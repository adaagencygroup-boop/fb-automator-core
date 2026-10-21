"""
farming_flow.py
Kịch bản tương tác nuôi tài khoản Facebook (Module 03 – Tab 1 Tương tác tài khoản):
lướt Newsfeed, xem Watch, kết bạn gợi ý, tham gia nhóm, check thông báo.

Mỗi kịch bản nhận driver đang đăng nhập + FarmControl (tạm dừng / dừng) và trả về
dict {"status": SUCCESS|BLOCKED|SKIPPED|FAILED, "quantity": int, "details": str}.
Lỗi mức tài khoản (checkpoint / mất phiên) ném FarmAccountDead để pipeline chuyển DIE.
"""
import logging
import random
import threading
import time
from typing import Callable, Optional
from urllib.parse import quote_plus, urlparse

from selenium.common.exceptions import WebDriverException
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.actions.wheel_input import ScrollOrigin
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys

from modules.module_03_acc_farm.browser.locators import LOGIN
from modules.module_03_acc_farm.farming.locators import FARM_COMMON, FARM_WATCH, FARM_FRIEND, FARM_GROUP, FARM_NOTIF
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
        raise FarmAccountDead(f"Phiên đăng nhập không còn hợp lệ ({url})")
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
    try:
        ActionChains(driver).scroll_to_element(element).perform()
    except WebDriverException:
        pass
    time.sleep(random.uniform(0.3, 0.8))
    try:
        ActionChains(driver).move_to_element(element).pause(random.uniform(0.2, 0.6)).click().perform()
        return True
    except WebDriverException:
        try:
            driver.execute_script("arguments[0].click();", element)
            return True
        except WebDriverException:
            return False


def _same_page(current: str, target: str) -> bool:
    return (current or "").split("?")[0].split("#")[0].rstrip("/") == target.split("?")[0].rstrip("/")


def _open(driver, ctl: FarmControl, url: str, reuse: bool = False):
    """reuse=True: đang đứng đúng trang thì không tải lại (tải lại trang chủ liên tục trông không tự nhiên)."""
    ctl.checkpoint()
    if not (reuse and _same_page(driver.current_url, url)):
        driver.get(url)
        ctl.sleep(random.uniform(3.0, 5.0))
    check_account_state(driver)


# ─────────────────────────── KỊCH BẢN ────────────────────────────

def run_newsfeed(driver, ctl: FarmControl, total_seconds: float, delay_min: float, delay_max: float,
                 report: Callable[[str], None]) -> dict:
    """Lướt Newsfeed tự nhiên: cuộn mượt 500-800px, 10-15% cuộn ngược, dừng đọc theo delay."""
    if total_seconds <= 0:
        return _result("SKIPPED", "Thời gian lướt = 0")
    _open(driver, ctl, FB_HOME, reuse=True)
    timer = ActiveTimer(ctl, total_seconds)
    scrolls = 0
    scroll_up_rate = random.uniform(0.10, 0.15)
    try:
        while timer.remaining() > 0:
            ctl.checkpoint()
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
    except Exception as e:
        # Dừng / tài khoản chết / trình duyệt treo giữa chừng: giữ lại phần đã lướt để lịch sử không ghi 0 giây
        e.partial = {"seconds": int(timer.elapsed()), "scrolls": scrolls}
        raise
    check_account_state(driver)
    return {**_result("SUCCESS", f"Đã lướt {timer.elapsed() / 60:.1f} phút, cuộn {scrolls} lần"),
            "seconds": int(timer.elapsed()), "scrolls": scrolls}


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


def _in_reel_viewer(driver) -> bool:
    """/watch có thể bị Facebook chuyển sang trình xem Reels (/reel/<id>): trang không cuộn, chuyển video bằng phím."""
    return "/reel/" in urlparse(driver.current_url or "").path


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
              report: Callable[[str], None]) -> dict:
    """Đếm mỗi video Watch một lần, sau khi xác nhận video mới đã phát."""
    if total_seconds <= 0:
        return _result("SKIPPED", "Thời gian xem = 0")
    _open(driver, ctl, FB_WATCH)
    timer = ActiveTimer(ctl, total_seconds)
    watched = 0
    misses = 0
    stuck = 0
    reloads = 0
    seen_videos = set()

    def progress_text(note: str) -> str:
        return (f"Xem Watch: {note}, đã xem {watched} video "
                f"({timer.elapsed() / 60:.1f}/{total_seconds / 60:.1f} phút)")

    try:
        while timer.remaining() > 0:
            ctl.checkpoint()
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
            state = driver.execute_script(_VIDEO_STATE_JS, video)
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
                ActionChains(driver).move_to_element(video).pause(random.uniform(0.5, 1.2)).perform()
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
                current = driver.execute_script(_VIDEO_STATE_JS, video)
                if not current or not keys.intersection(current.get("keys") or []):
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
            check_account_state(driver)
            _advance_video(driver, video, 0)
            ctl.sleep(min(random.uniform(1.0, 2.5), max(timer.remaining(), 0)))
    except Exception as e:
        # Dừng / tài khoản chết / trình duyệt treo giữa chừng: giữ lại phần đã xem để lịch sử không ghi 0 giây / 0 video
        e.partial = {"seconds": int(timer.elapsed()), "quantity": watched}
        raise

    if watched == 0:
        return {**_result("SKIPPED", "Không xác nhận được video mới nào đã phát trên Watch"),
                "seconds": int(timer.elapsed())}
    return {**_result("SUCCESS", f"Đã xem {watched} video khác nhau trong {timer.elapsed() / 60:.1f} phút", watched),
            "seconds": int(timer.elapsed())}


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


def run_add_friends(driver, ctl: FarmControl, target: int, report: Callable[[str], None],
                    progress: Optional[Callable[[int], None]] = None,
                    delay: tuple = FRIEND_DELAY_RANGE) -> dict:
    """Kết bạn theo gợi ý: chọn ngẫu nhiên, nghỉ theo delay, bắt popup 'Bạn có biết…' và dialog chặn tính năng."""
    if target <= 0:
        return _result("SKIPPED", "Số lượng kết bạn = 0")
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
        if not _human_click(driver, button):
            continue
        ctl.sleep(random.uniform(1.5, 2.5))

        if check_account_state(driver) == "blocked":
            _close_dialogs(driver)
            return _result("BLOCKED", f"Bị chặn tính năng kết bạn sau {sent} lời mời", sent)
        if _find_visible(driver, FARM_FRIEND["know_person_dialog"]):
            _close_dialogs(driver)
            status = "SUCCESS" if sent else "SKIPPED"
            return _result(status, f"Đã gửi {sent} lời mời, dừng do Facebook hỏi 'Bạn có biết người này'", sent)

        sent += 1
        _count(progress, sent)
        report(f"Kết bạn: đã gửi {sent}/{target} lời mời")
        if sent < target:
            _pause_between(driver, ctl, delay, report, f"Kết bạn {sent}/{target}")

    if sent == 0:
        result = _result("SKIPPED", "Không có gợi ý kết bạn, tự động bỏ qua")
        result["no_suggestions"] = True
        return result
    return _result("SUCCESS", f"Đã gửi {sent}/{target} lời mời kết bạn", sent)


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
                                delay: tuple = FRIEND_DELAY_RANGE) -> dict:
    """
    Kết bạn dự phòng khi trang gợi ý trống: gửi lời mời cho thành viên các nhóm nick đã tham gia.
    Chọn ngẫu nhiên trong các người đang hiển thị, nghỉ theo delay, bắt popup / dialog chặn như kết bạn gợi ý.
    """
    if target <= 0:
        return _result("SKIPPED", "Số lượng kết bạn = 0")
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
            if not _human_click(driver, button):
                continue
            ctl.sleep(random.uniform(1.5, 2.5))

            if check_account_state(driver) == "blocked":
                _close_dialogs(driver)
                return _result("BLOCKED", f"Bị chặn tính năng kết bạn sau {sent} lời mời (thành viên nhóm)", sent)
            if _find_visible(driver, FARM_FRIEND["know_person_dialog"]):
                _close_dialogs(driver)
                status = "SUCCESS" if sent else "SKIPPED"
                return _result(status, f"Đã gửi {sent} lời mời cho thành viên nhóm, dừng do Facebook hỏi 'Bạn có biết người này'", sent)

            sent += 1
            group_sent += 1
            _count(progress, sent)
            report(f"Kết bạn thành viên nhóm: đã gửi {sent}/{target} lời mời")
            if sent < target:
                _pause_between(driver, ctl, delay, report, f"Kết bạn thành viên nhóm {sent}/{target}")
        if group_sent:
            used_groups.append(gid)

    if sent == 0:
        return _result("SKIPPED", "Không gửi được lời mời nào cho thành viên các nhóm đã tham gia")
    return _result("SUCCESS", f"Đã gửi {sent}/{target} lời mời cho thành viên nhóm ({', '.join(used_groups)})", sent)


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


def run_join_groups(driver, ctl: FarmControl, target: int, keywords: Optional[list], report: Callable[[str], None],
                    progress: Optional[Callable[[int], None]] = None,
                    delay: tuple = GROUP_DELAY_RANGE) -> dict:
    """
    Tham gia nhóm theo danh sách từ khóa (đã xáo riêng cho từng nick): từ khóa nào hết nhóm vào được thì chuyển
    sang từ khóa kế tiếp, đến khi đủ số lượng hoặc hết danh sách. Danh sách rỗng thì vào nhóm đề xuất.
    Chọn ngẫu nhiên, nghỉ theo delay, bỏ qua form phức tạp.
    Kết quả có thêm "keywords": các từ khóa đã mở trang tìm kiếm, theo thứ tự đã dùng.
    """
    if target <= 0:
        return _result("SKIPPED", "Số lượng nhóm = 0")
    keywords = [k.strip() for k in (keywords or []) if k and k.strip()]
    sources = [(k, FB_GROUPS_SEARCH.format(q=quote_plus(k))) for k in keywords] or [(None, FB_GROUPS_DISCOVER)]
    joined = 0
    skipped_forms = 0
    used = []
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
            empty_rounds = 0
            while joined < target:
                ctl.checkpoint()
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
                if not _human_click(driver, button):
                    continue
                ctl.sleep(random.uniform(2.0, 3.0))

                if check_account_state(driver) == "blocked":
                    _close_dialogs(driver)
                    return {**_result("BLOCKED", f"Bị chặn tham gia nhóm sau {joined} nhóm", joined), "keywords": used}

                outcome = _handle_group_dialog(driver)
                if outcome == "skipped":
                    skipped_forms += 1
                    report("Tham gia nhóm: bỏ qua 1 nhóm có form câu hỏi phức tạp")
                    ctl.sleep(random.uniform(2.0, 4.0))
                    continue

                joined += 1
                _count(progress, joined)
                report(f"Tham gia nhóm: {joined}/{target} nhóm")
                # Một số nhóm công khai tự chuyển sang trang nhóm sau khi tham gia: quay lại danh sách
                if (driver.current_url or "").split("?")[0].rstrip("/") != list_url.split("?")[0].rstrip("/"):
                    _open(driver, ctl, list_url)
                    clicked_ids.clear()
                if joined < target:
                    _pause_between(driver, ctl, delay, report, f"Tham gia nhóm {joined}/{target}")
    except Exception as e:
        # Dừng / lỗi giữa chừng: giữ lại các từ khóa đã dùng để lịch sử vẫn ghi được
        e.partial = {"keywords": list(used)}
        raise

    extra = f", bỏ qua {skipped_forms} nhóm có form phức tạp" if skipped_forms else ""
    source = "từ khóa " + ", ".join(f"'{k}'" for k in used) if used else "nhóm đề xuất"
    if joined == 0:
        return {**_result("SKIPPED", f"Không tham gia được nhóm nào ({source}){extra}"), "keywords": used}
    return {**_result("SUCCESS", f"Đã tham gia {joined}/{target} nhóm ({source}){extra}", joined), "keywords": used}


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
    targets = _find_visible(driver, ['//div[@role="main"]'])
    try:
        ActionChains(driver).move_to_element(targets[0] if targets else driver.find_element(By.TAG_NAME, "body")).perform()
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
