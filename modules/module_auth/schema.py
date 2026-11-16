"""Bổ sung cột HWID/phiên vào users, tạo các bảng auth và bảng quản lý bản quyền tính năng (Feature Licenses). Chạy sau init_database()."""
from core.database.connection import db

_USER_COLUMNS = {
    "contact_info": "VARCHAR(100)",
    "hwid": "VARCHAR(64)",
    "expired_at": "TIMESTAMP",
    "last_login_at": "TIMESTAMP",
    "last_login_ip": "VARCHAR(45)",
    "last_hwid_reset_at": "TIMESTAMP",
    "client_version": "VARCHAR(30) DEFAULT 'v2.3.9'",
}

SYSTEM_DEFAULT_FEATURES = [
    ("fb_account", "1. Quản lý tài khoản Facebook", "Quản lý và đồng bộ danh sách tài khoản Facebook", 1),
    ("post_interact", "2. Đăng bài và tương tác tài khoản", "Đăng bài tự động, tương tác newfeed tài khoản", 2),
    ("create_fanpage", "3. Tạo Fanpage hàng loạt", "Tự động tạo Fanpage vệ tinh số lượng lớn", 3),
    ("manage_fanpage", "4. Quản lý Fanpage", "Quản trị thông tin, nội dung Fanpage", 4),
    ("chat_fanpage", "5. Quản lý Chat Page", "Quản lý hộp thư và chat khách hàng tập trung", 5),
    ("spam_group", "6. Spam Group Hội Nhóm", "Đăng bài chia sẻ nhóm Facebook tự động", 6),
    ("seeding", "7. Seeding Bài & Page", "Tự động bình luận, like chéo seeding bài viết", 7),
    ("scan_group", "8. Quét nhóm", "Tìm kiếm và cào dữ liệu thành viên, bài đăng nhóm", 8),
    ("scan_page", "9. Quét page", "Quét phân tích fanpage đối thủ", 9),
    ("scan_post", "10. Quét bài viết", "Quét lượt tương tác và bình luận bài đăng", 10),
    ("scan_profile", "11. Quét profile", "Quét thông tin cá nhân khách hàng tiềm năng", 11),
]


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
        try:
            db.execute(f"ALTER TABLE users ADD COLUMN {name} {col_type}")
        except Exception as e:
            print(f"[Schema Notice] ALTER TABLE users ADD COLUMN {name}: {e}")


def seed_system_features():
    """Khởi tạo danh sách 11 tính năng bản quyền cốt lõi nếu chưa có"""
    for key, name, desc, order in SYSTEM_DEFAULT_FEATURES:
        row = db.fetch_one("SELECT feature_key FROM system_features WHERE feature_key = ?", (key,))
        if not row:
            db.execute(
                """INSERT INTO system_features (feature_key, feature_name, description, order_index, is_active)
                   VALUES (?, ?, ?, ?, ?)""",
                (key, name, desc, order, True),
            )


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
        # 1. Bảng danh mục tính năng hệ thống
        f"""
        CREATE TABLE IF NOT EXISTS system_features (
            feature_key VARCHAR(50) PRIMARY KEY,
            feature_name VARCHAR(150) NOT NULL,
            description TEXT,
            order_index INTEGER DEFAULT 0,
            is_active BOOLEAN DEFAULT {bool_true},
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        # 2. Bảng cấp phép bản quyền tính năng độc lập cho từng User
        f"""
        CREATE TABLE IF NOT EXISTS user_feature_licenses (
            id {pk},
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            feature_key VARCHAR(50) NOT NULL REFERENCES system_features(feature_key),
            is_enabled BOOLEAN DEFAULT {bool_true},
            days_granted INTEGER DEFAULT 0,
            expired_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, feature_key)
        )
        """,
    ]
    for stmt in statements:
        db.execute(stmt)

    # Seed 11 tính năng vào bảng system_features
    seed_system_features()
