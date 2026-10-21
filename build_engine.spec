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
    "core.browser",
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
    "selenium",
    "selenium.webdriver",
    "webdriver_manager",
    "curl_cffi",
    "pyotp",
    "jwt",
    "bcrypt",
    "dotenv",
    "PyQt5",
    "PyQt5.QtCore",
]

try:
    hidden_imports += collect_submodules("modules")
    hidden_imports += collect_submodules("core")
    hidden_imports += collect_submodules("selenium")
    hidden_imports += collect_submodules("webdriver_manager")
    hidden_imports += collect_submodules("sqlalchemy.dialects.sqlite")
    hidden_imports += collect_submodules("sqlalchemy.dialects.postgresql")
    hidden_imports += collect_submodules("yt_dlp")
    hidden_imports += collect_submodules("duckduckgo_search")
except Exception as e:
    print(f"Warning collecting submodules: {e}")

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
    excludes=[
        "tkinter", "matplotlib", "scipy", "notebook", "jupyter",
        "PyQt5.QtWebEngine", "PyQt5.QtWebEngineCore", "PyQt5.QtWebEngineWidgets",
        "PyQt5.QtQml", "PyQt5.QtQuick", "PyQt5.Qt3D", "PyQt5.QtMultimedia",
        "PyQt5.QtMultimediaWidgets", "PyQt5.QtBluetooth", "PyQt5.QtDesigner",
        "PyQt5.QtHelp", "PyQt5.QtLocation", "PyQt5.QtNfc", "PyQt5.QtOpenGL",
        "PyQt5.QtPositioning", "PyQt5.QtPrintSupport", "PyQt5.QtSensors",
        "PyQt5.QtSerialPort", "PyQt5.QtSql", "PyQt5.QtSvg", "PyQt5.QtTest",
        "PyQt5.QtWebChannel", "PyQt5.QtWebSockets", "PyQt5.QtXml",
    ],
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
