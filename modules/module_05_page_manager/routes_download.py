import os
import sys
import re
import json
import threading
from pathlib import Path
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from core.database.connection import db
from .runner import (
  is_job_running,
  mark_job_running,
  stop_job,
  run_tiktok_download_task,
  run_youtube_download_task,
)

_picker_lock = threading.Lock()
router = APIRouter(prefix="/pages", tags=["Module 05: Media & Downloads"])
class TikTokDownloadRequest(BaseModel):
  download_folder: str = ""
  delay_sec: int = 2
  max_videos: int = 5
  concurrency: int = 3
  items: List[Dict[str, Any]] = []
class YouTubeDownloadRequest(BaseModel):
  download_folder: str = ""
  delay_sec: int = 2
  max_videos: int = 5
  concurrency: int = 3
  items: List[Dict[str, Any]] = []
class SelectFolderRequest(BaseModel):
  initial_dir: Optional[str] = None
class UpdatePageKeywordsRequest(BaseModel):
  tiktok_keyword: Optional[str] = None
  tiktok_url: Optional[str] = None
  youtube_keyword: Optional[str] = None
  youtube_url: Optional[str] = None
class BulkKeywordsRequest(BaseModel):
  keyword: str
  source: str = "TIKTOK"
  url: Optional[str] = None
class ToolConfigRequest(BaseModel):
  tool: str = "tiktok"
  config: Dict[str, Any] = {}
def ensure_page_activity_table():
  try:
    db.execute("""
      CREATE TABLE IF NOT EXISTS page_activity_logs (
        id SERIAL PRIMARY KEY,
        page_id VARCHAR(100),
        page_name VARCHAR(255),
        action_type VARCHAR(50) NOT NULL,
        title TEXT,
        details TEXT,
        object_path TEXT,
        status VARCHAR(50) DEFAULT 'SUCCESS',
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    """)
  except Exception:
    pass
def log_page_activity(page_id: str, page_name: str, action_type: str, title: str, details: str = "", object_path: str = "", status: str = "SUCCESS", error_message: str = ""):
  ensure_page_activity_table()
  try:
    db.execute(
      """INSERT INTO page_activity_logs (page_id, page_name, action_type, title, details, object_path, status, error_message, created_at)
      VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())""",
      (page_id, page_name, action_type, title, details, object_path, status, error_message)
    )
  except Exception:
    pass
def check_folder_has_page_videos(folder_path: str):
  if not folder_path:
    return False, 0
  target = folder_path.strip()
  if not os.path.isabs(target):
    from config.constants import BASE_DIR
    target = os.path.join(str(BASE_DIR), target)
  if not os.path.exists(target) or not os.path.isdir(target):
    return False, 0
  norm = target.replace("\\", "/").rstrip("/")
  try:
    row = db.fetch_one("SELECT COUNT(*) as c FROM downloaded_videos WHERE object_path LIKE %s OR object_path LIKE %s", (f"{norm}/%", f"{norm.replace('/', os.sep)}{os.sep}%"))
    if row and row.get("c", 0) > 0:
      return True, int(row["c"])
  except Exception:
    pass
  try:
    pages = db.fetch_all("SELECT page_id, page_name FROM pages") or []
    count = 0
    checked_dirs = set()
    for p in pages:
      p_id = str(p.get("page_id") or "").strip()
      p_name = str(p.get("page_name") or "").strip()
      safe_name = re.sub(r'[\\/*?:"<>|]', "", p_name).strip()
      names = []
      if safe_name:
        names.append(safe_name)
      if p_id:
        names.append(f"Page_{p_id}")
        names.append(p_id)
      for n in names:
        p_dir = os.path.join(target, n)
        if p_dir in checked_dirs:
          continue
        checked_dirs.add(p_dir)
        if os.path.isdir(p_dir):
          try:
            for f in os.listdir(p_dir):
              if f.lower().endswith((".mp4", ".mkv", ".mov", ".webm", ".avi", ".part")):
                count += 1
          except Exception:
            pass
    if count > 0:
      return True, count
  except Exception:
    pass
  return False, 0
def read_persistent_tiktok_config() -> Dict[str, Any]:
  from config.constants import TIKTOK_CONFIG_PATH, TIKTOK_CONFIG_INI_PATH
  cfg = {"download_folder": "", "max_videos": 5}
  if TIKTOK_CONFIG_PATH.exists():
    try:
      with open(TIKTOK_CONFIG_PATH, "r", encoding="utf-8") as f:
        loaded = json.load(f)
        if isinstance(loaded, dict):
          if loaded.get("download_folder") and str(loaded["download_folder"]).strip():
            cfg["download_folder"] = str(loaded["download_folder"]).strip()
          if "max_videos" in loaded:
            cfg["max_videos"] = int(loaded["max_videos"])
    except Exception:
      pass
  if TIKTOK_CONFIG_INI_PATH.exists():
    try:
      import configparser
      cp = configparser.ConfigParser()
      cp.read(str(TIKTOK_CONFIG_INI_PATH), encoding="utf-8")
      if "TikTok" in cp:
        if cp["TikTok"].get("download_folder") and cp["TikTok"]["download_folder"].strip():
          cfg["download_folder"] = cp["TikTok"]["download_folder"].strip()
        if "max_videos" in cp["TikTok"]:
          cfg["max_videos"] = int(cp["TikTok"]["max_videos"])
    except Exception:
      pass
  return cfg
def write_persistent_tiktok_config(cfg: Dict[str, Any]):
  from config.constants import TIKTOK_CONFIG_PATH, TIKTOK_CONFIG_INI_PATH
  folder_val = str(cfg.get("download_folder", "")).strip()
  payload = {
    "download_folder": folder_val,
    "max_videos": int(cfg.get("max_videos", 5))
  }
  try:
    with open(TIKTOK_CONFIG_PATH, "w", encoding="utf-8") as f:
      json.dump(payload, f, ensure_ascii=False, indent=2)
  except Exception:
    pass
  try:
    import configparser
    cp = configparser.ConfigParser()
    cp["TikTok"] = {
      "download_folder": payload["download_folder"],
      "max_videos": str(payload["max_videos"])
    }
    with open(TIKTOK_CONFIG_INI_PATH, "w", encoding="utf-8") as f:
      cp.write(f)
  except Exception:
    pass
def read_persistent_youtube_config() -> Dict[str, Any]:
  from config.constants import YOUTUBE_CONFIG_PATH, YOUTUBE_CONFIG_INI_PATH
  cfg = {"download_folder": "", "max_videos": 5}
  if YOUTUBE_CONFIG_PATH.exists():
    try:
      with open(YOUTUBE_CONFIG_PATH, "r", encoding="utf-8") as f:
        loaded = json.load(f)
        if isinstance(loaded, dict):
          if loaded.get("download_folder") and str(loaded["download_folder"]).strip():
            cfg["download_folder"] = str(loaded["download_folder"]).strip()
          if "max_videos" in loaded:
            cfg["max_videos"] = int(loaded["max_videos"])
    except Exception:
      pass
  if YOUTUBE_CONFIG_INI_PATH.exists():
    try:
      import configparser
      cp = configparser.ConfigParser()
      cp.read(str(YOUTUBE_CONFIG_INI_PATH), encoding="utf-8")
      if "YouTube" in cp:
        if cp["YouTube"].get("download_folder") and cp["YouTube"]["download_folder"].strip():
          cfg["download_folder"] = cp["YouTube"]["download_folder"].strip()
        if "max_videos" in cp["YouTube"]:
          cfg["max_videos"] = int(cp["YouTube"]["max_videos"])
    except Exception:
      pass
  return cfg
def write_persistent_youtube_config(cfg: Dict[str, Any]):
  from config.constants import YOUTUBE_CONFIG_PATH, YOUTUBE_CONFIG_INI_PATH
  folder_val = str(cfg.get("download_folder", "")).strip()
  payload = {
    "download_folder": folder_val,
    "max_videos": int(cfg.get("max_videos", 5))
  }
  try:
    with open(YOUTUBE_CONFIG_PATH, "w", encoding="utf-8") as f:
      json.dump(payload, f, ensure_ascii=False, indent=2)
  except Exception:
    pass
  try:
    import configparser
    cp = configparser.ConfigParser()
    cp["YouTube"] = {
      "download_folder": payload["download_folder"],
      "max_videos": str(payload["max_videos"])
    }
    with open(YOUTUBE_CONFIG_INI_PATH, "w", encoding="utf-8") as f:
      cp.write(f)
  except Exception:
    pass
@router.get("/history/stats")
def get_history_stats():
  ensure_page_activity_table()
  ai_tot = db.fetch_one("SELECT COUNT(*) as c FROM posting_history WHERE post_type = 'AI'")
  ai_succ = db.fetch_one("SELECT COUNT(*) as c FROM posting_history WHERE post_type = 'AI' AND status = 'SUCCESS'")
  reel_tot = db.fetch_one("SELECT COUNT(*) as c FROM posting_history WHERE post_type = 'REEL' OR post_type = 'REELS'")
  reel_succ = db.fetch_one("SELECT COUNT(*) as c FROM posting_history WHERE (post_type = 'REEL' OR post_type = 'REELS') AND status = 'SUCCESS'")
  tt_tot = db.fetch_one("SELECT COUNT(*) as c FROM download_logs WHERE source = 'TIKTOK'")
  tt_succ = db.fetch_one("SELECT COUNT(*) as c FROM download_logs WHERE source = 'TIKTOK' AND status = 'SUCCESS'")
  yt_tot = db.fetch_one("SELECT COUNT(*) as c FROM download_logs WHERE source = 'YOUTUBE'")
  yt_succ = db.fetch_one("SELECT COUNT(*) as c FROM download_logs WHERE source = 'YOUTUBE' AND status = 'SUCCESS'")
  del_tot = db.fetch_one("SELECT COUNT(*) as c FROM page_activity_logs WHERE action_type = 'DELETE'")
  del_succ = db.fetch_one("SELECT COUNT(*) as c FROM page_activity_logs WHERE action_type = 'DELETE' AND status = 'SUCCESS'")
  ai_t = ai_tot["c"] if ai_tot else 0
  ai_s = ai_succ["c"] if ai_succ else 0
  reel_t = reel_tot["c"] if reel_tot else 0
  reel_s = reel_succ["c"] if reel_succ else 0
  tt_t = tt_tot["c"] if tt_tot else 0
  tt_s = tt_succ["c"] if tt_succ else 0
  yt_t = yt_tot["c"] if yt_tot else 0
  yt_s = yt_succ["c"] if yt_succ else 0
  del_t = del_tot["c"] if del_tot else 0
  del_s = del_succ["c"] if del_succ else 0
  total_all = ai_t + reel_t + tt_t + yt_t + del_t
  return {
    "total": total_all,
    "ai": {"total": ai_t, "success": ai_s, "failed": max(0, ai_t - ai_s)},
    "reels": {"total": reel_t, "success": reel_s, "failed": max(0, reel_t - reel_s)},
    "tiktok": {"total": tt_t, "success": tt_s, "failed": max(0, tt_t - tt_s)},
    "youtube": {"total": yt_t, "success": yt_s, "failed": max(0, yt_t - yt_s)},
    "delete": {"total": del_t, "success": del_s, "failed": max(0, del_t - del_s)}
  }
@router.get("/history/terminal-logs")
def get_terminal_logs(filter_type: Optional[str] = None, lines: int = 300):
  from config.constants import BASE_DIR
  log_file = BASE_DIR / "logs" / "engine.log"
  if not log_file.exists():
    return {"success": True, "lines": [], "full_text": "", "total_lines": 0}
  try:
    content = log_file.read_text(encoding="utf-8", errors="replace")
    all_lines = [l for l in content.splitlines() if l.strip()]
    f = (filter_type or "").upper().strip()
    if f and f != "ALL":
      if f == "TIKTOK":
        all_lines = [l for l in all_lines if any(k in l.lower() for k in ["tiktok", "tik", "video_id"])]
      elif f == "YOUTUBE":
        all_lines = [l for l in all_lines if any(k in l.lower() for k in ["youtube", "shorts", "ytsearch", "yt-dlp", "ydl"])]
      elif f in ("FACEBOOK", "FB", "AI", "REEL", "REELS"):
        all_lines = [l for l in all_lines if any(k in l.lower() for k in ["facebook", "post_feed", "upload_reel", "gemini", "ai"])]
    selected = all_lines[-lines:] if len(all_lines) > lines else all_lines
    return {
      "success": True,
      "lines": selected,
      "full_text": "\n".join(selected),
      "total_lines": len(selected)
    }
  except Exception as e:
    return {"success": False, "lines": [str(e)], "full_text": str(e), "total_lines": 1}
@router.get("/history")
def get_history_list(post_type: Optional[str] = None, status: Optional[str] = None, search: Optional[str] = None, limit: int = 200, offset: int = 0):
  ensure_page_activity_table()
  p_type = post_type.upper().strip() if post_type else None
  st_filter = status.upper().strip() if status else None
  queries = []
  params = []
  if not p_type or p_type == "ALL" or p_type in ("TIKTOK", "YOUTUBE"):
    q1 = "SELECT l.id::text as id, l.page_id::text as page_id, l.source as post_type, coalesce(l.title, '') as title, coalesce(l.video_id, '') as caption, coalesce(l.object_path, '') as object_path, l.status, coalesce(l.error_message, '') as error_message, l.created_at as posted_at, coalesce(p.page_name, 'Fanpage') as page_name, coalesce(p.account_uid, '') as account_uid, coalesce((SELECT profile_name FROM accounts WHERE uid = p.account_uid LIMIT 1), '') as account_name FROM download_logs l LEFT JOIN LATERAL (SELECT page_name, account_uid FROM pages WHERE page_id = l.page_id OR id::text = l.page_id LIMIT 1) p ON true WHERE 1=1"
    if p_type in ("TIKTOK", "YOUTUBE"):
      q1 += " AND l.source = %s"
      params.append(p_type)
    if st_filter and st_filter != "ALL":
      q1 += " AND l.status = %s"
      params.append(st_filter)
    queries.append(q1)
  if not p_type or p_type == "ALL" or p_type in ("AI", "REEL", "REELS"):
    q2 = "SELECT h.id::text as id, h.page_id::text as page_id, h.post_type, coalesce(h.title, '') as title, coalesce(h.caption, '') as caption, coalesce(h.media_path, h.post_url, '') as object_path, h.status, coalesce(h.error_message, '') as error_message, h.posted_at, coalesce(p.page_name, 'Fanpage') as page_name, coalesce(h.account_uid, p.account_uid, '') as account_uid, coalesce((SELECT profile_name FROM accounts WHERE uid = coalesce(h.account_uid, p.account_uid) LIMIT 1), '') as account_name FROM posting_history h LEFT JOIN LATERAL (SELECT page_name, account_uid FROM pages WHERE page_id = h.page_id OR id::text = h.page_id LIMIT 1) p ON true WHERE 1=1"
    if p_type in ("AI", "REEL", "REELS"):
      target_type = "REEL" if "REEL" in p_type else "AI"
      q2 += " AND (h.post_type = %s OR h.post_type = %s)"
      params.extend([target_type, f"{target_type}S"])
    if st_filter and st_filter != "ALL":
      q2 += " AND h.status = %s"
      params.append(st_filter)
    queries.append(q2)
  if not p_type or p_type == "ALL" or p_type == "DELETE":
    q3 = "SELECT a.id::text as id, a.page_id::text as page_id, a.action_type as post_type, coalesce(a.title, '') as title, coalesce(a.details, '') as caption, coalesce(a.object_path, '') as object_path, a.status, coalesce(a.error_message, '') as error_message, a.created_at as posted_at, coalesce(a.page_name, 'Fanpage') as page_name, '' as account_uid, '' as account_name FROM page_activity_logs a WHERE 1=1"
    if p_type == "DELETE":
      q3 += " AND a.action_type = 'DELETE'"
    if st_filter and st_filter != "ALL":
      q3 += " AND a.status = %s"
      params.append(st_filter)
    queries.append(q3)
  if not queries:
    return {"history": []}
  full_union = " UNION ALL ".join(queries)
  final_query = f"SELECT * FROM ({full_union}) u WHERE 1=1"
  final_params = list(params)
  if search:
    final_query += " AND (lower(u.title) LIKE lower(%s) OR lower(u.page_name) LIKE lower(%s) OR lower(u.caption) LIKE lower(%s))"
    final_params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])
  final_query += " ORDER BY u.posted_at DESC LIMIT %s OFFSET %s"
  final_params.extend([limit, offset])
  rows = db.fetch_all(final_query, tuple(final_params))
  return {"history": rows or []}
@router.get("/history/{page_id}")
def get_page_history_detail(page_id: str, source: Optional[str] = None):
  ensure_page_activity_table()
  s = source.upper().strip() if source else None
  if s in ("TIKTOK", "YOUTUBE"):
    rows = db.fetch_all("SELECT id::text as id, page_id, source as post_type, video_id, title, object_path, status, error_message, created_at as posted_at FROM download_logs WHERE (page_id = %s OR page_id = (SELECT page_id FROM pages WHERE id::text = %s LIMIT 1)) AND source = %s ORDER BY id DESC LIMIT 100", (page_id, page_id, s))
  elif s in ("AI", "REEL", "REELS"):
    target = "REEL" if "REEL" in s else "AI"
    rows = db.fetch_all("SELECT id::text as id, page_id, post_type, title, caption, media_path as object_path, status, error_message, posted_at FROM posting_history WHERE (page_id = %s OR page_id = (SELECT page_id FROM pages WHERE id::text = %s LIMIT 1)) AND (post_type = %s OR post_type = %s) ORDER BY id DESC LIMIT 100", (page_id, page_id, target, f"{target}S"))
  elif s == "DELETE":
    rows = db.fetch_all("SELECT id::text as id, page_id, action_type as post_type, title, details as caption, object_path, status, error_message, created_at as posted_at FROM page_activity_logs WHERE (page_id = %s OR page_id = (SELECT page_id FROM pages WHERE id::text = %s LIMIT 1)) AND action_type = 'DELETE' ORDER BY id DESC LIMIT 100", (page_id, page_id))
  else:
    rows = db.fetch_all("""
      SELECT * FROM (
        SELECT id::text as id, page_id, source as post_type, title, video_id as caption, object_path, status, error_message, created_at as posted_at FROM download_logs WHERE (page_id = %s OR page_id = (SELECT page_id FROM pages WHERE id::text = %s LIMIT 1))
        UNION ALL
        SELECT id::text as id, page_id, post_type, title, caption, media_path as object_path, status, error_message, posted_at FROM posting_history WHERE (page_id = %s OR page_id = (SELECT page_id FROM pages WHERE id::text = %s LIMIT 1))
        UNION ALL
        SELECT id::text as id, page_id, action_type as post_type, title, details as caption, object_path, status, error_message, created_at as posted_at FROM page_activity_logs WHERE (page_id = %s OR page_id = (SELECT page_id FROM pages WHERE id::text = %s LIMIT 1))
      ) u ORDER BY u.posted_at DESC LIMIT 100
    """, (page_id, page_id, page_id, page_id, page_id, page_id))
  return {"page_id": page_id, "items": rows or []}
@router.get("/video-stream")
def stream_video(path: Optional[str] = None, video_id: Optional[int] = None):
  import mimetypes
  real_path = ""
  if path and path.strip():
    real_path = path.strip()
  elif video_id:
    row = db.fetch_one("SELECT object_path FROM downloaded_videos WHERE id = %s", (video_id,))
    if row and row.get("object_path"):
      real_path = row["object_path"]
  if not real_path:
    raise HTTPException(status_code=400, detail="Thiếu Đường Dẫn Video")
  p = Path(os.path.normpath(real_path))
  if not p.is_absolute():
    from config.constants import BASE_DIR
    p = BASE_DIR / p
  if not p.exists() or not p.is_file():
    raise HTTPException(status_code=404, detail="Không Tìm Thấy Tệp Video Trên Ổ Đĩa")
  mt = mimetypes.guess_type(str(p))[0] or "video/mp4"
  return FileResponse(str(p), media_type=mt, content_disposition_type="inline")
@router.delete("/all-videos")
def clear_all_downloaded_videos(source: Optional[str] = None, folder: Optional[str] = None):
  query = "SELECT object_path FROM downloaded_videos"
  params = []
  if source:
    query += " WHERE upper(source) = %s"
    params.append(source.upper())
  rows = db.fetch_all(query, tuple(params))
  deleted_count = 0
  parent_dirs = set()
  for r in rows:
    p = r.get("object_path")
    if p:
      norm_p = os.path.normpath(p)
      parent_dirs.add(os.path.dirname(norm_p))
      if os.path.exists(norm_p):
        try:
          os.remove(norm_p)
          deleted_count += 1
        except Exception:
          pass
      txt_p = os.path.splitext(norm_p)[0] + ".txt"
      if os.path.exists(txt_p):
        try:
          os.remove(txt_p)
        except Exception:
          pass
  for pdir in parent_dirs:
    if pdir and os.path.exists(pdir) and os.path.isdir(pdir):
      try:
        has_other = any(f.lower().endswith((".mp4", ".txt", ".part")) for f in os.listdir(pdir))
        if not has_other or not os.listdir(pdir):
          for f in os.listdir(pdir):
            fp = os.path.join(pdir, f)
            if os.path.isfile(fp):
              try:
                os.remove(fp)
              except Exception:
                pass
          if not os.listdir(pdir):
            os.rmdir(pdir)
      except Exception:
        pass
  if folder and folder.strip():
    target_f = folder.strip()
    if not os.path.isabs(target_f):
      from config.constants import BASE_DIR
      target_f = os.path.join(str(BASE_DIR), target_f)
    if os.path.exists(target_f) and os.path.isdir(target_f):
      try:
        pages = db.fetch_all("SELECT page_id, page_name FROM pages") or []
        for p in pages:
          p_id = str(p.get("page_id") or "").strip()
          p_name = str(p.get("page_name") or "").strip()
          safe_name = re.sub(r'[\\/*?:"<>|]', "", p_name).strip()
          names = []
          if safe_name:
            names.append(safe_name)
          if p_id:
            names.append(f"Page_{p_id}")
            names.append(p_id)
          for n in names:
            p_dir = os.path.join(target_f, n)
            if os.path.isdir(p_dir):
              try:
                for f in os.listdir(p_dir):
                  if f.lower().endswith((".mp4", ".mkv", ".mov", ".webm", ".avi", ".part", ".txt")):
                    try:
                      os.remove(os.path.join(p_dir, f))
                      deleted_count += 1
                    except Exception:
                      pass
                if not os.listdir(p_dir):
                  os.rmdir(p_dir)
              except Exception:
                pass
      except Exception:
        pass
  del_query = "DELETE FROM downloaded_videos"
  del_params = []
  if source:
    del_query += " WHERE upper(source) = %s"
    del_params.append(source.upper())
  db.execute(del_query, tuple(del_params))
  db.execute("UPDATE page_job_items SET status = 'PENDING', message = ''")
  log_page_activity(page_id="ALL", page_name="Toàn Bộ Fanpage", action_type="DELETE", title=f"Đã Xóa Toàn Bộ {deleted_count} Video Của Hệ Thống", details=f"Đã Dọn Dẹp {deleted_count} Tệp Video Khỏi Hệ Thống", status="SUCCESS")
  return {"success": True, "deleted_count": deleted_count, "message": "Đã Xóa Toàn Bộ Video & Dữ Liệu Đã Tải"}
@router.put("/{page_id}/keywords")
def update_page_keywords(page_id: str, req: UpdatePageKeywordsRequest):
  updates = []
  params = []
  if req.tiktok_keyword is not None:
    updates.append("tiktok_keyword = %s")
    params.append(req.tiktok_keyword.strip())
  if req.tiktok_url is not None:
    updates.append("tiktok_url = %s")
    params.append(req.tiktok_url.strip())
  if req.youtube_keyword is not None:
    updates.append("youtube_keyword = %s")
    params.append(req.youtube_keyword.strip())
  if req.youtube_url is not None:
    updates.append("youtube_url = %s")
    params.append(req.youtube_url.strip())
  if not updates:
    return {"success": True}
  params.extend([page_id, page_id])
  query = f"UPDATE pages SET {', '.join(updates)}, updated_at = NOW() WHERE page_id = %s OR id::text = %s"
  try:
    db.execute(query, tuple(params))
  except Exception as e:
    return {"success": False, "error": str(e)}
  return {"success": True}
@router.post("/bulk-keywords")
def bulk_update_keywords(req: BulkKeywordsRequest, request: Request):
  from modules.module_02_account_manager.context import owner_context
  owner = owner_context.get()
  kw = req.keyword.strip()
  source = (req.source or "TIKTOK").upper()
  where_clause = "WHERE 1=1"
  params = []
  if source == "TIKTOK":
    set_clause = "tiktok_keyword = %s, tiktok_url = %s"
    params.extend([kw, (req.url or "").strip()])
  else:
    set_clause = "youtube_keyword = %s, youtube_url = %s"
    params.extend([kw, (req.url or "").strip()])
  if owner:
    where_clause += " AND (user_id = %s OR account_uid IN (SELECT uid FROM accounts WHERE user_id = %s))"
    params.extend([owner, owner])
  query = f"UPDATE pages SET {set_clause}, updated_at = NOW() {where_clause}"
  try:
    db.execute(query, tuple(params))
  except Exception as e:
    return {"success": False, "error": str(e)}
  return {"success": True, "count": 1}
@router.get("/{page_id}/videos")
def get_page_videos(page_id: str, source: Optional[str] = None):
  p_row = db.fetch_one("SELECT page_id, page_name FROM pages WHERE page_id = %s OR id::text = %s", (page_id, page_id))
  real_pid = p_row["page_id"] if p_row else page_id
  query = "SELECT * FROM downloaded_videos WHERE (page_id = %s OR page_id = %s)"
  params = [page_id, real_pid]
  if source:
    query += " AND upper(source) = %s"
    params.append(source.upper())
  query += " ORDER BY id DESC LIMIT 200"
  rows = db.fetch_all(query, tuple(params))
  return {"page_id": real_pid, "page_name": p_row["page_name"] if p_row else "", "videos": rows}
@router.delete("/{page_id}/videos")
def clear_page_videos(page_id: str, source: Optional[str] = None):
  p_row = db.fetch_one("SELECT id, page_id, page_name FROM pages WHERE page_id = %s OR id::text = %s", (page_id, page_id))
  real_pid = p_row["page_id"] if p_row else page_id
  id_str = str(p_row["id"]) if p_row and p_row.get("id") else page_id
  query = "SELECT object_path, video_id, source FROM downloaded_videos WHERE (page_id = %s OR page_id = %s OR page_id = %s)"
  params = [page_id, real_pid, id_str]
  if source:
    query += " AND upper(source) = %s"
    params.append(source.upper())
  rows = db.fetch_all(query, tuple(params))
  deleted_count = 0
  parent_dirs = set()
  for r in rows:
    p = r.get("object_path")
    if p:
      norm_p = os.path.normpath(p)
      parent_dirs.add(os.path.dirname(norm_p))
      if os.path.exists(norm_p):
        try:
          os.remove(norm_p)
          deleted_count += 1
        except Exception:
          pass
      txt_p = os.path.splitext(norm_p)[0] + ".txt"
      if os.path.exists(txt_p):
        try:
          os.remove(txt_p)
        except Exception:
          pass
  base_folders = []
  try:
    cfg_t = read_persistent_tiktok_config()
    if cfg_t.get("download_folder"):
      base_folders.append(cfg_t["download_folder"])
    cfg_y = read_persistent_youtube_config()
    if cfg_y.get("download_folder"):
      base_folders.append(cfg_y["download_folder"])
  except Exception:
    pass
  name_candidates = []
  if p_row and p_row.get("page_name"):
    name_candidates.append(p_row["page_name"])
    s_name = re.sub(r'[\\/*?:"<>|]', "", p_row["page_name"]).strip()
    if s_name:
      name_candidates.append(s_name)
  name_candidates.extend([f"Page_{real_pid}", str(real_pid), str(id_str), f"Page_{id_str}"])
  for base in set(base_folders):
    if not base:
      continue
    target_base = base
    if not os.path.isabs(target_base):
      from config.constants import BASE_DIR
      target_base = os.path.join(str(BASE_DIR), base)
    if not os.path.exists(target_base) or not os.path.isdir(target_base):
      continue
    for d_name in set(name_candidates):
      sub_dir = os.path.join(target_base, d_name)
      if os.path.exists(sub_dir) and os.path.isdir(sub_dir):
        try:
          for f in os.listdir(sub_dir):
            if f.lower().endswith((".mp4", ".mkv", ".mov", ".webm", ".avi", ".part", ".txt")):
              try:
                os.remove(os.path.join(sub_dir, f))
                deleted_count += 1
              except Exception:
                pass
          if not os.listdir(sub_dir):
            os.rmdir(sub_dir)
        except Exception:
          pass
  for pdir in parent_dirs:
    if pdir and os.path.exists(pdir) and os.path.isdir(pdir):
      try:
        for f in os.listdir(pdir):
          if f.lower().endswith((".mp4", ".mkv", ".mov", ".webm", ".avi", ".part", ".txt")):
            try:
              os.remove(os.path.join(pdir, f))
              deleted_count += 1
            except Exception:
              pass
        if not os.listdir(pdir):
          os.rmdir(pdir)
      except Exception:
        pass
  del_query = "DELETE FROM downloaded_videos WHERE (page_id = %s OR page_id = %s OR page_id = %s)"
  del_params = [page_id, real_pid, id_str]
  if source:
    del_query += " AND upper(source) = %s"
    del_params.append(source.upper())
  db.execute(del_query, tuple(del_params))
  p_name = p_row["page_name"] if p_row and p_row.get("page_name") else "Fanpage"
  log_page_activity(page_id=real_pid, page_name=p_name, action_type="DELETE", title=f"Đã Xóa {deleted_count} Video Của Fanpage: {p_name}", details=f"Đã Xóa {deleted_count} Video Trong Thư Mục Lưu Trữ", status="SUCCESS")
  db.execute("UPDATE page_job_items SET status = 'PENDING', message = '' WHERE page_id = %s OR page_id = %s OR page_id = %s", (page_id, real_pid, id_str))
  return {"success": True, "deleted_count": deleted_count, "message": "Đã Xóa Toàn Bộ Video Và Dữ Liệu Đã Tải Của Fanpage"}
@router.delete("/{page_id}/videos/{video_db_id}")
def delete_single_video(page_id: str, video_db_id: int):
  p_row = db.fetch_one("SELECT id, page_id, page_name FROM pages WHERE page_id = %s OR id::text = %s", (page_id, page_id))
  real_pid = p_row["page_id"] if p_row else page_id
  id_str = str(p_row["id"]) if p_row and p_row.get("id") else page_id
  row = db.fetch_one("SELECT * FROM downloaded_videos WHERE id = %s AND (page_id = %s OR page_id = %s OR page_id = %s)", (video_db_id, page_id, real_pid, id_str))
  if not row:
    row = db.fetch_one("SELECT * FROM downloaded_videos WHERE id = %s", (video_db_id,))
  if not row:
    return {"success": False, "message": "Video Không Tồn Tại"}
  p = row.get("object_path")
  if p:
    norm_p = os.path.normpath(p)
    if os.path.exists(norm_p):
      try:
        os.remove(norm_p)
      except Exception:
        pass
    txt_p = os.path.splitext(norm_p)[0] + ".txt"
    if os.path.exists(txt_p):
      try:
        os.remove(txt_p)
      except Exception:
        pass
    pdir = os.path.dirname(norm_p)
    if pdir and os.path.exists(pdir) and os.path.isdir(pdir):
      try:
        if not os.listdir(pdir):
          os.rmdir(pdir)
      except Exception:
        pass
  db.execute("DELETE FROM downloaded_videos WHERE id = %s", (video_db_id,))
  p_name = p_row["page_name"] if p_row and p_row.get("page_name") else "Fanpage"
  vid_title = row.get("title") or "1 Video"
  log_page_activity(page_id=real_pid, page_name=p_name, action_type="DELETE", title=f"Đã Xóa Video '{vid_title}' Của Fanpage: {p_name}", details=row.get("caption") or "", object_path=p or "", status="SUCCESS")
  return {"success": True, "message": "Đã Xóa Video Thành Công"}
@router.get("/config/{tool}")
def get_page_tool_config(tool: str):
  key = f"{tool.lower()}_download_config"
  row = db.fetch_one("SELECT value FROM system_settings WHERE key = %s", (key,))
  if row and row.get("value"):
    try:
      return {"success": True, "config": json.loads(row["value"])}
    except Exception:
      pass
  local_file = Path("data/page_tool_settings.json")
  if local_file.exists():
    try:
      all_cfg = json.loads(local_file.read_text(encoding="utf-8"))
      if key in all_cfg:
        return {"success": True, "config": all_cfg[key]}
    except Exception:
      pass
  return {"success": True, "config": {}}
@router.post("/config")
def save_page_tool_config(req: ToolConfigRequest):
  key = f"{req.tool.lower()}_download_config"
  val_str = json.dumps(req.config)
  try:
    db.execute(
      """INSERT INTO system_settings (key, value, updated_at)
      VALUES (%s, %s, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()""",
      (key, val_str)
    )
  except Exception:
    pass
  try:
    local_file = Path("data/page_tool_settings.json")
    local_file.parent.mkdir(parents=True, exist_ok=True)
    existing = {}
    if local_file.exists():
      try:
        existing = json.loads(local_file.read_text(encoding="utf-8"))
      except Exception:
        existing = {}
    existing[key] = req.config
    local_file.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
  except Exception:
    pass
  return {"success": True}
@router.post("/tiktok-download")
def start_tiktok_download(req: TikTokDownloadRequest):
  if not req.download_folder or not req.download_folder.strip():
    raise HTTPException(status_code=400, detail="Vui Lòng Chọn Thư Mục Lưu Video Trước Khi Kích Hoạt!")
  if is_job_running("TIKTOK"):
    raise HTTPException(status_code=400, detail="Tác Vụ Tải TikTok Đang Chạy.")
  try:
    cfg = read_persistent_tiktok_config()
    cfg["download_folder"] = req.download_folder
    cfg["max_videos"] = req.max_videos
    write_persistent_tiktok_config(cfg)
  except Exception:
    pass
  job_row = db.fetch_one(
    """INSERT INTO page_jobs (job_type, status, config)
    VALUES ('TIKTOK', 'PENDING', %s) RETURNING id""",
    (json.dumps(req.dict()),)
  )
  job_id = job_row["id"] if isinstance(job_row, dict) else (job_row[0] if job_row else 1)
  seen_pids = set()
  for it in req.items:
    pid = str(it.get("page_id") or it.get("id") or "1")
    if pid in seen_pids:
      continue
    seen_pids.add(pid)
    db.execute(
      """INSERT INTO page_job_items (job_id, page_id, status)
      VALUES (%s, %s, 'PENDING')""",
      (job_id, pid)
    )
  mark_job_running("TIKTOK", job_id)
  thread = threading.Thread(target=run_tiktok_download_task, args=(job_id, req.dict()), daemon=True)
  thread.start()
  return {"success": True, "job_id": job_id, "message": "Đã Khởi Chạy Tác Vụ Tải TikTok"}
@router.post("/tiktok-download/stop")
def stop_tiktok_download():
  stop_job("TIKTOK")
  return {"success": True, "message": "Đã Gửi Lệnh Dừng Tải TikTok"}
@router.post("/youtube-download")
def start_youtube_download(req: YouTubeDownloadRequest):
  if not req.download_folder or not req.download_folder.strip():
    raise HTTPException(status_code=400, detail="Vui Lòng Chọn Thư Mục Lưu Video Trước Khi Kích Hoạt!")
  if is_job_running("YOUTUBE"):
    raise HTTPException(status_code=400, detail="Tác Vụ Tải YouTube Đang Chạy.")
  try:
    cfg = read_persistent_youtube_config()
    cfg["download_folder"] = req.download_folder
    cfg["max_videos"] = req.max_videos
    write_persistent_youtube_config(cfg)
  except Exception:
    pass
  job_row = db.fetch_one(
    """INSERT INTO page_jobs (job_type, status, config)
    VALUES ('YOUTUBE', 'PENDING', %s) RETURNING id""",
    (json.dumps(req.dict()),)
  )
  job_id = job_row["id"] if isinstance(job_row, dict) else (job_row[0] if job_row else 1)
  seen_pids = set()
  for it in req.items:
    pid = str(it.get("page_id") or it.get("id") or "1")
    if pid in seen_pids:
      continue
    seen_pids.add(pid)
    db.execute(
      """INSERT INTO page_job_items (job_id, page_id, status)
      VALUES (%s, %s, 'PENDING')""",
      (job_id, pid)
    )
  mark_job_running("YOUTUBE", job_id)
  thread = threading.Thread(target=run_youtube_download_task, args=(job_id, req.dict()), daemon=True)
  thread.start()
  return {"success": True, "job_id": job_id, "message": "Đã Khởi Chạy Tác Vụ Tải YouTube"}
@router.post("/youtube-download/stop")
def stop_youtube_download():
  stop_job("YOUTUBE")
  return {"success": True, "message": "Đã Gửi Lệnh Dừng Tải YouTube"}
@router.get("/jobs/{job_id}")
def get_job_status(job_id: int):
  job = db.fetch_one("SELECT * FROM page_jobs WHERE id = %s", (job_id,))
  if not job:
    raise HTTPException(status_code=404, detail="Không Tìm Thấy Job")
  items = db.fetch_all("SELECT * FROM page_job_items WHERE job_id = %s", (job_id,))
  return {"job": job, "items": items}
@router.post("/select-folder")
def select_folder_endpoint(req: Optional[SelectFolderRequest] = None):
  """
  Mở hộp thoại Windows native FolderBrowserDialog độc lập qua PowerShell (STA thread).
  Hoạt động 100% ổn định trên Windows cả khi chạy dev lẫn khi build đóng gói PyInstaller / Tauri.
  """
  init_dir = (req.initial_dir if req else None) or ""
  clean_init = init_dir.strip().strip('"').strip("'") if init_dir else ""
  dialog_init = clean_init if (clean_init and os.path.exists(clean_init) and os.path.isdir(clean_init)) else ""

  if not _picker_lock.acquire(blocking=False):
    return {"folder": "", "error": "Cửa sổ chọn thư mục đang mở, vui lòng thao tác trên cửa sổ đó!", "success": False}

  selected = ""
  error_msg = ""
  try:
    if sys.platform == "win32":
      from modules.module_05_page_manager.picker_helper import pick_folder_powershell
      selected = pick_folder_powershell(dialog_init, "Chọn thư mục lưu video")
    else:
      selected = ""
  except Exception as e:
    error_msg = f"Lỗi chọn thư mục: {str(e)}"
    selected = ""
  finally:
    _picker_lock.release()

  if selected:
    selected = os.path.normpath(selected)
  return {"folder": selected or "", "success": bool(selected), "error": error_msg}
@router.get("/tiktok/auth-status")
def get_tiktok_auth_status_endpoint():
  from core.media.tiktok_browser import get_tiktok_auth_status
  return get_tiktok_auth_status()
@router.post("/tiktok/open-login")
def open_tiktok_login_endpoint():
  from core.media.tiktok_browser import open_tiktok_login_browser
  return open_tiktok_login_browser()
@router.post("/tiktok/disconnect")
def disconnect_tiktok_endpoint():
  from core.media.tiktok_browser import disconnect_tiktok
  return {"success": disconnect_tiktok()}
@router.get("/tiktok/config")
def get_tiktok_config_endpoint():
  return read_persistent_tiktok_config()
@router.post("/tiktok/config")
def save_tiktok_config_endpoint(req: Dict[str, Any]):
  try:
    cfg = read_persistent_tiktok_config()
    df = str(req.get("download_folder", "")).strip()
    if df and df != cfg.get("download_folder") and cfg.get("download_folder"):
      old_folder = cfg.get("download_folder")
      has_vids, _ = check_folder_has_page_videos(old_folder)
      if has_vids:
        return {"success": False, "error": "Thư Mục Cũ Đang Chứa Dữ Liệu Video Đã Tải. Không Thể Thay Đổi Đường Dẫn Khi Chưa Xóa Hết Dữ Liệu Cũ!"}
    if df:
      cfg["download_folder"] = df
    if "max_videos" in req and req["max_videos"]:
      cfg["max_videos"] = int(req["max_videos"])
    write_persistent_tiktok_config(cfg)
    return {"success": True, "config": cfg}
  except Exception as e:
    return {"success": False, "error": str(e)}
@router.get("/youtube/config")
def get_youtube_config_endpoint():
  return read_persistent_youtube_config()
@router.post("/youtube/config")
def save_youtube_config_endpoint(req: Dict[str, Any]):
  try:
    cfg = read_persistent_youtube_config()
    df = str(req.get("download_folder", "")).strip()
    if df and df != cfg.get("download_folder") and cfg.get("download_folder"):
      old_folder = cfg.get("download_folder")
      has_vids, _ = check_folder_has_page_videos(old_folder)
      if has_vids:
        return {"success": False, "error": "Thư Mục Cũ Đang Chứa Dữ Liệu Video Đã Tải. Không Thể Thay Đổi Đường Dẫn Khi Chưa Xóa Hết Dữ Liệu Cũ!"}
    if df:
      cfg["download_folder"] = df
    if "max_videos" in req and req["max_videos"]:
      cfg["max_videos"] = int(req["max_videos"])
    write_persistent_youtube_config(cfg)
    return {"success": True, "config": cfg}
  except Exception as e:
    return {"success": False, "error": str(e)}
@router.post("/check-folder")
def check_folder_endpoint(req: Dict[str, Any]):
  folder = str(req.get("folder", "")).strip()
  has_data, count = check_folder_has_page_videos(folder)
  return {"has_data": has_data, "count": count}
