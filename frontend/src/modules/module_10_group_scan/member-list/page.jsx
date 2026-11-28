"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
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
import { downloadTable, memberExportTable, safeFileName } from "../utils/exportTable";
import ModulePageHeader from "../components/ModulePageHeader";
import ConfirmDialog from "@/components/ui/confirm-dialog";


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
  // Gõ tìm kiếm: chờ ngừng gõ 350ms mới gọi API (trước đây mỗi phím 1 request → hàng đợi dài, spinner quay mãi)
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(memberSearch.trim()), 350);
    return () => clearTimeout(t);
  }, [memberSearch]);
  const [ownerTotal, setOwnerTotal] = useState(0); // tổng thành viên đã quét (mọi danh mục) → bật/tắt nút Xuất toàn bộ file
  const requestSeq = useRef(0); // chỉ áp kết quả của lần gọi mới nhất
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
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const res = await getScannedMembers({
        category_id: selectedCatId,
        search: debouncedSearch,
        page: currentPage,
        page_size: pageSize,
      });
      if (seq !== requestSeq.current) return; // đã có lần gọi mới hơn → bỏ kết quả cũ
      if (res?.members && Array.isArray(res.members)) {
        setMembers(
          res.members.map((m, idx) => ({
            ...m,
            id: m.id,
            stt: String((currentPage - 1) * pageSize + idx + 1).padStart(2, "0"),
            shortUid: m.uid ? (m.uid.length > 15 ? `${m.uid.slice(0, 6)}...${m.uid.slice(-4)}` : m.uid) : "—",
            time: m.scanned_at || "Vừa xong",
          }))
        );
        setTotalCount(res.total || 0);
        getMembersSummary()
          .then((s) => setOwnerTotal(Math.max(Number(s?.total_members) || 0, Number(res.total) || 0)))
          .catch(() => setOwnerTotal(Number(res.total) || 0));
      } else {
        setMembers([]);
        setTotalCount(0);
      }
    } catch {
      if (seq !== requestSeq.current) return;
      setMembers([]);
      setTotalCount(0);
    } finally {
      // Lần gọi mới nhất xong (có hay không có kết quả) → tắt spinner ngay để hiện bảng / Empty State
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [selectedCatId, debouncedSearch, currentPage, pageSize]);

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

  // Xóa thành viên: luôn hỏi xác nhận trước (xóa 1 người hoặc xóa các người đã tick)
  const [deletePrompt, setDeletePrompt] = useState(null); // { ids: [], name?: string }
  const [deleting, setDeleting] = useState(false);

  const handleRemoveMember = (id) => {
    const m = members.find((x) => x.id === id);
    setDeletePrompt({ ids: [id], name: m?.name || m?.member_name || m?.uid || "" });
  };

  const handleBulkDelete = () => {
    if (selectedMemberIds.size === 0) return;
    setDeletePrompt({ ids: Array.from(selectedMemberIds) });
  };

  const confirmDeleteMembers = async () => {
    if (!deletePrompt || deleting) return;
    const { ids } = deletePrompt;
    setDeleting(true);
    try {
      if (ids.length === 1) {
        await deleteScannedMember(ids[0]);
        toast.success("Đã xóa thành viên khỏi danh sách!");
      } else {
        const res = await deleteScannedMembersBulk(ids);
        toast.success(`Đã xóa ${res?.deleted_count || ids.length} thành viên được chọn!`);
      }
      setSelectedMemberIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      setDeletePrompt(null);
      loadMembers();
    } catch {
      toast.error(ids.length === 1 ? "Không thể xóa thành viên!" : "Không thể xóa các thành viên đã chọn!");
    } finally {
      setDeleting(false);
    }
  };

  // Xuất Excel thành viên — luôn lấy ĐỦ từ máy chủ (bảng chỉ tải từng trang).
  const exportMembers = async (memberList, baseName) => {
    if (!memberList || memberList.length === 0) {
      toast.warning("Chưa có thành viên nào để xuất!");
      return;
    }
    try {
      const fileName = await downloadTable({ format: "xlsx", baseName, sheetName: "Thanh vien", ...memberExportTable(memberList) });
      toast.success(`Đã xuất ${memberList.length} thành viên ra file: ${fileName}`);
    } catch (err) {
      toast.error("Xuất file thất bại: " + (err?.message || "Lỗi"));
    }
  };

  const fetchAllMembers = async (params = {}) => {
    const res = await getScannedMembers({ ...params, page: 1, page_size: 100000 }, { fresh: true });
    return res?.members || [];
  };

  const handleRefresh = async () => {
    await loadCategories();
    await loadMembers();
    toast.info("Đã làm mới danh mục và danh sách thành viên.");
  };

  const handleExportAll = async () => {
    try {
      exportMembers(await fetchAllMembers(), "Thanh_vien_tat_ca");
    } catch {
      toast.error("Không thể tải toàn bộ danh sách để xuất file!");
    }
  };

  const handleExportGroup = async () => {
    const catName = currentCategory?.fullName || currentCategory?.name || "Danh_muc";
    try {
      const list = await fetchAllMembers({ category_id: selectedCatId, search: memberSearch });
      exportMembers(list, `Thanh_vien_${safeFileName(catName)}`);
    } catch {
      toast.error("Không thể tải danh sách thành viên của nhóm để xuất file!");
    }
  };

  const handleExportSelected = () => {
    if (selectedMemberIds.size === 0) {
      toast.warning("Chưa chọn thành viên nào để xuất!");
      return;
    }
    const selectedList = members.filter((m) => selectedMemberIds.has(m.id));
    exportMembers(selectedList, "Thanh_vien_da_chon");
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
      const created = await createScanCategory(catName);
      if (created?.existed) {
        toast.warning(`Danh mục «${created.category?.name || catName}» đã tồn tại — không tạo trùng.`);
        return;
      }
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
      <ModulePageHeader navId="scan.member_list" />
      {/* Hai khung riêng giống Danh sách page (Module 11): danh mục bên trái (dính khi cuộn) + bảng thành viên bên phải */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
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

        <section className="min-w-0 flex-1 rounded-xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        {/* Card Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-xl border-b border-[#F1F5F9] px-5 py-4 bg-[#F8FAFC]/50">
          <div className="flex items-center gap-2.5">
            <h2 className="font-heading text-base font-semibold text-[#0F172A]">
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
              disabled={ownerTotal === 0}
              title={ownerTotal === 0 ? "Danh sách thành viên đang rỗng — chưa có dữ liệu để xuất" : undefined}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3 text-xs font-semibold text-[#334155] shadow-xs hover:bg-slate-50 transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
            >
              <Download className="size-3.5 text-[#64748B]" />
              <span>Xuất toàn bộ file</span>
            </button>
          </div>
        </div>

          {/* Right Detail And Table Column */}
          <div className="p-5 flex flex-col gap-3.5 min-w-0">
            <MemberTableToolbar
              currentCategory={currentCategory}
              memberSearch={memberSearch}
              onMemberSearchChange={(val) => {
                setMemberSearch(val);
                setCurrentPage(1);
              }}
              selectedMemberIds={selectedMemberIds}
              onExportGroup={handleExportGroup}
              onExportSelected={handleExportSelected}
              onBulkDelete={handleBulkDelete}
              canExportGroup={totalCount > 0 && !loading}
            />

            <MemberDataTable
              members={members}
              loading={loading}
              selectedMemberIds={selectedMemberIds}
              onToggleSelectRow={handleToggleSelect}
              onSelectRows={setSelectedMemberIds}
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
        </section>
      </div>

      {/* Xác nhận trước khi xóa thành viên */}
      <ConfirmDialog
        isOpen={Boolean(deletePrompt)}
        onClose={() => { if (!deleting) setDeletePrompt(null); }}
        onConfirm={confirmDeleteMembers}
        loading={deleting}
        variant="danger"
        title="Xóa thành viên"
        description={
          deletePrompt?.ids.length === 1
            ? `Bạn có chắc muốn xóa thành viên${deletePrompt.name ? ` «${deletePrompt.name}»` : ""} khỏi danh sách? Thao tác này không thể hoàn tác.`
            : `Bạn có chắc muốn xóa ${deletePrompt?.ids.length || 0} thành viên đã chọn khỏi danh sách? Thao tác này không thể hoàn tác.`
        }
        confirmText="Xóa"
        cancelText="Hủy"
      />

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
