import re
import threading
import psycopg2
from psycopg2 import pool
from psycopg2.extras import RealDictCursor
from contextlib import contextmanager
from typing import Generator, List, Dict, Any, Optional
from config.constants import DATABASE_URL
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
    if not DATABASE_URL or DATABASE_URL.startswith("sqlite"):
      raise RuntimeError("DATABASE_URL phải là PostgreSQL production. Không dùng SQLite local.")
    try:
      self._pg_pool = pool.ThreadedConnectionPool(
        minconn=1,
        maxconn=60,
        dsn=DATABASE_URL,
        connect_timeout=10,
      )
      self._is_postgres = True
      print("[Database] Connected successfully to PostgreSQL!")
    except Exception as e:
      raise RuntimeError(f"Không kết nối được PostgreSQL production: {e}") from e
  def _normalize_query(self, query: str) -> str:
    if self._is_postgres:
      q = re.sub(r"('(?:''|[^'])*')|\?", lambda m: m.group(1) if m.group(1) else "%s", query)
      q = re.sub(r"date\('now'\)", "CURRENT_DATE", q, flags=re.IGNORECASE)
      q = re.sub(r"datetime\('now',\s*'localtime'\)", "NOW()", q, flags=re.IGNORECASE)
      q = re.sub(r"datetime\('now'\)", "NOW()", q, flags=re.IGNORECASE)
      return q
    return query
  @contextmanager
  def session(self) -> Generator[Any, None, None]:
    if not self._is_postgres or not self._pg_pool:
      raise RuntimeError("Chưa có kết nối PostgreSQL production.")
    conn = self._pg_pool.getconn()
    cursor = None
    try:
      cursor = conn.cursor(cursor_factory=RealDictCursor)
      yield cursor
      conn.commit()
    except Exception as e:
      conn.rollback()
      raise e
    finally:
      try:
        if cursor is not None:
          cursor.close()
      finally:
        self._pg_pool.putconn(conn)
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