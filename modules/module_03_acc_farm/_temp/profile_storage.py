"""Quản lý các thư mục Chrome profile gắn với UID tài khoản."""

import logging
import shutil
from pathlib import Path
from typing import Iterable, List, Union

logger = logging.getLogger(__name__)

from modules.module_03_acc_farm.browser.paths import PROFILES_DIR

PROFILE_ROOTS = (
    Path(PROFILES_DIR),
)


def delete_profiles_by_uid(
    uid: str,
    profile_roots: Iterable[Union[str, Path]] = PROFILE_ROOTS,
) -> List[str]:
    """Xóa folder mang đúng tên UID tại tất cả nơi lưu browser profile."""
    uid = str(uid).strip()
    if not uid or uid in {".", ".."} or "/" in uid or "\\" in uid:
        raise ValueError("UID tài khoản không hợp lệ")

    deleted_paths: List[str] = []
    errors: List[str] = []

    for root_value in profile_roots:
        root = Path(root_value).resolve()
        profile_path = root / uid
        try:
            if profile_path.is_symlink():
                profile_path.unlink()
                deleted_paths.append(str(profile_path))
            elif profile_path.exists():
                if not profile_path.is_dir():
                    raise OSError("Đường dẫn profile không phải là thư mục")
                shutil.rmtree(profile_path)
                deleted_paths.append(str(profile_path))
        except OSError as exc:
            logger.exception("Không thể xóa browser profile: %s", profile_path)
            errors.append(f"{profile_path}: {exc}")

    if errors:
        raise RuntimeError("; ".join(errors))

    return deleted_paths
