"""
post_routes.py
Module 03 - Tab 2: FastAPI Router cho phân hệ Đăng bài (Status, Reels, Story).
Cung cấp các API:
  - Cấu hình post_settings
  - Tự động quét & map thư mục video
  - Sinh bài nháp AI (Gemini + Pixabay)
  - Khởi chạy phiên / Tạm dừng / Dừng khẩn cấp
  - Giám sát tiến độ & 7 trạng thái
  - Lịch sử đăng bài
"""
import os
import re
import logging
import mimetypes
from config.constants import UPLOADS_DIR
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, HTTPException, Query, Body, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel

from modules.module_03_acc_farm import post_repository
from modules.module_03_acc_farm.content_service import (
    generate_status_content,
    list_available_gemini_models,
    load_gemini_keys,
    search_and_download_pixabay_image,
    crawl_or_fetch_image,
    auto_map_accounts_to_subfolders,
    scan_folder_media,
    generate_caption_from_filename
)
from modules.module_03_acc_farm.post_runner import runner

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/post", tags=["Module 03 - Tab 2: Đăng bài & Tương tác"])

# ==============================================================================
# SCHEMAS
# ==============================================================================

class SettingsPayload(BaseModel):
    post_type: str
    api_key_file_path: Optional[str] = None
    gemini_model: Optional[str] = "gemini-3.8-flash"
    prompt_template: Optional[str] = None
    master_folder_path: Optional[str] = None
    check_duplicate: Optional[bool] = True
    schedule_enabled: Optional[bool] = False
    schedule_time: Optional[str] = None
    min_delay: Optional[int] = 600
    max_delay: Optional[int] = 900
    thread_count: Optional[int] = 1

class GenerateDraftsPayload(BaseModel):
    post_type: str = "status"
    prompt: str
    accounts: List[Dict[str, Any]]
    api_key_source: Optional[str] = None
    pixabay_key: Optional[str] = None
    model: Optional[str] = None

class ScanFolderPayload(BaseModel):
    master_folder_path: str
    accounts: List[Dict[str, Any]]
    post_type: str = "reels"

class StartPostPayload(BaseModel):
    post_type: str
    accounts: List[Dict[str, Any]]
    thread_count: Optional[int] = 1
    min_delay: Optional[int] = 600
    max_delay: Optional[int] = 900
    schedule_enabled: Optional[bool] = False
    schedule_time: Optional[str] = None

class SaveDraftPayload(BaseModel):
    id: Optional[str] = None
    account_uid: str
    account_name: Optional[str] = ""
    post_type: str = "status"
    content: str
    image_path: Optional[str] = None
    clear_image: Optional[bool] = False
    status: Optional[str] = "READY"

class CrawlImagePayload(BaseModel):
    query: str
    pixabay_key: Optional[str] = None
    draft_id: Optional[str] = None
    account_uid: Optional[str] = None



# ==============================================================================
# 1. SETTINGS ENDPOINTS
# ==============================================================================

@router.get("/settings")
def get_settings(post_type: str = Query("status", pattern="^(status|reels|story)$")):
    data = post_repository.get_post_settings(post_type)
    if not data:
        return {"success": True, "data": {"post_type": post_type}}
    return {"success": True, "data": data}


@router.post("/settings")
def save_settings(payload: SettingsPayload):
    saved = post_repository.upsert_post_settings(payload.post_type, payload.dict())
    return {"success": True, "data": saved}


# ==============================================================================
# 2. FOLDER MAPPING ENDPOINTS
# ==============================================================================

@router.post("/folders/scan")
def scan_and_map_folders(payload: ScanFolderPayload):
    if not os.path.isdir(payload.master_folder_path):
        try:
            os.makedirs(payload.master_folder_path, exist_ok=True)
        except Exception:
            raise HTTPException(status_code=400, detail="Thư mục gốc không tồn tại trên máy tính và không thể tạo.")

    settings = post_repository.get_post_settings(payload.post_type) or {}
    check_dup = settings.get('check_duplicate', True)

    uids = [str(a.get('uid', '')) for a in payload.accounts if a.get('uid')]
    posted_hashes_map = post_repository.get_posted_media_hashes_batch(uids) if check_dup else {}

    mappings = auto_map_accounts_to_subfolders(
        payload.master_folder_path,
        payload.accounts,
        payload.post_type,
        check_duplicate=check_dup,
        posted_hashes_map=posted_hashes_map
    )

    # Lưu vào database: chỉ lưu các tài khoản đã được gán thư mục hợp lệ
    for m in mappings:
        if m.get('subfolder_path') and m.get('mapping_status') in ('MAPPED', 'SOURCE_ERROR'):
            post_repository.upsert_folder_mapping(
                account_uid=m['account_uid'],
                post_type=m['post_type'],
                subfolder_path=m['subfolder_path'],
                available_media_count=m['available_media_count'],
                mapping_status=m['mapping_status']
            )
        else:
            try:
                post_repository.delete_folder_mapping(m['account_uid'], m['post_type'])
            except Exception:
                pass

    return {"success": True, "data": mappings}


class ScanSingleFolderPayload(BaseModel):
    subfolder: str
    post_type: str = "reels"
    account_uid: Optional[str] = None


@router.post("/folders/scan-single")
def scan_single_subfolder(payload: ScanSingleFolderPayload):
    subfolder = payload.subfolder.strip()
    if not subfolder or not os.path.isdir(subfolder):
        return {
            "success": False,
            "count": 0,
            "total_count": 0,
            "all_posted": False,
            "status": "SOURCE_ERROR",
            "message": "Thư mục không tồn tại trên máy tính."
        }
    settings = post_repository.get_post_settings(payload.post_type) or {}
    check_dup = settings.get('check_duplicate', True)

    media_files = scan_folder_media(subfolder, post_type=payload.post_type)
    total_count = len(media_files)

    posted_hashes = set()
    if payload.account_uid and check_dup:
        posted_hashes = post_repository.get_posted_media_hashes(payload.account_uid)

    unposted = [
        f for f in media_files
        if not (check_dup and f.get('hash') and f['hash'] in posted_hashes)
    ]
    available_count = len(unposted)
    all_posted = bool(total_count > 0 and available_count == 0 and check_dup)
    status = "MAPPED" if total_count > 0 else "SOURCE_ERROR"

    if payload.account_uid:
        post_repository.upsert_folder_mapping(
            account_uid=payload.account_uid,
            post_type=payload.post_type,
            subfolder_path=subfolder,
            available_media_count=available_count,
            mapping_status=status
        )
    return {
        "success": True,
        "count": available_count,
        "total_count": total_count,
        "already_posted_count": total_count - available_count,
        "all_posted": all_posted,
        "subfolder": subfolder,
        "status": status
    }


# ==============================================================================
# 3. AI DRAFTS GENERATION & GEMINI MODELS
# ==============================================================================

class ModelListPayload(BaseModel):
    api_key_source: Optional[str] = None
    api_key: Optional[str] = None

@router.post("/gemini-models")
def get_available_gemini_models(payload: Optional[ModelListPayload] = None):
    """Lấy danh sách các model Google Gemini thực tế khả dụng cho API Key."""
    key = payload.api_key if payload else None
    key_source = payload.api_key_source if payload else None
    models = list_available_gemini_models(api_key=key, key_source=key_source)
    return {"success": True, "models": models, "count": len(models)}

@router.get("/gemini-models")
def get_available_gemini_models_get(key_source: Optional[str] = Query(None)):
    """Lấy danh sách các model Google Gemini qua GET."""
    models = list_available_gemini_models(key_source=key_source)
    return {"success": True, "models": models, "count": len(models)}

@router.post("/drafts/generate")
def generate_drafts(payload: GenerateDraftsPayload):
    # Lấy key từ file hoặc settings
    keys = []
    if payload.api_key_source:
        keys = load_gemini_keys(payload.api_key_source)
    settings = post_repository.get_post_settings(payload.post_type)
    if not keys and settings and settings.get('api_key_file_path'):
        keys = load_gemini_keys(settings['api_key_file_path'])
    if not keys:
        keys = load_gemini_keys()

    if not keys:
        raise HTTPException(status_code=400, detail="Chưa cấu hình Gemini API Key hợp lệ.")

    chosen_model = payload.model or (settings.get('gemini_model') if settings else None) or "gemini-3.8-flash"

    created_drafts = []
    for acc in payload.accounts:
        uid = str(acc.get('uid', ''))
        name = str(acc.get('name', ''))

        try:
            gen_res = generate_status_content(
                prompt=payload.prompt,
                api_key=keys[0],
                model=chosen_model,
                fallback_keys=keys[1:]
            )
            if isinstance(gen_res, tuple):
                content, img_kw = gen_res
            else:
                content, img_kw = gen_res, None

            img_path = None
            # Nếu prompt có yêu cầu/ngụ ý ảnh, tự động cào hoặc lấy ảnh minh họa
            if img_kw:
                logger.info(f"Prompt yêu cầu ảnh với từ khóa '{img_kw}'. Bắt đầu cào/tải ảnh...")
                img_path = crawl_or_fetch_image(img_kw, pixabay_key=payload.pixabay_key)

            post_repository.delete_drafts_by_account(uid, payload.post_type)
            post = post_repository.create_post(
                post_type=payload.post_type,
                account_uid=uid,
                account_name=name,
                content=content,
                image_path=img_path,
                status='DRAFT'
            )
            created_drafts.append(post)
        except Exception as e:
            logger.error(f"Lỗi tạo bài nháp cho UID {uid}: {e}")

    return {"success": True, "data": created_drafts}


@router.get("/drafts")
def list_drafts(post_type: str = Query("status")):
    drafts = post_repository.get_drafts(post_type)
    return {"success": True, "data": drafts}


@router.post("/drafts")
def save_draft(payload: SaveDraftPayload):
    post = post_repository.save_or_update_draft(
        account_uid=payload.account_uid,
        content=payload.content,
        post_type=payload.post_type,
        draft_id=payload.id,
        account_name=payload.account_name or "",
        status=payload.status or "READY",
        image_path=payload.image_path,
        clear_image=payload.clear_image or False
    )
    return {"success": True, "data": post}


@router.delete("/drafts")
def remove_draft(id: Optional[str] = Query(None), account_uid: Optional[str] = Query(None), post_type: str = Query("status")):
    if id:
        post_repository.delete_draft(id)
    elif account_uid:
        post_repository.delete_drafts_by_account(account_uid, post_type)
    return {"success": True, "message": "Đã xóa bài nháp thành công."}


# ==============================================================================
# MEDIA & IMAGE VIEW / UPLOAD / CRAWL
# ==============================================================================

@router.get("/media/file")
def get_media_file(path: str = Query(...)):
    """Trả về file ảnh thực tế trên ổ cứng để hiển thị trong thẻ <img> trình duyệt."""
    if not path:
        raise HTTPException(status_code=400, detail="Thiếu đường dẫn file ảnh")
    
    norm_path = os.path.abspath(os.path.normpath(path))
    if not os.path.isfile(norm_path):
        raise HTTPException(status_code=404, detail="File ảnh không tồn tại")

    # Kiểm tra tính toàn vẹn và định dạng ảnh thực tế
    try:
        from PIL import Image
        with Image.open(norm_path) as img:
            fmt = (img.format or "").lower()
            if fmt == "jpg":
                fmt = "jpeg"
            mime_type = f"image/{fmt}" if fmt in ["jpeg", "png", "webp", "gif"] else "image/jpeg"
    except Exception:
        raise HTTPException(status_code=415, detail="File không phải là định dạng ảnh hợp lệ hoặc đã bị lỗi")

    return FileResponse(norm_path, media_type=mime_type)


@router.post("/media/upload")
async def upload_post_image(file: UploadFile = File(...)):
    """Upload ảnh từ máy tính lưu vào uploads/posts và trả về đường dẫn file."""
    save_dir = str(UPLOADS_DIR / "posts")
    os.makedirs(save_dir, exist_ok=True)

    content = await file.read()
    saved_path = save_optimized_image(content, save_dir)
    if not saved_path:
        raise HTTPException(status_code=400, detail="File tải lên không phải là ảnh hợp lệ hoặc bị lỗi")

    filename = os.path.basename(saved_path)
    return {
        "success": True,
        "image_path": saved_path,
        "filename": filename,
        "size": os.path.getsize(saved_path)
    }


@router.post("/media/crawl")
def crawl_image_for_draft(payload: CrawlImagePayload):
    """Cào ảnh theo từ khóa hoặc nội dung bài viết và đính kèm vào bài nháp."""
    img_path = crawl_or_fetch_image(payload.query, pixabay_key=payload.pixabay_key)
    if not img_path:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy ảnh phù hợp với từ khóa '{payload.query}'")

    if payload.draft_id and payload.account_uid:
        post_repository.save_or_update_draft(
            account_uid=payload.account_uid,
            content="",
            draft_id=payload.draft_id,
            image_path=img_path
        )

    return {
        "success": True,
        "image_path": img_path,
        "message": f"Đã cào ảnh thành công cho từ khóa '{payload.query}'"
    }


# ==============================================================================
# 4. EXECUTION CONTROL (START / PAUSE / RESUME / STOP)
# ==============================================================================

@router.post("/start")
def start_posting(payload: StartPostPayload):
    """
    Luồng khởi chạy đúng thứ tự:
    1. Tạo session_id trong DB
    2. Commit toàn bộ bài viết (PENDING) vào DB trước
    3. Chỉ sau khi DB đã sẵn sàng mới kích hoạt runner threads
    """
    # ── Bước 1: Tạo session ──
    session_id = post_repository.create_post_session(payload.post_type)
    logger.info(f"[START] Đã tạo session {session_id}, chuẩn bị insert {len(payload.accounts)} bài vào DB...")

    # Xác định khung giờ hẹn nếu có bật (HH:mm)
    schedule_time_val = None
    if payload.schedule_enabled and payload.schedule_time:
        st = str(payload.schedule_time).strip()
        if re.match(r"^([01]\d|2[0-3]):([0-5]\d)$", st):
            schedule_time_val = st

    # ── Bước 2: Insert toàn bộ bài viết vào CSDL TRƯỚC ──
    inserted_count = 0
    for acc in payload.accounts:
        uid = str(acc.get('uid', ''))
        name = str(acc.get('name', ''))
        subfolder = acc.get('subfolder', '')

        # Lấy nội dung thật từ payload nếu có
        draft_content = str(acc.get('content', '')).strip()

        # Nếu chưa có trong payload, tìm trong danh sách drafts của CSDL
        if not draft_content:
            try:
                db_drafts = post_repository.get_drafts(payload.post_type)
                matched = next((d for d in db_drafts if str(d.get('account_uid')) == uid), None)
                if matched and matched.get('content'):
                    draft_content = str(matched['content']).strip()
                    if not acc.get('image_path'):
                        acc['image_path'] = matched.get('image_path')
            except Exception:
                pass

        # Tìm video clip nếu là Reels / Story
        media_path = None
        media_hash = None
        if payload.post_type in ('reels', 'story'):
            # VR-M03-PUB-04: Tự động loại bỏ nick có thư mục lỗi hoặc số media = 0
            if not subfolder or not os.path.isdir(subfolder):
                logger.warning(f"[VR-M03-PUB-04] Bỏ qua nick {name} ({uid}) do thư mục nguồn không tồn tại hoặc chưa gán.")
                continue

            clips = scan_folder_media(subfolder, post_type=payload.post_type)
            if not clips:
                logger.warning(f"[VR-M03-PUB-04] Bỏ qua nick {name} ({uid}) do SỐ MEDIA SẴN SÀNG = 0.")
                continue

            # Chống trùng lặp (Anti-duplicate): Lọc ra các video chưa từng đăng thành công bởi nick này
            settings = post_repository.get_post_settings(payload.post_type) or {}
            check_dup = settings.get('check_duplicate', True)

            unposted_clips = []
            for c in clips:
                h = c.get('hash')
                if not check_dup or not (h and post_repository.check_media_hash_exists(uid, h)):
                    unposted_clips.append(c)

            # Nếu tất cả đã đăng và không bật check_duplicate thì lấy toàn bộ
            target_clips = unposted_clips if unposted_clips else (clips if not check_dup else [])
            if not target_clips:
                logger.warning(f"Tài khoản {name} ({uid}) đã đăng hết toàn bộ {len(clips)} video trong thư mục, không còn video mới chưa đăng.")
                continue

            logger.info(f"Tài khoản {name} ({uid}): tìm thấy {len(target_clips)}/{len(clips)} video sẵn sàng để đưa vào hàng đợi đăng.")
            for clip in target_clips:
                c_path = clip['path']
                c_hash = clip.get('hash')

                if payload.post_type == 'reels':
                    c_caption = generate_caption_from_filename(c_path, post_type='reels')
                elif payload.post_type == 'story':
                    c_caption = generate_caption_from_filename(c_path, post_type='story')
                else:
                    c_caption = ""

                post_repository.create_post(
                    session_id=session_id,
                    post_type=payload.post_type,
                    account_uid=uid,
                    account_name=name,
                    content=c_caption,
                    media_path=c_path,
                    media_hash=c_hash,
                    schedule_time=schedule_time_val,
                    status='PENDING'
                )
                inserted_count += 1
        else:
            # Status Post: xác định nội dung & ảnh đính kèm
            img_path = acc.get('image_path') or acc.get('imagePath')
            if not img_path:
                try:
                    db_drafts = post_repository.get_drafts(payload.post_type)
                    matched_draft = next((d for d in db_drafts if str(d.get('account_uid')) == uid), None)
                    if matched_draft and matched_draft.get('image_path'):
                        img_path = matched_draft.get('image_path')
                except Exception:
                    pass

            if not draft_content:
                try:
                    gen_res = generate_status_content(
                        prompt=f"Viết một bài đăng Facebook ngắn truyền cảm hứng cuộc sống, nhẹ nhàng, tích cực cho tài khoản {name}.",
                        key_source=""
                    )
                    draft_content = gen_res[0] if isinstance(gen_res, tuple) else gen_res
                except Exception:
                    draft_content = "Chúc mọi người một ngày làm việc thật nhiều năng lượng và may mắn! ✨"

            post_repository.create_post(
                session_id=session_id,
                post_type=payload.post_type,
                account_uid=uid,
                account_name=name,
                content=draft_content,
                image_path=img_path,
                schedule_time=schedule_time_val,
                status='PENDING'
            )
            inserted_count += 1

    if inserted_count == 0:
        logger.warning(f"[START] Không có tài khoản nào đủ điều kiện đăng bài (số media = 0 hoặc lỗi nguồn).")
        post_repository.update_post_session(session_id, "STOPPED", finished=True)
        return {
            "success": False,
            "message": "Không có tài khoản nào đủ điều kiện thực thi (Số media sẵn sàng = 0 hoặc chưa gán thư mục hợp lệ theo VR-M03-PUB-04)."
        }

    logger.info(f"[START] Đã commit {inserted_count} bài PENDING vào DB. Bắt đầu kích hoạt runner threads...")

    # ── Bước 3: CHỈ SAU KHI DB đã sẵn sàng mới start runner ──
    runner.start_session_with_existing(
        session_id=session_id,
        post_type=payload.post_type,
        account_count=inserted_count,
        thread_count=payload.thread_count or 1,
        min_delay=payload.min_delay or 600,
        max_delay=payload.max_delay or 900,
        accounts=payload.accounts,
        schedule_enabled=bool(payload.schedule_enabled and schedule_time_val),
        schedule_time=schedule_time_val
    )

    return {"success": True, "session_id": session_id, "inserted_count": inserted_count}


@router.post("/pause")
def pause_posting():
    runner.pause_session()
    return {"success": True, "message": "Đã tạm dừng toàn bộ luồng đăng bài."}


@router.post("/resume")
def resume_posting():
    runner.resume_session()
    return {"success": True, "message": "Đã tiếp tục tiến trình đăng bài."}


@router.post("/stop")
def stop_posting():
    runner.stop_session()
    return {"success": True, "message": "Đã dừng khẩn cấp toàn bộ luồng đăng bài."}


@router.post("/reset")
def reset_posting():
    runner.reset_session()
    return {"success": True, "message": "Đã reset phiên đăng bài để soạn bài mới."}


@router.get("/status")
def get_posting_status():
    status = runner.get_status()
    return {"success": True, "data": status}


# ==============================================================================
# 5. HISTORY ENDPOINT
# ==============================================================================

@router.get("/history")
def get_history(
    post_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    time_slot: Optional[str] = Query(None),
    date: Optional[str] = Query(None),
    limit: int = Query(50),
    offset: int = Query(0)
):
    rows, total = post_repository.get_post_history(
        post_type=post_type,
        status=status,
        search=search,
        time_slot=time_slot,
        date=date,
        limit=limit,
        offset=offset
    )
    return {"success": True, "data": rows, "total": total}


@router.post("/history/cleanup")
def cleanup_history(payload: Dict[str, Any] = Body(default={})):
    days = int(payload.get("days", 30))
    deleted = post_repository.cleanup_post_history(days)
    return {"success": True, "message": f"Đã dọn dẹp bài đăng cũ hơn {days} ngày.", "deleted": deleted}


# ==============================================================================
# 6. NATIVE WINDOWS DIALOG ENDPOINTS (File & Folder Pickers)
# ==============================================================================

def _native_file_dialog(filter_ext: str = "txt") -> str:
    """Mở hộp thoại chọn file native trên Windows (Tkinter / PowerShell fallback)."""
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        types = [("Text Files", f"*.{filter_ext}"), ("All Files", "*.*")] if filter_ext else [("All Files", "*.*")]
        path = filedialog.askopenfilename(parent=root, title="Chọn File", filetypes=types)
        root.destroy()
        if path:
            return os.path.normpath(path)
    except Exception as e:
        logger.warning(f"Tkinter file dialog failed: {e}")

    try:
        import subprocess
        filter_str = f"File (*.{filter_ext})|*.{filter_ext}|Tất cả (*.*)|*.*" if filter_ext else "Tất cả (*.*)|*.*"
        ps_script = f"""
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.OpenFileDialog
$f.Filter = "{filter_str}"
$f.Title = "Chọn File"
$f.TopMost = $true
if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output $f.FileName
}}
"""
        cmd = ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script]
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
        out = proc.stdout.strip()
        if out and os.path.exists(out):
            return os.path.normpath(out)
    except Exception as e:
        logger.error(f"PowerShell file dialog failed: {e}")
    return ""


def _native_folder_dialog() -> str:
    """Mở hộp thoại chọn thư mục native trên Windows (Tkinter / PowerShell fallback)."""
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        path = filedialog.askdirectory(parent=root, title="Chọn Thư Mục Chứa Video")
        root.destroy()
        if path:
            return os.path.normpath(path)
    except Exception as e:
        logger.warning(f"Tkinter folder dialog failed: {e}")

    try:
        import subprocess
        ps_script = """
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.FolderBrowserDialog
$f.Description = "Chọn Thư Mục Chứa Video"
$f.ShowNewFolderButton = $true
if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output $f.SelectedPath
}
"""
        cmd = ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script]
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
        out = proc.stdout.strip()
        if out and os.path.isdir(out):
            return os.path.normpath(out)
    except Exception as e:
        logger.error(f"PowerShell folder dialog failed: {e}")
    return ""


@router.get("/dialog/file")
async def pick_file(filter_ext: str = Query("txt")):
    import asyncio
    loop = asyncio.get_event_loop()
    selected_path = await loop.run_in_executor(None, _native_file_dialog, filter_ext)
    return {"success": bool(selected_path), "path": selected_path or ""}


@router.get("/dialog/folder")
async def pick_folder():
    import asyncio
    loop = asyncio.get_event_loop()
    selected_path = await loop.run_in_executor(None, _native_folder_dialog)
    return {"success": bool(selected_path), "path": selected_path or ""}

