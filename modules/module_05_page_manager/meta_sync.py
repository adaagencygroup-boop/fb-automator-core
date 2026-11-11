"""Owner-bound OAuth and atomic token/Page synchronization. Never returns credentials."""
import hashlib
import json
import logging
import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlencode, urlsplit, parse_qs

logger = logging.getLogger(__name__)

from core.database.connection import db
from core.facebook.fb_graph_client import fb_client, MetaAPIError
from modules.module_02_account_manager.context import owner_scope
from .meta_config import GRAPH_API_VERSION, ALL_SCOPES, credentials, callback_url

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="meta-oauth")
_lock = threading.RLock()
_jobs = {}


def account(owner, uid):
    if not owner or not uid:
        raise ValueError("Chọn account thuộc phiên đăng nhập hiện tại.")
    row = db.fetch_one("SELECT uid, profile_name, token, proxy FROM accounts WHERE user_id = %s AND uid = %s", (owner, uid))
    if not row:
        raise ValueError("Không tìm thấy account của bạn.")
    return row


def create_state(owner, uid, flow):
    account(owner, uid)
    app_id, _ = credentials()
    redirect = callback_url()
    state = flow + "." + secrets.token_urlsafe(32)
    db.execute("""INSERT INTO meta_oauth_states
        (state_hash, user_id, account_uid, app_id, flow, expires_at)
        VALUES (%s, %s, %s, %s, %s, NOW() + INTERVAL '10 minutes')""",
        (hashlib.sha256(state.encode()).hexdigest(), owner, uid, app_id, flow))
    url = f"https://www.facebook.com/{GRAPH_API_VERSION}/dialog/oauth?" + urlencode({
        "client_id": app_id, "redirect_uri": redirect, "state": state,
        "scope": ",".join(sorted(ALL_SCOPES)), "response_type": "token",
    })
    return {"state": state, "authorization_url": url}


def consume_state(state, owner, flow, uid=None):
    app_id, _ = credentials()
    with db.session() as cur:
        cur.execute("""UPDATE meta_oauth_states SET consumed_at = NOW()
            WHERE state_hash = %s AND user_id = %s AND app_id = %s AND flow = %s
            AND consumed_at IS NULL AND expires_at > NOW()
            AND (%s IS NULL OR account_uid = %s) RETURNING account_uid""",
            (hashlib.sha256(state.encode()).hexdigest(), owner, app_id, flow, uid, uid))
        row = cur.fetchone()
        if not row:
            raise ValueError("OAuth state sai, đã hết hạn hoặc đã sử dụng.")
        return row["account_uid"]


def _verify_single_page(owner, page_id, access_token, user_id):
    """Tiến trình ngầm kiểm tra tính hợp lệ của token từng Page và cập nhật DB."""
    try:
        meta = fb_client.inspect_token(access_token, user=False)
        if meta.get("user_id") and str(meta["user_id"]) != str(user_id):
            status = 'ERROR'
            meta["error"] = "Page Token không thuộc danh tính Facebook đã xác thực."
        else:
            status = 'ACTIVE'
    except Exception as exc:
        status = 'ERROR'
        meta = {"is_valid": False, "type": "PAGE", "error": str(exc), "expires_at": 0}

    try:
        with db.session() as cur:
            cur.execute("""UPDATE pages
                SET token_metadata = %s::jsonb, status = %s, updated_at = NOW()
                WHERE user_id = %s AND page_id = %s""",
                (json.dumps(meta), status, owner, str(page_id)))
    except Exception as e:
        logger.warning(f"Lỗi cập nhật metadata kiểm tra ngầm cho page {page_id}: {e}")


def start_background_page_verification(owner, pages, user_id):
    """Chạy ngầm đa luồng (8 workers) để kiểm tra token của từng Page mà không làm nghẽn UI."""
    if not pages:
        return

    def _worker():
        with ThreadPoolExecutor(max_workers=8, thread_name_prefix="page-token-verify") as executor:
            futures = [
                executor.submit(_verify_single_page, owner, p["id"], p["access_token"], user_id)
                for p in pages if p.get("id") and p.get("access_token")
            ]
            for f in futures:
                try:
                    f.result()
                except Exception:
                    pass

    threading.Thread(target=_worker, daemon=True, name="bg-page-verify").start()


def prepare_token(raw_token, *, exchange=True):
    """Validate identity and all Pages before either account or standalone saves."""
    original = fb_client.inspect_token(raw_token)
    token = fb_client.exchange_token(raw_token) if exchange else raw_token
    metadata = fb_client.inspect_token(token)
    me = fb_client.get_user_profile(token)
    if str(original["user_id"]) != str(metadata["user_id"]) or str(me["id"]) != str(metadata["user_id"]):
        raise ValueError("Danh tính token không khớp với Meta.")
    pages = fb_client.fetch_managed_pages(token)
    now_ts = int(time.time())
    for page in pages:
        # Gán metadata tức thì (vĩnh viễn) kế thừa từ token dài hạn, không chặn UI gọi debug_token tuần tự
        page["token_metadata"] = {
            "app_id": metadata.get("app_id"),
            "type": "PAGE",
            "is_valid": True,
            "expires_at": 0,
            "data_access_expires_at": metadata.get("data_access_expires_at", 0),
            "issued_at": now_ts,
        }
    return {"token": token, "metadata": metadata, "identity": {"id": str(me["id"]), "name": me["name"]},
            "pages": pages}


def prepare(owner, uid, raw_token):
    account(owner, uid)
    prepared = prepare_token(raw_token)
    connection = db.fetch_one("""SELECT app_scoped_user_id FROM meta_account_connections
        WHERE user_id = %s AND account_uid = %s AND app_id = %s""", (owner, uid, prepared["metadata"]["app_id"]))
    if connection and str(connection["app_scoped_user_id"]) != prepared["identity"]["id"]:
        raise ValueError("Danh tính Facebook khác kết nối đã lưu của account này.")
    prepared["linked"] = bool(connection)
    return prepared


def save(owner, uid, prepared):
    meta, identity = prepared["metadata"], prepared["identity"]
    # Lock account first: concurrent confirmations cannot replace an established identity.
    with db.session() as cur:
        cur.execute("SELECT uid FROM accounts WHERE user_id = %s AND uid = %s FOR UPDATE", (owner, uid))
        if not cur.fetchone():
            raise ValueError("Account đã bị xóa trước khi lưu.")
        cur.execute("""SELECT app_scoped_user_id FROM meta_account_connections
            WHERE user_id = %s AND account_uid = %s AND app_id = %s""", (owner, uid, meta["app_id"]))
        linked = cur.fetchone()
        if linked and str(linked["app_scoped_user_id"]) != identity["id"]:
            raise ValueError("Danh tính Facebook khác kết nối đã lưu.")
        cur.execute("""INSERT INTO meta_account_connections
            (user_id, account_uid, app_id, app_scoped_user_id, facebook_name, token_metadata)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (user_id, account_uid, app_id) DO UPDATE SET
                facebook_name = EXCLUDED.facebook_name, token_metadata = EXCLUDED.token_metadata, updated_at = NOW()""",
            (owner, uid, meta["app_id"], identity["id"], identity["name"], json.dumps(meta)))
        cur.execute("UPDATE accounts SET token = %s WHERE user_id = %s AND uid = %s", (prepared["token"], owner, uid))
        for page in sorted(prepared["pages"], key=lambda item: item["id"]):
            cur.execute("""INSERT INTO pages
                (user_id, page_id, page_name, access_token, category, account_uid, status, token_metadata)
                VALUES (%s, %s, %s, %s, %s, %s, 'ACTIVE', %s::jsonb)
                ON CONFLICT (user_id, page_id) DO UPDATE SET
                    page_name = EXCLUDED.page_name, access_token = EXCLUDED.access_token,
                    category = EXCLUDED.category, account_uid = EXCLUDED.account_uid,
                    web_connection_id = NULL,
                    token_metadata = EXCLUDED.token_metadata, status = 'ACTIVE', updated_at = NOW()""",
                (owner, page["id"], page["name"], page["access_token"], page.get("category"), uid, json.dumps(page["token_metadata"])))

    # Khởi chạy kiểm tra ngầm đa luồng cho các Page Token (8 workers, siêu nhẹ RAM)
    start_background_page_verification(owner, prepared["pages"], identity["id"])

    return {"success": True, "count": len(prepared["pages"]), "identity": identity,
            "message": f"Đã lưu token và đồng bộ {len(prepared['pages'])} Fanpage."}


def _update(job, **values):
    with _lock:
        job.update(values)


def _run(job, task):
    with owner_scope(job["owner"]):
        _update(job, status="RUNNING", message="Đang xác thực và quét Page với Meta…")
        try:
            result = task(job)
            if result is not None:
                _update(job, status="SUCCEEDED", result=result, message=result["message"])
        except (ValueError, MetaAPIError) as exc:
            # Only our validation errors may be shown. Network/DB errors are never serialized.
            _update(job, status="FAILED", error=str(exc), message="Đồng bộ thất bại; dữ liệu cũ được giữ nguyên.")
        except Exception:
            _update(job, status="FAILED", error="Không thể hoàn tất đồng bộ hoặc ghi DB; dữ liệu cũ được giữ nguyên.")
        finally:
            if job["status"] != "AWAITING_CONFIRMATION":
                with _lock:
                    job.pop("prepared", None)
                    job["expires"] = time.time() + 600


def submit(owner, uid, task):
    account(owner, uid)
    with _lock:
        now = time.time()
        for key in list(_jobs):
            old = _jobs[key]
            if old["expires"] < now and old["status"] not in {"QUEUED", "RUNNING", "COMMITTING"}:
                del _jobs[key]
        if sum(j["status"] in {"AWAITING_OAUTH", "QUEUED", "RUNNING", "COMMITTING", "AWAITING_CONFIRMATION"} for j in _jobs.values()) >= 20:
            raise ValueError("Hàng đợi OAuth đang đầy. Vui lòng thử lại sau.")
        if any(j["owner"] == owner and j["account_uid"] == uid and j["status"] in {"QUEUED", "RUNNING", "AWAITING_CONFIRMATION"} for j in _jobs.values()):
            raise ValueError("Account này đang có tác vụ OAuth hoặc đồng bộ chưa hoàn tất.")
        job = {"job_id": secrets.token_urlsafe(24), "owner": owner, "account_uid": uid,
               "status": "QUEUED", "expires": now + 600, "message": "Đang chờ worker."}
        _jobs[job["job_id"]] = job
        _executor.submit(_run, job, task)
    return {"job_id": job["job_id"], "status": "QUEUED"}


def sync_task(owner, uid, token, trusted_profile=False):
    def task(job):
        prepared = prepare(owner, uid, token)
        if not prepared["linked"] and not trusted_profile:
            _update(job, status="AWAITING_CONFIRMATION", prepared=prepared,
                    identity=prepared["identity"], expires=time.time() + 600,
                    message="Xác nhận ghép danh tính Facebook này với account đã chọn.")
            return None
        return save(owner, uid, prepared)
    return task


def status(owner, job_id):
    with _lock:
        job = _jobs.get(job_id)
        if not job or job["owner"] != owner:
            raise KeyError(job_id)
        if job["status"] in {"AWAITING_OAUTH", "AWAITING_CONFIRMATION"} and job["expires"] <= time.time():
            job.update(status="FAILED", error="OAuth hoặc xác nhận liên kết đã hết hạn.")
            job.pop("prepared", None)
        return {key: job[key] for key in ("job_id", "kind", "account_uid", "status", "message", "identity", "error", "error_code", "result") if key in job}


def confirm(owner, job_id, accept):
    status(owner, job_id)
    with _lock:
        job = _jobs[job_id]
        if job.get("kind") == "web":
            from .meta_web import confirm_web
            return confirm_web(owner, job_id, accept)
        if job["status"] != "AWAITING_CONFIRMATION":
            raise ValueError("Tác vụ không chờ xác nhận hoặc đã hết hạn.")
        if not accept:
            job.update(status="CANCELLED", message="Đã hủy liên kết.")
            job.pop("prepared", None)
            return {"job_id": job_id, "status": "CANCELLED"}
        prepared = job.pop("prepared")
        job["status"] = "QUEUED"
        def task(_job):
            fb_client.inspect_token(prepared["token"])
            return save(owner, job["account_uid"], prepared)
        _executor.submit(_run, job, task)
        return {"job_id": job_id, "status": "QUEUED"}


def profile_task(owner, uid, headless=False):
    def task(job):
        from core.browser import get_profile_lock, open_browser, safe_close_driver
        row = account(owner, uid)
        profile_lock = get_profile_lock(uid, owner)
        if not profile_lock.acquire(timeout=10):
            raise ValueError("Profile Chrome đang bận.")
        driver = None
        try:
            driver = open_browser(uid=uid, owner=owner, proxy=row.get("proxy"), headless=headless, scope="oauth", allow_direct_fallback=True)
            def check_cookie():
                driver.get("https://www.facebook.com/")
                cookie = driver.get_cookie("c_user") or {}
                if str(cookie.get("value") or "") != uid:
                    raise ValueError("Profile chưa đăng nhập hoặc đang đăng nhập nhầm UID Facebook.")
            check_cookie()
            oauth = create_state(owner, uid, "profile")
            driver.get(oauth["authorization_url"])
            _update(job, message="Chờ bạn cấp quyền trên Chrome (tối đa 10 phút).")
            deadline = time.monotonic() + 600
            while time.monotonic() < deadline:
                current = urlsplit(driver.current_url or "")
                expected = urlsplit(callback_url())
                if (current.scheme, current.netloc, current.path.rstrip("/")) == (expected.scheme, expected.netloc, expected.path.rstrip("/")):
                    params = parse_qs(current.fragment or current.query)
                    returned_state = (params.get("state") or [""])[0]
                    consume_state(returned_state, owner, "profile", uid)
                    if params.get("error"):
                        raise ValueError("Người dùng đã hủy hoặc từ chối quyền OAuth.")
                    token = (params.get("access_token") or [""])[0]
                    if not token:
                        raise ValueError("Callback không có Access Token.")
                    return sync_task(owner, uid, token, trusted_profile=True)(job)
                if "checkpoint" in current.path or "login.php" in current.path:
                    raise ValueError("Profile cần đăng nhập lại hoặc xử lý checkpoint.")
                time.sleep(1)
            raise ValueError("Hết thời gian chờ OAuth; không tự chạy lại consent.")
        finally:
            try:
                if driver is not None:
                    safe_close_driver(driver)
            finally:
                profile_lock.release()
    return task
