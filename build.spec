# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller Spec File - Facebook Automator Pro
Tối ưu đóng gói toàn bộ 9 Modules và Core Engine thành ứng dụng Desktop hoàn chỉnh.
"""

import sys
import os
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None
PROJECT_DIR = os.path.abspath(SPECPATH)

# 1. Thu thập tất cả các submodules của 9 Modules và thư viện phức tạp
hidden_imports = [
    # Core system & 9 Modules
    "config",
    "config.constants",
    "config.settings",
    "config.theme",
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
    "gui",
    "gui.main_window",
    "gui.components",
    "gui.components.stat_card",
    "gui.components.log_viewer",
    "modules",
    "modules.module_01_dashboard",
    "modules.module_01_dashboard.ui",
    "modules.module_02_account_manager",
    "modules.module_02_account_manager.ui",
    "modules.module_02_account_manager.worker",
    "modules.module_03_acc_farm",
    "modules.module_03_acc_farm.ui",
    "modules.module_03_acc_farm.worker",
    "modules.module_04_page_creator",
    "modules.module_04_page_creator.ui",
    "modules.module_04_page_creator.worker",
    "modules.module_05_page_manager",
    "modules.module_05_page_manager.ui",
    "modules.module_05_page_manager.worker",
    "modules.module_06_omnichannel_chat",
    "modules.module_06_omnichannel_chat.ui",
    "modules.module_06_omnichannel_chat.worker",
    "modules.module_07_group_spam",
    "modules.module_07_group_spam.ui",
    "modules.module_07_group_spam.worker",
    "modules.module_08_interaction_seeding",
    "modules.module_08_interaction_seeding.ui",
    "modules.module_08_interaction_seeding.worker",
    "modules.module_09_user_profile",
    "modules.module_09_user_profile.ui",
    # External libraries
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
    "pydantic",
    "PIL",
    "psutil",
]

# Tự động quét submodules của yt-dlp và duckduckgo_search
try:
    hidden_imports += collect_submodules("yt_dlp")
    hidden_imports += collect_submodules("duckduckgo_search")
except Exception:
    pass

# 2. Gom dữ liệu tĩnh (Datas)
datas = [
    (os.path.join(PROJECT_DIR, "config"), "config"),
    (os.path.join(PROJECT_DIR, "data"), "data"),
]

# Thu thập data files cần thiết từ packages
try:
    datas += collect_data_files("yt_dlp")
except Exception:
    pass

a = Analysis(
    [os.path.join(PROJECT_DIR, "main.py")],
    pathex=[PROJECT_DIR],
    binaries=[],
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "scipy", "notebook", "jupyter"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# Chế độ OneDir (Tối ưu nhất cho Desktop App có CSDL SQLite & nhiều media assets)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="FacebookAutomatorPro",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,  # Đổi thành True nếu muốn mở console đen để xem debug log
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,  # Thêm đường dẫn file .ico tại đây khi có logo: "assets/icon.ico"
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="FacebookAutomatorPro",
)
