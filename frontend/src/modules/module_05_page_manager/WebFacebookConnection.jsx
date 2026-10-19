"use client";

import { Check, ChevronDown, Globe, Loader2, RefreshCw } from "lucide-react";
import { connectionLabel } from "./webOAuth.mjs";

const buttonClass = "w-full min-h-11 rounded-xl bg-[#1877F2] hover:bg-blue-600 font-bold text-white text-xs flex items-center justify-center gap-2 px-3 shadow-sm disabled:opacity-60";

export function WebConnectionButton({ controller: c }) {
  const busy = c.starting || Boolean(c.job);
  const cancelable = ["AWAITING_OAUTH", "AWAITING_CONFIRMATION"].includes(c.job?.status);
  return <div className="min-w-0 space-y-2 [overflow-wrap:anywhere]">
    {busy ? <button type="button" className={buttonClass} disabled><Loader2 className="h-4 w-4 shrink-0 animate-spin" /><span>Đang xử lý…</span></button>
      : c.connection?.connected ? <details className="relative">
        <summary className={`${buttonClass} cursor-pointer list-none`}><Check className="h-4 w-4 shrink-0" /><span className="min-w-0 truncate" title={connectionLabel(c.connection)}>{connectionLabel(c.connection)}</span><ChevronDown className="h-4 w-4 shrink-0" /></summary>
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          <button type="button" className="flex w-full items-center gap-2 rounded-md p-2 text-left text-xs hover:bg-slate-50" onClick={(event) => { event.currentTarget.closest("details").open = false; c.resync(); }}><RefreshCw className="h-3.5 w-3.5" />Quét lại Page</button>
          <button type="button" className="flex w-full items-center gap-2 rounded-md p-2 text-left text-xs hover:bg-slate-50" onClick={(event) => { event.currentTarget.closest("details").open = false; c.connect("switch"); }}><Globe className="h-3.5 w-3.5" />Đổi tài khoản</button>
          {c.connection.token_state === "expired" && <button type="button" className="w-full rounded-md p-2 text-left text-xs hover:bg-slate-50" onClick={() => c.connect("connect")}>Kết nối lại tài khoản này</button>}
        </div>
      </details> : <button type="button" className={buttonClass} onClick={() => c.connect()}><Globe className="h-4 w-4" />Kết nối Facebook</button>}
    {c.loadingConnection && !busy && <p role="status" className="text-xs text-slate-500">Đang tải kết nối đã lưu… Bạn vẫn có thể mở OAuth.</p>}
    {busy && <p role="status" className="text-xs text-slate-600">{c.job?.message || "Đang xử lý kết nối Facebook…"}</p>}
    {cancelable && <button type="button" onClick={c.cancel} disabled={c.actionBusy} className="text-xs text-slate-600 underline disabled:opacity-50">Hủy kết nối</button>}
    {cancelable && <p className="text-xs text-slate-500">Hoàn tất đăng nhập và chấp nhận trong cửa sổ OAuth. Nếu đã đóng cửa sổ đó, hãy hủy để kết nối lại.</p>}
    {c.error && <p role="alert" className="text-xs text-red-600">{c.error}</p>}
  </div>;
}

