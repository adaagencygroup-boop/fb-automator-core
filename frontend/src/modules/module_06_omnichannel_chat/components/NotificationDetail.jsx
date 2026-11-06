"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import {
  ArrowLeft,
  MessageCircle,
  Share2,
  Eye,
  ThumbsUp,
  AlertTriangle,
  ExternalLink,
  Info,
  Smile,
  Image as ImageIcon,
  SendHorizontal,
  X,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { REACTION_META, ReactionIcon } from "./ReactionIcons";
import ReactionDialog from "./ReactionDialog";
import CommentSortMenu from "./CommentSortMenu";
import CommentThread from "./CommentThread";
import PostInsightsDialog from "./PostInsightsDialog";
import EmojiPickerPanel from "./EmojiPickerPanel";
import { Initial } from "./atoms";
import {
  getPostDetails,
  postIdFromNotification,
  DEFAULT_COMMENT_SORT,
  setPostLike,
  replyToComment,
  uploadMedia,
  displayMediaUrl,
  friendlyFbError,
} from "../service";

// Figma: "Chi tiết thông báo" (1593:2826) — bài viết Fanpage
//        "Chi tiết thông báo (bài viết trên nhóm)" (1601:3727) — bài ngoài Fanpage (is_external)

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500";

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

/**
 * Cảm xúc chia theo loại, như dưới bài viết Facebook: chồng vài biểu tượng
 * nhiều lượt nhất rồi tới tổng số. Di chuột vào xem đủ từng loại.
 *
 * Backend chỉ gắn `reaction_breakdown` khi Graph trả được; không có thì lùi về
 * một biểu tượng thích màu xanh kèm tổng, đúng như trước đây.
 */
const formatCount = (n) => Number(n || 0).toLocaleString("vi-VN");

/** 2500 -> "2,5K"; dưới 1000 thì giữ nguyên số */
function compactCount(n) {
  const v = Number(n || 0);
  if (v < 1000) return String(v);
  if (v < 1000000) {
    const k = v / 1000;
    return `${(k >= 100 ? Math.round(k) : Number(k.toFixed(1))).toString().replace(".", ",")}K`;
  }
  const m = v / 1000000;
  return `${Number(m.toFixed(1)).toString().replace(".", ",")}M`;
}

/**
 * Dòng tóm tắt cảm xúc dưới bài viết. Bấm vào mở hộp thoại xem ai thả cảm xúc gì
 * (giống Facebook). Chưa có `reaction_breakdown` thì lùi về một biểu tượng Thích
 * kèm tổng số, và không bấm được vì chẳng có gì để xem chi tiết.
 */
/** Chồng biểu tượng các loại cảm xúc nhiều nhất — đứng bên phải thanh như Facebook */
function ReactionStack({ post, breakdown, total: totalProp, onOpen, size = 20 }) {
  const total = totalProp ?? countOf(post?.reactions);
  const ranked = Object.entries(breakdown ?? post?.reaction_breakdown ?? {})
    .filter(([key, n]) => REACTION_META[key] && n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!total) return null;

  const shown = ranked.length ? ranked.slice(0, 3) : [["like", total]];
  const title = ranked.length
    ? ranked.map(([key, n]) => `${REACTION_META[key].label} ${formatCount(n)}`).join(" · ")
    : undefined;

  return (
    <button
      type="button"
      onClick={onOpen}
      title={title}
      aria-label={`Xem ${formatCount(total)} người đã bày tỏ cảm xúc`}
      className={cn("flex shrink-0 items-center rounded transition-opacity hover:opacity-80", FOCUS)}
    >
      {shown.map(([key], i) => (
        <ReactionIcon
          key={key}
          type={key}
          size={size}
          ring
          style={{ zIndex: shown.length - i }}
          className={cn("relative", i > 0 && "-ml-1.5")}
        />
      ))}
    </button>
  );
}

/** Một ô số liệu trong thanh: biểu tượng viền + con số gọn */
function StatItem({ icon: Icon, value, label, onClick, title }) {
  const inner = (
    <>
      <Icon className="size-[18px]" strokeWidth={1.8} />
      <span className="text-sm">{compactCount(value)}</span>
    </>
  );
  const cls = "inline-flex items-center gap-1.5 text-slate-500";
  if (!onClick) {
    return (
      <span className={cls} title={title} aria-label={label}>
        {inner}
      </span>
    );
  }
  return (
    <button type="button" onClick={onClick} title={title} aria-label={label}
      className={cn(cls, "rounded transition-colors hover:text-slate-800", FOCUS)}>
      {inner}
    </button>
  );
}

function ReactionSummary({ post, onOpen }) {
  const total = countOf(post?.reactions);
  const breakdown = post?.reaction_breakdown;
  // Nhiều lượt nhất đứng trước, lấy tối đa 3 loại cho vừa chỗ
  const ranked = Object.entries(breakdown || {})
    .filter(([key, n]) => REACTION_META[key] && n > 0)
    .sort((a, b) => b[1] - a[1]);
  const shown = ranked.slice(0, 3);
  const title = ranked.length
    ? ranked.map(([key, n]) => `${REACTION_META[key].label} ${formatCount(n)}`).join(" · ")
    : undefined;

  const body = (
    <>
      <span className="flex items-center">
        {shown.length === 0 ? (
          <ReactionIcon type="like" size={18} />
        ) : (
          shown.map(([key], i) => (
            <ReactionIcon
              key={key}
              type={key}
              size={18}
              ring
              // z-index giảm dần -> loại nhiều lượt nhất nằm trên cùng, như Facebook
              style={{ zIndex: shown.length - i }}
              className={cn("relative", i > 0 && "-ml-[5px]")}
            />
          ))
        )}
      </span>
      {formatCount(total)}
    </>
  );

  if (!total) {
    return <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">{body}</span>;
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      title={title}
      aria-label={`Xem ${formatCount(total)} người đã bày tỏ cảm xúc`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded text-sm text-slate-600 hover:underline",
        FOCUS,
      )}
    >
      {body}
    </button>
  );
}

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

/** Thanh soạn bình luận dưới tên Page (đáy khung) */
function Composer({ pageName, page, disabled, onSubmit, replyTarget, onCancelReply }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [uploadError, setUploadError] = useState("");
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  // Khi bấm Trả lời một ai đó -> tự động focus vào ô nhập
  useEffect(() => {
    if (replyTarget) {
      inputRef.current?.focus();
    }
  }, [replyTarget]);

  const handlePickEmoji = (emoji) => {
    const el = inputRef.current;
    if (!el) {
      setText((prev) => prev + emoji);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    setTimeout(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    }, 0);
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    // Hiển thị preview ngay lập tức
    const blobUrl = URL.createObjectURL(file);
    setImagePreview(blobUrl);
    setImageUrl(null);
    setUploadError("");
    setUploading(true);

    try {
      const uploadedUrl = await uploadMedia(file);
      if (uploadedUrl) {
        setImageUrl(uploadedUrl);
      } else {
        throw new Error("Không nhận được URL ảnh sau khi tải.");
      }
    } catch (err) {
      setUploadError(err?.message || "Tải ảnh thất bại.");
      setImagePreview(null);
      setImageUrl(null);
    } finally {
      setUploading(false);
    }
  };

  const removeImage = () => {
    setImagePreview(null);
    setImageUrl(null);
    setUploadError("");
  };

  const submit = async () => {
    const value = text.trim();
    if ((!value && !imageUrl) || busy || disabled || uploading) return;
    setBusy(true);
    try {
      await onSubmit(value, imageUrl);
      setText("");
      removeImage();
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = !disabled && !busy && !uploading && (Boolean(text.trim()) || Boolean(imageUrl));

  const placeholderText = replyTarget
    ? `Trả lời ${replyTarget.name || "người dùng"} dưới tên ${pageName || "Page"}...`
    : `Bình luận dưới tên ${pageName || "Page"}...`;

  return (
    <div className="shrink-0 flex flex-col border-t border-slate-100 bg-white">
      {/* Banner đang trả lời ai đó */}
      {replyTarget && (
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/90 px-4 py-1.5 text-xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-slate-500">Đang trả lời</span>
            <span className="font-semibold text-slate-800 truncate">{replyTarget.name || "Người dùng"}</span>
            {replyTarget.message && (
              <span className="text-slate-400 truncate max-w-[200px] italic">
                “{replyTarget.message}”
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            title="Huỷ trả lời (chuyển về bình luận bài viết)"
            className="shrink-0 ml-2 rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div className="p-3">
        {/* Xem trước ảnh đính kèm nếu có */}
        {imagePreview && (
          <div className="relative mb-2 inline-flex items-center self-start rounded-lg border border-slate-200 bg-slate-50 p-1.5">
            <img
              src={imagePreview}
              alt="Đính kèm"
              className="h-16 w-16 rounded-md object-cover"
            />
            {uploading && (
              <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
                <Loader2 className="size-5 animate-spin text-white" />
              </div>
            )}
            <button
              type="button"
              onClick={removeImage}
              disabled={busy}
              aria-label="Xoá ảnh"
              className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full bg-slate-700 text-white shadow hover:bg-slate-900"
            >
              <X className="size-3" />
            </button>
          </div>
        )}

        {uploadError && (
          <p className="mb-2 text-xs text-rose-500">{uploadError}</p>
        )}

        <div className="flex items-center gap-2">
          <PageAvatar page={page} name={pageName} size={32} />
          <div className="flex flex-1 items-center gap-1 rounded-full bg-slate-100 pl-3 pr-1.5 py-1">
            <input
              ref={inputRef}
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                if (e.key === "Escape" && replyTarget) onCancelReply?.();
              }}
              disabled={disabled || busy}
              placeholder={placeholderText}
              className="flex-1 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 outline-none disabled:cursor-not-allowed"
            />

            <Dropdown
              label="Chọn biểu tượng cảm xúc"
              panelClassName="right-0 bottom-full mb-3 overflow-hidden shadow-xl"
              trigger={({ open, toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  aria-expanded={open}
                  aria-label="Biểu tượng cảm xúc"
                  className={cn(
                    "shrink-0 size-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600",
                    open && "text-blue-600 bg-blue-50",
                    FOCUS
                  )}
                >
                  <Smile className="size-4" />
                </button>
              )}
            >
              {() => <EmojiPickerPanel onPick={handlePickEmoji} />}
            </Dropdown>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || uploading}
              aria-label="Thêm ảnh"
              className={cn(
                "shrink-0 size-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 disabled:opacity-50",
                FOCUS
              )}
            >
              <ImageIcon className="size-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={handleFileChange}
            />
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            aria-label="Gửi bình luận"
            className={cn(
              "shrink-0 size-9 rounded-full flex items-center justify-center text-blue-600 hover:bg-blue-50 disabled:opacity-40",
              FOCUS
            )}
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : <SendHorizontal className="size-5" />}
          </button>
        </div>
      </div>
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
          <ReactionSummary post={post} />
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

/**
 * Ô đầu tiên của thanh thống kê — vừa hiện tổng cảm xúc, vừa LÀ nút Thích,
 * đúng như thanh dưới bài viết của Facebook.
 *
 * Trạng thái ban đầu lấy từ `likes.summary.has_liked`, không đoán. Đổi giao
 * diện ngay rồi mới gọi API; hỏng thì trả về nguyên trạng kèm báo lỗi.
 *
 * Nơi gọi phải đặt `key` theo khoá dữ liệu đã tải: `useState` chỉ chạy hàm khởi
 * tạo đúng một lần lúc mount, nên thiếu key thì sau mỗi lần tải lại nó vẫn giữ
 * trạng thái cũ, không theo kịp `has_liked` mới từ Graph.
 *
 * Xem AI đã thả cảm xúc thì bấm chồng biểu tượng bên phải thanh — tách hai
 * việc ra hai chỗ để không phải đoán bấm vào đây là thích hay là xem.
 */
function LikeStat({ post, postId, pageId, liked, total, onToggled }) {
  const summary = post?.likes?.summary;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canLike = summary?.can_like !== false;

  const toggle = async () => {
    if (busy || !pageId) return;
    const next = !liked;
    setBusy(true);
    setError("");
    onToggled(next);
    try {
      await setPostLike(postId, pageId, next);
    } catch (err) {
      onToggled(!next);
      setError(
        friendlyFbError(err?.message)
          || (next ? "Không thích được bài viết." : "Không bỏ thích được."),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={liked}
        disabled={busy || !canLike}
        title={canLike ? (liked ? "Bỏ thích bài viết" : "Thích bài viết") : "Facebook không cho thích bài này"}
        className={cn(
          "inline-flex items-center gap-1.5 rounded transition-colors disabled:opacity-50",
          liked ? "text-[#0866FF]" : "text-slate-500 hover:text-slate-800",
          FOCUS,
        )}
      >
        {liked ? (
          <ReactionIcon type="like" size={18} />
        ) : (
          <ThumbsUp className="size-[18px]" strokeWidth={1.8} />
        )}
        <span className={cn("text-sm", liked && "font-semibold")}>{compactCount(total)}</span>
      </button>
      {error && <span className="text-xs text-amber-600">{error}</span>}
    </>
  );
}

/** Biến thể bài viết Fanpage đầy đủ — Figma 1593:2826 */
function InternalPostView({ post, page, pageName, postId, onReload, sort, onSortChange, refreshing, threadKey }) {
  const videoSrc = post?.source || null;
  const imgSrc = post?.full_picture || null;

  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const postPageId = page?.id || post?.page_id;

  /**
   * Trạng thái Thích để ở đây chứ không trong LikeStat, vì cả thanh thống kê lẫn
   * hộp thoại chi tiết đều phải đếm theo cùng một con số. Trước đây thanh cộng
   * lạc quan +1 còn hộp thoại dùng số cũ từ server, nên lệch nhau 1.
   *
   * `likedOverride` là lựa chọn của người dùng, null = chưa bấm, theo server.
   * `likeDelta` tự về 0 khi server đuổi kịp — không cần dọn tay.
   */
  const serverLiked = Boolean(post?.likes?.summary?.has_liked);
  const [likedOverride, setLikedOverride] = useState(null);
  const liked = likedOverride === null ? serverLiked : likedOverride;
  const likeDelta = liked === serverLiked ? 0 : liked ? 1 : -1;
  const reactionTotal = Math.max(0, countOf(post?.reactions) + likeDelta);

  // Facebook không liệt kê chính Page trong /reactions dù có đếm, nên truyền
  // riêng xuống hộp thoại để nó tự chèn. Loại lấy từ `viewer_reaction`; chưa kịp
  // về thì mặc định "like", vì Graph chỉ cho thả LIKE qua cạnh /likes.
  const viewerReaction = useMemo(() => {
    if (!liked) return null;
    const raw = String(post?.reactions?.summary?.viewer_reaction || "").toLowerCase();
    return {
      id: postPageId,
      name: pageName || "Trang Facebook",
      avatar: page?.avatar || null,
      type: REACTION_META[raw] ? raw : "like",
    };
  }, [liked, post?.reactions?.summary?.viewer_reaction, postPageId, pageName, page?.avatar]);

  // Cộng luôn vào phần chia nhỏ: lượt của Page là LIKE
  const adjustedBreakdown = useMemo(() => {
    const bd = post?.reaction_breakdown;
    if (!bd || !likeDelta) return bd;
    return { ...bd, like: Math.max(0, (bd.like || 0) + likeDelta) };
  }, [post?.reaction_breakdown, likeDelta]);

  const [replyTarget, setReplyTarget] = useState(null); // { id, name, message }

  const submitComment = async (text, attachmentUrl) => {
    try {
      const targetId = replyTarget?.id || postId;
      await replyToComment(targetId, postPageId, text, attachmentUrl);
      setReplyTarget(null);
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

        {/* Số liệu bên trái, chồng biểu tượng cảm xúc bên phải — bố cục Facebook.
            Ô đầu tiên chính là nút Thích, nên không có hàng nút riêng phía dưới.
            Cũng không có nút Chia sẻ: /sharedposts chỉ đọc, Page không share được. */}
        <div className="flex items-center justify-between gap-3 border-y border-slate-100 py-2">
          <span className="flex min-w-0 items-center gap-4">
            <LikeStat
              post={post}
              postId={postId}
              pageId={postPageId}
              liked={liked}
              total={reactionTotal}
              onToggled={setLikedOverride}
            />
            {/* comment_total đếm cả câu trả lời; summary của danh sách chỉ đếm
                bình luận gốc vì nó lấy theo filter=toplevel */}
            <StatItem
              icon={MessageCircle}
              value={post?.comment_total ?? countOf(post?.comments)}
              label="bình luận"
              title="Bình luận"
            />
            <StatItem
              icon={Share2}
              value={countOf(post?.shares)}
              label="lượt chia sẻ"
              title="Lượt chia sẻ"
            />
            {/* Chỉ hiện khi Graph thực sự trả về — thiếu quyền read_insights thì
                `insights` không có, hiện "0 lượt xem" là nói dối */}
            {post?.insights?.views > 0 && (
              <StatItem
                icon={Eye}
                value={post.insights.views}
                label="lượt xem"
                title="Xem chi tiết hiệu suất bài viết"
                onClick={() => setInsightsOpen(true)}
              />
            )}
          </span>

          <ReactionStack
            post={post}
            breakdown={adjustedBreakdown}
            total={reactionTotal}
            onOpen={() => setReactionsOpen(true)}
          />
        </div>

        {/* Bình luận */}
        <CommentSortMenu value={sort} onChange={onSortChange} />
        {/* key = khoá tải: đổi bài hoặc đổi thứ tự thì dựng lại từ đầu, không để
            sót mấy trang đã "Xem thêm" của lần trước */}
        <CommentThread
          key={threadKey}
          post={post}
          postId={postId}
          pageId={postPageId}
          pageName={pageName}
          order={sort}
          onChanged={onReload}
          dimmed={refreshing}
          onReplyComment={(c) => {
            setReplyTarget({
              id: c.id,
              name: c.from?.name || "Người dùng",
              message: c.message || "",
            });
          }}
          activeReplyCommentId={replyTarget?.id}
        />
      </div>

      <Composer
        pageName={pageName}
        page={page}
        onSubmit={submitComment}
        replyTarget={replyTarget}
        onCancelReply={() => setReplyTarget(null)}
      />

      {insightsOpen && (
        <PostInsightsDialog
          insights={post?.insights}
          interactions={
            countOf(post?.reactions)
            + (post?.comment_total ?? countOf(post?.comments))
            + countOf(post?.shares)
          }
          onClose={() => setInsightsOpen(false)}
        />
      )}

      {reactionsOpen && (
        <ReactionDialog
          postId={postId}
          pageId={postPageId}
          breakdown={adjustedBreakdown}
          total={reactionTotal}
          viewer={viewerReaction}
          onClose={() => setReactionsOpen(false)}
        />
      )}
    </>
  );
}

export default function NotificationDetail({ notification, page, pageName, onBack, className }) {
  // Chỉ set state trong callback async (tránh setState đồng bộ trong effect gây render dây chuyền);
  // trạng thái "đang tải" suy ra từ việc dữ liệu đã khớp postId hiện tại hay chưa.
  const [fetched, setFetched] = useState({ forId: null, forKey: null, post: null, error: "" });
  const [reloadKey, setReloadKey] = useState(0);
  const [sort, setSort] = useState(DEFAULT_COMMENT_SORT);

  const postId = useMemo(() => postIdFromNotification(notification), [notification]);
  const pageId = notification?.pageId;
  const needFetch = Boolean(postId && pageId);
  const resolvedPageName = pageName || page?.name || "Trang Facebook";

  // Đổi thứ tự là phải hỏi lại Graph — sắp xếp diễn ra ở phía Facebook, không
  // phải trên dữ liệu đã tải. `reloadKey` nằm trong khoá để nút làm mới vẫn chạy.
  const fetchKey = `${postId}|${sort}|${reloadKey}`;

  useEffect(() => {
    if (!needFetch) return undefined;
    let alive = true;
    getPostDetails(postId, pageId, sort)
      .then((data) => {
        if (alive) setFetched({ forId: postId, forKey: fetchKey, post: data || {}, error: "" });
      })
      .catch((err) => {
        if (alive) {
          setFetched({
            forId: postId,
            forKey: fetchKey,
            post: { is_external: true },
            error: err?.message || "Không tải được chi tiết bài viết",
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [needFetch, postId, pageId, sort, fetchKey]);

  const reload = () => setReloadKey((k) => k + 1);
  // Khung xương cả trang chỉ khi đổi bài; đổi thứ tự thì giữ bài, chỉ mờ danh sách
  const loading = needFetch && fetched.forId !== postId;
  const refreshing = needFetch && !loading && fetched.forKey !== fetchKey;
  // CommentThread phải khoá theo DỮ LIỆU ĐÃ TẢI (`fetched.forKey`), không phải
  // khoá đang yêu cầu (`fetchKey`). Dùng fetchKey thì nó dựng lại NGAY lúc đổi
  // thứ tự, trong khi `post` vẫn đang là dữ liệu cũ — gặt lại đúng danh sách
  // cũ; rồi khi dữ liệu mới về, khoá không đổi nữa nên không dựng lại.
  // Kết quả: danh sách luôn chậm đúng một nhịp.
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
        <InternalPostView
          post={post}
          page={page}
          pageName={resolvedPageName}
          postId={postId}
          onReload={reload}
          sort={sort}
          onSortChange={setSort}
          refreshing={refreshing}
          threadKey={fetched.forKey}
        />
      )}

      {error && !loading && (
        <p className="shrink-0 border-t border-slate-100 px-5 py-2 text-xs text-amber-600">{friendlyFbError(error)}</p>
      )}
    </section>
  );
}
