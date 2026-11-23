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
POSTS_PER_ACCOUNT_TURN = 50
MAX_DATE_HOVERS = 8

_READ_FEED = r"""
const anchors = 'a[href*="/posts/"], a[href*="/permalink"], a[href*="story_fbid="], a[href*="/photo"], a[href*="/share/p/"]';
const preferredCaption = 'div.xdj266r.x14z9mp.xat24cr.x1lziwak.x1vvkbs.x126k92a > div[dir="auto"], div.xdj266r.x14z9mp.xat24cr.x1lziwak.x1vvkbs.x126k92a div[dir="auto"], div.xdj266r.x14z9mp.xat24cr.x1lziwak.x1vvkbs.x126k92a';
const caption = `${preferredCaption}, [data-ad-preview="message"], [data-ad-comet-preview="message"], div.html-div div[dir="auto"][style*="text-align"]`;
const cardSelector = '[role="article"], [data-pagelet^="FeedUnit"]';
const scope = document.querySelector('[role="main"]') || document.body;
const entries = new Map();
const clean = (text) => (text || '').replace(/[\u034f\u200b-\u200f\u2060\ufeff]/g, '').trim();

const isHeaderOrIntro = (node) => {
  return !!node.closest?.(
    '[data-pagelet*="ProfileHeader" i], ' +
    '[data-pagelet*="page_header" i], ' +
    '[data-pagelet*="CoverPhoto" i], ' +
    '[data-pagelet*="ProfileTabs" i], ' +
    '[data-pagelet*="ProfileTiles" i], ' +
    '[data-pagelet*="Intro" i], ' +
    '[data-pagelet*="header" i], ' +
    '[role="banner"]'
  );
};

const isInsideComment = (node) => {
  if (!node || node === scope || node === document.body) return false;
  const aria = (node.getAttribute && (node.getAttribute('aria-label') || '')) || '';
  if (/^(?:bình luận của|comment by|câu trả lời của|phản hồi của|reply by)\b/i.test(aria)) return true;
  return !!node.closest?.(
    '[role="article"][aria-label*="bình luận" i], ' +
    '[role="article"][aria-label*="comment" i], ' +
    '[role="article"][aria-label*="câu trả lời" i], ' +
    '[role="article"][aria-label*="phản hồi" i], ' +
    'div[aria-label*="bình luận của" i], ' +
    'div[aria-label*="comment by" i], ' +
    'div[aria-label*="câu trả lời của" i], ' +
    'div[aria-label*="phản hồi của" i], ' +
    '[data-pagelet*="Comment" i], ' +
    '[data-testid*="comment" i]'
  );
};

const isPostLink = (anchor) => {
  try {
    const href = anchor.getAttribute('href') || anchor.href || '';
    if (!href || /[?&](?:comment_id|reply_comment_id)=/i.test(href)) return false;
    if (/\/(?:reel|reels|videos?|watch|share\/v)\b/i.test(href)) return false;
    const url = new URL(anchor.href, location.href);
    if (url.searchParams.has('comment_id') || url.searchParams.has('reply_comment_id')) return false;
    const path = url.pathname.replace(/\/+$/, '');
    if (/\/(?:reel|reels|videos?|watch|share\/v)\b/i.test(path)) return false;
    return /\/(?:posts|permalink|photo|photos|share\/p)\/[A-Za-z0-9_-]+$/i.test(path) ||
      ['story_fbid', 'fbid'].some((key) => /^[A-Za-z0-9_-]+$/.test(url.searchParams.get(key) || ''));
  } catch {
    return false;
  }
};

const isAvatarOrCoverCard = (card, anchor) => {
  if (!card) return false;
  if (isHeaderOrIntro(anchor) || isHeaderOrIntro(card)) return true;

  const headings = [...card.querySelectorAll('h2, h3, h4, [role="heading"], strong')].map((el) => clean(el.innerText)).join(' ');
  const aria = clean(card.getAttribute('aria-label') || anchor.getAttribute('aria-label') || '');
  const combined = `${headings} ${aria}`;

  return /(?:cập nhật|thay đổi)\s+(?:ảnh|video)\s+(?:đại diện|bìa)|updated\s+(?:their|his|her|its)?\s*(?:profile\s+picture|cover\s+photo|avatar)/i.test(combined);
};

const isVideoOrReelCard = (card, anchor) => {
  const href = anchor?.getAttribute?.('href') || anchor?.href || '';
  if (/\/(?:reel|reels|videos?|share\/v)\b|\/watch\/?\?/i.test(href)) return true;
  if (!card) return false;
  if (card.querySelector('video, [data-pagelet*="Video" i], a[href*="/videos/"], a[href*="/watch?v="], a[href*="/watch/?v="], a[href*="/reel/"], a[href*="/reels/"], a[href*="/share/v/"]')) {
    return true;
  }
  return false;
};

const findCard = (anchor) => {
  let card = anchor.closest(cardSelector);
  if (card && !isInsideComment(card)) return card;

  for (let node = anchor.parentElement; node && node !== scope && node !== document.body; node = node.parentElement) {
    if (isInsideComment(node)) continue;
    const hasCaption = !!node.querySelector(caption);
    const hasAction = !!node.querySelector('[role="toolbar"], [aria-label*="Like" i], [aria-label*="Thích" i], [aria-label*="Comment" i], [aria-label*="Bình luận" i], [aria-label*="Chia sẻ" i], [aria-label*="Share" i]');
    const hasTime = !!node.querySelector('time[datetime], [data-utime], abbr');
    if ((hasCaption && (hasTime || hasAction)) || (hasTime && hasAction)) {
      return node;
    }
  }
  return null;
};

for (const anchor of scope.querySelectorAll(anchors)) {
  if (anchor.closest(caption) || !isPostLink(anchor) || isInsideComment(anchor) || isHeaderOrIntro(anchor)) continue;

  const card = findCard(anchor);
  if (!card || isInsideComment(card)) continue;
  if (card.parentElement?.closest('[role="article"]') && !card.parentElement?.closest('[data-pagelet^="FeedUnit"]')) continue;

  if (isAvatarOrCoverCard(card, anchor)) continue;
  if (isVideoOrReelCard(card, anchor)) continue;

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
  const isShareP = /\/share\/p\/[A-Za-z0-9_-]+/i.test(anchor.href);
  const isPermalink = /\/(?:posts|permalink)|story_fbid=/i.test(anchor.href);
  const isPhoto = /\/photo/i.test(anchor.href);
  const anchorHasTime = (time && anchor.contains(time)) ||
    /\d+\s*(?:giây|phút|giờ|ngày|tháng|năm|s|m|h|d|w|y|vừa xong|hôm qua|yesterday|just now)\b|\d{1,2}\s+tháng\s+\d{1,2}/i.test(clean(anchor.getAttribute('aria-label') || anchor.innerText || ''));
  const score = (anchorHasTime ? 6 : 0) +
    (timestamps.some((text) => /\d|yesterday|just now|hôm qua|vừa xong/i.test(text)) ? 2 : 0) +
    (isShareP ? 10 : 0) +
    (isPermalink ? 8 : 0) +
    (isPhoto ? 1 : 0);
  const previous = entries.get(card);
  if (previous && previous.score >= score) continue;
  entries.set(card, { anchor, timestamps, score,
    datetime: time?.getAttribute('datetime'), utime: time?.getAttribute('data-utime') });
}

return Array.from(entries).slice(0, 100).map(([card, data]) => {
  const commentAction = [...card.querySelectorAll('button, [role="button"]')].find((node) =>
    /^(?:comment|bình luận|để lại bình luận|viết bình luận)\b/i.test(clean(node.getAttribute('aria-label') || node.innerText))
  );
  const commentRegion = card.querySelector('[data-pagelet*="Comment" i], [aria-label*="bình luận của" i], [aria-label*="comment by" i], [role="article"][aria-label*="bình luận" i]');
  const bodyStops = [commentAction, commentRegion].filter(Boolean);

  const candidates = [...card.querySelectorAll(caption)].filter((node) =>
    !node.closest('a, [role="button"], [role="toolbar"], h1, h2, h3, h4, strong, [role="heading"]') &&
    (!node.closest(cardSelector) || node.closest(cardSelector) === card) &&
    !bodyStops.some((stop) => !(node.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING)) &&
    !isInsideComment(node)
  );

  const preferred = candidates.filter((node) => node.matches(preferredCaption));
  const message = candidates.filter((node) => node.matches('[data-ad-preview="message"], [data-ad-comet-preview="message"]'));
  const selected = preferred.length ? preferred : message.length ? message : candidates;
  const first = selected[0];
  const messages = selected.filter((node) =>
    (node === first || node.parentElement === first?.parentElement) &&
    !node.parentElement?.closest(preferred.length ? preferredCaption : caption)
  );
  let content = messages.map((node) => {
    const text = node.cloneNode(true);
    text.querySelectorAll('[role="button"], button').forEach((child) => child.remove());
    return clean(text.textContent);
  }).filter(Boolean).join('\n').slice(0, 5000);

  if (!content || !content.trim()) {
    content = 'Bài viết không có nội dung';
  }

  const path = data.anchor.pathname;
  const type = /\/photo/i.test(path) || card.querySelector('a[href*="/photo"] img, [data-ad-preview="media"] img, img[src*="fbcdn"]')
    ? 'photo'
    : 'text';

  const reactionLabels = [...card.querySelectorAll('[aria-label]')].filter((node) => !isInsideComment(node)).map((node) => clean(node.getAttribute('aria-label')));
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
        elif re.fullmatch(r"/share/(?:p|v)/[A-Za-z0-9_-]+", path, re.IGNORECASE):
            return f"https://www.facebook.com{path}"
        elif re.search(r"/(?:posts|permalink|videos?|photo|photos)/", path, re.IGNORECASE) or (path.lower() == "/permalink.php" and ("story_fbid" in parsed.query or "fbid" in parsed.query)):
            return urlunsplit(("https", "www.facebook.com", path, parsed.query, ""))
        elif re.fullmatch(r"/[A-Za-z0-9._-]+", path) and path[1:].lower() not in RESERVED_PATHS and not path.lower().endswith(".php"):
            return f"https://www.facebook.com{path}"
    except ValueError:
        pass
    raise SourceScanError("Vui lòng nhập link Page, trang cá nhân hoặc bài viết Facebook hợp lệ.")


def _collect_post(raw: dict, source_url: str = ""):
    raw_url = (raw.get("url") or "").strip()
    try:
        parsed = _facebook_url(raw_url)
    except ValueError:
        return None

    path = parsed.path.rstrip("/")
    if re.search(r"/(?:reel|reels|videos?|watch|share/v)\b", path, re.IGNORECASE) or raw.get("type") == "video":
        return None

    query = parse_qs(parsed.query)
    if "comment_id" in query or "reply_comment_id" in query:
        return None

    post_id = None
    post_url = None

    # 1. Share post link: /share/p/{token}
    m_share = re.search(r"/share/p/([A-Za-z0-9_-]+)", path, re.IGNORECASE)
    if m_share:
        token = m_share.group(1)
        post_id = token
        post_url = f"https://www.facebook.com/share/p/{token}"

    # 2. story_fbid trong query (vd: permalink.php?story_fbid=pfbid...&id=61559108794337)
    elif "story_fbid" in query:
        story_fbid = query["story_fbid"][0]
        post_id = story_fbid
        page_id = query.get("id", [None])[0]
        if not page_id and source_url:
            m_src = re.search(r"facebook\.com/(?:profile\.php\?id=(\d+)|(\d+)(?:/|$))", source_url)
            if m_src:
                page_id = m_src.group(1) or m_src.group(2)
        if page_id:
            post_url = f"https://www.facebook.com/permalink.php?story_fbid={story_fbid}&id={page_id}"
        else:
            post_url = f"https://www.facebook.com/permalink.php?story_fbid={story_fbid}"

    # 3. /{page_id_or_username}/posts/{post_id}
    elif re.search(r"^/([A-Za-z0-9._-]+)/posts/([A-Za-z0-9_-]+)$", path, re.IGNORECASE):
        m_posts = re.search(r"^/([A-Za-z0-9._-]+)/posts/([A-Za-z0-9_-]+)$", path, re.IGNORECASE)
        owner_segment = m_posts.group(1)
        post_id = m_posts.group(2)
        if owner_segment.isdigit():
            post_url = f"https://www.facebook.com/permalink.php?story_fbid={post_id}&id={owner_segment}"
        else:
            post_url = f"https://www.facebook.com/{owner_segment}/posts/{post_id}"

    # 4. Photo link với fbid
    elif "fbid" in query:
        fbid = query["fbid"][0]
        post_id = fbid
        post_url = f"https://www.facebook.com/photo.php?fbid={fbid}"

    # 5. Các dạng permalink / posts khác
    else:
        m_other = re.search(r"/(?:posts|permalink|photo|photos)/([A-Za-z0-9_-]+)$", path, re.IGNORECASE)
        if m_other:
            post_id = m_other.group(1)
            post_url = urlunsplit(("https", "www.facebook.com", path, parsed.query, ""))
        else:
            return None

    if not post_id or not post_url:
        return None

    try:
        utime = int(raw.get("utime") or 0) or None
    except (ValueError, TypeError):
        utime = None
    published_at, _ = parse_facebook_published_at(utime=utime, iso_attr=raw.get("datetime"))
    for timestamp in raw.get("timestamps") or []:
        if published_at:
            break
        published_at, _ = parse_facebook_published_at(timestamp)

    content = (raw.get("content") or "").strip()
    if not content:
        content = "Bài viết không có nội dung"

    return {
        "id": post_id,
        "post_url": post_url,
        "content": content,
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


def collect_visible_posts(
    driver, source_url: str, stop: Event, *, seen_ids=None, limit=None, cursor=None
) -> list[dict]:
    """Read the next posts from one browser, preserving its scroll position between turns."""
    seen_ids = seen_ids if seen_ids is not None else set()
    cursor = cursor if cursor is not None else {}
    if cursor.get("done"):
        return []

    def read_batch(browser):
        if stop.is_set():
            return []
        if not _on_facebook_feed(browser):
            raise SourceScanError("Phiên Facebook đã hết hạn. Vui lòng đăng nhập lại tài khoản trong mục Quản lý tài khoản.")
        return browser.execute_script(_READ_FEED) or []

    if not cursor.get("started"):
        driver.set_page_load_timeout(20)
        try:
            driver.get(source_url)
        except TimeoutException:
            driver.execute_script("window.stop()")
        try:
            batch = WebDriverWait(driver, 10).until(lambda browser: read_batch(browser) or stop.is_set())
        except TimeoutException:
            batch = read_batch(driver)
        if stop.is_set():
            return []
        cursor.update(
            started=True, batch=batch or [], index=0, observed=set(), hovered=set(),
            previous_observed=0, idle_rounds=0,
        )

    posts = {}
    MAX_IDLE_ROUNDS = 12

    while True:
        if stop.is_set():
            return []
        batch = cursor["batch"]
        while cursor["index"] < len(batch):
            row = batch[cursor["index"]]
            cursor["index"] += 1
            post = _collect_post(row, source_url=source_url)
            if post is None:
                continue
            cursor["observed"].add(post["id"])
            if post["id"] in seen_ids:
                continue
            if not post["published_at"] and row.get("anchor") and len(cursor["hovered"]) < MAX_DATE_HOVERS and post["id"] not in cursor["hovered"]:
                cursor["hovered"].add(post["id"])
                post["published_at"] = _read_date_tooltip(driver, row["anchor"], stop)
            previous = posts.get(post["id"])
            if previous is None:
                posts[post["id"]] = post
            else:
                if not previous["content"] and post["content"]:
                    previous["content"] = post["content"]
                elif post["content"] and len(post["content"]) > len(previous["content"]) and previous["content"] in post["content"]:
                    previous["content"] = post["content"]
                for field in ("published_at", "reaction_count"):
                    previous[field] = previous[field] or post[field]
            if limit is not None and len(posts) >= limit:
                return list(posts.values())

        has_new_posts = len(cursor["observed"]) > cursor["previous_observed"]
        cursor["idle_rounds"] = 0 if has_new_posts else (cursor["idle_rounds"] + 1)
        if cursor["idle_rounds"] >= MAX_IDLE_ROUNDS:
            cursor["done"] = True
            break
        cursor["previous_observed"] = len(cursor["observed"])
        # Cuộn từ từ (bước ngắn ~450px) để không bị nhảy cóc bỏ qua bài viết
        driver.execute_script(
            "window.scrollBy({ top: Math.min(Math.round(window.innerHeight * 0.55), 480), left: 0, behavior: 'smooth' });"
        )
        wait_time = 1.3 if has_new_posts else 2.2
        if stop.wait(wait_time):
            return []
        cursor["batch"] = read_batch(driver)
        cursor["index"] = 0
    return list(posts.values())


def scan_source_posts(
    raw_url: str,
    owner: str,
    stop: Event,
    uids: list[str] | None = None,
    account_count: int | None = None,
) -> list[dict]:
    import logging
    from sqlalchemy import func
    from selenium.common.exceptions import WebDriverException

    from core.browser import close_scoped_active_drivers, get_active_drivers, get_profile_lock, load_cookies, open_browser
    from core.browser.proxy_bridge import ProxyError
    from modules.module_02_account_manager.database.connection import SessionLocal
    from modules.module_02_account_manager.database.models import Account

    source_url = normalize_source_url(raw_url)
    with SessionLocal() as session:
        query = session.query(Account.uid, Account.proxy, Account.cookie).filter(
            Account.user_id == owner,
            func.upper(Account.status) == "LIVE",
            func.upper(Account.login_status) == "LOGGED_IN",
        )
        if uids:
            accounts = query.filter(Account.uid.in_(uids)).order_by(Account.id).all()
        else:
            accounts = query.order_by(Account.id).all()

        if not accounts and uids:
            accounts = session.query(Account.uid, Account.proxy, Account.cookie).filter(
                Account.user_id == owner,
                func.upper(Account.status) == "LIVE",
                func.upper(Account.login_status) == "LOGGED_IN",
            ).order_by(Account.id).all()

        if account_count and account_count > 0 and len(accounts) > account_count:
            accounts = accounts[:account_count]

    if not accounts:
        raise SourceScanError("Không tìm thấy tài khoản Facebook Live và đã đăng nhập trong mục Số lượng tài khoản sử dụng.")
    scope = f"{SCAN_SCOPE}:{owner}"
    logger = logging.getLogger(__name__)
    states = [
        {"uid": uid, "proxy": proxy, "cookie": cookie, "driver": None,
         "lock": None, "cursor": {}, "active": True}
        for uid, proxy, cookie in accounts
    ]
    collected = {}
    failures = []
    busy_accounts = 0

    def close_state(state):
        state["active"] = False
        try:
            if state["driver"] is not None:
                close_scoped_active_drivers(scope, uids=[state["uid"]])
        except Exception:
            logger.warning("Không thể đóng trình duyệt quét bài viết của tài khoản %s", state["uid"])
        finally:
            state["driver"] = None
            if state["lock"] is not None:
                state["lock"].release()
                state["lock"] = None

    try:
        for state in states:
            if stop.is_set():
                return []
            uid = state["uid"]
            lock = get_profile_lock(uid, owner=owner)
            if not lock.acquire(blocking=False):
                busy_accounts += 1
                continue
            state["lock"] = lock
            if get_active_drivers(uid, owner=owner):
                busy_accounts += 1
                close_state(state)
                continue
            try:
                state["driver"] = open_browser(
                    uid=uid, owner=owner, proxy=state["proxy"], scope=scope,
                    headless=False, verify_egress=False, allow_direct_fallback=True,
                )
                if state["cookie"]:
                    load_cookies(state["driver"], state["cookie"])
                batch = collect_visible_posts(
                    state["driver"], source_url, stop, seen_ids=collected,
                    cursor=state["cursor"],
                )
                for post in batch:
                    collected.setdefault(post["id"], post)
                if collected:
                    return list(collected.values())
            except (ProxyError, WebDriverException, RuntimeError) as exc:
                logger.warning("Quét bài viết thất bại với tài khoản %s: %s", uid, type(exc).__name__)
                failures.append(exc)
            finally:
                close_state(state)

        if collected:
            return list(collected.values())
        if failures:
            raise failures[0]
        if busy_accounts:
            raise SourceScanError("Các tài khoản Facebook khả dụng đang mở Chrome hoặc đang chạy tác vụ khác.", 409)
        return []
    finally:
        for state in states:
            if state["driver"] is not None or state["lock"] is not None:
                close_state(state)
