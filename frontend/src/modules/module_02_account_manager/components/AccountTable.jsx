"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { attachDragSelection } from "../utils/drag-selection.mjs";
import AccountDetailPanel from "./AccountDetailPanel";
import CustomSelect from "@/components/ui/custom-select";
import {
  Check,
  Copy,
  Edit3,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  LogIn,
  Search,
  Trash2,
} from "lucide-react";
import { formatVietnamDateTime } from "@/lib/date-utils";

function CheckStatusIcon({ className = "w-3 h-3 shrink-0" }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M0.664062 0.669482V4.00282H1.05206M11.2894 5.33615C10.9862 2.9269 9.09396 1.02652 6.68604 0.712908C4.27813 0.399296 1.96228 1.75161 1.05206 4.00282M1.05206 4.00282H3.9974M11.3307 11.3361V8.00282H10.9434M10.9434 8.00282C10.0319 10.2526 7.71658 11.6036 5.30946 11.2901C2.90235 10.9766 1.01026 9.07771 0.705396 6.66948M10.9434 8.00282H7.9974"
        stroke="#047857"
        strokeWidth="1.33333"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ConcurrentThreadsIcon({ className = "w-4 h-4 shrink-0" }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M5.33073 4.66667H13.3307M13.3307 4.66667L10.6641 2M13.3307 4.66667L10.6641 7.33333M10.6641 11.3333H2.66406M2.66406 11.3333L5.33073 14M2.66406 11.3333L5.33073 8.66667"
        stroke="#2563EB"
        strokeWidth="1.33333"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const avatarColors = ["#1877F2", "#0084FF", "#087A62", "#4F46E5", "#0284C7"];

const accountFilterOptions = [
  { value: "all", label: "Tất cả trạng thái TK" },
  { value: "live", label: "Live" },
  { value: "die", label: "Die" },
];

const loginFilterOptions = [
  { value: "all", label: "Tất cả đăng nhập" },
  { value: "logged_in", label: "Đã đăng nhập" },
  { value: "not_logged_in", label: "Chưa đăng nhập" },
  { value: "failed", label: "Đăng nhập lỗi" },
];

function DetailRow({ account, isClosing, onClosed, onClose }) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setIsOpen(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const show = isOpen && !isClosing;

  return (
    <tr className="bg-slate-50/50">
      <td
        colSpan={8}
        className={`p-0 overflow-hidden transition-[border-color] ${
          show
            ? "border-b border-[#E2E8F0] duration-[240ms]"
            : "border-b-0 border-transparent duration-[260ms]"
        }`}
        style={{ fontSize: 0, lineHeight: 0 }}
      >
        <div
          className={`grid transition-[grid-template-rows,opacity] ${
            show
              ? "grid-rows-[1fr] opacity-100 duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
              : "grid-rows-[0fr] opacity-0 duration-[260ms] ease-[cubic-bezier(0.25,1,0.5,1)]"
          }`}
          onTransitionEnd={(e) => {
            if (e.target === e.currentTarget && e.propertyName === "grid-template-rows" && isClosing) {
              onClosed();
            }
          }}
        >
          <div className="overflow-hidden min-h-0" style={{ fontSize: "13px", lineHeight: "normal" }}>
            <AccountDetailPanel uid={account.uid} initialAccount={account} onClose={onClose} />
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function AccountTable({
  accounts = [],
  tableRef, total = 0, hasMore = false, isLoadingMore = false, moreError, onLoadMore, onRetryMore,
  searchTerm, setSearchTerm, accountFilter, setAccountFilter, loginFilter, setLoginFilter,
  isLoading = false,
  isRefreshing = false,
  loadError = null,
  onRetry,
  selectedUids = [],
  onToggleSelect,
  onSelectAll,
  onSelectionChange,
  onEditAccount,
  onDeleteAccount,
  onOpenBrowser,
  onBulkDelete,
  onRefresh,
  isCheckingStatus = false,
  openingBrowserUids,
  effectiveThreads = 3,
  setCustomThreads,
  maxThreads = 10,
  handleLogin,
  isLoggingIn = false,
}) {
  const [expandedUids, setExpandedUids] = useState(new Set());
  const [closingUids, setClosingUids] = useState(new Set());
  const [copiedUid, setCopiedUid] = useState(null);
  const scrollRef = useRef(null);
  const selectedUidsRef = useRef(selectedUids);
  const sentinelRef = useRef(null);
  const anchorRef = useRef(null);
  const rowsRef = useRef(accounts);
  useLayoutEffect(() => { rowsRef.current = accounts; }, [accounts]);
  useLayoutEffect(() => {
    if (!tableRef) return;
    tableRef.current = {
      reset: () => { scrollRef.current.scrollTop = 0; anchorRef.current = null; },
      capture: () => {
        const root = scrollRef.current;
        const top = root.getBoundingClientRect().top + (root.querySelector("thead")?.offsetHeight || 0);
        const row = [...root.querySelectorAll("[data-account-uid]")].find(row => row.getBoundingClientRect().bottom > top);
        return row ? { uid: row.dataset.accountUid, id: rowsRef.current.find(account => account.uid === row.dataset.accountUid)?.id, offset: row.getBoundingClientRect().top - root.getBoundingClientRect().top } : null;
      },
      restore: anchor => { anchorRef.current = anchor; },
    };
    return () => { tableRef.current = null; };
  }, [tableRef]);
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    anchorRef.current = null;
    const root = scrollRef.current;
    const row = [...root.querySelectorAll("[data-account-uid]")].find(row => row.dataset.accountUid === anchor.uid);
    if (row) root.scrollTop += row.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.offset;
  }, [accounts]);
  useEffect(() => {
    if (!hasMore || isLoading || isLoadingMore || moreError || !sentinelRef.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) onLoadMore();
    }, { root: scrollRef.current, rootMargin: "160px" });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, isLoading, isLoadingMore, moreError, onLoadMore]);

  useEffect(() => {
    selectedUidsRef.current = selectedUids;
  }, [selectedUids]);

  const handleDetailClosed = (uid) => {
    setExpandedUids((prev) => {
      if (!prev.has(uid)) return prev;
      const next = new Set(prev);
      next.delete(uid);
      return next;
    });
    setClosingUids((prev) => {
      if (!prev.has(uid)) return prev;
      const next = new Set(prev);
      next.delete(uid);
      return next;
    });
  };

  const toggleDetail = (uid) => {
    if (closingUids.has(uid)) return;
    if (expandedUids.has(uid)) {
      setClosingUids((prev) => new Set(prev).add(uid));
      setTimeout(() => {
        handleDetailClosed(uid);
      }, 320);
    } else {
      setExpandedUids((prev) => new Set(prev).add(uid));
    }
  };

  const handleCopyUid = (uid) => {
    navigator.clipboard.writeText(uid);
    setCopiedUid(uid);
    setTimeout(() => setCopiedUid(null), 1500);
  };

  const filteredAccounts = accounts;
  const handleSearchChange = (event) => {
    setSearchTerm(event.target.value);
  };

  const handleAccountFilterChange = (val) => {
    setAccountFilter(val);
  };

  const handleLoginFilterChange = (val) => {
    setLoginFilter(val);
  };

  const isAllSelected =
    filteredAccounts.length > 0 &&
    filteredAccounts.every((account) => selectedUids.includes(account.uid));


  useEffect(() => {
    if (!scrollRef.current || !onSelectionChange) return;
    return attachDragSelection(scrollRef.current, {
      getVisibleUids: () => rowsRef.current.map(row => row.uid),
      getAvailableUids: () => rowsRef.current.map(row => row.uid),
      getSelectedUids: () => selectedUidsRef.current,
      onSelectionChange: (uids) => {
        selectedUidsRef.current = uids;
        onSelectionChange(uids);
      },
      disabled: isLoading || Boolean(loadError),
    });
  }, [onSelectionChange, isLoading, loadError]);

  return (
    <section className="w-full flex flex-col rounded-2xl bg-white border border-[#E2E8F0] shadow-[0_1px_2px_0_rgba(0,0,0,0.05)] overflow-hidden select-none">
      {/* 1. Section - Filter / Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-5 border-b border-[#E2E8F0] bg-white">
        {/* Search & Dropdowns Container */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1 max-w-3xl">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
            <input
              type="text"
              value={searchTerm}
              onChange={handleSearchChange}
              placeholder="Tìm kiếm theo UID, Tên tài khoản..."
              className="w-full h-10 pl-10 pr-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-[#1E293B] placeholder-[#6B7280] text-sm focus:outline-none focus:bg-white focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15 transition-all"
            />
          </div>

          {/* Account Status Filter Dropdown */}
          <div className="w-full sm:w-48 shrink-0">
            <CustomSelect
              value={accountFilter}
              onChange={handleAccountFilterChange}
              options={accountFilterOptions}
              className="w-full h-10 text-xs font-medium text-[#334155] rounded-xl"
            />
          </div>

          {/* Login Status Filter Dropdown */}
          <div className="w-full sm:w-44 shrink-0">
            <CustomSelect
              value={loginFilter}
              onChange={handleLoginFilterChange}
              options={loginFilterOptions}
              className="w-full h-10 text-xs font-medium text-[#334155] rounded-xl"
            />
          </div>
        </div>

        {/* Toolbar Action Buttons (Check trạng thái & Xóa) */}
        <div className="flex items-center gap-2.5 shrink-0 self-end lg:self-auto">
          {/* Check Status Button */}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading || isCheckingStatus || selectedUids.length === 0}
            className="flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] hover:bg-[#D1FAE5] px-3.5 text-xs font-semibold text-[#047857] transition disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer shadow-2xs"
            title="Kiểm tra trạng thái Live/Die của các tài khoản đã chọn"
          >
            <CheckStatusIcon className={`w-3 h-3 ${isCheckingStatus ? "animate-spin [animation-direction:reverse]" : ""}`} />
            <span>
              {isCheckingStatus ? "Đang kiểm tra..." : "Check trạng thái"}
              {selectedUids.length > 0 ? ` (${selectedUids.length})` : ""}
            </span>
          </button>

          {/* Bulk Delete Button */}
          <button
            type="button"
            onClick={onBulkDelete}
            disabled={isLoading || selectedUids.length === 0}
            className="flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-[#FECDD3] bg-[#FFF1F2] hover:bg-[#FFE4E6] px-3.5 text-xs font-semibold text-[#BE123C] transition disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer shadow-2xs"
            title="Xóa các tài khoản đã chọn"
          >
            <Trash2 className="w-4 h-4" />
            <span>Xóa {selectedUids.length > 0 ? `(${selectedUids.length})` : ""}</span>
          </button>
        </div>
      </div>

      {/* 2. Section - Data Table (Khung cuộn hiển thị 10 dòng tài khoản) */}
      <div className="relative w-full">
        <div ref={scrollRef} className="w-full overflow-x-auto max-h-[605px] overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#4B8EFF]/60 hover:[&::-webkit-scrollbar-thumb]:bg-[#2563EB] [&::-webkit-scrollbar-thumb]:rounded-full">
          <table aria-busy={isLoading || isRefreshing} className="w-full table-fixed border-collapse min-w-[960px]">
          <colgroup>
            <col className="w-[4%]" />
            <col className="w-[5%]" />
            <col className="w-[16%]" />
            <col className="w-[23%]" />
            <col className="w-[13%]" />
            <col className="w-[14%]" />
            <col className="w-[11%]" />
            <col className="w-[14%]" />
          </colgroup>

          <thead className="sticky top-0 z-10 bg-[#F8FAFC] shadow-[0_1px_0_0_#E2E8F0]">
            <tr className="h-11 border-b border-[#E2E8F0]">
              <th className="px-1 py-2 text-center bg-[#F8FAFC]">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  disabled={isLoading || !!loadError}
                  aria-label="Chọn tất cả tài khoản"
                  onChange={() => onSelectAll(filteredAccounts.map((a) => a.uid))}
                  className="h-4 w-4 rounded border-[#CBD5E1] accent-[#2563EB] cursor-pointer"
                />
              </th>
              <th className="px-1 py-2 font-bold text-[11px] uppercase tracking-wider text-[#64748B] text-center bg-[#F8FAFC]">
                STT
              </th>
              <th className="px-2 py-2 font-bold text-[11px] uppercase tracking-wider text-[#64748B] text-left bg-[#F8FAFC]">
                UID
              </th>
              <th className="px-3 py-2 font-bold text-[11px] uppercase tracking-wider text-[#64748B] text-left bg-[#F8FAFC]">
                TÊN TÀI KHOẢN
              </th>
              <th className="px-2 py-2 font-bold text-[11px] uppercase tracking-wider text-[#64748B] text-center whitespace-nowrap bg-[#F8FAFC]">
                <span className="block leading-tight">TRẠNG THÁI</span>
                <span className="block text-[10px] text-[#94A3B8] leading-tight">TÀI KHOẢN</span>
              </th>
              <th className="px-2 py-2 font-bold text-[11px] uppercase tracking-wider text-[#64748B] text-center whitespace-nowrap bg-[#F8FAFC]">
                <span className="block leading-tight">TRẠNG THÁI</span>
                <span className="block text-[10px] text-[#94A3B8] leading-tight">ĐĂNG NHẬP</span>
              </th>
              <th className="px-2 py-2 font-bold text-[11px] uppercase tracking-wider text-[#64748B] text-center bg-[#F8FAFC]">
                LAST LOGIN
              </th>
              <th className="px-2 py-2 font-bold text-[11px] uppercase tracking-wider text-[#64748B] text-center bg-[#F8FAFC]">
                HÀNH ĐỘNG
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100 text-xs">
            {isLoading ? (
              Array.from({ length: 5 }, (_, index) => (
                <tr key={`skeleton-${index}`} aria-hidden="true" className="h-14 motion-safe:animate-pulse">
                  <td className="px-1 py-2"><div className="mx-auto h-4 w-4 rounded bg-slate-200/70" /></td>
                  <td className="px-1 py-2"><div className="mx-auto h-3 w-4 rounded bg-slate-200/70" /></td>
                  <td className="px-2 py-2"><div className="h-3 w-4/5 rounded bg-slate-200/70" /></td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <div className="h-7 w-7 shrink-0 rounded-full bg-slate-200/70" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 w-3/4 rounded bg-slate-200/70" />
                        <div className="h-2 w-1/2 rounded bg-slate-100" />
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2"><div className="mx-auto h-5 w-14 rounded-full bg-slate-200/70" /></td>
                  <td className="px-2 py-2"><div className="mx-auto h-5 w-24 rounded-full bg-slate-200/70" /></td>
                  <td className="px-2 py-2"><div className="mx-auto h-3 w-16 rounded bg-slate-200/70" /></td>
                  <td className="px-2 py-2">
                    <div className="flex justify-center gap-1.5">
                      {Array.from({ length: 4 }, (_, action) => <div key={action} className="h-7 w-7 rounded-md bg-slate-200/70" />)}
                    </div>
                  </td>
                </tr>
              ))
            ) : loadError ? (
              <tr>
                <td colSpan={8} className="px-4 py-14 text-center">
                  <p role="alert" className="text-sm text-red-600">Không thể tải tài khoản: {loadError}</p>
                  <button type="button" onClick={onRetry} className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Thử lại</button>
                </td>
              </tr>
            ) : filteredAccounts.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-14 text-center text-slate-500">
                  <div className="flex flex-col items-center justify-center gap-2 max-w-sm mx-auto">
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
                      <Search className="w-5 h-5" />
                    </div>
                    <p className="text-[#0F172A] font-semibold text-sm">
                      {accounts.length === 0 ? "Chưa có tài khoản Facebook nào" : "Không tìm thấy tài khoản phù hợp"}
                    </p>
                    <p className="text-xs text-[#64748B] leading-relaxed">
                      {accounts.length === 0
                        ? "Vui lòng bấm 'Thêm nhiều tài khoản' để lưu tài khoản vào hệ thống."
                        : "Vui lòng thử tìm kiếm bằng từ khóa khác hoặc điều chỉnh lại bộ lọc trạng thái."}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredAccounts.map((account, index) => {
                const initial = (account.profile_name || account.uid).trim().charAt(0).toUpperCase();
                const isSelected = selectedUids.includes(account.uid);

                return (
                  <React.Fragment key={account.uid}>
                    <tr
                      data-account-uid={account.uid}
                      aria-selected={isSelected}
                      className={`h-14 transition-colors hover:bg-slate-50/80 ${
                        isSelected ? "bg-[#EFF6FF] hover:bg-[#EFF6FF]" : ""
                      }`}
                    >
                      {/* 1. Checkbox */}
                      <td className="px-1 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => onToggleSelect(account.uid)}
                          className="h-4 w-4 rounded border-[#CBD5E1] accent-[#2563EB] cursor-pointer"
                        />
                      </td>

                      {/* 2. STT */}
                      <td className="px-1 py-2 font-medium text-[#64748B] text-center text-xs">
                        {index + 1}
                      </td>

                      {/* 3. UID */}
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="font-mono font-semibold text-[#1E293B] truncate tracking-tight text-xs"
                            title={account.uid}
                          >
                            {account.uid}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopyUid(account.uid)}
                            className="p-1 rounded hover:bg-slate-200/60 text-[#94A3B8] hover:text-[#1E293B] transition-colors cursor-pointer shrink-0"
                            title="Sao chép UID"
                          >
                            {copiedUid === account.uid ? (
                              <Check className="w-3.5 h-3.5 text-[#059669]" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* 4. Tên tài khoản */}
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-bold text-[11px] text-white shadow-2xs"
                            style={{ backgroundColor: avatarColors[index % avatarColors.length] }}
                          >
                            {initial}
                          </span>
                          <div className="flex flex-col justify-center min-w-0 overflow-hidden">
                            <span
                              className="font-medium text-[#1E293B] truncate text-xs sm:text-sm"
                              title={account.profile_name || "Chưa cập nhật"}
                            >
                              {account.profile_name || "Chưa cập nhật"}
                            </span>
                            {account.email && (
                              <span
                                className="text-[11px] text-[#64748B] truncate"
                                title={account.email}
                              >
                                {account.email}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* 5. Trạng thái tài khoản (Badge pill với chấm tròn) */}
                      <td className="px-2 py-2 text-center whitespace-nowrap">
                        {account.status === "live" ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#ECFDF5] border border-[#A7F3D0] text-[#047857]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                            Live
                          </span>
                        ) : account.status === "die" ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#FFF1F2] border border-[#FECDD3] text-[#BE123C]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#F43F5E]" />
                            Die
                          </span>
                        ) : (
                          <span className="text-[#94A3B8] text-xs">--</span>
                        )}
                      </td>

                      {/* 6. Trạng thái đăng nhập (Badge pill với chấm tròn) */}
                      <td className="px-2 py-2 text-center whitespace-nowrap">
                        {account.login_status === "logged_in" ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#ECFDF5] border border-[#A7F3D0] text-[#047857]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                            Đã đăng nhập
                          </span>
                        ) : account.login_status === "failed" ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#FFF1F2] border border-[#FECDD3] text-[#BE123C]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#F43F5E]" />
                            Đăng nhập lỗi
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#F1F5F9] border border-[#E2E8F0] text-[#475569]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#94A3B8]" />
                            Chưa đăng nhập
                          </span>
                        )}
                      </td>

                      {/* 7. Last login (2 dòng: Ngày / Giờ hoặc --) */}
                      <td className="px-2 py-2 text-center">
                        {account.last_login_at ? (
                          (() => {
                            const { time, date } = formatVietnamDateTime(account.last_login_at);
                            if (time === "--:--") return <span className="text-[#94A3B8] text-xs">--</span>;
                            return (
                              <div className="flex flex-col items-center justify-center">
                                <span className="font-semibold text-[#334155] font-mono text-[11px]">
                                  {date}
                                </span>
                                <span className="text-[10px] text-[#94A3B8]">
                                  {time}
                                </span>
                              </div>
                            );
                          })()
                        ) : (
                          <span className="text-[#94A3B8] text-xs">--</span>
                        )}
                      </td>

                      {/* 8. Hành động: 4 nút vuông chuẩn Figma [Mắt] → [Bút chì] → [Địa cầu] → [Thùng rác] */}
                      <td className="px-2 py-2 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Nút 1: Xem/Ẩn chi tiết 11 trường (Mắt) */}
                          <button
                            type="button"
                            onClick={() => toggleDetail(account.uid)}
                            aria-expanded={expandedUids.has(account.uid) && !closingUids.has(account.uid)}
                            title={expandedUids.has(account.uid) && !closingUids.has(account.uid) ? "Đóng chi tiết" : "Xem chi tiết 11 trường"}
                            className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors border cursor-pointer shadow-2xs ${
                              expandedUids.has(account.uid) && !closingUids.has(account.uid)
                                ? "bg-blue-50 border-blue-200 text-[#2563EB]"
                                : "border-[#E2E8F0] bg-white hover:bg-slate-50 text-[#94A3B8] hover:text-[#2563EB]"
                            }`}
                          >
                            {expandedUids.has(account.uid) && !closingUids.has(account.uid) ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {/* Nút 2: Chỉnh sửa (Bút chì) */}
                          <button
                            type="button"
                            onClick={() => onEditAccount(account.uid)}
                            title="Chỉnh sửa thông tin"
                            className="flex items-center justify-center w-7 h-7 rounded-md border border-[#E2E8F0] bg-white hover:bg-slate-50 text-[#94A3B8] hover:text-[#2563EB] transition-colors cursor-pointer shadow-2xs"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>

                          {/* Nút 3: Mở Chrome Profile (Quả địa cầu) */}
                          <button
                            type="button"
                            onClick={() => onOpenBrowser(account.uid)}
                            disabled={openingBrowserUids?.has(account.uid)}
                            title={openingBrowserUids?.has(account.uid) ? "Đang mở Chrome..." : "Mở trình duyệt Profile Chrome"}
                            className={`flex items-center justify-center w-7 h-7 rounded-md border border-[#E2E8F0] bg-white hover:bg-slate-50 text-[#94A3B8] hover:text-[#059669] transition-colors cursor-pointer shadow-2xs ${
                              openingBrowserUids?.has(account.uid) ? "opacity-70 cursor-not-allowed text-[#2563EB]" : ""
                            }`}
                          >
                            {openingBrowserUids?.has(account.uid) ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#2563EB]" />
                            ) : (
                              <Globe className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {/* Nút 4: Xóa tài khoản (Thùng rác) */}
                          <button
                            type="button"
                            onClick={() => onDeleteAccount(account.uid)}
                            title="Xóa tài khoản"
                            className="flex items-center justify-center w-7 h-7 rounded-md border border-[#E2E8F0] bg-white hover:bg-red-50/50 hover:border-[#FECDD3] text-[#94A3B8] hover:text-[#BE123C] transition-colors cursor-pointer shadow-2xs"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Detail Panel Expand */}
                    {expandedUids.has(account.uid) && (
                      <DetailRow
                        account={account}
                        isClosing={closingUids.has(account.uid)}
                        onClose={() => toggleDetail(account.uid)}
                        onClosed={() => handleDetailClosed(account.uid)}
                      />
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
        <div ref={sentinelRef} className="h-1" />
        {isLoadingMore && <p role="status" className="p-3 text-center text-sm text-slate-500">Đang tải thêm...</p>}
        {moreError && <div role="alert" className="p-3 text-center text-sm text-red-600">{moreError} <button type="button" onClick={onRetryMore} className="ml-2 text-blue-600 underline">Thử lại</button></div>}
      </div>
      {isRefreshing && (
        <div className="absolute inset-0 z-20 bg-white/45 backdrop-blur-[1px] flex items-center justify-center transition-opacity">
          <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-xl bg-white/95 shadow-md border border-slate-200 text-xs font-semibold text-slate-700">
            <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
            <span>Đang làm mới dữ liệu...</span>
          </div>
        </div>
      )}
    </div>

      {/* 3. Section - Bottom Action Bar / Concurrent Threads Controller */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 border-t border-[#E2E8F0] bg-[#F8FAFC]/80 text-xs">
        {/* Cụm trái: Đã chọn X trên Y tài khoản */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="basis-full text-sm text-slate-600">Đã tải {accounts.length} / {total} tài khoản</span>
          <span className="w-2 h-2 rounded-full bg-[#2563EB]" />
          <span className="text-[#475569] text-sm">
            Đã chọn{" "}
            <strong className="text-[#2563EB] font-bold">
              {selectedUids.length}
            </strong>{" "}
            trên{" "}
            <strong aria-busy={isLoading} className="text-[#1E293B] font-bold">
              {isLoading ? <span aria-hidden="true" className="inline-block h-4 w-8 align-middle rounded bg-slate-200/70 motion-safe:animate-pulse" /> : loadError ? "--" : accounts.length}
            </strong>{" "}
            tài khoản
          </span>
          <span className="basis-full pl-4 text-[11px] text-[#64748B]">Kéo chuột để chọn dòng · Ctrl/Cmd + kéo để chọn thêm</span>
        </div>

        {/* Cụm phải: Luồng đồng thời & Nút Đăng nhập */}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {/* Thread Selection */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[#E2E8F0] bg-white shadow-2xs">
            <ConcurrentThreadsIcon className="w-4 h-4 shrink-0 text-[#2563EB]" />
            <span className="text-[#475569] font-medium text-xs whitespace-nowrap">
              Luồng đồng thời:
            </span>
            <input
              type="number"
              disabled={isLoading}
              min={1}
              max={maxThreads}
              value={effectiveThreads}
              onChange={(event) =>
                setCustomThreads?.(Math.max(1, Math.min(maxThreads, Number(event.target.value))))
              }
              className="w-12 h-6 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] text-center font-bold text-[#1E293B] text-xs outline-none focus:border-[#2563EB]"
            />
          </div>

          {/* Main Batch Login Action Button */}
          <button
            type="button"
            onClick={handleLogin}
            disabled={isLoading || isLoggingIn || !selectedUids.length}
            className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-semibold text-xs sm:text-sm shadow-[0_2px_4px_-2px_rgba(59,130,246,0.25),0_4px_6px_-1px_rgba(59,130,246,0.25)] transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {isLoggingIn ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <LogIn className="w-4 h-4" />
            )}
            <span>
              {isLoggingIn ? "Đang đăng nhập..." : "Đăng nhập"}
              {selectedUids.length > 0 ? ` (${selectedUids.length})` : ""}
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}
