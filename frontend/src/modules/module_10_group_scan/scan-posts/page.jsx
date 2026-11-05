"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Users,
  Globe,
  Trash2,
  Play,
  Download,
  Search,
  ExternalLink,
  ChevronDown,
  Copy,
  Check,
  Square,
  Eye,
  X,
  Filter,
  RotateCcw,
} from "lucide-react";
import { toast } from "@/lib/toast";
import Pagination from "@/components/ui/pagination";
import CustomSelect from "@/components/ui/custom-select";
import AccountSelectModal, { isScanReady } from "../components/AccountSelectModal";
import GroupPickerModal from "../components/GroupPickerModal";
import { getScanAccounts, getScanCategories, getScannedGroups } from "../service";

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

const MIN_LIKE_OPTIONS = [
  { value: "0", label: "Tất cả like" },
  { value: "50", label: "> 50 like" },
  { value: "100", label: "> 100 like" },
  { value: "500", label: "> 500 like" },
];

const MIN_CMT_OPTIONS = [
  { value: "0", label: "Tất cả cmt" },
  { value: "10", label: "> 10 cmt" },
  { value: "20", label: "> 20 cmt" },
  { value: "50", label: "> 50 cmt" },
];

const MIN_SHARE_OPTIONS = [
  { value: "0", label: "Tất cả share" },
  { value: "5", label: "> 5 share" },
  { value: "10", label: "> 10 share" },
  { value: "50", label: "> 50 share" },
];

const SORT_OPTIONS = [
  { value: "highest_interaction", label: "Tương tác cao nhất" },
  { value: "latest", label: "Mới nhất" },
  { value: "most_likes", label: "Nhiều like nhất" },
  { value: "most_comments", label: "Nhiều bình luận nhất" },
];

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
  const [availableGroups, setAvailableGroups] = useState([]);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");

  // Load available groups & categories from Database
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [posts, setPosts] = useState([]);

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
        {/* =======================================================
            SECTION 1 & SECTION 2: 2 Column Configuration Grids
        ======================================================= */}
        <div className="grid items-stretch gap-5 xl:grid-cols-2">
          {/* Card 1: Cấu hình chung & Chọn tài khoản/nhóm */}
          <section className="flex flex-col h-full rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-4">
            <div className="flex items-center gap-2.5 pb-3 border-b border-[#F1F5F9]">
              <span className="flex size-6 items-center justify-center rounded-full bg-[#1877F2] text-[11px] font-bold text-white shrink-0">
                1
              </span>
              <h2 className="text-sm font-bold text-[#0B1C30]">
                Chọn tài khoản & Nhóm quét
              </h2>
            </div>

            <div className="space-y-4">
              {/* Row 1: Tài khoản Facebook thực thi */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#475569]">
                  Tài khoản Facebook thực thi:
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setAccountsModalOpen(true)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#1877F2] px-3.5 text-xs font-semibold text-white hover:bg-blue-600 transition-colors shadow-sm"
                  >
                    <Users className="size-3.5" />
                    <span>Chọn tài khoản</span>
                  </button>

                  <div
                    title={selectedAccountNames}
                    className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-3 text-xs font-medium text-[#059669] cursor-help"
                  >
                    <span className="size-1.5 rounded-full bg-[#10B981] shrink-0" />
                    <span>
                      Đã chọn:{" "}
                      <strong className="text-emerald-950 font-bold">
                        {selectedUids.length} / {moduleAccounts.length}
                      </strong>{" "}
                      tài khoản
                    </span>
                  </div>
                </div>
              </div>

              {/* Row 2: Danh sách nhóm mục tiêu */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#475569]">
                  Danh sách nhóm mục tiêu:
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setGroupPickerOpen(true)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#1877F2] px-3.5 text-xs font-semibold text-white hover:bg-blue-600 transition-colors shadow-sm"
                  >
                    <Globe className="size-3.5" />
                    <span>Chọn nhóm muốn quét</span>
                  </button>

                  <div className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-3 text-xs font-medium text-[#059669]">
                    <span className="size-1.5 rounded-full bg-[#10B981] shrink-0" />
                    <span>
                      Đã chọn: <strong className="text-emerald-950 font-bold">{selectedGroups.length} nhóm</strong>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Card 2: Cấu hình quét nâng cao & Giới hạn */}
          <section className="flex flex-col h-full rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-4">
            <div className="flex items-center gap-2.5 pb-3 border-b border-[#F1F5F9]">
              <span className="flex size-6 items-center justify-center rounded-full bg-[#1877F2] text-[11px] font-bold text-white shrink-0">
                2
              </span>
              <h2 className="text-sm font-bold text-[#0B1C30]">
                Cấu hình quét nâng cao & Giới hạn
              </h2>
            </div>

            <div className="space-y-3.5">
              {/* Cài đặt khoảng cách quét (Stepper đồng nhất theo ảnh mẫu) */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#334155]">
                  Khoảng cách giữa các lần quét:
                </span>
                <div className="flex items-center gap-2">
                  {/* Min delay stepper */}
                  <div className="flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7">
                    <button
                      type="button"
                      onClick={() => setMinDelay((v) => Math.max(1, v - 1))}
                      className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-l-lg font-medium"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      value={minDelay}
                      onChange={(e) => setMinDelay(Number(e.target.value) || 1)}
                      className="w-8 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button
                      type="button"
                      onClick={() => setMinDelay((v) => v + 1)}
                      className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-r-lg font-medium"
                    >
                      +
                    </button>
                  </div>

                  <span className="text-xs text-[#94A3B8]">-</span>

                  {/* Max delay stepper */}
                  <div className="flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7">
                    <button
                      type="button"
                      onClick={() => setMaxDelay((v) => Math.max(minDelay, v - 1))}
                      className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-l-lg font-medium"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      value={maxDelay}
                      onChange={(e) => setMaxDelay(Math.max(minDelay, Number(e.target.value) || minDelay))}
                      className="w-8 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button
                      type="button"
                      onClick={() => setMaxDelay((v) => v + 1)}
                      className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-r-lg font-medium"
                    >
                      +
                    </button>
                  </div>

                  <span className="text-xs text-[#64748B]">giây</span>
                </div>
              </div>

              {/* Giới hạn đổi tài khoản (Stepper đồng nhất) */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#334155]">
                  Đổi tài khoản mới khi quét được:
                </span>
                <div className="flex items-center gap-2">
                  <div className="flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7">
                    <button
                      type="button"
                      onClick={() => setSwitchAccThreshold((v) => Math.max(5, v - 5))}
                      className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-l-lg font-medium"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      value={switchAccThreshold}
                      onChange={(e) => setSwitchAccThreshold(Number(e.target.value) || 10)}
                      className="w-10 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button
                      type="button"
                      onClick={() => setSwitchAccThreshold((v) => v + 5)}
                      className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-r-lg font-medium"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-xs text-[#64748B]">bài / nick</span>
                </div>
              </div>

              {/* Giới hạn bài mỗi nhóm (Stepper đồng nhất) */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#334155]">
                  Mỗi nhóm quét tối đa:
                </span>
                <div className="flex items-center gap-2">
                  <div className="flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7">
                    <button
                      type="button"
                      onClick={() => setPostsPerGroupLimit((v) => Math.max(10, v - 10))}
                      className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-l-lg font-medium"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      value={postsPerGroupLimit}
                      onChange={(e) => setPostsPerGroupLimit(Number(e.target.value) || 10)}
                      className="w-10 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button
                      type="button"
                      onClick={() => setPostsPerGroupLimit((v) => v + 10)}
                      className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-r-lg font-medium"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-xs text-[#64748B]">bài mới nhất</span>
                </div>
              </div>

              {/* Checkboxes Group */}
              <div className="space-y-2 pt-1 border-t border-[#F1F5F9]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={filterDaysEnabled}
                      onChange={(e) => setFilterDaysEnabled(e.target.checked)}
                      className="size-4 text-[#1877F2] rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                    />
                    <span className="text-xs font-medium text-[#334155]">
                      Chỉ quét các bài viết đăng trong vòng
                    </span>
                  </label>
                  <div className="flex items-center gap-2">
                    <div className={`flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7 ${!filterDaysEnabled ? "opacity-50 pointer-events-none" : ""}`}>
                      <button
                        type="button"
                        disabled={!filterDaysEnabled}
                        onClick={() => setFilterDays((v) => Math.max(1, v - 1))}
                        className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-l-lg font-medium"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        disabled={!filterDaysEnabled}
                        value={filterDays}
                        onChange={(e) => setFilterDays(Number(e.target.value) || 1)}
                        className="w-8 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <button
                        type="button"
                        disabled={!filterDaysEnabled}
                        onClick={() => setFilterDays((v) => v + 1)}
                        className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-r-lg font-medium"
                      >
                        +
                      </button>
                    </div>
                    <span className="text-xs text-[#64748B]">ngày qua</span>
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={skipPinnedPosts}
                    onChange={(e) => setSkipPinnedPosts(e.target.checked)}
                    className="size-4 text-[#1877F2] rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                  />
                  <span className="text-xs font-medium text-[#334155]">
                    Bỏ qua bài viết ghim của Quản trị viên
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoDedupePosts}
                    onChange={(e) => setAutoDedupePosts(e.target.checked)}
                    className="size-4 text-[#1877F2] rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                  />
                  <span className="text-xs font-medium text-[#334155]">
                    Tự động lọc trùng lặp bài viết giữa các nhóm
                  </span>
                </label>
              </div>
            </div>
          </section>
        </div>

        {/* =======================================================
            SECTION 3: Xem trước danh sách nhóm muốn quét
        ======================================================= */}
        <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F1F5F9] px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex size-8 items-center justify-center rounded-lg bg-[#EFF6FF] text-[#2563EB] shrink-0">
                <Eye className="size-4" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-[#0F172A]">
                    Xem trước danh sách nhóm muốn quét
                  </h3>
                  <span className="rounded-full bg-[#DBEAFE] px-2.5 py-0.5 text-[11px] font-semibold text-[#1D4ED8]">
                    {selectedGroups.length} nhóm đã chọn
                  </span>
                </div>
                <p className="text-xs text-[#94A3B8]">
                  Kiểm tra thông tin quyền riêng tư và quy mô thành viên trước khi tiến hành quét
                </p>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-xs">
              <thead className="bg-[#F8FAFC] text-[10px] font-bold uppercase tracking-wide text-[#64748B] border-b border-[#E2E8F0]">
                <tr>
                  <th className="w-14 px-4 py-3 text-center">STT</th>
                  <th className="px-4 py-3">TÊN NHÓM FACEBOOK</th>
                  <th className="w-36 px-4 py-3">LOẠI NHÓM</th>
                  <th className="w-48 px-4 py-3">QUY MÔ / THÀNH VIÊN</th>
                  <th className="w-20 px-4 py-3 text-center">THAO TÁC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {selectedGroups.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400">
                      Chưa có nhóm nào được chọn. Nhấn &apos;Chọn nhóm muốn quét&apos; để thêm nhóm từ cơ sở dữ liệu.
                    </td>
                  </tr>
                ) : (
                  selectedGroups.map((group, idx) => (
                    <tr key={group.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-center font-bold text-[#94A3B8]">
                        {group.stt || (idx < 9 ? `0${idx + 1}` : `${idx + 1}`)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${group.tagBg} ${group.tagText}`}
                          >
                            {group.tag}
                          </div>
                          <div className="flex flex-col">
                            <span className="font-semibold text-xs text-[#0F172A] line-clamp-1">
                              {group.name}
                            </span>
                            <span className="font-mono text-[11px] text-[#94A3B8]">
                              ID: {group.uid}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {group.type === "public" ? (
                          <span className="inline-flex rounded border border-[#D1FAE5] bg-[#ECFDF5] px-2 py-0.5 text-[10px] font-semibold text-[#047857]">
                            Công khai
                          </span>
                        ) : (
                          <span className="inline-flex rounded bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-semibold text-[#475569]">
                            Riêng tư
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold text-[#0F172A]">
                        {group.members}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveGroup(group.id)}
                          className="rounded p-1 text-[#94A3B8] hover:bg-rose-50 hover:text-rose-600 transition-colors"
                          title="Xóa nhóm"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* =======================================================
            NÚT THỰC THI TRUNG TÂM: BẮT ĐẦU THỰC THI
        ======================================================= */}
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

        {/* =======================================================
            SECTION 4: Kết quả quét bài viết (Master-Detail 2 cột)
        ======================================================= */}
        <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F1F5F9] px-5 py-4">
            <div className="flex items-center gap-2.5">
              <h3 className="text-sm font-bold text-[#0F172A]">
                Kết quả quét bài viết
              </h3>
              <span className="rounded-full bg-[#DBEAFE] px-2.5 py-0.5 text-[11px] font-semibold text-[#1D4ED8]">
                {filteredPosts.length} Bài viết
              </span>
            </div>

            <button
              type="button"
              onClick={handleExportAll}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-[#F8FAFC] px-3 text-xs font-semibold text-[#334155] hover:bg-slate-100 transition-colors"
            >
              <Download className="size-3.5 text-[#64748B]" />
              <span>Xuất toàn bộ Excel / CSV</span>
            </button>
          </div>

          {/* 2 Column Content */}
          <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[580px]">
            {/* Cột trái: Danh mục nhóm */}
            <div className="lg:col-span-4 p-4 bg-[#F8FAFC]/50 border-r border-[#E2E8F0] flex flex-col gap-3">
              <span className="text-[11px] font-bold uppercase tracking-wide text-[#334155]">
                DANH MỤC NHÓM ({categories.length})
              </span>

              <div className="relative w-full">
                <Search className="size-3.5 absolute left-3 top-2 text-[#94A3B8]" />
                <input
                  type="text"
                  placeholder="Tìm nhóm..."
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                  className="w-full h-7 pl-8 pr-3 text-xs text-slate-800 border border-[#E2E8F0] bg-white rounded-lg outline-none focus:border-[#1877F2]"
                />
              </div>

              <div className="flex flex-col gap-2 max-h-[480px] overflow-y-auto pr-0.5">
                {filteredCategories.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    Chưa có danh mục nào từ cơ sở dữ liệu.
                  </div>
                ) : (
                  filteredCategories.map((cat) => {
                    const isSelected = cat.id === selectedCategory;
                    return (
                      <button
                        type="button"
                        key={cat.id}
                        onClick={() => setSelectedCategory(cat.id)}
                        className={`flex flex-col items-start p-3 gap-1 w-full rounded-xl text-left transition-all ${
                          isSelected
                            ? "bg-white border-2 border-[#1877F2] shadow-xs"
                            : "bg-white border border-[#E2E8F0] hover:border-slate-300"
                        }`}
                      >
                        <span className="font-bold text-xs text-[#0F172A] line-clamp-1">
                          {cat.name}
                        </span>
                        <div className="flex items-center justify-between w-full">
                          <span className="text-[11px] text-[#64748B]">
                            {cat.memberSummary}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                              isSelected
                                ? "bg-[#EFF6FF] text-[#1877F2]"
                                : "bg-[#F1F5F9] text-[#475569]"
                            }`}
                          >
                            {cat.postCount} bài
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Cột phải: Bảng bài viết & Bộ lọc Like, Comment, Share */}
            <div className="lg:col-span-8 p-4 flex flex-col gap-3.5 min-w-0">
              {/* Group Header Info */}
              <div className="flex flex-wrap justify-between items-center pb-3 border-b border-[#F1F5F9] gap-2">
                <div className="flex flex-col gap-0.5">
                  <h4 className="font-bold text-sm text-[#0F172A]">
                    {currentCategoryData?.fullName || currentCategoryData?.name || "Chưa chọn danh mục"}
                  </h4>
                  <div className="flex items-center gap-2 text-xs text-[#64748B]">
                    <span>Quy mô: {currentCategoryData?.memberSummary || "0 Nhóm"}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleExportGroup}
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-3 text-xs font-semibold text-[#1877F2] hover:bg-blue-100 transition-colors"
                >
                  <Download className="size-3 text-[#1877F2]" />
                  <span>Xuất bài viết nhóm</span>
                </button>
              </div>

              {/* Bộ lọc tương tác nâng cao */}
              <div className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl flex flex-col gap-2.5">
                {/* Search & Quick Filters */}
                <div className="flex flex-wrap items-center gap-2 w-full">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="size-3.5 absolute left-2.5 top-2 text-[#94A3B8]" />
                    <input
                      type="text"
                      placeholder="Tìm nội dung bài viết, ID bài, tác giả..."
                      value={postSearch}
                      onChange={(e) => setPostSearch(e.target.value)}
                      className="w-full h-7 pl-8 pr-2.5 text-xs text-slate-800 border border-[#E2E8F0] bg-white rounded-lg outline-none focus:border-[#1877F2]"
                    />
                  </div>

                  <div className="w-28 shrink-0">
                    <CustomSelect
                      value={minLikeFilter}
                      onChange={(val) => {
                        setMinLikeFilter(val);
                        setCurrentPage(1);
                      }}
                      options={MIN_LIKE_OPTIONS}
                      size="sm"
                      buttonClassName="h-7 text-xs"
                    />
                  </div>

                  <div className="w-28 shrink-0">
                    <CustomSelect
                      value={minCmtFilter}
                      onChange={(val) => {
                        setMinCmtFilter(val);
                        setCurrentPage(1);
                      }}
                      options={MIN_CMT_OPTIONS}
                      size="sm"
                      buttonClassName="h-7 text-xs"
                    />
                  </div>

                  <div className="w-28 shrink-0">
                    <CustomSelect
                      value={minShareFilter}
                      onChange={(val) => {
                        setMinShareFilter(val);
                        setCurrentPage(1);
                      }}
                      options={MIN_SHARE_OPTIONS}
                      size="sm"
                      buttonClassName="h-7 text-xs"
                    />
                  </div>
                </div>

                {/* Sorting and Actions */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/60">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-[#64748B] flex items-center gap-1">
                      <Filter className="size-3 text-[#94A3B8]" />
                      Sắp xếp:
                    </span>
                    <div className="w-44 shrink-0">
                      <CustomSelect
                        value={sortOption}
                        onChange={(val) => setSortOption(val)}
                        options={SORT_OPTIONS}
                        size="sm"
                        buttonClassName="h-7 text-xs font-semibold"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toast.success("Đã áp dụng bộ lọc bài viết!")}
                      className="inline-flex h-7 items-center gap-1 px-3 bg-[#1877F2] text-white rounded-lg text-xs font-semibold hover:bg-blue-600 transition-colors shadow-xs"
                    >
                      <Search className="size-3" />
                      <span>Lọc dữ liệu</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPostSearch("");
                        setMinLikeFilter("0");
                        setMinCmtFilter("0");
                        setMinShareFilter("0");
                        toast.info("Đã đặt lại bộ lọc!");
                      }}
                      className="inline-flex h-7 items-center px-2.5 bg-white border border-[#E2E8F0] text-[#64748B] rounded-lg text-xs font-medium hover:bg-slate-50 transition-colors"
                    >
                      Đặt lại bộ lọc
                    </button>
                  </div>
                </div>
              </div>

              {/* Bảng bài viết quét được */}
              <div className="w-full border border-[#E2E8F0] rounded-xl overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="bg-[#F8FAFC] text-[10px] font-bold uppercase tracking-wide text-[#64748B] border-b border-[#E2E8F0]">
                    <tr>
                      <th className="py-2.5 px-3 text-center w-10">
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={handleToggleSelectAllPosts}
                          className="size-3.5 rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </th>
                      <th className="py-2.5 px-2 text-center w-10">STT</th>
                      <th className="py-2.5 px-3 min-w-[220px]">NỘI DUNG BÀI VIẾT</th>
                      <th className="py-2.5 px-3 w-36">TÁC GIẢ</th>
                      <th className="py-2.5 px-2 text-center w-20">LƯỢT LIKE</th>
                      <th className="py-2.5 px-2 text-center w-20">LƯỢT CMT</th>
                      <th className="py-2.5 px-2 text-center w-20">LƯỢT SHARE</th>
                      <th className="py-2.5 px-3 w-28">THỜI GIAN ĐĂNG</th>
                      <th className="py-2.5 px-3 text-center w-20">THAO TÁC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9]">
                    {paginatedPosts.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-slate-400">
                          Chưa có bài viết nào được quét. Nhấn &apos;BẮT ĐẦU THỰC THI&apos; để quét bài viết.
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
                                  {post.content}
                                </p>
                                <a
                                  href={`https://${post.linkText}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 font-mono text-[11px] text-[#1877F2] hover:underline"
                                >
                                  <span className="truncate max-w-[220px]">{post.linkText}</span>
                                  <ExternalLink className="size-3 text-[#1877F2] shrink-0" />
                                </a>
                              </div>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`size-7 rounded-full ${post.authorTagBg} ${post.authorTagText} font-bold text-xs flex items-center justify-center shrink-0 uppercase`}
                                >
                                  {post.authorTag}
                                </span>
                                <div className="flex flex-col min-w-0">
                                  <span className="font-semibold text-xs text-[#0F172A] truncate">
                                    {post.authorName}
                                  </span>
                                  <span className="font-mono text-[10px] text-[#94A3B8] truncate">
                                    {post.authorUid}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 px-2 text-center">
                              <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-[#EFF6FF] border border-[#DBEAFE] font-bold text-xs text-[#1D4ED8]">
                                {post.likesStr || post.likes || 0}
                              </span>
                            </td>
                            <td className="py-2.5 px-2 text-center">
                              <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-[#ECFDF5] border border-[#D1FAE5] font-bold text-xs text-[#047857]">
                                {post.comments || 0}
                              </span>
                            </td>
                            <td className="py-2.5 px-2 text-center">
                              <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-[#FFFBEB] border border-[#FEF3C7] font-bold text-xs text-[#B45309]">
                                {post.shares || 0}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-[11px] text-[#64748B]">
                              {post.postedTime || "—"}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  type="button"
                                  title="Xem chi tiết"
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
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Phân trang */}
              <div className="flex flex-row justify-between items-center w-full pt-1">
                <span className="text-xs text-[#64748B]">
                  Hiển thị {filteredPosts.length > 0 ? `${(currentPage - 1) * pageSize + 1} - ${Math.min(currentPage * pageSize, filteredPosts.length)}` : "0"} của {filteredPosts.length} bài viết
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

        {/* =======================================================
            SECTION 5: Live Automation Log Console [Thread-01]
        ======================================================= */}
        <section className="overflow-hidden rounded-xl border border-slate-800 bg-[#1e293b] shadow-inner">
          <div className="flex items-center justify-between border-b border-slate-800 bg-[#0f172a] px-4 py-2.5">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-rose-500" />
                <span className="size-2.5 rounded-full bg-amber-500" />
                <span className="size-2.5 rounded-full bg-emerald-500" />
              </div>
              <span className="font-mono text-xs font-semibold text-slate-300">
                Live Automation Log Console [Thread-01]
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-400">
                <span className={`size-1.5 rounded-full ${isExecuting ? "bg-emerald-400 animate-ping" : "bg-emerald-400"}`} />
                {isExecuting ? "RUNNING" : "IDLE"}
              </span>

              <button
                type="button"
                onClick={handleCopyLogs}
                className="text-slate-400 hover:text-white transition-colors"
                title="Sao chép toàn bộ logs"
              >
                {copiedLog ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
              </button>
            </div>
          </div>

          <div className="max-h-52 space-y-1.5 overflow-y-auto px-4 py-3 font-mono text-[11px] leading-relaxed">
            {logs.map((log, index) => (
              <p key={index} className="flex flex-wrap items-start gap-2 text-slate-300">
                <span className="shrink-0 text-slate-500">[{log.time}]</span>
                <span className="shrink-0 text-sky-400">[{log.thread}]</span>
                <span className={`break-all ${log.color}`}>{log.message}</span>
              </p>
            ))}
          </div>
        </section>

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
