"use client";

import React, { useState, useEffect, useMemo, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Search,
  Users,
  Check,
  CheckSquare,
  Square,
  RefreshCw,
  Loader2,
  Folder,
  FolderOpen,
  Tag,
  ShieldCheck,
  AlertCircle,
  Copy,
  CheckCircle2,
  Filter,
} from "lucide-react";
import { seedingApi } from "../service";

const emptySubscribe = () => () => {};
const useIsMounted = () => useSyncExternalStore(emptySubscribe, () => true, () => false);

function initials(name = "") {
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
  const initial = initials(account?.profile_name || account?.uid);

  return (
    <div
      className="relative rounded-full overflow-hidden flex items-center justify-center shrink-0 font-bold text-white shadow-2xs border border-slate-200 select-none"
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
        <span>{initial}</span>
      )}
    </div>
  );
}

export function isAccountReady(acc) {
  const status = String(acc?.status || "").toLowerCase();
  const login = String(acc?.login_status || "").toLowerCase();
  return status === "live" && login === "logged_in";
}

export default function AccountSelectModal({
  isOpen,
  onClose,
  selectedUids = [],
  onConfirm,
  isRunning = false,
}) {
  const mounted = useIsMounted();
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [categorySearch, setCategorySearch] = useState("");
  // Set chứa các category ID (số) hoặc "all" hoặc "uncategorized"
  const [selectedCategories, setSelectedCategories] = useState(() => new Set(["all"]));
  const [draftSelected, setDraftSelected] = useState(() => new Set(selectedUids));
  const [copiedUid, setCopiedUid] = useState(null);

  // Đồng bộ draft selection khi mở popup hoặc prop selectedUids thay đổi
  useEffect(() => {
    if (isOpen) {
      setDraftSelected(new Set(selectedUids));
      setSelectedCategories(new Set(["all"]));
      setSearchQuery("");
      setCategorySearch("");
      loadData();
    }
  }, [isOpen, selectedUids]);

  // Khóa cuộn trang nền và bắt phím ESC
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      const handleKeyDown = (e) => {
        if (e.key === "Escape" && onClose) {
          onClose();
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => {
        document.body.style.overflow = "";
        window.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [isOpen, onClose]);

  // Tự động đóng popup nếu chiến dịch bắt đầu chạy
  useEffect(() => {
    if (isOpen && isRunning && onClose) {
      onClose();
    }
  }, [isOpen, isRunning, onClose]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [accsRes, catsRes] = await Promise.all([
        seedingApi.getAccounts(),
        seedingApi.getCategories(),
      ]);
      setAccounts(Array.isArray(accsRes) ? accsRes : []);
      setCategories(Array.isArray(catsRes) ? catsRes : []);
    } catch (err) {
      console.error("Lỗi nạp danh sách tài khoản:", err);
    } finally {
      setLoading(false);
    }
  };

  // Map category theo ID
  const categoryMap = useMemo(() => {
    const map = new Map();
    categories.forEach((cat) => {
      map.set(cat.id, cat);
    });
    return map;
  }, [categories]);

  // Thống kê số lượng theo danh mục (tổng, live, và số nick đã tích chọn)
  const categoryStats = useMemo(() => {
    const stats = {
      all: { total: 0, ready: 0, selected: 0 },
      uncategorized: { total: 0, ready: 0, selected: 0 },
      byCat: {},
    };

    categories.forEach((cat) => {
      stats.byCat[cat.id] = {
        id: cat.id,
        name: cat.name,
        color: cat.color || "#3B82F6",
        total: 0,
        ready: 0,
        selected: 0,
      };
    });

    accounts.forEach((acc) => {
      const ready = isAccountReady(acc);
      const isSelected = draftSelected.has(acc.uid);

      stats.all.total += 1;
      if (ready) stats.all.ready += 1;
      if (isSelected) stats.all.selected += 1;

      if (!acc.category_id || !stats.byCat[acc.category_id]) {
        stats.uncategorized.total += 1;
        if (ready) stats.uncategorized.ready += 1;
        if (isSelected) stats.uncategorized.selected += 1;
      } else {
        stats.byCat[acc.category_id].total += 1;
        if (ready) stats.byCat[acc.category_id].ready += 1;
        if (isSelected) stats.byCat[acc.category_id].selected += 1;
      }
    });

    return stats;
  }, [accounts, categories, draftSelected]);

  // Xử lý bật/tắt chọn danh mục (hỗ trợ chọn 1, 2 hoặc nhiều danh mục)
  const handleToggleCategory = (catKey) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);

      // Nếu bấm vào "Tất cả": reset chỉ chọn "Tất cả"
      if (catKey === "all") {
        return new Set(["all"]);
      }

      // Nếu đang ở chế độ "all", bỏ "all" và chỉ chọn danh mục vừa bấm
      if (next.has("all")) {
        next.delete("all");
        next.add(catKey);
        return next;
      }

      // Nếu danh mục đã được chọn, bỏ chọn nó
      if (next.has(catKey)) {
        next.delete(catKey);
        // Nếu không còn danh mục nào được chọn, tự động quay lại "Tất cả"
        if (next.size === 0) {
          return new Set(["all"]);
        }
      } else {
        // Tích chọn thêm danh mục (cho phép chọn 2, 3... danh mục)
        next.add(catKey);
      }

      return next;
    });
  };

  // Lọc danh sách danh mục theo ô tìm kiếm danh mục bên sidebar
  const filteredCategories = useMemo(() => {
    if (!categorySearch.trim()) return categories;
    const q = categorySearch.trim().toLowerCase();
    return categories.filter((c) => (c.name || "").toLowerCase().includes(q));
  }, [categories, categorySearch]);

  // Các tài khoản thuộc các danh mục đang chọn (chưa áp dụng ô tìm kiếm tài khoản)
  const accountsInSelectedCategories = useMemo(() => {
    if (selectedCategories.has("all")) {
      return accounts;
    }
    return accounts.filter((acc) => {
      if (!acc.category_id || !categoryMap.has(acc.category_id)) {
        return selectedCategories.has("uncategorized");
      }
      return selectedCategories.has(acc.category_id);
    });
  }, [accounts, selectedCategories, categoryMap]);

  // Tài khoản khả dụng thuộc các danh mục đang chọn
  const readyAccountsInSelectedCategories = useMemo(() => {
    return accountsInSelectedCategories.filter(isAccountReady);
  }, [accountsInSelectedCategories]);

  // Tài khoản đã tích chọn thuộc các danh mục đang chọn
  const selectedCountInCategories = useMemo(() => {
    return accountsInSelectedCategories.filter((acc) => draftSelected.has(acc.uid)).length;
  }, [accountsInSelectedCategories, draftSelected]);

  // Danh sách tài khoản hiển thị trên bảng (sau khi lọc danh mục VÀ tìm kiếm)
  const filteredAccounts = useMemo(() => {
    let list = accountsInSelectedCategories;

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((acc) => {
        const name = (acc.profile_name || "").toLowerCase();
        const uid = (acc.uid || "").toLowerCase();
        const email = (acc.email || "").toLowerCase();
        return name.includes(q) || uid.includes(q) || email.includes(q);
      });
    }

    return list;
  }, [accountsInSelectedCategories, searchQuery]);

  // Tài khoản khả dụng trong bảng hiển thị
  const readyAccountsInFilter = useMemo(() => {
    return filteredAccounts.filter(isAccountReady);
  }, [filteredAccounts]);

  // Tổng số tài khoản khả dụng trong hệ thống
  const totalReadyAccountsCount = useMemo(() => {
    return accounts.filter(isAccountReady).length;
  }, [accounts]);

  // Kiểm tra đã tích chọn hết trong view bảng chưa
  const isAllFilterSelected = useMemo(() => {
    if (readyAccountsInFilter.length === 0) return false;
    return readyAccountsInFilter.every((acc) => draftSelected.has(acc.uid));
  }, [readyAccountsInFilter, draftSelected]);

  const isSomeFilterSelected = useMemo(() => {
    if (isAllFilterSelected) return false;
    return readyAccountsInFilter.some((acc) => draftSelected.has(acc.uid));
  }, [readyAccountsInFilter, draftSelected, isAllFilterSelected]);

  // Bật/tắt chọn 1 tài khoản
  const handleToggleAccount = (uid, ready) => {
    if (!ready || isRunning) return;
    setDraftSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) {
        next.delete(uid);
      } else {
        next.add(uid);
      }
      return next;
    });
  };

  // Bật/tắt chọn tất cả nick trong bảng hiển thị hiện tại
  const handleToggleSelectAllInView = () => {
    if (isRunning) return;
    setDraftSelected((prev) => {
      const next = new Set(prev);
      if (isAllFilterSelected) {
        readyAccountsInFilter.forEach((acc) => next.delete(acc.uid));
      } else {
        readyAccountsInFilter.forEach((acc) => next.add(acc.uid));
      }
      return next;
    });
  };

  // Tích chọn toàn bộ nick thuộc các danh mục đang chọn
  const handleSelectAllInCategories = () => {
    if (isRunning) return;
    setDraftSelected((prev) => {
      const next = new Set(prev);
      readyAccountsInSelectedCategories.forEach((acc) => next.add(acc.uid));
      return next;
    });
  };

  // Bỏ chọn toàn bộ nick thuộc các danh mục đang chọn
  const handleDeselectAllInCategories = () => {
    if (isRunning) return;
    setDraftSelected((prev) => {
      const next = new Set(prev);
      accountsInSelectedCategories.forEach((acc) => next.delete(acc.uid));
      return next;
    });
  };

  // Bỏ chọn tất cả nick
  const handleClearAll = () => {
    if (isRunning) return;
    setDraftSelected(new Set());
  };

  // Xác nhận lưu lựa chọn
  const handleConfirm = () => {
    onConfirm?.(Array.from(draftSelected));
    onClose?.();
  };

  const handleCopyUid = (uid, e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(uid);
    setCopiedUid(uid);
    setTimeout(() => setCopiedUid(null), 1500);
  };

  // Tiêu đề tóm tắt các danh mục đang chọn để hiển thị trên bảng
  const selectedCategoriesSummary = useMemo(() => {
    if (selectedCategories.has("all")) {
      return "Tất cả danh mục";
    }
    const names = [];
    if (selectedCategories.has("uncategorized")) {
      names.push("Chưa phân loại");
    }
    categories.forEach((c) => {
      if (selectedCategories.has(c.id)) {
        names.push(c.name);
      }
    });
    if (names.length === 0) return "Tất cả danh mục";
    if (names.length <= 2) return names.join(" & ");
    return `${names.slice(0, 2).join(", ")} +${names.length - 2} danh mục khác`;
  }, [selectedCategories, categories]);

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-2 sm:p-4 select-none bg-slate-900/60 backdrop-blur-sm overflow-hidden animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div className="relative w-full max-w-5xl h-[92vh] max-h-[820px] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-100 bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/20 shrink-0">
              <Users className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 tracking-tight">
                Chọn tài khoản Facebook chạy Seeding
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Tích chọn 1 hoặc nhiều danh mục ở cột trái, sau đó chọn nick cụ thể bên phải (chỉ nick{" "}
                <span className="text-emerald-700 font-semibold">Live & Đã đăng nhập</span> mới hợp lệ).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all cursor-pointer"
            title="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 2-Column Body: Left Sidebar (Categories) & Right Pane (Account Table) */}
        <div className="flex-1 flex flex-col sm:flex-row min-h-0 overflow-hidden">
          {/* CỘT TRÁI: DANH MỤC TÀI KHOẢN (Cho phép tích chọn 1, 2 hoặc nhiều danh mục) */}
          <div className="w-full sm:w-72 lg:w-80 border-b sm:border-b-0 sm:border-r border-slate-200 bg-slate-50/70 flex flex-col shrink-0 min-h-0">
            {/* Header Sidebar Danh mục */}
            <div className="px-4 py-3 border-b border-slate-200/80 bg-slate-100/60 shrink-0 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Danh mục ({categories.length})
                </span>
              </div>
            </div>

            {/* Ô tìm kiếm danh mục (khi có nhiều danh mục) */}
            {categories.length > 3 && (
              <div className="p-2.5 border-b border-slate-200/60 bg-white/50 shrink-0">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    value={categorySearch}
                    onChange={(e) => setCategorySearch(e.target.value)}
                    placeholder="Tìm danh mục..."
                    className="w-full pl-8 pr-2.5 py-1 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-700 placeholder:text-slate-400"
                  />
                </div>
              </div>
            )}

            {/* Thao tác nhanh cho các danh mục đang tích chọn */}
            <div className="p-2.5 border-b border-slate-200/60 bg-white shrink-0 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
                <span>
                  Đang chọn:{" "}
                  <strong className="text-blue-700 font-bold">
                    {selectedCategories.has("all") ? "Tất cả danh mục" : `${selectedCategories.size} danh mục`}
                  </strong>
                </span>
                <span className="text-slate-400 text-[10px]">
                  ({readyAccountsInSelectedCategories.length} nick Live)
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={handleSelectAllInCategories}
                  disabled={readyAccountsInSelectedCategories.length === 0}
                  className="px-2 py-1.5 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200/80 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed text-center truncate"
                  title="Tích chọn tất cả các nick khả dụng trong các danh mục đang chọn"
                >
                  + Tích hết nick ({readyAccountsInSelectedCategories.length})
                </button>
                <button
                  type="button"
                  onClick={handleDeselectAllInCategories}
                  disabled={selectedCountInCategories === 0}
                  className="px-2 py-1.5 text-[11px] font-semibold text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed text-center truncate"
                  title="Bỏ chọn các nick thuộc các danh mục đang chọn"
                >
                  - Bỏ chọn nick
                </button>
              </div>
            </div>

            {/* Mục "Tất cả tài khoản" cố định phía trên, không bị cuộn mất khi kéo danh mục */}
            <div className="p-2 pb-1.5 shrink-0 bg-slate-50/90 border-b border-slate-200/70">
              <div
                onClick={() => handleToggleCategory("all")}
                className={`flex items-center justify-between p-2 rounded-xl border text-xs cursor-pointer transition-all ${
                  selectedCategories.has("all")
                    ? "bg-blue-50 border-blue-300 text-blue-900 shadow-2xs font-semibold"
                    : "bg-white hover:bg-slate-100/80 border-slate-200/70 text-slate-700 shadow-2xs"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="shrink-0 text-blue-600">
                    {selectedCategories.has("all") ? (
                      <CheckSquare className="w-4 h-4 text-blue-600" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-300" />
                    )}
                  </div>
                  <Folder className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="truncate font-medium">Tất cả tài khoản</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-1">
                  {categoryStats.all.selected > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-600 text-white shadow-2xs">
                      {categoryStats.all.selected} đã chọn
                    </span>
                  )}
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600">
                    {categoryStats.all.ready}/{categoryStats.all.total}
                  </span>
                </div>
              </div>
            </div>

            {/* Danh sách danh mục dọc có Checkbox tích chọn đa mục (Cuộn độc lập) */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin">
              {/* Mục "Chưa phân loại" (nếu có nick chưa phân loại) */}
              {categoryStats.uncategorized.total > 0 &&
                (() => {
                  const isChecked = selectedCategories.has("uncategorized");
                  return (
                    <div
                      onClick={() => handleToggleCategory("uncategorized")}
                      className={`flex items-center justify-between p-2 rounded-xl border text-xs cursor-pointer transition-all ${
                        isChecked
                          ? "bg-blue-50 border-blue-300 text-blue-900 shadow-2xs font-semibold"
                          : "bg-white hover:bg-slate-100/80 border-slate-200/70 text-slate-700"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="shrink-0">
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-blue-600" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-300" />
                          )}
                        </div>
                        <Tag className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">Chưa phân loại</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-1">
                        {categoryStats.uncategorized.selected > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-600 text-white shadow-2xs">
                            {categoryStats.uncategorized.selected}
                          </span>
                        )}
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600">
                          {categoryStats.uncategorized.ready}
                        </span>
                      </div>
                    </div>
                  );
                })()}

              {/* Phân cách danh mục */}
              {filteredCategories.length > 0 && (
                <div className="pt-1.5 pb-0.5 px-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Danh mục cụ thể
                </div>
              )}

              {/* Danh sách từng danh mục */}
              {filteredCategories.map((cat) => {
                const stat = categoryStats.byCat[cat.id] || { total: 0, ready: 0, selected: 0 };
                const isChecked = selectedCategories.has(cat.id);

                return (
                  <div
                    key={cat.id}
                    onClick={() => handleToggleCategory(cat.id)}
                    className={`flex items-center justify-between p-2 rounded-xl border text-xs cursor-pointer transition-all ${
                      isChecked
                        ? "bg-blue-50 border-blue-300 text-blue-900 shadow-2xs font-semibold"
                        : "bg-white hover:bg-slate-100/80 border-slate-200/70 text-slate-700"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="shrink-0">
                        {isChecked ? (
                          <CheckSquare className="w-4 h-4 text-blue-600" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-300" />
                        )}
                      </div>
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0 shadow-2xs"
                        style={{ backgroundColor: cat.color || "#3B82F6" }}
                      />
                      <span className="truncate" title={cat.name}>
                        {cat.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 ml-1">
                      {stat.selected > 0 && (
                        <span
                          className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-600 text-white shadow-2xs"
                          title={`${stat.selected} nick trong danh mục này đã được tích chọn`}
                        >
                          {stat.selected}
                        </span>
                      )}
                      <span
                        className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                          isChecked ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {stat.ready}/{stat.total}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* CỘT PHẢI: BẢNG TÀI KHOẢN FACEBOOK */}
          <div className="flex-1 flex flex-col min-w-0 bg-white min-h-0">
            {/* Thanh Tìm kiếm & Thao tác chọn tài khoản */}
            <div className="px-5 py-2.5 border-b border-slate-100 flex items-center justify-between gap-3 shrink-0 bg-white">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm theo tên Facebook, UID..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800 placeholder:text-slate-400 bg-slate-50/50"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleToggleSelectAllInView}
                  disabled={readyAccountsInFilter.length === 0}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200/80 transition-all cursor-pointer disabled:opacity-40"
                  title="Chọn tất cả nick khả dụng đang hiển thị trong bảng"
                >
                  {isAllFilterSelected ? "Bỏ chọn trang này" : `Chọn trang này (${readyAccountsInFilter.length})`}
                </button>
                <button
                  type="button"
                  onClick={handleClearAll}
                  disabled={draftSelected.size === 0}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200/60 transition-all cursor-pointer disabled:opacity-40"
                  title="Bỏ tích toàn bộ các tài khoản đã chọn"
                >
                  Bỏ chọn tất cả
                </button>
                <button
                  type="button"
                  onClick={loadData}
                  disabled={loading}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 border border-slate-200 transition-all cursor-pointer disabled:opacity-50"
                  title="Tải lại danh sách tài khoản"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {/* Thông báo bộ lọc danh mục đang xem */}
            <div className="px-5 py-2 bg-slate-50/60 border-b border-slate-100 text-xs flex items-center justify-between shrink-0">
              <div className="flex items-center gap-1.5 text-slate-600">
                <Filter className="w-3.5 h-3.5 text-blue-600" />
                <span>Đang hiển thị:</span>
                <span className="font-bold text-slate-800 px-2 py-0.5 rounded-md bg-white border border-slate-200">
                  {selectedCategoriesSummary}
                </span>
              </div>
              <span className="text-[11px] text-slate-500">
                Hiển thị <strong>{filteredAccounts.length}</strong> nick (
                <strong className="text-emerald-700">{readyAccountsInFilter.length}</strong> khả dụng)
              </span>
            </div>

            {/* Vùng Bảng Danh sách tài khoản (Cuộn dọc) */}
            <div className="flex-1 overflow-y-auto px-5 py-2 min-h-0 scrollbar-thin">
              {loading && accounts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
                  <Loader2 className="w-7 h-7 animate-spin text-blue-600" />
                  <p className="text-xs">Đang tải danh sách tài khoản và danh mục...</p>
                </div>
              ) : filteredAccounts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-2">
                  <Users className="w-8 h-8 text-slate-300" />
                  <p className="text-xs font-medium text-slate-600">Không tìm thấy tài khoản nào phù hợp.</p>
                  <p className="text-[11px] text-slate-400">
                    Vui lòng thử tìm từ khóa khác hoặc tích chọn thêm danh mục ở cột bên trái.
                  </p>
                </div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-white z-10 text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
                    <tr>
                      <th className="w-10 py-2.5 px-2">
                        <button
                          type="button"
                          onClick={handleToggleSelectAllInView}
                          disabled={readyAccountsInFilter.length === 0}
                          className="p-1 rounded hover:bg-slate-100 text-slate-600 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                          title={isAllFilterSelected ? "Bỏ chọn tất cả nick đang xem" : "Chọn tất cả nick đang xem"}
                        >
                          {isAllFilterSelected ? (
                            <CheckSquare className="w-4 h-4 text-blue-600" />
                          ) : isSomeFilterSelected ? (
                            <div className="w-4 h-4 rounded border-2 border-blue-600 bg-blue-50 flex items-center justify-center">
                              <div className="w-2 h-0.5 bg-blue-600" />
                            </div>
                          ) : (
                            <Square className="w-4 h-4 text-slate-400" />
                          )}
                        </button>
                      </th>
                      <th className="py-2.5 px-3">Tài khoản Facebook</th>
                      <th className="py-2.5 px-3 w-36">Danh mục</th>
                      <th className="py-2.5 px-3 w-28 text-center">Trạng thái</th>
                      <th className="py-2.5 px-3 w-36 text-center">Phiên đăng nhập</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAccounts.map((acc, idx) => {
                      const ready = isAccountReady(acc);
                      const isChecked = draftSelected.has(acc.uid);
                      const cat = acc.category_id ? categoryMap.get(acc.category_id) : null;
                      const isLive = String(acc.status || "").toLowerCase() === "live";
                      const isLoggedIn = String(acc.login_status || "").toLowerCase() === "logged_in";

                      return (
                        <tr
                          key={acc.uid}
                          onClick={() => handleToggleAccount(acc.uid, ready)}
                          className={`transition-colors ${
                            ready
                              ? isChecked
                                ? "bg-blue-50/50 hover:bg-blue-50/80 cursor-pointer"
                                : "hover:bg-slate-50/80 cursor-pointer"
                              : "opacity-45 bg-slate-50/30 cursor-not-allowed"
                          }`}
                        >
                          {/* Checkbox */}
                          <td className="py-2.5 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => handleToggleAccount(acc.uid, ready)}
                              disabled={!ready}
                              className="p-1 rounded hover:bg-slate-100 transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {isChecked ? (
                                <CheckSquare className="w-4 h-4 text-blue-600" />
                              ) : (
                                <Square className="w-4 h-4 text-slate-300" />
                              )}
                            </button>
                          </td>

                          {/* Account info: Avatar, Name, UID */}
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-3">
                              {/* Avatar */}
                              <AccountAvatar account={acc} index={idx} size={32} />

                              {/* Name & UID */}
                              <div className="min-w-0">
                                <p className="font-bold text-slate-900 truncate">
                                  {acc.profile_name || "Chưa có tên"}
                                </p>
                                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                                  <span>UID: {acc.uid}</span>
                                  <button
                                    type="button"
                                    onClick={(e) => handleCopyUid(acc.uid, e)}
                                    className="hover:text-blue-600 transition-colors"
                                    title="Sao chép UID"
                                  >
                                    {copiedUid === acc.uid ? (
                                      <Check className="w-3 h-3 text-emerald-600" />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Category badge */}
                          <td className="py-2.5 px-3">
                            {cat ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: cat.color || "#3B82F6" }}
                                />
                                <span className="truncate max-w-[100px]">{cat.name}</span>
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-400 italic">Chưa phân loại</span>
                            )}
                          </td>

                          {/* Status Live/Die */}
                          <td className="py-2.5 px-3 text-center">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                isLive
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200/60"
                                  : "bg-rose-50 text-rose-700 border border-rose-200/60"
                              }`}
                            >
                              {String(acc.status || "UNKNOWN").toUpperCase()}
                            </span>
                          </td>

                          {/* Login Status */}
                          <td className="py-2.5 px-3 text-center">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                isLoggedIn
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200/60"
                                  : "bg-slate-100 text-slate-600 border border-slate-200"
                              }`}
                            >
                              {isLoggedIn ? (
                                <>
                                  <ShieldCheck className="w-3 h-3 text-emerald-600" />
                                  Đã đăng nhập
                                </>
                              ) : (
                                <>
                                  <AlertCircle className="w-3 h-3 text-slate-400" />
                                  Chưa đăng nhập
                                </>
                              )}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 font-medium">Đã tích chọn:</span>
              <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 font-bold text-xs">
                {draftSelected.size} tài khoản
              </span>
              <span className="text-slate-400 text-[11px]">
                / {totalReadyAccountsCount} khả dụng toàn hệ thống
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-all cursor-pointer shadow-sm"
            >
              Hủy bỏ
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={draftSelected.size === 0 || isRunning}
              title={isRunning ? "Đang chạy seeding, không thể xác nhận thay đổi" : undefined}
              className={`px-5 py-2 rounded-xl text-xs font-bold transition-all shadow-md ${
                draftSelected.size === 0 || isRunning
                  ? "bg-slate-200 text-slate-400 border border-slate-300/80 cursor-not-allowed shadow-none"
                  : "bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20 active:scale-[0.98] cursor-pointer"
              }`}
            >
              Xác nhận ({draftSelected.size} tài khoản)
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
