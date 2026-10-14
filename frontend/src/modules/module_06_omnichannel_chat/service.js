import api from "@/services/api";

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
    return { pages: [], total: 0, isMock: false };
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

      return {
        id: `${c.page_id}_${c.sender_id}`,
        pageId: String(c.page_id),
        pageName: c.page_name,
        customer: String(c.sender_id),
        customerName: c.customer_name || `KH ${String(c.sender_id).slice(0, 8)}`,
        avatar: c.avatar_url || null,
        lastMessage: c.last_message || "",
        updatedAt:
          c.created_at ||
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
    return { conversations: [], isMock: false };
  }
}

/**
 * Lấy danh sách thông báo tương tác & bình luận (/api/facebook/notifications)
 */
export async function getNotifications(facebookUserId = null) {
  try {
    const params = facebookUserId ? { facebook_user_id: facebookUserId } : {};
    const res = await api.get("/api/facebook/notifications", { params });
    const raw = Array.isArray(res) ? res : res?.notifications || [];
    const notifications = raw.map((n) => ({
      id: String(n.id || n.facebook_notification_id),
      actor: n.from_user_name || "Khách hàng",
      text: n.title || "",
      createdAt: n.created_time || new Date().toISOString(),
      unread: Boolean(n.unread),
      replied: Boolean(n.is_replied),
      pageId: String(n.page_id),
      type: n.notification_type === "comment" ? "comment" : "interaction",
      link: n.link || "",
    }));
    return { notifications, isMock: false };
  } catch (error) {
    console.warn("[getNotifications] Lỗi tải thông báo từ Backend:", error.message);
    return { notifications: [], isMock: false };
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
      let text = m.text || "";
      let attachment = null;
      if (text.startsWith("[image] ")) {
        attachment = { type: "image", url: text.replace("[image] ", "").trim() };
        text = "";
      } else if (text.startsWith("[audio] ")) {
        attachment = { type: "audio", url: text.replace("[audio] ", "").trim(), name: "Voice clip" };
        text = "";
      } else if (text.startsWith("[file] ")) {
        attachment = { type: "file", url: text.replace("[file] ", "").trim(), name: "Tệp đính kèm" };
        text = "";
      }

      return {
        id: String(m.id || m.facebook_message_id),
        direction: m.direction === "outbound" ? "out" : "in",
        text,
        attachment,
        createdAt:
          m.created_at ||
          (m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString()),
        reaction: m.reactions || null,
        status: "sent",
      };
    });
    return { messages, isMock: false };
  } catch (error) {
    console.warn("[getMessages] Lỗi tải tin nhắn từ Backend:", error.message);
    return { messages: [], isMock: false };
  }
}

/**
 * Gửi tin nhắn trả lời khách hàng (/api/facebook/send-reply)
 */
export async function sendMessage(conversationId, payload) {
  const parts = String(conversationId || "").split("_");
  const page_id = parts[0] || "";
  const recipient_id = parts.slice(1).join("_") || "";

  if (payload.attachment?.url) {
    const res = await api.post("/api/facebook/send-attachment-url", null, {
      params: {
        page_id,
        recipient_id,
        attachment_type: payload.attachment.type || "image",
        url: payload.attachment.url,
        reply_to_message_id: payload.replyToId || undefined,
      },
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
