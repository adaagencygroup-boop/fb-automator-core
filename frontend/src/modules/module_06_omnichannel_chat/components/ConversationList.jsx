"use client";

import { cn } from "@/lib/utils";
import { useIncrementalList } from "@/lib/use-incremental-list";
import NotificationList from "./NotificationList";
import StatusFilter from "./StatusFilter";
import { CONVERSATION_TAGS } from "../constants";
import { Star } from "lucide-react";

// Figma: Section - COLUMN 3: CONVERSATION LIST (HỘI THOẠI & THÔNG BÁO) (1072:12294)

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500";

const formatTime = (iso) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

/** "KH: 29224347..." — rút gọn mã khách hàng như Figma */
const shortCustomer = (id) => (String(id).length > 8 ? `${String(id).slice(0, 8)}...` : id);

function Tabs({ tab, onTabChange, notificationCount, hasUnread = false, onBack }) {
  const tabs = [
    { id: "conversations", label: "Hội thoại" },
    { id: "notifications", label: `Thông báo (${notificationCount})`, dot: hasUnread },
  ];
  return (
    <div role="tablist" aria-label="Hội thoại và thông báo" className="flex border-b border-slate-200 shrink-0">
      {/* Bố cục 1 cột: quay lại Danh sách Page */}
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Quay lại danh sách Page"
          className={cn("shrink-0 px-3 text-slate-600 hover:bg-slate-50", FOCUS)}
        >
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12.5 15.5L7 10l5.5-5.5" />
          </svg>
        </button>
      )}
      {tabs.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onTabChange(t.id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 pt-3 pb-3.5 -mb-px border-b-2 text-xs leading-4 font-bold uppercase transition-colors",
              active ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700",
              FOCUS,
            )}
          >
            {t.label}
            {t.dot && !active && <span className="size-2 rounded-full bg-red-500" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

function FilterBar({
  filter,
  onFilterChange,
  starOnly,
  onToggleStar,
  selectedTag,
  onSelectTag,
  sort,
  onSortChange,
}) {
  return (
    <StatusFilter
      filter={filter}
      onFilterChange={onFilterChange}
      starOnly={starOnly}
      onToggleStar={onToggleStar}
      selectedTag={selectedTag}
      onSelectTag={onSelectTag}
      label="Lọc hội thoại"
    >
      <button
        type="button"
        onClick={() => onSortChange(sort === "newest" ? "oldest" : "newest")}
        className={cn("shrink-0 flex items-center gap-1 rounded px-1 text-[11px] leading-4 text-slate-600 hover:text-slate-900", FOCUS)}
        title="Đổi thứ tự sắp xếp"
      >
        {sort === "newest" ? "Mới nhất" : "Cũ nhất"}
        <img
          src="/icons/icon_sort_chevron.svg"
          alt=""
          width={7.875}
          height={4.5}
          className={cn("block transition-transform", sort === "oldest" && "rotate-180")}
        />
      </button>
    </StatusFilter>
  );
}

function ConversationItem({ conversation, pageName, active, first, onSelect }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        className={cn(
          "w-full flex flex-col gap-1 px-3 text-left transition-colors",
          first ? "py-3" : "pt-[13px] pb-3 border-t border-slate-100",
          active ? "bg-blue-50/30" : "hover:bg-slate-50",
          FOCUS,
        )}
      >
        <span className="w-full flex items-center justify-between">
          <span className="flex items-center gap-1.5 min-w-0">
            <img src="/icons/icon_facebook_source.svg" alt="Facebook" width={11.625} height={11.5547} className="block shrink-0" />
            <span
              className="truncate text-xs leading-4 font-bold text-slate-900"
              title={conversation.customerName || `KH: ${conversation.customer}`}
            >
              {conversation.customerName || `KH: ${shortCustomer(conversation.customer)}`}
            </span>
            {conversation.starred && (
              <Star size={12} className="text-amber-400 fill-amber-400 shrink-0" />
            )}
          </span>
          <time dateTime={conversation.updatedAt} className="shrink-0 text-[10px] leading-5 text-slate-400">
            {formatTime(conversation.updatedAt)}
          </time>
        </span>
        <span className="w-full truncate text-xs leading-4 text-slate-600">
          {conversation.lastMessage}
        </span>
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          {pageName && (
            <span className="inline-flex px-[8px] py-[2px] rounded border border-blue-100 bg-blue-50 text-[10px] leading-4 text-blue-600 font-medium">
              {pageName}
            </span>
          )}
          {Array.isArray(conversation.tags) &&
            conversation.tags.map((tagId) => {
              const tagObj = CONVERSATION_TAGS.find((t) => t.id === tagId);
              if (!tagObj) return null;
              return (
                <span
                  key={tagId}
                  className={cn(
                    "inline-flex px-1.5 py-[1px] rounded-full border text-[9px] font-semibold leading-3.5",
                    tagObj.className,
                  )}
                >
                  {tagObj.label}
                </span>
              );
            })}
        </div>
      </button>
    </li>
  );
}

export default function ConversationList({
  tab,
  onTabChange,
  filter,
  onFilterChange,
  starOnly = false,
  onToggleStar,
  selectedTag = null,
  onSelectTag,
  sort,
  onSortChange,
  conversations,
  notifications,
  pagesById,
  activeConversationId,
  onSelectConversation,
  notificationType,
  onNotificationTypeChange,
  notificationFilter,
  onNotificationFilterChange,
  onOpenNotification,
  onBack,
  loading = false,
  className,
}) {
  const { slice: convSlice, sentinelRef: convSentinel, hasMore: convHasMore } = useIncrementalList(conversations, 30);
  return (
    <section
      aria-label="Hội thoại và thông báo"
      className={cn(
        "flex-1 min-w-0 h-full flex flex-col bg-white border border-slate-200 rounded-xl drop-shadow-[0px_1px_1px_rgba(0,0,0,0.05)] overflow-hidden",
        className,
      )}
    >
      <Tabs
        tab={tab}
        onTabChange={onTabChange}
        notificationCount={notifications.length}
        hasUnread={notifications.some((n) => n.unread)}
        onBack={onBack}
      />

      {tab === "conversations" ? (
        <>
          <FilterBar
            filter={filter}
            onFilterChange={onFilterChange}
            starOnly={starOnly}
            onToggleStar={onToggleStar}
            selectedTag={selectedTag}
            onSelectTag={onSelectTag}
            sort={sort}
            onSortChange={onSortChange}
          />
          <ul className="flex-1 min-h-0 overflow-y-auto">
            {loading ? (
              <li className="px-3 py-16 text-center flex flex-col items-center justify-center gap-2">
                <div className="size-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-slate-500 font-medium">Đang tải dữ liệu...</span>
              </li>
            ) : conversations.length === 0 ? (
              <li className="px-3 py-10 text-center text-xs text-slate-400">
                {starOnly || selectedTag || filter !== "all"
                  ? "Không có cuộc hội thoại nào phù hợp với bộ lọc."
                  : "Không có hội thoại nào."}
              </li>
            ) : null}
            {!loading &&
              convSlice.map((c, i) => (
                <ConversationItem
                  key={c.id}
                  conversation={c}
                  pageName={pagesById[c.pageId]?.name}
                  active={c.id === activeConversationId}
                  first={i === 0}
                  onSelect={() => onSelectConversation(c.id)}
                />
              ))}
            {!loading && convHasMore && <li ref={convSentinel} aria-hidden="true" className="h-4" />}
          </ul>
        </>
      ) : (
        <NotificationList
          notifications={notifications}
          pagesById={pagesById}
          type={notificationType}
          onTypeChange={onNotificationTypeChange}
          filter={notificationFilter}
          onFilterChange={onNotificationFilterChange}
          onOpenNotification={onOpenNotification}
        />
      )}
    </section>
  );
}
