"""Shared Meta configuration for Module 5 and the Graph client."""
import os
import threading
import time
from urllib.parse import urlsplit, urlunsplit

import requests

GRAPH_API_VERSION = os.getenv("FACEBOOK_GRAPH_API_VERSION", "v20.0").strip()
REQUIRED_SCOPES = {
    "pages_show_list", "pages_manage_posts", "pages_read_engagement",
    "pages_manage_engagement", "pages_messaging", "pages_manage_metadata",
}

OPTIONAL_SCOPES = {"read_insights"}

ALL_SCOPES = REQUIRED_SCOPES | OPTIONAL_SCOPES

DEFAULT_ADMIN_CALLBACK_URL = "https://admin.adagroupservice.com/oauth/meta/callback"
_PROBE_TTL_SECONDS = 300.0
_PROBE_TIMEOUT_SECONDS = 2.5
_NON_PROBED_SUFFIXES = (".localhost", ".local", ".example", ".test", ".invalid")
_probe_lock = threading.Lock()
_probe_cache: dict[str, tuple[float, bool]] = {}


def credentials():
    app_id = os.getenv("FACEBOOK_APP_ID", "").strip()
    secret = os.getenv("FACEBOOK_APP_SECRET", "").strip()
    if not app_id or not secret:
        raise ValueError("Thiếu FACEBOOK_APP_ID hoặc FACEBOOK_APP_SECRET.")
    return app_id, secret


def _normalize_callback_url(raw_url: str) -> str:
    """Validate and normalize an OAuth callback URL to end with /oauth/meta/callback."""
    parts = urlsplit(raw_url.strip())
    if (
        parts.scheme not in {"http", "https"}
        or not parts.netloc
        or parts.path.rstrip("/") != "/oauth/meta/callback"
        or parts.query
        or parts.fragment
    ):
        raise ValueError("FACEBOOK_OAUTH_CALLBACK_URL phải trỏ tới /oauth/meta/callback (không có query/fragment).")
    return urlunsplit((parts.scheme, parts.netloc, "/oauth/meta/callback", "", ""))


def _fallback_callback_url(primary_url: str = "") -> str:
    """Resolve the admin fallback callback URL from env or the primary domain."""
    explicit = os.getenv("FACEBOOK_OAUTH_CALLBACK_FALLBACK_URL", "").strip()
    if explicit:
        return _normalize_callback_url(explicit)

    if primary_url:
        parts = urlsplit(primary_url)
        host = (parts.hostname or "").lower()
        if host and not host.startswith("admin."):
            return urlunsplit(("https", f"admin.{parts.netloc}", "/oauth/meta/callback", "", ""))

    admin_base = os.getenv("NEXT_PUBLIC_ADMIN_URL", "").strip().rstrip("/")
    if admin_base:
        return _normalize_callback_url(f"{admin_base}/oauth/meta/callback")

    return DEFAULT_ADMIN_CALLBACK_URL


def _should_probe(url: str) -> bool:
    """Probe only public non-admin HTTPS callback URLs (skip local/test hosts)."""
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or not host:
        return False
    if host in {"localhost", "127.0.0.1", "::1"} or host.startswith("admin."):
        return False
    return not host.endswith(_NON_PROBED_SUFFIXES)


def _is_callback_reachable(url: str) -> bool:
    """Check with a short TTL cache whether the callback route responds with 2xx."""
    now = time.monotonic()
    with _probe_lock:
        cached = _probe_cache.get(url)
        if cached and now - cached[0] < _PROBE_TTL_SECONDS:
            return cached[1]

    reachable = False
    try:
        with requests.get(url, timeout=_PROBE_TIMEOUT_SECONDS, stream=True) as resp:
            final_path = urlsplit(resp.url).path.rstrip("/")
            reachable = 200 <= resp.status_code < 300 and final_path == "/oauth/meta/callback"
    except requests.RequestException:
        reachable = False

    with _probe_lock:
        _probe_cache[url] = (now, reachable)
    return reachable


def callback_url():
    """Return the configured Meta OAuth callback URL, falling back to admin.<domain> when unavailable."""
    raw = os.getenv("FACEBOOK_OAUTH_CALLBACK_URL", "").strip()
    if not raw:
        return _fallback_callback_url()

    normalized = _normalize_callback_url(raw)
    if _should_probe(normalized) and not _is_callback_reachable(normalized):
        return _fallback_callback_url(normalized)
    return normalized
