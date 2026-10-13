"""Bổ sung cột HWID/phiên vào users và tạo 3 bảng auth. Chạy sau init_database()."""
from core.database.connection import db

_USER_COLUMNS = {
    "contact_info": "VARCHAR(100)",
    "hwid": "VARCHAR(64)",
    "expired_at": "TIMESTAMP",
    "last_login_at": "TIMESTAMP",
    "last_login_ip": "VARCHAR(45)",
    "last_hwid_reset_at": "TIMESTAMP",
}


def _column_names(table: str):
    if db._is_postgres:
        rows = db.fetch_all(
            """SELECT column_name AS name FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = ?""",
            (table,),
        )
        return {r["name"] for r in rows}
    rows = db.fetch_all(f"PRAGMA table_info({table})")
    return {r["name"] for r in rows}


def _ensure_user_columns():
    existing = _column_names("users")
    for name, col_type in _USER_COLUMNS.items():
        if name in existing:
            continue
        db.execute(f"ALTER TABLE users ADD COLUMN {name} {col_type}")


def init_auth_tables():
    pk = "SERIAL PRIMARY KEY" if db._is_postgres else "INTEGER PRIMARY KEY AUTOINCREMENT"
    bool_true = "TRUE" if db._is_postgres else "1"
    _ensure_user_columns()
    statements = [
        f"""
        CREATE TABLE IF NOT EXISTS user_sessions (
            id {pk},
            user_id INTEGER NOT NULL,
            ip_address VARCHAR(45),
            device_type VARCHAR(50),
            user_agent TEXT,
            browser VARCHAR(100),
            os VARCHAR(100),
            login_at TIMESTAMP,
            last_active_at TIMESTAMP,
            logout_at TIMESTAMP,
            is_active BOOLEAN DEFAULT {bool_true},
            token_hash VARCHAR(64)
        )
        """,
        f"""
        CREATE TABLE IF NOT EXISTS system_notifications (
            id {pk},
            user_id INTEGER,
            type VARCHAR(50) NOT NULL,
            target VARCHAR(20) NOT NULL DEFAULT 'admin',
            message TEXT NOT NULL,
            is_read BOOLEAN DEFAULT {'FALSE' if db._is_postgres else '0'},
            created_at TIMESTAMP
        )
        """,
        f"""
        CREATE TABLE IF NOT EXISTS admin_activity_logs (
            id {pk},
            admin_username VARCHAR(100) NOT NULL,
            admin_role VARCHAR(50),
            action_type VARCHAR(50) NOT NULL,
            target_username VARCHAR(100),
            target_uid INTEGER,
            target_role VARCHAR(50),
            change_detail TEXT,
            result VARCHAR(20) NOT NULL DEFAULT 'success',
            error_message TEXT,
            ip_address VARCHAR(45),
            user_agent TEXT,
            note TEXT,
            created_at TIMESTAMP
        )
        """,
    ]
    for stmt in statements:
        db.execute(stmt)
