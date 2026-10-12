"""
paths.py
Đường dẫn dữ liệu local của Module 03 (profile Chrome, DB tài khoản, file log).
Tất cả nằm trong data/ và logs/ của repo, đã được .gitignore.
"""
import os

from config.constants import DATA_DIR, LOGS_DIR

PROFILES_DIR = str(DATA_DIR / "browser_profiles")
ACCOUNTS_DB_PATH = str(DATA_DIR / "module_03_accounts.db")
LOG_PATH = str(LOGS_DIR / "module_03_farm.log")

os.makedirs(PROFILES_DIR, exist_ok=True)


def get_profile_path(uid: str) -> str:
    """Trả về đường dẫn tuyệt đối đến thư mục profile Chrome của UID."""
    uid_str = str(uid).strip()
    path = os.path.join(PROFILES_DIR, uid_str)
    os.makedirs(path, exist_ok=True)
    return os.path.abspath(path)
