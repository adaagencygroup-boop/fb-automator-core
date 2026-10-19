"""Shared Meta configuration for Module 5 and the Graph client."""
import os

GRAPH_API_VERSION = os.getenv("FACEBOOK_GRAPH_API_VERSION", "v20.0").strip()
REQUIRED_SCOPES = {
    "pages_show_list", "pages_manage_posts", "pages_read_engagement",
    "pages_manage_engagement", "pages_messaging", "pages_manage_metadata",
}


def credentials():
    app_id = os.getenv("FACEBOOK_APP_ID", "").strip()
    secret = os.getenv("FACEBOOK_APP_SECRET", "").strip()
    if not app_id or not secret:
        raise ValueError("Thiếu FACEBOOK_APP_ID hoặc FACEBOOK_APP_SECRET.")
    return app_id, secret


def callback_url():
    from urllib.parse import urlsplit
    url = os.getenv("FACEBOOK_OAUTH_CALLBACK_URL", "").strip()
    parts = urlsplit(url)
    if parts.scheme not in {"http", "https"} or not parts.netloc or parts.path.rstrip("/") != "/oauth/meta/callback" or parts.query or parts.fragment:
        raise ValueError("FACEBOOK_OAUTH_CALLBACK_URL phải trỏ tới /oauth/meta/callback (không có query/fragment).")
    return url
