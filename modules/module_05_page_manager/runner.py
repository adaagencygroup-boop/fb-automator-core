import os
import re
import json
import time
import random
import threading
import requests
import yt_dlp
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from core.database.connection import db
from core.facebook.fb_graph_client import fb_client
from core.ai.gemini_engine import ai_engine
from core.media.image_search import image_searcher
from core.media.tiktok_scraper import (
  search_tiktok_videos,
  resolve_tiktok_video_url,
  download_stream_to_file,
  convert_tiktok_hashtags_to_facebook,
  fetch_tiktok_user_videos,
)
from core.media.youtube_scraper import (
  build_youtube_ydl_opts,
  convert_youtube_hashtags_to_facebook,
)
_active_jobs = {}
_jobs_lock = threading.Lock()
def is_job_running(job_type: str) -> bool:
  with _jobs_lock:
    return job_type in _active_jobs and _active_jobs[job_type].get("running", False)
def stop_job(job_type: str):
  with _jobs_lock:
    if job_type in _active_jobs:
      _active_jobs[job_type]["running"] = False
def run_ai_posting_task(job_id: int, config: dict):
  with _jobs_lock:
    _active_jobs["AI"] = {"running": True, "job_id": job_id}
  db.execute("UPDATE page_jobs SET status = 'RUNNING', started_at = NOW() WHERE id = %s", (job_id,))
  pages = config.get("pages", [])
  prompt_tpl = str(config.get("prompt") or "").strip()
  model_name = str(config.get("gemini_model") or "gemini-3.8-flash").strip()
  delay_min = int(config.get("delay_min", 30))
  delay_max = int(config.get("delay_max", 60))
  keys_file = config.get("keys_file") or config.get("keyFileName")
  extra_keys = config.get("api_keys") or []
  if keys_file or extra_keys:
    ai_engine.load_keys(custom_path=keys_file, extra_keys=extra_keys if isinstance(extra_keys, list) else [extra_keys])
  if config.get("pixabay_key"):
    image_searcher.set_pixabay_key(config.get("pixabay_key"))
  for item in pages:
    with _jobs_lock:
      if not _active_jobs.get("AI", {}).get("running", False):
        break
    page_id = str(item.get("page_id") or item.get("id"))
    page_name = item.get("page_name", "Fanpage")
    keyword = item.get("keyword") or item.get("ai_keyword") or page_name
    db.execute("UPDATE page_job_items SET status = 'RUNNING' WHERE job_id = %s AND page_id = %s", (job_id, page_id))
    try:
      p_row = db.fetch_one("SELECT access_token FROM pages WHERE page_id = %s", (page_id,))
      access_token = p_row["access_token"] if p_row else item.get("access_token")
      if not access_token:
        raise ValueError(f"Không tìm thấy Access Token cho Fanpage {page_name}")
      if not prompt_tpl:
        raise ValueError("Prompt AI rỗng. Vui lòng cung cấp prompt từ người dùng.")
      if "{page_name}" in prompt_tpl or "{keyword}" in prompt_tpl or "{topic}" in prompt_tpl:
        full_prompt = prompt_tpl.replace("{page_name}", page_name).replace("{keyword}", keyword).replace("{topic}", keyword)
      else:
        full_prompt = f"{prompt_tpl}\n\nFanpage: {page_name}\nChủ đề / Từ khóa: {keyword}"
      post_text = ai_engine.generate_content(prompt=full_prompt, model_name=model_name)
      if not post_text:
        raise RuntimeError("AI không thể tạo nội dung bài viết theo yêu cầu.")
      img_path = None
      try:
        img_path = image_searcher.search_and_download(keyword, pixabay_key=config.get("pixabay_key"))
      except Exception:
        img_path = None
      post_res = fb_client.post_feed(page_id=page_id, page_access_token=access_token, message=post_text, image_url=img_path)
      fb_post_id = post_res.get("id") or post_res.get("post_id") or f"post_{int(time.time())}"
      db.execute(
        """INSERT INTO posting_history (page_id, post_id, post_type, title, caption, post_url, media_path, status)
        VALUES (%s, %s, 'AI', %s, %s, %s, %s, 'SUCCESS')""",
        (page_id, fb_post_id, keyword, post_text, f"https://facebook.com/{fb_post_id}", img_path or "")
      )
      db.execute("UPDATE page_job_items SET status = 'SUCCESS', message = 'Đăng thành công' WHERE job_id = %s AND page_id = %s", (job_id, page_id))
    except Exception as e:
      db.execute(
        """INSERT INTO posting_history (page_id, post_type, title, status, error_message)
        VALUES (%s, 'AI', %s, 'FAILED', %s)""",
        (page_id, keyword, str(e))
      )
      db.execute("UPDATE page_job_items SET status = 'FAILED', message = %s WHERE job_id = %s AND page_id = %s", (str(e), job_id, page_id))
    time.sleep(random.randint(delay_min, delay_max))
  db.execute("UPDATE page_jobs SET status = 'FINISHED', finished_at = NOW() WHERE id = %s", (job_id,))
  with _jobs_lock:
    _active_jobs.pop("AI", None)
def run_reels_posting_task(job_id: int, config: dict):
  with _jobs_lock:
    _active_jobs["REEL"] = {"running": True, "job_id": job_id}
  db.execute("UPDATE page_jobs SET status = 'RUNNING', started_at = NOW() WHERE id = %s", (job_id,))
  mappings = config.get("mappings", [])
  delay_min = int(config.get("delay_min", 30))
  delay_max = int(config.get("delay_max", 60))
  for item in mappings:
    with _jobs_lock:
      if not _active_jobs.get("REEL", {}).get("running", False):
        break
    page_id = str(item.get("page_id") or item.get("id"))
    folder = item.get("folder")
    db.execute("UPDATE page_job_items SET status = 'RUNNING' WHERE job_id = %s AND page_id = %s", (job_id, page_id))
    try:
      p_row = db.fetch_one("SELECT access_token FROM pages WHERE page_id = %s", (page_id,))
      access_token = p_row["access_token"] if p_row else item.get("access_token")
      video_file = None
      caption_text = item.get("caption") or ""
      if folder and os.path.exists(folder):
        for f in os.listdir(folder):
          if f.lower().endswith((".mp4", ".mov", ".mkv")):
            video_file = os.path.join(folder, f)
            txt_candidate = os.path.splitext(video_file)[0] + ".txt"
            if not caption_text and os.path.exists(txt_candidate):
              try:
                with open(txt_candidate, "r", encoding="utf-8") as tf:
                  caption_text = tf.read().strip()
              except Exception:
                pass
            break
      if not video_file:
        raise RuntimeError("Không tìm thấy video hợp lệ trong thư mục.")
      desc = caption_text or f"Reels video {item.get('page_name')}"
      res = fb_client.upload_reel_3phases(page_id=page_id, page_access_token=access_token, video_path=video_file, description=desc)
      reel_id = res.get("id") or res.get("video_id") or f"reel_{int(time.time())}"
      db.execute(
        """INSERT INTO posting_history (page_id, post_id, post_type, title, media_path, status)
        VALUES (%s, %s, 'REEL', %s, %s, 'SUCCESS')""",
        (page_id, reel_id, os.path.basename(video_file), video_file)
      )
      db.execute(
        """INSERT INTO posting_progress (page_id, post_type, last_video_id, last_object_path, updated_at)
        VALUES (%s, 'REEL', %s, %s, NOW())
        ON CONFLICT (page_id, post_type) DO UPDATE SET last_video_id = EXCLUDED.last_video_id, last_object_path = EXCLUDED.last_object_path, updated_at = NOW()""",
        (page_id, reel_id, video_file)
      )
      db.execute("UPDATE page_job_items SET status = 'SUCCESS', message = 'Đăng Reels thành công' WHERE job_id = %s AND page_id = %s", (job_id, page_id))
    except Exception as e:
      db.execute(
        """INSERT INTO posting_history (page_id, post_type, status, error_message)
        VALUES (%s, 'REEL', 'FAILED', %s)""",
        (page_id, str(e))
      )
      db.execute("UPDATE page_job_items SET status = 'FAILED', message = %s WHERE job_id = %s AND page_id = %s", (str(e), job_id, page_id))
    time.sleep(random.randint(delay_min, delay_max))
  db.execute("UPDATE page_jobs SET status = 'FINISHED', finished_at = NOW() WHERE id = %s", (job_id,))
  with _jobs_lock:
    _active_jobs.pop("REEL", None)
def run_tiktok_download_task(job_id: int, config: dict):
  with _jobs_lock:
    _active_jobs["TIKTOK"] = {"running": True, "job_id": job_id}
  db.execute("UPDATE page_jobs SET status = 'RUNNING', started_at = NOW() WHERE id = %s", (job_id,))
  items = config.get("items", [])
  folder = config.get("download_folder", "downloads/tiktok")
  max_videos = int(config.get("max_videos", 5))
  delay_sec = 1
  concurrency = 1
  os.makedirs(folder, exist_ok=True)
  try:
    from config.constants import TIKTOK_CONFIG_PATH, TIKTOK_CONFIG_INI_PATH
    import configparser
    with open(TIKTOK_CONFIG_PATH, "w", encoding="utf-8") as f:
      json.dump({"download_folder": folder, "max_videos": max_videos}, f, ensure_ascii=False, indent=2)
    cp = configparser.ConfigParser()
    cp["TikTok"] = {"download_folder": str(folder), "max_videos": str(max_videos)}
    with open(TIKTOK_CONFIG_INI_PATH, "w", encoding="utf-8") as f:
      cp.write(f)
  except Exception:
    pass
  def process_tiktok_item(item):
    with _jobs_lock:
      if not _active_jobs.get("TIKTOK", {}).get("running", False):
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
      videos = []
      target_channel = None
      is_direct_url = False
      if raw_link:
        direct_matches = [m.strip() for m in re.split(r'[,;\s\n]+', raw_link) if "/video/" in m or re.search(r'\d{15,22}', m)]
        if direct_matches:
          is_direct_url = True
          for d_url in direct_matches:
            if len(videos) >= max_videos:
              break
            vid_m = re.search(r'(\d{15,22})', d_url)
            vid = vid_m.group(1) if vid_m else str(int(time.time() * 1000))
            play_url, raw_title = resolve_tiktok_video_url(d_url)
            videos.append({
              "video_id": vid,
              "title": raw_title if raw_title else f"TikTok Video {vid}",
              "play": play_url,
              "source_url": d_url
            })
        else:
          u_match = re.search(r'tiktok\.com/@([a-zA-Z0-9_.-]+)', raw_link)
          u_name = u_match.group(1) if u_match else raw_link.lstrip("@").strip().split("/")[0].strip()
          target_channel = u_name
          if raw_kw:
            channel_vids = fetch_tiktok_user_videos(u_name, count=max(50, max_videos * 10))
            sub_kws = [k.strip().lower() for k in re.split(r'[,;\n]+', raw_kw) if k.strip()]
            matched = []
            for v in channel_vids:
              t = (v.get("title") or "").lower()
              for kw in sub_kws:
                tokens = [tok for tok in re.split(r'\s+', kw) if tok]
                if kw in t or (tokens and all(tok in t for tok in tokens)):
                  if v not in matched:
                    matched.append(v)
                  break
            if not matched:
              for v in channel_vids:
                t = (v.get("title") or "").lower()
                for kw in sub_kws:
                  tokens = [tok for tok in re.split(r'\s+', kw) if tok]
                  if tokens and any(tok in t for tok in tokens):
                    if v not in matched:
                      matched.append(v)
                    break
            videos = matched[:max_videos]
            if not videos:
              for kw in sub_kws:
                if len(videos) >= max_videos:
                  break
                search_query = f"{u_name} {kw}"
                search_res = search_tiktok_videos(search_query, count=max(20, max_videos * 3))
                if search_res.get("code") == 0 and search_res.get("data", {}).get("videos"):
                  s_vids = search_res["data"]["videos"]
                  for sv in s_vids:
                    sv_auth = sv.get("author", {}).get("unique_id", "").lower() if isinstance(sv.get("author"), dict) else ""
                    sv_url = (sv.get("source_url") or "").lower()
                    if sv_auth == u_name.lower() or f"@{u_name.lower()}" in sv_url:
                      if sv not in videos:
                        videos.append(sv)
                    if len(videos) >= max_videos:
                      break
          else:
            channel_vids = fetch_tiktok_user_videos(u_name, count=max(30, max_videos * 5))
            if not channel_vids:
              s_res = search_tiktok_videos(u_name, count=max(15, max_videos * 2))
              if s_res.get("code") == 0 and s_res.get("data", {}).get("videos"):
                channel_vids = s_res["data"]["videos"]
            videos = [v for v in channel_vids if (v.get("author", {}).get("unique_id", "").lower() == u_name.lower()) or (f"@{u_name.lower()}" in (v.get("source_url") or "").lower())]
      elif raw_kw:
        kw_list = [k.strip() for k in re.split(r'[,;\n]', raw_kw) if k.strip()]
        for sub_kw in kw_list:
          if len(videos) >= max_videos:
            break
          needed = max_videos - len(videos)
          search_res = search_tiktok_videos(sub_kw, count=needed)
          if search_res.get("code") == 0 and search_res.get("data", {}).get("videos"):
            videos.extend(search_res["data"]["videos"][:needed])
      success_count = 0
      skipped_count = 0
      for idx, v in enumerate(videos):
        with _jobs_lock:
          if not _active_jobs.get("TIKTOK", {}).get("running", False):
            break
        if success_count >= max_videos:
          break
        v_id = str(v.get("video_id") or v.get("id") or int(time.time() * 1000))
        author = v.get("author", {}).get("unique_id", "user") if isinstance(v.get("author"), dict) else "user"
        if target_channel and author.lower() != target_channel.lower() and f"@{target_channel.lower()}" not in (v.get("source_url") or "").lower():
          continue
        f_path = os.path.join(page_folder, f"{v_id}.mp4")
        txt_path = os.path.join(page_folder, f"{v_id}.txt")
        if not is_direct_url:
          exist = db.fetch_one("SELECT id FROM downloaded_videos WHERE page_id = %s AND source = 'TIKTOK' AND video_id = %s", (page_id, v_id))
          if exist and os.path.exists(f_path) and os.path.getsize(f_path) > 1000:
            skipped_count += 1
            continue
        direct_url = v.get("source_url") or f"https://www.tiktok.com/@{author}/video/{v_id}"
        play_url = v.get("play") or v.get("hdplay") or v.get("wmplay")
        raw_title = v.get("title") or raw_kw or target_label
        download_ok = False
        if play_url and "v16-webapp-prime" not in play_url:
          download_ok = download_stream_to_file(play_url, f_path)
        if not download_ok and direct_url:
          resolved_play, resolved_title = resolve_tiktok_video_url(direct_url)
          if resolved_play:
            download_ok = download_stream_to_file(resolved_play, f_path)
            if download_ok and resolved_title:
              raw_title = resolved_title
        if download_ok:
          success_count += 1
          with open(txt_path, "w", encoding="utf-8") as f:
            f.write(convert_tiktok_hashtags_to_facebook(raw_title))
          db.execute(
            """INSERT INTO downloaded_videos (page_id, video_id, source, title, object_path)
            VALUES (%s, %s, 'TIKTOK', %s, %s)
            ON CONFLICT (page_id, source, video_id) DO NOTHING""",
            (page_id, v_id, raw_title, f_path)
          )
          db.execute(
            """INSERT INTO download_logs (page_id, source, video_id, title, object_path, status)
            VALUES (%s, 'TIKTOK', %s, %s, %s, 'SUCCESS')""",
            (page_id, v_id, raw_title, f_path)
          )
        if delay_sec > 0 and idx < len(videos) - 1:
          time.sleep(delay_sec)
      if success_count > 0:
        msg = f"Đã Tải {success_count} Video TikTok" + (f" (Đã Bỏ Qua {skipped_count} Video Trùng)" if skipped_count else "")
        st = "SUCCESS"
      elif skipped_count > 0:
        msg = f"Đã Có Sẵn {skipped_count} Video Trong Thư Mục (Đã Bỏ Qua Trùng Lặp)"
        st = "SUCCESS"
      else:
        st = "FAILED"
        if raw_link and raw_kw and len(videos) == 0:
          msg = f"Kênh '{raw_link}' Không Có Video Nào Khớp Từ Khóa '{raw_kw}'"
        elif len(videos) > 0:
          msg = f"Tìm Thấy {len(videos)} Video Nhưng Không Thể Tải File Về Máy"
        elif raw_link and raw_kw:
          msg = f"Kênh '{raw_link}' Không Có Video Nào Khớp Từ Khóa '{raw_kw}'"
        else:
          msg = f"Không Tìm Thấy Video Nào Khả Dụng Cho '{target_label}'"
      db.execute("UPDATE page_job_items SET status = %s, message = %s WHERE job_id = %s AND page_id = %s", (st, msg, job_id, page_id))
    except Exception as e:
      db.execute(
        """INSERT INTO download_logs (page_id, source, title, status, error_message)
        VALUES (%s, 'TIKTOK', %s, 'FAILED', %s)""",
        (page_id, target_label, str(e))
      )
      db.execute("UPDATE page_job_items SET status = 'FAILED', message = %s WHERE job_id = %s AND page_id = %s", (str(e), job_id, page_id))
    if delay_sec > 0:
      time.sleep(delay_sec)
  if concurrency <= 1 or len(items) <= 1:
    for it in items:
      process_tiktok_item(it)
  else:
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
      list(executor.map(process_tiktok_item, items))
  db.execute("UPDATE page_jobs SET status = 'FINISHED', finished_at = NOW() WHERE id = %s", (job_id,))
  with _jobs_lock:
    _active_jobs.pop("TIKTOK", None)
def run_youtube_download_task(job_id: int, config: dict):
  with _jobs_lock:
    _active_jobs["YOUTUBE"] = {"running": True, "job_id": job_id}
  db.execute("UPDATE page_jobs SET status = 'RUNNING', started_at = NOW() WHERE id = %s", (job_id,))
  items = config.get("items", [])
  folder = config.get("download_folder", "downloads/youtube")
  max_videos = int(config.get("max_videos", 5))
  delay_sec = int(config.get("delay_sec", 2))
  concurrency = max(1, min(int(config.get("concurrency", 1)), 10))
  cookie_browser = config.get("cookie_browser") or config.get("browser_cookies")
  cookie_file = config.get("cookie_file")
  os.makedirs(folder, exist_ok=True)
  try:
    from config.constants import YOUTUBE_CONFIG_PATH, YOUTUBE_CONFIG_INI_PATH
    import configparser
    with open(YOUTUBE_CONFIG_PATH, "w", encoding="utf-8") as f:
      json.dump({"download_folder": folder, "max_videos": max_videos}, f, ensure_ascii=False, indent=2)
    cp = configparser.ConfigParser()
    cp["YouTube"] = {"download_folder": str(folder), "max_videos": str(max_videos)}
    with open(YOUTUBE_CONFIG_INI_PATH, "w", encoding="utf-8") as f:
      cp.write(f)
  except Exception:
    pass
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
    if direct_matches:
      target_queries = direct_matches
    elif link:
      if kw:
        clean_channel = re.sub(r'/(shorts|videos|featured|playlists)$', '', link.rstrip("/"))
        target_queries = [f"{clean_channel}/search?query={urllib.parse.quote_plus(kw)}"]
      else:
        target_queries = [link]
    else:
      target_queries = [f"ytsearch{max_videos}:{kw} #shorts"]
    try:
      outtmpl = os.path.join(page_folder, "%(id)s.%(ext)s")
      ydl_opts = build_youtube_ydl_opts(outtmpl=outtmpl, cookie_browser=cookie_browser, cookie_file=cookie_file)
      search_opts = dict(ydl_opts)
      search_opts["extract_flat"] = "in_playlist"
      search_opts["playlistend"] = max(20, max_videos * 5) if (not direct_matches and link and kw) else max_videos
      downloaded_items = []
      skipped_count = 0
      last_error = ""
      with yt_dlp.YoutubeDL(search_opts) as ydl_search, yt_dlp.YoutubeDL(ydl_opts) as ydl:
        for tq in target_queries:
          if len(downloaded_items) >= max_videos:
            break
          try:
            info = ydl_search.extract_info(tq, download=False)
            raw_entries = info.get("entries") if (info and "entries" in info) else [info] if info else []
            entries = [e for e in raw_entries if e]
          except Exception as q_err:
            last_error = str(q_err)
            entries = []
          for ent in entries:
            if len(downloaded_items) >= max_videos:
              break
            v_id = str(ent.get("id") or "").strip()
            if not v_id:
              v_url = ent.get("url") or ""
              match = re.search(r'(?:v=|\/shorts\/|\/)([0-9A-Za-z_-]{11})', v_url)
              if match:
                v_id = match.group(1)
            if not v_id:
              continue
            raw_title = ent.get("title") or kw or "Video"
            clean_title = convert_youtube_hashtags_to_facebook(raw_title)
            if not direct_matches and link and kw:
              kw_lower = kw.strip().lower()
              title_lower = raw_title.lower()
              kw_tokens = [tok for tok in re.split(r'\s+', kw_lower) if tok]
              if kw_lower not in title_lower and not (kw_tokens and all(tok in title_lower for tok in kw_tokens)):
                continue
            exist = db.fetch_one("SELECT id FROM downloaded_videos WHERE page_id = %s AND source = 'YOUTUBE' AND video_id = %s", (page_id, v_id))
            existing_files = [f for f in os.listdir(page_folder) if f.startswith(f"{v_id}.") and not f.endswith(".txt") and not f.endswith(".part") and not f.endswith(".ytdl")] if os.path.exists(page_folder) else []
            if exist and existing_files and os.path.getsize(os.path.join(page_folder, existing_files[0])) > 1000:
              skipped_count += 1
              continue
            vid_url = f"https://www.youtube.com/watch?v={v_id}"
            try:
              ydl.download([vid_url])
              downloaded_files = [f for f in os.listdir(page_folder) if f.startswith(f"{v_id}.") and not f.endswith(".txt") and not f.endswith(".part") and not f.endswith(".ytdl")] if os.path.exists(page_folder) else []
              if downloaded_files:
                f_path = os.path.join(page_folder, downloaded_files[0])
                txt_path = os.path.join(page_folder, f"{v_id}.txt")
                with open(txt_path, "w", encoding="utf-8") as tf:
                  tf.write(clean_title)
                downloaded_items.append({"id": v_id, "title": clean_title, "path": f_path})
                db.execute(
                  """INSERT INTO downloaded_videos (page_id, video_id, source, title, object_path)
                  VALUES (%s, %s, 'YOUTUBE', %s, %s)
                  ON CONFLICT (page_id, source, video_id) DO NOTHING""",
                  (page_id, v_id, clean_title, f_path)
                )
                db.execute(
                  """INSERT INTO download_logs (page_id, source, video_id, title, object_path, status)
                  VALUES (%s, 'YOUTUBE', %s, %s, %s, 'SUCCESS')""",
                  (page_id, v_id, clean_title, f_path)
                )
            except Exception as dl_err:
              last_error = str(dl_err)
      if downloaded_items:
        msg = f"Đã Tải {len(downloaded_items)} Video YouTube" + (f" (Đã Bỏ Qua {skipped_count} Video Trùng)" if skipped_count else "")
        st = "SUCCESS"
      elif skipped_count > 0:
        msg = f"Đã Có Sẵn {skipped_count} Video Trong Thư Mục (Đã Bỏ Qua Trùng Lặp)"
        st = "SUCCESS"
      else:
        st = "FAILED"
        if last_error:
          msg = f"Lỗi Khi Tải Video: {last_error}"
        elif link and kw:
          msg = f"Kênh '{link}' Không Có Video Nào Khớp Từ Khóa '{kw}'"
        else:
          msg = "Không Tìm Thấy Video Khả Dụng"
      db.execute("UPDATE page_job_items SET status = %s, message = %s WHERE job_id = %s AND page_id = %s", (st, msg, job_id, page_id))
    except Exception as e:
      db.execute(
        """INSERT INTO download_logs (page_id, source, title, status, error_message)
        VALUES (%s, 'YOUTUBE', %s, 'FAILED', %s)""",
        (page_id, kw or link, str(e))
      )
      db.execute("UPDATE page_job_items SET status = 'FAILED', message = %s WHERE job_id = %s AND page_id = %s", (str(e), job_id, page_id))
    if delay_sec > 0:
      time.sleep(delay_sec)
  if concurrency <= 1 or len(items) <= 1:
    for it in items:
      process_youtube_item(it)
  else:
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
      list(executor.map(process_youtube_item, items))
  db.execute("UPDATE page_jobs SET status = 'FINISHED', finished_at = NOW() WHERE id = %s", (job_id,))
  with _jobs_lock:
    _active_jobs.pop("YOUTUBE", None)
