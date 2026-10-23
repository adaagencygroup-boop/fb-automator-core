import api from "@/services/api";
import { API_BASE } from "@/config/constants";

/**
 * Backend trả thời gian dạng UTC "naive" (không kèm múi giờ), vd "2026-10-20T03:00:00".
 * JS sẽ hiểu nhầm là giờ địa phương -> lệch 7h ở VN. Thêm "Z" để parse đúng là UTC.
 * Chuỗi đã có Z hoặc offset (+hh:mm / -hhmm) thì giữ nguyên.
 */
export function toUtcIso(value) {
  if (!value) return value;
  const s = String(value).trim();
  if (!s || s.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(s)) return s;
  return `${s}Z`;
}

/**
 * URL công khai (PUBLIC_MEDIA_BASE_URL / tunnel) chỉ dùng để Facebook tải file.
 * Hiển thị trong app thì trỏ thẳng về engine local — tránh trang cảnh báo của ngrok
 * (ngrok free trả HTML thay vì ảnh khi request đến từ trình duyệt) và đỡ tốn băng thông tunnel.
 */
export function displayMediaUrl(url) {
  const s = String(url || "");
  if (!s || s.startsWith("blob:") || s.startsWith("data:")) return s; // ảnh xem trước tại chỗ
  const i = s.indexOf("/uploads/");
  if (i === -1) return s; // file không nằm trên engine (vd ảnh khách gửi từ Facebook)
  return `${API_BASE}${s.slice(i)}`;
}

/**
 * Backend lưu đính kèm dưới dạng text có tiền tố, vd "[image] https://...".
 * Bóc ra thành { text, attachment } để hiển thị đúng ảnh/tệp thay vì in ra link.
 * Dùng chung cho cả tải lịch sử (getMessages) lẫn tin realtime qua WebSocket.
 */
/**
 * Suy ra tên tệp từ URL để khỏi phải hiện chữ "Tệp đính kèm" chung chung.
 * Backend lưu dạng "/uploads/<timestamp>_<tên gốc>" -> bỏ tiền tố timestamp.
 * Trả về "" khi URL không mang tên gốc, để chỗ hiển thị tự dùng nhãn mặc định.
 */
export function fileNameFromUrl(url) {
  const path = String(url || "").split(/[?#]/)[0];
  let base = path.slice(path.lastIndexOf("/") + 1);
  if (!base) return "";
  try {
    base = decodeURIComponent(base);
  } catch {
    /* URL encode hỏng -> giữ nguyên */
  }
  // Tệp khách gửi được tải về với tên ngẫu nhiên, tên gốc không còn trong URL
  if (/^fb_incoming_[0-9a-f]{16,}(\.|$)/i.test(base)) return "";
  return base.replace(/^\d{9,}_/, "");
}

// facebook_chat.py ghi tiền tố bằng chính attachment_type FE gửi lên
// (f"[{attachment_type}] {url}"), nên phải khớp mọi loại chứ không chỉ image/audio/file.
const ATTACHMENT_LINE = /^\[(image|audio|video|file)\]\s+(\S.*)$/;

export function parseAttachmentText(raw) {
  const value = String(raw || "");
  // sync_service có thể nối "nội dung\n[file] url" -> đính kèm luôn nằm ở dòng cuối
  const lines = value.split("\n");
  const matched = lines[lines.length - 1].trim().match(ATTACHMENT_LINE);
  if (!matched) return { text: value, attachment: null };

  const [, type, rawUrl] = matched;
  const url = rawUrl.trim();
  return {
    text: lines.slice(0, -1).join("\n").trim(),
    attachment: { type, url, name: type === "audio" ? "Voice clip" : fileNameFromUrl(url) },
  };
}

const ATTACHMENT_LABELS = {
  image: "[Hình ảnh]",
  audio: "[Tin nhắn thoại]",
  video: "[Video]",
  file: "[Tệp đính kèm]",
};

/** Nhãn ngắn cho một đính kèm, dùng ở danh sách hội thoại */
export const attachmentLabel = (type) => ATTACHMENT_LABELS[type] || ATTACHMENT_LABELS.file;

/**
 * Dòng xem trước trong danh sách hội thoại.
 * Backend lưu đính kèm dưới dạng "[image] /uploads/..." -> phải đổi thành nhãn,
 * nếu không danh sách sẽ in ra nguyên đường dẫn file.
 */
export function messagePreview(raw) {
  const { text, attachment } = parseAttachmentText(raw);
  if (text) return text;
  if (!attachment) return "";
  if (attachment.type === "file" && attachment.name) return `[Tệp] ${attachment.name}`;
  return attachmentLabel(attachment.type);
}

/**
 * Định dạng dòng xem trước tin nhắn trong danh sách hội thoại:
 * - Nếu Page gửi (isOutbound) -> "Bạn: [nội dung]"
 * - Nếu Khách gửi (!isOutbound) -> "[nội dung]" (không gắn tên khách)
 */
export function formatConversationSnippet(raw, isOutbound, customerName) {
  let snippet = messagePreview(raw);
  if (!snippet) return "";

  // Xóa tiền tố "Bạn: " hoặc "<Tên>: " nếu có để tránh lặp
  if (snippet.startsWith("Bạn: ")) {
    snippet = snippet.slice(5).trim();
  }
  const custPrefix = customerName ? `${customerName}: ` : "";
  if (custPrefix && snippet.startsWith(custPrefix)) {
    snippet = snippet.slice(custPrefix.length).trim();
  }

  if (isOutbound) {
    return `Bạn: ${snippet}`;
  }
  return snippet;
}

/**
 * Dịch lỗi Graph API sang thông báo tiếng Việt dễ hiểu + gợi ý xử lý.
 * Token Facebook (user/page access token) có hạn và sẽ hết; khi đó mọi lệnh gọi Graph đều lỗi.
 */
export function friendlyFbError(message) {
  const m = String(message || "");
  if (/token expired|revoked|session has expired|access token|oauthexception|authentication failed/i.test(m)) {
    return "Token Facebook đã hết hạn hoặc bị thu hồi. Hãy đồng bộ lại token cho tài khoản ở Quản lý tài khoản rồi thử lại.";
  }
  if (/econnrefused|local engine|không thể kết nối|network error|timeout/i.test(m)) {
    return "Không kết nối được Local Engine. Hãy kiểm tra Engine đã bật chưa rồi thử lại.";
  }
  return m || "Đã xảy ra lỗi. Vui lòng thử lại.";
}

/**
 * Lấy danh sách Fanpage từ Backend (/api/facebook/pages)
 */
export async function getChatPages(facebookUserId = null) {
  try {
    const params = facebookUserId ? { facebook_user_id: facebookUserId } : {};
    const res = await api.get("/api/facebook/pages", { params });
    const raw = Array.isArray(res) ? res : res?.pages || [];
    const pages = raw.map((p) => ({
      id: String(p.page_id),
      name: p.page_name,
      avatar: p.avatar_url || null,
      unread: 0,
      facebookUserId: p.facebook_user_id,
      status: p.status || "active",
    }));
    return { pages, total: pages.length, isMock: false };
  } catch (error) {
    console.warn("[getChatPages] Lỗi tải danh sách Page từ Backend:", error.message);
    return { pages: [], total: 0, isMock: false, error: error.message || "Không tải được danh sách Page" };
  }
}

/**
 * Kiểm tra trạng thái Module 2 (đã import tài khoản chưa, có Page chưa) (/api/facebook/status)
 */
export async function getChatStatus() {
  try {
    const res = await api.get("/api/facebook/status");
    return res || { has_accounts: false, accounts_count: 0, has_pages: false, pages_count: 0 };
  } catch (error) {
    console.warn("[getChatStatus] Lỗi kiểm tra trạng thái tài khoản:", error.message);
    return { has_accounts: false, accounts_count: 0, has_pages: false, pages_count: 0 };
  }
}

/**
 * Lấy danh sách các cuộc hội thoại (/api/facebook/conversations)
 */
export async function getConversations(params = {}) {
  try {
    const res = await api.get("/api/facebook/conversations", { params });
    const raw = Array.isArray(res) ? res : res?.conversations || [];
    const conversations = raw.map((c) => {
      const tagsArr = Array.isArray(c.tags)
        ? c.tags
        : typeof c.tags === "string" && c.tags
        ? c.tags.split(",").map((t) => t.trim()).filter(Boolean)
        : [];

      const custName = c.customer_name || `KH ${String(c.sender_id).slice(0, 8)}`;
      const isOutbound = c.direction === "outbound" || Boolean(c.is_replied);
      const formattedSnippet = formatConversationSnippet(c.last_message, isOutbound, custName);

      return {
        id: `${c.page_id}_${c.sender_id}`,
        pageId: String(c.page_id),
        pageName: c.page_name,
        customer: String(c.sender_id),
        customerName: custName,
        avatar: c.avatar_url || null,
        lastMessage: formattedSnippet,
        direction: c.direction || (isOutbound ? "outbound" : "inbound"),
        updatedAt:
          toUtcIso(c.created_at) ||
          (c.timestamp ? new Date(c.timestamp).toISOString() : new Date().toISOString()),
        unread: !c.is_read,
        replied: Boolean(c.is_replied),
        starred: Boolean(c.is_starred),
        tags: tagsArr,
      };
    });
    return { conversations, isMock: false };
  } catch (error) {
    console.warn("[getConversations] Lỗi tải hội thoại từ Backend:", error.message);
    return { conversations: [], isMock: false, error: error.message || "Không tải được hội thoại" };
  }
}

/** Một trang thông báo bằng bao nhiêu bản ghi */
export const NOTIFICATIONS_PAGE_SIZE = 25;

/** Graph trả nhiều loại, FE chỉ có 2 tab — cái gì không phải comment là tương tác */
const notificationType = (raw) => (raw === "comment" ? "comment" : "interaction");

/** Chuẩn hoá một bản ghi thông báo từ Backend */
export function mapNotification(n) {
  return {
    id: String(n.id || n.facebook_notification_id),
    rawId: String(n.facebook_notification_id || n.id || ""),
    actor: n.from_user_name || "Khách hàng",
    text: n.title || "",
    createdAt: n.created_time || new Date().toISOString(),
    // WebSocket co the khong gui `unread`; thong bao moi thi mac dinh la chua doc
    unread: n.unread !== undefined ? Boolean(n.unread) : true,
    replied: Boolean(n.is_replied),
    pageId: String(n.page_id),
    type: notificationType(n.notification_type),
    link: n.link || "",
  };
}

/**
 * Một trang thông báo (/api/facebook/notifications).
 *
 * Lọc và phân trang đều làm ở Backend: trước đây FE tải toàn bộ 1.200+ bản ghi
 * rồi tự lọc, giờ chỉ xin đúng thứ đang hiển thị.
 *
 * `unread_counts` đi kèm để badge trên hai tab con vẫn đúng, vì FE không còn
 * cả danh sách để tự đếm nữa.
 */
export async function getNotifications({
  pageId = null,
  type = null,
  filter = null,
  page = 1,
  pageSize = NOTIFICATIONS_PAGE_SIZE,
  facebookUserId = null,
} = {}) {
  try {
    const params = { page, page_size: pageSize };
    if (pageId) params.page_id = pageId;
    if (type) params.notification_type = type;
    if (filter && filter !== "all") params.filter = filter;
    if (facebookUserId) params.facebook_user_id = facebookUserId;

    const res = await api.get("/api/facebook/notifications", { params });
    const raw = Array.isArray(res) ? res : res?.items || res?.notifications || [];

    return {
      notifications: raw.map(mapNotification),
      unreadCounts: res?.unread_counts || {},
      typeCounts: res?.type_counts || {},
      total: Number(res?.total ?? raw.length) || 0,
      page: Number(res?.page ?? page) || 1,
      totalPages: Number(res?.total_pages ?? 1) || 1,
      isMock: false,
    };
  } catch (error) {
    console.warn("[getNotifications] Lỗi tải thông báo từ Backend:", error.message);
    return {
      notifications: [], unreadCounts: {}, typeCounts: {}, total: 0, page: 1, totalPages: 1,
      isMock: false, error: error.message || "Không tải được thông báo",
    };
  }
}

/**
 * Lấy lịch sử tin nhắn của một cuộc hội thoại (/api/facebook/messages)
 * conversationId định dạng: `${page_id}_${sender_id}`
 */
export async function getMessages(conversationId) {
  try {
    const parts = String(conversationId || "").split("_");
    const page_id = parts[0] || "";
    const sender_id = parts.slice(1).join("_") || "";

    const res = await api.get("/api/facebook/messages", {
      params: { page_id, sender_id },
    });

    const raw = Array.isArray(res) ? res : res?.messages || [];
    const messages = raw.map((m) => {
      const { text, attachment } = parseAttachmentText(m.text);

      return {
        id: String(m.id || m.facebook_message_id),
        direction: m.direction === "outbound" ? "out" : "in",
        text,
        attachment,
        createdAt:
          toUtcIso(m.created_at) ||
          (m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString()),
        reaction: m.reactions || null,
        status: "sent",
      };
    });
    return { messages, isMock: false };
  } catch (error) {
    console.warn("[getMessages] Lỗi tải tin nhắn từ Backend:", error.message);
    return { messages: [], isMock: false, error: error.message || "Không tải được tin nhắn" };
  }
}

/**
 * Gửi tin nhắn trả lời khách hàng (/api/facebook/send-reply)
 */
export async function sendMessage(conversationId, payload) {
  const parts = String(conversationId || "").split("_");
  const page_id = parts[0] || "";
  const recipient_id = parts.slice(1).join("_") || "";

  // Đính kèm: backend nhận form-data (Form/File), KHÔNG phải query params.
  // Có file thật -> upload thẳng (blob: URL của trình duyệt Facebook không tải được).
  if (payload.attachment?.file) {
    const form = new FormData();
    form.append("page_id", page_id);
    form.append("recipient_id", recipient_id);
    form.append("attachment_type", payload.attachment.type || "file");
    if (payload.replyToId) form.append("reply_to_message_id", payload.replyToId);
    form.append("file", payload.attachment.file, payload.attachment.name || payload.attachment.file.name);

    // Content-Type undefined -> trình duyệt tự đặt multipart kèm boundary
    const res = await api.post("/api/facebook/send-attachment", form, {
      headers: { "Content-Type": undefined },
    });
    return { success: true, message: { status: undefined, id: res?.data?.message_id }, url: res?.url };
  }

  // Đính kèm bằng URL công khai (không nhận blob: vì Facebook không tải được)
  if (payload.attachment?.url && !String(payload.attachment.url).startsWith("blob:")) {
    const form = new FormData();
    form.append("page_id", page_id);
    form.append("recipient_id", recipient_id);
    form.append("attachment_type", payload.attachment.type || "image");
    form.append("url", payload.attachment.url);
    if (payload.replyToId) form.append("reply_to_message_id", payload.replyToId);

    const res = await api.post("/api/facebook/send-attachment-url", form, {
      headers: { "Content-Type": undefined },
    });
    return { success: true, message: { status: undefined, id: res?.data?.message_id } };
  }

  const res = await api.post("/api/facebook/send-reply", {
    page_id,
    recipient_id,
    text: payload.text || "",
    reply_to_message_id: payload.replyToId || null,
  });

  return { success: true, message: { status: undefined, id: res?.data?.message_id } };
}

/**
 * Bật / tắt đánh dấu sao ⭐ hội thoại (/api/facebook/conversations/star)
 */
export async function setConversationStarred(conversationId, starred) {
  const parts = String(conversationId || "").split("_");
  const page_id = parts[0] || "";
  const customer_psid = parts.slice(1).join("_") || "";

  return api.post("/api/facebook/conversations/star", {
    page_id,
    customer_psid,
    is_starred: Boolean(starred),
  });
}

/**
 * Gắn nhãn phân loại hội thoại (/api/facebook/conversations/tag)
 */
export async function setConversationTags(conversationId, tags) {
  const parts = String(conversationId || "").split("_");
  const page_id = parts[0] || "";
  const customer_psid = parts.slice(1).join("_") || "";
  const tagsStr = Array.isArray(tags) ? tags.join(", ") : String(tags || "");

  return api.post("/api/facebook/conversations/tag", {
    page_id,
    customer_psid,
    tags: tagsStr,
  });
}

/**
 * Bày tỏ cảm xúc emoji tin nhắn (/api/facebook/messages/{message_id}/react)
 */
export async function reactToMessage(conversationId, messageId, reaction) {
  const parts = String(conversationId || "").split("_");
  const page_id = parts[0] || "";
  const recipient_id = parts.slice(1).join("_") || "";

  return api.post(`/api/facebook/messages/${messageId}/react`, {
    page_id,
    recipient_id,
    reaction,
  });
}

/**
 * Đánh dấu hội thoại đã đọc (/api/facebook/conversations/{page_id}/{sender_id}/read)
 */
export async function markConversationRead(conversationId) {
  const parts = String(conversationId || "").split("_");
  const page_id = parts[0] || "";
  const sender_id = parts.slice(1).join("_") || "";

  return api.put(`/api/facebook/conversations/${page_id}/${sender_id}/read`);
}

/**
 * Đánh dấu hội thoại chưa đọc (/api/facebook/conversations/{page_id}/{sender_id}/unread)
 */
export async function markConversationUnread(conversationId) {
  const parts = String(conversationId || "").split("_");
  const page_id = parts[0] || "";
  const sender_id = parts.slice(1).join("_") || "";

  return api.put(`/api/facebook/conversations/${page_id}/${sender_id}/unread`);
}


/**
 * Đánh dấu thông báo đã đọc (/api/facebook/notifications/{notif_id}/read)
 */
export async function markNotificationRead(notifId) {
  return api.put(`/api/facebook/notifications/${notifId}/read`);
}

/**
 * Reset dữ liệu hội thoại & Page (/api/facebook/reset)
 */
export async function resyncChatData() {
  return api.post("/api/facebook/reset").catch(() => ({ success: false }));
}

/**
 * Đồng bộ Fanpage từ User Token (/api/facebook/sync-by-token)
 */
export async function syncByToken(accessToken) {
  return api.post("/api/facebook/sync-by-token", { access_token: accessToken });
}

/**
 * Tách post_id (dạng `{page_id}_{số}`) từ một thông báo.
 * Backend nhúng post_id vào facebook_notification_id khi đồng bộ:
 *   react_{post_id}_{userId} · react_sum_{post_id} · share_{post_id} · post_created_{post_id}
 *   comment id: {page_id}_{post}_{comment}
 * Ưu tiên dò theo page_id, sau đó fallback phân tích link.
 */
export function postIdFromNotification(notification) {
  if (!notification) return "";
  const pageId = String(notification.pageId || notification.page_id || "");
  const rawId = String(notification.facebookNotificationId || notification.rawId || notification.id || "");

  if (pageId) {
    const escaped = pageId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = rawId.match(new RegExp(`${escaped}_(\\d+)`));
    if (m) return `${pageId}_${m[1]}`;
  }

  const link = String(notification.link || "");
  const pair = link.match(/(\d+_\d+)/);
  if (pair) return pair[1];
  const story = link.match(/story_fbid=(\d+)/) || link.match(/\/posts\/(\d+)/) || link.match(/\/(\d+)(?:[/?]|$)/);
  if (story) return pageId ? `${pageId}_${story[1]}` : story[1];
  return "";
}

/**
 * Lấy chi tiết bài viết (nội dung, media, reaction/comment/share, danh sách bình luận).
 * Trả về payload Graph API; cờ `is_external = true` cho bài trong Nhóm / Trang khác.
 *
 * `order` là thứ tự bình luận, chuyển thẳng cho Graph.
 */
export async function getPostDetails(postId, pageId, order) {
  const params = { page_id: pageId };
  if (order) params.order = order;

  const res = await api.get(`/api/facebook/posts/${encodeURIComponent(postId)}`, { params });
  return res || {};
}

/** Hai giá trị của tham số `order` trên cạnh page-post/comments */
export const COMMENT_SORTS = [
  { value: "reverse_chronological", label: "Mới nhất" },
  { value: "chronological", label: "Cũ nhất" },
];

export const DEFAULT_COMMENT_SORT = COMMENT_SORTS[0].value;

/**
 * Một trang bình luận GỐC của bài viết, kèm vài câu trả lời đầu mỗi bình luận.
 * `after` là con trỏ lấy từ `paging.cursors.after` của trang trước.
 */
export async function getPostComments(postId, pageId, { order, after, limit } = {}) {
  const params = { page_id: pageId };
  if (order) params.order = order;
  if (after) params.after = after;
  if (limit) params.limit = limit;

  const res = await api.get(`/api/facebook/posts/${encodeURIComponent(postId)}/comments`, { params });
  return res || {};
}

/**
 * Những người đã thả cảm xúc lên bài viết, lọc được theo `type`.
 *
 * Facebook CHሆ trả về những người mà app được phép nhìn thấy, nên `data` có thể
 * rỗng trong khi `summary.total_count` vẫn có số thật — nơi gọi phải chịu được.
 */
export async function getPostReactions(postId, pageId, { type, after, limit } = {}) {
  const params = { page_id: pageId };
  if (type && type !== "all") params.type = String(type).toUpperCase();
  if (after) params.after = after;
  if (limit) params.limit = limit;

  const res = await api.get(`/api/facebook/posts/${encodeURIComponent(postId)}/reactions`, { params });
  return res || {};
}

/** Câu trả lời dưới một bình luận (mọi cấp con, gộp phẳng) */
export async function getCommentReplies(commentId, pageId, { after, limit } = {}) {
  const params = { page_id: pageId };
  if (after) params.after = after;
  if (limit) params.limit = limit;

  const res = await api.get(`/api/facebook/posts/${encodeURIComponent(commentId)}/replies`, { params });
  return res || {};
}

/** Bình luận công khai dưới tên Page (dùng post_id để bình luận thẳng vào bài, hoặc comment_id để trả lời) */
export async function replyToComment(objectId, pageId, text, attachmentUrl) {
  return api.post(`/api/facebook/comments/${encodeURIComponent(objectId)}/reply`, {
    page_id: pageId,
    text,
    attachment_url: attachmentUrl || null,
  });
}

/** Trả lời riêng (vào hộp thư) cho người bình luận */
export async function privateReplyToComment(commentId, pageId, text) {
  return api.post(`/api/facebook/comments/${encodeURIComponent(commentId)}/private-reply`, {
    page_id: pageId,
    text,
  });
}

/**
 * Ẩn hoặc bỏ ẩn một bình luận trên Facebook.
 *
 * Ẩn rồi thì chỉ người viết và bạn bè họ còn thấy, người ngoài không thấy nữa.
 * Đây là thao tác đảo ngược được — khác hẳn xoá.
 */
export async function hideComment(commentId, pageId, isHidden = true) {
  return api.post(`/api/facebook/comments/${encodeURIComponent(commentId)}/hide`, {
    page_id: pageId,
    is_hidden: isHidden,
  });
}

/** Xoá hẳn một bình luận — KHÔNG đảo ngược được */
export async function deleteComment(commentId, pageId) {
  return api.delete(`/api/facebook/comments/${encodeURIComponent(commentId)}`, {
    params: { page_id: pageId },
  });
}

/** Thích (liked=true) hoặc bỏ thích bài viết dưới tên Page */
export async function setPostLike(postId, pageId, liked = true) {
  return api.post(`/api/facebook/posts/${encodeURIComponent(postId)}/like`, {
    page_id: pageId,
    liked,
  });
}

/** Bày tỏ cảm xúc cho một bình luận dưới tên Page */
export async function reactToComment(commentId, pageId, reaction = "LIKE", liked = true) {
  return api.post(`/api/facebook/comments/${encodeURIComponent(commentId)}/react`, {
    page_id: pageId,
    reaction,
    liked,
  });
}
