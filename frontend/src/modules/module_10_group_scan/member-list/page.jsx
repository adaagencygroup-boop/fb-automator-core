"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  RotateCcw,
  Download,
  Plus,
  Search,
  ExternalLink,
  Trash2,
  ChevronDown,
  Folder,
  X,
} from "lucide-react";
import { toast } from "@/lib/toast";
import Pagination from "@/components/ui/pagination";
import CustomSelect from "@/components/ui/custom-select";
import { getScanCategories, createScanCategory } from "../service";

const FRIEND_FILTER_OPTIONS = [
  { value: "all", label: "Tất cả số bạn bè" },
  { value: "under500", label: "Dưới 500 bạn bè" },
  { value: "500to2000", label: "500 - 2.000 bạn bè" },
  { value: "over2000", label: "Trên 2.000 bạn bè" },
];

export default function GroupScanMemberListPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

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
  const [friendDropdownOpen, setFriendDropdownOpen] = useState(false);
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
          <div className="lg:col-span-4 p-5 bg-[#F8FAFC]/40 border-r border-[#E2E8F0] flex flex-col gap-3.5">
            {/* Header & Search */}
            <div className="flex flex-col gap-2 w-full">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#1E293B]">
                  Danh mục nhóm ({categories.length})
                </span>
                <button
                  type="button"
                  onClick={() => setCreateCategoryModalOpen(true)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] hover:underline"
                >
                  <Plus className="size-3.5" />
                  <span>Thêm mới</span>
                </button>
              </div>

              {/* Search Category Input */}
              <div className="relative w-full">
                <Search className="size-3.5 absolute left-3 top-2 text-[#94A3B8]" />
                <input
                  type="text"
                  placeholder="Tìm nhóm..."
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                  className="w-full h-7 pl-8 pr-3 text-xs text-slate-800 border border-[#E2E8F0] bg-white rounded-lg outline-none focus:border-[#2563EB]"
                />
              </div>
            </div>

            {/* Category Group Cards List */}
            <div className="flex flex-col gap-2 w-full max-h-[480px] overflow-y-auto pr-0.5">
              {filteredCategories.length === 0 ? (
                <div className="text-center py-8 text-xs text-[#94A3B8]">
                  Chưa có danh mục nào từ cơ sở dữ liệu.
                </div>
              ) : (
                filteredCategories.map((cat) => {
                  const isSelected = cat.id === selectedCatId;
                  return (
                    <button
                      type="button"
                      key={cat.id}
                      onClick={() => setSelectedCatId(cat.id)}
                      className={`flex flex-col items-start p-3 gap-0.5 w-full rounded-xl text-left transition-all ${
                        isSelected
                          ? "bg-[#EFF6FF]/60 border border-[#3B82F6] shadow-xs"
                          : "bg-white border border-[#E2E8F0] hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span
                          className={`text-xs leading-4 ${
                            isSelected ? "font-bold text-[#1E3A8A]" : "font-semibold text-[#1E293B]"
                          } line-clamp-1`}
                        >
                          {cat.name}
                        </span>
                        {isSelected && (
                          <span className="size-2 rounded-full bg-[#2563EB] shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`size-1.5 rounded-full shrink-0 ${
                            isSelected ? "bg-[#3B82F6]" : "bg-[#CBD5E1]"
                          }`}
                        />
                        <span
                          className={`text-[11px] leading-4 ${
                            isSelected ? "text-[#2563EB]/90 font-medium" : "text-[#94A3B8]"
                          }`}
                        >
                          {cat.membersSummary}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Detail And Table Column */}
          <div className="lg:col-span-8 p-5 flex flex-col gap-3.5 min-w-0">
            {/* Group Meta Info */}
            <div className="flex flex-wrap justify-between items-center pb-3 border-b border-[#F1F5F9] gap-3">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-[#10B981] shrink-0" />
                  <h3 className="text-sm font-bold text-[#0F172A]">
                    {currentCategory ? (currentCategory.fullName || currentCategory.name) : "Chưa chọn danh mục"}
                  </h3>
                </div>
                <p className="text-xs text-[#64748B]">
                  {currentCategory ? (currentCategory.fullMeta || currentCategory.description || "—") : "Vui lòng chọn hoặc thêm danh mục"}
                </p>
              </div>

              <button
                type="button"
                onClick={handleExportGroup}
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-3 text-xs font-semibold text-[#1D4ED8] hover:bg-blue-100 transition-colors"
              >
                <Download className="size-3 text-[#1D4ED8]" />
                <span>Xuất nhóm</span>
              </button>
            </div>

            {/* Filter Bar */}
            <div className="flex flex-wrap items-center gap-2.5 w-full">
              {/* Keyword Search */}
              <div className="relative flex-1 min-w-[200px]">
                <Search className="size-3.5 absolute left-3 top-2 text-[#94A3B8]" />
                <input
                  type="text"
                  placeholder="Tìm UID, Tên thành viên..."
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  className="w-full h-7 pl-8 pr-3 text-xs text-[#6B7280] border border-[#E2E8F0] bg-white rounded-lg outline-none focus:border-[#2563EB]"
                />
              </div>

              {/* Friend Count Filter */}
              <div className="w-48 shrink-0">
                <CustomSelect
                  value={friendFilter}
                  onChange={(val) => {
                    setFriendFilter(val);
                    setCurrentPage(1);
                  }}
                  options={FRIEND_FILTER_OPTIONS}
                  size="sm"
                  buttonClassName="h-7 text-xs"
                />
              </div>
            </div>

            {/* Tick chọn / Bulk Actions Toolbar - Chỉ hiển thị khi có ít nhất 1 thành viên được tích chọn */}
            {selectedMemberIds.size > 0 && (
              <div className="flex flex-wrap justify-between items-center p-2.5 px-3 bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg gap-2 animate-in fade-in duration-150">
                <div className="flex items-center gap-2">
                  <span className="size-5 bg-[#2563EB] text-white rounded flex items-center justify-center font-bold text-[11px]">
                    {selectedMemberIds.size}
                  </span>
                  <span className="font-medium text-xs text-[#1E3A8A]">
                    thành viên đang được tick chọn
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleExportSelected}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-[#BFDBFE] rounded text-xs font-semibold text-[#1E40AF] hover:bg-blue-50 transition-colors"
                  >
                    <Download className="size-3 text-[#2563EB]" />
                    <span>Xuất file chọn</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleBulkDelete}
                    className="size-7 flex items-center justify-center text-[#DC2626] hover:bg-red-50 rounded transition-colors"
                    title="Xóa các mục đã chọn"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Member Data Table */}
            <div className="w-full border border-[#E2E8F0] rounded-lg overflow-x-auto">
              <table className="w-full min-w-[650px] text-left text-xs">
                <thead className="bg-[#F8FAFC] text-[10px] font-bold uppercase tracking-wide text-[#64748B] border-b border-[#E2E8F0]">
                  <tr>
                    <th className="py-2.5 px-3 text-center w-10">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={handleToggleSelectAll}
                        className="size-3.5 rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                      />
                    </th>
                    <th className="py-2.5 px-3 text-center w-12">STT</th>
                    <th className="py-2.5 px-3">HỌ VÀ TÊN</th>
                    <th className="py-2.5 px-3">PROFILE LINK / UID</th>
                    <th className="py-2.5 px-3 w-28">SỐ BẠN BÈ</th>
                    <th className="py-2.5 px-3 w-24">THỜI GIAN</th>
                    <th className="py-2.5 px-3 text-right w-20">THAO TÁC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9] bg-white">
                  {paginatedMembers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-10 text-xs text-slate-400">
                        Chưa có dữ liệu thành viên nào được quét trong danh mục này.
                      </td>
                    </tr>
                  ) : (
                    paginatedMembers.map((member) => {
                      const isChecked = selectedMemberIds.has(member.id);
                      return (
                        <tr
                          key={member.id}
                          className={`transition-colors hover:bg-slate-50 ${
                            isChecked ? "bg-[#EFF6FF]/25" : ""
                          }`}
                        >
                          <td className="py-2 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggleSelect(member.id)}
                              className="size-3.5 rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                            />
                          </td>
                          <td className="py-2 px-3 text-center font-mono text-xs text-[#94A3B8]">
                            {member.stt}
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-2.5">
                              <span
                                className={`size-6 rounded-full ${member.avatarBg} ${member.avatarText} font-bold text-[11px] flex items-center justify-center shrink-0 uppercase`}
                              >
                                {member.initial}
                              </span>
                              <span className="font-semibold text-xs text-[#1E293B]">
                                {member.name}
                              </span>
                            </div>
                          </td>
                          <td className="py-2 px-3">
                            <a
                              href={`https://facebook.com/${member.uid}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 font-mono text-[11px] text-[#2563EB] hover:underline"
                            >
                              <span>{member.shortUid}</span>
                              <ExternalLink className="size-3 text-[#2563EB]" />
                            </a>
                          </td>
                          <td className="py-2 px-3 font-semibold text-xs text-[#334155]">
                            {member.friends}
                          </td>
                          <td className="py-2 px-3 font-mono text-[11px] text-[#64748B]">
                            {member.time}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleRemoveMember(member.id)}
                              className="rounded p-1 text-[#94A3B8] hover:bg-rose-50 hover:text-rose-600 transition-colors"
                              title="Xóa thành viên"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Table Pagination */}
            <div className="flex flex-row justify-between items-center w-full pt-1">
              <span className="text-xs text-[#64748B]">
                Hiển thị {filteredMembers.length > 0 ? `${(currentPage - 1) * pageSize + 1} - ${Math.min(currentPage * pageSize, filteredMembers.length)}` : "0"} của{" "}
                {currentCategory?.totalUidCount ? currentCategory.totalUidCount.toLocaleString("vi-VN") : filteredMembers.length} UID
              </span>

              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Modal Thêm Mới Danh Mục Nhóm */}
      {mounted && createCategoryModalOpen && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCreateCategoryModalOpen(false);
          }}
        >
          <form
            onSubmit={handleCreateCategory}
            className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4 animate-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between border-b pb-3 border-slate-100">
              <h3 className="font-bold text-base text-slate-800 flex items-center gap-2">
                <Folder className="size-5 text-blue-600" />
                Thêm mới danh mục nhóm
              </h3>
              <button
                type="button"
                onClick={() => setCreateCategoryModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Tên danh mục nhóm</label>
              <input
                type="text"
                required
                placeholder="Ví dụ: Hội Mẹ & Bé Hà Nội..."
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                className="w-full h-8 px-3 text-xs border border-slate-300 rounded-lg outline-none focus:border-blue-600"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setCreateCategoryModalOpen(false)}
                className="px-3.5 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg text-xs font-semibold"
              >
                Hủy bỏ
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold"
              >
                Tạo danh mục
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
}
