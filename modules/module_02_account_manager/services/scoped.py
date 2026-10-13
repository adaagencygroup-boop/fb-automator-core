"""Explicit ownership across HTTP dependency teardown and background work."""
from ..context import owner_scope

async def run_owned(owner, function, *args):
    with owner_scope(owner):
        return await function(*args)

async def stream_owned(owner, factory):
    async for event in factory(owner=owner):
        yield event
