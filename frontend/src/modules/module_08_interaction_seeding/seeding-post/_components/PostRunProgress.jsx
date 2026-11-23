"use client";

/**
 * Tiến độ lô seeding: tổng + từng bài × từng loại tương tác, kèm "Thử lại lượt lỗi" khi lô đã xong.
 * progress = kết quả GET /api/seeding/campaigns/{id}/batch-progress.
 */
import React, { useState } from "react";
import { Clock, Loader2, PauseCircle, RotateCcw } from "lucide-react";
import Pagination from "@/components/ui/pagination";

const PAGE_SIZE = 10;
const ACTION_META = [
  { key: "REACT", label: "Cảm xúc", bar: "bg-blue-600" },
  { key: "COMMENT", label: "Bình luận", bar: "bg-sky-600" },
  { key: "SHARE", label: "Chia sẻ", bar: "bg-violet-600" },
];
const fmt = (n) => Number(n || 0).toLocaleString("vi-VN");

function MiniBar({ counts, bar }) {
  const total = counts?.total || 0;
  if (!total) return <span className="text-[11px] text-gray-400">—</span>;
  const done = (counts.success || 0) + (counts.failed || 0) + (counts.skipped || 0);
  return (
    <span className="flex flex-col gap-1">
      <span className="text-[11px] text-gray-600">
        {fmt(counts.success)}/{fmt(total)}
        {counts.failed ? <span className="text-rose-600"> · {fmt(counts.failed)} lỗi</span> : null}
      </span>
      <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded-full bg-gray-100">
        <span className={`block h-full ${bar}`} style={{ width: `${Math.round((done / total) * 100)}%` }} />
      </span>
    </span>
  );
}

function postStatus(p) {
  const all = ACTION_META.reduce(
    (acc, a) => {
      const c = p.actions?.[a.key] || {};
      acc.total += c.total || 0;
      acc.pending += c.pending || 0;
      return acc;
    },
    { total: 0, pending: 0 },
  );
  if (p.status === "STOPPED") return { text: "Đã dừng", cls: "bg-amber-50 text-amber-800" };
  if (all.total && !all.pending) return { text: "Xong", cls: "bg-emerald-50 text-emerald-700" };
  if (p.status === "RUNNING") return { text: "Đang chạy", cls: "bg-blue-50 text-blue-700" };
  return { text: "Chờ", cls: "bg-gray-100 text-gray-700" };
}

export default function PostRunProgress({ progress, isRunning, onRetry, retrying = false }) {
  const [page, setPage] = useState(1);
  if (!progress) return null;
  const t = progress.totals || {};
  const done = (t.success || 0) + (t.failed || 0) + (t.skipped || 0);
  const pct = t.total ? Math.round((done / t.total) * 100) : 0;
  const posts = progress.posts || [];
  const totalPages = Math.max(1, Math.ceil(posts.length / PAGE_SIZE));
  const visible = posts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  let state = { text: "Đã xong", cls: "bg-emerald-50 text-emerald-700" };
  if (progress.scheduled_at) state = { text: `Hẹn giờ ${new Date(progress.scheduled_at).toLocaleString("vi-VN")}`, cls: "bg-indigo-50 text-indigo-700", Icon: Clock };
  else if (progress.paused) state = { text: "Đang tạm dừng", cls: "bg-amber-50 text-amber-800", Icon: PauseCircle };
  else if (isRunning || progress.running) state = { text: "Đang chạy", cls: "bg-blue-50 text-blue-700", Icon: Loader2 };

  return (
    <section aria-labelledby="run-progress-title" className="space-y-4 rounded-2xl border border-gray-200/90 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id="run-progress-title" className="text-base font-bold text-gray-900">Theo dõi tiến trình</h2>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${state.cls}`}>
            {state.Icon && <state.Icon className={`h-3.5 w-3.5 ${state.Icon === Loader2 ? "animate-spin" : ""}`} />}
            {state.text}
          </span>
        </div>
        <span className="text-xs text-gray-500">{fmt(progress.post_count)} bài trong lô</span>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between text-xs">
          <span>
            <b>{fmt(done)}</b> / {fmt(t.total)} lượt
          </span>
          <span className="font-bold text-blue-700">{pct}%</span>
        </div>
        <div role="progressbar" aria-label="Tiến độ chung" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="h-2.5 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full bg-[#2563EB]" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
          <div className="text-[11px] font-semibold text-emerald-800">Thành công</div>
          <div className="text-lg font-bold text-emerald-700">{fmt(t.success)}</div>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
          <div className="text-[11px] font-semibold text-rose-800">Lỗi</div>
          <div className="text-lg font-bold text-rose-700">{fmt(t.failed)}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
          <div className="text-[11px] font-semibold text-gray-700">Đã làm từ trước</div>
          <div className="text-lg font-bold text-gray-800">{fmt(t.skipped)}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
          <div className="text-[11px] font-semibold text-gray-700">Còn lại</div>
          <div className="text-lg font-bold text-gray-800">{fmt(t.pending)}</div>
        </div>
      </div>

      {!isRunning && !progress.running && progress.retryable > 0 && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="flex h-10 items-center gap-2 rounded-xl border border-rose-300 bg-white px-4 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
        >
          {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          Thử lại {fmt(progress.retryable)} lượt lỗi
        </button>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <div className="min-w-[640px]">
          <div className="flex gap-3 bg-gray-50 px-3 py-2 text-[11px] font-bold text-gray-600">
            <span className="flex-[1.6]">Bài viết</span>
            {ACTION_META.map((a) => (
              <span key={a.key} className="flex-1">{a.label}</span>
            ))}
            <span className="w-20 text-right">Trạng thái</span>
          </div>
          {visible.map((p) => {
            const st = postStatus(p);
            return (
              <div key={p.campaign_id} className="flex items-center gap-3 border-t border-gray-100 px-3 py-2 text-xs">
                <span className="flex-[1.6] min-w-0 truncate font-semibold text-gray-900" title={p.url || p.name}>
                  {p.name}
                </span>
                {ACTION_META.map((a) => (
                  <span key={a.key} className="flex-1">
                    <MiniBar counts={p.actions?.[a.key]} bar={a.bar} />
                  </span>
                ))}
                <span className="w-20 text-right">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.text}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {totalPages > 1 && (
        <div className="flex justify-end">
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} siblingCount={1} />
        </div>
      )}
    </section>
  );
}
