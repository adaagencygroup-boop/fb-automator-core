"""Fan out committed auth events to connected admin streams in this engine process."""
from queue import Full, Queue
from threading import Lock

_subscribers = set()
_lock = Lock()


def subscribe():
    queue = Queue(maxsize=100)
    with _lock:
        _subscribers.add(queue)
    return queue


def unsubscribe(queue):
    with _lock:
        _subscribers.discard(queue)


def publish(event):
    with _lock:
        for queue in _subscribers:
            try:
                queue.put_nowait(event)
            except Full:
                # Persistent notifications remain available via the list API.
                pass
