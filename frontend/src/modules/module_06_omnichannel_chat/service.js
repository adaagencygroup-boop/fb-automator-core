import api from "@/services/api";
import { MOCK_PAGES, MOCK_TOTAL_PAGES, MOCK_CONVERSATIONS, MOCK_NOTIFICATIONS, buildMockMessages } from "./mockData";

// Khi Local Engine chưa chạy / chưa có API, trả dữ liệu mẫu để dựng giao diện.
// `isMock: true` giúp màn hình biết đang hiển thị dữ liệu mẫu.

export async function getChatPages() {
  return api
    .get("/api/chat/pages")
    .catch(() => ({ pages: MOCK_PAGES, total: MOCK_TOTAL_PAGES, isMock: true }));
}

export async function getConversations(params = {}) {
  return api
    .get("/api/chat/conversations", { params })
    .catch(() => ({ conversations: MOCK_CONVERSATIONS, isMock: true }));
}

export async function getNotifications() {
  return api
    .get("/api/chat/notifications")
    .catch(() => ({ notifications: MOCK_NOTIFICATIONS, isMock: true }));
}

/** "Reset dữ liệu": yêu cầu Engine đồng bộ lại toàn bộ Page & hội thoại */
export async function resyncChatData() {
  return api.post("/api/chat/resync").catch(() => ({ success: false, isMock: true }));
}

/** Tin nhắn của một hội thoại (cũ -> mới) */
export async function getMessages(conversationId) {
  return api
    .get(`/api/chat/conversations/${conversationId}/messages`)
    .catch(() => ({ messages: buildMockMessages(conversationId), isMock: true }));
}

/**
 * Gửi tin nhắn từ Page. payload: { text, attachment?, replyToId? }
 * Không trả dữ liệu mẫu khi lỗi: màn hình sẽ đánh dấu tin nhắn "Gửi lỗi".
 * (Khi đang xem dữ liệu mẫu, màn hình tự giả lập gửi và không gọi hàm này.)
 * TODO: tệp đính kèm cần API upload riêng — hiện `attachment.url` chỉ là link tạm trên trình duyệt.
 */
export async function sendMessage(conversationId, payload) {
  return api.post(`/api/chat/conversations/${conversationId}/messages`, payload);
}

/** Gắn / bỏ sao hội thoại */
export async function setConversationStarred(conversationId, starred) {
  return api.post(`/api/chat/conversations/${conversationId}/star`, { starred });
}

/** Cập nhật nhãn của hội thoại */
export async function setConversationTags(conversationId, tags) {
  return api.post(`/api/chat/conversations/${conversationId}/tags`, { tags });
}
