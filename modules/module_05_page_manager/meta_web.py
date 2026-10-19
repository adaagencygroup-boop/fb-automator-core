"""Popup OAuth: independent Facebook connections scoped to the software owner."""
import hashlib
import json
import os
import secrets
import time
from urllib.parse import urlencode

from core.database.connection import db
from . import meta_sync as sync
from .meta_config import GRAPH_API_VERSION, REQUIRED_SCOPES, callback_url, credentials

ACTIVE = {"AWAITING_OAUTH", "QUEUED", "RUNNING", "AWAITING_CONFIRMATION", "COMMITTING"}


def _current(owner, *, token=False):
    app_id = os.getenv("FACEBOOK_APP_ID", "").strip()
    fields = "id, app_id, app_scoped_user_id, facebook_name, token_metadata, updated_at"
    if token:
        fields += ", user_access_token"
    return db.fetch_one(f"SELECT {fields} FROM meta_web_connections WHERE user_id = %s AND app_id = %s ORDER BY updated_at DESC, id DESC LIMIT 1", (owner, app_id))


def connection_status(owner):
    row = _current(owner)
    active = None
    with sync._lock:
        for job in sync._jobs.values():
            if job["owner"] == owner and job.get("kind") == "web":
                snapshot = sync.status(owner, job["job_id"])
                if snapshot["status"] in ACTIVE:
                    active = snapshot
                    break
    if not row:
        return {"connected": False, "identity": None, "token_state": "unknown", "active_job": active}
    metadata = row.get("token_metadata") or {}
    if isinstance(metadata, str):
        metadata = json.loads(metadata)
    expired = any(isinstance(metadata.get(key), (int, float)) and 0 < metadata[key] <= time.time()
                  for key in ("expires_at", "data_access_expires_at"))
    return {"connected": True, "connection_id": row["id"],
            "identity": {"id": str(row["app_scoped_user_id"]), "name": row["facebook_name"]},
            "token_state": "expired" if expired else "valid_at_last_check" if metadata.get("is_valid") else "unknown",
            "active_job": active}


def _reserve(owner, status, reason):
    if not owner:
        raise ValueError("Phiên đăng nhập không hợp lệ.")
    with sync._lock:
        now = time.time()
        for key, job in list(sync._jobs.items()):
            if job.get("kind") == "web":
                sync.status(job["owner"], key)
            if job["expires"] < now and job["status"] not in {"QUEUED", "RUNNING", "COMMITTING"}:
                del sync._jobs[key]
        if any(j["owner"] == owner and j.get("kind") == "web" and j["status"] in ACTIVE for j in sync._jobs.values()):
            raise ValueError("Bạn đang có một tác vụ kết nối Facebook chưa hoàn tất.")
        if sum(j["status"] in ACTIVE for j in sync._jobs.values()) >= 20:
            raise ValueError("Hàng đợi OAuth đang đầy. Vui lòng thử lại sau.")
        job = {"job_id": secrets.token_urlsafe(24), "owner": owner, "kind": "web", "account_uid": None,
               "status": status, "reason": reason, "expires": now + 600,
               "message": "Chờ cấp quyền trong cửa sổ Facebook…" if status == "AWAITING_OAUTH" else "Đang chờ đồng bộ Page…"}
        sync._jobs[job["job_id"]] = job
        return job


def start(owner, reason="connect"):
    app_id, _ = credentials()
    redirect = callback_url()
    current = _current(owner)
    job = _reserve(owner, "AWAITING_OAUTH", reason)
    state = "web-popup." + secrets.token_urlsafe(32)
    with sync._lock:
        job["previous_identity_id"] = str(current["app_scoped_user_id"]) if current else None
    try:
        db.execute("""INSERT INTO meta_oauth_states
            (state_hash, user_id, account_uid, app_id, flow, job_id, expires_at)
            VALUES (%s, %s, NULL, %s, 'web_standalone', %s, NOW() + INTERVAL '10 minutes')""",
            (hashlib.sha256(state.encode()).hexdigest(), owner, app_id, job["job_id"]))
    except Exception:
        with sync._lock:
            sync._jobs.pop(job["job_id"], None)
        raise
    url = f"https://www.facebook.com/{GRAPH_API_VERSION}/dialog/oauth?" + urlencode({
        "client_id": app_id, "redirect_uri": redirect, "state": state, "response_type": "token",
        "scope": ",".join(sorted(REQUIRED_SCOPES)),
    })
    return {"job_id": job["job_id"], "status": "AWAITING_OAUTH", "state": state,
            "authorization_url": url, "expires_at": job["expires"],
            "previous_identity": {"id": str(current["app_scoped_user_id"]), "name": current["facebook_name"]}
            if reason == "switch" and current else None}


def complete(owner, state, token, error=""):
    app_id, _ = credentials()
    # The callback can only queue the job which was reserved for this state/owner/app.
    with sync._lock:
        with db.session() as cur:
            cur.execute("""UPDATE meta_oauth_states SET consumed_at = NOW()
                WHERE state_hash = %s AND user_id = %s AND app_id = %s AND flow = 'web_standalone'
                AND consumed_at IS NULL AND expires_at > NOW() RETURNING job_id""",
                (hashlib.sha256(state.encode()).hexdigest(), owner, app_id))
            row = cur.fetchone()
            if not row:
                raise ValueError("OAuth state sai, đã hết hạn hoặc đã sử dụng.")
        snapshot = sync.status(owner, row["job_id"])
        job = sync._jobs[row["job_id"]]
        if snapshot["status"] != "AWAITING_OAUTH" or job.get("kind") != "web":
            raise ValueError("Tác vụ OAuth đã kết thúc hoặc bị hủy.")
        if error or not token.strip():
            job.update(status="FAILED", error="Bạn đã hủy/từ chối quyền OAuth hoặc Meta không trả token.",
                       message="Kết nối Facebook chưa thay đổi.")
            return {"job_id": job["job_id"], "status": "FAILED"}
        job["status"] = "QUEUED"
        def task(current_job):
            prepared = sync.prepare_token(token.strip())
            if current_job["reason"] == "switch" and prepared["identity"]["id"] == current_job.get("previous_identity_id"):
                sync._update(current_job, error_code="SAME_FACEBOOK_IDENTITY")
                raise ValueError(f"Meta vẫn trả về tài khoản {prepared['identity']['name']}. Hãy chọn Facebook khác rồi thử lại; kết nối hiện tại được giữ nguyên.")
            sync._update(current_job, status="AWAITING_CONFIRMATION", prepared=prepared,
                         identity=prepared["identity"], expires=time.time() + 600,
                         message="Chờ chấp nhận đăng nhập trong cửa sổ OAuth.")
        sync._executor.submit(sync._run, job, task)
        return {"job_id": job["job_id"], "status": "QUEUED"}


def complete_by_state(state, token, error="", auto_confirm=True):
    app_id, _ = credentials()
    with sync._lock:
        with db.session() as cur:
            cur.execute("""UPDATE meta_oauth_states SET consumed_at = NOW()
                WHERE state_hash = %s AND app_id = %s AND flow = 'web_standalone'
                AND consumed_at IS NULL AND expires_at > NOW() RETURNING job_id, user_id""",
                (hashlib.sha256(state.encode()).hexdigest(), app_id))
            row = cur.fetchone()
            if not row:
                raise ValueError("OAuth state sai, đã hết hạn hoặc đã sử dụng.")
        owner = str(row["user_id"])
        job_id = row["job_id"]
        snapshot = sync.status(owner, job_id)
        job = sync._jobs.get(job_id)
        if not job or snapshot["status"] != "AWAITING_OAUTH" or job.get("kind") != "web":
            raise ValueError("Tác vụ OAuth đã kết thúc hoặc bị hủy.")
        if error or not token.strip():
            job.update(status="FAILED", error="Bạn đã hủy/từ chối quyền OAuth hoặc Meta không trả token.",
                       message="Kết nối Facebook chưa thay đổi.")
            return {"job_id": job["job_id"], "status": "FAILED", "owner": owner}
        job["status"] = "QUEUED"
        def task(current_job):
            prepared = sync.prepare_token(token.strip())
            if current_job["reason"] == "switch" and prepared["identity"]["id"] == current_job.get("previous_identity_id"):
                sync._update(current_job, error_code="SAME_FACEBOOK_IDENTITY")
                raise ValueError(f"Meta vẫn trả về tài khoản {prepared['identity']['name']}. Hãy chọn Facebook khác rồi thử lại; kết nối hiện tại được giữ nguyên.")
            if auto_confirm:
                return _save(owner, prepared, current_job)
            sync._update(current_job, status="AWAITING_CONFIRMATION", prepared=prepared,
                         identity=prepared["identity"], expires=time.time() + 600,
                         message="Chờ chấp nhận đăng nhập trong cửa sổ OAuth.")
        sync._executor.submit(sync._run, job, task)
        return {"job_id": job["job_id"], "status": "QUEUED", "owner": owner}


def _save(owner, prepared, job):
    with sync._lock:
        job.update(status="COMMITTING", message="Đang lưu kết nối và Page…")
    metadata, identity = prepared["metadata"], prepared["identity"]
    with db.session() as cur:
        cur.execute("""INSERT INTO meta_web_connections
            (user_id, app_id, app_scoped_user_id, facebook_name, user_access_token, token_metadata)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (user_id, app_id, app_scoped_user_id) DO UPDATE SET
                facebook_name = EXCLUDED.facebook_name, user_access_token = EXCLUDED.user_access_token,
                token_metadata = EXCLUDED.token_metadata, updated_at = NOW() RETURNING id""",
            (owner, metadata["app_id"], identity["id"], identity["name"], prepared["token"], json.dumps(metadata)))
        connection_id = cur.fetchone()["id"]
        for page in sorted(prepared["pages"], key=lambda item: item["id"]):
            cur.execute("""INSERT INTO pages
                (user_id, page_id, page_name, access_token, category, account_uid, web_connection_id, status, token_metadata)
                VALUES (%s, %s, %s, %s, %s, NULL, %s, 'ACTIVE', %s::jsonb)
                ON CONFLICT (user_id, page_id) DO UPDATE SET
                    page_name = EXCLUDED.page_name, access_token = EXCLUDED.access_token,
                    category = EXCLUDED.category, account_uid = NULL, web_connection_id = EXCLUDED.web_connection_id,
                    token_metadata = EXCLUDED.token_metadata, status = 'ACTIVE', updated_at = NOW()""",
                (owner, page["id"], page["name"], page["access_token"], page.get("category"), connection_id, json.dumps(page["token_metadata"])))
    return {"success": True, "count": len(prepared["pages"]), "identity": identity,
            "connection_id": connection_id, "message": f"Đã kết nối {identity['name']} và đồng bộ {len(prepared['pages'])} Page."}


def confirm_web(owner, job_id, accept):
    # Called under the shared job lock by meta_sync.confirm.
    job = sync._jobs[job_id]
    if job["status"] != "AWAITING_CONFIRMATION":
        raise ValueError("Tác vụ không chờ xác nhận hoặc đã hết hạn.")
    if not accept:
        return cancel(owner, job_id)
    prepared = job.pop("prepared")
    job["status"] = "QUEUED"
    def task(current_job):
        latest = sync.fb_client.inspect_token(prepared["token"])
        if str(latest.get("user_id")) != prepared["identity"]["id"] or str(latest.get("app_id")) != str(prepared["metadata"]["app_id"]):
            raise ValueError("Danh tính token đã thay đổi trước khi lưu.")
        prepared["metadata"] = latest
        for page in prepared["pages"]:
            latest_page = sync.fb_client.inspect_token(page["access_token"], user=False)
            if latest_page.get("user_id") and str(latest_page["user_id"]) != prepared["identity"]["id"]:
                raise ValueError("Page Token không thuộc danh tính đã xác nhận.")
            page["token_metadata"] = latest_page
        return _save(owner, prepared, current_job)
    sync._executor.submit(sync._run, job, task)
    return {"job_id": job_id, "status": "QUEUED"}


def cancel(owner, job_id):
    with sync._lock:
        snapshot = sync.status(owner, job_id)
        job = sync._jobs[job_id]
        if job.get("kind") != "web" or snapshot["status"] not in {"AWAITING_OAUTH", "AWAITING_CONFIRMATION"}:
            raise ValueError("Không thể hủy tác vụ đang xử lý hoặc đã kết thúc. Hãy chờ kết quả.")
        db.execute("UPDATE meta_oauth_states SET consumed_at = NOW() WHERE user_id = %s AND job_id = %s AND consumed_at IS NULL", (owner, job_id))
        job.update(status="CANCELLED", message="Đã hủy; kết nối và Page cũ được giữ nguyên.")
        job.pop("prepared", None)
        return {"job_id": job_id, "status": "CANCELLED"}


def resync(owner):
    credentials()
    current = _current(owner, token=True)
    if not current:
        raise ValueError("Bạn chưa kết nối Facebook trên trình duyệt này.")
    job = _reserve(owner, "QUEUED", "sync")
    def task(current_job):
        prepared = sync.prepare_token(current["user_access_token"], exchange=False)
        if prepared["identity"]["id"] != str(current["app_scoped_user_id"]):
            raise ValueError("Danh tính token không khớp kết nối đã lưu.")
        return _save(owner, prepared, current_job)
    sync._executor.submit(sync._run, job, task)
    return {"job_id": job["job_id"], "status": "QUEUED"}
