"""
System Constants and Enums
"""
import os
from enum import Enum
from pathlib import Path
from dotenv import dotenv_values, load_dotenv

import sys
if getattr(sys, "frozen", False):
  BASE_DIR = Path(sys.executable).resolve().parent
else:
  BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
LOGS_DIR = BASE_DIR / "logs"
DOWNLOADS_DIR = BASE_DIR / "downloads"
TIKTOK_CONFIG_PATH = DATA_DIR / "tiktok_config.json"
TIKTOK_CONFIG_INI_PATH = DATA_DIR / "tiktok_config.ini"
TIKTOK_SESSION_PATH = DATA_DIR / "tiktok_session.json"
YOUTUBE_CONFIG_PATH = DATA_DIR / "youtube_config.json"
YOUTUBE_CONFIG_INI_PATH = DATA_DIR / "youtube_config.ini"

# Tải biến môi trường từ file .env tại thư mục gốc dự án
ENV_PATH = BASE_DIR / ".env"
if ENV_PATH.exists():
    load_dotenv(ENV_PATH)
else:
    load_dotenv()

# Đảm bảo các thư mục hệ thống tồn tại
DATA_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR.mkdir(parents=True, exist_ok=True)
DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "fb_automator.db"
CONFIG_PATH = DATA_DIR / "config.json"
KEYS_PATH = DATA_DIR / "keys.txt"
PROXIES_PATH = DATA_DIR / "proxies.txt"

def _postgres_url(value):
    """Chỉ nhận DSN libpq. URL prisma+postgres của IDE không dùng được với psycopg2."""
    value = (value or "").strip().strip('"').strip("'")
    if value.startswith("postgres://"):
        value = "postgresql://" + value[len("postgres://"):]
    return value if value.startswith("postgresql://") else ""


# Ưu tiên DATABASE_URL postgresql có sẵn trong process (test/CI).
# Terminal Cursor đôi khi inject prisma+postgres:// — bỏ qua và lấy URL trong .env.
_file_database_url = _postgres_url(
    dotenv_values(ENV_PATH).get("DATABASE_URL") if ENV_PATH.exists() else ""
)
DATABASE_URL = _postgres_url(os.environ.get("DATABASE_URL")) or _file_database_url
if DATABASE_URL:
    os.environ["DATABASE_URL"] = DATABASE_URL

# Cấu hình Local Engine Server
ENGINE_HOST = os.environ.get("ENGINE_HOST", "127.0.0.1").strip()
ENGINE_PORT = int(os.environ.get("ENGINE_PORT", 28129))

class AccountStatus(str, Enum):
    NEW = "NEW"
    LIVE = "LIVE"
    DIE = "DIE"
    CHECKPOINT = "CHECKPOINT"
    RESTRICTED = "RESTRICTED"

class ProxyStatus(str, Enum):
    ACTIVE = "ACTIVE"
    DEAD = "DEAD"
    SLOW = "SLOW"
    UNCHECKED = "UNCHECKED"

class TaskStatus(str, Enum):
    IDLE = "IDLE"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

class LogLevel(str, Enum):
    INFO = "INFO"
    SUCCESS = "SUCCESS"
    WARNING = "WARNING"
    ERROR = "ERROR"
    DEBUG = "DEBUG"
