"""Bounded plugin executor; every submission retains its owner context."""
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context

executor = None
stopping = threading.Event()
_watchers = set()
_guard = threading.Lock()

def initialize():
    global executor
    if executor is None:
        stopping.clear()
        executor = ThreadPoolExecutor(max_workers=10, thread_name_prefix="accounts")

def submit(fn, *args):
    if executor is None or stopping.is_set():
        raise RuntimeError("Accounts plugin is not running")
    return executor.submit(copy_context().run, fn, *args)

def watch(fn, *args):
    context = copy_context()
    def run():
        try:
            context.run(fn, *args)
        finally:
            with _guard:
                _watchers.discard(threading.current_thread())
    thread = threading.Thread(target=run, daemon=True, name="account-session-watcher")
    with _guard:
        _watchers.add(thread)
    thread.start()

async def shutdown():
    global executor
    stopping.set()
    pool, executor = executor, None
    if pool:
        await asyncio.to_thread(pool.shutdown, wait=True, cancel_futures=True)
    with _guard:
        watchers = tuple(_watchers)
    for thread in watchers:
        await asyncio.to_thread(thread.join)
