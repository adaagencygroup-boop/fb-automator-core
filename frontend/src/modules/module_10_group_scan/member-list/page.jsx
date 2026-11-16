"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { RotateCcw, Download } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  getScanCategories,
  createScanCategory,
  getScannedMembers,
  deleteScannedMember,
  deleteScannedMembersBulk,
  getMembersSummary,
} from "../service";
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
  const [loading, setLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [memberSearch, setMemberSearch] = useState("");
  const [friendFilter, setFriendFilter] = useState("all");
  const [selectedMemberIds, setSelectedMemberIds] = useState(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

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

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getScannedMembers({
        category_id: selectedCatId,
        search: memberSearch,
        friend_filter: friendFilter,
        page: currentPage,
        page_size: pageSize,
      });
      if (res?.members && Array.isArray(res.members)) {
        setMembers(
          res.members.map((m, idx) => ({
            ...m,
            id: m.id,
            stt: String((currentPage - 1) * pageSize + idx + 1).padStart(2, "0"),
            shortUid: m.uid ? (m.uid.length > 15 ? `${m.uid.slice(0, 6)}...${m.uid.slice(-4)}` : m.uid) : "—",
            friends: (m.friend_count || m.friendCount) ? `${(m.friend_count || m.friendCount).toLocaleString("vi-VN")} bạn` : "—",
            time: m.scanned_at || "Vừa xong",
          }))
        );
        setTotalCount(res.total || 0);
      } else {
        setMembers([]);
        setTotalCount(0);
      }
    } catch {
      setMembers([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [selectedCatId, memberSearch, friendFilter, currentPage, pageSize]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

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

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  // Toggle selection
  const allFilteredSelected =
    members.length > 0 &&
    members.every((m) => selectedMemberIds.has(m.id));

  const handleToggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedMemberIds(new Set());
    } else {
      setSelectedMemberIds(new Set(members.map((m) => m.id)));
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
  const handleRemoveMember = async (id) => {
    try {
      await deleteScannedMember(id);
      toast.success("Đã xóa thành viên khỏi danh sách!");
      setSelectedMemberIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      loadMembers();
    } catch {
      toast.error("Không thể xóa thành viên!");
    }
  };

  // Bulk Delete
  const handleBulkDelete = async () => {
    if (selectedMemberIds.size === 0) return;
    try {
      const ids = Array.from(selectedMemberIds);
      const res = await deleteScannedMembersBulk(ids);
      toast.success(`Đã xóa ${res?.deleted_count || ids.length} thành viên được chọn!`);
      setSelectedMemberIds(new Set());
      loadMembers();
    } catch {
      toast.error("Không thể xóa các thành viên đã chọn!");
    }
  };

  // Actions & Exports (UC-GMS-06)
  const exportMembersCsv = (memberList, title = "MemberScraping") => {
    if (!memberList || memberList.length === 0) {
      toast.warning("Chưa có thành viên nào để xuất!");
      return;
    }
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const filename = `${title}_${ts}.csv`;

    const headers = ["STT", "Họ tên", "UID Facebook", "Nhóm", "Link cá nhân", "Số bạn bè", "Vai trò", "Thời gian quét"];
    const rows = memberList.map((m, idx) => [
      idx + 1,
      `"${(m.name || "").replace(/"/g, '""')}"`,
      `\t${m.uid}`, // Tab prefix to preserve text in Excel
      `"${(m.group_name || m.group_id || "").replace(/"/g, '""')}"`,
      `"${(m.profile_url || `https://www.facebook.com/${m.uid}`).replace(/"/g, '""')}"`,
      m.friend_count ?? m.friendCount ?? 0,
      m.role === "admin" ? "Quản trị viên" : m.role === "moderator" ? "Kiểm duyệt viên" : "Thành viên",
      `"${m.scanned_at || ""}"`,
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Đã xuất ${memberList.length} thành viên ra tệp: ${filename}`);
  };

  const handleRefresh = async () => {
    await loadCategories();
    await loadMembers();
    toast.info("Đã làm mới danh mục và danh sách thành viên.");
  };

  const handleExportAll = async () => {
    try {
      const res = await getScannedMembers({ page_size: 5000 });
      const allMembers = res?.members || [];
      exportMembersCsv(allMembers, "MemberScraping_All");
    } catch {
      toast.error("Không thể tải toàn bộ danh sách để xuất file!");
    }
  };

  const handleExportGroup = () => {
    const catName = currentCategory?.fullName || currentCategory?.name || "Category";
    exportMembersCsv(members, `MemberScraping_${catName.replace(/[^a-zA-Z0-9]/g, "_")}`);
  };

  const handleExportSelected = () => {
    if (selectedMemberIds.size === 0) {
      toast.warning("Chưa chọn thành viên nào để xuất!");
      return;
    }
    const selectedList = members.filter((m) => selectedMemberIds.has(m.id));
    exportMembersCsv(selectedList, "MemberScraping_Selected");
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
              {totalCount.toLocaleString("vi-VN")} UID
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
            onSelectCat={(id) => {
              setSelectedCatId(id);
              setCurrentPage(1);
            }}
            categorySearch={categorySearch}
            onSearchChange={setCategorySearch}
            onOpenCreateModal={() => setCreateCategoryModalOpen(true)}
          />

          {/* Right Detail And Table Column */}
          <div className="lg:col-span-8 p-5 flex flex-col gap-3.5 min-w-0">
            <MemberTableToolbar
              currentCategory={currentCategory}
              memberSearch={memberSearch}
              onMemberSearchChange={(val) => {
                setMemberSearch(val);
                setCurrentPage(1);
              }}
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
              members={members}
              loading={loading}
              selectedMemberIds={selectedMemberIds}
              onToggleSelectRow={handleToggleSelect}
              onToggleSelectAll={handleToggleSelectAll}
              allFilteredSelected={allFilteredSelected}
              onRemoveMember={handleRemoveMember}
              totalFilteredCount={totalCount}
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
