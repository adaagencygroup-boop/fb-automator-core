"""
human_interaction.py
=============================================================================
Module mô phỏng hành vi sinh trắc học của con người (Human Biometrics Emulation)
Dành cho Selenium WebDriver & Chrome DevTools Protocol (CDP).

Chống phát hiện Bot / Behavioral Biometrics thông qua:
  1. Di chuyển chuột theo đường cong Bézier bậc 3 (Cubic Bézier)
  2. Gia tốc Ease-In-Out (chậm lúc đầu -> nhanh ở giữa -> hãm phanh khi chạm đích)
  3. Rung tay tự nhiên (Micro-tremors & Hand Jitter)
  4. Điểm click phân tán ngẫu nhiên trong bounding box (không click chính tâm)
  5. Cuộn trang mượt mà kèm cơ chế đọc quá đà và cuộn ngược (Overshoot & Reading pattern)
  6. Phát sự kiện chuột thật qua CDP (isTrusted = True)
=============================================================================
"""

import math
import random
import time
from typing import Optional, Tuple, Dict, Any
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.remote.webelement import WebElement
from selenium.webdriver.common.action_chains import ActionChains


class HumanInteraction:
    """
    Class điều khiển chuột và cuộn trang mô phỏng 100% cơ chế sinh trắc học của con người.
    """

    def __init__(self, driver: WebDriver):
        self.driver = driver
        # Lưu tọa độ chuột hiện tại (viewport coordinates). Khởi tạo ở vị trí ngẫu nhiên rìa màn hình.
        self._current_x = float(random.randint(100, 300))
        self._current_y = float(random.randint(100, 300))

    # ==========================================================================
    # 1. THUẬT TOÁN ĐƯỜNG CONG BÉZIER BẬC 3 & GIA TỐC HỌC (BEZIER & KINEMATICS)
    # ==========================================================================

    @staticmethod
    def _cubic_bezier_point(
        p0: Tuple[float, float],
        p1: Tuple[float, float],
        p2: Tuple[float, float],
        p3: Tuple[float, float],
        t: float
    ) -> Tuple[float, float]:
        """
        Tính tọa độ (x, y) tại thời điểm t (0 <= t <= 1) trên đường cong Bézier bậc 3:
        B(t) = (1-t)^3*P0 + 3*(1-t)^2*t*P1 + 3*(1-t)*t^2*P2 + t^3*P3
        """
        u = 1.0 - t
        tt = t * t
        uu = u * u
        uuu = uu * u
        ttt = tt * t

        x = uuu * p0[0] + 3 * uu * t * p1[0] + 3 * u * tt * p2[0] + ttt * p3[0]
        y = uuu * p0[1] + 3 * uu * t * p1[1] + 3 * u * tt * p2[1] + ttt * p3[1]
        return x, y

    @staticmethod
    def _ease_in_out(t: float) -> float:
        """
        Đường cong gia tốc phi tuyến tính (Sigmoid Ease-In-Out):
        Con người bắt đầu di chuyển chậm để định hướng, tăng tốc ở đoạn giữa
        và giảm tốc (hãm quán tính) khi con trỏ chuẩn bị chạm tới nút bấm.
        """
        return 3 * (t ** 2) - 2 * (t ** 3)

    def _generate_control_points(
        self,
        start: Tuple[float, float],
        end: Tuple[float, float]
    ) -> Tuple[Tuple[float, float], Tuple[float, float]]:
        """
        Tạo 2 điểm điều khiển P1, P2 ngẫu nhiên để tạo độ cong tự nhiên cho quỹ đạo.
        Con người không bao giờ di chuột theo một đường thẳng tuyệt đối.
        """
        dx = end[0] - start[0]
        dy = end[1] - start[1]
        distance = math.hypot(dx, dy)

        # Biên độ lệch tỉ lệ với khoảng cách di chuyển
        deviation = max(20.0, min(distance * 0.4, 250.0))

        # Vector vuông góc với hướng di chuyển
        perp_x = -dy / (distance + 1e-6)
        perp_y = dx / (distance + 1e-6)

        # Chọn độ lệch ngẫu nhiên về bên trái hoặc phải của đường thẳng
        side1 = random.choice([-1, 1]) * random.uniform(0.3, 1.0) * deviation
        side2 = random.choice([-1, 1]) * random.uniform(0.2, 0.8) * deviation

        # Điểm P1 nằm ở ~1/3 quãng đường, P2 nằm ở ~2/3 quãng đường
        p1_x = start[0] + dx * random.uniform(0.2, 0.4) + perp_x * side1
        p1_y = start[1] + dy * random.uniform(0.2, 0.4) + perp_y * side1

        p2_x = start[0] + dx * random.uniform(0.6, 0.8) + perp_x * side2
        p2_y = start[1] + dy * random.uniform(0.6, 0.8) + perp_y * side2

        return (p1_x, p1_y), (p2_x, p2_y)

    def _dispatch_mouse_event(self, event_type: str, x: float, y: float, button: str = "none"):
        """
        Phát tín hiệu chuột qua Chrome DevTools Protocol (CDP).
        Sự kiện này được Chromium gắn nhãn `isTrusted = true`, đánh lừa hoàn toàn
        các bộ theo dõi sinh trắc học DOM (mousemove, pointermove).
        """
        try:
            params = {
                "type": event_type,
                "x": int(x),
                "y": int(y),
            }
            if event_type in ("mousePressed", "mouseReleased"):
                params["button"] = button
                params["clickCount"] = 1

            self.driver.execute_cdp_cmd("Input.dispatchMouseEvent", params)
        except Exception:
            pass

    # ==========================================================================
    # 2. DI CHUYỂN CHUỘT SINH TRẮC HỌC (MOUSE MOVEMENT WITH JITTER)
    # ==========================================================================

    def move_mouse_to(self, element: WebElement, deviation_ratio: float = 0.8) -> Tuple[float, float]:
        """
        Di chuyển chuột từ vị trí hiện tại đến phần tử web theo đường cong Bézier.
        - Thêm độ rung vi mô (hand tremor jitter) 1-3px để mô phỏng cơ tay người.
        - Tốc độ di chuyển phụ thuộc vào khoảng cách (Định luật Fitts).
        - Chọn điểm rơi ngẫu nhiên bên trong bounding box thay vì chính giữa tâm.
        """
        rect = element.rect
        elem_x = rect['x']
        elem_y = rect['y']
        width = rect['width']
        height = rect['height']

        # Chọn điểm rơi ngẫu nhiên quanh vùng an toàn của nút
        padding_x = width * (1.0 - deviation_ratio) / 2
        padding_y = height * (1.0 - deviation_ratio) / 2
        target_x = elem_x + padding_x + random.random() * (width * deviation_ratio)
        target_y = elem_y + padding_y + random.random() * (height * deviation_ratio)

        start = (self._current_x, self._current_y)
        end = (target_x, target_y)

        # Sinh điểm điều khiển Bézier
        p1, p2 = self._generate_control_points(start, end)
        distance = math.hypot(end[0] - start[0], end[1] - start[1])

        # Số bước di chuyển tỉ lệ thuận với khoảng cách (25 - 85 bước)
        steps = int(max(25, min(distance / 12.0, 85)))
        total_duration = random.uniform(0.35, 0.65) + (distance / 1200.0) * random.uniform(0.3, 0.6)
        base_step_delay = total_duration / steps

        for step in range(steps + 1):
            raw_t = step / float(steps)
            t = self._ease_in_out(raw_t)

            bx, by = self._cubic_bezier_point(start, p1, p2, end, t)

            # Mô phỏng rung tay (Hand Tremor Jitter 1-3px)
            dampening = 1.0 - (raw_t * 0.7)
            jitter_x = random.uniform(-1.5, 1.5) * dampening
            jitter_y = random.uniform(-1.5, 1.5) * dampening

            curr_x = bx + jitter_x
            curr_y = by + jitter_y

            self._dispatch_mouse_event("mouseMoved", curr_x, curr_y)
            self._current_x = curr_x
            self._current_y = curr_y

            step_sleep = base_step_delay * random.uniform(0.7, 1.3)
            time.sleep(max(0.003, step_sleep))

        # Điểm dừng chốt hạ
        self._dispatch_mouse_event("mouseMoved", target_x, target_y)
        self._current_x = target_x
        self._current_y = target_y

        return target_x, target_y

    # ==========================================================================
    # 3. MÔ PHỎNG CLICK CHUỘT TỰ NHIÊN (NATURAL CLICK SEQUENCE)
    # ==========================================================================

    def click(self, element: WebElement, pre_delay_range: Tuple[float, float] = (0.12, 0.38)):
        """
        Quy trình click chuột mô phỏng hành vi người:
        1. Di chuyển chuột tới phần tử theo quỹ đạo Bézier.
        2. Dừng quan sát (120ms - 380ms) trước khi nhấn.
        3. Nhấn chuột xuống (MouseDown).
        4. Giữ phím vật lý (MouseHold: 60ms - 140ms).
        5. Nhả chuột (MouseUp) & kích hoạt sự kiện click.
        """
        try:
            target_x, target_y = self.move_mouse_to(element)
            time.sleep(random.uniform(*pre_delay_range))

            # Phát sự kiện qua CDP
            self._dispatch_mouse_event("mousePressed", target_x, target_y, button="left")
            time.sleep(random.uniform(0.06, 0.14))
            self._dispatch_mouse_event("mouseReleased", target_x, target_y, button="left")

            # Click trực tiếp element qua Selenium như phương án chốt hạ
            ActionChains(self.driver).click(element).perform()
        except Exception:
            try:
                element.click()
            except Exception:
                try:
                    self.driver.execute_script("arguments[0].click();", element)
                except Exception:
                    pass

        time.sleep(random.uniform(0.15, 0.35))

    # ==========================================================================
    # 4. CUỘN TRANG SINH TRẮC HỌC (OVERSHOOT & INERTIAL SCROLLING)
    # ==========================================================================

    def scroll_page(self, total_pixels: int):
        """
        Mô phỏng thao tác cuộn chuột đọc tin tức của người dùng:
        - Chia nhỏ thành nhiều nấc cuộn.
        - Đôi khi cuộn ngược lại một chút (Overshoot Correction) như khi mắt đọc lướt quá đà.
        """
        direction = 1 if total_pixels >= 0 else -1
        remaining = abs(total_pixels)

        while remaining > 0:
            chunk = min(remaining, random.randint(60, 180))
            step_pixels = chunk * direction

            self.driver.execute_script(f"window.scrollBy({{top: {step_pixels}, left: 0, behavior: 'smooth'}});")
            remaining -= chunk

            self._current_y = max(50.0, self._current_y - (step_pixels * 0.1))

            # 15% xác suất người dùng cuộn ngược lại một chút
            if random.random() < 0.15 and remaining > 100:
                back_pixels = int(random.randint(25, 65) * -direction)
                time.sleep(random.uniform(0.18, 0.42))
                self.driver.execute_script(f"window.scrollBy({{top: {back_pixels}, left: 0, behavior: 'smooth'}});")
                remaining += abs(back_pixels)

            time.sleep(random.uniform(0.04, 0.16))

        time.sleep(random.uniform(0.4, 0.85))

    # ==========================================================================
    # 5. GÕ PHÍM NGẪU NHIÊN VỚI SỬA LỖI (HUMAN TYPING WITH MISTAKES)
    # ==========================================================================

    def human_type(self, element: WebElement, text: str, mistake_rate: float = 0.015):
        """
        Gõ phím mô phỏng người:
        - Tốc độ gõ không đều (Jitter 25ms - 75ms).
        - Tỷ lệ gõ nhầm phím và bấm Backspace sửa lại ngẫu nhiên.
        - Hỗ trợ Emoji an toàn qua CDP tránh crash ChromeDriver.
        """
        self.click(element)
        time.sleep(random.uniform(0.1, 0.25))

        for ch in text:
            # Thỉnh thoảng gõ nhầm 1 ký tự rồi bấm Backspace sửa lại
            if mistake_rate > 0 and random.random() < mistake_rate and ch.isalnum():
                wrong_ch = random.choice("asdfghjklqwerty")
                element.send_keys(wrong_ch)
                time.sleep(random.uniform(0.12, 0.25))
                element.send_keys("\b")
                time.sleep(random.uniform(0.08, 0.16))

            # Xử lý Emoji ngoài chuẩn BMP (🔥, ❤️, ...)
            if ord(ch) > 0xFFFF:
                try:
                    self.driver.execute_cdp_cmd("Input.insertText", {"text": ch})
                except Exception:
                    element.send_keys(ch)
            else:
                element.send_keys(ch)

            time.sleep(random.uniform(0.025, 0.075))
