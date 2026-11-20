"""Read the posts visible to an owned Facebook account without storing the results."""

import re
from threading import Event
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

from selenium.common.exceptions import (
    MoveTargetOutOfBoundsException,
    StaleElementReferenceException,
    TimeoutException,
)
from selenium.webdriver import ActionChains
from selenium.webdriver.support.ui import WebDriverWait

from modules.module_11_page_scanner.facebook_time import parse_facebook_published_at

FACEBOOK_HOSTS = {"facebook.com", "www.facebook.com", "web.facebook.com", "m.facebook.com"}
RESERVED_PATHS = {"checkpoint", "events", "feed", "friends", "gaming", "groups", "help", "home", "login", "logout", "marketplace", "messages", "notifications", "pages", "photo", "photos", "reel", "reels", "search", "settings", "share", "watch"}
SCAN_SCOPE = "seeding_post_scan"
MAX_POSTS = 50
MAX_DATE_HOVERS = 8

_READ_FEED = r"""
const anchors = 'a[href*="/posts/"], a[href*="/permalink"], a[href*="story_fbid="], a[href*="/videos/"], a[href*="/reel/"], a[href*="/reels/"], a[href*="/watch"], a[href*="/photo"]';
const caption = '[data-ad-preview="message"], [data-ad-comet-preview="message"], div.html-div div[dir="auto"][style*="text-align"]';
const cardSelector = '[role="article"], [data-pagelet^="FeedUnit"]';
const scope = document.querySelector('[role="main"]') || document.body;
const entries = new Map();
const clean = (text) => (text || '').replace(/[\u034f\u200b-\u200f\u2060\ufeff]/g, '').trim();

for (const anchor of scope.querySelectorAll(anchors)) {
  let card = anchor.closest(cardSelector);
  if (!card) {
    for (let node = anchor.parentElement; node && node !== scope; node = node.parentElement) {
      if (node.querySelector(caption)) {
        card = node;
        break;
      }
    }
  }
  if (!card || card.parentElement?.closest('[role="article"]')) continue;

  const time = anchor.querySelector('time[datetime], [data-utime], abbr') ||
    card.querySelector('time[datetime], abbr[data-utime], [data-utime]');
  const labels = [time?.getAttribute('title'), time?.getAttribute('aria-label'),
    anchor.getAttribute('title'), anchor.getAttribute('aria-label')];
  for (const node of [anchor, ...anchor.querySelectorAll('[aria-labelledby]')]) {
    for (const id of (node.getAttribute('aria-labelledby') || '').split(/\s+/)) {
      if (id) labels.push(document.getElementById(id)?.textContent);
    }
  }
  labels.push(time?.innerText, anchor.innerText);
  const timestamps = [...new Set(labels.map(clean).filter(Boolean).filter((text) => text.length <= 120))];
  const score = (time && anchor.contains(time) ? 4 : 0) +
    (timestamps.some((text) => /\d|yesterday|just now|hôm qua|vừa xong/i.test(text)) ? 2 : 0) +
    (/\/(posts|permalink)|story_fbid=/.test(anchor.href) ? 1 : 0);
  const previous = entries.get(card);
  if (previous && previous.score >= score) continue;
  entries.set(card, { anchor, timestamps, score,
    datetime: time?.getAttribute('datetime'), utime: time?.getAttribute('data-utime') });
}

return Array.from(entries).slice(0, 100).map(([card, data]) => {
  const messages = [...card.querySelectorAll(caption)].filter((node) =>
    !node.parentElement?.closest(caption) &&
    !node.closest('a, [role="button"], [role="toolbar"]') &&
    (!node.closest(cardSelector) || node.closest(cardSelector) === card)
  );
  const content = messages.map((node) => {
    const text = node.cloneNode(true);
    text.querySelectorAll('[role="button"], button').forEach((child) => child.remove());
    return clean(text.textContent);
  }).filter(Boolean).join('\n').slice(0, 5000);
  const path = data.anchor.pathname;
  const type = /\/(?:videos?|reels?|watch)(?:\/|$)/i.test(path) || card.querySelector('video')
    ? 'video'
    : /\/photo/i.test(path) || card.querySelector('a[href*="/photo"] img, [data-ad-preview="media"] img')
      ? 'photo'
      : 'text';
  const reactionLabels = [...card.querySelectorAll('[aria-label]')].map((node) => clean(node.getAttribute('aria-label')));
  const reactions = reactionLabels.map((text) => text.match(
    /([\d]+(?:[.,][\d]+)*(?:\s*[KMB])?)\s*(?:reactions?|likes?|lượt thích|lượt cảm xúc|người\s+(?:đã\s+)?bày tỏ)/i
  )?.[1]).find(Boolean);
  return { url: data.anchor.href, anchor: data.anchor, timestamps: data.timestamps, utime: data.utime,
    datetime: data.datetime, content, type, reactions };
});
"""


class SourceScanError(RuntimeError):
    """A scan failure that can be displayed in the popup."""

    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


def _facebook_url(raw: str):
    value = raw.strip()
    if not value or any(char.isspace() for char in value) or "\\" in value:
        raise ValueError("Invalid URL")
    parsed = urlsplit(value if "://" in value else f"https://{value}")
    if (
        parsed.scheme not in {"http", "https"}
        or parsed.hostname not in FACEBOOK_HOSTS
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port not in {None, 80, 443}
    ):
        raise ValueError("Invalid Facebook origin")
    return parsed


def normalize_source_url(raw: str) -> str:
    try:
        parsed = _facebook_url(raw)
        path = parsed.path.rstrip("/")
        if path.lower() == "/profile.php":
            profile_ids = parse_qs(parsed.query).get("id", [])
            if len(profile_ids) == 1 and re.fullmatch(r"[0-9]+", profile_ids[0]):
                return f"https://www.facebook.com/profile.php?id={profile_ids[0]}"
        elif re.fullmatch(r"/(?:people|pages|p)/[^/]+(?:/[0-9]+)?", path, re.IGNORECASE):
            return urlunsplit(("https", "www.facebook.com", path, "", ""))
        elif re.fullmatch(r"/[A-Za-z0-9._-]+", path) and path[1:].lower() not in RESERVED_PATHS and not path.lower().endswith(".php"):
            return f"https://www.facebook.com{path}"
    except ValueError:
        pass
    raise SourceScanError("Vui lòng nhập link Page hoặc trang cá nhân Facebook hợp lệ.")


def _collect_post(raw: dict):
    try:
        parsed = _facebook_url(raw.get("url") or "")
    except ValueError:
        return None

    path = parsed.path.rstrip("/")
    query = parse_qs(parsed.query)
    post_id = None
    params = {}
    for name in ("story_fbid", "fbid", "v"):
        values = query.get(name, [])
        if values and re.fullmatch(r"[A-Za-z0-9_-]+", values[0]):
            post_id = values[0]
            params[name] = post_id
            owner_id = query.get("id", [""])[0]
            if name == "story_fbid" and owner_id.isdigit():
                params["id"] = owner_id
            break
    if post_id is None:
        match = re.search(r"/(?:posts|permalink|videos?|reels?|photo|photos)/([A-Za-z0-9_-]+)$", path, re.IGNORECASE)
        if not match:
            return None
        post_id = match[1]

    try:
        utime = int(raw.get("utime") or 0) or None
    except (ValueError, TypeError):
        utime = None
    published_at, _ = parse_facebook_published_at(utime=utime, iso_attr=raw.get("datetime"))
    for timestamp in raw.get("timestamps") or []:
        if published_at:
            break
        published_at, _ = parse_facebook_published_at(timestamp)

    return {
        "id": post_id,
        "post_url": urlunsplit(("https", "www.facebook.com", path, urlencode(params), "")),
        "content": raw.get("content") or "",
        "post_type": raw.get("type") or "text",
        "published_at": published_at,
        "reaction_count": raw.get("reactions"),
    }


def _on_facebook_feed(driver):
    try:
        location = _facebook_url(driver.current_url)
    except ValueError:
        return False
    return location.path.lstrip("/").split("/", 1)[0].lower() not in {"login", "login.php", "checkpoint", "recover", "consent"}


def _read_date_tooltip(driver, anchor, stop: Event):
    read_tooltips = """
    return [...document.querySelectorAll('[role="tooltip"]')]
      .filter((node) => node.getClientRects().length)
      .map((node) => node.innerText.trim());
    """
    previous = set(driver.execute_script(read_tooltips))
    try:
        ActionChains(driver, duration=100).move_to_element(anchor).perform()

        def read_date(browser):
            if stop.is_set():
                return True
            for label in browser.execute_script(read_tooltips):
                if label not in previous:
                    date, _ = parse_facebook_published_at(label)
                    if date:
                        return date
            return False

        date = WebDriverWait(driver, 1, poll_frequency=0.2).until(read_date)
        return date if isinstance(date, str) else None
    except (MoveTargetOutOfBoundsException, StaleElementReferenceException, TimeoutException):
        return None


def collect_visible_posts(driver, source_url: str, stop: Event) -> list[dict]:
    driver.set_page_load_timeout(15)
    try:
        driver.get(source_url)
    except TimeoutException:
        driver.execute_script("window.stop()")

    def read_batch(browser):
        if stop.is_set():
            return []
        if not _on_facebook_feed(browser):
            raise SourceScanError("Phiên Facebook đã hết hạn. Vui lòng đăng nhập lại tài khoản trong mục Quản lý tài khoản.")
        return browser.execute_script(_READ_FEED) or []

    try:
        batch = WebDriverWait(driver, 8).until(lambda browser: read_batch(browser) or stop.is_set())
    except TimeoutException:
        return []

    posts = {}
    hovered = set()
    idle_rounds = 0
    for _ in range(10):
        if stop.is_set():
            return []
        previous_count = len(posts)
        for row in batch:
            post = _collect_post(row)
            if post is None:
                continue
            if not post["published_at"] and row.get("anchor") and len(hovered) < MAX_DATE_HOVERS and post["id"] not in hovered:
                hovered.add(post["id"])
                post["published_at"] = _read_date_tooltip(driver, row["anchor"], stop)
            previous = posts.get(post["id"])
            if previous is None:
                posts[post["id"]] = post
            else:
                if len(post["content"]) > len(previous["content"]):
                    previous["content"] = post["content"]
                for field in ("published_at", "reaction_count"):
                    previous[field] = previous[field] or post[field]
            if len(posts) >= MAX_POSTS:
                return list(posts.values())
        idle_rounds = idle_rounds + 1 if len(posts) == previous_count else 0
        if idle_rounds >= 3:
            break
        driver.execute_script("window.scrollBy(0, Math.max(window.innerHeight * 0.85, 400));")
        if stop.wait(1.2):
            return []
        batch = read_batch(driver)
    return list(posts.values())


def scan_source_posts(raw_url: str, owner: str, stop: Event) -> list[dict]:
    from sqlalchemy import func, or_

    from core.browser import close_scoped_active_drivers, get_active_drivers, get_profile_lock, load_cookies, open_browser
    from modules.module_02_account_manager.database.connection import SessionLocal
    from modules.module_02_account_manager.database.models import Account

    source_url = normalize_source_url(raw_url)
    with SessionLocal() as session:
        logged_in = func.upper(Account.login_status) == "LOGGED_IN"
        accounts = session.query(Account.uid, Account.proxy, Account.cookie).filter(
            Account.user_id == owner,
            func.upper(Account.status) == "LIVE",
            or_(logged_in, Account.cookie.contains("c_user=")),
        ).order_by(logged_in.desc(), Account.id).all()

    if not accounts:
        raise SourceScanError("Cần một tài khoản Facebook đang hoạt động và có phiên đăng nhập trong mục Quản lý tài khoản.")
    scope = f"{SCAN_SCOPE}:{owner}"
    for uid, proxy, cookie in accounts:
        if stop.is_set():
            return []
        lock = get_profile_lock(uid, owner=owner)
        if not lock.acquire(blocking=False):
            continue
        driver = None
        try:
            if get_active_drivers(uid, owner=owner):
                continue
            driver = open_browser(
                uid=uid, owner=owner, proxy=proxy, scope=scope,
                headless=True, verify_egress=False, allow_direct_fallback=False,
            )
            driver.set_page_load_timeout(12)
            if not stop.is_set() and cookie:
                load_cookies(driver, cookie)
            if stop.is_set():
                return []
            return collect_visible_posts(driver, source_url, stop)
        finally:
            try:
                if driver is not None:
                    close_scoped_active_drivers(scope, uids=[uid])
            finally:
                lock.release()
    raise SourceScanError("Các tài khoản Facebook khả dụng đang mở Chrome hoặc đang chạy tác vụ khác.", 409)
