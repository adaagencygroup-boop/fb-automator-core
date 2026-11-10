"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Copy, Loader2, Search, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const AVATAR_PALETTE = [
  "bg-[#2563EB]", // Blue (VA)
  "bg-[#6366F1]", // Indigo/Purple (TB)
  "bg-[#0284C7]", // Cyan/Light Blue (LC)
  "bg-[#059669]", // Emerald (PD)
  "bg-[#9333EA]", // Violet/Fuchsia (HM)
  "bg-[#D97706]", // Amber
  "bg-[#E11D48]", // Rose
  "bg-[#0D9488]", // Teal
];

function getAvatarBg(index) {
  return AVATAR_PALETTE[index % AVATAR_PALETTE.length];
}

function initials(name = "") {
  const clean = String(name || "").trim();
  if (!clean || clean === "Chưa có tên" || /^\d+$/.test(clean)) return "FB";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase() || "FB";
}

function formatProxy(raw = "") {
  if (!raw) return "—";
  let p = String(raw).trim();
  p = p.replace(/^https?:\/\//i, "");
  if (p.includes("@")) {
    p = p.split("@")[1];
  }
  // Hiển thị vài ký tự đầu rồi ....
  if (p.length > 10) {
    return p.slice(0, 10) + "....";
  }
  return p || "—";
}

/** Nick đã đăng nhập Module 2. Die thì không cho chọn. */
export function isScanReady(account) {
  const status = String(account.status || "").toLowerCase();
  const login = String(account.login_status || "").toLowerCase();
  if (status === "die") return false;
  return login === "logged_in" || login === "success";
}

export default function AccountSelectModal({
  open,
  onOpenChange,
  accounts = [],
  loading = false,
  selectedUids = [],
  onConfirm,
  onRefresh,
}) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [nurtureFilter, setNurtureFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 5;

  const [draft, setDraft] = useState(() => new Set(selectedUids));

  useEffect(() => {
    if (open) {
      setDraft(new Set(selectedUids));
      setCurrentPage(1);
    }
  }, [open, selectedUids]);

  const categories = useMemo(() => {
    const set = new Set();
    accounts.forEach((acc) => {
      const cat = acc.category || acc.folder || "Folder Nuôi 01";
      if (cat) set.add(cat);
    });
    return Array.from(set).sort();
  }, [accounts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts.filter((acc) => {
      if (q) {
        const text = `${acc.profile_name || ""} ${acc.name || ""} ${acc.uid || ""} ${acc.proxy || ""} ${acc.category || ""}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      if (categoryFilter !== "all") {
        const cat = acc.category || acc.folder || "Folder Nuôi 01";
        if (cat !== categoryFilter) return false;
      }
      if (nurtureFilter !== "all") {
        const days = Number(acc.nurture_days != null ? acc.nurture_days : 30);
        if (nurtureFilter === "under7" && days >= 7) return false;
        if (nurtureFilter === "7_15" && (days < 7 || days > 15)) return false;
        if (nurtureFilter === "15_30" && (days <= 15 || days > 30)) return false;
        if (nurtureFilter === "over30" && days <= 30) return false;
        if (nurtureFilter === "over60" && days <= 60) return false;
      }
      return true;
    });
  }, [accounts, query, categoryFilter, nurtureFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

  // Reset page if filtered results shrink
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [currentPage, totalPages]);

  const startIndex = (currentPage - 1) * pageSize;
  const paginated = useMemo(() => {
    return filtered.slice(startIndex, startIndex + pageSize);
  }, [filtered, startIndex, pageSize]);

  const readyRows = useMemo(() => {
    return filtered.filter(isScanReady);
  }, [filtered]);

  const totalLiveAvailable = useMemo(() => {
    return accounts.filter(isScanReady).length;
  }, [accounts]);

  const allReadyChecked = readyRows.length > 0 && readyRows.every((acc) => draft.has(acc.uid));

  const toggle = (uid, checked, ready) => {
    if (!ready) return;
    setDraft((current) => {
      const next = new Set(current);
      if (checked) next.add(uid);
      else next.delete(uid);
      return next;
    });
  };

  const toggleAllReady = (checked) => {
    setDraft((current) => {
      const next = new Set(current);
      readyRows.forEach((acc) => {
        if (checked) next.add(acc.uid);
        else next.delete(acc.uid);
      });
      return next;
    });
  };

  const handleCopyUid = (uid, e) => {
    e.stopPropagation();
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(uid);
      toast.success(`Đã sao chép UID: ${uid}`);
    }
  };

  // Generate page numbers to display
  const pageNumbers = useMemo(() => {
    const pages = [];
    for (let i = 1; i <= totalPages; i++) {
      pages.push(i);
    }
    return pages;
  }, [totalPages]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-5xl flex-col gap-0 overflow-hidden p-0 rounded-2xl bg-white border border-slate-200 shadow-2xl">
        {/* HEADER */}
        <div className="flex items-start justify-between px-6 pt-5 pb-3 pr-14">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <DialogTitle className="text-lg font-bold text-slate-900 tracking-tight">
                Chọn tài khoản Facebook thực thi quét
              </DialogTitle>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-[#EFF6FF] px-3 py-1 text-xs font-semibold text-[#2563EB] border border-[#BFDBFE]">
                <span className="size-2 rounded-full bg-[#2563EB]" />
                <span>
                  Đã chọn: {draft.size} / {totalLiveAvailable || accounts.length} tài khoản khả dụng
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Chọn các tài khoản có trạng thái Live và sẵn sàng để chạy tác vụ quét nhóm tự động
            </p>
          </div>
        </div>

        {/* FILTER BAR */}
        <div className="flex flex-col sm:flex-row items-center gap-3 px-6 py-3">
          {/* Search Box */}
          <div className="relative flex-1 w-full">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Tìm theo Tên tài khoản, UID, Proxy, Thư mục..."
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-xs sm:text-sm text-slate-700 placeholder:text-slate-400 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Category Dropdown */}
          <div className="relative w-full sm:w-auto">
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="h-10 w-full sm:w-[170px] appearance-none rounded-xl border border-slate-200 bg-white px-3.5 pr-8 text-xs sm:text-sm font-medium text-slate-700 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 cursor-pointer"
            >
              <option value="all">Tất cả danh mục</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          </div>

          {/* Nurture Time Dropdown */}
          <div className="relative w-full sm:w-auto">
            <select
              value={nurtureFilter}
              onChange={(e) => {
                setNurtureFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="h-10 w-full sm:w-[190px] appearance-none rounded-xl border border-slate-200 bg-white px-3.5 pr-8 text-xs sm:text-sm font-medium text-slate-700 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 cursor-pointer"
            >
              <option value="all">Tất cả thời gian nuôi</option>
              <option value="under7">Dưới 7 ngày</option>
              <option value="7_15">7 - 15 ngày</option>
              <option value="15_30">15 - 30 ngày</option>
              <option value="over30">Trên 30 ngày</option>
              <option value="over60">Trên 60 ngày</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          </div>
        </div>

        {/* TABLE CONTENT */}
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto px-6 py-1">
          <table className="w-full min-w-[860px] text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <th className="w-12 py-3 pl-2 pr-3">
                  <Checkbox
                    checked={allReadyChecked}
                    onCheckedChange={(val) => toggleAllReady(Boolean(val))}
                    disabled={!readyRows.length}
                    className={cn(
                      "rounded border-slate-300",
                      allReadyChecked && "bg-[#2563EB] border-[#2563EB] text-white"
                    )}
                  />
                </th>
                <th className="w-12 py-3 text-slate-400">STT</th>
                <th className="py-3 text-slate-500 font-bold">TÀI KHOẢN & HỌ TÊN</th>
                <th className="py-3 text-slate-500 font-bold">UID FACEBOOK</th>
                <th className="py-3 text-slate-500 font-bold">DANH MỤC</th>
                <th className="py-3 text-slate-500 font-bold">TRẠNG THÁI TK</th>
                <th className="py-3 text-slate-500 font-bold">ĐĂNG NHẬP</th>
                <th className="py-3 text-slate-500 font-bold">PROXY GẮN KÈM</th>
                <th className="py-3 pr-2 text-right text-slate-500 font-bold">THỜI GIAN NUÔI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading && accounts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-sm text-slate-500">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="size-4 animate-spin text-blue-600" />
                      <span>Đang tải danh sách tài khoản Module 2...</span>
                    </div>
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-sm text-slate-400">
                    Không tìm thấy tài khoản phù hợp với điều kiện lọc.
                  </td>
                </tr>
              ) : (
                paginated.map((acc, idx) => {
                  const globalIdx = (currentPage - 1) * pageSize + idx;
                  const stt = String(globalIdx + 1).padStart(2, "0");
                  const ready = isScanReady(acc);
                  const checked = draft.has(acc.uid);
                  const isLive = String(acc.status || "").toLowerCase() === "live";
                  const loginStatus = String(acc.login_status || "").toLowerCase();
                  const isLoggedIn = loginStatus === "logged_in" || loginStatus === "success";
                  const nurtureDays = acc.nurture_days != null ? Number(acc.nurture_days) : 30;
                  const avatarBg = getAvatarBg(globalIdx);
                  const userInitials = initials(acc.profile_name || acc.name);

                  return (
                    <tr
                      key={acc.uid || globalIdx}
                      className={cn(
                        "transition-colors",
                        ready ? "hover:bg-slate-50/70 cursor-pointer" : "opacity-60",
                        checked && "bg-blue-50/20"
                      )}
                      onClick={() => ready && toggle(acc.uid, !checked, ready)}
                    >
                      <td className="w-12 py-3.5 pl-2 pr-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={checked}
                          disabled={!ready}
                          onCheckedChange={(val) => toggle(acc.uid, Boolean(val), ready)}
                          className={cn(
                            "rounded border-slate-300",
                            checked && "bg-[#2563EB] border-[#2563EB] text-white"
                          )}
                        />
                      </td>
                      <td className="w-12 py-3.5 text-xs font-medium text-slate-400">
                        {stt}
                      </td>
                      <td className="py-3.5">
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              "size-8 rounded-full flex items-center justify-center font-bold text-xs text-white shrink-0 shadow-2xs",
                              avatarBg
                            )}
                          >
                            {userInitials}
                          </div>
                          <span className="font-semibold text-slate-900 text-xs sm:text-sm truncate max-w-[170px]">
                            {acc.profile_name || acc.name || "Chưa có tên"}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 font-mono text-xs text-slate-600">
                        <div
                          className="flex items-center gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span>{acc.uid}</span>
                          <button
                            type="button"
                            onClick={(e) => handleCopyUid(acc.uid, e)}
                            title="Sao chép UID"
                            className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                          >
                            <Copy className="size-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="py-3.5">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium text-slate-700 bg-slate-100/90 border border-slate-200/60">
                          {acc.category || acc.folder || "Folder Nuôi 01"}
                        </span>
                      </td>
                      <td className="py-3.5">
                        {isLive ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]">
                            <span className="size-1.5 rounded-full bg-[#059669]" />
                            Live
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]">
                            <span className="size-1.5 rounded-full bg-[#DC2626]" />
                            Die
                          </span>
                        )}
                      </td>
                      <td className="py-3.5">
                        {isLoggedIn ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-[#EFF6FF] text-[#2563EB] border border-[#BFDBFE]">
                            <span className="size-1.5 rounded-full bg-[#2563EB]" />
                            Đã đăng nhập
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                            <span className="size-1.5 rounded-full bg-slate-400" />
                            Chưa đăng nhập
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 font-mono text-xs text-slate-600">
                        <span
                          className="inline-block cursor-pointer hover:text-blue-600 transition-colors"
                          title={acc.proxy ? String(acc.proxy) : undefined}
                          onClick={(e) => {
                            if (acc.proxy) {
                              e.stopPropagation();
                              navigator?.clipboard?.writeText?.(String(acc.proxy));
                              toast.success("Đã sao chép Proxy!");
                            }
                          }}
                        >
                          {formatProxy(acc.proxy)}
                        </span>
                      </td>
                      <td className="py-3.5 pr-2 text-right text-xs font-medium text-slate-700">
                        {nurtureDays ? `${nurtureDays} ngày` : "30 ngày"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* PAGINATION BAR */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-3 border-t border-slate-100 bg-white">
          <p className="text-xs sm:text-sm text-slate-500">
            Hiển thị {filtered.length === 0 ? 0 : startIndex + 1} - {Math.min(startIndex + pageSize, filtered.length)} của {filtered.length} tài khoản
          </p>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-500 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Trước
            </button>

            {pageNumbers.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setCurrentPage(p)}
                className={cn(
                  "w-8 h-8 flex items-center justify-center text-xs font-bold rounded-lg transition-colors",
                  p === currentPage
                    ? "bg-[#2563EB] text-white shadow-2xs"
                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 font-medium"
                )}
              >
                {p}
              </button>
            ))}

            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Sau
            </button>
          </div>
        </div>

        {/* BOTTOM ACTION BAR */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-white">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-10 px-5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs"
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm([...draft]);
              onOpenChange(false);
            }}
            className="h-10 px-5 rounded-xl bg-[#0052CC] hover:bg-blue-700 text-sm font-bold text-white transition-colors flex items-center gap-2 shadow-sm"
          >
            <Check className="size-4" strokeWidth={2.5} />
            <span>Xác nhận chọn ({draft.size} tài khoản)</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
