import os
import asyncio
from datetime import datetime
from typing import Dict, Any
import json
from modules.module_06_omnichannel_chat.database import SessionLocal
from modules.module_06_omnichannel_chat.repositories import (
    MessageRepository,
    ConversationRepository,
    CustomerRepository,
)
from modules.module_06_omnichannel_chat.websocket import manager
from modules.module_06_omnichannel_chat.models import Page, Notification, Message, Conversation, Customer

# Safe import for native Windows notifications
try:
    from plyer import notification as win_notifier
except ImportError:
    win_notifier = None

# Safe import for Web Push (Service Worker)
try:
    from pywebpush import webpush, WebPushException
except ImportError:
    webpush = None

async def trigger_web_push(db, facebook_user_id: str, title: str, body: str, target_url: str = "/"):
    from modules.module_06_omnichannel_chat.services.web_push import WebPushService
    return await WebPushService.trigger_web_push(db, facebook_user_id, title, body, target_url=target_url)

# In-memory Async Event Queue
event_queue = asyncio.Queue()

async def process_webhook_event(event: Dict[str, Any]):
    """Processes a single queued webhook payload from Facebook."""
    db = SessionLocal()
    try:
        obj_type = event.get("object")
        if obj_type != "page":
            return

        entries = event.get("entry", [])
        for entry in entries:
            page_id = entry.get("id")

            # 1. Parse real-time messages
            messagings = entry.get("messaging", [])
            for messaging in messagings:
                sender_obj = messaging.get("sender", {})
                sender_id = sender_obj.get("id")
                msg_sender_name = sender_obj.get("name") or (f"Khách hàng {sender_id[:8]}" if sender_id else "Khách hàng")
                recipient_id = messaging.get("recipient", {}).get("id")
                timestamp = messaging.get("timestamp")

                # 1.1 Handle incoming reactions from customer
                reaction_event = messaging.get("reaction")
                if reaction_event:
                    mid = reaction_event.get("mid")
                    action = reaction_event.get("action", "react")
                    raw_emoji = reaction_event.get("emoji") or reaction_event.get("reaction")

                    emoji_map = {
                        "like": "👍",
                        "love": "❤️",
                        "haha": "😂",
                        "wow": "😮",
                        "sad": "😢",
                        "angry": "😡",
                    }
                    final_emoji = emoji_map.get(raw_emoji, raw_emoji)
                    reaction_val = final_emoji if action == "react" else None

                    if mid:
                        msg = db.query(Message).filter(Message.facebook_message_id == mid).first()
                        if msg:
                            msg.reactions = reaction_val
                            db.commit()

                            page_record = db.query(Page).filter(Page.page_id == page_id).first()
                            if page_record:
                                ws_payload = {
                                    "type": "reaction",
                                    "page_id": page_id,
                                    "data": {
                                        "facebook_message_id": mid,
                                        "reactions": reaction_val,
                                    },
                                }
                                await manager.send_personal_message(ws_payload, page_record.facebook_user_id)

                message_obj = messaging.get("message", {})
                message_id = message_obj.get("mid")
                text = message_obj.get("text")

                sticker_id = message_obj.get("sticker_id")
                sticker_url = message_obj.get("sticker") or message_obj.get("sticker_url")
                if not text and (sticker_id or sticker_url):
                    s_url = sticker_url if sticker_url else "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/2021_Facebook_icon.svg/192px-2021_Facebook_icon.svg.png"
                    text = f"[image] {s_url}"

                # Support incoming attachments (images/files) from customer
                attachments = message_obj.get("attachments", [])
                if not text and attachments:
                    att = attachments[0]
                    att_type = str(att.get("type", "image")).lower()
                    payload = att.get("payload", {})
                    att_url = payload.get("url") or payload.get("src") or att.get("url") or ""
                    att_url_lower = att_url.lower()

                    if "audio" in att_type or "audioclip" in att_url_lower or any(att_url_lower.split("?")[0].endswith(ext) for ext in [".m4a", ".aac", ".mp3", ".wav", ".ogg"]):
                        att_type = "audio"

                    if att_url and att_url.startswith("http"):
                        import uuid
                        import requests

                        file_ext = ".bin"
                        if att_type == "image": file_ext = ".jpg"
                        elif att_type == "audio": file_ext = ".mp4"
                        elif att_type == "video": file_ext = ".mp4"

                        local_filename = f"fb_incoming_{uuid.uuid4().hex}{file_ext}"
                        # queue_worker.py nam nong hon routers/ 1 cap -> chi di len 2 cap
                        # moi tro ve goc repo, dung thu muc ma engine.py dang serve
                        uploads_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../uploads"))
                        os.makedirs(uploads_dir, exist_ok=True)
                        local_filepath = os.path.join(uploads_dir, local_filename)

                        try:
                            resp = await asyncio.to_thread(requests.get, att_url, timeout=15)
                            if resp.status_code == 200:
                                with open(local_filepath, "wb") as f:
                                    f.write(resp.content)
                                att_url = f"/uploads/{local_filename}"
                        except Exception as e:
                            print(f"Error downloading incoming attachment: {e}")

                    if not att_url:
                        att_url = "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/2021_Facebook_icon.svg/192px-2021_Facebook_icon.svg.png"

                    if att_type == "image":
                        text = f"[image] {att_url}"
                    elif att_type == "audio":
                        text = f"[audio] {att_url}"
                    elif att_type in ("video", "file"):
                        text = f"[file] {att_url}"
                    else:
                        text = f"[image] {att_url}"

                if not text or not text.strip():
                    text = "📎 [Tin nhắn đính kèm]"

                if message_id and sender_id and recipient_id:
                    direction = "outbound" if sender_id == page_id else "inbound"
                    active_customer_id = sender_id if direction == "inbound" else recipient_id

                    message_repo = MessageRepository(db)
                    saved_msg = message_repo.save_webhook_message(
                        facebook_message_id=message_id,
                        page_id=page_id,
                        sender_id=active_customer_id,
                        text=text,
                        timestamp=timestamp,
                        direction=direction,
                    )

                    # Resolve Page mapping
                    page_record = db.query(Page).filter(Page.page_id == page_id).first()
                    if page_record:
                        # Resolve real customer profile from Graph API
                        from modules.module_06_omnichannel_chat.services import FacebookSyncService
                        sync_service = FacebookSyncService(db)
                        profile_info = await sync_service.get_customer_profile(active_customer_id, page_id)
                        real_customer_name = profile_info.get("name") or msg_sender_name
                        customer_avatar = profile_info.get("avatar_url", "")

                        # Update Conversation & Customer tables for instant sidebar
                        try:
                            conv_repo = ConversationRepository(db)
                            conv_repo.upsert_conversation(
                                page_id=page_id,
                                customer_psid=active_customer_id,
                                customer_name=real_customer_name,
                                customer_avatar=customer_avatar,
                                last_message=text,
                                is_read=(direction == "outbound"),
                                is_replied=(direction == "outbound"),
                            )
                            cust_repo = CustomerRepository(db)
                            cust_repo.upsert_customer(
                                psid=active_customer_id,
                                name=real_customer_name,
                                avatar_url=customer_avatar,
                            )
                        except Exception as cache_err:
                            print(f"[Conversation Upsert Warning] {cache_err}")

                        # Broadcast message packet to WebSocket clients
                        ws_payload = {
                            "type": "message",
                            "page_id": page_id,
                            "page_name": page_record.page_name,
                            "facebook_user_id": page_record.facebook_user_id,
                            "data": {
                                "id": saved_msg.id,
                                "facebook_message_id": saved_msg.facebook_message_id,
                                "page_id": saved_msg.page_id,
                                "sender_id": saved_msg.sender_id,
                                "text": saved_msg.text,
                                "timestamp": saved_msg.timestamp,
                                "direction": saved_msg.direction,
                                "created_at": saved_msg.created_at.isoformat(),
                                "sender_name": real_customer_name,
                                "avatar_url": customer_avatar,
                            },
                        }
                        await manager.send_personal_message(ws_payload, page_record.facebook_user_id)

                        # Trigger native Windows notifications for inbound client messages
                        if direction == "inbound" and win_notifier:
                            try:
                                icon_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../app_logo.ico"))
                                icon_to_use = icon_path if os.path.exists(icon_path) else None
                                msg_preview = text[:50] if text else "[Hình ảnh/Tệp đính kèm]"
                                await asyncio.to_thread(
                                    win_notifier.notify,
                                    title=f"💬 Tin nhắn từ {real_customer_name} ({page_record.page_name})",
                                    message=f"{real_customer_name}: {msg_preview}",
                                    app_name="Hội thoại Đa kênh (Omnichannel)",
                                    app_icon=icon_to_use,
                                    timeout=6,
                                )
                            except Exception as ne:
                                print(f"[Notifier Error] {str(ne)}")

                        # Trigger Service Worker push notification
                        if direction == "inbound":
                            msg_preview = text[:60] if text else "[Hình ảnh/Tệp đính kèm]"
                            push_title = f"💬 {page_record.page_name}"
                            push_body = f"Tin nhắn từ {real_customer_name}: \"{msg_preview}\""
                            await trigger_web_push(db, page_record.facebook_user_id, push_title, push_body)

            # 2. Parse feed changes (Likes/Comments -> Notifications)
            changes = entry.get("changes", [])
            for change in changes:
                field_name = change.get("field")
                if field_name in ["feed", "mention", "ratings"]:
                    value = change.get("value", {})
                    item = value.get("item")  # comment, like, post
                    verb = value.get("verb")  # add, edit, remove
                    from_obj = value.get("from", {})

                    sender_id = from_obj.get("id") or value.get("sender_id") or value.get("reviewer_id") or "anonymous"
                    sender_name = from_obj.get("name") or value.get("sender_name") or value.get("reviewer_name") or "Khách hàng"
                    message_text = value.get("message") or value.get("review_text") or ""
                    post_id = value.get("post_id") or value.get("review_id") or "unknown_post"

                    title = ""
                    notif_id = ""
                    link = ""

                    if field_name == "ratings" and verb == "add":
                        rating = value.get("rating", 5)
                        preview = (message_text[:40] + "...") if len(message_text) > 40 else message_text
                        title = f"{sender_name} đã đánh giá {rating} sao: \"{preview}\""
                        notif_id = f"rating_{post_id}_{sender_id}"
                        link = f"https://facebook.com/{page_id}/reviews"

                    elif field_name == "mention" and verb == "add":
                        title = f"{sender_name} đã nhắc đến trang của bạn"
                        notif_id = f"mention_{post_id}_{sender_id}"
                        link = f"https://facebook.com/{post_id}"

                    elif field_name == "feed" and sender_id and page_id and sender_id != page_id:
                        comment_id = value.get("comment_id")
                        group_id = value.get("group_id") or value.get("community_id") or value.get("community")
                        permalink = value.get("permalink_url") or value.get("link")

                        is_group_post = False
                        perm_str = str(permalink or "")
                        target_id = str(post_id).split("_")[0] if (post_id and "_" in str(post_id)) else None

                        if group_id or "/groups/" in perm_str or "/groups/" in str(post_id):
                            is_group_post = True
                        elif target_id and target_id != str(page_id):
                            is_group_post = True
                        elif post_id and not str(post_id).startswith(str(page_id)) and "story_fbid" not in perm_str and "permalink.php" not in perm_str and f"id={page_id}" not in perm_str:
                            is_group_post = True

                        prefix = "👥 [Nhóm]" if is_group_post else "📌 [Trang]"

                        if item == "comment":
                            title = f"{prefix} {sender_name} đã bình luận: \"{message_text}\""
                        elif item in ("like", "reaction"):
                            reaction_type = value.get("reaction_type") or "like"
                            react_map = {
                                "like": "thích",
                                "love": "yêu thích",
                                "haha": "haha",
                                "wow": "wow",
                                "sad": "buồn",
                                "angry": "phẫn nộ",
                            }
                            viet_react = react_map.get(reaction_type.lower(), reaction_type)
                            title = f"{prefix} {sender_name} đã bày tỏ cảm xúc \"{viet_react}\""
                        elif item == "post":
                            title = f"{prefix} {sender_name} đã đăng một bài viết"
                        elif item == "share":
                            title = f"{prefix} {sender_name} đã chia sẻ bài viết"
                        elif item in ("photo", "video", "status"):
                            title = f"{prefix} {sender_name} đã cập nhật một {item} mới"
                        elif item == "follow":
                            title = f"{prefix} {sender_name} đã bắt đầu theo dõi trang"
                        else:
                            title = f"{prefix} {sender_name} đã tương tác \"{item}\""

                        notif_id = comment_id if comment_id else f"{post_id}_{item}_{verb}_{sender_id}"

                        if permalink and str(permalink).startswith("http"):
                            link = str(permalink)
                        elif is_group_post and group_id:
                            link = f"https://facebook.com/groups/{group_id}/permalink/{post_id}/"
                        else:
                            link = f"https://facebook.com/{post_id}"

                    if title and notif_id:
                        db_notif = db.query(Notification).filter(
                            Notification.facebook_notification_id == notif_id
                        ).first()

                        if not db_notif:
                            page_record = db.query(Page).filter(Page.page_id == page_id).first()
                            from modules.module_06_omnichannel_chat.services import FacebookSyncService
                            sync_service = FacebookSyncService(db)
                            profile_info = await sync_service.get_customer_profile(sender_id, page_id) if (sender_id and page_id) else {}
                            avatar_url = profile_info.get("avatar_url", "")
                            if profile_info.get("name") and (not sender_name or sender_name == "Khách hàng"):
                                sender_name = profile_info.get("name")

                            db_notif = Notification(
                                facebook_notification_id=notif_id,
                                page_id=page_id,
                                page_name=page_record.page_name if page_record else "Trang Facebook",
                                title=title,
                                link=link,
                                created_time=datetime.utcnow(),
                                unread=True,
                                from_user_id=sender_id,
                                from_user_name=sender_name,
                                from_user_avatar=avatar_url,
                                notification_type=item if item else "comment",
                            )
                            db.add(db_notif)
                            db.commit()
                            db.refresh(db_notif)

                            if page_record:
                                # Broadcast notification alert to WebSocket
                                ws_payload = {
                                    "type": "notification",
                                    "page_id": page_id,
                                    "page_name": page_record.page_name,
                                    "facebook_user_id": page_record.facebook_user_id,
                                    "data": {
                                        "id": db_notif.id,
                                        "facebook_notification_id": db_notif.facebook_notification_id,
                                        "page_id": db_notif.page_id,
                                        "page_name": page_record.page_name,
                                        "title": db_notif.title,
                                        "link": db_notif.link,
                                        "created_time": db_notif.created_time.isoformat(),
                                        "unread": db_notif.unread,
                                        "from_user_id": db_notif.from_user_id,
                                        "from_user_name": db_notif.from_user_name,
                                        "from_user_avatar": db_notif.from_user_avatar,
                                        "notification_type": db_notif.notification_type,
                                    },
                                }
                                await manager.send_personal_message(ws_payload, page_record.facebook_user_id)

                                # Trigger native Windows toast for feed interaction
                                if win_notifier:
                                    try:
                                        icon_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../app_logo.ico"))
                                        icon_to_use = icon_path if os.path.exists(icon_path) else None
                                        await asyncio.to_thread(
                                            win_notifier.notify,
                                            title=f"🔔 Tương tác mới - {page_record.page_name}",
                                            message=title,
                                            app_name="Hội thoại Đa kênh (Omnichannel)",
                                            app_icon=icon_to_use,
                                            timeout=6,
                                        )
                                    except Exception as ne:
                                        print(f"[Notifier Error] {str(ne)}")

                                # Trigger Service Worker push notification
                                push_title = f"{prefix} {page_record.page_name}"
                                push_body = title
                                push_url = link if is_group_post else "/"
                                await trigger_web_push(db, page_record.facebook_user_id, push_title, push_body, target_url=push_url)

    except Exception as e:
        print(f"[Queue Worker] Error parsing webhook item: {str(e)}")
    finally:
        db.close()

async def start_queue_worker():
    """Background loop daemon for event parsing consumer."""
    print("[Queue Worker] Event loop consumer initiated successfully.")
    while True:
        try:
            event = await event_queue.get()
            await process_webhook_event(event)
            event_queue.task_done()
        except asyncio.CancelledError:
            print("[Queue Worker] Worker loop cancelled.")
            break
        except Exception as e:
            print(f"[Queue Worker] Consumer exception occurred: {str(e)}")
            await asyncio.sleep(1)
