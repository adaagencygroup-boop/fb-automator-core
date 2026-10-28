# -*- coding: utf-8 -*-
"""
File: core/tiktok_downloader.py
"""
import os
import time
import datetime
import requests
import re
import random
import urllib.parse
import threading
from concurrent.futures import ThreadPoolExecutor
from core.qt_compat import QThread, pyqtSignal

try:
    import curl_cffi.requests as c_requests  # type: ignore
    HAS_CURL_CFFI = True
except ImportError:
    c_requests = None
    HAS_CURL_CFFI = False

db_lock = threading.Lock()

# Lock toàn cục để giới hạn tần suất gọi API TikWM (tránh lỗi Free Api Limit)
api_call_lock = threading.Lock()
last_api_call_time = 0.0

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0"
]

# Browser Profiles nhất quán cho UrleBird
URLEBIRD_BROWSER_PROFILES = [
    {
        "name": "Chrome 126 Windows",
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
        "sec_ch_ua_mobile": "?0",
        "sec_ch_ua_platform": '"Windows"',
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "accept_language": "en-US,en;q=0.9,vi;q=0.8",
        "impersonate": "chrome124",
    },
    {
        "name": "Chrome 125 Windows",
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
        "sec_ch_ua_mobile": "?0",
        "sec_ch_ua_platform": '"Windows"',
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "accept_language": "en-US,en;q=0.9,vi;q=0.8",
        "impersonate": "chrome124",
    },
    {
        "name": "Chrome 124 Windows",
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        "sec_ch_ua_mobile": "?0",
        "sec_ch_ua_platform": '"Windows"',
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "accept_language": "en-US,en;q=0.9,vi;q=0.8",
        "impersonate": "chrome124",
    },
    {
        "name": "Chrome 126 macOS",
        "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
        "sec_ch_ua_mobile": "?0",
        "sec_ch_ua_platform": '"macOS"',
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "accept_language": "en-US,en;q=0.9,vi;q=0.8",
        "impersonate": "chrome120",
    },
    {
        "name": "Firefox 127 Windows",
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
        "sec_ch_ua": None,
        "sec_ch_ua_mobile": None,
        "sec_ch_ua_platform": None,
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept_language": "en-US,en;q=0.5",
        "impersonate": None,
    }
]

def get_headers():
    """Header dành riêng cho TikWM API"""
    ua = random.choice(USER_AGENTS)
    return {
        "User-Agent": ua,
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
        "Origin": "https://tikwm.com",
        "Referer": "https://tikwm.com/",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "X-Requested-With": "XMLHttpRequest"
    }

def get_urlebird_headers(profile=None, referer="https://urlebird.com/"):
    """
    Sinh HTTP headers nhất quán theo một Browser Profile cụ thể cho UrleBird.
    Không random độc lập từng header để tránh lệch lạc thông tin browser.
    """
    if profile is None:
        profile = random.choice(URLEBIRD_BROWSER_PROFILES)
    
    headers = {
        "User-Agent": profile["user_agent"],
        "Accept": profile.get("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
        "Accept-Language": profile.get("accept_language", "en-US,en;q=0.9,vi;q=0.8"),
        "Referer": referer,
        "Upgrade-Insecure-Requests": "1"
    }

    # Chỉ gắn client hints và Sec-Fetch nếu profile hỗ trợ (Chromium)
    if profile.get("sec_ch_ua"):
        headers["Sec-Ch-Ua"] = profile["sec_ch_ua"]
        if profile.get("sec_ch_ua_mobile"):
            headers["Sec-Ch-Ua-Mobile"] = profile["sec_ch_ua_mobile"]
        if profile.get("sec_ch_ua_platform"):
            headers["Sec-Ch-Ua-Platform"] = profile["sec_ch_ua_platform"]
        headers["Sec-Fetch-Dest"] = "document"
        headers["Sec-Fetch-Mode"] = "navigate"
        headers["Sec-Fetch-Site"] = "same-origin"
        headers["Sec-Fetch-User"] = "?1"

    return headers

DEFAULT_HEADERS = get_headers()

# --- FlareSolverr (Hướng 3: Vượt Cloudflare bằng browser thật) ---
FLARESOLVERR_URL = "http://localhost:8191/v1"
_flaresolverr_available = None  # None = chưa kiểm tra, True/False = đã kiểm tra

def check_flaresolverr():
    """Kiểm tra FlareSolverr có đang chạy trên localhost:8191 hay không."""
    global _flaresolverr_available
    if _flaresolverr_available is not None:
        return _flaresolverr_available
    try:
        r = requests.get("http://localhost:8191/", timeout=2)
        _flaresolverr_available = (r.status_code == 200)
    except Exception:
        _flaresolverr_available = False
    return _flaresolverr_available

def request_via_flaresolverr(url, timeout=60, log_func=None):
    """
    Gửi request qua FlareSolverr để vượt qua Cloudflare challenge hợp lệ.
    FlareSolverr dùng Chrome thật để giải mã challenge, trả về HTML và cookies.
    Xem: https://github.com/FlareSolverr/FlareSolverr
    """
    def log(msg):
        if log_func: log_func(msg)
        else: print(msg)

    try:
        payload = {
            "cmd": "request.get",
            "url": url,
            "maxTimeout": timeout * 1000
        }
        log(f"[FlareSolverr] Đang giải Cloudflare cho: {url}")
        resp = requests.post(FLARESOLVERR_URL, json=payload, timeout=timeout + 15)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("status") == "ok":
                solution = data.get("solution", {})
                status = solution.get("status", 200)
                text = solution.get("response", "")
                log(f"[FlareSolverr] Status: {status}, Content length: {len(text)}")
                return {"success": True, "status": status, "text": text, "headers": solution.get("headers", {})}
            else:
                log(f"[FlareSolverr] Phản hồi lỗi: {data.get('message', '')}")
        else:
            log(f"[FlareSolverr] HTTP {resp.status_code}")
    except Exception as e:
        log(f"[FlareSolverr] Ngoại lệ: {str(e)}")
    return {"success": False, "status": -1, "error": "FlareSolverr failed"}

# --- Session & State cho UrleBird (Tách biệt khỏi TikWM) ---
_urlebird_session = None
_urlebird_active_profile = None
_urlebird_lock = threading.Lock()
last_urlebird_call_time = 0.0

def get_urlebird_session():
    """
    Tạo hoặc trả về Session riêng cho UrleBird để duy trì cookies xuyên suốt.
    Gắn cố định một Browser Profile nhất quán cho Session đó.
    """
    global _urlebird_session, _urlebird_active_profile
    with _urlebird_lock:
        if _urlebird_session is None:
            _urlebird_active_profile = random.choice(URLEBIRD_BROWSER_PROFILES)
            if HAS_CURL_CFFI and c_requests is not None and _urlebird_active_profile.get("impersonate"):
                try:
                    _urlebird_session = c_requests.Session(impersonate=_urlebird_active_profile["impersonate"])
                except Exception:
                    _urlebird_session = requests.Session()
            else:
                _urlebird_session = requests.Session()
        return _urlebird_session, _urlebird_active_profile

def is_cloudflare_challenge(status_code, headers, text):
    """Kiểm tra xem response có phải là trang challenge của Cloudflare hay không."""
    if status_code in [403, 503]:
        server = headers.get("server", "").lower()
        if "cloudflare" in server or "cf-mitigated" in headers or "cf-ray" in headers:
            return True
    if text:
        lower_text = text[:3000].lower()
        if "just a moment..." in lower_text or "cf-turnstile" in lower_text or "challenge-platform" in lower_text or "cf-browser-verification" in lower_text:
            return True
    return False

def safe_urlebird_request(url, headers=None, timeout=25, max_retries=3, log_func=None):
    """
    Thực hiện HTTP GET tới UrleBird với:
    - Session & Cookie đồng nhất
    - Browser profile nhất quán
    - Rate limit spacing
    - Error handling & Exponential backoff
    - Phát hiện Cloudflare challenge & Rate limit chuẩn xác
    """
    global last_urlebird_call_time
    session, profile = get_urlebird_session()

    req_headers = get_urlebird_headers(profile=profile, referer="https://urlebird.com/")
    if headers:
        req_headers.update(headers)

    def log(msg):
        if log_func:
            log_func(msg)
        else:
            print(msg)

    for attempt in range(max_retries):
        with _urlebird_lock:
            now = time.time()
            elapsed = now - last_urlebird_call_time
            # Khoảng cách tối thiểu 2.0s - 3.5s giữa các request
            required_spacing = random.uniform(2.0, 3.5)
            if elapsed < required_spacing:
                time.sleep(required_spacing - elapsed)

            log(f"[UrleBird] Request URL: {url}")
            try:
                resp = session.get(url, headers=req_headers, timeout=timeout)
                last_urlebird_call_time = time.time()

                status_code = resp.status_code
                content_type = resp.headers.get("Content-Type", "")
                log(f"[UrleBird] Status Code: {status_code}")
                log(f"[UrleBird] Response Content-Type: {content_type}")

                # Kiểm tra Cloudflare challenge
                if is_cloudflare_challenge(status_code, resp.headers, resp.text):
                    log(f"[UrleBird] Cloudflare challenge detected")
                    # Thử FlareSolverr nếu có sẵn
                    if check_flaresolverr():
                        log(f"[UrleBird] Thử vượt Cloudflare qua FlareSolverr...")
                        fs_result = request_via_flaresolverr(url, timeout=timeout, log_func=log_func)
                        if fs_result.get("success") and fs_result.get("text"):
                            return fs_result
                        log(f"[UrleBird] FlareSolverr không thành công, bỏ qua UrleBird.")
                    return {"success": False, "status": status_code, "challenge": True, "error": "Cloudflare challenge detected"}

                if status_code == 200:
                    return {"success": True, "status": 200, "text": resp.text, "headers": resp.headers}

                elif status_code == 429:
                    log(f"[UrleBird] Rate limited")
                    backoff = (2 ** attempt) * 2.0 + random.uniform(1.0, 2.0)
                    time.sleep(backoff)
                    continue

                elif 500 <= status_code < 600:
                    log(f"[UrleBird] Server error ({status_code}) on {url}")
                    backoff = (2 ** attempt) * 1.5 + random.uniform(0.5, 1.5)
                    time.sleep(backoff)
                    continue

                else:
                    log(f"[UrleBird] HTTP Error {status_code} on {url}")
                    if attempt == max_retries - 1:
                        return {"success": False, "status": status_code, "error": f"HTTP {status_code}"}

            except Exception as e:
                last_urlebird_call_time = time.time()
                log(f"[UrleBird] Request exception: {str(e)}")
                if attempt == max_retries - 1:
                    return {"success": False, "status": -1, "error": str(e)}
                backoff = (2 ** attempt) * 1.5 + random.uniform(0.5, 1.5)
                time.sleep(backoff)

    return {"success": False, "status": -1, "error": "Max retries reached"}

def create_session():
    if HAS_CURL_CFFI and c_requests is not None:
        profiles = ["chrome124", "chrome120", "chrome119", "edge101", "safari17_0"]
        for prof in profiles:
            try:
                return c_requests.Session(impersonate=prof)
            except Exception:
                continue
    return requests.Session()

_session = create_session()

def safe_api_request(url, params=None, data=None, method="POST", headers=None, timeout=25):
    global last_api_call_time, _session
    max_retries = 3

    req_headers = get_headers()
    if headers:
        req_headers.update(headers)

    # Thử các domain thay thế nếu gặp lỗi
    urls_to_try = [url]
    if "www.tikwm.com" in url:
        urls_to_try.append(url.replace("www.tikwm.com", "tikwm.com"))
    elif "tikwm.com" in url:
        urls_to_try.append(url.replace("://tikwm.com", "://www.tikwm.com"))

    for attempt in range(max_retries):
        target_url = urls_to_try[attempt % len(urls_to_try)]
        with api_call_lock:
            now = time.time()
            elapsed = now - last_api_call_time
            # Khoảng cách ngẫu nhiên 1.8s - 3.0s để tránh bị Cloudflare/TikWM nhận diện bot
            required_spacing = random.uniform(1.8, 3.0)
            if elapsed < required_spacing:
                time.sleep(required_spacing - elapsed)
            
            try:
                if HAS_CURL_CFFI and _session is not None:
                    if method.upper() == "POST":
                        resp = _session.post(target_url, params=params, data=data, headers=req_headers, timeout=timeout)
                    else:
                        resp = _session.get(target_url, params=params, headers=req_headers, timeout=timeout)
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
                        # Kiểm tra Rate Limit nội bộ từ API
                        if res_json.get("code") == -1 and ("limit" in res_json.get("msg", "").lower() or "rate" in res_json.get("msg", "").lower()):
                            pass
                        else:
                            return res_json
                elif resp.status_code in [403, 429, 502, 503, 504]:
                    # Nếu gặp 403 / 429 / 503, thử đổi method GET <-> POST cho lần sau
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
        
        time.sleep(random.uniform(2.0, 4.0))
        
    return {"code": -1, "msg": "Đã thử lại nhiều lần nhưng không thể kết nối tới TikWM (bị chặn hoặc quá tải)"}

def search_tiktok_videos(keywords, cursor=0, count=15):
    """Tìm kiếm video qua TikWM với cơ chế tự động thử cả POST và GET."""
    search_url = "https://tikwm.com/api/feed/search"
    params = {
        "keywords": keywords,
        "count": count,
        "cursor": cursor,
        "web": 1
    }
    # Thử POST trước
    data = safe_api_request(search_url, data=params, method="POST", timeout=25)
    if data.get("code") == 0 and data.get("data", {}).get("videos"):
        return data
    
    # Nếu POST không được, fallback sang GET
    data_get = safe_api_request(search_url, params=params, method="GET", timeout=25)
    return data_get if data_get.get("code") == 0 else data

def _extract_videos_from_urlebird_html(html):
    """Bóc tách danh sách video từ mã nguồn HTML của Urlebird"""
    videos = []
    seen_ids = set()

    # Tìm tất cả link dẫn tới video trên Urlebird: /video/slug-id/ hoặc https://urlebird.com/video/slug-id/
    video_links = re.findall(r'href=["\']((?:https?://urlebird\.com)?/video/[^"\'?#]+)["\']', html)
    
    for link in video_links:
        full_url = link if link.startswith("http") else f"https://urlebird.com{link}"
        vid_match = re.search(r'(\d{15,22})', full_url)
        if not vid_match:
            continue
        vid = vid_match.group(1)
        if vid in seen_ids:
            continue
        seen_ids.add(vid)

        # Trích xuất title từ slug hoặc alt/title nếu có
        slug_part = full_url.split('/video/')[-1].strip('/')
        title_clean = slug_part.replace(vid, '').replace('-', ' ').strip()
        
        # Thử tìm tác giả từ link
        author_match = re.search(r'/user/([^/]+)/', full_url) or re.search(r'@([a-zA-Z0-9._-]+)', full_url)
        author = author_match.group(1) if author_match else "tiktok_user"

        videos.append({
            "video_id": vid,
            "title": title_clean if title_clean else f"TikTok Video {vid}",
            "author": {"unique_id": author},
            "urlebird_url": full_url
        })
    return videos

def search_urlebird_videos(keywords, count=15, log_func=None):
    """Tìm kiếm video đa chiến lược trên Urlebird khi TikWM bị chặn hoàn toàn."""
    try:
        clean_kw = keywords.strip()
        slug_kw = re.sub(r'[^a-zA-Z0-9_]', '', clean_kw.lower())
        
        # Danh sách các URL tìm kiếm tiềm năng trên Urlebird
        urls_to_try = [
            f"https://urlebird.com/search/?q={urllib.parse.quote_plus(clean_kw)}",
            f"https://urlebird.com/hashtag/{slug_kw}/" if slug_kw else None,
            f"https://urlebird.com/user/{slug_kw}/" if slug_kw else None,
            "https://urlebird.com/trending/"
        ]
        urls_to_try = [u for u in urls_to_try if u]

        for target_url in urls_to_try:
            res = safe_urlebird_request(target_url, timeout=25, log_func=log_func)
            if res.get("challenge"):
                # Dừng quét tiếp khi bị Cloudflare challenge để tránh spam vô nghĩa
                break
            if res.get("success") and res.get("text"):
                videos = _extract_videos_from_urlebird_html(res["text"])
                if videos:
                    return videos[:count]

        return []
    except Exception:
        return []

def get_video_detail_urlebird(urlebird_url_or_vid, log_func=None):
    """Trích xuất direct MP4 từ trang Urlebird khi TikWM bị lỗi."""
    try:
        if str(urlebird_url_or_vid).startswith("http"):
            url = urlebird_url_or_vid
        else:
            url = f"https://urlebird.com/video/{urlebird_url_or_vid}/"
            
        res = safe_urlebird_request(url, timeout=25, log_func=log_func)
        if res.get("success") and res.get("text"):
            html = res["text"]
            # Tìm video src hoặc download link
            src_match = re.search(r'<video[^>]+src=["\']([^"\']+)["\']', html)
            if not src_match:
                src_match = re.search(r'<a[^>]+href=["\']([^"\']+\.mp4[^"\']*)["\']', html)
            if not src_match:
                src_match = re.search(r'href=["\']([^"\']+download=1[^"\']*)["\']', html)
            if not src_match:
                # Tìm link tiktokcdn hoặc direct mp4
                cdn_match = re.search(r'(https?://[^\s"\'<>]+(?:tiktokcdn|\.mp4|\.m4v)[^\s"\'<>]*)', html)
                if cdn_match:
                    src_match = cdn_match
                
            play_url = src_match.group(1) if src_match else None
            
            title_match = re.search(r'<title>([^<]+)</title>', html)
            title = title_match.group(1).replace(" - Urlebird", "").strip() if title_match else ""
            
            return play_url, title
    except Exception:
        pass
    return None, ""

def get_video_detail_tiklydown(tiktok_url):
    """API dự phòng: Tiklydown API khi TikWM và Urlebird bị bận"""
    try:
        encoded_url = urllib.parse.quote(tiktok_url, safe='')
        api_url = f"https://api.tiklydown.eu.org/api/download/v2?url={encoded_url}"
        r = requests.get(api_url, headers={"User-Agent": random.choice(USER_AGENTS)}, timeout=20)
        if r.status_code == 200:
            res = r.json()
            if res.get("status") == 200 or res.get("code") == 0 or res.get("data"):
                data = res.get("data", res.get("result", {}))
                play_url = data.get("video") or data.get("play") or (data.get("video", [{}])[0].get("url") if isinstance(data.get("video"), list) else None)
                title = data.get("title", "")
                if play_url:
                    return play_url, title
    except Exception:
        pass
    return None, ""

def get_video_detail_ssstik(tiktok_url, log_func=None):
    """
    API dự phòng (Hướng 4): ssstik.io - Tải TikTok không logo khi TikWM, Urlebird, Tiklydown đều bận.
    Sử dụng endpoint công khai không yêu cầu token đặc biệt.
    """
    def log(msg):
        if log_func: log_func(msg)

    try:
        base_headers = {
            "User-Agent": random.choice(USER_AGENTS),
            "Referer": "https://ssstik.io/",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }
        # Bước 1: Lấy token tt từ trang chủ ssstik
        r_home = requests.get("https://ssstik.io/en", headers=base_headers, timeout=15)
        if r_home.status_code != 200:
            return None, ""

        tt_match = re.search(r'tt:\s*["\']([^"\']+)["\']', r_home.text)
        if not tt_match:
            tt_match = re.search(r'name=["\']tt["\']\s+value=["\']([^"\']+)["\']', r_home.text)
        if not tt_match:
            log(f"[ssstik] Không tìm được token tt")
            return None, ""
        tt_token = tt_match.group(1)

        # Bước 2: Gửi request tải về
        post_headers = {
            **base_headers,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
        }
        data = {"id": tiktok_url, "locale": "en", "tt": tt_token}
        r_dl = requests.post("https://ssstik.io/abc", data=data, headers=post_headers, timeout=20)

        if r_dl.status_code == 200 and r_dl.text:
            html = r_dl.text
            # Ưu tiên link "Without watermark" (không logo)
            no_wm = re.search(
                r'href=["\']([^"\']+)["\'][^>]*>[^<]*[Ww]ithout\s*[Ww]atermark',
                html, re.DOTALL
            )
            if not no_wm:
                no_wm = re.search(r'href=["\']([^"\']+)["\'][^>]*class=["\'][^"\']*without_watermark[^"\']*["\']', html, re.IGNORECASE)
            if not no_wm:
                no_wm = re.search(r'<a[^>]+href=["\']([^"\']+\.mp4[^"\']*)["\']\ ?[^>]*>', html)
            if not no_wm:
                no_wm = re.search(r'(https?://[^\s"\'<>]+\.mp4[^\s"\'<>]*)', html)

            if no_wm:
                play_url = no_wm.group(1)
                if play_url.startswith("//"):
                    play_url = "https:" + play_url
                elif play_url.startswith("/"):
                    play_url = "https://ssstik.io" + play_url
                title_match = re.search(r'class=["\'][^"\']*(maintext|title|video-title)[^"\']* ["\'][^>]*>([^<]+)<', html)
                title = title_match.group(2).strip() if title_match else ""
                log(f"[ssstik] Tìm thấy link tải: {play_url[:80]}...")
                return play_url, title

        log(f"[ssstik] Không tìm thấy link tải trong response")
    except Exception as e:
        log(f"[ssstik] Lỗi: {str(e)}")
    return None, ""

def get_next_folder_number(page_dir):
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

def convert_tiktok_hashtags_to_facebook(text):
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

class TikTokBulkDownloader(QThread):
    log_signal = pyqtSignal(str)
    page_status_signal = pyqtSignal(int, str)  # index, status text
    finished_signal = pyqtSignal()

    def __init__(self, pages_list, download_folder, delay_seconds=2, max_videos_per_page=5, max_workers=5, parent=None, owner=None):
        super().__init__(parent)
        from modules.module_02_account_manager.context import owner_context
        from modules.module_05_page_manager.owned_data import require_owner, pages_for, download_root
        self.owner = require_owner(owner or owner_context.get())
        self.pages_list = pages_for(self.owner, [str(page.get("page_id") or page.get("id")) for page in pages_list])
        self.download_folder = download_root(download_folder, self.owner)
        self.delay_seconds = float(delay_seconds)
        self.max_videos_per_page = int(max_videos_per_page)
        self.max_workers = int(max_workers)
        self.is_running = True

    def stop(self):
        self.is_running = False

    def run(self):
        from modules.module_05_page_manager.owned_data import video_exists, record_download
        self.log_signal.emit("=========================================================")
        self.log_signal.emit(f" BẮT ĐẦU TẢI VIDEO TIKTOK SONG SONG ({self.max_workers} LUỒNG) ")
        if HAS_CURL_CFFI:
            self.log_signal.emit("[*] Chế độ mạng: Bật giả lập TLS Chrome thực tế (curl_cffi) chống Cloudflare.")
        else:
            self.log_signal.emit("[!] Đang chạy requests thường. Khuyến nghị cài curl_cffi để tối ưu.")
        self.log_signal.emit("[*] Hệ thống dự phòng: Tự động kích hoạt TikWM -> Urlebird -> Tiklydown khi bị chặn.")
        self.log_signal.emit("=========================================================")
        
        main_folder = os.path.abspath(self.download_folder.strip())
        try:
            os.makedirs(main_folder, exist_ok=True)
        except Exception as e:
            self.log_signal.emit(f"[ERROR] Không thể tạo thư mục lưu video '{main_folder}': {str(e)}")
            self.finished_signal.emit()
            return

        def download_page_videos(args):
            idx, page = args
            if not self.is_running:
                self.page_status_signal.emit(idx, "Bị dừng")
                return

            page_name = page.get("name", "Unknown Page")
            page_id = page.get("id")
            
            if not page_id:
                self.log_signal.emit(f"[WARNING] Bỏ qua trang '{page_name}' do thiếu ID.")
                self.page_status_signal.emit(idx, "Lỗi ID")
                return



            self.log_signal.emit(f"[*] [{page_name}] Bắt đầu quét video từ khóa: '{page_name}'")
            self.page_status_signal.emit(idx, "Đang quét...")

            cursor = 0
            has_more = True
            downloaded_this_page = 0
            search_attempts = 0
            max_search_pages = 5  # Quét tối đa 5 trang kết quả tìm kiếm (~75 video) mỗi Page

            while has_more and downloaded_this_page < self.max_videos_per_page and search_attempts < max_search_pages and self.is_running:
                search_attempts += 1
                item_list = []
                try:
                    data = search_tiktok_videos(page_name, cursor=cursor, count=15)
                    if data.get("code") == 0:
                        item_list = data.get("data", {}).get("videos", [])
                except Exception as e:
                    self.log_signal.emit(f"[WARNING] [{page_name}] TikWM lỗi ({str(e)}), chuyển sang tìm kiếm Urlebird...")

                # Nếu TikWM bị lỗi/chặn hoặc không có kết quả, kích hoạt Urlebird
                if not item_list and self.is_running:
                    self.log_signal.emit(f"[*] [{page_name}] Kích hoạt Urlebird tìm kiếm video cho từ khóa '{page_name}'...")
                    item_list = search_urlebird_videos(page_name, count=15, log_func=self.log_signal.emit)
                    if item_list:
                        self.log_signal.emit(f"[SUCCESS] [{page_name}] Urlebird tìm thấy {len(item_list)} video!")

                if not item_list:
                    time.sleep(random.uniform(2.0, 3.5))
                    break

                for item in item_list:
                    if downloaded_this_page >= self.max_videos_per_page or not self.is_running:
                        break

                    vid = item.get("video_id")
                    if not vid:
                        continue

                    author = item.get("author", {}).get("unique_id", "user")
                    link = f"https://www.tiktok.com/@{author}/video/{vid}"
                    urlebird_url = item.get("urlebird_url")

                    if video_exists(self.owner, page_id, "TIKTOK", vid):
                        continue

                    # Gọi API chi tiết để lấy link tải không logo
                    self.log_signal.emit(f"[*] [{page_name}] Lấy chi tiết cho {vid}...")
                    api_details = "https://tikwm.com/api/"
                    video_link = None
                    raw_caption = item.get("title", "")
                    
                    # Bước 1: Thử TikWM
                    try:
                        detail_resp = safe_api_request(api_details, data={"url": link, "hd": 1}, method="POST", timeout=25)
                        if detail_resp.get("code") == 0 and detail_resp.get("data"):
                            video_link = detail_resp["data"].get("play")
                            raw_caption = detail_resp["data"].get("title", raw_caption)
                    except Exception:
                        pass

                    # Bước 2: Dự phòng Urlebird nếu TikWM bị giới hạn
                    if not video_link:
                        self.log_signal.emit(f"[*] [{page_name}] TikWM bận, chuyển sang Urlebird cho {vid}...")
                        video_link, ub_title = get_video_detail_urlebird(urlebird_url or vid, log_func=self.log_signal.emit)
                        if ub_title:
                            raw_caption = ub_title

                    # Bước 3: Dự phòng Tiklydown nếu Urlebird không có stream trực tiếp
                    if not video_link:
                        self.log_signal.emit(f"[*] [{page_name}] Chuyển sang Tiklydown cho {vid}...")
                        video_link, fb_title = get_video_detail_tiklydown(link)
                        if fb_title:
                            raw_caption = fb_title

                    # Bước 4: Dự phòng ssstik.io (Hướng 4) nếu tất cả nguồn trên đều thất bại
                    if not video_link:
                        self.log_signal.emit(f"[*] [{page_name}] Chuyển sang ssstik.io cho {vid}...")
                        video_link, ss_title = get_video_detail_ssstik(link, log_func=self.log_signal.emit)
                        if ss_title:
                            raw_caption = ss_title

                    if not video_link:
                        self.log_signal.emit(f"[ERROR] [{page_name}] Không lấy được link tải của {vid} (đã thử TikWM, Urlebird, Tiklydown, ssstik)")
                        continue

                    self.log_signal.emit(f"[*] [{page_name}] Đang tải video {downloaded_this_page + 1}/{self.max_videos_per_page} (ID: {vid})...")
                    self.page_status_signal.emit(idx, f"Tải {downloaded_this_page + 1}/{self.max_videos_per_page}...")

                    facebook_caption = convert_tiktok_hashtags_to_facebook(raw_caption)
                    safe_name = "".join(c for c in (raw_caption or "no_caption") if c.isalnum() or c in " ._-").strip()
                    safe_name = safe_name[:100] if safe_name else str(vid)

                    page_dir = os.path.join(main_folder, page_name)
                    
                    with db_lock:
                        num = get_next_folder_number(page_dir)
                        video_folder = os.path.join(page_dir, str(num))
                        os.makedirs(video_folder, exist_ok=True)

                    video_path = os.path.join(video_folder, f"{safe_name}.mp4")
                    caption_path = os.path.join(video_folder, f"{safe_name}.txt")

                    download_success = False

                    # --- Giải pháp 1: Thêm đúng Referer TikTok khi tải CDN ---
                    try:
                        _, ub_profile = get_urlebird_session()
                        tiktok_cdn_headers = {
                            "User-Agent": ub_profile["user_agent"] if ub_profile else random.choice(USER_AGENTS),
                            "Accept": "*/*",
                            "Accept-Language": "en-US,en;q=0.9",
                            "Referer": "https://www.tiktok.com/",
                            "Origin": "https://www.tiktok.com",
                            "Sec-Fetch-Dest": "video",
                            "Sec-Fetch-Mode": "no-cors",
                            "Sec-Fetch-Site": "cross-site",
                        }
                        with requests.get(video_link, headers=tiktok_cdn_headers, stream=True, timeout=60) as r:
                            r.raise_for_status()
                            with open(video_path, "wb") as f:
                                for chunk in r.iter_content(chunk_size=1024*1024):
                                    if not self.is_running:
                                        f.close()
                                        if os.path.exists(video_path):
                                            os.remove(video_path)
                                        break
                                    if chunk:
                                        f.write(chunk)

                        if os.path.exists(video_path) and os.path.getsize(video_path) > 1000:
                            download_success = True
                    except requests.HTTPError as e:
                        if "403" in str(e) or "401" in str(e):
                            self.log_signal.emit(f"[*] [{page_name}] CDN URL hết hạn (403), thử làm mới URL từ TikWM...")
                            # --- Giải pháp 2: Làm mới URL ngay lập tức từ TikWM ---
                            try:
                                detail_resp2 = safe_api_request("https://tikwm.com/api/", data={"url": link, "hd": 1}, method="POST", timeout=25)
                                if detail_resp2.get("code") == 0 and detail_resp2.get("data"):
                                    fresh_link = detail_resp2["data"].get("hdplay") or detail_resp2["data"].get("play")
                                    if fresh_link and fresh_link != video_link:
                                        with requests.get(fresh_link, headers=tiktok_cdn_headers, stream=True, timeout=60) as r2:
                                            r2.raise_for_status()
                                            with open(video_path, "wb") as f:
                                                for chunk in r2.iter_content(chunk_size=1024*1024):
                                                    if not self.is_running:
                                                        break
                                                    if chunk:
                                                        f.write(chunk)
                                        if os.path.exists(video_path) and os.path.getsize(video_path) > 1000:
                                            download_success = True
                            except Exception:
                                pass
                        else:
                            self.log_signal.emit(f"[ERROR] [{page_name}] Lỗi tải file: {str(e)}")
                    except Exception as e:
                        self.log_signal.emit(f"[ERROR] [{page_name}] Lỗi tải file: {str(e)}")

                    # --- Giải pháp 3: Dùng yt-dlp tải từ URL TikTok gốc nếu CDN thất bại ---
                    if not download_success and self.is_running:
                        self.log_signal.emit(f"[*] [{page_name}] Thử tải bằng yt-dlp cho {vid}...")
                        try:
                            import yt_dlp
                            if os.path.exists(video_path):
                                os.remove(video_path)
                            ydl_opts = {
                                "outtmpl": video_path.replace(".mp4", ""),
                                "format": "mp4/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                                "quiet": True,
                                "no_warnings": True,
                                "merge_output_format": "mp4",
                                "noplaylist": True,
                                "http_headers": {
                                    "User-Agent": random.choice(USER_AGENTS),
                                    "Referer": "https://www.tiktok.com/",
                                }
                            }
                            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                                ydl.download([link])
                            # yt-dlp có thể thêm đuôi file, kiểm tra
                            if not os.path.exists(video_path):
                                for ext in [".mp4", ".mkv", ".webm"]:
                                    candidate = video_path.replace(".mp4", "") + ext
                                    if os.path.exists(candidate) and os.path.getsize(candidate) > 1000:
                                        os.rename(candidate, video_path)
                                        break
                            if os.path.exists(video_path) and os.path.getsize(video_path) > 1000:
                                download_success = True
                                self.log_signal.emit(f"[*] [{page_name}] yt-dlp tải thành công.")
                        except Exception as e:
                            self.log_signal.emit(f"[ERROR] [{page_name}] yt-dlp thất bại: {str(e)}")

                    if not self.is_running:
                        if os.path.exists(video_path):
                            try: os.remove(video_path)
                            except Exception: pass
                        self.page_status_signal.emit(idx, "Bị dừng")
                        return

                    if download_success:
                        with open(caption_path, "w", encoding="utf-8") as f:
                            f.write(facebook_caption.strip())

                        record_download(self.owner, page_id, "TIKTOK", vid, raw_caption, link, video_path)
                        downloaded_this_page += 1
                        self.log_signal.emit(f"[SUCCESS] [{page_name}] Đã tải xong video số {downloaded_this_page}: {vid}")
                        self.page_status_signal.emit(idx, f"Đã tải {downloaded_this_page}/{self.max_videos_per_page}")
                    else:
                        record_download(self.owner, page_id, "TIKTOK", vid, raw_caption, link, video_path, success=False)
                        self.log_signal.emit(f"[ERROR] [{page_name}] Không thể tải video {vid}.")
                        if os.path.exists(video_path):
                            try: os.remove(video_path)
                            except Exception: pass

                    # Delay nhỏ an toàn giữa các video
                    delay = max(self.delay_seconds, 1.5)
                    time.sleep(delay)

                cursor = data.get("data", {}).get("cursor", 0) if isinstance(data, dict) else 0
                has_more = bool(data.get("data", {}).get("hasMore", False)) if isinstance(data, dict) else False
                time.sleep(random.uniform(1.0, 2.0))

            if not self.is_running:
                self.page_status_signal.emit(idx, "Bị dừng")
            elif downloaded_this_page == 0:
                self.page_status_signal.emit(idx, "Không có video mới")
            else:
                self.page_status_signal.emit(idx, f"Hoàn thành ({downloaded_this_page})")

        # Chạy ThreadPool song song các Fanpage
        tasks = list(enumerate(self.pages_list))
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            list(executor.map(download_page_videos, tasks))

        self.log_signal.emit("\n[FINISHED] Tiến trình tải video TikTok hàng loạt kết thúc.")
        self.finished_signal.emit()
