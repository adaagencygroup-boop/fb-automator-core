"""API màn Đăng bài AI: danh sách nick, đếm page, kích hoạt / dừng luồng."""
from concurrent.futures import ThreadPoolExecutor

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field

from modules.module_02_account_manager.api.router import scoped_owner
from modules.module_02_account_manager.context import owner_context
from modules.module_02_account_manager.database.connection import get_db
from modules.module_02_account_manager.database.repository import AccountRepository as Repo
from modules.module_04_page_creator.automation.facebook_urls import facebook_picture_url
from modules.module_04_page_creator.routes import get_owner_username
from modules.module_05_page_manager.ai_job import pages_of, parse_schedule_times, request_stop, snapshot, start_job
from modules.module_05_page_manager.ai_generator import MODEL_FALLBACK_CHAIN, models_to_try
from modules.module_05_page_manager.vi_messages import suggested_replacement, vi_gemini_message, vi_pixabay_message
from modules.module_05_page_manager.page_avatar import page_avatar, valid_page_avatar
from modules.module_05_page_manager.page_counter import (
    count_pages_for_account,
    get_count,
    open_fanpage_in_browser,
    remember_keywords,
)
from sqlalchemy.orm import Session

router = APIRouter(
    prefix="/api/pages/ai",
    tags=["Module 05: AI Post"],
    dependencies=[Depends(scoped_owner)],
)


class LoginBody(BaseModel):
    uid: str


class OpenPageBody(BaseModel):
    uid: str
    page_id: str


class TestKeyBody(BaseModel):
    api_key: str
    model_name: str = "gemini-3-flash-preview"
    pixabay_key: str = ""


class TestPixabayBody(BaseModel):
    pixabay_key: str = ""


class StartBody(BaseModel):
    api_keys: list[str] = Field(default_factory=list)
    pixabay_key: str = ""
    model_name: str = "gemini-3-flash-preview"
    fb_version: str = "v22.0"
    prompt: str = ""
    schedule_enabled: bool = False
    schedule_times: list[str] = Field(default_factory=list)
    sleep_min: int = 600
    sleep_max: int = 900
    account_uids: list[str] = Field(default_factory=list)
    page_ids: list[str] = Field(default_factory=list)
    page_keywords: dict[str, str] = Field(default_factory=dict)


def _pages_for(db: Session, owner: str, uid: str):
    """Ưu tiên page vừa đếm trên Facebook. Chưa đếm thì dùng page đã lưu trong hệ thống."""
    live = get_count(owner, uid)
    if live.get("status") == "done":
        return live.get("pages") or [], live
    stored = pages_of(db, uid, owner)
    return stored, live


def _fanpage_row(page: dict, account, avatar_url: str = "") -> dict:
    graph_id = str(page.get("graph_id") or "")
    stored = str(page.get("avatar_url") or "")
    avatar = avatar_url or (stored if valid_page_avatar(stored) else "")
    return {
        "id": page.get("id"),
        "name": page.get("name") or "Fanpage",
        "url": page.get("url") or "",
        "category": page.get("category") or "",
        "graph_id": graph_id,
        "avatar_url": avatar,
        "owner_uid": account.uid,
        "owner_name": account.profile_name or "",
    }


def _avatars_for(pages: list) -> list[str]:
    """Ảnh đại diện thật của từng page. Graph picture là silhouette xám nên không dùng."""
    if not pages:
        return []

    def one(page):
        stored = str(page.get("avatar_url") or "")
        if valid_page_avatar(stored):
            return stored
        return page_avatar(str(page.get("url") or ""), str(page.get("graph_id") or ""))

    with ThreadPoolExecutor(max_workers=min(6, len(pages))) as pool:
        return list(pool.map(one, pages))


def _account_rows(db: Session, owner: str):
    accounts = Repo.get_all(db, owner_username=owner)
    rows = []
    for account in accounts:
        counted, live = _pages_for(db, owner, account.uid)
        avatars = _avatars_for(counted)
        rows.append({
            "uid": account.uid,
            "profile_name": account.profile_name or "",
            "login_status": {"LOGGED_IN": "logged_in", "ERROR": "failed"}.get(account.login_status, "not_logged_in"),
            "avatar_url": facebook_picture_url(account.uid),
            "page_count": int(live["count"]) if live.get("status") == "done" and live.get("count") is not None else len(counted),
            "count_status": live.get("status") or "idle",
            "count_message": live.get("message") or "",
            "pages": [_fanpage_row(page, account, avatar) for page, avatar in zip(counted, avatars)],
        })
    return rows


@router.get("/accounts")
def list_accounts(db: Session = Depends(get_db)):
    owner = get_owner_username()
    return {"accounts": _account_rows(db, owner), "job": snapshot()}


def _provider_message(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return f"HTTP {response.status_code}"
    detail = body.get("error", body) if isinstance(body, dict) else body
    if isinstance(detail, dict):
        return str(detail.get("message") or detail.get("status") or f"HTTP {response.status_code}")
    return str(detail or f"HTTP {response.status_code}")


def _probe_gemini_model(api_key: str, model: str) -> tuple[bool, str]:
    """Thử 1 model. Trả (ok, message). Hỗ trợ key AIza* và AQ.* (AI Studio mới)."""
    response = httpx.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        params={"key": api_key},
        headers={"Content-Type": "application/json"},
        json={"contents": [{"parts": [{"text": "Reply with OK"}]}]},
        timeout=30,
    )
    if response.status_code == 200:
        return True, ""
    return False, _provider_message(response)


def _check_gemini(api_key: str, model_name: str) -> str:
    """Thử model đã chọn rồi cascade xuống model nhỏ hơn. Trả về model đang dùng được."""
    selected = (model_name or "gemini-3-flash-preview").strip().split("/")[-1]
    # Model chọn trước, rồi cả chuỗi to→nhỏ (bỏ trùng).
    candidates = []
    for name in [selected, *MODEL_FALLBACK_CHAIN, *models_to_try(selected)]:
        if name and name not in candidates:
            candidates.append(name)

    last_error = ""
    for model in candidates:
        try:
            ok, raw = _probe_gemini_model(api_key, model)
        except httpx.HTTPError as exc:
            last_error = str(exc)
            continue
        if ok:
            return model
        last_error = raw
        # Key hỏng hẳn → không cần thử model khác.
        lower = (raw or "").lower()
        if any(token in lower for token in ("api key not valid", "api_key_invalid", "invalid api key", "permission_denied")):
            raise HTTPException(status_code=400, detail=vi_gemini_message(raw))

    hint = suggested_replacement(last_error)
    detail = vi_gemini_message(last_error) if last_error else "Không kết nối được Gemini."
    if hint and hint not in detail:
        detail = f"{detail} Gợi ý thử {hint}."
    raise HTTPException(
        status_code=400,
        detail=f"Đã thử {len(candidates)} model, không cái nào dùng được. {detail}",
    )


def _check_pixabay(api_key: str) -> None:
    response = httpx.get(
        "https://pixabay.com/api/",
        params={"key": api_key, "q": "nature", "per_page": 3},
        timeout=20,
    )
    if response.status_code != 200:
        raise HTTPException(
            status_code=400,
            detail=vi_pixabay_message(_provider_message(response), response.status_code),
        )


@router.post("/test-key")
def test_key(body: TestKeyBody):
    """Gemini key: tự thử cascade model to→nhỏ, trả về model đang dùng được."""
    api_key = (body.api_key or "").strip()
    if len(api_key) < 20:
        raise HTTPException(status_code=400, detail="Gemini API key quá ngắn hoặc đang để trống.")
    try:
        working_model = _check_gemini(api_key, body.model_name)
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Không kết nối được Gemini (mạng/proxy): {exc.__class__.__name__}",
        ) from exc

    selected = (body.model_name or "").strip().split("/")[-1]
    if working_model != selected:
        gemini_msg = f"Gemini key dùng được. Đã tự chuyển sang model {working_model}."
    else:
        gemini_msg = f"Gemini key dùng được với model {working_model}."

    # Pixabay kiểm tra bằng nút riêng — không fail Gemini vì Pixabay rate-limit.
    return {
        "gemini": "ok",
        "pixabay": "skipped",
        "model_name": working_model,
        "message": gemini_msg,
    }


@router.post("/test-pixabay-key")
def test_pixabay_key(body: TestPixabayBody):
    """Chỉ kiểm tra Pixabay — không bắt buộc Gemini. Không có ảnh thì job vẫn đăng chữ."""
    pixabay = (body.pixabay_key or "").strip()
    if len(pixabay) < 10:
        raise HTTPException(status_code=400, detail="Pixabay API key quá ngắn hoặc đang để trống.")
    try:
        _check_pixabay(pixabay)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=400, detail="Không kết nối được Pixabay.") from exc
    return {"pixabay": "ok", "message": "Pixabay key dùng được."}


@router.post("/login")
async def login_account(body: LoginBody, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    owner = get_owner_username()
    uid = body.uid.strip()
    account = Repo.get_by_uid(db, uid, owner_username=owner)
    if account is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản.")
    background_tasks.add_task(count_pages_for_account, owner_context.get(), uid)
    return {"started": True, "uid": uid}


@router.post("/open-page")
async def open_page(body: OpenPageBody, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Mở Chrome nick quản lý và đứng trong fanpage được bấm."""
    owner = get_owner_username()
    uid = body.uid.strip()
    page_id = body.page_id.strip()
    if not uid or not page_id:
        raise HTTPException(status_code=400, detail="Thiếu nick hoặc fanpage.")
    account = Repo.get_by_uid(db, uid, owner_username=owner)
    if account is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản.")
    pages, _live = _pages_for(db, owner, uid)
    page = next((item for item in pages if str(item.get("id")) == page_id or str(item.get("graph_id") or "") == page_id), None)
    if page is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy fanpage của nick này.")
    background_tasks.add_task(open_fanpage_in_browser, owner_context.get(), uid, dict(page))
    return {"started": True, "uid": uid, "page_id": page_id, "name": page.get("name") or ""}


@router.post("/start")
def start(body: StartBody, db: Session = Depends(get_db)):
    keys = [key.strip() for key in body.api_keys if key and key.strip()]
    prompt = (body.prompt or "").strip()
    if keys and not prompt:
        raise HTTPException(status_code=400, detail="Có Gemini key thì phải nhập khung prompt bài đăng.")
    if body.sleep_min < 0 or body.sleep_max < body.sleep_min:
        raise HTTPException(status_code=400, detail="Giãn cách không hợp lệ.")
    try:
        times = parse_schedule_times(",".join(body.schedule_times)) if body.schedule_enabled else []
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if body.schedule_enabled and not times:
        raise HTTPException(status_code=400, detail="Bật hẹn giờ thì phải có ít nhất một khung HH:MM.")

    owner = get_owner_username()
    selected = {str(item).strip() for item in body.page_ids if str(item).strip()}
    if not selected:
        raise HTTPException(status_code=400, detail="Chọn ít nhất một fanpage để chạy AI.")
    keywords = {str(key): str(value or "").strip()[:200] for key, value in body.page_keywords.items()}
    grouped = {}
    for account in Repo.get_all(db, owner_username=owner):
        source, _live = _pages_for(db, owner, account.uid)
        pages = []
        chosen_keywords = {}
        for page in source:
            if str(page.get("id")) not in selected or not page.get("url"):
                continue
            keyword = keywords.get(str(page.get("id")))
            if keyword:
                page["category"] = keyword
                chosen_keywords[str(page.get("id"))] = keyword
            pages.append(page)
        if chosen_keywords:
            remember_keywords(owner, account.uid, chosen_keywords)
        if pages:
            grouped[account.uid] = pages
    if not grouped:
        raise HTTPException(status_code=400, detail="Fanpage đã chọn chưa có link Facebook để đăng.")
    try:
        start_job(owner, {
            "api_keys": keys,
            "pixabay_key": (body.pixabay_key or "").strip(),
            "model_name": (body.model_name or "gemini-3-flash-preview").strip(),
            "fb_version": (body.fb_version or "v22.0").strip(),
            "prompt": prompt[:2000],
            "schedule_enabled": body.schedule_enabled,
            "schedule_times": times,
            "sleep_min": int(body.sleep_min),
            "sleep_max": int(body.sleep_max),
        }, grouped)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"started": True, "accounts": len(grouped), "pages": sum(len(pages) for pages in grouped.values())}


@router.post("/stop")
def stop():
    if not request_stop():
        raise HTTPException(status_code=400, detail="Không có luồng đăng bài đang chạy.")
    return {"stopped": True}


@router.get("/status")
def status():
    return snapshot()
