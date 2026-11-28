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
  violet: "bg-violet-50 text-violet-600",
};
const DOT = {
  blue: "bg-blue-500",
  sky: "bg-sky-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  slate: "bg-slate-400",
  violet: "bg-violet-500",
};

export function StatusPill({ tone = "slate", label, pulse = false, title }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${PILL[tone]}`}
    >
      <span
        className={`size-1.5 rounded-full ${DOT[tone]} ${pulse ? "animate-pulse" : ""}`}
      />
      {label}
    </span>
  );
}

/** Trạng thái chiến dịch hiển thị (gộp với tình trạng các khung giờ). */
export function campaignStatus(c) {
  if (c.status === "STOPPED") return { tone: "violet", label: "Tạm dừng" };
  if (c.status === "COMPLETED") {
    const issues = slotIssueParts(c);
    return issues.length
      ? { tone: "amber", label: `Kết thúc · ${issues.join(", ")}` }
      : { tone: "emerald", label: "Hoàn thành" };
  }
  if (Number(c.slot_running) > 0)
    return { tone: "blue", label: "Đang chạy", pulse: true };
  return { tone: "sky", label: "Chờ khung kế tiếp" };
}

/** Các khung có vấn đề, vd ["1 khung bị lỡ", "1 khung lỗi"] (không có số riêng thì dùng slot_problem). */
export function slotIssueParts(c) {
  const missed = Number(c.slot_missed) || 0;
  const failed = Number(c.slot_failed) || 0;
  const stopped = Number(c.slot_stopped) || 0;
  if (!missed && !failed && !stopped) {
    const problem = Number(c.slot_problem) || 0;
    return problem ? [`${problem} khung lỡ / lỗi`] : [];
  }
  return [
    stopped && `${stopped} khung dừng giữa chừng`,
    missed && `${missed} khung bị lỡ`,
    failed && `${failed} khung lỗi`,
  ].filter(Boolean);
}

/** Nhãn ngắn cho trang danh sách (chi tiết vấn đề xem ở tooltip / popup chi tiết). */
export function campaignStatusShort(c) {
  if (c.status === "STOPPED") return { tone: "violet", label: "Tạm dừng" };
  if (c.status === "COMPLETED") {
    const issues = slotIssueParts(c);
    // Dòng chi tiết ngắn dưới nhãn, vd "1 dừng giữa chừng · 1 bị lỡ"
    const detail = [
      Number(c.slot_stopped) > 0 && `${c.slot_stopped} dừng giữa chừng`,
      Number(c.slot_missed) > 0 && `${c.slot_missed} bị lỡ`,
      Number(c.slot_failed) > 0 && `${c.slot_failed} lỗi`,
    ].filter(Boolean);
    return issues.length
      ? {
          tone: "amber",
          label: "Cần xử lý",
          title: issues.join(", "),
          detail: detail.length ? detail.join(" · ") : issues.join(", "),
        }
      : { tone: "emerald", label: "Hoàn thành" };
  }
  if (Number(c.slot_running) > 0)
    return { tone: "blue", label: "Đang chạy", pulse: true };
  return {
    tone: "sky",
    label: c.next_run_at
      ? `Chờ ${formatTime(c.next_run_at)}`
      : "Chờ khung kế tiếp",
  };
}

/** Mỗi khung giờ là 1 chip nhỏ: chấm màu theo trạng thái + giờ (rê chuột xem trạng thái). */
export function SlotChips({ slots, max = 6 }) {
  const list = slots || [];
  const shown = list.slice(0, max);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((s, i) => {
        const st = slotStatus(s);
        return (
          <span
            key={i}
            title={`${formatTime(s.run_at)} · ${st.label}`}
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold ${PILL[st.tone] || PILL.slate}`}
          >
            <span
              className={`size-1.5 rounded-full ${DOT[st.tone] || DOT.slate} ${st.pulse ? "animate-pulse" : ""}`}
            />
            {formatTime(s.run_at)}
          </span>
        );
      })}
      {list.length > max && (
        <span className="text-[11px] font-semibold text-slate-400">
          +{list.length - max}
        </span>
      )}
      {list.length === 0 && (
        <span className="text-[11px] text-slate-400">--</span>
      )}
    </div>
  );
}

/** Thanh số bài: xanh = đã đăng, đỏ = lỗi / bị dừng, xám = chưa đăng. */
export function PostsBar({ success, failed, expected }) {
  const total = Math.max(1, expected, success + failed);
  return (
    <div className="w-28 space-y-1">
      <p className="text-xs tabular-nums">
        <strong className="text-emerald-600">{success}</strong>
        <span className="text-slate-400">/{expected} bài</span>
        {failed > 0 && (
          <span className="ml-1 text-[11px] font-semibold text-rose-600">
            · {failed} lỗi
          </span>
        )}
      </p>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full bg-emerald-500"
          style={{ width: `${(100 * success) / total}%` }}
        />
        <div
          className="h-full bg-rose-400"
          style={{ width: `${(100 * failed) / total}%` }}
        />
      </div>
    </div>
  );
}

export const QUEUED_PREFIX = "Đang xếp hàng";
export const PAUSED_MID_RUN_PREFIX = "Tạm dừng giữa chừng";

export function slotStatus(slot) {
  switch (slot.status) {
    case "WAITING":
      return String(slot.message || "").startsWith(QUEUED_PREFIX)
        ? { tone: "amber", label: "Đang xếp hàng" }
        : { tone: "sky", label: "Chờ đến giờ" };
    case "RUNNING":
      // Chiến dịch tạm dừng khi khung đang chạy dở: phiên chỉ pause, Chạy tiếp sẽ chạy tiếp từ chỗ dừng
      return String(slot.message || "").startsWith(PAUSED_MID_RUN_PREFIX)
        ? { tone: "violet", label: "Tạm dừng giữa chừng" }
        : { tone: "blue", label: "Đang chạy", pulse: true };
    case "DONE":
      return Number(slot.failed_count) > 0
        ? { tone: "amber", label: "Xong, có bài lỗi" }
        : { tone: "emerald", label: "Xong" };
    case "MISSED":
      return { tone: "rose", label: "Bị lỡ" };
    case "FAILED":
      return { tone: "rose", label: "Lỗi" };
    case "STOPPED":
      // Chưa có phiên = tạm dừng theo chiến dịch (Chạy tiếp sẽ chạy đúng giờ); đã có phiên = bị dừng giữa chừng.
      // Khung tạm dừng mà qua giờ hẹn thì backend chuyển sang "Bị lỡ".
      return slot.session_id
        ? { tone: "slate", label: "Dừng giữa chừng" }
        : { tone: "violet", label: "Tạm dừng" };
    default:
      return { tone: "slate", label: slot.status || "--" };
  }
}

export const CONTENT_MODE_LABEL = {
  SINGLE: "1 nội dung",
  MULTI: "Nhiều nội dung",
};
export const IMAGE_MODE_LABEL = {
  NONE: "Không ảnh",
  SINGLE: "1 ảnh chung",
  MULTI: "Mỗi bài 1 ảnh",
};
