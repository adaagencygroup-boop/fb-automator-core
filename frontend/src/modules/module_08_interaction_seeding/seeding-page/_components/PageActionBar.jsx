"use client";

import React, { useState } from "react";
import { Play, Square, Loader2 } from "lucide-react";
import ConfirmDialog from "@/components/ui/confirm-dialog";

/**
 * otherRunning: { id, label } khi đang có lô seeding của TRANG KHÁC chạy (vd label "Bài viết #149").
 * Mỗi lúc chỉ chạy 1 lô seeding: nút Bắt đầu bị khoá, nút Dừng dừng lô đó (hỏi xác nhận trước).
 */
export default function PageActionBar({
  isRunning,
  onStart,
  onStop,
  disabled = false,
  otherRunning = null,
  onStopOther,
}) {
  const [confirmStopOther, setConfirmStopOther] = useState(false);
  const [stoppingOther, setStoppingOther] = useState(false);
  const blockedByOther = !isRunning && !!otherRunning;
  const startDisabled = isRunning || disabled || blockedByOther;
  const stopEnabled = isRunning || blockedByOther;

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
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
      <button
        type="button"
        onClick={onStart}
        disabled={startDisabled}
        className={`w-full py-3.5 px-6 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-md ${
          startDisabled
            ? "bg-emerald-600/50 text-white/70 cursor-not-allowed shadow-none"
            : "bg-[#059669] hover:bg-[#047857] text-white shadow-emerald-700/20 active:scale-[0.99]"
        }`}
      >
        {isRunning || blockedByOther ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {blockedByOther ? `ĐANG CHẠY SEEDING ${otherRunning.label}...` : "ĐANG CHẠY SEEDING..."}
          </>
        ) : (
          <>
            <Play className="w-4 h-4 fill-current" />
            BẮT ĐẦU SEEDING
          </>
        )}
      </button>

      <button
        type="button"
        onClick={blockedByOther ? () => setConfirmStopOther(true) : onStop}
        disabled={!stopEnabled}
        className={`w-full py-3.5 px-6 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-md ${
          !stopEnabled
            ? "bg-rose-600/40 text-white/50 cursor-not-allowed shadow-none"
            : "bg-[#DC2626] hover:bg-[#B91C1C] text-white shadow-rose-700/20 active:scale-[0.99]"
        }`}
      >
        <Square className="w-4 h-4 fill-current" />
        {blockedByOther ? `DỪNG SEEDING ${otherRunning.label}` : "DỪNG SEEDING"}
      </button>

      <ConfirmDialog
        isOpen={confirmStopOther && blockedByOther}
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
