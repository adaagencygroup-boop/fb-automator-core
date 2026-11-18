from __future__ import annotations
import os
import re
import threading
from typing import Optional
from urllib.parse import quote
import psycopg2
from core.database.connection import db
_BUCKET = re.compile(r"^[a-z0-9][a-z0-9_-]{0,60}$")
_ready = False
_lock = threading.Lock()
def ensure_schema() -> None:
  global _ready
  if _ready:
    return
  with _lock:
    if _ready:
      return
    db.execute(
      """
            CREATE TABLE IF NOT EXISTS stored_objects (
                id BIGSERIAL PRIMARY KEY,
                bucket VARCHAR(80) NOT NULL,
                object_path TEXT NOT NULL,
                content_type VARCHAR(160),
                size_bytes BIGINT NOT NULL DEFAULT 0,
                data BYTEA NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (bucket, object_path)
            )
            """
    )
    _ready = True
def clean_bucket(bucket: str) -> str:
  name = (bucket or "").strip().lower()
  if not _BUCKET.fullmatch(name):
    raise ValueError("Tên kho file không hợp lệ")
  return name
def clean_path(object_path: str) -> str:
  parts = []
  for part in (object_path or "").replace("\\", "/").split("/"):
    if not part or part in (".", ".."):
      continue
    parts.append(part)
  if not parts:
    raise ValueError("Đường dẫn file trống")
  return "/".join(parts)
def put_object(bucket: str, object_path: str, data: bytes, content_type: Optional[str] = None) -> dict:
  ensure_schema()
  name = clean_bucket(bucket)
  path = clean_path(object_path)
  payload = bytes(data or b"")
  db.execute(
    """
        INSERT INTO stored_objects (bucket, object_path, content_type, size_bytes, data)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (bucket, object_path) DO UPDATE
        SET content_type = EXCLUDED.content_type,
            size_bytes = EXCLUDED.size_bytes,
            data = EXCLUDED.data,
            created_at = CURRENT_TIMESTAMP
        """,
    (name, path, content_type or "application/octet-stream", len(payload), psycopg2.Binary(payload)),
  )
  return {
    "bucket": name,
    "path": path,
    "size": len(payload),
    "url": pg_url(name, path),
    "http_url": http_media_url(name, path),
  }
def read_object(bucket: str, object_path: str) -> Optional[dict]:
  ensure_schema()
  try:
    name = clean_bucket(bucket)
    path = clean_path(object_path)
  except ValueError:
    return None
  row = db.fetch_one(
    "SELECT content_type, size_bytes, data FROM stored_objects WHERE bucket = ? AND object_path = ?",
    (name, path),
  )
  if not row:
    return None
  raw = row.get("data")
  return {
    "bucket": name,
    "path": path,
    "content_type": row.get("content_type") or "application/octet-stream",
    "size": row.get("size_bytes") or 0,
    "data": bytes(raw) if raw is not None else b"",
  }
def list_objects(bucket: str, prefix: str = "") -> list[dict]:
  ensure_schema()
  name = clean_bucket(bucket)
  folder = clean_path(prefix).rstrip("/") + "/" if prefix else ""
  rows = db.fetch_all(
    """
        SELECT object_path, content_type, size_bytes, created_at
        FROM stored_objects
        WHERE bucket = ? AND object_path LIKE ?
        ORDER BY created_at DESC
        LIMIT 100
        """,
    (name, folder + "%"),
  )
  items = []
  for row in rows:
    path = row["object_path"]
    items.append({
      "name": path.rsplit("/", 1)[-1],
      "path": path,
      "content_type": row.get("content_type"),
      "size": row.get("size_bytes") or 0,
      "created_at": row.get("created_at"),
      "url": pg_url(name, path),
      "http_url": http_media_url(name, path),
    })
  return items
def delete_object(bucket: str, object_path: str) -> None:
  ensure_schema()
  db.execute(
    "DELETE FROM stored_objects WHERE bucket = ? AND object_path = ?",
    (clean_bucket(bucket), clean_path(object_path)),
  )
def pg_url(bucket: str, object_path: str) -> str:
  return f"pg://{clean_bucket(bucket)}/{clean_path(object_path)}"
def parse_pg_url(url: str) -> Optional[tuple[str, str]]:
  raw = (url or "").strip()
  if not raw.startswith("pg://"):
    return None
  rest = raw[len("pg://"):]
  bucket, _, path = rest.partition("/")
  if not bucket or not path:
    return None
  return clean_bucket(bucket), clean_path(path)
def http_media_url(bucket: str, object_path: str) -> str:
  rel = "/media/" + clean_bucket(bucket) + "/" + quote(clean_path(object_path), safe="/")
  base = (os.getenv("PUBLIC_MEDIA_BASE_URL") or "").strip().rstrip("/")
  if base:
    return base + rel
  return "http://127.0.0.1:28129" + rel