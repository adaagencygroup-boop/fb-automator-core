"""
bot.py
Class FacebookSeedingBot hợp nhất các flow tự động hóa của Module 08:
- Base: quản lý phiên, cookie, credentials, 2FA, click đa tầng, cuộn tự nhiên.
- Page Flow: Seeding Fanpage (Follow, Like).
- Profile Flow: Seeding Trang cá nhân (Follow Profile).
- Post Flow: Seeding Bài viết (Thả cảm xúc, Bình luận, Chia sẻ Public).
"""

import random
import time
from typing import Optional, Callable

from modules.module_08_interaction_seeding.automation.base import BaseFacebookBot, parse_cookie_pairs, perform_robust_click
from modules.module_08_interaction_seeding.automation.locators import (
    CommonLocators, PageLocators, ProfileLocators, PostLocators
)
from modules.module_08_interaction_seeding.automation.seeding_page_flow import PageSeedingFlow, execute_page_follow
from modules.module_08_interaction_seeding.automation.seeding_profile_flow import ProfileSeedingFlow, execute_profile_follow
from modules.module_08_interaction_seeding.automation.seeding_post_flow import (
    PostSeedingFlow, execute_react, execute_comment, execute_share
)


class FacebookSeedingBot(BaseFacebookBot):
    """
    Bot tự động hóa Seeding Facebook tổng hợp cho Module 08.
    Kế thừa BaseFacebookBot và tích hợp Page Flow, Profile Flow, Post Flow.
    """

    def __init__(self, driver):
        super().__init__(driver)
        self.page_flow = PageSeedingFlow(self)
        self.profile_flow = ProfileSeedingFlow(self)
        self.post_flow = PostSeedingFlow(self)

    def execute_follow(
        self,
        target_url: str,
        target_type: str = "PAGE",
        account_name: Optional[str] = None,
        callback: Optional[Callable[[str], None]] = None
    ) -> tuple[bool, str]:
        """Điều phối tương tác Follow Fanpage hoặc Follow Trang cá nhân tùy theo target_type."""
        clean_type = (target_type or "PAGE").upper().strip()
        if clean_type == "PAGE":
            return self.page_flow.execute(target_url=target_url, account_name=account_name, callback=callback)
        else:
            return self.profile_flow.execute(target_url=target_url, account_name=account_name, callback=callback)

    def execute_page_follow(
        self,
        target_url: str,
        account_name: Optional[str] = None,
        callback: Optional[Callable[[str], None]] = None
    ) -> tuple[bool, str]:
        """Tương tác Follow / Like Fanpage."""
        return self.page_flow.execute(target_url=target_url, account_name=account_name, callback=callback)

    def execute_profile_follow(
        self,
        target_url: str,
        account_name: Optional[str] = None,
        callback: Optional[Callable[[str], None]] = None
    ) -> tuple[bool, str]:
        """Tương tác Follow Trang cá nhân."""
        return self.profile_flow.execute(target_url=target_url, account_name=account_name, callback=callback)

    def execute_react(
        self,
        target_url: str,
        reaction_type: Optional[str] = "LIKE",
        callback: Optional[Callable[[str], None]] = None
    ) -> tuple[bool, str]:
        """Thả cảm xúc bài viết."""
        return self.post_flow.execute_react(target_url=target_url, reaction_type=reaction_type, callback=callback)

    def execute_comment(
        self,
        target_url: str,
        content: str,
        callback: Optional[Callable[[str], None]] = None
    ) -> tuple[bool, str]:
        """Viết bình luận bài viết."""
        return self.post_flow.execute_comment(target_url=target_url, content=content, callback=callback)

    def execute_share(
        self,
        target_url: str,
        callback: Optional[Callable[[str], None]] = None
    ) -> tuple[bool, str]:
        """Chia sẻ bài viết lên Bảng tin cá nhân ở chế độ Công khai (Public)."""
        return self.post_flow.execute_share(target_url=target_url, callback=callback)

    def verify_action_kept(
        self,
        action: str,
        target_type: str = "POST",
        comment_text: Optional[str] = None,
        callback: Optional[Callable[[str], None]] = None,
        wait_range: tuple = (8.0, 12.0),
    ) -> tuple[bool, str]:
        """
        Đợi một lúc sau khi thao tác báo thành công rồi kiểm tra lại, vì có lúc Facebook hiện cảnh báo
        (chặn tạm thời, giới hạn tần suất...) rồi tự hoàn tác thao tác vừa làm: nút Follow / cảm xúc trở lại
        như cũ, bình luận biến mất.
        - Trong lúc đợi: mỗi giây xem có hộp thoại cảnh báo của Facebook không.
        - Đợi xong: so trạng thái nút với lúc vừa bấm xong (Follow, cảm xúc) hoặc bình luận còn trên trang không.
        - Chia sẻ: chỉ kiểm tra cảnh báo (bài đã chia sẻ không nằm trên trang đang mở).
        Trả về (True, "") nếu thao tác vẫn được giữ, ngược lại (False, lý do).
        """
        act = (action or "").upper()
        page_type = (target_type or "POST").upper()

        def snapshot():
            try:
                if act in ("FOLLOW", "LIKE_PAGE"):
                    js = (PageLocators.JS_VERIFY_PAGE_STATE_CHANGED if page_type == "PAGE"
                          else ProfileLocators.JS_VERIFY_PROFILE_FOLLOWED)
                    return bool(self.driver.execute_script(js))
                if act == "REACT":
                    return self.driver.execute_script(PostLocators.JS_LIKE_BUTTON_SIGNATURE)
                if act == "COMMENT" and comment_text and comment_text.strip():
                    return self.driver.execute_script(
                        "return (document.body.innerText || '').split(arguments[0]).length - 1;",
                        comment_text.strip(),
                    )
            except Exception:
                return None
            return None

        before = snapshot()
        wait_s = random.uniform(*wait_range)
        if callback:
            callback(f"⏳ Đợi {wait_s:.0f}s để kiểm tra Facebook có cảnh báo hoặc hoàn tác thao tác không...")
        deadline = time.time() + wait_s
        while time.time() < deadline:
            try:
                warning = self.driver.execute_script(CommonLocators.JS_FIND_FACEBOOK_WARNING)
            except Exception:
                warning = None
            if warning:
                return False, f"Facebook cảnh báo và không ghi nhận thao tác: {warning}"
            time.sleep(1.0)

        after = snapshot()
        if act in ("FOLLOW", "LIKE_PAGE") and before is True and after is False:
            return False, "Facebook đã hoàn tác thao tác Follow (nút trở lại trạng thái chưa theo dõi)"
        if act == "REACT" and before and after and before != after:
            return False, "Facebook đã hoàn tác cảm xúc vừa thả (nút cảm xúc đã đổi lại)"
        if act == "COMMENT" and isinstance(before, int) and isinstance(after, int) and 0 < before and after < before:
            return False, "Bình luận vừa đăng đã bị Facebook gỡ (không còn hiện trên bài viết)"

        if callback:
            callback("✓ Đã kiểm tra lại: Facebook không cảnh báo, thao tác vẫn được giữ.")
        return True, ""
