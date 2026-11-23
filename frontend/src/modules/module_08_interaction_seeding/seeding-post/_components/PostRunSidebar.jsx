"use client";

/**
 * Cột phải (dính khi cuộn) của Seeding Bài viết: tóm tắt, ước tính thời gian, phân bổ lượt,
 * kiểm tra trước khi chạy, Xem trước kế hoạch, mẫu cấu hình và nút Bắt đầu / Tạm dừng / Dừng.
 * Chưa chạy: chỉ hiện Bắt đầu (khoá khi còn lỗi). Đang chạy: Tạm dừng / Tiếp tục + Dừng.
 */
import React, { useMemo, useState } from "react";
import { AlertTriangle, BarChart2, Check, ClipboardList, Clock, Eye, Loader2, Pause, Play, Square } from "lucide-react";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { estimateSeconds, formatDuration, planTotals, preRunChecks } from "../runPlan.mjs";
import PostTemplateControls from "./PostTemplateControls";

const REACTION_NAMES = {
  LIKE: "Thích",
  LOVE: "Yêu thích",
  CARE: "Thương thương",
  HAHA: "Haha",
  WOW: "Wow",
  SAD: "Buồn",
  ANGRY: "Phẫn nộ",
};
const DIST_ROWS = 10;
const fmt = (n) => Number(n || 0).toLocaleString("vi-VN");

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-gray-100 py-2 text-xs">
      <span className="shrink-0 text-gray-500">{label}</span>
      <span className="text-right font-semibold text-gray-900">{children}</span>
    </div>
  );
}

function fmtStart(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

export default function PostRunSidebar({
  targets = [],
  accountCount = 0,
  liveAccounts = 0,
  doLike,
  doComment,
  doShare,
  selectedReactions = [],
  commentCount = 0,
  commentVariants = Infinity,
  threads = 2,
  spreadEnabled = false,
  spreadHours = 0,
  startMode = "now",
  startAt = "",
  delayMin,
  delayMax,
  isRunning = false,
  isStopping = false,
  paused = false,
  scheduledAt = null,
  onStart,
  onStop,
  onPause,
  onResume,
  pauseBusy = false,
  onPreview,
  otherRunning = null,
  onStopOther,
  fetchRunning = false,
  getTemplateConfig,
  onApplyTemplate,
}) {
  const [confirmStopOther, setConfirmStopOther] = useState(false);
  const [stoppingOther, setStoppingOther] = useState(false);
  const targetCount = targets.length;

  const totals = useMemo(
    () => planTotals({ accountCount, targetCount, doLike, doComment, doShare }),
    [accountCount, targetCount, doLike, doComment, doShare],
  );
  const seconds = estimateSeconds({
    accountCount,
    targetCount,
    delayMin,
    delayMax,
    totals,
    threads,
    spreadHours: spreadEnabled ? spreadHours : 0,
  });
  const scheduleMissing = startMode === "schedule" && (!startAt || new Date(startAt).getTime() <= Date.now());
  const checks = preRunChecks({
    targetCount,
    doLike,
    doComment,
    doShare,
    reactionCount: selectedReactions.length,
    commentCount,
    accountCount,
    liveAccounts,
    delayMin,
    delayMax,
    fetchRunning,
    otherRunningLabel: !isRunning && otherRunning ? otherRunning.label : null,
    commentVariants,
    commentPerPost: doComment ? totals.comment : 0,
    scheduleMissing,
  });
  const blocking = checks.filter((c) => !c.ok);

  const sharePerPost = !doShare ? 0 : totals.shareMin === totals.shareMax ? totals.shareMin : `${totals.shareMin}–${totals.shareMax}`;
  const perPostParts = [];
  if (doLike) perPostParts.push(`${fmt(totals.react)} cảm xúc`);
  if (doComment) perPostParts.push(`${fmt(totals.comment)} bình luận`);
  if (doShare) perPostParts.push(`${sharePerPost} chia sẻ`);
  const reactionText = selectedReactions.length
    ? selectedReactions.map((r) => REACTION_NAMES[r] || r).join(", ")
    : "Chưa chọn";

  const handleConfirmStopOther = async () => {
    setStoppingOther(true);
    try {
      await onStopOther?.(otherRunning);
    } finally {
      setStoppingOther(false);
      setConfirmStopOther(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Tóm tắt */}
      <div className="overflow-hidden rounded-2xl border border-gray-200/90 bg-white shadow-sm">
        <div className="flex items-center gap-2 bg-[#2563EB] px-5 py-3 text-white">
          <ClipboardList className="h-4 w-4" />
          <h3 className="text-xs font-bold tracking-wide">Tóm tắt cấu hình</h3>
        </div>
        <div className="px-5 pb-4 pt-1">
          <Row label="Số bài viết">{fmt(targetCount)} bài</Row>
          <Row label="Tài khoản">
            {fmt(accountCount)} / {fmt(liveAccounts)} khả dụng
          </Row>
          <Row label="Mỗi bài">{perPostParts.length ? perPostParts.join(" · ") : "Chưa chọn tương tác"}</Row>
          {doLike && <Row label="Cảm xúc">{reactionText}</Row>}
          <Row label="Nghỉ / tốc độ">
            {spreadEnabled ? `Rải đều trong ${spreadHours} giờ` : `${delayMin || 0}–${delayMax || 0} giây`} · {threads} luồng Chrome
          </Row>
          <Row label="Bắt đầu">{startMode === "schedule" ? (startAt ? `Hẹn giờ ${fmtStart(startAt)}` : "Hẹn giờ (chưa chọn)") : "Chạy ngay"}</Row>
          <div className="flex items-center justify-between pt-3">
            <span className="text-xs text-gray-500">Tổng lượt</span>
            <span className="text-xl font-bold text-gray-900">{fmt(totals.total)}</span>
          </div>
          <div className="flex items-start justify-between gap-3 pt-2">
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <Clock className="h-3.5 w-3.5" /> Ước tính
            </span>
            <span className="text-right">
              <span className="block text-sm font-bold text-blue-700">{seconds ? formatDuration(seconds) : "—"}</span>
              <span className="block text-[11px] text-gray-500">
                {spreadEnabled ? "rải đều theo số giờ đã chọn" : `chạy lần lượt từng bài, ${threads} Chrome song song`}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* Phân bổ */}
      {targetCount > 0 && (
        <div className="rounded-2xl border border-gray-200/90 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <BarChart2 className="h-4 w-4 text-emerald-600" />
            <h3 className="text-xs font-bold text-gray-900">Phân bổ lượt (dự kiến)</h3>
          </div>
          <div className="overflow-hidden rounded-xl border border-gray-100 text-[11px]">
            <div className="flex bg-gray-50 px-3 py-2 font-bold text-gray-600">
              <span className="flex-[1.2]">Bài</span>
              <span className="flex-1 text-right">Cảm xúc</span>
              <span className="flex-1 text-right">Bình luận</span>
              <span className="flex-1 text-right">Chia sẻ</span>
            </div>
            {targets.slice(0, DIST_ROWS).map((t, i) => (
              <div key={t.id ?? i} className="flex border-t border-gray-100 px-3 py-1.5 text-gray-700">
                <span className="flex-[1.2] font-semibold">Bài {i + 1}</span>
                <span className="flex-1 text-right">{doLike ? fmt(totals.react) : "—"}</span>
                <span className="flex-1 text-right">{doComment ? fmt(totals.comment) : "—"}</span>
                <span className="flex-1 text-right">{doShare ? sharePerPost : "—"}</span>
              </div>
            ))}
            {targetCount > DIST_ROWS && (
              <div className="border-t border-gray-100 px-3 py-1.5 text-gray-500">… và {fmt(targetCount - DIST_ROWS)} bài khác</div>
            )}
            <div className="flex border-t border-gray-200 bg-blue-50/60 px-3 py-2 font-bold text-blue-700">
              <span className="flex-[1.2]">Tổng</span>
              <span className="flex-1 text-right">{fmt(totals.totalReacts)}</span>
              <span className="flex-1 text-right">{fmt(totals.totalComments)}</span>
              <span className="flex-1 text-right">{fmt(totals.totalShares)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Kiểm tra trước khi chạy */}
      {!isRunning && (
        <div className="space-y-2 rounded-2xl border border-gray-200/90 bg-white p-4 shadow-sm">
          <h3 className="text-xs font-bold text-gray-900">Kiểm tra trước khi chạy</h3>
          {checks.map((c) => (
            <div key={c.key} className="flex items-start gap-2 text-xs">
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                  c.ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-100 text-amber-700"
                }`}
              >
                {c.ok ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
              </span>
              <span className={c.ok ? "text-gray-800" : "text-amber-900"}>{c.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Nút */}
      {isRunning ? (
        <div className="space-y-2">
          {scheduledAt ? (
            <p className="rounded-xl bg-indigo-50 px-3 py-2 text-center text-xs font-semibold text-indigo-800">
              Đã hẹn giờ chạy lúc {fmtStart(scheduledAt)}
            </p>
          ) : paused ? (
            <button
              type="button"
              onClick={onResume}
              disabled={pauseBusy || isStopping}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] text-xs font-bold uppercase tracking-wider text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {pauseBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
              Tiếp tục
            </button>
          ) : (
            <button
              type="button"
              onClick={onPause}
              disabled={pauseBusy || isStopping}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-amber-600 bg-white text-xs font-bold uppercase tracking-wider text-amber-800 hover:bg-amber-50 disabled:opacity-60"
            >
              {pauseBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4 fill-current" />}
              Tạm dừng
            </button>
          )}
          <button
            type="button"
            onClick={isStopping ? undefined : onStop}
            disabled={isStopping}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#DC2626] text-xs font-bold uppercase tracking-wider text-white shadow-md shadow-rose-700/20 hover:bg-[#B91C1C] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isStopping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4 fill-current" />}
            {isStopping ? "Đang dừng seeding..." : scheduledAt ? "Huỷ hẹn giờ" : "Dừng seeding"}
          </button>
          {paused && <p className="text-center text-[11px] text-amber-800">Đang tạm dừng — các nick làm xong tác vụ dở rồi chờ.</p>}
        </div>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={onPreview}
            disabled={!targetCount || !accountCount || (!doLike && !doComment && !doShare)}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-blue-500 bg-white text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:border-gray-200 disabled:text-gray-400"
          >
            <Eye className="h-4 w-4" /> Xem trước kế hoạch
          </button>
          <PostTemplateControls getConfig={getTemplateConfig} onApply={onApplyTemplate} />
          <button
            type="button"
            onClick={onStart}
            disabled={blocking.length > 0}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#047857] text-xs font-bold uppercase tracking-wider text-white shadow-md shadow-emerald-700/20 hover:bg-[#065F46] disabled:cursor-not-allowed disabled:bg-emerald-700/40 disabled:shadow-none"
          >
            {startMode === "schedule" ? <Clock className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
            {startMode === "schedule" ? "Hẹn giờ seeding" : "Bắt đầu seeding"}
          </button>
          {blocking.length > 0 && (
            <p className="text-center text-[11px] text-amber-800">Còn {blocking.length} mục cần xử lý trước khi chạy.</p>
          )}
          {otherRunning && (
            <button
              type="button"
              onClick={() => setConfirmStopOther(true)}
              disabled={stoppingOther}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
            >
              {stoppingOther ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-3.5 w-3.5 fill-current" />}
              Dừng seeding {otherRunning.label}
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmStopOther && !!otherRunning && !isRunning}
        onClose={() => !stoppingOther && setConfirmStopOther(false)}
        onConfirm={handleConfirmStopOther}
        title="Dừng seeding đang chạy ở trang khác"
        description={`Bạn có chắc muốn dừng seeding ${otherRunning?.label || ""}? Các nick đang chạy sẽ bị đóng trình duyệt và các mục tiêu chưa tới lượt sẽ không chạy nữa.`}
        confirmText="Dừng ngay"
        cancelText="Hủy bỏ"
        variant="danger"
        loading={stoppingOther}
      />
    </div>
  );
}
