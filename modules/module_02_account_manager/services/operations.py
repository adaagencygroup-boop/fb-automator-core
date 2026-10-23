"""Ephemeral, owner-scoped progress; snapshots never contain credentials."""
from contextlib import contextmanager
from contextvars import ContextVar
from copy import deepcopy
from datetime import timezone
import threading
import time
from uuid import uuid4

from fastapi import HTTPException
from ..context import owner_context

current_operation = ContextVar("account_operation", default=None)
TERMINAL = {"completed", "failed", "timeout", "closed"}
_items = {}
_lock = threading.RLock()


@contextmanager
def scope(operation_id):
    token = current_operation.set(operation_id)
    try:
        yield
    finally:
        current_operation.reset(token)


def create(kind, uids):
    with _lock:
        cutoff = time.monotonic() - 1800
        for key in [key for key, item in _items.items() if item["finished_at"] is not None and item["finished_at"] < cutoff]:
            del _items[key]
        operation_id = uuid4().hex
        _items[operation_id] = {
            "operation_id": operation_id, "owner": owner_context.get(), "kind": kind,
            "sequence": 0, "started_at": time.time(), "finished_at": None, "done": False,
            "accounts": {uid: {"uid": uid, "phase": "queued", "changes": {}} for uid in uids},
        }
        return operation_id


def read(operation_id):
    with _lock:
        item = _items.get(operation_id)
        if not item or item["owner"] != owner_context.get() or (
            item["finished_at"] is not None and time.monotonic() - item["finished_at"] >= 1800
        ):
            raise HTTPException(404, "Operation not found")
        return deepcopy({key: value for key, value in item.items() if key not in {"owner", "finished_at"}})


def account_fields(account):
    return {
        "login_status": {"LOGGED_IN": "logged_in", "ERROR": "failed"}.get(account.login_status, "not_logged_in"),
        "status": account.status.lower() if account.status_checked_at and account.status in {"LIVE", "DIE"} else None,
        "last_login_at": account.last_login_at.replace(tzinfo=timezone.utc).isoformat() if account.last_login_at else None,
        "first_login_at": account.first_login_at.replace(tzinfo=timezone.utc).isoformat() if account.first_login_at else None,
        "profile_name": account.profile_name or "", "avatar_url": account.avatar_url or None,
    }


def update(uid, phase, account=None):
    operation_id = current_operation.get()
    if not operation_id:
        return
    with _lock:
        item = _items.get(operation_id)
        if not item or item["owner"] != owner_context.get() or uid not in item["accounts"]:
            return
        previous = item["accounts"][uid]
        changes = account_fields(account) if account is not None else previous["changes"]
        item["accounts"][uid] = {"uid": uid, "phase": phase, "changes": changes}
        item["sequence"] += 1
        item["done"] = all(row["phase"] in TERMINAL for row in item["accounts"].values())
        if item["done"]:
            item["finished_at"] = time.monotonic()
        payload = {"event": "account_operation_updated", "event_id": uuid4().hex,
                   "operation_id": operation_id, "sequence": item["sequence"], "kind": item["kind"],
                   "done": item["done"], "started_at": item["started_at"], "account": deepcopy(item["accounts"][uid])}
        if item["done"]:
            payload["accounts"] = deepcopy(item["accounts"])
        # Serialize publication with progress updates to preserve per-operation order.
        from .events import broadcast
        broadcast("info", "", uid=uid, extra=payload)


def publish(uid, phase, db):
    if current_operation.get():
        from ..database.repository import AccountRepository
        update(uid, phase, AccountRepository.get_by_uid(db, uid))
