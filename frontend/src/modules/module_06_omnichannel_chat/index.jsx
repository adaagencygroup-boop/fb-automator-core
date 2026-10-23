"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getChatPages,
  getConversations,
  getMessages,
  getNotifications,
  mapNotification,
  resyncChatData,
  friendlyFbError,
  toUtcIso,
  parseAttachmentText,
  messagePreview,
  attachmentLabel,
  sendMessage,
  setConversationStarred,
  setConversationTags,
  markConversationRead,
  markNotificationRead,
  reactToMessage,
} from "./service";
import PageList from "./components/PageList";
import PageSwitcher from "./components/PageSwitcher";
import ConversationList from "./components/ConversationList";
import ChatWindow from "./components/ChatWindow";
import NotificationDetail from "./components/NotificationDetail";
import { useResizableWidth, ResizeHandle } from "@/lib/use-resizable-width";

// Figma: "Quản lý chat Page" (1072:11951) — OmnichannelPanels (1072:12081)
// 3 cột: (1) Danh sách Page · (2) Khung chat (1072:12415) · (3) Hội thoại / Thông báo

async function fetchAll(notifQuery) {
  const [p, c, n] = await Promise.all([
    getChatPages(),
    getConversations(),
    getNotifications(notifQuery),
  ]);
  return { p, c, n };
}

/**
 * Dưới ngưỡng này (độ rộng vùng 3 cột) thì chuyển sang bố cục 2 cột:
 * cột Page + cột thứ hai đổi qua lại giữa Danh sách hội thoại/thông báo và Chi tiết.
 */
/**
 * Hẹp hơn mức này thì không đủ cho 2 cột (chi tiết 360 + hội thoại 320 + nút Page)
 * -> chuyển bố cục 1 cột, đi lần lượt:
 * Danh sách Page -> Hội thoại/Thông báo -> Chi tiết (mỗi cấp có nút quay lại).
 */
const COMPACT_LAYOUT_WIDTH = 760;

/** Đo độ rộng thật của hàng cột để quyết định bố cục (chính xác hơn dựa theo viewport) */
function useRowWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width ?? 0;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
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
  // Backend lo loc + phan trang, nen phai giu ca so trang va badge no tra ve
  const [notifMeta, setNotifMeta] = useState({
    unreadCounts: {}, page: 1, totalPages: 1, forKey: null,
  });
  const [loadingMoreNotif, setLoadingMoreNotif] = useState(false);
  const [isMock, setIsMock] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [compactShowList, setCompactShowList] = useState(false); // bố cục 1 cột: đã vào Hội thoại chưa

  const [activePageId, setActivePageId] = useState(null); // null = tất cả các trang
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("conversations");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [openedNotificationId, setOpenedNotificationId] = useState(null); // thông báo đang mở chi tiết
  const [notificationType, setNotificationType] = useState("interaction");
  const [notificationFilter, setNotificationFilter] = useState("all");
  // Tin nhắn đã tải, theo id hội thoại (chưa có key = chưa tải)
  const [messagesByConversation, setMessagesByConversation] = useState({});
  const loadingMessages = useRef(new Set());
  const activeConvRef = useRef(null); // hội thoại đang mở, cho WS đọc mà không phải reconnect
  const wsOpenRef = useRef(false); // WS đang mở hay không, để tắt polling khi realtime khoẻ
  const notifQueryRef = useRef(null); // bộ lọc thông báo hiện hành, cho WS đọc

  useEffect(() => {
    activeConvRef.current = activeConversationId;
  }, [activeConversationId]);

  const applyData = ({ p, c, n }) => {
    setPages(p.pages || []);
    setTotalPages(p.total ?? (p.pages || []).length);
    setConversations(c.conversations || []);
    setNotifications(n.notifications || []);
    setNotifMeta({
      unreadCounts: n.unreadCounts || {},
      page: n.page || 1,
      totalPages: n.totalPages || 1,
      forKey: n.forKey ?? null,
    });
    setIsMock(Boolean(p.isMock || c.isMock));
    // Chỉ coi là lỗi khi tải Page/Hội thoại hỏng (thông báo lỗi nhẹ hơn, không chặn)
    setLoadError(p.error || c.error || "");
    setLoading(false);
  };

  // Lưới an toàn: 3 hàm tải đều tự bắt lỗi, nhưng nếu có gì lọt ra thì vẫn phải
  // tắt skeleton — để treo mãi còn khó hiểu hơn là danh sách rỗng kèm báo lỗi.
  const failData = (err) => {
    setLoadError(err?.message || "Không tải được dữ liệu");
    setLoading(false);
  };

  // Bộ lọc thông báo hiện hành — Backend lọc chứ không phải FE nữa
  const notifQuery = useMemo(
    () => ({ pageId: activePageId, type: notificationType, filter: notificationFilter }),
    [activePageId, notificationType, notificationFilter],
  );
  const notifQueryKey = `${activePageId || ""}|${notificationType}|${notificationFilter}`;

  const reload = () => {
    setLoading(true);
    setLoadError("");
    fetchAll(notifQuery)
      .then((data) => applyData({ ...data, n: { ...data.n, forKey: notifQueryKey } }))
      .catch(failData);
  };

  useEffect(() => {
    let cancelled = false;
    fetchAll(notifQuery)
      .then((data) => !cancelled && applyData({ ...data, n: { ...data.n, forKey: notifQueryKey } }))
      .catch((err) => !cancelled && failData(err));
    return () => {
      cancelled = true;
    };
    // Chỉ chạy một lần lúc dựng; đổi bộ lọc đã có effect riêng bên dưới lo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Đổi Page / tab / bộ lọc -> hỏi lại Backend từ trang 1.
   *
   * Bỏ qua lần đầu vì `fetchAll` ở trên đã tải đúng bộ lọc mặc định rồi, không
   * thì một lần mở Chat lại gọi thông báo hai lượt.
   */
  useEffect(() => {
    notifQueryRef.current = notifQuery;
  }, [notifQuery]);

  const firstNotifLoad = useRef(true);
  useEffect(() => {
    if (firstNotifLoad.current) {
      firstNotifLoad.current = false;
      return undefined;
    }
    let cancelled = false;
    getNotifications({ ...notifQuery, page: 1 }).then((res) => {
      if (cancelled) return;
      setNotifications(res.notifications || []);
      setNotifMeta({
        unreadCounts: res.unreadCounts || {},
        page: res.page || 1,
        totalPages: res.totalPages || 1,
        forKey: notifQueryKey,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [notifQuery, notifQueryKey]);

  // Đổi Page/tab/bộ lọc là phải hỏi lại Backend, có độ trễ thật -> hiện khung
  // xương. So khoá đã tải với khoá đang chọn thay vì giữ thêm một cờ loading.
  const notificationsLoading = loading || notifMeta.forKey !== notifQueryKey;

  /** Cuộn tới đáy danh sách thông báo -> xin trang kế tiếp, nối vào cuối */
  const loadMoreNotifications = () => {
    if (loadingMoreNotif || notifMeta.page >= notifMeta.totalPages) return;
    setLoadingMoreNotif(true);
    getNotifications({ ...notifQuery, page: notifMeta.page + 1 })
      .then((res) => {
        const fresh = res.notifications || [];
        setNotifications((prev) => {
          const seen = new Set(prev.map((x) => x.id));
          return [...prev, ...fresh.filter((x) => !seen.has(x.id))];
        });
        setNotifMeta((m) => ({
          ...m,
          unreadCounts: res.unreadCounts || m.unreadCounts,
          page: res.page || m.page + 1,
          totalPages: res.totalPages || m.totalPages,
        }));
      })
      .finally(() => setLoadingMoreNotif(false));
  };

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
          wsOpenRef.current = true;
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
              // Bóc tiền tố "[image] ..." thành đính kèm, tránh hiện nguyên link dưới dạng text
              const parsed = parseAttachmentText(msgData.text);
              const incomingMsg = {
                id: String(msgData.id || msgData.facebook_message_id),
                direction: msgData.direction === "outbound" ? "out" : "in",
                text: parsed.text,
                attachment: parsed.attachment,
                createdAt: toUtcIso(msgData.created_at) || new Date().toISOString(),
              };

              // Thêm tin nhắn mới vào cuộc hội thoại (chống trùng với tin optimistic mình vừa gửi)
              setMessagesByConversation((all) => {
                const currentList = all[convId] || [];
                // Đã có đúng tin này theo id thật -> bỏ qua
                if (currentList.some((m) => m.id === incomingMsg.id)) return all;
                // Tin do mình vừa gửi (id local-..., cùng chiều & nội dung) -> gắn id thật thay vì thêm bản mới
                if (incomingMsg.direction === "out") {
                  const idx = currentList.findIndex(
                    (m) =>
                      String(m.id).startsWith("local-") &&
                      m.direction === "out" &&
                      (m.text || "") === (incomingMsg.text || ""),
                  );
                  if (idx !== -1) {
                    const next = currentList.slice();
                    next[idx] = {
                      ...next[idx],
                      id: incomingMsg.id,
                      status: undefined,
                      // Đổi ảnh xem trước (blob:) sang URL công khai thật do server trả về.
                      // Bản echo không mang tên tệp gốc -> giữ lại tên của tin optimistic.
                      attachment: incomingMsg.attachment
                        ? {
                            ...incomingMsg.attachment,
                            name: incomingMsg.attachment.name || next[idx].attachment?.name,
                          }
                        : next[idx].attachment,
                    };
                    return { ...all, [convId]: next };
                  }
                }
                return { ...all, [convId]: [...currentList, incomingMsg] };
              });

              // Cập nhật thẻ hội thoại ở sidebar
              setConversations((list) => {
                const exists = list.some((c) => c.id === convId);
                const isCurrentActive = activeConvRef.current === convId;
                // Xem trước ở danh sách hội thoại: đính kèm thì ghi nhãn, không in link
                const snippet = messagePreview(msgData.text) || attachmentLabel();
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
              const incomingNotif = mapNotification(payload.data);

              // Danh sách giờ là kết quả lọc của Backend, nên chỉ chèn vào khi cái
              // vừa tới đúng là thứ đang xem — không thì thông báo của Page khác
              // sẽ nhảy vào giữa danh sách đã lọc.
              const q = notifQueryRef.current || {};
              const matchPage = !q.pageId || incomingNotif.pageId === q.pageId;
              const matchType = !q.type || incomingNotif.type === q.type;
              const matchFilter =
                !q.filter || q.filter === "all"
                  ? true
                  : q.filter === "unread"
                    ? incomingNotif.unread
                    : !incomingNotif.replied;

              if (matchPage && matchType && matchFilter) {
                setNotifications((prev) => [incomingNotif, ...prev.filter((n) => n.id !== incomingNotif.id)]);
              }

              // Badge thì nhích bất kể đang xem tab nào, miễn là đúng Page đang lọc
              if (incomingNotif.unread && matchPage) {
                setNotifMeta((m) => ({
                  ...m,
                  unreadCounts: {
                    ...m.unreadCounts,
                    [incomingNotif.type]: (m.unreadCounts[incomingNotif.type] || 0) + 1,
                  },
                }));
              }
            }
          } catch (err) {
            console.error("[WS Message Error]", err);
          }
        };

        ws.onclose = () => {
          wsOpenRef.current = false;
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
      wsOpenRef.current = false;
      clearInterval(timer);
      if (ws) ws.close();
    };
  }, []);

  const confirmReset = async () => {
    setResetConfirmOpen(false);
    setResetting(true);
    await resyncChatData();
    const data = await fetchAll(notifQuery);
    applyData({ ...data, n: { ...data.n, forKey: notifQueryKey } });
    setActivePageId(null);
    setActiveConversationId(null);
    setOpenedNotificationId(null);
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

  // Fallback: chỉ hỏi lại tin nhắn khi WS realtime KHÔNG hoạt động (tránh tải trùng)
  useEffect(() => {
    if (!activeConversationId) return;
    const interval = setInterval(() => {
      if (wsOpenRef.current) return; // WS đang khoẻ -> tin mới đã về qua realtime, bỏ qua
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
    setOpenedNotificationId(null); // mở hội thoại thì đóng chi tiết thông báo
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
      // Giữ nguyên id local-... (KHÔNG gắn message_id của HTTP = Facebook mid), chỉ bỏ cờ "sending".
      // WS echo dùng id DB (trùng với getMessages) sẽ tự reconcile tin local-... này -> tránh trùng.
      .then(() => patchMessage(conversationId, message.id, { status: undefined }))
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
    const preview = text || attachmentLabel(attachment?.type);
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
    const target = notifications.find((n) => n.id === id) || null;
    setNotifications((list) => list.map((n) => (n.id === id ? { ...n, unread: false } : n)));
    if (!isMock) markNotificationRead(target?.rawId || id).catch(() => {});
    setActiveConversationId(null); // mở chi tiết thông báo thì đóng khung chat
    setOpenedNotificationId(id);
  };

  const openedNotification = notifications.find((n) => n.id === openedNotificationId) || null;

  // Bố cục theo độ rộng thật: đủ rộng -> 2 cột (chi tiết + hội thoại, Page thu thành nút);
  // hẹp (compact) -> 1 cột đi lần lượt
  const { ref: rowRef, width: rowWidth } = useRowWidth();
  const compact = rowWidth > 0 && rowWidth < COMPACT_LAYOUT_WIDTH;

  // Kéo dãn độ rộng 2 cột (giống thanh sidebar), nhớ lại bằng localStorage.
  // getAvailableMax chặn không cho kéo quá chỗ trống còn lại → không tràn ngang cả trang.
  const MIDDLE_MIN = 360; // khớp min-w của khung chat ở giữa
  const SECOND_COL_MIN = 420; // bố cục 2 cột: chỗ tối thiểu cho khung chat / danh sách (ô nhập + thanh lọc)
  const GAP = 12; // gap-3
  const { ref: pageColRef, handleProps: pageColHandleProps, dragging: pageColDragging } = useResizableWidth({
    min: 240,
    max: 480,
    default: 317,
    storageKey: "fb-automator.chat.pagelist-width",
    side: "right",
    getAvailableMax: (el) => {
      const row = el.parentElement;
      if (!row) return Infinity;
      if (row.children.length >= 3) {
        // 3 cột: chừa chỗ cho khung giữa (min) + cột Hội thoại hiện tại
        const convW = row.lastElementChild?.getBoundingClientRect().width ?? 440;
        return row.clientWidth - convW - MIDDLE_MIN - GAP * 2;
      }
      // 2 cột: chừa đủ chỗ cho cột thứ hai (khung chat / danh sách) khỏi bị cắt nội dung
      return row.clientWidth - SECOND_COL_MIN - GAP;
    },
  });
  const {
    ref: convColRef,
    handleProps: convColHandleProps,
    dragging: convColDragging,
    reclamp: reclampConvCol,
  } = useResizableWidth({
    min: 320,
    max: 680,
    default: 440,
    storageKey: "fb-automator.chat.convlist-width",
    side: "left",
    getAvailableMax: (el) => {
      const row = el.parentElement;
      if (!row) return Infinity;
      const pageW = row.firstElementChild?.getBoundingClientRect().width ?? 317;
      return row.clientWidth - pageW - MIDDLE_MIN - GAP * 2;
    },
  });

  // Đổi bố cục (mở/đóng chi tiết, vào/ra chế độ 1 cột) -> số cột đổi nhưng bề rộng hàng không đổi,
  // nên ResizeObserver không kích hoạt; phải chủ động kẹp lại cột Hội thoại cho vừa chỗ trống mới.
  useEffect(() => {
    reclampConvCol();
  }, [reclampConvCol, activeConversationId, openedNotificationId, compact]);

  // Có panel giữa (khung chat / chi tiết thông báo) hay không
  const detailPanel = activeConversation ? (
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
      // Bố cục hẹp: chi tiết thay chỗ danh sách -> cần nút quay lại
      onBack={compact ? () => setActiveConversationId(null) : undefined}
    />
  ) : openedNotification ? (
    <NotificationDetail
      key={openedNotification.id}
      notification={openedNotification}
      page={pagesById[openedNotification.pageId]}
      pageName={pagesById[openedNotification.pageId]?.name}
      onBack={() => setOpenedNotificationId(null)}
    />
  ) : null;

  // Một bản PageList dùng chung cho cột cố định (1 cột drill-down hoặc 2 cột)
  const pageListEl = (className, onPicked) => (
    <PageList
      className={className}
      pages={visiblePages}
      total={totalPages}
      activePageId={activePageId}
      onSelectPage={(id) => {
        setActivePageId(id);
        setActiveConversationId(null);
        setOpenedNotificationId(null);
        onPicked?.();
      }}
      search={search}
      onSearchChange={setSearch}
      onReset={() => setResetConfirmOpen(true)}
      resetting={resetting}
      loading={loading}
    />
  );

  // Một bản ConversationList dùng chung; đổi className tuỳ 2 cột hay 3 cột
  const conversationList = (extraClass, onBack) => (
    <ConversationList
      className={extraClass}
      loading={loading}
      onBack={onBack}
      tab={tab}
      onTabChange={setTab}
      filter={filter}
      onFilterChange={setFilter}
      sort={sort}
      onSortChange={setSort}
      conversations={visibleConversations}
      notifications={notifications}
      notificationCounts={notifMeta.unreadCounts}
      notificationsLoading={notificationsLoading}
      onLoadMoreNotifications={loadMoreNotifications}
      hasMoreNotifications={notifMeta.page < notifMeta.totalPages}
      loadingMoreNotifications={loadingMoreNotif}
      pagesById={pagesById}
      activeConversationId={activeConversationId}
      onSelectConversation={selectConversation}
      notificationType={notificationType}
      onNotificationTypeChange={setNotificationType}
      notificationFilter={notificationFilter}
      onNotificationFilterChange={setNotificationFilter}
      onOpenNotification={openNotification}
    />
  );

  return (
    <div className="h-full min-h-[520px] flex flex-col gap-2">
      {/* #7: báo lỗi tải dữ liệu rõ ràng + nút thử lại (thay vì im lặng trả rỗng) */}
      {loadError && !loading && (
        <div className="shrink-0 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <span className="min-w-0 truncate" title={loadError}>{friendlyFbError(loadError)}</span>
          <button
            type="button"
            onClick={reload}
            className="shrink-0 rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100"
          >
            Thử lại
          </button>
        </div>
      )}
      <div ref={rowRef} className="relative flex-1 min-h-0 min-w-0 flex gap-3 overflow-hidden">
        {compact ? (
          // Bố cục 1 cột: Danh sách Page -> Hội thoại/Thông báo -> Chi tiết (mỗi cấp có nút quay lại)
          detailPanel ? (
            detailPanel
          ) : compactShowList ? (
            conversationList("flex-1 min-w-0", () => setCompactShowList(false))
          ) : (
            pageListEl("flex-1 min-w-0 w-auto", () => setCompactShowList(true))
          )
        ) : !detailPanel ? (
          // Chưa mở chi tiết: 2 cột như Figma — Page (kéo đổi độ rộng) + Hội thoại giãn đầy
          <>
            <div ref={pageColRef} style={{ width: 317 }} className="relative shrink-0 h-full">
              {pageListEl("w-full")}
              <ResizeHandle handleProps={pageColHandleProps} dragging={pageColDragging} side="right" />
            </div>
            {conversationList("flex-1 min-w-0")}
          </>
        ) : (
          // Đang mở chi tiết: ẩn cột Page, chỉ còn nút icon mở sheet -> nhường chỗ cho nội dung
          <>
            <div className="shrink-0 pt-1">
              <PageSwitcher
                pages={visiblePages}
                total={totalPages}
                activePageId={activePageId}
                activePage={activePageId ? pagesById[activePageId] : null}
                onSelectPage={(id) => {
                  setActivePageId(id);
                  setActiveConversationId(null);
                  setOpenedNotificationId(null);
                }}
                search={search}
                onSearchChange={setSearch}
                onReset={() => setResetConfirmOpen(true)}
                resetting={resetting}
              />
            </div>

            {/* Cột trái: chi tiết (chiếm phần còn lại) */}
            {detailPanel}

            {/* Cột phải: Hội thoại & Thông báo — cố định, kéo đổi độ rộng ở mép trái */}
            <div ref={convColRef} style={{ width: 440 }} className="relative shrink-0 h-full">
              <ResizeHandle handleProps={convColHandleProps} dragging={convColDragging} side="left" />
              {conversationList("w-full")}
            </div>
          </>
        )}

      </div>

      {/* #4: xác nhận trước khi xoá/đồng bộ lại toàn bộ dữ liệu chat */}
      {resetConfirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setResetConfirmOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-slate-900">Reset dữ liệu chat?</h3>
            <p className="mt-2 text-sm leading-5 text-slate-600">
              Thao tác này sẽ <strong>xoá toàn bộ</strong> Page, hội thoại, tin nhắn và thông báo đã đồng bộ của bạn, rồi đồng bộ lại từ Facebook. Không thể hoàn tác.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetConfirmOpen(false)}
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Huỷ
              </button>
              <button
                type="button"
                onClick={confirmReset}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
              >
                Xoá & đồng bộ lại
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
