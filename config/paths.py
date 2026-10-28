"""Resolve writable runtime storage separately from installed application files."""
import os
import sys
from pathlib import Path


def runtime_root():
    if not getattr(sys, "frozen", False):
        return Path(__file__).resolve().parent.parent
    if sys.platform.startswith("linux"):
        data_home = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
        return data_home / "FBAutomator"
    return Path(sys.executable).resolve().parent
