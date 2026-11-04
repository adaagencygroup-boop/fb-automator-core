"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Folder,
  Plus,
  Search,
  ExternalLink,
  Trash2,
  ChevronDown,
  Eye,
  MoreVertical,
  X,
  FileSpreadsheet,
  FolderInput,
} from "lucide-react";
import { toast } from "@/lib/toast";
import Pagination from "@/components/ui/pagination";
import CustomSelect from "@/components/ui/custom-select";
import { getScannedGroups } from "../service";

function IconLike() {
  return (
    <svg width="10" height="9" viewBox="0 0 10 9" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
      <path d="M6.11328 0.0208333C6.3737 0.0729167 6.57552 0.203125 6.71875 0.411458V0.411458C6.86198 0.619792 6.90755 0.854167 6.85547 1.11458L6.81641 1.34896C6.71224 1.86979 6.52344 2.35807 6.25 2.8138H9.0625C9.32292 2.82682 9.54427 2.91797 9.72656 3.08724C9.89583 3.26953 9.98698 3.49089 10 3.7513C9.98698 4.12891 9.81771 4.40885 9.49219 4.59115C9.71354 4.77344 9.83073 5.01432 9.84375 5.3138C9.84375 5.54818 9.77214 5.75 9.62891 5.91927C9.48568 6.08854 9.30339 6.19271 9.08203 6.23177C9.17318 6.375 9.21875 6.53776 9.21875 6.72005C9.19271 7.16276 8.97786 7.46224 8.57422 7.61849C8.58724 7.68359 8.59375 7.7487 8.59375 7.8138C8.58073 8.07422 8.48958 8.29557 8.32031 8.47786C8.13802 8.64713 7.91667 8.73828 7.65625 8.7513H5.76172C5.37109 8.7513 5.01953 8.64713 4.70703 8.4388L3.96484 7.93099C3.41797 7.55339 3.13802 7.03255 3.125 6.36849V5.6263V4.6888V4.20052C3.13802 3.60156 3.3724 3.11328 3.82812 2.73568L3.96484 2.61849C4.4987 2.1888 4.83724 1.64193 4.98047 0.977865L5.01953 0.763021C5.07161 0.502604 5.20182 0.300781 5.41016 0.157552C5.61849 0.0143229 5.85286 -0.03125 6.11328 0.0208333V0.0208333V0.0208333M0.625 3.1263H1.875C2.05729 3.1263 2.20703 3.1849 2.32422 3.30208C2.44141 3.41927 2.5 3.56901 2.5 3.7513V8.1263C2.5 8.30859 2.44141 8.45833 2.32422 8.57552C2.20703 8.69271 2.05729 8.7513 1.875 8.7513H0.625C0.442708 8.7513 0.292969 8.69271 0.175781 8.57552C0.0585938 8.45833 0 8.30859 0 8.1263V3.7513C0 3.56901 0.0585938 3.41927 0.175781 3.30208C0.292969 3.1849 0.442708 3.1263 0.625 3.1263V3.1263V3.1263" fill="#1D4ED8"/>
    </svg>
  );
}

function IconComment() {
  return (
    <svg width="10" height="9" viewBox="0 0 10 9" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
      <path d="M5 8.125C5.9375 8.11198 6.77734 7.92969 7.51953 7.57812V7.57812C8.27474 7.21354 8.8737 6.72526 9.31641 6.11328V6.11328C9.75911 5.5013 9.98698 4.81771 10 4.0625C9.98698 3.30729 9.75911 2.6237 9.31641 2.01172C8.8737 1.39974 8.27474 0.911458 7.51953 0.546875C6.77734 0.195312 5.9375 0.0130208 5 0C4.0625 0.0130208 3.22266 0.195312 2.48047 0.546875C1.72526 0.911458 1.1263 1.39974 0.683594 2.01172C0.240885 2.6237 0.0130208 3.30729 0 4.0625C0.0130208 4.96094 0.325521 5.7487 0.9375 6.42578C0.872396 6.90755 0.729167 7.31771 0.507812 7.65625C0.403646 7.83854 0.30599 7.97526 0.214844 8.06641C0.175781 8.11849 0.143229 8.15755 0.117188 8.18359C0.117188 8.19661 0.110677 8.20312 0.0976562 8.20312C0.0976562 8.20312 0.0976562 8.20964 0.0976562 8.22266V8.22266V8.22266V8.22266V8.22266V8.22266C0.00651041 8.3138 -0.0195312 8.42448 0.0195312 8.55469C0.0846354 8.6849 0.182292 8.75 0.3125 8.75C0.885417 8.72396 1.41927 8.60026 1.91406 8.37891C2.36979 8.17057 2.72135 7.96875 2.96875 7.77344C3.59375 8.00781 4.27083 8.125 5 8.125V8.125V8.125M2.5 3.4375C2.68229 3.4375 2.83203 3.49609 2.94922 3.61328V3.61328C3.06641 3.73047 3.125 3.88021 3.125 4.0625C3.125 4.24479 3.06641 4.39453 2.94922 4.51172C2.83203 4.62891 2.68229 4.6875 2.5 4.6875C2.31771 4.6875 2.16797 4.62891 2.05078 4.51172C1.93359 4.39453 1.875 4.24479 1.875 4.0625C1.875 3.88021 1.93359 3.73047 2.05078 3.61328C2.16797 3.49609 2.31771 3.4375 2.5 3.4375V3.4375V3.4375M5 3.4375C5.18229 3.4375 5.33203 3.49609 5.44922 3.61328V3.61328C5.56641 3.73047 5.625 3.88021 5.625 4.0625C5.625 4.24479 5.56641 4.39453 5.44922 4.51172C5.33203 4.62891 5.18229 4.6875 5 4.6875C4.81771 4.6875 4.66797 4.62891 4.55078 4.51172C4.43359 4.39453 4.375 4.24479 4.375 4.0625C4.375 3.88021 4.43359 3.73047 4.55078 3.61328C4.66797 3.49609 4.81771 3.4375 5 3.4375V3.4375V3.4375M6.875 4.0625C6.875 3.88021 6.93359 3.73047 7.05078 3.61328V3.61328C7.16797 3.49609 7.31771 3.4375 7.5 3.4375C7.68229 3.4375 7.83203 3.49609 7.94922 3.61328C8.06641 3.73047 8.125 3.88021 8.125 4.0625C8.125 4.24479 8.06641 4.39453 7.94922 4.51172C7.83203 4.62891 7.68229 4.6875 7.5 4.6875C7.31771 4.6875 7.16797 4.62891 7.05078 4.51172C6.93359 4.39453 6.875 4.24479 6.875 4.0625V4.0625V4.0625" fill="#047857"/>
    </svg>
  );
}

function IconShare() {
  return (
    <svg width="10" height="9" viewBox="0 0 10 9" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
      <path d="M5.99609 0.0595238C5.76172 0.176711 5.63802 0.365513 5.625 0.62593V1.87593H3.4375C2.46094 1.90197 1.65365 2.24051 1.01562 2.89156C0.364583 3.52958 0.0260417 4.33687 0 5.31343C0.0130208 6.0426 0.15625 6.64807 0.429688 7.12984C0.690104 7.61161 0.976562 7.9827 1.28906 8.24312C1.60156 8.49051 1.82292 8.64676 1.95312 8.71187C2.00521 8.73791 2.05729 8.75093 2.10938 8.75093C2.34375 8.72489 2.47396 8.59468 2.5 8.3603C2.48698 8.21708 2.42188 8.09338 2.30469 7.98921C2.21354 7.89807 2.1224 7.76135 2.03125 7.57905C1.9401 7.40978 1.88802 7.17541 1.875 6.87593C1.88802 6.34208 2.07031 5.89937 2.42188 5.5478C2.77344 5.19624 3.21615 5.01395 3.75 5.00093H5.625V6.25093C5.63802 6.51135 5.76172 6.70015 5.99609 6.81734C6.24349 6.9215 6.46484 6.88895 6.66016 6.71968L9.78516 3.90718C9.92839 3.77697 10 3.62072 10 3.43843C10 3.25614 9.92839 3.09989 9.78516 2.96968L6.66016 0.15718C6.46484 -0.0120908 6.24349 -0.0446429 5.99609 0.0595238V0.0595238V0.0595238" fill="#7E22CE"/>
    </svg>
  );
}

const DATE_FILTER_OPTIONS = [
  { value: "all", label: "Ngày đăng: Tất cả" },
  { value: "today", label: "Hôm nay" },
  { value: "7days", label: "7 ngày qua" },
  { value: "30days", label: "30 ngày qua" },
];

const LIKE_FILTER_OPTIONS = [
  { value: "all", label: "Tất cả like" },
  { value: "100", label: "> 100 like" },
  { value: "500", label: "> 500 like" },
  { value: "1000", label: "> 1,000 like" },
];

const SHARE_FILTER_OPTIONS = [
  { value: "all", label: "Tất cả share" },
  { value: "10", label: "> 10 share" },
  { value: "50", label: "> 50 share" },
  { value: "100", label: "> 100 share" },
];

const COMMENT_FILTER_OPTIONS = [
  { value: "all", label: "Tất cả comment" },
  { value: "20", label: "> 20 cmt" },
  { value: "100", label: "> 100 cmt" },
  { value: "500", label: "> 500 cmt" },
];

const PAGE_SIZE_OPTIONS = [
  { value: 5, label: "5" },
  { value: 10, label: "10" },
  { value: 20, label: "20" },
];

const NEW_GROUP_CATEGORY_OPTIONS = [
  { value: "Hội buôn", label: "Hội buôn" },
  { value: "Kinh doanh", label: "Kinh doanh" },
  { value: "Đầu tư", label: "Đầu tư" },
  { value: "Thương mại điện tử", label: "Thương mại điện tử" },
];

export default function GroupScanPostListPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Groups State
  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [addGroupModalOpen, setAddGroupModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupCategory, setNewGroupCategory] = useState("Hội buôn");

  // Posts State
  const [posts, setPosts] = useState([]);
  const [postSearch, setPostSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [likeFilter, setLikeFilter] = useState("all");
  const [shareFilter, setShareFilter] = useState("all");
  const [commentFilter, setCommentFilter] = useState("all");

  const [selectedPostIds, setSelectedPostIds] = useState(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  const loadGroups = useCallback(async () => {
    try {
      const res = await getScannedGroups();
      const loaded = res?.groups || [];
      if (loaded.length > 0) {
        setGroups(
          loaded.map((g) => ({
            id: g.id || g.group_id,
            name: g.name || g.group_id,
            category: g.category_name || g.keyword || "Chung",
            postCount: 0,
            status: "active",
            statusLabel: "Đang hoạt động",
            updateTime: g.created_at || "Vừa cập nhật",
          }))
        );
        setSelectedGroupId((prev) =>
          loaded.some((g) => (g.id || g.group_id) === prev)
            ? prev
            : loaded[0].id || loaded[0].group_id
        );
      } else {
        setGroups([]);
        setSelectedGroupId("");
      }
    } catch {
      setGroups([]);
      setSelectedGroupId("");
    }
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  // Active group details
  const activeGroup = useMemo(() => {
    return groups.find((g) => g.id === selectedGroupId) || groups[0] || null;
  }, [groups, selectedGroupId]);

  // Filter Groups
  const filteredGroups = useMemo(() => {
    if (!groupSearch.trim()) return groups;
    return groups.filter((g) =>
      g.name.toLowerCase().includes(groupSearch.toLowerCase()) ||
      g.category.toLowerCase().includes(groupSearch.toLowerCase())
    );
  }, [groups, groupSearch]);

  // Filter Posts
  const filteredPosts = useMemo(() => {
    return posts.filter((p) => {
      const matchQuery =
        !postSearch.trim() ||
        p.title.toLowerCase().includes(postSearch.toLowerCase()) ||
        p.authorName.toLowerCase().includes(postSearch.toLowerCase()) ||
        p.linkText.includes(postSearch.trim());
      return matchQuery;
    });
  }, [posts, postSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredPosts.length / pageSize));
  const paginatedPosts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredPosts.slice(start, start + pageSize);
  }, [filteredPosts, currentPage, pageSize]);

  // Select all checkbox
  const allFilteredSelected =
    filteredPosts.length > 0 &&
    filteredPosts.every((p) => selectedPostIds.has(p.id));

  const handleToggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedPostIds(new Set());
    } else {
      setSelectedPostIds(new Set(filteredPosts.map((p) => p.id)));
    }
  };

  const handleToggleSelectPost = (id) => {
    setSelectedPostIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Delete single post
  const handleRemovePost = (id) => {
    setPosts((prev) => prev.filter((p) => p.id !== id));
    setSelectedPostIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    toast.success("Đã xóa bài viết khỏi danh sách!");
  };

  // Bulk Delete
  const handleBulkDelete = () => {
    if (selectedPostIds.size === 0) return;
    const count = selectedPostIds.size;
    setPosts((prev) => prev.filter((p) => !selectedPostIds.has(p.id)));
    setSelectedPostIds(new Set());
    toast.success(`Đã xóa ${count} bài viết thành công!`);
  };

  // Export handlers
  const handleExportExcel = () => {
    if (!activeGroup) {
      toast.warning("Chưa có nhóm nào để xuất bài viết!");
      return;
    }
    toast.success(`Đang xuất file Excel bài viết của ${activeGroup.name}...`);
  };

  const handleMoveCategory = () => {
    if (selectedPostIds.size === 0) {
      toast.warning("Vui lòng chọn bài viết cần chuyển mục!");
      return;
    }
    toast.info(`Chức năng chuyển mục cho ${selectedPostIds.size} bài viết.`);
  };

  // Add new group
  const handleAddGroup = (e) => {
    e.preventDefault();
    if (!newGroupName.trim()) {
      toast.error("Vui lòng nhập tên nhóm!");
      return;
    }
    const newId = `grp-${Date.now()}`;
    const newGrp = {
      id: newId,
      name: newGroupName.trim(),
      category: newGroupCategory,
      postCount: 0,
      status: "active",
      statusLabel: "Đang hoạt động",
      updateTime: "Vừa tạo",
    };
    setGroups((prev) => [newGrp, ...prev]);
    setSelectedGroupId(newId);
    setNewGroupName("");
    setAddGroupModalOpen(false);
    toast.success("Đã thêm nhóm mới thành công!");
  };

  return (
    <div className="-m-6 min-h-full space-y-5 bg-[#F4F7FC] p-6">
      {/* Two-Column Workspace Layout */}
      <div className="flex flex-col lg:flex-row gap-5 items-start w-full min-h-[640px]">
        {/* Left Column: LeftCategoryPanel */}
        <section className="w-full lg:w-[280px] shrink-0 bg-white border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-xl flex flex-col overflow-hidden">
          {/* Panel Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-[#F8FAFC]/50 border-b border-[#F1F5F9]">
            <div className="flex items-center gap-2">
              <Folder className="size-4 text-[#2563EB] fill-[#2563EB]" />
              <span className="text-xs font-bold uppercase tracking-wide text-[#1E293B]">
                DANH SÁCH NHÓM
              </span>
            </div>

            <button
              type="button"
              onClick={() => setAddGroupModalOpen(true)}
              className="size-7 flex items-center justify-center rounded-lg bg-[#EFF6FF] text-[#2563EB] font-bold text-sm hover:bg-blue-100 transition-colors"
              title="Thêm nhóm mới"
            >
              <Plus className="size-4" />
            </button>
          </div>

          {/* Counter info & Search */}
          <div className="px-4 py-3 border-b border-[#F1F5F9] flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-[#1E293B]">
                Đã quét {groups.length} nhóm
              </span>
              <span className="text-[11px] text-[#94A3B8]">
                {posts.length} bài viết
              </span>
            </div>

            <div className="relative w-full">
              <Search className="size-3.5 absolute left-2.5 top-2 text-[#94A3B8]" />
              <input
                type="text"
                placeholder="Lọc danh mục thư mục..."
                value={groupSearch}
                onChange={(e) => setGroupSearch(e.target.value)}
                className="w-full h-7 pl-8 pr-2.5 text-xs text-slate-800 border border-[#E2E8F0] bg-[#F8FAFC] rounded-lg outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>

          {/* Group Items List */}
          <div className="p-2.5 flex flex-col gap-1.5 max-h-[500px] overflow-y-auto">
            {filteredGroups.length === 0 ? (
              <div className="text-center py-8 text-xs text-[#94A3B8]">
                Chưa có nhóm nào trong cơ sở dữ liệu.
              </div>
            ) : (
              filteredGroups.map((grp) => {
                const isActive = grp.id === selectedGroupId;
                return (
                  <div
                    key={grp.id}
                    onClick={() => setSelectedGroupId(grp.id)}
                    className={`p-2.5 rounded-lg flex items-center justify-between cursor-pointer transition-all ${
                      isActive
                        ? "bg-[#EFF6FF]/60 border border-[#3B82F6] shadow-xs"
                        : "bg-white border border-transparent hover:border-slate-200"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 pr-1">
                      <span
                        className={`size-2 rounded-full shrink-0 ${
                          isActive ? "bg-[#2563EB]" : "bg-[#CBD5E1]"
                        }`}
                      />
                      <div className="flex flex-col min-w-0">
                        <span
                          className={`text-xs truncate ${
                            isActive ? "font-bold text-[#0F172A]" : "font-semibold text-[#1E293B]"
                          }`}
                        >
                          {grp.name}
                        </span>
                        <span className="text-[11px] text-[#64748B] truncate">
                          {grp.postCount} bài viết • {grp.category}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toast.info(`Tùy chọn cho nhóm: ${grp.name}`);
                      }}
                      className="p-1 text-slate-400 hover:text-slate-600 rounded"
                    >
                      <MoreVertical className="size-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Right Detail Section */}
        <section className="flex-1 min-w-0 bg-white border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-xl p-5 space-y-4">
          {/* Group Header Info */}
          <div className="flex flex-wrap justify-between items-center pb-3 border-b border-[#F1F5F9] gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-[#0F172A]">
                  {activeGroup ? activeGroup.name : "Chưa chọn nhóm"}
                </h3>
                {activeGroup && (
                  <span className="rounded-full bg-[#ECFDF5] border border-[#D1FAE5] px-2.5 py-0.5 text-[11px] font-semibold text-[#059669]">
                    {activeGroup.statusLabel}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#64748B]">
                {activeGroup
                  ? `${activeGroup.postCount} Bài viết • Danh mục: ${activeGroup.category} • ${activeGroup.updateTime}`
                  : "Vui lòng chọn hoặc quét nhóm"}
              </p>
            </div>

            <button
              type="button"
              onClick={handleExportExcel}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3 text-xs font-semibold text-[#334155] hover:bg-slate-50 transition-colors shadow-xs"
            >
              <FileSpreadsheet className="size-3.5 text-[#059669]" />
              <span>Xuất Excel</span>
            </button>
          </div>

          {/* Filter Bar Row */}
          <div className="flex flex-wrap items-center gap-2.5 w-full">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="size-3.5 absolute left-3 top-2 text-[#94A3B8]" />
              <input
                type="text"
                placeholder="Tìm theo tên bài viết, từ khóa, UID..."
                value={postSearch}
                onChange={(e) => setPostSearch(e.target.value)}
                className="w-full h-7 pl-8 pr-3 text-xs text-slate-800 border border-[#E2E8F0] rounded-lg outline-none focus:border-[#2563EB]"
              />
            </div>

            <div className="w-32 shrink-0">
              <CustomSelect
                value={dateFilter}
                onChange={(val) => {
                  setDateFilter(val);
                  setCurrentPage(1);
                }}
                options={DATE_FILTER_OPTIONS}
                size="sm"
                buttonClassName="h-7 text-xs"
              />
            </div>

            <div className="w-32 shrink-0">
              <CustomSelect
                value={likeFilter}
                onChange={(val) => {
                  setLikeFilter(val);
                  setCurrentPage(1);
                }}
                options={LIKE_FILTER_OPTIONS}
                size="sm"
                buttonClassName="h-7 text-xs"
              />
            </div>

            <div className="w-32 shrink-0">
              <CustomSelect
                value={shareFilter}
                onChange={(val) => {
                  setShareFilter(val);
                  setCurrentPage(1);
                }}
                options={SHARE_FILTER_OPTIONS}
                size="sm"
                buttonClassName="h-7 text-xs"
              />
            </div>

            <div className="w-36 shrink-0">
              <CustomSelect
                value={commentFilter}
                onChange={(val) => {
                  setCommentFilter(val);
                  setCurrentPage(1);
                }}
                options={COMMENT_FILTER_OPTIONS}
                size="sm"
                buttonClassName="h-7 text-xs"
              />
            </div>
          </div>

          {/* Action Toolbar Bar - Chỉ hiển thị khi có ít nhất 1 bài viết được tích chọn */}
          {selectedPostIds.size > 0 && (
            <div className="flex flex-wrap justify-between items-center p-2.5 px-3 bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg gap-2 animate-in fade-in duration-150">
              <div className="flex items-center gap-2">
                <span className="size-5 bg-[#2563EB] text-white rounded flex items-center justify-center font-bold text-[11px]">
                  {selectedPostIds.size}
                </span>
                <span className="font-medium text-xs text-[#1E3A8A]">
                  Đã chọn {selectedPostIds.size} / 28 bài viết
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleMoveCategory}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-[#CBD5E1] rounded text-xs font-medium text-[#334155] hover:bg-slate-50 transition-colors"
                >
                  <FolderInput className="size-3.5 text-[#64748B]" />
                  <span>Chuyển mục</span>
                </button>

                <button
                  type="button"
                  onClick={handleBulkDelete}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-rose-200 text-rose-600 rounded text-xs font-medium hover:bg-rose-50 transition-colors"
                >
                  <Trash2 className="size-3.5" />
                  <span>Xóa ({selectedPostIds.size})</span>
                </button>
              </div>
            </div>
          )}

          {/* Posts Data Table */}
          <div className="w-full border border-[#E2E8F0] rounded-xl overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
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
                  <th className="py-2.5 px-2 text-center w-10">STT</th>
                  <th className="py-2.5 px-3 min-w-[220px]">LINK & NỘI DUNG BÀI VIẾT</th>
                  <th className="py-2.5 px-3 w-36">TÁC GIẢ</th>
                  <th className="py-2.5 px-3 text-center min-w-[190px]">
                    CHỈ SỐ TƯƠNG TÁC (L / C / S)
                  </th>
                  <th className="py-2.5 px-3 w-28">NGÀY ĐĂNG</th>
                  <th className="py-2.5 px-3 text-center w-24">THAO TÁC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {paginatedPosts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-10 text-xs text-slate-400">
                      Chưa có bài viết nào được quét trong nhóm này.
                    </td>
                  </tr>
                ) : (
                  paginatedPosts.map((post) => {
                    const isChecked = selectedPostIds.has(post.id);
                    return (
                      <tr
                        key={post.id}
                        className={`hover:bg-slate-50 transition-colors ${
                          isChecked ? "bg-[#EFF6FF]/25" : ""
                        }`}
                      >
                        <td className="py-2.5 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleSelectPost(post.id)}
                            className="size-3.5 rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                          />
                        </td>
                        <td className="py-2.5 px-2 text-center font-mono text-xs text-[#94A3B8]">
                          {post.stt}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex flex-col gap-1">
                            <p className="text-xs font-medium text-[#1E293B] line-clamp-2">
                              {post.title}
                            </p>
                            <a
                              href={`https://${post.linkText}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 font-mono text-[11px] text-[#2563EB] hover:underline"
                            >
                              <span className="truncate max-w-[200px]">{post.linkText}</span>
                              <ExternalLink className="size-3 text-[#2563EB] shrink-0" />
                            </a>
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <span
                              className={`size-6 rounded-full ${post.authorTagBg} ${post.authorTagText} font-bold text-[11px] flex items-center justify-center shrink-0 uppercase`}
                            >
                              {post.authorTag}
                            </span>
                            <span className="font-semibold text-xs text-[#0F172A] truncate">
                              {post.authorName}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center justify-center gap-1.5 flex-wrap">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#EFF6FF] text-[#1D4ED8] text-xs font-semibold">
                              <IconLike />
                              <span>{post.likes}</span>
                            </span>
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#ECFDF5] text-[#047857] text-xs font-semibold">
                              <IconComment />
                              <span>{post.comments}</span>
                            </span>
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#F3E8FF] text-[#7E22CE] text-xs font-semibold">
                              <IconShare />
                              <span>{post.shares}</span>
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-[#64748B]">
                          {post.postedDate}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              title="Xem trước"
                              className="p-1 text-slate-400 hover:text-blue-600 rounded"
                            >
                              <Eye className="size-3.5" />
                            </button>
                            <a
                              href={`https://${post.linkText}`}
                              target="_blank"
                              rel="noreferrer"
                              title="Mở bài viết"
                              className="p-1 text-slate-400 hover:text-blue-600 rounded"
                            >
                              <ExternalLink className="size-3.5" />
                            </a>
                            <button
                              type="button"
                              onClick={() => handleRemovePost(post.id)}
                              title="Xóa bài viết"
                              className="p-1 text-slate-400 hover:text-rose-600 rounded"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Phân trang Footer */}
          <div className="flex flex-wrap justify-between items-center w-full pt-1 gap-2">
            <div className="flex items-center gap-2 text-xs text-[#64748B]">
              <span>Hiển thị {filteredPosts.length > 0 ? `${(currentPage - 1) * pageSize + 1} - ${Math.min(currentPage * pageSize, filteredPosts.length)}` : "0"} trong tổng số {filteredPosts.length} bài viết</span>
              <span>•</span>
              <div className="flex items-center gap-1">
                <span>Hàng mỗi trang:</span>
                <CustomSelect
                  value={pageSize}
                  onChange={(val) => {
                    setPageSize(Number(val) || 5);
                    setCurrentPage(1);
                  }}
                  options={PAGE_SIZE_OPTIONS}
                  size="sm"
                  direction="up"
                  className="w-16"
                  buttonClassName="h-6 px-1.5 text-xs"
                />
              </div>
            </div>

            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          </div>
        </section>
      </div>

      {/* Modal Thêm Mới Nhóm */}
      {mounted && addGroupModalOpen && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAddGroupModalOpen(false);
          }}
        >
          <form
            onSubmit={handleAddGroup}
            className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4 animate-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between border-b pb-3 border-slate-100">
              <h3 className="font-bold text-base text-slate-800 flex items-center gap-2">
                <Folder className="size-5 text-blue-600" />
                Thêm nhóm mới vào danh sách
              </h3>
              <button
                type="button"
                onClick={() => setAddGroupModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Tên nhóm Facebook</label>
                <input
                  type="text"
                  required
                  placeholder="Ví dụ: Hội Bán Hàng Online..."
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  className="w-full h-8 px-3 text-xs border border-slate-300 rounded-lg outline-none focus:border-blue-600"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Phân loại thư mục</label>
                <CustomSelect
                  value={newGroupCategory}
                  onChange={(val) => setNewGroupCategory(val)}
                  options={NEW_GROUP_CATEGORY_OPTIONS}
                  size="sm"
                  buttonClassName="h-8"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setAddGroupModalOpen(false)}
                className="px-3.5 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg text-xs font-semibold"
              >
                Hủy bỏ
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold"
              >
                Tạo nhóm
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
}
