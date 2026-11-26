"""Đọc 1 trang cá nhân bằng Chrome đã đăng nhập. Mọi phép bóc tách chữ nằm ở parse.py."""
from __future__ import annotations

import logging
import random
import re
import time
from typing import Any, Callable, Dict, Iterator, List, Optional

from selenium.common.exceptions import (
    ElementClickInterceptedException, ElementNotInteractableException, StaleElementReferenceException, TimeoutException,
)

from core.browser.human import human_click
from modules.module_03_acc_farm.browser.errors import is_browser_gone

from .parse import (
    about_region, bio_from_source, clean_lines, find_phones, key_to_url, page_state, parse_about, parse_counts,
    parse_intro, profile_key, section_url, uid_from_source,
)

logger = logging.getLogger(__name__)

PAGE_TIMEOUT = 45
WAIT_READY = 15


class AccountBlocked(RuntimeError):
    """Tài khoản quét bị checkpoint / đăng xuất / chặn tạm thời."""


class ProfileSkipped(RuntimeError):
    """Không quét được người này (không tồn tại, đã khóa) hoặc không đạt bộ lọc."""


class Stopped(RuntimeError):
    """Người dùng bấm dừng."""


# Tên, phần đầu trang (trước khối bài viết), thẻ Giới thiệu, ảnh đại diện
_READ_JS = r"""
const bad = /^(facebook|đăng nhập|chats|đoạn chat|notifications|thông báo)$/i;
// "1 follower" (số ít) ở trang mới / trang chuyên nghiệp ít người theo dõi
const counts = /người theo dõi|\bfollowers?\b/i;
const friends = /\d[\d.,]*\s*(?:k|n|nghìn|tr)?\s*(?:bạn bè|người bạn|friends?)(?!\p{L})/iu;
const ok = s => !!s && !bad.test(s);
const goodH1 = m => [...m.querySelectorAll('h1')].find(h => ok(h.innerText.trim()));
const mains = [...document.querySelectorAll('[role="main"]')];
const main = mains.find(goodH1) || mains.find(m => [counts, friends].some(r => r.test((m.innerText || '').slice(0, 3000)))) || mains[mains.length - 1];
const h1Count = document.querySelectorAll('h1').length;
if (!main) return {name: '', name_source: '', header: '', intro: '', text: (document.body ? document.body.innerText : '').slice(0, 6000), avatar: '', h1_count: h1Count};
const h1 = goodH1(main);
const lines = (main.innerText || '').slice(0, 6000).split('\n').map(s => s.trim()).filter(Boolean);
let name = h1 ? h1.innerText.trim().split('\n')[0].trim() : '';
let source = name ? 'h1' : '';
// Tiêu đề có trước khi trang dựng xong, và có cả ở trang lỗi → chỉ tin khi tên đó hiện trong trang
const clean = s => (s || '').replace(/^\(\d+\+?\)\s*/, '').replace(/\s*\|\s*Facebook\s*$/i, '').trim();
const shown = s => lines.some(l => l === s || l.startsWith(s + ' ('));
if (!name) {
  const og = document.querySelector('meta[property="og:title"]');
  for (const [from, value] of [['title', clean(document.title)], ['og', clean(og && og.content)]]) {
    if (ok(value) && shown(value)) { name = value; source = from; break; }
  }
}
if (!name) {
  const at = lines.findIndex((l, i) => i < 40 && (/\d.*(người theo dõi|\bfollowers?\b)/i.test(l) || friends.test(l)));
  for (let i = at - 1; i >= 0; i--) {
    const l = lines[i];
    if (/^[\d.,+]+$/.test(l) || /số thông báo chưa đọc|unread notifications/i.test(l) || /[·•]/.test(l) || counts.test(l) || friends.test(l)) continue;
    if (ok(l)) { name = l; source = 'header'; }
    break;
  }
}
// Không có h1: lấy phần tử nhỏ nhất đang hiện tên để dò phần đầu trang
let anchor = h1;
if (!anchor && name) {
  anchor = [...main.querySelectorAll('span, div, h2, h3, a, strong')].find(e => {
    const first = (e.innerText || '').trim().split('\n')[0].trim();
    return e.innerText.length < 200 && (first === name || first.startsWith(name + ' ('));
  });
}
let header = '';
for (let el = anchor, i = 0; el && i < 8 && el.parentElement && el.parentElement !== main; i++) {
  el = el.parentElement;
  const t = el.innerText || '';
  if (t.length > 900) break;
  header = t;
}
if (!h1 && name && !/người theo dõi|followers?|bạn bè|friends?/i.test(header)) {
  const at = lines.findIndex(l => l === name || l.startsWith(name + ' ('));
  if (at >= 0) header = lines.slice(at, at + 8).join('\n');
}
// Tiểu sử ở đầu trang: chữ thường nằm giữa hàng nút và thanh tab (danh mục/SĐT nằm trong list, nút nằm trong button)
let bio = '';
const tabs = [...main.querySelectorAll('[role="tablist"]')][0];
if (anchor && tabs) {
  const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  const action = /^(message|follow|following|search|call now|add friend|friends|nhắn tin|theo dõi|đang theo dõi|tìm kiếm|gọi ngay|thêm bạn bè|bạn bè)$/i;
  const buttons = [...main.querySelectorAll('[role="button"]')].filter(e => action.test((e.innerText || '').trim()) && after(anchor, e) && after(e, tabs));
  const from = buttons[buttons.length - 1];
  const blocks = [];
  const walk = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  for (let n; from && (n = walk.nextNode());) {
    if (!after(from, n) || from.contains(n)) continue;
    if (!after(n, tabs) || tabs.contains(n)) break;
    const p = n.parentElement;
    if (!n.nodeValue.trim() || !p || p.closest('[role="button"], [role="list"], [role="tablist"], h1, h2, h3, [role="heading"]')) continue;
    const block = p.closest('div');
    if (block && !block.contains(from) && !block.contains(tabs) && !blocks.some(b => b.contains(block))) blocks.push(block);
  }
  bio = blocks.flatMap(b => (b.innerText || '').split('\n')).map(s => s.replace(/\s*(?:…|\.\.\.)?\s*(?:see more|xem thêm)$/i, '').trim())
    .filter(s => s && s !== name && !counts.test(s) && !friends.test(s) && !action.test(s)).join('\n').slice(0, 1000);
}
let intro = '';
let box = [...main.querySelectorAll('h2, [role="heading"]')].find(e => /^(intro|giới thiệu)$/i.test(e.innerText.trim()));
for (let i = 0; box && i < 7; i++) {
  box = box.parentElement;
  if (!box || box === main) break;
  if (box.innerText.split('\n').length > 2) { intro = box.innerText.slice(0, 3000); break; }
}
let avatar = '';
for (const img of main.querySelectorAll('svg[role="img"] image')) {
  if (img.getBoundingClientRect().width < 100) continue;
  avatar = img.getAttribute('xlink:href') || img.getAttribute('href') || '';
  if (avatar) break;
}
return {name, name_source: source, header, bio, intro, text: (main.innerText || '').slice(0, 6000), avatar, h1_count: h1Count};
"""

# Nút mở tab Giới thiệu trên thanh tab; không thấy thì trả nút "Xem thêm" để mở ra tìm tiếp
_ABOUT_TAB_JS = r"""
const seen = e => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
const label = e => (e.innerText || '').trim().toLowerCase();
const bars = [...document.querySelectorAll('[role="main"] [role="tablist"]')].filter(seen);
const items = [...(bars[0] ? bars[0].querySelectorAll('a, [role="tab"], [role="button"]') : []),
  ...document.querySelectorAll('[role="menu"] a, [role="menuitem"], [role="menuitemradio"]')].filter(seen);
const about = items.find(e => ['about', 'giới thiệu'].includes(label(e)));
if (about) return {about};
return {more: items.find(e => ['more', 'xem thêm'].includes(label(e))) || null};
"""

# Menu dọc bên trái khối Giới thiệu + chữ của riêng cột nội dung bên phải
_ABOUT_JS = r"""
const box = e => e.getBoundingClientRect();
const seen = e => box(e).width > 1 && box(e).height > 1;
const mains = [...document.querySelectorAll('[role="main"]')];
const links = mains.flatMap(m => [...m.querySelectorAll('a[href]')])
  .filter(a => /[\/=](?:about|directory)_[a-z_]+/.test(a.href) && seen(a) && (a.innerText || '').trim());
// Các mục menu thẳng hàng trái, xếp dọc; tab ngang và link lẻ trong nội dung thì không
let menu = [];
for (const a of links) {
  const col = links.filter(b => Math.abs(box(b).left - box(a).left) < 4);
  if (col.length > menu.length || (col.length === menu.length && col.length && box(col[0]).left < box(menu[0]).left)) menu = col;
}
if (menu.length < 2) menu = [];
let text = '';
if (menu.length) {
  let el = menu[0];
  while (el.parentElement && !menu.every(m => el.contains(m))) el = el.parentElement;
  const right = Math.max(...menu.map(m => box(m).right));
  for (; el.parentElement && el.getAttribute('role') !== 'main'; el = el.parentElement) {
    const side = [...el.parentElement.children].filter(c => c !== el && seen(c) && box(c).left >= right - 8 && (c.innerText || '').trim());
    if (side.length) { text = side.map(c => c.innerText).join('\n'); break; }
  }
}
const names = new Set();
const items = [];
for (const a of menu) {
  const label = a.innerText.trim().split('\n')[0].trim();
  if (names.has(label)) continue;
  names.add(label);
  items.push({el: a, label, href: a.href});
}
const last = mains[mains.length - 1];
return {items, text, all: last ? last.innerText : ''};
"""

# Mục Giới thiệu không có thông tin cần lấy
_SKIP_ITEM = re.compile(
    r"[/=](?:about|directory)_(?:family|relationship|life_event|hobb|interest|travel|names|links|profile_transparency)"
)


def check_account(driver) -> None:
    url = (driver.current_url or "").lower()
    if "/checkpoint/" in url or "facebook.com/login" in url or "two_step_verification" in url:
        raise AccountBlocked("Facebook yêu cầu xác minh / đăng nhập lại")
    if not driver.get_cookie("c_user"):
        raise AccountBlocked("Tài khoản đã bị đăng xuất")


# Chạy trên mọi trang (gắn lúc mở Chrome): cửa sổ thu nhỏ thì Chrome ngừng vẽ khung hình và báo trang bị ẩn →
# Facebook ngừng dựng nội dung, luồng đứng chờ tới khi người dùng mở cửa sổ ra. Trang luôn báo đang hiển thị;
# requestAnimationFrame không có khung hình thật thì chạy bằng timer (timer không bị hãm nhờ cờ Chrome của scope).
KEEP_RENDERING_JS = r"""
(() => {
  try {
    Object.defineProperty(document, "hidden", { get: () => false, configurable: true });
    Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
    const stop = (e) => e.stopImmediatePropagation();
    window.addEventListener("visibilitychange", stop, true);
    document.addEventListener("visibilitychange", stop, true);
    const raf = window.requestAnimationFrame.bind(window);
    const caf = window.cancelAnimationFrame.bind(window);
    const pending = new Map();
    let seq = 0;
    window.requestAnimationFrame = function requestAnimationFrame(cb) {
      const id = ++seq;
      const run = (t) => {
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        caf(p[0]);
        clearTimeout(p[1]);
        cb(t);
      };
      pending.set(id, [raf(run), setTimeout(() => run(performance.now()), 50)]);
      return id;
    };
    window.cancelAnimationFrame = function cancelAnimationFrame(id) {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      caf(p[0]);
      clearTimeout(p[1]);
    };
  } catch (e) {}
})();
"""


def _minimized(driver) -> bool:
    try:
        win = driver.execute_cdp_cmd("Browser.getWindowForTarget", {})
        return (win.get("bounds") or {}).get("windowState") == "minimized"
    except Exception as exc:
        if is_browser_gone(exc):
            raise
        return False


def _open(driver, url: str) -> None:
    driver.set_page_load_timeout(PAGE_TIMEOUT)
    try:
        driver.get(url)
    except TimeoutException:
        driver.execute_script("window.stop();")  # trang tải chậm: đọc phần đã có


def _wait(stop: Callable[[], bool], seconds: float) -> None:
    end = time.time() + seconds
    while True:
        if stop():
            raise Stopped()
        left = end - time.time()
        if left <= 0:
            return
        time.sleep(min(0.5, left))


def _read_main(driver, stop: Callable[[], bool]) -> Dict[str, Any]:
    """Đợi trang dựng xong: tên, phần đầu trang và thẻ Giới thiệu không đổi trong 2 nhịp."""
    data: Dict[str, Any] = {}
    last, stable = None, 0
    end = time.time() + WAIT_READY
    while time.time() < end:
        _wait(stop, 1)
        data = driver.execute_script(_READ_JS) or {}
        if not data.get("name") and page_state(data.get("text") or "", False) != "OK":
            return data
        mark = (data.get("name"), data.get("header"), data.get("intro"))
        stable = stable + 1 if mark == last else 0
        last = mark
        if data.get("name") and stable >= 2:
            break
    return data


def _click(driver, element) -> bool:
    """Bấm như người dùng; không được thì bấm của WebDriver.
    Cửa sổ đang thu nhỏ: bấm bằng JS (thao tác chuột của WebDriver tự khôi phục cửa sổ lên màn hình)."""
    if _minimized(driver):
        try:
            driver.execute_script("arguments[0].click();", element)
            return True
        except StaleElementReferenceException:
            return False
    if human_click(driver, element):
        return True
    try:
        element.click()
        return True
    except (ElementClickInterceptedException, ElementNotInteractableException, StaleElementReferenceException):
        return False


def _read_about(driver, stop: Callable[[], bool], before: str = "") -> Dict[str, Any]:
    """Đợi cột nội dung đổi khác 'before' và đứng yên 2 nhịp."""
    data: Dict[str, Any] = {}
    last = None
    for _ in range(8):
        _wait(stop, 1)
        data = driver.execute_script(_ABOUT_JS) or {}
        text = data.get("text") or ""
        if text and text == last and text != before:
            break
        last = text
    check_account(driver)
    return data


def _open_about(driver, page_key: str, stop: Callable[[], bool]) -> None:
    """Bấm tab Giới thiệu; chỉ mở bằng link khi trang không có tab để bấm."""
    for _ in range(3):
        found = driver.execute_script(_ABOUT_TAB_JS) or {}
        target = found.get("about") or found.get("more")
        if target is None:
            break
        clicked = _click(driver, target)
        _wait(stop, random.uniform(1.0, 2.0))
        if clicked and found.get("about"):
            return
    logger.warning(f"[Module 13] {page_key}: không bấm được tab Giới thiệu, mở bằng link")
    _open(driver, section_url(page_key, "about"))


def _about_parts(driver, page_key: str, stop: Callable[[], bool]) -> Iterator[List[str]]:
    """Bấm tab Giới thiệu rồi bấm lần lượt từng mục bên trái; mỗi mục trả các dòng ở cột phải."""
    _open_about(driver, page_key, stop)
    data = _read_about(driver, stop)
    text = data.get("text") or ""
    yield clean_lines(text) if text else about_region(data.get("all") or "")
    labels = [i["label"] for i in data.get("items") or [] if not _SKIP_ITEM.search(i["href"])]
    for label in labels:
        # Trang dựng lại sau mỗi lần bấm → tìm lại nút
        fresh = driver.execute_script(_ABOUT_JS) or {}
        item = next((i for i in fresh.get("items") or [] if i["label"] == label), None)
        if item is None or item["href"].split("#")[0] == driver.current_url.split("#")[0]:
            continue
        _wait(stop, random.uniform(0.5, 1.5))
        if not _click(driver, item["el"]):
            logger.warning(f"[Module 13] {page_key}: không bấm được mục {label}")
            continue
        before = fresh.get("text") or ""
        text = _read_about(driver, stop, before).get("text") or ""
        if text and text != before:
            yield clean_lines(text)
        else:
            logger.warning(f"[Module 13] {page_key}: mục {label} không đổi nội dung")


_ABOUT_FIELDS = ("phone", "birthday", "job_place", "education", "hometown", "location")


def read_profile(
    driver, target_key: str, own_uid: str, stop: Callable[[], bool],
    accept: Callable[[Dict[str, Any]], Optional[str]] = lambda data: None,
) -> Dict[str, Any]:
    """
    Dữ liệu 1 profile (khóa 'uid': UID số, hoặc 'user:…' khi không tìm được UID số).
    accept(data) trả lý do → bỏ qua sớm, không mở Giới thiệu.
    """
    _open(driver, key_to_url(target_key))
    check_account(driver)
    main = _read_main(driver, stop)
    check_account(driver)
    name = (main.get("name") or "").strip()
    state = page_state(main.get("text") or "", bool(name))
    if state == "BLOCKED":
        raise AccountBlocked("Facebook chặn tạm thời tài khoản quét")
    if state == "UNAVAILABLE":
        raise ProfileSkipped("Trang không tồn tại hoặc không xem được")
    if state == "LOCKED":
        raise ProfileSkipped("Trang cá nhân đã khóa")
    if not name:
        text = " ".join((main.get("text") or "").split())[:200]
        logger.error(f"[Module 13] Không đọc được tên: url={driver.current_url} h1={main.get('h1_count')} text={text!r}")
        raise RuntimeError("Không đọc được tên trang cá nhân")

    source = driver.page_source or ""
    here = profile_key(driver.current_url) or target_key
    keys = (target_key, here)
    username = next((k[5:] for k in keys if k.startswith("user:")), None)
    uid = next((k[3:] for k in keys if k.startswith("id:")), None) or uid_from_source(source, username, own_uid)
    page_key = f"id:{uid}" if uid else here
    intro, header = main.get("intro") or "", main.get("header") or ""
    source_bio = bio_from_source(source)

    data: Dict[str, Any] = {
        "uid": uid or target_key, "username": username, "name": name, "url": key_to_url(f"user:{username}" if username else page_key),
        "avatar_url": main.get("avatar") or "", "bio": main.get("bio") or source_bio,
        "bio_source": "header" if main.get("bio") else "source" if source_bio else None,
    }
    data.update(parse_counts(header))
    data.update(parse_intro(clean_lines(intro)))
    data.pop("phone", None)
    # SĐT bước 1: tiểu sử (bố cục mới đặt tiểu sử ngay ở phần đầu trang)
    phones = find_phones("\n".join([source_bio, header, intro]))
    if phones:
        data["phone"], data["phone_source"] = ", ".join(phones), "bio"

    reason = accept(data)
    if reason:
        raise ProfileSkipped(reason)

    def merge(lines: List[str]) -> None:
        for field, value in parse_about(lines).items():
            if data.get(field):
                continue
            data[field] = value
            if field == "phone":  # SĐT bước 2: mục Giới thiệu
                data["phone_source"] = "about"

    for lines in _about_parts(driver, page_key, stop):
        merge(lines)
        if all(data.get(f) for f in _ABOUT_FIELDS):
            break
    return data
