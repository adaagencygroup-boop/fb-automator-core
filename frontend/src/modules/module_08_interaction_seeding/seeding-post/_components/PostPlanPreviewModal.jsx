"use client";

/**
 * "Xem trước kế hoạch": nick nào làm gì ở bài nào (backend tính bằng đúng cách chia lượt khi chạy thật,
 * nhưng chưa ghi gì; phần ngẫu nhiên — nick nào / câu nào — có thể khác ở lần chạy thật).
 */
import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { Loader2, MessageCircle, Share2, ThumbsUp, X } from "lucide-react";

const REACTION_NAMES = { LIKE: "Thích", LOVE: "Yêu thích", CARE: "Thương", HAHA: "Haha", WOW: "Wow", SAD: "Buồn", ANGRY: "Phẫn nộ" };
const ACTION_NAMES = { REACT: "cảm xúc", COMMENT: "bình luận", SHARE: "chia sẻ" };
const fmt = (n) => Number(n || 0).toLocaleString("vi-VN");
const nick = (x) => x.name || x.uid;

function reactionSummary(list) {
  const counts = {};
  for (const r of list) counts[r.reaction] = (counts[r.reaction] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${REACTION_NAMES[k] || k}`)
    .join(" · ");
}

export default function PostPlanPreviewModal({ open, onClose, loading, plan, error }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="plan-preview-title" className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h3 id="plan-preview-title" className="text-base font-bold text-gray-900">Xem trước kế hoạch seeding</h3>
            <p className="text-xs text-gray-500">Chưa chạy gì. Nick / câu bình luận cụ thể được chọn ngẫu nhiên nên lần chạy thật có thể khác.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin text-blue-600" /> Đang tính kế hoạch...
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>
          ) : plan ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {[
                  ["Bài viết", fmt(plan.post_count)],
                  ["Tài khoản", fmt(plan.accounts)],
                  ["Cảm xúc", fmt(plan.totals?.REACT)],
                  ["Bình luận", fmt(plan.totals?.COMMENT)],
                  ["Chia sẻ", fmt(plan.totals?.SHARE)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2">
                    <div className="text-[11px] text-gray-500">{label}</div>
                    <div className="text-lg font-bold text-gray-900">{value}</div>
                  </div>
                ))}
              </div>
              {plan.totals?.SKIPPED > 0 && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {fmt(plan.totals.SKIPPED)} lượt sẽ bị bỏ qua vì nick đã làm hành động đó trên bài từ trước.
                </p>
              )}
              {plan.distribution_mode === "rotation" && plan.by_account?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-slate-600">
                    Chia xoay vòng: mỗi tài khoản <b>{fmt(plan.posts_per_account)}</b> bài liên tiếp, hết tài khoản thì quay lại tài khoản đầu.
                  </p>
                  <div className="overflow-x-auto rounded-xl border border-slate-200 text-[11px]">
                    <table className="w-full border-collapse text-left">
                      <thead className="bg-slate-50 font-bold text-slate-600">
                        <tr>
                          <th className="px-3 py-2">Tài khoản</th>
                          <th className="px-3 py-2 text-right">Số bài</th>
                          <th className="px-3 py-2 text-right">Cảm xúc</th>
                          <th className="px-3 py-2 text-right">Bình luận</th>
                          <th className="px-3 py-2 text-right">Chia sẻ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {plan.by_account.map((a) => (
                          <tr key={a.uid}>
                            <td className="px-3 py-1.5 font-semibold">{nick(a)}</td>
                            <td className="px-3 py-1.5 text-right">{fmt(a.posts)}</td>
                            <td className="px-3 py-1.5 text-right">{fmt(a.react)}</td>
                            <td className="px-3 py-1.5 text-right">{fmt(a.comment)}</td>
                            <td className="px-3 py-1.5 text-right">{fmt(a.share)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {plan.post_count > plan.shown && (
                <p className="text-xs text-gray-500">Hiện chi tiết {fmt(plan.shown)} bài đầu / {fmt(plan.post_count)} bài.</p>
              )}

              {plan.posts.map((p) => (
                <div key={p.index} className="space-y-2 rounded-xl border border-gray-200 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-xs font-bold text-gray-900">
                      Bài {p.index}: {p.name}
                      {p.owner && <span className="ml-2 font-semibold text-blue-700">· {nick(p.owner)}</span>}
                    </span>
                    {p.url && (
                      <a href={p.url} target="_blank" rel="noreferrer" className="shrink-0 text-[11px] font-semibold text-blue-700 hover:underline">
                        Mở bài
                      </a>
                    )}
                  </div>
                  {p.react.length > 0 && (
                    <div className="flex items-start gap-2 text-[11px] text-gray-700">
                      <ThumbsUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" />
                      <span>
                        <b>{p.react.length} cảm xúc</b> ({reactionSummary(p.react)}) — {p.react.slice(0, 6).map(nick).join(", ")}
                        {p.react.length > 6 ? `, +${p.react.length - 6} nick` : ""}
                      </span>
                    </div>
                  )}
                  {p.comment.length > 0 && (
                    <div className="flex items-start gap-2 text-[11px] text-gray-700">
                      <MessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-700" />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <b>{p.comment.length} bình luận</b>
                        {p.comment.slice(0, 5).map((c) => (
                          <div key={c.uid} className="truncate">
                            <span className="font-semibold">{nick(c)}:</span> “{c.text}”
                          </div>
                        ))}
                        {p.comment.length > 5 && <div className="text-gray-500">… và {p.comment.length - 5} bình luận khác</div>}
                      </div>
                    </div>
                  )}
                  {p.share.length > 0 && (
                    <div className="flex items-start gap-2 text-[11px] text-gray-700">
                      <Share2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-700" />
                      <span>
                        <b>{p.share.length} chia sẻ</b> — {p.share.slice(0, 6).map(nick).join(", ")}
                        {p.share.length > 6 ? `, +${p.share.length - 6} nick` : ""}
                      </span>
                    </div>
                  )}
                  {p.skipped.length > 0 && (
                    <div className="text-[11px] text-amber-800">
                      Bỏ qua {p.skipped.length} lượt đã làm từ trước (
                      {[...new Set(p.skipped.map((s) => ACTION_NAMES[s.action] || s.action))].join(", ")}).
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end border-t border-gray-100 px-6 py-3">
          <button type="button" onClick={onClose} className="h-10 rounded-xl border border-gray-200 px-5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
            Đóng
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
