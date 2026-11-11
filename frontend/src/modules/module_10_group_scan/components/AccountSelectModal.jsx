"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Copy, Loader2, RefreshCw, Search, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import CustomSelect from "@/components/ui/custom-select";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { formatVietnamDateTime } from "@/lib/date-utils";
import { useAccountCategories } from "@/modules/module_02_account_manager/hooks/useAccountCategories";
import { categoryLabelStyle } from "@/modules/module_02_account_manager/components/CategorySelect";
import { farmingDays } from "@/modules/module_02_account_manager/utils/farming-days.mjs";

const AVATAR_COLORS = ["#1877F2", "#0084FF", "#087A62", "#4F46E5", "#0284C7"];

function AccountAvatar({ account, index = 0, size = 32 }) {
  const primaryUrl = account?.avatar_url || account?.avatar || null;
  const graphFallbackUrl = account?.uid
    ? `https://graph.facebook.com/${encodeURIComponent(account.uid)}/picture?type=square&width=80&height=80`
    : null;

  const [currentSrc, setCurrentSrc] = useState(primaryUrl || graphFallbackUrl);

  useEffect(() => {
    setCurrentSrc(primaryUrl || graphFallbackUrl);
  }, [primaryUrl, graphFallbackUrl]);

  const handleImageError = () => {
    if (currentSrc === primaryUrl && graphFallbackUrl && graphFallbackUrl !== primaryUrl) {
      setCurrentSrc(graphFallbackUrl);
    } else {
      setCurrentSrc(null);
    }
  };

  const color = AVATAR_COLORS[index % AVATAR_COLORS.length];
  const initial = (account?.profile_name || account?.name || account?.uid || "FB").trim().charAt(0).toUpperCase();

  return (
    <span
      className="relative rounded-full overflow-hidden flex items-center justify-center shrink-0 font-bold text-white shadow-2xs select-none"
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        fontSize: size >= 32 ? 11 : 10,
      }}
    >
      {currentSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={currentSrc}
          src={currentSrc}
          alt=""
          referrerPolicy="no-referrer"
          onError={handleImageError}
          className="w-full h-full object-cover"
        />
      ) : (
        initial
      )}
    </span>
  );
}

function formatProxy(raw = "") {
  if (!raw) return "—";
  let p = String(raw).trim();
  p = p.replace(/^https?:\/\//i, "");
  if (p.includes("@")) {
    p = p.split("@")[1];
  }
  if (p.length > 15) {
    return p.slice(0, 15) + "....";
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

function getFarmingDays(acc, currentNow) {
  if (currentNow === null) return null;
  const days = farmingDays(acc.first_login_at, currentNow);
  if (days !== null) return days;
  if (acc.nurture_days != null && !isNaN(Number(acc.nurture_days))) {
    return Number(acc.nurture_days);
  }
  return null;
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
  const [now, setNow] = useState(null);

  const [draft, setDraft] = useState(() => new Set(selectedUids));

  // Tải danh mục từ Module 2
  const categoryList = useAccountCategories(open);

  const categoriesById = useMemo(() => {
    const map = new Map();
    (categoryList.categories || []).forEach((item) => {
      map.set(item.id, item);
      map.set(String(item.id), item);
    });
    return map;
  }, [categoryList.categories]);

  const categoryOptions = useMemo(() => {
    const list = [
      { value: "all", label: "Tất cả danh mục" },
      { value: "uncategorized", label: "Chưa gán danh mục" },
    ];
    (categoryList.categories || []).forEach((cat) => {
      list.push({
        value: String(cat.id),
        label: cat.name,
        icon: cat.color ? (
          <span
            className="size-2 rounded-full shrink-0"
            style={{ backgroundColor: cat.color }}
          />
        ) : undefined,
      });
    });
    return list;
  }, [categoryList.categories]);

  const nurtureOptions = useMemo(
    () => [
      { value: "all", label: "Tất cả thời gian nuôi" },
      { value: "under7", label: "Dưới 7 ngày" },
      { value: "7_15", label: "7 - 15 ngày" },
      { value: "15_30", label: "15 - 30 ngày" },
      { value: "over30", label: "Trên 30 ngày" },
      { value: "over60", label: "Trên 60 ngày" },
    ],
    []
  );

  useEffect(() => {
    setNow(Date.now());
  }, []);

  useEffect(() => {
    if (open) {
      setDraft(new Set(selectedUids));
      setNow(Date.now());
    }
  }, [open, selectedUids]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const currentNow = now ?? Date.now();
    return accounts.filter((acc) => {
      const accCategory = acc.category_id != null ? categoriesById.get(acc.category_id) : null;
      const catName = (accCategory?.name || acc.category_name || acc.category || "").toLowerCase();

      if (q) {
        const text = `${acc.profile_name || ""} ${acc.name || ""} ${acc.uid || ""} ${acc.proxy || ""} ${catName}`.toLowerCase();
        if (!text.includes(q)) return false;
      }

      if (categoryFilter !== "all") {
        if (categoryFilter === "uncategorized") {
          if (acc.category_id != null) return false;
        } else {
          if (String(acc.category_id) !== String(categoryFilter)) return false;
        }
      }

      if (nurtureFilter !== "all") {
        const days = getFarmingDays(acc, currentNow);
        if (days === null) return false;
        if (nurtureFilter === "under7" && days >= 7) return false;
        if (nurtureFilter === "7_15" && (days < 7 || days > 15)) return false;
        if (nurtureFilter === "15_30" && (days < 15 || days > 30)) return false;
        if (nurtureFilter === "over30" && days <= 30) return false;
        if (nurtureFilter === "over60" && days <= 60) return false;
      }
      return true;
    });
  }, [accounts, query, categoryFilter, nurtureFilter, categoriesById, now]);

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

  const handleRefresh = async () => {
    categoryList.refresh?.();
    if (onRefresh) {
      await onRefresh();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] h-[85vh] max-w-5xl flex-col gap-0 overflow-hidden p-0 rounded-2xl bg-white border border-slate-200 shadow-2xl">
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
        <div className="flex flex-col sm:flex-row items-center gap-3 px-6 py-3 border-b border-slate-100">
          {/* Search Box */}
          <div className="relative flex-1 w-full">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theo Tên tài khoản, UID, Proxy, Danh mục..."
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-xs sm:text-sm text-slate-700 placeholder:text-slate-400 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Category Dropdown */}
          <CustomSelect
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={categoryOptions}
            size="lg"
            className="w-full sm:w-[190px]"
            buttonClassName="!rounded-xl border-slate-200 text-xs sm:text-sm text-slate-700 bg-white"
            dropdownClassName="!rounded-xl shadow-xl border-slate-200 z-50"
          />

          {/* Nurture Time Dropdown */}
          <CustomSelect
            value={nurtureFilter}
            onChange={setNurtureFilter}
            options={nurtureOptions}
            size="lg"
            className="w-full sm:w-[200px]"
            buttonClassName="!rounded-xl border-slate-200 text-xs sm:text-sm text-slate-700 bg-white"
            dropdownClassName="!rounded-xl shadow-xl border-slate-200 z-50"
          />

          {/* Refresh Button */}
          {onRefresh && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading || categoryList.loading}
              title="Làm mới danh sách tài khoản & danh mục"
              className="h-10 px-3 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 transition-colors flex items-center justify-center shrink-0"
            >
              <RefreshCw className={cn("size-4", (loading || categoryList.isRefreshing) && "animate-spin text-blue-600")} />
            </button>
          )}
        </div>

        {/* SCROLLABLE TABLE CONTENT */}
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto px-6 py-1">
          <table className="w-full min-w-[860px] text-left text-xs sm:text-sm">
            <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_#F1F5F9]">
              <tr className="border-b border-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-400 bg-white">
                <th className="w-12 py-3 pl-2 pr-3 bg-white">
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
                <th className="w-12 py-3 text-slate-400 bg-white">STT</th>
                <th className="py-3 text-slate-500 font-bold bg-white">TÀI KHOẢN & HỌ TÊN</th>
                <th className="py-3 text-slate-500 font-bold bg-white">UID FACEBOOK</th>
                <th className="py-3 text-slate-500 font-bold bg-white">DANH MỤC</th>
                <th className="py-3 text-slate-500 font-bold bg-white">TRẠNG THÁI TK</th>
                <th className="py-3 text-slate-500 font-bold bg-white">ĐĂNG NHẬP</th>
                <th className="py-3 text-slate-500 font-bold bg-white">PROXY GẮN KÈM</th>
                <th className="py-3 pr-3 text-right text-slate-500 font-bold bg-white">THỜI GIAN NUÔI</th>
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
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-sm text-slate-400">
                    Không tìm thấy tài khoản phù hợp với điều kiện lọc.
                  </td>
                </tr>
              ) : (
                filtered.map((acc, idx) => {
                  const stt = String(idx + 1).padStart(2, "0");
                  const ready = isScanReady(acc);
                  const checked = draft.has(acc.uid);
                  const isLive = String(acc.status || "").toLowerCase() === "live";
                  const loginStatus = String(acc.login_status || "").toLowerCase();
                  const isLoggedIn = loginStatus === "logged_in" || loginStatus === "success";

                  // Danh mục từ Module 2
                  const accCategory = acc.category_id != null ? categoriesById.get(acc.category_id) : null;
                  const catName =
                    accCategory?.name ||
                    acc.category_name ||
                    acc.category ||
                    (acc.category_id != null ? `Danh mục #${acc.category_id}` : null);

                  // Thời gian nuôi từ Module 2
                  const days = getFarmingDays(acc, now);

                  return (
                    <tr
                      key={acc.uid || idx}
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
                          <AccountAvatar account={acc} index={idx} size={32} />
                          <span
                            className="font-semibold text-slate-900 text-xs sm:text-sm truncate max-w-[170px]"
                            title={acc.profile_name || acc.name || "Chưa có tên"}
                          >
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
                        {catName ? (
                          <span
                            style={categoryLabelStyle(accCategory)}
                            title={catName}
                            className="inline-block max-w-[160px] truncate whitespace-nowrap rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold"
                          >
                            {catName}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs text-slate-400 bg-slate-50 border border-slate-200/60 font-medium">
                            Chưa gán
                          </span>
                        )}
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
                      <td
                        className="py-3.5 pr-3 text-right text-xs font-medium text-slate-700 tabular-nums"
                        title={
                          acc.first_login_at
                            ? `Bắt đầu nuôi: ${formatVietnamDateTime(acc.first_login_at).full}`
                            : "Chưa ghi nhận ngày bắt đầu nuôi"
                        }
                      >
                        {days === null ? "—" : `${days} ngày`}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* BOTTOM ACTION BAR */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-3.5 border-t border-slate-100 bg-white">
          <p className="text-xs sm:text-sm text-slate-500">
            Hiển thị <span className="font-semibold text-slate-800">{filtered.length}</span> tài khoản
            {filtered.length !== accounts.length && (
              <span className="text-slate-400"> (lọc từ {accounts.length} tài khoản)</span>
            )}
          </p>

          <div className="flex items-center gap-3">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
