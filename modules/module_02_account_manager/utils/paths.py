"""Plugin-owned storage; no discovery or copying of source-project data."""
import hashlib
import os
import sys
from pathlib import Path
from ..context import owner_context

_DEFAULT = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "FBAutomator" if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[3] / "data"
BASE_DIR = str(Path(os.environ.get("FB_ACCOUNT_DATA_DIR", _DEFAULT / "module_02_account_manager")).resolve())
PROFILES_DIR = str(Path(BASE_DIR) / "browser_profiles")

def validate_uid(uid):
    uid = str(uid).strip()
    if not uid or len(uid) > 50 or not uid.isascii() or not uid.isdigit():
        raise ValueError("UID phải gồm các chữ số ASCII, tối đa 50 ký tự")
    return uid

def owner_directory():
    owner = owner_context.get()
    return "local" if owner is None else hashlib.sha256(owner.encode()).hexdigest()

def account_key(uid):
    return (owner_context.get(), validate_uid(uid))

def profile_path(uid):
    root = Path(PROFILES_DIR).resolve()
    path = root / owner_directory() / validate_uid(uid)
    for component in (path.parent, path):
        if component.is_symlink() or getattr(component, "is_junction", lambda: False)():
            raise ValueError("Profile không được dùng liên kết thư mục")
    if not path.resolve().is_relative_to(root):
        raise ValueError("Profile nằm ngoài thư mục plugin")
    return path

def get_profile_path(uid):
    path = profile_path(uid)
    path.mkdir(parents=True, exist_ok=True)
    return str(path)
