"""Delete only a profile belonging to the current plugin owner."""
import shutil
from .paths import profile_path

def delete_profiles_by_uid(uid):
    path = profile_path(uid)
    if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
        raise ValueError("Không xóa profile qua liên kết thư mục")
    if not path.exists():
        return []
    try:
        shutil.rmtree(path)
    except OSError as exc:
        raise RuntimeError("Không thể xóa profile; hãy đóng Chrome rồi thử lại") from exc
    return [str(path)]
