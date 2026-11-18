import hashlib
import os
import sys
import threading
from pathlib import Path
from typing import Optional
_DEFAULT_BASE = (
  Path(os.environ.get("LOCALAPPDATA", Path.home())) / "FBAutomator"
  if getattr(sys, "frozen", False)
  else Path(__file__).resolve().parents[2] / "data"
)
if getattr(sys, "frozen", False) and sys.platform.startswith("linux"):
  _DEFAULT_BASE = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "FBAutomator" / "data"
BASE_DIR = str(Path(os.environ.get("FB_ACCOUNT_DATA_DIR", _DEFAULT_BASE / "module_02_account_manager")).resolve())
PROFILES_DIR = str(Path(BASE_DIR) / "browser_profiles")
def normalize_owner(owner: Optional[str]) -> Optional[str]:
  return (str(owner).strip() or None) if owner is not None else None
def validate_uid(uid) -> str:
  uid = str(uid).strip()
  if not uid or len(uid) > 50 or not uid.isascii() or not uid.isdigit():
    raise ValueError("UID phải gồm các chữ số ASCII, tối đa 50 ký tự")
  return uid
def owner_directory(owner: Optional[str]) -> str:
  owner = normalize_owner(owner)
  return "local" if owner is None else hashlib.sha256(owner.encode()).hexdigest()
def profile_path(uid, owner: Optional[str] = None) -> Path:
  root = Path(PROFILES_DIR).resolve()
  path = root / owner_directory(owner) / validate_uid(uid)
  for component in (path.parent, path):
    if component.is_symlink() or getattr(component, "is_junction", lambda: False)():
      raise ValueError("Profile không được dùng liên kết thư mục")
  if not path.resolve().is_relative_to(root):
    raise ValueError("Profile nằm ngoài thư mục profile chung")
  return path
def get_profile_path(uid, owner: Optional[str] = None) -> str:
  path = profile_path(uid, owner)
  path.mkdir(parents=True, exist_ok=True)
  return str(path)
def profile_key(uid, owner: Optional[str] = None) -> str:
  return f"{owner_directory(owner)}/{validate_uid(uid)}"
_profile_locks = {}
_profile_locks_guard = threading.Lock()
def get_profile_lock(uid, owner: Optional[str] = None) -> threading.Lock:
  key = profile_key(uid, owner)
  with _profile_locks_guard:
    if key not in _profile_locks:
      _profile_locks[key] = threading.Lock()
    return _profile_locks[key]
