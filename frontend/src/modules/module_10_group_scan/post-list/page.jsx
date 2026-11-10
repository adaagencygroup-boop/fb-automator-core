"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { toast } from "@/lib/toast";
import {
  getPostsGroups,
  getScannedGroups,
  getScannedPosts,
  deleteScannedPost,
  deleteScannedPostsBulk,
} from "../service";
import PostCategorySidebar from "./_components/PostCategorySidebar";
import PostTableToolbar from "./_components/PostTableToolbar";
import PostDataTable from "./_components/PostDataTable";
import AddGroupModal from "./_components/AddGroupModal";

export default function GroupScanPostListPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Groups State (3-tier hierarchy: Category -> Group -> Posts)
  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [addGroupModalOpen, setAddGroupModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupCategory, setNewGroupCategory] = useState("Hội buôn");

  // Posts State
  const [posts, setPosts] = useState([]);
  const [isLoadingPosts, setIsLoadingPosts] = useState(false);
  const [postSearch, setPostSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [likeFilter, setLikeFilter] = useState("all");
  const [shareFilter, setShareFilter] = useState("all");
  const [commentFilter, setCommentFilter] = useState("all");

  const [selectedPostIds, setSelectedPostIds] = useState(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Load Groups list with post counts
  const loadGroups = useCallback(async () => {
    try {
      const [groupsWithPosts, scannedGroupsRes] = await Promise.all([
        getPostsGroups(),
        getScannedGroups({ limit: 100 }),
      ]);

      const postGroupsMap = new Map();
      (groupsWithPosts || []).forEach((g) => {
        postGroupsMap.set(String(g.group_id), g);
      });

      const scannedList = scannedGroupsRes?.groups || [];
      const combined = [];
      const seenIds = new Set();

      // Priority 1: Groups from 10.1 scanned groups
      scannedList.forEach((g) => {
        const gid = String(g.id || g.group_id);
        seenIds.add(gid);
        const postMeta = postGroupsMap.get(gid);
        combined.push({
          id: gid,
          name: g.name || postMeta?.group_name || `Nhóm ${gid}`,
          category: g.category_name || g.keyword || "Chung",
          postCount: postMeta?.post_count || 0,
          status: "active",
          statusLabel: "Đang hoạt động",
          updateTime: postMeta?.last_post_time
            ? `Cập nhật ${postMeta.last_post_time.slice(0, 16)}`
            : g.created_at
            ? g.created_at.slice(0, 10)
            : "Chưa có bài",
        });
      });

      // Priority 2: Groups that have posts in DB but not in scannedList
      (groupsWithPosts || []).forEach((g) => {
        const gid = String(g.group_id);
        if (!seenIds.has(gid)) {
          seenIds.add(gid);
          combined.push({
            id: gid,
            name: g.group_name || `Nhóm ${gid}`,
            category: "Chung",
            postCount: g.post_count || 0,
            status: "active",
            statusLabel: "Đang hoạt động",
            updateTime: g.last_post_time
              ? `Cập nhật ${g.last_post_time.slice(0, 16)}`
              : "Vừa quét",
          });
        }
      });

      setGroups(combined);

      // Select first group or keep current
      setSelectedGroupId((prev) => {
        if (prev && combined.some((g) => g.id === prev)) return prev;
        return combined[0]?.id || "";
      });
    } catch (e) {
      console.error("Lỗi tải danh sách nhóm:", e);
      setGroups([]);
      setSelectedGroupId("");
    }
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  // Load Posts when active group changes
  const loadPostsForGroup = useCallback(async (groupId) => {
    if (!groupId) {
      setPosts([]);
      return;
    }
    setIsLoadingPosts(true);
    try {
      const res = await getScannedPosts({ group_id: groupId, limit: 1000 });
      const rawPosts = res?.posts || [];
      const formatted = rawPosts.map((p, idx) => ({
        id: p.id,
        stt: idx + 1,
        title: p.content || "(Bài viết không có nội dung chữ hoặc ảnh/video)",
        linkText: p.post_url
          ? p.post_url.replace(/^https?:\/\//, "")
          : `facebook.com/groups/${p.group_id}/posts/${p.post_id}`,
        postUrl: p.post_url || `https://www.facebook.com/groups/${p.group_id}/posts/${p.post_id}`,
        postId: p.post_id,
        groupId: p.group_id,
        groupName: p.group_name,
        authorName: p.author_name || "Người dùng Facebook",
        authorUid: p.author_uid || "",
        authorTag: (p.author_name || "FB").slice(0, 2).toUpperCase(),
        authorTagBg: "bg-blue-100",
        authorTagText: "text-blue-700",
        likes: Number(p.likes_count) || 0,
        comments: Number(p.comments_count) || 0,
        shares: Number(p.shares_count) || 0,
        engagementScore:
          Number(p.engagement_score) ||
          (Number(p.likes_count) || 0) +
            (Number(p.comments_count) || 0) * 2 +
            (Number(p.shares_count) || 0) * 3,
        postedDate: p.posted_time || (p.scanned_at ? p.scanned_at.slice(0, 10) : "N/A"),
        raw: p,
      }));
      setPosts(formatted);
      setSelectedPostIds(new Set());
      setCurrentPage(1);
    } catch (e) {
      console.error("Lỗi nạp bài viết nhóm:", e);
      setPosts([]);
    } finally {
      setIsLoadingPosts(false);
    }
  }, []);

  useEffect(() => {
    if (selectedGroupId) {
      loadPostsForGroup(selectedGroupId);
    } else {
      setPosts([]);
    }
  }, [selectedGroupId, loadPostsForGroup]);

  // Active group details
  const activeGroup = useMemo(() => {
    return groups.find((g) => g.id === selectedGroupId) || groups[0] || null;
  }, [groups, selectedGroupId]);

  // Filter Groups in sidebar
  const filteredGroups = useMemo(() => {
    if (!groupSearch.trim()) return groups;
    const q = groupSearch.toLowerCase();
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.category.toLowerCase().includes(q) ||
        g.id.includes(q)
    );
  }, [groups, groupSearch]);

  // Filter Posts (UC-GPS-05)
  const filteredPosts = useMemo(() => {
    return posts.filter((p) => {
      // 1. Text search
      if (postSearch.trim()) {
        const q = postSearch.trim().toLowerCase();
        const matchTitle = p.title.toLowerCase().includes(q);
        const matchAuthor = p.authorName.toLowerCase().includes(q);
        const matchAuthorUid = p.authorUid.toLowerCase().includes(q);
        const matchPostId = String(p.postId).includes(q);
        const matchLink = p.linkText.toLowerCase().includes(q);
        if (!matchTitle && !matchAuthor && !matchAuthorUid && !matchPostId && !matchLink) {
          return false;
        }
      }

      // 2. Like filter
      if (likeFilter !== "all") {
        const minLikes = Number(likeFilter) || 0;
        if (p.likes < minLikes) return false;
      }

      // 3. Comment filter
      if (commentFilter !== "all") {
        const minCmt = Number(commentFilter) || 0;
        if (p.comments < minCmt) return false;
      }

      // 4. Share filter
      if (shareFilter !== "all") {
        const minShare = Number(shareFilter) || 0;
        if (p.shares < minShare) return false;
      }

      // 5. Date filter
      if (dateFilter !== "all") {
        const dateStr = (p.postedDate || "").toLowerCase();
        if (dateFilter === "today") {
          const isToday =
            dateStr.includes("giờ") ||
            dateStr.includes("phút") ||
            dateStr.includes("h") ||
            dateStr.includes("vừa xong");
          if (!isToday) return false;
        } else if (dateFilter === "7days") {
          const matchDay = dateStr.match(/(\d+)\s*ngày/);
          if (matchDay && Number(matchDay[1]) > 7) return false;
        } else if (dateFilter === "30days") {
          const matchDay = dateStr.match(/(\d+)\s*ngày/);
          if (matchDay && Number(matchDay[1]) > 30) return false;
        }
      }

      return true;
    });
  }, [posts, postSearch, likeFilter, commentFilter, shareFilter, dateFilter]);

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

  // Delete single post (UC-GPS-06)
  const handleRemovePost = async (id) => {
    const confirmed = window.confirm("Bạn có chắc chắn muốn xóa bài viết này khỏi cơ sở dữ liệu?");
    if (!confirmed) return;

    try {
      const res = await deleteScannedPost(id);
      if (res && res.ok === false) {
        toast.error("Không thể xóa bài viết!");
        return;
      }
      setPosts((prev) => prev.filter((p) => p.id !== id));
      setSelectedPostIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      // Giảm postCount nhóm hiện tại
      setGroups((prev) =>
        prev.map((g) =>
          g.id === selectedGroupId
            ? { ...g, postCount: Math.max(0, g.postCount - 1) }
            : g
        )
      );
      toast.success("Đã xóa bài viết thành công!");
    } catch {
      toast.error("Đã xảy ra lỗi khi xóa bài viết!");
    }
  };

  // Bulk Delete (UC-GPS-06)
  const handleBulkDelete = async () => {
    if (selectedPostIds.size === 0) return;
    const count = selectedPostIds.size;
    const confirmed = window.confirm(
      `Bạn có chắc chắn muốn xóa ${count} bài viết đã chọn khỏi cơ sở dữ liệu? Thao tác không thể hoàn tác!`
    );
    if (!confirmed) return;

    try {
      const idsToDelete = Array.from(selectedPostIds);
      const res = await deleteScannedPostsBulk(idsToDelete);
      if (res && res.ok === false) {
        toast.error("Xóa hàng loạt thất bại!");
        return;
      }
      setPosts((prev) => prev.filter((p) => !selectedPostIds.has(p.id)));
      setSelectedPostIds(new Set());
      setGroups((prev) =>
        prev.map((g) =>
          g.id === selectedGroupId
            ? { ...g, postCount: Math.max(0, g.postCount - count) }
            : g
        )
      );
      toast.success(`Đã xóa thành công ${count} bài viết!`);
    } catch {
      toast.error("Đã xảy ra lỗi khi xóa hàng loạt!");
    }
  };

  // Export handlers (UC-GPS-07: Chuẩn bảng tính 13 cột UTF-8 BOM)
  const handleExportExcel = () => {
    if (!activeGroup) {
      toast.warning("Chưa có nhóm nào để xuất bài viết!");
      return;
    }
    if (filteredPosts.length === 0) {
      toast.warning("Không có bài viết nào để xuất theo bộ lọc hiện tại!");
      return;
    }

    const headers = [
      "STT",
      "Post ID",
      "Group ID",
      "Tên nhóm",
      "Tác giả",
      "UID Tác giả",
      "Nội dung bài viết",
      "Lượt thích (Like)",
      "Lượt bình luận (Comment)",
      "Lượt chia sẻ (Share)",
      "Điểm tương tác",
      "Thời gian đăng",
      "Link bài viết",
    ];

    const escapeCsv = (str) => {
      if (str === null || str === undefined) return '""';
      const s = String(str).replace(/"/g, '""');
      return `"${s}"`;
    };

    const rows = filteredPosts.map((p, idx) => {
      return [
        idx + 1,
        `\t${p.postId || ""}`, // \t để Excel giữ định dạng Text, không bị dạng số E+15
        `\t${p.groupId || activeGroup.id || ""}`,
        escapeCsv(p.groupName || activeGroup.name || ""),
        escapeCsv(p.authorName || "Ẩn danh"),
        `\t${p.authorUid || ""}`,
        escapeCsv(p.title || ""),
        p.likes || 0,
        p.comments || 0,
        p.shares || 0,
        p.engagementScore || 0,
        escapeCsv(p.postedDate || ""),
        escapeCsv(p.postUrl || `https://${p.linkText}`),
      ].join(",");
    });

    const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
      now.getDate()
    )}_${pad(now.getHours())}${pad(now.getMinutes())}`;

    link.setAttribute("href", url);
    link.setAttribute("download", `PostScraping_${timestamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success(`Đã xuất ${filteredPosts.length} bài viết ra tệp PostScraping_${timestamp}.csv thành công!`);
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
        {/* Left Column: Group Sidebar (3-tier hierarchy) */}
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

          {isLoadingPosts ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500">
              <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs font-medium">Đang tải danh sách bài viết từ cơ sở dữ liệu...</p>
            </div>
          ) : (
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
                setPageSize(Number(val) || 10);
                setCurrentPage(1);
              }}
            />
          )}
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
