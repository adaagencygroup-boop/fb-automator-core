import DashboardModule from "./module_01_dashboard";
import AccountManagerModule from "./module_02_account_manager";
import AccFarmModule from "./module_03_acc_farm";
import PageCreatorModule from "./module_04_page_creator";
import PageManagerModule from "./module_05_page_manager";
import OmnichannelChatModule from "./module_06_omnichannel_chat";
import GroupSpamModule from "./module_07_group_spam";
import InteractionSeedingModule from "./module_08_interaction_seeding";
import UserProfileModule from "./module_09_user_profile";

export const MODULE_REGISTRY = [
  {
    id: "dashboard",
    icon: "📊",
    label: "Dashboard",
    author: "Đức",
    component: DashboardModule,
  },
  {
    id: "accounts",
    icon: "👥",
    label: "Quản Lý Acc FB",
    author: "Mạnh Cường",
    component: AccountManagerModule,
  },
  {
    id: "farm",
    icon: "🚜",
    label: "Nuôi Acc (Farm)",
    author: "Cường Trần, Bình Kiến",
    component: AccFarmModule,
  },
  {
    id: "creator",
    icon: "⚡",
    label: "Tạo Page Hàng Loạt",
    author: "Minh",
    component: PageCreatorModule,
  },
  {
    id: "pages",
    icon: "📢",
    label: "Quản Lý Fanpage",
    author: "Bình Ka, Kiệt",
    component: PageManagerModule,
  },
  {
    id: "chat",
    icon: "💬",
    label: "Chat Omnichannel",
    author: "Mạnh, Minh",
    component: OmnichannelChatModule,
  },
  {
    id: "groups",
    icon: "🚀",
    label: "Spam Group FB",
    author: "Anh",
    component: GroupSpamModule,
  },
  {
    id: "seeding",
    icon: "❤️",
    label: "Seeding Tương Tác",
    author: "Hưởng, Trường",
    component: InteractionSeedingModule,
  },
  {
    id: "settings",
    icon: "⚙️",
    label: "Cài Đặt Hệ Thống",
    author: "Trường, Kiệt",
    component: UserProfileModule,
  },
];
