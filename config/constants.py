"""
System Constants and Enums
"""
import os
from enum import Enum
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
LOGS_DIR = BASE_DIR / "logs"
DOWNLOADS_DIR = BASE_DIR / "downloads"

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

# PostgreSQL production từ .env. Không có URL local.
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()

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
