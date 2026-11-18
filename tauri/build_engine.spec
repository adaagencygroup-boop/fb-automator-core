import glob as _glob
import os
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules
PROJECT_DIR = os.path.abspath(os.path.join(SPECPATH, ".."))
def _submodules(package: str):
  skip_bits = (".tests", ".testing", "test_", ".test.")
  out = []
  try:
    for name in collect_submodules(package):
      lower = name.lower()
      if any(bit in lower for bit in skip_bits):
        continue
      out.append(name)
  except Exception:
    pass
  return out
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
  "google.genai",
  "google.generativeai",
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
  "selenium.common",
  "selenium.common.exceptions",
  "yt_dlp",
  "duckduckgo_search",
]
for _path in (Path(PROJECT_DIR) / "modules").rglob("*.py"):
  _parts = _path.relative_to(PROJECT_DIR).with_suffix("").parts
  if "tests" in _parts or _path.name.startswith("test_"):
    continue
  if _parts[-1] == "__init__":
    _parts = _parts[:-1]
  hidden_imports.append(".".join(_parts))
hidden_imports += _submodules("sqlalchemy.dialects.postgresql")
hidden_imports += _submodules("selenium.webdriver.chrome")
hidden_imports += _submodules("selenium.webdriver.common")
hidden_imports += _submodules("selenium.webdriver.support")
hidden_imports += _submodules("selenium.webdriver.remote")
datas = [
  (os.path.join(PROJECT_DIR, "config"), "config"),
]
if sys.platform.startswith("linux"):
  datas = []
_env_file = os.path.join(PROJECT_DIR, ".env")
if sys.platform == "win32" and os.path.isfile(_env_file):
  datas.append((_env_file, "."))
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
  runtime_hooks=[
    os.path.join(PROJECT_DIR, "scripts", "pyi_rth_simplejson.py"),
  ],
  excludes=[
    "simplejson",
    "simplejson.errors",
    "simplejson.decoder",
    "simplejson.encoder",
    "simplejson.scanner",
    "tkinter",
    "matplotlib",
    "scipy",
    "notebook",
    "jupyter",
    "PyQt5",
    "PyQt6",
    "PySide2",
    "PySide6",
    "pytest",
    "pytest_asyncio",
    "IPython",
    "pandas.tests",
    "numpy.tests",
  ],
  noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
  pyz,
  a.scripts,
  [],
  exclude_binaries=True,
  name="local_engine",
  debug=False,
  bootloader_ignore_signals=False,
  strip=False,
  upx=False,
  console=False,
  disable_windowed_traceback=False,
  argv_emulation=False,
  target_arch=None,
  codesign_identity=None,
  entitlements_file=None,
)
coll = COLLECT(
  exe,
  a.binaries,
  a.zipfiles,
  a.datas,
  strip=False,
  upx=False,
  upx_exclude=[],
  name="local_engine",
)