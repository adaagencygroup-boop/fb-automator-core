"use client";

import { useEffect, useRef, useState } from "react";
import { X, Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, relativeTime } from "./atoms";
import { privateReplyToComment, friendlyFbError } from "../service";

/**
 * Nhắn riêng cho người bình luận, dựng theo hộp thoại "Message" của Facebook.
 *
 * Trích lại đúng bình luận đang trả lời ở trên ô soạn — nhắn riêng tách khỏi
 * luồng bình luận nên không nhắc lại thì người gửi dễ quên đang trả lời cái gì.
 *
 * Facebook chỉ cho nhắn riêng MỘT lần cho mỗi bình luận, và trong 7 ngày kể từ
 * lúc bình luận. Quá hạn hoặc đã nhắn rồi thì Graph trả lỗi — hiện nguyên văn.
 */

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-sky-500";

export default function PrivateReplyDialog({ comment, pageName, pageId, onClose, onSent }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const boxRef = useRef(null);

  const name = comment?.from?.name || "Người dùng";

  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    setError("");
    try {
      await privateReplyToComment(comment.id, pageId, value);
      onSent?.();
      onClose();
    } catch (err) {
      setError(friendlyFbError(err?.message) || "Không gửi được tin nhắn.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" aria-hidden="true" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Nhắn riêng cho ${name}`}
        className="relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="relative shrink-0 border-b border-slate-200 px-12 py-3">
          <h2 className="truncate text-center text-base font-bold text-slate-900">
            Nhắn riêng cho {name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className={cn(
              "absolute right-3 top-2.5 rounded-full bg-slate-100 p-1.5 text-slate-600 hover:bg-slate-200",
              FOCUS,
            )}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
          <p className="text-sm leading-5 text-slate-600">
            Mở một cuộc trò chuyện chỉ hai bên nhìn thấy. Tin nhắn này trả lời riêng cho bình luận
            của {name} trong Messenger.
          </p>

          {/* Trích lại bình luận đang trả lời */}
          <div className="mt-3.5 flex items-start gap-2.5">
            <Avatar src={comment?.from?.picture?.data?.url} name={name} size={40} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-5 text-slate-900">{name}</p>
              {comment?.message && (
                <p className="text-sm leading-5 text-slate-700 break-words">{comment.message}</p>
              )}
              <p className="mt-0.5 text-xs leading-4 text-slate-400">
                {relativeTime(comment?.created_time)}
              </p>
            </div>
          </div>

          <textarea
            ref={boxRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
            }}
            rows={5}
            placeholder={`Gửi tin nhắn với tư cách ${pageName || "Page"}`}
            className="mt-3.5 w-full resize-none rounded-lg border border-slate-300 px-3 py-2.5 text-sm leading-5 text-slate-800 placeholder:text-slate-400 outline-none transition-colors focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
          />

          {error && (
            <p role="alert" className="mt-2 text-xs leading-4 text-amber-600">
              {error}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className={cn("rounded-lg px-3 py-2 text-sm font-bold text-blue-600 hover:bg-blue-50", FOCUS)}
          >
            Quay lại bình luận
          </button>
          <button
            type="button"
            onClick={send}
            disabled={busy || !text.trim()}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400",
              FOCUS,
            )}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {busy ? "Đang gửi…" : "Gửi tin nhắn"}
          </button>
        </div>
      </div>
    </div>
  );
}
