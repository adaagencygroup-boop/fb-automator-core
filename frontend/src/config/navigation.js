/**
 * CẤU HÌNH MENU SIDEBAR + TIÊU ĐỀ HEADER (theo Figma: Aside - LeftSidebar 1016:5, Header - TopBar 1016:109)
 *
 * Mỗi mục:
 *  - id          : khóa duy nhất của mục menu (state activeNavId trong page.js)
 *  - label       : chữ hiển thị trên Sidebar
 *  - title       : tiêu đề lớn trên Header (mặc định = label)
 *  - description : dòng mô tả dưới tiêu đề Header
 *  - moduleId    : id module trong MODULE_REGISTRY (src/modules/index.js) sẽ được render.
 *                  Để trống -> hiển thị "Chức năng đang phát triển".
 *  - icon        : { src, width, height } — width/height = đúng kích thước gốc của file SVG
 *  - children    : danh sách submenu (nhóm xổ xuống)
 */

const icon = (name, width, height) => ({ src: `/icons/${name}.svg`, width, height });

export const NAV_CHEVRON = icon("icon_nav_chevron_down", 8.75, 5);

/** Icon lớn bên trái tiêu đề Header (21×24) */
export const HEADER_ICON_DEFAULT = icon("icon_header_flag", 21, 24);

export const NAV_ITEMS = [
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Tổng quan hoạt động của toàn hệ thống.",
    moduleId: "dashboard",
    icon: icon("icon_nav_dashboard", 30, 13.0025),
  },
  {
    id: "accounts",
    label: "Quản lý Account",
    description: "Quản lý danh sách tài khoản Facebook, trạng thái và phiên đăng nhập.",
    moduleId: "accounts",
    icon: icon("icon_nav_accounts", 30, 13),
  },
  {
    id: "farm",
    label: "Nuôi Acc (Farm)",
    description: "Thiết lập kịch bản nuôi tài khoản tự động.",
    moduleId: "farm",
    icon: icon("icon_nav_farm", 30, 12.9238),
  },
  {
    id: "creator",
    label: "Tạo Page hàng loạt",
    description: "Tạo Fanpage hàng loạt từ danh sách tài khoản.",
    moduleId: "creator",
    icon: icon("icon_nav_page_creator", 30, 13),
  },
  {
    id: "pages",
    label: "Quản lý Fanpage",
    icon: icon("icon_nav_fanpage", 30, 13),
    headerIcon: icon("icon_header_flag", 21, 24),
    children: [
      {
        id: "pages.list",
        label: "1. Danh sách Fanpage",
        title: "Danh sách Fanpage",
        description: "Quản lý danh sách Fanpage Facebook, theo dõi trạng thái và thao tác nhanh.",
        moduleId: "pages",
        icon: icon("icon_nav_fanpage_list", 24, 10.5),
      },
      {
        id: "pages.ai_post",
        label: "2. Đăng bài AI",
        title: "Đăng bài AI",
        description: "Tạo nội dung bằng AI và lên lịch đăng bài cho Fanpage.",
        moduleId: "pages",
        icon: icon("icon_nav_ai_post", 24, 12),
      },
      {
        id: "pages.reels",
        label: "3. Đăng Video Reels",
        title: "Đăng Video Reels",
        description: "Đăng video Reels hàng loạt lên Fanpage.",
        moduleId: "pages",
        icon: icon("icon_nav_reels", 24, 10.5),
      },
      {
        id: "pages.tiktok",
        label: "4. Tải Video TikTok",
        title: "Tải Video TikTok",
        description: "Tải video TikTok không logo để dùng cho Fanpage.",
        moduleId: "pages",
        icon: icon("icon_nav_tiktok", 24, 12.0054),
      },
      {
        id: "pages.youtube",
        label: "5. Tải YouTube Shorts",
        title: "Tải YouTube Shorts",
        description: "Tải video YouTube Shorts để dùng cho Fanpage.",
        moduleId: "pages",
        icon: icon("icon_nav_youtube_shorts", 24, 9),
      },
    ],
  },
  {
    id: "chat",
    label: "Quản lý Chat Page",
    description: "Hộp thư hợp nhất cho tin nhắn của tất cả Fanpage.",
    moduleId: "chat",
    icon: icon("icon_nav_chat", 30, 13),
  },
  {
    id: "groups",
    label: "Spam Group",
    description: "Đăng bài tự động vào các Group Facebook.",
    moduleId: "groups",
    icon: icon("icon_nav_group_spam", 30, 13),
  },
  {
    id: "seeding",
    label: "Seeding Bài & Page",
    description: "Tăng tương tác cho bài viết và Fanpage.",
    moduleId: "seeding",
    icon: icon("icon_nav_seeding", 30, 11.9251),
  },
  {
    id: "history",
    label: "Lịch sử (Nhật ký)",
    description: "Nhật ký thao tác và tiến trình của hệ thống.",
    moduleId: null, // chưa có module
    icon: icon("icon_nav_history", 30, 13),
  },
  {
    id: "profile",
    label: "Hồ sơ cá nhân",
    description: "Thông tin cá nhân, proxy và API key của bạn.",
    moduleId: "settings",
    icon: icon("icon_nav_profile", 30, 13),
  },
  {
    id: "admin",
    label: "Quản trị Web Admin",
    description: "Quản trị người dùng và cấu hình hệ thống.",
    moduleId: null, // chưa có module
    icon: icon("icon_nav_admin", 30, 13),
  },
];

/** Tìm mục menu theo id, trả về { item, parent } (parent = nhóm chứa submenu, nếu có). */
export function findNavItem(id) {
  for (const item of NAV_ITEMS) {
    if (item.id === id) return { item, parent: null };
    const child = item.children?.find((c) => c.id === id);
    if (child) return { item: child, parent: item };
  }
  return { item: NAV_ITEMS[0], parent: null };
}
