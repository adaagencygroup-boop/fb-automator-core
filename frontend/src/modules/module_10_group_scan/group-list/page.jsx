"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Folder,
  Plus,
  Search,
  Pencil,
  Trash2,
  FolderInput,
  ExternalLink,
  MoreVertical,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { toast } from "@/lib/toast";
import Pagination from "@/components/ui/pagination";
import CustomSelect from "@/components/ui/custom-select";
import {
  getScannedGroups,
  getScanCategories,
  deleteScannedGroup,
  deleteScannedGroupsBulk,
  createScanCategory,
  updateScanCategory,
  deleteScanCategory,
  moveGroupsToCategory,
} from "../service";

const TYPE_FILTER_OPTIONS = [
  { value: "all", label: "Loại nhóm: Tất cả" },
  { value: "public", label: "Công khai" },
  { value: "private", label: "Riêng tư" },
];

const MEMBERS_FILTER_OPTIONS = [
  { value: "all", label: "Thành viên: Tất cả" },
  { value: "under50k", label: "Dưới 50.000" },
  { value: "50k_200k", label: "50.000 - 200.000" },
  { value: "over200k", label: "Trên 200.000" },
];

const NOTE_FILTER_OPTIONS = [
  { value: "all", label: "Ghi chú: Tất cả" },
  { value: "joined", label: "Đã tham gia" },
  { value: "pending", label: "Đang chờ QTV duyệt" },
  { value: "none", label: "Chưa có ghi chú" },
];

const PAGE_SIZE_OPTIONS = [
  { value: 8, label: "8" },
  { value: 15, label: "15" },
  { value: 30, label: "30" },
];

export default function GroupScanListPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState([
    {
      id: "cat-all",
      name: "Tất cả nhóm đã quét",
      description: "Toàn bộ nhóm lưu trong CSDL",
      sub: "0 nhóm FB",
    },
  ]);
  const [activeCategoryId, setActiveCategoryId] = useState("cat-all");
  const [categorySearch, setCategorySearch] = useState("");
  const [groups, setGroups] = useState([]);
  const [dbKeywords, setDbKeywords] = useState([]);

  // Bộ lọc bên phải
  const [tableSearch, setTableSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [membersFilter, setMembersFilter] = useState("all");
  const [noteFilter, setNoteFilter] = useState("all");

  // Selection
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // Phân trang
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);

  // Modals state
  const [showAddCatModal, setShowAddCatModal] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [showEditCatModal, setShowEditCatModal] = useState(false);
  const [editCatName, setEditCatName] = useState("");
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [targetCatId, setTargetCatId] = useState("");
  const [menuAnchor, setMenuAnchor] = useState(null); // { id, cat, top, right }

  // Tự động đóng 3-dots menu khi click ra ngoài hoặc cuộn
  useEffect(() => {
    if (!menuAnchor) return;
    const handleClose = () => setMenuAnchor(null);
    window.addEventListener("click", handleClose);
    window.addEventListener("scroll", handleClose, true);
    return () => {
      window.removeEventListener("click", handleClose);
      window.removeEventListener("scroll", handleClose, true);
    };
  }, [menuAnchor]);

  // Nạp danh sách nhóm từ Database (chỉ làm việc với các bảng chuẩn trong DB)
  const loadGroups = useCallback(async (isRefresh = false) => {
    setLoading(true);
    try {
      if (typeof window !== "undefined") {
        try {
          localStorage.removeItem("fb_scanned_groups_cache");
        } catch {}
      }

      const [res, catsRes] = await Promise.all([
        getScannedGroups(),
        getScanCategories(),
      ]);
      const loadedGroups = res?.groups || [];
      const kws = res?.keywords || [];
      const dbCats = (catsRes && catsRes.length > 0) ? catsRes : (res?.categories || []);

      setGroups(loadedGroups);
      setDbKeywords(kws);

      const catAll = {
        id: "cat-all",
        name: "Tất cả nhóm đã quét",
        description: "Toàn bộ nhóm lưu trong CSDL",
        sub: `${loadedGroups.length} nhóm FB`,
      };

      // Chỉ hiển thị các danh mục từ bảng scanned_group_categories
      const scannedCategories = dbCats.map((c) => ({
        id: c.id,
        name: c.name,
        isCustom: true,
        description: c.description || "Danh mục nhóm",
        sub: `${c.count || 0} nhóm FB`,
        count: c.count || 0,
      }));

      setCategories([catAll, ...scannedCategories]);

      if (isRefresh) {
        toast.success("Đã làm mới danh sách nhóm từ Database!");
      }
    } catch (err) {
      console.warn("[Group List]", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  // Active Category Object
  const activeCategory = useMemo(() => {
    return (
      categories.find((c) => c.id === activeCategoryId) ||
      categories[0] || {
        id: "cat-all",
        name: "Tất cả nhóm đã quét",
      }
    );
  }, [categories, activeCategoryId]);

  // Lọc danh mục bên trái theo từ khóa
  const filteredCategories = useMemo(() => {
    if (!categorySearch.trim()) return categories;
    const term = categorySearch.toLowerCase().trim();
    return categories.filter((c) => c.name.toLowerCase().includes(term));
  }, [categories, categorySearch]);

  // Các nhóm thuộc danh mục đang chọn
  const categoryGroups = useMemo(() => {
    if (activeCategoryId === "cat-all") return groups;
    return groups.filter((g) => {
      const cname = activeCategory?.name;
      if (cname) {
        if ((g.category_name || "").toLowerCase() === cname.toLowerCase()) return true;
        if ((g.keyword || "").toLowerCase() === cname.toLowerCase()) return true;
      }
      if (g.categoryId === activeCategoryId) return true;
      if (String(g.categoryId) === `cat-${activeCategoryId}`) return true;
      if (`cat-${g.categoryId}` === String(activeCategoryId)) return true;
      return false;
    });
  }, [groups, activeCategoryId, activeCategory]);

  // Thống kê 4 thẻ Summary Cards
  const stats = useMemo(() => {
    const totalGroups = categoryGroups.length;
    let totalMembersCount = 0;
    let nonModerated = 0; // Công khai
    let moderated = 0; // Riêng tư

    categoryGroups.forEach((g) => {
      if (g.membersCount) {
        totalMembersCount += g.membersCount;
      }
      if (g.type === "public") {
        nonModerated += 1;
      } else {
        moderated += 1;
      }
    });

    const formatNumber = (num) => num.toLocaleString("vi-VN");

    return {
      totalGroups,
      totalMembersFormatted: formatNumber(totalMembersCount),
      nonModerated,
      moderated,
    };
  }, [categoryGroups]);

  // Lọc nhóm trong bảng theo Toolbar tìm kiếm & dropdowns
  const filteredGroups = useMemo(() => {
    return categoryGroups.filter((g) => {
      // 1. Text search (tên nhóm hoặc UID / keyword / URL)
      if (tableSearch.trim()) {
        const term = tableSearch.toLowerCase().trim();
        const matchName = (g.name || "").toLowerCase().includes(term);
        const matchKey = (g.keyword || "").toLowerCase().includes(term);
        const matchUrl = (g.url || "").toLowerCase().includes(term);
        const matchGid = (g.group_id || "").toLowerCase().includes(term);
        if (!matchName && !matchKey && !matchUrl && !matchGid) return false;
      }

      // 2. Filter Loại nhóm
      if (typeFilter !== "all") {
        if (typeFilter === "public" && g.type !== "public") return false;
        if (typeFilter === "private" && g.type !== "private") return false;
      }

      // 3. Filter Thành viên
      if (membersFilter !== "all") {
        const count = g.membersCount || 0;
        if (membersFilter === "under50k" && count >= 50000) return false;
        if (membersFilter === "50k_200k" && (count < 50000 || count > 200000))
          return false;
        if (membersFilter === "over200k" && count <= 200000) return false;
      }

      // 4. Filter Ghi chú
      if (noteFilter !== "all") {
        const note = g.note || "—";
        if (noteFilter === "joined" && !note.includes("Đã tham gia")) return false;
        if (noteFilter === "pending" && !note.includes("Đang chờ")) return false;
        if (noteFilter === "none" && note !== "—") return false;
      }

      return true;
    });
  }, [categoryGroups, tableSearch, typeFilter, membersFilter, noteFilter]);

  // Pagination calculation
  const totalItems = filteredGroups.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedGroups = useMemo(() => {
    return filteredGroups.slice(startIndex, startIndex + pageSize);
  }, [filteredGroups, startIndex, pageSize]);

  // Select all checkbox handler
  const allCurrentPageSelected = useMemo(() => {
    if (paginatedGroups.length === 0) return false;
    return paginatedGroups.every((g) => selectedIds.has(g.id));
  }, [paginatedGroups, selectedIds]);

  const toggleSelectAll = () => {
    const next = new Set(selectedIds);
    if (allCurrentPageSelected) {
      paginatedGroups.forEach((g) => next.delete(g.id));
    } else {
      paginatedGroups.forEach((g) => next.add(g.id));
    }
    setSelectedIds(next);
  };

  const toggleSelectRow = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  // Thêm danh mục tự tạo lưu vào Database
  const handleAddCategory = async () => {
    if (!newCatName.trim()) {
      toast.warn("Vui lòng nhập tên danh mục!");
      return;
    }
    const catName = newCatName.trim();
    try {
      await createScanCategory(catName);
      await loadGroups();
      setNewCatName("");
      setShowAddCatModal(false);
      toast.success(`Đã tạo danh mục "${catName}" thành công!`);
    } catch (err) {
      console.error(err);
      toast.error("Không thể tạo danh mục");
    }
  };

  // Sửa danh mục trong Database (bảng scanned_group_categories)
  const handleEditCategory = async () => {
    if (!editCatName.trim()) {
      toast.warn("Tên danh mục không được để trống!");
      return;
    }
    const targetCat = categories.find((c) => c.id === activeCategoryId);
    const catIdOrName = targetCat?.id || activeCategoryId;
    try {
      await updateScanCategory(catIdOrName, editCatName.trim());
      await loadGroups();
      setShowEditCatModal(false);
      toast.success("Đã cập nhật danh mục thành công trong Database!");
    } catch (err) {
      console.error(err);
      toast.error("Không thể cập nhật danh mục trong Database");
    }
  };

  // Xóa danh mục khỏi Database (bảng scanned_group_categories và liên kết nhóm)
  const handleDeleteCategory = async (catId) => {
    if (catId === "cat-all") {
      toast.error("Không thể xóa danh mục tổng!");
      return;
    }
    const catToDelete = categories.find((c) => c.id === catId);
    try {
      await deleteScanCategory(catId);
      await loadGroups();
      if (activeCategoryId === catId) {
        setActiveCategoryId("cat-all");
      }
      setShowEditCatModal(false);
      setActiveMenuCatId(null);
      toast.success(`Đã xóa danh mục "${catToDelete?.name || ""}" khỏi Database!`);
    } catch (err) {
      console.error(err);
      toast.error("Không thể xóa danh mục trong Database");
    }
  };

  // Chuyển nhóm sang danh mục khác trong Database (bảng scanned_group_category_groups)
  const handleMoveGroups = async () => {
    if (!targetCatId) {
      toast.warn("Vui lòng chọn danh mục đích!");
      return;
    }
    const count = selectedIds.size;
    const targetCat = categories.find((c) => c.id === targetCatId);
    if (!targetCat?.name) {
      toast.warn("Danh mục đích không hợp lệ!");
      return;
    }
    try {
      await moveGroupsToCategory({
        categoryName: targetCat.name,
        groupIds: Array.from(selectedIds),
      });
      await loadGroups();
      setSelectedIds(new Set());
      setShowMoveModal(false);
      toast.success(
        `Đã chuyển ${count} nhóm sang danh mục "${targetCat.name}" trong Database!`
      );
    } catch (err) {
      console.error(err);
      toast.error("Lỗi khi chuyển danh mục nhóm!");
    }
  };

  // Xóa các nhóm đã chọn khỏi Database (bảng scanned_groups)
  const handleDeleteSelectedGroups = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    const ids = Array.from(selectedIds);
    try {
      await deleteScannedGroupsBulk(ids);
      await loadGroups();
      setSelectedIds(new Set());
      toast.success(`Đã xóa ${count} nhóm thành công khỏi Database!`);
    } catch (err) {
      console.error(err);
      toast.error("Lỗi khi xóa nhóm khỏi Database!");
    }
  };

  return (
    <div className="-m-6 min-h-full space-y-5 bg-[#F4F7FC] p-6">
      {/* ======================================================== */}
      {/* MAIN LAYOUT: LEFT FOLDER PANEL & RIGHT DETAIL SECTION */}
      {/* ======================================================== */}
      <div className="flex flex-col lg:flex-row gap-5 items-start w-full">
        {/* ──────────────────────────────────────────────────────── */}
        {/* LEFT COLUMN: DANH SÁCH DANH MỤC (Width 320px) */}
        {/* ──────────────────────────────────────────────────────── */}
        <div className="w-full lg:w-[320px] shrink-0 bg-white border border-[#E2E8F0] shadow-sm rounded-xl p-4 flex flex-col justify-between min-h-[640px]">
          <div className="flex flex-col">
            {/* Header of Category Box */}
            <div className="flex items-center justify-between pb-3 border-b border-[#F1F5F9]">
              <div className="flex items-center gap-2">
                <Folder className="w-4 h-4 text-[#2563EB] fill-[#2563EB]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#334155]">
                  DANH SÁCH DANH MỤC
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowAddCatModal(true)}
                title="Tạo danh mục mới"
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 font-bold text-sm transition-colors"
              >
                +
              </button>
            </div>

            {/* Stats summary */}
            <div className="py-2.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-[#1E293B]">
                {categories.length} Thư mục ({groups.length} nhóm FB)
              </span>
              <button
                type="button"
                onClick={() => loadGroups(true)}
                title="Đồng bộ lại từ DB"
                className="text-slate-400 hover:text-blue-600 transition-colors p-1"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-blue-600" : ""}`} />
              </button>
            </div>

            {/* Filter input */}
            <div className="relative w-full mb-3">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-[#94A3B8]" />
              <input
                type="text"
                value={categorySearch}
                onChange={(e) => setCategorySearch(e.target.value)}
                placeholder="Lọc danh mục thư mục..."
                className="w-full h-[30px] rounded-lg border border-[#E2E8F0] bg-white pl-8 pr-3 text-xs text-[#1E293B] placeholder:text-[#6B7280] focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            {/* Folder Item List */}
            <div className="flex flex-col gap-2 max-h-[460px] overflow-y-auto pr-0.5">
              {filteredCategories.map((cat) => {
                const isActive = cat.id === activeCategoryId;
                const catGroupCount =
                  cat.id === "cat-all"
                    ? groups.length
                    : groups.filter((g) => {
                        const cname = cat.name;
                        if (cname) {
                          if ((g.category_name || "").toLowerCase() === cname.toLowerCase()) return true;
                          if ((g.keyword || "").toLowerCase() === cname.toLowerCase()) return true;
                        }
                        if (g.categoryId === cat.id) return true;
                        return false;
                      }).length;

                return (
                  <div
                    key={cat.id}
                    onClick={() => {
                      setActiveCategoryId(cat.id);
                      setPage(1);
                    }}
                    className={`h-16 p-3 rounded-lg flex items-center justify-between cursor-pointer transition-all relative ${
                      isActive
                        ? "bg-[#EFF6FF]/60 border border-[#3B82F6]"
                        : "bg-white border border-[#F1F5F9] hover:border-slate-300"
                    }`}
                  >
                    <div className="flex flex-col gap-0.5 min-w-0 pr-2">
                      <div className="flex items-center gap-1.5 truncate">
                        <span
                          className={`text-sm font-semibold truncate ${
                            isActive ? "text-[#0F172A]" : "text-[#1E293B]"
                          }`}
                        >
                          {cat.name}
                        </span>
                      </div>
                      <span
                        className={`text-xs truncate ${
                          isActive ? "text-[#64748B]" : "text-[#94A3B8]"
                        }`}
                      >
                        {catGroupCount} nhóm FB
                        {cat.sub && cat.sub.includes("•") ? ` • ${cat.sub.split("•")[1].trim()}` : ""}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isActive && (
                        <span className="w-2 h-2 rounded-full bg-[#2563EB]" />
                      )}
                      {cat.id !== "cat-all" && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (menuAnchor?.id === cat.id) {
                              setMenuAnchor(null);
                            } else {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const spaceBelow = window.innerHeight - rect.bottom;
                              const openUp = spaceBelow < 120;
                              setMenuAnchor({
                                id: cat.id,
                                cat,
                                top: openUp ? rect.top - 76 : rect.bottom + 4,
                                right: window.innerWidth - rect.right,
                              });
                            }
                          }}
                          className="p-1 rounded hover:bg-slate-100 text-[#94A3B8] hover:text-slate-600 transition-colors"
                          title="Tùy chọn danh mục"
                        >
                          <MoreVertical className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer Button: + Thêm danh mục */}
          {/* <button
            type="button"
            onClick={() => setShowAddCatModal(true)}
            className="pt-3 border-t border-[#F1F5F9] flex items-center gap-2 text-xs font-semibold text-[#475569] hover:text-[#2563EB] transition-colors w-full text-left"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Thêm danh mục</span>
          </button> */}
        </div>

        {/* ──────────────────────────────────────────────────────── */}
        {/* RIGHT COLUMN: DETAIL SECTION (4 CARDS + TABLE + TOOLBAR) */}
        {/* ──────────────────────────────────────────────────────── */}
        <div className="flex-1 w-full bg-white border border-[#E2E8F0] shadow-sm rounded-xl p-6 flex flex-col gap-4 min-w-0">
          {/* Detail Title & Action */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold tracking-tight text-[#0F172A]">
                {activeCategory.name}
              </h2>
              {loading && (
                <span className="flex items-center gap-1 text-xs text-blue-600">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang tải...
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => loadGroups(true)}
                title="Tải lại từ DB"
                className="h-[30px] px-3 bg-white border border-[#CBD5E1] shadow-sm rounded-lg text-xs font-medium text-[#334155] flex items-center gap-1.5 hover:bg-slate-50 transition-colors"
              >
                <RefreshCw className="w-3 h-3 text-[#64748B]" />
                <span>Làm mới</span>
              </button>
              {activeCategory.id !== "cat-all" && (
                <button
                  type="button"
                  onClick={() => {
                    setEditCatName(activeCategory.name);
                    setShowEditCatModal(true);
                  }}
                  className="h-[30px] px-3.5 py-1.5 bg-white border border-[#CBD5E1] shadow-sm rounded-lg text-xs font-medium text-[#334155] flex items-center gap-1.5 hover:bg-slate-50 transition-colors"
                >
                  <Pencil className="w-3 h-3 text-[#64748B]" />
                  <span>Sửa danh mục</span>
                </button>
              )}
            </div>
          </div>

          {/* 4 Summary Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Card 1: Tổng số nhóm */}
            <div className="bg-[#F8FAFC]/70 border border-[#E2E8F0]/80 rounded-xl p-3.5 text-center flex flex-col items-center justify-center gap-1.5 h-[90px]">
              <span className="text-xs font-medium text-[#64748B]">
                Tổng số nhóm
              </span>
              <span className="text-2xl font-bold text-[#0F172A] leading-8">
                {stats.totalGroups}
              </span>
            </div>

            {/* Card 2: Tổng thành viên (Highlighted Blue) */}
            <div className="bg-[#EFF6FF]/60 border border-[#DBEAFE] rounded-xl p-3.5 text-center flex flex-col items-center justify-center gap-1.5 h-[90px]">
              <span className="text-xs font-medium text-[#64748B]">
                Tổng thành viên
              </span>
              <span className="text-2xl font-bold text-[#2563EB] leading-8">
                {stats.totalMembersFormatted}
              </span>
            </div>

            {/* Card 3: Không kiểm duyệt */}
            <div className="bg-[#F8FAFC]/70 border border-[#E2E8F0]/80 rounded-xl p-3.5 text-center flex flex-col items-center justify-center gap-1.5 h-[90px]">
              <span className="text-xs font-medium text-[#64748B]">
                Không kiểm duyệt
              </span>
              <span className="text-2xl font-bold text-[#0F172A] leading-8">
                {stats.nonModerated}
              </span>
            </div>

            {/* Card 4: Có kiểm duyệt */}
            <div className="bg-[#F8FAFC]/70 border border-[#E2E8F0]/80 rounded-xl p-3.5 text-center flex flex-col items-center justify-center gap-1.5 h-[90px]">
              <span className="text-xs font-medium text-[#64748B]">
                Có kiểm duyệt
              </span>
              <span className="text-2xl font-bold text-[#0F172A] leading-8">
                {stats.moderated}
              </span>
            </div>
          </div>

          {/* Search & Filters Toolbar */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            {/* Search Input */}
            <div className="relative flex-1 w-full">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#94A3B8]" />
              <input
                type="text"
                value={tableSearch}
                onChange={(e) => {
                  setTableSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Tìm theo tên nhóm, UID, từ khóa hoặc URL..."
                className="w-full h-[34px] rounded-lg border border-[#E2E8F0] bg-white pl-8 pr-3 text-xs text-[#1E293B] placeholder:text-[#6B7280] focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            {/* Filter: Loại nhóm */}
            <div className="w-full sm:w-auto shrink-0 min-w-[140px]">
              <CustomSelect
                value={typeFilter}
                onChange={(val) => {
                  setTypeFilter(val);
                  setPage(1);
                }}
                options={TYPE_FILTER_OPTIONS}
                size="sm"
                buttonClassName="h-[34px]"
              />
            </div>

            {/* Filter: Thành viên */}
            <div className="w-full sm:w-auto shrink-0 min-w-[150px]">
              <CustomSelect
                value={membersFilter}
                onChange={(val) => {
                  setMembersFilter(val);
                  setPage(1);
                }}
                options={MEMBERS_FILTER_OPTIONS}
                size="sm"
                buttonClassName="h-[34px]"
              />
            </div>

            {/* Filter: Ghi chú */}
            <div className="w-full sm:w-auto shrink-0 min-w-[150px]">
              <CustomSelect
                value={noteFilter}
                onChange={(val) => {
                  setNoteFilter(val);
                  setPage(1);
                }}
                options={NOTE_FILTER_OPTIONS}
                size="sm"
                buttonClassName="h-[34px]"
              />
            </div>
          </div>

          {/* Batch Action Bar - Chỉ hiển thị khi có ít nhất 1 nhóm được tích chọn */}
          {selectedIds.size > 0 && (
            <div className="h-11 px-4 rounded-lg bg-[#EFF6FF]/70 border border-[#BFDBFE] flex items-center justify-between animate-in fade-in duration-150">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedIds.size > 0}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-blue-500 text-blue-600 focus:ring-blue-500 cursor-pointer accent-[#2563EB]"
                />
                <span className="text-xs font-semibold text-[#1E3A8A]">
                  Đã chọn {selectedIds.size} / {filteredGroups.length} nhóm
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (categories.length <= 1) {
                      toast.warn("Chưa có danh mục khác để chuyển!");
                      return;
                    }
                    const otherCat = categories.find(
                      (c) => c.id !== activeCategoryId
                    );
                    setTargetCatId(otherCat ? otherCat.id : "");
                    setShowMoveModal(true);
                  }}
                  className="h-[28px] px-3 rounded-lg border border-[#CBD5E1] bg-white text-xs font-medium text-[#334155] flex items-center gap-1.5 hover:bg-slate-50 transition-colors shadow-2xs"
                >
                  <FolderInput className="w-3.5 h-3.5 text-[#64748B]" />
                  <span>Chuyển mục</span>
                </button>

                <button
                  type="button"
                  onClick={handleDeleteSelectedGroups}
                  className="h-[28px] px-3 rounded-lg border border-[#FECACA] bg-[#FEF2F2] text-xs font-medium text-[#93000A] flex items-center gap-1 hover:bg-red-100 transition-colors shadow-2xs"
                >
                  <Trash2 className="w-3.5 h-3.5 text-[#93000A]" />
                  <span>Xóa</span>
                </button>
              </div>
            </div>
          )}

          {/* Data Table */}
          <div className="border border-[#E2E8F0] rounded-lg overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[700px]">
              <thead>
                <tr className="bg-[#F8FAFC]/80 border-b border-[#E2E8F0] h-[48px]">
                  <th className="w-10 px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={allCurrentPageSelected}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer accent-[#2563EB]"
                    />
                  </th>
                  <th className="w-12 px-2 py-2 text-center text-[11px] font-bold uppercase text-[#475569]">
                    STT
                  </th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase text-[#475569]">
                    TỪ KHÓA
                  </th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase text-[#475569]">
                    TÊN NHÓM
                  </th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase text-[#475569]">
                    LOẠI NHÓM
                  </th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase text-[#475569] text-right">
                    THÀNH VIÊN
                  </th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase text-[#475569]">
                    LIÊN KẾT / URL NHÓM
                  </th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase text-[#475569]">
                    GHI CHÚ
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-xs text-slate-500">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                        <span>Đang tải danh sách nhóm từ Database...</span>
                      </div>
                    </td>
                  </tr>
                ) : paginatedGroups.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-12 text-center text-xs text-slate-400"
                    >
                      Không tìm thấy nhóm nào phù hợp trong danh mục này.
                    </td>
                  </tr>
                ) : (
                  paginatedGroups.map((g, index) => {
                    const isChecked = selectedIds.has(g.id);
                    return (
                      <tr
                        key={g.id}
                        className={`hover:bg-slate-50/60 transition-colors ${
                          isChecked ? "bg-blue-50/20" : ""
                        }`}
                      >
                        {/* Checkbox */}
                        <td className="w-10 px-3 py-4 text-center">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelectRow(g.id)}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer accent-[#2563EB]"
                          />
                        </td>

                        {/* STT */}
                        <td className="w-12 px-2 py-4 text-center text-xs font-medium text-[#94A3B8]">
                          {startIndex + index + 1}
                        </td>

                        {/* TỪ KHÓA */}
                        <td className="px-3 py-4 text-xs font-medium text-[#1E293B]">
                          {g.keyword || "—"}
                        </td>

                        {/* TÊN NHÓM */}
                        <td className="px-3 py-4 text-xs font-medium text-[#0F172A] max-w-[200px] leading-5">
                          {g.name}
                        </td>

                        {/* LOẠI NHÓM */}
                        <td className="px-3 py-4">
                          {g.type === "public" ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#ECFDF5] border border-[#A7F3D0] text-[#047857]">
                              Công khai
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#EEF2FF] border border-[#C7D2FE] text-[#4338CA]">
                              Riêng tư
                            </span>
                          )}
                        </td>

                        {/* THÀNH VIÊN */}
                        <td className="px-3 py-4 text-xs font-medium text-[#0F172A] text-right">
                          {g.members || "—"}
                        </td>

                        {/* LIÊN KẾT / URL NHÓM */}
                        <td className="px-3 py-4">
                          <a
                            href={g.url || g.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-[#2563EB] hover:underline max-w-[190px] truncate"
                          >
                            <span className="truncate">{g.url || g.href}</span>
                            <ExternalLink className="w-3 h-3 shrink-0 text-[#94A3B8]" />
                          </a>
                        </td>

                        {/* GHI CHÚ */}
                        <td className="px-3 py-4 text-xs">
                          {g.note === "Đã tham gia" ? (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-[10px] text-[11px] font-medium bg-[#EFF6FF] border border-[#BFDBFE] text-[#1D4ED8]">
                              Đã tham gia
                            </span>
                          ) : g.note === "Đang chờ QTV duyệt" ? (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-[10px] text-[11px] font-medium bg-[#FFFBEB] border border-[#FDE68A] text-[#B45309]">
                              Đang chờ QTV duyệt
                            </span>
                          ) : (
                            <span className="text-[#94A3B8]">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Table Pagination */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
            {/* Left stats info */}
            <div className="flex items-center gap-2 text-xs text-[#64748B]">
              <span>
                Hiển thị {filteredGroups.length === 0 ? 0 : startIndex + 1} -{" "}
                {Math.min(startIndex + pageSize, filteredGroups.length)} trong tổng số{" "}
                {filteredGroups.length} nhóm
              </span>
              <span>•</span>
              <div className="flex items-center gap-1.5">
                <span>Hàng mỗi trang:</span>
                <CustomSelect
                  value={pageSize}
                  onChange={(val) => {
                    setPageSize(Number(val));
                    setPage(1);
                  }}
                  options={PAGE_SIZE_OPTIONS}
                  size="sm"
                  direction="up"
                  className="w-16"
                  buttonClassName="h-[28px] px-2 text-xs"
                />
              </div>
            </div>

            {/* Right pagination */}
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={(p) => setPage(p)}
            />
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 3. MODALS (THÊM DANH MỤC, SỬA DANH MỤC, CHUYỂN MỤC) */}
      {/* ======================================================== */}

      {mounted && createPortal(
        <>
          {/* Modal Thêm danh mục */}
          {showAddCatModal && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
              onClick={(e) => {
                if (e.target === e.currentTarget) setShowAddCatModal(false);
              }}
            >
              <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                    <FolderPlus className="w-4 h-4 text-blue-600" />
                    <span>Thêm danh mục mới</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowAddCatModal(false)}
                    className="p-1 rounded hover:bg-slate-100 text-slate-400"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    Tên danh mục thư mục <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    autoFocus
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    placeholder="Ví dụ: Hội Săn Hàng Sale, Bất Động Sản..."
                    className="h-9 px-3 rounded-lg border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
                    onKeyDown={(e) => e.key === "Enter" && handleAddCategory()}
                  />
                </div>
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddCatModal(false)}
                    className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Hủy
                  </button>
                  <button
                    type="button"
                    onClick={handleAddCategory}
                    className="px-4 py-1.5 rounded-lg bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700 shadow-sm"
                  >
                    Tạo danh mục
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modal Sửa danh mục */}
          {showEditCatModal && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
              onClick={(e) => {
                if (e.target === e.currentTarget) setShowEditCatModal(false);
              }}
            >
              <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                    <Pencil className="w-4 h-4 text-blue-600" />
                    <span>Chỉnh sửa danh mục</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowEditCatModal(false)}
                    className="p-1 rounded hover:bg-slate-100 text-slate-400"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    Tên danh mục thư mục <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    autoFocus
                    value={editCatName}
                    onChange={(e) => setEditCatName(e.target.value)}
                    className="h-9 px-3 rounded-lg border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                    onKeyDown={(e) => e.key === "Enter" && handleEditCategory()}
                  />
                </div>
                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => handleDeleteCategory(activeCategoryId)}
                    className="px-3 py-1.5 rounded-lg border border-red-200 text-xs font-medium text-red-600 hover:bg-red-50 flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Xóa danh mục</span>
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowEditCatModal(false)}
                      className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Hủy
                    </button>
                    <button
                      type="button"
                      onClick={handleEditCategory}
                      className="px-4 py-1.5 rounded-lg bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700 shadow-sm"
                    >
                      Lưu thay đổi
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Modal Chuyển mục */}
          {showMoveModal && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
              onClick={(e) => {
                if (e.target === e.currentTarget) setShowMoveModal(false);
              }}
            >
              <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                    <FolderInput className="w-4 h-4 text-blue-600" />
                    <span>Chuyển {selectedIds.size} nhóm sang danh mục khác</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowMoveModal(false)}
                    className="p-1 rounded hover:bg-slate-100 text-slate-400"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    Chọn danh mục đích:
                  </label>
                  <CustomSelect
                    value={targetCatId}
                    onChange={(val) => setTargetCatId(val)}
                    options={categories
                      .filter((c) => c.id !== activeCategoryId)
                      .map((c) => ({ value: c.id, label: c.name }))}
                    placeholder="-- Chọn danh mục đích --"
                    size="md"
                  />
                </div>
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowMoveModal(false)}
                    className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Hủy
                  </button>
                  <button
                    type="button"
                    onClick={handleMoveGroups}
                    className="px-4 py-1.5 rounded-lg bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700 shadow-sm"
                  >
                    Xác nhận chuyển
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 3-dots Dropdown Menu (Portalled so it is never clipped by overflow-y-auto) */}
          {menuAnchor && (
            <div
              style={{
                position: "fixed",
                top: `${menuAnchor.top}px`,
                right: `${menuAnchor.right}px`,
                zIndex: 9999,
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-36 bg-white rounded-xl border border-slate-200 shadow-xl py-1 text-xs animate-in fade-in zoom-in-95 duration-100"
            >
              <button
                type="button"
                onClick={() => {
                  setEditCatName(menuAnchor.cat.name);
                  setShowEditCatModal(true);
                  setMenuAnchor(null);
                }}
                className="w-full px-3 py-2 text-left text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium transition-colors"
              >
                <Pencil className="w-3.5 h-3.5 text-slate-500" />
                <span>Đổi tên</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  handleDeleteCategory(menuAnchor.cat.id);
                  setMenuAnchor(null);
                }}
                className="w-full px-3 py-2 text-left text-rose-600 hover:bg-rose-50 flex items-center gap-2 font-medium transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                <span>Xóa danh mục</span>
              </button>
            </div>
          )}
        </>,
        document.body
      )}
    </div>
  );
}
