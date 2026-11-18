import math
import random
import time
from typing import List, Optional, Tuple
from selenium.common.exceptions import WebDriverException
from selenium.webdriver.common.action_chains import ActionChains
from core.browser.fingerprint import BrowserConfig, MouseProfile
def human_type(element, text: str, min_delay: float = 0.03, max_delay: float = 0.09,
         config: Optional[BrowserConfig] = None):
  if config:
    min_delay, max_delay = config.type_delay
  for char in text:
    element.send_keys(char)
    time.sleep(random.uniform(min_delay, max_delay))
def human_sleep(min_s: float = 2.0, max_s: float = 4.5, config: Optional[BrowserConfig] = None):
  factor = config.sleep_factor if config else 1.0
  time.sleep(random.uniform(min_s * factor, max_s * factor))
MOUSE_STEP_MS = 16
MOUSE_STEP_PAUSE = (0.0, 0.006)
MOUSE_MS = (160, 1300)
MOUSE_BEND_MAX_PX = 160
OVERSHOOT_MIN_DISTANCE = 120
CORRECTION_MIN_DISTANCE = 80
CORRECTION_MS = (80, 200)
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
  return t * t * t * (10 - 15 * t + 6 * t * t)
def mouse_profile(driver) -> MouseProfile:
  profile = getattr(getattr(driver, "browser_config", None), "mouse", None)
  return profile if isinstance(profile, MouseProfile) else DEFAULT_MOUSE
def move_duration_ms(distance: float, profile: MouseProfile = DEFAULT_MOUSE, rng: random.Random = random) -> float:
  base = min(MOUSE_MS[1], max(MOUSE_MS[0], 80 + 120 * math.log2(1 + distance / 14)))
  return base * profile.speed * rng.uniform(0.88, 1.15)
def mouse_path(start: Tuple[float, float], end: Tuple[float, float], curve: float = 1.0,
         rng: random.Random = random, profile: MouseProfile = DEFAULT_MOUSE,
         duration_ms: Optional[float] = None) -> List[Tuple[int, int, float]]:
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
  return getattr(driver, "_human_mouse", None)
def _legs(start, end, curve, overshoot, profile, rng, width, height) -> List[tuple]:
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
def dispatch_mouse(driver, event_type: str, x: float, y: float, button: str = "none",
           buttons: int = 0, click_count: int = 0):
  driver.execute_cdp_cmd("Input.dispatchMouseEvent", {
    "type": event_type,
    "x": int(x),
    "y": int(y),
    "button": button,
    "buttons": buttons,
    "clickCount": click_count,
    "pointerType": "mouse",
  })
def mouse_to(driver, x: float, y: float, curve: float = 1.0, overshoot: bool = True,
       rng: random.Random = random) -> Tuple[int, int]:
  size = driver.execute_script(_VIEWPORT_JS)
  if not isinstance(size, (list, tuple)) or len(size) != 2:
    raise WebDriverException("Không đọc được kích thước khung nhìn")
  width, height = size
  profile = mouse_profile(driver)
  end = _clamp_point(x, y, width, height)
  start = mouse_position(driver)
  if start is None:
    start = _clamp_point(width * rng.uniform(0.3, 0.7), height * rng.uniform(0.3, 0.7), width, height)
    dispatch_mouse(driver, "mouseMoved", *start)
  current = start
  for target, bend, leg_ms in _legs(start, end, curve, overshoot, profile, rng, width, height):
    for px, py, pause in mouse_path(current, target, bend, rng, profile, leg_ms):
      px, py = _clamp_point(px, py, width, height)
      dispatch_mouse(driver, "mouseMoved", px, py)
      if pause > 0.001:
        time.sleep(pause)
    current = target
  driver._human_mouse = end
  return end
def press_mouse(driver, rng: random.Random = random):
  point = mouse_position(driver) or (1, 1)
  dispatch_mouse(driver, "mousePressed", point[0], point[1], "left", 1, 1)
  time.sleep(rng.uniform(*mouse_profile(driver).hold))
  dispatch_mouse(driver, "mouseReleased", point[0], point[1], "left", 0, 1)
def element_box(driver, element) -> Optional[Tuple[float, float, float, float]]:
  data = driver.execute_script(_RECT_JS, element)
  if not isinstance(data, (list, tuple)) or len(data) != 6:
    return None
  left, top, width, height, view_w, view_h = data
  box = (max(left, 0), max(top, 0), min(left + width, view_w), min(top + height, view_h))
  return box if box[2] - box[0] >= 2 and box[3] - box[1] >= 2 else None
def point_hits(driver, element, x: float, y: float) -> bool:
  try:
    return bool(driver.execute_script(_HIT_JS, element, x, y))
  except WebDriverException:
    return False
def _aim_ratio(center: float, spread: float, low: float, high: float, rng) -> float:
  return min(high, max(low, rng.gauss(center, spread)))
def click_point(driver, element, rng: random.Random = random, need_hit: bool = True) -> Optional[Tuple[int, int]]:
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
    ActionChains(driver).scroll_to_element(element).perform()
    time.sleep(rng.uniform(0.3, 0.8))
    point = click_point(driver, element, rng)
  return point
def hover_element(driver, element, rng: random.Random = random, need_hit: bool = True) -> bool:
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
def install_os_independent_click():
  from selenium.webdriver.remote.webelement import WebElement
  if getattr(WebElement.click, "_ignores_os_cursor", False):
    return
  original = WebElement.click
  def click(self):
    driver = getattr(self, "_parent", None)
    try:
      rect = driver.execute_script(
        "const el = arguments[0];"
        "el.scrollIntoView({block:'center', inline:'nearest'});"
        "const r = el.getBoundingClientRect();"
        "return [r.left, r.top, r.width, r.height];",
        self,
      )
      if isinstance(rect, (list, tuple)) and len(rect) == 4 and rect[2] >= 2 and rect[3] >= 2:
        x, y = int(rect[0] + rect[2] / 2), int(rect[1] + rect[3] / 2)
        dispatch_mouse(driver, "mouseMoved", x, y)
        dispatch_mouse(driver, "mousePressed", x, y, "left", 1, 1)
        dispatch_mouse(driver, "mouseReleased", x, y, "left", 0, 1)
        try:
          driver._human_mouse = (x, y)
        except Exception:
          pass
        return
    except Exception:
      pass
    return original(self)
  click._ignores_os_cursor = True
  WebElement.click = click
install_os_independent_click()
