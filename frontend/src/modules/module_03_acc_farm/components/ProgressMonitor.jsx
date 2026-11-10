"use client";

import { useEffect, useState } from "react";
import { Activity, ListChecks, PauseCircle } from "lucide-react";
import { ACTION_FULL_LABELS, MONITOR_STATUSES, RUN_STATUS } from "../constants";
import { ActionChip, RunStatusBadge, formatDuration } from "./parts";
import RunTargetsModal, { hasRunTargets } from "./RunTargetsModal";

// Nick đã kết thúc (kể cả dừng / lỗi giữa chừng) thì xem được danh sách nhóm / người đã làm được
const FINISHED_STATUSES = ["COMPLETED", "STOPPED", "FAILED", "BLOCKED", "DIE"];
const ACTION_ORDER = ["CHECK_NOTIF", "NEWSFEED", "WATCH", "STORY", "ADD_FRIEND", "LEAVE_GROUP", "JOIN_GROUP"];
const COUNT_COLORS = {
  RUNNING: "text-blue-600",
  PAUSED: "text-amber-500",
  PENDING: "text-slate-500",
  COMPLETED: "text-emerald-600",
  BLOCKED: "text-orange-500",
  FAILED: "text-rose-500",
  DIE: "text-red-600",
  STOPPED: "text-slate-700",
};

function useNow(active) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function elapsed(acc, now) {
  if (!acc.started_at) return "—";
  return formatDuration((acc.finished_at || now) - acc.started_at);
}

export default function ProgressMonitor({ status }) {
  const accounts = status?.accounts || [];
  const now = useNow(Boolean(status?.running));
  const counts = accounts.reduce((acc, a) => ({ ...acc, [a.status]: (acc[a.status] || 0) + 1 }), {});
  const [targetsOf, setTargetsOf] = useState(null);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-2xl font-bold text-[#0F172A]">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-subtle text-primary">
            <Activity className="h-4 w-4" />
          </span>
          Giám sát tiến trình
        </h2>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {status?.paused && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-700">
              <PauseCircle className="h-3.5 w-3.5" /> Đang tạm dừng
            </span>
          )}
          {status?.stopping && (
            <span className="rounded-full bg-red-50 px-2.5 py-1 font-semibold text-red-700">Đang dừng: chờ các nick lưu cookie</span>
          )}
          {status?.threads ? <span>{status.threads} luồng</span> : null}
          {status?.started_at ? (
            <span>
              Bắt đầu {new Date(status.started_at * 1000).toLocaleTimeString("vi-VN", { hour12: false })}
              {!status.running && status.finished_at ? ` · kết thúc ${new Date(status.finished_at * 1000).toLocaleTimeString("vi-VN", { hour12: false })}` : ""}
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {MONITOR_STATUSES.map((key) => (
          <div key={key} className="rounded-xl border border-border bg-white px-3.5 py-3 shadow-subtle">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wide text-slate-500">
              {RUN_STATUS[key].label}
              <span className={`h-2 w-2 rounded-full ${RUN_STATUS[key].dot}`} />
            </div>
            <div className={`mt-1 text-2xl font-bold ${COUNT_COLORS[key]}`}>{counts[key] || 0}</div>
          </div>
        ))}
      </div>

      <div className="overflow-auto rounded-xl border border-border bg-white shadow-subtle">
        <table className="w-full text-xs">
          <thead className="bg-[#EEF2FF] text-[11px] font-bold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-3 text-left">Luồng</th>
              <th className="px-4 py-3 text-left">Tài khoản</th>
              <th className="px-4 py-3 text-left">Trạng thái</th>
              <th className="px-4 py-3 text-left">Kịch bản thực thi</th>
              <th className="px-4 py-3 text-left">Hoạt động hiện tại</th>
              <th className="px-4 py-3 text-right">Thời gian</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {accounts.map((acc) => {
              const actions = Object.keys(acc.actions || {}).sort((a, b) => ACTION_ORDER.indexOf(a) - ACTION_ORDER.indexOf(b));
              return (
                <tr key={acc.uid} className="align-top hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-mono text-sm font-bold text-primary">
                    {acc.thread ? String(acc.thread).padStart(2, "0") : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm font-semibold text-slate-800">{acc.name || "—"}</div>
                    <div className="font-mono text-[10px] text-slate-500">{acc.uid}</div>
                  </td>
                  <td className="px-4 py-3">
                    <RunStatusBadge status={acc.status} />
                    {FINISHED_STATUSES.includes(acc.status) && acc.run_id && hasRunTargets(acc) && (
                      <button
                        type="button"
                        onClick={() => setTargetsOf(acc)}
                        className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                      >
                        <ListChecks className="h-3.5 w-3.5" />
                        Xem danh sách
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex max-w-[280px] flex-wrap gap-1">
                      {actions.length ? (
                        actions.map((action) => (
                          <ActionChip
                            key={action}
                            action={action}
                            status={acc.actions[action]}
                            extra={
                              action === "ADD_FRIEND" && acc.friends_sent
                                ? acc.friends_sent
                                : action === "JOIN_GROUP" && acc.groups_joined
                                  ? acc.groups_joined
                                  : null
                            }
                          />
                        ))
                      ) : (
                        <span className="text-[11px] text-slate-400">Chưa lập kế hoạch</span>
                      )}
                    </div>
                  </td>
                  <td className="max-w-[320px] px-4 py-3">
                    <div className="text-slate-700">{acc.activity || "—"}</div>
                    {acc.error && acc.error !== acc.activity && (
                      <div className="mt-0.5 line-clamp-2 text-[11px] text-rose-600" title={acc.error}>
                        {acc.error}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">{elapsed(acc, now)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400">
        Kịch bản: {Object.values(ACTION_FULL_LABELS).join(" · ")}. Màu chip: xanh lá thành công, xanh dương đang chạy, cam bị chặn,
        vàng bỏ qua, đỏ lỗi.
      </p>

      {targetsOf && <RunTargetsModal account={targetsOf} onClose={() => setTargetsOf(null)} />}
    </section>
  );
}
