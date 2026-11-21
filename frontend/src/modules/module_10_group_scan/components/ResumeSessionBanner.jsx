"use client";

import { useCallback, useEffect, useState } from "react";
import { History, Loader2, Play, X } from "lucide-react";
import { toast } from "@/lib/toast";
import { getResumableSession, resumeScanSession } from "../service";

/**
 * Thông báo "Phiên trước bị gián đoạn" + nút Chạy tiếp ở đầu trang Quét.
 * Chỉ quét phần còn thiếu của phiên cũ (cùng nick & cấu hình); không tự mở Chrome khi chưa bấm.
 *
 * scanType: "GROUP_INFO" | "GROUP_MEMBERS"
 * hidden:   đang có phiên chạy → ẩn
 * onResumed(result): phiên mới đã bắt đầu ({ job_id, scan_type, remaining })
 */
export default function ResumeSessionBanner({ scanType, hidden = false, onResumed }) {
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    try {
      setSession(await getResumableSession(scanType));
    } catch {
      setSession(null);
    }
  }, [scanType]);

  // Tải khi mở trang và mỗi khi phiên quét vừa kết thúc (hidden: true → false) — phiên dừng dở ngay trên
  // trang này cũng hiện nút Chạy tiếp, không cần chuyển trang.
  useEffect(() => {
    if (hidden) return;
    setDismissed(false);
    load();
  }, [load, hidden]);

  if (hidden || dismissed || !session) return null;

  const unit = scanType === "GROUP_MEMBERS" ? "nhóm" : "từ khóa / link";
  const reason = session.status === "ABORTED" ? "đã dừng giữa chừng" : "bị gián đoạn (app hoặc Engine tắt giữa chừng)";

  const handleResume = async () => {
    setBusy(true);
    try {
      const res = await resumeScanSession(session.session_id);
      toast.success(`Đang chạy tiếp ${res?.remaining || session.remaining} ${unit} còn thiếu của phiên trước.`);
      setSession(null);
      onResumed?.(res);
    } catch (err) {
      toast.error(err?.message || "Không chạy tiếp được phiên này.");
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <History className="mt-0.5 size-5 shrink-0 text-amber-600" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-900">Phiên quét trước {reason}</p>
          <p className="text-xs text-amber-800" title={session.title}>
            {session.startTime ? `Phiên bắt đầu lúc ${session.startTime} · ` : ""}còn {session.remaining} {unit} chưa quét xong.
            Bấm Chạy tiếp sẽ quét nốt (nhóm / thành viên đã có tự bỏ qua):
          </p>
          {Array.isArray(session.items) && session.items.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {session.items.map((it, i) => (
                <li
                  key={`${it.label}-${i}`}
                  className="max-w-[260px] truncate rounded-md border border-amber-200 bg-white px-2 py-0.5 text-[11px] text-amber-900"
                  title={it.label}
                >
                  {it.unit === "link" ? it.label.replace(/^https?:\/\/(www\.)?/, "") : `«${it.label}»`}
                  {it.unit === "link" ? "" : ` — thêm ${it.left} ${it.unit}`}
                </li>
              ))}
              {session.remaining > session.items.length && (
                <li className="px-1 text-[11px] text-amber-800">+{session.remaining - session.items.length} mục khác</li>
              )}
            </ul>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={handleResume}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          Chạy tiếp
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          title="Ẩn thông báo (vẫn chạy tiếp được ở trang Lịch sử)"
          className="rounded-lg p-1.5 text-amber-700 hover:bg-amber-100"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
