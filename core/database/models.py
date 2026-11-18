from core.database.connection import db
from core.startup import startup_step
CORE_DDL_STATEMENTS = [
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
  """
    CREATE TABLE IF NOT EXISTS system_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT,
        description VARCHAR(255),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """,
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
  for stmt in CORE_DDL_STATEMENTS:
    try:
      clean_stmt = stmt if db._is_postgres else stmt.replace("SERIAL PRIMARY KEY", "INTEGER PRIMARY KEY AUTOINCREMENT")
      db.execute(clean_stmt)
    except Exception as e:
      print(f"[Core DB Error] {e}")
def init_database():
  print("[Database] Initializing Core & Admin tables (users, system_settings, activity_logs)...")
  with startup_step("Core tables"):
    init_core_tables()
  try:
    from modules.module_05_page_manager.models import init_models as init_module_05
    with startup_step("Module 05 schema"):
      init_module_05()
    print("[Database] Initialized DB schema for Module 05 (Page Manager).")
  except Exception as e:
    print(f"[Database] Notice initializing Module 05 DB: {e}")
  try:
    from modules.module_03_acc_farm.models import init_models as init_module_03
    with startup_step("Module 03 schema"):
      init_module_03()
    print("[Database] Initialized DB schema for Module 03 (Acc Farm - Tab 1).")
  except Exception as e:
    print(f"[Database] Notice initializing Module 03 DB: {e}")