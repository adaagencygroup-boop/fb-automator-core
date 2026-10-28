"use client";

import React, { useState, useMemo } from "react";
import {
  Search,
  Download,
  Copy,
  RefreshCw,
  ExternalLink,
  ThumbsUp,
  MessageSquare,
  Share2,
  Eye,
  Trash2,
  FolderInput,
  RotateCcw,
  Check,
  X,
  FileText,
} from "lucide-react";

const PAGE_CATEGORIES = [
  {
    id: "tech_24h",
    name: "Thế Giới Công Nghệ 24h",
    slug: "fb.com/thegioicongnghe24h",
    posts_count: 245,
    updated_at: "10 phút trước",
    sync_status: "Đang đồng bộ",
  },
  {
    id: "fashion_women",
    name: "Thời Trang Nữ Cao Cấp",
    slug: "fb.com/thoitrangnucaocap.official",
    posts_count: 180,
    updated_at: "35 phút trước",
    sync_status: "Đã đồng bộ",
  },
  {
    id: "bds_saigon",
    name: "Bất Động Sản Sài Gòn",
    slug: "fb.com/batdongsansaigon247",
    posts_count: 95,
    updated_at: "1 giờ trước",
    sync_status: "Đã đồng bộ",
  },
  {
    id: "interior_modern",
    name: "Nội Thất Hiện Đại",
    slug: "fb.com/noithathiendai.vn",
    posts_count: 310,
    updated_at: "2 giờ trước",
    sync_status: "Đang đồng bộ",
  },
  {
    id: "home_gadgets",
    name: "Gia Dụng Tiện Ích",
    slug: "fb.com/giadungtienich.store",
    posts_count: 140,
    updated_at: "Hôm qua",
    sync_status: "Đã đồng bộ",
  },
];

const INITIAL_SCANNED_POSTS = [
  {
    id: "post_10928371",
    page_id: "tech_24h",
    content:
      "🔥 ĐÁNH GIÁ CHI TIẾT MacBook Pro M4 Max sau 30 ngày trải nghiệm thực tế: Hiệu năng render 8K vượt trội, pin trụ vững 18 tiếng liên tục! Nhận ngay ưu đãi thu cũ đổi mới trợ giá 4.000.000đ tại showroom.",
    hashtags: ["#MacBookProM4", "#AppleVietnam", "#TechReview"],
    link: "fb.com/post/109283719201",
    published_date: "26/10/2026",
    published_time: "14:15",
    days_ago: 0,
    likes: 1840,
    comments: 425,
    shares: 192,
  },
  {
    id: "post_10928344",
    page_id: "tech_24h",
    content:
      "⚡ FLASH SALE CUỐI TUẦN: Tai nghe chống ồn Sony WH-1000XM6 giảm trực tiếp 2.500.000đ + Tặng kèm đế sạc không dây MagSafe 3in1. Số lượng giới hạn 50 suất đầu tiên comment SĐT!",
    hashtags: ["#FlashSale", "#SonyWH1000XM6", "#CongNghe24h"],
    link: "fb.com/post/109283448192",
    published_date: "25/10/2026",
    published_time: "20:00",
    days_ago: 1,
    likes: 2650,
    comments: 890,
    shares: 340,
  },
  {
    id: "post_10928290",
    page_id: "tech_24h",
    content:
      "So sánh camera iPhone 16 Pro Max vs Galaxy S25 Ultra trong điều kiện thiếu sáng: Đâu mới là ông vua nhiếp ảnh di động năm nay? Xem trọn bộ ảnh gốc không chỉnh sửa dưới phần bình luận.",
    hashtags: ["#iPhone16ProMax", "#GalaxyS25Ultra", "#CameraTest"],
    link: "fb.com/post/109282903841",
    published_date: "24/10/2026",
    published_time: "11:30",
    days_ago: 2,
    likes: 3120,
    comments: 1120,
    shares: 415,
  },
  {
    id: "post_10928155",
    page_id: "tech_24h",
    content:
      "Top 5 bàn phím cơ Custom не-wireless đáng mua nhất tầm giá dưới 3 triệu đồng cho lập trình viên & dân văn phòng. Gasket mount êm ái, hotswap 5 pin tiện lợi!",
    hashtags: ["#MechanicalKeyboard", "#SetupGocLamViec", "#DevGear"],
    link: "fb.com/post/109281559012",
    published_date: "22/10/2026",
    published_time: "09:45",
    days_ago: 4,
    likes: 780,
    comments: 215,
    shares: 68,
  },
  {
    id: "post_10928012",
    page_id: "tech_24h",
    content:
      "Hướng dẫn tối ưu hóa Windows 11 24H2 giúp tăng 30% FPS khi chơi game eSports và giảm ngốn RAM nền. Tải bộ công cụ script tự động miễn phí tại link bio!",
    hashtags: ["#Windows11", "#PCGaming", "#ThuThuatMayTinh"],
    link: "fb.com/post/109280127741",
    published_date: "19/10/2026",
    published_time: "17:20",
    days_ago: 7,
    likes: 1490,
    comments: 310,
    shares: 520,
  },
];

function exportScannedPostsCsv(posts, filename = "danh_sach_bai_viet_quet.csv") {
  const headers = [
    "STT",
    "ID Bài Viết",
    "Nội dung bài viết",
    "Hashtags",
    "Link Bài Viết",
    "Ngày đăng",
    "Giờ đăng",
    "Likes",
    "Comments",
    "Shares",
  ];
  const rows = posts.map((p, idx) => [
    idx + 1,
    p.id,
    `"${(p.content || "").replace(/"/g, '""')}"`,
    `"${(p.hashtags || []).join(" ")}"`,
    `https://${p.link}`,
    p.published_date,
    p.published_time,
    p.likes,
    p.comments,
    p.shares,
  ]);
  const csv = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.setAttribute("download", filename);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export default function PageScannerListPosts() {
  const [pages, setPages] = useState(PAGE_CATEGORIES);
  const [activePageId, setActivePageId] = useState("tech_24h");
  const [sidebarSearch, setSidebarSearch] = useState("");

  const [posts, setPosts] = useState(INITIAL_SCANNED_POSTS);
  const [searchQuery, setSearchQuery] = useState("");
  const [timeFilter, setTimeFilter] = useState("ALL");
  const [likeFilter, setLikeFilter] = useState("ALL");
  const [commentFilter, setCommentFilter] = useState("ALL");
  const [shareFilter, setShareFilter] = useState("ALL");

  const [selectedIds, setSelectedIds] = useState(["post_10928371", "post_10928344"]);
  const [copiedBanner, setCopiedBanner] = useState(false);
  const [detailPost, setDetailPost] = useState(null);

  const filteredSidebarPages = useMemo(() => {
    const q = sidebarSearch.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q)
    );
  }, [pages, sidebarSearch]);

  const activePage = useMemo(() => {
    return pages.find((p) => p.id === activePageId) || pages[0];
  }, [pages, activePageId]);

  const totalAllPosts = useMemo(() => {
    return pages.reduce((sum, p) => sum + (p.posts_count || 0), 0);
  }, [pages]);

  const filteredPosts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return posts.filter((post) => {
      if (
        q &&
        !post.content.toLowerCase().includes(q) &&
        !(post.hashtags || []).join(" ").toLowerCase().includes(q) &&
        !post.link.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (timeFilter === "TODAY" && post.days_ago > 0) return false;
      if (timeFilter === "3DAYS" && post.days_ago > 3) return false;
      if (timeFilter === "7DAYS" && post.days_ago > 7) return false;

      if (likeFilter === "GT_1000" && post.likes < 1000) return false;
      if (likeFilter === "GT_2000" && post.likes < 2000) return false;

      if (commentFilter === "GT_300" && post.comments < 300) return false;
      if (commentFilter === "GT_500" && post.comments < 500) return false;

      if (shareFilter === "GT_100" && post.shares < 100) return false;
      if (shareFilter === "GT_300" && post.shares < 300) return false;

      return true;
    });
  }, [posts, searchQuery, timeFilter, likeFilter, commentFilter, shareFilter]);

  const handleResetFilters = () => {
    setSearchQuery("");
    setTimeFilter("ALL");
    setLikeFilter("ALL");
    setCommentFilter("ALL");
    setShareFilter("ALL");
  };

  const handleCopyContent = () => {
    const targetPosts =
      selectedIds.length > 0
        ? filteredPosts.filter((p) => selectedIds.includes(p.id))
        : filteredPosts;
    const text = targetPosts
      .map((p) => `${p.content}\n${(p.hashtags || []).join(" ")}\nhttps://${p.link}`)
      .join("\n\n---\n\n");
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedBanner(true);
    setTimeout(() => setCopiedBanner(false), 2000);
  };

  const handleRefreshSync = () => {
    const newPost = {
      id: `post_${Math.floor(10000000 + Math.random() * 89999999)}`,
      page_id: activePage.id,
      content: `[MỚI ĐỒNG BỘ] Tổng hợp bảng giá linh kiện & thiết bị thông minh cập nhật tại ${activePage.name}. Ưu đãi miễn phí vận chuyển toàn quốc hôm nay!`,
      hashtags: ["#CapNhatMoi", "#UuDaiHomNay"],
      link: `fb.com/post/${Math.floor(1000000000 + Math.random() * 8999999999)}`,
      published_date: new Date().toLocaleDateString("vi-VN"),
      published_time: new Date().toTimeString().slice(0, 5),
      days_ago: 0,
      likes: Math.floor(200 + Math.random() * 1400),
      comments: Math.floor(40 + Math.random() * 320),
      shares: Math.floor(15 + Math.random() * 120),
    };
    setPosts((prev) => [newPost, ...prev]);
    setPages((prev) =>
      prev.map((p) =>
        p.id === activePage.id
          ? { ...p, posts_count: p.posts_count + 1, updated_at: "Vừa xong" }
          : p
      )
    );
  };

  const toggleSelectPost = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (
      filteredPosts.length > 0 &&
      filteredPosts.every((p) => selectedIds.includes(p.id))
    ) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredPosts.map((p) => p.id));
    }
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    setPosts((prev) => prev.filter((p) => !selectedIds.includes(p.id)));
    setSelectedIds([]);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start pb-10">
      {/* Left Sidebar: Danh mục Page */}
      <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <span className="text-sm font-bold text-slate-800">Danh mục Page</span>
          <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[11px] font-bold">
            Tổng: {totalAllPosts} bài
          </span>
        </div>

        <div className="p-3 border-b border-slate-100">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
              placeholder="Tìm tên hoặc ID page..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="p-2.5 space-y-1.5 max-h-[540px] overflow-y-auto">
          {filteredSidebarPages.map((p) => {
            const isSelected = p.id === activePage?.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setActivePageId(p.id)}
                className={`w-full text-left p-3 rounded-xl transition-all flex items-center justify-between gap-2 cursor-pointer ${
                  isSelected
                    ? "bg-blue-50/90 border border-blue-200 text-blue-900"
                    : "hover:bg-slate-50 text-slate-700 border border-transparent"
                }`}
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold truncate">{p.name}</div>
                  <div className="text-[11px] text-slate-400 truncate mt-0.5">
                    {p.slug}
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0 ${
                    isSelected
                      ? "bg-blue-600 text-white"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {p.posts_count} bài viết
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right Main Area */}
      <div className="lg:col-span-9 space-y-4">
        {/* Top Summary Card */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-sm">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">
                  {activePage?.name}
                </h2>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {activePage?.sync_status}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1">
                <a
                  href={`https://${activePage?.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 hover:underline font-medium flex items-center gap-1"
                >
                  {activePage?.slug}
                  <ExternalLink className="w-3 h-3" />
                </a>
                <span>•</span>
                <span>Cập nhật mới nhất: {activePage?.updated_at}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => exportScannedPostsCsv(filteredPosts)}
              className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              Xuất Excel/CSV
            </button>
            <button
              type="button"
              onClick={handleCopyContent}
              className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              {copiedBanner ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  Đã sao chép
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-blue-600" />
                  Sao chép nội dung
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleRefreshSync}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Quét cập nhật
            </button>
          </div>
        </div>

        {/* Filter & Table Card */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
          {/* Search + Filters */}
          <div className="p-4 border-b border-slate-100 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm theo nội dung từ khóa, hashtag, SĐT, khuyến mãi..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <select
                value={timeFilter}
                onChange={(e) => setTimeFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700"
              >
                <option value="ALL">Thời gian đăng: Tất cả</option>
                <option value="TODAY">Hôm nay</option>
                <option value="3DAYS">3 ngày qua</option>
                <option value="7DAYS">7 ngày qua</option>
              </select>

              <select
                value={likeFilter}
                onChange={(e) => setLikeFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700"
              >
                <option value="ALL">Lượt Thích (Like): Tất cả</option>
                <option value="GT_1000">&gt; 1.000 Likes</option>
                <option value="GT_2000">&gt; 2.000 Likes</option>
              </select>

              <select
                value={commentFilter}
                onChange={(e) => setCommentFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700"
              >
                <option value="ALL">Bình luận (Comment): Tất cả</option>
                <option value="GT_300">&gt; 300 Comments</option>
                <option value="GT_500">&gt; 500 Comments</option>
              </select>

              <select
                value={shareFilter}
                onChange={(e) => setShareFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700"
              >
                <option value="ALL">Chia sẻ (Share): Tất cả</option>
                <option value="GT_100">&gt; 100 Shares</option>
                <option value="GT_300">&gt; 300 Shares</option>
              </select>

              <button
                type="button"
                onClick={handleResetFilters}
                className="ml-auto px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-100 flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Đặt lại lọc
              </button>
            </div>
          </div>

          {/* Blue Selection Bar */}
          {selectedIds.length > 0 && (
            <div className="px-4 py-2.5 bg-blue-50/80 border-b border-blue-100 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-blue-800">
                {selectedIds.length} bài viết đang được chọn
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="px-3 py-1 rounded-lg bg-white border border-blue-200 text-blue-700 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <FolderInput className="w-3.5 h-3.5" />
                  Chuyển danh mục
                </button>
                <button
                  type="button"
                  onClick={() =>
                    exportScannedPostsCsv(
                      filteredPosts.filter((p) => selectedIds.includes(p.id)),
                      "bai_viet_da_chon.csv"
                    )
                  }
                  className="px-3 py-1 rounded-lg bg-white border border-blue-200 text-blue-700 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Xuất dữ liệu chọn
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Xóa
                </button>
              </div>
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-[11px] font-bold text-slate-500 uppercase">
                  <th className="py-3 px-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={
                        filteredPosts.length > 0 &&
                        filteredPosts.every((p) => selectedIds.includes(p.id))
                      }
                      onChange={toggleSelectAll}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600"
                    />
                  </th>
                  <th className="py-3 px-3 w-12">STT</th>
                  <th className="py-3 px-3 min-w-[280px]">NỘI DUNG BÀI VIẾT</th>
                  <th className="py-3 px-3">LINK BÀI VIẾT</th>
                  <th className="py-3 px-3">THỜI GIAN ĐĂNG</th>
                  <th className="py-3 px-3">TƯƠNG TÁC</th>
                  <th className="py-3 px-3 text-center w-24">HÀNH ĐỘNG</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredPosts.map((post, idx) => (
                  <tr key={post.id} className="hover:bg-slate-50/70">
                    <td className="py-3.5 px-3 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(post.id)}
                        onChange={() => toggleSelectPost(post.id)}
                        className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600"
                      />
                    </td>
                    <td className="py-3.5 px-3 font-semibold text-slate-500">
                      {idx + 1}
                    </td>
                    <td className="py-3.5 px-3 max-w-md">
                      <p className="text-slate-800 font-medium line-clamp-2 leading-relaxed">
                        {post.content}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {(post.hashtags || []).map((tag) => (
                          <span
                            key={tag}
                            className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <a
                        href={`https://${post.link}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:underline font-medium"
                      >
                        {post.link}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <div className="font-bold text-slate-700">
                        {post.published_date}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {post.published_time}
                      </div>
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 font-bold text-[11px]">
                          <ThumbsUp className="w-3 h-3" />
                          {post.likes.toLocaleString("vi-VN")}
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 font-bold text-[11px]">
                          <MessageSquare className="w-3 h-3" />
                          {post.comments.toLocaleString("vi-VN")}
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-bold text-[11px]">
                          <Share2 className="w-3 h-3" />
                          {post.shares.toLocaleString("vi-VN")}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => setDetailPost(post)}
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
              Hiển thị <strong>1 - {filteredPosts.length}</strong> trên{" "}
              <strong>{activePage?.posts_count || filteredPosts.length}</strong> bài viết
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
                3
              </button>
              <span className="px-1">...</span>
              <button
                type="button"
                className="px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-600"
              >
                25
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

      {/* Modal: Chi tiết bài viết */}
      {detailPost && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-800">
                Nội dung bài viết chi tiết
              </h3>
              <button
                type="button"
                onClick={() => setDetailPost(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-3.5 rounded-xl border border-slate-100">
              {detailPost.content}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(detailPost.hashtags || []).map((t) => (
                <span
                  key={t}
                  className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
