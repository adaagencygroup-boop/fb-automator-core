import { ICON_GLYPHS } from "./iconGlyphs.js";

/**
 * CẤU HÌNH MENU SIDEBAR + TIÊU ĐỀ HEADER
 * Figma: Aside - LeftSidebar (1016:5), Header - TopBar (1016:109),
 *        mục "Tổng quan" (1020:13823), "Quản lý tài khoản Facebook" (1020:13770)
 *
 * Mỗi mục:
 *  - id          : khóa duy nhất của mục menu (state activeTab trong page.js)
 *  - label       : chữ hiển thị trên Sidebar
 *  - title       : tiêu đề lớn trên Header (mặc định = label)
 *  - description : dòng mô tả dưới tiêu đề Header
 *  - moduleId    : id module trong MODULE_REGISTRY (src/modules/index.js) sẽ được render.
 *                  null -> hiển thị "Chức năng đang được phát triển".
 *  - icon        : { src, width, height, glyph } — width/height = đúng kích thước gốc của file SVG,
 *                  glyph = vùng hình thật (src/config/iconGlyphs.js) để Sidebar hiển thị mọi icon cùng cỡ.
 *  - children    : danh sách submenu (nhóm xổ xuống)
 *  - path        : (tuỳ chọn) đường dẫn trang. Mặc định suy ra từ id: "pages.ai_post" -> "/pages/ai-post",
 *                  "dashboard" -> "/". Mỗi mục lá (không có children) là một trang riêng, nằm ở
 *                  src/app/<path>/page.js. Thêm/đổi mục -> tạo/đổi folder tương ứng
 *                  (npm run check:routes sẽ báo nếu thiếu).
 */

const icon = (name, width, height) => ({
  src: `/icons/${name}.svg`,
  width,
  height,
  glyph: ICON_GLYPHS[name],
});

const HISTORY_ICON = icon("icon_nav_history", 15, 15);

export const NAV_CHEVRON = icon("icon_nav_chevron_down", 8.75, 5);

/** Icon lớn bên trái tiêu đề Header (21×24) */
export const HEADER_ICON_DEFAULT = icon("icon_header_flag", 21, 24);

export const NAV_ITEMS = [
  {
    id: "dashboard",
    label: "Tổng quan",
    description: "Tổng quan hoạt động của toàn hệ thống.",
    moduleId: "dashboard",
    icon: icon("icon_nav_overview", 15, 15),
  },
  {
    id: "accounts",
    label: "Quản lý tài khoản Facebook",
    description: "Quản lý danh sách tài khoản Facebook, trạng thái và phiên đăng nhập.",
    moduleId: "accounts",
    icon: icon("icon_nav_fb_accounts", 16.5417, 14.1667),
  },
  {
    id: "interact",
    label: "Đăng bài và tương tác tài khoản",
    icon: icon("icon_nav_interact", 16, 17),
    children: [
      {
        id: "interact.post",
        label: "Đăng bài viết Facebook",
        description: "Đăng bài viết lên trang cá nhân bằng các tài khoản Facebook.",
        moduleId: "farm",
        icon: icon("icon_nav_post_facebook", 14, 14),
      },
      {
        id: "interact.engage",
        label: "Tương tác tài khoản",
        description: "Thiết lập kịch bản tương tác tự động để nuôi tài khoản.",
        moduleId: "farm",
        icon: icon("icon_nav_account_engage", 14, 11),
      },
      {
        id: "interact.history",
        label: "Lịch sử",
        title: "Lịch sử đăng bài",
        description: "Nhật ký đăng bài của các tài khoản Facebook.",
        moduleId: "farm",
        icon: HISTORY_ICON,
      },
    ],
  },
  {
    id: "creator",
    label: "Tạo fanpage hàng loạt",
    icon: icon("icon_nav_page_creator", 15, 15),
    children: [
      {
        id: "creator.create",
        label: "Tạo Fanpage",
        description: "Tự động tạo và thiết lập nhiều Fanpage theo dữ liệu và cấu hình đã chuẩn bị.",
        moduleId: "creator",
        icon: icon("icon_nav_post_facebook", 14, 14), // Figma dùng chung icon với "Đăng bài viết Facebook"
      },
      {
        id: "creator.history",
        label: "Lịch sử tạo fanpage",
        title: "Lịch sử tạo Fanpage",
        description: "Nhật ký các lượt tạo Fanpage và kết quả.",
        moduleId: null,
        icon: HISTORY_ICON,
      },
    ],
  },
  {
    id: "pages",
    label: "Quản lý Fanpage",
    icon: icon("icon_nav_fanpage", 30, 13),
    headerIcon: icon("icon_header_flag", 21, 24),
    children: [
      {
        id: "pages.list",
        label: "Danh sách Fanpage",
        description: "Quản lý danh sách Fanpage Facebook, theo dõi trạng thái và thao tác nhanh.",
        moduleId: "pages",
        icon: icon("icon_nav_fanpage_list", 24, 10.5),
      },
      {
        id: "pages.ai_post",
        label: "Đăng bài AI",
        description: "Tạo nội dung bằng AI và lên lịch đăng bài cho Fanpage.",
        moduleId: "pages",
        icon: icon("icon_nav_ai_post", 24, 12),
      },
      {
        id: "pages.reels",
        label: "Đăng Video Reels",
        description: "Đăng video Reels hàng loạt lên Fanpage.",
        moduleId: "pages",
        icon: icon("icon_nav_reels", 24, 10.5),
      },
      {
        id: "pages.tiktok",
        label: "Tải Video TikTok",
        title: "Tải Video TikTok",
        description: "Tự Động Tìm Kiếm & Tải Video TikTok Theo Từ Khóa Cho Từng Fanpage Để Làm Nguồn Đăng Reels.",
        moduleId: "pages",
        icon: icon("icon_nav_tiktok", 24, 12.0054),
      },
      {
        id: "pages.youtube",
        label: "Tải Video YouTube",
        title: "Tải Video YouTube",
        description: "Tự Động Tìm Kiếm & Tải Video YouTube Shorts Theo Từ Khóa Cho Từng Fanpage Để Làm Nguồn Đăng Reels.",
        moduleId: "pages",
        icon: icon("icon_nav_youtube_shorts", 24, 9),
      },
      {
        id: "pages.history",
        label: "Lịch Sử / Nhật Ký",
        title: "Lịch Sử / Nhật Ký",
        description: "Tra Cứu & Thống Kê Kết Quả Các Tác Vụ Trong Module Quản Lý Fanpage.",
        moduleId: "pages",
        icon: HISTORY_ICON,
      },
    ],
  },
  {
    id: "chat",
    label: "Quản lý Chat Page",
    description: "Quản lý chat tập trung, đồng bộ các Fanpage và nhận thông báo thời gian thực.",
    moduleId: "chat",
    icon: icon("icon_nav_chat", 30, 13),
  },
  {
    id: "groups",
    label: "Spam Group Hội Nhóm",
    icon: icon("icon_nav_group_spam", 30, 13),
    children: [
      {
        id: "groups.post",
        label: "Đăng bài",
        title: "Đăng bài vào Group",
        description: "Đăng bài tự động vào các Group Facebook.",
        moduleId: "groups",
        icon: icon("icon_nav_group_post", 16, 16),
      },
      {
        id: "groups.comment",
        label: "Bình luận",
        title: "Bình luận trong Group",
        description: "Bình luận tự động vào bài viết trong các Group.",
        moduleId: "groups",
        icon: icon("icon_nav_group_comment", 16, 16),
      },
      {
        id: "groups.history",
        label: "Lịch sử",
        title: "Lịch sử Spam Group",
        description: "Nhật ký đăng bài và bình luận trong các Group.",
        moduleId: "groups",
        icon: HISTORY_ICON,
      },
      {
        id: "groups.campaigns",
        label: "Quản lý chiến dịch",
        title: "Quản lý chiến dịch Spam Group",
        description: "Theo dõi, tra cứu, xem chi tiết và chạy lại các chiến dịch.",
        moduleId: "groups",
        icon: icon("icon_nav_fanpage_list", 24, 10.5),
      },
    ],
  },
  {
    id: "scan",
    label: "Quét nhóm",
    icon: icon("icon_nav_group_spam", 30, 13),
    headerIcon: icon("icon_header_flag", 21, 24),
    children: [
      {
        id: "scan.info",
        label: "Quét thông tin nhóm",
        description: "Tìm kiếm và thu thập thông tin nhóm theo từ khóa, link hoặc tệp.",
        moduleId: "scan",
        icon: icon("icon_nav_group_post", 16, 16),
      },
      {
        id: "scan.members",
        label: "Quét thành viên nhóm",
        description: "Thu thập danh sách thành viên trong các nhóm đã chọn.",
        moduleId: "scan",
        icon: icon("icon_nav_fb_accounts", 16.5417, 14.1667),
      },
      {
        id: "scan.posts",
        label: "Quét bài viết nhóm",
        description: "Thu thập bài viết trong các nhóm đã chọn.",
        moduleId: "scan",
        icon: icon("icon_nav_post_facebook", 14, 14),
      },
      {
        id: "scan.list",
        label: "Danh sách nhóm quét",
        description: "Kho nhóm đã quét được, dùng lại cho các luồng khác.",
        moduleId: "scan",
        icon: icon("icon_nav_fanpage_list", 24, 10.5),
      },
      {
        id: "scan.post_list",
        label: "Danh sách bài viết quét",
        description: "Kho bài viết đã quét từ nhóm.",
        moduleId: "scan",
        icon: icon("icon_nav_seeding_post", 16, 16),
      },
      {
        id: "scan.member_list",
        label: "Danh sách thành viên quét",
        description: "Kho thành viên đã quét từ nhóm.",
        moduleId: "scan",
        icon: icon("icon_nav_seeding_profile", 16, 13),
      },
      {
        id: "scan.history",
        label: "Lịch sử",
        title: "Lịch sử quét nhóm",
        description: "Nhật ký các phiên quét nhóm.",
        moduleId: "scan",
        icon: HISTORY_ICON,
      },
    ],
  },
  {
    id: "seeding",
    label: "Seeding Bài & Page",
    icon: icon("icon_nav_seeding", 30, 11.9251),
    children: [
      {
        id: "seeding.page",
        label: "Seeding Page",
        description: "Tăng tương tác cho Fanpage.",
        moduleId: "seeding",
        icon: icon("icon_nav_seeding_page", 14, 14),
      },
      {
        id: "seeding.profile",
        label: "Seeding Trang cá nhân",
        description: "Tăng tương tác cho trang cá nhân.",
        moduleId: "seeding",
        icon: icon("icon_nav_seeding_profile", 16, 13),
      },
      {
        id: "seeding.post",
        label: "Seeding Bài viết",
        description: "Tăng like, bình luận, chia sẻ cho bài viết.",
        moduleId: "seeding",
        icon: icon("icon_nav_seeding_post", 16, 16),
      },
      {
        id: "seeding.history",
        label: "Lịch sử",
        title: "Lịch sử Seeding",
        description: "Nhật ký các chiến dịch seeding.",
        moduleId: null,
        icon: HISTORY_ICON,
      },
    ],
  },
  {
    id: "scanner",
    label: "Quét page",
    icon: icon("icon_nav_group_spam", 30, 13),
    children: [
      {
        id: "scanner.search",
        label: "Quét thông tin page",
        title: "Quét thông tin page",
        description: "Tìm kiếm, lọc danh sách Fanpage Facebook theo từ khóa, dán danh sách link hoặc tải tệp và trích xuất dữ liệu liên hệ (Số điện thoại, Email, Website, Follower).",
        moduleId: "scanner",
        icon: icon("icon_nav_group_post", 16, 16),
      },
      {
        id: "scanner.followers",
        label: "Quét followers page",
        title: "Quét followers page",
        description: "Thu thập danh sách người theo dõi của Fanpage Facebook.",
        moduleId: null,
        icon: icon("icon_nav_group_post", 16, 16),
      },
      {
        id: "scanner.posts",
        label: "Quét bài viết page",
        title: "Quét bài viết page",
        description: "Thu thập danh sách bài viết từ Fanpage Facebook.",
        moduleId: null,
        icon: icon("icon_nav_group_post", 16, 16),
      },
      {
        id: "scanner.groups",
        label: "Danh sách nhóm page",
        title: "Danh sách nhóm page",
        description: "Quản lý danh sách nhóm đã quét.",
        moduleId: null,
        icon: icon("icon_nav_group_post", 16, 16),
      },
      {
        id: "scanner.list-posts",
        label: "Danh sách bài viết page",
        title: "Danh sách bài viết page",
        description: "Xem toàn bộ bài viết đã quét.",
        moduleId: null,
        icon: icon("icon_nav_group_post", 16, 16),
      },
      {
        id: "scanner.list-followers",
        label: "Danh sách followers page",
        title: "Danh sách followers page",
        description: "Xem toàn bộ followers đã quét.",
        moduleId: null,
        icon: icon("icon_nav_group_post", 16, 16),
      },
      {
        id: "scanner.history",
        label: "Lịch sử",
        title: "Lịch sử quét page",
        description: "Nhật ký và tiến độ các phiên quét thông tin Fanpage.",
        moduleId: "scanner",
        icon: HISTORY_ICON,
      },
    ],
  },
];

/** Trang không nằm trên Sidebar, mở từ chỗ khác (vd. bấm avatar trên Header) */
export const HIDDEN_NAV_ITEMS = [
  {
    id: "profile",
    label: "Hồ sơ cá nhân",
    description: "Quản trị thông tin xác thực tài khoản, thời hạn License và liên kết phần cứng HWID an toàn.",
    moduleId: "settings",
    icon: icon("icon_nav_profile", 30, 13),
  },
];

/** Tìm mục menu theo id, trả về { item, parent } (parent = nhóm chứa submenu, nếu có). */
export function findNavItem(id) {
  for (const item of [...NAV_ITEMS, ...HIDDEN_NAV_ITEMS]) {
    if (item.id === id) return { item, parent: null };
    const child = item.children?.find((c) => c.id === id);
    if (child) return { item: child, parent: item };
  }
  return { item: NAV_ITEMS[0], parent: null };
}

/** Đường dẫn trang của một mục menu */
export function pathOf(item) {
  if (item.path) return item.path;
  if (item.id === "dashboard") return "/";
  return "/" + item.id.replace(/\./g, "/").replace(/_/g, "-");
}

/** Tất cả mục là trang (mục lá + trang ẩn) — dùng để tạo route tĩnh khi build */
export const NAV_ROUTES = [...NAV_ITEMS, ...HIDDEN_NAV_ITEMS].flatMap((item) =>
  item.children?.length ? item.children : [item],
);

const normalizePath = (p = "/") => {
  const clean = p.split(/[?#]/)[0].replace(/\/+$/, "");
  return clean === "" ? "/" : clean;
};

/** Tìm mục menu theo đường dẫn (bỏ qua dấu "/" cuối). Không khớp -> null */
export function findNavItemByPath(pathname) {
  const target = normalizePath(pathname);
  const exact = NAV_ROUTES.find((item) => pathOf(item) === target);
  if (exact) return exact;

  // Nếu là trang con (ví dụ /groups/campaigns/camp-001 -> khớp với /groups/campaigns)
  const matches = NAV_ROUTES.filter((item) => {
    const p = pathOf(item);
    return p !== "/" && target.startsWith(p);
  });
  if (matches.length > 0) {
    // Sắp xếp lấy route dài nhất
    matches.sort((a, b) => pathOf(b).length - pathOf(a).length);
    return matches[0];
  }
  return null;
}

/** metadata (tiêu đề tab trình duyệt) cho trang của một mục menu — dùng trong các file src/app/.../page.js */
export function pageMetadata(navId) {
  const { item } = findNavItem(navId);
  return { title: `${item.title || item.label} | Facebook Automator Pro` };
}
