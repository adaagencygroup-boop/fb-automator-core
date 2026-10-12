"""Owner scope shared by services and copied into background workers."""
from contextlib import contextmanager
from contextvars import ContextVar

owner_context = ContextVar("account_owner", default=None)

def normalize_owner(value):
    return str(value).strip() or None if value is not None else None

@contextmanager
def owner_scope(owner):
    token = owner_context.set(normalize_owner(owner))
    try:
        yield
    finally:
        owner_context.reset(token)
