"""
seeding_profile_flow.py
Xử lý toàn bộ logic tự động hóa Seeding Trang cá nhân (Follow Profile) trên giao diện Facebook Comet.
Bao gồm:
  1. Kiểm tra trạng thái: tài khoản đã Follow / Kết bạn / Gửi lời mời từ trước chưa.
  2. Tìm nút Follow trực tiếp trên Header Trang cá nhân.
  3. Xử lý mở Menu 3 chấm (...) của Trang cá nhân nếu nút Follow bị ẩn vào trong.
  4. Xác minh trạng thái sau khi thao tác.
"""

import time
import logging
from typing import Optional, Callable

from selenium.webdriver import ActionChains
from selenium.webdriver.common.keys import Keys

from modules.module_08_interaction_seeding.automation.base import BaseFacebookBot, perform_robust_click
from modules.module_08_interaction_seeding.automation.locators import ProfileLocators

logger = logging.getLogger(__name__)


class ProfileSeedingFlow:
    """Lớp điều phối quy trình seeding Trang cá nhân (Follow Profile)."""

    def __init__(self, bot: BaseFacebookBot):
        self.bot = bot
        self.driver = bot.driver

    def execute(
        self,
        target_url: str,
        account_name: Optional[str] = None,
        callback: Optional[Callable[[str], None]] = None
    ) -> tuple[bool, str]:
        """Thực hiện tương tác Follow Trang cá nhân trên máy thật."""
        try:
            acc_label = f"Tài khoản {account_name}" if account_name else "Tài khoản"
            if callback:
                callback(f"🌐 [{acc_label}] Điều hướng đến Trang cá nhân: {target_url}")
            self.driver.get(target_url)
            self.bot.random_sleep(3.5, 5.5)

            if "login" in (self.driver.current_url or "").lower():
                return False, f"{acc_label} chưa đăng nhập Facebook hoặc cookie đã hết hạn"

            # Đảm bảo trình duyệt luôn ở đỉnh trang để quét khu vực Header Profile
            self.driver.execute_script("window.scrollTo(0, 0);")
            self.bot.random_sleep(1.2, 2.0)

            def check_state_after_click() -> bool:
                """Xác minh xem Facebook đã ghi nhận thay đổi chưa sau khi bấm."""
                time.sleep(1.8)
                return bool(self.driver.execute_script(ProfileLocators.JS_VERIFY_PROFILE_FOLLOWED))

            # ─── BƯỚC 0: KIỂM TRA XEM ĐÃ KẾT NỐI / FOLLOW TỪ TRƯỚC CHƯA ───
            if callback:
                callback(f"🔍 [{acc_label}] Đang kiểm tra xem tài khoản đã follow trang cá nhân này chưa...")

            already_check = self.driver.execute_script(ProfileLocators.JS_CHECK_ALREADY_CONNECTED)
            if already_check and already_check.get("already"):
                reason = already_check.get("reason", "đang theo dõi")
                msg = f"{acc_label} đã follow trang cá nhân này rồi ({reason})"
                if callback:
                    callback(f"ℹ️ {msg}")
                return True, msg

            # ─── BƯỚC 1: TÌM NÚT THEO DÕI (FOLLOW) NGOÀI HEADER TRANG CÁ NHÂN ───
            if callback:
                callback(f"🔍 [{acc_label}] Chưa follow. Đang tìm nút Theo dõi trên Trang cá nhân...")

            buttons_info = self.driver.execute_script(ProfileLocators.JS_SCAN_PROFILE_BUTTONS)
            follow_btn = buttons_info.get("followBtn") if buttons_info else None
            more_btn = buttons_info.get("moreBtn") if buttons_info else None

            # Nếu có nút Follow ở ngoài Header thì bấm trực tiếp
            if follow_btn:
                if callback:
                    callback(f"🎯 [{acc_label}] Tìm thấy nút Theo dõi (Follow) trên header Trang cá nhân, đang bấm...")
                perform_robust_click(self.driver, follow_btn)
                if check_state_after_click():
                    msg = f"{acc_label} đã bấm Theo dõi thành công"
                    if callback:
                        callback(f"✓ {msg}!")
                    return True, msg
                else:
                    perform_robust_click(self.driver, follow_btn)
                    if check_state_after_click():
                        msg = f"{acc_label} đã bấm Theo dõi thành công"
                        if callback:
                            callback(f"✓ {msg}!")
                        return True, msg

            # ─── BƯỚC 2: NẾU KHÔNG HIỆN NÚT FOLLOW Ở NGOÀI -> BẤM NÚT 3 CHẤM (...) ───
            if more_btn:
                if callback:
                    callback(f"🔍 [{acc_label}] Không thấy nút Follow ở ngoài, đang bấm nút 3 chấm (...) để kiểm tra...")
                perform_robust_click(self.driver, more_btn)
                self.bot.random_sleep(1.5, 2.2)

                # Quét menu popup xem có nút Follow không
                menu_scan_result = self.driver.execute_script(ProfileLocators.JS_SCAN_PROFILE_MORE_MENU)
                already_following = menu_scan_result.get("alreadyFollowing") if menu_scan_result else False
                menu_follow_item = menu_scan_result.get("followItem") if menu_scan_result else None

                if already_following:
                    try:
                        ActionChains(self.driver).send_keys(Keys.ESCAPE).perform()
                    except Exception:
                        pass
                    msg = f"{acc_label} đã follow trang cá nhân này rồi"
                    if callback:
                        callback(f"ℹ️ {msg}")
                    return True, msg

                if menu_follow_item:
                    if callback:
                        callback(f"🎯 [{acc_label}] Đã tìm thấy nút Follow trong menu 3 chấm, đang bấm...")
                    perform_robust_click(self.driver, menu_follow_item)
                    self.bot.random_sleep(2.0, 3.0)
                    msg = f"{acc_label} đã bấm Follow qua menu 3 chấm thành công"
                    if callback:
                        callback(f"✓ {msg}!")
                    return True, msg
                else:
                    try:
                        ActionChains(self.driver).send_keys(Keys.ESCAPE).perform()
                    except Exception:
                        pass
                    if callback:
                        callback(f"⚠️ [{acc_label}] Trong menu 3 chấm không có nút Follow!")

            fail_msg = f"{acc_label}: Không tìm thấy nút Follow trên trang cá nhân"
            if callback:
                callback(f"❌ {fail_msg}")
            return False, fail_msg

        except Exception as e:
            logger.error(f"Error in ProfileSeedingFlow: {e}")
            return False, f"{acc_label} gặp lỗi seeding Profile: {str(e)[:80]}"


def execute_profile_follow(
    bot: BaseFacebookBot,
    target_url: str,
    account_name: Optional[str] = None,
    callback: Optional[Callable[[str], None]] = None
) -> tuple[bool, str]:
    """Helper hàm tiện ích gọi nhanh ProfileSeedingFlow."""
    flow = ProfileSeedingFlow(bot)
    return flow.execute(target_url=target_url, account_name=account_name, callback=callback)
