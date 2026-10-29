"""
Điều phối tạo fanpage: đăng nhập nick có sẵn, Gemini, điền form Facebook, cấp admin.
Port từ project_auto_create_page_facebook. Không gồm import tài khoản.
"""
import asyncio
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from modules.module_02_account_manager.api.router import scoped_owner
from modules.module_02_account_manager.context import owner_context, owner_scope
from modules.module_02_account_manager.database.connection import get_db
from modules.module_02_account_manager.security.hwid_collector import get_hwid
from modules.module_02_account_manager.services.events import broadcast

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/api/creator",
    tags=["Module 04: Page Creator"],
    dependencies=[Depends(scoped_owner)],
)
executor = ThreadPoolExecutor(max_workers=10, thread_name_prefix="page-creator")

try:
    HWID = get_hwid()
except Exception:
    HWID = ""


def get_owner_username(request=None, explicit_owner=None):
    current = owner_context.get()
    if current:
        return current
    if explicit_owner and str(explicit_owner).strip():
        return str(explicit_owner).strip()
    return None


def check_user_license_valid(owner=None):
    """Bản quyền đã được LicenseMiddleware chặn trước khi vào API này."""
    return True


class CreatePageItem(BaseModel):
    uid: str
    page_name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    loop_round: Optional[int] = 1
    owner_username: Optional[str] = None


class CreatePageRequest(BaseModel):
    pages: list[CreatePageItem]
    target_admin_uid: str
    threads: int = 2
    delay_min: int = 120
    delay_max: int = 240
    repeat_count: int = 1
    country_code: str = "+84"
    batch_id: Optional[str] = None
    owner_username: Optional[str] = None


class SettingItem(BaseModel):
    key: str
    value: str


class ManualPageRequest(BaseModel):
    page_name: str
    manager_uid: str
    page_url: Optional[str] = ""
    page_category: Optional[str] = ""


async def _run_with_owner(owner, fn):
    with owner_scope(owner):
        await fn()


def _owned_page_worker(item, target_admin_uid, country_code="+84", owner_username=None):
    with owner_scope(owner_username or (item or {}).get("owner_username")):
        return _create_page_worker(item, target_admin_uid, country_code, owner_username)


stop_task_requested = False
pause_task_requested = False
_open_browser_pending = set()
_open_browser_pending_lock = threading.Lock()
active_creator_task: Optional[asyncio.Task] = None

from modules.module_02_account_manager.automation.browser_manager import (
    register_active_driver,
    unregister_active_driver,
    close_all_active_drivers,
    close_scoped_active_drivers,
    close_driver_for_uid,
    get_profile_lock,
)


def wait_if_paused():
    """Chờ nếu tiến trình đang ở trạng thái Tạm dừng (Pause). Thoát ngay nếu Dừng khẩn cấp."""
    global pause_task_requested, stop_task_requested
    import time
    while pause_task_requested and not stop_task_requested:
        time.sleep(0.5)


# ── Tạo Page ──

def _create_page_worker(item: dict, target_admin_uid: str, country_code: str = "+84", owner_username: Optional[str] = None):
    """Worker tạo Page chạy trong thread pool."""
    from modules.module_02_account_manager.automation.browser_manager import create_driver, human_sleep, get_profile_lock, close_driver_for_uid
    from modules.module_04_page_creator.automation.page_flow import run_page_creation, finalize_page, clean_facebook_page_url
    from modules.module_04_page_creator.automation.share_admin_flow import run_share_admin
    from modules.module_04_page_creator.integrations.gemini_client import GeminiClient
    from modules.module_04_page_creator.integrations.media_downloader import generate_ai_page_media, create_placeholder_image, validate_image
    from modules.module_02_account_manager.database.connection import SessionLocal
    from modules.module_04_page_creator.database import AccountRepo, PageRepo, SettingRepo
    from modules.module_02_account_manager.services.credentials import decrypt

    if stop_task_requested:
        return

    owner = owner_username or item.get("owner_username")
    uid = item["uid"]
    page_name = item["page_name"]
    broadcast("info", f"🤖 [{uid}] Bắt đầu xử lý page: '{page_name}' (Mã QG: {country_code})", uid=uid, extra={"action": "step", "page_name": page_name, "step": "Bước 1/5: Bắt đầu xử lý & kết nối nick", "subStage": "Khởi tạo môi trường", "percent": 15})

    # Tự động đóng trình duyệt Live cũ của nick (nếu có) để nhường quyền ưu tiên cho tiến trình Tạo Page
    close_driver_for_uid(uid)

    profile_lock = get_profile_lock(uid)
    profile_lock.acquire()

    db = SessionLocal()
    driver = None
    admin_name = ""
    try:
        if stop_task_requested:
            return {"success": False, "reason": "stopped"}
        account = AccountRepo.get_by_uid(db, uid, owner_username=owner) or AccountRepo.get_by_uid(db, uid)
        if not account:
            broadcast("error", f"❌ [{uid}] Không tìm thấy tài khoản", uid=uid, extra={"action": "failed", "page_name": page_name, "percent": 100})
            return {"success": False, "reason": "not_found"}

        try:
            password = decrypt(account.password, HWID) if account.password else ""
        except Exception as dec_err:
            password = account.password or ""
            logger.warning(f"[{uid}] Decrypt password fallback note: {dec_err}")

        # Log thông tin đầu vào bóc tách được
        input_phone = item.get("phone", "")
        input_email = item.get("email", "")
        input_address = item.get("address", "")
        broadcast("info", f"📋 [{uid}] Dữ liệu bóc tách: Page='{page_name}' | SĐT='{input_phone}' | Mail='{input_email}' | Địa chỉ='{input_address}' | Mã QG='{country_code}'", uid=uid)

        # ── Bước AI: Gọi Gemini ──
        gemini_key = SettingRepo.get(db, "gemini_api_key")
        gemini_model = SettingRepo.get(db, "gemini_model") or "gemini-3.8-flash"
        ai_data = {}
        if gemini_key and not stop_task_requested:
            try:
                broadcast("info", f"🧠 [{uid}] Đang gọi Gemini AI (Model: {gemini_model}) cho Page '{page_name}'...", uid=uid, extra={"action": "step", "page_name": page_name, "step": "Bước 2/5: Gemini AI đang sinh nội dung Bio & Prompt", "subStage": "Sinh nội dung AI", "percent": 35})
                client = GeminiClient(gemini_key)
                ai_data = client.generate_page_content(page_name, preferred_model=gemini_model)
                used_model = ai_data.get("_used_model", gemini_model)
                if ai_data.get("_fallback_from"):
                    fb_from = ai_data.get("_fallback_from")
                    fb_reason = str(ai_data.get("_fallback_reason", "Quá tải hoặc không phản hồi"))
                    if "429" in fb_reason or "ResourceExhausted" in fb_reason:
                        short_reason = "Đạt giới hạn Quota / Rate limit (429)"
                    elif "404" in fb_reason or "NotFound" in fb_reason:
                        short_reason = "Model không tồn tại hoặc đã ngừng phục vụ (404)"
                    else:
                        short_reason = fb_reason[:70]
                    broadcast("warning", f"⚠️ [{uid}] Model '{fb_from}' gặp sự cố ({short_reason}). Đã tự động chuyển sang '{used_model}' thành công!", uid=uid)
                broadcast("success", f"✨ [{uid}] Gemini AI ({used_model}) đã sinh thành công các trường:", uid=uid)
                broadcast("info", f"   ├── 📌 Hạng mục (Category): {ai_data.get('category')}", uid=uid)
                broadcast("info", f"   ├── 📝 Tiểu sử (Bio): {ai_data.get('bio')}", uid=uid)
                broadcast("info", f"   ├── 📰 Nội dung bài viết: {ai_data.get('post_content')[:90]}...", uid=uid)
                broadcast("info", f"   ├── 🖼️ Avatar Prompt: {ai_data.get('avatar_prompt')}", uid=uid)
                broadcast("info", f"   ├── 🏙️ Cover Prompt: {ai_data.get('cover_prompt')}", uid=uid)
                broadcast("info", f"   └── 🖼️ Post Image Prompt: {ai_data.get('post_image_prompt')}", uid=uid)
            except Exception as e:
                logger.warning(f"[{uid}] Gemini AI error: {e}")
                broadcast("warning", f"⚠️ [{uid}] Gọi Gemini AI thất bại ({e}). Chuyển sang dữ liệu mặc định.", uid=uid)
        else:
            broadcast("info", f"ℹ️ [{uid}] Chưa cấu hình Gemini API Key. Sử dụng nội dung mặc định.", uid=uid)

        if stop_task_requested:
            broadcast("warning", f"⏹️ [{uid}] Đã nhận lệnh dừng khẩn cấp trước khi mở trình duyệt.", uid=uid)
            return

        category = ai_data.get("category", "Dịch vụ kinh doanh")
        bio = ai_data.get("bio", f"Chào mừng bạn đến với {page_name}!")
        post_content = ai_data.get("post_content", f"Chào mừng đến với {page_name}! 🎉")
        post_image_prompt = ai_data.get("post_image_prompt", f"High quality promotional poster illustration for {page_name} matching {category} concept")

        # ── Sinh/Tải ảnh AI chuyên nghiệp chuẩn tỉ lệ FB (Avatar 800x800, Cover Banner 1640x624, Post Banner 1080x1080) ──
        broadcast("info", f"🎨 [{uid}] Đang khởi tạo bộ nhận diện thương hiệu AI (Avatar Emblem Logo 800x800, Cover Banner 1640x624 & Post Image 1080x1080)...", uid=uid, extra={"action": "step", "page_name": page_name, "step": "Bước 3/5: Tải & Tối ưu Avatar, Cover Banner Spintax AI", "subStage": "Media Branding AI", "percent": 55})
        avatar_path = generate_ai_page_media(
            uid=uid,
            kind="avatar",
            page_name=page_name,
            prompt=ai_data.get("avatar_prompt", "")
        )
        cover_path = generate_ai_page_media(
            uid=uid,
            kind="cover",
            page_name=page_name,
            prompt=ai_data.get("cover_prompt", "")
        )
        post_img_path = generate_ai_page_media(
            uid=uid,
            kind="post",
            page_name=page_name,
            prompt=post_image_prompt
        )

        if not validate_image(avatar_path):
            avatar_path = create_placeholder_image(uid, "avatar", page_name)
        if not validate_image(cover_path):
            cover_path = create_placeholder_image(uid, "cover", page_name)

        # ── Mở Chrome & Tạo Page ──
        broadcast("info", f"🌐 [{uid}] Mở Chrome & Tạo Page '{page_name}'...", uid=uid, extra={"action": "step", "page_name": page_name, "step": "Bước 4/5: Mở Chromium Headless & Điền Form Page", "subStage": "Đang ghi đè Bio", "percent": 75})
        driver = create_driver(uid, proxy=account.proxy if account else None, scope="creator")
        register_active_driver(driver, uid=uid, scope="creator")

        if stop_task_requested:
            broadcast("warning", f"⏹️ [{uid}] Đã nhận lệnh dừng khẩn cấp sau khi mở trình duyệt.", uid=uid)
            return {"success": False, "reason": "stopped"}

        # ── ĐẢM BẢO ĐÃ ĐĂNG NHẬP (Tự động đăng nhập lại nếu phiên bị hết hạn) ──
        from modules.module_02_account_manager.automation.login_flow import ensure_logged_in
        try:
            two_fa_plain = decrypt(account.two_fa, HWID) if account.two_fa else None
        except Exception:
            two_fa_plain = account.two_fa or None
        login_check = ensure_logged_in(
            driver=driver,
            uid=uid,
            password=password,
            two_fa=two_fa_plain,
            cookie=account.cookie,
        )

        if not login_check["success"]:
            broadcast("error", f"❌ [{uid}] Phiên đăng nhập không hợp lệ: {login_check['error']}", uid=uid, extra={"action": "failed", "page_name": page_name, "percent": 100})
            AccountRepo.update_login_status(db, uid, "failed")
            PageRepo.create(db, {
                "owner_username": owner,
                "creator_fb_uid": uid,
                "shared_admin_uid": target_admin_uid,
                "page_name": page_name,
                "status": "FAILED",
                "log_detail": f"Lỗi đăng nhập: {login_check['error']}",
            }, owner_username=owner)
            return {"success": False, "reason": "login_failed", "error": login_check["error"]}

        if login_check.get("reloaded"):
            AccountRepo.update_login_status(db, uid, "logged_in")
            broadcast("success", f"✅ [{uid}] Đã tự động phục hồi phiên đăng nhập thành công!", uid=uid)

        # Lưu lại cookies mới nhất vào database
        try:
            from modules.module_02_account_manager.automation.browser_manager import extract_cookies_as_string
            fresh_cookie = extract_cookies_as_string(driver)
            if fresh_cookie and "c_user" in fresh_cookie:
                AccountRepo.update_cookies(db, uid, fresh_cookie)
        except Exception:
            pass

        # ── Đảm bảo trình duyệt luôn ở tài khoản cá nhân gốc trước khi tạo Page (tránh kẹt profile Fanpage vòng trước) ──
        try:
            from modules.module_02_account_manager.automation.login_flow import ensure_personal_profile
            ensure_personal_profile(driver, uid)
        except Exception as pe:
            logger.debug(f"[{uid}] ensure_personal_profile note: {pe}")

        page_result = run_page_creation(
            driver=driver,
            page_name=page_name,
            category=category,
            bio=bio,
            phone=item.get("phone", ""),
            email=item.get("email", ""),
            address=item.get("address", ""),
            avatar_path=avatar_path,
            cover_path=cover_path,
            country_code=country_code,
        )

        wait_if_paused()
        if stop_task_requested:
            broadcast("warning", f"⏹️ [{uid}] Tiến trình bị ngắt bởi lệnh dừng khẩn cấp.", uid=uid)
            return {"success": False, "reason": "stopped"}

        if not page_result["success"]:
            broadcast("error", f"❌ [{uid}] Tạo page thất bại: {page_result['error']}", uid=uid, extra={"action": "failed", "page_name": page_name, "percent": 100})
            PageRepo.create(db, {
                "owner_username": owner,
                "creator_fb_uid": uid,
                "shared_admin_uid": target_admin_uid,
                "page_name": page_name,
                "status": "FAILED",
                "log_detail": page_result["error"],
            }, owner_username=owner)
            return {"success": False, "reason": "page_create_failed", "error": page_result["error"]}

        # Hoàn tất (Skip WhatsApp, Done)
        actual_page_url = finalize_page(driver)
        if actual_page_url and "pages/creation" not in actual_page_url:
            page_result["page_url"] = actual_page_url
            logger.info(f"[{uid}] Finalized page URL: {actual_page_url}")
        else:
            cur = clean_facebook_page_url(driver.current_url or "")
            if cur:
                page_result["page_url"] = cur
                logger.info(f"[{uid}] Fallback captured page URL: {cur}")

        final_url_so_far = clean_facebook_page_url(page_result.get("page_url", ""))
        broadcast("info", f"📄 [{uid}] Page tạo xong. Tiến hành cấp quyền Admin...", uid=uid, extra={
            "action": "step",
            "page_name": page_name,
            "page_url": final_url_so_far,
            "step": "Bước 5/5: Phân quyền Quản trị viên Full Control",
            "subStage": "Final Handshake",
            "percent": 90
        })

        wait_if_paused()
        if stop_task_requested:
            PageRepo.create(db, {
                "owner_username": owner,
                "creator_fb_uid": uid,
                "shared_admin_uid": target_admin_uid,
                "page_name": page_name,
                "page_category": category,
                "page_url": final_url_so_far,
                "status": "PARTIAL",
                "log_detail": "Đã dừng trước khi cấp quyền admin.",
            }, owner_username=owner)
            broadcast("warning", f"⏹️ [{uid}] Đã nhận lệnh dừng trước khi cấp quyền admin.", uid=uid, extra={"action": "completed", "page_name": page_name, "page_url": final_url_so_far, "percent": 100})
            return

        # ── Phân quyền Admin & Đăng bài viết chào mừng (nội dung + ảnh AI) ──
        clean_admin = (target_admin_uid or "").strip()
        is_same_uid = bool(clean_admin and clean_admin == uid.strip())

        if is_same_uid:
            broadcast(
                "info",
                f"ℹ️ [{uid}] Nick nhận Admin trùng với nick tạo ({uid}). Đã có sẵn Full Control, bỏ qua bước phân quyền.",
                uid=uid,
                extra={
                    "action": "step",
                    "page_name": page_name,
                    "page_url": final_url_so_far,
                    "step": "Bước 5/5: Đã có sẵn quyền Admin Full Control",
                    "subStage": "Admin sẵn có",
                    "percent": 95,
                }
            )

        admin_result = run_share_admin(
            driver=driver,
            target_admin_uid=target_admin_uid,
            creator_password=password,
            post_content=post_content,
            image_path=post_img_path or avatar_path or cover_path,
            creator_uid=uid,
        )
        admin_name = (admin_result.get("admin_name") or "").strip()
        if not admin_name and is_same_uid and account is not None:
            admin_name = (account.profile_name or "").strip()
        if admin_name:
            PageRepo.remember_admin_name(db, target_admin_uid, admin_name)

        if not final_url_so_far and admin_result.get("page_url"):
            final_url_so_far = clean_facebook_page_url(admin_result["page_url"])

        if not final_url_so_far and driver:
            try:
                from selenium.webdriver.common.by import By
                for meta_xp in ['//meta[@property="og:url"]', '//link[@rel="canonical"]', '//a[contains(@href, "/profile.php?id=")]']:
                    elems = driver.find_elements(By.XPATH, meta_xp)
                    for el in elems:
                        val = el.get_attribute("content") or el.get_attribute("href") or ""
                        c = clean_facebook_page_url(val)
                        if c:
                            final_url_so_far = c
                            break
                    if final_url_so_far:
                        break
            except Exception:
                pass

        # ── Phân loại trạng thái chuẩn xác ──
        if not final_url_so_far:
            status = "FAILED"
            log = "Không lấy được liên kết Fanpage sau khi tạo"
        elif not admin_result.get("success", False):
            status = "FAILED"
            log = f"Tạo trang thành công nhưng cấp quyền Admin thất bại: {admin_result.get('error', 'Lỗi không xác định')}"
        else:
            status = "SUCCESS"
            log = None

        # ── Lưu kết quả vào DB ──
        PageRepo.create(db, {
            "owner_username": owner,
            "creator_fb_uid": uid,
            "shared_admin_uid": target_admin_uid,
            "shared_admin_name": admin_name,
            "page_name": page_name,
            "page_category": category,
            "page_url": final_url_so_far,
            "status": status,
            "log_detail": log,
        }, owner_username=owner)

        url_msg = f" ({final_url_so_far})" if final_url_so_far else ""
        if status == "SUCCESS":
            broadcast("success", f"🎉 [{uid}] Hoàn tất! Page '{page_name}'{url_msg} - Status: {status}", uid=uid, extra={"action": "completed", "page_name": page_name, "page_url": final_url_so_far, "percent": 100})
            return {"success": True, "page_url": final_url_so_far, "status": status}
        else:
            broadcast("error", f"❌ [{uid}] {log}{url_msg}", uid=uid, extra={"action": "failed", "page_name": page_name, "page_url": final_url_so_far, "percent": 100, "error": log})
            return {"success": False, "page_url": final_url_so_far, "status": status, "reason": log}

    except Exception as e:
        if stop_task_requested:
            broadcast("warning", f"⏹️ [{uid}] Đã đóng trình duyệt theo lệnh dừng khẩn cấp.", uid=uid)
        else:
            logger.exception(f"[{uid}] Create page worker crashed: {e}")
            broadcast("error", f"💥 [{uid}] Lỗi nghiêm trọng: {e}", uid=uid, extra={"action": "failed", "page_name": page_name, "percent": 100})
            try:
                PageRepo.create(db, {
                    "owner_username": owner,
                    "creator_fb_uid": uid,
                    "shared_admin_uid": target_admin_uid,
                    "shared_admin_name": admin_name,
                    "page_name": page_name,
                    "status": "FAILED",
                    "log_detail": str(e),
                }, owner_username=owner)
            except Exception:
                pass
        return {"success": False, "error": str(e)}

    finally:
        if driver:
            unregister_active_driver(driver)
            try:
                driver.quit()
            except Exception:
                pass
        db.close()
        profile_lock.release()


@router.post("/tasks/pause")
async def pause_tasks():
    """API tạm dừng tất cả tác vụ đang chạy."""
    global pause_task_requested
    pause_task_requested = True
    broadcast("warning", "⏸️ ĐÃ TẠM DỪNG TIẾN TRÌNH! Bấm 'Tiếp tục chạy' để tiến trình chạy tiếp.")
    return {"paused": True}


@router.post("/tasks/resume")
async def resume_tasks():
    """API tiếp tục chạy tất cả tác vụ đang tạm dừng."""
    global pause_task_requested
    pause_task_requested = False
    broadcast("info", "▶️ ĐÃ TIẾP TỤC CHẠY TIẾN TRÌNH!")
    return {"resumed": True}


# ── Biến theo dõi trạng thái tác vụ toàn cục ──
current_task_status = {
    "running": False,
    "total_pages": 0,
    "repeat_count": 1,
    "threads": 2,
    "target_admin_uid": "",
    "pages": [],
    "start_time": 0,
    "batch_id": "",
    "finished_time": 0,
    "owner_username": "",
}


@router.get("/tasks/status")
async def get_task_status(request: Request = None, owner_username: Optional[str] = None):
    """Lấy trạng thái thực thi hiện tại của Local Engine."""
    global current_task_status, pause_task_requested, stop_task_requested
    owner = get_owner_username(request, owner_username)
    status_owner = current_task_status.get("owner_username", "")
    if owner and status_owner and status_owner != owner:
        return {
            "running": False,
            "total_pages": 0,
            "repeat_count": 1,
            "threads": 2,
            "target_admin_uid": "",
            "pages": [],
            "start_time": 0,
            "batch_id": "",
            "finished_time": 0,
            "owner_username": owner,
            "paused": False,
            "stopped": False,
        }
    return {
        **current_task_status,
        "paused": pause_task_requested,
        "stopped": stop_task_requested,
    }


@router.post("/tasks/stop")
async def stop_tasks():
    """API dừng khẩn cấp tất cả tác vụ tạo Page đang chạy."""
    global stop_task_requested, pause_task_requested, current_task_status, active_creator_task
    stop_task_requested = True
    pause_task_requested = False
    current_task_status["running"] = False
    broadcast("warning", "🛑 ĐÃ NHẬN LỆNH DỪNG KHẨN CẤP! Đang đóng toàn bộ trình duyệt Tạo Page & dừng tất cả tiến trình...")

    # 1. Hủy ngay asyncio task đang chạy (hủy sleep delay, hủy gather)
    if active_creator_task and not active_creator_task.done():
        active_creator_task.cancel()

    # 2. Đóng CHỈ các trình duyệt thuộc tiến trình Tạo Page (không đóng trình duyệt live bên Accounts)
    close_scoped_active_drivers(scope="creator", force=True)

    return {"stopped": True}


@router.post("/tasks/start")
async def start_create_pages(req: CreatePageRequest, background_tasks: BackgroundTasks, request: Request = None):
    """Bắt đầu tạo Page hàng loạt trong background với hỗ trợ dừng, delay ngẫu nhiên & số lần lặp."""
    global stop_task_requested, pause_task_requested, current_task_status, active_creator_task
    stop_task_requested = False
    pause_task_requested = False

    owner = get_owner_username(request, req.owner_username)
    if owner and not check_user_license_valid(owner):
        raise HTTPException(
            status_code=403,
            detail="Tài khoản của bạn đã hết hạn bản quyền! Vui lòng liên hệ Quản trị viên để gia hạn tiếp tục sử dụng."
        )
    req.threads = max(1, min(10, req.threads))
    total_pages_per_run = len(req.pages)
    now_ts = int(time.time() * 1000)
    batch_id = req.batch_id or f"batch_{now_ts}"
    current_task_status["running"] = True
    current_task_status["total_pages"] = total_pages_per_run
    current_task_status["repeat_count"] = req.repeat_count
    current_task_status["threads"] = req.threads
    current_task_status["target_admin_uid"] = req.target_admin_uid
    current_task_status["pages"] = [p.model_dump() for p in req.pages]
    current_task_status["start_time"] = now_ts
    current_task_status["batch_id"] = batch_id
    current_task_status["finished_time"] = 0
    current_task_status["owner_username"] = owner or ""

    broadcast("info", f"🚀 Bắt đầu tạo {total_pages_per_run} Page ({req.repeat_count} vòng lặp, {req.threads} luồng, Delay random: {req.delay_min}-{req.delay_max}s)...")

    async def run():
        global stop_task_requested, pause_task_requested, current_task_status
        import random, time
        loop = asyncio.get_event_loop()
        semaphore = asyncio.Semaphore(req.threads)

        # Tách danh sách pages thành hàng đợi động theo từng vòng lặp (Round 1, Round 2, ...)
        pages_by_round = {}
        for idx, p in enumerate(req.pages):
            if getattr(p, "loop_round", None) and p.loop_round > 1:
                rnd = p.loop_round
            else:
                uid_seen_count = sum(1 for prev_p in req.pages[:idx] if prev_p.uid == p.uid)
                rnd = uid_seen_count + 1
            pages_by_round.setdefault(rnd, []).append(p)

        # Nếu danh sách truyền vào chưa đủ số vòng lặp theo req.repeat_count: nhân bản
        if len(pages_by_round) < req.repeat_count and not any((getattr(p, 'loop_round', 1) or 1) > 1 for p in req.pages):
            base_pages = list(pages_by_round.get(1, []))
            for rep in range(len(pages_by_round) + 1, req.repeat_count + 1):
                pages_by_round[rep] = [bp.model_copy(update={"loop_round": rep}) for bp in base_pages]

        max_rounds = max(req.repeat_count, max(pages_by_round.keys(), default=1))
        round_locks = {rnd: asyncio.Lock() for rnd in range(1, max_rounds + 1)}
        uids = list(dict.fromkeys(p.uid for p in req.pages))

        async def account_worker(uid):
            global stop_task_requested
            for r in range(1, max_rounds + 1):
                if stop_task_requested:
                    break
                while pause_task_requested and not stop_task_requested:
                    await asyncio.sleep(0.5)
                if stop_task_requested:
                    break

                if r not in pages_by_round:
                    break

                # ── KIỂM TRA BẢN QUYỀN TRƯỚC KHI BỐC PAGE MỚI: DỪNG AN TOÀN NẾU HẾT HẠN ──
                if owner and not check_user_license_valid(owner):
                    broadcast(
                        "warning",
                        f"🛑 Bản quyền tài khoản [{owner}] đã hết hạn! Dừng an toàn hàng đợi tạo Page để bảo vệ nick Facebook không bị Checkpoint.",
                        extra={"action": "license_expired_drain"}
                    )
                    stop_task_requested = True
                    break

                # Bốc page tiếp theo trong hàng đợi của vòng r
                page_item = None
                async with round_locks[r]:
                    if pages_by_round[r]:
                        page_item = pages_by_round[r].pop(0)

                # Nếu vòng này đã hết page để bốc -> nick này dừng
                if not page_item:
                    break

                page_dict = page_item.model_dump() if hasattr(page_item, "model_dump") else page_item.dict()
                page_dict["uid"] = uid
                if owner:
                    page_dict["owner_username"] = owner
                page_name = page_item.page_name

                # Thông báo cho FE cập nhật dòng page này gán cho UID này
                broadcast(
                    "info",
                    f"🎬 [{uid}] Bốc page '{page_name}' (Vòng {r})...",
                    uid=uid,
                    extra={
                        "action": "claim",
                        "page_name": page_name,
                        "uid": uid,
                        "loop_round": r,
                    },
                )

                worker_succeeded = False
                async with semaphore:
                    if stop_task_requested:
                        break
                    while pause_task_requested and not stop_task_requested:
                        await asyncio.sleep(0.5)
                    if stop_task_requested:
                        break

                    try:
                        res = await loop.run_in_executor(
                            executor,
                            _owned_page_worker,
                            page_dict,
                            req.target_admin_uid,
                            req.country_code,
                            owner,
                        )
                        if isinstance(res, dict):
                            worker_succeeded = res.get("success", False)
                        else:
                            worker_succeeded = True
                    except asyncio.CancelledError:
                        return
                    except Exception as worker_err:
                        logger.info(f"Worker task error: {worker_err}")
                        worker_succeeded = False

                # Nếu dừng khẩn cấp hoặc nick gặp lỗi checkpoint/die/thất bại: dừng nick này
                if stop_task_requested:
                    break
                if not worker_succeeded:
                    broadcast("warning", f"🛑 [{uid}] Gặp lỗi khi tạo page, dừng nick này không tiếp tục các vòng sau.", uid=uid)
                    break

                # Nếu còn vòng tiếp theo và vòng tiếp theo còn page trong pool, nghỉ delay
                next_round = r + 1
                has_next_pages = False
                if next_round in pages_by_round:
                    async with round_locks[next_round]:
                        has_next_pages = len(pages_by_round[next_round]) > 0

                if not stop_task_requested and worker_succeeded and has_next_pages:
                    delay_sec = round(random.uniform(req.delay_min, req.delay_max), 1) if req.delay_max > 0 else 0
                    if delay_sec > 0:
                        broadcast("info", f"⏳ Nick [{uid}] hoàn tất Vòng {r}, tạm nghỉ {delay_sec}s trước khi bốc page Vòng {next_round}...")
                        slept = 0.0
                        while slept < delay_sec and not stop_task_requested:
                            while pause_task_requested and not stop_task_requested:
                                await asyncio.sleep(0.5)
                            step_sleep = min(0.5, delay_sec - slept)
                            await asyncio.sleep(step_sleep)
                            slept += step_sleep

        try:
            account_tasks = [account_worker(uid) for uid in uids]
            await asyncio.gather(*account_tasks)
        except asyncio.CancelledError:
            logger.info("Main create pages task was cancelled.")
        finally:
            # Dọn sạch và thông báo hủy cho toàn bộ các page còn tồn đọng trong hàng đợi chưa kịp chạy
            remaining_unprocessed_pages = []
            for rnd_key, pages_list in pages_by_round.items():
                while pages_list:
                    remaining_unprocessed_pages.append(pages_list.pop(0))

            for rem_page in remaining_unprocessed_pages:
                rem_name = getattr(rem_page, 'page_name', '') or (rem_page.get('page_name') if isinstance(rem_page, dict) else '')
                rem_uid = getattr(rem_page, 'uid', '') or (rem_page.get('uid') if isinstance(rem_page, dict) else '')
                reason = "Bị hủy do người dùng dừng khẩn cấp" if stop_task_requested else "Bị hủy do tài khoản phụ trách gặp lỗi ở vòng trước"
                broadcast(
                    "warning",
                    f"⚠️ Page '{rem_name}' {reason}.",
                    uid=rem_uid,
                    extra={
                        "action": "failed",
                        "page_name": rem_name,
                        "uid": rem_uid,
                        "error": reason,
                        "percent": 100,
                    }
                )

            now_finished = int(time.time() * 1000)
            current_task_status["finished_time"] = now_finished
            is_stopped_run = bool(stop_task_requested)
            if is_stopped_run:
                broadcast(
                    "warning",
                    "🛑 TẤT CẢ TÁC VỤ TẠO PAGE ĐÃ ĐƯỢC DỪNG HOÀN TOÀN.",
                    extra={
                        "action": "all_finished",
                        "running": False,
                        "stopped": True,
                        "batch_id": batch_id,
                        "finished_time": now_finished,
                    }
                )
            else:
                broadcast(
                    "success",
                    "🏁 Hoàn tất tất cả tác vụ tạo Page!",
                    extra={
                        "action": "all_finished",
                        "running": False,
                        "stopped": False,
                        "batch_id": batch_id,
                        "finished_time": now_finished,
                    }
                )
            current_task_status["running"] = False
            close_scoped_active_drivers(scope="creator")
            # Reset cờ dừng sau khi dọn dẹp để không lưu vết
            stop_task_requested = False
            pause_task_requested = False

    active_creator_task = asyncio.create_task(_run_with_owner(owner, run))
    return {"started": True, "count": total_pages_per_run, "repeat_count": req.repeat_count}


# ── Lịch sử Page ──

@router.get("/pages/history")
async def page_history(request: Request = None, owner_username: Optional[str] = None, db: Session = Depends(get_db)):
    """Lấy toàn bộ lịch sử Page đã tạo theo owner_username."""
    from modules.module_04_page_creator.automation.page_flow import clean_facebook_page_url
    from modules.module_04_page_creator.database import PageRepo, to_vn_iso
    owner = get_owner_username(request, owner_username)
    pages = PageRepo.get_all(db, owner_username=owner)
    return [
        {
            "id": p.id,
            "owner_username": p.owner_username,
            "creator_fb_uid": p.creator_fb_uid,
            "shared_admin_uid": p.shared_admin_uid,
            "page_name": p.page_name,
            "page_category": p.page_category,
            "page_url": clean_facebook_page_url(p.page_url) if p.page_url else None,
            "status": p.status,
            "log_detail": p.log_detail,
            "created_at": to_vn_iso(p.created_at),
        }
        for p in pages
    ]


def _manager_uid(page):
    admin = (page.shared_admin_uid or "").strip()
    return admin or (page.creator_fb_uid or "").strip()


def _manager_names(db, uids, owner):
    wanted = [uid for uid in uids if uid]
    if not wanted:
        return {}
    from modules.module_02_account_manager.database.models import Account

    names = {}
    for account in db.query(Account).filter(Account.uid.in_(wanted)).all():
        if owner and account.user_id and str(account.user_id) != str(owner):
            continue
        label = (account.profile_name or "").strip()
        if not label:
            continue
        current = names.get(account.uid)
        if current is None or (owner and str(account.user_id or "") == str(owner)):
            names[account.uid] = label
    return names


def _managed_row(page, names):
    from modules.module_04_page_creator.automation.facebook_urls import facebook_picture_url
    from modules.module_04_page_creator.automation.page_flow import clean_facebook_page_url
    from modules.module_04_page_creator.database import to_vn_iso

    manager = _manager_uid(page)
    page_url = clean_facebook_page_url(page.page_url) if page.page_url else ""
    return {
        "id": page.id,
        "page_name": page.page_name,
        "page_category": page.page_category or "",
        "page_url": page_url,
        "page_avatar_url": facebook_picture_url(page_url),
        "status": page.status,
        "creator_fb_uid": page.creator_fb_uid,
        "manager_uid": manager,
        "manager_name": names.get(manager) or (page.shared_admin_name or ""),
        "manager_avatar_url": facebook_picture_url(manager),
        "created_at": to_vn_iso(page.created_at),
    }


@router.get("/pages/managed")
def list_managed_pages(db: Session = Depends(get_db)):
    """Danh sách fanpage Module 4, kèm tài khoản đang quản lý."""
    from modules.module_04_page_creator.database import PageRepo

    owner = get_owner_username()
    pages = PageRepo.get_all(db, owner_username=owner)
    names = _manager_names(db, {_manager_uid(page) for page in pages}, owner)
    return {"pages": [_managed_row(page, names) for page in pages]}


@router.post("/pages/manual")
def add_manual_page(req: ManualPageRequest, db: Session = Depends(get_db)):
    """Thêm fanpage có sẵn vào danh sách, không tạo page trên Facebook."""
    from modules.module_04_page_creator.automation.page_flow import clean_facebook_page_url
    from modules.module_04_page_creator.database import PageRepo

    name = (req.page_name or "").strip()
    manager = (req.manager_uid or "").strip()
    if not name or len(name) > 255:
        raise HTTPException(status_code=400, detail="Nhập tên fanpage.")
    if not manager.isdigit() or not (4 <= len(manager) <= 20):
        raise HTTPException(status_code=400, detail="UID quản lý phải là số Facebook.")
    url = clean_facebook_page_url(req.page_url or "")
    if (req.page_url or "").strip() and not url:
        raise HTTPException(status_code=400, detail="Link fanpage không hợp lệ.")
    owner = get_owner_username()
    page = PageRepo.create(
        db,
        {
            "creator_fb_uid": manager,
            "shared_admin_uid": manager,
            "page_name": name,
            "page_category": (req.page_category or "").strip(),
            "page_url": url,
            "status": "SUCCESS",
            "log_detail": "Thêm tay từ danh sách Fanpage",
        },
        owner_username=owner,
    )
    names = _manager_names(db, {manager}, owner)
    return {"page": _managed_row(page, names)}


@router.delete("/pages/{page_id}")
def delete_managed_page(page_id: int, db: Session = Depends(get_db)):
    from modules.module_04_page_creator.database import PageRepo

    owner = get_owner_username()
    if not PageRepo.delete_owned(db, page_id, owner_username=owner):
        raise HTTPException(status_code=404, detail="Không tìm thấy fanpage.")
    return {"success": True}


class GeminiTestBody(BaseModel):
    api_key: str
    model_name: str = "gemini-3.8-flash"


def _provider_message(response) -> str:
    try:
        body = response.json()
    except ValueError:
        return f"HTTP {response.status_code}"
    detail = body.get("error", body) if isinstance(body, dict) else body
    if isinstance(detail, dict):
        return str(detail.get("message") or detail.get("status") or f"HTTP {response.status_code}")
    return str(detail or f"HTTP {response.status_code}")


@router.post("/gemini/test-key")
def test_gemini_key(body: GeminiTestBody, db: Session = Depends(get_db)):
    """Gọi Gemini thật để kiểm tra key + model; chỉ lưu khi dùng được."""
    import httpx

    from modules.module_04_page_creator.database import SettingRepo
    from modules.module_05_page_manager.vi_messages import suggested_replacement, vi_gemini_message

    api_key = (body.api_key or "").strip()
    model = (body.model_name or "gemini-3.8-flash").strip()
    if len(api_key) < 20:
        raise HTTPException(status_code=400, detail="Gemini API key quá ngắn hoặc đang để trống.")
    try:
        response = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
            json={"contents": [{"parts": [{"text": "Reply with OK"}]}]},
            timeout=30,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=400, detail="Không kết nối được Gemini.") from exc
    if response.status_code != 200:
        message = _provider_message(response)
        replacement = suggested_replacement(message)
        if replacement:
            raise HTTPException(
                status_code=400,
                detail=f"Model {model} không còn cho key này. Hãy chọn {replacement}.",
            )
        raise HTTPException(status_code=400, detail=vi_gemini_message(message))
    SettingRepo.set(db, "gemini_api_key", api_key)
    SettingRepo.set(db, "gemini_model", model)
    return {
        "gemini": "ok",
        "model": model,
        "message": f"Gemini key dùng được với {model}. Đã lưu cho lần tạo page tiếp theo.",
    }


@router.get("/settings")
async def get_settings(db: Session = Depends(get_db)):
    from modules.module_04_page_creator.database import SettingRepo
    return SettingRepo.get_all(db)


@router.post("/settings")
async def save_setting(item: SettingItem, db: Session = Depends(get_db)):
    from modules.module_04_page_creator.database import SettingRepo
    SettingRepo.set(db, item.key, item.value)
    return {"saved": True}
