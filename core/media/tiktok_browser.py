import os
import re
import json
import time
import urllib.parse
import threading
from typing import Callable, Dict, Any, Iterable, List, Optional, Set
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from config.constants import DATA_DIR, TIKTOK_SESSION_PATH
PROFILE_DIR = os.path.abspath(str(DATA_DIR / "browser_profiles" / "tiktok_profile"))
SESSION_FILE = os.path.abspath(str(TIKTOK_SESSION_PATH))
DEFAULT_DESKTOP_UA = (
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
)
_live_driver = None
_live_driver_lock = threading.Lock()
_browser_session_lock = threading.Lock()
_is_opening = False
_last_cookie_check_ts = 0.0
_last_cookie_check_cache = {"connected": False}
def get_installed_chrome_path() -> Optional[str]:
  candidates = [
    os.path.join(os.environ.get("PROGRAMFILES", "C:\\Program Files"), "Google", "Chrome", "Application", "chrome.exe"),
    os.path.join(os.environ.get("PROGRAMFILES(X86)", "C:\\Program Files (x86)"), "Google", "Chrome", "Application", "chrome.exe"),
    os.path.join(os.environ.get("LOCALAPPDATA", ""), "Google", "Chrome", "Application", "chrome.exe"),
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
    if ctypes.windll.crypt32.CryptUnprotectData(
      ctypes.byref(in_blob), None, None, None, None, 0, ctypes.byref(out_blob)
    ):
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
    cur.execute(
      "SELECT name, value, encrypted_value, host_key, path, is_secure, expires_utc "
      "FROM cookies WHERE host_key LIKE '%tiktok.com%'"
    )
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
      cookies_list.append({
        "name": c_name,
        "value": c_val,
        "domain": r[3] or ".tiktok.com",
        "path": r[4] or "/",
        "secure": bool(r[5]),
      })
    has_session = any(c["name"] in ["sessionid", "sessionid_ss", "sid_tt"] and c["value"] for c in cookies_list)
    if has_session:
      session_info = {
        "connected": True,
        "username": "",
        "cookies": cookies_list,
        "updated_at": int(time.time()),
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
        has_real_val = any(
          c.get("name") in ["sessionid", "sessionid_ss", "sid_tt"] and c.get("value")
          for c in cookies
        )
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
  return any(c.get("name") in ["sessionid", "sessionid_ss", "sid_tt"] and c.get("value") for c in cookies)
def get_tiktok_auth_status() -> Dict[str, Any]:
  global _is_opening
  data = get_session_data()
  cookies = data.get("cookies", []) if data.get("connected") else []
  is_logged = bool(
    data.get("connected")
    and any(c.get("name") in ["sessionid", "sessionid_ss", "sid_tt"] and c.get("value") for c in cookies)
  )
  raw_user = data.get("username", "") if is_logged else ""
  safe_user = "" if raw_user.lower().startswith("user_") else raw_user
  return {
    "connected": is_logged,
    "username": safe_user,
    "updated_at": data.get("updated_at") if is_logged else None,
    "is_opening": _is_opening,
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
          "updated_at": int(time.time()),
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
    opts.add_argument(f"user-agent={DEFAULT_DESKTOP_UA}")
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
        },
      )
    except Exception:
      pass
    driver.get("https://www.tiktok.com/login")
    _live_driver = driver
    threading.Thread(target=_watch_tiktok_login, args=(driver,), daemon=True).start()
    return {"status": "OPENED", "message": "Đã mở trình duyệt đăng nhập TikTok thành công."}
def _create_headless_tiktok_driver() -> webdriver.Chrome:
  global _live_driver
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
  opts.add_argument("--mute-audio")
  opts.add_argument("--autoplay-policy=no-user-gesture-required")
  opts.add_argument("--disable-blink-features=AutomationControlled")
  opts.add_argument("--window-size=1920,1080")
  opts.add_argument(f"user-agent={DEFAULT_DESKTOP_UA}")
  opts.add_experimental_option("excludeSwitches", ["enable-automation"])
  opts.add_experimental_option("useAutomationExtension", False)
  driver = webdriver.Chrome(service=Service(), options=opts)
  try:
    driver.set_page_load_timeout(30)
  except Exception:
    pass
  try:
    driver.execute_cdp_cmd(
      "Page.addScriptToEvaluateOnNewDocument",
      {
        "source": """
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        """
      },
    )
  except Exception:
    pass
  return driver
class TikTokBrowserSession:
  def __init__(self):
    self.driver: Optional[webdriver.Chrome] = None
    self._acquired = False
  def __enter__(self) -> "TikTokBrowserSession":
    _browser_session_lock.acquire()
    self._acquired = True
    try:
      self.driver = _create_headless_tiktok_driver()
      return self
    except Exception:
      self.close()
      raise
  def close(self):
    if self.driver is not None:
      try:
        self.driver.quit()
      except Exception:
        pass
      self.driver = None
    if self._acquired:
      self._acquired = False
      try:
        _browser_session_lock.release()
      except Exception:
        pass
  def __exit__(self, exc_type, exc_val, exc_tb):
    self.close()
def _should_stop(stop_check: Optional[Callable[[], bool]]) -> bool:
  if not stop_check:
    return False
  try:
    return bool(stop_check())
  except Exception:
    return False
def _clean_caption(text: str) -> str:
  if not text:
    return ""
  return re.sub(r"\s+", " ", str(text)).strip()
def _extract_dom_video_cards(driver: webdriver.Chrome, mode: str = "search") -> List[Dict[str, str]]:
  js = """
    var mode = arguments[0];
    var root = document.querySelector('main') || document;
    var anchors = Array.from(root.querySelectorAll('a[href*="/video/"]'));
    var out = [];
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      if (a.closest('header, [class*="Header"], [class*="header"], [inbox-notifications], [inbox-list], nav, aside')) {
        continue;
      }
      var href = a.href || '';
      if (!href) continue;
      var caption = '';
      var card = null;
      if (mode === 'profile') {
        card = a.closest('[data-e2e="user-post-item"], [class*="DivItemContainer"]') || a.parentElement;
      } else {
        card = a.closest('[data-e2e="search_video-item"], [data-e2e="search-card-item"], [data-e2e="search_top-item"], [class*="DivItemContainer"], [class*="ItemContainer"], article, li') || a.parentElement;
      }
      var selectors = mode === 'profile'
        ? ['[data-e2e="user-post-item-desc"]', '[class*="Caption"]', '[class*="Desc"]']
        : ['[data-e2e="search-card-video-caption"]', '[data-e2e="search-card-desc"]', '[data-e2e="video-desc"]', '[class*="DivCardDesc"]', '[class*="Caption"]'];
      var searchScopes = [card, card ? card.parentElement : null];
      for (var s = 0; s < searchScopes.length && !caption; s++) {
        var scope = searchScopes[s];
        if (!scope) continue;
        for (var j = 0; j < selectors.length && !caption; j++) {
          var el = scope.querySelector(selectors[j]);
          if (el && el.innerText && el.innerText.trim()) {
            caption = el.innerText.trim();
          }
        }
      }
      if (!caption) {
        var titleAttr = a.getAttribute('title');
        if (titleAttr && titleAttr.trim()) caption = titleAttr.trim();
      }
      if (!caption) {
        var img = a.querySelector('img[alt]') || (card ? card.querySelector('img[alt]') : null);
        if (img && img.alt && img.alt.trim()) caption = img.alt.trim();
      }
      out.push({ href: href, title: caption });
    }
    return out;
  """
  try:
    return driver.execute_script(js, mode) or []
  except Exception:
    return []
def _matches_any_keyword(title: str, keywords: List[str]) -> bool:
  t = (title or "").lower()
  if not t:
    return False
  for kw in keywords:
    tokens = [tok for tok in re.split(r"\s+", kw) if tok]
    if kw in t or (tokens and all(tok in t for tok in tokens)):
      return True
  return False
def _search_tiktok_with_driver(
  driver: webdriver.Chrome,
  keywords: str,
  count: int = 15,
  exclude_ids: Optional[Set[str]] = None,
  max_scrolls: int = 12,
  stop_check: Optional[Callable[[], bool]] = None,
) -> List[Dict[str, Any]]:
  clean_kw = (keywords or "").strip()
  if not clean_kw:
    return []
  excluded = set(exclude_ids or ())
  results: List[Dict[str, Any]] = []
  seen: Set[str] = set()
  new_unseen = 0
  encoded = urllib.parse.quote_plus(clean_kw)
  search_urls = [
    f"https://www.tiktok.com/search/video?q={encoded}",
    f"https://www.tiktok.com/search?q={encoded}",
  ]
  for search_url in search_urls:
    if _should_stop(stop_check):
      break
    try:
      driver.get(search_url)
    except Exception:
      continue
    found_initial = False
    for _ in range(12):
      if _should_stop(stop_check):
        return results
      time.sleep(1.0)
      cards = _extract_dom_video_cards(driver, mode="search")
      if cards:
        found_initial = True
        break
    if not found_initial:
      continue
    stalled = 0
    for _ in range(max_scrolls):
      if _should_stop(stop_check):
        break
      cards = _extract_dom_video_cards(driver, mode="search")
      added_this_round = 0
      for card in cards:
        href = card.get("href") or ""
        m = re.search(r"tiktok\.com/@([a-zA-Z0-9_.-]+)/video/(\d+)", href)
        if not m:
          continue
        author = m.group(1)
        vid = m.group(2)
        if vid in seen:
          continue
        seen.add(vid)
        added_this_round += 1
        title = _clean_caption(card.get("title") or "")
        results.append({
          "video_id": vid,
          "title": title or f"{clean_kw} Video {vid}",
          "source_url": f"https://www.tiktok.com/@{author}/video/{vid}",
          "author": {"unique_id": author},
        })
        if vid not in excluded:
          new_unseen += 1
      if new_unseen >= count:
        break
      if added_this_round == 0:
        stalled += 1
        if stalled >= 3:
          break
      else:
        stalled = 0
      try:
        driver.execute_script("window.scrollBy(0, 1800);")
      except Exception:
        break
      time.sleep(2.0)
    if results:
      break
  return results
def search_tiktok_via_browser(
  keywords: str,
  count: int = 15,
  driver: Optional[webdriver.Chrome] = None,
  exclude_ids: Optional[Iterable[str]] = None,
  max_scrolls: int = 12,
  stop_check: Optional[Callable[[], bool]] = None,
) -> List[Dict[str, Any]]:
  excluded = {str(x) for x in (exclude_ids or ())}
  if driver is not None:
    return _search_tiktok_with_driver(
      driver, keywords, count=count, exclude_ids=excluded, max_scrolls=max_scrolls, stop_check=stop_check
    )
  try:
    with TikTokBrowserSession() as sess:
      return _search_tiktok_with_driver(
        sess.driver, keywords, count=count, exclude_ids=excluded, max_scrolls=max_scrolls, stop_check=stop_check
      )
  except Exception:
    return []
def _parse_tiktok_username(username_or_url: str) -> str:
  raw = (username_or_url or "").strip()
  u_match = re.search(r"tiktok\.com/@([a-zA-Z0-9_.-]+)", raw)
  if u_match:
    return u_match.group(1)
  if raw.startswith("@"):
    return raw.lstrip("@").split("/")[0].split("?")[0].strip()
  return raw.split("/")[0].split("?")[0].strip()
def _fetch_channel_with_driver(
  driver: webdriver.Chrome,
  username_or_url: str,
  count: int = 30,
  exclude_ids: Optional[Set[str]] = None,
  match_keywords: Optional[List[str]] = None,
  max_scrolls: int = 18,
  stop_check: Optional[Callable[[], bool]] = None,
) -> List[Dict[str, Any]]:
  username = _parse_tiktok_username(username_or_url)
  if not username:
    return []
  excluded = set(exclude_ids or ())
  kw_list = [k.strip().lower() for k in (match_keywords or []) if k and k.strip()]
  results: List[Dict[str, Any]] = []
  seen: Set[str] = set()
  new_unseen = 0
  matched_unseen = 0
  try:
    driver.get(f"https://www.tiktok.com/@{username}")
  except Exception:
    return []
  found_initial = False
  for _ in range(12):
    if _should_stop(stop_check):
      return results
    time.sleep(1.0)
    cards = _extract_dom_video_cards(driver, mode="profile")
    if cards:
      found_initial = True
      break
  if not found_initial:
    return results
  stalled = 0
  for _ in range(max_scrolls):
    if _should_stop(stop_check):
      break
    cards = _extract_dom_video_cards(driver, mode="profile")
    added_this_round = 0
    for card in cards:
      href = card.get("href") or ""
      m = re.search(r"tiktok\.com/@([a-zA-Z0-9_.-]+)/video/(\d+)", href)
      if not m:
        continue
      author = m.group(1)
      vid = m.group(2)
      if author.lower() != username.lower():
        continue
      if vid in seen:
        continue
      seen.add(vid)
      added_this_round += 1
      title = _clean_caption(card.get("title") or "")
      results.append({
        "video_id": vid,
        "title": title or f"{username} Video {vid}",
        "source_url": f"https://www.tiktok.com/@{author}/video/{vid}",
        "author": {"unique_id": author},
      })
      if vid not in excluded:
        new_unseen += 1
        if kw_list and _matches_any_keyword(title, kw_list):
          matched_unseen += 1
    if kw_list:
      if matched_unseen >= count:
        break
    else:
      if new_unseen >= count:
        break
    if added_this_round == 0:
      stalled += 1
      if stalled >= 3:
        break
    else:
      stalled = 0
    try:
      driver.execute_script("window.scrollBy(0, 2000);")
    except Exception:
      break
    time.sleep(2.0)
  return results
def fetch_tiktok_channel_via_browser(
  username_or_url: str,
  count: int = 30,
  driver: Optional[webdriver.Chrome] = None,
  exclude_ids: Optional[Iterable[str]] = None,
  match_keywords: Optional[List[str]] = None,
  max_scrolls: int = 18,
  stop_check: Optional[Callable[[], bool]] = None,
) -> List[Dict[str, Any]]:
  excluded = {str(x) for x in (exclude_ids or ())}
  if driver is not None:
    return _fetch_channel_with_driver(
      driver,
      username_or_url,
      count=count,
      exclude_ids=excluded,
      match_keywords=match_keywords,
      max_scrolls=max_scrolls,
      stop_check=stop_check,
    )
  try:
    with TikTokBrowserSession() as sess:
      return _fetch_channel_with_driver(
        sess.driver,
        username_or_url,
        count=count,
        exclude_ids=excluded,
        match_keywords=match_keywords,
        max_scrolls=max_scrolls,
        stop_check=stop_check,
      )
  except Exception:
    return []
def _collect_urls_from_addr(addr: Any) -> List[str]:
  urls: List[str] = []
  if isinstance(addr, str) and addr.startswith("http"):
    urls.append(addr)
  elif isinstance(addr, dict):
    for key in ("UrlList", "url_list"):
      val = addr.get(key)
      if isinstance(val, list):
        for u in val:
          if isinstance(u, str) and u.startswith("http"):
            urls.append(u)
  return urls
def _extract_item_struct_from_rehydration(rehyd_text: str) -> Dict[str, Any]:
  if not rehyd_text:
    return {}
  try:
    data = json.loads(rehyd_text)
  except Exception:
    return {}
  scope = data.get("__DEFAULT_SCOPE__", {}) if isinstance(data, dict) else {}
  vd = scope.get("webapp.video-detail", {}) if isinstance(scope, dict) else {}
  item_info = vd.get("itemInfo", {}) if isinstance(vd, dict) else {}
  item_struct = item_info.get("itemStruct", {}) if isinstance(item_info, dict) else {}
  return item_struct if isinstance(item_struct, dict) else {}
def _resolve_video_with_driver(
  driver: webdriver.Chrome,
  video_url_or_id: str,
  stop_check: Optional[Callable[[], bool]] = None,
) -> Dict[str, Any]:
  raw = (video_url_or_id or "").strip()
  if not raw:
    return {}
  if raw.startswith("http://") or raw.startswith("https://"):
    target_url = raw
  else:
    vid_m = re.search(r"(\d{15,22})", raw)
    target_url = f"https://www.tiktok.com/@_/video/{vid_m.group(1) if vid_m else raw}"
  try:
    driver.get(target_url)
  except Exception:
    return {}
  extract_page_js = """
    var rehyd = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
    var rehydText = rehyd ? rehyd.textContent : '';
    var vidUrls = [];
    var videos = document.querySelectorAll('video');
    for (var i = 0; i < videos.length; i++) {
      var v = videos[i];
      if (v.currentSrc && v.currentSrc.indexOf('http') === 0) vidUrls.push(v.currentSrc);
      if (v.src && v.src.indexOf('http') === 0) vidUrls.push(v.src);
      var sources = v.querySelectorAll('source');
      for (var j = 0; j < sources.length; j++) {
        if (sources[j].src && sources[j].src.indexOf('http') === 0) vidUrls.push(sources[j].src);
      }
    }
    var descEl = document.querySelector('[data-e2e="browse-video-desc"], [data-e2e="video-desc"]');
    var domDesc = descEl ? (descEl.innerText || '').trim() : '';
    if (!domDesc) {
      var meta = document.querySelector('meta[name="description"]');
      if (meta && meta.content) domDesc = meta.content.trim();
    }
    return {
      currentUrl: window.location.href || '',
      userAgent: navigator.userAgent || '',
      rehydText: rehydText || '',
      domVideoUrls: vidUrls,
      domDesc: domDesc || '',
      docTitle: document.title || ''
    };
  """
  page_data: Dict[str, Any] = {}
  item_struct: Dict[str, Any] = {}
  for _ in range(10):
    if _should_stop(stop_check):
      break
    time.sleep(1.0)
    try:
      page_data = driver.execute_script(extract_page_js) or {}
    except Exception:
      page_data = {}
    item_struct = _extract_item_struct_from_rehydration(page_data.get("rehydText") or "")
    has_video_src = bool(page_data.get("domVideoUrls"))
    has_struct_video = bool(item_struct.get("video"))
    if has_video_src or has_struct_video:
      break
  curr_url = page_data.get("currentUrl") or target_url
  url_match = re.search(r"tiktok\.com/@([a-zA-Z0-9_.-]+)/video/(\d+)", curr_url)
  fallback_vid_match = re.search(r"(\d{15,22})", curr_url) or re.search(r"(\d{15,22})", target_url)
  video_id = str(
    item_struct.get("id")
    or (url_match.group(2) if url_match else "")
    or (fallback_vid_match.group(1) if fallback_vid_match else "")
  )
  author_obj = item_struct.get("author") if isinstance(item_struct.get("author"), dict) else {}
  author = str(
    author_obj.get("uniqueId")
    or (url_match.group(1) if url_match else "")
    or "user"
  )
  title = _clean_caption(
    item_struct.get("desc")
    or page_data.get("domDesc")
    or ""
  )
  play_urls: List[str] = []
  seen_urls: Set[str] = set()
  def _add_urls(candidates: List[str]):
    for u in candidates:
      if u and u.startswith("http") and u not in seen_urls:
        seen_urls.add(u)
        play_urls.append(u)
  video_obj = item_struct.get("video") if isinstance(item_struct.get("video"), dict) else {}
  bitrate_info = video_obj.get("bitrateInfo")
  if isinstance(bitrate_info, list) and bitrate_info:
    h264_entries = []
    other_entries = []
    for entry in bitrate_info:
      if not isinstance(entry, dict):
        continue
      codec = str(entry.get("CodecType") or "").lower()
      if "h264" in codec or "avc" in codec:
        h264_entries.append(entry)
      else:
        other_entries.append(entry)
    h264_entries.sort(key=lambda e: int(e.get("Bitrate") or 0), reverse=True)
    other_entries.sort(key=lambda e: int(e.get("Bitrate") or 0), reverse=True)
    for entry in h264_entries + other_entries:
      _add_urls(_collect_urls_from_addr(entry.get("PlayAddr")))
  _add_urls(_collect_urls_from_addr(video_obj.get("playAddr")))
  _add_urls(page_data.get("domVideoUrls") or [])
  _add_urls(_collect_urls_from_addr(video_obj.get("downloadAddr")))
  cookies: List[Dict[str, Any]] = []
  try:
    cookies = driver.get_cookies() or []
  except Exception:
    cookies = []
  canonical_url = (
    f"https://www.tiktok.com/@{author}/video/{video_id}"
    if (video_id and author and author != "user")
    else curr_url
  )
  return {
    "video_id": video_id,
    "author": author,
    "title": title,
    "source_url": canonical_url,
    "play_urls": play_urls,
    "cookies": cookies,
    "user_agent": page_data.get("userAgent") or DEFAULT_DESKTOP_UA,
  }
def resolve_tiktok_video_via_browser(
  video_url_or_id: str,
  driver: Optional[webdriver.Chrome] = None,
  stop_check: Optional[Callable[[], bool]] = None,
) -> Dict[str, Any]:
  if driver is not None:
    return _resolve_video_with_driver(driver, video_url_or_id, stop_check=stop_check)
  try:
    with TikTokBrowserSession() as sess:
      return _resolve_video_with_driver(sess.driver, video_url_or_id, stop_check=stop_check)
  except Exception:
    return {}
