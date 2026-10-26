"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Users,
  Plus,
  Minus,
  Trash2,
  Play,
  Pause,
  Square,
  Download,
  Search,
  ExternalLink,
  Terminal,
  RefreshCw,
  FileSpreadsheet,
  SlidersHorizontal,
  Eye,
  X,
  ThumbsUp,
  MessageSquare,
  Share2,
  Calendar,
} from "lucide-react";
import { getAccounts } from "@/modules/module_02_account_manager/service";
import {
  DEFAULT_SCANNED_PAGES,
  SelectAccountsModal,
  SelectPagesModal,
} from "../shared/SelectPagesModal";

const INITIAL_POST_PAGES = [
  {
    id: "1000894123991",
    page_id: "1000894123991",
    name: "Nội Thất Cao Cấp Sài Gòn",
    category: "Nội thất & Thiết kế",
    followers_text: "324.500",
    followers_count: 324500,
    posts_count: 184,
    status: "RUNNING",
    status_label: "Đang thu thập...",
    avatar_initials: "NT",
    avatar_color: "bg-indigo-100 text-indigo-700",
  },
  {
    id: "1000648291042",
    page_id: "1000648291042",
    name: "Faslink Vietnam",
    category: "Thương hiệu Thời trang",
    followers_text: "185.200",
    followers_count: 185200,
    posts_count: 112,
    status: "DONE",
    status_label: "Hoàn tất quét",
    avatar_initials: "FV",
    avatar_color: "bg-emerald-100 text-emerald-700",
  },
  {
    id: "1000512398401",
    page_id: "1000512398401",
    name: "Gia Dụng Thông Minh Store",
    category: "Mua sắm & Bán lẻ",
    followers_text: "412.000",
    followers_count: 412000,
    posts_count: 78,
    status: "QUEUE",
    status_label: "Đang chờ hàng đợi",
    avatar_initials: "GD",
    avatar_color: "bg-amber-100 text-amber-700",
  },
  {
    id: "1000938271654",
    page_id: "1000938271654",
    name: "Thế Giới Skincare Chính Hãng",
    category: "Sức khỏe / Sắc đẹp",
    followers_text: "260.800",
    followers_count: 260800,
    posts_count: 54,
    status: "DONE",
    status_label: "Hoàn tất quét",
    avatar_initials: "SK",
    avatar_color: "bg-pink-100 text-pink-700",
  },
  {
    id: "1000772819203",
    page_id: "1000772819203",
    name: "Bất Động Sản Khu Đông TP.HCM",
    category: "Bất động sản",
    followers_text: "98.400",
    followers_count: 98400,
    posts_count: 34,
    status: "DONE",
    status_label: "Hoàn tất quét",
    avatar_initials: "BĐ",
    avatar_color: "bg-blue-100 text-blue-700",
  },
];

const INITIAL_POSTS_BY_PAGE = {
  "1000894123991": [
    {
      id: "p_991823741",
      content:
        "[SIÊU SALE CUỐI TUẦN] Giảm ngay 35% trọn bộ Sofa Da Bò Ý nhập khẩu cao cấp. Bảo hành 10 năm khung sườn, miễn phí giao hàng nội thành TP.HCM! #NoiThatCaoCap #SofaDaBo #SaleNoiThat",
      post_url: "fb.com/1000894123991/posts/991823741",
      published_date: "26/10/2026",
      published_time: "14:20",
      days_ago: 0,
      likes: 1245,
      comments: 342,
      shares: 89,
    },
    {
      id: "p_991823610",
      content:
        "Bàn giao hoàn thiện căn hộ Penthouse 240m2 tại Thủ Thiêm River Park. Phong cách Modern Luxury tinh tế từng đường nét, thiết kế độc bản theo gu gia chủ. Inbox nhận báo giá thiết kế 3D!",
      post_url: "fb.com/1000894123991/posts/991823610",
      published_date: "25/10/2026",
      published_time: "09:15",
      days_ago: 1,
      likes: 856,
      comments: 194,
      shares: 45,
    },
    {
      id: "p_991823402",
      content:
        "Bàn ăn mặt đá Ceramic chống trầy xước, chống thấm ố tuyệt đối kết hợp 6 ghế bọc da Microfiber êm ái. Chỉ còn 5 bộ giá ưu đãi trải nghiệm tại Showroom Quận 7!",
      post_url: "fb.com/1000894123991/posts/991823402",
      published_date: "24/10/2026",
      published_time: "19:45",
      days_ago: 2,
      likes: 530,
      comments: 118,
      shares: 27,
    },
    {
      id: "p_991823118",
      content:
        "Tổng hợp 25+ mẫu phòng ngủ Master chuẩn khách sạn 5 sao xu hướng 2026. Tặng ngay gói tư vấn phong thủy và khảo sát thực tế trị giá 5.000.000đ khi đăng ký trong tuần này.",
      post_url: "fb.com/1000894123991/posts/991823118",
      published_date: "22/10/2026",
      published_time: "11:30",
      days_ago: 4,
      likes: 2140,
      comments: 615,
      shares: 312,
    },
    {
      id: "p_991822905",
      content:
        "Xưởng sản xuất trực tiếp rộng 5.000m2 không qua trung gian - Cam kết chuẩn gỗ An Cường 100%, đền gấp đôi nếu phát hiện pha trộn ván kém chất lượng. Hotline: 0909.888.777",
      post_url: "fb.com/1000894123991/posts/991822905",
      published_date: "20/10/2026",
      published_time: "16:05",
      days_ago: 6,
      likes: 412,
      comments: 67,
      shares: 19,
    },
  ],
  "1000648291042": [
    {
      id: "p_882716101",
      content:
        "Ra mắt BST Áo Sơ Mi Sợi Tre Kháng Khuẩn Thu Đông 2026 - Chống nhăn tự nhiên, thoáng khí gấp 3 lần cotton thông thường. Mua 2 tặng 1 trên toàn hệ thống showroom Faslink!",
      post_url: "fb.com/1000648291042/posts/882716101",
      published_date: "26/10/2026",
      published_time: "10:00",
      days_ago: 0,
      likes: 940,
      comments: 215,
      shares: 64,
    },
    {
      id: "p_882715890",
      content:
        "Đồng phục doanh nghiệp xanh bền vững từ sợi Cafe & Sen: Giải pháp nâng tầm thương hiệu chuẩn ESG cho hơn 500 tập đoàn hàng đầu Việt Nam.",
      post_url: "fb.com/1000648291042/posts/882715890",
      published_date: "23/10/2026",
      published_time: "15:30",
      days_ago: 3,
      likes: 620,
      comments: 88,
      shares: 51,
    },
  ],
};

function exportPostsToCsv(posts, filename = "ket_qua_quet_bai_viet_fanpage.csv") {
  const headers = [
    "STT",
    "ID Bài Viết",
    "Nội dung bài viết",
    "Link Post",
    "Ngày đăng",
    "Giờ đăng",
    "Lượt Like",
    "Bình luận",
    "Chia sẻ",
  ];
  const rows = posts.map((p, idx) => [
    idx + 1,
    p.id,
    `"${(p.content || "").replace(/"/g, '""')}"`,
    `https://${p.post_url}`,
    p.published_date,
    p.published_time,
    p.likes,
    p.comments,
    p.shares,
  ]);
  const csv = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export default function PageScannerPosts() {
  // Accounts & Pages Selection
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState([
    "100089234101",
    "100045612890",
    "100099887766",
  ]);
  const [showAccountModal, setShowAccountModal] = useState(false);

  const [selectedPages, setSelectedPages] = useState(INITIAL_POST_PAGES);
  const [showSelectPagesModal, setShowSelectPagesModal] = useState(false);

  // Card 1 & Card 2 Settings
  const [delayMin, setDelayMin] = useState(5);
  const [delayMax, setDelayMax] = useState(10);
  const [autoRotateOnCheckpoint, setAutoRotateOnCheckpoint] = useState(true);

  const [postsPerAccountSwitch, setPostsPerAccountSwitch] = useState(50);
  const [maxPostsPerPage, setMaxPostsPerPage] = useState(100);
  const [onlyRecentDays, setOnlyRecentDays] = useState(true);
  const [recentDaysLimit, setRecentDaysLimit] = useState(7);
  const [skipPinnedPosts, setSkipPinnedPosts] = useState(true);
  const [deduplicatePosts, setDeduplicatePosts] = useState(true);

  // Execution state
  const [scanState, setScanState] = useState("IDLE"); // IDLE | RUNNING | PAUSED
  const [postsByPage, setPostsByPage] = useState(INITIAL_POSTS_BY_PAGE);
  const [activePageId, setActivePageId] = useState("1000894123991");
  const [sidebarSearch, setSidebarSearch] = useState("");

  // Filters & Selection in right table
  const [postSearch, setPostSearch] = useState("");
  const [sortBy, setSortBy] = useState("NEWEST");
  const [dateFilter, setDateFilter] = useState("ALL");
  const [likeFilter, setLikeFilter] = useState("ALL");
  const [commentFilter, setCommentFilter] = useState("ALL");
  const [shareFilter, setShareFilter] = useState("ALL");
  const [selectedPostIds, setSelectedPostIds] = useState([]);
  const [previewPost, setPreviewPost] = useState(null);

  // Console logs
  const [logs, setLogs] = useState([
    {
      time: "14:38:10",
      tag: "SYS",
      color: "text-blue-400",
      text: "Khởi tạo tiến trình Quét Bài Viết Fanpage (5 page mục tiêu, 3 tài khoản khả dụng).",
    },
    {
      time: "14:38:16",
      tag: "SCAN",
      color: "text-emerald-400",
      text: "[1000894123991] Nội Thất Cao Cấp Sài Gòn -> Đã bóc tách 184 bài viết (Bỏ qua 2 bài ghim Admin).",
    },
    {
      time: "14:38:28",
      tag: "INFO",
      color: "text-amber-400",
      text: "[1000648291042] Faslink Vietnam -> Hoàn tất thu thập 112 bài viết mới nhất trong 7 ngày qua.",
    },
    {
      time: "14:38:34",
      tag: "WAIT",
      color: "text-purple-400",
      text: "Đang nghỉ ngẫu nhiên 7s trước khi chuyển sang luồng quét tiếp theo...",
    },
  ]);

  const timerRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    getAccounts()
      .then((res) => {
        if (!mounted) return;
        const list = Array.isArray(res?.accounts)
          ? res.accounts
          : Array.isArray(res)
            ? res
            : [];
        if (list.length > 0) {
          setAccounts(list);
          setSelectedAccountIds(list.slice(0, 3).map((a) => String(a.id)));
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const appendLog = (tag, color, text) => {
    const now = new Date().toTimeString().slice(0, 8);
    setLogs((prev) => [...prev.slice(-60), { time: now, tag, color, text }]);
  };

  const handleStartScan = () => {
    if (selectedPages.length === 0) return;
    setScanState("RUNNING");
    appendLog(
      "START",
      "text-emerald-400",
      `Bắt đầu quét bài viết cho ${selectedPages.length} Fanpage (Giới hạn ${maxPostsPerPage} bài/page, delay ${delayMin}-${delayMax}s).`
    );

    if (timerRef.current) clearInterval(timerRef.current);
    let step = 0;
    timerRef.current = setInterval(() => {
      step += 1;
      const targetPage = selectedPages[step % selectedPages.length];
      if (!targetPage) return;

      const newPostId = `p_${Math.floor(100000000 + Math.random() * 899999999)}`;
      const likes = Math.floor(120 + Math.random() * 1900);
      const comments = Math.floor(25 + Math.random() * 450);
      const shares = Math.floor(10 + Math.random() * 180);
      const now = new Date();
      const dateStr = now.toLocaleDateString("vi-VN");
      const timeStr = now.toTimeString().slice(0, 5);

      const samplePost = {
        id: newPostId,
        content: `[CẬP NHẬT MỚI #${step}] Tổng hợp ưu đãi đặc quyền tại ${targetPage.name} — Đặt hàng trực tiếp nhận ngay voucher giảm 25% hôm nay! #HotDeal #FanpageUpdate`,
        post_url: `fb.com/${targetPage.page_id || targetPage.id}/posts/${newPostId.replace("p_", "")}`,
        published_date: dateStr,
        published_time: timeStr,
        days_ago: 0,
        likes,
        comments,
        shares,
      };

      setPostsByPage((prev) => {
        const key = targetPage.page_id || targetPage.id;
        const current = prev[key] || [];
        return {
          ...prev,
          [key]: [samplePost, ...current],
        };
      });

      setSelectedPages((prev) =>
        prev.map((p) =>
          (p.page_id || p.id) === (targetPage.page_id || targetPage.id)
            ? {
                ...p,
                posts_count: (p.posts_count || 0) + 1,
                status: "RUNNING",
                status_label: "Đang thu thập...",
              }
            : p
        )
      );

      appendLog(
        "POST",
        "text-emerald-400",
        `[${targetPage.name}] Thu thập bài viết ${newPostId} (${likes} Likes, ${comments} Comments, ${shares} Shares).`
      );
    }, 2600);
  };

  const handlePauseScan = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setScanState("PAUSED");
    appendLog("PAUSE", "text-amber-400", "Đã tạm dừng tiến trình quét bài viết Fanpage.");
  };

  const handleStopScan = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setScanState("IDLE");
    appendLog("STOP", "text-rose-400", "Đã dừng khẩn cấp toàn bộ luồng quét bài viết.");
  };

  const handleRemovePreviewPage = (id) => {
    setSelectedPages((prev) => prev.filter((p) => (p.page_id || p.id) !== id));
  };

  const filteredSidebarPages = useMemo(() => {
    const q = sidebarSearch.trim().toLowerCase();
    if (!q) return selectedPages;
    return selectedPages.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        String(p.page_id || p.id).toLowerCase().includes(q)
    );
  }, [selectedPages, sidebarSearch]);

  const activePage = useMemo(() => {
    return (
      selectedPages.find((p) => String(p.page_id || p.id) === String(activePageId)) ||
      selectedPages[0] ||
      INITIAL_POST_PAGES[0]
    );
  }, [selectedPages, activePageId]);

  const currentPosts = useMemo(() => {
    const key = activePage?.page_id || activePage?.id;
    const raw = postsByPage[key] || INITIAL_POSTS_BY_PAGE["1000894123991"] || [];
    const q = postSearch.trim().toLowerCase();

    let list = raw.filter((item) => {
      if (
        q &&
        !item.content.toLowerCase().includes(q) &&
        !item.post_url.toLowerCase().includes(q) &&
        !item.id.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (dateFilter === "TODAY" && item.days_ago > 0) return false;
      if (dateFilter === "3DAYS" && item.days_ago > 3) return false;
      if (dateFilter === "7DAYS" && item.days_ago > 7) return false;

      if (likeFilter === "GT_500" && item.likes < 500) return false;
      if (likeFilter === "GT_1000" && item.likes < 1000) return false;

      if (commentFilter === "GT_100" && item.comments < 100) return false;
      if (commentFilter === "GT_300" && item.comments < 300) return false;

      if (shareFilter === "GT_50" && item.shares < 50) return false;
      if (shareFilter === "GT_100" && item.shares < 100) return false;

      return true;
    });

    if (sortBy === "LIKES_DESC") {
      list = [...list].sort((a, b) => b.likes - a.likes);
    } else if (sortBy === "COMMENTS_DESC") {
      list = [...list].sort((a, b) => b.comments - a.comments);
    } else {
      list = [...list].sort((a, b) => a.days_ago - b.days_ago);
    }

    return list;
  }, [
    activePage,
    postsByPage,
    postSearch,
    dateFilter,
    likeFilter,
    commentFilter,
    shareFilter,
    sortBy,
  ]);

  const totalPostsCount = useMemo(() => {
    return selectedPages.reduce((sum, p) => sum + (Number(p.posts_count) || 0), 0);
  }, [selectedPages]);

  const togglePostSelect = (postId) => {
    setSelectedPostIds((prev) =>
      prev.includes(postId) ? prev.filter((id) => id !== postId) : [...prev, postId]
    );
  };

  const toggleSelectAllPosts = () => {
    if (
      currentPosts.length > 0 &&
      currentPosts.every((p) => selectedPostIds.includes(p.id))
    ) {
      setSelectedPostIds([]);
    } else {
      setSelectedPostIds(currentPosts.map((p) => p.id));
    }
  };

  return (
    <div className="space-y-5 pb-10">
      {/* Top 2 Configuration Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Card 1: Cấu hình chung, Chọn tài khoản & Nhóm quét */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-5">
          <div className="flex items-center gap-2.5 pb-3.5 mb-4 border-b border-slate-100">
            <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
              1
            </span>
            <h2 className="text-[15px] font-bold text-slate-800">
              Cấu hình chung, Chọn tài khoản &amp; Nhóm quét
            </h2>
          </div>

          <div className="space-y-4">
            {/* Row 1: Chọn tài khoản */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-600">
                Tài khoản Facebook thực thi:
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAccountModal(true)}
                  className="px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50/70 hover:bg-blue-100 text-blue-700 text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Users className="w-3.5 h-3.5" />
                  Chọn tài khoản
                </button>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Đã chọn: {selectedAccountIds.length} / {Math.max(accounts.length, 4)} tài khoản
                </span>
              </div>
            </div>

            {/* Row 2: Danh sách nhóm mục tiêu */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-600">
                Danh sách nhóm mục tiêu:
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowSelectPagesModal(true)}
                  className="px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50/70 hover:bg-blue-100 text-blue-700 text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  Chọn page muốn quét
                </button>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Đã chọn: {selectedPages.length} page
                </span>
              </div>
            </div>

            {/* Row 3: Khoảng cách giữa các lần quét */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-xs font-semibold text-slate-600">
                Khoảng cách giữa các lần quét:
              </span>
              <div className="flex items-center gap-2 text-xs text-slate-700 font-semibold">
                <span>Từ</span>
                <div className="inline-flex items-center border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
                  <button
                    type="button"
                    onClick={() => setDelayMin((v) => Math.max(1, v - 1))}
                    className="px-2 py-1 hover:bg-slate-200/70 text-slate-600 cursor-pointer"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <input
                    type="number"
                    value={delayMin}
                    onChange={(e) => setDelayMin(Math.max(1, Number(e.target.value) || 1))}
                    className="w-10 text-center bg-white py-1 text-xs font-bold text-slate-800 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setDelayMin((v) => v + 1)}
                    className="px-2 py-1 hover:bg-slate-200/70 text-slate-600 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                <span>-</span>
                <div className="inline-flex items-center border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
                  <button
                    type="button"
                    onClick={() => setDelayMax((v) => Math.max(delayMin, v - 1))}
                    className="px-2 py-1 hover:bg-slate-200/70 text-slate-600 cursor-pointer"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <input
                    type="number"
                    value={delayMax}
                    onChange={(e) =>
                      setDelayMax(Math.max(delayMin, Number(e.target.value) || delayMin))
                    }
                    className="w-10 text-center bg-white py-1 text-xs font-bold text-slate-800 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setDelayMax((v) => v + 1)}
                    className="px-2 py-1 hover:bg-slate-200/70 text-slate-600 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                <span className="text-slate-500">giây</span>
              </div>
            </div>

            {/* Row 4: Checkbox */}
            <label className="flex items-center gap-2.5 pt-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoRotateOnCheckpoint}
                onChange={(e) => setAutoRotateOnCheckpoint(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-xs font-medium text-slate-700">
                Tự động đảo tài khoản khi bị checkpoint hoặc rate limit
              </span>
            </label>
          </div>
        </div>

        {/* Card 2: Cấu hình quét nâng cao & Giới hạn */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-5">
          <div className="flex items-center gap-2.5 pb-3.5 mb-4 border-b border-slate-100">
            <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
              2
            </span>
            <h2 className="text-[15px] font-bold text-slate-800">
              Cấu hình quét nâng cao &amp; Giới hạn
            </h2>
          </div>

          <div className="space-y-3.5">
            {/* Đổi tài khoản mới khi quét được */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-600">
                Đổi tài khoản mới khi quét được:
              </span>
              <div className="flex items-center gap-2">
                <div className="inline-flex items-center border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
                  <button
                    type="button"
                    onClick={() => setPostsPerAccountSwitch((v) => Math.max(10, v - 10))}
                    className="px-2 py-1 hover:bg-slate-200/70 text-slate-600 cursor-pointer"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <input
                    type="number"
                    value={postsPerAccountSwitch}
                    onChange={(e) =>
                      setPostsPerAccountSwitch(Math.max(1, Number(e.target.value) || 50))
                    }
                    className="w-14 text-center bg-white py-1 text-xs font-bold text-slate-800 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setPostsPerAccountSwitch((v) => v + 10)}
                    className="px-2 py-1 hover:bg-slate-200/70 text-slate-600 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                <span className="text-xs font-semibold text-slate-500">bài / nick</span>
              </div>
            </div>

            {/* Mỗi page quét tối đa */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-600">
                Mỗi page quét tối đa:
              </span>
              <div className="flex items-center gap-2">
                <div className="inline-flex items-center border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
                  <button
                    type="button"
                    onClick={() => setMaxPostsPerPage((v) => Math.max(10, v - 10))}
                    className="px-2 py-1 hover:bg-slate-200/70 text-slate-600 cursor-pointer"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <input
                    type="number"
                    value={maxPostsPerPage}
                    onChange={(e) =>
                      setMaxPostsPerPage(Math.max(1, Number(e.target.value) || 100))
                    }
                    className="w-14 text-center bg-white py-1 text-xs font-bold text-slate-800 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setMaxPostsPerPage((v) => v + 10)}
                    className="px-2 py-1 hover:bg-slate-200/70 text-slate-600 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                <span className="text-xs font-semibold text-slate-500">bài mới nhất</span>
              </div>
            </div>

            {/* Checkboxes */}
            <div className="space-y-2 pt-1">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={onlyRecentDays}
                  onChange={(e) => setOnlyRecentDays(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
                  Chỉ quét các bài viết đăng trong vòng
                  <input
                    type="number"
                    value={recentDaysLimit}
                    onChange={(e) =>
                      setRecentDaysLimit(Math.max(1, Number(e.target.value) || 7))
                    }
                    className="w-11 px-1.5 py-0.5 text-center rounded border border-slate-300 text-xs font-bold text-blue-700 bg-blue-50/40"
                  />
                  ngày qua
                </span>
              </label>

              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={skipPinnedPosts}
                  onChange={(e) => setSkipPinnedPosts(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs font-medium text-slate-700">
                  Bỏ qua bài viết ghim của Quản trị viên
                </span>
              </label>

              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={deduplicatePosts}
                  onChange={(e) => setDeduplicatePosts(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs font-medium text-slate-700">
                  Tự động lọc trùng lặp bài viết giữa các page
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Middle Card: Xem trước danh sách page muốn quét */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h3 className="text-sm font-bold text-slate-800">
              Xem trước danh sách page muốn quét
            </h3>
            <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[11px] font-bold">
              {selectedPages.length} page đã chọn
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowSelectPagesModal(true)}
            className="px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Quản lý / Thay đổi page
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-100 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-2.5 px-4 w-14">STT</th>
                <th className="py-2.5 px-4">TÊN FANPAGE &amp; ID</th>
                <th className="py-2.5 px-4">NGÀNH NGHỀ / LOẠI PAGE</th>
                <th className="py-2.5 px-4">QUY MÔ / FOLLOWERS</th>
                <th className="py-2.5 px-4 text-right w-24">THAO TÁC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {selectedPages.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-400">
                    Chưa có Fanpage nào được chọn. Nhấn &ldquo;Quản lý / Thay đổi page&rdquo; để thêm.
                  </td>
                </tr>
              ) : (
                selectedPages.slice(0, 5).map((page, index) => (
                  <tr key={page.page_id || page.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-semibold text-slate-500">
                      #{index + 1}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0 ${
                            page.avatar_color || "bg-blue-100 text-blue-700"
                          }`}
                        >
                          {page.avatar_initials || page.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-bold text-slate-800">{page.name}</div>
                          <div className="text-[11px] text-slate-400">
                            ID: {page.page_id || page.id}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <span className="px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-700 font-medium text-[11px]">
                        {page.category || "Thương hiệu / Fanpage"}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-bold text-slate-700">
                      {page.followers_text ||
                        Number(page.followers_count || 125000).toLocaleString("vi-VN")}{" "}
                      <span className="font-normal text-slate-400">followers</span>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleRemovePreviewPage(page.page_id || page.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                        title="Xóa khỏi danh sách quét"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Execution Action Bar */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {scanState !== "RUNNING" ? (
          <button
            type="button"
            onClick={handleStartScan}
            className="px-8 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-md shadow-blue-600/20 transition-all flex items-center gap-2 cursor-pointer"
          >
            <Play className="w-4 h-4 fill-current" />
            BẮT ĐẦU THỰC THI
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handlePauseScan}
              className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-sm flex items-center gap-2 cursor-pointer"
            >
              <Pause className="w-4 h-4" />
              TẠM DỪNG QUÉT
            </button>
            <button
              type="button"
              onClick={handleStopScan}
              className="px-6 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-sm flex items-center gap-2 cursor-pointer"
            >
              <Square className="w-4 h-4 fill-current" />
              DỪNG KHẨN CẤP
            </button>
          </>
        )}
      </div>

      {/* Results Section Header */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-slate-800">
              Kết quả quét bài viết Fanpage
            </h2>
            <span className="px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-bold">
              Tổng {totalPostsCount} bài viết
            </span>
          </div>
          <button
            type="button"
            onClick={() =>
              exportPostsToCsv(
                Object.values(postsByPage).flat(),
                "toan_bo_bai_viet_fanpage.csv"
              )
            }
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs flex items-center gap-2 transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Xuất toàn bộ file Excel
          </button>
        </div>

        {/* Master - Detail Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Left Sidebar: DANH MỤC PAGE */}
          <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
            <div className="p-3.5 border-b border-slate-100 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                DANH MỤC PAGE ({selectedPages.length})
              </span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                Đang chạy {scanState === "RUNNING" ? "3" : "1"}/{selectedPages.length}
              </span>
            </div>

            <div className="p-3 border-b border-slate-100">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={sidebarSearch}
                  onChange={(e) => setSidebarSearch(e.target.value)}
                  placeholder="Tìm tên page trong danh sách..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto">
              {filteredSidebarPages.map((p) => {
                const pid = String(p.page_id || p.id);
                const isSelected = String(activePage?.page_id || activePage?.id) === pid;
                const statusBadge =
                  p.status === "RUNNING"
                    ? "text-blue-600"
                    : p.status === "DONE"
                      ? "text-emerald-600"
                      : "text-amber-600";

                return (
                  <button
                    key={pid}
                    type="button"
                    onClick={() => setActivePageId(pid)}
                    className={`w-full text-left p-3.5 transition-colors flex items-start justify-between gap-2 cursor-pointer ${
                      isSelected
                        ? "bg-blue-50/80 border-l-4 border-l-blue-600"
                        : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-xs text-slate-800 truncate">
                        {p.name}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        ID: {pid}
                      </div>
                      <div className={`text-[11px] font-semibold mt-1 ${statusBadge}`}>
                        ● {p.status_label || "Hoàn tất quét"}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0 ${
                        isSelected
                          ? "bg-blue-600 text-white"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {p.posts_count || 0} bài
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Detail Area */}
          <div className="lg:col-span-9 bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
            {/* Page Header */}
            <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900">
                    {activePage?.name}
                  </h3>
                  <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[11px] font-bold">
                    {activePage?.category || "Fanpage"}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Quy mô:{" "}
                  <strong className="text-slate-700">
                    {activePage?.followers_text || "324.500"} Followers
                  </strong>{" "}
                  • Đã quét:{" "}
                  <strong className="text-blue-600">
                    {currentPosts.length} bài viết
                  </strong>{" "}
                  • Cập nhật lúc: 14:38:34
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  exportPostsToCsv(
                    currentPosts,
                    `bai_viet_${activePage?.page_id || "page"}.csv`
                  )
                }
                className="px-3.5 py-2 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Xuất Page này
              </button>
            </div>

            {/* Search + Sort + 4 Filters */}
            <div className="p-4 bg-slate-50/60 border-b border-slate-100 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[240px]">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={postSearch}
                    onChange={(e) => setPostSearch(e.target.value)}
                    placeholder="Tìm từ khóa trong nội dung bài viết, ID post, hashtag..."
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-500">Sắp xếp:</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 focus:outline-none"
                  >
                    <option value="NEWEST">Mới nhất</option>
                    <option value="LIKES_DESC">Lượt Like cao nhất</option>
                    <option value="COMMENTS_DESC">Bình luận nhiều nhất</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <select
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-700 font-medium"
                >
                  <option value="ALL">Lọc Ngày Đăng: Tất cả</option>
                  <option value="TODAY">Hôm nay</option>
                  <option value="3DAYS">3 ngày gần đây</option>
                  <option value="7DAYS">7 ngày gần đây</option>
                </select>

                <select
                  value={likeFilter}
                  onChange={(e) => setLikeFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-700 font-medium"
                >
                  <option value="ALL">Lọc Lượt Like: Tất cả</option>
                  <option value="GT_500">Trên 500 Likes</option>
                  <option value="GT_1000">Trên 1.000 Likes</option>
                </select>

                <select
                  value={commentFilter}
                  onChange={(e) => setCommentFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-700 font-medium"
                >
                  <option value="ALL">Lọc Bình Luận: Tất cả</option>
                  <option value="GT_100">Trên 100 Comments</option>
                  <option value="GT_300">Trên 300 Comments</option>
                </select>

                <select
                  value={shareFilter}
                  onChange={(e) => setShareFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-700 font-medium"
                >
                  <option value="ALL">Lọc Lượt Share: Tất cả</option>
                  <option value="GT_50">Trên 50 Shares</option>
                  <option value="GT_100">Trên 100 Shares</option>
                </select>
              </div>
            </div>

            {/* Posts Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-[11px] font-bold text-slate-500 uppercase">
                    <th className="py-3 px-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={
                          currentPosts.length > 0 &&
                          currentPosts.every((p) => selectedPostIds.includes(p.id))
                        }
                        onChange={toggleSelectAllPosts}
                        className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600"
                      />
                    </th>
                    <th className="py-3 px-3 w-12">STT</th>
                    <th className="py-3 px-3 min-w-[260px]">NỘI DUNG BÀI VIẾT</th>
                    <th className="py-3 px-3">LINK POST</th>
                    <th className="py-3 px-3">NGÀY ĐĂNG</th>
                    <th className="py-3 px-3 text-center">LƯỢT LIKE</th>
                    <th className="py-3 px-3 text-center">BÌNH LUẬN</th>
                    <th className="py-3 px-3 text-center">CHIA SẺ</th>
                    <th className="py-3 px-3 text-center w-14">HĐ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {currentPosts.map((post, idx) => (
                    <tr key={post.id} className="hover:bg-slate-50/80">
                      <td className="py-3 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={selectedPostIds.includes(post.id)}
                          onChange={() => togglePostSelect(post.id)}
                          className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600"
                        />
                      </td>
                      <td className="py-3 px-3 font-semibold text-slate-500">
                        {idx + 1}
                      </td>
                      <td className="py-3 px-3 max-w-md">
                        <p className="text-slate-800 font-medium line-clamp-2 leading-relaxed">
                          {post.content}
                        </p>
                        <span className="text-[10px] text-slate-400">
                          Post ID: {post.id.replace("p_", "")}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <a
                          href={`https://${post.post_url}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 hover:underline font-medium text-[11px]"
                        >
                          {post.post_url.slice(0, 26)}...
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="font-semibold text-slate-700">
                          {post.published_date}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {post.published_time}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-bold text-[11px]">
                          <ThumbsUp className="w-3 h-3" />
                          {post.likes.toLocaleString("vi-VN")}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 font-bold text-[11px]">
                          <MessageSquare className="w-3 h-3" />
                          {post.comments.toLocaleString("vi-VN")}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center font-semibold text-slate-600">
                        {post.shares.toLocaleString("vi-VN")}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => setPreviewPost(post)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                          title="Xem chi tiết bài viết"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            <div className="px-4 py-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                Hiển thị <strong>1 - {currentPosts.length}</strong> trong tổng số{" "}
                <strong>{activePage?.posts_count || currentPosts.length}</strong> bài viết
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-600"
                >
                  Trước
                </button>
                <button
                  type="button"
                  className="px-2.5 py-1 rounded bg-blue-600 text-white font-bold"
                >
                  1
                </button>
                <button
                  type="button"
                  className="px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-600"
                >
                  2
                </button>
                <button
                  type="button"
                  className="px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-600"
                >
                  Sau
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Live Automation Log Console */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-md">
        <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-mono font-bold text-slate-200">
              Live Automation Log Console [Thread-01]
            </span>
          </div>
          <button
            type="button"
            onClick={() => setLogs([])}
            className="text-[11px] font-mono text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            Clear console
          </button>
        </div>
        <div className="p-4 font-mono text-xs space-y-1.5 max-h-44 overflow-y-auto">
          {logs.map((log, i) => (
            <div key={i} className="flex items-start gap-2 leading-relaxed">
              <span className="text-slate-500 shrink-0">[{log.time}]</span>
              <span className={`font-bold shrink-0 [${log.color}] ${log.color}`}>
                [{log.tag}]
              </span>
              <span className="text-slate-300">{log.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Post Detail Preview Modal */}
      {previewPost && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h4 className="text-sm font-bold text-slate-800">
                  Chi tiết bài viết #{previewPost.id.replace("p_", "")}
                </h4>
                <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                  <Calendar className="w-3 h-3" />
                  Đăng lúc {previewPost.published_time} - {previewPost.published_date}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewPost(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap bg-slate-50 p-3.5 rounded-xl border border-slate-100">
              {previewPost.content}
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2.5 rounded-xl bg-blue-50 text-blue-700">
                <div className="text-sm font-bold">
                  {previewPost.likes.toLocaleString("vi-VN")}
                </div>
                <div className="text-[11px]">Lượt Thích</div>
              </div>
              <div className="p-2.5 rounded-xl bg-purple-50 text-purple-700">
                <div className="text-sm font-bold">
                  {previewPost.comments.toLocaleString("vi-VN")}
                </div>
                <div className="text-[11px]">Bình Luận</div>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-700">
                <div className="text-sm font-bold">
                  {previewPost.shares.toLocaleString("vi-VN")}
                </div>
                <div className="text-[11px]">Chia Sẻ</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <SelectAccountsModal
        open={showAccountModal}
        onClose={() => setShowAccountModal(false)}
        accounts={accounts}
        selectedUids={selectedAccountIds}
        onConfirm={(ids) => {
          setSelectedAccountIds(ids);
          setShowAccountModal(false);
        }}
      />

      <SelectPagesModal
        open={showSelectPagesModal}
        onClose={() => setShowSelectPagesModal(false)}
        selectedPages={selectedPages}
        onConfirm={(pages) => {
          const normalized = pages.map((p) => ({
            ...p,
            id: p.page_id || p.uid || p.id,
            page_id: p.page_id || p.uid || p.id,
            name: p.name || p.page_name || "Fanpage",
            posts_count: p.posts_count || p.scanned_post_count || 65,
            followers_text:
              p.followers_text ||
              Number(p.follower_count || p.followers_count || 125000).toLocaleString("vi-VN"),
            status: p.status || "DONE",
            status_label: p.status_label || "Hoàn tất quét",
          }));
          setSelectedPages(normalized.length > 0 ? normalized : DEFAULT_SCANNED_PAGES);
          setShowSelectPagesModal(false);
        }}
      />
    </div>
  );
}
