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
    if (messagesByConversation[id] || loadingMessages.current.has(id)) return;
    loadingMessages.current.add(id);
    getMessages(id)
      .then((res) => setMessagesByConversation((all) => ({ ...all, [id]: res.messages || [] })))
      .finally(() => loadingMessages.current.delete(id));
  };

  const selectConversation = (id) => {
    setActiveConversationId(id);
    // Mở hội thoại -> coi như đã xem
    updateConversation(id, { unread: false });
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

  const openNotification = (id) =>
    setNotifications((list) => list.map((n) => (n.id === id ? { ...n, unread: false } : n)));

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
            onReact={(messageId, emoji) =>
              setThread(activeConversation.id, (list) =>
                list.map((m) => (m.id === messageId ? { ...m, reaction: m.reaction === emoji ? null : emoji } : m)),
              )
            }
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
