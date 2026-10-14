"""
seeding_page_flow.py
Xử lý toàn bộ logic tự động hóa Seeding Fanpage (Follow, Like Fanpage) trên giao diện Facebook Comet.
Bao gồm:
  1. Kiểm tra trạng thái: tài khoản đã Follow / Like Page từ trước chưa.
  2. Tìm nút Follow / Like trực tiếp trên Header Fanpage.
  3. Xử lý mở Menu 3 chấm (...) nếu nút Follow bị ẩn trong tùy chọn phụ.
  4. Xác minh trạng thái sau khi thao tác.
"""

import time
import logging
from typing import Optional, Callable

from selenium.webdriver import ActionChains
from selenium.webdriver.common.keys import Keys

from modules.module_08_interaction_seeding.automation.base import BaseFacebookBot, perform_robust_click
from modules.module_08_interaction_seeding.automation.locators import PageLocators

logger = logging.getLogger(__name__)


class PageSeedingFlow:
    """Lớp điều phối quy trình seeding Fanpage (Like / Follow Page)."""

    def __init__(self, bot: BaseFacebookBot):
        self.bot = bot
        self.driver = bot.driver

    def execute(
        self,
        target_url: str,
        account_name: Optional[str] = None,
        callback: Optional[Callable[[str], None]] = None
    ) -> tuple[bool, str]:
        """Thực hiện tương tác Follow / Like Fanpage trên máy thật."""
        try:
            acc_label = f"Tài khoản {account_name}" if account_name else "Tài khoản"
            if callback:
                callback(f"🌐 [{acc_label}] Điều hướng đến Fanpage: {target_url}")
            self.driver.get(target_url)
            self.bot.random_sleep(3.5, 5.5)

            if "login" in (self.driver.current_url or "").lower():
                return False, f"{acc_label} chưa đăng nhập Facebook hoặc cookie đã hết hạn"

            # Đảm bảo trình duyệt luôn ở đỉnh trang để quét khu vực Header
            self.driver.execute_script("window.scrollTo(0, 0);")
            self.bot.random_sleep(1.2, 2.0)

            def check_state_after_click() -> bool:
                """Xác minh xem Facebook đã ghi nhận thay đổi chưa sau khi bấm."""
                time.sleep(1.8)
                return bool(self.driver.execute_script(PageLocators.JS_VERIFY_PAGE_STATE_CHANGED))

            # ─── BƯỚC 0: KIỂM TRA XEM ĐÃ FOLLOW / LIKE PAGE TỪ TRƯỚC CHƯA ───
            if callback:
                callback(f"🔍 [{acc_label}] Đang kiểm tra xem tài khoản đã follow trang này chưa...")

            already_check = self.driver.execute_script(PageLocators.JS_CHECK_ALREADY_FOLLOWED_OR_LIKED)
            if already_check and already_check.get("already"):
                reason = already_check.get("reason", "đang theo dõi")
                msg = f"{acc_label} đã follow page này rồi ({reason})"
                if callback:
                    callback(f"ℹ️ {msg}")
                return True, msg

            # ─── BƯỚC 1: TÌM NÚT FOLLOW / LIKE TRỰC TIẾP TRÊN HEADER ───
            if callback:
                callback(f"🔍 [{acc_label}] Chưa follow. Đang tìm nút Follow trên Fanpage...")

            page_buttons = self.driver.execute_script(PageLocators.JS_SCAN_PAGE_BUTTONS)
            follow_btn = page_buttons.get("followBtn") if page_buttons else None
            like_btn = page_buttons.get("likeBtn") if page_buttons else None
            more_btn = page_buttons.get("moreBtn") if page_buttons else None

            # Ưu tiên 1: Nút Follow trực tiếp
            if follow_btn:
                if callback:
                    callback(f"🎯 [{acc_label}] Tìm thấy nút Theo dõi (Follow) trên header Page, đang bấm...")
                perform_robust_click(self.driver, follow_btn)
                if check_state_after_click():
                    msg = f"{acc_label} đã bấm Theo dõi Fanpage thành công"
                    if callback:
                        callback(f"✓ {msg}!")
                    return True, msg
                else:
                    perform_robust_click(self.driver, follow_btn)
                    if check_state_after_click():
                        msg = f"{acc_label} đã bấm Theo dõi Fanpage thành công"
                        if callback:
                            callback(f"✓ {msg}!")
                        return True, msg

            # Ưu tiên 2: Nút Thích (Like) trực tiếp (Page profile tự động Follow khi Like)
            if like_btn:
                if callback:
                    callback(f"🎯 [{acc_label}] Tìm thấy nút Thích (Like) trên header Page, đang bấm...")
                perform_robust_click(self.driver, like_btn)
                if check_state_after_click():
                    msg = f"{acc_label} đã bấm Thích Fanpage thành công"
                    if callback:
                        callback(f"✓ {msg}!")
                    return True, msg

            # ─── BƯỚC 2: TÌM TRONG MENU 3 CHẤM (...) CỦA FANPAGE ───
            if more_btn:
                if callback:
                    callback(f"🔍 [{acc_label}] Không thấy nút Follow ở ngoài, đang bấm nút 3 chấm (...) Fanpage...")
                perform_robust_click(self.driver, more_btn)
                self.bot.random_sleep(1.5, 2.2)

                menu_scan = self.driver.execute_script(PageLocators.JS_SCAN_PAGE_MORE_MENU)
                if menu_scan and menu_scan.get("alreadyFollowOrLiked"):
                    try:
                        ActionChains(self.driver).send_keys(Keys.ESCAPE).perform()
                    except Exception:
                        pass
                    msg = f"{acc_label} đã follow page này rồi"
                    if callback:
                        callback(f"ℹ️ {msg}")
                    return True, msg

                menu_follow = menu_scan.get("followItem") if menu_scan else None
                menu_like = menu_scan.get("likeItem") if menu_scan else None

                target_item = menu_follow or menu_like
                if target_item:
                    action_name = "Follow" if target_item == menu_follow else "Like"
                    if callback:
                        callback(f"🎯 [{acc_label}] Đã tìm thấy nút {action_name} trong menu 3 chấm Fanpage, đang bấm...")
                    perform_robust_click(self.driver, target_item)
                    self.bot.random_sleep(2.0, 3.0)
                    msg = f"{acc_label} đã bấm {action_name} Fanpage qua menu 3 chấm thành công"
                    if callback:
                        callback(f"✓ {msg}!")
                    return True, msg
                else:
                    try:
                        ActionChains(self.driver).send_keys(Keys.ESCAPE).perform()
                    except Exception:
                        pass
                    if callback:
                        callback(f"⚠️ [{acc_label}] Trong menu 3 chấm Fanpage không có tùy chọn Follow/Like!")

            fail_msg = f"{acc_label}: Không tìm thấy nút Follow/Like trên Fanpage"
            if callback:
                callback(f"❌ {fail_msg}")
            return False, fail_msg

        except Exception as e:
            logger.error(f"Error in PageSeedingFlow: {e}")
            return False, f"{acc_label} gặp lỗi seeding Page: {str(e)[:80]}"


def execute_page_follow(
    bot: BaseFacebookBot,
    target_url: str,
    account_name: Optional[str] = None,
    callback: Optional[Callable[[str], None]] = None
) -> tuple[bool, str]:
    """Helper hàm tiện ích gọi nhanh PageSeedingFlow."""
    flow = PageSeedingFlow(bot)
    return flow.execute(target_url=target_url, account_name=account_name, callback=callback)
