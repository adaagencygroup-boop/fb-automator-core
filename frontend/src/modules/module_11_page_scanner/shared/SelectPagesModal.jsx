"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  X,
  Check,
  Copy,
  Loader2,
  ExternalLink,
  Download,
  Trash2,
  FolderCog,
  Folder,
  FolderPlus,
  Plus,
  SlidersHorizontal,
  Phone,
  MapPin,
  CheckCircle2,
  FolderSync,
  FileSpreadsheet,
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  Tag,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "@/lib/toast";
import { askConfirm } from "./askConfirm";
import { getCategories } from "@/modules/module_02_account_manager/service";
import useDragRowSelect from "./useDragRowSelect";
import { attachDragSelection } from "@/modules/module_02_account_manager/utils/drag-selection.mjs";
import { AVATAR_COLORS } from "@/modules/module_07_group_spam/shared/constants";
import {
  deletePageFollowers,
  getPageFollowers,
  getPagesWithFollowers,
  getScannedPages,
  getSearchKeywords,
} from "../service";
import { Pager, notifyExportResult } from "../_shared";
import { useActionLock } from "./useActionLock";
import { saveCsvContent } from "./saveFile.mjs";

const fmtNum = (n) => Number(n || 0).toLocaleString("vi-VN");

function initialsOf(name = "") {
  return (
    String(name)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(-2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "FB"
  );
}

function formatPhoneDisplay(p) {
  if (!p) return "";
  const cleaned = String(p).trim();
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length === 10) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 11) {
    return `${digits.slice(0, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  }
  return cleaned;
}

/** Giờ:phút:giây của mốc thời gian (bảng UID theo thiết kế chỉ hiện giờ). */
function clockOf(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("vi-VN", { hour12: false });
}

/** Số ngày nuôi tính từ lần đăng nhập đầu tiên (null nếu chưa từng đăng nhập). */
function farmDays(acc) {
  const t = Date.parse(acc?.first_login_at || "");
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

const LOGIN_META = {
  logged_in: { label: "Đã đăng nhập", box: "border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]", dot: "bg-[#2563EB]" },
  failed: { label: "Lỗi đăng nhập", box: "border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]", dot: "bg-[#EF4444]" },
};
const LOGIN_DEFAULT = { label: "Chưa đăng nhập", box: "border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B]", dot: "bg-[#94A3B8]" };

const STATUS_META = {
  LIVE: { label: "Live", box: "border-[#A7F3D0] bg-[#ECFDF5] text-[#059669]", dot: "bg-[#10B981]" },
  DIE: { label: "Die", box: "border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]", dot: "bg-[#EF4444]" },
};
const STATUS_DEFAULT = { label: "Chưa kiểm tra", box: "border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B]", dot: "bg-[#94A3B8]" };

/** Nick dùng được để quét: trạng thái Live VÀ đã đăng nhập ở Module 2. */
export function isAccountUsable(acc) {
  if (!acc) return false;
  const status = String(acc.status || "").trim().toUpperCase();
  const login = String(acc.login_status || "").trim().toLowerCase();
  const isLive = status === "LIVE";
  const isLoggedIn = login === "logged_in" || login === "success";
  return isLive && isLoggedIn;
}

export function getAccountDisabledReason(acc) {
  if (!acc) return "";
  const status = String(acc.status || "").trim().toUpperCase();
  const login = String(acc.login_status || "").trim().toLowerCase();
  const isLive = status === "LIVE";
  const isLoggedIn = login === "logged_in" || login === "success";

  if (!isLive && !isLoggedIn) {
    return "Tài khoản đã Die và chưa đăng nhập — không thể chọn để quét";
  }
  if (!isLive) {
    return "Tài khoản đã Die — không thể chọn để quét";
  }
  if (!isLoggedIn) {
    return login === "failed"
      ? "Tài khoản bị lỗi đăng nhập — không thể chọn để quét"
      : "Tài khoản chưa đăng nhập — không thể chọn để quét";
  }
  return "";
}

/* ─── Modal: Chọn tài khoản Facebook thực thi quét (ảnh 2) ─── */
export function SelectAccountsModal({
  open,
  onClose,
  accounts = [],
  loading = false,
  selectedUids = [],
  onConfirm,
}) {
  const [draftUids, setDraftUids] = useState(selectedUids);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("ALL");
  const [farmTime, setFarmTime] = useState("ALL");
  const [page, setPage] = useState(1);
  const [categoriesById, setCategoriesById] = useState({});
  const [isCopyingUid, guardCopyUid] = useActionLock();
  const pageSize = 5;

  const usableAccounts = useMemo(() => accounts.filter(isAccountUsable), [accounts]);
  const usableUids = useMemo(() => new Set(usableAccounts.map((a) => a.uid)), [usableAccounts]);
  const selectedUsableCount = useMemo(
    () => draftUids.filter((uid) => usableUids.has(uid)).length,
    [draftUids, usableUids],
  );

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      const initialUsableSet = new Set(accounts.filter(isAccountUsable).map((a) => a.uid));
      setDraftUids((selectedUids || []).filter((uid) => initialUsableSet.has(uid)));
      setPage(1);
    }
  }

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    getCategories()
      .then((rows) => {
        if (!cancelled) setCategoriesById(Object.fromEntries((rows || []).map((r) => [String(r.id), r])));
      })
      .catch(() => {
        if (!cancelled) setCategoriesById({});
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const categoryName = useCallback(
    (acc) =>
      acc.category_id == null
        ? "Chưa gán"
        : categoriesById[String(acc.category_id)]?.name || `Danh mục #${acc.category_id}`,
    [categoriesById],
  );

  const categoryOptions = useMemo(() => {
    const ids = new Set(accounts.map((a) => (a.category_id == null ? "NONE" : String(a.category_id))));
    return [...ids].map((id) => ({
      id,
      name: id === "NONE" ? "Chưa gán" : categoriesById[id]?.name || `Danh mục #${id}`,
    }));
  }, [accounts, categoriesById]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((acc) => {
      const cid = acc.category_id == null ? "NONE" : String(acc.category_id);
      if (category !== "ALL" && cid !== category) return false;
      if (farmTime !== "ALL") {
        const days = farmDays(acc);
        if (days == null || days < (farmTime === "1Y" ? 365 : 180)) return false;
      }
      if (q) {
        const hay = `${acc.name || ""} ${acc.uid || ""} ${acc.proxy || ""} ${categoryName(acc)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [accounts, category, farmTime, search, categoryName]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedAccounts = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const filteredUsable = useMemo(() => filtered.filter(isAccountUsable), [filtered]);
  const filteredUsableIds = useMemo(() => filteredUsable.map((a) => a.uid), [filteredUsable]);
  const allFilteredChecked =
    filteredUsableIds.length > 0 &&
    filteredUsableIds.every((uid) => draftUids.includes(uid));

  const scrollRef = useRef(null);
  const selectionRef = useRef(new Set(draftUids));
  const visibleUidsRef = useRef([]);
  const availableUidsRef = useRef([]);
  const lastClickedIdxRef = useRef(null);

  useLayoutEffect(() => {
    selectionRef.current = new Set(draftUids);
    visibleUidsRef.current = pagedAccounts.filter(isAccountUsable).map((a) => a.uid);
    availableUidsRef.current = accounts.filter(isAccountUsable).map((a) => a.uid);
  }, [draftUids, pagedAccounts, accounts]);

  // Tích hợp thao tác kéo chọn tài khoản (drag to select) chuẩn xác như Module 03
  useEffect(() => {
    if (!open || !scrollRef.current) return;
    return attachDragSelection(scrollRef.current, {
      getVisibleUids: () => visibleUidsRef.current,
      getAvailableUids: () => availableUidsRef.current,
      getSelectedUids: () => [...selectionRef.current],
      onSelectionChange: (uids) => {
        const available = new Set(availableUidsRef.current);
        const next = uids.filter((uid) => available.has(uid));
        selectionRef.current = new Set(next);
        setDraftUids(next);
      },
    });
  }, [open]);

  const handleRowClick = (acc, idx, e) => {
    if (e.target.closest("button") || e.target.closest("a") || e.target.closest("input")) return;
    if (!isAccountUsable(acc)) return;

    // Shift + Click chọn dải liên tiếp
    if (e.shiftKey && lastClickedIdxRef.current !== null) {
      e.preventDefault();
      const start = Math.min(lastClickedIdxRef.current, idx);
      const end = Math.max(lastClickedIdxRef.current, idx);
      const inRangeUsableUids = pagedAccounts
        .slice(start, end + 1)
        .filter(isAccountUsable)
        .map((a) => a.uid);
      setDraftUids((prev) => [...new Set([...prev, ...inRangeUsableUids])]);
      return;
    }

    lastClickedIdxRef.current = idx;
    const isCurrentlyChecked = draftUids.includes(acc.uid);
    setDraftUids((prev) =>
      isCurrentlyChecked ? prev.filter((u) => u !== acc.uid) : [...new Set([...prev, acc.uid])]
    );
  };

  if (!open) return null;

  const toggle = (uid, checked) => {
    if (!usableUids.has(uid)) return;
    setDraftUids((prev) => (checked ? [...new Set([...prev, uid])] : prev.filter((u) => u !== uid)));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1px]">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#F1F5F9] px-6 py-5">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="font-heading text-lg font-bold text-[#0F172A]">Chọn tài khoản Facebook thực thi quét</h2>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-0.5 text-xs font-semibold text-[#1D4ED8]">
                <span className="size-1.5 rounded-full bg-[#2563EB]" />
                Đã chọn: {selectedUsableCount} / {usableAccounts.length} tài khoản khả dụng
              </span>
            </div>
            <p className="mt-1 text-xs text-[#64748B]">
              Chọn các tài khoản có trạng thái Live và sẵn sàng để chạy tác vụ quét page tự động
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-[#64748B] hover:bg-[#F1F5F9]" aria-label="Đóng">
            <X className="size-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 px-6 py-4">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[#94A3B8]" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Tìm theo Tên tài khoản, UID, Proxy, Thư mục..."
              className="h-10 w-full rounded-xl border border-[#E2E8F0] bg-white pr-4 pl-10 text-xs text-[#0F172A] outline-none focus:border-[#1877F2]"
            />
          </div>
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            className="h-10 min-w-[170px] rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs font-medium text-[#334155] outline-none"
          >
            <option value="ALL">Tất cả danh mục</option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={farmTime}
            onChange={(e) => {
              setFarmTime(e.target.value);
              setPage(1);
            }}
            className="h-10 min-w-[170px] rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs font-medium text-[#334155] outline-none"
          >
            <option value="ALL">Tất cả thời gian nuôi</option>
            <option value="6M">Trên 6 tháng</option>
            <option value="1Y">Trên 1 năm</option>
          </select>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-auto border-t border-[#F1F5F9] custom-scrollbar">
          {loading ? (
            <div className="py-12 text-center text-xs text-[#64748B]">
              <Loader2 className="mx-auto mb-2 size-6 animate-spin text-[#1877F2]" />
              Đang tải danh sách tài khoản...
            </div>
          ) : (
            <table onDragStart={(e) => e.preventDefault()} className="w-full min-w-[840px] text-left text-xs select-none">
              <thead className="sticky top-0 z-10 bg-[#F8FAFC] text-[11px] font-bold text-[#475569] uppercase">
                <tr className="border-b border-[#E2E8F0]">
                  <th className="w-12 px-6 py-3.5">
                    <Checkbox
                      checked={allFilteredChecked}
                      disabled={filteredUsableIds.length === 0}
                      onCheckedChange={(c) => {
                        setDraftUids((prev) =>
                          c
                            ? [...new Set([...prev, ...filteredUsableIds])]
                            : prev.filter((u) => !filteredUsableIds.includes(u)),
                        );
                      }}
                      title={
                        filteredUsableIds.length === 0
                          ? "Không có tài khoản khả dụng nào trong trang hiện tại"
                          : "Chọn tất cả tài khoản khả dụng"
                      }
                    />
                  </th>
                  <th className="w-12 px-2 py-3.5">STT</th>
                  <th className="px-3 py-3.5">Tài khoản &amp; Họ tên</th>
                  <th className="px-3 py-3.5">UID Facebook</th>
                  <th className="px-3 py-3.5">Danh mục</th>
                  <th className="px-3 py-3.5">Trạng thái TK</th>
                  <th className="px-3 py-3.5">Đăng nhập</th>
                  <th className="px-3 py-3.5">Proxy gán kèm</th>
                  <th className="px-6 py-3.5 text-right">Thời gian nuôi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {pagedAccounts.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-10 text-center text-[#94A3B8]">
                      Không có tài khoản phù hợp.
                    </td>
                  </tr>
                ) : (
                  pagedAccounts.map((acc, idx) => {
                    const realIdx = (safePage - 1) * pageSize + idx;
                    const isUsable = isAccountUsable(acc);
                    const checked = isUsable && draftUids.includes(acc.uid);
                    const status = STATUS_META[String(acc.status).toUpperCase()] || STATUS_DEFAULT;
                    const login = LOGIN_META[acc.login_status] || LOGIN_DEFAULT;
                    const days = farmDays(acc);
                    const disabledReason = !isUsable ? getAccountDisabledReason(acc) : "";

                    return (
                      <tr
                        key={acc.uid}
                        data-account-uid={acc.uid}
                        onClick={(e) => handleRowClick(acc, idx, e)}
                        title={disabledReason || undefined}
                        className={`transition select-none ${
                          !isUsable
                            ? "opacity-50 bg-slate-50/70 cursor-not-allowed"
                            : checked
                            ? "cursor-pointer bg-[#EFF6FF]/70 hover:bg-[#EFF6FF]"
                            : "cursor-pointer hover:bg-[#F8FAFC]"
                        }`}
                      >
                        <td
                          className="px-6 py-3.5"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={checked}
                            disabled={!isUsable}
                            onCheckedChange={(c) => {
                              if (isUsable) toggle(acc.uid, !!c);
                            }}
                            className={!isUsable ? "opacity-50 cursor-not-allowed pointer-events-none" : ""}
                            title={disabledReason || undefined}
                          />
                        </td>
                        <td className="px-2 py-3.5 font-mono text-[#94A3B8]">{String(realIdx + 1).padStart(2, "0")}</td>
                        <td className="px-3 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <Avatar className={`size-9 ${!isUsable ? "grayscale" : ""}`}>
                              {acc.avatar_url ? <AvatarImage src={acc.avatar_url} alt="" /> : null}
                              <AvatarFallback className={`font-bold text-white ${AVATAR_COLORS[realIdx % AVATAR_COLORS.length]}`}>
                                {initialsOf(acc.name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="max-w-[150px] font-bold leading-snug text-[#0F172A]">{acc.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3.5 font-mono text-[#334155]">
                          <div className="inline-flex items-center gap-1.5">
                            <span>{acc.uid}</span>
                            <button
                              type="button"
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                guardCopyUid(async () => {
                                  try {
                                    await navigator.clipboard?.writeText(acc.uid);
                                    toast.success(`Đã sao chép UID ${acc.uid}`, { key: "m11-modal-acc-copy" });
                                  } catch {
                                    toast.error("Không sao chép được UID", { key: "m11-modal-acc-copy" });
                                  }
                                });
                              }}
                              disabled={isCopyingUid}
                              className="text-[#94A3B8] hover:text-[#1877F2] disabled:cursor-not-allowed disabled:opacity-40"
                              aria-label="Sao chép UID"
                            >
                              <Copy className="size-3" />
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-3.5">
                          <span className="inline-block max-w-[120px] truncate rounded-md border border-[#E2E8F0] bg-[#F1F5F9] px-2 py-1 text-[11px] text-[#475569]" title={categoryName(acc)}>
                            {categoryName(acc)}
                          </span>
                        </td>
                        <td className="px-3 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${status.box}`}>
                            <span className={`size-1.5 rounded-full ${status.dot}`} />
                            {status.label}
                          </span>
                        </td>
                        <td className="px-3 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${login.box}`}>
                            <span className={`size-1.5 rounded-full ${login.dot}`} />
                            {login.label}
                          </span>
                        </td>
                        <td className="px-3 py-3.5 font-mono text-[11px] text-[#475569]">{acc.proxy || "Không dùng proxy"}</td>
                        <td className="px-6 py-3.5 text-right font-bold text-[#334155]">{days == null ? "—" : `${days} ngày`}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#F1F5F9] bg-[#F8FAFC] px-6 py-3 text-xs text-[#64748B]">
          <span>
            Hiển thị {filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1} - {Math.min(safePage * pageSize, filtered.length)} của{" "}
            {filtered.length} tài khoản
            {accounts.length > usableAccounts.length && (
              <span className="text-slate-400">
                {" "}· Có {accounts.length - usableAccounts.length} tài khoản không khả dụng (chưa đăng nhập / Die)
              </span>
            )}
          </span>
          <Pager page={safePage} totalPages={totalPages} onChange={setPage} variant="text" />
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[#F1F5F9] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border border-[#CBD5E1] bg-white px-6 text-sm font-semibold text-[#334155] hover:bg-[#F1F5F9]"
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            onClick={() => {
              const finalUids = draftUids.filter((uid) => usableUids.has(uid));
              if (finalUids.length === 0 && usableAccounts.length > 0) {
                toast.warning("Vui lòng chọn ít nhất 1 tài khoản khả dụng để thực thi quét.");
                return;
              }
              onConfirm(finalUids);
              onClose();
              if (finalUids.length > 0) {
                toast.success(`Đã chọn ${finalUids.length} tài khoản thực thi.`);
              }
            }}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#1D4ED8] px-6 text-sm font-semibold text-white shadow-sm hover:bg-[#1E40AF]"
          >
            <Check className="size-4" />
            Xác nhận chọn ({selectedUsableCount} tài khoản)
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Modal: Chọn page từ danh mục đã quét (giao diện danh mục theo từ khóa/tag) ─── */
export const NO_TAG_KEY = "__NO_TAG__";
export const ALL_TAGS_KEY = "__ALL__";

const BADGE_COLOR_PALETTE = [
  "bg-[#2563EB]", // Blue (LE)
  "bg-[#D97706]", // Orange (BDS)
  "bg-[#B45309]", // Brown/Orange (TH)
  "bg-[#DB2777]", // Pink/Magenta (BG)
  "bg-[#0F172A]", // Slate/Black (AF)
  "bg-[#059669]", // Emerald (NT)
  "bg-[#7C3AED]", // Violet
];

function getPageBadgeText(name) {
  if (!name) return "FB";
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  if (words.length === 2) return (words[0][0] + words[1][0]).toUpperCase();
  return words.slice(0, 3).map((w) => w[0]).join("").toUpperCase();
}

/**
 * Trích xuất từ khóa (tag) của page:
 * - matched_hashtags (hashtag khớp khi quét)
 * - source_keywords (từ khóa chiến dịch quét tìm thấy page)
 * Tuyệt đối KHÔNG lấy category từ Facebook hay bất kỳ nguồn nào khác.
 */
export function extractPageTags(page) {
  const tags = [];
  const seen = new Set();
  const add = (t) => {
    if (!t) return;
    const clean = String(t).trim().replace(/^#+/, "");
    if (!clean) return;
    const key = clean.toLowerCase();
    if (key === "fanpage") return;
    if (seen.has(key)) return;
    seen.add(key);
    tags.push(clean);
  };

  // 1. Hashtag khớp khi quét bài viết / page
  const mh = page?.matched_hashtags;
  if (Array.isArray(mh)) {
    mh.forEach(add);
  } else if (typeof mh === "string" && mh.trim()) {
    try {
      const parsed = JSON.parse(mh);
      if (Array.isArray(parsed)) parsed.forEach(add);
      else mh.split(/[,;|]/).forEach(add);
    } catch {
      mh.split(/[,;|]/).forEach(add);
    }
  }

  // 2. Từ khóa tìm kiếm trong chiến dịch quét (source_keywords)
  if (Array.isArray(page?.source_keywords)) {
    page.source_keywords.forEach(add);
  }

  return tags;
}

export function SelectPagesModal({ open, onClose, selectedPages = [], onConfirm }) {
  const [allPages, setAllPages] = useState([]);
  const [loadingPages, setLoadingPages] = useState(false);
  const [draftKeys, setDraftKeys] = useState([]);
  const [activeCategory, setActiveCategory] = useState("");
  const [customCategories, setCustomCategories] = useState([]);
  const [categorySearch, setCategorySearch] = useState("");
  const [pageSearch, setPageSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [locationFilter, setLocationFilter] = useState("ALL");
  const [pageSize, setPageSize] = useState(15);
  const [currentPage, setCurrentPage] = useState(1);
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [isExporting, guardExport] = useActionLock();

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setDraftKeys(selectedPages.map((p) => p.page_key));
      setCategorySearch("");
      setPageSearch("");
      setStatusFilter("ALL");
      setLocationFilter("ALL");
      setCurrentPage(1);
    }
  }

  // Load danh sách page từ backend (chỉ lấy dữ liệu thật trong kho, không lấy demo/mock)
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoadingPages(true);

    async function fetchData() {
      try {
        let firstPageRes = null;
        try {
          firstPageRes = await getScannedPages({ page: 1, page_size: 200, sort_by: "followers" });
        } catch (err200) {
          console.warn("[SelectPagesModal] fetch page_size=200 failed, trying page_size=100", err200);
          try {
            firstPageRes = await getScannedPages({ page: 1, page_size: 100, sort_by: "followers" });
          } catch (err100) {
            console.warn("[SelectPagesModal] fetch page_size=100 failed, trying page_size=50", err100);
            firstPageRes = await getScannedPages({ page: 1, page_size: 50, sort_by: "followers" });
          }
        }

        const resKeywords = await getSearchKeywords().catch(() => ({ items: [] }));

        if (cancelled) return;

        let allLoadedPages = firstPageRes?.items || [];
        const total = Number(firstPageRes?.total) || allLoadedPages.length;

        // Nếu có nhiều page hơn đợt đầu, tiếp tục load thêm
        if (total > allLoadedPages.length) {
          const batchSize = allLoadedPages.length || 50;
          const totalPagesNeeded = Math.min(Math.ceil(total / batchSize), 10); // Tối đa 10 trang
          const remainingPromises = [];
          for (let p = 2; p <= totalPagesNeeded; p++) {
            remainingPromises.push(
              getScannedPages({ page: p, page_size: batchSize, sort_by: "followers" }).catch(() => ({ items: [] }))
            );
          }
          const results = await Promise.all(remainingPromises);
          if (cancelled) return;
          results.forEach((r) => {
            if (r?.items && Array.isArray(r.items)) {
              allLoadedPages = allLoadedPages.concat(r.items);
            }
          });
        }

        setAllPages(allLoadedPages);

        // Lấy danh sách từ khóa đã quét từ sessions
        const kwList = (resKeywords?.items || [])
          .map((k) => (k?.keyword || "").trim().replace(/^#+/, ""))
          .filter(Boolean);
        if (kwList.length) {
          setCustomCategories((prev) => Array.from(new Set([...prev, ...kwList])));
        }

        setActiveCategory((prev) => {
          if (prev) return prev;
          for (const p of allLoadedPages) {
            const tags = extractPageTags(p);
            if (tags.length) return tags[0];
          }
          if (kwList.length) return kwList[0];
          return NO_TAG_KEY;
        });
      } catch (err) {
        if (!cancelled) {
          toast.error(`Lỗi tải danh sách page: ${err?.message || "Không thể kết nối"}`);
          setAllPages([]);
          setActiveCategory(NO_TAG_KEY);
        }
      } finally {
        if (!cancelled) setLoadingPages(false);
      }
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [open]);

  // Danh sách từ khóa (tag) + mục "Chưa có tag"
  const categoriesData = useMemo(() => {
    const tagCountMap = new Map();
    let untaggedCount = 0;

    allPages.forEach((p) => {
      const tags = extractPageTags(p);
      if (tags.length === 0) {
        untaggedCount += 1;
      } else {
        tags.forEach((t) => {
          const lower = t.toLowerCase();
          if (!tagCountMap.has(lower)) {
            tagCountMap.set(lower, { name: t, count: 0 });
          }
          tagCountMap.get(lower).count += 1;
        });
      }
    });

    customCategories.forEach((cat) => {
      const lower = cat.toLowerCase();
      if (!tagCountMap.has(lower)) {
        tagCountMap.set(lower, { name: cat, count: 0 });
      }
    });

    const list = Array.from(tagCountMap.values()).map(({ name, count }) => ({
      key: name,
      name,
      count,
      isUntagged: false,
    }));

    list.sort((a, b) => b.count - a.count);

    const untaggedItem = {
      key: NO_TAG_KEY,
      name: "Chưa có tag",
      count: untaggedCount,
      isUntagged: true,
    };

    return {
      allList: [...list, untaggedItem],
      totalCategories: list.length + (untaggedCount > 0 ? 1 : 0),
      totalPages: allPages.length,
      untaggedCount,
    };
  }, [allPages, customCategories]);

  // Lọc danh mục bên trái theo ô tìm kiếm
  const filteredCategories = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    if (!q) return categoriesData.allList;
    return categoriesData.allList.filter((cat) =>
      cat.name.toLowerCase().includes(q),
    );
  }, [categoriesData.allList, categorySearch]);

  // Lọc danh sách page bên phải theo từ khóa/tag đang chọn & các bộ lọc
  const filteredPages = useMemo(() => {
    const q = pageSearch.trim().toLowerCase();
    const activeLower = (activeCategory || "").toLowerCase();

    return allPages.filter((p) => {
      // 1. Lọc theo Từ khóa (Tag)
      const tags = extractPageTags(p);
      if (activeCategory === NO_TAG_KEY) {
        if (tags.length > 0) return false;
      } else if (activeCategory && activeCategory !== ALL_TAGS_KEY) {
        const hasTag = tags.some((t) => t.toLowerCase() === activeLower);
        if (!hasTag) return false;
      }

      // 2. Lọc theo Tình trạng
      if (statusFilter === "PHONE" && !p.phone) return false;
      if (statusFilter === "EMAIL" && !p.email) return false;
      if (statusFilter === "WEBSITE" && !p.website) return false;
      if (statusFilter === "ADDRESS" && !p.address) return false;
      if (statusFilter === "VERIFIED" && !p.is_verified) return false;

      // 3. Lọc theo Khu vực
      if (locationFilter !== "ALL") {
        const addr = String(p.address || "").toLowerCase();
        if (locationFilter === "HCM" && !addr.includes("hcm") && !addr.includes("hồ chí minh") && !addr.includes("quận") && !addr.includes("thủ đức")) return false;
        if (locationFilter === "HN" && !addr.includes("hà nội") && !addr.includes("đống đa") && !addr.includes("cầu giấy")) return false;
        if (locationFilter === "DN" && !addr.includes("đà nẵng") && !addr.includes("hải châu")) return false;
      }

      // 4. Lọc theo Search text
      if (q) {
        const hay = `${p.page_name || ""} ${p.uid || ""} ${p.page_key || ""} ${p.phone || ""} ${p.email || ""} ${p.address || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [allPages, activeCategory, statusFilter, locationFilter, pageSearch]);

  // Phân trang danh sách page
  const totalFiltered = filteredPages.length;
  const totalPagesCount = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPagesCount);
  const pagedPages = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return filteredPages.slice(start, start + pageSize);
  }, [filteredPages, safeCurrentPage, pageSize]);

  // Kiểm tra trạng thái chọn trong danh sách hiện tại
  const currentPageKeys = useMemo(() => pagedPages.map((p) => p.page_key), [pagedPages]);
  const allCurrentChecked = currentPageKeys.length > 0 && currentPageKeys.every((k) => draftKeys.includes(k));

  const toggleSelectAllCurrent = (checked) => {
    if (checked) {
      setDraftKeys((prev) => [...new Set([...prev, ...currentPageKeys])]);
    } else {
      setDraftKeys((prev) => prev.filter((k) => !currentPageKeys.includes(k)));
    }
  };

  const toggleSinglePage = (pageKey) => {
    setDraftKeys((prev) =>
      prev.includes(pageKey)
        ? prev.filter((k) => k !== pageKey)
        : [...prev, pageKey],
    );
  };

  // Kéo chọn nhiều page trong trang đang xem (giữ lựa chọn ở trang / danh mục khác)
  const drag = useDragRowSelect({
    ids: currentPageKeys,
    isSelected: (key) => draftKeys.includes(key),
    onSet: (keys) => setDraftKeys((prev) => [...new Set([...prev.filter((k) => !currentPageKeys.includes(k)), ...keys])]),
    onToggle: toggleSinglePage,
  });

  const activeCategoryObj = useMemo(() => {
    return categoriesData.allList.find((c) => c.key === activeCategory) || {
      name: activeCategory === NO_TAG_KEY ? "Chưa có tag" : activeCategory,
      count: filteredPages.length,
    };
  }, [categoriesData.allList, activeCategory, filteredPages.length]);

  const handleExportExcel = async () => {
    const exportItems = filteredPages;
    if (!exportItems.length) {
      toast.warning("Không có dữ liệu để xuất.", { key: "m11-modal-pages-export" });
      return;
    }
    const headers = ["STT", "Tên Page", "UID", "Link Page", "Số điện thoại", "Email", "Website", "Địa chỉ", "Danh mục/Tag"];
    const rows = exportItems.map((p, idx) => [
      idx + 1,
      p.page_name || "",
      p.uid || p.page_key || "",
      p.page_url || "",
      p.phone || "",
      p.email || "",
      p.website || "",
      p.address || "",
      extractPageTags(p).join("; ") || "Chưa có tag",
    ]);
    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    try {
      const res = await saveCsvContent(csvContent, `danh_sach_page_${activeCategory || "all"}.csv`);
      notifyExportResult(res, {
        successMessage: `Đã xuất ${exportItems.length} page ra file "${res.fileName}".`,
        key: "m11-modal-pages-export",
      });
    } catch (err) {
      toast.error(`Lỗi xuất file: ${err?.message || "Không lưu được file."}`, { key: "m11-modal-pages-export" });
    }
  };

  const handleDeleteSelected = async () => {
    const selectedInCurrent = filteredPages.filter((p) => draftKeys.includes(p.page_key));
    if (!selectedInCurrent.length) return;
    const ok = await askConfirm({
      title: "Bỏ chọn page",
      description: `Bạn có chắc chắn muốn bỏ chọn ${selectedInCurrent.length} page này?`,
      confirmText: "Bỏ chọn",
      variant: "warning",
    });
    if (!ok) return;
    const removeKeys = new Set(selectedInCurrent.map((p) => p.page_key));
    setDraftKeys((prev) => prev.filter((k) => !removeKeys.has(k)));
    toast.success(`Đã bỏ chọn ${selectedInCurrent.length} page.`);
  };

  const handleCreateCategory = (e) => {
    e.preventDefault();
    const name = newCategoryName.trim().replace(/^#+/, "");
    if (!name) return;
    if (categoriesData.allList.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      toast.warning("Từ khóa/tag này đã tồn tại.");
      return;
    }
    setCustomCategories((prev) => [...prev, name]);
    setActiveCategory(name);
    setNewCategoryName("");
    setShowAddCategoryModal(false);
    toast.success(`Đã tạo từ khóa/tag "${name}".`);
  };

  const cleanLinkDisplay = (url, name) => {
    if (!url) return name ? `fb.com/${name.toLowerCase().replace(/\s+/g, "")}` : "fb.com/page";
    return url.replace(/^https?:\/\/(www\.)?facebook\.com\//, "fb.com/").replace(/\/$/, "");
  };

  const [showMoveCategoryModal, setShowMoveCategoryModal] = useState(false);
  const [targetCategory, setTargetCategory] = useState("");

  const handleDeleteCategory = async () => {
    if (activeCategory === NO_TAG_KEY) {
      toast.warning("Không thể xóa mục 'Chưa có tag'.");
      return;
    }
    const ok = await askConfirm({
      title: "Gỡ từ khóa/tag",
      description: `Bạn có chắc chắn muốn gỡ từ khóa/tag "${activeCategory}" khỏi các page?`,
      confirmText: "Gỡ",
    });
    if (!ok) return;
    const targetLower = activeCategory.toLowerCase();
    setAllPages((prev) =>
      prev.map((p) => {
        const tags = extractPageTags(p);
        if (tags.some((t) => t.toLowerCase() === targetLower)) {
          const newTags = tags.filter((t) => t.toLowerCase() !== targetLower);
          return {
            ...p,
            matched_hashtags: newTags,
            source_keywords: (p.source_keywords || []).filter((kw) => kw.toLowerCase() !== targetLower),
          };
        }
        return p;
      })
    );
    setCustomCategories((prev) => prev.filter((c) => c.toLowerCase() !== targetLower));
    setActiveCategory(NO_TAG_KEY);
    toast.success(`Đã gỡ từ khóa/tag "${activeCategory}".`);
  };

  const handleMoveCategory = (e) => {
    e.preventDefault();
    const dest = targetCategory.trim().replace(/^#+/, "");
    if (!dest) {
      toast.warning("Vui lòng chọn hoặc nhập từ khóa/tag đích.");
      return;
    }
    const destLower = dest.toLowerCase();
    const selectedKeysSet = new Set(draftKeys);
    let count = 0;
    setAllPages((prev) =>
      prev.map((p) => {
        if (selectedKeysSet.has(p.page_key)) {
          count += 1;
          const currentTags = extractPageTags(p);
          if (!currentTags.some((t) => t.toLowerCase() === destLower)) {
            const nextTags = [...currentTags, dest];
            return {
              ...p,
              matched_hashtags: nextTags,
              source_keywords: [...(p.source_keywords || []), dest],
            };
          }
        }
        return p;
      })
    );
    if (!categoriesData.allList.some((c) => c.name.toLowerCase() === destLower)) {
      setCustomCategories((prev) => [...prev, dest]);
    }
    setShowMoveCategoryModal(false);
    setTargetCategory("");
    toast.success(`Đã gán từ khóa/tag "${dest}" cho ${count} page.`);
  };

  const selectedInCurrentCount = useMemo(() => {
    return filteredPages.filter((p) => draftKeys.includes(p.page_key)).length;
  }, [filteredPages, draftKeys]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4 md:p-6 backdrop-blur-[1px]">
      <div className="flex h-[92vh] max-h-[890px] w-full max-w-[1240px] flex-col overflow-hidden rounded-2xl bg-[#F4F7FC] shadow-2xl border border-[#E2E8F0]">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#E2E8F0] bg-[#E2E8F0]/70 px-4 py-3 sm:px-6 sm:py-4 md:px-8 md:py-4">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <FolderCog className="size-6 text-[#0F172A] shrink-0" />
            <div className="min-w-0">
              <h2 className="font-heading text-base sm:text-lg font-bold text-[#0F172A] truncate">
                Chọn page từ danh mục đã quét
              </h2>
              <p className="text-xs sm:text-sm text-[#475569] line-clamp-1 sm:line-clamp-none">
                Lựa chọn các page từ danh sách đã thu thập trước đó để tiến hành quét bài viết mục tiêu
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#475569] hover:bg-black/5 hover:text-[#0F172A] transition shrink-0"
            aria-label="Đóng"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Content body: 2 cột */}
        <div className="grid flex-1 min-h-0 grid-cols-1 md:grid-cols-12 gap-3 sm:gap-4 p-3 sm:p-4 md:p-5 overflow-y-auto md:overflow-hidden">
          {/* Cột trái: Danh sách danh mục từ khóa / tag */}
          <div className="flex h-[320px] md:h-auto min-h-0 flex-col rounded-2xl border border-[#E2E8F0] bg-white overflow-hidden md:col-span-4 lg:col-span-3 shrink-0 md:shrink p-3 sm:p-4">
            <div className="flex shrink-0 items-center justify-between pb-3 border-b border-[#F1F5F9]">
              <div className="flex items-center gap-2 text-xs font-bold text-[#0F172A] uppercase tracking-wide">
                <Folder className="size-4 text-[#1877F2]" />
                <span>DANH SÁCH DANH MỤC</span>
              </div>
              <button
                type="button"
                onClick={() => setShowAddCategoryModal(true)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#1877F2] hover:text-[#1D4ED8] hover:underline"
              >
                <Plus className="size-3.5" />
                <span>Thêm</span>
              </button>
            </div>

            {/* Thẻ thống kê */}
            <div className="mt-3 shrink-0 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2 flex items-center justify-between text-xs text-[#64748B]">
              <span>
                Đã quét: <strong className="text-[#0F172A] font-bold">{categoriesData.totalCategories} danh mục</strong>
              </span>
              <strong className="text-[#1877F2] font-bold">{fmtNum(categoriesData.totalPages)} Page</strong>
            </div>

            {/* Ô tìm kiếm danh mục */}
            <div className="mt-3 shrink-0 relative">
              <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[#94A3B8]" />
              <input
                value={categorySearch}
                onChange={(e) => setCategorySearch(e.target.value)}
                placeholder="Lọc danh mục thư mục..."
                className="h-9 w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] pr-3 pl-9 text-xs text-[#0F172A] placeholder:text-[#94A3B8] outline-none focus:border-[#1877F2] focus:bg-white transition"
              />
            </div>

            {/* Danh sách danh mục scrollable */}
            <div className="mt-3 flex-1 min-h-0 space-y-1.5 overflow-y-auto pr-0.5 [scrollbar-width:thin] [scrollbar-color:#CBD5E1_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300 hover:[&::-webkit-scrollbar-thumb]:bg-slate-400 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-button]:hidden">
              {filteredCategories.length === 0 ? (
                <div className="py-8 text-center text-xs text-[#94A3B8]">
                  Không tìm thấy từ khóa phù hợp.
                </div>
              ) : (
                filteredCategories.map((cat) => {
                  const isActive = activeCategory === cat.key;
                  return (
                    <div
                      key={cat.key}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setActiveCategory(cat.key);
                        setCurrentPage(1);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          setActiveCategory(cat.key);
                          setCurrentPage(1);
                        }
                      }}
                      className={`group flex items-center justify-between rounded-xl px-3 py-2.5 cursor-pointer transition text-left ${
                        isActive
                          ? "border-2 border-[#1877F2] bg-[#F0F7FF] shadow-xs"
                          : "border border-transparent hover:border-[#E2E8F0] hover:bg-[#F8FAFC]"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 pr-1">
                        <span
                          className={`size-2 shrink-0 rounded-full ${
                            isActive ? "bg-[#1877F2]" : cat.isUntagged ? "bg-amber-400" : "bg-[#CBD5E1]"
                          }`}
                        />
                        <div className="min-w-0">
                          <div
                            className={`text-xs truncate ${
                              isActive ? "font-bold text-[#0F172A]" : "font-semibold text-[#334155]"
                            }`}
                          >
                            {cat.name}
                          </div>
                          <div
                            className={`text-[11px] mt-0.5 ${
                              isActive ? "font-semibold text-[#1877F2]" : "text-[#94A3B8]"
                            }`}
                          >
                            {fmtNum(cat.count)} page
                          </div>
                        </div>
                      </div>
                      {isActive && !cat.isUntagged && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCategory();
                          }}
                          title="Xóa danh mục này"
                          className="p-1 text-[#94A3B8] hover:text-[#DC2626] rounded transition shrink-0"
                        >
                          <MoreVertical className="size-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Nút thêm danh mục mới ở đáy */}
            <div className="pt-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowAddCategoryModal(true)}
                className="w-full py-2.5 rounded-xl border border-dashed border-[#CBD5E1] hover:border-[#1877F2] hover:bg-[#F0F7FF] text-xs font-semibold text-[#475569] hover:text-[#1877F2] flex items-center justify-center gap-1.5 transition"
              >
                <Plus className="size-4" />
                <span>+ Thêm danh mục mới</span>
              </button>
            </div>
          </div>

          {/* Cột phải: Danh sách Page trong danh mục */}
          <div className="flex min-h-[460px] md:min-h-0 flex-1 flex-col rounded-2xl border border-[#E2E8F0] bg-white overflow-hidden md:col-span-8 lg:col-span-9">
            {/* Header cột phải */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#F1F5F9] px-4 py-3 sm:px-5 sm:py-3.5">
              <div>
                <h3 className="text-base font-bold text-[#0F172A] truncate">
                  {activeCategoryObj.name}
                </h3>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-[#64748B]">
                  <Folder className="size-3.5 text-[#94A3B8]" />
                  <span>{fmtNum(filteredPages.length)} Page</span>
                  <span>•</span>
                  <span>Cập nhật gần đây</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => guardExport(handleExportExcel)}
                  disabled={isExporting}
                  className="inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-lg bg-[#059669] hover:bg-[#047857] px-3 sm:px-3.5 text-xs font-semibold text-white shadow-xs transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FileSpreadsheet className="size-3.5" />
                  <span>Xuất Excel</span>
                </button>
                {activeCategory !== NO_TAG_KEY && (
                  <button
                    type="button"
                    onClick={handleDeleteCategory}
                    className="inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-lg border border-[#FECACA] hover:bg-[#FEF2F2] px-3 sm:px-3.5 text-xs font-semibold text-[#DC2626] transition"
                  >
                    <Trash2 className="size-3.5" />
                    <span>Xóa danh mục</span>
                  </button>
                )}
              </div>
            </div>

            {/* Thanh tìm kiếm & bộ lọc */}
            <div className="shrink-0 border-b border-[#F1F5F9] p-3 sm:p-4 flex flex-col md:flex-row gap-2.5 items-stretch md:items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#94A3B8]" />
                <input
                  value={pageSearch}
                  onChange={(e) => {
                    setPageSearch(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Tìm theo Tên Page, ID Page, Số điện thoại hoặc Email..."
                  className="h-9 w-full rounded-xl border border-[#E2E8F0] bg-white pr-3 pl-9 text-xs text-[#0F172A] placeholder:text-[#94A3B8] outline-none focus:border-[#1877F2] transition"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="h-9 rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs text-[#334155] outline-none focus:border-[#1877F2] cursor-pointer"
              >
                <option value="ALL">Tình trạng: Tất cả thông tin</option>
                <option value="PHONE">Có Số điện thoại</option>
                <option value="EMAIL">Có Email</option>
                <option value="WEBSITE">Có Website</option>
                <option value="ADDRESS">Có Địa chỉ</option>
                <option value="VERIFIED">Page xác minh</option>
              </select>

              <select
                value={locationFilter}
                onChange={(e) => {
                  setLocationFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="h-9 rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs text-[#334155] outline-none focus:border-[#1877F2] cursor-pointer"
              >
                <option value="ALL">Khu vực: Toàn quốc</option>
                <option value="HCM">TP. Hồ Chí Minh</option>
                <option value="HN">Hà Nội</option>
                <option value="DN">Đà Nẵng</option>
              </select>
            </div>

            {/* Thanh hành động (Chọn tất cả / Đã chọn / Chuyển danh mục / Xóa) */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2">
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={allCurrentChecked}
                  onCheckedChange={toggleSelectAllCurrent}
                  id="select-all-pages"
                />
                <label
                  htmlFor="select-all-pages"
                  className="text-xs font-semibold text-[#334155] cursor-pointer select-none"
                >
                  Chọn tất cả
                </label>
                <span className="inline-flex items-center rounded-full bg-[#EFF6FF] border border-[#BFDBFE] px-2.5 py-0.5 text-[11px] font-bold text-[#1D4ED8]">
                  Đã chọn {selectedInCurrentCount} / {filteredPages.length} page
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowMoveCategoryModal(true)}
                  disabled={selectedInCurrentCount === 0}
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] px-2.5 text-[11px] font-semibold text-[#334155] disabled:opacity-40 shadow-xs transition"
                >
                  <FolderSync className="size-3.5 text-[#64748B]" />
                  <span>Chuyển danh mục</span>
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  disabled={selectedInCurrentCount === 0}
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[#FECACA] bg-white hover:bg-[#FEF2F2] px-2.5 text-[11px] font-semibold text-[#DC2626] disabled:opacity-40 shadow-xs transition"
                >
                  <Trash2 className="size-3.5" />
                  <span>Xóa ({selectedInCurrentCount})</span>
                </button>
              </div>
            </div>

            {/* Bảng danh sách Page */}
            <div ref={drag.setContainer} className="flex-1 min-h-0 overflow-auto [scrollbar-width:thin] [scrollbar-color:#CBD5E1_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300 hover:[&::-webkit-scrollbar-thumb]:bg-slate-400 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-button]:hidden">
              <table className="w-full min-w-[760px] select-none text-left text-xs">
                <thead className="sticky top-0 z-10 bg-white text-[10px] font-bold text-[#64748B] uppercase tracking-wider">
                  <tr className="border-b border-[#E2E8F0]">
                    <th className="w-10 px-4 py-3">
                      <Checkbox
                        checked={allCurrentChecked}
                        onCheckedChange={toggleSelectAllCurrent}
                      />
                    </th>
                    <th className="w-12 px-2 py-3">STT</th>
                    <th className="px-3 py-3 min-w-[200px]">THÔNG TIN PAGE</th>
                    <th className="px-3 py-3 min-w-[140px]">LINK PAGE</th>
                    <th className="px-3 py-3 min-w-[130px]">SỐ ĐIỆN THOẠI</th>
                    <th className="px-3 py-3 min-w-[140px]">EMAIL</th>
                    <th className="px-3 py-3 min-w-[130px]">WEBSITE</th>
                    <th className="px-4 py-3 min-w-[130px]">ĐỊA CHỈ / VÙNG</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {loadingPages ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-[#64748B]">
                        <Loader2 className="mx-auto mb-2 size-5 animate-spin text-[#1877F2]" />
                        Đang tải danh sách page...
                      </td>
                    </tr>
                  ) : pagedPages.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-[#94A3B8]">
                        Không có page nào trong danh mục này hoặc khớp với bộ lọc.
                      </td>
                    </tr>
                  ) : (
                    pagedPages.map((pg, idx) => {
                      const realIdx = (safeCurrentPage - 1) * pageSize + idx;
                      const isChecked = draftKeys.includes(pg.page_key);
                      const badgeText = getPageBadgeText(pg.page_name);
                      const badgeBg = BADGE_COLOR_PALETTE[idx % BADGE_COLOR_PALETTE.length];
                      const cleanUid = pg.uid || String(pg.page_key || "").replace(/^(user|page):/, "") || "—";
                      const cleanLink = cleanLinkDisplay(pg.page_url, pg.page_name);

                      return (
                        <tr
                          key={pg.page_key || idx}
                          {...drag.rowProps(pg.page_key)}
                          className={`cursor-pointer transition ${
                            isChecked ? "bg-[#F0F7FF]/50 hover:bg-[#F0F7FF]" : "hover:bg-[#F8FAFC]"
                          }`}
                        >
                          <td
                            className="px-4 py-3"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={() => toggleSinglePage(pg.page_key)}
                            />
                          </td>
                          <td className="px-2 py-3 font-mono text-[11px] text-[#94A3B8]">
                            {String(realIdx + 1).padStart(2, "0")}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2.5">
                              <Avatar className="size-8 rounded-lg shrink-0 overflow-hidden border border-slate-200 shadow-xs">
                                {pg.avatar_url ? (
                                  <AvatarImage
                                    src={pg.avatar_url}
                                    alt={pg.page_name || "Page"}
                                    className="object-cover size-full"
                                  />
                                ) : null}
                                <AvatarFallback
                                  className={`size-full rounded-lg flex items-center justify-center font-bold text-[11px] text-white ${badgeBg}`}
                                >
                                  {badgeText}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1">
                                  <span className="font-bold text-xs text-[#0F172A] truncate max-w-[160px]">
                                    {pg.page_name || "Fanpage"}
                                  </span>
                                  {pg.is_verified && (
                                    <CheckCircle2 className="size-3.5 text-[#1877F2] shrink-0" />
                                  )}
                                </div>
                                <div className="text-[10px] font-mono text-[#94A3B8] truncate">
                                  UID: {cleanUid}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td
                            className="px-3 py-3"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {pg.page_url ? (
                              <a
                                href={pg.page_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 font-mono text-xs text-[#1877F2] hover:underline"
                              >
                                <span className="max-w-[120px] truncate">{cleanLink}</span>
                                <ExternalLink className="size-3 shrink-0" />
                              </a>
                            ) : (
                              <span className="font-mono text-xs text-[#94A3B8]">{cleanLink}</span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            {pg.phone ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EFF6FF] border border-[#BFDBFE] px-2.5 py-1 text-xs font-semibold text-[#1D4ED8]">
                                <Phone className="size-3 shrink-0 text-[#2563EB]" />
                                <span>{formatPhoneDisplay(pg.phone)}</span>
                              </span>
                            ) : (
                              <span className="text-xs text-[#CBD5E1]">—</span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            {pg.email ? (
                              <span className="text-xs text-[#334155] truncate max-w-[140px] block" title={pg.email}>
                                {pg.email}
                              </span>
                            ) : (
                              <span className="text-[11px] italic text-[#94A3B8]">(Chưa cập nhật)</span>
                            )}
                          </td>
                          <td
                            className="px-3 py-3"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {pg.website ? (
                              <a
                                href={pg.website.startsWith("http") ? pg.website : `https://${pg.website}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-[#1877F2] hover:underline"
                              >
                                <span className="max-w-[120px] truncate">
                                  {pg.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                                </span>
                                <ExternalLink className="size-2.5 shrink-0" />
                              </a>
                            ) : (
                              <span className="text-xs text-[#94A3B8]">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {pg.address ? (
                              <div className="flex items-center gap-1 text-xs text-[#475569]">
                                <MapPin className="size-3 text-[#94A3B8] shrink-0" />
                                <span className="truncate max-w-[140px]" title={pg.address}>
                                  {pg.address}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-[#CBD5E1]">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Thanh phân trang ở đáy bảng */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[#E2E8F0] px-4 py-2.5 text-xs text-[#64748B] bg-white">
              <div className="flex items-center gap-2">
                <span>
                  Hiển thị{" "}
                  <strong className="text-[#0F172A]">
                    {totalFiltered === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1} -{" "}
                    {Math.min(safeCurrentPage * pageSize, totalFiltered)}
                  </strong>{" "}
                  trong tổng số <strong className="text-[#0F172A]">{fmtNum(totalFiltered)}</strong> Page
                </span>
                <span className="text-[#CBD5E1]">|</span>
                <div className="inline-flex items-center gap-1">
                  <span>Số hàng:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="rounded-md border border-[#E2E8F0] px-1.5 py-0.5 text-xs font-semibold text-[#0F172A] outline-none bg-white cursor-pointer"
                  >
                    <option value={10}>10</option>
                    <option value={15}>15</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                  </select>
                </div>
              </div>

              <Pager page={safeCurrentPage} totalPages={totalPagesCount} onChange={setCurrentPage} />
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-[#E2E8F0] bg-[#F4F7FC] px-4 py-3 sm:px-6 sm:py-4 md:px-8">
          <button
            type="button"
            onClick={onClose}
            className="h-10 sm:h-11 rounded-xl border border-[#CBD5E1] bg-white px-5 sm:px-7 text-xs sm:text-sm font-semibold text-[#334155] shadow-xs hover:bg-[#F8FAFC] transition"
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            onClick={() => {
              const chosen = allPages.filter((p) => draftKeys.includes(p.page_key));
              onConfirm(chosen);
              onClose();
              toast.success(`Đã chọn ${chosen.length} Fanpage.`);
            }}
            className="inline-flex h-10 sm:h-11 items-center gap-2 rounded-xl bg-[#1D4ED8] hover:bg-[#1E40AF] px-5 sm:px-7 text-xs sm:text-sm font-semibold text-white shadow-xs transition"
          >
            <Check className="size-4" />
            <span>Xác nhận chọn ({draftKeys.length} page)</span>
          </button>
        </div>
      </div>

      {/* Submodal Thêm từ khóa / tag mới */}
      {showAddCategoryModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl border border-slate-200">
            <h4 className="text-base font-bold text-slate-900 mb-2">Thêm từ khóa / tag mới</h4>
            <p className="text-xs text-slate-500 mb-4">
              Nhập tên từ khóa (tag) để gom nhóm các Fanpage.
            </p>
            <form onSubmit={handleCreateCategory} className="space-y-4">
              <input
                autoFocus
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="VD: mỹ phẩm, #thoitrang, fnb..."
                className="w-full h-10 rounded-xl border border-slate-300 px-3 text-xs outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
              />
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddCategoryModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={!newCategoryName.trim()}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Tạo từ khóa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Submodal Chuyển / Gán từ khóa tag */}
      {showMoveCategoryModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl border border-slate-200">
            <h4 className="text-base font-bold text-slate-900 mb-2">Gán từ khóa / tag</h4>
            <p className="text-xs text-slate-500 mb-4">
              Chọn từ khóa (tag) muốn gán cho {selectedInCurrentCount} page đã chọn.
            </p>
            <form onSubmit={handleMoveCategory} className="space-y-4">
              <select
                value={targetCategory}
                onChange={(e) => setTargetCategory(e.target.value)}
                className="w-full h-10 rounded-xl border border-slate-300 px-3 text-xs outline-none focus:border-blue-600 cursor-pointer"
              >
                <option value="">-- Chọn từ khóa đích --</option>
                {categoriesData.allList
                  .filter((c) => !c.isUntagged && c.name !== activeCategory)
                  .map((c) => (
                    <option key={c.key} value={c.name}>
                      {c.name}
                    </option>
                  ))}
              </select>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowMoveCategoryModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={!targetCategory}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Xác nhận gán
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
