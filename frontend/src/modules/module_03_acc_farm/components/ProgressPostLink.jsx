"use client";

import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import {
  isProgressPermalink,
  progressActivityLabel,
  resolveProgressPostUrl,
} from "@/modules/module_03_acc_farm/postSessionUi";
import { openPostInAccountBrowser } from "@/modules/module_03_acc_farm/openAccountPost";

/**
 * Cột hoạt động + nút Xem bài viết / Xem trang cá nhân trên bảng tiến trình.
 * Mở Chrome profile của nick (không dùng trình duyệt mặc định).
 */
export function ProgressActivityCell({ row }) {
  const [opening, setOpening] = useState(false);
  const url = resolveProgressPostUrl(row);
  const label = progressActivityLabel(row);
  const permalink = isProgressPermalink(row, url);
  const uid = row?.accountUid || row?.account_uid || "";

  const handleOpen = async (e) => {
    e?.stopPropagation?.();
    if (!url || !uid || opening) return;
    setOpening(true);
    try {
      await openPostInAccountBrowser(uid, url, {
        title: permalink ? "Xem bài viết" : "Xem trang cá nhân",
      });
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 min-w-[140px] max-w-[280px]">
      <span className="flex items-start gap-1.5 text-slate-700 text-xs font-medium leading-snug">
        <span
          className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
            row.status === "Đang chạy" ? "bg-blue-500" : "bg-amber-500"
          }`}
        />
        <span className="break-words">{label || "—"}</span>
      </span>
      {url ? (
        <button
          type="button"
          onClick={handleOpen}
          disabled={!uid || opening}
          className={`inline-flex items-center gap-1 w-fit px-2 py-1 rounded-lg text-[11px] font-bold transition-colors border cursor-pointer disabled:opacity-50 disabled:cursor-wait ${
            permalink
              ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
              : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
          }`}
          title={uid ? url : "Thiếu UID tài khoản — không mở được Chrome profile"}
        >
          {opening ? (
            <Loader2 size={12} className="shrink-0 animate-spin" />
          ) : (
            <ExternalLink size={12} className="shrink-0" />
          )}
          {permalink ? "Xem bài viết" : "Xem trang cá nhân"}
        </button>
      ) : null}
    </div>
  );
}
