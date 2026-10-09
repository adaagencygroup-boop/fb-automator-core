/**
 * VÙNG HÌNH THẬT (glyph bounding box) CỦA TỪNG ICON MENU — đo tự động từ file SVG gốc trong /public/icons.
 * Bộ icon cũ của Figma có sẵn khoảng trống trong file (vd. 30×13 nhưng hình chỉ 16×13),
 * nên FitMaskIcon dùng số đo này để phóng/thu mọi icon về cùng một kích thước hiển thị.
 * Thêm icon mới: ghi [x, y, rộng, cao] của phần hình vẽ (không tính khoảng trống).
 */
export const ICON_GLYPHS = {
  icon_nav_account_engage: [0, 0, 13.333, 10.667],
  icon_nav_ai_post: [0, 0, 15, 12],
  icon_nav_chat: [0, 0, 16.25, 13],
  icon_nav_fanpage: [0, 0, 11.375, 13],
  icon_nav_fanpage_list: [0, 0, 13.5, 10.5],
  icon_nav_fb_accounts: [0, 0, 16.542, 14.167],
  icon_nav_group_comment: [0.669, 0.665, 14.667, 14.667],
  icon_nav_group_post: [0.669, 0.665, 14.668, 14.668],
  icon_nav_group_spam: [0, 0, 16.25, 13],
  icon_nav_history: [0, 0, 15, 15],
  icon_nav_interact: [0, 0, 15.843, 16.667],
  icon_nav_overview: [0, 0, 15, 15],
  icon_nav_page_creator: [0, 0, 15, 15],
  icon_nav_post_facebook: [0, 0, 14, 14],
  icon_nav_profile: [0, 0, 13, 13],
  icon_nav_reels: [0, 0, 12, 10.5],
  icon_nav_seeding: [0, 0, 14.625, 11.925],
  icon_nav_seeding_page: [-0.003, 0.001, 13.333, 13.333],
  icon_nav_seeding_post: [2.064, 0.732, 11.872, 14.533],
  icon_nav_seeding_profile: [0, 0, 15.75, 12.25],
  icon_nav_tiktok: [0, 0, 12, 12.005],
  icon_nav_youtube_shorts: [0, 0, 12.797, 9],
};
