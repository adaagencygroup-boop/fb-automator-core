"""
Thread-safe Database Connection Manager
Primary: Supabase PostgreSQL (ThreadedConnectionPool + RealDictCursor)
Fallback: Local SQLite (WAL Mode) nếu ngoại tuyến không có mạng
"""
import os
import re
import threading
import psycopg2
from psycopg2 import pool
from psycopg2.extras import RealDictCursor
from contextlib import contextmanager
from typing import Generator, List, Dict, Any, Optional

from config.constants import DATABASE_URL, DB_PATH

class DatabaseManager:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(DatabaseManager, cls).__new__(cls)
                cls._instance._pg_pool = None
                cls._instance._is_postgres = False
                cls._instance._init_database()
        return cls._instance

    def _init_database(self):
        """Khởi tạo kết nối với Supabase PostgreSQL qua connection pool"""
        if DATABASE_URL:
            try:
                # Tạo ThreadedConnectionPool (min 1, max 20 connections)
                self._pg_pool = pool.ThreadedConnectionPool(
                    minconn=1,
                    maxconn=20,
                    dsn=DATABASE_URL
                )
                self._is_postgres = True
                print("[Database] Connected successfully to Supabase PostgreSQL!")
                return
            except Exception as e:
                print(f"[Database] Could not connect to Supabase ({e}), falling back to SQLite.")

        # Fallback sang SQLite
        self._is_postgres = False
        self._local = threading.local()

    def _normalize_query(self, query: str) -> str:
        """
        Chuẩn hóa câu lệnh SQL:
        - Chuyển dấu ? sang %s nếu dùng PostgreSQL
        - Chuyển hàm ngày SQLite date('now') sang CURRENT_DATE
        - Chuyển datetime('now', 'localtime') sang NOW()
        """
        if self._is_postgres:
            q = query.replace("?", "%s")
            q = re.sub(r"date\('now'\)", "CURRENT_DATE", q, flags=re.IGNORECASE)
            q = re.sub(r"datetime\('now',\s*'localtime'\)", "NOW()", q, flags=re.IGNORECASE)
            q = re.sub(r"datetime\('now'\)", "NOW()", q, flags=re.IGNORECASE)
            return q
        return query

    @contextmanager
    def session(self) -> Generator[Any, None, None]:
        """Context manager cấp phát cursor và tự động commit / rollback"""
        if self._is_postgres and self._pg_pool:
            conn = self._pg_pool.getconn()
            try:
                cursor = conn.cursor(cursor_factory=RealDictCursor)
                yield cursor
                conn.commit()
                cursor.close()
            except Exception as e:
                conn.rollback()
                raise e
            finally:
                self._pg_pool.putconn(conn)
        else:
            # SQLite fallback
            import sqlite3
            if not hasattr(self._local, "connection") or self._local.connection is None:
                c = sqlite3.connect(DB_PATH, timeout=30.0)
                c.row_factory = sqlite3.Row
                self._local.connection = c
            conn = self._local.connection
            cursor = conn.cursor()
            try:
                yield cursor
                conn.commit()
            except Exception as e:
                conn.rollback()
                raise e

    def execute(self, query: str, params: tuple = ()) -> Any:
        norm_q = self._normalize_query(query)
        with self.session() as cursor:
            cursor.execute(norm_q, params)
            return cursor

    def fetch_all(self, query: str, params: tuple = ()) -> List[Dict[str, Any]]:
        norm_q = self._normalize_query(query)
        with self.session() as cursor:
            cursor.execute(norm_q, params)
            rows = cursor.fetchall()
            return [dict(r) for r in rows]

    def fetch_one(self, query: str, params: tuple = ()) -> Optional[Dict[str, Any]]:
        norm_q = self._normalize_query(query)
        with self.session() as cursor:
            cursor.execute(norm_q, params)
            row = cursor.fetchone()
            return dict(row) if row else None

    @property
    def is_postgres(self) -> bool:
        return self._is_postgres

db = DatabaseManager()
