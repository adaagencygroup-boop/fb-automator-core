"use client";

/**
 * Popup "Lấy bài viết từ page/ trang cá nhân".
 * Luôn được mount (chỉ mở / đóng <dialog>) để lượt lấy bài đang chạy nền vẫn được theo dõi khi đóng popup
 * và cờ "đang lấy bài" (chặn nút Bắt đầu seeding) luôn đúng.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import Toaster from "@/components/Toaster";

export default function PostFetchModal({ open, running = false, canStop = false, onStop, onClose, title = "Lấy bài viết từ page/ trang cá nhân", children }) {
  const dialog = useRef(null);
  const confirmDialog = useRef(null);
  const titleId = useId();
  const [confirmStopOpen, setConfirmStopOpen] = useState(false);
  const [stoppingOnClose, setStoppingOnClose] = useState(false);

  const requestClose = useCallback(() => {
    if (running) {
      setConfirmStopOpen(true);
      return;
    }
    onClose();
  }, [running, onClose]);

  const confirmStop = useCallback(async () => {
    if (!canStop) return;
    setStoppingOnClose(true);
    try {
      const stopped = await onStop?.();
      if (stopped) {
        setConfirmStopOpen(false);
        onClose();
      }
    } finally {
      setStoppingOnClose(false);
    }
  }, [canStop, onStop, onClose]);

  useEffect(() => {
    if (!running) setConfirmStopOpen(false);
  }, [running]);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = confirmDialog.current;
    if (!el) return;
    if (confirmStopOpen && !el.open) el.showModal();
    if (!confirmStopOpen && el.open) el.close();
  }, [confirmStopOpen]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
      className="fixed inset-0 m-auto max-h-[92vh] w-[97vw] max-w-7xl overflow-hidden overscroll-contain rounded-2xl border border-slate-200 bg-white p-0 text-gray-800 shadow-2xl backdrop:bg-slate-900/45 backdrop:backdrop-blur-sm"
    >
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-100 bg-white px-5 py-3 sm:px-6">
        <h2 id={titleId} className="text-base font-bold text-gray-900">
          {title}
        </h2>
        <button
          type="button"
          onClick={requestClose}
          aria-label="Đóng"
          className="rounded-md p-1.5 text-gray-500 hover:bg-slate-100 hover:text-gray-900"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </header>
      <Toaster />
      {children}
      {confirmStopOpen && (
        <dialog
          ref={confirmDialog}
          onCancel={(event) => {
            event.preventDefault();
            if (!stoppingOnClose) setConfirmStopOpen(false);
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget && !stoppingOnClose) setConfirmStopOpen(false);
          }}
          className="fixed left-1/2 top-1/2 m-0 w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-visible border-0 bg-transparent p-0 shadow-none backdrop:bg-slate-900/60 backdrop:backdrop-blur-sm"
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`${titleId}-stop-title`}
            aria-describedby={`${titleId}-stop-description`}
            className="relative w-full rounded-2xl border border-amber-200 bg-white p-6 text-slate-900 shadow-2xl"
          >
            <div className="flex items-start gap-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600">
                <AlertTriangle className="size-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 pr-5">
                <h3 id={`${titleId}-stop-title`} className="text-base font-bold">Dừng lấy bài viết?</h3>
                <p id={`${titleId}-stop-description`} className="mt-1.5 text-xs leading-relaxed text-slate-500">
                  {canStop
                    ? "Lượt quét đang chạy. Nếu tiếp tục, hệ thống sẽ dừng quét và đóng popup; các bài đã lấy được vẫn được giữ lại."
                    : "Yêu cầu lấy bài đang được khởi tạo. Hãy chờ job bắt đầu để có thể dừng và đóng popup an toàn."}
                </p>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={stoppingOnClose}
                onClick={() => setConfirmStopOpen(false)}
                className="inline-flex min-h-8 items-center justify-center rounded-md border border-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Tiếp tục quét
              </button>
              <button
                type="button"
                disabled={stoppingOnClose || !canStop}
                onClick={confirmStop}
                className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
              >
                {(stoppingOnClose || !canStop) && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
                {canStop ? "Dừng và đóng" : "Đang bắt đầu…"}
              </button>
            </div>
          </section>
        </dialog>
      )}
    </dialog>
  );
}
