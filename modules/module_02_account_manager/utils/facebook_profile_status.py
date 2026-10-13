"""Verify whether a Facebook UID resolves to an actual profile."""

import re
import os
import shutil
import logging
import tempfile
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx

logger = logging.getLogger(__name__)
_FACEBOOK_HOSTS = {"facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com"}
_CHALLENGE = re.compile(
    r"checkpoint|confirm your identity|enter login code|security check|temporarily locked|"
    r"sorry, something went wrong|too many requests|try again later|"
    r"account disabled|account has been disabled|account has been suspended|"
    r"xác nhận danh tính|tài khoản.*(?:bị khóa|vô hiệu hóa)", re.IGNORECASE,
)


_UNAVAILABLE = re.compile(
    r"this content isn't available|this page isn't available|page isn't available|"
    r"content isn't available right now|profile isn't available|you can't view this content|"
    r"the link you followed may be broken|trang này hiện không khả dụng|"
    r"nội dung này hiện không khả dụng|bạn hiện không xem được nội dung này|"
    r"không tìm thấy tài khoản",
    re.IGNORECASE,
)


class _ProfileMetadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.meta = {}
        self.canonical = ""
        self.visible_text = []
        self.headings = []
        self._hidden_depth = 0
        self._in_heading = False

    def handle_starttag(self, tag, attrs):
        if tag == "h1":
            self._in_heading = True
        if tag in {"script", "style"}:
            self._hidden_depth += 1
        values = dict(attrs)
        if tag == "meta":
            key = values.get("property") or values.get("name")
            if key:
                self.meta[key.lower()] = unescape(values.get("content", ""))
        elif tag == "link" and values.get("rel") == "canonical":
            self.canonical = unescape(values.get("href", ""))

    def handle_endtag(self, tag):
        if tag == "h1":
            self._in_heading = False
        if tag in {"script", "style"} and self._hidden_depth:
            self._hidden_depth -= 1

    def handle_data(self, data):
        if not self._hidden_depth:
            self.visible_text.append(data)
            if self._in_heading:
                self.headings.append(data)


def _points_to_uid(url: str, uid: str) -> bool:
    parsed = urlparse(url)
    if parsed.hostname not in {"facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com"}:
        return False
    path = parsed.path.rstrip("/")
    return path == f"/{uid}" or (path == "/profile.php" and parse_qs(parsed.query).get("id") == [uid])


def profile_exists(uid: str, response: httpx.Response) -> bool:
    """Require profile-specific evidence; HTTP 200 or a login page is insufficient."""
    if response.status_code != 200 or not uid.isascii() or not uid.isdigit():
        return False
    if response.url.host not in {"facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com"}:
        return False
    if response.url.path.lower().startswith(("/login", "/checkpoint", "/recover")):
        return False
    body = response.text
    metadata = _ProfileMetadata()
    metadata.feed(body)
    if _UNAVAILABLE.search(" ".join(metadata.visible_text)) or _UNAVAILABLE.search(metadata.meta.get("og:description", "")):
        return False
    if _points_to_uid(metadata.meta.get("og:url", ""), uid) or _points_to_uid(metadata.canonical, uid):
        title = metadata.meta.get("og:title", "").strip().lower()
        if metadata.meta.get("og:type") == "profile" or (title and title not in {"facebook", "log in", "log into facebook"}):
            return True
    if re.search(rf'"(?:profile_id|userID|user_id)"\s*:\s*"?{re.escape(uid)}"?(?!\d)', body):
        return True
    visible = " ".join(metadata.visible_text).lower()
    heading = " ".join(metadata.headings).strip().lower()
    profile_sections = ("bạn bè", "ảnh", "giới thiệu", "friends", "photos", "about")
    return bool(
        _points_to_uid(str(response.url), uid)
        and heading
        and heading not in {"facebook", "đăng nhập", "log in", "log into facebook"}
        and sum(section in visible for section in profile_sections) >= 2
    )


def _find_chrome() -> str | None:
    for name in ("chrome", "google-chrome", "chromium"):
        path = shutil.which(name)
        if path:
            return path
    candidates = [
        Path(os.environ.get("PROGRAMFILES", "")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("PROGRAMFILES(X86)", "")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Chrome/Application/chrome.exe",
    ]
    return str(next((path for path in candidates if path.is_file()), "")) or None


def _classify_profile(uid: str, response: httpx.Response, body_text: str = "") -> str | None:
    """Separate a confirmed unavailable profile from an inaccessible check."""
    if response.url.host not in _FACEBOOK_HOSTS:
        return None
    if response.url.path.lower().startswith(("/login", "/checkpoint", "/recover", "/error")):
        return None
    if response.status_code not in (200, 404, 410):
        return None
    metadata = _ProfileMetadata()
    metadata.feed(response.text)
    visible = " ".join(metadata.visible_text) + " " + body_text
    if _CHALLENGE.search(visible):
        return None
    if _points_to_uid(str(response.url), uid) and (
        _UNAVAILABLE.search(visible) or _UNAVAILABLE.search(metadata.meta.get("og:description", ""))
    ):
        return "die"
    return "live" if profile_exists(uid, response) else None


def _browser_snapshot(uid: str, driver) -> str | None:
    from selenium.webdriver.common.by import By

    response = httpx.Response(200, text=driver.page_source, request=httpx.Request("GET", driver.current_url))
    return _classify_profile(uid, response, driver.find_element(By.TAG_NAME, "body").text)


def _check_in_browser(uid: str, chrome: str, profile_dir: str) -> str | None:
    from selenium import webdriver
    from selenium.common.exceptions import TimeoutException
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.support.ui import WebDriverWait

    driver = None
    try:
        options = Options()
        options.binary_location = chrome
        for argument in ("--headless=new", "--disable-gpu", "--no-first-run",
                         "--no-default-browser-check", "--disable-extensions", "--lang=vi-VN",
                         f"--user-data-dir={profile_dir}"):
            options.add_argument(argument)
        driver = webdriver.Chrome(options=options)
        driver.set_page_load_timeout(30)
        driver.get(f"https://m.facebook.com/profile.php?id={uid}")
        try:
            return WebDriverWait(driver, 6).until(lambda current: _browser_snapshot(uid, current))
        except TimeoutException:
            return None
    except Exception:
        logger.debug("Browser profile check failed for UID %s", uid, exc_info=True)
        return None
    finally:
        if driver is not None:
            try:
                driver.quit()
            except Exception:
                logger.debug("Could not close status browser for UID %s", uid, exc_info=True)


def check_profile_status(uid: str) -> str | None:
    """Graph picture, public HTTP profile, then isolated browser; None is inconclusive."""
    if not uid.isascii() or not uid.isdigit():
        return None
    with httpx.Client(follow_redirects=True, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
    }) as client:
        try:
            picture = client.get(f"https://graph.facebook.com/{uid}/picture?type=normal", timeout=10)
            host = picture.url.host or ""
            if (picture.status_code == 200 and (host == "fbcdn.net" or host.endswith(".fbcdn.net"))
                    and not host.startswith("static.") and "rsrc.php" not in picture.url.path.lower()
                    and picture.headers.get("content-type", "").lower().startswith("image/")
                    and picture.content):
                return "live"
        except httpx.HTTPError:
            logger.debug("Graph picture check failed for UID %s", uid)
        try:
            response = client.get(f"https://m.facebook.com/profile.php?id={uid}", timeout=15)
            status = _classify_profile(uid, response)
            if status is not None:
                return status
        except httpx.HTTPError:
            logger.debug("Public HTTP check failed for UID %s", uid)
    chrome = _find_chrome()
    if not chrome:
        return None
    try:
        from ..utils.paths import PROFILES_DIR
        profiles_dir = Path(PROFILES_DIR)
        profiles_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="fb-status-", dir=profiles_dir, ignore_cleanup_errors=True) as profile_dir:
            return _check_in_browser(uid, chrome, profile_dir)
    except Exception:
        logger.debug("Status profile setup failed for UID %s", uid, exc_info=True)
        return None
