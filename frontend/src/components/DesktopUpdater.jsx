"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, RefreshCw, X } from "lucide-react";
import { isTauriShell } from "@/config/constants";

/**
 * Kiểm tra GitHub Release (latest.json) khi mở app desktop.
 * Chỉ chạy trong shell Tauri — bỏ qua trình duyệt web/dev.
 */
export default function DesktopUpdater() {
  const [update, setUpdate] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isTauriShell()) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const next = await check();
        if (!cancelled && next) setUpdate(next);
      } catch (err) {
        // Repo private / chưa có Release / offline — im lặng, không chặn app
        if (!cancelled) console.warn("[updater]", err?.message || err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const install = useCallback(async () => {
    if (!update || busy) return;
    setBusy(true);
    setError("");
    setProgress(0);
    let downloaded = 0;
    let total = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data?.contentLength || 0;
          downloaded = 0;
          setProgress(0);
        } else if (event.event === "Progress") {
          downloaded += event.data?.chunkLength || 0;
          if (total > 0) setProgress(Math.min(99, Math.round((100 * downloaded) / total)));
        } else if (event.event === "Finished") {
          setProgress(100);
        }
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      setError(err?.message || "Không tải được bản cập nhật.");
      setBusy(false);
      setProgress(null);
    }
  }, [update, busy]);

  if (!update || dismissed) return null;

  return (
    <div
      role="status"
      className="fixed right-4 bottom-4 z-[90] w-[min(420px,calc(100vw-2rem))] rounded-xl border border-[#C7D7FE] bg-white p-4 shadow-[0_12px_40px_rgba(15,23,42,0.16)]"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#DBE1FF] text-[#004AC6]">
          <RefreshCw className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#0B1C30]">Có phiên bản mới {update.version}</p>
          <p className="mt-1 text-xs leading-5 text-[#434655]">
            {update.body?.trim() || "Bản đóng gói mới đã sẵn sàng. Cập nhật để nhận sửa lỗi và tính năng mới."}
          </p>
          {error ? <p className="mt-2 text-xs text-[#BE123C]">{error}</p> : null}
          {progress != null ? (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#EFF4FF]">
              <div className="h-full rounded-full bg-[#2563EB] transition-all" style={{ width: `${progress}%` }} />
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={install}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              {busy ? "Đang cập nhật…" : "Tải & cập nhật ngay"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setDismissed(true)}
              className="inline-flex h-8 items-center rounded-lg bg-[#EFF4FF] px-3 text-xs font-medium text-[#434655] hover:text-[#0B1C30] disabled:opacity-60"
            >
              Để sau
            </button>
          </div>
        </div>
        <button
          type="button"
          aria-label="Đóng thông báo cập nhật"
          disabled={busy}
          onClick={() => setDismissed(true)}
          className="rounded p-1 text-[#737686] hover:bg-slate-100 hover:text-[#0B1C30] disabled:opacity-50"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
