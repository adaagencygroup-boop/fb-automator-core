"use client";

import React from "react";

export function formatDateTime(value) {
  if (!value) return "--";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatTime(value) {
  if (!value) return "--:--";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
}

const PILL = {
  blue: "bg-blue-50 text-blue-600",
  sky: "bg-sky-50 text-sky-700",
  emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-700",
  rose: "bg-rose-50 text-rose-600",
  slate: "bg-slate-100 text-slate-600",
};
const DOT = {
  blue: "bg-blue-500",
  sky: "bg-sky-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  slate: "bg-slate-400",
};

export function StatusPill({ tone = "slate", label, pulse = false }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${PILL[tone]}`}>
      <span className={`size-1.5 rounded-full ${DOT[tone]} ${pulse ? "animate-pulse" : ""}`} />
      {label}
    </span>
  );
}

/** Trạng thái chiến dịch hiển thị (gộp với tình trạng các khung giờ). */
export function campaignStatus(c) {
  if (c.status === "STOPPED") return { tone: "slate", label: "Đã dừng" };
  if (c.status === "COMPLETED") {
    return Number(c.slot_problem) > 0
      ? { tone: "amber", label: "Xong, có khung lỡ / lỗi" }
      : { tone: "emerald", label: "Hoàn thành" };
  }
  if (Number(c.slot_running) > 0) return { tone: "blue", label: "Đang chạy", pulse: true };
  return { tone: "sky", label: "Chờ khung kế tiếp" };
}

export const QUEUED_PREFIX = "Đang xếp hàng";

export function slotStatus(slot) {
  switch (slot.status) {
    case "WAITING":
      return String(slot.message || "").startsWith(QUEUED_PREFIX)
        ? { tone: "amber", label: "Đang xếp hàng" }
        : { tone: "sky", label: "Chờ đến giờ" };
    case "RUNNING":
      return { tone: "blue", label: "Đang chạy", pulse: true };
    case "DONE":
      return Number(slot.failed_count) > 0 ? { tone: "amber", label: "Xong, có bài lỗi" } : { tone: "emerald", label: "Xong" };
    case "MISSED":
      return { tone: "rose", label: "Bị lỡ" };
    case "FAILED":
      return { tone: "rose", label: "Lỗi" };
    case "STOPPED":
      return { tone: "slate", label: "Đã dừng" };
    default:
      return { tone: "slate", label: slot.status || "--" };
  }
}

export const CONTENT_MODE_LABEL = { SINGLE: "1 nội dung", MULTI: "Nhiều nội dung" };
export const IMAGE_MODE_LABEL = { NONE: "Không ảnh", SINGLE: "1 ảnh", MULTI: "Nhiều ảnh" };
