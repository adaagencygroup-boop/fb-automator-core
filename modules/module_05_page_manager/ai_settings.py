"""Cấu hình màn đăng bài AI, lưu theo user trên server."""
import json
import re

from core.database.connection import db

_MODEL_RE = re.compile(r"^[A-Za-z0-9._:-]{1,80}$")
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_DEFAULT_MODEL = "gemini-3-flash-preview"
_DEFAULT_TIMES = ["09:00", "15:00", "21:00"]

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS ai_post_settings (
    owner_username VARCHAR(100) PRIMARY KEY,
    gemini_key TEXT NOT NULL DEFAULT '',
    pixabay_key TEXT NOT NULL DEFAULT '',
    model_name VARCHAR(100) NOT NULL DEFAULT 'gemini-3-flash-preview',
    prompt TEXT NOT NULL DEFAULT '',
    schedule_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    schedule_times TEXT NOT NULL DEFAULT '',
    sleep_min INT NOT NULL DEFAULT 600,
    sleep_max INT NOT NULL DEFAULT 900,
    keywords_json TEXT NOT NULL DEFAULT '{}',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
"""


def ensure_table() -> None:
    db.execute(_CREATE_TABLE)


def _clip(value, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _sleep(value, fallback: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return fallback
    return min(86400, max(0, number))


def normalize_settings(raw) -> dict:
    """Chuẩn hóa khối cấu hình trước khi ghi. Không giữ phiên bản Graph vì luồng này không gọi Graph."""
    source = raw or {}
    model = _clip(source.get("model_name"), 80)
    if not _MODEL_RE.match(model):
        model = _DEFAULT_MODEL
    times = []
    incoming = source.get("schedule_times")
    if isinstance(incoming, str):
        incoming = [part.strip() for part in incoming.replace(";", ",").split(",")]
    for item in incoming or []:
        value = str(item or "").strip()
        if _TIME_RE.match(value) and value not in times:
            times.append(value)
        if len(times) >= 24:
            break
    sleep_min = _sleep(source.get("sleep_min"), 600)
    sleep_max = _sleep(source.get("sleep_max"), 900)
    if sleep_max < sleep_min:
        sleep_max = sleep_min
    keywords = {}
    incoming_keywords = source.get("keywords") or {}
    if isinstance(incoming_keywords, dict):
        for key, value in incoming_keywords.items():
            page_key = _clip(key, 200)
            if not page_key:
                continue
            keywords[page_key] = _clip(value, 200)
            if len(keywords) >= 300:
                break
    return {
        "gemini_key": _clip(source.get("gemini_key"), 300),
        "pixabay_key": _clip(source.get("pixabay_key"), 300),
        "model_name": model,
        "prompt": _clip(source.get("prompt"), 2000),
        "schedule_enabled": bool(source.get("schedule_enabled")),
        "schedule_times": times,
        "sleep_min": sleep_min,
        "sleep_max": sleep_max,
        "keywords": keywords,
    }


def _public(row, saved: bool) -> dict:
    if not row:
        config = normalize_settings({
            "model_name": _DEFAULT_MODEL,
            "schedule_times": _DEFAULT_TIMES,
            "sleep_min": 600,
            "sleep_max": 900,
        })
        config["saved"] = False
        return config
    try:
        keywords = json.loads(row.get("keywords_json") or "{}")
    except Exception:
        keywords = {}
    times = [part.strip() for part in str(row.get("schedule_times") or "").split(",") if part.strip()]
    config = normalize_settings({
        "gemini_key": row.get("gemini_key"),
        "pixabay_key": row.get("pixabay_key"),
        "model_name": row.get("model_name"),
        "prompt": row.get("prompt"),
        "schedule_enabled": row.get("schedule_enabled"),
        "schedule_times": times or _DEFAULT_TIMES,
        "sleep_min": row.get("sleep_min"),
        "sleep_max": row.get("sleep_max"),
        "keywords": keywords if isinstance(keywords, dict) else {},
    })
    if not times:
        config["schedule_times"] = []
    config["saved"] = saved
    return config


def load_settings(owner: str) -> dict:
    owner = _clip(owner, 100)
    if not owner:
        raise ValueError("Thiếu user để đọc cấu hình.")
    ensure_table()
    row = db.fetch_one("SELECT * FROM ai_post_settings WHERE owner_username = ?", (owner,))
    return _public(row, saved=bool(row))


def save_settings(owner: str, raw) -> dict:
    owner = _clip(owner, 100)
    if not owner:
        raise ValueError("Thiếu user để lưu cấu hình.")
    config = normalize_settings(raw)
    ensure_table()
    db.execute(
        """
        INSERT INTO ai_post_settings (
            owner_username, gemini_key, pixabay_key, model_name, prompt,
            schedule_enabled, schedule_times, sleep_min, sleep_max, keywords_json, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (owner_username) DO UPDATE SET
            gemini_key = EXCLUDED.gemini_key,
            pixabay_key = EXCLUDED.pixabay_key,
            model_name = EXCLUDED.model_name,
            prompt = EXCLUDED.prompt,
            schedule_enabled = EXCLUDED.schedule_enabled,
            schedule_times = EXCLUDED.schedule_times,
            sleep_min = EXCLUDED.sleep_min,
            sleep_max = EXCLUDED.sleep_max,
            keywords_json = EXCLUDED.keywords_json,
            updated_at = CURRENT_TIMESTAMP
        """,
        (
            owner,
            config["gemini_key"],
            config["pixabay_key"],
            config["model_name"],
            config["prompt"],
            config["schedule_enabled"],
            ",".join(config["schedule_times"]),
            config["sleep_min"],
            config["sleep_max"],
            json.dumps(config["keywords"], ensure_ascii=False),
        ),
    )
    config["saved"] = True
    return config
