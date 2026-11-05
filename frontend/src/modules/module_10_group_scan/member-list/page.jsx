"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { RotateCcw, Download } from "lucide-react";
import { toast } from "@/lib/toast";
import { getScanCategories, createScanCategory } from "../service";
import MemberCategorySidebar from "./_components/MemberCategorySidebar";
import MemberTableToolbar from "./_components/MemberTableToolbar";
import MemberDataTable from "./_components/MemberDataTable";
import CreateCategoryModal from "./_components/CreateCategoryModal";

const FRIEND_FILTER_OPTIONS = [
  { value: "all", label: "Tất cả số bạn bè" },
  { value: "under500", label: "Dưới 500 bạn bè" },
  { value: "500to2000", label: "500 - 2.000 bạn bè" },
  { value: "over2000", label: "Trên 2.000 bạn bè" },
];

export default function GroupScanMemberListPage() {
  // Categories state
  const [categories, setCategories] = useState([]);
  const [selectedCatId, setSelectedCatId] = useState("");
  const [categorySearch, setCategorySearch] = useState("");
  const [createCategoryModalOpen, setCreateCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  // Members state
  const [members, setMembers] = useState([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [friendFilter, setFriendFilter] = useState("all");
  const [selectedMemberIds, setSelectedMemberIds] = useState(new Set());
  const [currentPage, setCurrentPage] = useState(1);

  const loadCategories = useCallback(async () => {
    try {
      const data = await getScanCategories();
      const cats = Array.isArray(data) ? data : [];
      if (cats.length > 0) {
        setCategories(
          cats.map((c) => ({
            id: c.id,
            name: c.name,
            fullName: c.name,
            membersSummary: `${c.count || 0} nhóm`,
            fullMeta: c.description || `Danh mục nhóm: ${c.name}`,
            totalUidCount: 0,
          }))
        );
        setSelectedCatId((prev) => (cats.some((c) => c.id === prev) ? prev : cats[0].id));
      } else {
        setCategories([]);
        setSelectedCatId("");
      }
    } catch {
      setCategories([]);
      setSelectedCatId("");
    }
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  // Selected Category Object
  const currentCategory = useMemo(() => {
    return categories.find((c) => c.id === selectedCatId) || categories[0] || null;
  }, [categories, selectedCatId]);

  // Filter Categories
  const filteredCategories = useMemo(() => {
    if (!categorySearch.trim()) return categories;
    return categories.filter((c) =>
      c.name.toLowerCase().includes(categorySearch.toLowerCase())
    );
  }, [categories, categorySearch]);

  // Filter Members
  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      const matchQuery =
        !memberSearch.trim() ||
        m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
        m.uid.includes(memberSearch.trim());
      const matchFriend =
        friendFilter === "all" ||
        (friendFilter === "under500" && m.friendCount <= 500) ||
        (friendFilter === "500to2000" && m.friendCount > 500 && m.friendCount <= 2000) ||
        (friendFilter === "over2000" && m.friendCount > 2000);
      return matchQuery && matchFriend;
    });
  }, [members, memberSearch, friendFilter]);

  const pageSize = 15;
  const totalPages = Math.max(1, Math.ceil(filteredMembers.length / pageSize));
  const paginatedMembers = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredMembers.slice(start, start + pageSize);
  }, [filteredMembers, currentPage, pageSize]);

  // Toggle selection
  const allFilteredSelected =
    filteredMembers.length > 0 &&
    filteredMembers.every((m) => selectedMemberIds.has(m.id));

  const handleToggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedMemberIds(new Set());
    } else {
      setSelectedMemberIds(new Set(filteredMembers.map((m) => m.id)));
    }
  };

  const handleToggleSelect = (id) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Remove Single Member
  const handleRemoveMember = (id) => {
    setMembers((prev) => prev.filter((m) => m.id !== id));
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    toast.success("Đã xóa thành viên khỏi danh sách!");
  };

  // Bulk Delete
  const handleBulkDelete = () => {
    if (selectedMemberIds.size === 0) return;
    setMembers((prev) => prev.filter((m) => !selectedMemberIds.has(m.id)));
    toast.success(`Đã xóa ${selectedMemberIds.size} thành viên được chọn!`);
    setSelectedMemberIds(new Set());
  };

  // Actions & Exports
  const handleRefresh = async () => {
    await loadCategories();
    toast.info("Đã làm mới danh mục và danh sách thành viên.");
  };

  const handleExportAll = () => {
    if (members.length === 0) {
      toast.warning("Chưa có thành viên nào để xuất!");
      return;
    }
    toast.success(`Đang xuất toàn bộ ${members.length} UID ra file...`);
  };

  const handleExportGroup = () => {
    if (!currentCategory) {
      toast.warning("Vui lòng chọn một danh mục!");
      return;
    }
    toast.success(`Đang xuất file nhóm ${currentCategory.fullName || currentCategory.name}...`);
  };

  const handleExportSelected = () => {
    if (selectedMemberIds.size === 0) {
      toast.warning("Chưa chọn thành viên nào để xuất!");
      return;
    }
    toast.success(`Đang xuất file ${selectedMemberIds.size} thành viên đã chọn...`);
  };

  // Create Category
  const handleCreateCategory = async (e) => {
    e.preventDefault();
    if (!newCategoryName.trim()) {
      toast.error("Vui lòng nhập tên danh mục!");
      return;
    }
    const catName = newCategoryName.trim();
    try {
      await createScanCategory(catName);
      await loadCategories();
      setNewCategoryName("");
      setCreateCategoryModalOpen(false);
      toast.success("Đã thêm danh mục nhóm mới thành công!");
    } catch {
      toast.error("Không thể tạo danh mục");
    }
  };

  return (
    <div className="-m-6 min-h-full space-y-5 bg-[#F4F7FC] p-6">
      {/* Master Workspace Card */}
      <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        {/* Card Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F1F5F9] px-5 py-4 bg-[#F8FAFC]/50">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-bold text-[#0B1C30]">
              DANH SÁCH THÀNH VIÊN ĐÃ QUÉT
            </h2>
            <span className="rounded-full bg-[#EFF6FF] border border-[#BFDBFE] px-2.5 py-0.5 text-[11px] font-semibold text-[#1D4ED8]">
              {members.length.toLocaleString("vi-VN")} UID
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3 text-xs font-semibold text-[#334155] shadow-xs hover:bg-slate-50 transition-colors"
            >
              <RotateCcw className="size-3.5 text-[#64748B]" />
              <span>Làm mới</span>
            </button>

            <button
              type="button"
              onClick={handleExportAll}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3 text-xs font-semibold text-[#334155] shadow-xs hover:bg-slate-50 transition-colors"
            >
              <Download className="size-3.5 text-[#64748B]" />
              <span>Xuất toàn bộ file</span>
            </button>
          </div>
        </div>

        {/* Two Column Layout: Categories Left + Data Table Right */}
        <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[620px]">
          {/* Left Category Column */}
          <MemberCategorySidebar
            categories={filteredCategories}
            selectedCatId={selectedCatId}
            onSelectCat={setSelectedCatId}
            categorySearch={categorySearch}
            onSearchChange={setCategorySearch}
            onOpenCreateModal={() => setCreateCategoryModalOpen(true)}
          />

          {/* Right Detail And Table Column */}
          <div className="lg:col-span-8 p-5 flex flex-col gap-3.5 min-w-0">
            <MemberTableToolbar
              currentCategory={currentCategory}
              memberSearch={memberSearch}
              onMemberSearchChange={setMemberSearch}
              friendFilter={friendFilter}
              onFriendFilterChange={(val) => {
                setFriendFilter(val);
                setCurrentPage(1);
              }}
              friendFilterOptions={FRIEND_FILTER_OPTIONS}
              selectedMemberIds={selectedMemberIds}
              onExportGroup={handleExportGroup}
              onExportSelected={handleExportSelected}
              onBulkDelete={handleBulkDelete}
            />

            <MemberDataTable
              members={paginatedMembers}
              loading={false}
              selectedMemberIds={selectedMemberIds}
              onToggleSelectRow={handleToggleSelect}
              onToggleSelectAll={handleToggleSelectAll}
              allFilteredSelected={allFilteredSelected}
              onRemoveMember={handleRemoveMember}
              totalFilteredCount={filteredMembers.length}
              totalUidCount={currentCategory?.totalUidCount}
              currentPage={currentPage}
              totalPages={totalPages}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
            />
          </div>
        </div>
      </section>

      {/* Modal Thêm Mới Danh Mục Nhóm */}
      <CreateCategoryModal
        open={createCategoryModalOpen}
        onClose={() => setCreateCategoryModalOpen(false)}
        categoryName={newCategoryName}
        onCategoryNameChange={setNewCategoryName}
        onSubmit={handleCreateCategory}
      />
    </div>
  );
}
