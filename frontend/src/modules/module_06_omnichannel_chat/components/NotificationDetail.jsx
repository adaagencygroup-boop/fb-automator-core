"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  MoreVertical,
  ThumbsUp,
  MessageCircle,
  Share2,
  ChevronDown,
  AlertTriangle,
  ExternalLink,
  Info,
  Smile,
  Image as ImageIcon,
  SendHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getPostDetails,
  postIdFromNotification,
  replyToComment,
  privateReplyToComment,
  reactToComment,
  friendlyFbError,
} from "../service";

// Figma: "Chi tiết thông báo" (1593:2826) — bài viết Fanpage
//        "Chi tiết thông báo (bài viết trên nhóm)" (1601:3727) — bài ngoài Fanpage (is_external)

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500";

// Màu avatar chữ cái (nền / chữ) — đồng bộ với NotificationList
const AVATAR_COLORS = [
  ["#E1EFFF", "#1877F2"],
  ["#E5EDF9", "#295BAC"],
  ["#E1F7EB", "#00875A"],
  ["#FCE6E8", "#D83A52"],
  ["#FAECE0", "#B85718"],
];
function avatarColor(name = "") {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
const initialOf = (name = "") => (name.trim()[0] || "?").toUpperCase();

function Initial({ name, size = 32, className }) {
  const [bg, fg] = avatarColor(name);
  return (
    <span
      style={{ width: size, height: size, background: bg, color: fg }}
      className={cn("shrink-0 rounded-full flex items-center justify-center font-bold", className)}
      aria-hidden="true"
    >
      {initialOf(name)}
    </span>
  );
}

function PageAvatar({ page, name, size = 40 }) {
  if (page?.avatar) {
    return (
      <img
        src={page.avatar}
        alt=""
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full object-cover border border-slate-200"
      />
    );
  }
  return <Initial name={page?.name || name} size={size} className="text-lg" />;
}

/** Thời gian tương đối tiếng Việt (vd. "1 phút", "3 giờ", "2 ngày") */
function relativeTime(iso) {
  if (!iso) return "";
  let s = String(iso).trim();
  if (!s.endsWith("Z") && !s.includes("+") && !s.includes("-", 11)) s += "Z";
  const then = new Date(s).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Vừa xong";
  if (mins < 60) return `${mins} phút`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày`;
  return new Date(then).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fullDateTime(iso) {
  if (!iso) return "";
  let s = String(iso).trim();
  if (!s.endsWith("Z") && !s.includes("+") && !s.includes("-", 11)) s += "Z";
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric", hour12: false });
}

/** Tô màu xanh cho hashtag trong nội dung bài viết */
function renderMessage(message) {
  if (!message) return null;
  return String(message)
    .split(/(#[\p{L}\p{N}_]+)/u)
    .map((part, i) =>
      part.startsWith("#") ? (
        <span key={i} className="text-blue-600">
          {part}
        </span>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
}

const countOf = (obj) => Number(obj?.summary?.total_count ?? obj?.count ?? 0) || 0;

function Header({ title, subtitle, onBack }) {
  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-4 border-b border-slate-100">
      <button
        type="button"
        onClick={onBack}
        aria-label="Quay lại"
        className={cn("shrink-0 size-9 rounded-full flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors", FOCUS)}
      >
        <ArrowLeft className="size-5" />
      </button>
      <div className="min-w-0">
        <h2 className="truncate text-lg leading-6 font-bold text-slate-900">{title}</h2>
        {subtitle && <p className="truncate text-sm leading-5 text-slate-500">{subtitle}</p>}
      </div>
    </div>
  );
}

function CommentCard({ comment, pageName, pageId, onChanged }) {
  const [hidden, setHidden] = useState(false);
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false);
  const name = comment?.from?.name || "Người dùng";
  if (hidden) return null;

  const like = async () => {
    try {
      await reactToComment(comment.id, pageId, "LIKE");
      onChanged?.();
    } catch {
      /* im lặng, giữ nguyên UI */
    }
  };

  const sendReply = async (kind) => {
    const text = replyText.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      if (kind === "private") await privateReplyToComment(comment.id, pageId, text);
      else await replyToComment(comment.id, pageId, text);
      setReplyText("");
      setReplying(false);
      onChanged?.();
    } catch {
      /* giữ nội dung để thử lại */
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex items-start gap-2.5">
      <Initial name={name} size={32} className="mt-0.5 text-sm" />
      <div className="min-w-0 flex-1">
        <div className="inline-block max-w-full rounded-2xl bg-slate-100 px-3 py-2">
          <p className="text-[13px] leading-4 font-bold text-slate-900">{name}</p>
          {comment.message && <p className="mt-0.5 text-sm leading-5 text-slate-800 break-words">{comment.message}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3 pl-3 pt-1 text-xs leading-4">
          <span className="text-slate-500">{relativeTime(comment.created_time)}</span>
          <button type="button" onClick={like} className={cn("font-semibold text-slate-600 hover:underline", FOCUS)}>
            Thích
          </button>
          <button type="button" onClick={() => setReplying((v) => !v)} className={cn("font-semibold text-slate-600 hover:underline", FOCUS)}>
            Trả lời
          </button>
          <button
            type="button"
            onClick={() => setReplying(true)}
            className={cn("font-semibold text-blue-600 hover:underline", FOCUS)}
          >
            Gửi tin nhắn
          </button>
          <button type="button" onClick={() => setHidden(true)} className={cn("font-semibold text-slate-600 hover:underline", FOCUS)}>
            Ẩn
          </button>
        </div>

        {replying && (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendReply("public")}
              placeholder={`Trả lời dưới tên ${pageName || "Page"}...`}
              className="flex-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-100"
            />
            <button
              type="button"
              disabled={busy || !replyText.trim()}
              onClick={() => sendReply("public")}
              className={cn("shrink-0 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50", FOCUS)}
            >
              Gửi
            </button>
            <button
              type="button"
              disabled={busy || !replyText.trim()}
              onClick={() => sendReply("private")}
              title="Trả lời riêng vào hộp thư"
              className={cn("shrink-0 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-100 disabled:opacity-50", FOCUS)}
            >
              Nhắn riêng
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

/** Thanh soạn bình luận dưới tên Page (đáy khung) */
function Composer({ pageName, page, disabled, onSubmit }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const value = text.trim();
    if (!value || busy || disabled) return;
    setBusy(true);
    try {
      await onSubmit(value);
      setText("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="shrink-0 flex items-center gap-2 border-t border-slate-100 p-3">
      <PageAvatar page={page} name={pageName} size={32} />
      <div className="flex flex-1 items-center gap-1 rounded-full bg-slate-100 pl-3 pr-1.5 py-1">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          disabled={disabled}
          placeholder={`Bình luận dưới tên ${pageName || "Page"}...`}
          className="flex-1 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 outline-none disabled:cursor-not-allowed"
        />
        <button type="button" aria-label="Biểu tượng cảm xúc" className={cn("shrink-0 size-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600", FOCUS)}>
          <Smile className="size-4" />
        </button>
        <button type="button" aria-label="Thêm ảnh" className={cn("shrink-0 size-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600", FOCUS)}>
          <ImageIcon className="size-4" />
        </button>
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={disabled || busy || !text.trim()}
        aria-label="Gửi bình luận"
        className={cn("shrink-0 size-9 rounded-full flex items-center justify-center text-blue-600 hover:bg-blue-50 disabled:opacity-40", FOCUS)}
      >
        <SendHorizontal className="size-5" />
      </button>
    </div>
  );
}

/** Biến thể bài viết ngoài Fanpage (Nhóm / Trang khác) — Figma 1601:3727 */
function ExternalPostView({ post, page, pageName, link }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 p-5">
      {/* Banner cảnh báo */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-500" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-800">Bài viết trong nhóm / Trang khác</p>
            <p className="mt-1 text-sm leading-5 text-amber-700">
              Bài viết này được đăng trong Nhóm hoặc Trang khác. Facebook không hỗ trợ truy vấn chi tiết bài viết ngoài Fanpage qua Graph API.
            </p>
          </div>
        </div>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className={cn("mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700", FOCUS)}
          >
            <ExternalLink className="size-4" />
            Xem &amp; Trả lời bình luận trực tiếp trên Facebook
          </a>
        )}
      </div>

      {/* Card bài viết */}
      <div className="rounded-xl border border-slate-200 p-5">
        <div className="flex items-center gap-3">
          <PageAvatar page={page} name={pageName} size={48} />
          <div className="min-w-0">
            <p className="truncate text-[15px] leading-5 font-bold text-slate-900">{pageName || "Trang Facebook"}</p>
            <p className="text-sm leading-5 text-slate-500">Trang</p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
            <span className="flex size-5 items-center justify-center rounded-full bg-blue-600 text-white">
              <ThumbsUp className="size-3" />
            </span>
            {countOf(post?.reactions)}
          </span>
          <span className="flex items-center gap-4 text-sm text-slate-500">
            <span>{countOf(post?.comments)} bình luận</span>
            <span>{countOf(post?.shares)} lượt chia sẻ</span>
          </span>
        </div>

        <h3 className="mt-5 text-sm font-bold text-slate-900">Bình luận</h3>
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <MessageCircle className="size-8 text-slate-300" />
          <p className="text-sm text-slate-400">Chưa có bình luận nào.</p>
        </div>
      </div>

      {/* Banner thông tin */}
      <div className="flex items-start gap-2.5 rounded-lg bg-blue-50 p-3">
        <Info className="mt-0.5 size-4 shrink-0 text-blue-500" />
        <p className="text-sm leading-5 text-slate-600">
          Chức năng bình luận AI tự động khả dụng cho bài viết ngoài Fanpage.{" "}
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className="font-semibold text-blue-600 hover:underline">
              Tìm hiểu thêm
            </a>
          )}
        </p>
      </div>
    </div>
  );
}

/** Biến thể bài viết Fanpage đầy đủ — Figma 1593:2826 */
function InternalPostView({ post, page, pageName, postId, onReload }) {
  const comments = Array.isArray(post?.comments?.data) ? post.comments.data : [];
  const videoSrc = post?.source || null;
  const imgSrc = post?.full_picture || null;

  const submitComment = async (text) => {
    try {
      await replyToComment(postId, page?.id || post?.page_id, text);
      onReload?.();
    } catch {
      /* lỗi gửi — giữ nguyên */
    }
  };

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 p-5">
        {/* Tác giả bài viết */}
        <div className="flex items-start gap-3">
          <PageAvatar page={page} name={pageName} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] leading-5 font-bold text-slate-900">{pageName || "Trang Facebook"}</p>
            <p className="text-xs leading-4 text-slate-500">{fullDateTime(post?.created_time)}</p>
          </div>
          <button
            type="button"
            aria-label="Tùy chọn bài viết"
            className={cn("shrink-0 size-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100", FOCUS)}
          >
            <MoreVertical className="size-5" />
          </button>
        </div>

        {/* Nội dung */}
        {post?.message && (
          <p className="whitespace-pre-wrap break-words text-sm leading-5 text-slate-800">{renderMessage(post.message)}</p>
        )}

        {/* Media */}
        {videoSrc ? (
          <video src={videoSrc} poster={imgSrc || undefined} controls className="w-full rounded-lg bg-black" />
        ) : imgSrc ? (
          <img src={imgSrc} alt="" className="w-full rounded-lg bg-black object-contain" />
        ) : null}

        {/* Thống kê */}
        <div className="flex items-center justify-between border-y border-slate-100 py-2">
          <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
            <span className="flex size-5 items-center justify-center rounded-full bg-blue-600 text-white">
              <ThumbsUp className="size-3" />
            </span>
            {countOf(post?.reactions)}
          </span>
          <span className="flex items-center gap-4 text-sm text-slate-500">
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="size-4" />
              {countOf(post?.comments)} bình luận
            </span>
            <span className="inline-flex items-center gap-1">
              <Share2 className="size-4" />
              {countOf(post?.shares)} lượt chia sẻ
            </span>
          </span>
        </div>

        {/* Bình luận */}
        <button type="button" className={cn("inline-flex items-center gap-1 self-start text-sm font-semibold text-slate-700", FOCUS)}>
          Mới nhất
          <ChevronDown className="size-4" />
        </button>
        <ul className="flex flex-col gap-4">
          {comments.length === 0 && <li className="py-6 text-center text-sm text-slate-400">Chưa có bình luận nào.</li>}
          {comments.map((c) => (
            <CommentCard key={c.id} comment={c} pageName={pageName} pageId={page?.id || post?.page_id} onChanged={onReload} />
          ))}
        </ul>
      </div>

      <Composer pageName={pageName} page={page} onSubmit={submitComment} />
    </>
  );
}

export default function NotificationDetail({ notification, page, pageName, onBack, className }) {
  // Chỉ set state trong callback async (tránh setState đồng bộ trong effect gây render dây chuyền);
  // trạng thái "đang tải" suy ra từ việc dữ liệu đã khớp postId hiện tại hay chưa.
  const [fetched, setFetched] = useState({ forId: null, post: null, error: "" });
  const [reloadKey, setReloadKey] = useState(0);

  const postId = useMemo(() => postIdFromNotification(notification), [notification]);
  const pageId = notification?.pageId;
  const needFetch = Boolean(postId && pageId);
  const resolvedPageName = pageName || page?.name || "Trang Facebook";

  useEffect(() => {
    if (!needFetch) return undefined;
    let alive = true;
    getPostDetails(postId, pageId)
      .then((data) => {
        if (alive) setFetched({ forId: postId, post: data || {}, error: "" });
      })
      .catch((err) => {
        if (alive) setFetched({ forId: postId, post: { is_external: true }, error: err?.message || "Không tải được chi tiết bài viết" });
      });
    return () => {
      alive = false;
    };
  }, [needFetch, postId, pageId, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);
  const loading = needFetch && fetched.forId !== postId;
  const post = needFetch ? fetched.post : { is_external: true };
  const error = needFetch ? fetched.error : "";
  const isExternal = Boolean(post?.is_external);

  return (
    <section
      aria-label="Chi tiết bài viết"
      className={cn(
        "flex-1 min-w-0 h-full flex flex-col bg-white border border-slate-200 rounded-xl drop-shadow-[0px_1px_1px_rgba(0,0,0,0.05)] overflow-hidden",
        className,
      )}
    >
      <Header title="Chi tiết bài viết" subtitle={resolvedPageName} onBack={onBack} />

      {loading ? (
        <div className="flex-1 flex flex-col gap-4 p-5">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-full bg-slate-100 animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-1/3 rounded bg-slate-100 animate-pulse" />
              <div className="h-3 w-1/4 rounded bg-slate-100 animate-pulse" />
            </div>
          </div>
          <div className="h-4 w-3/4 rounded bg-slate-100 animate-pulse" />
          <div className="aspect-video w-full rounded-lg bg-slate-100 animate-pulse" />
        </div>
      ) : isExternal ? (
        <ExternalPostView post={post} page={page} pageName={resolvedPageName} link={notification?.link} />
      ) : (
        <InternalPostView post={post} page={page} pageName={resolvedPageName} postId={postId} onReload={reload} />
      )}

      {error && !loading && (
        <p className="shrink-0 border-t border-slate-100 px-5 py-2 text-xs text-amber-600">{friendlyFbError(error)}</p>
      )}
    </section>
  );
}
