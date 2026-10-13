"""Verify whether a Facebook UID resolves to an actual profile."""

import re
import os
import shutil
import subprocess
import tempfile
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx


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


def _check_in_browser(uid: str, chrome: str, profile_dir: str) -> str:
    url = f"https://www.facebook.com/profile.php?id={uid}"
    try:
        result = subprocess.run(
            [chrome, "--headless=new", "--no-sandbox", "--disable-gpu",
             "--disable-gpu-sandbox", "--disable-gpu-compositing",
             "--disable-software-rasterizer", "--disable-features=VizDisplayCompositor,UseSkiaRenderer",
             "--no-first-run",
             "--no-default-browser-check", "--disable-extensions", "--lang=vi-VN",
             f"--user-data-dir={profile_dir}", "--dump-dom", url],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
            check=False,
        )
        if result.returncode != 0 or not result.stdout:
            return "die"
        response = httpx.Response(200, text=result.stdout, request=httpx.Request("GET", url))
        return "live" if profile_exists(uid, response) else "die"
    except Exception:
        return "die"


def check_profile_status(uid: str) -> str:
    """Open the public profile URL and classify it from the returned Facebook page."""
    if not uid.isascii() or not uid.isdigit():
        return "die"
    chrome = _find_chrome()
    if not chrome:
        return "die"
    try:
        from modules.module_03_acc_farm.browser.paths import PROFILES_DIR
        profiles_dir = Path(PROFILES_DIR)
        profiles_dir.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="fb-status-", dir=profiles_dir, ignore_cleanup_errors=True) as profile_dir:
            return _check_in_browser(uid, chrome, profile_dir)
    except Exception:
        return "die"
