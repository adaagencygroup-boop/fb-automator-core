"""Delete only a profile belonging to the current plugin owner."""
import os
import stat
import time
import shutil
import logging
from .paths import profile_path

logger = logging.getLogger(__name__)

def _remove_readonly(func, path, exc_info):
    """Windows-safe error handler for shutil.rmtree removing read-only attributes."""
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except Exception as exc:
        logger.debug("Failed to reset permissions on %s: %s", path, exc)

def delete_profiles_by_uid(uid):
    path = profile_path(uid)
    if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
        raise ValueError("Không xóa profile qua liên kết thư mục")
    if not path.exists():
        return []

    # Release any active Chrome processes holding files in this profile
    try:
        from core.browser.driver import _release_profile_chrome
        _release_profile_chrome(str(path))
    except Exception as exc:
        logger.debug("Error releasing profile Chrome for %s: %s", uid, exc)

    time.sleep(0.2)
    try:
        shutil.rmtree(path, onerror=_remove_readonly)
    except OSError:
        try:
            time.sleep(0.3)
            shutil.rmtree(path, onerror=_remove_readonly)
        except OSError as exc:
            logger.warning("Could not completely delete profile directory %s: %s", path, exc)
            if not path.exists():
                return [str(path)]
            return []
    return [str(path)]
