"""Thread-safe, owner-filtered SSE fan-out + mirror WebSocket /ws/logs (desktop pack)."""
import asyncio
import json
import threading
from datetime import datetime, timezone
from ..context import owner_context, normalize_owner

_subscribers = set()
_lock = threading.Lock()
_UNSET = object()

# Desktop/Tauri: SSE đôi khi lệch owner → mirror thêm sang /ws/logs (không lọc owner).
_ws_manager = None
_ws_loop = None


def register_ws_log_channel(ws_manager, loop):
    """engine.py lifespan gọi để mọi broadcast() cũng lên WebSocket UI."""
    global _ws_manager, _ws_loop
    _ws_manager, _ws_loop = ws_manager, loop


def _mirror_ws(payload: dict):
    if _ws_manager is None or _ws_loop is None or getattr(_ws_loop, "is_closed", lambda: True)():
        return
    ws_payload = {
        "module": "accounts",
        "level": (payload.get("level") or "info"),
        "message": payload.get("message") or "",
        "timestamp": payload.get("time") or datetime.now(timezone.utc).isoformat(),
        "time": payload.get("time"),
        "uid": payload.get("uid"),
        "owner": payload.get("owner"),
        **{k: v for k, v in payload.items() if k not in ("level", "message", "time", "uid", "owner")},
    }

    async def _send():
        for connection in list(_ws_manager.active_connections):
            try:
                await connection.send_json(ws_payload)
            except Exception:
                _ws_manager.disconnect(connection)

    try:
        asyncio.run_coroutine_threadsafe(_send(), _ws_loop)
    except Exception:
        pass


def broadcast(level, message, uid=None, extra=None):
    from .operations import current_operation
    owner = normalize_owner(owner_context.get())
    payload = {
        "time": datetime.now(timezone.utc).isoformat(),
        "level": level,
        "message": message,
        "uid": uid,
        "owner": owner,
        "operation_id": current_operation.get(),
        **(extra or {}),
    }
    with _lock:
        targets = tuple(_subscribers)
    for loop, queue, subscriber_owner in targets:
        sub = normalize_owner(subscriber_owner)
        # Khớp owner; cho phép cả hai None (dev cũ). So sánh str để tránh "5" vs 5.
        if sub != owner or loop.is_closed():
            continue

        def deliver(q=queue, item=payload):
            if q.full():
                q.get_nowait()
            q.put_nowait(item)

        try:
            loop.call_soon_threadsafe(deliver)
        except RuntimeError:
            pass

    # Luôn mirror WS — bản đóng gói dựa vào /ws/logs khi SSE lọc mất
    _mirror_ws(payload)


async def event_stream(owner=_UNSET):
    queue = asyncio.Queue(maxsize=1000)
    subscriber = (
        asyncio.get_running_loop(),
        queue,
        normalize_owner(owner_context.get() if owner is _UNSET else owner),
    )
    with _lock:
        _subscribers.add(subscriber)
    try:
        yield 'data: {"type":"connected","message":"SSE stream connected"}\n\n'
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), 25)
            except asyncio.TimeoutError:
                event = {"type": "heartbeat"}
            yield "data: " + json.dumps(event, ensure_ascii=False) + "\n\n"
    finally:
        with _lock:
            _subscribers.discard(subscriber)
