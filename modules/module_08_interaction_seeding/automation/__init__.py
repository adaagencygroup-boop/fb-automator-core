"""
Package automation cho Module 08: Interaction Seeding.
"""

from modules.module_08_interaction_seeding.automation.locators import (
    LoginLocators, PageLocators, ProfileLocators, PostLocators
)
from modules.module_08_interaction_seeding.automation.base import (
    BaseFacebookBot, parse_cookie_pairs, perform_robust_click
)
from modules.module_08_interaction_seeding.automation.seeding_page_flow import (
    PageSeedingFlow, execute_page_follow
)
from modules.module_08_interaction_seeding.automation.seeding_profile_flow import (
    ProfileSeedingFlow, execute_profile_follow
)
from modules.module_08_interaction_seeding.automation.seeding_post_flow import (
    PostSeedingFlow, execute_react, execute_comment, execute_share
)
from modules.module_08_interaction_seeding.automation.bot import FacebookSeedingBot

__all__ = [
    "LoginLocators",
    "PageLocators",
    "ProfileLocators",
    "PostLocators",
    "BaseFacebookBot",
    "parse_cookie_pairs",
    "perform_robust_click",
    "PageSeedingFlow",
    "execute_page_follow",
    "ProfileSeedingFlow",
    "execute_profile_follow",
    "PostSeedingFlow",
    "execute_react",
    "execute_comment",
    "execute_share",
    "FacebookSeedingBot",
]
