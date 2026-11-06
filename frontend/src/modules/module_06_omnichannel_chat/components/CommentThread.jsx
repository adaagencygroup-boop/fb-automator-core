"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, relativeTime } from "./atoms";
import PrivateReplyDialog from "./PrivateReplyDialog";
import { ReactionIcon } from "./ReactionIcons";
import {
  replyToComment,
  reactToComment,
  hideComment,
  deleteComment,
  getPostComments,
  getCommentReplies,
  friendlyFbError,
} from "../service";

/**
 * Danh sách bình luận có phân cấp và phân trang.
 *
 * Cấp ngoài là bình luận gốc (Graph `filter=toplevel`); câu trả lời nằm lồng
 * bên trong, lấy bằng `filter=stream` nên mọi cấp con gộp phẳng thành một mạch
 * — đúng cách Facebook hiển thị, không thụt vào vô tận.
 *
 * Mỗi lần chỉ tải một trang; còn nữa thì hiện "Xem thêm".
 */

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-sky-500";

const countOf = (node) => Number(node?.summary?.total_count ?? 0) || 0;

/**
 * Số cảm xúc của một bình luận.
 *
 * Ưu tiên `reactions.summary` vì nó đếm đủ mọi loại; `like_count` chỉ đếm riêng
 * lượt Thích. Cả hai đều đã về sẵn cùng bình luận, không tốn thêm lệnh gọi nào.
 */
const reactionCountOf = (comment) =>
  Number(comment?.reactions?.summary?.total_count ?? comment?.like_count ?? 0) || 0;

/** Nút tải tiếp dùng chung cho cả bình luận gốc lẫn câu trả lời */
function LoadMore({ label, busy, error, onClick, className }) {
  return (
    <div className={className}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className={cn(
          "inline-flex items-center gap-1.5 rounded text-xs font-bold text-slate-600 hover:underline disabled:opacity-60",
          FOCUS,
        )}
      >
        {busy && <Loader2 className="size-3 animate-spin" />}
        {busy ? "Đang tải…" : label}
      </button>
      {error && <p className="mt-1 text-xs leading-4 text-amber-600">{error}</p>}
    </div>
  );
}

/**
 * Gỡ lớp bọc chuyển hướng của Facebook để lấy địa chỉ thật.
 *
 * Link ngoài bị bọc thành `l.facebook.com/l.php?u=<đã mã hoá>`. Trả về nguyên
 * chuỗi cũ nếu không phải dạng đó.
 */
function unwrapFbLink(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("facebook.com") && u.pathname === "/l.php") {
      return u.searchParams.get("u") || url;
    }
  } catch {
    /* không phải URL hợp lệ -> dùng nguyên */
  }
  return url;
}

/**
 * Ảnh / GIF / nhãn dán đính kèm bình luận.
 *
 * Đo thực tế trên Graph: cả ba loại `photo`, `animated_image_share` và `sticker`
 * đều trả ảnh ở `media.image.src` kèm width/height. Video thì nằm ở `media.source`.
 *
 * Nhãn dán để nhỏ như Facebook; ảnh và GIF lớn hơn nhưng vẫn phải chặn bề ngang
 * vì cột bình luận rất hẹp.
 *
 * Với GIF (`animated_image_share`), `media.image.src` chỉ là ẢNH TĨNH xem trước
 * (đo thực tế: image/jpeg 8.9 KB). Bản động nằm trong `attachment.url`, bọc qua
 * l.php (image/gif 691 KB). Nên phải gỡ bọc ra mới thấy GIF chạy.
 */
function CommentAttachment({ attachment, depth = 0 }) {
  const [animFailed, setAnimFailed] = useState(false);
  if (!attachment) return null;

  const kind = String(attachment.type || "");
  const media = attachment.media || {};
  const img = media.image || {};
  const href = attachment.url || attachment.target?.url || null;
  const subs = attachment.subattachments?.data;

  // Nhiều ảnh trong một bình luận -> vẽ từng cái
  if (Array.isArray(subs) && subs.length > 0) {
    return (
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {subs.slice(0, 4).map((sub, i) => (
          <CommentAttachment key={sub?.target?.id || i} attachment={sub} depth={depth} />
        ))}
      </div>
    );
  }

  if (media.source) {
    return (
      <video
        src={media.source}
        poster={img.src || undefined}
        controls
        className="mt-1.5 w-full max-w-[260px] rounded-lg bg-black"
      />
    );
  }

  if (!img.src) {
    if (!href) return null;
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={cn("mt-1.5 inline-block text-xs text-blue-600 hover:underline", FOCUS)}
      >
        Xem tệp đính kèm
      </a>
    );
  }

  const maxW = kind === "sticker" ? 120 : depth > 0 ? 180 : 240;
  const ratio = img.width && img.height ? img.height / img.width : null;

  // GIF: ưu tiên bản động; tải hỏng thì lùi về ảnh tĩnh chứ không để ô trống
  const animated = kind === "animated_image_share" ? unwrapFbLink(attachment.url) : null;
  const src = animated && !animFailed ? animated : img.src;

  const picture = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      onError={animated && !animFailed ? () => setAnimFailed(true) : undefined}
      alt={kind === "sticker" ? "Nhãn dán" : "Ảnh đính kèm"}
      loading="lazy"
      width={img.width || undefined}
      height={img.height || undefined}
      style={{ maxWidth: maxW, aspectRatio: ratio ? 1 / ratio : undefined }}
      className={cn(
        "block h-auto w-full object-cover",
        kind === "sticker" ? "bg-transparent" : "rounded-lg bg-slate-100",
      )}
    />
  );

  return (
    <div className="mt-1.5">
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className={cn("inline-block", FOCUS)}>
          {picture}
        </a>
      ) : (
        picture
      )}
    </div>
  );
}

function CommentCard({
  comment,
  pageName,
  pageId,
  onChanged,
  onReplyComment,
  activeReplyCommentId,
  depth = 0,
}) {
  // `is_hidden` từ Graph: bình luận đang bị ẩn vẫn ở lại trong danh sách, chỉ mờ
  // đi và đeo nhãn — bỏ khỏi danh sách thì không còn đường nào bỏ ẩn nữa.
  const [isHidden, setIsHidden] = useState(() => Boolean(comment?.is_hidden));
  const [removed, setRemoved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [likeBusy, setLikeBusy] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [busy, setBusy] = useState(false);
  // Trạng thái thực tế từ Graph (`user_likes`), không phải đoán từ lần bấm —
  // tải lại trang vẫn đúng, và biết cả lúc nào nên hiện "Bỏ thích".
  const [liked, setLiked] = useState(() => Boolean(comment?.user_likes));
  const [likeDelta, setLikeDelta] = useState(0); // bù số đếm ngay, không chờ tải lại
  const [likeError, setLikeError] = useState("");

  // Vài câu trả lời đầu đã về sẵn cùng bình luận gốc; phần còn lại tải thêm
  const seeded = comment?.comments;
  const [replies, setReplies] = useState(() => seeded?.data || []);
  const [replyAfter, setReplyAfter] = useState(() => seeded?.paging?.cursors?.after || null);
  const [moreReplies, setMoreReplies] = useState(() => Boolean(seeded?.paging?.next));
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [repliesError, setRepliesError] = useState("");

  const name = comment?.from?.name || "Người dùng";
  if (removed) return null;

  const hasText = Boolean(comment?.message);
  const reactions = Math.max(0, reactionCountOf(comment) + likeDelta);
  const canLike = comment?.can_like !== false;
  // Thiếu `summary` thì vẫn còn `paging.next` để biết còn nữa hay không
  const remainingReplies = Math.max(0, countOf(seeded) - replies.length);
  const canLoadReplies = moreReplies || remainingReplies > 0;

  /**
   * Thích / bỏ thích bình luận — cùng cạnh /likes, POST và DELETE.
   *
   * Tài liệu ghi cả hai thao tác "không được hỗ trợ", nhưng thực tế chạy được:
   * đo trên bình luận đã bấm thích thì Graph trả `user_likes = true`.
   *
   * Đổi giao diện NGAY rồi mới gọi API; hỏng thì trả về nguyên trạng kèm báo lỗi.
   * Chờ mạng xong mới đổi thì bấm xong tưởng như không ăn.
   */
  const toggleLike = async () => {
    if (busy || likeBusy) return;
    const next = !liked;
    setLikeBusy(true);
    setLikeError("");
    setLiked(next);
    setLikeDelta((d) => d + (next ? 1 : -1));
    try {
      await reactToComment(comment.id, pageId, "LIKE", next);
      // KHÔNG gọi onChanged: nó tải lại cả bài viết, đổi `threadKey` làm
      // CommentThread dựng lại từ đầu, và `liked` khởi tạo lại từ `user_likes`
      // — mất sạch trạng thái vừa bấm. Thích không đổi cấu trúc danh sách
      // nên không cần tải lại gì cả.
    } catch (err) {
      setLiked(!next);
      setLikeDelta((d) => d - (next ? 1 : -1));
      setLikeError(
        friendlyFbError(err?.message) || (next ? "Không thích được bình luận này." : "Không bỏ thích được."),
      );
    } finally {
      setLikeBusy(false);
    }
  };

  /** Ẩn / bỏ ẩn trên Facebook thật, không phải chỉ giấu khỏi màn hình */
  const toggleHide = async () => {
    if (actionBusy) return;
    const next = !isHidden;
    setActionBusy("hide");
    setActionError("");
    try {
      await hideComment(comment.id, pageId, next);
      setIsHidden(next);
    } catch (err) {
      setActionError(
        friendlyFbError(err?.message) || (next ? "Không ẩn được bình luận." : "Không bỏ ẩn được."),
      );
    } finally {
      setActionBusy("");
    }
  };

  /** Xoá hẳn — phải bấm xác nhận thêm một lần vì không hoàn lại được */
  const removeComment = async () => {
    if (actionBusy) return;
    setActionBusy("delete");
    setActionError("");
    try {
      await deleteComment(comment.id, pageId);
      setRemoved(true);
      onChanged?.();
    } catch (err) {
      setActionError(friendlyFbError(err?.message) || "Không xoá được bình luận.");
      setConfirmDelete(false);
    } finally {
      setActionBusy("");
    }
  };

  const loadMoreReplies = async () => {
    if (loadingReplies) return;
    setLoadingReplies(true);
    setRepliesError("");
    try {
      const res = await getCommentReplies(comment.id, pageId, { after: replyAfter || undefined });
      const fresh = Array.isArray(res?.data) ? res.data : [];
      // Không có con trỏ thì lệnh này lấy lại từ đầu -> THAY chứ đừng nối,
      // không thì mấy câu đã hiện sẵn bị lặp lại.
      setReplies((prev) => (replyAfter ? [...prev, ...fresh] : fresh));
      setReplyAfter(res?.paging?.cursors?.after || null);
      setMoreReplies(Boolean(res?.paging?.next));
    } catch (err) {
      setRepliesError(friendlyFbError(err?.message) || "Không tải thêm được câu trả lời.");
    } finally {
      setLoadingReplies(false);
    }
  };

  return (
    <li className="flex items-start gap-2.5">
      {/* Avatar và tên dẫn tới BÌNH LUẬN trên Facebook, không phải trang cá nhân.
          Graph không cho lấy link trang cá nhân: trường `link` bị gạt im lặng, còn
          `from.id` là app-scoped ID — đo thực tế facebook.com/<id> trả về đúng như
          một ID bịa đặt. Từ bình luận bấm vào tên là sang được, Facebook tự lo. */}
      {comment.permalink_url ? (
        <a
          href={comment.permalink_url}
          target="_blank"
          rel="noreferrer"
          title={`Mở bình luận của ${name} trên Facebook`}
          className={cn("shrink-0 rounded-full", FOCUS)}
        >
          <Avatar
            src={comment?.from?.picture?.data?.url}
            name={name}
            size={depth > 0 ? 28 : 32}
            className={cn("mt-0.5 transition-opacity hover:opacity-80", depth > 0 ? "text-xs" : "text-sm")}
          />
        </a>
      ) : (
        <Avatar
          src={comment?.from?.picture?.data?.url}
          name={name}
          size={depth > 0 ? 28 : 32}
          className={cn("mt-0.5", depth > 0 ? "text-xs" : "text-sm")}
        />
      )}
      <div className="min-w-0 flex-1">
        {/* Bọc `relative` để gắn huy hiệu cảm xúc vào góc bóng bóng như Facebook.
            Trước đây huy hiệu nằm trong hàng thao tác và đẩy bằng ml-auto, nên cột
            hẹp là cả hàng tràn xuống dòng, kéo "Xoá" rơi theo. */}
        <div className={cn("relative inline-block max-w-full", reactions > 0 && "mb-1")}>
          <div
            className={cn(
              "transition-opacity",
              // Chỉ có ảnh, không có chữ -> bỏ nền xám, để ảnh đứng trần như Facebook
              hasText ? "rounded-2xl bg-slate-100 px-3 py-2" : "pl-0.5",
              isHidden && "opacity-55",
            )}
          >
            <p className="text-[13px] leading-4 font-bold text-slate-900">
              {comment.permalink_url ? (
                <a
                  href={comment.permalink_url}
                  target="_blank"
                  rel="noreferrer"
                  title={`Mở bình luận của ${name} trên Facebook`}
                  className={cn("rounded hover:underline", FOCUS)}
                >
                  {name}
                </a>
              ) : (
                name
              )}
              {isHidden && (
                <span className="ml-1.5 rounded bg-slate-200 px-1.5 py-px align-middle text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Đã ẩn
                </span>
              )}
            </p>
            {hasText && (
              <p className="mt-0.5 text-sm leading-5 text-slate-800 break-words">{comment.message}</p>
            )}
            <CommentAttachment attachment={comment.attachment} depth={depth} />
          </div>

          {reactions > 0 && (
            <span
              title={`${reactions} lượt bày tỏ cảm xúc`}
              className="absolute -bottom-1.5 -right-1 inline-flex items-center gap-0.5 rounded-full bg-white px-1 py-px shadow-[0_1px_3px_rgba(0,0,0,0.16)] ring-1 ring-slate-200"
            >
              <ReactionIcon type="like" size={14} />
              <span className="text-[11px] font-semibold leading-4 text-slate-500">{reactions}</span>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-3 pt-1 text-xs leading-4">
          <span className="text-slate-500">{relativeTime(comment.created_time)}</span>
          <button
            type="button"
            onClick={toggleLike}
            aria-pressed={liked}
            disabled={likeBusy || !canLike}
            title={canLike ? (liked ? "Bỏ thích" : "Thích") : "Facebook không cho thích bình luận này"}
            className={cn(
              "inline-flex items-center gap-1 font-semibold transition-colors hover:underline disabled:opacity-50 disabled:hover:no-underline",
              liked ? "text-[#0866FF]" : "text-slate-600",
              FOCUS,
            )}
          >
            {liked && <ReactionIcon type="like" size={13} />}
            {liked ? "Đã thích" : "Thích"}
          </button>
          <button
            type="button"
            onClick={() => onReplyComment?.(comment)}
            className={cn(
              "font-semibold hover:underline",
              activeReplyCommentId === comment.id ? "text-blue-600 font-bold" : "text-slate-600",
              FOCUS
            )}
          >
            Trả lời
          </button>
          <button
            type="button"
            onClick={() => setMessaging(true)}
            className={cn("font-semibold text-blue-600 hover:underline", FOCUS)}
          >
            Gửi tin nhắn
          </button>
          <button
            type="button"
            onClick={toggleHide}
            disabled={Boolean(actionBusy)}
            className={cn("font-semibold text-slate-600 hover:underline disabled:opacity-50", FOCUS)}
          >
            {actionBusy === "hide" ? "Đang xử lý…" : isHidden ? "Bỏ ẩn" : "Ẩn"}
          </button>

          {/* Xoá không hoàn lại được nên phải bấm hai lần; dùng xác nhận tại chỗ
              chứ không window.confirm — hộp thoại trình duyệt chặn hết mọi thứ */}
          {confirmDelete ? (
            <>
              <button
                type="button"
                onClick={removeComment}
                disabled={Boolean(actionBusy)}
                className={cn("font-bold text-red-600 hover:underline disabled:opacity-50", FOCUS)}
              >
                {actionBusy === "delete" ? "Đang xoá…" : "Xoá thật?"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className={cn("font-semibold text-slate-500 hover:underline", FOCUS)}
              >
                Huỷ
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={Boolean(actionBusy)}
              className={cn("font-semibold text-slate-600 hover:underline disabled:opacity-50", FOCUS)}
            >
              Xoá
            </button>
          )}

        </div>

        {(likeError || actionError) && (
          <p role="alert" className="pl-3 pt-1 text-xs leading-4 text-amber-600">
            {likeError || actionError}
          </p>
        )}

        {/* Câu trả lời — chỉ lồng một cấp, vì stream đã gộp phẳng mọi cấp con */}
        {replies.length > 0 && (
          <ul className="mt-2.5 flex flex-col gap-2.5">
            {replies.map((r) => (
              <CommentCard
                key={r.id}
                comment={r}
                pageName={pageName}
                pageId={pageId}
                onChanged={onChanged}
                onReplyComment={onReplyComment}
                activeReplyCommentId={activeReplyCommentId}
                depth={depth + 1}
              />
            ))}
          </ul>
        )}

        {canLoadReplies && (
          <LoadMore
            className="mt-2 pl-3"
            label={remainingReplies > 0 ? `Xem thêm ${remainingReplies} câu trả lời` : "Xem thêm câu trả lời"}
            busy={loadingReplies}
            error={repliesError}
            onClick={loadMoreReplies}
          />
        )}
      </div>

      {messaging && (
        <PrivateReplyDialog
          comment={comment}
          pageName={pageName}
          pageId={pageId}
          onClose={() => setMessaging(false)}
          onSent={onChanged}
        />
      )}
    </li>
  );
}

export default function CommentThread({
  post,
  postId,
  pageId,
  pageName,
  order,
  onChanged,
  onReplyComment,
  activeReplyCommentId,
  dimmed,
}) {
  const seeded = post?.comments;
  const [comments, setComments] = useState(() => seeded?.data || []);
  const [after, setAfter] = useState(() => seeded?.paging?.cursors?.after || null);
  const [more, setMore] = useState(() => Boolean(seeded?.paging?.next));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // summary ở đây đếm theo toplevel, đúng cái cần để biết còn bao nhiêu bình
  // luận GỐC chưa tải. `post.comment_total` mới là tổng kể cả câu trả lời.
  const remaining = Math.max(0, countOf(seeded) - comments.length);
  const canLoadMore = more || remaining > 0;

  const loadMore = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await getPostComments(postId, pageId, { order, after: after || undefined });
      const fresh = Array.isArray(res?.data) ? res.data : [];
      setComments((prev) => (after ? [...prev, ...fresh] : fresh));
      setAfter(res?.paging?.cursors?.after || null);
      setMore(Boolean(res?.paging?.next));
    } catch (err) {
      setError(friendlyFbError(err?.message) || "Không tải thêm được bình luận.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-4 transition-opacity", dimmed && "pointer-events-none opacity-40")}>
      <ul className="flex flex-col gap-4">
        {comments.length === 0 && (
          <li className="py-6 text-center text-sm text-slate-400">
            {dimmed ? "Đang tải lại bình luận…" : "Chưa có bình luận nào."}
          </li>
        )}
        {comments.map((c) => (
          <CommentCard
            key={c.id}
            comment={c}
            pageName={pageName}
            pageId={pageId}
            onChanged={onChanged}
            onReplyComment={onReplyComment}
            activeReplyCommentId={activeReplyCommentId}
          />
        ))}
      </ul>

      {canLoadMore && (
        <LoadMore
          label={remaining > 0 ? `Xem thêm ${remaining} bình luận` : "Xem thêm bình luận"}
          busy={busy}
          error={error}
          onClick={loadMore}
        />
      )}
    </div>
  );
}
