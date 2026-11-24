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
import { downloadTable, groupExportTable, safeFileName } from "../utils/exportTable";
import ModulePageHeader from "../components/ModulePageHeader";
import { groupInCategory, groupMembersCount, matchesGroupSearch, matchesMembersFilter } from "../utils/groupCategory";

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
  const [membersFilter, setMembersFilter] = useState("all");

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
    // Thư mục chưa có trong danh sách (vừa xoá / đổi tên) → không hiện nhầm nhóm của thư mục khác.
    if (!categories.some((c) => c.id === activeCategoryId)) return [];
    return groups.filter((g) => groupInCategory(g, activeCategory));
  }, [groups, categories, activeCategoryId, activeCategory]);

  // Thư mục đang chọn bị xoá / không còn → quay về "Tất cả" để tiêu đề và bảng khớp nhau.
  useEffect(() => {
    if (!loading && activeCategoryId !== "cat-all" && !categories.some((c) => c.id === activeCategoryId)) {
      setActiveCategoryId("cat-all");
    }
  }, [loading, categories, activeCategoryId]);

  // Lọc nhóm trong bảng theo ô tìm kiếm (không phân biệt dấu / hoa thường) & bộ lọc số thành viên
  const filteredGroups = useMemo(
    () => categoryGroups.filter((g) => matchesGroupSearch(g, tableSearch) && matchesMembersFilter(g, membersFilter)),
    [categoryGroups, tableSearch, membersFilter],
  );

  // Thống kê 4 thẻ Summary Cards — theo đúng danh sách đang hiển thị (sau tìm kiếm / lọc)
  const stats = useMemo(() => {
    const totalGroups = filteredGroups.length;
    let totalMembersCount = 0;
    let largestGroup = 0;

    filteredGroups.forEach((g) => {
      const count = groupMembersCount(g);
      if (count) {
        totalMembersCount += count;
        largestGroup = Math.max(largestGroup, count);
      }
    });

    const formatNumber = (num) => num.toLocaleString("vi-VN");

    return {
      totalGroups,
      totalMembersFormatted: formatNumber(totalMembersCount),
      averageMembersFormatted: formatNumber(totalGroups ? Math.round(totalMembersCount / totalGroups) : 0),
      largestGroupFormatted: formatNumber(largestGroup),
    };
  }, [filteredGroups]);

  // Pagination calculation
  const totalItems = filteredGroups.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedGroups = useMemo(() => {
    return filteredGroups.slice(startIndex, startIndex + pageSize);
  }, [filteredGroups, startIndex, pageSize]);

  // "Chọn tất cả": tick → chọn TẤT CẢ nhóm trong danh sách (mọi trang, theo tìm kiếm / bộ lọc hiện tại);
  // bỏ tick → bỏ chọn toàn bộ.
  const allFilteredSelected = useMemo(
    () => filteredGroups.length > 0 && filteredGroups.every((g) => selectedIds.has(g.id)),
    [filteredGroups, selectedIds],
  );
  const someSelected = selectedIds.size > 0 && !allFilteredSelected;

  const toggleSelectAll = () => {
    setSelectedIds(allFilteredSelected ? new Set() : new Set(filteredGroups.map((g) => g.id)));
  };

  // Tìm kiếm / lọc lại → chỉ giữ lựa chọn của các nhóm còn hiển thị (tránh xoá / chuyển nhầm nhóm bị ẩn).
  useEffect(() => {
    setSelectedIds((current) => {
      if (!current.size) return current;
      const visible = new Set(filteredGroups.map((g) => g.id));
      const next = new Set([...current].filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [filteredGroups]);

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
      const created = await createScanCategory(catName);
      if (created?.existed) {
        toast.warning(`Danh mục «${created.category?.name || catName}» đã tồn tại — không tạo trùng.`);
        return;
      }
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
      toast.error(err?.message || "Không thể cập nhật danh mục trong Database");
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
      const table = groupExportTable(rows);
      const catName = activeCategory?.id && activeCategory.id !== "cat-all" ? activeCategory.name : "Tat_ca";
      const fileName = await downloadTable({ format, baseName: `Danh_sach_nhom_${safeFileName(catName)}`, sheetName: "Nhom", ...table });
      toast.success(`Đã xuất ${rows.length} nhóm ra file: ${fileName}`);
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
      <ModulePageHeader navId="scan.list" />
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
            // Bỏ chọn nhóm của thư mục cũ — tránh xoá / chuyển nhầm nhóm không còn nhìn thấy.
            if (id !== activeCategoryId) setSelectedIds(new Set());
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
            membersFilter={membersFilter}
            onMembersFilterChange={(val) => {
              setMembersFilter(val);
              setPage(1);
            }}
            selectedCount={selectedIds.size}
            allSelected={allFilteredSelected}
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
            allCurrentPageSelected={allFilteredSelected}
            someSelected={someSelected}
            hasFilter={Boolean(tableSearch.trim()) || membersFilter !== "all"}
            onClearFilters={() => {
              setTableSearch("");
              setMembersFilter("all");
              setPage(1);
            }}
            onToggleSelectAll={toggleSelectAll}
            selectedIds={selectedIds}
            onToggleSelectRow={toggleSelectRow}
            allGroups={filteredGroups}
            onSelectRows={setSelectedIds}
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
