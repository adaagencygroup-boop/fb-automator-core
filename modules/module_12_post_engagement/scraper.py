"""
Thao tác Chrome cho Module 12 (đã dò DOM Facebook thật, giao diện tiếng Anh & tiếng Việt):

- Bài viết mở dạng hộp thoại; thông tin bài + bình luận đọc từ JSON trang đã tải (fb_parse).
- Người bày tỏ cảm xúc: mở trang "People Who Reacted" (/ufi/reaction/profile/browser/?ft_ent_identifier=<ID bài>)
  rồi cuộn danh sách bằng JS tới hết (mỗi lượt Facebook tải thêm ~10 người). KHÔNG bấm vào nút có số lượt thích —
  ở giao diện mới đó chính là nút Thích.
- Bình luận: chuyển "Tất cả bình luận", bấm "Xem N phản hồi" / "Xem thêm bình luận", cuộn hộp thoại tới hết.
- Danh sách người chia sẻ: Facebook web không còn cho xem → chỉ lấy tổng số chia sẻ.

Chỉ bấm nút có chữ khớp mẫu an toàn ("Xem…", "View…", sắp xếp bình luận), luôn loại trừ nút Thích / Bày tỏ cảm xúc /
Chia sẻ / Bình luận. Mọi dữ liệu là dữ liệu chính trang Facebook đã tải cho nick — không gọi API.
"""
from __future__ import annotations

import time
from collections import Counter
from typing import Any, Callable, Optional

from modules.module_12_post_engagement import fb_parse

REACTION_PAGE = "https://www.facebook.com/ufi/reaction/profile/browser/?ft_ent_identifier={post_id}"

# Ghi lại phản hồi GraphQL mà CHÍNH trang tải (khi cuộn / mở trả lời) để đọc UID số, nội dung, thời gian chính xác.
CAPTURE_HOOK_JS = r"""
(function(){
  if (window.__pecap) return; window.__pecap = [];
  const keep = (url, text) => { try {
    if (String(url || '').indexOf('/api/graphql') >= 0 && text) {
      window.__pecap.push(text); if (window.__pecap.length > 300) window.__pecap.shift();
    } } catch (e) {} };
  const oOpen = XMLHttpRequest.prototype.open, oSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(m, u) { this.__peurl = u; return oOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function() {
    this.addEventListener('load', function() { keep(this.__peurl, this.responseText); });
    return oSend.apply(this, arguments);
  };
})();
"""

DRAIN_JS = "const c = window.__pecap || []; window.__pecap = []; return c;"

PAGE_STATE_JS = r"""
const t = (document.body && document.body.innerText || '').slice(0, 1500).toLowerCase();
const has = (arr) => arr.some(s => t.indexOf(s) >= 0);
return {
  url: location.href,
  ready: document.readyState,
  unavailable: has(["this content isn't available", "content isn't available right now", "nội dung này hiện không khả dụng",
                    "bạn hiện không xem được nội dung này", "this page isn't available", "trang này hiện không khả dụng",
                    "sorry, something went wrong", "rất tiếc, đã xảy ra lỗi"]),
  blocked: has(["you're temporarily blocked", "bạn tạm thời bị chặn", "you’re temporarily blocked", "tạm thời bị chặn"]),
  checkpoint: /checkpoint|\/login/.test(location.pathname) || has(["confirm your identity", "xác nhận danh tính", "your account has been locked", "tài khoản của bạn đã bị khóa"]),
  dialogs: document.querySelectorAll('[role=dialog]').length,
  articles: document.querySelectorAll('[role=article]').length,
  tabs: document.querySelectorAll('[role=dialog] [role=tab]').length,
};
"""

# Hộp thoại "Người đã bày tỏ cảm xúc": đọc từng dòng (UID từ link /user/<uid>/ hoặc profile.php?id=)
DOM_REACTORS_JS = r"""
const ds = [...document.querySelectorAll('[role=dialog]')].filter(d => d.querySelector('[role=tab]'));
const d = ds[ds.length - 1];
if (!d) return {rows: [], friendsOnly: false, height: 0};
const map = new Map();
d.querySelectorAll('a[href]').forEach(a => {
  const h = a.href || '';
  const m = h.match(/\/user\/(\d{5,})/) || h.match(/profile\.php\?id=(\d{5,})/);
  if (!m) return;
  const uid = m[1];
  const row = map.get(uid) || {uid, aria: '', name: '', avatar: ''};
  const aria = a.getAttribute('aria-label') || '';
  if (aria && !row.aria) row.aria = aria;
  const txt = (a.innerText || '').trim();
  if (txt && !row.name) row.name = txt;
  const img = a.querySelector('image, img');
  if (img && !row.avatar) row.avatar = img.getAttribute('xlink:href') || img.getAttribute('href') || img.src || '';
  map.set(uid, row);
});
const txt = (d.innerText || '').toLowerCase();
const friendsOnly = txt.indexOf('only the names of friends') >= 0 || txt.indexOf('chỉ hiển thị tên của bạn bè') >= 0
                 || txt.indexOf('tên bạn bè') >= 0;
const sc = [...d.querySelectorAll('div')].filter(x => x.scrollHeight > x.clientHeight + 30 && /(auto|scroll)/.test(getComputedStyle(x).overflowY))
  .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
return {rows: [...map.values()], friendsOnly, height: sc ? sc.scrollHeight : 0};
"""

SCROLL_REACTORS_JS = r"""
const ds = [...document.querySelectorAll('[role=dialog]')].filter(d => d.querySelector('[role=tab]'));
const d = ds[ds.length - 1];
if (!d) return -1;
const sc = [...d.querySelectorAll('div')].filter(x => x.scrollHeight > x.clientHeight + 30 && /(auto|scroll)/.test(getComputedStyle(x).overflowY))
  .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
if (!sc) return -1;
sc.scrollTop = sc.scrollHeight;
return sc.scrollHeight;
"""

_COMMENT_ROOT_JS = r"""
// Bài mở dạng hộp thoại → hộp thoại; trang bài → main; trang ảnh/video → khung bên phải (complementary).
const root = [...document.querySelectorAll('[role=dialog]')].reverse().find(x => x.querySelector('[role=article]'))
          || [...document.querySelectorAll('[role=main], [role=complementary]')].find(x => x.querySelector('[role=article]'))
          || document.querySelector('[role=main]') || document.body;
"""

# Chuyển bộ lọc bình luận sang "Tất cả bình luận" (mặc định "Phù hợp nhất" ẩn bớt bình luận).
OPEN_SORT_JS = _COMMENT_ROOT_JS + r"""
const labels = /^(most relevant|newest|all comments|phù hợp nhất|mới nhất|tất cả bình luận)$/i;
const btn = [...root.querySelectorAll('[role=button]')].find(b => labels.test((b.innerText || '').trim()));
if (!btn) return 'none';
const cur = (btn.innerText || '').trim().toLowerCase();
if (cur === 'all comments' || cur === 'tất cả bình luận') return 'already';
btn.click();
return 'opened';
"""
PICK_ALL_COMMENTS_JS = r"""
const m = [...document.querySelectorAll('[role=menuitem], [role=menuitemradio], [role=option]')]
  .find(x => /^(all comments|tất cả bình luận)/i.test((x.innerText || '').trim()));
if (m) { m.click(); return true; }
return false;
"""

# Bấm "Xem N phản hồi" / "Xem thêm bình luận"… — chỉ nút khớp mẫu, loại trừ nút tương tác.
# Nút vẫn còn sau 5s (Facebook dùng lại phần tử "Xem thêm bình luận") thì được bấm lại.
EXPAND_COMMENTS_JS = _COMMENT_ROOT_JS + r"""
const ok = [
  /^view (all )?\d+ (more )?repl(y|ies)$/i, /^view (\d+ )?more repl(y|ies)$/i, /^view more comments$/i, /^view previous comments$/i,
  /^see more comments$/i, /^\d+ repl(y|ies)$/i, /^view 1 reply$/i, /replied\s*·\s*\d+ repl/i,
  /^xem (tất cả )?\d+ phản hồi$/i, /^xem thêm (\d+ )?phản hồi$/i, /^xem thêm bình luận$/i, /^xem bình luận trước$/i,
  /^\d+ phản hồi$/i, /đã phản hồi\s*·\s*\d+ phản hồi/i,
  /^xem (tất cả )?(\d+ )?(thêm )?(câu trả lời|trả lời)$/i, /^xem (tất cả )?\d+ (câu )?trả lời$/i, /^xem thêm (\d+ )?(câu )?trả lời$/i,
  /^\d+ câu trả lời$/i, /^view hidden comments$/i, /^xem (các )?bình luận (đã |bị )?ẩn$/i, /đã trả lời\s*·\s*\d+ (câu )?trả lời/i,
];
const bad = /^(react|like|remove|change|share|comment|reply|thích|bày tỏ|gỡ|thay đổi|chia sẻ|bình luận|trả lời|phản hồi$)/i;
let n = 0;
for (const b of root.querySelectorAll('[role=button]')) {
  if (n >= arguments[0]) break;
  if (b.dataset.peClicked && Date.now() - Number(b.dataset.peClicked) < 5000) continue;
  if (b.closest('[contenteditable=true], form')) continue;
  const t = (b.innerText || '').trim().replace(/\s+/g, ' ');
  const a = (b.getAttribute('aria-label') || '').trim();
  if (!t || t.length > 60 || (a && bad.test(a))) continue;
  if (!ok.some(r => r.test(t))) continue;
  b.dataset.peClicked = String(Date.now());
  b.click();
  n++;
}
return n;
"""

SCROLL_COMMENTS_JS = _COMMENT_ROOT_JS + r"""
const sc = root === document.body ? null : [...root.querySelectorAll('div')]
  .filter(x => x.scrollHeight > x.clientHeight + 30 && /(auto|scroll)/.test(getComputedStyle(x).overflowY))
  .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
if (sc) { sc.scrollTop = sc.scrollHeight; return sc.scrollHeight; }
window.scrollTo(0, document.documentElement.scrollHeight);
return document.documentElement.scrollHeight;
"""


class AccountProblem(Exception):
    """Nick bị checkpoint / mất đăng nhập / bị chặn tạm thời → nhường bài cho nick khác."""


def install_capture(driver) -> None:
    """Gắn bộ ghi phản hồi GraphQL cho mọi trang mở sau đó (1 lần / Chrome)."""
    try:
        driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": CAPTURE_HOOK_JS})
    except Exception:
        pass


def ensure_rendering(driver) -> None:
    """Trang bị ẩn (cửa sổ Chrome bị che / thu nhỏ) thì trình duyệt ngừng vẽ khung hình → Facebook KHÔNG tải thêm khi
    cuộn (danh sách cảm xúc / bình luận dừng giữa chừng). Đưa tab lên trước để trang hiển thị lại (chỉ khi đang ẩn)."""
    try:
        if driver.execute_script("return document.visibilityState") != "visible":
            driver.execute_cdp_cmd("Page.bringToFront", {})
    except Exception as exc:
        if _dead(exc):
            raise


def drain_capture(driver) -> list[str]:
    try:
        data = driver.execute_script(DRAIN_JS)
        return [x for x in (data or []) if isinstance(x, str)]
    except Exception as exc:
        if _dead(exc):
            raise
        return []


def _dead(exc: BaseException) -> bool:
    from modules.module_12_post_engagement.common import is_browser_dead_error

    return is_browser_dead_error(exc)


def page_state(driver) -> dict[str, Any]:
    try:
        return driver.execute_script(PAGE_STATE_JS) or {}
    except Exception as exc:
        if _dead(exc):
            raise
        return {}


def _check_account(state: dict[str, Any]) -> None:
    if state.get("checkpoint"):
        raise AccountProblem("Nick bị checkpoint / mất đăng nhập Facebook")
    if state.get("blocked"):
        raise AccountProblem("Nick bị Facebook chặn tạm thời (Rate Limit)")


def open_post(driver, url: str, *, wait: float = 20.0, sleep=time.sleep) -> dict[str, Any]:
    """Mở bài; trả {state, meta, url}. meta rỗng + state.unavailable khi bài bị xoá / riêng tư / sai link."""
    driver.get(url)
    ensure_rendering(driver)
    deadline = time.monotonic() + wait
    state: dict[str, Any] = {}
    while time.monotonic() < deadline:
        sleep(1.0)
        state = page_state(driver)
        _check_account(state)
        if state.get("unavailable"):
            break
        if state.get("ready") == "complete" and (state.get("articles") or state.get("dialogs")):
            sleep(2.0)
            break
    state = page_state(driver) or state
    _check_account(state)
    current = state.get("url") or url
    objs = fb_parse.json_blobs_from_html(driver.page_source) + fb_parse.json_objects_from_responses(drain_capture(driver))
    from modules.module_12_post_engagement.links import parse_post_link

    info = parse_post_link(url) or {}
    meta = fb_parse.post_meta(objs, post_key=str(info.get("post_key") or ""), page_url=current) if not state.get("unavailable") else {}
    return {"state": state, "meta": meta, "url": current, "objs": objs}


def collect_reactions(
    driver,
    fb_post_id: str,
    quota: int,
    *,
    on_batch: Callable[[list[dict[str, Any]]], None],
    tick: Callable[[], bool],
    pause: Callable[[], bool],
    known: Optional[set[str]] = None,
    log: Callable[[str, str], None] = lambda m, lv="info": None,
    sleep=time.sleep,
    idle_rounds: int = 4,
    max_rounds: int = 3000,
) -> dict[str, Any]:
    """Cuộn hết danh sách người bày tỏ cảm xúc. Trả {count, friends_only, reason}.

    tick(): True nếu phải dừng ngay (Dừng khẩn cấp). pause(): nghỉ Min–Max giây giữa 2 lượt tải (True nếu bị dừng).
    """
    seen: set[str] = set(known or ())
    got = 0
    driver.get(REACTION_PAGE.format(post_id=fb_post_id))
    ensure_rendering(driver)
    deadline = time.monotonic() + 20
    state: dict[str, Any] = {}
    while time.monotonic() < deadline:
        sleep(1.0)
        state = page_state(driver)
        _check_account(state)
        if state.get("tabs") or state.get("unavailable"):
            break
    if not state.get("tabs"):
        return {"count": 0, "friends_only": False, "reason": "no_dialog" if not state.get("unavailable") else "unavailable"}
    sleep(1.5)
    objs = fb_parse.json_blobs_from_html(driver.page_source)
    friends_only = False
    idle, last_height = 0, -1
    for _round in range(max_rounds):
        if tick():
            return {"count": got, "friends_only": friends_only, "reason": "stopped"}
        ensure_rendering(driver)
        objs += fb_parse.json_objects_from_responses(drain_capture(driver))
        parsed = fb_parse.extract_reactors(objs)
        objs = []
        try:
            dom = driver.execute_script(DOM_REACTORS_JS) or {}
        except Exception as exc:
            if _dead(exc):
                raise
            dom = {}
        friends_only = friends_only or parsed["friends_only"] or bool(dom.get("friendsOnly"))
        rows = fb_parse.merge_reactors(parsed["rows"], dom.get("rows") or [])
        fresh = [r for r in rows if r["uid"] not in seen]
        if quota > 0:
            fresh = fresh[: max(0, quota - got)]
        for r in fresh:
            seen.add(r["uid"])
        if fresh:
            got += len(fresh)
            on_batch(fresh)
            idle = 0
        if quota > 0 and got >= quota:
            return {"count": got, "friends_only": friends_only, "reason": "quota"}
        if parsed["has_next"] is False and not fresh:
            return {"count": got, "friends_only": friends_only, "reason": "end"}
        try:
            ensure_rendering(driver)
            height = driver.execute_script(SCROLL_REACTORS_JS)
        except Exception as exc:
            if _dead(exc):
                raise
            height = -1
        if not fresh:
            idle = idle + 1 if height == last_height else max(idle, 1)
            if idle >= idle_rounds:
                return {"count": got, "friends_only": friends_only, "reason": "end"}
        last_height = height
        if pause():
            return {"count": got, "friends_only": friends_only, "reason": "stopped"}
        _check_account(page_state(driver))
    return {"count": got, "friends_only": friends_only, "reason": "end"}


def ensure_all_comments(driver, sleep=time.sleep) -> str:
    """Chuyển bộ lọc bình luận sang "Tất cả bình luận". Trả 'already' | 'switched' | 'none' | 'failed'."""
    try:
        res = driver.execute_script(OPEN_SORT_JS)
        if res != "opened":
            return res or "none"
        sleep(1.5)
        return "switched" if driver.execute_script(PICK_ALL_COMMENTS_JS) else "failed"
    except Exception as exc:
        if _dead(exc):
            raise
        return "failed"


def collect_comments(
    driver,
    quota: int,
    *,
    on_batch: Callable[[list[dict[str, Any]]], None],
    tick: Callable[[], bool],
    pause: Callable[[], bool],
    initial_objs: Optional[list[Any]] = None,
    known: Optional[set[str]] = None,
    sleep=time.sleep,
    idle_rounds: int = 4,
    clicks_per_round: int = 12,
    max_rounds: int = 3000,
    round_wait: float = 1.5,
    post_id: str = "",
) -> dict[str, Any]:
    """Lấy bình luận (gốc + trả lời, toàn văn) trên bài đang mở. Trả {count, reason, sort}."""
    seen: set[str] = set(known or ())
    got = 0
    sort = ensure_all_comments(driver, sleep=sleep)
    if sort == "switched":
        sleep(3.0)
    objs = list(initial_objs or [])
    idle, last_height = 0, -1
    ctx: dict[str, Any] = {}
    prefixes: Counter[str] = Counter()  # bài chứa bình luận → số lần gặp
    for _round in range(max_rounds):
        if tick():
            return {"count": got, "reason": "stopped", "sort": sort}
        ensure_rendering(driver)
        objs += fb_parse.json_objects_from_responses(drain_capture(driver))
        comments = fb_parse.extract_comments(objs, ctx)
        objs = []
        # Trang ảnh tải sẵn bình luận của ảnh trước/sau → chỉ giữ bình luận của đúng bài (id bài biết trước,
        # không khớp bình luận nào thì lấy bài chiếm đa số).
        prefixes.update(c["post_id"] for c in comments if c.get("post_id"))
        target = str(post_id or "")
        if prefixes and target not in prefixes:
            target = prefixes.most_common(1)[0][0]
        if target:
            comments = [c for c in comments if not c.get("post_id") or c["post_id"] == target]
        fresh = [c for c in comments if c["comment_id"] not in seen]
        if quota > 0:
            fresh = fresh[: max(0, quota - got)]
        for c in fresh:
            seen.add(c["comment_id"])
        if fresh:
            got += len(fresh)
            on_batch(fresh)
            idle = 0
        if quota > 0 and got >= quota:
            return {"count": got, "reason": "quota", "sort": sort}
        try:
            ensure_rendering(driver)
            clicked = int(driver.execute_script(EXPAND_COMMENTS_JS, clicks_per_round) or 0)
            height = driver.execute_script(SCROLL_COMMENTS_JS)
        except Exception as exc:
            if _dead(exc):
                raise
            clicked, height = 0, -1
        if not fresh and not clicked and height == last_height:
            idle += 1
            if idle >= idle_rounds:
                return {"count": got, "reason": "end", "sort": sort}
        elif not fresh:
            idle = max(0, idle - 1) if clicked else idle
        last_height = height
        if pause():
            return {"count": got, "reason": "stopped", "sort": sort}
        _check_account(page_state(driver))
        sleep(round_wait)  # chờ Facebook trả dữ liệu sau khi bấm / cuộn
    return {"count": got, "reason": "end", "sort": sort}
