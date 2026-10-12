/**
 * DỮ LIỆU MẪU cho màn Quản lý Chat Page (lấy theo Figma 1072:11951).
 * Chỉ dùng khi Local Engine chưa trả dữ liệu thật (xem service.js).
 *
 * Page:
 *  - avatar   : link ảnh đại diện Page (null -> dùng `initials` hoặc icon mặc định).
 *               Dữ liệu mẫu dùng ảnh giữ chỗ của placehold.co.
 *  - initials : { text, bg, fg } chữ viết tắt khi Page chưa có ảnh
 *  - unread   : số hội thoại chưa đọc (0 -> chấm xanh = đang kết nối)
 *  - alert    : true -> badge đỏ (cần xử lý gấp)
 *
 * Conversation:
 *  - unread  : khách gửi mà chưa xem
 *  - replied : đã có phản hồi từ Page
 */

/** Ảnh giữ chỗ (placehold.co) — 64×64 để hiển thị nét ở khung 32px */
const placeholder = (text, bg = "cbd5e1", fg = "334155") =>
  `https://placehold.co/64x64/${bg}/${fg}/png?text=${encodeURIComponent(text)}&font=roboto`;

export const MOCK_PAGES = [
  { id: "p01", name: "Travel 24h", avatar: placeholder("T24", "bfdbfe", "1d4ed8"), unread: 12 },
  { id: "p02", name: "Du Lịch Tự Túc", avatar: placeholder("DL", "bbf7d0", "15803d"), unread: 5 },
  { id: "p03", name: "Ẩm Thực Việt", avatar: placeholder("AT", "fed7aa", "c2410c"), unread: 1 },
  { id: "p04", name: "Review Khách Sạn Đẹp", avatar: placeholder("RK", "e9d5ff", "7e22ce"), unread: 0 },
  { id: "p05", name: "Khám Phá Thế Giới", avatar: placeholder("KP", "a5f3fc", "0e7490"), unread: 3 },
  { id: "p06", name: "Đẹp Mỗi Ngày", initials: { text: "D", bg: "#fef3c7", fg: "#d97706" }, unread: 0 },
  { id: "p07", name: "Đi Đâu Hôm Nay", avatar: placeholder("DD", "fecdd3", "be123c"), unread: 0 },
  { id: "p08", name: "Việt Nam Trong Tôi", avatar: placeholder("VN", "fde68a", "b45309"), unread: 0 },
  { id: "p09", name: "Bí Quyết Sức Khoẻ", avatar: placeholder("SK", "bbf7d0", "166534"), unread: 2, alert: true },
  { id: "p10", name: "Góc Nhìn Xã Hội", initials: { text: "G", bg: "#e2e8f0", fg: "#475569" }, unread: 0 },
  { id: "p11", name: "Street Style VN", avatar: placeholder("SS", "e2e8f0", "334155"), unread: 0 },
  { id: "p12", name: "BDS Insight", initials: { text: "BDS", bg: "#44403c", fg: "#ffffff", small: true }, unread: 0 },
  { id: "p13", name: "Giao Tiếp Tiếng Anh", unread: 0 },
  { id: "p14", name: "Tư Vấn Pháp Luật", initials: { text: "T", bg: "#dbeafe", fg: "#2563eb" }, unread: 1 },
  { id: "p16", name: "Học Tiếng Anh Mỗi Ngày", initials: { text: "H", bg: "#e0e7ff", fg: "#4338ca" }, unread: 0 },
  { id: "p15", name: "Pháp Lý Việt Nam", initials: { text: "P", bg: "#dcfce7", fg: "#16a34a" }, unread: 1 },
];

export const MOCK_TOTAL_PAGES = 100;

/** Thời điểm cách đây `minutes` phút (để giờ hiển thị & đếm ngược 24h luôn hợp lý) */
const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

/**
 * Conversation (thêm):
 *  - customerName : tên Facebook của khách (null -> chỉ hiện "Khách hàng (mã...)")
 *  - psid         : Page-Scoped ID của khách
 *  - avatar       : ảnh đại diện khách (placehold.co)
 *  - starred      : đã gắn sao
 */
const customerAvatar = (name, bg = "e2e8f0", fg = "475569") =>
  placeholder(
    String(name || "KH")
      .split(/\s+/)
      .map((w) => w[0])
      .slice(-2)
      .join("")
      .toUpperCase(),
    bg,
    fg,
  );

export const MOCK_CONVERSATIONS = [
  { id: "c01", starred: true, customer: "29224347812", psid: "2922434737150256", customerName: "Thuần Nguyễn", avatar: customerAvatar("Thuần Nguyễn", "fde68a", "92400e"), pageId: "p14", lastMessage: "Em vay 6 triệu một tháng đóng một triệu hai có cao không ạ?", updatedAt: ago(8), unread: true, replied: false },
  { id: "c02", customer: "39061831205", psid: "3906183120598841", customerName: "Lê Minh Anh", avatar: customerAvatar("Lê Minh Anh", "bfdbfe", "1d4ed8"), pageId: "p11", lastMessage: "[Hình ảnh]", updatedAt: ago(10), unread: true, replied: false },
  { id: "c03", customer: "28682018734", psid: "2868201873440127", customerName: null, avatar: null, pageId: "p12", lastMessage: "ban oiiiii", updatedAt: ago(12), unread: false, replied: false },
  { id: "c04", customer: "29561441093", psid: "2956144109327705", customerName: "Kim Nguyen", avatar: customerAvatar("Kim Nguyen", "bbf7d0", "166534"), pageId: "p15", lastMessage: "Chào bạn, mình có 3 miếng đất ở bên Việt Nam cần tư vấn thủ tục", updatedAt: ago(25), unread: false, replied: false },
  { id: "c05", customer: "28740239561", psid: "2874023956103318", customerName: "Hoàng Long", avatar: customerAvatar("Hoàng Long", "e9d5ff", "7e22ce"), pageId: "p13", lastMessage: "Alo a", updatedAt: ago(39), unread: true, replied: false },
  { id: "c06", customer: "28516433870", psid: "2851643387061902", customerName: "Bác Tư", avatar: customerAvatar("Bác Tư", "fed7aa", "c2410c"), pageId: "p09", lastMessage: "Sản phẩm này dùng cho người lớn tuổi được không shop?", updatedAt: ago(60), unread: false, replied: true },
  { id: "c07", customer: "35003066412", psid: "3500306641285530", customerName: "Mai Hồng", avatar: customerAvatar("Mai Hồng", "fecdd3", "be123c"), pageId: "p13", lastMessage: "Bé nhà mình mới học, có lớp giao tiếp cơ bản không ạ?", updatedAt: ago(82), unread: false, replied: true },
  { id: "c08", customer: "31277450021", psid: "3127745002179964", customerName: "Quốc Bảo", avatar: customerAvatar("Quốc Bảo", "a5f3fc", "0e7490"), pageId: "p01", lastMessage: "Tour Đà Lạt 3 ngày 2 đêm còn chỗ cuối tuần này không?", updatedAt: ago(110), unread: true, replied: false },
  { id: "c09", customer: "30118725590", psid: "3011872559014473", customerName: "Thanh Hà", avatar: customerAvatar("Thanh Hà", "e0e7ff", "4338ca"), pageId: "p02", lastMessage: "Cảm ơn ad nhiều nha 😊", updatedAt: ago(138), unread: false, replied: true },
];

/**
 * Tin nhắn trong khung chat (Figma "giao diện chat" 1072:12415).
 *  - direction  : "in" = khách gửi, "out" = Page trả lời
 *  - text       : nội dung (có thể rỗng nếu chỉ có tệp)
 *  - attachment : { type: "image" | "file", url, name } (tuỳ chọn)
 *  - replyTo    : { id, text } tin nhắn được trả lời (tuỳ chọn)
 */
const shift = (iso, minutes) => new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
const daysAgo = (days, h, m) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const CUSTOM_THREADS = {
  c01: [
    { id: "m01", direction: "in", text: "Chào page, cho em hỏi về vay tín chấp ạ", createdAt: daysAgo(1, 21, 40) },
    { id: "m02", direction: "out", text: "Chào bạn, Tư Vấn Pháp Luật xin nghe ạ.", createdAt: daysAgo(1, 21, 46) },
    { id: "m03", direction: "out", text: "Bạn cần tư vấn khoản vay bao nhiêu và trả trong bao lâu ạ?", createdAt: daysAgo(1, 21, 46) },
    { id: "m04", direction: "in", text: "Dạ để em xem lại hợp đồng rồi nhắn page sau nha", createdAt: daysAgo(1, 21, 52) },
    { id: "m05", direction: "in", text: "Em vay 6 triệu một tháng đóng một triệu hai có cao không ạ?", createdAt: ago(8) },
  ],
  c02: [
    { id: "m01", direction: "in", text: "Shop ơi mẫu này còn size M không ạ?", createdAt: ago(11) },
    {
      id: "m02",
      direction: "in",
      text: "",
      attachment: { type: "image", url: "https://placehold.co/480x320/e2e8f0/475569/png?text=%E1%BA%A2nh+kh%C3%A1ch+g%E1%BB%ADi&font=roboto", name: "anh-mau.png" },
      createdAt: ago(10),
    },
  ],
};

const REPLY_SAMPLE = "Dạ page đã nhận được tin nhắn, bạn chờ chút để bên mình kiểm tra nhé ạ.";

/** Hội thoại không có kịch bản riêng: tin cuối của khách (+ 1 tin trả lời nếu đã phản hồi) */
export function buildMockMessages(conversationId) {
  if (CUSTOM_THREADS[conversationId]) return CUSTOM_THREADS[conversationId];
  const c = MOCK_CONVERSATIONS.find((x) => x.id === conversationId);
  if (!c) return [];
  const thread = [{ id: "m01", direction: "in", text: c.lastMessage, createdAt: c.updatedAt }];
  if (c.replied) thread.push({ id: "m02", direction: "out", text: REPLY_SAMPLE, createdAt: shift(c.updatedAt, 2) });
  return thread;
}

/**
 * Thông báo (Figma "Thông báo"): type "comment" = Bình luận, "interaction" = Tương tác bài viết.
 *  - actor   : người tương tác (actorColor = chỉ số màu avatar theo Figma, bỏ trống -> tự chọn theo tên)
 *  - text    : nội dung hiển thị sau tên (có thể chứa "[Trang]")
 *  - unread  : chưa xem (chấm xanh)
 *  - replied : đã xử lý / đã trả lời (dấu ✓)
 */
const at = (h, m, s) => new Date(2026, 9, 8, h, m, s).toISOString();

export const MOCK_NOTIFICATIONS = [
  { id: "n01", actorColor: 0, type: "interaction", actor: "Phạm Trang", text: "[Trang] đã bày tỏ cảm xúc “thích”", pageId: "p09", createdAt: at(15, 43, 27), unread: false, replied: true },
  { id: "n02", actorColor: 0, type: "interaction", actor: "Hương", text: "[Trang] đã bày tỏ cảm xúc “thích”", pageId: "p13", createdAt: at(15, 29, 18), unread: true, replied: false },
  { id: "n03", actorColor: 0, type: "interaction", actor: "Hương Hoàng", text: "[Trang] đã bày tỏ cảm xúc “thích”", pageId: "p13", createdAt: at(14, 59, 10), unread: false, replied: true },
  { id: "n04", actorColor: 1, type: "interaction", actor: "Mucelib Ahmedov", text: "[Trang] đã cập nhật một video mới", pageId: "p16", createdAt: at(14, 57, 41), unread: false, replied: true },
  { id: "n05", actorColor: 2, type: "interaction", actor: "Tru Nguyen", text: "[Trang] đã bày tỏ cảm xúc “thích”", pageId: "p09", createdAt: at(14, 44, 18), unread: false, replied: true },
  { id: "n06", actorColor: 3, type: "interaction", actor: "Lâm Huyền", text: "[Trang] đã bày tỏ cảm xúc “thích”", pageId: "p09", createdAt: at(14, 28, 53), unread: false, replied: true },
  { id: "n07", actorColor: 4, type: "interaction", actor: "Daniel Manolescu", text: "[Trang] đã cập nhật một video mới", pageId: "p16", createdAt: at(14, 19, 57), unread: false, replied: true },
  { id: "n08", actorColor: 0, type: "interaction", actor: "Manh Cuong", text: "[Trang] đã bày tỏ cảm xúc “thích”", pageId: "p05", createdAt: at(14, 4, 50), unread: false, replied: true },
  { id: "n09", type: "comment", actor: "Nguyễn Lan", text: "đã bình luận: “Tour này còn chỗ cho 2 người không ạ?”", pageId: "p01", createdAt: at(15, 12, 5), unread: false, replied: false },
  { id: "n10", type: "comment", actor: "Trần Bảo", text: "đã bình luận: “Xin giá chi tiết qua inbox nhé”", pageId: "p03", createdAt: at(13, 47, 33), unread: false, replied: true },
];
