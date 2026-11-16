"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  SlidersHorizontal,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "@/lib/toast";
import { getCategories } from "@/modules/module_02_account_manager/service";
import { initialsOf } from "@/modules/module_07_group_spam/shared/components";
import { AVATAR_COLORS } from "@/modules/module_07_group_spam/shared/constants";
import {
  deletePageFollowers,
  getPageFollowers,
  getPagesWithFollowers,
  getScannedPages,
} from "../service";
import { Pager } from "../_shared";

const fmtNum = (n) => Number(n || 0).toLocaleString("vi-VN");

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
  const pageSize = 5;

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setDraftUids(selectedUids);
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
  const allFilteredChecked = filtered.length > 0 && filtered.every((a) => draftUids.includes(a.uid));

  if (!open) return null;

  const toggle = (uid, checked) =>
    setDraftUids((prev) => (checked ? [...new Set([...prev, uid])] : prev.filter((u) => u !== uid)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1px]">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#F1F5F9] px-6 py-5">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="font-heading text-lg font-bold text-[#0F172A]">Chọn tài khoản Facebook thực thi quét</h2>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-0.5 text-xs font-semibold text-[#1D4ED8]">
                <span className="size-1.5 rounded-full bg-[#2563EB]" />
                Đã chọn: {draftUids.length} / {accounts.length} tài khoản khả dụng
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

        <div className="flex-1 overflow-auto border-t border-[#F1F5F9]">
          {loading ? (
            <div className="py-12 text-center text-xs text-[#64748B]">
              <Loader2 className="mx-auto mb-2 size-6 animate-spin text-[#1877F2]" />
              Đang tải danh sách tài khoản...
            </div>
          ) : (
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="sticky top-0 z-10 bg-[#F8FAFC] text-[11px] font-bold text-[#475569] uppercase">
                <tr className="border-b border-[#E2E8F0]">
                  <th className="w-12 px-6 py-3.5">
                    <Checkbox
                      checked={allFilteredChecked}
                      onCheckedChange={(c) => {
                        const ids = filtered.map((a) => a.uid);
                        setDraftUids((prev) =>
                          c ? [...new Set([...prev, ...ids])] : prev.filter((u) => !ids.includes(u)),
                        );
                      }}
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
                    const checked = draftUids.includes(acc.uid);
                    const status = STATUS_META[String(acc.status).toUpperCase()] || STATUS_DEFAULT;
                    const login = LOGIN_META[acc.login_status] || LOGIN_DEFAULT;
                    const days = farmDays(acc);
                    return (
                      <tr
                        key={acc.uid}
                        onClick={() => toggle(acc.uid, !checked)}
                        className={`cursor-pointer transition ${checked ? "bg-[#EFF6FF]/60" : "hover:bg-[#F8FAFC]"}`}
                      >
                        <td className="px-6 py-3.5" onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={checked} onCheckedChange={(c) => toggle(acc.uid, !!c)} />
                        </td>
                        <td className="px-2 py-3.5 font-mono text-[#94A3B8]">{String(realIdx + 1).padStart(2, "0")}</td>
                        <td className="px-3 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <Avatar className="size-9">
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
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard?.writeText(acc.uid);
                                toast.success(`Đã sao chép UID ${acc.uid}`);
                              }}
                              className="text-[#94A3B8] hover:text-[#1877F2]"
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
              onConfirm(draftUids);
              onClose();
              toast.success(`Đã chọn ${draftUids.length} tài khoản thực thi.`);
            }}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#1D4ED8] px-6 text-sm font-semibold text-white shadow-sm hover:bg-[#1E40AF]"
          >
            <Check className="size-4" />
            Xác nhận chọn ({draftUids.length} tài khoản)
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Modal: Chọn page từ danh mục đã quét (ảnh 1) ─── */
const UID_PAGE_SIZE = 6;

export function SelectPagesModal({ open, onClose, selectedPages = [], onConfirm }) {
  const [pageCache, setPageCache] = useState({}); // page_key -> page (đã thấy / đã chọn)
  const [listKeys, setListKeys] = useState([]);
  const [listTotal, setListTotal] = useState(0);
  const [loadingPages, setLoadingPages] = useState(false);
  const [uidCounts, setUidCounts] = useState({});
  const [totalUids, setTotalUids] = useState(0);
  const [draftKeys, setDraftKeys] = useState([]);
  const [activePageKey, setActivePageKey] = useState("");
  const [leftSearch, setLeftSearch] = useState("");
  const [leftQuery, setLeftQuery] = useState("");
  const [rightSearch, setRightSearch] = useState("");
  const [rightQuery, setRightQuery] = useState("");
  const [selectedUidIds, setSelectedUidIds] = useState([]);
  const [uidRows, setUidRows] = useState([]);
  const [uidTotal, setUidTotal] = useState(0);
  const [uidPage, setUidPage] = useState(1);
  const [loadingUids, setLoadingUids] = useState(false);
  const [reloadUids, setReloadUids] = useState(0);

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setDraftKeys(selectedPages.map((p) => p.page_key));
      setPageCache(Object.fromEntries(selectedPages.map((p) => [p.page_key, p])));
      setActivePageKey(selectedPages[0]?.page_key || "");
      setLeftSearch("");
      setLeftQuery("");
      setRightSearch("");
      setRightQuery("");
      setSelectedUidIds([]);
      setUidPage(1);
    }
  }

  /* Debounce ô tìm kiếm */
  useEffect(() => {
    const t = setTimeout(() => setLeftQuery(leftSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [leftSearch]);
  useEffect(() => {
    const t = setTimeout(() => {
      setRightQuery(rightSearch.trim());
      setUidPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [rightSearch]);

  /* Số UID đã quét theo từng page (thật, từ kho followers) */
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    getPagesWithFollowers()
      .then((res) => {
        if (cancelled) return;
        setUidCounts(Object.fromEntries((res?.items || []).map((r) => [r.page_key, Number(r.scanned_uid_count) || 0])));
        setTotalUids(Number(res?.total_uids) || 0);
      })
      .catch(() => {
        if (!cancelled) {
          setUidCounts({});
          setTotalUids(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  /* Danh sách page trong kho (tìm kiếm phía server) */
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoadingPages(true);
    getScannedPages({ page: 1, page_size: 200, keyword: leftQuery || undefined, sort_by: "followers" })
      .then((res) => {
        if (cancelled) return;
        const items = res?.items || [];
        setPageCache((prev) => ({ ...prev, ...Object.fromEntries(items.map((p) => [p.page_key, { ...prev[p.page_key], ...p }])) }));
        setListKeys(items.map((p) => p.page_key));
        setListTotal(Number(res?.total) || items.length);
        setActivePageKey((cur) => cur || items[0]?.page_key || "");
      })
      .catch((err) => {
        if (!cancelled) toast.error(`Lỗi tải danh sách page: ${err.message}`);
      })
      .finally(() => {
        if (!cancelled) setLoadingPages(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, leftQuery]);

  /* UID đã thu thập của page đang xem (phân trang phía server) */
  useEffect(() => {
    if (!open || !activePageKey) {
      setUidRows([]);
      setUidTotal(0);
      return undefined;
    }
    let cancelled = false;
    setLoadingUids(true);
    getPageFollowers({ page_key: activePageKey, page: uidPage, page_size: UID_PAGE_SIZE, keyword: rightQuery || undefined })
      .then((res) => {
        if (cancelled) return;
        setUidRows(res?.items || []);
        setUidTotal(Number(res?.total) || 0);
      })
      .catch((err) => {
        if (cancelled) return;
        setUidRows([]);
        setUidTotal(0);
        toast.error(`Lỗi tải UID của page: ${err.message}`);
      })
      .finally(() => {
        if (!cancelled) setLoadingUids(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, activePageKey, uidPage, rightQuery, reloadUids]);

  const listPages = useMemo(() => listKeys.map((k) => pageCache[k]).filter(Boolean), [listKeys, pageCache]);
  const activePage = pageCache[activePageKey] || null;
  const uidTotalPages = Math.max(1, Math.ceil(uidTotal / UID_PAGE_SIZE));

  if (!open) return null;

  const selectPage = (key) => {
    setActivePageKey(key);
    setSelectedUidIds([]);
    setUidPage(1);
    setDraftKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
  };
  const unselectPage = (key) => setDraftKeys((prev) => prev.filter((k) => k !== key));

  const rowUid = (f) => String(f.follower_key || "").replace(/^id:|^user:/, "") || "—";

  const handleExportSelectedUids = () => {
    const chosen = uidRows.filter((f) => selectedUidIds.includes(f.id));
    if (!chosen.length) {
      toast.warning("Vui lòng chọn ít nhất 1 UID để xuất file.");
      return;
    }
    const header = ["STT", "Họ và tên", "UID", "Profile", "Địa chỉ", "Số bạn bè", "Thời gian"];
    const lines = chosen.map((f, i) => [
      i + 1,
      f.follower_name || "",
      rowUid(f),
      f.profile_url || "",
      f.location || "",
      f.friend_count ?? "",
      f.updated_at || f.created_at || "",
    ]);
    const csv = [header, ...lines].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `uid_${String(activePageKey).replace(/[:/\\]/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Đã xuất ${chosen.length} UID đã chọn.`);
  };

  const handleDeleteSelectedUids = async () => {
    const ids = uidRows.filter((f) => selectedUidIds.includes(f.id) && f.id != null).map((f) => f.id);
    if (!ids.length) return;
    if (!window.confirm(`Xóa vĩnh viễn ${ids.length} UID khỏi kho followers?`)) return;
    try {
      const res = await deletePageFollowers({ follower_ids: ids });
      const deleted = Number(res?.deleted ?? ids.length);
      toast.success(`Đã xóa ${deleted} UID.`);
      setSelectedUidIds([]);
      setUidCounts((prev) => ({ ...prev, [activePageKey]: Math.max(0, (prev[activePageKey] || 0) - deleted) }));
      setTotalUids((prev) => Math.max(0, prev - deleted));
      setReloadUids((n) => n + 1);
    } catch (err) {
      toast.error(`Lỗi xóa UID: ${err.message}`);
    }
  };

  const allRowsChecked = uidRows.length > 0 && uidRows.every((f) => selectedUidIds.includes(f.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1px]">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-[#F4F7FC] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#E2E8F0] bg-[#E2E8F0]/70 px-8 py-5">
          <div className="flex items-center gap-4">
            <FolderCog className="size-6 text-[#0F172A]" />
            <div>
              <h2 className="font-heading text-lg font-bold text-[#0F172A]">Chọn page từ danh mục đã quét</h2>
              <p className="text-sm text-[#334155]">
                Lựa chọn các page từ danh sách đã thu thập trước đó để tiến hành quét bài viết mục tiêu
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-[#334155] hover:bg-black/5" aria-label="Đóng">
            <X className="size-5" />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-5 overflow-auto px-8 py-5 lg:grid-cols-12">
          {/* Trái: danh sách page */}
          <div className="flex min-h-[480px] flex-col rounded-2xl border border-[#E2E8F0] bg-white lg:col-span-4">
            <div className="flex items-center justify-between border-b border-[#F1F5F9] px-4 py-4">
              <span className="text-sm font-bold text-[#0F172A]">Danh sách Page ({fmtNum(listTotal)})</span>
              <SlidersHorizontal className="size-4 text-[#64748B]" />
            </div>
            <div className="px-3 pt-3">
              <div className="relative">
                <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[#94A3B8]" />
                <input
                  value={leftSearch}
                  onChange={(e) => setLeftSearch(e.target.value)}
                  placeholder="Tìm tên Page, UID..."
                  className="h-9 w-full rounded-xl border border-[#E2E8F0] bg-white pr-3 pl-9 text-xs text-[#0F172A] outline-none focus:border-[#1877F2]"
                />
              </div>
            </div>
            <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
              {loadingPages && listPages.length === 0 ? (
                <div className="py-10 text-center text-xs text-[#64748B]">
                  <Loader2 className="mx-auto mb-2 size-5 animate-spin text-[#1877F2]" />
                  Đang tải page...
                </div>
              ) : listPages.length === 0 ? (
                <p className="py-10 text-center text-xs text-[#94A3B8]">
                  {leftQuery ? "Không có page khớp tìm kiếm." : "Chưa có page trong kho — hãy chạy Quét thông tin page trước."}
                </p>
              ) : (
                listPages.map((pg) => {
                  const isSelected = draftKeys.includes(pg.page_key);
                  const isCurrent = activePageKey === pg.page_key;
                  return (
                    <div
                      key={pg.page_key}
                      role="button"
                      tabIndex={0}
                      onClick={() => selectPage(pg.page_key)}
                      onKeyDown={(e) => e.key === "Enter" && selectPage(pg.page_key)}
                      className={`cursor-pointer rounded-xl border p-3.5 transition ${
                        isCurrent
                          ? "border-2 border-[#1877F2] bg-white shadow-sm"
                          : isSelected
                            ? "border-[#BFDBFE] bg-[#F8FBFF]"
                            : "border-[#E2E8F0] bg-white hover:bg-[#F8FAFC]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="line-clamp-1 text-sm font-bold text-[#0F172A]">{pg.page_name || pg.page_key}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isSelected) unselectPage(pg.page_key);
                            else selectPage(pg.page_key);
                          }}
                          title={isSelected ? "Bỏ chọn page" : "Chọn page"}
                          aria-label={isSelected ? "Bỏ chọn page" : "Chọn page"}
                          className="flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-slate-100"
                        >
                          <span className={`size-2 rounded-full ${isSelected ? "bg-[#10B981]" : "bg-[#CBD5E1]"}`} />
                        </button>
                      </div>
                      <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px] text-[#64748B]">
                        <span>
                          Quy mô: <strong className="text-[#0F172A]">{pg.follower_count != null ? fmtNum(pg.follower_count) : "—"}</strong> followers
                        </span>
                        <span className={isCurrent ? "font-bold text-[#1877F2]" : "font-semibold text-[#334155]"}>
                          Đã quét: {fmtNum(uidCounts[pg.page_key])} UID
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="flex items-center justify-between border-t border-[#F1F5F9] px-4 py-3.5 text-xs">
              <span className="text-[#475569]">Tổng UID đã xử lý:</span>
              <strong className="font-mono text-sm font-bold text-[#1877F2]">{fmtNum(totalUids)} UID</strong>
            </div>
          </div>

          {/* Phải: UID của page đang xem */}
          <div className="flex min-h-[480px] flex-col rounded-2xl border border-[#E2E8F0] bg-white lg:col-span-8">
            <div className="border-b border-[#F1F5F9] px-4 py-4">
              <h3 className="text-sm font-bold text-[#0F172A]">{activePage?.page_name || "Chọn page bên trái"}</h3>
              <p className="mt-0.5 text-[11px] text-[#64748B]">
                Quy mô: <strong className="text-[#0F172A]">{activePage?.follower_count != null ? fmtNum(activePage.follower_count) : "—"}</strong> Followers •
                Đã thu thập: <strong className="font-mono text-[#1877F2]">{fmtNum(uidCounts[activePageKey] ?? uidTotal)}</strong> UID
              </p>
            </div>

            <div className="px-4 pt-3">
              <div className="relative">
                <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[#94A3B8]" />
                <input
                  value={rightSearch}
                  onChange={(e) => setRightSearch(e.target.value)}
                  placeholder="Tìm UID, Tên, Vị trí..."
                  className="h-9 w-full rounded-xl border border-[#E2E8F0] bg-white pr-3 pl-9 text-xs text-[#0F172A] outline-none focus:border-[#1877F2]"
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-y border-[#DBEAFE] bg-[#EFF6FF] px-4 py-2">
              <div className="flex items-center gap-2 text-xs font-bold text-[#1D4ED8]">
                <span className="flex size-5 items-center justify-center rounded-full bg-[#1D4ED8] text-[10px] text-white">
                  {selectedUidIds.length}
                </span>
                Đã chọn: {selectedUidIds.length} UID
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleExportSelectedUids}
                  className="inline-flex items-center gap-1 rounded-lg border border-[#BFDBFE] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#1D4ED8] hover:bg-[#DBEAFE]"
                >
                  <Download className="size-3" />
                  Xuất file chọn
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSelectedUids}
                  disabled={!selectedUidIds.length}
                  className="inline-flex items-center gap-1 rounded-lg border border-[#FECACA] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#DC2626] hover:bg-[#FEF2F2] disabled:opacity-40"
                >
                  <Trash2 className="size-3" />
                  Xóa
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-white text-[10px] font-bold text-[#475569] uppercase">
                  <tr className="border-b border-[#E2E8F0]">
                    <th className="w-10 px-4 py-3">
                      <Checkbox
                        checked={allRowsChecked}
                        onCheckedChange={(c) => setSelectedUidIds(c ? uidRows.map((f) => f.id) : [])}
                      />
                    </th>
                    <th className="w-12 px-2 py-3">STT</th>
                    <th className="px-2 py-3">Họ và tên</th>
                    <th className="px-2 py-3">UID / Profile link</th>
                    <th className="px-2 py-3">Địa chỉ</th>
                    <th className="px-2 py-3">Số bạn bè</th>
                    <th className="px-4 py-3 text-right">Thời gian</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {loadingUids ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-[#64748B]">
                        <Loader2 className="mx-auto mb-2 size-5 animate-spin text-[#1877F2]" />
                        Đang tải UID của Page...
                      </td>
                    </tr>
                  ) : uidRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-[#94A3B8]">
                        {activePageKey ? "Page này chưa có UID nào được quét." : "Chọn một page để xem UID đã thu thập."}
                      </td>
                    </tr>
                  ) : (
                    uidRows.map((f, idx) => {
                      const realIdx = (uidPage - 1) * UID_PAGE_SIZE + idx;
                      const checked = selectedUidIds.includes(f.id);
                      const uid = rowUid(f);
                      const name = f.follower_name || uid;
                      return (
                        <tr key={f.id} className="hover:bg-[#F8FAFC]">
                          <td className="px-4 py-3">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(c) =>
                                setSelectedUidIds((prev) => (c ? [...prev, f.id] : prev.filter((id) => id !== f.id)))
                              }
                            />
                          </td>
                          <td className="px-2 py-3 font-mono text-[#94A3B8]">{String(realIdx + 1).padStart(2, "0")}</td>
                          <td className="px-2 py-3">
                            <div className="flex items-center gap-2">
                              <Avatar className="size-8">
                                {f.avatar_url ? <AvatarImage src={f.avatar_url} alt="" /> : null}
                                <AvatarFallback className={AVATAR_COLORS[realIdx % AVATAR_COLORS.length]}>
                                  {initialsOf(name)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="max-w-[110px] font-bold leading-snug text-[#0F172A]">{name}</span>
                            </div>
                          </td>
                          <td className="px-2 py-3">
                            <a
                              href={f.profile_url || `https://www.facebook.com/${uid}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 font-mono text-[#1877F2] hover:underline"
                            >
                              {uid}
                              <ExternalLink className="size-3" />
                            </a>
                          </td>
                          <td className="px-2 py-3 text-[#475569]">{f.location || "—"}</td>
                          <td className="px-2 py-3 text-[#334155]">
                            {f.friend_count != null ? `${fmtNum(f.friend_count)} bạn bè` : "—"}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[#64748B]" title={f.updated_at || f.created_at || ""}>
                            {clockOf(f.updated_at || f.created_at)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#F1F5F9] px-4 py-3 text-xs text-[#64748B]">
              <span>
                Hiển thị{" "}
                <strong className="text-[#0F172A]">
                  {uidTotal === 0 ? 0 : (uidPage - 1) * UID_PAGE_SIZE + 1} - {Math.min(uidPage * UID_PAGE_SIZE, uidTotal)}
                </strong>{" "}
                của <strong className="text-[#0F172A]">{fmtNum(uidTotal)}</strong> UID
              </span>
              <Pager page={uidPage} totalPages={uidTotalPages} onChange={setUidPage} />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-8 pb-6">
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-xl border border-[#CBD5E1] bg-white px-7 text-sm font-semibold text-[#334155] shadow-sm hover:bg-[#F8FAFC]"
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            onClick={() => {
              const chosen = draftKeys.map((k) => pageCache[k]).filter(Boolean);
              onConfirm(chosen);
              onClose();
              toast.success(`Đã chọn ${chosen.length} Fanpage mục tiêu.`);
            }}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#1D4ED8] px-7 text-sm font-semibold text-white shadow-sm hover:bg-[#1E40AF]"
          >
            <Check className="size-4" />
            Xác nhận chọn ({draftKeys.length} page)
          </button>
        </div>
      </div>
    </div>
  );
}
