"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Play,
  Square,
} from "lucide-react";
import { toast } from "@/lib/toast";
import AccountSelectModal, { isScanReady } from "../components/AccountSelectModal";
import GroupPickerModal from "../components/GroupPickerModal";
import {
  controlPostScan,
  getPostScanStatus,
  getScanAccounts,
  getScanCategories,
  getScannedGroups,
  getScannedPosts,
  startPostScan,
} from "../service";
import AccountGroupPickerCard from "./_components/AccountGroupPickerCard";
import AdvancedScanFilterCard from "./_components/AdvancedScanFilterCard";
import GroupPreviewSection from "./_components/GroupPreviewSection";
import LivePostResultSection from "./_components/LivePostResultSection";
import LiveLogConsole from "./_components/LiveLogConsole";

function normalizeAccount(raw) {
  const status = String(raw.status || "").toLowerCase();
  let login = String(raw.login_status || "").toLowerCase();
  if (login === "success") login = "logged_in";
  if (!login && String(raw.login_status || "").toUpperCase() === "LOGGED_IN") login = "logged_in";
  return {
    ...raw,
    uid: String(raw.uid || ""),
    profile_name: raw.profile_name || raw.name || "",
    email: raw.email || raw.mail || "",
    status: status === "live" || status === "die" ? status : status || "unknown",
    login_status: login || "not_logged_in",
  };
}

export default function GroupScanPostsPage() {
  // Accounts State
  const [accountsModalOpen, setAccountsModalOpen] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [moduleAccounts, setModuleAccounts] = useState([]);
  const [selectedUids, setSelectedUids] = useState([]);

  // Load accounts from Module 2 API
  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const res = await getScanAccounts();
      const rawList = Array.isArray(res)
        ? res
        : Array.isArray(res?.accounts)
        ? res.accounts
        : Array.isArray(res?.data)
        ? res.data
        : [];
      const list = rawList.map(normalizeAccount);
      setModuleAccounts(list);
      setSelectedUids((current) => {
        const readyUids = list.filter(isScanReady).map((acc) => acc.uid);
        const kept = current.filter((uid) => readyUids.includes(uid));
        if (kept.length > 0) return kept;
        if (readyUids.length > 0) return readyUids.slice(0, 5);
        return list.slice(0, 5).map((a) => a.uid);
      });
    } catch {
      setModuleAccounts([]);
      setSelectedUids([]);
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const selectedAccountNames = useMemo(() => {
    return moduleAccounts
      .filter((a) => selectedUids.includes(a.uid))
      .map((a) => a.profile_name || a.uid)
      .join(", ");
  }, [moduleAccounts, selectedUids]);

  // Group selection state
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [, setAvailableGroups] = useState([]);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);

  // Load available groups & categories from Database
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [posts, setPosts] = useState([]);

  const loadCategoriesAndGroups = useCallback(async () => {
    try {
      const res = await getScannedGroups();
      const list = res?.groups || [];
      setAvailableGroups(
        list.map((g, idx) => {
          const rawGid = String(g.group_id || g.uid || "");
          const dbId = g.id;
          let realGid = "";
          let rawUrl = String(g.url || g.href || "");
          if (rawUrl.includes("/groups/")) {
            const parts = rawUrl.split("/groups/")[1].split("/")[0].split("?")[0].trim();
            if (parts && !/^\d{1,7}$/.test(parts)) {
              realGid = parts;
            }
          }
          if (!realGid) {
            if (rawGid && !/^\d{1,7}$/.test(rawGid)) {
              realGid = rawGid;
            }
          }
          let realUrl = "";
          if (rawUrl && !/\/groups\/\d{1,7}(?:[/?#]|$)/.test(rawUrl)) {
            realUrl = rawUrl;
          } else if (realGid && !/^\d{1,7}$/.test(realGid)) {
            realUrl = `https://www.facebook.com/groups/${realGid}`;
          }

          return {
            id: realGid || String(dbId || idx),
            groupId: realGid,
            group_id: realGid,
            dbId: dbId,
            stt: String(idx + 1).padStart(2, "0"),
            name: g.name || g.group_name || realGid || `Nhóm #${dbId}`,
            uid: realGid,
            tag: (g.name || "FB").slice(0, 2).toUpperCase(),
            tagBg: "bg-[#DBEAFE]",
            tagText: "text-[#2563EB]",
            type: g.type === "private" ? "private" : "public",
            typeLabel: g.type === "private" ? "Riêng tư" : "Công khai",
            members: g.members || "—",
            memberCount: g.membersCount || 0,
            url: realUrl,
          };
        })
      );
    } catch {
      setAvailableGroups([]);
    }

    try {
      const data = await getScanCategories();
      const cats = Array.isArray(data) ? data : [];
      setCategories(
        cats.map((c) => ({
          id: c.id,
          name: c.name,
          fullName: c.name,
          memberSummary: `${c.count || 0} Nhóm`,
          postCount: 0,
        }))
      );
      if (cats.length > 0) {
        setSelectedCategory((prev) => (prev && cats.some((c) => c.id === prev) ? prev : cats[0].id));
      } else {
        setSelectedCategory("");
      }
    } catch {
      setCategories([]);
    }
  }, []);

  useEffect(() => {
    loadCategoriesAndGroups();
  }, [loadCategoriesAndGroups]);

  // Nạp bài viết đã lưu từ CSDL
  const loadDatabasePosts = useCallback(async (catId) => {
    try {
      const res = await getScannedPosts({ category_id: catId, page_size: 100 });
      if (res?.posts && Array.isArray(res.posts)) {
        setPosts(res.posts);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (selectedCategory) {
      loadDatabasePosts(selectedCategory);
    }
  }, [selectedCategory, loadDatabasePosts]);

  // Configuration options state
  const [minDelay, setMinDelay] = useState(5);
  const [maxDelay, setMaxDelay] = useState(10);
  const [switchAccThreshold, setSwitchAccThreshold] = useState(50);
  const [postsPerGroupLimit, setPostsPerGroupLimit] = useState(100);

  const [filterDaysEnabled, setFilterDaysEnabled] = useState(true);
  const [filterDays, setFilterDays] = useState(7);
  const [skipPinnedPosts, setSkipPinnedPosts] = useState(true);
  const [autoDedupePosts, setAutoDedupePosts] = useState(true);

  // Master-Detail Post Results
  const [categorySearch, setCategorySearch] = useState("");
  const [postSearch, setPostSearch] = useState("");
  const [minLikeFilter, setMinLikeFilter] = useState("0");
  const [minCmtFilter, setMinCmtFilter] = useState("0");
  const [minShareFilter, setMinShareFilter] = useState("0");
  const [sortOption, setSortOption] = useState("highest_interaction");

  const [selectedPostIds, setSelectedPostIds] = useState(new Set());
  const [currentPage, setCurrentPage] = useState(1);

  // Execution & Logs
  const [isExecuting, setIsExecuting] = useState(false);
  const [activeJobId, setActiveJobId] = useState(null);
  const [logs, setLogs] = useState([]);
  const [copiedLog, setCopiedLog] = useState(false);

  // Polling Live Status
  useEffect(() => {
    if (!isExecuting || !activeJobId) return;

    const interval = setInterval(async () => {
      try {
        const res = await getPostScanStatus({ jobId: activeJobId });
        const job = res?.job;
        if (!job) return;

        if (Array.isArray(job.logs) && job.logs.length > 0) {
          setLogs(job.logs);
        }

        if (Array.isArray(job.posts) && job.posts.length > 0) {
          setPosts(job.posts);
        }

        if (job.status === "done" || job.status === "aborted" || job.status === "error") {
          setIsExecuting(false);
          setActiveJobId(null);
          if (job.status === "done") {
            toast.success(`Đã hoàn thành phiên quét! Thu thập được ${job.total_posts_scanned || 0} bài viết.`);
            if (selectedCategory) loadDatabasePosts(selectedCategory);
          } else if (job.status === "aborted") {
            toast.info("Phiên quét bài viết đã dừng lại.");
          } else if (job.status === "error") {
            toast.error(job.error || "Phiên quét gặp sự cố!");
          }
        }
      } catch {
        // Polling error ignored
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [isExecuting, activeJobId, selectedCategory, loadDatabasePosts]);

  // Remove Group handler
  const handleRemoveGroup = (groupId) => {
    setSelectedGroups((prev) => prev.filter((g) => g.id !== groupId));
    toast.success("Đã xóa nhóm khỏi danh sách quét!");
  };

  // Toggle Execution
  const handleToggleExecution = async () => {
    if (isExecuting) {
      if (activeJobId) {
        try {
          await controlPostScan({ jobId: activeJobId, action: "abort" });
        } catch {
          // ignore
        }
      }
      setIsExecuting(false);
      toast.info("Đã dừng tiến trình quét bài viết nhóm.");
    } else {
      if (selectedUids.length === 0) {
        toast.error("Vui lòng chọn ít nhất một tài khoản thực thi!");
        return;
      }
      if (selectedGroups.length === 0) {
        toast.error("Vui lòng chọn ít nhất một nhóm để quét!");
        return;
      }
      if (selectedGroups.length > 20) {
        toast.warning("Số lượng nhóm mục tiêu trong một phiên quét không được vượt quá 20 nhóm để bảo đảm an toàn tài khoản!");
        return;
      }
      if (minDelay > maxDelay) {
        toast.error("Thời gian trễ tối đa phải lớn hơn hoặc bằng thời gian tối thiểu!");
        return;
      }
      if (maxDelay > 3600) {
        toast.error("Thời gian trễ tối đa không được vượt quá 3600 giây!");
        return;
      }

      try {
        setIsExecuting(true);
        setLogs([
          {
            time: new Date().toLocaleTimeString("vi-VN", { hour12: false }),
            thread: "Thread-01",
            color: "text-emerald-400",
            message: `[Bắt đầu quét] Kích hoạt ${selectedUids.length} tài khoản quét bài viết cho ${selectedGroups.length} nhóm...`,
          },
          {
            time: new Date().toLocaleTimeString("vi-VN", { hour12: false }),
            thread: "Thread-01",
            color: "text-slate-300",
            message: `Cấu hình: Delay ${minDelay}-${maxDelay}s, Đổi nick sau ${switchAccThreshold} bài, Quét ${postsPerGroupLimit} bài mới nhất/nhóm.`,
          },
        ]);

        const res = await startPostScan({
          uids: selectedUids,
          groups: selectedGroups,
          delay_min: minDelay,
          delay_max: maxDelay,
          switch_acc_threshold: switchAccThreshold,
          posts_limit: postsPerGroupLimit,
          days_limit: filterDaysEnabled ? filterDays : 0,
          skip_pinned_posts: skipPinnedPosts,
          auto_dedupe_posts: autoDedupePosts,
        });

        if (res?.job_id) {
          setActiveJobId(res.job_id);
          toast.success("Bắt đầu tiến trình quét bài viết nhóm...");
        } else {
          setIsExecuting(false);
          toast.error("Không thể khởi động phiên quét bài viết!");
        }
      } catch (err) {
        setIsExecuting(false);
        const errMsg = err?.response?.data?.detail || err?.message || "Đã xảy ra lỗi";
        toast.error(`Khởi chạy thất bại: ${errMsg}`);
      }
    }
  };

  // Copy Logs
  const handleCopyLogs = () => {
    const text = logs.map((l) => `[${l.time}] [${l.thread}] ${l.message}`).join("\n");
    navigator.clipboard.writeText(text);
    setCopiedLog(true);
    toast.success("Đã sao chép toàn bộ logs vào clipboard!");
    setTimeout(() => setCopiedLog(false), 2000);
  };

  // Filter Categories
  const filteredCategories = useMemo(() => {
    if (!categorySearch.trim()) return categories;
    return categories.filter((c) =>
      (c.fullName || c.name || "").toLowerCase().includes(categorySearch.toLowerCase())
    );
  }, [categories, categorySearch]);

  // Filter & Sort Posts (UC-GPS-05)
  const filteredPosts = useMemo(() => {
    let result = posts.filter((p) => {
      const matchQuery =
        !postSearch.trim() ||
        (p.content || "").toLowerCase().includes(postSearch.toLowerCase()) ||
        (p.author_name || p.authorName || "").toLowerCase().includes(postSearch.toLowerCase()) ||
        String(p.post_id || p.postId || "").includes(postSearch.trim());
      const l = Number(p.likes_count ?? p.likes ?? 0);
      const c = Number(p.comments_count ?? p.comments ?? 0);
      const s = Number(p.shares_count ?? p.shares ?? 0);
      const matchLike = !minLikeFilter || minLikeFilter === "0" || l >= Number(minLikeFilter);
      const matchCmt = !minCmtFilter || minCmtFilter === "0" || c >= Number(minCmtFilter);
      const matchShare = !minShareFilter || minShareFilter === "0" || s >= Number(minShareFilter);
      return matchQuery && matchLike && matchCmt && matchShare;
    });

    // BR-GPS-05.2: Xếp hạng Tương tác cao nhất: Like + (Comment * 2) + (Share * 3)
    if (sortOption === "highest_interaction") {
      result.sort((a, b) => {
        const scoreA = Number(a.likes || a.likes_count || 0) + (Number(a.comments || a.comments_count || 0) * 2) + (Number(a.shares || a.shares_count || 0) * 3);
        const scoreB = Number(b.likes || b.likes_count || 0) + (Number(b.comments || b.comments_count || 0) * 2) + (Number(b.shares || b.shares_count || 0) * 3);
        return scoreB - scoreA;
      });
    } else if (sortOption === "most_likes") {
      result.sort((a, b) => Number(b.likes || b.likes_count || 0) - Number(a.likes || a.likes_count || 0));
    } else if (sortOption === "most_comments") {
      result.sort((a, b) => Number(b.comments || b.comments_count || 0) - Number(a.comments || a.comments_count || 0));
    }

    return result;
  }, [posts, postSearch, minLikeFilter, minCmtFilter, minShareFilter, sortOption]);

  const pageSize = 15;
  const totalPages = Math.max(1, Math.ceil(filteredPosts.length / pageSize));
  const paginatedPosts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredPosts.slice(start, start + pageSize).map((p, idx) => {
      const aName = p.author_name || p.authorName || "Ẩn danh";
      const pUrl = p.post_url || p.postUrl || (p.post_id ? `https://www.facebook.com/groups/${p.group_id}/posts/${p.post_id}/` : "");
      const linkText = pUrl.replace(/^https?:\/\//, "").replace(/^www\./, "");
      return {
        ...p,
        id: p.id || p.post_id || p.postId || `post-${idx}`,
        stt: String(start + idx + 1).padStart(2, "0"),
        linkText: linkText || `facebook.com/posts/${p.post_id || p.postId}`,
        authorName: aName,
        authorUid: p.author_uid || p.authorUid || "—",
        authorTag: aName.slice(0, 2).toUpperCase(),
        authorTagBg: "bg-[#DBEAFE]",
        authorTagText: "text-[#1D4ED8]",
        likes: Number(p.likes_count ?? p.likes ?? 0),
        likesStr: Number(p.likes_count ?? p.likes ?? 0).toLocaleString("vi-VN"),
        comments: Number(p.comments_count ?? p.comments ?? 0),
        shares: Number(p.shares_count ?? p.shares ?? 0),
        postedTime: p.posted_at || p.postedTime || "Vừa xong",
      };
    });
  }, [filteredPosts, currentPage, pageSize]);

  // Select all posts
  const allFilteredSelected =
    paginatedPosts.length > 0 &&
    paginatedPosts.every((p) => selectedPostIds.has(p.id));

  const handleToggleSelectAllPosts = () => {
    if (allFilteredSelected) {
      setSelectedPostIds(new Set());
    } else {
      setSelectedPostIds(new Set(paginatedPosts.map((p) => p.id)));
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

  // Export CSV Helper (UC-GPS-07: 13 cột chuẩn)
  const exportPostsCsv = (postList, title = "PostScraping") => {
    if (!postList || postList.length === 0) {
      toast.warning("Chưa có bài viết nào để xuất!");
      return;
    }
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const filename = `${title}_${ts}.csv`;

    const headers = [
      "STT",
      "Post ID",
      "Nội dung bài viết",
      "Đường dẫn bài viết (Post URL)",
      "Tên tác giả",
      "UID / Profile tác giả",
      "Lượt Like",
      "Lượt Comment",
      "Lượt Share",
      "Tên nhóm nguồn",
      "Group ID nguồn",
      "Ngày đăng bài",
      "Thời gian quét",
    ];

    const rows = postList.map((p, idx) => [
      idx + 1,
      `\t${p.post_id || p.postId}`, // Tab prefix prevents Excel exponential notation
      `"${(p.content || "").replace(/"/g, '""').replace(/\n/g, ' ')}"`,
      `"${(p.post_url || p.postUrl || "").replace(/"/g, '""')}"`,
      `"${(p.author_name || p.authorName || "Ẩn danh").replace(/"/g, '""')}"`,
      `\t${p.author_uid || p.authorUid || ""}`,
      p.likes_count ?? p.likes ?? 0,
      p.comments_count ?? p.comments ?? 0,
      p.shares_count ?? p.shares ?? 0,
      `"${(p.group_name || "").replace(/"/g, '""')}"`,
      `\t${p.group_id || ""}`,
      `"${p.posted_at || p.postedTime || ""}"`,
      `"${p.scanned_at || ""}"`,
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
    toast.success(`Đã xuất ${postList.length} bài viết ra tệp: ${filename}`);
  };

  // Export actions
  const handleExportAll = () => {
    if (isExecuting) {
      toast.warning("Đang quét bài viết, vui lòng đợi hoàn tất hoặc dừng tiến trình trước khi xuất file!");
      return;
    }
    exportPostsCsv(posts, "PostScraping_All");
  };

  const handleExportGroup = () => {
    if (isExecuting) {
      toast.warning("Đang quét bài viết, vui lòng đợi hoàn tất hoặc dừng tiến trình trước khi xuất file!");
      return;
    }
    const curCat = categories.find((c) => c.id === selectedCategory);
    const catName = curCat?.fullName || curCat?.name || "Group";
    exportPostsCsv(filteredPosts, `PostScraping_${catName.replace(/[^a-zA-Z0-9]/g, "_")}`);
  };

  const handleResetFilters = () => {
    setPostSearch("");
    setMinLikeFilter("0");
    setMinCmtFilter("0");
    setMinShareFilter("0");
    setSortOption("highest_interaction");
    toast.info("Đã đặt lại bộ lọc!");
  };

  const currentCategoryData =
    categories.find((c) => c.id === selectedCategory) || categories[0] || null;

  return (
    <>
      <style>{`
        input[type="number"]::-webkit-inner-spin-button,
        input[type="number"]::-webkit-outer-spin-button {
          -webkit-appearance: none !important;
          margin: 0 !important;
        }
        input[type="number"] {
          -moz-appearance: textfield !important;
          appearance: textfield !important;
        }
      `}</style>
      <div className="-m-6 min-h-full space-y-5 bg-[#F4F7FC] p-6">
        {/* SECTION 1 & SECTION 2: 2 Column Configuration Grids */}
        <div className="grid items-stretch gap-5 xl:grid-cols-2">
          {/* Card 1: Cấu hình chung & Chọn tài khoản/nhóm */}
          <AccountGroupPickerCard
            onOpenAccountsModal={() => setAccountsModalOpen(true)}
            selectedUidsCount={selectedUids.length}
            totalAccountsCount={moduleAccounts.length}
            selectedAccountNames={selectedAccountNames}
            onOpenGroupPicker={() => setGroupPickerOpen(true)}
            selectedGroupsCount={selectedGroups.length}
          />

          {/* Card 2: Cấu hình quét nâng cao & Giới hạn */}
          <AdvancedScanFilterCard
            minDelay={minDelay}
            setMinDelay={setMinDelay}
            maxDelay={maxDelay}
            setMaxDelay={setMaxDelay}
            switchAccThreshold={switchAccThreshold}
            setSwitchAccThreshold={setSwitchAccThreshold}
            postsPerGroupLimit={postsPerGroupLimit}
            setPostsPerGroupLimit={setPostsPerGroupLimit}
            filterDaysEnabled={filterDaysEnabled}
            setFilterDaysEnabled={setFilterDaysEnabled}
            filterDays={filterDays}
            setFilterDays={setFilterDays}
            skipPinnedPosts={skipPinnedPosts}
            setSkipPinnedPosts={setSkipPinnedPosts}
            autoDedupePosts={autoDedupePosts}
            setAutoDedupePosts={setAutoDedupePosts}
          />
        </div>

        {/* SECTION 3: Xem trước danh sách nhóm muốn quét */}
        <GroupPreviewSection
          selectedGroups={selectedGroups}
          onRemoveGroup={handleRemoveGroup}
        />

        {/* BIG PRIMARY ACTION BUTTON: BẮT ĐẦU THỰC THI */}
        <button
          type="button"
          onClick={handleToggleExecution}
          className={`inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-xl text-sm font-bold tracking-wide text-white transition-colors shadow-sm ${
            isExecuting ? "bg-[#DC2626] hover:bg-rose-700" : "bg-[#1877F2] hover:bg-blue-600"
          }`}
        >
          {isExecuting ? (
            <>
              <Square className="size-4 fill-white" />
              <span>DỪNG THỰC THI QUÉT</span>
            </>
          ) : (
            <>
              <Play className="size-4 fill-white" />
              <span>BẮT ĐẦU THỰC THI</span>
            </>
          )}
        </button>

        {/* SECTION 4: Kết quả quét bài viết (Master-Detail 2 cột) */}
        <LivePostResultSection
          categories={filteredCategories}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          categorySearch={categorySearch}
          onCategorySearchChange={setCategorySearch}
          currentCategoryData={currentCategoryData}
          onExportAll={handleExportAll}
          onExportGroup={handleExportGroup}
          postSearch={postSearch}
          onPostSearchChange={setPostSearch}
          minLikeFilter={minLikeFilter}
          onMinLikeFilterChange={setMinLikeFilter}
          minCmtFilter={minCmtFilter}
          onMinCmtFilterChange={setMinCmtFilter}
          minShareFilter={minShareFilter}
          onMinShareFilterChange={setMinShareFilter}
          sortOption={sortOption}
          onSortOptionChange={setSortOption}
          onResetFilters={handleResetFilters}
          posts={paginatedPosts}
          allFilteredSelected={allFilteredSelected}
          onToggleSelectAllPosts={handleToggleSelectAllPosts}
          selectedPostIds={selectedPostIds}
          onToggleSelectPost={handleToggleSelectPost}
          currentPage={currentPage}
          pageSize={pageSize}
          totalFilteredCount={filteredPosts.length}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />

        {/* SECTION 5: Live Automation Log Console [Thread-01] */}
        <LiveLogConsole
          logs={logs}
          isExecuting={isExecuting}
          onCopyLogs={handleCopyLogs}
          copiedLog={copiedLog}
          title="Live Automation Log Console [Thread-01]"
        />

        {/* Account Selection Modal */}
        <AccountSelectModal
          open={accountsModalOpen}
          onOpenChange={setAccountsModalOpen}
          accounts={moduleAccounts}
          loading={accountsLoading}
          selectedUids={selectedUids}
          onRefresh={loadAccounts}
          onConfirm={(uids) => {
            setSelectedUids(uids);
            toast.success(`Đã chọn ${uids.length} tài khoản thực thi!`);
          }}
        />

        {/* Group Picker Modal */}
        <GroupPickerModal
          open={groupPickerOpen}
          onClose={() => setGroupPickerOpen(false)}
          selectedGroups={selectedGroups}
          onConfirm={(newGroups) => {
            setSelectedGroups(newGroups);
            setGroupPickerOpen(false);
            toast.success(`Đã chọn ${newGroups.length} nhóm!`);
          }}
          targetType="posts"
        />
      </div>
    </>
  );
}
