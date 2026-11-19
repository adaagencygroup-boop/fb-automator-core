"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  Pause,
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
  getPostsSummary,
  getScanCategories,
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
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);

  // Load available groups & categories from Database
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [posts, setPosts] = useState([]);
  const isExecutingRef = useRef(false);

  const loadCategoriesAndGroups = useCallback(async () => {
    try {
      const [data, summary] = await Promise.all([getScanCategories(), getPostsSummary()]);
      const cats = Array.isArray(data) ? data : [];
      const postCounts = summary?.category_counts || {};
      setCategories(
        cats.map((c) => ({
          id: c.id,
          name: c.name,
          fullName: c.name,
          memberSummary: `${c.count || 0} Nhóm`,
          postCount: Number(postCounts[String(c.name || "").toLowerCase()] || 0),
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
      const res = await getScannedPosts({ category_id: catId, page_size: 1000 });
      if (res?.posts && Array.isArray(res.posts)) {
        setPosts(res.posts);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (selectedCategory && !isExecutingRef.current) {
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
  useEffect(() => {
    isExecutingRef.current = isExecuting;
  }, [isExecuting]);
  const [activeJobId, setActiveJobId] = useState(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [logs, setLogs] = useState([
    {
      time: "—",
      thread: "System",
      message: "Module 10.3 sẵn sàng. Chọn tài khoản & nhóm cần quét bài viết, sau đó bấm Bắt đầu thực thi.",
      color: "text-slate-300",
    },
  ]);
  const [copiedLog, setCopiedLog] = useState(false);

  // Polling Live Status
  useEffect(() => {
    if (!isExecuting || !activeJobId) return;
    let failStreak = 0;
    let finishedToast = false;

    const finishUi = (kind, job) => {
      if (finishedToast) return;
      finishedToast = true;
      setIsExecuting(false);
      setActiveJobId(null);
      setIsPaused(false);
      setIsStopping(false);
      if (kind === "done") {
        toast.success(`Đã hoàn thành phiên quét! Thu thập được ${job?.total_posts_scanned || 0} bài viết.`);
        loadCategoriesAndGroups();
      } else if (kind === "aborted") {
        toast.info("Phiên quét bài viết đã dừng lại.");
      } else if (kind === "error") {
        toast.error(job?.error || "Phiên quét gặp sự cố!");
      }
    };

    const interval = setInterval(async () => {
      try {
        const res = await getPostScanStatus({ jobId: activeJobId });
        const job = res?.job;
        if (!job) {
          failStreak += 1;
          if (failStreak >= 10 && !finishedToast) {
            finishedToast = true;
            setIsExecuting(false);
            setActiveJobId(null);
            toast.info("Phiên quét không còn trên máy chủ (có thể Engine vừa restart).");
          }
          return;
        }
        failStreak = 0;

        if (Array.isArray(job.logs) && job.logs.length > 0) {
          setLogs(job.logs);
        }

        if (Array.isArray(job.posts) && job.posts.length > 0) {
          setPosts(job.posts);
        }

        const st = String(job.status || "").toLowerCase();
        setIsPaused(st === "paused");
        setIsStopping(st === "stopping");
        if (st === "done" || st === "aborted" || st === "error") {
          finishUi(st, job);
        }
      } catch {
        failStreak += 1;
        // Không spam toast; chỉ dừng UI sau mất kết nối kéo dài
        if (failStreak >= 20 && !finishedToast) {
          finishedToast = true;
          setIsExecuting(false);
          setActiveJobId(null);
        }
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [isExecuting, activeJobId, loadCategoriesAndGroups]);

  // Remove Group handler
  const handleRemoveGroup = (groupId) => {
    setSelectedGroups((prev) => prev.filter((g) => g.id !== groupId));
    toast.success("Đã xóa nhóm khỏi danh sách quét!");
  };

  // Toggle Execution
  // Dừng: gửi lệnh rồi tiếp tục poll tới khi worker báo kết thúc (để thấy log cuối).
  const handleStop = async () => {
    if (!activeJobId || isStopping || controlBusy) return;
    setControlBusy(true);
    try {
      await controlPostScan({ jobId: activeJobId, action: "abort" });
      setIsStopping(true);
      toast.info("Đang dừng — chờ lưu dữ liệu vào CSDL...");
    } catch {
      setIsExecuting(false);
      setActiveJobId(null);
      setIsPaused(false);
      toast.info("Phiên quét không còn chạy trên Engine.");
    } finally {
      setControlBusy(false);
    }
  };

  const handlePauseResume = async () => {
    if (!activeJobId || isStopping || controlBusy) return;
    const action = isPaused ? "resume" : "pause";
    setControlBusy(true);
    try {
      await controlPostScan({ jobId: activeJobId, action });
      setIsPaused(action === "pause");
      toast.info(action === "pause" ? "Đã tạm dừng phiên quét." : "Đang tiếp tục quét...");
    } catch (err) {
      toast.error(err?.message || "Không gửi được lệnh điều khiển.");
    } finally {
      setControlBusy(false);
    }
  };

  const handleToggleExecution = async () => {
    if (isExecuting) {
      await handleStop();
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
      const matchLike = !minLikeFilter || minLikeFilter === "0" || l > Number(minLikeFilter);
      const matchCmt = !minCmtFilter || minCmtFilter === "0" || c > Number(minCmtFilter);
      const matchShare = !minShareFilter || minShareFilter === "0" || s > Number(minShareFilter);
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
    } else if (sortOption === "latest") {
      // ID bài số của Facebook tăng theo thời gian đăng; ID dạng pfbid… để cuối.
      const idOf = (p) => {
        const raw = String(p.post_id || p.postId || "");
        return /^[0-9]+$/.test(raw) ? BigInt(raw) : null;
      };
      result.sort((a, b) => {
        const x = idOf(a);
        const y = idOf(b);
        if (x === null && y === null) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        return x === y ? 0 : y > x ? 1 : -1;
      });
    }

    return result;
  }, [posts, postSearch, minLikeFilter, minCmtFilter, minShareFilter, sortOption]);

  const pageSize = 15;
  const totalPages = Math.max(1, Math.ceil(filteredPosts.length / pageSize));

  // Đổi bộ lọc / danh mục → về trang 1; danh sách ngắn lại → không đứng ở trang trống.
  useEffect(() => {
    setCurrentPage(1);
  }, [postSearch, minLikeFilter, minCmtFilter, minShareFilter, sortOption, selectedCategory]);
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);
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
        postedTime: p.posted_at || p.postedTime || "—",
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

        {/* BIG PRIMARY ACTION BUTTON: BẮT ĐẦU / TẠM DỪNG / DỪNG */}
        {isExecuting ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={handlePauseResume}
              disabled={isStopping || controlBusy || !activeJobId}
              className="inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-xl bg-[#F59E0B] text-sm font-bold tracking-wide text-white shadow-sm transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPaused ? <Play className="size-4 fill-white" /> : <Pause className="size-4 fill-white" />}
              <span>{isPaused ? "TIẾP TỤC QUÉT" : "TẠM DỪNG"}</span>
            </button>
            <button
              type="button"
              onClick={handleStop}
              disabled={isStopping || controlBusy}
              className="inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-xl bg-[#DC2626] text-sm font-bold tracking-wide text-white shadow-sm transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Square className="size-4 fill-white" />
              <span>{isStopping ? "ĐANG DỪNG..." : "DỪNG THỰC THI QUÉT"}</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleToggleExecution}
            className="inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-xl bg-[#1877F2] text-sm font-bold tracking-wide text-white shadow-sm transition-colors hover:bg-blue-600"
          >
            <Play className="size-4 fill-white" />
            <span>BẮT ĐẦU THỰC THI</span>
          </button>
        )}

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
