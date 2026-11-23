"use client";

/**
 * Thẻ nút cuối trang (theo Figma): BẮT ĐẦU SEEDING (xanh lá) + DỪNG SEEDING (đỏ) luôn hiện, nút không dùng được thì khoá.
 * Hàng nhỏ phía trên: Xem trước kế hoạch, Lưu / Mở mẫu (khi chưa chạy) hoặc Tạm dừng / Tiếp tục (khi đang chạy).
 * Nút DỪNG khi trang này chưa chạy mà trang khác đang chạy seeding → dừng lô đó (có xác nhận).
 */
import React, { useState } from "react";
import { Clock, Eye, Loader2, Pause, Play, Square } from "lucide-react";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { CARD } from "./StepCard";
import PostTemplateControls from "./PostTemplateControls";

function fmtStart(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

export default function PostRunActions({
  isRunning = false,
  isStopping = false,
  paused = false,
  pauseBusy = false,
  scheduledAt = null,
  startMode = "now",
  blockingCount = 0,
  canPreview = false,
  otherRunning = null,
  onStart,
  onStop,
  onPause,
  onResume,
  onPreview,
  onStopOther,
  getTemplateConfig,
  onApplyTemplate,
}) {
  const [confirmStopOther, setConfirmStopOther] = useState(false);
  const [stoppingOther, setStoppingOther] = useState(false);

  const stopOtherMode = !isRunning && !!otherRunning;
  const stopDisabled = isRunning ? isStopping : !otherRunning || stoppingOther;
  const handleStopClick = () => {
    if (isRunning) onStop?.();
    else if (otherRunning) setConfirmStopOther(true);
  };

  const handleConfirmStopOther = async () => {
    setStoppingOther(true);
    try {
      await onStopOther?.(otherRunning);
    } finally {
      setStoppingOther(false);
      setConfirmStopOther(false);
    }
  };

  const stopLabel = isStopping
    ? "ĐANG DỪNG SEEDING..."
    : isRunning
      ? scheduledAt
        ? "HUỶ HẸN GIỜ"
        : "DỪNG SEEDING"
      : stopOtherMode
        ? `DỪNG SEEDING ${otherRunning.label}`.toUpperCase()
        : "DỪNG SEEDING";

  return (
    <section className={`${CARD} space-y-4 p-5`} aria-label="Chạy seeding">
      {isRunning ? (
        <div className="flex flex-wrap items-center gap-3">
          {scheduledAt ? (
            <p className="rounded-xl bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800">
              Đã hẹn giờ chạy lúc {fmtStart(scheduledAt)}
            </p>
          ) : paused ? (
            <>
              <button
                type="button"
                onClick={onResume}
                disabled={pauseBusy || isStopping}
                className="flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {pauseBusy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Play className="size-4 fill-current" aria-hidden="true" />}
                Tiếp tục
              </button>
              <span className="text-xs text-amber-800">Đang tạm dừng — các nick làm xong tác vụ dở rồi chờ.</span>
            </>
          ) : (
            <button
              type="button"
              onClick={onPause}
              disabled={pauseBusy || isStopping}
              className="flex h-10 items-center gap-2 rounded-xl border-2 border-amber-500 bg-white px-4 text-xs font-bold text-amber-800 hover:bg-amber-50 disabled:opacity-60"
            >
              {pauseBusy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Pause className="size-4 fill-current" aria-hidden="true" />}
              Tạm dừng
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-2">
          <button
            type="button"
            onClick={onPreview}
            disabled={!canPreview}
            className="flex h-10 items-center gap-2 rounded-xl border border-blue-500 bg-white px-4 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:border-slate-200 disabled:text-slate-400"
          >
            <Eye className="size-4" aria-hidden="true" /> Xem trước kế hoạch
          </button>
          <div className="min-w-[280px] flex-1 sm:max-w-md">
            <PostTemplateControls getConfig={getTemplateConfig} onApply={onApplyTemplate} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={onStart}
            disabled={isRunning || blockingCount > 0}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-bold uppercase tracking-wide text-white shadow-md shadow-emerald-700/20 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-600/40 disabled:shadow-none"
          >
            {startMode === "schedule" ? <Clock className="size-4" aria-hidden="true" /> : <Play className="size-4 fill-current" aria-hidden="true" />}
            {isRunning ? "ĐANG SEEDING..." : startMode === "schedule" ? "HẸN GIỜ SEEDING" : "BẮT ĐẦU SEEDING"}
          </button>
          {!isRunning && blockingCount > 0 && (
            <p className="text-center text-[11px] text-amber-800">Còn {blockingCount} mục cần xử lý trước khi chạy (xem Tóm tắt cấu hình).</p>
          )}
        </div>
        <button
          type="button"
          onClick={handleStopClick}
          disabled={stopDisabled}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-sm font-bold uppercase tracking-wide text-white shadow-md shadow-red-700/20 hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-600/40 disabled:shadow-none"
        >
          {isStopping || stoppingOther ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Square className="size-4 fill-current" aria-hidden="true" />
          )}
          {stopLabel}
        </button>
      </div>

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
    </section>
  );
}
