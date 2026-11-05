"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Eye, Lock, Film, Image as ImageIcon } from "lucide-react";
import { mediaFileUrl } from "./PostImageModal";

/**
 * Locked read-only preview of post content while a publish session is running.
 * Click a progress-table row (or the card selector) to switch which post is shown.
 */
export function PostProgressPreview({
  rows = [],
  postType = "status",
  selectedId = null,
  onSelectId = null,
}) {
  const list = Array.isArray(rows) ? rows : [];

  const autoActiveId = useMemo(() => {
    const running = list.find((r) => r?.status === "Đang chạy");
    if (running) return String(running.id || running.threadId || "");
    const paused = list.find((r) => r?.status === "Tạm dừng");
    if (paused) return String(paused.id || paused.threadId || "");
    if (list[0]) return String(list[0].id || list[0].threadId || "");
    return "";
  }, [list]);

  const [internalId, setInternalId] = useState("");
  const activeId = selectedId != null && selectedId !== "" ? String(selectedId) : internalId || autoActiveId;

  useEffect(() => {
    if (selectedId != null && selectedId !== "") return;
    if (!internalId || !list.some((r) => String(r.id || r.threadId) === internalId)) {
      setInternalId(autoActiveId);
    }
  }, [autoActiveId, internalId, list, selectedId]);

  const active = useMemo(
    () => list.find((r) => String(r.id || r.threadId) === String(activeId)) || list[0] || null,
    [list, activeId]
  );

  if (!list.length) return null;

  const ptype = (active?.postType || postType || "status").toLowerCase();
  const content = (active?.content || "").trim();
  const imagePaths = Array.isArray(active?.imagePaths)
    ? active.imagePaths.filter(Boolean)
    : [];
  const mediaPath = (active?.mediaPath || "").trim();
  const mediaName = active?.mediaName || (mediaPath ? mediaPath.split(/[/\\]/).pop() : "");
  const isMediaPost = ptype === "reels" || ptype === "story";

  const selectRow = (row) => {
    const id = String(row?.id || row?.threadId || "");
    if (!id) return;
    if (onSelectId) onSelectId(id);
    else setInternalId(id);
  };

  return (
    <div className="rounded-2xl border border-slate-200/90 bg-slate-50/80 overflow-hidden shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 bg-white px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#1D49BF] text-white">
            <Eye size={15} />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-bold text-slate-900 truncate">
              Xem trước nội dung đang đăng
            </h4>
            <p className="text-[11px] text-slate-500 truncate">
              {active
                ? `${active.accountName || "Tài khoản"} · ${active.accountUid || "—"} · ${active.threadId || "—"}`
                : "Chọn một dòng trong bảng tiến trình"}
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-800">
          <Lock size={11} />
          Đã khóa chỉnh sửa
        </span>
      </div>

      {list.length > 1 && (
        <div className="flex gap-2 overflow-x-auto border-b border-slate-200/70 bg-white px-3 py-2">
          {list.map((row) => {
            const id = String(row.id || row.threadId || "");
            const selected = id === String(activeId);
            return (
              <button
                key={id}
                type="button"
                onClick={() => selectRow(row)}
                className={`shrink-0 rounded-xl border px-3 py-1.5 text-left transition-colors cursor-pointer ${
                  selected
                    ? "border-blue-300 bg-blue-50 text-blue-800"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
                title={row.contentPreview || row.accountName}
              >
                <span className="block text-[10px] font-bold font-mono">{row.threadId || "—"}</span>
                <span className="block max-w-[140px] truncate text-[11px] font-semibold">
                  {row.accountName || row.accountUid}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="p-4 space-y-3">
        {isMediaPost && mediaPath ? (
          <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-slate-400">
              {/\.(jpe?g|png|webp|gif|bmp)$/i.test(mediaPath) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaFileUrl(mediaPath)}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <Film size={22} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {ptype === "reels" ? "Video Reels" : "Media Story"}
              </p>
              <p className="mt-0.5 truncate text-xs font-semibold text-slate-800" title={mediaPath}>
                {mediaName || mediaPath}
              </p>
              <p className="mt-1 font-mono text-[10px] text-slate-400 break-all line-clamp-2">
                {mediaPath}
              </p>
            </div>
          </div>
        ) : null}

        {!isMediaPost && imagePaths.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {imagePaths.map((p) => (
              <div
                key={p}
                className="relative h-20 w-20 overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
                title={p}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaFileUrl(p)} alt="" className="h-full w-full object-cover" />
              </div>
            ))}
          </div>
        ) : null}

        {!isMediaPost && imagePaths.length === 0 && !content ? (
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white px-3 py-6 text-xs text-slate-400 justify-center">
            <ImageIcon size={14} />
            Chưa có nội dung xem trước cho bài này
          </div>
        ) : null}

        {(content || isMediaPost) && (
          <textarea
            readOnly
            value={
              content ||
              (isMediaPost
                ? `(Không có caption) — file: ${mediaName || mediaPath || "—"}`
                : "")
            }
            rows={Math.min(12, Math.max(4, (content || "").split("\n").length + 1))}
            className="w-full resize-none rounded-xl border border-slate-200 bg-white p-3.5 text-xs sm:text-[13px] leading-relaxed text-slate-800 font-sans cursor-default focus:outline-none [scrollbar-width:thin]"
            aria-label="Nội dung bài viết đang đăng (chỉ xem)"
          />
        )}

        {content ? (
          <p className="text-[11px] text-slate-500">{content.length} ký tự · chỉ xem, không chỉnh sửa</p>
        ) : null}
      </div>
    </div>
  );
}

export default PostProgressPreview;
