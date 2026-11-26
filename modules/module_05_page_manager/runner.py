import os
import re
import json
import time
import threading
import unicodedata
import urllib.request
import yt_dlp
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from core.database.connection import db
from core.media.tiktok_browser import TikTokBrowserSession
from core.media.tiktok_scraper import (
  search_tiktok_videos,
  download_tiktok_video,
  convert_tiktok_hashtags_to_facebook,
  fetch_tiktok_user_videos,
)
from core.media.youtube_scraper import (
  build_youtube_ydl_opts,
  convert_youtube_hashtags_to_facebook,
)
_active_jobs = {}
_jobs_lock = threading.Lock()
_folder_num_lock = threading.Lock()
_mode_col_ready = False
def _ensure_download_mode_column():
  global _mode_col_ready
  with _folder_num_lock:
    if _mode_col_ready:
      return
    try:
      db.execute("ALTER TABLE downloaded_videos ADD COLUMN IF NOT EXISTS download_mode VARCHAR(50)")
      _mode_col_ready = True
    except Exception:
      pass
def _resolve_download_mode(raw_kw: str, raw_link: str, is_direct: bool) -> str:
  if is_direct:
    return "DIRECT_LINK"
  if raw_link and raw_kw:
    return "KEYWORD_IN_PROFILE"
  if raw_link:
    return "PROFILE_ONLY"
  return "KEYWORD_ONLY"
def _save_downloaded_video(page_id: str, video_id: str, source: str, title: str, object_path: str, download_mode: str):
  try:
    exist = db.fetch_one(
      "SELECT id FROM downloaded_videos WHERE page_id = %s AND source = %s AND video_id = %s ORDER BY id DESC LIMIT 1",
      (page_id, source, video_id),
    )
    if exist and exist.get("id") is not None:
      db.execute(
        """UPDATE downloaded_videos
        SET title = %s, object_path = %s, download_mode = %s, downloaded_at = NOW()
        WHERE id = %s""",
        (title, object_path, download_mode, exist["id"]),
      )
    else:
      db.execute(
        """INSERT INTO downloaded_videos (page_id, video_id, source, title, object_path, download_mode)
        VALUES (%s, %s, %s, %s, %s, %s)""",
        (page_id, video_id, source, title, object_path, download_mode),
      )
  except Exception:
    pass
def _log_download_event(page_id: str, source: str, status: str, title: str = "", video_id: str = None, object_path: str = "", error_message: str = ""):
  try:
    db.execute(
      """INSERT INTO download_logs (page_id, source, video_id, title, object_path, status, error_message)
      VALUES (%s, %s, %s, %s, %s, %s, %s)""",
      (page_id, source, video_id, title or "", object_path or "", status, error_message or None),
    )
  except Exception:
    pass
def get_next_folder_number(page_dir: str) -> int:
  if not os.path.exists(page_dir):
    return 1
  existing_numbers = []
  try:
    for name in os.listdir(page_dir):
      if os.path.isdir(os.path.join(page_dir, name)) and name.isdigit():
        existing_numbers.append(int(name))
  except Exception:
    pass
  return max(existing_numbers) + 1 if existing_numbers else 1
def _allocate_video_subfolder(page_dir: str) -> str:
  with _folder_num_lock:
    sub_num = get_next_folder_number(page_dir)
    sub_dir = os.path.join(page_dir, str(sub_num))
    os.makedirs(sub_dir, exist_ok=True)
    return sub_dir
def _cleanup_failed_subfolder(sub_dir: str):
  if not os.path.isdir(sub_dir):
    return
  for name in os.listdir(sub_dir):
    try:
      os.remove(os.path.join(sub_dir, name))
    except Exception:
      pass
  if not os.listdir(sub_dir):
    try:
      os.rmdir(sub_dir)
    except Exception:
      pass
def _is_downloaded_video_present(page_id: str, source: str, video_id: str) -> bool:
  exist = db.fetch_one("SELECT id, object_path FROM downloaded_videos WHERE page_id = %s AND source = %s AND video_id = %s", (page_id, source, video_id))
  if not exist:
    return False
  old_p = (exist.get("object_path") or "").strip()
  if old_p:
    norm_p = os.path.normpath(old_p)
    if not os.path.isabs(norm_p):
      from config.constants import BASE_DIR
      norm_p = os.path.join(str(BASE_DIR), norm_p)
    if os.path.exists(norm_p) and os.path.isfile(norm_p) and os.path.getsize(norm_p) > 1000:
      return True
  db.execute("DELETE FROM downloaded_videos WHERE id = %s", (exist["id"],))
  return False
def _get_existing_downloaded_video_ids(page_id: str, source: str) -> set:
  rows = db.fetch_all(
    "SELECT id, video_id, object_path FROM downloaded_videos WHERE page_id = %s AND source = %s",
    (page_id, source),
  ) or []
  valid_ids = set()
  stale_ids = []
  for r in rows:
    old_p = (r.get("object_path") or "").strip()
    if old_p:
      norm_p = os.path.normpath(old_p)
      if not os.path.isabs(norm_p):
        from config.constants import BASE_DIR
        norm_p = os.path.join(str(BASE_DIR), norm_p)
      if os.path.exists(norm_p) and os.path.isfile(norm_p) and os.path.getsize(norm_p) > 1000:
        if r.get("video_id"):
          valid_ids.add(str(r["video_id"]))
        continue
    if r.get("id") is not None:
      stale_ids.append(r["id"])
  if stale_ids:
    try:
      placeholders = ",".join(["%s"] * len(stale_ids))
      db.execute(f"DELETE FROM downloaded_videos WHERE id IN ({placeholders})", tuple(stale_ids))
    except Exception:
      pass
  return valid_ids
def is_job_running(job_type: str) -> bool:
  with _jobs_lock:
    return job_type in _active_jobs and _active_jobs[job_type].get("running", False)
def mark_job_running(job_type: str, job_id: int):
  with _jobs_lock:
    _active_jobs[job_type] = {"running": True, "job_id": job_id}
def stop_job(job_type: str):
  with _jobs_lock:
    if job_type in _active_jobs:
      _active_jobs[job_type]["running"] = False
def run_tiktok_download_task(job_id: int, config: dict):
  with _jobs_lock:
    _active_jobs["TIKTOK"] = {"running": True, "job_id": job_id}
  _ensure_download_mode_column()
  db.execute("UPDATE page_jobs SET status = 'RUNNING', started_at = NOW() WHERE id = %s", (job_id,))
  items = config.get("items", [])
  folder = config.get("download_folder", "downloads/tiktok")
  max_videos = int(config.get("max_videos", 5))
  delay_sec = 1
  os.makedirs(folder, exist_ok=True)
  def is_tiktok_stopped() -> bool:
    with _jobs_lock:
      return not _active_jobs.get("TIKTOK", {}).get("running", False)
  def _is_channel_match(v: dict, channel_name: str) -> bool:
    ch = (channel_name or "").lower()
    if not ch:
      return True
    sv_auth = v.get("author", {}).get("unique_id", "").lower() if isinstance(v.get("author"), dict) else ""
    sv_url = (v.get("source_url") or "").lower()
    return sv_auth == ch or f"@{ch}" in sv_url
  def process_tiktok_item(item, driver):
    if is_tiktok_stopped():
      return
    page_id = str(item.get("page_id") or item.get("id"))
    page_name = (item.get("page_name") or f"Page_{page_id}").strip()
    safe_name = re.sub(r'[\\/*?:"<>|]', "", page_name).strip() or f"Page_{page_id}"
    page_folder = os.path.join(folder, safe_name)
    os.makedirs(page_folder, exist_ok=True)
    raw_kw = (item.get("keyword") or item.get("tiktok_keyword") or "").strip()
    raw_link = (item.get("link") or item.get("tiktok_url") or "").strip()
    if not raw_kw and not raw_link:
      raw_kw = (item.get("page_name") or f"Page_{page_id}").strip()
    target_label = f"{raw_link} [{raw_kw}]" if (raw_link and raw_kw) else (raw_link or raw_kw)
    db.execute("UPDATE page_job_items SET status = 'RUNNING', message = 'Đang Tìm Kiếm Video...' WHERE job_id = %s AND page_id = %s", (job_id, page_id))
    try:
      if driver is None:
        raise RuntimeError("Không Thể Khởi Chạy Trình Duyệt Chrome TikTok Đã Đăng Nhập.")
      existing_ids = _get_existing_downloaded_video_ids(page_id, "TIKTOK")
      videos = []
      target_channel = None
      is_direct_url = False
      if raw_link:
        direct_matches = [
          m.strip()
          for m in re.split(r'[,;\s\n]+', raw_link)
          if m.strip() and (
            "/video/" in m
            or "vm.tiktok.com/" in m
            or "vt.tiktok.com/" in m
            or re.search(r'\d{15,22}', m)
          )
        ]
        if direct_matches:
          is_direct_url = True
          for d_url in direct_matches:
            if len(videos) >= max_videos:
              break
            vid_m = re.search(r'(\d{15,22})', d_url)
            vid = vid_m.group(1) if vid_m else ""
            source_url = d_url if d_url.startswith("http") else f"https://www.tiktok.com/@_/video/{vid or d_url}"
            videos.append({
              "video_id": vid,
              "title": "",
              "source_url": source_url,
            })
        else:
          u_match = re.search(r'tiktok\.com/@([a-zA-Z0-9_.-]+)', raw_link)
          u_name = u_match.group(1) if u_match else raw_link.lstrip("@").strip().split("/")[0].split("?")[0].strip()
          target_channel = u_name
          if raw_kw:
            sub_kws = [k.strip().lower() for k in re.split(r'[,;\n]+', raw_kw) if k.strip()]
            channel_vids = fetch_tiktok_user_videos(
              u_name,
              count=max_videos,
              driver=driver,
              exclude_ids=existing_ids,
              match_keywords=sub_kws,
              stop_check=is_tiktok_stopped,
            )
            matched = []
            matched_ids = set()
            for v in channel_vids:
              t = (v.get("title") or "").lower()
              for kw in sub_kws:
                tokens = [tok for tok in re.split(r'\s+', kw) if tok]
                if kw in t or (tokens and all(tok in t for tok in tokens)):
                  vid_key = str(v.get("video_id") or "")
                  if vid_key not in matched_ids:
                    matched_ids.add(vid_key)
                    matched.append(v)
                  break
            if not matched:
              for v in channel_vids:
                t = (v.get("title") or "").lower()
                for kw in sub_kws:
                  tokens = [tok for tok in re.split(r'\s+', kw) if tok]
                  if tokens and any(tok in t for tok in tokens):
                    vid_key = str(v.get("video_id") or "")
                    if vid_key not in matched_ids:
                      matched_ids.add(vid_key)
                      matched.append(v)
                    break
            videos = matched
            if not videos and not is_tiktok_stopped():
              seen_fallback = set()
              for kw in sub_kws:
                if is_tiktok_stopped():
                  break
                search_query = f"{u_name} {kw}"
                search_res = search_tiktok_videos(
                  search_query,
                  count=max(20, max_videos * 3),
                  driver=driver,
                  exclude_ids=existing_ids | seen_fallback,
                  stop_check=is_tiktok_stopped,
                )
                if search_res.get("code") == 0 and search_res.get("data", {}).get("videos"):
                  for sv in search_res["data"]["videos"]:
                    sv_id = str(sv.get("video_id") or "")
                    if sv_id and sv_id not in seen_fallback and _is_channel_match(sv, u_name):
                      seen_fallback.add(sv_id)
                      videos.append(sv)
          else:
            channel_vids = fetch_tiktok_user_videos(
              u_name,
              count=max_videos,
              driver=driver,
              exclude_ids=existing_ids,
              stop_check=is_tiktok_stopped,
            )
            if not channel_vids and not is_tiktok_stopped():
              s_res = search_tiktok_videos(
                u_name,
                count=max(15, max_videos * 2),
                driver=driver,
                exclude_ids=existing_ids,
                stop_check=is_tiktok_stopped,
              )
              if s_res.get("code") == 0 and s_res.get("data", {}).get("videos"):
                channel_vids = s_res["data"]["videos"]
            videos = [v for v in channel_vids if _is_channel_match(v, u_name)]
      elif raw_kw:
        kw_list = [k.strip() for k in re.split(r'[,;\n]', raw_kw) if k.strip()]
        seen_candidate_ids = set()
        unseen_collected = 0
        for sub_kw in kw_list:
          if unseen_collected >= max_videos or is_tiktok_stopped():
            break
          needed = max_videos - unseen_collected
          search_res = search_tiktok_videos(
            sub_kw,
            count=needed,
            driver=driver,
            exclude_ids=existing_ids | seen_candidate_ids,
            stop_check=is_tiktok_stopped,
          )
          if search_res.get("code") == 0 and search_res.get("data", {}).get("videos"):
            for sv in search_res["data"]["videos"]:
              sv_id = str(sv.get("video_id") or "")
              if sv_id and sv_id in seen_candidate_ids:
                continue
              if sv_id:
                seen_candidate_ids.add(sv_id)
              videos.append(sv)
              if sv_id and sv_id not in existing_ids:
                unseen_collected += 1
      dl_mode = _resolve_download_mode(raw_kw, raw_link, is_direct_url)
      success_count = 0
      skipped_count = 0
      for idx, v in enumerate(videos):
        if is_tiktok_stopped():
          break
        if success_count >= max_videos:
          break
        v_id = str(v.get("video_id") or v.get("id") or "")
        author = v.get("author", {}).get("unique_id", "user") if isinstance(v.get("author"), dict) else "user"
        if target_channel and not _is_channel_match(v, target_channel):
          continue
        if not is_direct_url and v_id and _is_downloaded_video_present(page_id, "TIKTOK", v_id):
          skipped_count += 1
          continue
        direct_url = v.get("source_url") or f"https://www.tiktok.com/@{author}/video/{v_id}"
        raw_title = v.get("title") or raw_kw or target_label
        db.execute("UPDATE page_job_items SET status = 'RUNNING', message = %s WHERE job_id = %s AND page_id = %s", (f"Đang Tải Video ({success_count + 1}/{max_videos})...", job_id, page_id))
        video_sub_folder = _allocate_video_subfolder(page_folder)
        temp_vid = v_id or str(int(time.time() * 1000))
        f_path = os.path.join(video_sub_folder, f"{temp_vid}.mp4")
        download_ok, resolved_meta = download_tiktok_video(
          direct_url,
          f_path,
          driver=driver,
          stop_check=is_tiktok_stopped,
          prefetched_meta=v,
        )
        if download_ok:
          final_vid = str(resolved_meta.get("video_id") or temp_vid)
          if final_vid != temp_vid:
            renamed_path = os.path.join(video_sub_folder, f"{final_vid}.mp4")
            try:
              os.replace(f_path, renamed_path)
              f_path = renamed_path
            except Exception:
              final_vid = temp_vid
          if resolved_meta.get("title"):
            raw_title = resolved_meta["title"]
          elif not raw_title:
            raw_title = f"TikTok Video {final_vid}"
          txt_path = os.path.join(video_sub_folder, f"{final_vid}.txt")
          success_count += 1
          with open(txt_path, "w", encoding="utf-8") as f:
            f.write(convert_tiktok_hashtags_to_facebook(raw_title))
          _save_downloaded_video(page_id, final_vid, "TIKTOK", raw_title, f_path, dl_mode)
          _log_download_event(page_id, "TIKTOK", "SUCCESS", title=raw_title, video_id=final_vid, object_path=f_path)
          existing_ids.add(final_vid)
        else:
          _cleanup_failed_subfolder(video_sub_folder)
        if delay_sec > 0 and idx < len(videos) - 1 and not is_tiktok_stopped():
          time.sleep(delay_sec)
      stopped_now = is_tiktok_stopped()
      if success_count > 0:
        msg = f"Đã Tải {success_count} Video TikTok" + (f" (Đã Bỏ Qua {skipped_count} Video Trùng)" if skipped_count else "")
        st = "SUCCESS"
      elif skipped_count > 0:
        msg = f"Đã Có Sẵn {skipped_count} Video Trong Thư Mục (Đã Bỏ Qua Trùng Lặp)"
        st = "SUCCESS"
      elif stopped_now:
        msg = "Đã Dừng"
        st = "PENDING"
      else:
        st = "FAILED"
        if raw_link and raw_kw and len(videos) == 0:
          msg = f"Kênh '{raw_link}' Không Có Video Nào Khớp Từ Khóa '{raw_kw}'"
        elif len(videos) > 0:
          msg = f"Tìm Thấy {len(videos)} Video Nhưng Không Thể Tải File Về Máy"
        else:
          msg = f"Không Tìm Thấy Video Nào Khả Dụng Cho '{target_label}'"
        _log_download_event(page_id, "TIKTOK", "FAILED", title=target_label, error_message=msg)
      db.execute("UPDATE page_job_items SET status = %s, message = %s WHERE job_id = %s AND page_id = %s", (st, msg, job_id, page_id))
    except Exception as e:
      _log_download_event(page_id, "TIKTOK", "FAILED", title=target_label, error_message=str(e))
      db.execute("UPDATE page_job_items SET status = 'FAILED', message = %s WHERE job_id = %s AND page_id = %s", (str(e), job_id, page_id))
    if delay_sec > 0 and not is_tiktok_stopped():
      time.sleep(delay_sec)
  browser_session = None
  driver = None
  try:
    browser_session = TikTokBrowserSession()
    browser_session.__enter__()
    driver = browser_session.driver
  except Exception:
    if browser_session is not None:
      browser_session.close()
    browser_session = None
    driver = None
  try:
    for it in items:
      if is_tiktok_stopped():
        break
      process_tiktok_item(it, driver)
  finally:
    if browser_session is not None:
      browser_session.close()
  db.execute("UPDATE page_job_items SET message = '' WHERE job_id = %s AND status = 'PENDING' AND message = 'Đang Chờ Lượt...'", (job_id,))
  db.execute("UPDATE page_jobs SET status = 'FINISHED', finished_at = NOW() WHERE id = %s", (job_id,))
  with _jobs_lock:
    _active_jobs.pop("TIKTOK", None)
def _flatten_yt_entries(info) -> list:
  if not info:
    return []
  if isinstance(info, dict) and "entries" in info and info["entries"] is not None:
    flat = []
    for ent in info["entries"]:
      if not ent:
        continue
      if isinstance(ent, dict) and ent.get("entries") is not None:
        flat.extend(_flatten_yt_entries(ent))
      else:
        flat.append(ent)
    return flat
  return [info] if isinstance(info, dict) else []
def _extract_valid_yt_video_id(ent: dict) -> str:
  if not isinstance(ent, dict):
    return ""
  ie_key = str(ent.get("ie_key") or "").lower()
  if ent.get("_type") == "playlist" or ie_key == "youtubetab":
    return ""
  cand = str(ent.get("id") or "").strip()
  if re.fullmatch(r"[0-9A-Za-z_-]{11}", cand):
    return cand
  for field in ("url", "webpage_url"):
    v_url = str(ent.get(field) or "").strip()
    if not v_url:
      continue
    if "/channel/" in v_url or "/@" in v_url:
      if "/shorts/" not in v_url and "watch?v=" not in v_url:
        continue
    m = re.search(r"(?:[?&]v=|/shorts/|youtu\.be/)([0-9A-Za-z_-]{11})(?:[?&#/]|$)", v_url)
    if m:
      return m.group(1)
  return ""
def _slugify_yt_hashtag(keyword: str, ascii_only: bool = False) -> str:
  raw = (keyword or "").strip().lower()
  if not raw:
    return ""
  if ascii_only:
    raw = raw.replace("đ", "d")
    raw = "".join(ch for ch in unicodedata.normalize("NFKD", raw) if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "", raw)
  return re.sub(r"[^\w]+", "", raw, flags=re.UNICODE).replace("_", "")
def _search_youtube_shorts_entries(query: str, limit: int = 25) -> list:
  if not query or not query.strip():
    return []
  url = f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(query.strip())}"
  req = urllib.request.Request(
    url,
    headers={
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    },
  )
  try:
    with urllib.request.urlopen(req, timeout=15) as resp:
      html = resp.read().decode("utf-8", errors="replace")
  except Exception:
    return []
  out = []
  seen = set()
  m = re.search(r"var ytInitialData = (\{.*?\});</script>", html)
  if m:
    try:
      data = json.loads(m.group(1))
    except Exception:
      data = None
    def _walk(node):
      if len(out) >= limit:
        return
      if isinstance(node, dict):
        if "shortsLockupViewModel" in node:
          vm = node["shortsLockupViewModel"]
          vid = (
            vm.get("onTap", {})
            .get("innertubeCommand", {})
            .get("reelWatchEndpoint", {})
            .get("videoId")
            or ""
          )
          title = (
            vm.get("overlayMetadata", {}).get("primaryText", {}).get("content")
            or vm.get("accessibilityText")
            or ""
          )
          if re.fullmatch(r"[0-9A-Za-z_-]{11}", str(vid)) and vid not in seen:
            seen.add(vid)
            out.append({"id": vid, "title": str(title).strip(), "url": f"https://www.youtube.com/shorts/{vid}"})
          return
        if "reelItemRenderer" in node:
          rr = node["reelItemRenderer"]
          vid = rr.get("videoId") or rr.get("navigationEndpoint", {}).get("reelWatchEndpoint", {}).get("videoId") or ""
          title = rr.get("headline", {}).get("simpleText") or ""
          if re.fullmatch(r"[0-9A-Za-z_-]{11}", str(vid)) and vid not in seen:
            seen.add(vid)
            out.append({"id": vid, "title": str(title).strip(), "url": f"https://www.youtube.com/shorts/{vid}"})
          return
        for val in node.values():
          _walk(val)
      elif isinstance(node, list):
        for it in node:
          _walk(it)
    if data is not None:
      _walk(data)
  if len(out) < limit:
    for vid in re.findall(r"/shorts/([0-9A-Za-z_-]{11})", html):
      if vid not in seen:
        seen.add(vid)
        out.append({"id": vid, "title": "", "url": f"https://www.youtube.com/shorts/{vid}"})
        if len(out) >= limit:
          break
  return out
def run_youtube_download_task(job_id: int, config: dict):
  with _jobs_lock:
    _active_jobs["YOUTUBE"] = {"running": True, "job_id": job_id}
  _ensure_download_mode_column()
  db.execute("UPDATE page_jobs SET status = 'RUNNING', started_at = NOW() WHERE id = %s", (job_id,))
  items = config.get("items", [])
  folder = config.get("download_folder", "downloads/youtube")
  max_videos = int(config.get("max_videos", 5))
  delay_sec = int(config.get("delay_sec", 2))
  concurrency = max(1, min(int(config.get("concurrency", 1)), 10))
  cookie_browser = config.get("cookie_browser") or config.get("browser_cookies")
  cookie_file = config.get("cookie_file")
  os.makedirs(folder, exist_ok=True)
  def process_youtube_item(item):
    with _jobs_lock:
      if not _active_jobs.get("YOUTUBE", {}).get("running", False):
        return
    page_id = str(item.get("page_id") or item.get("id"))
    page_name = (item.get("page_name") or f"Page_{page_id}").strip()
    safe_name = re.sub(r'[\\/*?:"<>|]', "", page_name).strip() or f"Page_{page_id}"
    page_folder = os.path.join(folder, safe_name)
    os.makedirs(page_folder, exist_ok=True)
    kw = (item.get("keyword") or item.get("youtube_keyword") or "").strip()
    link = (item.get("link") or item.get("youtube_url") or "").strip()
    if not kw and not link:
      kw = (item.get("page_name") or f"Page_{page_id}").strip()
    direct_matches = [m.strip() for m in re.split(r'[,;\s\n]+', link) if "watch?v=" in m or "/shorts/" in m or "youtu.be/" in m] if link else []
    dl_mode = _resolve_download_mode(kw, link, bool(direct_matches))
    db.execute("UPDATE page_job_items SET status = 'RUNNING', message = 'Đang Tìm Kiếm Video...' WHERE job_id = %s AND page_id = %s", (job_id, page_id))
    try:
      search_opts = build_youtube_ydl_opts(outtmpl=os.path.join(page_folder, "%(id)s.%(ext)s"), cookie_browser=cookie_browser, cookie_file=cookie_file)
      search_opts["extract_flat"] = "in_playlist"
      downloaded_items = []
      skipped_count = 0
      seen_video_ids = set()
      last_error = ""
      candidate_entries = []
      if direct_matches:
        search_opts["playlistend"] = max_videos
        with yt_dlp.YoutubeDL(search_opts) as ydl_search:
          for d_url in direct_matches:
            with _jobs_lock:
              if not _active_jobs.get("YOUTUBE", {}).get("running", False):
                break
            try:
              info = ydl_search.extract_info(d_url, download=False)
              candidate_entries.extend(_flatten_yt_entries(info))
            except Exception as q_err:
              last_error = str(q_err)
      elif link:
        clean_channel = re.sub(r'/(shorts|videos|featured|playlists|streams|live)$', '', link.rstrip("/"))
        shorts_tab_url = link if "playlist?list=" in link.lower() else f"{clean_channel}/shorts"
        search_opts["playlistend"] = max(120, max_videos * 25) if kw else max(30, max_videos * 6)
        raw_channel_shorts = []
        with yt_dlp.YoutubeDL(search_opts) as ydl_search:
          try:
            info = ydl_search.extract_info(shorts_tab_url, download=False)
            raw_channel_shorts = _flatten_yt_entries(info)
          except Exception as q_err:
            last_error = str(q_err)
        if kw:
          sub_kws = [k.strip().lower() for k in re.split(r'[,;\n]+', kw) if k.strip()]
          matched_strict = []
          matched_loose = []
          for ent in raw_channel_shorts:
            t = (ent.get("title") or "").lower()
            is_strict = False
            is_loose = False
            for sk in sub_kws:
              tokens = [tok for tok in re.split(r'\s+', sk) if tok]
              if sk in t or (tokens and all(tok in t for tok in tokens)):
                is_strict = True
                break
              if tokens and any(tok in t for tok in tokens):
                is_loose = True
            if is_strict:
              matched_strict.append(ent)
            elif is_loose:
              matched_loose.append(ent)
          candidate_entries = matched_strict if matched_strict else matched_loose
        else:
          candidate_entries = raw_channel_shorts
      else:
        kw_list = [k.strip() for k in re.split(r'[,;\n]+', kw) if k.strip()]
        target_pool = max(25, max_videos * 5)
        collected_ids = set()
        for sub_kw in kw_list:
          with _jobs_lock:
            if not _active_jobs.get("YOUTUBE", {}).get("running", False):
              break
          if len(candidate_entries) >= target_pool:
            break
          for q_text in (sub_kw, f"{sub_kw} #shorts"):
            for ent in _search_youtube_shorts_entries(q_text, limit=target_pool):
              evid = ent.get("id")
              if evid and evid not in collected_ids:
                collected_ids.add(evid)
                candidate_entries.append(ent)
            if len(candidate_entries) >= target_pool:
              break
          if len(candidate_entries) < target_pool:
            slugs = []
            for slug in (_slugify_yt_hashtag(sub_kw, ascii_only=False), _slugify_yt_hashtag(sub_kw, ascii_only=True)):
              if slug and slug not in slugs:
                slugs.append(slug)
            search_opts["playlistend"] = target_pool
            with yt_dlp.YoutubeDL(search_opts) as ydl_search:
              for slug in slugs:
                if len(candidate_entries) >= target_pool:
                  break
                try:
                  h_url = f"https://www.youtube.com/hashtag/{urllib.parse.quote(slug)}/shorts"
                  info = ydl_search.extract_info(h_url, download=False)
                  for ent in _flatten_yt_entries(info):
                    evid = _extract_valid_yt_video_id(ent)
                    if evid and evid not in collected_ids:
                      collected_ids.add(evid)
                      candidate_entries.append(ent)
                except Exception as q_err:
                  if not candidate_entries:
                    last_error = str(q_err)
      for ent in candidate_entries:
        with _jobs_lock:
          if not _active_jobs.get("YOUTUBE", {}).get("running", False):
            break
        if len(downloaded_items) >= max_videos:
          break
        v_id = _extract_valid_yt_video_id(ent)
        if not v_id or v_id in seen_video_ids:
          continue
        seen_video_ids.add(v_id)
        raw_title = ent.get("title") or kw or "Video"
        clean_title = convert_youtube_hashtags_to_facebook(raw_title)
        if not direct_matches and _is_downloaded_video_present(page_id, "YOUTUBE", v_id):
          skipped_count += 1
          continue
        db.execute("UPDATE page_job_items SET status = 'RUNNING', message = %s WHERE job_id = %s AND page_id = %s", (f"Đang Tải Video ({len(downloaded_items) + 1}/{max_videos})...", job_id, page_id))
        video_sub_folder = _allocate_video_subfolder(page_folder)
        vid_url = f"https://www.youtube.com/shorts/{v_id}" if not direct_matches else f"https://www.youtube.com/watch?v={v_id}"
        ydl_opts = build_youtube_ydl_opts(outtmpl=os.path.join(video_sub_folder, "%(id)s.%(ext)s"), cookie_browser=cookie_browser, cookie_file=cookie_file)
        try:
          with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info_dl = ydl.extract_info(vid_url, download=True)
            if isinstance(info_dl, dict) and info_dl.get("title"):
              clean_title = convert_youtube_hashtags_to_facebook(info_dl["title"])
          downloaded_files = [f for f in os.listdir(video_sub_folder) if f.startswith(f"{v_id}.") and not f.endswith(".txt") and not f.endswith(".part") and not f.endswith(".ytdl")] if os.path.exists(video_sub_folder) else []
          if downloaded_files:
            f_path = os.path.join(video_sub_folder, downloaded_files[0])
            txt_path = os.path.join(video_sub_folder, f"{v_id}.txt")
            with open(txt_path, "w", encoding="utf-8") as tf:
              tf.write(clean_title)
            downloaded_items.append({"id": v_id, "title": clean_title, "path": f_path})
            _save_downloaded_video(page_id, v_id, "YOUTUBE", clean_title, f_path, dl_mode)
            _log_download_event(page_id, "YOUTUBE", "SUCCESS", title=clean_title, video_id=v_id, object_path=f_path)
          else:
            _cleanup_failed_subfolder(video_sub_folder)
        except Exception as dl_err:
          last_error = str(dl_err)
          _cleanup_failed_subfolder(video_sub_folder)
      with _jobs_lock:
        is_stopped = not _active_jobs.get("YOUTUBE", {}).get("running", False)
      if downloaded_items:
        msg = f"Đã Tải {len(downloaded_items)} Video YouTube" + (f" (Đã Bỏ Qua {skipped_count} Video Trùng)" if skipped_count else "")
        st = "SUCCESS"
      elif skipped_count > 0:
        msg = f"Đã Có Sẵn {skipped_count} Video Trong Thư Mục (Đã Bỏ Qua Trùng Lặp)"
        st = "SUCCESS"
      elif is_stopped:
        msg = "Đã Dừng"
        st = "PENDING"
      else:
        st = "FAILED"
        if last_error:
          msg = f"Lỗi Khi Tải Video: {last_error}"
        elif link and kw:
          msg = f"Kênh '{link}' Không Có Video Nào Khớp Từ Khóa '{kw}'"
        else:
          msg = "Không Tìm Thấy Video Khả Dụng"
        _log_download_event(page_id, "YOUTUBE", "FAILED", title=kw or link or page_name, error_message=msg)
      db.execute("UPDATE page_job_items SET status = %s, message = %s WHERE job_id = %s AND page_id = %s", (st, msg, job_id, page_id))
    except Exception as e:
      _log_download_event(page_id, "YOUTUBE", "FAILED", title=kw or link or page_name, error_message=str(e))
      db.execute("UPDATE page_job_items SET status = 'FAILED', message = %s WHERE job_id = %s AND page_id = %s", (str(e), job_id, page_id))
    if delay_sec > 0:
      time.sleep(delay_sec)
  if concurrency <= 1 or len(items) <= 1:
    for it in items:
      process_youtube_item(it)
  else:
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
      list(executor.map(process_youtube_item, items))
  db.execute("UPDATE page_job_items SET message = '' WHERE job_id = %s AND status = 'PENDING' AND message = 'Đang Chờ Lượt...'", (job_id,))
  db.execute("UPDATE page_jobs SET status = 'FINISHED', finished_at = NOW() WHERE id = %s", (job_id,))
  with _jobs_lock:
    _active_jobs.pop("YOUTUBE", None)
