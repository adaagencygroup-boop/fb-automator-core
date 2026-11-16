"use client";

import { useState } from "react";
import { Check, ChevronDown, Globe, Loader2, LogOut, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { connectionLabel } from "./webOAuth.mjs";

const buttonClass = "w-full min-h-11 rounded-xl bg-[#1877F2] hover:bg-blue-600 font-bold text-white text-xs flex items-center justify-center gap-2 px-3 shadow-sm disabled:opacity-60";

export function WebConnectionButton({ controller: c }) {
  const [confirmLogout, setConfirmLogout] = useState(false);
  const busy = c.starting || Boolean(c.job);
  const cancelable = ["AWAITING_OAUTH", "AWAITING_CONFIRMATION"].includes(c.job?.status);

  return (
    <div className="min-w-0 space-y-2 [overflow-wrap:anywhere]">
      {busy ? (
        <button type="button" className={buttonClass} disabled>
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <span>Đang xử lý…</span>
        </button>
      ) : c.connection?.connected ? (
        <details className="relative">
          <summary className={`${buttonClass} cursor-pointer list-none`}>
            <Check className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate" title={connectionLabel(c.connection)}>
              {connectionLabel(c.connection)}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0" />
          </summary>
          <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-slate-200 bg-white p-1 shadow-lg space-y-0.5">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md p-2 text-left text-xs text-slate-700 hover:bg-slate-50 transition-colors"
              onClick={(event) => {
                event.currentTarget.closest("details").open = false;
                c.resync();
              }}
            >
              <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
              Quét lại Page
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md p-2 text-left text-xs text-slate-700 hover:bg-slate-50 transition-colors"
              onClick={(event) => {
                event.currentTarget.closest("details").open = false;
                c.connect("switch");
              }}
            >
              <Globe className="h-3.5 w-3.5 text-slate-500" />
              Đổi tài khoản
            </button>
            {c.connection.token_state === "expired" && (
              <button
                type="button"
                className="w-full rounded-md p-2 text-left text-xs text-amber-700 hover:bg-amber-50"
                onClick={() => c.connect("connect")}
              >
                Kết nối lại tài khoản này
              </button>
            )}
            <div className="my-1 border-t border-slate-100" />
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md p-2 text-left text-xs text-red-600 hover:bg-red-50 transition-colors font-medium"
              onClick={(event) => {
                event.currentTarget.closest("details").open = false;
                setConfirmLogout(true);
              }}
            >
              <LogOut className="h-3.5 w-3.5 text-red-500" />
              Đăng xuất
            </button>
          </div>
        </details>
      ) : (
        <button type="button" className={buttonClass} onClick={() => c.connect()}>
          <Globe className="h-4 w-4" />
          Kết nối Facebook
        </button>
      )}

      {c.loadingConnection && !busy && (
        <p role="status" className="text-xs text-slate-500">
          Đang tải kết nối đã lưu… Bạn vẫn có thể mở OAuth.
        </p>
      )}
      {busy && (
        <p role="status" className="text-xs text-slate-600">
          {c.job?.message || "Đang xử lý kết nối Facebook…"}
        </p>
      )}
      {cancelable && (
        <button
          type="button"
          onClick={c.cancel}
          disabled={c.actionBusy}
          className="text-xs text-slate-600 underline disabled:opacity-50"
        >
          Hủy kết nối
        </button>
      )}
      {cancelable && (
        <p className="text-xs text-slate-500">
          Hoàn tất đăng nhập và chấp nhận trong cửa sổ OAuth. Nếu đã đóng cửa sổ đó, hãy hủy để kết nối lại.
        </p>
      )}
      {c.error && (
        <p role="alert" className="text-xs text-red-600">
          {c.error}
        </p>
      )}

      {/* Hộp thoại xác nhận Đăng xuất */}
      <Dialog open={confirmLogout} onOpenChange={setConfirmLogout}>
        <DialogContent className="max-w-sm rounded-2xl bg-white p-5 shadow-2xl border border-slate-200">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-slate-800">
              Ngắt kết nối Facebook
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-slate-600 mt-2 leading-relaxed">
            Bạn có chắc chắn muốn ngắt kết nối Facebook này? Danh sách Fanpage đã nạp trước đó vẫn sẽ được giữ nguyên.
          </p>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              className="h-8 px-3 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              onClick={() => setConfirmLogout(false)}
            >
              Hủy
            </button>
            <button
              type="button"
              disabled={c.actionBusy}
              className="h-8 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-xs font-semibold text-white flex items-center gap-1.5 shadow-xs transition-colors disabled:opacity-50"
              onClick={async () => {
                setConfirmLogout(false);
                await c.disconnect();
              }}
            >
              {c.actionBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
              Đăng xuất
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
