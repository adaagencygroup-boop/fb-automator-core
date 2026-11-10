"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { toast } from "@/lib/toast";
import {
  getScannedGroups,
  getScanCategories,
  deleteScannedGroupsBulk,
  createScanCategory,
  updateScanCategory,
  deleteScanCategory,
  moveGroupsToCategory,
} from "../service";
import CategorySidebar from "./_components/CategorySidebar";
import GroupStatsOverview from "./_components/GroupStatsOverview";
import GroupTableToolbar from "./_components/GroupTableToolbar";
import GroupDataTable from "./_components/GroupDataTable";
import GroupListModals from "./_components/GroupListModals";

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
  const [, setDbKeywords] = useState([]);

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

  // Nạp danh sách nhóm từ Database
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
      // 1. Text search
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

  // Sửa danh mục trong Database
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

  // Xóa danh mục khỏi Database
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
      setMenuAnchor(null);
      toast.success(`Đã xóa danh mục "${catToDelete?.name || ""}" khỏi Database!`);
    } catch (err) {
      console.error(err);
      toast.error("Không thể xóa danh mục trong Database");
    }
  };

  // Chuyển nhóm sang danh mục khác
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

  // Xóa đơn lẻ 1 nhóm
  const handleDeleteSingleGroup = async (id) => {
    try {
      await deleteScannedGroupsBulk([id]);
      await loadGroups();
      setSelectedIds((curr) => {
        const next = new Set(curr);
        next.delete(id);
        return next;
      });
      toast.success("Đã xóa nhóm thành công khỏi Database!");
    } catch (err) {
      console.error(err);
      toast.error("Không thể xóa nhóm.");
    }
  };

  // Sao chép liên kết nhóm
  const handleCopyLink = async (url) => {
    if (!url) return;
    try {
      const full = url.startsWith("http") ? url : `https://${url}`;
      await navigator.clipboard.writeText(full);
      toast.success("Đã sao chép liên kết nhóm vào bộ nhớ tạm!");
    } catch {
      toast.info(`Link nhóm: ${url}`);
    }
  };

  // Xuất báo cáo dữ liệu nhóm (UC-GIS-08)
  const handleExport = async (format = "xlsx") => {
    const rows = selectedIds.size
      ? filteredGroups.filter((g) => selectedIds.has(g.id))
      : filteredGroups;
    if (!rows.length) {
      toast.warning("Chưa có nhóm để xuất báo cáo.");
      return;
    }
    try {
      const typeLabel = (t) => (t === "private" ? "Riêng tư" : "Công khai");
      const headers = ["STT", "Từ khóa", "Tên nhóm", "Loại nhóm", "Thành viên", "URL nhóm", "Ghi chú"];
      const dataRows = rows.map((g, index) => [
        index + 1,
        g.keyword || "",
        g.name || "",
        typeLabel(g.type),
        g.members || "",
        g.url || g.href || "",
        g.note || "",
      ]);

      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
      const fileName = `GroupInfo_${stamp}.${format}`;

      if (format === "csv") {
        const escapeCsv = (val) => {
          const str = String(val == null ? "" : val);
          if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        };
        const csvContent = "\uFEFF" + [
          headers.map(escapeCsv).join(","),
          ...dataRows.map((r) => r.map(escapeCsv).join(",")),
        ].join("\r\n");
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        const XLSX = await import("xlsx");
        const sheet = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
        sheet["!cols"] = [
          { wch: 6 },
          { wch: 22 },
          { wch: 36 },
          { wch: 14 },
          { wch: 14 },
          { wch: 48 },
          { wch: 20 },
        ];
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, sheet, "Kho nhom");
        XLSX.writeFile(book, fileName);
      }
      toast.success(`Đã xuất thành công file báo cáo: ${fileName}`);
    } catch (err) {
      toast.error("Xuất báo cáo thất bại: " + (err.message || "Lỗi"));
    }
  };

  // Xóa các nhóm đã chọn
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

  const handleToggleMenu = (e, cat) => {
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
  };

  return (
    <div className="-m-6 min-h-full space-y-5 bg-[#F4F7FC] p-6">
      {/* MAIN LAYOUT: LEFT FOLDER PANEL & RIGHT DETAIL SECTION */}
      <div className="flex flex-col lg:flex-row gap-5 items-start w-full">
        {/* LEFT COLUMN: DANH SÁCH DANH MỤC */}
        <CategorySidebar
          categories={filteredCategories}
          groups={groups}
          activeCategoryId={activeCategoryId}
          onSelectCategory={(id) => {
            setActiveCategoryId(id);
            setPage(1);
          }}
          categorySearch={categorySearch}
          onCategorySearchChange={setCategorySearch}
          onRefresh={() => loadGroups(true)}
          loading={loading}
          onOpenAddCatModal={() => setShowAddCatModal(true)}
          menuAnchor={menuAnchor}
          onToggleMenu={handleToggleMenu}
        />

        {/* RIGHT COLUMN: DETAIL SECTION */}
        <div className="flex-1 w-full bg-white border border-[#E2E8F0] shadow-sm rounded-xl p-6 flex flex-col gap-4 min-w-0">
          <GroupTableToolbar
            activeCategory={activeCategory}
            loading={loading}
            onRefresh={() => loadGroups(true)}
            onOpenEditModal={() => {
              setEditCatName(activeCategory.name);
              setShowEditCatModal(true);
            }}
            tableSearch={tableSearch}
            onTableSearchChange={(val) => {
              setTableSearch(val);
              setPage(1);
            }}
            typeFilter={typeFilter}
            onTypeFilterChange={(val) => {
              setTypeFilter(val);
              setPage(1);
            }}
            membersFilter={membersFilter}
            onMembersFilterChange={(val) => {
              setMembersFilter(val);
              setPage(1);
            }}
            noteFilter={noteFilter}
            onNoteFilterChange={(val) => {
              setNoteFilter(val);
              setPage(1);
            }}
            selectedCount={selectedIds.size}
            totalFilteredCount={filteredGroups.length}
            onToggleSelectAll={toggleSelectAll}
            onOpenMoveModal={() => {
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
            onDeleteSelected={handleDeleteSelectedGroups}
            onExport={handleExport}
          />

          <GroupStatsOverview stats={stats} />

          <GroupDataTable
            loading={loading}
            paginatedGroups={paginatedGroups}
            allCurrentPageSelected={allCurrentPageSelected}
            onToggleSelectAll={toggleSelectAll}
            selectedIds={selectedIds}
            onToggleSelectRow={toggleSelectRow}
            startIndex={startIndex}
            totalFilteredCount={filteredGroups.length}
            pageSize={pageSize}
            onPageSizeChange={(val) => {
              setPageSize(Number(val));
              setPage(1);
            }}
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={(p) => setPage(p)}
            onDeleteSingle={handleDeleteSingleGroup}
            onCopyLink={handleCopyLink}
          />
        </div>
      </div>

      {/* MODALS */}
      <GroupListModals
        mounted={mounted}
        groups={groups}
        showAddCatModal={showAddCatModal}
        onCloseAddCatModal={() => setShowAddCatModal(false)}
        newCatName={newCatName}
        onNewCatNameChange={setNewCatName}
        onAddCategory={handleAddCategory}
        showEditCatModal={showEditCatModal}
        onCloseEditCatModal={() => setShowEditCatModal(false)}
        editCatName={editCatName}
        onEditCatNameChange={setEditCatName}
        onEditCategory={handleEditCategory}
        onDeleteCategory={handleDeleteCategory}
        activeCategoryId={activeCategoryId}
        showMoveModal={showMoveModal}
        onCloseMoveModal={() => setShowMoveModal(false)}
        selectedCount={selectedIds.size}
        targetCatId={targetCatId}
        onTargetCatIdChange={setTargetCatId}
        categories={categories}
        onMoveGroups={handleMoveGroups}
        menuAnchor={menuAnchor}
        onCloseMenu={() => setMenuAnchor(null)}
        onOpenEditFromMenu={() => {
          setEditCatName(menuAnchor.cat.name);
          setShowEditCatModal(true);
          setMenuAnchor(null);
        }}
      />
    </div>
  );
}
