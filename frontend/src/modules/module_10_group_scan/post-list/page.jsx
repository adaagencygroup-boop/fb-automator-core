"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { toast } from "@/lib/toast";
import { getScannedGroups } from "../service";
import PostCategorySidebar from "./_components/PostCategorySidebar";
import PostTableToolbar from "./_components/PostTableToolbar";
import PostDataTable from "./_components/PostDataTable";
import AddGroupModal from "./_components/AddGroupModal";

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
        {/* Left Column: Group Sidebar */}
        <PostCategorySidebar
          groups={filteredGroups}
          selectedGroupId={selectedGroupId}
          onSelectGroup={setSelectedGroupId}
          groupSearch={groupSearch}
          onGroupSearchChange={setGroupSearch}
          onOpenAddGroupModal={() => setAddGroupModalOpen(true)}
          totalPostsCount={posts.length}
        />

        {/* Right Detail Section */}
        <section className="flex-1 min-w-0 bg-white border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-xl p-5 space-y-4">
          <PostTableToolbar
            activeGroup={activeGroup}
            onExportExcel={handleExportExcel}
            postSearch={postSearch}
            onPostSearchChange={setPostSearch}
            dateFilter={dateFilter}
            onDateFilterChange={(val) => {
              setDateFilter(val);
              setCurrentPage(1);
            }}
            likeFilter={likeFilter}
            onLikeFilterChange={(val) => {
              setLikeFilter(val);
              setCurrentPage(1);
            }}
            shareFilter={shareFilter}
            onShareFilterChange={(val) => {
              setShareFilter(val);
              setCurrentPage(1);
            }}
            commentFilter={commentFilter}
            onCommentFilterChange={(val) => {
              setCommentFilter(val);
              setCurrentPage(1);
            }}
            selectedCount={selectedPostIds.size}
            totalFilteredCount={filteredPosts.length}
            onMoveCategory={handleMoveCategory}
            onBulkDelete={handleBulkDelete}
          />

          <PostDataTable
            posts={paginatedPosts}
            allFilteredSelected={allFilteredSelected}
            onToggleSelectAll={handleToggleSelectAll}
            selectedPostIds={selectedPostIds}
            onToggleSelectPost={handleToggleSelectPost}
            onRemovePost={handleRemovePost}
            currentPage={currentPage}
            pageSize={pageSize}
            totalFilteredCount={filteredPosts.length}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            onPageSizeChange={(val) => {
              setPageSize(Number(val) || 5);
              setCurrentPage(1);
            }}
          />
        </section>
      </div>

      {/* Modal Thêm Mới Nhóm */}
      <AddGroupModal
        isOpen={addGroupModalOpen}
        onClose={() => setAddGroupModalOpen(false)}
        newGroupName={newGroupName}
        onNewGroupNameChange={setNewGroupName}
        newGroupCategory={newGroupCategory}
        onNewGroupCategoryChange={setNewGroupCategory}
        onSubmit={handleAddGroup}
        mounted={mounted}
      />
    </div>
  );
}
