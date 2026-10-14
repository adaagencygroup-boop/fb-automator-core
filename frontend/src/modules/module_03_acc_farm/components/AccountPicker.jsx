"use client";

import { useMemo, useState } from "react";
import { RefreshCw, Search, UserRound } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import CustomSelect from "@/components/ui/custom-select";
import { SectionCard, UidCopy, proxyHost } from "./parts";

const LOGIN_LABELS = {
  logged_in: { label: "Đã đăng nhập", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  not_logged_in: { label: "Chưa đăng nhập", cls: "bg-slate-100 text-slate-600 border-slate-200", dot: "bg-slate-400" },
  failed: { label: "Đăng nhập lỗi", cls: "bg-rose-50 text-rose-700 border-rose-200", dot: "bg-rose-500" },
};

const ACCOUNT_STATUS = {
  live: { label: "Live", cls: "bg-emerald-50 text-emerald-700" },
  die: { label: "Die", cls: "bg-red-50 text-red-700" },
};

// Chỉ nick Live + Đã đăng nhập mới chạy được (BE loại nick khác khi Kích hoạt)
export const isEligible = (acc) => acc.status === "live" && acc.login_status === "logged_in";

const LOGIN_FILTERS = [
  { value: "", label: "Tất cả trạng thái ĐN" },
  { value: "logged_in", label: "Đã đăng nhập" },
  { value: "not_logged_in", label: "Chưa đăng nhập" },
  { value: "failed", label: "Đăng nhập lỗi" },
];

const STATUS_FILTERS = [
  { value: "", label: "Tất cả trạng thái TK" },
  { value: "live", label: "Live" },
  { value: "die", label: "Die" },
  { value: "unknown", label: "Chưa kiểm tra" },
];

export default function AccountPicker({ accounts, loading, selected, onSelectedChange, onRefresh, readOnly }) {
  const [search, setSearch] = useState("");
  const [loginFilter, setLoginFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((acc) => {
      if (loginFilter && acc.login_status !== loginFilter) return false;
      if (statusFilter === "unknown" ? acc.status : statusFilter && acc.status !== statusFilter) return false;
      if (!q) return true;
      return [acc.uid, acc.profile_name, proxyHost(acc.proxy)].some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [accounts, search, loginFilter, statusFilter]);

  const selectable = visible.filter(isEligible);
  const allChecked = selectable.length > 0 && selectable.every((acc) => selected.has(acc.uid));
  const eligibleCount = accounts.filter(isEligible).length;

  const toggle = (uid, checked) => {
    const next = new Set(selected);
    if (checked) next.add(uid);
    else next.delete(uid);
    onSelectedChange(next);
  };

  const toggleAll = (checked) => {
    const next = new Set(selected);
    selectable.forEach((acc) => (checked ? next.add(acc.uid) : next.delete(acc.uid)));
    onSelectedChange(next);
  };

  return (
    <SectionCard
      icon={UserRound}
      title={readOnly ? "Số tài khoản đã chọn" : "Danh Sách Thực Thi"}
      subtitle={
        readOnly
          ? `${accounts.length} tài khoản`
          : `Đã chọn ${selected.size} / ${accounts.length} tài khoản (${eligibleCount} đủ điều kiện Live + Đã đăng nhập)`
      }
      action={
        !readOnly && (
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            title="Tải lại danh sách tài khoản"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        )
      }
    >
      {!readOnly && (
        <div className="mb-3 flex flex-col gap-2 md:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm UID, tên nick, proxy..."
              className="h-9 w-full rounded-lg border border-border bg-slate-50 pl-9 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <CustomSelect className="md:w-48" value={statusFilter} onChange={setStatusFilter} options={STATUS_FILTERS} />
          <CustomSelect className="md:w-48" value={loginFilter} onChange={setLoginFilter} options={LOGIN_FILTERS} />
        </div>
      )}

      <div className="max-h-[340px] overflow-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-[#EEF2FF] text-[11px] font-bold uppercase tracking-wide text-slate-600">
            <tr>
              {!readOnly && (
                <th className="w-10 px-3 py-3">
                  <Checkbox checked={allChecked} onCheckedChange={toggleAll} disabled={!selectable.length} />
                </th>
              )}
              <th className="w-14 px-3 py-3 text-left">STT</th>
              <th className="px-3 py-3 text-left">UID Facebook</th>
              <th className="px-3 py-3 text-left">Họ &amp; tên tài khoản</th>
              <th className="px-3 py-3 text-left">Proxy</th>
              <th className="px-3 py-3 text-left">Trạng thái ĐN</th>
              <th className="px-3 py-3 text-left">Trạng thái TK</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((acc, idx) => {
              const eligible = isEligible(acc);
              const login = LOGIN_LABELS[acc.login_status] || LOGIN_LABELS.not_logged_in;
              const status = ACCOUNT_STATUS[acc.status];
              return (
                <tr
                  key={acc.uid}
                  className={`${eligible || readOnly ? "" : "opacity-60"} ${selected.has(acc.uid) && !readOnly ? "bg-primary-subtle/40" : "hover:bg-slate-50"}`}
                  title={eligible || readOnly ? undefined : "Chỉ chạy được nick Live + Đã đăng nhập"}
                >
                  {!readOnly && (
                    <td className="px-3 py-3">
                      <Checkbox
                        checked={selected.has(acc.uid)}
                        onCheckedChange={(checked) => toggle(acc.uid, checked)}
                        disabled={!eligible}
                      />
                    </td>
                  )}
                  <td className="px-3 py-3 text-slate-500">{String(idx + 1).padStart(2, "0")}</td>
                  <td className="px-3 py-3">
                    <UidCopy uid={acc.uid} />
                  </td>
                  <td className="px-3 py-3 text-sm font-semibold text-slate-800">{acc.profile_name || "—"}</td>
                  <td className="px-3 py-3 font-mono text-[11px] text-slate-500">{proxyHost(acc.proxy) || "IP máy"}</td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${login.cls}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${login.dot}`} />
                      {login.label}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {status ? (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${status.cls}`}>{status.label}</span>
                    ) : (
                      <span className="text-[10px] text-slate-400">Chưa kiểm tra</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!visible.length && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-xs text-slate-400">
                  {loading
                    ? "Đang tải danh sách tài khoản..."
                    : accounts.length
                      ? "Không có tài khoản khớp bộ lọc."
                      : "Chưa có tài khoản. Thêm tài khoản ở trang Quản lý tài khoản Facebook."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
