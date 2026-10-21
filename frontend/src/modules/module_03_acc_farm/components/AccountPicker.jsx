"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { RefreshCw, Search, UserRound } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { attachDragSelection } from "@/modules/module_02_account_manager/utils/drag-selection.mjs";
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

export default function AccountPicker({
  accounts, knownAccounts, total, search, onSearchChange,
  loading, loadingMore, loadError, moreError, hasMore, onLoadMore,
  selected, onSelectedChange, onRefresh, readOnly,
}) {
  const scrollRef = useRef(null);
  const sentinelRef = useRef(null);
  const selection = useRef(selected);
  const visibleUids = useRef([]);
  const availableUids = useRef([]);
  const visible = useMemo(() => readOnly ? accounts : accounts.filter(
    (acc) => acc.status === "live" || acc.login_status === "logged_in",
  ), [accounts, readOnly]);
  const selectable = visible.filter(isEligible);
  const allChecked = selectable.length > 0 && selectable.every((acc) => selected.has(acc.uid));

  useLayoutEffect(() => {
    selection.current = selected;
    visibleUids.current = visible.filter(isEligible).map((acc) => acc.uid);
    availableUids.current = Object.values(knownAccounts).filter(isEligible).map((acc) => acc.uid);
  }, [selected, visible, knownAccounts]);

  useEffect(() => {
    if (!scrollRef.current || readOnly || loading || loadError) return;
    return attachDragSelection(scrollRef.current, {
      getVisibleUids: () => visibleUids.current,
      getAvailableUids: () => availableUids.current,
      getSelectedUids: () => [...selection.current],
      onSelectionChange: (uids) => {
        const available = new Set(availableUids.current);
        const next = new Set(uids.filter((uid) => available.has(uid)));
        selection.current = next;
        onSelectedChange(next);
      },
    });
  }, [readOnly, loading, loadError, onSelectedChange]);

  useEffect(() => {
    if (readOnly || loading || loadingMore || loadError || moreError || !hasMore || !sentinelRef.current) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
    }, { root: scrollRef.current });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [readOnly, loading, loadingMore, loadError, moreError, hasMore, onLoadMore, visible.length]);

  const toggle = (uid, checked) => {
    if (readOnly || loading || loadError || !availableUids.current.includes(uid)) return;
    const next = new Set(selection.current);
    if (checked) next.add(uid);
    else next.delete(uid);
    selection.current = next;
    onSelectedChange(next);
  };

  const toggleAll = (checked) => {
    if (readOnly || loading || loadError) return;
    // Snapshot only the loaded rows. Appending another page never changes selection.
    const next = new Set(selection.current);
    selectable.forEach((acc) => (checked ? next.add(acc.uid) : next.delete(acc.uid)));
    selection.current = next;
    onSelectedChange(next);
  };

  const refresh = () => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    onRefresh();
  };

  return (
    <SectionCard
      icon={UserRound}
      title={readOnly ? "Số tài khoản đã chọn" : "Danh Sách Thực Thi"}
      subtitle={
        readOnly
          ? `${accounts.length} tài khoản`
          : `Đã chọn ${selected.size} tài khoản · Đã tải ${visible.length}/${total} (${selectable.length} đủ điều kiện Live + Đã đăng nhập)`
      }
      action={
        !readOnly && (
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            title="Tải lại danh sách tài khoản"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        )
      }
    >
      {!readOnly && (
        <div className="mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => {
                if (scrollRef.current) scrollRef.current.scrollTop = 0;
                onSearchChange(e.target.value);
              }}
              aria-label="Tìm tài khoản thực thi"
              placeholder="Tìm UID, tên nick, proxy..."
              className="h-9 w-full rounded-lg border border-border bg-slate-50 pl-9 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>
      )}

      <div ref={scrollRef} className="max-h-[340px] select-none overflow-auto rounded-lg border border-border">
        <table className="w-full text-xs" aria-label="Danh sách tài khoản thực thi" aria-busy={loading || loadingMore}>
          <thead className="sticky top-0 z-10 bg-[#EEF2FF] text-[11px] font-bold uppercase tracking-wide text-slate-600">
            <tr>
              {!readOnly && (
                <th className="w-10 px-3 py-3">
                  <Checkbox checked={allChecked} onCheckedChange={toggleAll} disabled={loading || Boolean(loadError) || !selectable.length} aria-label="Chọn tất cả tài khoản đã tải đủ điều kiện" />
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
            {(!loading && !loadError || readOnly) && visible.map((acc, idx) => {
              const eligible = isEligible(acc);
              const login = LOGIN_LABELS[acc.login_status] || LOGIN_LABELS.not_logged_in;
              const status = ACCOUNT_STATUS[acc.status];
              return (
                <tr
                  key={acc.uid}
                  data-account-uid={eligible && !readOnly ? acc.uid : undefined}
                  aria-selected={!readOnly && selected.has(acc.uid)}
                  onClick={(event) => {
                    if (!eligible || readOnly || event.target.closest("button, input, a, select, textarea")) return;
                    toggle(acc.uid, !selection.current.has(acc.uid));
                  }}
                  className={`${eligible || readOnly ? "" : "opacity-60"} ${eligible && !readOnly ? "cursor-pointer" : ""} ${selected.has(acc.uid) && !readOnly ? "bg-primary-subtle/40" : "hover:bg-slate-50"}`}
                  title={eligible || readOnly ? undefined : "Chỉ chạy được nick Live + Đã đăng nhập"}
                >
                  {!readOnly && (
                    <td className="px-3 py-3">
                      <Checkbox
                        checked={selected.has(acc.uid)}
                        onCheckedChange={(checked) => toggle(acc.uid, checked)}
                        disabled={!eligible}
                        aria-label={`Chọn tài khoản ${acc.uid}`}
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
            {!readOnly && loadError && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-xs text-red-600">
                  <p role="alert">{loadError}</p>
                  <button type="button" onClick={refresh} className="mt-2 font-semibold text-primary hover:underline">Thử lại</button>
                </td>
              </tr>
            )}
            {(!readOnly && loading || !visible.length && !loadError) && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-xs text-slate-400">
                  {loading
                    ? "Đang tải danh sách tài khoản..."
                    : search
                      ? "Không có tài khoản Live hoặc Đã đăng nhập khớp từ khóa."
                      : "Chưa có tài khoản Live hoặc Đã đăng nhập."}
                </td>
              </tr>
            )}
            {!readOnly && !loading && !loadError && hasMore && (
              <tr ref={!moreError && !loadingMore ? sentinelRef : undefined}>
                <td colSpan={7} className="px-3 py-3 text-center text-xs text-slate-500">
                  {loadingMore ? "Đang tải thêm tài khoản..." : moreError ? (
                    <>
                      <span role="alert" className="text-red-600">{moreError}</span>
                      <button type="button" onClick={onLoadMore} className="ml-2 font-semibold text-primary hover:underline">Thử lại</button>
                    </>
                  ) : (
                    <button type="button" onClick={onLoadMore} className="font-semibold text-primary hover:underline">Tải thêm tài khoản</button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
