"use client";

import { useEffect } from "react";
import { X, Eye, Users, MousePointerClick, Clock, Timer, PlayCircle, Heart } from "lucide-react";
import { cn } from "@/lib/utils";

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-sky-500";

const formatCount = (n) => Number(n || 0).toLocaleString("vi-VN");

function formatDuration(ms) {
  const total = Math.round(Number(ms || 0) / 1000);
  if (!total) return "0 giây";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h} giờ${m ? ` ${m} phút` : ""}`;
  if (m) return `${m} phút${s ? ` ${s} giây` : ""}`;
  return `${s} giây`;
}

function Metric({ icon: Icon, label, value, hint }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
        <Icon className="size-3.5 shrink-0" strokeWidth={1.8} />
        {label}
      </p>
      <p className="mt-1 text-xl font-bold leading-7 text-slate-900">{value}</p>
    </div>
  );
}

export default function PostInsightsDialog({ insights, interactions, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const data = insights || {};
  const has = (k) => Number(data[k] || 0) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" aria-hidden="true" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Hiệu suất bài viết"
        className="relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900">Hiệu suất bài viết</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className={cn("shrink-0 rounded-full p-1.5 text-slate-500 hover:bg-slate-100", FOCUS)}
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
          <div className="grid grid-cols-2 gap-2.5">
            {has("views") && (
              <Metric
                icon={Eye}
                label="Lượt xem"
                value={formatCount(data.views)}
              />
            )}
            {has("viewers") && (
              <Metric
                icon={Users}
                label="Người xem"
                value={formatCount(data.viewers)}
              />
            )}
            {interactions > 0 && (
              <Metric
                icon={Heart}
                label="Tương tác"
                value={formatCount(interactions)}
              />
            )}
            {has("clicks") && (
              <Metric icon={MousePointerClick} label="Lượt nhấp" value={formatCount(data.clicks)} />
            )}
            {has("watch_time_ms") && (
              <Metric
                icon={Clock}
                label="Thời gian xem"
                value={formatDuration(data.watch_time_ms)}
              />
            )}
            {has("avg_watch_ms") && (
              <Metric
                icon={Timer}
                label="Xem trung bình"
                value={formatDuration(data.avg_watch_ms)}
              />
            )}
            {has("video_views") && (
              <Metric
                icon={PlayCircle}
                label="Xem quá 3 giây"
                value={formatCount(data.video_views)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
