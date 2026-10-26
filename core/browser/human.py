"""
human.py
Gõ phím / nghỉ ngẫu nhiên theo nhịp riêng của từng nick (lấy từ BrowserConfig của driver), và chuột giống người.
"""
import math
import random
import time
from typing import List, Optional, Tuple

from selenium.common.exceptions import WebDriverException
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.actions.action_builder import ActionBuilder

from core.browser.fingerprint import BrowserConfig, MouseProfile


def human_type(element, text: str, min_delay: float = 0.03, max_delay: float = 0.09,
               config: Optional[BrowserConfig] = None):
    """Gõ từng ký tự với độ trễ ngẫu nhiên; có config thì dùng khoảng trễ của nick."""
    if config:
        min_delay, max_delay = config.type_delay
    for char in text:
        element.send_keys(char)
        time.sleep(random.uniform(min_delay, max_delay))


def human_sleep(min_s: float = 2.0, max_s: float = 4.5, config: Optional[BrowserConfig] = None):
    """Nghỉ ngẫu nhiên trong [min_s, max_s] giây, nhân hệ số nhịp của nick nếu có config."""
    factor = config.sleep_factor if config else 1.0
    time.sleep(random.uniform(min_s * factor, max_s * factor))


# ─────────────────────────── CHUỘT ────────────────────────────
# Selenium move_to_element / element.click(): trang chỉ nhận đúng 1 mousemove (chuột nhảy tức thời, kể cả khi đặt
# duration) rồi bấm đúng tâm; bấm bằng JS thì không có chuột nào và isTrusted = false (đã đo trên Chrome 2026-10-23).
# Facebook có thu chuyển động chuột để phân biệt người / bot. Ở đây chuột đi theo đường cong, mỗi ~16ms 1 mousemove
# (nhịp nhanh nhất ChromeDriver đưa được; chuột thật 60-125 sự kiện/giây), chậm ở 2 đầu nhanh ở giữa, có rung tay;
# lần rê dài đôi khi đi quá đích hoặc dừng hơi hụt rồi chỉnh thêm 1-2 nhịp nhỏ; điểm bấm dạng chuông quanh vùng ưa
# thích; dừng trước khi bấm, giữ nút chuột 1 chút. Mọi thông số theo thói quen tay riêng của nick (MouseProfile trong
# BrowserConfig, cố định theo seed) để cả dàn không chung 1 khuôn. Tọa độ theo khung nhìn (getBoundingClientRect):
# element.rect là tọa độ theo trang, lệch khi trang đã cuộn.

MOUSE_STEP_MS = 16                 # khoảng cách thời gian giữa 2 mousemove (độ trễ mỗi lệnh của ChromeDriver, đã đo)
MOUSE_STEP_PAUSE = (0.0, 0.006)    # nghỉ thêm sau mỗi bước (giây); phần còn lại là độ trễ của ChromeDriver
MOUSE_MS = (160, 1300)             # thời gian 1 lần rê (ms) trước khi nhân tốc độ của nick
MOUSE_BEND_MAX_PX = 160            # độ cong tuyệt đối tối đa
OVERSHOOT_MIN_DISTANCE = 120       # chỉ lần rê dài mới đi quá đích
CORRECTION_MIN_DISTANCE = 80       # chỉ lần rê dài mới dừng hụt rồi chỉnh
CORRECTION_MS = (80, 200)          # thời gian 1 nhịp chỉnh nhỏ
DEFAULT_MOUSE = MouseProfile()

_VIEWPORT_JS = "return [innerWidth, innerHeight];"
_RECT_JS = """
const r = arguments[0].getBoundingClientRect();
return [r.left, r.top, r.width, r.height, innerWidth, innerHeight];
"""
_HIT_JS = """
const e = document.elementFromPoint(arguments[1], arguments[2]);
return !!e && (e === arguments[0] || arguments[0].contains(e));
"""


def _ease(t: float) -> float:
    """Minimum-jerk: vận tốc 0 ở 2 đầu, lớn nhất ở giữa quãng (giống tay người)."""
    return t * t * t * (10 - 15 * t + 6 * t * t)


def mouse_profile(driver) -> MouseProfile:
    """Thói quen tay của nick đang mở (driver.browser_config.mouse); không có thì bộ mặc định."""
    profile = getattr(getattr(driver, "browser_config", None), "mouse", None)
    return profile if isinstance(profile, MouseProfile) else DEFAULT_MOUSE


def move_duration_ms(distance: float, profile: MouseProfile = DEFAULT_MOUSE, rng: random.Random = random) -> float:
    """Thời gian rê tăng theo log quãng đường (kiểu định luật Fitts), nhân tốc độ của nick."""
    # ~280ms cho 30px, ~440ms cho 100px, ~760ms cho 700px (trước khi nhân tốc độ 0.8-1.3 của nick)
    base = min(MOUSE_MS[1], max(MOUSE_MS[0], 80 + 120 * math.log2(1 + distance / 14)))
    return base * profile.speed * rng.uniform(0.88, 1.15)


def mouse_path(start: Tuple[float, float], end: Tuple[float, float], curve: float = 1.0,
               rng: random.Random = random, profile: MouseProfile = DEFAULT_MOUSE,
               duration_ms: Optional[float] = None) -> List[Tuple[int, int, float]]:
    """
    Các điểm (x, y, nghỉ thêm giây sau điểm đó) từ start tới end trên đường Bézier bậc 2 lệch ngẫu nhiên sang 1 bên,
    mỗi điểm cách nhau ~MOUSE_STEP_MS (số điểm tăng theo thời gian rê). Điểm cuối đúng end.
    curve: 0 = gần thẳng, 1 = cong theo thói quen của nick.
    """
    (x0, y0), (x1, y1) = start, end
    distance = math.hypot(x1 - x0, y1 - y0)
    if distance < 2:
        return [(int(round(x1)), int(round(y1)), rng.uniform(0.01, 0.03))]
    total_ms = duration_ms if duration_ms is not None else move_duration_ms(distance, profile, rng)
    steps = max(3, int(round(total_ms / MOUSE_STEP_MS * rng.uniform(0.9, 1.1))))
    normal_x, normal_y = -(y1 - y0) / distance, (x1 - x0) / distance
    tangent_x, tangent_y = (x1 - x0) / distance, (y1 - y0) / distance
    bend_ratio = max(profile.bend, 0.05)
    bend = rng.uniform(-bend_ratio, bend_ratio) * min(distance, MOUSE_BEND_MAX_PX / bend_ratio) * curve
    at = rng.uniform(0.3, 0.7)
    cx, cy = x0 + (x1 - x0) * at + normal_x * bend, y0 + (y1 - y0) * at + normal_y * bend
    noise = 0.0
    points = []
    for i in range(1, steps + 1):
        e = _ease((i / steps) ** profile.peak)
        x = (1 - e) ** 2 * x0 + 2 * (1 - e) * e * cx + e * e * x1
        y = (1 - e) ** 2 * y0 + 2 * (1 - e) * e * cy + e * e * y1
        if i < steps:
            # Rung tay: nhiễu trơn (không nhảy loạn từng điểm), chủ yếu vuông góc với hướng đi; nhỏ dần về cuối
            noise = noise * 0.65 + rng.gauss(0, profile.jitter)
            along = rng.gauss(0, profile.jitter * 0.3)
            fade = 1 - e * 0.6
            x += (normal_x * noise + tangent_x * along) * fade
            y += (normal_y * noise + tangent_y * along) * fade
        points.append((int(round(x)), int(round(y)), rng.uniform(*MOUSE_STEP_PAUSE)))
    points[-1] = (int(round(x1)), int(round(y1)), points[-1][2])
    return points


def _clamp_point(x: float, y: float, width: float, height: float) -> Tuple[int, int]:
    return int(min(max(x, 1), width - 2)), int(min(max(y, 1), height - 2))


def mouse_position(driver) -> Optional[Tuple[int, int]]:
    """Vị trí chuột lần cuối do các hàm ở đây đưa tới (tọa độ khung nhìn); None = chưa rê lần nào."""
    return getattr(driver, "_human_mouse", None)


def _legs(start, end, curve, overshoot, profile, rng, width, height) -> List[tuple]:
    """
    Các chặng của 1 lần rê: (đích chặng, độ cong, thời gian ms hoặc None = tự tính theo quãng đường).
    overshoot=True: lần rê dài đôi khi đi quá đích rồi quay lại, hoặc dừng hơi hụt rồi chỉnh thêm 1-2 nhịp nhỏ
    (theo tỉ lệ của nick). overshoot=False: 1 chặng tới đích (vd đi trên thanh cảm xúc, không được lệch ra).
    """
    distance = math.hypot(end[0] - start[0], end[1] - start[1])
    if not overshoot or distance < CORRECTION_MIN_DISTANCE:
        return [(end, curve, None)]
    ux, uy = (end[0] - start[0]) / distance, (end[1] - start[1]) / distance
    roll = rng.random()
    if distance >= OVERSHOOT_MIN_DISTANCE and roll < profile.overshoot:
        over = rng.uniform(4, 12)
        past = _clamp_point(end[0] + ux * over + rng.gauss(0, 2), end[1] + uy * over + rng.gauss(0, 2), width, height)
        return [(past, curve, None), (end, 0.3, rng.uniform(*CORRECTION_MS))]
    if roll < profile.overshoot + profile.submove:
        short = distance * rng.uniform(0.03, 0.08)
        near = _clamp_point(end[0] - ux * short + rng.gauss(0, 3), end[1] - uy * short + rng.gauss(0, 3), width, height)
        legs = [(near, curve, None)]
        if rng.random() < 0.4:
            mid = _clamp_point(end[0] + rng.gauss(0, 2), end[1] + rng.gauss(0, 2), width, height)
            legs.append((mid, 0.2, rng.uniform(*CORRECTION_MS)))
        legs.append((end, 0.2, rng.uniform(*CORRECTION_MS)))
        return legs
    return [(end, curve, None)]


def mouse_to(driver, x: float, y: float, curve: float = 1.0, overshoot: bool = True,
             rng: random.Random = random) -> Tuple[int, int]:
    """
    Rê chuột tới (x, y) theo khung nhìn bằng nhiều bước nhỏ, theo thói quen tay của nick. Lần đầu (chưa biết chuột ở
    đâu) chuột xuất hiện ở 1 điểm ngẫu nhiên giữa màn hình rồi mới rê. Điểm ngoài khung nhìn được kéo vào trong.
    overshoot=False: không đi quá đà / không chỉnh nhịp (đường đi phải gọn, vd trên thanh cảm xúc).
    """
    size = driver.execute_script(_VIEWPORT_JS)
    if not isinstance(size, (list, tuple)) or len(size) != 2:
        raise WebDriverException("Không đọc được kích thước khung nhìn")
    width, height = size
    profile = mouse_profile(driver)
    end = _clamp_point(x, y, width, height)
    start = mouse_position(driver)
    builder = ActionBuilder(driver, duration=0)
    if start is None:
        start = _clamp_point(width * rng.uniform(0.3, 0.7), height * rng.uniform(0.3, 0.7), width, height)
        builder.pointer_action.move_to_location(*start)
    current = start
    for target, bend, leg_ms in _legs(start, end, curve, overshoot, profile, rng, width, height):
        for px, py, pause in mouse_path(current, target, bend, rng, profile, leg_ms):
            px, py = _clamp_point(px, py, width, height)
            builder.pointer_action.move_to_location(px, py)
            if pause > 0.001:
                builder.pointer_action.pause(pause)
        current = target
    builder.perform()
    driver._human_mouse = end
    return end


def press_mouse(driver, rng: random.Random = random):
    """Nhấn rồi nhả chuột trái tại chỗ, giữ theo thói quen của nick."""
    builder = ActionBuilder(driver, duration=0)
    builder.pointer_action.pointer_down()
    builder.pointer_action.pause(rng.uniform(*mouse_profile(driver).hold))
    builder.pointer_action.pointer_up()
    builder.perform()


def element_box(driver, element) -> Optional[Tuple[float, float, float, float]]:
    """Phần thấy được của phần tử trong khung nhìn: (trái, trên, phải, dưới); None = nằm ngoài / không có kích thước."""
    data = driver.execute_script(_RECT_JS, element)
    if not isinstance(data, (list, tuple)) or len(data) != 6:
        return None
    left, top, width, height, view_w, view_h = data
    box = (max(left, 0), max(top, 0), min(left + width, view_w), min(top + height, view_h))
    return box if box[2] - box[0] >= 2 and box[3] - box[1] >= 2 else None


def point_hits(driver, element, x: float, y: float) -> bool:
    """Điểm (x, y) đang trúng phần tử thật (không bị phần tử khác che)."""
    try:
        return bool(driver.execute_script(_HIT_JS, element, x, y))
    except WebDriverException:
        return False


def _aim_ratio(center: float, spread: float, low: float, high: float, rng) -> float:
    return min(high, max(low, rng.gauss(center, spread)))


def click_point(driver, element, rng: random.Random = random, need_hit: bool = True) -> Optional[Tuple[int, int]]:
    """
    Điểm bấm dạng chuông quanh vùng ưa thích của nick trên phần tử (rìa thưa dần, không phải hình chữ nhật đều, không
    bao giờ đúng tâm mọi lần) mà không bị che; None = không có.
    need_hit=False: không kiểm bị che (chỉ rê qua, vd video luôn có lớp phủ nút / chữ đè lên).
    """
    box = element_box(driver, element)
    if box is None:
        return None
    left, top, right, bottom = box
    profile = mouse_profile(driver)
    for _ in range(8):
        x = left + (right - left) * _aim_ratio(profile.aim[0], profile.spread[0], 0.12, 0.88, rng)
        y = top + (bottom - top) * _aim_ratio(profile.aim[1], profile.spread[1], 0.18, 0.82, rng)
        if not need_hit or point_hits(driver, element, x, y):
            return int(x), int(y)
    x, y = (left + right) / 2, (top + bottom) / 2
    return (int(x), int(y)) if point_hits(driver, element, x, y) else None


def _point_or_scroll(driver, element, rng) -> Optional[Tuple[int, int]]:
    point = click_point(driver, element, rng)
    if point is None:
        # Ngoài màn hình / bị che: cuộn bằng bánh xe tới phần tử rồi thử lại
        ActionChains(driver).scroll_to_element(element).perform()
        time.sleep(rng.uniform(0.3, 0.8))
        point = click_point(driver, element, rng)
    return point


def hover_element(driver, element, rng: random.Random = random, need_hit: bool = True) -> bool:
    """
    Rê chuột tới 1 điểm trên phần tử (không bấm).
    need_hit=False: rê qua phần đang thấy của phần tử, kể cả lớp phủ đè lên, và KHÔNG cuộn trang (trình xem Reels:
    cuộn bánh xe có thể sang video khác); phần tử không nằm trong khung nhìn thì trả False.
    """
    try:
        point = click_point(driver, element, rng, need_hit=False) if not need_hit else \
            _point_or_scroll(driver, element, rng)
        if point is None:
            return False
        mouse_to(driver, *point, rng=rng)
        return True
    except WebDriverException:
        return False


def human_click(driver, element, hover: Optional[Tuple[float, float]] = None, rng: random.Random = random) -> bool:
    """
    Bấm như người: rê chuột tới điểm bấm trên phần tử, dừng 1 chút (theo thói quen của nick, hoặc hover nếu truyền),
    kiểm lại điểm vẫn trúng phần tử (trang có thể xô lệch khi tải thêm) rồi nhấn / nhả chuột. Không bấm bằng JS (sự
    kiện giả, không có chuột): bấm thật lỗi thì thử lại 1 lần, vẫn lỗi thì trả False để luồng bỏ qua phần tử.
    """
    for _ in range(2):
        try:
            point = _point_or_scroll(driver, element, rng)
            if point is None:
                time.sleep(rng.uniform(0.3, 0.6))
                continue
            mouse_to(driver, *point, rng=rng)
            time.sleep(rng.uniform(*(hover or mouse_profile(driver).hover)))
            if not point_hits(driver, element, *point):
                point = click_point(driver, element, rng)
                if point is None:
                    continue
                mouse_to(driver, *point, curve=0.4, overshoot=False, rng=rng)
                time.sleep(rng.uniform(0.1, 0.3))
            press_mouse(driver, rng)
            return True
        except WebDriverException:
            time.sleep(rng.uniform(0.3, 0.6))
    return False
