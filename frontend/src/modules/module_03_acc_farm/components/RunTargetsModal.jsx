"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, LogOut, UserPlus, Users, X } from "lucide-react";
import { getFarmRunTargets } from "../service";
import { TargetList } from "./HistoryDetail";
import { UidCopy } from "./parts";

const LISTS = [
  { key: "groups_joined", action: "JOIN_GROUP", title: "Nhóm đã tham gia", icon: Users },
  { key: "groups_left", action: "LEAVE_GROUP", title: "Nhóm đã rời", icon: LogOut },
  { key: "friends_sent", action: "ADD_FRIEND", title: "Đã gửi lời mời kết bạn", icon: UserPlus },
];
// Danh sách ghi xuống CSDL qua hàng đợi: nick vừa xong có thể chưa kịp ghi nên đọc lại vài lần trước khi báo trống
const LOAD_TRIES = 3;
const RETRY_MS = 1500;

// Hành động đã chạy tới (kể cả dừng / lỗi giữa chừng); còn "PENDING" là chưa tới lượt thì không có gì để xem
const ran = (account, action) => Boolean(account.actions?.[action]) && account.actions[action] !== "PENDING";

export const hasRunTargets = (account) => LISTS.some((list) => ran(account, list.action));

export default function RunTargetsModal({ account, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let timer;
    const load = async (attempt) => {
      try {
        const res = await getFarmRunTargets(account.run_id);
        if (cancelled) return;
        if (attempt < LOAD_TRIES && LISTS.every((list) => !res[list.key]?.length)) {
          timer = setTimeout(() => load(attempt + 1), RETRY_MS);
          return;
        }
        setData(res);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    };
    load(1);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [account.run_id]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100000] flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label="Danh sách đã tương tác" className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng"
          className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="shrink-0 border-b border-slate-200 px-6 py-4 pr-12">
          <div className="text-base font-bold text-slate-900">{account.name || "—"}</div>
          <UidCopy uid={account.uid} />
        </div>

        <div className="space-y-5 overflow-y-auto px-6 py-5">
          {!data && !error && (
            <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang tải danh sách...
            </div>
          )}
          {error && <div className="py-6 text-sm text-rose-600">{error}</div>}
          {data &&
            LISTS.filter((list) => ran(account, list.action)).map(({ key, action, title, icon: Icon }) => (
              <section key={key}>
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                  <Icon className="h-4 w-4 text-primary" />
                  {title} ({data[key]?.length || 0})
                </h3>
                {data[key]?.length ? (
                  <TargetList action={action} targets={data[key]} nick={{ uid: account.uid, name: account.name }} />
                ) : (
                  <p className="mt-1.5 text-xs text-slate-400">Không có</p>
                )}
              </section>
            ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
