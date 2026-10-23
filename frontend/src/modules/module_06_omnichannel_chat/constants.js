/** Bộ lọc dùng chung cho Hội thoại và Thông báo */
export const CONVERSATION_FILTERS = [
  { id: "all", label: "Tất cả" },
  { id: "unread", label: "Chưa xem" },
  { id: "unreplied", label: "Chưa trả lời" },
];

/** Nhãn gắn cho hội thoại (nút "Tag" trên đầu khung chat) */
export const CONVERSATION_TAGS = [
  { id: "potential", label: "Khách tiềm năng", className: "bg-purple-50 text-purple-700 border-purple-200" },
  { id: "ordered", label: "Đã chốt đơn", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { id: "callback", label: "Cần gọi lại", className: "bg-amber-50 text-amber-700 border-amber-200" },
  { id: "spam", label: "Spam", className: "bg-slate-100 text-slate-600 border-slate-200" },
];

/** 6 cảm xúc thả vào tin nhắn — đúng bộ của Messenger (bảng emoji ô nhập dùng emoji-picker-react) */
export const REACTIONS = ["👍", "❤️", "😆", "😮", "😢", "😡"];

/** Facebook chỉ cho Page nhắn tin tự do trong 24 giờ kể từ tin nhắn cuối của khách */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
