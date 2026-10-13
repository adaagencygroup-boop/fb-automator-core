"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { MaskIcon } from "@/components/icons/MaskIcon";
import { CONVERSATION_TAGS, EMOJIS, QUICK_REPLIES, REACTIONS, REPLY_WINDOW_MS } from "../constants";

// Figma: "giao diện chat" (1072:12415) — Section - COLUMN 2 (giữa Danh sách Page và Hội thoại)
// Gồm: Header khách hàng · Lịch sử tin nhắn · Banner đếm ngược 24h · Ô soạn tin.

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500";

/** Icon trong /public/icons (width/height = kích thước gốc file SVG), tô màu theo text-color */
const ICONS = {
  star: { src: "/icons/icon_chat_star.svg", width: 14.44, height: 14 },
  tag: { src: "/icons/icon_chat_tag.svg", width: 11.95, height: 11.98 },
  moreVertical: { src: "/icons/icon_chat_more_vertical.svg", width: 3.06, height: 11.81 },
  moreDots: { src: "/icons/icon_chat_more_dots.svg", width: 18, height: 18 },
  reply: { src: "/icons/icon_chat_reply.svg", width: 18, height: 18 },
  react: { src: "/icons/icon_chat_emoji.svg", width: 18, height: 18 },
  image: { src: "/icons/icon_chat_image.svg", width: 16, height: 14 },
  smile: { src: "/icons/icon_chat_smile.svg", width: 16, height: 16 },
  attach: { src: "/icons/icon_chat_attach.svg", width: 12.03, height: 13.64 },
  send: { src: "/icons/icon_chat_send.svg", width: 12.01, height: 12.01 },
  warning: { src: "/icons/icon_chat_warning.svg", width: 12, height: 10.5 },
  facebookF: { src: "/icons/icon_brand_facebook_f.svg", width: 4.82, height: 9 },
};

const Icon = ({ name, className }) => <MaskIcon {...ICONS[name]} className={className} />;

/* ------------------------------------------------------------------ */
/* Thời gian                                                           */
/* ------------------------------------------------------------------ */

const WEEKDAYS = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
const pad = (n) => String(n).padStart(2, "0");

/** "Thứ Năm, 1 Thg 10, 2026, 06:03" như Figma */
const formatSeparator = (iso) => {
  const d = new Date(iso);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} Thg ${d.getMonth() + 1}, ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const formatTime = (iso) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Đồng hồ dùng chung, cập nhật mỗi 30 giây (cho banner đếm ngược 24h).
// Khi prerender (không có trình duyệt) trả null -> banner chưa hiển thị.
let clockNow = 0;
const subscribeClock = (onChange) => {
  clockNow = Date.now();
  onChange();
  const timer = setInterval(() => {
    clockNow = Date.now();
    onChange();
  }, 30_000);
  return () => clearInterval(timer);
};
const getClock = () => {
  if (!clockNow) clockNow = Date.now();
  return clockNow;
};
const getServerClock = () => null;
const useNow = () => useSyncExternalStore(subscribeClock, getClock, getServerClock);

/* ------------------------------------------------------------------ */
/* Gom tin nhắn: dải ngày + cụm tin liên tiếp cùng người gửi           */
/* ------------------------------------------------------------------ */

const GROUP_GAP_MS = 5 * 60 * 1000; // tin cách nhau < 5 phút -> chung một cụm (bo góc liền nhau)
const SEPARATOR_GAP_MS = 60 * 60 * 1000; // cách nhau > 1 giờ hoặc sang ngày mới -> hiện dải thời gian

function buildRows(messages) {
  const rows = [];
  let group = null;
  let prev = null;
  for (const m of messages) {
    const t = new Date(m.createdAt).getTime();
    const prevT = prev ? new Date(prev.createdAt).getTime() : 0;
    const newDay = !prev || new Date(prevT).toDateString() !== new Date(t).toDateString();
    if (newDay || t - prevT > SEPARATOR_GAP_MS) {
      rows.push({ type: "separator", id: `sep-${m.id}`, createdAt: m.createdAt });
      group = null;
    }
    if (!group || group.direction !== m.direction || t - prevT > GROUP_GAP_MS) {
      group = { type: "group", id: `group-${m.id}`, direction: m.direction, messages: [] };
      rows.push(group);
    }
    group.messages.push(m);
    prev = m;
  }
  return rows;
}

/** Bo góc kiểu Messenger: tin trong cùng cụm dính nhau ở phía người gửi (góc 4px) */
function bubbleRadius(direction, index, count) {
  if (count === 1) return "rounded-[18px]";
  const first = index === 0;
  const last = index === count - 1;
  if (direction === "out") {
    if (first) return "rounded-[18px] rounded-br-[4px]";
    if (last) return "rounded-[18px] rounded-tr-[4px]";
    return "rounded-[18px] rounded-r-[4px]";
  }
  if (first) return "rounded-[18px] rounded-bl-[4px]";
  if (last) return "rounded-[18px] rounded-tl-[4px]";
  return "rounded-[18px] rounded-l-[4px]";
}

const shortId = (id) => (String(id).length > 8 ? `${String(id).slice(0, 8)}...` : String(id));

const previewOf = (m) =>
  m.text || (m.attachment?.type === "image" ? "[Hình ảnh]" : m.attachment ? `[Tệp] ${m.attachment.name || ""}` : "");

/* ------------------------------------------------------------------ */
/* Thành phần dùng chung                                               */
/* ------------------------------------------------------------------ */

/** Nút mở menu / bảng chọn nhỏ; tự đóng khi bấm ra ngoài hoặc nhấn Esc */
function Dropdown({ trigger, children, panelClassName, label }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (!rootRef.current?.contains(e.target)) close();
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  return (
    <div ref={rootRef} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className={cn(
            "absolute z-30 bg-white border border-slate-200 rounded-xl shadow-lg shadow-slate-900/10",
            panelClassName,
          )}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

function IconButton({ label, className, children, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn("shrink-0 flex items-center justify-center transition-colors", FOCUS, className)}
      {...props}
    >
      {children}
    </button>
  );
}

function MenuItem({ children, onClick, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-2 text-left text-xs leading-4 rounded-lg transition-colors",
        danger ? "text-red-600 hover:bg-red-50" : "text-slate-700 hover:bg-slate-100",
        FOCUS,
      )}
    >
      {children}
    </button>
  );
}

function Avatar({ src, name, size }) {
  const style = { width: size, height: size };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- ảnh ngoài (Facebook / placehold.co), app dùng static export
    return <img src={src} alt="" style={style} className="shrink-0 rounded-full object-cover bg-[#E5E7EB]" />;
  }
  const initials = String(name || "KH")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(-2)
    .join("")
    .toUpperCase();
  return (
    <span
      style={style}
      className={cn(
        "shrink-0 rounded-full bg-[#E5E7EB] text-slate-500 font-bold flex items-center justify-center",
        size >= 40 ? "text-sm" : "text-[10px]",
      )}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

function ChatHeader({ conversation, pageName, onToggleStar, onToggleTag, onMarkUnread, onClose }) {
  const tags = CONVERSATION_TAGS.filter((t) => conversation.tags?.includes(t.id));
  return (
    <header className="h-[82px] shrink-0 flex items-center justify-between gap-3 px-4 border-b border-slate-100">
      <div className="flex items-center gap-3 min-w-0">
        <span className="relative shrink-0">
          <span className="block rounded-full border border-slate-200">
            <Avatar src={conversation.avatar} name={conversation.customerName} size={38} />
          </span>
          <span
            className="absolute -right-0.5 -bottom-0.5 size-4 rounded-full bg-blue-600 ring-2 ring-white flex items-center justify-center"
            title="Facebook Messenger"
          >
            <Icon name="facebookF" className="text-white" />
          </span>
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0 overflow-hidden">
            <h3 className="shrink-0 text-sm leading-[19px] font-bold text-slate-900" title={`Khách hàng (${conversation.customer})`}>
              Khách hàng ({shortId(conversation.customer)})
            </h3>
            {tags.map((t) => (
              <span key={t.id} className={cn("shrink-0 rounded-full border px-2 text-[10px] leading-4 font-semibold", t.className)}>
                {t.label}
              </span>
            ))}
          </div>
          <p className="text-[11px] leading-5 text-slate-400">
            PSID: {conversation.psid || conversation.customer} • Kênh nhận: {pageName || "—"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <IconButton
          label={conversation.starred ? "Bỏ gắn sao" : "Gắn sao"}
          aria-pressed={Boolean(conversation.starred)}
          onClick={onToggleStar}
          className="size-8 rounded-full hover:bg-slate-100"
        >
          <Icon name="star" className={conversation.starred ? "text-amber-400" : "text-slate-300"} />
        </IconButton>

        <Dropdown
          label="Gắn nhãn"
          panelClassName="right-0 top-full mt-1 w-52 p-1.5"
          trigger={({ open, toggle }) => (
            <IconButton label="Gắn nhãn" aria-expanded={open} onClick={toggle} className="size-8 rounded-full hover:bg-slate-100">
              <Icon name="tag" className="text-blue-500" />
            </IconButton>
          )}
        >
          {() => (
            <>
              <p className="px-3 pt-1 pb-1.5 text-[11px] font-bold uppercase text-slate-400">Gắn nhãn</p>
              {CONVERSATION_TAGS.map((t) => {
                const checked = Boolean(conversation.tags?.includes(t.id));
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    onClick={() => onToggleTag(t.id)}
                    className={cn(
                      "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs leading-4 text-slate-700 hover:bg-slate-100",
                      FOCUS,
                    )}
                  >
                    <span className={cn("rounded-full border px-2 text-[11px] leading-5 font-semibold", t.className)}>{t.label}</span>
                    {checked && <span className="text-blue-600 font-bold" aria-hidden="true">✓</span>}
                  </button>
                );
              })}
            </>
          )}
        </Dropdown>

        <Dropdown
          label="Tuỳ chọn hội thoại"
          panelClassName="right-0 top-full mt-1 w-48 p-1.5"
          trigger={({ open, toggle }) => (
            <IconButton label="Tuỳ chọn khác" aria-expanded={open} onClick={toggle} className="size-8 rounded-full hover:bg-slate-100">
              <Icon name="moreVertical" className="text-slate-400" />
            </IconButton>
          )}
        >
          {(close) => (
            <>
              <MenuItem
                onClick={() => {
                  close();
                  onMarkUnread();
                }}
              >
                Đánh dấu chưa đọc
              </MenuItem>
              <MenuItem
                onClick={() => {
                  close();
                  onClose();
                }}
              >
                Đóng khung chat
              </MenuItem>
            </>
          )}
        </Dropdown>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Tin nhắn                                                            */
/* ------------------------------------------------------------------ */

/** Thanh thao tác hiện khi rê chuột vào tin (Figma: More · Reply · React) */
function MessageActions({ message, outgoing, onReply, onReact }) {
  const copy = () => navigator.clipboard?.writeText(previewOf(message))?.catch(() => {});
  const btn = "size-[26px] p-1 rounded-full text-[#65676B] hover:bg-slate-200/70";
  return (
    <div
      className={cn(
        "shrink-0 flex items-center gap-2.5 opacity-0 transition-opacity",
        "group-hover/msg:opacity-90 focus-within:opacity-90 has-[[aria-expanded=true]]:opacity-90",
        outgoing ? "pr-1.5 mr-0.5" : "flex-row-reverse pl-1.5 ml-0.5",
      )}
    >
      <Dropdown
        label="Tuỳ chọn tin nhắn"
        panelClassName={cn("top-full mt-1 w-40 p-1.5", outgoing ? "right-0" : "left-0")}
        trigger={({ open, toggle }) => (
          <IconButton label="Khác" aria-expanded={open} onClick={toggle} className={btn}>
            <Icon name="moreDots" />
          </IconButton>
        )}
      >
        {(close) => (
          <>
            <MenuItem
              onClick={() => {
                close();
                onReply();
              }}
            >
              Trả lời
            </MenuItem>
            <MenuItem
              onClick={() => {
                close();
                copy();
              }}
            >
              Sao chép nội dung
            </MenuItem>
          </>
        )}
      </Dropdown>
      <IconButton label="Trả lời" onClick={onReply} className={btn}>
        <Icon name="reply" />
      </IconButton>
      <Dropdown
        label="Bày tỏ cảm xúc"
        panelClassName={cn("top-full mt-1 rounded-full px-1.5 py-1 flex gap-0.5", outgoing ? "right-0" : "left-0")}
        trigger={({ open, toggle }) => (
          <IconButton label="Bày tỏ cảm xúc" aria-expanded={open} onClick={toggle} className={btn}>
            <Icon name="react" />
          </IconButton>
        )}
      >
        {(close) =>
          REACTIONS.map((r) => (
            <button
              key={r}
              type="button"
              aria-label={`Cảm xúc ${r}`}
              aria-pressed={message.reaction === r}
              onClick={() => {
                close();
                onReact(r);
              }}
              className={cn(
                "size-8 rounded-full text-lg leading-none transition-transform hover:scale-125",
                message.reaction === r && "bg-blue-50",
                FOCUS,
              )}
            >
              {r}
            </button>
          ))
        }
      </Dropdown>
    </div>
  );
}

function MessageBody({ message, outgoing, radius }) {
  const { attachment } = message;
  const bubbleColor = outgoing ? "bg-[#5821F5] text-white" : "bg-[#F0F2F5] text-[#050505]";
  return (
    <>
      {attachment?.type === "image" && (
        <a href={attachment.url} target="_blank" rel="noreferrer" className={cn("block overflow-hidden border border-slate-200", radius, FOCUS)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- ảnh khách gửi / ảnh tạm khi chọn tệp */}
          <img src={attachment.url} alt={attachment.name || "Hình ảnh"} className="block max-h-60 max-w-full object-cover bg-slate-100" />
        </a>
      )}
      {attachment && attachment.type !== "image" && (
        <a
          href={attachment.url}
          target="_blank"
          rel="noreferrer"
          download={attachment.name}
          className={cn("flex items-center gap-2 px-3.5 py-2 text-sm underline-offset-2 hover:underline", bubbleColor, radius, FOCUS)}
        >
          <Icon name="attach" className={outgoing ? "text-white" : "text-blue-600"} />
          <span className="truncate">{attachment.name || "Tệp đính kèm"}</span>
        </a>
      )}
      {message.text && (
        <div
          className={cn(
            "px-3.5 pt-[7px] pb-[8.25px] text-[15px] leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]",
            bubbleColor,
            radius,
            attachment && "mt-1",
          )}
        >
          {message.text}
        </div>
      )}
    </>
  );
}

function MessageRow({ message, outgoing, radius, showAvatar, avatar, customerName, onReply, onReact, onRetry }) {
  return (
    <div className={cn("group/msg flex items-center w-full", outgoing ? "justify-end" : "justify-start")}>
      {outgoing && <MessageActions message={message} outgoing onReply={onReply} onReact={onReact} />}

      {!outgoing && (
        <span className="self-end shrink-0 w-7 mr-2">{showAvatar && <Avatar src={avatar} name={customerName} size={28} />}</span>
      )}

      <div
        className={cn(
          "relative min-w-0 max-w-[70%] flex flex-col",
          outgoing ? "items-end" : "items-start",
          message.reaction && "mb-3",
          message.status === "sending" && "opacity-70",
        )}
        title={formatTime(message.createdAt)}
      >
        {message.replyTo && (
          <div className="max-w-full -mb-2.5 pb-3.5 pt-1.5 px-3 rounded-[14px] bg-slate-200/80 text-xs leading-4 text-slate-500">
            <span className="block text-[11px] text-slate-400">Trả lời</span>
            <span className="line-clamp-2 [overflow-wrap:anywhere]">{message.replyTo.text}</span>
          </div>
        )}
        <MessageBody message={message} outgoing={outgoing} radius={radius} />
        {message.reaction && (
          <span
            className={cn(
              "absolute -bottom-3 rounded-full bg-white px-1 text-xs leading-5 shadow ring-1 ring-slate-200",
              outgoing ? "left-1" : "right-1",
            )}
            aria-label={`Cảm xúc ${message.reaction}`}
          >
            {message.reaction}
          </span>
        )}
        {message.status === "failed" && (
          <button type="button" onClick={onRetry} className={cn("mt-1 text-[11px] leading-4 text-red-600 hover:underline", FOCUS)}>
            Gửi lỗi · Thử lại
          </button>
        )}
      </div>

      {!outgoing && <MessageActions message={message} onReply={onReply} onReact={onReact} />}
    </div>
  );
}

function MessageGroup({ group, conversation, onReply, onReact, onRetry }) {
  const outgoing = group.direction === "out";
  const count = group.messages.length;
  return (
    <div className={cn("flex flex-col gap-1", "mt-3", outgoing ? "items-end" : "items-start")}>
      {!outgoing && (
        <span className="pl-10 pb-0.5 text-xs leading-[18px] text-[#65676B]">{conversation.customerName || "Khách hàng"}</span>
      )}
      {group.messages.map((m, i) => (
        <MessageRow
          key={m.id}
          message={m}
          outgoing={outgoing}
          radius={bubbleRadius(group.direction, i, count)}
          showAvatar={i === count - 1}
          avatar={conversation.avatar}
          customerName={conversation.customerName}
          onReply={() => onReply(m)}
          onReact={(r) => onReact(m.id, r)}
          onRetry={() => onRetry(m)}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Banner 24h + ô soạn tin                                             */
/* ------------------------------------------------------------------ */

function ReplyWindowBanner({ lastInboundAt }) {
  const now = useNow();
  if (!lastInboundAt || now == null) return null;
  const remaining = new Date(lastInboundAt).getTime() + REPLY_WINDOW_MS - now;
  const expired = remaining <= 0;
  const left = Math.min(remaining, REPLY_WINDOW_MS);
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  return (
    <div
      role="status"
      className={cn(
        "shrink-0 flex items-center gap-2 px-4 py-1.5 border-y",
        expired ? "bg-red-50 border-red-200/70" : "bg-[#FFFBEB] border-[rgba(253,230,138,0.7)]",
      )}
    >
      <Icon name="warning" className={expired ? "text-red-500" : "text-[#F59E0B]"} />
      <span className={cn("text-xs leading-4 font-bold", expired ? "text-red-700" : "text-[#92400E]")}>
        {expired
          ? "Đã quá 24h kể từ tin nhắn cuối của khách — Facebook có thể chặn tin nhắn gửi đi."
          : `Còn ${hours}h ${minutes}m để phản hồi`}
      </span>
    </div>
  );
}

function Composer({ onSend, replyTo, onCancelReply, bordered }) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);
  const imageInputRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [replyTo]);

  const submit = () => {
    const text = draft.trim();
    if (!text) {
      inputRef.current?.focus();
      return;
    }
    onSend({ text });
    setDraft("");
  };

  /** Chèn chữ vào vị trí con trỏ */
  const insert = (value) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + value + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + value.length, start + value.length);
    });
  };

  const pickFile = (type) => (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    onSend({ text: "", attachment: { type, url: URL.createObjectURL(file), name: file.name } });
  };

  const actionBtn = "size-8 rounded-lg text-blue-600 hover:bg-blue-50";

  return (
    <div className={cn("shrink-0", bordered && "border-t border-slate-100")}>
      {replyTo && (
        <div className="flex items-center gap-2 px-4 pt-2 text-xs leading-4">
          <span className="min-w-0 flex-1 truncate text-slate-500">
            Đang trả lời <span className="font-semibold text-slate-700">{replyTo.direction === "out" ? "chính bạn" : "khách"}</span>
            {": "}
            {previewOf(replyTo)}
          </span>
          <IconButton label="Huỷ trả lời" onClick={onCancelReply} className="size-6 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            ✕
          </IconButton>
        </div>
      )}

      <div className="flex items-center gap-3 p-3">
        <div className="flex items-center gap-0.5 shrink-0">
          <IconButton label="Gửi hình ảnh" onClick={() => imageInputRef.current?.click()} className={actionBtn}>
            <Icon name="image" />
          </IconButton>
          <Dropdown
            label="Câu trả lời mẫu"
            panelClassName="left-0 bottom-full mb-2 w-80 p-1.5"
            trigger={({ open, toggle }) => (
              <IconButton label="Câu trả lời mẫu" aria-expanded={open} onClick={toggle} className={actionBtn}>
                <Icon name="smile" />
              </IconButton>
            )}
          >
            {(close) => (
              <>
                <p className="px-3 pt-1 pb-1.5 text-[11px] font-bold uppercase text-slate-400">Câu trả lời mẫu</p>
                {QUICK_REPLIES.map((q) => (
                  <MenuItem
                    key={q}
                    onClick={() => {
                      close();
                      insert(q);
                    }}
                  >
                    {q}
                  </MenuItem>
                ))}
              </>
            )}
          </Dropdown>
          <IconButton label="Đính kèm tệp" onClick={() => fileInputRef.current?.click()} className={actionBtn}>
            <Icon name="attach" />
          </IconButton>
          <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={pickFile("image")} />
          <input ref={fileInputRef} type="file" hidden onChange={pickFile("file")} />
        </div>

        <div className="flex-1 min-w-0 flex items-center bg-slate-50 border border-slate-200 rounded-full px-4 py-1.5 transition-colors focus-within:border-blue-300 focus-within:bg-white">
          <span className="shrink-0 pr-2 mr-2 border-r border-slate-300 text-xs leading-4 font-bold text-slate-400" aria-hidden="true">
            Aa
          </span>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
              if (e.key === "Escape" && replyTo) onCancelReply();
            }}
            placeholder="Nhập tin nhắn..."
            aria-label="Nhập tin nhắn"
            className="flex-1 min-w-0 bg-transparent text-xs leading-5 text-slate-800 placeholder:text-slate-400 outline-none"
          />
          <Dropdown
            label="Chọn biểu tượng cảm xúc"
            panelClassName="right-0 bottom-full mb-3 w-64 p-2 grid grid-cols-5 gap-1"
            trigger={({ open, toggle }) => (
              <IconButton
                label="Biểu tượng cảm xúc"
                aria-expanded={open}
                onClick={toggle}
                className="ml-2 rounded-full text-slate-400 hover:text-slate-600"
              >
                <Icon name="smile" />
              </IconButton>
            )}
          >
            {() =>
              EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  aria-label={em}
                  onClick={() => insert(em)}
                  className={cn("h-9 rounded-lg text-xl leading-none hover:bg-slate-100", FOCUS)}
                >
                  {em}
                </button>
              ))
            }
          </Dropdown>
        </div>

        <IconButton
          label="Gửi"
          onClick={submit}
          className="size-9 rounded-full bg-blue-600 text-white hover:bg-blue-700 shadow-[0px_4px_6px_-1px_#93C5FD,0px_2px_4px_-2px_#93C5FD]"
        >
          <Icon name="send" />
        </IconButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Khung chat                                                          */
/* ------------------------------------------------------------------ */

const PANEL =
  "flex-1 min-w-[360px] h-full flex flex-col bg-white border border-slate-200 rounded-xl shadow-[0px_1px_2px_rgba(0,0,0,0.05)] overflow-hidden";

/** Chưa chọn hội thoại */
export function ChatPlaceholder() {
  return (
    <section aria-label="Khung chat" className={cn(PANEL, "items-center justify-center gap-2 bg-slate-50/50 text-center px-6")}>
      <span className="size-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
        <MaskIcon src="/icons/icon_nav_chat.svg" width={30} height={13} />
      </span>
      <p className="text-sm font-bold text-slate-700">Chưa chọn hội thoại</p>
      <p className="text-xs text-slate-400">Chọn một hội thoại ở cột bên phải để xem và trả lời tin nhắn.</p>
    </section>
  );
}

/**
 * Khung chat của một hội thoại. Dùng `key={conversation.id}` ở nơi gọi để mỗi hội thoại có
 * trạng thái riêng (đang trả lời tin nào, nội dung đang gõ...).
 *  - messages : danh sách tin (cũ -> mới); undefined = đang tải
 *  - onSend({ text, attachment?, replyTo? }), onReact(messageId, emoji), onRetry(message)
 */
export default function ChatWindow({
  conversation,
  pageName,
  messages,
  onSend,
  onReact,
  onRetry,
  onToggleStar,
  onToggleTag,
  onMarkUnread,
  onClose,
}) {
  const [replyTo, setReplyTo] = useState(null);
  const scrollRef = useRef(null);

  const rows = useMemo(() => buildRows(messages || []), [messages]);
  const lastInboundAt = useMemo(() => [...(messages || [])].reverse().find((m) => m.direction === "in")?.createdAt, [messages]);

  // Có tin mới -> cuộn xuống cuối
  const count = messages?.length ?? 0;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  const send = (payload) => {
    onSend(replyTo ? { ...payload, replyTo: { id: replyTo.id, text: previewOf(replyTo) } } : payload);
    setReplyTo(null);
  };

  const showBanner = Boolean(lastInboundAt);

  return (
    <section aria-label="Khung chat" className={PANEL}>
      <ChatHeader
        conversation={conversation}
        pageName={pageName}
        onToggleStar={onToggleStar}
        onToggleTag={onToggleTag}
        onMarkUnread={onMarkUnread}
        onClose={onClose}
      />

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto bg-slate-50/50" aria-live="polite">
        {messages === undefined ? (
          <p className="py-10 text-center text-xs text-slate-400">Đang tải tin nhắn...</p>
        ) : messages.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-400">Chưa có tin nhắn nào.</p>
        ) : (
          <div className="flex flex-col px-6 pb-4">
            {rows.map((row) =>
              row.type === "separator" ? (
                <div key={row.id} className="flex justify-center pt-4 pb-6">
                  <span className="rounded-full bg-slate-200/70 px-3 py-0.5 text-[11px] leading-5 text-slate-500">
                    {formatSeparator(row.createdAt)}
                  </span>
                </div>
              ) : (
                <MessageGroup
                  key={row.id}
                  group={row}
                  conversation={conversation}
                  onReply={setReplyTo}
                  onReact={onReact}
                  onRetry={onRetry}
                />
              ),
            )}
          </div>
        )}
      </div>

      {showBanner && <ReplyWindowBanner lastInboundAt={lastInboundAt} />}
      <Composer onSend={send} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} bordered={!showBanner} />
    </section>
  );
}
