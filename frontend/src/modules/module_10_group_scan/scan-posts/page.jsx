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
import AccountSelectModal, { isScanReady } from "../components/AccountSelectModal";
import { getScanAccounts } from "../service";

const DEFAULT_SCAN_ACCOUNTS = [
  {
    id: "acc-1",
    uid: "81594788917102",
    profile_name: "Riska Nasution (Nick Trâu)",
    email: "riska.nasution@gmail.com",
    status: "live",
    login_status: "logged_in",
  },
  {
    id: "acc-2",
    uid: "100084729182312",
    profile_name: "Hoàng Minh Thuận (Scan Post 01)",
    email: "thuandz99@gmail.com",
    status: "live",
    login_status: "logged_in",
  },
  {
    id: "acc-3",
    uid: "100091823761294",
    profile_name: "Trần Mai Anh (Seeding 02)",
    email: "maianh.tran@gmail.com",
    status: "live",
    login_status: "logged_in",
  },
  {
    id: "acc-4",
    uid: "100062819451290",
    profile_name: "Nguyễn Hải Đăng (Acc Backup 03)",
    email: "haidang.dev@gmail.com",
    status: "live",
    login_status: "logged_in",
  },
  {
    id: "acc-5",
    uid: "100037194012893",
    profile_name: "Lê Ngọc Bích (Farm 04)",
    email: "ngocbich.le@gmail.com",
    status: "live",
    login_status: "logged_in",
  },
];

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

// ==========================================
// DỮ LIỆU MẪU BAN ĐẦU CHUẨN FIGMA IMAGE 1
// ==========================================

const INITIAL_SELECTED_GROUPS = [
  {
    id: "g-1",
    stt: "01",
    name: "Hội Buôn Bán Online Toàn Quốc",
    uid: "81594788917102",
    tag: "HB",
    tagBg: "bg-[#DBEAFE]",
    tagText: "text-[#2563EB]",
    type: "public",
    typeLabel: "Công khai",
    members: "258.724 TV",
  },
  {
    id: "g-2",
    stt: "02",
    name: "Marketing Sài Gòn Hub - Tuyển dụng & Thảo luận",
    uid: "49204918231032",
    tag: "MK",
    tagBg: "bg-[#F3E8FF]",
    tagText: "text-[#9333EA]",
    type: "private",
    typeLabel: "Riêng tư",
    members: "186.392 TV",
  },
  {
    id: "g-3",
    stt: "03",
    name: "Bất Động Sản & Đầu Tư Hà Nội 2024",
    uid: "92837192837123",
    tag: "BĐ",
    tagBg: "bg-[#FFEDD5]",
    tagText: "text-[#EA580C]",
    type: "public",
    typeLabel: "Công khai",
    members: "142.050 TV",
  },
  {
    id: "g-4",
    stt: "04",
    name: "Cộng Đồng Thương Mại Điện Tử & Dropship VN",
    uid: "37492817293847",
    tag: "TM",
    tagBg: "bg-[#D1FAE5]",
    tagText: "text-[#059669]",
    type: "public",
    typeLabel: "Công khai",
    members: "95.400 TV",
  },
  {
    id: "g-5",
    stt: "05",
    name: "Khởi Nghiệp & Kinh Doanh Thực Chiến",
    uid: "61928371928312",
    tag: "KV",
    tagBg: "bg-[#FCE7F3]",
    tagText: "text-[#DB2777]",
    type: "private",
    typeLabel: "Riêng tư",
    members: "312.800 TV",
  },
];

const CATEGORIES_DATA = [
  {
    id: "cat-1",
    name: "Hội Buôn Bán Online Toàn...",
    fullName: "Hội Buôn Bán Online Toàn Quốc",
    memberSummary: "1.4M Thành viên",
    postCount: 450,
  },
  {
    id: "cat-2",
    name: "Marketing Sài Gòn Hub",
    fullName: "Marketing Sài Gòn Hub - Tuyển dụng & Thảo luận",
    memberSummary: "1.8M Thành viên",
    postCount: 320,
  },
  {
    id: "cat-3",
    name: "Cộng Đồng Bất Động Sản &...",
    fullName: "Cộng Đồng Bất Động Sản & Đầu Tư",
    memberSummary: "412K Thành viên",
    postCount: 380,
  },
  {
    id: "cat-4",
    name: "Nguồn Hàng Sỉ & Dropship VN",
    fullName: "Nguồn Hàng Sỉ & Dropship VN",
    memberSummary: "650K Thành viên",
    postCount: 270,
  },
];

const INITIAL_POSTS = [
  {
    id: "p-1",
    stt: "01",
    content: "Cần tìm xưởng may gia công áo thun số lượng lớn từ 2000-5000c/tháng tại HCM…",
    linkText: "fb.com/groups/buonban/posts/89123891",
    authorName: "Nguyễn Văn An",
    authorUid: "1000847291...",
    authorTag: "NA",
    authorTagBg: "bg-[#E0E7FF]",
    authorTagText: "text-[#4338CA]",
    likes: 1250,
    likesStr: "1.250",
    comments: 342,
    shares: 85,
    postedTime: "Hôm nay 10:15",
  },
  {
    id: "p-2",
    stt: "02",
    content: "Tổng hợp file tài liệu bí quyết chạy Ads Facebook tối ưu ngân sách 2024 mới nhất.",
    linkText: "fb.com/groups/buonban/posts/78100234",
    authorName: "Trần Thị Mai",
    authorUid: "1000918237...",
    authorTag: "TM",
    authorTagBg: "bg-[#FFE4E6]",
    authorTagText: "text-[#BE123C]",
    likes: 890,
    likesStr: "890",
    comments: 512,
    shares: 142,
    postedTime: "Hôm qua 18:20",
  },
  {
    id: "p-3",
    stt: "03",
    content: "Tổng hợp file tài liệu bí quyết chạy Ads Facebook tối ưu ngân sách 2024 mới nhất.",
    linkText: "fb.com/groups/buonban/posts/78100234",
    authorName: "Trần Thị Mai",
    authorUid: "1000918237...",
    authorTag: "TM",
    authorTagBg: "bg-[#FFE4E6]",
    authorTagText: "text-[#BE123C]",
    likes: 890,
    likesStr: "890",
    comments: 512,
    shares: 142,
    postedTime: "Hôm qua 18:20",
  },
  {
    id: "p-4",
    stt: "04",
    content: "Tổng hợp file tài liệu bí quyết chạy Ads Facebook tối ưu ngân sách 2024 mới nhất.",
    linkText: "fb.com/groups/buonban/posts/78100234",
    authorName: "Trần Thị Mai",
    authorUid: "1000918237...",
    authorTag: "TM",
    authorTagBg: "bg-[#FFE4E6]",
    authorTagText: "text-[#BE123C]",
    likes: 890,
    likesStr: "890",
    comments: 512,
    shares: 142,
    postedTime: "Hôm qua 18:20",
  },
];

const INITIAL_LOGS = [
  {
    time: "14:26:41",
    thread: "Thread-01",
    color: "text-slate-400",
    message: "Khởi chạy Chrome Profile cho UID 81594788917102 (Riska Nasution)...",
  },
  {
    time: "14:26:44",
    thread: "Thread-01",
    color: "text-amber-400",
    message: "Proxy: Nick không có proxy cá nhân, đang chạy bằng IP trực tiếp của máy",
  },
  {
    time: "14:26:51",
    thread: "Thread-01",
    color: "text-slate-300",
    message: 'Kết nối Group: "Hội Buôn Bán Online Toàn Quốc" (ID: 81594788917102)',
  },
  {
    time: "14:26:55",
    thread: "Thread-01",
    color: "text-emerald-400",
    message: "Tìm thấy 50 bài viết mới đăng trong 7 ngày. Bắt đầu trích xuất tương tác...",
  },
  {
    time: "14:27:01",
    thread: "Thread-01",
    color: "text-slate-300",
    message: "PostID 89123891: Đã bóc tách tương tác [1.250 Likes - 342 Comments - 85 Shares] -> Lưu cơ sở dữ liệu",
  },
  {
    time: "14:27:06",
    thread: "Thread-01",
    color: "text-slate-300",
    message: "PostID 78100234: Đã bóc tách tương tác [890 Likes - 512 Comments - 142 Shares] -> Lưu cơ sở dữ liệu",
  },
  {
    time: "14:27:14",
    thread: "Thread-01",
    color: "text-emerald-400",
    message: "Đạt mốc 50 bài/tài khoản. Tiến hành chuyển đổi tài khoản theo quy chuẩn cấu hình",
  },
  {
    time: "14:27:18",
    thread: "Thread-01",
    color: "text-cyan-400",
    message: "Đang nghỉ 5 giây ngẫu nhiên trước khi chuyển sang nhóm tiếp theo...",
  },
];

export default function GroupScanPostsPage() {
  // Accounts State
  const [accountsModalOpen, setAccountsModalOpen] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [moduleAccounts, setModuleAccounts] = useState(DEFAULT_SCAN_ACCOUNTS);
  const [selectedUids, setSelectedUids] = useState(
    DEFAULT_SCAN_ACCOUNTS.map((a) => a.uid)
  );

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
      const list = rawList.length > 0 ? rawList.map(normalizeAccount) : DEFAULT_SCAN_ACCOUNTS;
      setModuleAccounts(list);
      setSelectedUids((current) => {
        const readyUids = list.filter(isScanReady).map((acc) => acc.uid);
        const kept = current.filter((uid) => readyUids.includes(uid));
        if (kept.length > 0) return kept;
        if (readyUids.length > 0) return readyUids.slice(0, 5);
        return list.slice(0, 5).map((a) => a.uid);
      });
    } catch {
      setModuleAccounts(DEFAULT_SCAN_ACCOUNTS);
      setSelectedUids(DEFAULT_SCAN_ACCOUNTS.map((a) => a.uid));
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    getScanAccounts()
      .then((res) => {
        if (ignore) return;
        const rawList = Array.isArray(res)
          ? res
          : Array.isArray(res?.accounts)
          ? res.accounts
          : Array.isArray(res?.data)
          ? res.data
          : [];
        const list = rawList.length > 0 ? rawList.map(normalizeAccount) : DEFAULT_SCAN_ACCOUNTS;
        setModuleAccounts(list);
        setSelectedUids((current) => {
          const readyUids = list.filter(isScanReady).map((acc) => acc.uid);
          const kept = current.filter((uid) => readyUids.includes(uid));
          if (kept.length > 0) return kept;
          if (readyUids.length > 0) return readyUids.slice(0, 5);
          return list.slice(0, 5).map((a) => a.uid);
        });
      })
      .catch(() => {
        if (ignore) return;
        setModuleAccounts(DEFAULT_SCAN_ACCOUNTS);
        setSelectedUids(DEFAULT_SCAN_ACCOUNTS.map((a) => a.uid));
      });
    return () => {
      ignore = true;
    };
  }, []);

  const selectedAccountNames = useMemo(() => {
    return moduleAccounts
      .filter((a) => selectedUids.includes(a.uid))
      .map((a) => a.profile_name || a.uid)
      .join(", ");
  }, [moduleAccounts, selectedUids]);

  // Group selection state
  const [selectedGroups, setSelectedGroups] = useState(INITIAL_SELECTED_GROUPS);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);

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
  const [selectedCategory, setSelectedCategory] = useState("cat-1");
  const [categorySearch, setCategorySearch] = useState("");
  const [postSearch, setPostSearch] = useState("");
  const [minLikeFilter, setMinLikeFilter] = useState("100");
  const [minCmtFilter, setMinCmtFilter] = useState("20");
  const [minShareFilter, setMinShareFilter] = useState("10");
  const [sortOption, setSortOption] = useState("highest_interaction");

  const [selectedPostIds, setSelectedPostIds] = useState(new Set());
  const [currentPage, setCurrentPage] = useState(1);

  // Execution & Logs
  const [isExecuting, setIsExecuting] = useState(false);
  const [logs, setLogs] = useState(INITIAL_LOGS);
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
    if (!categorySearch.trim()) return CATEGORIES_DATA;
    return CATEGORIES_DATA.filter((c) =>
      c.fullName.toLowerCase().includes(categorySearch.toLowerCase())
    );
  }, [categorySearch]);

  // Filter Posts
  const filteredPosts = useMemo(() => {
    return INITIAL_POSTS.filter((p) => {
      const matchQuery =
        !postSearch.trim() ||
        p.content.toLowerCase().includes(postSearch.toLowerCase()) ||
        p.authorName.toLowerCase().includes(postSearch.toLowerCase()) ||
        p.linkText.includes(postSearch.trim());
      const matchLike = !minLikeFilter || p.likes >= Number(minLikeFilter);
      const matchCmt = !minCmtFilter || p.comments >= Number(minCmtFilter);
      const matchShare = !minShareFilter || p.shares >= Number(minShareFilter);
      return matchQuery && matchLike && matchCmt && matchShare;
    });
  }, [postSearch, minLikeFilter, minCmtFilter, minShareFilter]);

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
    const curCat = CATEGORIES_DATA.find((c) => c.id === selectedCategory);
    toast.success(`Đang xuất bài viết của nhóm: ${curCat?.fullName || "nhóm đang chọn"}...`);
  };

  const currentCategoryData =
    CATEGORIES_DATA.find((c) => c.id === selectedCategory) || CATEGORIES_DATA[0];

  return (
    <div className="-m-6 min-h-full space-y-5 bg-[#F4F7FC] p-6">
      <div className="space-y-5">
        {/* =======================================================
            SECTION 1 & SECTION 2: 2 Column Configuration Grids
        ======================================================= */}
        <div className="grid items-start gap-5 xl:grid-cols-2">
          {/* Card 1: Cấu hình chung & Chọn tài khoản/nhóm */}
          <section className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-4">
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
                      Đã chọn: <strong className="text-emerald-950">{selectedGroups.length} nhóm</strong>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Card 2: Cấu hình quét nâng cao & Giới hạn */}
          <section className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-4">
            <div className="flex items-center gap-2.5 pb-3 border-b border-[#F1F5F9]">
              <span className="flex size-6 items-center justify-center rounded-full bg-[#1877F2] text-[11px] font-bold text-white shrink-0">
                2
              </span>
              <h2 className="text-sm font-bold text-[#0B1C30]">
                Cấu hình quét nâng cao & Giới hạn
              </h2>
            </div>

            <div className="space-y-3.5">
              {/* Cài đặt khoảng cách quét */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#334155]">
                  Khoảng cách giữa các lần quét:
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#64748B]">Từ</span>
                  <div className="flex items-center rounded-lg border border-[#CBD5E1] bg-white h-7">
                    <button
                      type="button"
                      onClick={() => setMinDelay((v) => Math.max(1, v - 1))}
                      className="w-5 h-full flex items-center justify-center text-xs text-[#475569] bg-[#F1F5F9] hover:bg-slate-200 rounded-l-lg font-medium"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      value={minDelay}
                      onChange={(e) => setMinDelay(Number(e.target.value) || 1)}
                      className="w-8 text-center text-xs font-medium text-[#475569] bg-transparent outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setMinDelay((v) => v + 1)}
                      className="w-5 h-full flex items-center justify-center text-xs text-[#475569] bg-[#F1F5F9] hover:bg-slate-200 rounded-r-lg font-medium"
                    >
                      +
                    </button>
                  </div>

                  <span className="text-xs text-[#64748B]">-</span>

                  <div className="flex items-center rounded-lg border border-[#CBD5E1] bg-white h-7">
                    <button
                      type="button"
                      onClick={() => setMaxDelay((v) => Math.max(minDelay, v - 1))}
                      className="w-5 h-full flex items-center justify-center text-xs text-[#475569] bg-[#F1F5F9] hover:bg-slate-200 rounded-l-lg font-medium"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      value={maxDelay}
                      onChange={(e) => setMaxDelay(Number(e.target.value) || minDelay)}
                      className="w-8 text-center text-xs font-medium text-[#475569] bg-transparent outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setMaxDelay((v) => v + 1)}
                      className="w-5 h-full flex items-center justify-center text-xs text-[#475569] bg-[#F1F5F9] hover:bg-slate-200 rounded-r-lg font-medium"
                    >
                      +
                    </button>
                  </div>

                  <span className="text-xs text-[#64748B]">giây</span>
                </div>
              </div>

              {/* Giới hạn đổi tài khoản */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#334155]">
                  Đổi tài khoản mới khi quét được:
                </span>
                <div className="flex items-center gap-2">
                  <div className="flex items-center rounded-lg border border-[#CBD5E1] bg-white h-7">
                    <button
                      type="button"
                      onClick={() => setSwitchAccThreshold((v) => Math.max(5, v - 5))}
                      className="w-5 h-full flex items-center justify-center text-xs text-[#475569] bg-[#F1F5F9] hover:bg-slate-200 rounded-l-lg font-medium"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      value={switchAccThreshold}
                      onChange={(e) => setSwitchAccThreshold(Number(e.target.value) || 10)}
                      className="w-10 text-center text-xs font-medium text-[#1E293B] bg-transparent outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setSwitchAccThreshold((v) => v + 5)}
                      className="w-5 h-full flex items-center justify-center text-xs text-[#475569] bg-[#F1F5F9] hover:bg-slate-200 rounded-r-lg font-medium"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-xs text-[#64748B]">bài / nick</span>
                </div>
              </div>

              {/* Giới hạn bài mỗi nhóm */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#334155]">
                  Mỗi nhóm quét tối đa:
                </span>
                <div className="flex items-center gap-2">
                  <div className="flex items-center rounded-lg border border-[#CBD5E1] bg-white h-7">
                    <button
                      type="button"
                      onClick={() => setPostsPerGroupLimit((v) => Math.max(10, v - 10))}
                      className="w-5 h-full flex items-center justify-center text-xs text-[#475569] bg-[#F1F5F9] hover:bg-slate-200 rounded-l-lg font-medium"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      value={postsPerGroupLimit}
                      onChange={(e) => setPostsPerGroupLimit(Number(e.target.value) || 10)}
                      className="w-10 text-center text-xs font-medium text-[#1E293B] bg-transparent outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setPostsPerGroupLimit((v) => v + 10)}
                      className="w-5 h-full flex items-center justify-center text-xs text-[#475569] bg-[#F1F5F9] hover:bg-slate-200 rounded-r-lg font-medium"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-xs text-[#64748B]">bài mới nhất</span>
                </div>
              </div>

              {/* Checkboxes Group */}
              <div className="space-y-2 pt-1 border-t border-[#F1F5F9]">
                <div className="flex items-center gap-2">
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
                  <input
                    type="number"
                    disabled={!filterDaysEnabled}
                    value={filterDays}
                    onChange={(e) => setFilterDays(Number(e.target.value) || 1)}
                    className="w-12 h-6 rounded border border-[#CBD5E1] text-center text-xs font-medium text-[#1E293B] outline-none disabled:bg-slate-100"
                  />
                  <span className="text-xs text-[#64748B]">ngày qua</span>
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
                {selectedGroups.map((group, idx) => (
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
                ))}
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
                1.420 Bài viết
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
            {/* Cột trái: Danh mục nhóm (4) */}
            <div className="lg:col-span-4 p-4 bg-[#F8FAFC]/50 border-r border-[#E2E8F0] flex flex-col gap-3">
              <span className="text-[11px] font-bold uppercase tracking-wide text-[#334155]">
                DANH MỤC NHÓM ({CATEGORIES_DATA.length})
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
                {filteredCategories.map((cat) => {
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
                })}
              </div>
            </div>

            {/* Cột phải: Bảng bài viết & Bộ lọc Like, Comment, Share */}
            <div className="lg:col-span-8 p-4 flex flex-col gap-3.5 min-w-0">
              {/* Group Header Info */}
              <div className="flex flex-wrap justify-between items-center pb-3 border-b border-[#F1F5F9] gap-2">
                <div className="flex flex-col gap-0.5">
                  <h4 className="font-bold text-sm text-[#0F172A]">
                    {currentCategoryData.fullName}
                  </h4>
                  <div className="flex items-center gap-2 text-xs text-[#64748B]">
                    <span>Quy mô: 258.724 Thành viên</span>
                    <span>•</span>
                    <span className="text-[#059669] font-medium">Group Public</span>
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

                  <select
                    value={minLikeFilter}
                    onChange={(e) => setMinLikeFilter(e.target.value)}
                    className="h-7 px-2.5 border border-[#E2E8F0] bg-white rounded-lg text-xs font-medium text-[#334155] outline-none"
                  >
                    <option value="0">Tất cả like</option>
                    <option value="50">&gt; 50 like</option>
                    <option value="100">&gt; 100 like</option>
                    <option value="500">&gt; 500 like</option>
                  </select>

                  <select
                    value={minCmtFilter}
                    onChange={(e) => setMinCmtFilter(e.target.value)}
                    className="h-7 px-2.5 border border-[#E2E8F0] bg-white rounded-lg text-xs font-medium text-[#334155] outline-none"
                  >
                    <option value="0">Tất cả cmt</option>
                    <option value="10">&gt; 10 cmt</option>
                    <option value="20">&gt; 20 cmt</option>
                    <option value="50">&gt; 50 cmt</option>
                  </select>

                  <select
                    value={minShareFilter}
                    onChange={(e) => setMinShareFilter(e.target.value)}
                    className="h-7 px-2.5 border border-[#E2E8F0] bg-white rounded-lg text-xs font-medium text-[#334155] outline-none"
                  >
                    <option value="0">Tất cả share</option>
                    <option value="5">&gt; 5 share</option>
                    <option value="10">&gt; 10 share</option>
                    <option value="50">&gt; 50 share</option>
                  </select>
                </div>

                {/* Sorting and Actions */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/60">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-[#64748B] flex items-center gap-1">
                      <Filter className="size-3 text-[#94A3B8]" />
                      Sắp xếp:
                    </span>
                    <select
                      value={sortOption}
                      onChange={(e) => setSortOption(e.target.value)}
                      className="h-7 px-2.5 border border-[#E2E8F0] bg-white rounded-lg text-xs font-semibold text-[#334155] outline-none"
                    >
                      <option value="highest_interaction">Tương tác cao nhất</option>
                      <option value="latest">Mới nhất</option>
                      <option value="most_likes">Nhiều like nhất</option>
                      <option value="most_comments">Nhiều bình luận nhất</option>
                    </select>
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
                    {filteredPosts.map((post) => {
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
                              {post.likesStr}
                            </span>
                          </td>
                          <td className="py-2.5 px-2 text-center">
                            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-[#ECFDF5] border border-[#D1FAE5] font-bold text-xs text-[#047857]">
                              {post.comments}
                            </span>
                          </td>
                          <td className="py-2.5 px-2 text-center">
                            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-[#FFFBEB] border border-[#FEF3C7] font-bold text-xs text-[#B45309]">
                              {post.shares}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-[11px] text-[#64748B]">
                            {post.postedTime}
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
                    })}
                  </tbody>
                </table>
              </div>

              {/* Phân trang */}
              <div className="flex flex-row justify-between items-center w-full pt-1">
                <span className="text-xs text-[#64748B]">
                  Hiển thị 1 - {filteredPosts.length} của 1.420 bài viết
                </span>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="size-7 flex items-center justify-center border border-[#E2E8F0] rounded text-xs font-semibold text-[#64748B] hover:bg-slate-100"
                  >
                    &lt;
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentPage(1)}
                    className={`size-7 flex items-center justify-center rounded text-xs font-semibold ${
                      currentPage === 1 ? "bg-[#1877F2] text-white" : "border border-[#E2E8F0] text-[#64748B] hover:bg-slate-100"
                    }`}
                  >
                    1
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentPage(2)}
                    className={`size-7 flex items-center justify-center rounded text-xs font-semibold ${
                      currentPage === 2 ? "bg-[#1877F2] text-white" : "border border-[#E2E8F0] text-[#64748B] hover:bg-slate-100"
                    }`}
                  >
                    2
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentPage(3)}
                    className={`size-7 flex items-center justify-center rounded text-xs font-semibold ${
                      currentPage === 3 ? "bg-[#1877F2] text-white" : "border border-[#E2E8F0] text-[#64748B] hover:bg-slate-100"
                    }`}
                  >
                    3
                  </button>
                  <span className="px-1 text-xs font-semibold text-[#94A3B8]">...</span>
                  <button
                    type="button"
                    onClick={() => setCurrentPage(142)}
                    className={`size-7 flex items-center justify-center rounded text-xs font-semibold ${
                      currentPage === 142 ? "bg-[#1877F2] text-white" : "border border-[#E2E8F0] text-[#64748B] hover:bg-slate-100"
                    }`}
                  >
                    142
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => p + 1)}
                    className="size-7 flex items-center justify-center border border-[#E2E8F0] rounded text-xs font-semibold text-[#64748B] hover:bg-slate-100"
                  >
                    &gt;
                  </button>
                </div>
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
      </div>

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
      {groupPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b pb-3 border-slate-100">
              <h3 className="font-bold text-base text-slate-800 flex items-center gap-2">
                <Globe className="size-5 text-blue-600" />
                Chọn nhóm muốn quét
              </h3>
              <button
                type="button"
                onClick={() => setGroupPickerOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="size-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Đang có {selectedGroups.length} nhóm được chọn để thực thi quét bài viết.
            </p>

            <div className="max-h-60 overflow-y-auto space-y-2">
              {selectedGroups.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center justify-between p-2.5 border rounded-lg bg-slate-50"
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`size-7 rounded ${g.tagBg} ${g.tagText} flex items-center justify-center text-xs font-bold`}>
                      {g.tag}
                    </span>
                    <div>
                      <p className="text-xs font-bold text-slate-800">{g.name}</p>
                      <p className="text-[11px] text-slate-400">ID: {g.uid} • {g.members}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveGroup(g.id)}
                    className="text-slate-400 hover:text-rose-600 p-1"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setGroupPickerOpen(false)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold"
              >
                Hoàn tất
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
