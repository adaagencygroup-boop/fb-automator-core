import os
import re
import json
import time
import urllib.parse
import threading
from typing import Dict, Any, List, Optional, Tuple
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from config.constants import DATA_DIR, TIKTOK_SESSION_PATH
PROFILE_DIR = os.path.abspath(str(DATA_DIR / "browser_profiles" / "tiktok_profile"))
SESSION_FILE = os.path.abspath(str(TIKTOK_SESSION_PATH))
_live_driver = None
_live_driver_lock = threading.Lock()
_is_opening = False
_last_cookie_check_ts = 0.0
_last_cookie_check_cache = {"connected": False}
def get_installed_chrome_path() -> Optional[str]:
  candidates = [
    os.path.join(os.environ.get("PROGRAMFILES", "C:\\Program Files"), "Google", "Chrome", "Application", "chrome.exe"),
    os.path.join(os.environ.get("PROGRAMFILES(X86)", "C:\\Program Files (x86)"), "Google", "Chrome", "Application", "chrome.exe"),
    os.path.join(os.environ.get("LOCALAPPDATA", ""), "Google", "Chrome", "Application", "chrome.exe")
  ]
  for p in candidates:
    if p and os.path.isfile(p):
      return p
  try:
    import winreg
    for root in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
      try:
        with winreg.OpenKey(root, r"Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe") as key:
          val, _ = winreg.QueryValueEx(key, "")
          if val and os.path.isfile(val):
            return val
      except Exception:
        pass
  except Exception:
    pass
  return None
def get_chrome_cookie_decryptor():
  try:
    import base64
    import ctypes
    from ctypes import wintypes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    local_state_path = os.path.join(PROFILE_DIR, "Local State")
    if not os.path.exists(local_state_path):
      return None
    with open(local_state_path, "r", encoding="utf-8") as f:
      ls = json.load(f)
    enc_key = base64.b64decode(ls["os_crypt"]["encrypted_key"])[5:]
    class DATA_BLOB(ctypes.Structure):
      _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]
    in_blob = DATA_BLOB(len(enc_key), ctypes.cast(enc_key, ctypes.POINTER(ctypes.c_byte)))
    out_blob = DATA_BLOB()
    if ctypes.windll.crypt32.CryptUnprotectData(ctypes.byref(in_blob), None, None, None, None, 0, ctypes.byref(out_blob)):
      key = ctypes.string_at(out_blob.pbData, out_blob.cbData)
      ctypes.windll.kernel32.LocalFree(out_blob.pbData)
      return AESGCM(key)
  except Exception:
    pass
  return None
def check_profile_cookies() -> Dict[str, Any]:
  global _last_cookie_check_ts, _last_cookie_check_cache
  now = time.time()
  if (now - _last_cookie_check_ts) < 3.0 and not _is_opening:
    return _last_cookie_check_cache
  db_path = os.path.join(PROFILE_DIR, "Default", "Network", "Cookies")
  if not os.path.exists(db_path):
    _last_cookie_check_ts = now
    _last_cookie_check_cache = {"connected": False}
    return {"connected": False}
  import sqlite3
  try:
    decryptor = get_chrome_cookie_decryptor()
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("SELECT name, value, encrypted_value FROM cookies WHERE host_key LIKE '%tiktok.com%'")
    rows = cur.fetchall()
    conn.close()
    cookies_list = []
    for r in rows:
      c_name = r[0]
      c_val = r[1] or ""
      c_enc = r[2]
      if not c_val and c_enc and decryptor and c_enc[:3] in (b"v10", b"v11"):
        try:
          c_val = decryptor.decrypt(c_enc[3:15], c_enc[15:], None).decode("utf-8", errors="ignore")
        except Exception:
          c_val = ""
      cookies_list.append({"name": c_name, "value": c_val})
    has_session = any(c["name"] in ["sessionid", "sessionid_ss", "sid_tt"] and c["value"] for c in cookies_list)
    if has_session:
      session_info = {
        "connected": True,
        "username": "",
        "cookies": cookies_list,
        "updated_at": int(time.time())
      }
      os.makedirs(os.path.dirname(SESSION_FILE), exist_ok=True)
      with open(SESSION_FILE, "w", encoding="utf-8") as f:
        json.dump(session_info, f, ensure_ascii=False, indent=2)
      _last_cookie_check_ts = now
      _last_cookie_check_cache = session_info
      return session_info
  except Exception:
    pass
  _last_cookie_check_ts = now
  _last_cookie_check_cache = {"connected": False}
  return {"connected": False}
def get_session_data() -> Dict[str, Any]:
  if os.path.exists(SESSION_FILE):
    try:
      with open(SESSION_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
        cookies = data.get("cookies", [])
        has_real_val = any(c.get("name") in ["sessionid", "sessionid_ss", "sid_tt"] and c.get("value") for c in cookies)
        if data.get("connected") and has_real_val:
          return data
    except Exception:
      pass
  return check_profile_cookies()
def is_tiktok_logged_in() -> bool:
  data = get_session_data()
  if not data.get("connected"):
    return False
  cookies = data.get("cookies", [])
  return any(c.get("name") in ["sessionid", "sessionid_ss", "sid_tt"] for c in cookies)
def get_tiktok_auth_status() -> Dict[str, Any]:
  global _is_opening
  data = get_session_data()
  cookies = data.get("cookies", []) if data.get("connected") else []
  is_logged = bool(data.get("connected") and any(c.get("name") in ["sessionid", "sessionid_ss", "sid_tt"] and c.get("value") for c in cookies))
  raw_user = data.get("username", "") if is_logged else ""
  safe_user = "" if raw_user.lower().startswith("user_") else raw_user
  return {
    "connected": is_logged,
    "username": safe_user,
    "updated_at": data.get("updated_at") if is_logged else None,
    "is_opening": _is_opening
  }
def disconnect_tiktok() -> bool:
  global _live_driver, _last_cookie_check_ts, _last_cookie_check_cache
  _last_cookie_check_ts = 0.0
  _last_cookie_check_cache = {"connected": False}
  with _live_driver_lock:
    if _live_driver is not None:
      try:
        _live_driver.quit()
      except Exception:
        pass
      _live_driver = None
  if os.path.exists(SESSION_FILE):
    try:
      os.remove(SESSION_FILE)
    except Exception:
      pass
  return True
def _watch_tiktok_login(driver: webdriver.Chrome):
  global _live_driver, _is_opening
  try:
    for _ in range(1800):
      time.sleep(2.0)
      if not getattr(driver, "window_handles", None):
        break
      try:
        curr_url = driver.current_url or ""
      except Exception:
        break
      cookies = []
      try:
        cookies = driver.get_cookies()
      except Exception:
        pass
      has_session = any(c.get("name") in ["sessionid", "sessionid_ss", "sid_tt"] for c in cookies)
      if has_session:
        username = ""
        u_match = re.search(r'tiktok\.com/@([a-zA-Z0-9_.-]+)', curr_url)
        if u_match:
          username = u_match.group(1)
        os.makedirs(os.path.dirname(SESSION_FILE), exist_ok=True)
        session_info = {
          "connected": True,
          "username": username or "",
          "cookies": cookies,
          "updated_at": int(time.time())
        }
        with open(SESSION_FILE, "w", encoding="utf-8") as f:
          json.dump(session_info, f, ensure_ascii=False, indent=2)
        try:
          driver.quit()
        except Exception:
          pass
        break
  finally:
    time.sleep(1.0)
    check_profile_cookies()
    with _live_driver_lock:
      _live_driver = None
      _is_opening = False
def open_tiktok_login_browser() -> Dict[str, Any]:
  global _live_driver, _is_opening
  with _live_driver_lock:
    if _live_driver is not None:
      try:
        if getattr(_live_driver, "window_handles", None):
          return {"status": "ALREADY_OPEN", "message": "Trình duyệt đăng nhập TikTok đã mở sẵn."}
      except Exception:
        _live_driver = None
    _is_opening = True
    os.makedirs(PROFILE_DIR, exist_ok=True)
    opts = Options()
    chrome_path = get_installed_chrome_path()
    if chrome_path:
      opts.binary_location = chrome_path
    opts.add_argument(f"--user-data-dir={PROFILE_DIR}")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_argument("--window-size=1280,850")
    opts.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)
    driver = webdriver.Chrome(service=Service(), options=opts)
    try:
      driver.execute_cdp_cmd(
        "Page.addScriptToEvaluateOnNewDocument",
        {
          "source": """
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
          """
        }
      )
    except Exception:
      pass
    driver.get("https://www.tiktok.com/login")
    _live_driver = driver
    threading.Thread(target=_watch_tiktok_login, args=(driver,), daemon=True).start()
    return {"status": "OPENED", "message": "Đã mở trình duyệt đăng nhập TikTok thành công."}
def search_tiktok_via_browser(keywords: str, count: int = 15) -> List[Dict[str, Any]]:
  global _live_driver
  clean_kw = keywords.strip()
  if not clean_kw:
    return []
  results = []
  seen = set()
  driver = None
  try:
    with _live_driver_lock:
      if _live_driver is not None:
        try:
          _live_driver.quit()
        except Exception:
          pass
        _live_driver = None
    os.makedirs(PROFILE_DIR, exist_ok=True)
    opts = Options()
    chrome_path = get_installed_chrome_path()
    if chrome_path:
      opts.binary_location = chrome_path
    opts.add_argument(f"--user-data-dir={PROFILE_DIR}")
    opts.add_argument("--headless=new")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_argument("--window-size=1920,1080")
    opts.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)
    driver = webdriver.Chrome(service=Service(), options=opts)
    try:
      driver.execute_cdp_cmd(
        "Page.addScriptToEvaluateOnNewDocument",
        {
          "source": """
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
          """
        }
      )
    except Exception:
      pass
    encoded = urllib.parse.quote_plus(clean_kw)
    driver.get(f"https://www.tiktok.com/search?q={encoded}")
    extract_js = "var m = document.querySelector('main') || document; return Array.from(m.querySelectorAll('a[href*=\"/video/\"]')).filter(function(a){ return !a.closest('header, [class*=\"Header\"], [class*=\"header\"], [inbox-notifications], [inbox-list], nav, aside'); }).map(function(a){ return a.href; });"
    for _ in range(12):
      time.sleep(1.0)
      raw_links = driver.execute_script(extract_js)
      if raw_links:
        break
    for _ in range(5):
      raw_links = driver.execute_script(extract_js) or []
      for href in raw_links:
        m = re.search(r'tiktok\.com/@([a-zA-Z0-9_.-]+)/video/(\d+)', href or "")
        if m:
          author = m.group(1)
          vid = m.group(2)
          if vid not in seen:
            seen.add(vid)
            results.append({
              "video_id": vid,
              "title": f"{clean_kw} Video {vid}",
              "source_url": f"https://www.tiktok.com/@{author}/video/{vid}",
              "author": {"unique_id": author}
            })
            if len(results) >= count:
              break
      if len(results) >= count:
        break
      driver.execute_script("window.scrollBy(0, 1500);")
      time.sleep(2.0)
  except Exception:
    pass
  finally:
    if driver is not None:
      try:
        driver.quit()
      except Exception:
        pass
  return results
