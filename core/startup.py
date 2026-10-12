"""Visible timing and failure diagnostics for backend startup."""
import time
import traceback
from contextlib import contextmanager
from datetime import datetime


@contextmanager
def startup_step(name):
    started = time.monotonic()
    print(f"[Startup] {datetime.now().isoformat(timespec='seconds')} START {name}", flush=True)
    try:
        yield
    except Exception:
        print(f"[Startup] FAILED {name} after {time.monotonic() - started:.2f}s", flush=True)
        traceback.print_exc()
        raise
    else:
        print(f"[Startup] DONE {name} in {time.monotonic() - started:.2f}s", flush=True)
