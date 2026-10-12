"""Thread-safe, owner-filtered SSE fan-out."""
import asyncio
import json
import threading
from datetime import datetime, timezone
from ..context import owner_context

_subscribers = set()
_lock = threading.Lock()
_UNSET = object()

def broadcast(level, message, uid=None, extra=None):
    owner = owner_context.get()
    payload = {"time": datetime.now(timezone.utc).isoformat(), "level": level, "message": message, "uid": uid, **(extra or {})}
    with _lock:
        targets = tuple(_subscribers)
    for loop, queue, subscriber_owner in targets:
        if subscriber_owner != owner or loop.is_closed():
            continue
        def deliver(q=queue, item=payload):
            if q.full():
                q.get_nowait()
            q.put_nowait(item)
        try:
            loop.call_soon_threadsafe(deliver)
        except RuntimeError:
            pass

async def event_stream(owner=_UNSET):
    queue = asyncio.Queue(maxsize=1000)
    subscriber = (asyncio.get_running_loop(), queue, owner_context.get() if owner is _UNSET else owner)
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
