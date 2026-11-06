"""
farming_flow.py
Kịch bản tương tác nuôi tài khoản Facebook (Module 03 – Tab 1 Tương tác tài khoản):
lướt Newsfeed, xem Watch, xem Story (kèm thả cảm xúc), kết bạn, tham gia nhóm, check thông báo.

Mỗi kịch bản nhận driver đang đăng nhập + FarmControl (tạm dừng / dừng) và trả về
dict {"status": SUCCESS|BLOCKED|SKIPPED|FAILED, "quantity": int, "details": str}.
Lỗi mức tài khoản (checkpoint / mất phiên) ném FarmAccountDead để pipeline chuyển DIE.
"""
import logging
import random
import re
import threading
import time
from typing import Callable, Optional
from urllib.parse import quote_plus, urlparse

from selenium.common.exceptions import StaleElementReferenceException, TimeoutException, WebDriverException
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.actions.wheel_input import ScrollOrigin
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys

from core.browser.human import click_point, element_box, hover_element, human_click, mouse_position, mouse_to, press_mouse
from modules.module_03_acc_farm.browser.locators import LOGIN
from modules.module_03_acc_farm.farming.locators import (
    FARM_COMMON, FARM_FRIEND, FARM_GROUP, FARM_LEAVE, FARM_NOTIF, FARM_STORY, FARM_WATCH, REACTION_BUTTON,
    REACTION_NAMES_VI,
)
from modules.module_03_acc_farm.browser.login_flow import (
    CHECKPOINT_HEAVY, checkpoint_kind, checkpoint_message, is_checkpoint_url, _check_logged_in,
)

logger = logging.getLogger(__name__)

FB_HOME = "https://www.facebook.com"
FB_WATCH = "https://www.facebook.com/watch"
FB_FRIEND_SUGGESTIONS = "https://www.facebook.com/friends/suggestions"
FB_GROUPS_DISCOVER = "https://www.facebook.com/groups/discover"
FB_GROUPS_SEARCH = "https://www.facebook.com/search/groups/?q={q}"
FB_GROUPS_JOINS = "https://www.facebook.com/groups/joins/"
FB_GROUP_MEMBERS = "https://www.facebook.com/groups/{gid}/members"

# Delay mặc định giữa các thao tác rủi ro cao (UI cho chỉnh, server ép tối thiểu FRIEND/GROUP_DELAY_FLOOR)
FRIEND_DELAY_RANGE = (5.0, 15.0)
GROUP_DELAY_RANGE = (10.0, 20.0)
LEAVE_DELAY_RANGE = (10.0, 30.0)
# Thỉnh thoảng nghỉ dài + cuộn đọc như người xem profile, để nhịp không đều đặn như máy
LONG_PAUSE_RATE = 0.25
LONG_PAUSE_RANGE = (30.0, 60.0)
# Chọn ngẫu nhiên trong vài nút đầu đang hiển thị thay vì luôn bấm nút đầu tiên
PICK_WINDOW = 10
BROWSE_BEFORE_PICK_RATE = 0.3
# Chờ danh sách gợi ý kết bạn / nhóm tải xong trước khi tìm nút (mạng, proxy chậm)
PAGE_LOAD_WAIT = 15.0
NOTIF_OPEN_RANGE = (3.0, 7.0)
NOTIF_CLICK_RATE = 0.20
# Thả cảm xúc: tỉ lệ mỗi bài / video / khung story; thanh cảm xúc chờ tối đa REACTION_BAR_WAIT giây mỗi lần rê chuột,
# không hiện thì rê ra rồi rê lại, tối đa REACTION_HOVER_TRIES lần rồi bỏ qua bài đó
REACT_RATE = 0.50
REACTION_BAR_WAIT = 3.0
REACTION_HOVER_TRIES = 2
# Không thấy nút Like của chừng này video liên tiếp / sau chừng này lần cuộn feed thì báo: có thể Facebook đã đổi giao diện
REACT_NO_LIKE_VIDEOS = 3
REACT_NO_LIKE_SCROLLS = 10


class FarmStopped(Exception):
    """Người dùng bấm Dừng hẳn."""


class FarmAccountDead(Exception):
    """Tài khoản dính checkpoint / mất phiên đăng nhập giữa chừng. checkpoint = "light" / "heavy" / None (mất phiên)."""

    def __init__(self, message: str = "", checkpoint: Optional[str] = None):
        super().__init__(message)
        self.checkpoint = checkpoint


class FarmControl:
    """Cờ điều khiển dùng chung cho mọi luồng của một phiên chạy Tương tác."""

    def __init__(self):
        self._stop = threading.Event()
        self._running = threading.Event()
        self._running.set()
        self._lock = threading.Lock()
        self._paused_total = 0.0
        self._paused_since: Optional[float] = None

    @property
    def stopped(self) -> bool:
        return self._stop.is_set()

    @property
    def paused(self) -> bool:
        return not self._running.is_set()

    def pause(self):
        with self._lock:
            if self._running.is_set():
                self._paused_since = time.time()
                self._running.clear()

    def resume(self):
        with self._lock:
            if not self._running.is_set():
                if self._paused_since:
                    self._paused_total += time.time() - self._paused_since
                self._paused_since = None
                self._running.set()

    def stop(self):
        self._stop.set()
        self.resume()

    def paused_total(self) -> float:
        """Tổng thời gian đã tạm dừng (giây), dùng để đóng băng đồng hồ của kịch bản."""
        with self._lock:
            extra = time.time() - self._paused_since if self._paused_since else 0.0
            return self._paused_total + extra

    def checkpoint(self):
        """Chặn tại đây khi đang tạm dừng; ném FarmStopped khi đã bấm dừng."""
        if self._stop.is_set():
            raise FarmStopped()
        while not self._running.wait(timeout=0.5):
            if self._stop.is_set():
                raise FarmStopped()
        if self._stop.is_set():
            raise FarmStopped()

    def sleep(self, seconds: float):
        """Ngủ theo từng nhịp ngắn để phản ứng ngay với Tạm dừng / Dừng."""
        end = time.time() + max(0.0, seconds)
        while True:
            self.checkpoint()
            remaining = end - time.time()
            if remaining <= 0:
                return
            before = self.paused_total()
            time.sleep(min(0.5, remaining))
            # Thời gian tạm dừng không tính vào thời lượng ngủ
            end += self.paused_total() - before


class ActiveTimer:
    """Đồng hồ chỉ tính thời gian chạy thật (trừ thời gian tạm dừng)."""

    def __init__(self, ctl: FarmControl, total_seconds: float):
        self.ctl = ctl
        self.total = max(0.0, total_seconds)
        self.start = time.time()
        self.paused_at_start = ctl.paused_total()

    def elapsed(self) -> float:
        return (time.time() - self.start) - (self.ctl.paused_total() - self.paused_at_start)

    def remaining(self) -> float:
        return self.total - self.elapsed()


def _result(status: str, details: str, quantity: int = 0) -> dict:
    return {"status": status, "quantity": quantity, "details": details}


def _count(progress: Optional[Callable[[int], None]], quantity: int):
    """Báo số lượng đã làm ngay sau mỗi lần thành công, để dừng giữa chừng vẫn tính đúng giới hạn ngày."""
    if progress:
        progress(quantity)


# ─────────────────────────── HELPERS ────────────────────────────

def _find_visible(driver, locators, root=None) -> list:
    found = []
    seen = set()
    base = root if root is not None else driver
    for locator in locators:
        try:
            for el in base.find_elements(By.XPATH, locator):
                if el.id in seen:
                    continue
                try:
                    if el.is_displayed():
                        seen.add(el.id)
                        found.append(el)
                except WebDriverException:
                    continue
        except WebDriverException:
            continue
    return found


_notices = threading.local()


def _record_notice(message: str):
    if not hasattr(_notices, "items"):
        _notices.items = []
    _notices.items.append(message)


def pop_notices() -> list:
    """Lấy và xóa các cảnh báo phát sinh trong luồng hiện tại (pipeline in ra log)."""
    items = getattr(_notices, "items", [])
    _notices.items = []
    return items


def pop_light_checkpoint() -> bool:
    """Luồng hiện tại đã bấm bỏ qua checkpoint nhẹ thành công lần nào chưa (đọc xong thì xóa cờ)."""
    hit = getattr(_notices, "light_checkpoint", False)
    _notices.light_checkpoint = False
    return hit


def try_dismiss_checkpoint(driver) -> bool:
    """
    Checkpoint nhẹ của Facebook (chỉ có nút Dismiss / Bỏ qua) không cần xác minh danh tính.
    Thử bấm bỏ qua rồi kiểm tra lại; trả True nếu đã thoát checkpoint.
    """
    url = driver.current_url or ""
    if not is_checkpoint_url(url):
        return True
    buttons = _find_visible(driver, LOGIN.get("dismiss_button", []))
    if not buttons:
        return False
    if not _human_click(driver, buttons[0]):
        return False
    time.sleep(random.uniform(3.0, 5.0))
    if not _check_logged_in(driver):
        return False
    _record_notice(f"Facebook hiện cảnh báo checkpoint nhẹ, đã bấm bỏ qua ({url.split('?')[0]})")
    _notices.light_checkpoint = True
    return True


def raise_checkpoint_dead(driver):
    """Ném FarmAccountDead kèm loại checkpoint của trang hiện tại."""
    kind = checkpoint_kind(driver) or CHECKPOINT_HEAVY
    raise FarmAccountDead(checkpoint_message(kind, driver.current_url or ""), checkpoint=kind)


def check_account_state(driver) -> Optional[str]:
    """
    Kiểm tra tình trạng tài khoản sau mỗi thao tác.
    Ném FarmAccountDead nếu checkpoint / mất phiên; trả "blocked" nếu có dialog chặn tính năng.
    """
    url = driver.current_url or ""
    if is_checkpoint_url(url) and not try_dismiss_checkpoint(driver):
        raise_checkpoint_dead(driver)
    url = driver.current_url or ""
    if is_checkpoint_url(url):
        raise_checkpoint_dead(driver)
    if "facebook.com" in url and not _check_logged_in(driver):
        raise FarmAccountDead(f"Phiên đăng nhập không còn hợp lệ ({url.split('?')[0]})")
    # Facebook có thể hủy phiên phía server trong khi c_user còn sót: trang nào cũng hiện form đăng nhập
    if _find_visible(driver, ['//input[@type="password"]']):
        raise FarmAccountDead(f"Facebook đã đăng xuất tài khoản, trang yêu cầu đăng nhập lại ({url.split('?')[0]})")
    if _find_visible(driver, FARM_COMMON["blocked_dialog"]):
        return "blocked"
    dismiss_notice_dialogs(driver)
    return None


_NOTICE_SKIP_LINES = {"what happened", "see why", "điều gì đã xảy ra", "xem lý do"}


def _notice_summary(dialog) -> str:
    try:
        lines = [l.strip() for l in (dialog.text or "").splitlines() if l.strip()]
    except WebDriverException:
        return ""
    return " | ".join(l for l in lines if l.lower() not in _NOTICE_SKIP_LINES)[:200]


def dismiss_notice_dialogs(driver, max_rounds: int = 3) -> int:
    """
    Đóng popup thông báo trạng thái tài khoản (vd "We added a restriction to your account") bằng nút X,
    ghi cảnh báo kèm nội dung để pipeline in ra log. Trả số popup đã đóng.
    """
    closed = 0
    for _ in range(max_rounds):
        dialogs = _find_visible(driver, FARM_COMMON["notice_dialog"])
        if not dialogs:
            break
        dialog = dialogs[-1]
        summary = _notice_summary(dialog)
        buttons = _find_visible(driver, FARM_COMMON["notice_close"], root=dialog)
        if not (buttons and _human_click(driver, buttons[0])):
            try:
                ActionChains(driver).send_keys(Keys.ESCAPE).perform()
            except WebDriverException:
                pass
        time.sleep(random.uniform(1.0, 2.0))
        closed += 1
        message = f"Facebook hiện popup thông báo tài khoản, đã tự đóng: {summary or 'không đọc được nội dung'}"
        logger.warning(message)
        if message not in getattr(_notices, "items", []):
            _record_notice(message)
    return closed


def _close_dialogs(driver):
    buttons = _find_visible(driver, FARM_COMMON["dialog_close"])
    if buttons:
        _human_click(driver, buttons[0])
        return
    try:
        ActionChains(driver).send_keys(Keys.ESCAPE).perform()
    except WebDriverException:
        pass


def _focus_is_text_field(driver) -> bool:
    try:
        return bool(driver.execute_script(
            "const el = document.activeElement;"
            "if (!el) return false;"
            "const tag = (el.tagName || '').toUpperCase();"
            "return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;"
        ))
    except WebDriverException:
        return True


def _focus_on_page(driver) -> bool:
    """
    Focus đang ở trang (body), không ở nút / link / ô nhập. Chỉ lúc này PAGE_DOWN / SPACE mới là cuộn:
    SPACE khi focus còn ở nút (vd nút chuông sau khi đóng bảng thông báo bằng ESC) sẽ bấm nút đó.
    """
    try:
        return bool(driver.execute_script(
            "const el = document.activeElement;"
            "return !el || el === document.body || el === document.documentElement;"
        ))
    except WebDriverException:
        return False


def _release_focus(driver):
    """Bỏ focus khỏi nút vừa dùng (như bấm ra vùng trống) để phím cuộn về sau không bấm nhầm nút đó."""
    try:
        driver.execute_script(
            "const el = document.activeElement;"
            "if (el && el !== document.body && typeof el.blur === 'function') el.blur();"
        )
    except WebDriverException:
        pass


def _scroll_origin(driver, element=None) -> Optional[ScrollOrigin]:
    """
    Điểm phát sự kiện bánh xe: trên element nếu có, không thì giữa màn hình.
    Mặc định Selenium phát ở góc trên trái (header) nên khung cuộn riêng như trình xem Reels không nhận được.
    """
    if element is not None:
        return ScrollOrigin.from_element(element)
    try:
        width, height = driver.execute_script("return [window.innerWidth, window.innerHeight];")
        return ScrollOrigin.from_viewport(int(width) // 2, int(height) // 2)
    except (WebDriverException, TypeError, ValueError):
        return None


def human_scroll(driver, distance: int, allow_keys: bool = True, element=None):
    """
    Cuộn bằng sự kiện bánh xe thật (chia nhiều nấc nhỏ) xen kẽ phím PAGE_DOWN/SPACE thật.
    Không dùng window.scrollTo nhảy cóc. Phím chỉ gửi khi focus đang ở trang, không thì cuộn bánh xe.
    """
    if allow_keys and distance > 0 and random.random() < 0.25 and _focus_on_page(driver):
        try:
            ActionChains(driver).send_keys(random.choice([Keys.PAGE_DOWN, Keys.SPACE])).perform()
            return
        except WebDriverException:
            pass

    direction = 1 if distance >= 0 else -1
    remaining = abs(int(distance))
    origin = _scroll_origin(driver, element)
    while remaining > 0:
        step = min(remaining, random.randint(80, 140))
        try:
            if origin is not None:
                ActionChains(driver).scroll_from_origin(origin, 0, step * direction).perform()
            else:
                ActionChains(driver).scroll_by_amount(0, step * direction).perform()
        except WebDriverException:
            driver.execute_script("window.scrollBy(0, arguments[0]);", step * direction)
        remaining -= step
        time.sleep(random.uniform(0.03, 0.09))


def _human_click(driver, element) -> bool:
    """Bấm bằng chuột giống người (core.browser.human); không bấm bằng JS. False = không bấm được, bỏ qua phần tử."""
    return human_click(driver, element)


def _same_page(current: str, target: str) -> bool:
    return (current or "").split("?")[0].split("#")[0].rstrip("/") == target.split("?")[0].rstrip("/")


def _open(driver, ctl: FarmControl, url: str, reuse: bool = False):
    """reuse=True: đang đứng đúng trang thì không tải lại (tải lại trang chủ liên tục trông không tự nhiên)."""
    ctl.checkpoint()
    if not (reuse and _same_page(driver.current_url, url)):
        driver.get(url)
        ctl.sleep(random.uniform(3.0, 5.0))
    check_account_state(driver)


NEWSFEED_MAX_REOPENS = 5  # Số lần mở lại Trang chủ khi trang bị chuyển đi nơi khác (vd bấm sang Nhóm, Watch)


def _on_home_feed(driver, landing_path: str = "") -> bool:
    """
    Còn ở Trang chủ (bảng feed) của Facebook: / hoặc /home.php, hoặc đúng trang Facebook đưa tới khi mở Trang chủ
    (landing_path, phòng khi Facebook đổi đường dẫn).
    """
    parsed = urlparse(driver.current_url or "")
    if not (parsed.hostname or "").endswith("facebook.com"):
        return False
    path = parsed.path.rstrip("/")
    return path in ("", "/home.php") or (bool(landing_path) and path == landing_path.rstrip("/"))


# ─────────────────────────── THẢ CẢM XÚC ────────────────────────────

# Nhãn nút thả cảm xúc của bài (đo thật): giao diện mới (2026-10-30) "React with Like to <Tên>'s post", đã thả
# "Remove <Loại> from <Tên>'s post"; giao diện cũ (2026-10-22, có thể còn ở 1 số nick) "Like" / "Remove <Loại>".
# Reel "Like" / "Remove <Loại>", từ 2026-11-04 có thêm số đếm: "Like, 860 reactions" / "Remove Love, 861 reactions".
# Tiếng Việt (2026-10-30): bài "Bày tỏ cảm xúc Thích về bài viết của <Tên>" / "Gỡ <Loại> khỏi bài viết của <Tên>", reel
# "Thích" / "Gỡ <Loại>", từ 2026-11-04 "Thích, 1,6K cảm xúc" / "Gỡ Haha, 4K cảm xúc"; loại đọc được quy về tên tiếng Anh
# (KIND). Chỉ nhận phần đuôi sau dấu phẩy, không so "bắt đầu bằng Like": "Like: 17 people" là nút đếm, không phải nút
# thả. Bình luận nổi dưới bài vẫn có nút "Like" /
# "Remove <Loại>" riêng, nằm trong khối [role=article] "Comment by ..." / "Reply by ..." (tiếng Việt "Bình luận dưới
# tên ..." / "Phản hồi bình luận của ...") -> luôn loại theo khối đó, không theo nhãn (Facebook đổi nhãn nút thì cùng
# lắm không thả, không bao giờ thả nhầm vào bình luận).
_REACT_LABELS_JS = r"""
const UNREACTED = /^(?:(?:Like|Thích)(?=,|$)|React with Like to |Bày tỏ cảm xúc Thích về )/;
const REACTED = /^(?:Remove (Like|Love|Care|Haha|Wow|Sad|Angry)|Gỡ (Thích|Yêu thích|Thương thương|Haha|Wow|Buồn|Phẫn nộ))(?=,| from | khỏi |$)/;
const KIND = {'Thích': 'Like', 'Yêu thích': 'Love', 'Thương thương': 'Care', 'Buồn': 'Sad', 'Phẫn nộ': 'Angry'};
const reactedKind = (label) => {
  const m = label.match(REACTED);
  return m ? (m[1] || KIND[m[2]] || m[2]) : null;
};
const inComment = (el, root) => {
  const art = el.closest('[role="article"]');
  return !!art && art !== root && root.contains(art)
    && /^(Comment|Reply|Bình luận|Phản hồi)\b/i.test((art.getAttribute('aria-label') || '').trim());
};
"""

# Cảm xúc hiện tại của 1 bài / video (đọc lại sau khi thả), bỏ phần bình luận.
_REACTION_STATE_JS = _REACT_LABELS_JS + r"""
const box = arguments[0];
if (!box || !box.isConnected) return null;
for (const b of box.querySelectorAll('[role="button"][aria-label]')) {
  if (inComment(b, box)) continue;
  const kind = reactedKind(b.getAttribute('aria-label').trim());
  if (kind) return kind;
}
return null;
"""

# Bài trên Newsfeed vừa vào màn hình (khối [aria-posinset] có nút Like của bài nằm trọn trong màn hình), mỗi bài
# chỉ xét 1 lần. Khối không có Like (People you may know, Reels, gợi ý nhóm) tự bị loại. Bài đã thả cảm xúc bỏ qua.
# Nút bị che (ảnh / video / lớp phủ / khối khác) hoặc lệch ngoài màn hình thì chưa xét, không đánh dấu: lần sau xét lại.
_FEED_REACT_CANDIDATES_JS = _REACT_LABELS_JS + r"""
const vh = innerHeight, out = [];
const seen = (el) => {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  if (x < 0 || x > innerWidth) return false;
  const hit = document.elementFromPoint(x, y);
  return !!hit && (hit === el || el.contains(hit));
};
for (const post of document.querySelectorAll('[aria-posinset]')) {
  if (post.dataset.m03Seen) continue;
  const like = Array.from(post.querySelectorAll('[role="button"][aria-label]')).find((b) => {
    const label = b.getAttribute('aria-label').trim();
    return (UNREACTED.test(label) || REACTED.test(label)) && b.getClientRects().length && !inComment(b, post);
  });
  if (!like) continue;
  const r = like.getBoundingClientRect();
  if (r.top < 80 || r.bottom > vh - 10 || !seen(like)) continue;
  post.dataset.m03Seen = '1';
  if (UNREACTED.test(like.getAttribute('aria-label').trim())) out.push([post, like]);
}
return out;
"""

# Feed có nút Like của bài nào không (kể cả bài đã thả), khối không phải bài thì không có: chỉ để biết Facebook đổi nhãn.
_FEED_HAS_LIKE_JS = _REACT_LABELS_JS + r"""
return Array.from(document.querySelectorAll('[aria-posinset]')).some((post) =>
  Array.from(post.querySelectorAll('[role="button"][aria-label]')).some((b) => {
    const label = b.getAttribute('aria-label').trim();
    return (UNREACTED.test(label) || REACTED.test(label)) && !inComment(b, post);
  }));
"""

# Nút Like của video đang xem: tầng tổ tiên gần nhất của video có nút Like / Remove <Loại>. Trình xem reel có 2 video
# (đang phát + kế tiếp), mỗi video 1 nút Like trong khối riêng (đã kiểm 2026-10-22, 2026-10-30 cả tiếng Việt).
# Trả [khối, nút, chưa thả?].
_VIDEO_LIKE_JS = _REACT_LABELS_JS + r"""
let node = arguments[0];
for (let depth = 0; node && depth < 25; depth++, node = node.parentElement) {
  const box = node;
  const like = Array.from(box.querySelectorAll('[role="button"][aria-label]')).find((b) => {
    const label = b.getAttribute('aria-label').trim();
    return (UNREACTED.test(label) || REACTED.test(label)) && !inComment(b, box);
  });
  if (like) return [box, like, UNREACTED.test(like.getAttribute('aria-label').trim())];
}
return null;
"""


# Phần tử nhìn thấy thật: điểm giữa nằm trong màn hình (cả dọc lẫn ngang, dưới thanh tiêu đề) và phần tử trên cùng tại
# điểm đó là chính nó / con của nó. Tránh rê chuột vào "tọa độ" của nút đang bị che: chuột sẽ rơi vào thứ đang hiện ở
# đó (vd tên người đăng, user gặp 2026-10-22 khi màn hình đang ở giữa ảnh / video to, không thấy nút Like nào).
_REALLY_VISIBLE_JS = r"""
const el = arguments[0];
if (!el || !el.isConnected) return false;
const r = el.getBoundingClientRect();
if (r.width < 4 || r.height < 4) return false;
const x = r.left + r.width / 2, y = r.top + r.height / 2;
if (x < 0 || x > innerWidth || y < 60 || y > innerHeight - 5) return false;
const hit = document.elementFromPoint(x, y);
return !!hit && (hit === el || el.contains(hit));
"""

# Điểm trống để đặt chuột (như người để chuột ở lề khi lướt): không nằm trên link, nút, ảnh, video, bài viết, menu,
# cột trái / phải. Dò lề 2 bên cột chính trước rồi quét ngang màn hình. Không có điểm nào thì trả null.
_SAFE_POINT_JS = r"""
const BAD = 'a, button, input, textarea, video, img, svg, [role="button"], [role="link"], [role="img"], [role="article"],'
  + ' [aria-posinset], [role="dialog"], [role="menu"], [role="banner"], [role="navigation"], [role="complementary"]';
const xs = [];
const main = document.querySelector('[role="main"]');
if (main) { const r = main.getBoundingClientRect(); xs.push(r.left - 14, r.right + 14); }
for (let f = 0.02; f < 1; f += 0.04) xs.push(innerWidth * f);
const ys = [0.5, 0.35, 0.65, 0.8].map((f) => innerHeight * f);
for (const x of xs) {
  if (x < 2 || x > innerWidth - 2) continue;
  for (const y of ys) {
    const hit = document.elementFromPoint(x, y);
    if (hit && !hit.closest(BAD)) return [Math.round(x), Math.round(y)];
  }
}
return null;
"""


def _really_visible(driver, element) -> bool:
    try:
        return bool(driver.execute_script(_REALLY_VISIBLE_JS, element))
    except WebDriverException:
        return False


def _park_mouse(driver) -> bool:
    """Đưa chuột ra điểm trống trên màn hình để lúc cuộn trang chuột không lướt qua tên / link (bật thẻ hover)."""
    try:
        point = driver.execute_script(_SAFE_POINT_JS)
    except WebDriverException:
        return False
    if not point:
        return False
    try:
        mouse_to(driver, point[0], point[1])
        return True
    except WebDriverException:
        return False


def _reaction_text(counts: dict) -> str:
    return ", ".join(f"{kind} {n}" for kind, n in counts.items() if n)


def _reaction_result(counts: dict) -> dict:
    return {"reactions": sum(counts.values()), "reaction_types": {k: v for k, v in counts.items() if v}}


def _reaction_locator(kind: str) -> str:
    return REACTION_BUTTON.format(kind=kind, vi=REACTION_NAMES_VI.get(kind, kind))


def _reaction_bar_button(driver, ctl: FarmControl, like_button, kind: str):
    """
    Rê chuột lên nút Like, chờ thanh cảm xúc hiện (tối đa REACTION_BAR_WAIT giây); không hiện thì rê ra rồi rê lại,
    tối đa REACTION_HOVER_TRIES lần. Trả nút của loại cảm xúc cần thả, hoặc None.
    Rê ra: sang điểm trống ở lề, không có thì sang ngang dọc thanh nút (Comment / Share); không rê lên trên vì dễ
    trúng tên người đăng của bài ngắn.
    """
    locator = [_reaction_locator(kind)]
    for attempt in range(REACTION_HOVER_TRIES):
        if attempt:
            if not _park_mouse(driver):
                here = mouse_position(driver)
                if here:
                    try:
                        mouse_to(driver, here[0] + random.randint(180, 260), here[1], curve=0.2, overshoot=False)
                    except WebDriverException:
                        pass
            ctl.sleep(random.uniform(0.6, 1.2))
            if not _really_visible(driver, like_button):
                return None
        if not hover_element(driver, like_button):
            return None
        timer = ActiveTimer(ctl, REACTION_BAR_WAIT)
        while timer.remaining() > 0:
            buttons = _find_visible(driver, locator)
            if buttons:
                return buttons[0]
            ctl.sleep(0.3)
    return None


def _react(driver, ctl: FarmControl, box, like_button, types: list) -> Optional[str]:
    """
    Thả 1 cảm xúc ngẫu nhiên trong types lên bài / video chứa nút like_button (box = khối của bài / video).
    Like thì bấm thẳng nút; loại khác thì rê chuột mở thanh cảm xúc. Trả loại đã thả nếu đọc lại được nhãn
    "Remove <Loại>", không thì None (không đếm). Nút Like / nút trên thanh không thấy thật thì không rê chuột, không bấm.
    Xong (thả được hay không) thì đưa chuột ra điểm trống trước khi kịch bản cuộn tiếp.
    """
    if not _really_visible(driver, like_button):
        logger.debug("Thả cảm xúc: nút Like không thấy thật trên màn hình (bị che / lệch), bỏ qua bài")
        return None
    kind = random.choice(types)
    try:
        if kind == "Like":
            if not _human_click(driver, like_button):
                return None
        else:
            button = _reaction_bar_button(driver, ctl, like_button, kind)
            if button is None:
                logger.info("Thả cảm xúc: thanh cảm xúc không hiện sau %s lần rê chuột, bỏ qua", REACTION_HOVER_TRIES)
                return None
            # Thanh vừa hiện còn chạy hiệu ứng: bấm ngay hoặc rê chéo ra khỏi thanh thì Facebook không nhận. Chờ ~1s rồi
            # rê lên thẳng phía trên nút Like (vẫn trong thanh) trước, sau đó mới sang ngang tới loại cần thả
            # (đã kiểm 2026-10-22). Trang trôi / thanh tắt trong lúc chờ thì không bấm.
            ctl.sleep(random.uniform(0.8, 1.2))
            if not _really_visible(driver, button):
                logger.info("Thả cảm xúc: nút %s trên thanh cảm xúc không còn hiện, không bấm", kind)
                return None
            try:
                like_box, target = element_box(driver, like_button), click_point(driver, button)
                if like_box is None or target is None:
                    return None
                above_like = (like_box[0] + like_box[2]) / 2 + random.uniform(-3, 3)
                # Gần như thẳng (curve nhỏ, không đi quá đà) để chuột không rời khỏi thanh cảm xúc
                mouse_to(driver, above_like, target[1], curve=0.1, overshoot=False)
                time.sleep(random.uniform(0.2, 0.4))
                mouse_to(driver, *target, curve=0.1, overshoot=False)
                time.sleep(random.uniform(0.3, 0.6))
                press_mouse(driver)
            except WebDriverException:
                return None
        ctl.sleep(random.uniform(1.0, 2.0))
        _release_focus(driver)
        try:
            return driver.execute_script(_REACTION_STATE_JS, box)
        except WebDriverException:
            return None
    finally:
        _park_mouse(driver)


# ─────────────────────────── KỊCH BẢN ────────────────────────────

def run_newsfeed(driver, ctl: FarmControl, total_seconds: float, delay_min: float, delay_max: float,
                 report: Callable[[str], None], react: Optional[list] = None,
                 log: Optional[Callable[[str, str], None]] = None) -> dict:
    """
    Lướt Newsfeed tự nhiên: cuộn mượt 500-800px, 10-15% cuộn ngược, dừng đọc theo delay.
    Trang bị chuyển khỏi Trang chủ (người dùng bấm sang chỗ khác) thì mở lại Trang chủ, tối đa NEWSFEED_MAX_REOPENS lần.
    react: loại cảm xúc được chọn; mỗi bài vào màn hình có REACT_RATE khả năng được thả 1 cảm xúc.
    Cuộn REACT_NO_LIKE_SCROLLS lần mà chưa thấy nút Like của bài nào thì báo qua log.
    """
    if total_seconds <= 0:
        return _result("SKIPPED", "Thời gian lướt = 0")
    log = log or (lambda level, text: None)
    like_seen = False
    _open(driver, ctl, FB_HOME, reuse=True)
    landing_path = urlparse(driver.current_url or "").path
    timer = ActiveTimer(ctl, total_seconds)
    scrolls = 0
    reopens = 0
    reactions = {}
    scroll_up_rate = random.uniform(0.10, 0.15)
    try:
        while timer.remaining() > 0:
            ctl.checkpoint()
            if not _on_home_feed(driver, landing_path):
                if reopens >= NEWSFEED_MAX_REOPENS:
                    logger.info("Newsfeed: trang rời khỏi Trang chủ %s lần, kết thúc sớm (%s)",
                                reopens, (driver.current_url or "").split("?")[0])
                    break
                reopens += 1
                report(f"Lướt Newsfeed: trang đã chuyển khỏi Trang chủ, mở lại Trang chủ "
                       f"({timer.elapsed() / 60:.1f}/{total_seconds / 60:.1f} phút)")
                _open(driver, ctl, FB_HOME)
                continue
            human_scroll(driver, random.randint(500, 800))
            scrolls += 1
            if random.random() < scroll_up_rate:
                ctl.sleep(random.uniform(0.8, 1.8))
                human_scroll(driver, -random.randint(300, 500), allow_keys=False)
            # Mỗi lần kiểm tra quét nhiều XPath trên cả feed; 3 nhịp cuộn một lần vẫn kịp bắt checkpoint / popup
            if scrolls % 3 == 0:
                check_account_state(driver)
            if scrolls % 5 == 0:
                report(f"Lướt Newsfeed: {timer.elapsed() / 60:.1f}/{total_seconds / 60:.1f} phút, {scrolls} lần cuộn")
            ctl.sleep(min(random.uniform(delay_min, delay_max), max(timer.remaining(), 0)))
            if react and timer.remaining() > 0:
                like_seen = like_seen or _feed_has_like(driver)
                if not like_seen and scrolls == REACT_NO_LIKE_SCROLLS:
                    log("warning", f"cuộn {scrolls} lần chưa thấy nút Like của bài nào, "
                                   "có thể Facebook đã đổi giao diện nên không thả được cảm xúc")
                for post, like in _feed_react_candidates(driver):
                    if random.random() >= REACT_RATE:
                        continue
                    kind = _react(driver, ctl, post, like, react)
                    if kind:
                        reactions[kind] = reactions.get(kind, 0) + 1
                        report(f"Lướt Newsfeed: đã thả {kind}, tổng {sum(reactions.values())} cảm xúc")
    except Exception as e:
        # Dừng / tài khoản chết / trình duyệt treo giữa chừng: giữ lại phần đã lướt để lịch sử không ghi 0 giây
        e.partial = {"seconds": int(timer.elapsed()), "scrolls": scrolls, **_reaction_result(reactions)}
        raise
    check_account_state(driver)
    react_note = f", thả {sum(reactions.values())} cảm xúc ({_reaction_text(reactions)})" if reactions else ""
    return {**_result("SUCCESS", f"Đã lướt {timer.elapsed() / 60:.1f} phút, cuộn {scrolls} lần{react_note}"),
            "seconds": int(timer.elapsed()), "scrolls": scrolls, **_reaction_result(reactions)}


def _feed_react_candidates(driver) -> list:
    try:
        return driver.execute_script(_FEED_REACT_CANDIDATES_JS) or []
    except WebDriverException:
        return []


def _feed_has_like(driver) -> bool:
    try:
        return bool(driver.execute_script(_FEED_HAS_LIKE_JS))
    except WebDriverException:
        return False


_VISIBLE_VIDEO_JS = """
const vh = window.innerHeight;
let best = null, bestArea = 0;
for (const v of document.querySelectorAll('video')) {
  const r = v.getBoundingClientRect();
  const h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
  if (h > 80 && r.width > 80 && h * r.width > bestArea) { best = v; bestArea = h * r.width; }
}
return best;
"""


_VIDEO_STATE_JS = r"""
const video = arguments[0];
if (!video || !video.isConnected) return null;
const videoId = (value) => {
  if (!value) return null;
  try {
    const url = new URL(value, location.href);
    const path = url.pathname;
    const match = path.match(/\/(?:reel|videos)\/(?:[^/]*\/)?(\d{5,})(?:\/|$)/);
    if (match) return `fb:${match[1]}`;
    if (path === '/watch/' || path === '/watch' || path === '/video.php') {
      const id = url.searchParams.get('v');
      if (id && /^\d{5,}$/.test(id)) return `fb:${id}`;
    }
  } catch (_) {}
  return null;
};
let key = null;
let node = video;
for (let depth = 0; node && depth < 7 && !key; depth++, node = node.parentElement) {
  const id = node.getAttribute('data-video-id');
  if (id && /^\d{5,}$/.test(id)) key = `fb:${id}`;
  if (!key) {
    const links = node.querySelectorAll('a[href*="/reel/"], a[href*="/videos/"], a[href*="/watch/"], a[href*="/video.php"]');
    const ids = new Set(Array.from(links, link => videoId(link.href)).filter(Boolean));
    if (ids.size === 1) key = ids.values().next().value;
  }
}
if (!key) key = videoId(location.href);
const keys = key ? [key] : [];
for (const source of [video.poster, video.currentSrc || video.src]) {
  if (source && !source.startsWith('blob:') && !source.startsWith('data:')) {
    try {
      const url = new URL(source, location.href);
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        keys.push(`media:${url.hostname}${url.pathname}`);
      }
    } catch (_) {}
  }
}
return {
  keys,
  currentTime: Number(video.currentTime) || 0,
  duration: Number.isFinite(video.duration) ? video.duration : 0,
  playing: !video.paused && !video.ended && video.readyState >= 2
};
"""


WATCH_STUCK_LIMIT = 4      # Số lần chuyển liên tiếp mà vẫn gặp video đã xem thì tải lại Watch
WATCH_MAX_RELOADS = 3
WATCH_MAX_REOPENS = 5      # Số lần mở lại Watch khi trang bị chuyển đi nơi khác (vd bấm sang Trang chủ)


def _in_reel_viewer(driver) -> bool:
    """/watch có thể bị Facebook chuyển sang trình xem Reels (/reel/<id>): trang không cuộn, chuyển video bằng phím."""
    return "/reel/" in urlparse(driver.current_url or "").path


def _on_watch_page(driver, landing_path: str = "") -> bool:
    """
    Còn ở khu vực xem video: /watch, trình xem Reels, trang 1 video, hoặc đúng trang Facebook đưa tới khi mở Watch
    (landing_path, phòng khi Facebook đổi đường dẫn của Watch).
    """
    path = urlparse(driver.current_url or "").path
    if path.startswith("/watch") or "/reel/" in path or "/videos/" in path or path == "/video.php":
        return True
    return bool(landing_path) and path.rstrip("/") == landing_path.rstrip("/")


def _video_state(driver, video) -> Optional[dict]:
    """Trạng thái video; None khi phần tử đã bị gỡ khỏi trang (Facebook vẽ lại feed, hoặc trang đã chuyển đi nơi khác)."""
    try:
        return driver.execute_script(_VIDEO_STATE_JS, video)
    except StaleElementReferenceException:
        return None


def _advance_video(driver, video, stuck: int):
    """
    Sang video kế. Trình xem Reels: phím ArrowDown như người dùng máy tính, kẹt lâu thì thử nút Thẻ tiếp theo.
    Feed video thường: cuộn bánh xe ngay trên video. Không dùng SPACE vì SPACE tạm dừng video.
    """
    if _in_reel_viewer(driver):
        if stuck >= 2:
            buttons = _find_visible(driver, FARM_WATCH["next_reel"])
            if buttons and _human_click(driver, buttons[0]):
                return
        if not _focus_is_text_field(driver):
            try:
                ActionChains(driver).send_keys(Keys.ARROW_DOWN).perform()
                return
            except WebDriverException:
                pass
    try:
        human_scroll(driver, random.randint(600, 900), allow_keys=False, element=video)
    except WebDriverException:
        human_scroll(driver, random.randint(600, 900), allow_keys=False)


def run_watch(driver, ctl: FarmControl, total_seconds: float, view_min: float, view_max: float,
              report: Callable[[str], None], react: Optional[list] = None,
              log: Optional[Callable[[str, str], None]] = None) -> dict:
    """
    Đếm mỗi video Watch một lần, sau khi xác nhận video mới đã phát.
    react: loại cảm xúc được chọn; mỗi video đã tính "đã xem" có REACT_RATE khả năng được thả 1 cảm xúc.
    REACT_NO_LIKE_VIDEOS video liên tiếp không thấy nút Like thì báo qua log.
    """
    if total_seconds <= 0:
        return _result("SKIPPED", "Thời gian xem = 0")
    log = log or (lambda level, text: None)
    no_like = 0
    _open(driver, ctl, FB_WATCH)
    landing_path = urlparse(driver.current_url or "").path
    timer = ActiveTimer(ctl, total_seconds)
    reactions = {}
    watched = 0
    misses = 0
    stuck = 0
    reloads = 0
    reopens = 0
    seen_videos = set()

    def progress_text(note: str) -> str:
        return (f"Xem Watch: {note}, đã xem {watched} video "
                f"({timer.elapsed() / 60:.1f}/{total_seconds / 60:.1f} phút)")

    try:
        while timer.remaining() > 0:
            ctl.checkpoint()
            # Trang đã rời Watch (người dùng bấm sang Trang chủ, mở thông báo...): mở lại Watch rồi xem tiếp
            if not _on_watch_page(driver, landing_path):
                if reopens >= WATCH_MAX_REOPENS:
                    logger.info("Watch: trang rời khỏi Watch %s lần, kết thúc sớm (%s)",
                                reopens, (driver.current_url or "").split("?")[0])
                    break
                reopens += 1
                stuck = misses = 0
                report(progress_text("trang đã chuyển khỏi Watch, mở lại Watch"))
                _open(driver, ctl, FB_WATCH)
                continue
            if stuck >= WATCH_STUCK_LIMIT:
                if reloads >= WATCH_MAX_RELOADS:
                    logger.info("Watch: vẫn kẹt sau %s lần tải lại, kết thúc sớm", reloads)
                    break
                reloads += 1
                stuck = 0
                report(progress_text(f"không chuyển được video, tải lại Watch (lần {reloads})"))
                _open(driver, ctl, FB_WATCH)
                continue

            video = driver.execute_script(_VISIBLE_VIDEO_JS)
            if video is None:
                misses += 1
                if misses >= 8:
                    # Ghi lại để phân biệt mất mạng với Facebook tự chuyển trang (vd sang trình xem Reels)
                    try:
                        page = (driver.current_url or "").split("?")[0]
                    except WebDriverException:
                        page = "không đọc được"
                    logger.info("Watch: không tìm thấy video sau %s lần, kết thúc sớm (%.1f/%.1f phút, trang %s)",
                                misses, timer.elapsed() / 60, total_seconds / 60, page)
                    break
                human_scroll(driver, random.randint(600, 900), allow_keys=False)
                ctl.sleep(random.uniform(1.5, 3.0))
                continue
            misses = 0
            state = _video_state(driver, video)
            keys = set(state.get("keys") or []) if state else set()
            if not keys or keys.intersection(seen_videos):
                stuck += 1
                report(progress_text("đang chuyển sang video mới"))
                _advance_video(driver, video, stuck)
                ctl.sleep(min(random.uniform(1.5, 3.0), max(timer.remaining(), 0)))
                check_account_state(driver)
                continue
            stuck = 0
            try:
                # Video luôn có lớp phủ (nút, chữ) đè lên: rê qua phần đang thấy, không kiểm bị che, không cuộn trang
                hover_element(driver, video, need_hit=False)
                time.sleep(random.uniform(0.5, 1.2))
                if driver.execute_script("return arguments[0].muted === true;", video):
                    unmute = _find_visible(driver, FARM_WATCH["unmute_button"])
                    if unmute:
                        _human_click(driver, unmute[0])
                if driver.execute_script("return arguments[0].paused === true;", video):
                    driver.execute_script("arguments[0].play().catch(() => {});", video)
            except WebDriverException as e:
                logger.debug(f"Watch video interaction note: {e}")

            watch_for = min(random.uniform(view_min, view_max), max(timer.remaining(), 0))
            if watch_for <= 0:
                break
            report(progress_text(f"đang xem video mới {watch_for:.0f} giây"))
            played_seconds = 0.0
            previous_time = state["currentTime"]
            elapsed_watch = 0.0
            current = state
            while elapsed_watch < watch_for:
                interval = min(1.0, watch_for - elapsed_watch)
                ctl.sleep(interval)
                elapsed_watch += interval
                current = _video_state(driver, video)
                if current is None:
                    # Video bị gỡ khỏi trang giữa chừng: không tính video này, tìm video khác ở vòng sau
                    report(progress_text("video đang xem đã biến mất khỏi trang, tìm video khác"))
                    break
                if not keys.intersection(current.get("keys") or []):
                    break
                current_time = current["currentTime"]
                if current["playing"]:
                    progress = current_time - previous_time
                    if progress < 0 and current["duration"]:
                        progress += current["duration"]  # Video ngắn phát lặp về giây 0.
                    played_seconds += min(max(progress, 0.0), interval + 0.5)
                previous_time = current_time
            if (elapsed_watch >= watch_for and current
                    and keys.intersection(current.get("keys") or [])
                    and played_seconds >= min(2.0, watch_for / 2)):
                seen_videos.update(keys)
                seen_videos.update(current.get("keys") or [])
                watched += 1
                report(progress_text("vừa xem xong 1 video"))
                if react:
                    found = _video_like(driver, video)
                    no_like = 0 if found else no_like + 1
                    if no_like == REACT_NO_LIKE_VIDEOS:
                        log("warning", f"{no_like} video liên tiếp không thấy nút Like, "
                                       "có thể Facebook đã đổi giao diện nên không thả được cảm xúc")
                    # Video đã thả từ trước (found[2] False) thì bỏ qua
                    if found and found[2] and random.random() < REACT_RATE:
                        kind = _react(driver, ctl, found[0], found[1], react)
                        if kind:
                            reactions[kind] = reactions.get(kind, 0) + 1
                            report(progress_text(f"đã thả {kind}"))
            check_account_state(driver)
            _advance_video(driver, video, 0)
            ctl.sleep(min(random.uniform(1.0, 2.5), max(timer.remaining(), 0)))
    except Exception as e:
        # Dừng / tài khoản chết / trình duyệt treo giữa chừng: giữ lại phần đã xem để lịch sử không ghi 0 giây / 0 video
        e.partial = {"seconds": int(timer.elapsed()), "quantity": watched, **_reaction_result(reactions)}
        raise

    if watched == 0:
        return {**_result("SKIPPED", "Không xác nhận được video mới nào đã phát trên Watch"),
                "seconds": int(timer.elapsed())}
    react_note = f", thả {sum(reactions.values())} cảm xúc ({_reaction_text(reactions)})" if reactions else ""
    return {**_result("SUCCESS", f"Đã xem {watched} video khác nhau trong {timer.elapsed() / 60:.1f} phút{react_note}",
                      watched),
            "seconds": int(timer.elapsed()), **_reaction_result(reactions)}


def _video_like(driver, video) -> Optional[list]:
    """Nút Like trong khối của chính video đang xem: [khối, nút, chưa thả?], không thấy thì None."""
    try:
        return driver.execute_script(_VIDEO_LIKE_JS, video)
    except WebDriverException:
        return None


STORY_MAX_STUCK = 3  # Bấm sang khung kế liên tiếp chừng này lần mà khung không đổi thì coi như hết story

# Trạng thái trình xem story. URL KHÔNG đổi khi chuyển khung / chuyển người (đã kiểm 2026-10-22) nên nhận khung mới
# qua ảnh / video lớn nhất giữa màn hình: ảnh theo đường dẫn, video theo đường dẫn + thời lượng, không có thì theo
# chính phần tử. Hết story: rời /stories/ hoặc hiện nút "Create story" (khung của người khác không có nút này,
# màn cuối thì có, đã kiểm 2026-10-22). Khung thật có nút cảm xúc, màn cuối thì không.
_STORY_STATE_JS = r"""
const vis = (el) => el.getClientRects().length > 0;
const path = location.pathname;
const inViewer = path.startsWith('/stories/') && !path.startsWith('/stories/create');
const labels = Array.from(document.querySelectorAll('[role="button"][aria-label], [role="link"][aria-label]'))
  .filter(vis).map((b) => b.getAttribute('aria-label').trim());
const reacts = labels.filter((l) => /^(Like|Love|Care|Haha|Wow|Sad|Angry|Thích|Yêu thích|Thương thương|Buồn|Phẫn nộ)$/.test(l)).length;
const end = !inViewer || labels.includes('Create story');
const vw = innerWidth;
let media = null, area = 0;
for (const m of document.querySelectorAll('img, video')) {
  if (!vis(m)) continue;
  const r = m.getBoundingClientRect();
  if (r.left > vw * 0.75 || r.right < vw * 0.25) continue;
  if (r.width * r.height > area) { media = m; area = r.width * r.height; }
}
let sig = null;
if (media) {
  if (!media.dataset.m03Frame) media.dataset.m03Frame = Math.random().toString(36).slice(2, 10);
  const src = (media.currentSrc || media.src || '').split('?')[0];
  const extra = media.tagName === 'VIDEO' ? `:${Math.round(media.duration || 0)}` : '';
  sig = `${media.tagName}:${src || media.dataset.m03Frame}${extra}`;
}
return {end, reacts, sig};
"""


def _story_state(driver) -> Optional[dict]:
    try:
        return driver.execute_script(_STORY_STATE_JS)
    except WebDriverException:
        return None


STORY_KEY_WAIT = (0.6, 1.0)  # Chờ sau phím mũi tên phải rồi mới xem khung đã đổi chưa


def _story_next(driver):
    """
    Sang khung kế bằng phím mũi tên phải như người dùng máy tính; focus đang ở ô trả lời thì bỏ focus trước.
    Phím chỉ ăn khi focus còn trong trình xem: thả cảm xúc xong focus về trang (body) thì phím không sang được
    (đã gặp 2026-10-23, kẹt ở 1 video dài). Khung không đổi thì bấm nút Next card / Next Bucket bằng chuột.
    """
    if _focus_is_text_field(driver):
        _release_focus(driver)
    before = _story_state(driver)
    try:
        ActionChains(driver).send_keys(Keys.ARROW_RIGHT).perform()
        time.sleep(random.uniform(*STORY_KEY_WAIT))
        after = _story_state(driver)
        if not before or not after or after.get("end") or after.get("sig") != before.get("sig"):
            return
    except WebDriverException:
        pass
    buttons = _find_visible(driver, FARM_STORY["next"])
    if buttons:
        _human_click(driver, buttons[0])


def _react_story(driver, types: list) -> Optional[str]:
    """Story hiện sẵn các nút cảm xúc: bấm 1 loại ngẫu nhiên. Facebook không đổi nhãn sau khi thả nên tính khi bấm được."""
    kind = random.choice(types)
    buttons = _find_visible(driver, [_reaction_locator(kind)])
    if not buttons or not _human_click(driver, buttons[0]):
        return None
    _release_focus(driver)
    _leave_reaction_bar(driver)
    return kind


# Chuột nằm trên thanh cảm xúc của story thì Facebook dừng khung (phím mũi tên cũng không sang khung được), rê ra
# là chạy tiếp (user mô tả + đã kiểm 2026-10-23). Thả xong rê chuột lên trên, vào vùng khung story.
STORY_LEAVE_UP_PX = (200, 300)
STORY_TRAY_MAX_SCROLL = 400  # Trang chủ đã cuộn quá chừng này (px) thì mở lại để khay story hiện lại


def _leave_reaction_bar(driver):
    here = mouse_position(driver)
    if not here:
        return
    try:
        mouse_to(driver, here[0] + random.randint(-40, 40), here[1] - random.randint(*STORY_LEAVE_UP_PX))
    except WebDriverException:
        pass


def run_story(driver, ctl: FarmControl, target: int, delay_min: float, delay_max: float,
              report: Callable[[str], None], react: Optional[list] = None) -> dict:
    """
    Xem story: bấm thẻ đầu khay story trên Trang chủ, mỗi khung xem trong khoảng delay rồi sang khung kế
    (hết khung của 1 người thì Facebook tự sang người kế). Đếm theo khung; dừng khi đủ target hoặc hết story.
    react: mỗi khung mới có REACT_RATE khả năng được thả 1 cảm xúc.
    """
    if target <= 0:
        return _result("SKIPPED", "Số lượng story = 0")
    # Đang ở Trang chủ nhưng đã lướt xa (vd vừa chạy Newsfeed): Facebook gỡ khay story ở đầu trang khỏi DOM, tìm
    # không thấy thẻ nào (đã gặp 2026-10-23, báo nhầm "không có story"). Mở lại Trang chủ như bấm logo về đầu trang.
    scrolled = _same_page(driver.current_url, FB_HOME) and (_script(driver, "return window.scrollY") or 0) > \
        STORY_TRAY_MAX_SCROLL
    _open(driver, ctl, FB_HOME, reuse=not scrolled)
    _wait_for_any(driver, ctl, FARM_STORY["tray_cards"])
    cards = _find_visible(driver, FARM_STORY["tray_cards"])
    if not cards or not _human_click(driver, cards[0]):
        return _result("SKIPPED", "Không có story nào trong khay để xem")
    ctl.sleep(random.uniform(2.5, 4.0))
    timer = ActiveTimer(ctl, 0)
    frames = stuck = 0
    last_sig = None
    reactions = {}
    try:
        while frames < target:
            ctl.checkpoint()
            check_account_state(driver)
            before = _story_state(driver)
            if not before or before["end"]:
                break
            view = random.uniform(delay_min, delay_max)
            if react and before["reacts"] and before["sig"] != last_sig and random.random() < REACT_RATE:
                part = view * random.uniform(0.3, 0.6)
                ctl.sleep(part)
                kind = _react_story(driver, react)
                if kind:
                    reactions[kind] = reactions.get(kind, 0) + 1
                ctl.sleep(view - part)
            else:
                ctl.sleep(view)
            after = _story_state(driver)
            ended = not after or after["end"]
            logger.debug("Story: trước %s, sau %s", before, after)
            # Hết story trong lúc xem: chỉ tính khung vừa xem nếu lúc bắt đầu xem nó là khung thật (có nút cảm xúc),
            # không tính màn cuối chưa kịp hiện nút "Create story"
            sig = (before["sig"] if before["reacts"] else None) if ended else after["sig"]
            if sig and sig != last_sig:
                frames += 1
                stuck = 0
                last_sig = sig
                report(f"Xem Story: {frames}/{target} story" + (f", {sum(reactions.values())} cảm xúc" if reactions else ""))
            else:
                stuck += 1
                if stuck >= STORY_MAX_STUCK:
                    logger.info("Story: %s lần sang khung kế mà khung không đổi, kết thúc", stuck)
                    break
            if ended or frames >= target:
                break
            _story_next(driver)
            ctl.sleep(random.uniform(1.0, 2.0))
    except Exception as e:
        e.partial = {"seconds": int(timer.elapsed()), "quantity": frames, **_reaction_result(reactions)}
        raise

    extra = {"seconds": int(timer.elapsed()), **_reaction_result(reactions)}
    if frames == 0:
        return {**_result("SKIPPED", "Không xem được story nào"), **extra}
    react_note = f", thả {sum(reactions.values())} cảm xúc ({_reaction_text(reactions)})" if reactions else ""
    tail = "" if frames >= target else " (hết story)"
    return {**_result("SUCCESS", f"Đã xem {frames}/{target} story trong {timer.elapsed() / 60:.1f} phút"
                                 f"{react_note}{tail}", frames), **extra}


def _wait_for_any(driver, ctl: FarmControl, locators, timeout: float = PAGE_LOAD_WAIT) -> bool:
    """
    Chờ tối đa timeout giây (thời gian chạy thật) cho ít nhất 1 nút hiển thị.
    Mạng / proxy chậm thì danh sách gợi ý chưa kịp tải, tìm ngay sẽ kết luận nhầm là trang trống.
    """
    timer = ActiveTimer(ctl, timeout)
    while True:
        if _find_visible(driver, locators):
            return True
        if timer.remaining() <= 0:
            return False
        ctl.sleep(1.0)


def _pick_button(driver, ctl: FarmControl, locators, clicked_ids: set):
    """Chọn ngẫu nhiên 1 nút chưa bấm trong PICK_WINDOW nút đang hiển thị; thỉnh thoảng cuộn xem thêm rồi mới chọn."""
    def visible():
        return [b for b in _find_visible(driver, locators) if b.id not in clicked_ids]

    buttons = visible()
    if buttons and random.random() < BROWSE_BEFORE_PICK_RATE:
        human_scroll(driver, random.randint(300, 600), allow_keys=False)
        ctl.sleep(random.uniform(1.0, 2.5))
        buttons = visible() or buttons
    return random.choice(buttons[:PICK_WINDOW]) if buttons else None


def _pause_between(driver, ctl: FarmControl, delay: tuple, report: Callable[[str], None], label: str):
    """Nghỉ ngẫu nhiên trong khoảng delay; thỉnh thoảng nghỉ dài 30-60s và cuộn đọc trang."""
    if random.random() >= LONG_PAUSE_RATE:
        ctl.sleep(random.uniform(*delay))
        return
    total = random.uniform(*LONG_PAUSE_RANGE)
    report(f"{label}: nghỉ {total:.0f} giây, lướt xem trang")
    end = time.time() + total
    while time.time() < end:
        ctl.sleep(min(random.uniform(4.0, 9.0), max(end - time.time(), 0)))
        if time.time() < end:
            human_scroll(driver, random.choice([1, 1, -1]) * random.randint(250, 500), allow_keys=False)


# Đọc người / nhóm trên thẻ chứa nút sắp bấm: đi ngược lên từ nút, dừng ở tầng đầu tiên có đúng 1 đối tượng.
# Tầng chứa từ 2 đối tượng khác nhau trở lên (theo link, hoặc theo tên trong nhãn nút "Remove X" / "Add Friend X")
# là cả danh sách, không phải 1 thẻ: dừng, không lấy nhầm đối tượng của thẻ bên cạnh. Không đếm số nút: Facebook vẽ
# 2 bản nút của cùng 1 thẻ (đã gặp trên trang gợi ý kết bạn 2026-10-21). Chỉ nhận link https của facebook.com.
# Đánh dấu thẻ bằng data-m03-target để sau khi bấm đọc lại trạng thái (nhóm: đã vào / chờ duyệt).
_TARGET_JS = r"""
const button = arguments[0], kind = arguments[1], token = arguments[2];
const RESERVED_GROUP = new Set(['joins', 'discover', 'feed', 'create', 'search', 'notifications']);
const NOT_PROFILE = new Set(['friends', 'groups', 'watch', 'marketplace', 'gaming', 'reel', 'reels', 'photo', 'photos',
  'events', 'pages', 'search', 'notifications', 'messages', 'bookmarks', 'stories', 'hashtag', 'profile.php']);
const parse = (a) => {
  let url;
  try { url = new URL(a.href, location.href); } catch (_) { return null; }
  if (url.protocol !== 'https:' || !/(^|\.)facebook\.com$/.test(url.hostname)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (kind === 'group') {
    if (parts[0] !== 'groups' || !parts[1] || RESERVED_GROUP.has(parts[1]) || parts.length > 2) return null;
    return {id: parts[1], url: `https://www.facebook.com/groups/${parts[1]}/`};
  }
  // Thẻ gợi ý: /friends/suggestions/?profile_id=; thành viên nhóm: /groups/<gid>/user/<uid>/; trang cá nhân
  let id = url.searchParams.get('profile_id');
  if (!id && parts[0] === 'groups' && parts[2] === 'user') id = parts[3];
  if (!id && parts[0] === 'profile.php') id = url.searchParams.get('id');
  if (!id && parts[0] === 'people') id = parts[2];  // /people/<Tên>/<id>/
  if (id && /^\d+$/.test(id)) return {id, url: `https://www.facebook.com/profile.php?id=${id}`};
  if (parts.length === 1 && /^[A-Za-z0-9.]{5,}$/.test(parts[0]) && !NOT_PROFILE.has(parts[0].toLowerCase())) {
    return {id: parts[0], url: `https://www.facebook.com/${parts[0]}`};
  }
  return null;
};
// Tên trong nhãn nút: "Add Friend Holly Lane", "Remove Oladiti Bukola", "Join group Phòng trọ TP.HCM"
// (nhãn nhóm thật không có dấu phẩy, đã kiểm 2026-10-21; trang đề xuất cũ có dạng "Join group, X")
const NAME_LABEL = kind === 'group'
  ? /^(?:Tham gia nhóm|Join [Gg]roup)\s*,?\s+(.+)$/
  : /^(?:Thêm bạn bè|Add [Ff]riend|Remove|Gỡ|Xóa)\s+(.+)$/;
const nameFromLabel = (el) => {
  const m = (el.getAttribute('aria-label') || '').trim().match(NAME_LABEL);
  return m ? m[1].trim() : '';
};
const norm = (s) => (s || '').trim().toLowerCase();
let labelName = nameFromLabel(button);
// Lý do không lấy được link, để ghi log: tầng dừng và các link (bỏ query) ở tầng đầu tiên có link
const debug = {stop: 'no_link', depth: null, links: []};
let node = button.parentElement;
for (let depth = 0; node && depth < 12; depth++, node = node.parentElement) {
  const labelNames = Array.from(node.querySelectorAll('[role="button"][aria-label]'), nameFromLabel).filter(Boolean);
  if (new Set(labelNames.map(norm)).size > 1) { Object.assign(debug, {stop: 'many_names', depth}); break; }
  if (!labelName && labelNames.length) labelName = labelNames[0];
  const anchors = Array.from(node.querySelectorAll('a[href]'));
  if (!debug.links.length && anchors.length) {
    debug.links = anchors.slice(0, 8).map((a) => (a.getAttribute('href') || '').split('?')[0].slice(0, 80));
  }
  const found = new Map();
  for (const a of anchors) {
    const t = parse(a);
    if (!t) continue;
    const name = (a.innerText || a.getAttribute('aria-label') || '').trim().split('\n')[0].trim();
    const prev = found.get(t.id);
    if (!prev || (!prev.name && name)) found.set(t.id, {...t, name});
  }
  let pick = null;
  if (found.size === 1) {
    pick = found.values().next().value;
  } else if (found.size > 1) {
    // Nhiều đối tượng (vd ảnh bạn chung): chỉ nhận link có chữ trùng tên trong nhãn nút
    const same = labelName ? [...found.values()].filter((t) => norm(t.name) === norm(labelName)) : [];
    if (same.length !== 1) { Object.assign(debug, {stop: 'many_links', depth}); break; }
    pick = same[0];
  }
  if (pick) {
    if (token) node.setAttribute('data-m03-target', token);
    return {name: pick.name || labelName, url: pick.url};
  }
}
return {name: labelName || null, url: null, debug};
"""

# Trạng thái nhóm sau khi bấm Tham gia, đọc trên thẻ đã đánh dấu: nhóm kín thì chờ admin duyệt.
# So nguyên dòng chữ / nhãn của nút, không tìm chữ trong cả thẻ (tên nhóm có thể chứa "Visit").
# Nhóm công khai: nút "Join group X" đổi thành "Visit" (đã kiểm 2026-10-21).
_GROUP_STATUS_JS = r"""
const card = document.querySelector(`[data-m03-target="${arguments[0]}"]`);
if (!card) return null;
const texts = [
  ...(card.innerText || '').split('\n'),
  ...Array.from(card.querySelectorAll('[aria-label]'), (e) => e.getAttribute('aria-label')),
].map((t) => (t || '').trim()).filter(Boolean);
const has = (re) => texts.some((t) => re.test(t));
if (has(/^(Hủy yêu cầu|Cancel [Rr]equest|Đã gửi yêu cầu|Request sent|Requested|Đã yêu cầu|Pending|Đang chờ duyệt)$/)) return 'pending';
if (has(/^(Đã tham gia|Joined|Truy cập|Truy cập nhóm|Visit|Visit group|Xem nhóm|View group)$/)) return 'joined';
return null;
"""

_target_seq = 0
_target_seq_lock = threading.Lock()


def _read_target(driver, button, kind: str, token: str = "") -> dict:
    """Tên + link người / nhóm trên thẻ chứa nút sắp bấm. Không đọc được thì name / url = None (vẫn ghi 1 lượt)."""
    try:
        info = driver.execute_script(_TARGET_JS, button, kind, token) or {}
    except WebDriverException as e:
        info = {"debug": f"lỗi script: {str(e)[:120]}"}
    url = info.get("url")
    target = {"name": (str(info.get("name") or "").strip()[:150] or None),
              "url": url if isinstance(url, str) and url.startswith("https://www.facebook.com/") else None}
    if not target["url"]:
        # Ghi lại cấu trúc thẻ để sửa cách đọc khi Facebook đổi giao diện
        logger.info("Không đọc được link %s '%s': %s", "nhóm" if kind == "group" else "người",
                    target["name"] or "?", info.get("debug"))
    return target


def _next_target_token() -> str:
    global _target_seq
    with _target_seq_lock:
        _target_seq += 1
        return f"t{_target_seq}"


def _group_join_status(driver, token: str, list_url: str, outcome: str) -> Optional[str]:
    """'joined' / 'pending' / None (không xác định được). Bị chuyển sang trang nhóm nghĩa là đã vào nhóm công khai."""
    if not _same_page(driver.current_url, list_url):
        return "joined"
    try:
        status = driver.execute_script(_GROUP_STATUS_JS, token)
    except WebDriverException:
        status = None
    if not status and outcome != "submitted":
        logger.info("Không đọc được trạng thái nhóm sau khi bấm tham gia (thẻ %s)", token)
    # Đã trả lời form câu hỏi mà không đọc được nút: nhóm có câu hỏi thường phải chờ duyệt
    return status or ("pending" if outcome == "submitted" else None)


def _keep_targets(e: Exception, targets: list):
    """Gắn danh sách đối tượng đã tương tác vào lỗi để lịch sử vẫn ghi được khi dừng / lỗi giữa chừng."""
    e.partial = {**(getattr(e, "partial", None) or {}), "targets": list(targets)}


# UID số trong link trang cá nhân đã chuẩn hóa (profile.php?id=<số>); link dạng username không có
_PROFILE_ID_RE = re.compile(r"[?&]id=(\d+)")


def _profile_uid(*urls) -> Optional[str]:
    for url in urls:
        match = _PROFILE_ID_RE.search(url or "")
        if match:
            return match.group(1)
    return None


def _own_nick_note(skipped: int) -> str:
    return f", bỏ qua {skipped} người là nick trong dàn" if skipped else ""


def run_add_friends(driver, ctl: FarmControl, target: int, report: Callable[[str], None],
                    progress: Optional[Callable[[int], None]] = None,
                    delay: tuple = FRIEND_DELAY_RANGE, own_uids: Optional[set] = None) -> dict:
    """
    Kết bạn theo gợi ý: chọn ngẫu nhiên, nghỉ theo delay, bắt popup 'Bạn có biết…' và dialog chặn tính năng.
    own_uids: UID các nick trong dàn; gợi ý trúng nick trong dàn thì bỏ qua, không tính vào số lời mời.
    Kết quả có thêm "targets": tên + link những người đã gửi lời mời.
    """
    if target <= 0:
        return _result("SKIPPED", "Số lượng kết bạn = 0")
    targets = []
    skipped_own = 0
    try:
        _open(driver, ctl, FB_FRIEND_SUGGESTIONS)
        _wait_for_any(driver, ctl, FARM_FRIEND["add_friend_buttons"])
        sent = 0
        clicked_ids = set()
        empty_rounds = 0
        while sent < target:
            ctl.checkpoint()
            button = _pick_button(driver, ctl, FARM_FRIEND["add_friend_buttons"], clicked_ids)
            if button is None:
                empty_rounds += 1
                if empty_rounds >= 4:
                    break
                human_scroll(driver, random.randint(700, 1000), allow_keys=False)
                ctl.sleep(random.uniform(2.0, 3.5))
                continue
            empty_rounds = 0
            clicked_ids.add(button.id)
            person = _read_target(driver, button, "friend")
            if own_uids and _profile_uid(person["url"]) in own_uids:
                skipped_own += 1
                report("Kết bạn: bỏ qua 1 gợi ý là nick trong dàn")
                continue
            if not _human_click(driver, button):
                continue
            ctl.sleep(random.uniform(1.5, 2.5))

            if check_account_state(driver) == "blocked":
                _close_dialogs(driver)
                return {**_result("BLOCKED", f"Bị chặn tính năng kết bạn sau {sent} lời mời", sent), "targets": targets}
            if _find_visible(driver, FARM_FRIEND["know_person_dialog"]):
                _close_dialogs(driver)
                status = "SUCCESS" if sent else "SKIPPED"
                return {**_result(status, f"Đã gửi {sent} lời mời, dừng do Facebook hỏi 'Bạn có biết người này'"
                                          f"{_own_nick_note(skipped_own)}", sent), "targets": targets}

            sent += 1
            targets.append(person)
            _count(progress, sent)
            report(f"Kết bạn: đã gửi {sent}/{target} lời mời")
            if sent < target:
                _pause_between(driver, ctl, delay, report, f"Kết bạn {sent}/{target}")
    except Exception as e:
        _keep_targets(e, targets)
        raise

    if sent == 0:
        result = _result("SKIPPED", f"Không có gợi ý kết bạn, tự động bỏ qua{_own_nick_note(skipped_own)}")
        result["no_suggestions"] = True
        return result
    return {**_result("SUCCESS", f"Đã gửi {sent}/{target} lời mời kết bạn{_own_nick_note(skipped_own)}", sent),
            "targets": targets}


_JOINED_GROUP_IDS_JS = r"""
const ids = new Set();
for (const a of document.querySelectorAll('a[href*="/groups/"]')) {
  const m = a.href.match(/\/groups\/([^/?#]+)\/?(?:[?#]|$)/);
  if (m && !['joins', 'discover', 'feed', 'create', 'search', 'notifications'].includes(m[1])) ids.add(m[1]);
}
return Array.from(ids);
"""


def run_add_friends_from_groups(driver, ctl: FarmControl, target: int, report: Callable[[str], None],
                                progress: Optional[Callable[[int], None]] = None,
                                delay: tuple = FRIEND_DELAY_RANGE, own_uids: Optional[set] = None) -> dict:
    """
    Kết bạn dự phòng khi trang gợi ý trống: gửi lời mời cho thành viên các nhóm nick đã tham gia.
    Chọn ngẫu nhiên trong các người đang hiển thị, nghỉ theo delay, bắt popup / dialog chặn như kết bạn gợi ý.
    own_uids: UID các nick trong dàn (thường cùng ở các nhóm này); trúng nick trong dàn thì bỏ qua.
    Kết quả có thêm "targets": tên + link những người đã gửi lời mời.
    """
    if target <= 0:
        return _result("SKIPPED", "Số lượng kết bạn = 0")
    targets = []
    skipped_own = 0
    try:
        _open(driver, ctl, FB_GROUPS_JOINS)
        group_ids = driver.execute_script(_JOINED_GROUP_IDS_JS) or []
        if not group_ids:
            return _result("SKIPPED", "Nick chưa tham gia nhóm nào để lấy thành viên kết bạn")
        random.shuffle(group_ids)

        sent = 0
        used_groups = []
        for gid in group_ids[:5]:
            if sent >= target:
                break
            _open(driver, ctl, FB_GROUP_MEMBERS.format(gid=gid))
            clicked_ids = set()
            empty_rounds = 0
            group_sent = 0
            while sent < target:
                ctl.checkpoint()
                button = _pick_button(driver, ctl, FARM_FRIEND["add_friend_buttons"], clicked_ids)
                if button is None:
                    empty_rounds += 1
                    if empty_rounds >= 3:
                        break
                    human_scroll(driver, random.randint(700, 1000), allow_keys=False)
                    ctl.sleep(random.uniform(2.0, 3.5))
                    continue
                empty_rounds = 0
                clicked_ids.add(button.id)
                person = _read_target(driver, button, "friend")
                if own_uids and _profile_uid(person["url"]) in own_uids:
                    skipped_own += 1
                    report("Kết bạn thành viên nhóm: bỏ qua 1 người là nick trong dàn")
                    continue
                if not _human_click(driver, button):
                    continue
                ctl.sleep(random.uniform(1.5, 2.5))

                if check_account_state(driver) == "blocked":
                    _close_dialogs(driver)
                    return {**_result("BLOCKED", f"Bị chặn tính năng kết bạn sau {sent} lời mời (thành viên nhóm)", sent),
                            "targets": targets}
                if _find_visible(driver, FARM_FRIEND["know_person_dialog"]):
                    _close_dialogs(driver)
                    status = "SUCCESS" if sent else "SKIPPED"
                    return {**_result(status, f"Đã gửi {sent} lời mời cho thành viên nhóm, dừng do Facebook hỏi "
                                              f"'Bạn có biết người này'{_own_nick_note(skipped_own)}", sent),
                            "targets": targets}

                sent += 1
                group_sent += 1
                targets.append(person)
                _count(progress, sent)
                report(f"Kết bạn thành viên nhóm: đã gửi {sent}/{target} lời mời")
                if sent < target:
                    _pause_between(driver, ctl, delay, report, f"Kết bạn thành viên nhóm {sent}/{target}")
            if group_sent:
                used_groups.append(gid)
    except Exception as e:
        _keep_targets(e, targets)
        raise

    if sent == 0:
        return _result("SKIPPED", f"Không gửi được lời mời nào cho thành viên các nhóm đã tham gia"
                                  f"{_own_nick_note(skipped_own)}")
    return {**_result("SUCCESS", f"Đã gửi {sent}/{target} lời mời cho thành viên nhóm ({', '.join(used_groups)})"
                                 f"{_own_nick_note(skipped_own)}", sent), "targets": targets}


def _handle_group_dialog(driver) -> str:
    """
    Xử lý dialog sau khi bấm Tham gia nhóm.
    Trả "none" (không có dialog), "submitted" (form nội quy đơn giản đã gửi), "skipped" (form phức tạp, đã đóng).
    """
    dialogs = _find_visible(driver, FARM_GROUP["open_dialog"])
    if not dialogs:
        return "none"
    dialog = dialogs[-1]
    try:
        if dialog.find_elements(By.XPATH, FARM_GROUP["dialog_text_inputs"]):
            _close_dialogs(driver)
            return "skipped"
        checkboxes = dialog.find_elements(By.XPATH, FARM_GROUP["dialog_checkboxes"])
        submit = dialog.find_elements(By.XPATH, FARM_GROUP["dialog_submit"])
        if checkboxes and submit:
            for box in checkboxes:
                checked = (box.get_attribute("aria-checked") == "true") or box.is_selected()
                if not checked:
                    _human_click(driver, box)
                    time.sleep(random.uniform(0.4, 0.9))
            _human_click(driver, submit[0])
            return "submitted"
    except WebDriverException as e:
        logger.debug(f"Group dialog handling note: {e}")
    _close_dialogs(driver)
    return "skipped"


# Bỏ qua liên tiếp chừng này nhóm (đã thuộc nick khác / form phức tạp / không bấm được) mà chưa vào được nhóm nào
# thì thôi trang kết quả này, sang từ khóa kế: tránh cuộn mãi khi phần lớn nhóm đã có nick khác trong dàn vào
KEYWORD_MAX_MISSES = 15


def run_join_groups(driver, ctl: FarmControl, target: int, keywords: Optional[list], report: Callable[[str], None],
                    progress: Optional[Callable[[int], None]] = None,
                    delay: tuple = GROUP_DELAY_RANGE, owners=None) -> dict:
    """
    Tham gia nhóm theo danh sách từ khóa (đã xáo riêng cho từng nick): từ khóa nào hết nhóm vào được thì chuyển
    sang từ khóa kế tiếp, đến khi đủ số lượng hoặc hết danh sách. Danh sách rỗng thì vào nhóm đề xuất.
    Chọn ngẫu nhiên, nghỉ theo delay, bỏ qua form phức tạp.
    owners (routes.TargetOwners): giành chủ nhóm trước khi bấm; nhóm đã thuộc nick khác trong dàn thì bỏ qua,
    đang chia mà không đọc được link nhóm thì cũng bỏ qua (không biết có trùng nick khác không).
    Kết quả có thêm "keywords": các từ khóa đã mở trang tìm kiếm, theo thứ tự đã dùng;
    "targets": tên + link các nhóm đã bấm tham gia, kèm trạng thái joined / pending (None: không đọc được).
    """
    if target <= 0:
        return _result("SKIPPED", "Số lượng nhóm = 0")
    keywords = [k.strip() for k in (keywords or []) if k and k.strip()]
    sources = [(k, FB_GROUPS_SEARCH.format(q=quote_plus(k))) for k in keywords] or [(None, FB_GROUPS_DISCOVER)]
    joined = 0
    skipped_forms = 0
    skipped_owned = skipped_unknown = 0
    used = []
    targets = []
    try:
        for keyword, list_url in sources:
            if joined >= target:
                break
            if keyword:
                if used:
                    report(f"Tham gia nhóm: từ khóa '{used[-1]}' hết nhóm, chuyển sang '{keyword}'")
                used.append(keyword)
            _open(driver, ctl, list_url)
            _wait_for_any(driver, ctl, FARM_GROUP["join_buttons"])
            clicked_ids = set()
            empty_rounds = misses = 0
            while joined < target:
                ctl.checkpoint()
                if misses >= KEYWORD_MAX_MISSES:
                    report(f"Tham gia nhóm: bỏ qua liên tiếp {misses} nhóm, thôi danh sách này")
                    break
                button = _pick_button(driver, ctl, FARM_GROUP["join_buttons"], clicked_ids)
                if button is None:
                    empty_rounds += 1
                    if empty_rounds >= 4:
                        break
                    human_scroll(driver, random.randint(700, 1000), allow_keys=False)
                    ctl.sleep(random.uniform(2.0, 3.5))
                    continue
                empty_rounds = 0
                clicked_ids.add(button.id)
                token = _next_target_token()
                group = _read_target(driver, button, "group", token)
                keys = owners.keys(group["url"]) if owners else []
                misses += 1  # Về 0 khi vào được nhóm
                if owners and owners.enforce and not keys:
                    skipped_unknown += 1
                    report("Tham gia nhóm: bỏ qua 1 nhóm không đọc được link (không biết có trùng nick khác không)")
                    continue
                other = owners.claim(keys, group["name"], group["url"]) if keys else None
                if other:
                    skipped_owned += 1
                    report(f"Tham gia nhóm: bỏ qua '{group['name'] or group['url']}' (đã thuộc nick khác trong dàn)")
                    continue
                if not _human_click(driver, button):
                    if keys:
                        owners.release(keys)
                    continue
                ctl.sleep(random.uniform(2.0, 3.0))

                if check_account_state(driver) == "blocked":
                    _close_dialogs(driver)
                    return {**_result("BLOCKED", f"Bị chặn tham gia nhóm sau {joined} nhóm", joined),
                            "keywords": used, "targets": targets}

                outcome = _handle_group_dialog(driver)
                if outcome == "skipped":
                    skipped_forms += 1
                    if keys:
                        owners.release(keys)
                    report("Tham gia nhóm: bỏ qua 1 nhóm có form câu hỏi phức tạp")
                    ctl.sleep(random.uniform(2.0, 4.0))
                    continue

                joined += 1
                misses = 0
                ctl.sleep(random.uniform(1.0, 2.0))  # Chờ nút đổi sang "Đã tham gia" / "Hủy yêu cầu"
                status = _group_join_status(driver, token, list_url, outcome)
                if keys:
                    owners.settle(keys, status or "joined", group["name"], group["url"])
                targets.append({**group, "status": status})
                _count(progress, joined)
                report(f"Tham gia nhóm: {joined}/{target} nhóm")
                # Một số nhóm công khai tự chuyển sang trang nhóm sau khi tham gia: quay lại danh sách
                if (driver.current_url or "").split("?")[0].rstrip("/") != list_url.split("?")[0].rstrip("/"):
                    _open(driver, ctl, list_url)
                    clicked_ids.clear()
                if joined < target:
                    _pause_between(driver, ctl, delay, report, f"Tham gia nhóm {joined}/{target}")
    except Exception as e:
        # Dừng / lỗi giữa chừng: giữ lại các từ khóa và nhóm đã dùng để lịch sử vẫn ghi được
        e.partial = {"keywords": list(used)}
        _keep_targets(e, targets)
        raise

    extra = f", bỏ qua {skipped_forms} nhóm có form phức tạp" if skipped_forms else ""
    if skipped_owned:
        extra += f", bỏ qua {skipped_owned} nhóm đã thuộc nick khác"
    if skipped_unknown:
        extra += f", bỏ qua {skipped_unknown} nhóm không đọc được link"
    source = "từ khóa " + ", ".join(f"'{k}'" for k in used) if used else "nhóm đề xuất"
    if joined == 0:
        return {**_result("SKIPPED", f"Không tham gia được nhóm nào ({source}){extra}"), "keywords": used}
    return {**_result("SUCCESS", f"Đã tham gia {joined}/{target} nhóm ({source}){extra}", joined),
            "keywords": used, "targets": targets}


# ─────────────────────────── THEO DANH SÁCH LINK ────────────────────────────

# Lý do bỏ qua link (ghi vào targets[].reason, hiện ở chi tiết lịch sử)
SKIP_UNAVAILABLE = "skipped_unavailable"
SKIP_DONE = "skipped_done"
SKIP_FORM = "skipped_form"
SKIP_OWNED = "skipped_owned"  # Nhóm / người đã thuộc nick khác trong dàn (chia đích)
SKIP_OWN_NICK = "skipped_own_nick"  # Người nhận là chính 1 nick trong dàn (kể cả nick đang chạy)
LINK_SKIP_PAUSE = (2.0, 4.0)  # Nghỉ ngắn sau khi mở 1 link phải bỏ qua, không mở link kế ngay lập tức

# ID số + tên rút gọn của nhóm đang mở, đọc trong dữ liệu trang (đã kiểm 2026-10-23): mở bằng ID thì URL giữ ID,
# mở bằng tên rút gọn thì giữ tên; trang luôn có "groupID":"<số>" và tab About "content_view_uri":"\/groups\/<tên>\/about\/"
# (nhóm không có tên rút gọn thì <tên> là ID). Dùng để 1 nhóm dán bằng ID hay tên vẫn ra cùng 1 chủ.
_GROUP_ALIASES_JS = r"""
const html = document.documentElement.innerHTML;
const id = (html.match(/"groupID":"(\d+)"/) || [])[1] || null;
const slug = (html.match(/"content_view_uri":"\\\/groups\\\/([^"\\\/]+)\\\/about\\\/"/) || [])[1] || null;
return {id, slug};
"""


def _group_alias_urls(driver, page_url: str) -> list:
    """Link nhóm theo ID số và tên rút gọn. Dữ liệu không khớp nhóm đang mở (có thể của nhóm khác) thì bỏ."""
    info = _script(driver, _GROUP_ALIASES_JS) or {}
    names = {str(v) for v in (info.get("id"), info.get("slug")) if v}
    current = page_url.rstrip("/").rsplit("/groups/", 1)[-1].lower()
    if current not in {n.lower() for n in names}:
        return []
    return [f"https://www.facebook.com/groups/{n}/" for n in sorted(names)]

# Trạng thái nút của trang nhóm: so nguyên nhãn / dòng chữ của nút đang hiển thị
_GROUP_PAGE_STATE_JS = r"""
const texts = [];
for (const el of document.querySelectorAll('[role="button"]')) {
  if (!el.getClientRects().length) continue;
  texts.push((el.getAttribute('aria-label') || '').trim());
  for (const line of (el.innerText || '').split('\n')) texts.push(line.trim());
}
const has = (re) => texts.some((t) => re.test(t));
if (has(/^(Cancel [Rr]equest|Hủy yêu cầu|Đã gửi yêu cầu|Request sent|Requested|Pending)$/)) return 'pending';
if (has(/^(Joined|Đã tham gia)$/)) return 'joined';
return null;
"""

# Tên trang đang mở (nhóm / người): tiêu đề h1 trong vùng chính, không có thì lấy từ tiêu đề tab
_PAGE_NAME_JS = r"""
const h1 = document.querySelector('[role="main"] h1') || document.querySelector('h1');
const fromH1 = h1 ? (h1.innerText || '').split('\n')[0].trim() : '';
if (fromH1) return fromH1;
return (document.title || '').replace(/^\(\d+\+?\)\s*/, '').replace(/\s*\|\s*Facebook\s*$/, '').trim() || null;
"""

# Trang cá nhân: chỉ bấm nút kết bạn của CHỦ TRANG. Cùng trang có khối gợi ý "Add Friend <người khác>", mỗi người
# gợi ý luôn kèm nút "Remove recommendation for <tên>" (đã kiểm 2026-10-22); nút của chủ trang thì không.
# Tên chủ trang: nút "Search <Tên>'s profile" (có lúc có), không có thì là tên trong nhãn "Add Friend <Tên>" /
# "Cancel Request <Tên>" không thuộc khối gợi ý và trùng chữ của nút tên chủ trang (nút không nhãn, chữ = tên;
# trang cá nhân hiện không có h1), cuối cùng mới thử h1. Không xác định được chủ trang thì không bấm gì.
_PROFILE_STATE_JS = r"""
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const visible = (el) => el.getClientRects().length > 0;
const buttons = Array.from(document.querySelectorAll('[role="button"]')).filter(visible);
const label = (el) => (el.getAttribute('aria-label') || '').trim();
const ADD = /^(?:Add [Ff]riend|Thêm bạn bè)\s+(.+)$/;
const CANCEL = /^(?:Cancel [Rr]equest|Hủy lời mời|Hủy yêu cầu)\s+(.+)$/;
const nameIn = (el, re) => { const m = label(el).match(re); return m ? m[1].trim() : null; };
const recommended = new Set(buttons.map((b) => nameIn(b, /^Remove recommendation for\s+(.+)$/)).filter(Boolean).map(norm));
const plainTexts = new Set(buttons.filter((b) => !label(b)).map((b) => norm((b.innerText || '').split('\n')[0])));
let owner = null;
for (const el of document.querySelectorAll('[aria-label]')) {
  const m = label(el).match(/^Search\s+(.+?)['’]s profile$/);
  if (m) { owner = m[1].trim(); break; }
}
if (!owner) {
  for (const b of buttons) {
    const name = nameIn(b, ADD) || nameIn(b, CANCEL);
    if (name && !recommended.has(norm(name)) && plainTexts.has(norm(name))) { owner = name; break; }
  }
}
if (!owner) {
  const h1 = document.querySelector('[role="main"] h1');
  owner = h1 ? (h1.innerText || '').split('\n')[0].trim() || null : null;
}
const ownerButton = (re) => owner ? buttons.find((b) => { const n = nameIn(b, re); return n && norm(n) === norm(owner); }) : null;
const add = ownerButton(ADD);
if (add) return {owner, state: 'add', button: add};
if (ownerButton(CANCEL)) return {owner, state: 'pending', button: null};
if (buttons.some((b) => /^(Friends|Bạn bè)$/.test(label(b)))) return {owner, state: 'friends', button: null};
return {owner, state: 'none', button: null};
"""

_PROFILE_SKIP_REASONS = {
    "pending": "đã gửi lời mời trước đó, đang chờ chấp nhận",
    "friends": "đã là bạn bè",
    "none": "trang không có nút Thêm bạn bè",
}


def _clean_page_url(current: str, fallback: str) -> str:
    """Link trang đang mở (sau khi Facebook chuyển hướng link chia sẻ), bỏ query trừ id của profile.php."""
    parsed = urlparse(current or "")
    if not (parsed.hostname or "").endswith("facebook.com") or not parsed.path.strip("/"):
        return fallback
    path = "/" + parsed.path.strip("/")
    if path == "/profile.php":
        pid = next((p.split("=", 1)[1] for p in parsed.query.split("&") if p.startswith("id=")), "")
        return f"https://www.facebook.com/profile.php?id={pid}" if pid.isdigit() else fallback
    return f"https://www.facebook.com{path}/" if path.startswith("/groups/") else f"https://www.facebook.com{path}"


def _open_link(driver, ctl: FarmControl, url: str) -> bool:
    """Mở 1 link từ danh sách dán. False = tải trang quá thời gian (link chết / mạng), bỏ qua link này."""
    ctl.checkpoint()
    try:
        driver.get(url)
    except TimeoutException:
        return False
    ctl.sleep(random.uniform(3.0, 5.0))
    check_account_state(driver)
    return True


def _script(driver, js: str, *args):
    try:
        return driver.execute_script(js, *args)
    except WebDriverException:
        return None


def _skip_entry(link: dict, result: str, reason: str, name: Optional[str] = None, url: Optional[str] = None) -> dict:
    return {"name": name, "url": url or link["url"], "source_url": link["source"], "result": result, "reason": reason}


def _list_summary(done: int, target: int, unit: str, skipped: int, total: int) -> str:
    ended = ", hết danh sách" if done < target and total else ""
    extra = f", bỏ qua {skipped} link" if skipped else ""
    return f"{done}/{target} {unit}{ended}{extra}"


def run_join_groups_from_links(driver, ctl: FarmControl, links: list, target: int, report: Callable[[str], None],
                               progress: Optional[Callable[[int], None]] = None,
                               delay: tuple = GROUP_DELAY_RANGE, skips: Optional[dict] = None,
                               log: Optional[Callable[[str, str], None]] = None, owners=None) -> dict:
    """
    Tham gia nhóm theo danh sách link (đã xáo riêng cho nick): đi lần lượt tới khi đủ target nhóm hoặc hết danh sách.
    links: [{"key", "url", "source"}]; skips: key -> lý do (nhóm đã vào / vừa rời theo lịch sử tool), không mở trang.
    Trang không có nút "Join group" -> skipped_done; không mở được -> skipped_unavailable; form phức tạp -> skipped_form;
    nhóm đã thuộc nick khác trong dàn (owners giành chủ theo link dán + ID số + tên rút gọn) -> skipped_owned.
    Link bỏ qua không tính vào target. "targets" ghi mọi link đã xét kèm "source_url" và "result".
    """
    if target <= 0:
        return _result("SKIPPED", "Số lượng nhóm = 0")
    log = log or (lambda level, text: None)
    skips = skips or {}
    joined = skipped = 0
    targets = []

    def skip(link, result, reason, name=None, url=None):
        nonlocal skipped
        skipped += 1
        targets.append(_skip_entry(link, result, reason, name, url))
        log("warning", f"bỏ qua {link['source']}: {reason}")

    try:
        for index, link in enumerate(links, start=1):
            if joined >= target:
                break
            report(f"Tham gia nhóm theo danh sách: {joined}/{target} nhóm, đang xét link {index}/{len(links)}")
            if link["key"] in skips:
                skip(link, SKIP_DONE, skips[link["key"]])
                continue
            if not _open_link(driver, ctl, link["url"]):
                skip(link, SKIP_UNAVAILABLE, "trang tải quá lâu, không mở được")
                continue
            _wait_for_any(driver, ctl, FARM_GROUP["page_loaded"] + FARM_COMMON["unavailable_page"])
            page_url = _clean_page_url(driver.current_url, link["url"])
            if _find_visible(driver, FARM_COMMON["unavailable_page"]) or "/groups/" not in page_url:
                skip(link, SKIP_UNAVAILABLE, "nhóm không tồn tại hoặc không xem được", url=page_url)
                ctl.sleep(random.uniform(*LINK_SKIP_PAUSE))
                continue
            name = _script(driver, _PAGE_NAME_JS)
            name = str(name).strip()[:150] if name else None
            # Xét trạng thái trước: trang nhóm đã vào đôi khi vẫn có 1 nút "Join group" lạc (đã gặp 2026-10-22 ở
            # nhóm govap.phongtro.club, có thể là thẻ nhóm trong bài viết), không được bấm
            state = _script(driver, _GROUP_PAGE_STATE_JS)
            buttons = [] if state else _find_visible(driver, FARM_GROUP["page_join_button"])
            keys = owners.keys(link["source"], page_url, *_group_alias_urls(driver, page_url)) if owners else []
            if not buttons:
                reason = {"joined": "nick đã là thành viên nhóm", "pending": "đã gửi yêu cầu tham gia, đang chờ duyệt"}
                if keys and state in reason:
                    owners.record(keys, "member" if state == "joined" else "pending", name, page_url)
                skip(link, SKIP_DONE, reason.get(state, "trang không có nút Tham gia nhóm"), name, page_url)
                ctl.sleep(random.uniform(*LINK_SKIP_PAUSE))
                continue
            other = owners.claim(keys, name, page_url) if keys else None
            if other:
                skip(link, SKIP_OWNED, f"nhóm đã thuộc nick khác trong dàn ({other})", name, page_url)
                ctl.sleep(random.uniform(*LINK_SKIP_PAUSE))
                continue
            if not _human_click(driver, buttons[0]):
                if keys:
                    owners.release(keys)
                skip(link, SKIP_UNAVAILABLE, "không bấm được nút Tham gia nhóm", name, page_url)
                continue
            ctl.sleep(random.uniform(2.0, 3.0))

            if check_account_state(driver) == "blocked":
                _close_dialogs(driver)
                log("error", f"Facebook chặn tham gia nhóm khi xét {link['source']}")
                return {**_result("BLOCKED", f"Bị chặn tham gia nhóm sau {joined} nhóm", joined), "targets": targets}
            outcome = _handle_group_dialog(driver)
            if outcome == "skipped":
                if keys:
                    owners.release(keys)
                skip(link, SKIP_FORM, "nhóm có form câu hỏi phức tạp", name, page_url)
                ctl.sleep(random.uniform(*LINK_SKIP_PAUSE))
                continue

            joined += 1
            ctl.sleep(random.uniform(1.0, 2.0))  # Chờ nút đổi sang "Joined" / "Cancel request"
            status = _script(driver, _GROUP_PAGE_STATE_JS) or ("pending" if outcome == "submitted" else None)
            if keys:
                owners.settle(keys, status or "joined", name, page_url)
            targets.append({"name": name, "url": page_url, "source_url": link["source"],
                            "result": status, "status": status})
            _count(progress, joined)
            state_text = {"joined": "đã tham gia", "pending": "đã gửi yêu cầu, chờ duyệt"}.get(status, "đã bấm tham gia")
            log("success", f"nhóm {joined}/{target} {state_text}: {name or page_url}")
            if joined < target and index < len(links):
                _pause_between(driver, ctl, delay, report, f"Tham gia nhóm {joined}/{target}")
    except Exception as e:
        _keep_targets(e, targets)
        raise

    summary = _list_summary(joined, target, "nhóm", skipped, len(links))
    if joined == 0:
        return {**_result("SKIPPED", f"Không tham gia được nhóm nào theo danh sách ({summary})"), "targets": targets}
    return {**_result("SUCCESS", f"Đã tham gia {summary} theo danh sách", joined), "targets": targets}


def run_add_friends_from_links(driver, ctl: FarmControl, links: list, target: int, report: Callable[[str], None],
                               progress: Optional[Callable[[int], None]] = None,
                               delay: tuple = FRIEND_DELAY_RANGE,
                               log: Optional[Callable[[str, str], None]] = None, owners=None,
                               own_uids: Optional[set] = None) -> dict:
    """
    Kết bạn theo danh sách link trang cá nhân (đã xáo riêng cho nick), tới khi đủ target lời mời hoặc hết danh sách.
    Chỉ bấm nút "Add Friend <Tên chủ trang>"; chủ trang đang chờ chấp nhận / đã là bạn -> skipped_done;
    người đã thuộc nick khác trong dàn (owners giành chủ theo link dán + link trang đang mở) -> skipped_owned;
    người là nick trong dàn (own_uids, so UID số; link username không so được) -> skipped_own_nick.
    Không lọc theo lịch sử tool: người từng từ chối mà trang còn nút Thêm bạn bè thì vẫn gửi lại.
    """
    if target <= 0:
        return _result("SKIPPED", "Số lượng kết bạn = 0")
    log = log or (lambda level, text: None)
    sent = skipped = 0
    targets = []

    def skip(link, result, reason, name=None, url=None):
        nonlocal skipped
        skipped += 1
        targets.append(_skip_entry(link, result, reason, name, url))
        log("warning", f"bỏ qua {link['source']}: {reason}")

    try:
        for index, link in enumerate(links, start=1):
            if sent >= target:
                break
            report(f"Kết bạn theo danh sách: {sent}/{target} lời mời, đang xét link {index}/{len(links)}")
            if own_uids and _profile_uid(link["url"]) in own_uids:
                skip(link, SKIP_OWN_NICK, "là nick trong dàn, không tự kết bạn với nhau")
                continue
            if not _open_link(driver, ctl, link["url"]):
                skip(link, SKIP_UNAVAILABLE, "trang tải quá lâu, không mở được")
                continue
            _wait_for_any(driver, ctl, FARM_FRIEND["profile_loaded"] + FARM_COMMON["unavailable_page"])
            page_url = _clean_page_url(driver.current_url, link["url"])
            if _find_visible(driver, FARM_COMMON["unavailable_page"]):
                skip(link, SKIP_UNAVAILABLE, "trang cá nhân không tồn tại hoặc không xem được", url=page_url)
                ctl.sleep(random.uniform(*LINK_SKIP_PAUSE))
                continue
            if own_uids and _profile_uid(page_url) in own_uids:
                skip(link, SKIP_OWN_NICK, "là nick trong dàn, không tự kết bạn với nhau", url=page_url)
                ctl.sleep(random.uniform(*LINK_SKIP_PAUSE))
                continue
            info = _script(driver, _PROFILE_STATE_JS) or {}
            if info.get("state") in (None, "none", "unknown"):
                # Nút "Search <Tên>'s profile" có thể hiện trước các nút kết bạn: chờ thêm rồi đọc lại 1 lần
                ctl.sleep(random.uniform(2.0, 3.0))
                info = _script(driver, _PROFILE_STATE_JS) or {}
            name = str(info.get("owner") or "").strip()[:150] or None
            keys = owners.keys(link["source"], page_url) if owners else []
            if info.get("state") != "add" or info.get("button") is None:
                if keys and info.get("state") in ("pending", "friends"):
                    owners.record(keys, "sent" if info["state"] == "pending" else "friends", name, page_url)
                reason = _PROFILE_SKIP_REASONS.get(info.get("state"), "không đọc được trang cá nhân")
                skip(link, SKIP_DONE if info.get("state") in _PROFILE_SKIP_REASONS else SKIP_UNAVAILABLE,
                     reason, name, page_url)
                ctl.sleep(random.uniform(*LINK_SKIP_PAUSE))
                continue
            other = owners.claim(keys, name, page_url) if keys else None
            if other:
                skip(link, SKIP_OWNED, f"người này đã thuộc nick khác trong dàn ({other})", name, page_url)
                ctl.sleep(random.uniform(*LINK_SKIP_PAUSE))
                continue
            if not _human_click(driver, info["button"]):
                if keys:
                    owners.release(keys)
                skip(link, SKIP_UNAVAILABLE, "không bấm được nút Thêm bạn bè", name, page_url)
                continue
            ctl.sleep(random.uniform(1.5, 2.5))

            if check_account_state(driver) == "blocked":
                _close_dialogs(driver)
                log("error", f"Facebook chặn kết bạn khi gửi cho {name or link['source']}")
                return {**_result("BLOCKED", f"Bị chặn tính năng kết bạn sau {sent} lời mời", sent), "targets": targets}
            if _find_visible(driver, FARM_FRIEND["know_person_dialog"]):
                if keys:
                    owners.release(keys)
                _close_dialogs(driver)
                log("warning", f"Facebook hỏi 'Bạn có biết người này' khi gửi cho {name or link['source']}, dừng kết bạn")
                status = "SUCCESS" if sent else "SKIPPED"
                return {**_result(status, f"Đã gửi {sent} lời mời theo danh sách, dừng do Facebook hỏi "
                                          f"'Bạn có biết người này'", sent), "targets": targets}

            sent += 1
            if keys:
                owners.settle(keys, "sent", name, page_url)
            targets.append({"name": name, "url": page_url, "source_url": link["source"], "result": "sent"})
            _count(progress, sent)
            log("success", f"đã gửi lời mời {sent}/{target}: {name or page_url}")
            if sent < target and index < len(links):
                _pause_between(driver, ctl, delay, report, f"Kết bạn {sent}/{target}")
    except Exception as e:
        _keep_targets(e, targets)
        raise

    summary = _list_summary(sent, target, "lời mời", skipped, len(links))
    if sent == 0:
        return {**_result("SKIPPED", f"Không gửi được lời mời nào theo danh sách ({summary})"), "targets": targets}
    return {**_result("SUCCESS", f"Đã gửi {summary} theo danh sách", sent), "targets": targets}


# ─────────────────────────── RỜI NHÓM ────────────────────────────

LEAVE_SCROLL_ROUNDS = 6  # Cuộn danh sách nhóm giữa trang để tải đủ thẻ (thẻ tải dần khi cuộn)

# Nhóm đã tham gia trên groups/joins (đã kiểm 2026-10-22): thẻ giữa trang "<Tên> | You last visited | <thời gian>"
# + nút More (1 nhóm vẽ nhiều bản, gom theo link); cột trái "Groups you manage" (admin) rồi "Groups you've joined",
# mỗi dòng "Last active <thời gian>". Tên nhóm có thể trùng nhau nên gom theo link /groups/<id|tên>.
_JOINED_GROUPS_JS = r"""
const RESERVED = ['joins', 'discover', 'feed', 'create', 'search', 'notifications'];
const idOf = (a) => {
  const m = (a.getAttribute('href') || '').match(/\/groups\/([^/?#]+)/);
  return m && !RESERVED.includes(m[1]) ? m[1] : null;
};
const groupIds = (node) => new Set(Array.from(node.querySelectorAll('a[href*="/groups/"]'), idOf).filter(Boolean));
const out = {};
const get = (id, name) => out[id] || (out[id] = {id, name: name || null, visited: null, active: null, admin: false, card: false});
const main = document.querySelector('[role="main"]');
for (const a of (main ? main.querySelectorAll('a[href*="/groups/"]') : [])) {
  const id = idOf(a);
  if (!id || (out[id] && out[id].card)) continue;
  let node = a, card = null;
  for (let i = 0; i < 12 && node; i++, node = node.parentElement) {
    if (groupIds(node).size > 1) break;
    if (node.querySelector('[role="button"][aria-label="More"]')) { card = node; break; }
  }
  if (!card) continue;
  const lines = (card.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const at = lines.findIndex((l) => /^You last visited$/i.test(l));
  const g = get(id, lines[0]);
  g.card = true;
  g.visited = at >= 0 ? (lines[at + 1] || null) : null;
}
for (const nav of document.querySelectorAll('[role="navigation"]')) {
  let section = null;
  for (const el of nav.querySelectorAll('*')) {
    if (!el.children.length) {
      const t = (el.textContent || '').trim();
      if (t === 'Groups you manage') section = 'manage';
      else if (t === "Groups you've joined") section = 'joined';
    }
    if (el.tagName !== 'A' || !section) continue;
    const id = idOf(el);
    if (!id) continue;
    let node = el, text = '';
    for (let i = 0; i < 4 && node; i++, node = node.parentElement) {
      if (groupIds(node).size > 1) break;
      text = node.innerText || '';
      if (/Last active/.test(text)) break;
    }
    const g = get(id, (el.innerText || '').split('\n')[0].trim());
    const m = text.match(/Last active\s+([^\n]+)/);
    if (m) g.active = m[1].trim();
    if (section === 'manage') g.admin = true;
  }
}
return Object.values(out);
"""

# Nút More trên thẻ của 1 nhóm (cùng cách tìm thẻ như trên)
_GROUP_MORE_JS = r"""
const id = arguments[0];
const RESERVED = ['joins', 'discover', 'feed', 'create', 'search', 'notifications'];
const idOf = (a) => { const m = (a.getAttribute('href') || '').match(/\/groups\/([^/?#]+)/); return m && !RESERVED.includes(m[1]) ? m[1] : null; };
const main = document.querySelector('[role="main"]');
for (const a of (main ? main.querySelectorAll('a[href*="/groups/"]') : [])) {
  if (idOf(a) !== id) continue;
  let node = a;
  for (let i = 0; i < 12 && node; i++, node = node.parentElement) {
    if (new Set(Array.from(node.querySelectorAll('a[href*="/groups/"]'), idOf).filter(Boolean)).size > 1) break;
    const more = Array.from(node.querySelectorAll('[role="button"][aria-label="More"]')).find((b) => b.getClientRects().length);
    if (more) return more;
  }
}
return null;
"""

_AGO_UNITS = {"second": 1 / 86400, "minute": 1 / 1440, "hour": 1 / 24, "day": 1, "week": 7, "month": 30, "year": 365}
_AGO_RE = re.compile(r"^(?:about |over |almost )?(a few|a|an|one|\d+) (second|minute|hour|day|week|month|year)s? ago$")


def parse_ago_days(text: Optional[str]) -> Optional[float]:
    """'5 days ago' -> 5; 'about an hour ago' -> 0.04; 'a week ago' -> 7. Không nhận ra dạng chữ thì None."""
    value = re.sub(r"\s+", " ", (text or "").strip().lower())
    if value == "just now":
        return 0.0
    if value == "yesterday":
        return 1.0
    m = _AGO_RE.match(value)
    if not m:
        return None
    count = {"a few": 3, "a": 1, "an": 1, "one": 1}.get(m.group(1))
    return (count if count is not None else int(m.group(1))) * _AGO_UNITS[m.group(2)]


def _load_joined_groups(driver, ctl: FarmControl) -> list:
    """Mở đủ danh sách: bấm See all ở cột trái, cuộn giữa trang tới khi số thẻ không tăng nữa."""
    buttons = _find_visible(driver, FARM_LEAVE["see_all"])
    if buttons and _human_click(driver, buttons[0]):
        ctl.sleep(random.uniform(2.0, 3.0))
    groups, last = [], -1
    for _ in range(LEAVE_SCROLL_ROUNDS):
        groups = _script(driver, _JOINED_GROUPS_JS) or []
        cards = sum(1 for g in groups if g.get("card"))
        if cards == last:
            break
        last = cards
        human_scroll(driver, random.randint(900, 1300), allow_keys=False)
        ctl.sleep(random.uniform(1.5, 2.5))
    return groups


def _leave_group(driver, ctl: FarmControl, group_id: str) -> str:
    """
    Rời 1 nhóm: More trên thẻ -> Leave group -> hộp xác nhận. Trả "left" / "last_admin" (hộp "Delete group by
    leaving?", đã bấm Cancel) / "no_menu" (không thấy nút / mục rời nhóm) / "no_dialog" / "blocked".
    """
    more = _script(driver, _GROUP_MORE_JS, group_id)
    if more is None or not _human_click(driver, more):
        return "no_menu"
    ctl.sleep(random.uniform(1.0, 2.0))
    items = _find_visible(driver, FARM_LEAVE["menu_leave"])
    if not items:
        _close_dialogs(driver)
        return "no_menu"
    _human_click(driver, items[0])
    ctl.sleep(random.uniform(1.5, 2.5))
    dialogs = _find_visible(driver, FARM_LEAVE["dialog"])
    if not dialogs:
        _close_dialogs(driver)
        return "no_dialog"
    dialog = dialogs[-1]
    try:
        text = dialog.text or ""
        if re.search(r"Delete group|Xóa nhóm", text):
            # Nick là admin cuối: rời là xóa luôn nhóm, không bao giờ làm
            cancel = dialog.find_elements(By.XPATH, FARM_LEAVE["dialog_cancel"])
            if not (cancel and _human_click(driver, cancel[0])):
                _close_dialogs(driver)
            return "last_admin"
        confirm = dialog.find_elements(By.XPATH, FARM_LEAVE["dialog_confirm"])
    except WebDriverException:
        _close_dialogs(driver)
        return "no_dialog"
    if not confirm or not _human_click(driver, confirm[-1]):
        _close_dialogs(driver)
        return "no_dialog"
    ctl.sleep(random.uniform(2.0, 3.0))
    if check_account_state(driver) == "blocked":
        _close_dialogs(driver)
        return "blocked"
    return "left"


def run_leave_groups(driver, ctl: FarmControl, target: int, criteria: str, days: float, keep_admin: bool,
                     report: Callable[[str], None], progress: Optional[Callable[[int], None]] = None,
                     delay: tuple = LEAVE_DELAY_RANGE, recent: Optional[dict] = None,
                     log: Optional[Callable[[str, str], None]] = None) -> dict:
    """
    Rời nhóm trên trang groups/joins theo 1 tiêu chí, chọn ngẫu nhiên trong các nhóm đủ tiêu chí:
      not_visited: "You last visited" >= days; inactive: "Last active" >= days;
      recent: nhóm trong `recent` (key "group:<id>" -> số ngày từ lúc tool vào, đã lọc theo days ở routes).
    Nhóm không đọc được thời gian thì không rời. keep_admin: không rời nhóm trong "Groups you manage".
    Ít nhóm đủ tiêu chí hơn target thì chỉ rời số đủ tiêu chí. "targets": nhóm đã rời / bỏ qua kèm lý do.
    """
    if target <= 0:
        return _result("SKIPPED", "Số nhóm rời = 0")
    log = log or (lambda level, text: None)
    _open(driver, ctl, FB_GROUPS_JOINS)
    _wait_for_any(driver, ctl, FARM_LEAVE["more_buttons"])
    groups = _load_joined_groups(driver, ctl)

    eligible, unreadable, admins, no_card = [], 0, 0, 0
    for g in groups:
        if criteria == "recent":
            age = (recent or {}).get(f"group:{str(g['id']).lower()}")
            if age is None:
                continue
            reason = f"tool vào nhóm {age:.1f} ngày trước"
        else:
            text = g.get("visited") if criteria == "not_visited" else g.get("active")
            value = parse_ago_days(text)
            if value is None:
                unreadable += 1
                continue
            if value < days:
                continue
            reason = f"{'You last visited' if criteria == 'not_visited' else 'Last active'} {text}"
        if keep_admin and g.get("admin"):
            admins += 1
            continue
        if not g.get("card"):
            no_card += 1
            continue
        eligible.append((g, reason))
    random.shuffle(eligible)
    notes = [f"{n} nhóm {what}" for n, what in ((unreadable, "không đọc được thời gian, không rời"),
                                                (admins, "là Admin/Mod, giữ lại"),
                                                (no_card, "không thấy thẻ để rời")) if n]
    if notes:
        log("info", "; ".join(notes))
    if not eligible:
        return _result("SKIPPED", f"Không có nhóm nào đủ tiêu chí trong {len(groups)} nhóm đã tham gia"
                                  + (f" ({'; '.join(notes)})" if notes else ""))

    left = 0
    targets = []
    try:
        for g, reason in eligible:
            if left >= target:
                break
            ctl.checkpoint()
            report(f"Rời nhóm: {left}/{target}, đang rời {g.get('name') or g['id']}")
            outcome = _leave_group(driver, ctl, g["id"])
            entry = {"name": g.get("name"), "url": f"https://www.facebook.com/groups/{g['id']}/", "reason": reason}
            if outcome == "blocked":
                log("error", f"Facebook chặn khi rời nhóm {g.get('name') or g['id']}")
                return {**_result("BLOCKED", f"Bị chặn khi rời nhóm sau {left} nhóm", left), "targets": targets}
            if outcome == "left":
                left += 1
                targets.append({**entry, "result": "left", "status": "left"})
                _count(progress, left)
                log("success", f"đã rời {left}/{target}: {g.get('name') or g['id']} ({reason})")
                if left < target:
                    _pause_between(driver, ctl, delay, report, f"Rời nhóm {left}/{target}")
            elif outcome == "last_admin":
                targets.append({**entry, "result": "skipped_last_admin",
                                "reason": "nick là admin cuối, rời sẽ xóa nhóm (đã bấm Hủy)"})
                log("warning", f"bỏ qua {g.get('name') or g['id']}: nick là admin cuối, rời sẽ xóa nhóm")
            else:
                targets.append({**entry, "result": "skipped_unavailable", "reason": "không mở được menu / hộp rời nhóm"})
                log("warning", f"bỏ qua {g.get('name') or g['id']}: không mở được menu / hộp rời nhóm")
    except Exception as e:
        _keep_targets(e, targets)
        raise

    criteria_text = {"not_visited": f"không vào nhóm >= {days} ngày", "inactive": f"nhóm không hoạt động >= {days} ngày",
                     "recent": f"vào trong {days} ngày qua"}.get(criteria, criteria)
    if left == 0:
        return {**_result("SKIPPED", f"Không rời được nhóm nào ({criteria_text})"), "targets": targets}
    tail = "" if left >= target else f", chỉ có {len(eligible)} nhóm đủ tiêu chí"
    return {**_result("SUCCESS", f"Đã rời {left}/{target} nhóm ({criteria_text}){tail}", left), "targets": targets}


def run_check_notifications(driver, ctl: FarmControl, report: Callable[[str], None]) -> dict:
    """Mở chuông thông báo 3-7s, 20% xác suất click 1 thông báo chưa đọc, rồi đóng."""
    if "facebook.com" not in (driver.current_url or ""):
        _open(driver, ctl, FB_HOME)
    else:
        check_account_state(driver)
    bells = _find_visible(driver, FARM_NOTIF["bell_button"])
    if not bells:
        return _result("SKIPPED", "Không tìm thấy nút thông báo")
    _human_click(driver, bells[0])
    report("Check thông báo: đang xem danh sách thông báo")
    ctl.sleep(random.uniform(*NOTIF_OPEN_RANGE))
    check_account_state(driver)

    if random.random() < NOTIF_CLICK_RATE:
        unread = _find_visible(driver, FARM_NOTIF["unread_items"])
        if unread:
            _human_click(driver, random.choice(unread[:5]))
            ctl.sleep(random.uniform(4.0, 8.0))
            check_account_state(driver)
            _leave_opened_notification(driver, ctl)
            return _result("SUCCESS", "Đã xem thông báo và mở 1 thông báo chưa đọc", 1)

    _close_notif_panel(driver)
    return _result("SUCCESS", "Đã xem danh sách thông báo")


def _move_mouse_off(driver):
    """Đưa chuột vào vùng nội dung để tắt dòng nhắc 'Thông báo' còn hiện dưới nút chuông."""
    if _park_mouse(driver):
        return
    targets = _find_visible(driver, ['//div[@role="main"]'])
    try:
        hover_element(driver, targets[0] if targets else driver.find_element(By.TAG_NAME, "body"))
    except WebDriverException:
        pass


def _close_notif_panel(driver):
    """Đóng bảng thông báo và kiểm tra lại: ESC tối đa 2 lần, vẫn mở thì bấm lại nút chuông (bấm lần 2 là đóng)."""
    for _ in range(2):
        if not _find_visible(driver, FARM_NOTIF["panel"]):
            break
        try:
            ActionChains(driver).send_keys(Keys.ESCAPE).perform()
        except WebDriverException:
            pass
        time.sleep(random.uniform(0.8, 1.5))
    if _find_visible(driver, FARM_NOTIF["panel"]):
        bells = _find_visible(driver, FARM_NOTIF["bell_button"][:1])
        if bells:
            _human_click(driver, bells[0])
            time.sleep(random.uniform(0.8, 1.5))
    if _find_visible(driver, FARM_NOTIF["panel"]):
        logger.warning("Check thông báo: không đóng được bảng thông báo")
    # ESC đóng bảng xong Facebook trả focus về nút chuông
    _release_focus(driver)
    _move_mouse_off(driver)


def _leave_opened_notification(driver, ctl: FarmControl):
    """
    Thông báo vừa mở có thể là bài viết dạng cửa sổ nổi (vd bình luận) nằm đè lên trang và không tự tắt:
    đóng cửa sổ đó; nếu đã chuyển sang trang khác (nhóm, trang cá nhân) thì quay về trang chủ.
    """
    for _ in range(2):
        if not _find_visible(driver, ['//div[@role="dialog"]']):
            break
        _close_dialogs(driver)
        time.sleep(random.uniform(1.0, 2.0))
    if not _same_page(driver.current_url, FB_HOME):
        _open(driver, ctl, FB_HOME)
    _release_focus(driver)
    _move_mouse_off(driver)
