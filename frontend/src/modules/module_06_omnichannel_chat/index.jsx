"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getChatPages,
  getConversations,
  getMessages,
  getNotifications,
  resyncChatData,
  sendMessage,
  setConversationStarred,
  setConversationTags,
  markConversationRead,
  markNotificationRead,
  reactToMessage,
} from "./service";
import PageList from "./components/PageList";
import ConversationList from "./components/ConversationList";
import ChatWindow, { ChatPlaceholder } from "./components/ChatWindow";

// Figma: "Quản lý chat Page" (1072:11951) — OmnichannelPanels (1072:12081)
// 3 cột: (1) Danh sách Page · (2) Khung chat (1072:12415) · (3) Hội thoại / Thông báo

async function fetchAll() {
  const [p, c, n] = await Promise.all([getChatPages(), getConversations(), getNotifications()]);
  return { p, c, n };
}

const normalize = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();

export default function OmnichannelChatModule() {
  const [pages, setPages] = useState([]);
  const [totalPages, setTotalPages] = useState(0);
  const [conversations, setConversations] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [isMock, setIsMock] = useState(false);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);

  const [activePageId, setActivePageId] = useState(null); // null = tất cả các trang
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("conversations");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [notificationType, setNotificationType] = useState("interaction");
  const [notificationFilter, setNotificationFilter] = useState("all");
  // Tin nhắn đã tải, theo id hội thoại (chưa có key = chưa tải)
  const [messagesByConversation, setMessagesByConversation] = useState({});
  const loadingMessages = useRef(new Set());

  const applyData = ({ p, c, n }) => {
    setPages(p.pages || []);
    setTotalPages(p.total ?? (p.pages || []).length);
    setConversations(c.conversations || []);
    setNotifications(n.notifications || []);
    setIsMock(Boolean(p.isMock || c.isMock));
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    fetchAll().then((data) => !cancelled && applyData(data));
    return () => {
      cancelled = true;
    };
  }, []);

  // Lắng nghe sự kiện Realtime (Tin nhắn & Thông báo mới) từ WebSocket Backend
  useEffect(() => {
    let ws = null;
    let timer = null;
    let destroyed = false;

    const connectWs = () => {
      if (destroyed) return;
      try {
        const host = typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
        const proto = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
        ws = new WebSocket(`${proto}//${host}:28129/api/facebook/ws/all`);

        ws.onopen = () => {
          timer = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "ping" }));
            }
          }, 25000);
        };

        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            if (payload.type === "message" && payload.data) {
              const msgData = payload.data;
              const convId = `${msgData.page_id}_${msgData.sender_id}`;
              const incomingMsg = {
                id: String(msgData.id || msgData.facebook_message_id),
                direction: msgData.direction === "outbound" ? "out" : "in",
                text: msgData.text || "",
                createdAt: msgData.created_at || new Date().toISOString(),
              };

              // Thêm tin nhắn mới vào cuộc hội thoại
              setMessagesByConversation((all) => {
                const currentList = all[convId] || [];
                if (currentList.some((m) => m.id === incomingMsg.id)) return all;
                return { ...all, [convId]: [...currentList, incomingMsg] };
              });

              // Cập nhật thẻ hội thoại ở sidebar
              setConversations((list) => {
                const exists = list.some((c) => c.id === convId);
                const isCurrentActive = activeConversationId === convId;
                const snippet = msgData.text || "[Hình ảnh/Tệp đính kèm]";
                const lastMsgText = msgData.direction === "outbound" ? `Bạn: ${snippet}` : snippet;

                if (exists) {
                  const target = list.find((c) => c.id === convId);
                  const rest = list.filter((c) => c.id !== convId);
                  const updated = {
                    ...target,
                    lastMessage: lastMsgText,
                    updatedAt: incomingMsg.createdAt,
                    unread: isCurrentActive ? false : msgData.direction === "inbound",
                    replied: msgData.direction === "outbound",
                  };
                  return [updated, ...rest];
                } else {
                  const newConv = {
                    id: convId,
                    pageId: String(msgData.page_id),
                    senderId: String(msgData.sender_id),
                    customer: String(msgData.sender_id),
                    customerName: msgData.sender_name || `KH: ${String(msgData.sender_id).slice(0, 8)}`,
                    avatar: msgData.avatar_url || null,
                    lastMessage: lastMsgText,
                    updatedAt: incomingMsg.createdAt,
                    unread: !isCurrentActive && msgData.direction === "inbound",
                    replied: msgData.direction === "outbound",
                    tags: [],
                    starred: false,
                  };
                  return [newConv, ...list];
                }
              });
            } else if (payload.type === "notification" && payload.data) {
              const notifData = payload.data;
              const incomingNotif = {
                id: String(notifData.id || notifData.facebook_notification_id),
                actor: notifData.from_user_name || "Khách hàng",
                text: notifData.title || "",
                createdAt: notifData.created_time || new Date().toISOString(),
                unread: Boolean(notifData.unread),
                replied: false,
                pageId: String(notifData.page_id),
                type: notifData.notification_type === "comment" ? "comment" : "interaction",
                link: notifData.link || "",
              };
              setNotifications((prev) => [incomingNotif, ...prev.filter((n) => n.id !== incomingNotif.id)]);
            }
          } catch (err) {
            console.error("[WS Message Error]", err);
          }
        };

        ws.onclose = () => {
          clearInterval(timer);
          if (!destroyed) {
            setTimeout(connectWs, 3000);
          }
        };

        ws.onerror = () => {
          if (ws) ws.close();
        };
      } catch (e) {
        console.warn("[WS Connect Error]", e);
      }
    };

    connectWs();

    return () => {
      destroyed = true;
      clearInterval(timer);
      if (ws) ws.close();
    };
  }, [activeConversationId]);

  const handleReset = async () => {
    setResetting(true);
    await resyncChatData();
    applyData(await fetchAll());
    setActivePageId(null);
    setActiveConversationId(null);
    setMessagesByConversation({});
    loadingMessages.current.clear();
    setResetting(false);
  };

  const pagesById = useMemo(() => Object.fromEntries(pages.map((p) => [p.id, p])), [pages]);

  const visiblePages = useMemo(() => {
    const q = normalize(search.trim());
    return q ? pages.filter((p) => normalize(p.name).includes(q)) : pages;
  }, [pages, search]);

  const visibleConversations = useMemo(() => {
    let list = conversations;
    if (activePageId) list = list.filter((c) => c.pageId === activePageId);
    if (filter === "unread") list = list.filter((c) => c.unread);
    if (filter === "unreplied") list = list.filter((c) => !c.replied);
    const dir = sort === "newest" ? -1 : 1;
    return [...list].sort((a, b) => dir * (new Date(a.updatedAt) - new Date(b.updatedAt)));
  }, [conversations, activePageId, filter, sort]);

  const activeConversation = conversations.find((c) => c.id === activeConversationId) || null;

  const updateConversation = (id, patch) =>
    setConversations((list) => list.map((c) => (c.id === id ? { ...c, ...(typeof patch === "function" ? patch(c) : patch) } : c)));

  const setThread = (conversationId, update) =>
    setMessagesByConversation((all) => ({ ...all, [conversationId]: update(all[conversationId] || []) }));

  const patchMessage = (conversationId, messageId, patch) =>
    setThread(conversationId, (list) => list.map((m) => (m.id === messageId ? { ...m, ...patch } : m)));

  const loadMessages = (id) => {
    if (loadingMessages.current.has(id)) return;
    loadingMessages.current.add(id);
    getMessages(id)
      .then((res) => {
        if (res?.messages) {
          setMessagesByConversation((all) => ({ ...all, [id]: res.messages }));
        }
      })
      .finally(() => loadingMessages.current.delete(id));
  };

  // Đồng bộ định kỳ tin nhắn của hội thoại đang mở (fallback 3s)
  useEffect(() => {
    if (!activeConversationId) return;
    const interval = setInterval(() => {
      getMessages(activeConversationId).then((res) => {
        if (res?.messages && res.messages.length > 0) {
          setMessagesByConversation((all) => {
            const current = all[activeConversationId] || [];
            if (
              current.length !== res.messages.length ||
              current[current.length - 1]?.id !== res.messages[res.messages.length - 1]?.id
            ) {
              return { ...all, [activeConversationId]: res.messages };
            }
            return all;
          });
        }
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [activeConversationId]);

  const selectConversation = (id) => {
    setActiveConversationId(id);
    // Mở hội thoại -> coi như đã xem
    updateConversation(id, { unread: false });
    if (!isMock) markConversationRead(id).catch(() => {});
    loadMessages(id);
  };

  /** Gửi lên Engine; đang xem dữ liệu mẫu thì chỉ thêm tin trên giao diện */
  const deliver = (conversationId, message) => {
    if (isMock) return;
    patchMessage(conversationId, message.id, { status: "sending" });
    sendMessage(conversationId, { text: message.text, attachment: message.attachment, replyToId: message.replyTo?.id })
      .then((res) => patchMessage(conversationId, message.id, { ...(res?.message || {}), id: message.id, status: undefined }))
      .catch(() => patchMessage(conversationId, message.id, { status: "failed" }));
  };

  const handleSend = (conversationId, { text, attachment, replyTo }) => {
    const message = {
      id: `local-${Date.now()}`,
      direction: "out",
      text,
      attachment,
      replyTo,
      createdAt: new Date().toISOString(),
      status: isMock ? undefined : "sending",
    };
    setThread(conversationId, (list) => [...list, message]);
    const preview = text || (attachment?.type === "image" ? "[Hình ảnh]" : "[Tệp đính kèm]");
    updateConversation(conversationId, { replied: true, unread: false, lastMessage: `Bạn: ${preview}`, updatedAt: message.createdAt });
    deliver(conversationId, message);
  };

  const handleToggleStar = (conversation) => {
    const starred = !conversation.starred;
    updateConversation(conversation.id, { starred });
    if (!isMock) setConversationStarred(conversation.id, starred).catch(() => updateConversation(conversation.id, { starred: !starred }));
  };

  const handleToggleTag = (conversation, tagId) => {
    const current = conversation.tags || [];
    const tags = current.includes(tagId) ? current.filter((t) => t !== tagId) : [...current, tagId];
    updateConversation(conversation.id, { tags });
    if (!isMock) setConversationTags(conversation.id, tags).catch(() => updateConversation(conversation.id, { tags: current }));
  };

  const openNotification = (id) => {
    setNotifications((list) => list.map((n) => (n.id === id ? { ...n, unread: false } : n)));
    if (!isMock) markNotificationRead(id).catch(() => {});
  };

  return (
    <div className="h-full min-h-[520px] flex flex-col gap-2">
      <div className="flex-1 min-h-0 flex gap-3">
        <PageList
          className="w-[260px] 2xl:w-[317px]"
          pages={visiblePages}
          total={totalPages}
          activePageId={activePageId}
          onSelectPage={(id) => {
            setActivePageId(id);
            setActiveConversationId(null);
          }}
          search={search}
          onSearchChange={setSearch}
          onReset={handleReset}
          resetting={resetting}
        />
        {activeConversation ? (
          <ChatWindow
            key={activeConversation.id}
            conversation={activeConversation}
            pageName={pagesById[activeConversation.pageId]?.name}
            messages={messagesByConversation[activeConversation.id]}
            onSend={(payload) => handleSend(activeConversation.id, payload)}
            onRetry={(message) => deliver(activeConversation.id, message)}
            onReact={(messageId, emoji) => {
              setThread(activeConversation.id, (list) =>
                list.map((m) => (m.id === messageId ? { ...m, reaction: m.reaction === emoji ? null : emoji } : m)),
              );
              if (!isMock) reactToMessage(activeConversation.id, messageId, emoji).catch(() => {});
            }}
            onToggleStar={() => handleToggleStar(activeConversation)}
            onToggleTag={(tagId) => handleToggleTag(activeConversation, tagId)}
            onMarkUnread={() => {
              updateConversation(activeConversation.id, { unread: true });
              setActiveConversationId(null);
            }}
            onClose={() => setActiveConversationId(null)}
          />
        ) : (
          <ChatPlaceholder />
        )}
        <ConversationList
          className="flex-none w-[320px] xl:w-[360px] 2xl:w-[440px]"
          tab={tab}
          onTabChange={setTab}
          filter={filter}
          onFilterChange={setFilter}
          sort={sort}
          onSortChange={setSort}
          conversations={visibleConversations}
          notifications={notifications}
          pagesById={pagesById}
          activeConversationId={activeConversationId}
          onSelectConversation={selectConversation}
          notificationType={notificationType}
          onNotificationTypeChange={setNotificationType}
          notificationFilter={notificationFilter}
          onNotificationFilterChange={setNotificationFilter}
          onOpenNotification={openNotification}
        />
      </div>
    </div>
  );
}
