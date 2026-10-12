"use client";

import React, { useEffect, useMemo, useState } from "react";
import AccountDetailPanel from "./AccountDetailPanel";
import CustomSelect from "@/components/ui/custom-select";
import Pagination from "@/components/ui/pagination";
import { Badge } from "@/components/ui/badge";
import { Check, Copy, Edit3, Eye, EyeOff, Globe, Loader2, Search, ShieldCheck, Trash2 } from "lucide-react";
import { formatVietnamDateTime } from "@/lib/date-utils";

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
    <tr className="bg-slate-50/40">
      <td
        colSpan={8}
        className={`p-0 overflow-hidden transition-[border-color] ${
          show
            ? "border-b border-border duration-[240ms]"
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
  selectedUids = [],
  onToggleSelect,
  onSelectAll,
  onEditAccount,
  onDeleteAccount,
  onOpenBrowser,
  onBulkDelete,
  onRefresh,
  isCheckingStatus = false,
  openingBrowserUids,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const [loginFilter, setLoginFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [expandedUids, setExpandedUids] = useState(new Set());
  const [closingUids, setClosingUids] = useState(new Set());
  const [copiedUid, setCopiedUid] = useState(null);

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

  const filteredAccounts = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    return accounts.filter((account) => {
      const matchesSearch =
        !search ||
        account.uid.toLowerCase().includes(search) ||
        account.profile_name?.toLowerCase().includes(search) ||
        account.email?.toLowerCase().includes(search);
      const normalizedStatus = account.status;
      const loginStatus = account.login_status || "not_logged_in";
      return (
        matchesSearch &&
        (accountFilter === "all" || normalizedStatus === accountFilter) &&
        (loginFilter === "all" || loginStatus === loginFilter)
      );
    });
  }, [accounts, searchTerm, accountFilter, loginFilter]);

  const handleSearchChange = (event) => {
    setSearchTerm(event.target.value);
    setCurrentPage(1);
  };

  const handleAccountFilterChange = (val) => {
    setAccountFilter(val);
    setCurrentPage(1);
  };

  const handleLoginFilterChange = (val) => {
    setLoginFilter(val);
    setCurrentPage(1);
  };

  const totalItems = filteredAccounts.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize) || 1);
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const currentAccounts = filteredAccounts.slice(startIndex, startIndex + pageSize);

  const isAllSelected =
    currentAccounts.length > 0 &&
    currentAccounts.every((account) => selectedUids.includes(account.uid));

  return (
    <section className="w-full flex flex-col gap-4 p-5 rounded-xl bg-card border border-border shadow-card select-none">
      {/* 1. Filter Bar */}
      <div className="flex flex-col sm:flex-row flex-wrap xl:flex-nowrap items-stretch sm:items-center gap-3 w-full">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[200px] w-full sm:w-auto">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={handleSearchChange}
            placeholder="Tìm kiếm theo UID, Tên tài khoản, Email..."
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-white border border-border text-slate-800 placeholder-slate-400 text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-subtle transition-colors"
          />
        </div>

        {/* Account Status Filter Dropdown */}
        <div className="w-full sm:w-44 shrink-0">
          <CustomSelect
            value={accountFilter}
            onChange={handleAccountFilterChange}
            options={accountFilterOptions}
            className="w-full"
          />
        </div>

        {/* Login Status Filter Dropdown */}
        <div className="w-full sm:w-44 shrink-0">
          <CustomSelect
            value={loginFilter}
            onChange={handleLoginFilterChange}
            options={loginFilterOptions}
            className="w-full"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto shrink-0">
          {/* Check Status Button */}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isCheckingStatus || selectedUids.length === 0}
            className="flex-1 sm:flex-initial flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-3.5 text-xs font-semibold text-emerald-700 transition disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer shadow-subtle"
            title="Kiểm tra trạng thái Live/Die của các tài khoản đã chọn"
          >
            <ShieldCheck className={`w-4 h-4 ${isCheckingStatus ? "animate-spin" : ""}`} />
            <span>{isCheckingStatus ? "Đang kiểm tra..." : "Check trạng thái"}{selectedUids.length > 0 ? ` (${selectedUids.length})` : ""}</span>
          </button>

          {/* Bulk Delete Button */}
          <button
            type="button"
            onClick={onBulkDelete}
            disabled={selectedUids.length === 0}
            className="flex-1 sm:flex-initial flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 px-3.5 text-xs font-semibold text-red-700 transition disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer shadow-subtle"
            title="Xóa các tài khoản đã chọn"
          >
            <Trash2 className="w-4 h-4" />
            <span>Xóa {selectedUids.length > 0 ? `(${selectedUids.length})` : ""}</span>
          </button>
        </div>
      </div>

      {/* 2. Table Area */}
      <div className="w-full rounded-xl border border-border overflow-hidden bg-white shadow-subtle">
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[840px]">
            <thead>
              <tr className="h-10 bg-slate-50/80 border-b border-border">
                <th className="w-10 px-2.5 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={() => onSelectAll(currentAccounts.map((a) => a.uid))}
                    className="h-4 w-4 rounded accent-primary cursor-pointer"
                  />
                </th>
                <th className="w-12 px-2 py-2 font-semibold text-[11px] uppercase tracking-wider text-slate-500">
                  STT
                </th>
                <th className="w-36 px-2.5 py-2 font-semibold text-[11px] uppercase tracking-wider text-slate-500">
                  UID
                </th>
                <th className="px-3 py-2 font-semibold text-[11px] uppercase tracking-wider text-slate-500">
                  TÊN TÀI KHOẢN
                </th>
                <th className="w-36 px-2.5 py-2 font-semibold text-[11px] uppercase tracking-wider text-slate-500 text-center whitespace-nowrap">
                  TRẠNG THÁI TK
                </th>
                <th className="w-36 px-2.5 py-2 font-semibold text-[11px] uppercase tracking-wider text-slate-500 text-center whitespace-nowrap">
                  ĐĂNG NHẬP
                </th>
                <th className="w-32 px-2.5 py-2 font-semibold text-[11px] uppercase tracking-wider text-slate-500">
                  LAST LOGIN
                </th>
                <th className="w-36 px-2.5 py-2 font-semibold text-[11px] uppercase tracking-wider text-slate-500 text-center">
                  HÀNH ĐỘNG
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredAccounts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center gap-2 max-w-sm mx-auto">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400">
                        <Search className="w-5 h-5" />
                      </div>
                      <p className="text-slate-800 font-semibold text-sm">
                        {accounts.length === 0 ? "Chưa có tài khoản Facebook nào" : "Không tìm thấy tài khoản phù hợp"}
                      </p>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        {accounts.length === 0
                          ? "Vui lòng bấm 'Thêm một tài khoản' hoặc 'Thêm nhiều tài khoản' để lưu tài khoản vào hệ thống."
                          : "Vui lòng thử tìm kiếm bằng từ khóa khác hoặc điều chỉnh lại bộ lọc trạng thái."}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                currentAccounts.map((account, index) => {
                  const initial = (account.profile_name || account.uid).trim().charAt(0).toUpperCase();

                  return (
                    <React.Fragment key={account.uid}>
                      <tr
                        className={`h-14 transition-colors hover:bg-slate-50/80 ${
                          selectedUids.includes(account.uid) ? "bg-blue-50/50" : ""
                        }`}
                      >
                        {/* 1. Checkbox */}
                        <td className="px-2.5 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={selectedUids.includes(account.uid)}
                            onChange={() => onToggleSelect(account.uid)}
                            className="h-4 w-4 rounded accent-primary cursor-pointer"
                          />
                        </td>

                        {/* 2. STT */}
                        <td className="px-2 py-2 font-mono text-slate-400 font-medium">
                          {startIndex + index + 1}
                        </td>

                        {/* 3. UID */}
                        <td className="px-2.5 py-2">
                          <div className="flex items-center gap-1 max-w-[140px]">
                            <span
                              className="font-bold text-primary font-mono truncate"
                              title={account.uid}
                            >
                              {account.uid}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopyUid(account.uid)}
                              className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer shrink-0"
                              title="Sao chép UID"
                            >
                              {copiedUid === account.uid ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </td>

                        {/* 4. Tên tài khoản */}
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2.5">
                            <span
                              className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-bold text-[11px] text-white shadow-sm"
                              style={{ backgroundColor: avatarColors[index % avatarColors.length] }}
                            >
                              {initial}
                            </span>
                            <div className="flex flex-col justify-center min-w-0">
                              <span
                                className="font-semibold text-slate-800 truncate max-w-[200px]"
                                title={account.profile_name || "Chưa cập nhật"}
                              >
                                {account.profile_name || "Chưa cập nhật"}
                              </span>
                              {account.email && (
                                <span
                                  className="text-[11px] text-slate-500 truncate max-w-[200px]"
                                  title={account.email}
                                >
                                  {account.email}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* 5. Trạng thái tài khoản */}
                        <td className="px-2.5 py-2 text-center whitespace-nowrap">
                          {account.status === "live" ? (
                            <Badge variant="success">LIVE</Badge>
                          ) : account.status === "die" ? (
                            <Badge variant="destructive">DIE</Badge>
                          ) : (
                            <span className="text-slate-400 text-xs">--</span>
                          )}
                        </td>

                        {/* 6. Trạng thái đăng nhập */}
                        <td className="px-2.5 py-2 text-center whitespace-nowrap">
                          {account.login_status === "logged_in" ? (
                            <Badge variant="success">Đã đăng nhập</Badge>
                          ) : account.login_status === "failed" ? (
                            <Badge variant="destructive">Đăng nhập lỗi</Badge>
                          ) : (
                            <Badge variant="secondary">Chưa đăng nhập</Badge>
                          )}
                        </td>

                        {/* 7. Last login */}
                        <td className="px-2.5 py-2">
                          {account.last_login_at ? (
                            (() => {
                              const { time, date } = formatVietnamDateTime(account.last_login_at);
                              if (time === "--:--") return <span className="text-slate-400 text-xs">--</span>;
                              return (
                                <div className="flex flex-col">
                                  <span className="font-semibold text-slate-700 font-mono text-[11px]">
                                    {time}
                                  </span>
                                  <span className="text-[10px] text-slate-400">
                                    {date}
                                  </span>
                                </div>
                              );
                            })()
                          ) : (
                            <span className="text-slate-400 text-xs">--</span>
                          )}
                        </td>

                        {/* 8. Hành động */}
                        <td className="px-2.5 py-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => toggleDetail(account.uid)}
                              aria-expanded={expandedUids.has(account.uid) && !closingUids.has(account.uid)}
                              title={expandedUids.has(account.uid) && !closingUids.has(account.uid) ? "Đóng chi tiết" : "Xem chi tiết 11 trường"}
                              className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors border cursor-pointer ${
                                expandedUids.has(account.uid) && !closingUids.has(account.uid)
                                  ? "bg-primary-subtle border-blue-200 text-primary"
                                  : "border-border bg-white hover:bg-slate-50 text-slate-600 hover:text-primary"
                              }`}
                            >
                              {expandedUids.has(account.uid) && !closingUids.has(account.uid) ? (
                                <EyeOff className="w-3.5 h-3.5" />
                              ) : (
                                <Eye className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => onEditAccount(account.uid)}
                              title="Chỉnh sửa thông tin"
                              className="flex items-center justify-center w-7 h-7 rounded-md border border-border bg-white hover:bg-slate-50 text-slate-600 hover:text-primary transition-colors cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onOpenBrowser(account.uid)}
                              disabled={openingBrowserUids?.has(account.uid)}
                              title={openingBrowserUids?.has(account.uid) ? "Đang mở Chrome..." : "Mở trình duyệt Profile Chrome"}
                              className={`flex items-center justify-center w-7 h-7 rounded-md border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition-colors cursor-pointer ${
                                openingBrowserUids?.has(account.uid) ? "opacity-70 cursor-not-allowed" : ""
                              }`}
                            >
                              {openingBrowserUids?.has(account.uid) ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Globe className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteAccount(account.uid)}
                              title="Xóa tài khoản"
                              className="flex items-center justify-center w-7 h-7 rounded-md border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 transition-colors cursor-pointer"
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
        </div>
      </div>

      {/* 3. Table Footer & Pagination */}
      <div className="w-full flex flex-col md:flex-row justify-between items-center gap-3 pt-1 select-none text-xs">
        {/* Left: Summary & Page Size selector */}
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-slate-500">
          <span>
            Đang hiển thị{" "}
            <strong className="text-slate-800">
              {totalItems > 0 ? startIndex + 1 : 0}-{Math.min(startIndex + pageSize, totalItems)}
            </strong>{" "}
            trong số <strong className="text-slate-800">{totalItems}</strong> kết quả
          </span>
          <span>· Xem:</span>
          <CustomSelect
            size="sm"
            direction="up"
            value={pageSize}
            onChange={(val) => {
              setPageSize(Number(val));
              setCurrentPage(1);
            }}
            options={[
              { value: 10, label: "10 / trang" },
              { value: 20, label: "20 / trang" },
              { value: 50, label: "50 / trang" },
              { value: 100, label: "100 / trang" },
            ]}
            className="w-28"
          />
        </div>

        {/* Right: Pagination Navigation buttons */}
        <div className="flex items-center justify-center overflow-x-auto max-w-full">
          <Pagination
            currentPage={safeCurrentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        </div>
      </div>
    </section>
  );
}
