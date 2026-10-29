# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for local_engine / local_engine.exe (Tauri sidecar).
"""
import os
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

PROJECT_DIR = os.path.abspath(SPECPATH)

hidden_imports = [
    "uvicorn",
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespans",
    "uvicorn.lifespans.on",
    "fastapi",
    "starlette",
    "pydantic",
    "config",
    "config.constants",
    "config.settings",
    "core",
    "core.base_module",
    "core.database",
    "core.database.connection",
    "core.database.models",
    "core.facebook",
    "core.facebook.fb_graph_client",
    "core.ai",
    "core.ai.gemini_engine",
    "core.media",
    "core.media.tiktok_scraper",
    "core.media.youtube_scraper",
    "core.media.image_search",
    "core.network",
    "core.network.proxy_manager",
    "modules",
    "sqlite3",
    "psycopg2",
    "psycopg2.extras",
    "psycopg2.pool",
    "requests",
    "urllib3",
    "yt_dlp",
    "duckduckgo_search",
    "google.genai",
    "google.generativeai",
]

# Enumerate project modules without importing them: some imports open the database.
for _path in (Path(PROJECT_DIR) / "modules").rglob("*.py"):
    _parts = _path.relative_to(PROJECT_DIR).with_suffix("").parts
    if "tests" in _parts or _path.name.startswith("test_"):
        continue
    if _parts[-1] == "__init__":
        _parts = _parts[:-1]
    hidden_imports.append(".".join(_parts))

try:
    hidden_imports += collect_submodules("sqlalchemy.dialects.sqlite")
    hidden_imports += collect_submodules("sqlalchemy.dialects.postgresql")
    hidden_imports += collect_submodules("yt_dlp")
    hidden_imports += collect_submodules("duckduckgo_search")
    # Selenium lazy-imports chrome.webdriver — PyInstaller bỏ sót nếu không collect hết
    hidden_imports += collect_submodules("selenium")
    hidden_imports += collect_submodules("selenium.webdriver")
except Exception:
    pass

hidden_imports += [
    "selenium",
    "selenium.webdriver",
    "selenium.webdriver.common",
    "selenium.webdriver.common.by",
    "selenium.webdriver.common.keys",
    "selenium.webdriver.common.action_chains",
    "selenium.webdriver.chrome",
    "selenium.webdriver.chrome.webdriver",
    "selenium.webdriver.chrome.options",
    "selenium.webdriver.chrome.service",
    "selenium.webdriver.remote",
    "selenium.webdriver.remote.webdriver",
    "selenium.webdriver.support",
    "selenium.webdriver.support.ui",
    "selenium.webdriver.support.expected_conditions",
]

datas = [
    (os.path.join(PROJECT_DIR, "config"), "config"),
]

# Runtime data (especially Chrome profiles) is created on the user's machine.
# Bundling it makes onefile extraction huge and can exceed Windows path limits.

# Linux installs into a read-only system directory. Settings are created in the
# user's XDG data directory; do not copy the build machine's local data into it.
if sys.platform.startswith("linux"):
    datas = []

# .env production — Local Engine sidecar cần DATABASE_URL khi chạy ngoài repo
_env_file = os.path.join(PROJECT_DIR, ".env")
if sys.platform == "win32" and os.path.isfile(_env_file):
    datas.append((_env_file, "."))

# SQL / migration assets đọc bằng đường dẫn file lúc runtime (không nằm trong .pyc)
import glob as _glob
for _mig in _glob.glob(os.path.join(PROJECT_DIR, "modules", "*", "migrations")):
    _rel = os.path.relpath(_mig, PROJECT_DIR)
    datas.append((_mig, _rel))

try:
    datas += collect_data_files("yt_dlp")
except Exception:
    pass

a = Analysis(
    [os.path.join(PROJECT_DIR, "engine.py")],
    pathex=[PROJECT_DIR],
    binaries=[],
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "scipy", "notebook", "jupyter", "PyQt5"],
    noarchive=False,
)

pyz = PYZ(a.pure)

# Build single file executable for Tauri sidecar
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="local_engine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    # UPX dễ bị Windows Defender quét lâu (máy khác có thể 5–10 phút lần đầu).
    upx=False,
    console=True,  # Giữ console=True để Tauri shell có thể capture stdout/stderr
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
