"""Suy ra ID Graph và URL ảnh đại diện Facebook từ UID hoặc link Fanpage."""
from urllib.parse import parse_qs, quote, unquote, urlparse

_SYSTEM_PATHS = {
    "login", "checkpoint", "two_step", "recover", "help", "watch", "marketplace",
    "groups", "gaming", "bookmarks", "settings", "messages", "notifications",
    "friends", "events", "saved", "memories", "stories", "reels", "ads", "fundraisers",
    "me", "allactivity", "privacy", "policies", "terms", "support", "biz_web",
}


def facebook_picture_id(url_or_uid: str) -> str:
    raw = (url_or_uid or "").strip()
    if not raw:
        return ""
    if raw.isdigit() and 4 <= len(raw) <= 20:
        return raw
    if "://" not in raw and "facebook.com" not in raw:
        return ""

    parsed = urlparse(raw.replace("web.facebook.com", "www.facebook.com"))
    host = (parsed.netloc or "").lower()
    if "facebook.com" not in host:
        return ""

    query_id = (parse_qs(parsed.query).get("id") or [""])[0].strip()
    if query_id.isdigit() and 4 <= len(query_id) <= 20:
        return query_id

    parts = [unquote(part) for part in parsed.path.split("/") if part]
    if not parts:
        return ""
    first = parts[0]
    if first.lower() in _SYSTEM_PATHS:
        return ""
    if first.lower() in {"people", "pages"}:
        last = parts[-1]
        return last if last.isdigit() and 4 <= len(last) <= 20 else ""
    if first.lower() == "profile.php":
        return ""
    return first


def facebook_picture_url(url_or_uid: str, size: int = 80) -> str:
    ident = facebook_picture_id(url_or_uid)
    if not ident:
        return ""
    return (
        f"https://graph.facebook.com/{quote(ident, safe='')}/picture"
        f"?type=square&width={int(size)}&height={int(size)}"
    )
