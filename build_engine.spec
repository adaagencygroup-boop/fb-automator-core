# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller Spec for building local_engine.exe (Tauri Sidecar Binary)
"""
import os
import sys
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None
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

try:
    hidden_imports += collect_submodules("modules.module_02_account_manager")
    hidden_imports += collect_submodules("sqlalchemy.dialects.sqlite")
    hidden_imports += collect_submodules("sqlalchemy.dialects.postgresql")
    hidden_imports += collect_submodules("yt_dlp")
    hidden_imports += collect_submodules("duckduckgo_search")
except Exception:
    pass

datas = [
    (os.path.join(PROJECT_DIR, "config"), "config"),
    (os.path.join(PROJECT_DIR, "data"), "data"),
]

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
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# Build single file executable for Tauri sidecar
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="local_engine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,  # Giữ console=True để Tauri shell có thể capture stdout/stderr
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
