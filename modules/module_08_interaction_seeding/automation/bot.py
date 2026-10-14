"""
bot.py
Class FacebookSeedingBot hợp nhất các flow tự động hóa của Module 08:
- Base: quản lý phiên, cookie, credentials, 2FA, click đa tầng, cuộn tự nhiên.
- Page Flow: Seeding Fanpage (Follow, Like).
- Profile Flow: Seeding Trang cá nhân (Follow Profile).
- Post Flow: Seeding Bài viết (Thả cảm xúc, Bình luận, Chia sẻ Public).
"""

from typing import Optional, Callable

from modules.module_08_interaction_seeding.automation.base import BaseFacebookBot, parse_cookie_pairs, perform_robust_click
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
