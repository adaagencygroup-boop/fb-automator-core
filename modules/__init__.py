"""
Export all 9 modules for dynamic loading
"""
from modules.module_01_dashboard import DashboardTab
from modules.module_02_account_manager import AccountManagerTab
from modules.module_03_acc_farm import AccFarmTab
from modules.module_04_page_creator import PageCreatorTab
from modules.module_05_page_manager import PageManagerTab
from modules.module_06_omnichannel_chat import OmnichannelChatTab
from modules.module_07_group_spam import GroupSpamTab
from modules.module_08_interaction_seeding import InteractionSeedingTab
from modules.module_09_user_profile import UserProfileTab

MODULE_REGISTRY = [
    {
        "id": "module_01_dashboard",
        "title": "Dashboard",
        "icon": "📊",
        "author": "Đức",
        "cls": DashboardTab
    },
    {
        "id": "module_02_account_manager",
        "title": "Quản Lý Acc FB",
        "icon": "👥",
        "author": "Mạnh Cường",
        "cls": AccountManagerTab
    },
    {
        "id": "module_03_acc_farm",
        "title": "Nuôi Acc (Farm)",
        "icon": "🚜",
        "author": "Cường Trần, Bình Kiến",
        "cls": AccFarmTab
    },
    {
        "id": "module_04_page_creator",
        "title": "Tạo Page Hàng Loạt",
        "icon": "⚡",
        "author": "Minh",
        "cls": PageCreatorTab
    },
    {
        "id": "module_05_page_manager",
        "title": "Quản Lý Fanpage",
        "icon": "📢",
        "author": "Bình Ka, Kiệt",
        "cls": PageManagerTab
    },
    {
        "id": "module_06_omnichannel_chat",
        "title": "Quản Lý Chat Page",
        "icon": "💬",
        "author": "Mạnh, Minh",
        "cls": OmnichannelChatTab
    },
    {
        "id": "module_07_group_spam",
        "title": "Spam Group FB",
        "icon": "🚀",
        "author": "Anh",
        "cls": GroupSpamTab
    },
    {
        "id": "module_08_interaction_seeding",
        "title": "Seeding Tương Tác",
        "icon": "❤️",
        "author": "Hưởng, Trường",
        "cls": InteractionSeedingTab
    },
    {
        "id": "module_09_user_profile",
        "title": "Hồ Sơ & Cài Đặt",
        "icon": "⚙️",
        "author": "Trường, Kiệt",
        "cls": UserProfileTab
    }
]

__all__ = [
    "MODULE_REGISTRY",
    "DashboardTab",
    "AccountManagerTab",
    "AccFarmTab",
    "PageCreatorTab",
    "PageManagerTab",
    "OmnichannelChatTab",
    "GroupSpamTab",
    "InteractionSeedingTab",
    "UserProfileTab"
]
