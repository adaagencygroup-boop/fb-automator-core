"""Đếm Fanpage nick đang quản lý trên https://www.facebook.com/pages/?category=your_pages."""
import threading
from urllib.parse import parse_qs, urlparse

from selenium.webdriver.common.by import By

YOUR_PAGES_URL = "https://www.facebook.com/pages/?category=your_pages"
_SWITCH_LABELS = ("chuyển sang", "switch now", "switch")
_CARD_NOISE = set(_SWITCH_LABELS) | {
    "create post", "promote", "messages", "notifications", "notification",
    "tạo bài viết", "quảng cáo", "tin nhắn", "thông báo",
}
_PROFILE_PICTURE_XPATH = (
    '//a[@href and ('
    'contains(translate(@aria-label, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "profile picture")'
    ' or contains(@aria-label, "Ảnh đại diện")'
    ' or .//*[contains(translate(@aria-label, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "profile picture")'
    ' or contains(@aria-label, "Ảnh đại diện")]'
    ')]'
)
_SCAN_SCRIPT = """
const labels = ["profile picture", "ảnh đại diện"];
const noise = new Set(%s);
const matches = (value) => {
  const label = (value || "").trim().toLowerCase();
  return labels.some((item) => label.includes(item));
};
return Array.from(document.querySelectorAll("a[href]")).filter((anchor) => {
  if (matches(anchor.getAttribute("aria-label"))) return true;
  return Array.from(anchor.querySelectorAll("[aria-label]")).some((node) => matches(node.getAttribute("aria-label")));
}).map((anchor) => {
  let name = "";
  let node = anchor;
  for (let depth = 0; depth < 8 && node; depth += 1) {
    const lines = Array.from(node.querySelectorAll("a[href], span"))
      .map((item) => (item.innerText || "").trim())
      .filter((text) => text && !noise.has(text.toLowerCase()) && text.length < 150);
    if (lines.length) {
      name = lines[0];
      break;
    }
    node = node.parentElement;
  }
  return {href: anchor.href || "", text: name || (anchor.innerText || "")};
});
""" % str(list(_CARD_NOISE)).replace("'", '"')

_counts_lock = threading.Lock()
_counts = {}


def page_name_from_anchor_text(text: str) -> str:
    for raw in (text or "").splitlines():
        line = " ".join(raw.split()).strip()
        if len(line) < 2:
            continue
        if line.lower() in _CARD_NOISE:
            continue
        return line[:150]
    return ""


def anchor_key(href: str) -> str:
    raw = (href or "").strip()
    if not raw or "category=your_pages" in raw:
        return ""
    parsed = urlparse(raw.replace("web.facebook.com", "www.facebook.com"))
    if "facebook.com" not in (parsed.netloc or ""):
        return ""
    query = parse_qs(parsed.query)
    for field in ("page_id", "id"):
        value = (query.get(field) or [""])[0].strip()
        if value.isdigit():
            return value
    path = parsed.path.strip("/")
    if not path or path.lower() in {"pages", "pages/"}:
        return ""
    return path


def pages_from_anchors(anchors) -> list:
    """anchors: iterable of (href, text). Mỗi page một dòng, bỏ link danh sách."""
    found = {}
    for href, text in anchors:
        key = anchor_key(href)
        if not key or key in found:
            continue
        found[key] = {
            "id": key,
            "name": page_name_from_anchor_text(text) or "Fanpage",
            "url": (href or "").strip(),
            "category": "",
            "graph_id": key if key.isdigit() else "",
        }
    return list(found.values())


def keep_saved_categories(pages, previous_categories: dict) -> list:
    """Giữ từ khóa đã lưu khi đếm lại, trừ khi lần quét mới đã có hạng mục."""
    merged = []
    for page in pages:
        row = dict(page)
        if not str(row.get("category") or "").strip():
            row["category"] = previous_categories.get(str(row.get("id") or ""), "")
        merged.append(row)
    return merged


def keep_saved_avatars(pages, previous_avatars: dict) -> list:
    """Giữ URL ảnh đã lưu khi lần đếm mới không mang theo ảnh."""
    merged = []
    for page in pages:
        row = dict(page)
        if not str(row.get("avatar_url") or "").strip():
            row["avatar_url"] = previous_avatars.get(str(row.get("id") or ""), "") or ""
        merged.append(row)
    return merged


def _scope(owner, uid) -> tuple:
    return str(owner or ""), str(uid or "")


def _row_to_page(row: dict) -> dict:
    key = str(row.get("page_key") or "")
    return {
        "id": key,
        "name": row.get("page_name") or "Fanpage",
        "url": row.get("page_url") or "",
        "category": row.get("category") or "",
        "graph_id": key if key.isdigit() else "",
        "avatar_url": row.get("avatar_url") or "",
    }


def load_saved_count(owner, uid):
    """None nếu nick này chưa đếm lần nào. Danh sách rỗng vẫn là một lần đếm hợp lệ."""
    from core.database.connection import db

    scope = _scope(owner, uid)
    scan = db.fetch_one(
        "SELECT page_count FROM ai_page_scans WHERE owner_username = ? AND account_uid = ?",
        scope,
    )
    if not scan:
        return None
    rows = db.fetch_all(
        """
        SELECT page_key, page_name, page_url, category, avatar_url
        FROM ai_managed_pages
        WHERE owner_username = ? AND account_uid = ?
        ORDER BY id
        """,
        scope,
    )
    pages = [_row_to_page(row) for row in rows]
    count = int(scan.get("page_count") or 0)
    return {"status": "done", "count": count, "pages": pages, "message": f"{count} page"}


def save_managed_pages(owner, uid, pages, page_count=None) -> list:
    """Thay danh sách page của nick bằng lần đếm mới. Từ khóa cũ của page còn lại được giữ."""
    from core.database.connection import db

    scope = _scope(owner, uid)
    previous_rows = db.fetch_all(
        "SELECT page_key, category, avatar_url FROM ai_managed_pages WHERE owner_username = ? AND account_uid = ?",
        scope,
    )
    previous = {str(row.get("page_key") or ""): row.get("category") or "" for row in previous_rows}
    previous_avatars = {str(row.get("page_key") or ""): row.get("avatar_url") or "" for row in previous_rows}
    kept = keep_saved_avatars(keep_saved_categories(pages, previous), previous_avatars)
    db.execute("DELETE FROM ai_managed_pages WHERE owner_username = ? AND account_uid = ?", scope)
    for page in kept:
        db.execute(
            """
            INSERT INTO ai_managed_pages (
                owner_username, account_uid, page_key, page_name, page_url, category, avatar_url
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                scope[0],
                scope[1],
                str(page.get("id") or "")[:200],
                str(page.get("name") or "Fanpage")[:255],
                page.get("url") or "",
                str(page.get("category") or "")[:200],
                str(page.get("avatar_url") or ""),
            ),
        )
    db.execute(
        """
        INSERT INTO ai_page_scans (owner_username, account_uid, page_count, scanned_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (owner_username, account_uid)
        DO UPDATE SET page_count = EXCLUDED.page_count, scanned_at = CURRENT_TIMESTAMP
        """,
        (scope[0], scope[1], len(kept) if page_count is None else int(page_count)),
    )
    return kept


def remember_keywords(owner, uid, keywords: dict) -> None:
    """Ghi từ khóa người dùng sửa, để lần mở app sau ô nhập không bị trống."""
    from core.database.connection import db

    scope = _scope(owner, uid)
    cleaned = {str(key): str(value or "").strip()[:200] for key, value in (keywords or {}).items() if str(key).strip()}
    for key, value in cleaned.items():
        db.execute(
            """
            UPDATE ai_managed_pages
            SET category = ?, updated_at = CURRENT_TIMESTAMP
            WHERE owner_username = ? AND account_uid = ? AND page_key = ?
            """,
            (value, scope[0], scope[1], key),
        )
    with _counts_lock:
        cached = _counts.get(scope)
        if not cached:
            return
        for page in cached.get("pages") or []:
            value = cleaned.get(str(page.get("id") or ""))
            if value is not None:
                page["category"] = value


def remember_avatar(owner, uid, page_key, avatar_url) -> None:
    """Ghi URL ảnh page. Lần mở danh sách sau chỉ đọc, không tải lại Facebook."""
    from core.database.connection import db
    from modules.module_05_page_manager.page_avatar import valid_page_avatar

    url = str(avatar_url or "").strip()
    key = str(page_key or "").strip()[:200]
    if not key or not valid_page_avatar(url):
        return
    scope = _scope(owner, uid)
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_page_avatars (
            owner_username VARCHAR(100) NOT NULL,
            page_key VARCHAR(200) NOT NULL,
            avatar_url TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (owner_username, page_key)
        )
        """
    )
    db.execute(
        """
        INSERT INTO ai_page_avatars (owner_username, page_key, avatar_url, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (owner_username, page_key) DO UPDATE SET
            avatar_url = EXCLUDED.avatar_url,
            updated_at = CURRENT_TIMESTAMP
        """,
        (scope[0], key, url),
    )
    db.execute(
        """
        UPDATE ai_managed_pages
        SET avatar_url = ?, updated_at = CURRENT_TIMESTAMP
        WHERE owner_username = ? AND account_uid = ? AND page_key = ?
        """,
        (url, scope[0], scope[1], key),
    )
    with _counts_lock:
        cached = _counts.get(scope)
        if not cached:
            return
        for page in cached.get("pages") or []:
            if str(page.get("id") or "") == key:
                page["avatar_url"] = url


def load_avatar_map(owner) -> dict:
    from core.database.connection import db

    owner_name = str(owner or "")
    if not owner_name:
        return {}
    try:
        rows = db.fetch_all(
            "SELECT page_key, avatar_url FROM ai_page_avatars WHERE owner_username = ?",
            (owner_name,),
        )
    except Exception:
        rows = []
    return {
        str(row.get("page_key") or ""): row.get("avatar_url") or ""
        for row in rows
        if row.get("page_key")
    }


def persist_page_avatars(owner, uid, pages) -> list:
    """Page đã có URL hợp lệ thì giữ. Thiếu thì tải một lần và ghi DB."""
    from concurrent.futures import ThreadPoolExecutor

    from modules.module_05_page_manager.page_avatar import page_avatar, valid_page_avatar

    if not pages:
        return []
    known = load_avatar_map(owner)

    def one(page):
        key = str(page.get("id") or "")
        stored = str(page.get("avatar_url") or "") or known.get(key, "")
        if valid_page_avatar(stored):
            page["avatar_url"] = stored
            return stored
        found = page_avatar(str(page.get("url") or ""), str(page.get("graph_id") or key))
        if valid_page_avatar(found):
            try:
                remember_avatar(owner, uid, key, found)
            except Exception:
                pass
            page["avatar_url"] = found
            return found
        return ""

    with ThreadPoolExecutor(max_workers=min(6, len(pages))) as pool:
        return list(pool.map(one, pages))


def get_count(owner, uid) -> dict:
    scope = _scope(owner, uid)
    with _counts_lock:
        row = _counts.get(scope)
        if row:
            return dict(row)
    try:
        saved = load_saved_count(owner, uid)
    except Exception:
        return {}
    if not saved:
        return {}
    with _counts_lock:
        _counts.setdefault(scope, saved)
        return dict(_counts[scope])


def _set_count(owner, uid, **fields):
    key = (str(owner or ""), str(uid or ""))
    with _counts_lock:
        current = dict(_counts.get(key) or {})
        current.update(fields)
        _counts[key] = current
        return dict(current)


def is_profile_picture_label(label: str) -> bool:
    text = " ".join((label or "").split()).lower()
    return "profile picture" in text or "ảnh đại diện" in text


def _harvest(driver) -> list:
    """Quét mọi thẻ a trên trang. Chỉ giữ link có aria-label Profile picture."""
    raw = []
    try:
        scanned = driver.execute_script(_SCAN_SCRIPT) or []
        raw = [(item.get("href") or "", item.get("text") or "") for item in scanned]
    except Exception:
        raw = []
    if not raw:
        for element in driver.find_elements(By.XPATH, _PROFILE_PICTURE_XPATH):
            raw.append((element.get_attribute("href") or "", element.text or ""))
    return pages_from_anchors(raw)


_PROFILE_LABELS = ("your profile", "trang cá nhân của bạn", "account", "tài khoản")
_SEE_ALL_LABELS = ("see all profiles", "xem tất cả trang cá nhân", "xem tất cả hồ sơ")
_SWITCHER_NOISE = frozenset({
    "see all profiles",
    "xem tất cả trang cá nhân",
    "xem tất cả hồ sơ",
    "select profile",
    "chọn trang cá nhân",
    "your profile",
    "trang cá nhân của bạn",
})
_HOME_URL = "https://www.facebook.com/"
_LIST_ROWS_SCRIPT = """
const noise = new Set(arguments[0]);
const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="menu"]'))
  .filter((el) => el.getClientRects().length);
const root = dialogs[dialogs.length - 1];
if (!root) return [];
return Array.from(root.querySelectorAll('[data-visualcompletion="ignore-dynamic"]')).map((row) => {
  const lines = (row.innerText || "").split("\\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > 4) return null;
  const name = lines.find((line) => !noise.has(line.toLowerCase()) && line.length > 1 && line.length < 150) || "";
  const checked = !!row.querySelector('[aria-checked="true"], [aria-current="page"]');
  return name ? {name, checked} : null;
}).filter(Boolean);
"""
_CLICK_LABEL_SCRIPT = """
const labels = new Set(arguments[0]);
const nodes = Array.from(document.querySelectorAll("[aria-label]")).filter((el) => {
  const label = (el.getAttribute("aria-label") || "").trim().toLowerCase();
  if (!labels.has(label)) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
});
if (!nodes.length) return false;
nodes[0].click();
return true;
"""
_CLICK_ROW_SCRIPT = """
const target = (arguments[0] || "").trim().toLowerCase();
const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="menu"]'))
  .filter((el) => el.getClientRects().length);
const root = dialogs[dialogs.length - 1];
if (!root || !target) return false;
const row = Array.from(root.querySelectorAll('[data-visualcompletion="ignore-dynamic"]')).find((item) => {
  const text = (item.innerText || "").trim().toLowerCase();
  return text === target || text.startsWith(target + "\\n");
});
if (!row) return false;
const button = row.querySelector('[role="button"]') || row;
button.click();
return true;
"""


def switcher_page_names(rows, personal_name: str = "") -> list:
    """Bỏ nick cá nhân và nhãn menu. Mỗi dòng ignore-dynamic còn lại là một fanpage."""
    personal = " ".join((personal_name or "").casefold().split())
    names = []
    for row in rows or []:
        if isinstance(row, str):
            name, checked = row, False
        else:
            name, checked = row.get("name") or "", bool(row.get("checked"))
        name = " ".join(str(name).split())
        folded = name.casefold()
        if len(name) < 2 or folded in _SWITCHER_NOISE:
            continue
        if "notification" in folded or folded.endswith("thông báo"):
            continue
        if checked or (personal and folded == personal):
            continue
        if name not in names:
            names.append(name)
    return names


def _click_aria(driver, labels) -> bool:
    try:
        return bool(driver.execute_script(_CLICK_LABEL_SCRIPT, [label.lower() for label in labels]))
    except Exception:
        return False


def _open_profile_switcher(driver) -> bool:
    from modules.module_02_account_manager.automation.browser_manager import human_sleep

    if not _click_aria(driver, _PROFILE_LABELS):
        return False
    human_sleep(0.8, 1.3)
    _click_aria(driver, _SEE_ALL_LABELS)
    human_sleep(0.8, 1.3)
    return True


def _switcher_rows(driver) -> list:
    try:
        return driver.execute_script(_LIST_ROWS_SCRIPT, sorted(_SWITCHER_NOISE)) or []
    except Exception:
        return []


def _wait_switched_page_id(driver, personal_uid: str, previous_id: str, timeout: float = 8) -> str:
    import time

    from modules.module_02_account_manager.automation.browser_manager import human_sleep

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        cookie = driver.get_cookie("i_user") or {}
        value = str(cookie.get("value") or "")
        if value and value not in {str(personal_uid or ""), str(previous_id or "")}:
            return value
        human_sleep(0.35, 0.55)
    return ""


def _url_for_switched_page(driver, page_id: str) -> str:
    current = (driver.current_url or "").strip()
    if page_id and "facebook.com" in current and page_id in current and "category=your_pages" not in current:
        return current
    if page_id:
        return f"https://www.facebook.com/profile.php?id={page_id}"
    return current


def enter_pages_from_profile_switcher(driver, personal_uid: str, personal_name: str = "") -> list:
    """Từ news feed: Your profile -> See all profiles -> vào từng page và lấy danh sách."""
    from modules.module_02_account_manager.automation.browser_manager import human_sleep

    try:
        driver.delete_cookie("i_user")
    except Exception:
        pass
    driver.get(_HOME_URL)
    human_sleep(2.5, 3.5)
    if not _open_profile_switcher(driver):
        return []
    names = switcher_page_names(_switcher_rows(driver), personal_name)
    found = []
    previous_id = ""
    for name in names[:40]:
        if found and not _open_profile_switcher(driver):
            break
        try:
            clicked = bool(driver.execute_script(_CLICK_ROW_SCRIPT, name))
        except Exception:
            clicked = False
        if not clicked:
            continue
        human_sleep(1.2, 1.8)
        page_id = _wait_switched_page_id(driver, personal_uid, previous_id)
        if not page_id:
            continue
        previous_id = page_id
        found.append({
            "id": page_id,
            "name": name,
            "url": _url_for_switched_page(driver, page_id),
            "category": "",
            "graph_id": page_id if page_id.isdigit() else "",
        })
    return found


def collect_managed_pages(driver, rounds: int = 12) -> list:
    """Mở your_pages, cuộn hết lazy-load, đếm thẻ a có aria-label Profile picture."""
    from modules.module_02_account_manager.automation.browser_manager import human_sleep

    driver.get(YOUR_PAGES_URL)
    human_sleep(3.0, 4.5)
    found = {}
    last = -1
    stable = 0
    for _ in range(rounds):
        for page in _harvest(driver):
            found[page["id"]] = page
        if len(found) == last:
            stable += 1
            if stable >= 2:
                break
        else:
            stable = 0
            last = len(found)
        driver.execute_script(
            """
            const main = document.querySelector('[role="main"]');
            if (main) main.scrollTop = main.scrollHeight;
            window.scrollTo(0, document.body.scrollHeight);
            """
        )
        human_sleep(1.0, 1.6)
    return list(found.values())


def _usable_driver(owner, uid):
    from core.browser import get_active_drivers

    for driver in get_active_drivers(uid=uid, owner=owner):
        try:
            driver.current_url
        except Exception:
            continue
        return driver
    return None


def open_fanpage_in_browser(owner, uid: str, page: dict):
    """Mở Chrome của nick và đứng trong đúng fanpage. Cửa sổ được giữ lại cho người dùng."""
    from modules.module_02_account_manager.automation.browser_manager import (
        close_driver_for_uid,
        create_driver,
        get_profile_lock,
        human_sleep,
        register_active_driver,
    )
    from modules.module_02_account_manager.automation.login_flow import ensure_logged_in
    from modules.module_02_account_manager.context import owner_scope
    from modules.module_02_account_manager.database.connection import SessionLocal
    from modules.module_02_account_manager.database.repository import AccountRepository as Repo
    from modules.module_02_account_manager.services.credentials import decrypt
    from modules.module_02_account_manager.services.events import broadcast
    from modules.module_05_page_manager.page_poster import confirm_use_page, use_page_session

    page_id = str(page.get("graph_id") or page.get("id") or "").strip()
    page_name = page.get("name") or "Fanpage"
    try:
        persist_page_avatars(owner, uid, [page])
    except Exception:
        pass
    page_url = page.get("url") or (f"https://www.facebook.com/profile.php?id={page_id}" if page_id.isdigit() else "")
    with owner_scope(owner):
        lock = get_profile_lock(uid)
        if not lock.acquire(timeout=20):
            broadcast("warning", f"Nick {uid} đang bận. Hãy đợi lượt đăng nhập hoặc đếm page xong.", uid=uid)
            return
        db = None
        driver = None
        created = False
        try:
            driver = _usable_driver(owner, uid)
            if driver is None:
                db = SessionLocal()
                account = Repo.get_by_uid(db, uid, owner_username=owner)
                if account is None:
                    broadcast("error", f"Không tìm thấy tài khoản {uid}", uid=uid)
                    return
                try:
                    password = decrypt(account.password) if account.password else ""
                except Exception:
                    password = ""
                try:
                    two_fa = decrypt(account.two_fa) if account.two_fa else None
                except Exception:
                    two_fa = None
                broadcast("info", f"Đang mở Chrome của {uid} để vào {page_name}.", uid=uid)
                driver = create_driver(uid, detach=True, proxy=account.proxy, scope="ai-page")
                register_active_driver(driver, uid=uid, scope="ai-page")
                created = True
                login = ensure_logged_in(
                    driver=driver,
                    uid=uid,
                    password=password,
                    two_fa=two_fa,
                    cookie=account.cookie,
                )
                if not login.get("success"):
                    broadcast("error", login.get("error") or f"Không đăng nhập được {uid}", uid=uid)
                    close_driver_for_uid(uid)
                    return
            else:
                broadcast("info", f"Chuyển Chrome của {uid} sang {page_name}.", uid=uid)
            use_page_session(driver, page_id)
            if page_url:
                driver.get(page_url)
                human_sleep(2.0, 2.8)
            if confirm_use_page(driver):
                broadcast("info", f"Đã bấm Dùng Page cho {page_name}.", uid=uid)
            broadcast("success", f"Đã vào page {page_name}.", uid=uid)
        except Exception as exc:
            broadcast("error", f"Không mở được {page_name}: {exc}", uid=uid)
            if created:
                try:
                    close_driver_for_uid(uid)
                except Exception:
                    pass
        finally:
            if db is not None:
                db.close()
            lock.release()


def count_pages_for_account(owner, uid: str):
    """Đăng nhập nick trong đúng owner, đếm page trên your_pages, rồi đóng Chrome."""
    from modules.module_02_account_manager.context import owner_scope

    with owner_scope(owner):
        _count_pages(uid)


def _count_pages(uid: str):
    from modules.module_02_account_manager.automation.browser_manager import (
        close_driver_for_uid,
        create_driver,
        get_profile_lock,
        register_active_driver,
    )
    from modules.module_02_account_manager.automation.login_flow import ensure_logged_in
    from modules.module_02_account_manager.context import owner_context
    from modules.module_02_account_manager.database.connection import SessionLocal
    from modules.module_02_account_manager.database.repository import AccountRepository as Repo
    from modules.module_02_account_manager.services.credentials import decrypt
    from modules.module_02_account_manager.services.events import broadcast

    owner = owner_context.get()
    _set_count(owner, uid, status="running", count=0, pages=[], message="Đang đăng nhập, đếm page và vào từng fanpage")
    lock = get_profile_lock(uid)
    lock.acquire()
    db = None
    driver = None
    try:
        db = SessionLocal()
        account = Repo.get_by_uid(db, uid, owner_username=owner)
        if account is None:
            _set_count(owner, uid, status="error", message="Không tìm thấy tài khoản")
            broadcast("error", f"Không tìm thấy tài khoản {uid}", uid=uid)
            return
        try:
            password = decrypt(account.password) if account.password else ""
        except Exception:
            password = ""
        try:
            two_fa = decrypt(account.two_fa) if account.two_fa else None
        except Exception:
            two_fa = None
        driver = create_driver(uid, proxy=account.proxy, scope="ai-count")
        register_active_driver(driver, uid=uid, scope="ai-count")
        login = ensure_logged_in(
            driver=driver,
            uid=uid,
            password=password,
            two_fa=two_fa,
            cookie=account.cookie,
        )
        if not login.get("success"):
            message = login.get("error") or "Đăng nhập thất bại"
            _set_count(owner, uid, status="error", message=message)
            broadcast("error", f"Đăng nhập thất bại {uid}: {message}", uid=uid)
            return
        counted = collect_managed_pages(driver)
        broadcast("info", f"{uid} đếm được {len(counted)} page. Đang vào từng fanpage.", uid=uid)
        entered = enter_pages_from_profile_switcher(driver, uid, account.profile_name or "")
        listed = entered or counted
        pages = save_managed_pages(owner, uid, listed, page_count=len(counted))
        try:
            persist_page_avatars(owner, uid, pages)
        except Exception:
            pass
        _set_count(
            owner,
            uid,
            status="done",
            count=len(counted),
            pages=pages,
            message=f"{len(counted)} page",
        )
        broadcast("success", f"{uid} đang quản lý {len(counted)} page, đã mở {len(entered)} fanpage.", uid=uid)
    except Exception as exc:
        _set_count(owner, uid, status="error", message=str(exc)[:300])
        broadcast("error", f"Không đếm được page của {uid}: {exc}", uid=uid)
    finally:
        if db is not None:
            db.close()
        if driver is not None:
            try:
                close_driver_for_uid(uid)
            except Exception:
                try:
                    driver.quit()
                except Exception:
                    pass
        lock.release()
