"""Host integration without dependencies on host modules."""
from .database import connection
from .services import runtime

def initialize(database_url=None, profile_root=None):
    if profile_root:
        from .utils import paths
        from pathlib import Path
        paths.PROFILES_DIR = str(Path(profile_root).resolve())
    connection.initialize(database_url)
    runtime.initialize()

async def shutdown():
    await runtime.shutdown()
    from .automation.browser_manager import close_all_active_drivers
    import asyncio
    await asyncio.to_thread(close_all_active_drivers)
    connection.shutdown()
