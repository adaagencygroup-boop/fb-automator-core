"""
=============================================================================
MODULE 07: SPAM & ĐĂNG BÀI GROUP FACEBOOK - HỆ THỐNG CONSTANTS
Chứa toàn bộ các hằng số, cấu hình mặc định, URL endpoint và Enum trạng thái.
=============================================================================
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Dict, Set


# =============================================================================
# 1. THÔNG TIN MODULE & ĐƯỜNG DẪN MẶC ĐỊNH
# =============================================================================
MODULE_ID = "module_07_group_spam"
MODULE_TITLE = "Spam & Đăng Bài Group Facebook"
MODULE_API_PREFIX = "/api/groups"


# =============================================================================
# 2. CẤU HÌNH NHÀ CUNG CẤP AI (AI PROVIDERS & ENDPOINTS)
# =============================================================================
OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions"

DEFAULT_MODEL = "gpt-4o"

MODEL_SPECS: Dict[str, Dict[str, str]] = {
    # OpenAI Models
    "gpt-4o": {"provider": "openai", "api_model": "gpt-4o"},
    "gpt-4o-mini": {"provider": "openai", "api_model": "gpt-4o-mini"},
    
    # Google Gemini Models (AI Studio)
    "gemini-3.8-flash": {"provider": "gemini", "api_model": "gemini-3.8-flash"},
    "gemini-3.7-flash": {"provider": "gemini", "api_model": "gemini-3.7-flash"},
    "gemini-3.6-flash": {"provider": "gemini", "api_model": "gemini-3.6-flash"},
    "gemini-3.5-flash": {"provider": "gemini", "api_model": "gemini-3.5-flash"},
    "gemini-3.5-flash-lite": {"provider": "gemini", "api_model": "gemini-3.5-flash-lite"},
    "gemini-3.1-pro-preview": {"provider": "gemini", "api_model": "gemini-3.1-pro-preview"},
    "gemini-2.5-flash": {"provider": "gemini", "api_model": "gemini-2.5-flash"},
    "gemini-2.5-flash-lite": {"provider": "gemini", "api_model": "gemini-2.5-flash-lite"},
    "gemini-2.5-pro": {"provider": "gemini", "api_model": "gemini-2.5-pro"},
    
    # DeepSeek Models
    "deepseek-v4-flash": {"provider": "deepseek", "api_model": "deepseek-flash"},
    "deepseek-flash": {"provider": "deepseek", "api_model": "deepseek-flash"},
    
    # Backward compatibility
    "gemini": {"provider": "gemini", "api_model": "gemini-2.5-flash"},
}


# =============================================================================
# 3. GIỚI HẠN & CÀI ĐẶT THIẾT BỊ MẶC ĐỊNH (SYSTEM LIMITS & DEFAULTS)
# =============================================================================
DEFAULT_THREADS = 2
MIN_THREADS = 1
MAX_THREADS = 10

DEFAULT_REST_MINUTES = 10
MIN_REST_MINUTES = 0
MAX_REST_MINUTES = 1440

DEFAULT_MAX_POSTS = 10
MIN_MAX_POSTS = 1
MAX_MAX_POSTS = 1000

DEFAULT_DELAY_MIN = 15
DEFAULT_DELAY_MAX = 30

DEFAULT_SETTINGS: Dict[str, Any] = {
    "model": DEFAULT_MODEL,
    "threads": DEFAULT_THREADS,
    "rest_minutes": DEFAULT_REST_MINUTES,
    "max_posts": DEFAULT_MAX_POSTS,
    "api_keys": {},
}


# =============================================================================
# 4. ENUMS & TRẠNG THÁI CHIẾN DỊCH (CAMPAIGN & SESSION STATES)
# =============================================================================
class ActionType(str, Enum):
    POST = "POST"
    COMMENT = "COMMENT"


class CampaignStatus(str, Enum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    STOPPED = "STOPPED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    PARTIAL = "PARTIAL"
    CANCELLED = "CANCELLED"


# Tập hợp các trạng thái kết thúc (không thể tiếp tục chạy)
TERMINAL_STATES: Set[str] = {
    CampaignStatus.COMPLETED.value,
    CampaignStatus.PARTIAL.value,
    CampaignStatus.STOPPED.value,
    CampaignStatus.FAILED.value,
    CampaignStatus.CANCELLED.value,
}


class StepStatus(str, Enum):
    SUCCESS = "SUCCESS"
    PENDING_APPROVAL = "PENDING_APPROVAL"  # Chờ QTV duyệt bài
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"
    JOINED = "JOINED"                      # Đã bấm tham gia nhóm
    ALREADY_MEMBER = "ALREADY_MEMBER"      # Đã là thành viên


# =============================================================================
# 5. FACEBOOK CONSTANTS & SELECTORS
# =============================================================================
FB_BASE_URL = "https://www.facebook.com"
FB_GROUPS_BASE_URL = "https://www.facebook.com/groups/"
FB_GROUP_SEARCH_URL = "https://www.facebook.com/groups/search/groups/?q={search_term}"

# Các thẻ HTML dạng khối khi trích xuất text thuần từ bộ soạn thảo nội dung
BLOCK_TAGS: Set[str] = {"p", "div", "h1", "h2", "h3", "blockquote", "li", "br", "hr"}


# =============================================================================
# 6. DATABASE TABLES V2 (POSTGRESQL)
# =============================================================================
TABLE_CLOUD_GROUP_CAMPAIGNS = "cloud_group_campaigns"
TABLE_CLOUD_GROUP_RUNS = "cloud_group_runs"
TABLE_CLOUD_GROUP_LOGS = "cloud_group_logs"

# =============================================================================
# 7. DEFINE LOG 
# =============================================================================

class LogLevel(str, Enum):
    INFO = "INFO"
    WARNING = "WARNING"
    SUCCESS = "SUCCESS"
    ERROR = "ERROR"
