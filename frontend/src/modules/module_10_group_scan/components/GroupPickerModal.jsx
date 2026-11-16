"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Folder,
  Search,
  Plus,
  Pencil,
  Trash2,
  FolderInput,
  ExternalLink,
  X,
  ChevronLeft,
  ChevronRight,
  Check,
  MoreVertical,
  FolderPlus,
  Loader2,
  FolderKanban,
} from "lucide-react";
import { toast } from "@/lib/toast";
import Pagination from "@/components/ui/pagination";
import CustomSelect from "@/components/ui/custom-select";
import {
  getScannedGroups,
  getScanCategories,
  createScanCategory,
  updateScanCategory,
  deleteScanCategory,
  moveGroupsToCategory,
  deleteScannedGroupsBulk,
} from "../service";

function formatTV(count) {
  if (!count || count <= 0) return "0 TV";
  if (count >= 1000000) {
    return (count / 1000000).toFixed(1).replace(/\.0$/, "") + "M TV";
  }
  if (count >= 1000) {
    return (count / 1000).toFixed(1).replace(/\.0$/, "") + "K TV";
  }
  return count.toLocaleString("vi-VN") + " TV";
}

const TYPE_FILTER_OPTIONS = [
  { value: "all", label: "Loại nhóm: Tất cả" },
  { value: "public", label: "Công khai" },
  { value: "private", label: "Riêng tư" },
];

const MEMBERS_FILTER_OPTIONS = [
  { value: "all", label: "Thành viên: Tất cả" },
  { value: "under50k", label: "Dưới 50K" },
  { value: "50k_200k", label: "50K - 200K" },
  { value: "over200k", label: "Trên 200K" },
];

const NOTE_FILTER_OPTIONS = [
  { value: "all", label: "Ghi chú: Tất cả" },
  { value: "joined", label: "Đã tham gia" },
  { value: "pending", label: "Đang chờ" },
  { value: "none", label: "Chưa tham gia" },
];

const PAGE_SIZE_OPTIONS = [
  { value: 8, label: "8" },
  { value: 15, label: "15" },
  { value: 30, label: "30" },
];

export default function GroupPickerModal({
  open,
  onClose,
  selectedGroups = [],
  onConfirm,
  targetType = "posts", // "posts" | "members"
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState([]);
  const [activeCategoryId, setActiveCategoryId] = useState("cat-all");
  const [categorySearch, setCategorySearch] = useState("");
  const [groups, setGroups] = useState([]);

  // Filter toolbar states
  const [tableSearch, setTableSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [membersFilter, setMembersFilter] = useState("all");
  const [noteFilter, setNoteFilter] = useState("all");

  // Selection state (Set of group IDs)
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // Pagination states
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);

  // Sub-modal states
  const [showAddCatModal, setShowAddCatModal] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [showEditCatModal, setShowEditCatModal] = useState(false);
  const [editCatTarget, setEditCatTarget] = useState(null);
  const [editCatName, setEditCatName] = useState("");
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [targetCatId, setTargetCatId] = useState("");
  const [menuAnchor, setMenuAnchor] = useState(null); // { id, cat, top, right }

  // Sync initial selected groups from parent
  useEffect(() => {
    if (open) {
      const initialSet = new Set(
        (selectedGroups || [])
          .flatMap((g) => [g.id, g.group_id, g.groupId, g.uid, g.dbId])
          .filter(Boolean)
          .map(String)
      );
      setSelectedIds(initialSet);
    }
  }, [open, selectedGroups]);

  // Close 3-dot dropdown menu when clicking outside or scrolling
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

  // Fetch groups and categories from database
  const loadData = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const [groupsRes, catsRes] = await Promise.all([
        getScannedGroups(),
        getScanCategories(),
      ]);

      const loadedGroups = (groupsRes?.groups || []).map((g) => {
        const rawGid = String(g.group_id || g.uid || "");
        const fallbackDbId = String(g.id || "");

        let extractedSlug = "";
        const rawUrl = String(g.url || g.href || "");
        if (rawUrl.includes("/groups/")) {
          const parts = rawUrl.split("/groups/")[1].split("/")[0].split("?")[0].trim();
          if (parts && (!/^\d{1,7}$/.test(parts))) {
            extractedSlug = parts;
          }
        }

        let realGid = "";
        if (rawGid && (!/^\d{1,7}$/.test(rawGid))) {
          realGid = rawGid;
        } else if (extractedSlug) {
          realGid = extractedSlug;
        }

        let realUrl = "";
        if (rawUrl && (!/\/groups\/\d{1,7}(?:[/?#]|$)/.test(rawUrl))) {
          realUrl = rawUrl;
        } else if (realGid && (!/^\d{1,7}$/.test(realGid))) {
          realUrl = `https://www.facebook.com/groups/${realGid}`;
        } else {
          realUrl = "";
        }

        const primaryId = realGid || fallbackDbId;

        return {
          ...g,
          id: primaryId,
          group_id: realGid,
          groupId: realGid,
          dbId: fallbackDbId,
          uid: realGid,
          name: g.name || g.group_name || realGid || `Nhóm #${fallbackDbId}`,
          type: g.type === "private" || g.privacy === "private" ? "private" : "public",
          typeLabel: g.type === "private" || g.privacy === "private" ? "Riêng tư" : "Công khai",
          membersCount: Number(g.membersCount || g.member_count || 0) || 0,
          members: g.members || (g.membersCount ? Number(g.membersCount).toLocaleString("vi-VN") : "—"),
          url: realUrl,
          href: realUrl,
          keyword: g.keyword || g.category_name || "",
          note: g.note || (g.joined ? "Đã tham gia" : "—"),
        };
      });

      setGroups(loadedGroups);

      const dbCats = Array.isArray(catsRes) ? catsRes : groupsRes?.categories || [];
      const catList = dbCats.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description || "",
      }));

      // Prepend "Tất cả nhóm đã quét"
      const allCategories = [
        {
          id: "cat-all",
          name: "Tất cả nhóm đã quét",
          description: "Toàn bộ nhóm đã thu thập",
        },
        ...catList,
      ];

      setCategories(allCategories);

      // Keep activeCategoryId if still valid, or default to first category
      setActiveCategoryId((prev) => {
        if (allCategories.some((c) => c.id === prev)) return prev;
        return allCategories[0]?.id || "cat-all";
      });
    } catch (err) {
      console.error("[GroupPickerModal] Load error:", err);
      toast.error("Không thể tải danh sách nhóm từ Database!");
    } finally {
      setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      loadData();
    }
  }, [open, loadData]);

  // Active Category Object
  const activeCategory = useMemo(() => {
    return (
      categories.find((c) => c.id === activeCategoryId) ||
      categories[0] || { id: "cat-all", name: "Tất cả nhóm đã quét" }
    );
  }, [categories, activeCategoryId]);

  // Compute stats per category (number of groups and total member count)
  const categoryStatsMap = useMemo(() => {
    const stats = {};
    categories.forEach((cat) => {
      let matchedGroups = [];
      if (cat.id === "cat-all") {
        matchedGroups = groups;
      } else {
        const cname = (cat.name || "").toLowerCase();
        matchedGroups = groups.filter((g) => {
          if (cname) {
            if ((g.category_name || "").toLowerCase() === cname) return true;
            if ((g.keyword || "").toLowerCase() === cname) return true;
          }
          if (g.categoryId === cat.id) return true;
          if (String(g.categoryId) === `cat-${cat.id}`) return true;
          if (`cat-${g.categoryId}` === String(cat.id)) return true;
          return false;
        });
      }

      const totalTV = matchedGroups.reduce((acc, curr) => acc + (curr.membersCount || 0), 0);
      stats[cat.id] = {
        count: matchedGroups.length,
        membersTotal: totalTV,
      };
    });
    return stats;
  }, [categories, groups]);

  // Filter categories on the left side
  const filteredCategories = useMemo(() => {
    if (!categorySearch.trim()) return categories;
    const term = categorySearch.toLowerCase().trim();
    return categories.filter((c) => c.name.toLowerCase().includes(term));
  }, [categories, categorySearch]);

  // Groups belonging to currently active category
  const categoryGroups = useMemo(() => {
    if (activeCategoryId === "cat-all") return groups;
    const cname = (activeCategory?.name || "").toLowerCase();
    return groups.filter((g) => {
      if (cname) {
        if ((g.category_name || "").toLowerCase() === cname) return true;
        if ((g.keyword || "").toLowerCase() === cname) return true;
      }
      if (g.categoryId === activeCategoryId) return true;
      if (String(g.categoryId) === `cat-${activeCategoryId}`) return true;
      if (`cat-${g.categoryId}` === String(activeCategoryId)) return true;
      return false;
    });
  }, [groups, activeCategoryId, activeCategory]);

  // Filter groups in right table
  const filteredGroups = useMemo(() => {
    return categoryGroups.filter((g) => {
      // 1. Text search (tên nhóm hoặc UID / keyword / URL)
      if (tableSearch.trim()) {
        const term = tableSearch.toLowerCase().trim();
        const matchName = (g.name || "").toLowerCase().includes(term);
        const matchKey = (g.keyword || "").toLowerCase().includes(term);
        const matchUrl = (g.url || "").toLowerCase().includes(term);
        const matchGid = String(g.uid || g.id || "").toLowerCase().includes(term);
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
        if (membersFilter === "50k_200k" && (count < 50000 || count > 200000)) return false;
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

  // Selection handlers
  const allCurrentViewSelected = useMemo(() => {
    if (filteredGroups.length === 0) return false;
    return filteredGroups.every((g) => selectedIds.has(g.id));
  }, [filteredGroups, selectedIds]);

  const selectedInCurrentCategoryCount = useMemo(() => {
    return categoryGroups.filter((g) => selectedIds.has(g.id)).length;
  }, [categoryGroups, selectedIds]);

  const toggleSelectAllCurrentView = () => {
    const next = new Set(selectedIds);
    if (allCurrentViewSelected) {
      filteredGroups.forEach((g) => next.delete(g.id));
    } else {
      let reachedLimit = false;
      for (const g of filteredGroups) {
        if (!next.has(g.id)) {
          if (next.size >= 20) {
            reachedLimit = true;
            break;
          }
          next.add(g.id);
        }
      }
      if (reachedLimit) {
        toast.warning(
          "Số lượng nhóm mục tiêu trong một phiên quét không được vượt quá 20 nhóm để bảo đảm an toàn tài khoản!"
        );
      }
    }
    setSelectedIds(next);
  };

  const toggleSelectRow = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      if (next.size >= 20) {
        toast.warning(
          "Số lượng nhóm mục tiêu trong một phiên quét không được vượt quá 20 nhóm để bảo đảm an toàn tài khoản!"
        );
        return;
      }
      next.add(id);
    }
    setSelectedIds(next);
  };

  // Category Actions: Add, Edit, Delete
  const handleAddCategory = async () => {
    if (!newCatName.trim()) {
      toast.warn("Vui lòng nhập tên danh mục!");
      return;
    }
    const catName = newCatName.trim();
    try {
      await createScanCategory(catName);
      await loadData();
      setNewCatName("");
      setShowAddCatModal(false);
      toast.success(`Đã tạo danh mục "${catName}" thành công!`);
    } catch {
      toast.error("Không thể tạo danh mục!");
    }
  };

  const handleOpenEditCategory = (cat) => {
    setEditCatTarget(cat);
    setEditCatName(cat.name);
    setShowEditCatModal(true);
    setActiveMenuCatId(null);
  };

  const handleUpdateCategory = async () => {
    if (!editCatName.trim() || !editCatTarget) {
      toast.warn("Tên danh mục không được để trống!");
      return;
    }
    try {
      await updateScanCategory(editCatTarget.id, editCatName.trim());
      await loadData();
      setShowEditCatModal(false);
      toast.success("Đã cập nhật tên danh mục thành công!");
    } catch {
      toast.error("Không thể cập nhật danh mục!");
    }
  };

  const handleDeleteCategory = async (catId) => {
    if (catId === "cat-all") {
      toast.error("Không thể xóa danh mục tổng!");
      return;
    }
    const targetCat = categories.find((c) => c.id === catId);
    try {
      await deleteScanCategory(catId);
      await loadData();
      if (activeCategoryId === catId) {
        setActiveCategoryId("cat-all");
      }
      setActiveMenuCatId(null);
      toast.success(`Đã xóa danh mục "${targetCat?.name || ""}" thành công!`);
    } catch {
      toast.error("Không thể xóa danh mục!");
    }
  };

  // Move Selected Groups to Another Category
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
      await loadData();
      setShowMoveModal(false);
      toast.success(`Đã chuyển ${count} nhóm sang danh mục "${targetCat.name}"!`);
    } catch {
      toast.error("Lỗi khi chuyển danh mục nhóm!");
    }
  };

  // Delete Selected Groups from Database
  const handleDeleteSelectedGroups = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!window.confirm(`Bạn có chắc chắn muốn xóa ${count} nhóm đã chọn khỏi Database?`)) {
      return;
    }
    try {
      await deleteScannedGroupsBulk(Array.from(selectedIds));
      setSelectedIds(new Set());
      await loadData();
      toast.success(`Đã xóa ${count} nhóm thành công!`);
    } catch {
      toast.error("Lỗi khi xóa nhóm khỏi Database!");
    }
  };

  // Confirm selection and pass back to parent
  const handleConfirmSelection = () => {
    const selectedGroupObjects = groups
      .filter((g) => selectedIds.has(g.id) || (g.dbId && selectedIds.has(g.dbId)))
      .map((g, idx) => ({
        id: g.group_id || g.uid || g.id,
        groupId: g.group_id || g.uid || g.id,
        group_id: g.group_id || g.uid || g.id,
        dbId: g.dbId || g.id,
        stt: String(idx + 1).padStart(2, "0"),
        name: g.name,
        uid: g.group_id || g.uid || g.id,
        tag: (g.name || "FB").slice(0, 2).toUpperCase(),
        tagBg: "bg-[#DBEAFE]",
        tagText: "text-[#2563EB]",
        type: g.type,
        typeLabel: g.typeLabel,
        members: g.members,
        memberCount: g.membersCount,
        url: g.url || (g.group_id && !/^\d{1,7}$/.test(g.group_id) ? `https://www.facebook.com/groups/${g.group_id}` : ""),
        href: g.url || (g.group_id && !/^\d{1,7}$/.test(g.group_id) ? `https://www.facebook.com/groups/${g.group_id}` : ""),
        keyword: g.keyword,
        note: g.note,
      }));

    if (onConfirm) {
      onConfirm(selectedGroupObjects);
    }
    onClose();
  };

  if (!open || !mounted) return null;

  const subtitleText =
    targetType === "members"
      ? "Lựa chọn các nhóm Facebook từ danh sách đã thu thập trước đó để tiến hành quét thành viên mục tiêu"
      : "Lựa chọn các nhóm Facebook từ danh sách đã thu thập trước đó để tiến hành quét bài viết mục tiêu";

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 sm:p-6 overflow-hidden animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        {/* ======================================================== */}
        {/* MODAL HEADER */}
        {/* ======================================================== */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-200 bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[#0F172A] text-white shadow-xs">
              <FolderKanban className="size-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0F172A]">
                Chọn nhóm từ danh mục đã quét
              </h2>
              <p className="text-xs text-[#64748B] mt-0.5">{subtitleText}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-2 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* ======================================================== */}
        {/* MODAL BODY: 2 COLUMNS (DANH MỤC & NHÓM) */}
        {/* ======================================================== */}
        <div className="flex-1 overflow-y-auto p-5 bg-[#F8FAFC]">
          <div className="flex flex-col lg:flex-row gap-5 items-stretch h-full min-h-[560px]">
            {/* ──────────────────────────────────────────────────────── */}
            {/* LEFT COLUMN: DANH SÁCH DANH MỤC */}
            {/* ──────────────────────────────────────────────────────── */}
            <div className="w-full lg:w-[310px] shrink-0 bg-white border border-[#E2E8F0] shadow-xs rounded-xl p-4 flex flex-col justify-between">
              <div className="flex flex-col">
                {/* Header */}
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
                    title="Thêm danh mục mới"
                    className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-500 hover:text-blue-600 font-bold text-sm transition-colors"
                  >
                    +
                  </button>
                </div>

                {/* Subtitle / summary count */}
                <div className="py-2.5 flex items-center justify-between text-xs text-[#1E293B] font-semibold">
                  <span>
                    {categories.length} Thư mục{" "}
                    <span className="text-[#2563EB] font-bold">
                      ({groups.length} nhóm FB)
                    </span>
                  </span>
                </div>

                {/* Search category input */}
                <div className="relative w-full mb-3">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#94A3B8]" />
                  <input
                    type="text"
                    value={categorySearch}
                    onChange={(e) => setCategorySearch(e.target.value)}
                    placeholder="Lọc danh mục thư mục..."
                    className="w-full h-8 rounded-lg border border-[#E2E8F0] bg-white pl-8 pr-3 text-xs text-[#1E293B] placeholder:text-[#94A3B8] focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>

                {/* Category Cards List */}
                <div className="flex flex-col gap-2 max-h-[380px] overflow-y-auto pr-0.5">
                  {filteredCategories.map((cat) => {
                    const isActive = cat.id === activeCategoryId;
                    const catStats = categoryStatsMap[cat.id] || { count: 0, membersTotal: 0 };

                    return (
                      <div
                        key={cat.id}
                        onClick={() => {
                          setActiveCategoryId(cat.id);
                          setPage(1);
                        }}
                        className={`p-3 rounded-xl flex items-center justify-between cursor-pointer transition-all relative ${
                          isActive
                            ? "bg-[#EFF6FF]/50 border-2 border-[#2563EB] shadow-xs"
                            : "bg-white border border-[#E2E8F0] hover:border-slate-300"
                        }`}
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span
                            className={`text-xs font-bold truncate ${
                              isActive ? "text-[#1E40AF]" : "text-[#0F172A]"
                            }`}
                          >
                            {cat.name}
                          </span>
                          <span className="text-[11px] text-[#64748B] font-medium mt-0.5">
                            {catStats.count} nhóm FB • {formatTV(catStats.membersTotal)}
                          </span>
                        </div>

                        {/* Right: Active Dot & 3-dots Menu Button */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isActive && (
                            <span className="size-2 rounded-full bg-[#2563EB]" />
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
                              className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                              title="Tùy chọn danh mục"
                            >
                              <MoreVertical className="size-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Bottom: Thêm danh mục button */}
              {/* <button
                type="button"
                onClick={() => setShowAddCatModal(true)}
                className="w-full mt-3 py-2 px-3 rounded-xl border border-[#E2E8F0] hover:border-blue-400 hover:text-[#2563EB] text-xs font-semibold text-slate-600 flex items-center justify-center gap-1.5 transition-colors bg-white hover:bg-blue-50/30"
              >
                <Plus className="size-3.5" />
                Thêm danh mục
              </button> */}
            </div>

            {/* ──────────────────────────────────────────────────────── */}
            {/* RIGHT COLUMN: GROUP TABLE & FILTERS */}
            {/* ──────────────────────────────────────────────────────── */}
            <div className="flex-1 bg-white border border-[#E2E8F0] shadow-xs rounded-xl p-4 flex flex-col justify-between overflow-hidden">
              <div className="flex flex-col space-y-3.5">
                {/* Header: Selected Category Name & Edit button */}
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-[#0F172A] truncate">
                    {activeCategory.name}
                  </h3>
                  {activeCategory.id !== "cat-all" && (
                    <button
                      type="button"
                      onClick={() => handleOpenEditCategory(activeCategory)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E2E8F0] hover:bg-slate-50 text-xs font-medium text-[#334155] transition-colors"
                    >
                      <Pencil className="size-3.5 text-slate-500" />
                      Sửa danh mục
                    </button>
                  )}
                </div>

                {/* Toolbar: Search & 3 Filters */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#94A3B8]" />
                    <input
                      type="text"
                      value={tableSearch}
                      onChange={(e) => {
                        setTableSearch(e.target.value);
                        setPage(1);
                      }}
                      placeholder="Tìm theo tên nhóm hoặc UID..."
                      className="w-full h-8 pl-8 pr-3 text-xs border border-[#E2E8F0] rounded-lg outline-none focus:border-blue-500 placeholder:text-[#94A3B8] text-[#0F172A]"
                    />
                  </div>

                  <div className="w-full sm:w-auto shrink-0 min-w-[130px]">
                    <CustomSelect
                      value={typeFilter}
                      onChange={(val) => {
                        setTypeFilter(val);
                        setPage(1);
                      }}
                      options={TYPE_FILTER_OPTIONS}
                      size="sm"
                    />
                  </div>

                  <div className="w-full sm:w-auto shrink-0 min-w-[135px]">
                    <CustomSelect
                      value={membersFilter}
                      onChange={(val) => {
                        setMembersFilter(val);
                        setPage(1);
                      }}
                      options={MEMBERS_FILTER_OPTIONS}
                      size="sm"
                    />
                  </div>

                  <div className="w-full sm:w-auto shrink-0 min-w-[135px]">
                    <CustomSelect
                      value={noteFilter}
                      onChange={(val) => {
                        setNoteFilter(val);
                        setPage(1);
                      }}
                      options={NOTE_FILTER_OPTIONS}
                      size="sm"
                    />
                  </div>
                </div>

                {/* Blue Selection Banner - Chỉ hiển thị khi có ít nhất 1 nhóm được chọn */}
                {selectedInCurrentCategoryCount > 0 && (
                  <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg px-3.5 py-2 flex items-center justify-between text-xs text-[#1D4ED8] animate-in fade-in duration-150">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={allCurrentViewSelected}
                        onChange={toggleSelectAllCurrentView}
                        className="size-4 rounded text-blue-600 border-blue-300 focus:ring-blue-500 cursor-pointer"
                      />
                      <span className="font-semibold text-xs text-[#1E40AF]">
                        Đã chọn {selectedInCurrentCategoryCount} / {categoryGroups.length} nhóm
                      </span>
                    </label>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedIds.size === 0) {
                            toast.warn("Vui lòng chọn ít nhất 1 nhóm để chuyển mục!");
                            return;
                          }
                          setShowMoveModal(true);
                        }}
                        className="px-2.5 py-1 rounded-md border border-[#BFDBFE] bg-white text-[#1E40AF] hover:bg-blue-50 text-xs font-medium flex items-center gap-1.5 transition-colors"
                      >
                        <FolderInput className="size-3.5" />
                        Chuyển mục
                      </button>

                      <button
                        type="button"
                        onClick={handleDeleteSelectedGroups}
                        disabled={selectedIds.size === 0}
                        className="px-2.5 py-1 rounded-md border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 disabled:opacity-50 text-xs font-medium flex items-center gap-1.5 transition-colors"
                      >
                        <Trash2 className="size-3.5" />
                        Xóa
                      </button>
                    </div>
                  </div>
                )}

                {/* Groups Data Table */}
                <div className="border border-[#E2E8F0] rounded-xl overflow-x-auto min-h-[280px]">
                  {loading ? (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
                      <Loader2 className="size-6 animate-spin text-blue-600" />
                      <span className="text-xs">Đang tải danh sách nhóm từ Database...</span>
                    </div>
                  ) : paginatedGroups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400 text-xs">
                      Không tìm thấy nhóm nào phù hợp trong danh mục này.
                    </div>
                  ) : (
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[11px] font-bold text-[#64748B] uppercase tracking-wider">
                          <th className="w-10 px-3 py-2.5 text-center">
                            <input
                              type="checkbox"
                              checked={allCurrentViewSelected}
                              onChange={toggleSelectAllCurrentView}
                              className="size-3.5 rounded text-blue-600 border-slate-300 cursor-pointer"
                            />
                          </th>
                          <th className="w-12 px-3 py-2.5 text-center">STT</th>
                          <th className="w-28 px-3 py-2.5">TỪ KHÓA</th>
                          <th className="px-3 py-2.5">TÊN NHÓM</th>
                          <th className="w-24 px-3 py-2.5 text-center">LOẠI NHÓM</th>
                          <th className="w-28 px-3 py-2.5 text-right">THÀNH VIÊN</th>
                          <th className="w-56 px-3 py-2.5">LIÊN KẾT / URL NHÓM</th>
                          <th className="w-28 px-3 py-2.5 text-center">GHI CHÚ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F1F5F9] bg-white">
                        {paginatedGroups.map((group, idx) => {
                          const isSelected = selectedIds.has(group.id);
                          const sttNum = startIndex + idx + 1;

                          return (
                            <tr
                              key={group.id}
                              onClick={() => toggleSelectRow(group.id)}
                              className={`hover:bg-slate-50 cursor-pointer transition-colors ${
                                isSelected ? "bg-blue-50/40" : ""
                              }`}
                            >
                              <td
                                className="px-3 py-2.5 text-center"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleSelectRow(group.id)}
                                  className="size-3.5 rounded text-blue-600 border-slate-300 cursor-pointer"
                                />
                              </td>
                              <td className="px-3 py-2.5 text-center font-semibold text-[#64748B]">
                                {sttNum}
                              </td>
                              <td className="px-3 py-2.5 text-[#334155] font-medium truncate max-w-[120px]">
                                {group.keyword || "—"}
                              </td>
                              <td className="px-3 py-2.5">
                                <span className="font-bold text-xs text-[#0F172A] line-clamp-1">
                                  {group.name}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                {group.type === "public" ? (
                                  <span className="inline-flex items-center justify-center rounded border border-[#BBF7D0] bg-[#F0FDF4] px-2 py-0.5 text-[11px] font-semibold text-[#16A34A]">
                                    Công khai
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center justify-center rounded border border-[#E9D5FF] bg-[#FAF5FF] px-2 py-0.5 text-[11px] font-semibold text-[#9333EA]">
                                    Riêng tư
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-right font-semibold text-[#0F172A]">
                                {group.members}
                              </td>
                              <td
                                className="px-3 py-2.5 max-w-[200px]"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <a
                                  href={group.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-[#2563EB] hover:underline truncate max-w-full text-xs"
                                >
                                  <span className="truncate">{group.url}</span>
                                  <ExternalLink className="size-3 shrink-0 text-slate-400" />
                                </a>
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                {group.note && group.note.includes("Đã tham gia") ? (
                                  <span className="inline-flex items-center justify-center rounded bg-[#EFF6FF] border border-[#BFDBFE] px-2 py-0.5 text-[11px] font-semibold text-[#2563EB]">
                                    Đã tham gia
                                  </span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Pagination Controls */}
              <div className="pt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[#64748B]">
                <div className="flex items-center gap-2">
                  <span>
                    Hiển thị{" "}
                    <strong>
                      {totalItems === 0 ? 0 : startIndex + 1} -{" "}
                      {Math.min(startIndex + pageSize, totalItems)}
                    </strong>{" "}
                    trong tổng số <strong>{totalItems}</strong> nhóm
                  </span>
                  <span>•</span>
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

                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={(p) => setPage(p)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ======================================================== */}
        {/* MODAL FOOTER */}
        {/* ======================================================== */}
        <div className="border-t border-slate-200 bg-white px-6 py-3.5 flex items-center justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Hủy bỏ
          </button>

          <button
            type="button"
            onClick={handleConfirmSelection}
            className="px-5 py-2 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors"
          >
            <Check className="size-3.5" />
            Xác nhận chọn ({selectedIds.size} nhóm)
          </button>
        </div>
      </div>

      {/* ======================================================== */}
      {/* SUB-MODAL: THÊM DANH MỤC */}
      {/* ======================================================== */}
      {showAddCatModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b pb-3 border-slate-100">
              <h4 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                <FolderPlus className="size-4 text-blue-600" />
                Thêm danh mục mới
              </h4>
              <button
                type="button"
                onClick={() => setShowAddCatModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="size-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tên danh mục:
              </label>
              <input
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="VD: Hội buôn Hà Nội..."
                className="w-full h-9 px-3 text-xs border border-slate-200 rounded-lg outline-none focus:border-blue-500"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddCategory();
                }}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowAddCatModal(false)}
                className="px-3 py-1.5 border border-slate-200 text-xs font-medium rounded-lg text-slate-600 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleAddCategory}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg"
              >
                Tạo mới
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* SUB-MODAL: SỬA DANH MỤC */}
      {/* ======================================================== */}
      {showEditCatModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b pb-3 border-slate-100">
              <h4 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                <Pencil className="size-4 text-blue-600" />
                Sửa tên danh mục
              </h4>
              <button
                type="button"
                onClick={() => setShowEditCatModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="size-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tên mới:
              </label>
              <input
                type="text"
                value={editCatName}
                onChange={(e) => setEditCatName(e.target.value)}
                className="w-full h-9 px-3 text-xs border border-slate-200 rounded-lg outline-none focus:border-blue-500"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleUpdateCategory();
                }}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowEditCatModal(false)}
                className="px-3 py-1.5 border border-slate-200 text-xs font-medium rounded-lg text-slate-600 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleUpdateCategory}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg"
              >
                Lưu thay đổi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* SUB-MODAL: CHUYỂN NHÓM SANG DANH MỤC KHÁC */}
      {/* ======================================================== */}
      {showMoveModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b pb-3 border-slate-100">
              <h4 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                <FolderInput className="size-4 text-blue-600" />
                Chuyển {selectedIds.size} nhóm sang danh mục
              </h4>
              <button
                type="button"
                onClick={() => setShowMoveModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="size-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Chọn danh mục đích:
              </label>
              <CustomSelect
                value={targetCatId}
                onChange={(val) => setTargetCatId(val)}
                options={categories
                  .filter((c) => c.id !== "cat-all")
                  .map((c) => ({ value: c.id, label: c.name }))}
                placeholder="-- Chọn danh mục --"
                size="md"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowMoveModal(false)}
                className="px-3 py-1.5 border border-slate-200 text-xs font-medium rounded-lg text-slate-600 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleMoveGroups}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg"
              >
                Chuyển ngay
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
          className="w-36 bg-white border border-slate-200 rounded-xl shadow-xl py-1 text-xs animate-in fade-in zoom-in-95 duration-100"
        >
          <button
            type="button"
            onClick={() => {
              handleOpenEditCategory(menuAnchor.cat);
              setMenuAnchor(null);
            }}
            className="w-full px-3 py-2 text-left text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium transition-colors"
          >
            <Pencil className="size-3.5 text-slate-500" />
            <span>Sửa danh mục</span>
          </button>
          <button
            type="button"
            onClick={() => {
              handleDeleteCategory(menuAnchor.cat.id);
              setMenuAnchor(null);
            }}
            className="w-full px-3 py-2 text-left text-rose-600 hover:bg-rose-50 flex items-center gap-2 font-medium transition-colors"
          >
            <Trash2 className="size-3.5 text-rose-500" />
            <span>Xóa danh mục</span>
          </button>
        </div>
      )}
    </div>
  );

  return createPortal(modalContent, document.body);
}

