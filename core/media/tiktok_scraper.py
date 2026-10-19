import os
import re
import html
import json
import string
import time
import random
import urllib.parse
import threading
import requests
from typing import Optional, Dict, Any, List, Tuple
from pathlib import Path
from core.database.connection import db
from bs4 import BeautifulSoup
try:
  import curl_cffi.requests as c_requests
  HAS_CURL_CFFI = True
except ImportError:
  c_requests = None
  HAS_CURL_CFFI = False
api_call_lock = threading.Lock()
last_api_call_time = 0.0
USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0"
]
def get_tikwm_headers() -> Dict[str, str]:
  return {
    "User-Agent": random.choice(USER_AGENTS),
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
    "Origin": "https://tikwm.com",
    "Referer": "https://tikwm.com/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "X-Requested-With": "XMLHttpRequest"
  }
def safe_tikwm_request(target_url: str, params=None, data=None, method: str = "POST", timeout: int = 25, max_retries: int = 3) -> Dict[str, Any]:
  global last_api_call_time
  req_headers = get_tikwm_headers()
  for attempt in range(max_retries):
    with api_call_lock:
      now = time.time()
      elapsed = now - last_api_call_time
      if elapsed < 1.5:
        time.sleep(1.5 - elapsed)
      try:
        if HAS_CURL_CFFI and c_requests is not None:
          s = c_requests.Session(impersonate="chrome124")
          if method.upper() == "POST":
            resp = s.post(target_url, params=params, data=data, headers=req_headers, timeout=timeout)
          else:
            resp = s.get(target_url, params=params, headers=req_headers, timeout=timeout)
        else:
          if method.upper() == "POST":
            resp = requests.post(target_url, params=params, data=data, headers=req_headers, timeout=timeout)
          else:
            resp = requests.get(target_url, params=params, headers=req_headers, timeout=timeout)
        last_api_call_time = time.time()
        if resp.status_code == 200:
          try:
            res_json = resp.json()
          except Exception:
            res_json = None
          if res_json is not None:
            if res_json.get("code") == -1 and ("limit" in res_json.get("msg", "").lower() or "rate" in res_json.get("msg", "").lower()):
              pass
            else:
              return res_json
        elif resp.status_code in [403, 429, 502, 503, 504]:
          method = "GET" if method.upper() == "POST" else "POST"
          if method == "GET" and data and not params:
            params = data
        else:
          if attempt == max_retries - 1:
            return {"code": resp.status_code, "msg": f"HTTP Error {resp.status_code}"}
      except Exception as e:
        last_api_call_time = time.time()
        if attempt == max_retries - 1:
          return {"code": -1, "msg": str(e)}
    time.sleep(random.uniform(2.0, 3.5))
  return {"code": -1, "msg": "TikWM connection failed"}
def fetch_tiktok_user_videos(username_or_url: str, count: int = 15) -> List[Dict[str, Any]]:
  raw = username_or_url.strip()
  u_match = re.search(r'tiktok\.com/@([a-zA-Z0-9_.-]+)', raw)
  if u_match:
    username = u_match.group(1)
  elif raw.startswith("@"):
    username = raw.lstrip("@").strip()
  else:
    username = raw.split("/")[0].strip()
  if not username:
    return []
  results = []
  seen = set()
  try:
    if HAS_CURL_CFFI and c_requests is not None:
      s_tt = c_requests.Session(impersonate="chrome124")
      headers_page = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": "https://www.google.com/"
      }
      r_prof = s_tt.get(f"https://www.tiktok.com/@{username}", headers=headers_page, timeout=12)
      if r_prof.status_code == 200:
        m_rehyd = re.search(r'<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)</script>', r_prof.text, re.DOTALL)
        if m_rehyd:
          u_data = json.loads(m_rehyd.group(1))
          ud = u_data.get("__DEFAULT_SCOPE__", {}).get("webapp.user-detail", {})
          sec_uid = ud.get("userInfo", {}).get("user", {}).get("secUid")
          if sec_uid:
            dev_id = str(random.randint(7250000000000000000, 7325099899999994577))
            verify_fp = f'verify_{"".join(random.choices(string.hexdigits, k=7))}'
            headers_api = {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
              "Referer": f"https://www.tiktok.com/@{username}",
              "Accept": "*/*"
            }
            page_cursor = "0"
            while len(results) < count:
              batch_size = min(15, count - len(results))
              params_creator = {
                "aid": "1988",
                "app_language": "en",
                "app_name": "tiktok_web",
                "browser_language": "en-US",
                "browser_name": "Mozilla",
                "browser_online": "true",
                "browser_platform": "Win32",
                "browser_version": "5.0 (Windows)",
                "channel": "tiktok_web",
                "cookie_enabled": "true",
                "count": str(batch_size),
                "cursor": page_cursor,
                "device_id": dev_id,
                "device_platform": "web_pc",
                "focus_state": "true",
                "from_page": "user",
                "history_len": "2",
                "is_fullscreen": "false",
                "is_page_visible": "true",
                "language": "en",
                "os": "windows",
                "priority_region": "",
                "referer": "",
                "region": "US",
                "screen_height": "1080",
                "screen_width": "1920",
                "secUid": sec_uid,
                "type": "1",
                "tz_name": "UTC",
                "verifyFp": verify_fp,
                "webcast_language": "en",
              }
              r_api = s_tt.get("https://www.tiktok.com/api/creator/item_list/", params=params_creator, headers=headers_api, timeout=12)
              if r_api.status_code != 200:
                break
              data_api = r_api.json()
              items = data_api.get("itemList", [])
              if not items:
                break
              for it in items:
                v_id = str(it.get("id"))
                if v_id and v_id not in seen:
                  seen.add(v_id)
                  desc = it.get("desc", "").strip()
                  v_play = it.get("video", {}).get("playAddr") or it.get("video", {}).get("downloadAddr")
                  results.append({
                    "video_id": v_id,
                    "title": desc if desc else f"{username} Video {v_id}",
                    "play": None,
                    "source_url": f"https://www.tiktok.com/@{username}/video/{v_id}",
                    "author": {"unique_id": username}
                  })
                  if len(results) >= count:
                    break
              if not data_api.get("hasMore"):
                break
              page_cursor = str(data_api.get("cursor", ""))
              if not page_cursor or page_cursor == "0":
                break
            if results:
              return results
  except Exception:
    pass
  if len(results) >= count:
    return results
  user_posts_url = "https://tikwm.com/api/user/posts"
  data = safe_tikwm_request(user_posts_url, params={"unique_id": username, "count": count}, method="GET", timeout=15)
  if data.get("code") == 0 and data.get("data", {}).get("videos"):
    for v in data["data"]["videos"]:
      v_id = str(v.get("video_id") or v.get("id"))
      if v_id and v_id not in seen:
        seen.add(v_id)
        results.append({
          "video_id": v_id,
          "title": v.get("title") or f"{username} Video {v_id}",
          "play": v.get("play") or v.get("hdplay") or v.get("wmplay"),
          "source_url": f"https://www.tiktok.com/@{username}/video/{v_id}",
          "author": {"unique_id": username}
        })
        if len(results) >= count:
          return results
  if len(results) < count:
    ub_url = f"https://urlebird.com/user/{username}/"
    profile = random.choice(URLEBIRD_BROWSER_PROFILES)
    headers = get_urlebird_headers(profile)
    html_body = ""
    try:
      if HAS_CURL_CFFI and c_requests is not None and profile.get("impersonate"):
        s = c_requests.Session(impersonate=profile["impersonate"])
        r = s.get(ub_url, headers=headers, timeout=10)
      else:
        r = requests.get(ub_url, headers=headers, timeout=10)
      if r.status_code == 200 and r.text:
        html_body = r.text
      elif (r.status_code in [403, 503] or "cloudflare" in r.text.lower()) and check_flaresolverr():
        fs_res = request_via_flaresolverr(ub_url, timeout=15)
        if fs_res:
          html_body = fs_res
    except Exception:
      if check_flaresolverr():
        fs_res = request_via_flaresolverr(ub_url, timeout=15)
        if fs_res:
          html_body = fs_res
    if html_body:
      for m in re.findall(r'href=["\']((?:https?://urlebird\.com)?/video/[^"\'?#]+)["\']', html_body):
        full_url = m if m.startswith("http") else f"https://urlebird.com{m}"
        vid_match = re.search(r'(\d{15,22})', full_url)
        if vid_match and vid_match.group(1) not in seen:
          v_id = vid_match.group(1)
          seen.add(v_id)
          results.append({
            "video_id": v_id,
            "title": f"{username} Video {v_id}",
            "author": {"unique_id": username},
            "urlebird_url": full_url,
            "source_url": f"https://www.tiktok.com/@{username}/video/{v_id}"
          })
          if len(results) >= count:
            break
  return results
def search_tiktok_videos(keywords: str, cursor: int = 0, count: int = 15) -> Dict[str, Any]:
  search_url = "https://tikwm.com/api/feed/search"
  params = {"keywords": keywords, "count": count, "cursor": cursor, "web": 1}
  data = safe_tikwm_request(search_url, data=params, method="POST", timeout=20)
  if data.get("code") == 0 and data.get("data", {}).get("videos"):
    return data
  data_get = safe_tikwm_request(search_url, params=params, method="GET", timeout=20)
  if data_get.get("code") == 0 and data_get.get("data", {}).get("videos"):
    return data_get
  try:
    from core.media.tiktok_browser import search_tiktok_via_browser
    browser_vids = search_tiktok_via_browser(keywords, count=count)
    if browser_vids:
      return {"code": 0, "msg": "success", "data": {"videos": browser_vids}}
  except Exception:
    pass
  return {"code": -1, "msg": "No TikTok videos found", "data": {"videos": []}}
def resolve_tiktok_video_url(raw_url_or_id: str, urlebird_url: Optional[str] = None) -> Tuple[Optional[str], str]:
  url = raw_url_or_id if raw_url_or_id.startswith("http") else f"https://www.tiktok.com/@user/video/{raw_url_or_id}"
  try:
    detail_resp = safe_tikwm_request("https://tikwm.com/api/", data={"url": url, "hd": 1}, method="POST", timeout=20)
    if detail_resp.get("code") == 0 and detail_resp.get("data"):
      d = detail_resp["data"]
      play = d.get("play") or d.get("hdplay") or d.get("wmplay")
      if play:
        return play, d.get("title", "")
  except Exception:
    pass
  return None, ""
def download_stream_to_file(download_url: str, save_path: str) -> bool:
  if not download_url:
    return False
  headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.tiktok.com/",
    "Origin": "https://www.tiktok.com",
    "Range": "bytes=0-",
    "Sec-Fetch-Dest": "video",
    "Sec-Fetch-Mode": "no-cors",
    "Sec-Fetch-Site": "cross-site",
  }
  for attempt in range(3):
    try:
      with requests.get(download_url, headers=headers, stream=True, timeout=30) as r:
        if r.status_code in (200, 206):
          with open(save_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=256 * 1024):
              if chunk:
                f.write(chunk)
          if os.path.exists(save_path) and os.path.getsize(save_path) > 1000:
            return True
    except Exception:
      pass
    time.sleep(0.5)
  return False
def convert_tiktok_hashtags_to_facebook(text: str) -> str:
  if not text:
    return ""
  replacements = {
    r'#fyp\b': '#reels',
    r'#xuhuong\b': '#facebook',
    r'#tiktok\b': '#facebook',
    r'#tik_tok\b': '#fb',
    r'#trending\b': '#viral',
    r'#fypシ\b': '#viral',
    r'#foryou\b': '#reels'
  }
  for pattern, repl in replacements.items():
    text = re.sub(pattern, repl, text, flags=re.IGNORECASE)
  return text
class TikTokScraper:
  def __init__(self, timeout: int = 30):
    self.timeout = timeout
    self.session = requests.Session()
    self.session.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})
  def is_downloaded(self, video_id: str) -> bool:
    row = db.fetch_one("SELECT id FROM videos_cache WHERE video_id = %s AND platform = 'tiktok'", (video_id,))
    return row is not None
  def mark_downloaded(self, video_id: str, page_id: str, source_url: str, file_path: str):
    db.execute(
      "INSERT INTO videos_cache (video_id, platform, page_id, source_url, file_path) VALUES (%s, 'tiktok', %s, %s, %s) ON CONFLICT (video_id, platform) DO NOTHING",
      (video_id, page_id, source_url, file_path)
    )
  def extract_video_info_tikwm(self, video_url: str) -> Optional[Dict[str, Any]]:
    play_url, title = resolve_tiktok_video_url(video_url)
    if play_url:
      vid_match = re.search(r'(\d{15,22})', video_url)
      vid = vid_match.group(1) if vid_match else str(int(time.time() * 1000))
      return {"video_id": vid, "title": title, "play_url": play_url, "hd_url": play_url}
    return None
  def download_to_page_pipeline(self, video_url: str, page_folder: str, page_id: str = "") -> Optional[Dict[str, Any]]:
    play_url, title = resolve_tiktok_video_url(video_url)
    if not play_url:
      return None
    vid_match = re.search(r'(\d{15,22})', video_url)
    video_id = vid_match.group(1) if vid_match else str(int(time.time() * 1000))
    if self.is_downloaded(video_id):
      return {"skipped": True, "reason": "Already downloaded", "video_id": video_id}
    target_base = Path(page_folder)
    target_base.mkdir(parents=True, exist_ok=True)
    existing_subdirs = [int(p.name) for p in target_base.iterdir() if p.is_dir() and p.name.isdigit()]
    next_idx = max(existing_subdirs) + 1 if existing_subdirs else 1
    video_subfolder = target_base / str(next_idx)
    video_subfolder.mkdir(parents=True, exist_ok=True)
    video_file_path = video_subfolder / f"{video_id}.mp4"
    caption_file_path = video_subfolder / "caption.txt"
    if download_stream_to_file(play_url, str(video_file_path)):
      with open(caption_file_path, "w", encoding="utf-8") as f:
        f.write(convert_tiktok_hashtags_to_facebook(title))
      self.mark_downloaded(video_id, page_id, video_url, str(video_file_path))
      return {"success": True, "video_id": video_id, "folder_index": next_idx, "video_path": str(video_file_path), "caption": title}
    return None
tiktok_scraper = TikTokScraper()
