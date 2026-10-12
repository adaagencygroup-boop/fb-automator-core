"""
=============================================================================
CORE DATABASE SCHEMA & SYSTEM MODELS (Admin & Shared Platform)
Chỉ chứa các bảng dùng chung toàn hệ thống liên quan đến User, Admin, 
Cấu hình hệ thống và Nhật ký hoạt động chung.
=============================================================================
"""
from core.database.connection import db

# 1. BẢNG DÙNG CHUNG CỐT LÕI (Users, Admin, Settings, Logs)
CORE_DDL_STATEMENTS = [
    # Bảng Quản trị viên & Người dùng hệ thống (Admin & Users)
    """
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(150),
        email VARCHAR(150),
        role VARCHAR(20) DEFAULT 'ADMIN', -- 'ADMIN', 'MEMBER'
        status VARCHAR(20) DEFAULT 'ACTIVE', -- 'ACTIVE', 'BLOCKED'
        last_login TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """,

    # Bảng Cấu hình hệ thống chung (Global System Settings)
    """
    CREATE TABLE IF NOT EXISTS system_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT,
        description VARCHAR(255),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """,

    # Bảng Nhật ký sự kiện toàn hệ thống (Real-time Activity Logs)
    """
    CREATE TABLE IF NOT EXISTS activity_logs (
        id SERIAL PRIMARY KEY,
        module VARCHAR(50) NOT NULL,
        level VARCHAR(20) DEFAULT 'INFO',
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """
]

def init_core_tables():
    """Khởi tạo các bảng dùng chung (Admin, Users, Settings, Logs)"""
    for stmt in CORE_DDL_STATEMENTS:
        try:
            clean_stmt = stmt if db._is_postgres else stmt.replace("SERIAL PRIMARY KEY", "INTEGER PRIMARY KEY AUTOINCREMENT")
            db.execute(clean_stmt)
        except Exception as e:
            print(f"[Core DB Error] {e}")


def init_database():
    """
    Khởi tạo CSDL:
    1. Tạo bảng cốt lõi (Admin/Users/Settings/Logs)
    2. Khởi tạo riêng schema cho Module 5 (Page Manager)
    """
    print("[Database] Initializing Core & Admin tables (users, system_settings, activity_logs)...")
    init_core_tables()

    # Chỉ khởi tạo cho Module 5 (Page Manager)
    try:
        from modules.module_05_page_manager.models import init_models as init_module_05
        init_module_05()
        print("[Database] Initialized DB schema for Module 05 (Page Manager).")
    except Exception as e:
        print(f"[Database] Notice initializing Module 05 DB: {e}")

    try:
        from modules.module_03_acc_farm.models import init_models as init_module_03
        init_module_03()
        print("[Database] Initialized DB schema for Module 03 (Acc Farm - Tab 1).")
    except Exception as e:
        print(f"[Database] Notice initializing Module 03 DB: {e}")
