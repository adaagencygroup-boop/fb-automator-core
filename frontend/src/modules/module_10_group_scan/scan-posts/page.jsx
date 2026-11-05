"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Play,
  Square,
} from "lucide-react";
import { toast } from "@/lib/toast";
import AccountSelectModal, { isScanReady } from "../components/AccountSelectModal";
import GroupPickerModal from "../components/GroupPickerModal";
import { getScanAccounts, getScanCategories, getScannedGroups } from "../service";
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
  const [posts] = useState([]);

  useEffect(() => {
    getScannedGroups()
      .then((res) => {
        const list = res?.groups || [];
        setAvailableGroups(
          list.map((g, idx) => ({
            id: g.id || g.group_id,
            stt: String(idx + 1).padStart(2, "0"),
            name: g.name || g.group_id,
            uid: g.group_id || g.id,
            tag: (g.name || "FB").slice(0, 2).toUpperCase(),
            tagBg: "bg-[#DBEAFE]",
            tagText: "text-[#2563EB]",
            type: g.type === "private" ? "private" : "public",
            typeLabel: g.type === "private" ? "Riêng tư" : "Công khai",
            members: g.members || "—",
            memberCount: g.membersCount || 0,
          }))
        );
      })
      .catch(() => setAvailableGroups([]));

    getScanCategories()
      .then((data) => {
        const cats = Array.isArray(data) ? data : [];
        setCategories(
          cats.map((c) => ({
            id: c.id,
            name: c.name,
            fullName: c.name,
            memberSummary: `${c.group_count || 0} Nhóm`,
            postCount: 0,
          }))
        );
        if (cats.length > 0) {
          setSelectedCategory(cats[0].id);
        }
      })
      .catch(() => setCategories([]));
  }, []);

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
  const [logs, setLogs] = useState([]);
  const [copiedLog, setCopiedLog] = useState(false);

  // Remove Group handler
  const handleRemoveGroup = (groupId) => {
    setSelectedGroups((prev) => prev.filter((g) => g.id !== groupId));
    toast.success("Đã xóa nhóm khỏi danh sách quét!");
  };

  // Toggle Execution
  const handleToggleExecution = () => {
    if (isExecuting) {
      setIsExecuting(false);
      toast.info("Đã dừng tiến trình quét bài viết nhóm.");
      setLogs((prev) => [
        ...prev,
        {
          time: new Date().toLocaleTimeString("vi-VN", { hour12: false }),
          thread: "Thread-01",
          color: "text-rose-400",
          message: "Người dùng đã tạm dừng tiến trình quét bài viết.",
        },
      ]);
    } else {
      if (selectedUids.length === 0) {
        toast.error("Vui lòng chọn ít nhất một tài khoản thực thi!");
        return;
      }
      if (selectedGroups.length === 0) {
        toast.error("Vui lòng chọn ít nhất một nhóm để quét!");
        return;
      }
      setIsExecuting(true);
      toast.success("Bắt đầu tiến trình quét bài viết nhóm...");
      setLogs((prev) => [
        ...prev,
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

  // Filter Posts
  const filteredPosts = useMemo(() => {
    return posts.filter((p) => {
      const matchQuery =
        !postSearch.trim() ||
        (p.content || "").toLowerCase().includes(postSearch.toLowerCase()) ||
        (p.authorName || "").toLowerCase().includes(postSearch.toLowerCase()) ||
        (p.linkText || "").includes(postSearch.trim());
      const matchLike = !minLikeFilter || minLikeFilter === "0" || (p.likes || 0) >= Number(minLikeFilter);
      const matchCmt = !minCmtFilter || minCmtFilter === "0" || (p.comments || 0) >= Number(minCmtFilter);
      const matchShare = !minShareFilter || minShareFilter === "0" || (p.shares || 0) >= Number(minShareFilter);
      return matchQuery && matchLike && matchCmt && matchShare;
    });
  }, [posts, postSearch, minLikeFilter, minCmtFilter, minShareFilter]);

  const pageSize = 15;
  const totalPages = Math.max(1, Math.ceil(filteredPosts.length / pageSize));
  const paginatedPosts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredPosts.slice(start, start + pageSize);
  }, [filteredPosts, currentPage, pageSize]);

  // Select all posts
  const allFilteredSelected =
    filteredPosts.length > 0 &&
    filteredPosts.every((p) => selectedPostIds.has(p.id));

  const handleToggleSelectAllPosts = () => {
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

  // Export actions
  const handleExportAll = () => {
    toast.success("Đang trích xuất toàn bộ bài viết ra file Excel / CSV...");
  };

  const handleExportGroup = () => {
    const curCat = categories.find((c) => c.id === selectedCategory);
    toast.success(`Đang xuất bài viết của nhóm: ${curCat?.fullName || curCat?.name || "nhóm đang chọn"}...`);
  };

  const handleResetFilters = () => {
    setPostSearch("");
    setMinLikeFilter("0");
    setMinCmtFilter("0");
    setMinShareFilter("0");
    toast.info("Đã đặt lại bộ lọc!");
  };

  const currentCategoryData =
    categories.find((c) => c.id === selectedCategory) || categories[0] || null;

  return (
    <>
      {/* Ẩn nút mũi tên tăng giảm số chỉ cho riêng Module 10 */}
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

        {/* NÚT THỰC THI TRUNG TÂM: BẮT ĐẦU THỰC THI */}
        <button
          type="button"
          onClick={handleToggleExecution}
          className={`inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-xl text-sm font-bold tracking-wide text-white transition-colors shadow-sm ${
            isExecuting ? "bg-[#DC2626] hover:bg-rose-700" : "bg-[#004AC6] hover:bg-blue-800"
          }`}
        >
          {isExecuting ? (
            <>
              <Square className="size-4 fill-white" />
              <span>DỪNG THỰC THI QUÉT BÀI VIẾT</span>
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
          onMinLikeFilterChange={(val) => {
            setMinLikeFilter(val);
            setCurrentPage(1);
          }}
          minCmtFilter={minCmtFilter}
          onMinCmtFilterChange={(val) => {
            setMinCmtFilter(val);
            setCurrentPage(1);
          }}
          minShareFilter={minShareFilter}
          onMinShareFilterChange={(val) => {
            setMinShareFilter(val);
            setCurrentPage(1);
          }}
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
