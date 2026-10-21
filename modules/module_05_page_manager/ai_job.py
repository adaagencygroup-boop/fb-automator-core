"""Job đăng bài AI: đăng nhập nick admin, đếm page, đăng từng page."""
import os
import random
import re
import tempfile
import threading
import time
from datetime import datetime, timedelta

import httpx

from modules.module_02_account_manager.context import owner_scope, owner_context
from modules.module_04_page_creator.automation.facebook_urls import facebook_picture_id

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_lock = threading.Lock()
_states = {}


def _state_for(owner=None):
    key = owner if owner is not None else owner_context.get()
    return _states.setdefault(key, {
        "running": False, "stop": False, "logs": [],
        "started_at": None, "finished_at": None, "accounts": {},
    })


def parse_schedule_times(raw: str) -> list[str]:
    times = []
    for part in str(raw or "").replace(";", ",").split(","):
        value = part.strip()
        if not value:
            continue
        if not _TIME_RE.match(value):
            raise ValueError(f"Giờ không hợp lệ: {value}")
        times.append(value)
    return times


def snapshot():
    with _lock:
        return {
            "running": _state_for()["running"],
            "started_at": _state_for()["started_at"],
            "finished_at": _state_for()["finished_at"],
            "logs": list(_state_for()["logs"][-40:]),
            "accounts": dict(_state_for()["accounts"]),
        }


def request_stop():
    with _lock:
        if not _state_for()["running"]:
            return False
        _state_for()["stop"] = True
    _progress("Luồng", "Đã nhận lệnh dừng. Bài đang đăng sẽ xong rồi dừng.")
    return True


def _log(message):
    line = f"{datetime.now().strftime('%H:%M:%S')} {message}"
    with _lock:
        _state_for()["logs"].append(line)
        del _state_for()["logs"][:-80]
    try:
        from modules.module_02_account_manager.services.events import broadcast
        broadcast("info", message)
    except Exception:
        pass


def _progress(subject, message):
    """Dòng theo dõi tiến trình: 'Tên page - nội dung bước'."""
    name = (subject or "Luồng").strip() or "Luồng"
    _log(f"{name} - {message}")


def _format_remain(seconds: int) -> str:
    seconds = max(0, int(seconds))
    hours, rem = divmod(seconds, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours} giờ {minutes} phút {secs} giây"
    if minutes:
        return f"{minutes} phút {secs} giây"
    return f"{secs} giây"


def _seconds_until(hhmm: str, now: datetime | None = None) -> int:
    now = now or datetime.now()
    hour, minute = [int(part) for part in hhmm.split(":")]
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if now.strftime("%H:%M") == hhmm:
        return 0
    if target <= now:
        target += timedelta(days=1)
    return max(0, int((target - now).total_seconds()))


def _next_slot(times, fired, now: datetime | None = None):
    """Khung HH:MM gần nhất chưa chạy trong ngày; hết thì lấy khung sớm nhất ngày mai."""
    now = now or datetime.now()
    today = now.strftime("%Y-%m-%d")
    pending = []
    for slot in times:
        if f"{today} {slot}" in fired:
            continue
        pending.append((_seconds_until(slot, now), slot))
    if not pending:
        pending = [(_seconds_until(slot, now), slot) for slot in times]
    if not pending:
        return None, None
    pending.sort()
    remain, slot = pending[0]
    return slot, remain


def _wait_countdown(slot: str, remain: int) -> None:
    """Cập nhật dòng chờ hẹn giờ (đếm ngược), không spam thêm dòng mới."""
    line = f"{datetime.now().strftime('%H:%M:%S')} Hẹn giờ - Chờ đến {slot} (còn {_format_remain(remain)})"
    with _lock:
        logs = _state_for()["logs"]
        if logs and "Hẹn giờ - Chờ đến " in logs[-1]:
            logs[-1] = line
        else:
            logs.append(line)
            del logs[:-80]


def _stopped():
    with _lock:
        return _state_for()["stop"]


def _set_account(uid, **fields):
    with _lock:
        current = dict(_state_for()["accounts"].get(uid) or {})
        current.update(fields)
        _state_for()["accounts"][uid] = current


def pages_of(db, uid, owner):
    from modules.module_04_page_creator.automation.page_flow import clean_facebook_page_url
    from modules.module_04_page_creator.database import PageRepo

    rows = []
    for page in PageRepo.get_all(db, owner_username=owner):
        manager = (page.shared_admin_uid or "").strip() or (page.creator_fb_uid or "").strip()
        if manager != uid or page.status != "SUCCESS":
            continue
        url = clean_facebook_page_url(page.page_url) if page.page_url else ""
        rows.append({
            "id": page.id,
            "name": page.page_name or "Fanpage",
            "url": url,
            "category": page.page_category or "",
            "graph_id": facebook_picture_id(url),
        })
    return rows


def _fallback_content(page):
    """Bài tạm theo chủ đề khi không có key hoặc Gemini lỗi/ quá tải."""
    topic = (page.get("category") or "").strip() or page.get("name") or "hôm nay"
    name = (page.get("name") or "Fanpage").strip()
    text = (
        f"Hôm nay {name} muốn hỏi bạn: đã thử {topic} chưa?\n\n"
        f"Một chút {topic} đủ làm ngày mới dễ chịu hơn.\n"
        f"Bạn thích nhất phần nào? Comment cho mình biết nhé!"
    )
    return text, topic


def _content_for(page, config, check):
    from modules.module_05_page_manager.ai_generator import AIGenerator

    name = page["name"]
    keys = [key for key in (config.get("api_keys") or []) if str(key).strip()]
    topic = (page.get("category") or "").strip() or page["name"]
    if not keys:
        _progress(name, "Chưa có Gemini key, dùng bài tạm...")
        return _fallback_content(page)

    _progress(name, "Đang sinh nội dung bằng AI...")

    def on_ai_log(message):
        text = str(message or "")
        if "xuống" in text.lower() or "gợi ý" in text.lower() or "Model" in text:
            _progress(name, text.replace("[THÔNG TIN] ", "").replace("[CẢNH BÁO] ", "").replace("[LỖI] ", ""))
        elif "[CẢNH BÁO]" in text or "[LỖI]" in text or "[NGHIÊM TRỌNG]" in text:
            _progress(name, text.split("]", 1)[-1].strip() if "]" in text else text)

    generator = AIGenerator(
        api_keys=keys,
        model_name=config["model_name"],
        prompt_template=config.get("prompt") or "",
        log_func=on_ai_log,
    )
    raw = generator.generate_batch_content(
        [{"name": page["name"], "ai_keyword": topic}],
        check,
    )
    if not raw:
        _progress(name, "Gemini lỗi, dùng bài tạm...")
        return _fallback_content(page)
    content = re.search(r"CONTENT:\s*(.*)", raw, re.DOTALL)
    text = content.group(1).split("===")[0].strip() if content else ""
    if not text:
        _progress(name, "Gemini trả thiếu nội dung, dùng bài tạm...")
        return _fallback_content(page)
    keyword = re.search(r"KEYWORD:\s*(.*)", raw)
    image_keyword = keyword.group(1).strip() if keyword and keyword.group(1).strip() else topic
    _progress(name, f"Đã tạo nội dung ({len(text)} ký tự)")
    return text, image_keyword


def _download_to_temp(url: str):
    try:
        response = httpx.get(url, follow_redirects=True, timeout=20)
    except httpx.HTTPError:
        return None
    if response.status_code != 200 or not response.content:
        return None
    handle, path = tempfile.mkstemp(suffix=".jpg")
    os.close(handle)
    with open(path, "wb") as handle:
        handle.write(response.content)
    return path


def _placeholder_image_file(page_name=""):
    """Ảnh tạm khi Pixabay không ra — không để bài đăng không có ảnh."""
    # 1) Ảnh random public (không cần API key).
    for url in (
        "https://picsum.photos/1200/800",
        "https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=1200&q=80",
    ):
        path = _download_to_temp(url)
        if path:
            return path
    # 2) Tự vẽ JPG đơn giản bằng PIL.
    try:
        from PIL import Image, ImageDraw, ImageFont

        img = Image.new("RGB", (1200, 800), (240, 248, 255))
        draw = ImageDraw.Draw(img)
        title = (page_name or "Fanpage").strip()[:40] or "Fanpage"
        draw.rectangle((40, 40, 1160, 760), outline=(37, 99, 235), width=4)
        try:
            font = ImageFont.truetype("arial.ttf", 48)
        except Exception:
            font = ImageFont.load_default()
        draw.text((80, 340), title, fill=(15, 23, 42), font=font)
        draw.text((80, 420), "Anh minh hoa tam", fill=(100, 116, 139), font=font)
        handle, path = tempfile.mkstemp(suffix=".jpg")
        os.close(handle)
        img.save(path, format="JPEG", quality=90)
        return path
    except Exception:
        return None


def _image_file(keyword, pixabay_key, page_name=""):
    from modules.module_05_page_manager.image_downloader import get_image_from_internet

    subject = page_name or "Ảnh"
    seen = set()

    def on_image_log(message):
        text = str(message or "")
        if text in seen:
            return
        seen.add(text)
        if "Chưa có Pixabay" in text:
            _progress(subject, "Chưa có Pixabay key — dùng ảnh tạm")
        elif "Đang tìm ảnh trên Pixabay" in text:
            _progress(subject, "Đang tải ảnh minh họa từ Pixabay...")
        elif "giới hạn" in text.lower():
            _progress(subject, "Pixabay giới hạn lượt — dùng ảnh tạm")
        elif "ảnh tạm" in text.lower() or "[!]" in text or "[LỖI]" in text:
            _progress(subject, "Pixabay không ra ảnh — dùng ảnh tạm")

    url = get_image_from_internet(keyword, pixabay_key, on_image_log)
    if url:
        path = _download_to_temp(url)
        if path:
            return path

    _progress(subject, "Đang lấy ảnh tạm để đăng kèm bài...")
    path = _placeholder_image_file(page_name)
    if path:
        _progress(subject, "Đã có ảnh tạm")
        return path
    _progress(subject, "Không lấy được ảnh tạm — đăng chữ thôi")
    return None


def _record(page, uid, caption, ok, error=""):
    try:
        from core.database.connection import db
        db.execute(
            """INSERT INTO posting_history
               (user_id, page_id, account_uid, post_type, title, caption, post_url, status, error_message)
               VALUES (?, ?, ?, 'AI', ?, ?, ?, ?, ?)""",
            (
                owner_context.get(),
                page.get("graph_id") or str(page["id"]),
                uid,
                page["name"],
                caption[:4000],
                page.get("url") or "",
                "SUCCESS" if ok else "FAILED",
                error[:500],
            ),
        )
    except Exception:
        pass


def _sleep(seconds):
    for _ in range(max(0, int(seconds))):
        if _stopped():
            return False
        time.sleep(1)
    return not _stopped()


def _post_round(owner, uid, pages, config):
    from modules.module_02_account_manager.automation.browser_manager import (
        close_driver_for_uid,
        create_driver,
        register_active_driver,
    )
    from modules.module_02_account_manager.automation.login_flow import ensure_logged_in, ensure_personal_profile
    from modules.module_02_account_manager.database.connection import SessionLocal
    from modules.module_02_account_manager.database.repository import AccountRepository as Repo
    from modules.module_02_account_manager.security.hwid_collector import get_hwid
    from modules.module_02_account_manager.services.credentials import decrypt
    from modules.module_05_page_manager.page_poster import post_on_page

    db = SessionLocal()
    driver = None
    try:
        account = Repo.get_by_uid(db, uid, owner_username=owner)
        if account is None:
            _set_account(uid, status="FAILED", message="Không tìm thấy tài khoản")
            return
        try:
            password = decrypt(account.password, get_hwid()) if account.password else ""
        except Exception:
            password = ""
        try:
            two_fa = decrypt(account.two_fa) if account.two_fa else None
        except Exception:
            two_fa = None
        nick = (account.profile_name or "").strip() or uid
        _progress(nick, "Đang mở Chrome và đăng nhập...")
        try:
            close_driver_for_uid(uid)
        except Exception:
            pass
        driver = create_driver(uid, proxy=account.proxy, scope="ai-post")
        register_active_driver(driver, uid=uid, scope="ai-post")
        login = ensure_logged_in(
            driver=driver,
            uid=uid,
            password=password,
            two_fa=two_fa,
            cookie=account.cookie,
        )
        if not login.get("success"):
            _set_account(uid, status="FAILED", message=login.get("error") or "Đăng nhập thất bại")
            _progress(nick, f"Đăng nhập thất bại: {login.get('error') or 'không rõ'}")
            return
        try:
            ensure_personal_profile(driver, uid)
        except Exception:
            pass
        _set_account(uid, status="RUNNING", page_count=len(pages), message="Đang đăng bài")
        for page in pages:
            if _stopped():
                _set_account(uid, status="STOPPED", message="Đã dừng")
                return
            if not page.get("url"):
                _progress(page["name"], "Bỏ qua: chưa có link page.")
                continue
            page_id = str(page.get("graph_id") or page.get("id") or "")
            caption, keyword = _content_for(page, config, lambda: not _stopped())
            image = _image_file(keyword, config.get("pixabay_key") or "", page["name"])
            try:
                if image:
                    _progress(page["name"], "Có ảnh — sẽ gắn vào bài")
                else:
                    _progress(page["name"], "Không có ảnh — đăng chữ thôi")
                _progress(page["name"], f"Đang mở page và đăng bài... ({(page.get('url') or '')[:70]})")
                ok = post_on_page(driver, page["url"], caption, image, page_id=page_id)
                _record(page, uid, caption, ok)
                _progress(page["name"], "Đăng thành công ✓" if ok else "Đăng thất bại")
            except Exception as exc:
                _record(page, uid, caption, False, str(exc))
                _progress(page["name"], f"Đăng thất bại: {exc}")
            finally:
                if image and os.path.exists(image):
                    os.remove(image)
            delay = random.randint(config["sleep_min"], config["sleep_max"])
            _progress(page["name"], f"Nghỉ {delay} giây trước page tiếp theo...")
            if not _sleep(delay):
                _set_account(uid, status="STOPPED", message="Đã dừng")
                return
        _set_account(uid, status="SUCCESS", message=f"Xong {len(pages)} page")
        _progress(nick, f"Xong {len(pages)} page")
    finally:
        db.close()
        if driver is not None:
            try:
                close_driver_for_uid(uid)
            except Exception:
                try:
                    driver.quit()
                except Exception:
                    pass


def _due(times, fired):
    now = datetime.now().strftime("%H:%M")
    today = datetime.now().strftime("%Y-%m-%d")
    if now in times and f"{today} {now}" not in fired:
        fired.add(f"{today} {now}")
        return True
    return False


def start_job(owner, config, grouped):
    if not owner:
        raise ValueError("Thiếu owner cho tác vụ AI.")
    with _lock:
        if _state_for(owner)["running"]:
            raise RuntimeError("Đang có luồng đăng bài.")
        _state_for(owner).update(running=True, stop=False, logs=[], started_at=datetime.now().isoformat(), finished_at=None, accounts={
            uid: {"status": "PENDING", "page_count": len(pages), "message": "Chờ đăng nhập"}
            for uid, pages in grouped.items()
        })

    def run():
        try:
            with owner_scope(owner):
                fired = set()
                while not _stopped():
                    if config["schedule_enabled"]:
                        if not _due(config["schedule_times"], fired):
                            slot, remain = _next_slot(config["schedule_times"], fired)
                            if slot is not None:
                                _wait_countdown(slot, remain)
                            if not _sleep(1):
                                break
                            continue
                        _progress("Hẹn giờ", f"Đến khung {datetime.now().strftime('%H:%M')}, bắt đầu đăng...")
                    for uid, pages in grouped.items():
                        if _stopped():
                            break
                        _post_round(owner, uid, pages, config)
                    if not config["schedule_enabled"] or _stopped():
                        break
                _progress("Luồng", "Đã kết thúc")
        finally:
            with _lock:
                _state_for(owner)["running"] = False
                _state_for(owner)["finished_at"] = datetime.now().isoformat()
                if _state_for(owner)["stop"]:
                    for uid, item in _state_for(owner)["accounts"].items():
                        if item.get("status") in {"PENDING", "RUNNING"}:
                            item["status"] = "STOPPED"

    threading.Thread(target=run, name="ai-page-post", daemon=True).start()
