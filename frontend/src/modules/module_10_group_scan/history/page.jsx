"use client";

import React, { useState, useMemo, useEffect } from "react";
import {
  Search,
  Filter,
  RotateCcw,
  Download,
  Trash2,
  Eye,
  RefreshCw,
  Layers,
  CheckCircle2,
  Activity,
  Database,
  ExternalLink,
  Copy,
  Clock,
  Calendar,
  AlertCircle,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  X,
  Play,
  Users,
  FileText,
  Folder,
  Tag,
  ShieldCheck,
  Check,
  ChevronDown,
} from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "@/lib/toast";

// ==========================================
// MOCK DATA: PHIÊN QUÉT LỊCH SỬ CHUẨN MẪU
// ==========================================
const INITIAL_HISTORY_DATA = [
  {
    id: "SCN-2026-8941",
    type: "GROUP_INFO", // GROUP_INFO | MEMBERS | POSTS
    title: "Quét thông tin nhóm theo từ khóa",
    target: "thời trang sỉ tphcm, kinh doanh online",
    targetType: "keywords",
    account: {
      uid: "100084920412845",
      name: "Nguyễn Văn Hùng (Nick Trâu)",
      avatarText: "NV",
      avatarBg: "bg-blue-600",
    },
    progress: {
      collected: 50,
      target: 50,
      percentage: 100,
      unit: "nhóm",
    },
    startTime: "26/10/2026 14:15:20",
    endTime: "26/10/2026 14:22:45",
    duration: "7m 25s",
    status: "SUCCESS", // SUCCESS | RUNNING | PAUSED | FAILED
    config: {
      delay: "5 - 10s",
      privacy: "Tất cả (Public & Private)",
      minMembers: "1.000 thành viên",
      maxKeywords: 2,
    },
    logs: [
      { time: "14:15:20", level: "INFO", message: "Khởi động Chrome profile với UID 100084920412845" },
      { time: "14:15:35", level: "INFO", message: "Đã đăng nhập thành công. Điều hướng đến Facebook Search Groups" },
      { time: "14:16:10", level: "INFO", message: "Bắt đầu quét từ khóa 1: 'thời trang sỉ tphcm'" },
      { time: "14:18:40", level: "SUCCESS", message: "Đã thu thập đủ 25 nhóm hợp lệ cho từ khóa 1. Nghỉ chuyển tiếp 7s" },
      { time: "14:18:47", level: "INFO", message: "Bắt đầu quét từ khóa 2: 'kinh doanh online'" },
      { time: "14:22:30", level: "SUCCESS", message: "Đã thu thập đủ 25 nhóm hợp lệ cho từ khóa 2" },
      { time: "14:22:45", level: "SUCCESS", message: "Lưu 50 nhóm vào cơ sở dữ liệu Supabase thành công. Hoàn tất job!" },
    ],
    sampleResults: [
      { id: "1018249102", name: "Chợ Sỉ Quần Áo Sài Gòn & Miền Tây", privacy: "Công khai", members: "128,400 TV", url: "https://facebook.com/groups/chosi.saigon" },
      { id: "1029482019", name: "Tổng Kho Sỉ Thời Trang Nữ TPHCM", privacy: "Công khai", members: "94,200 TV", url: "https://facebook.com/groups/tongkhosi.tphcm" },
      { id: "1038592011", name: "Hội Các Mẹ Bán Hàng Online Toàn Quốc", privacy: "Riêng tư", members: "245,000 TV", url: "https://facebook.com/groups/mebanhang.online" },
      { id: "1049583024", name: "Cộng Đồng Kinh Doanh Đột Phá 2026", privacy: "Công khai", members: "68,100 TV", url: "https://facebook.com/groups/kinhdoanh.dotpha" },
    ],
  },
  {
    id: "SCN-2026-8940",
    type: "MEMBERS",
    title: "Quét UID thành viên nhóm tiềm năng",
    target: "Chợ Đầu Mối Quần Áo Ninh Hiệp (UID: 8492019482)",
    targetType: "group",
    account: {
      uid: "100091847291048",
      name: "Trần Mai Anh (Seeding 02)",
      avatarText: "TM",
      avatarBg: "bg-emerald-600",
    },
    progress: {
      collected: 1200,
      target: 1200,
      percentage: 100,
      unit: "UID",
    },
    startTime: "26/10/2026 13:40:10",
    endTime: "26/10/2026 13:58:30",
    duration: "18m 20s",
    status: "SUCCESS",
    config: {
      delay: "3 - 5s",
      filterNewMembers: "Bật (Ưu tiên TV mới vào < 30 ngày)",
      extractField: "UID, Họ tên, Giới tính, Link Profile",
      targetCount: "1.200 TV",
    },
    logs: [
      { time: "13:40:10", level: "INFO", message: "Kết nối tài khoản 100091847291048 tới nhóm mục tiêu" },
      { time: "13:40:25", level: "INFO", message: "Mở tab Danh sách thành viên / Thẻ thành viên mới" },
      { time: "13:45:00", level: "INFO", message: "Cuộn trang tự động, trích xuất 300 UID thành viên mới đợt 1" },
      { time: "13:50:15", level: "INFO", message: "Đã trích xuất 750 UID. Kiểm tra trùng lặp: loại bỏ 18 UID đã có" },
      { time: "13:58:10", level: "SUCCESS", message: "Đạt mốc chỉ tiêu 1.200 UID hợp lệ. Kết xuất file dữ liệu" },
      { time: "13:58:30", level: "SUCCESS", message: "Cập nhật vào Kho thành viên quét. Hoàn thành phiên." },
    ],
    sampleResults: [
      { id: "100092840192841", name: "Hoàng Minh Thuận", extra: "Thành viên mới (5 ngày)", url: "https://facebook.com/profile.php?id=100092840192841" },
      { id: "100083910294812", name: "Lê Ngọc Bích", extra: "Thành viên tích cực", url: "https://facebook.com/profile.php?id=100083910294812" },
      { id: "100074819204910", name: "Nguyễn Hải Đăng", extra: "Thành viên mới (1 tuần)", url: "https://facebook.com/profile.php?id=100074819204910" },
      { id: "100065910294819", name: "Phạm Thúy Hằng", extra: "Thành viên mới (2 ngày)", url: "https://facebook.com/profile.php?id=100065910294819" },
    ],
  },
  {
    id: "SCN-2026-8939",
    type: "POSTS",
    title: "Quét bài viết & đo lường tương tác nhóm",
    target: "Hội Mua Bán Xe Ô Tô Cũ Hà Nội (UID: 7182940192)",
    targetType: "group",
    account: {
      uid: "100072819401928",
      name: "Phạm Quốc Bảo (Scan Post 01)",
      avatarText: "PQ",
      avatarBg: "bg-amber-600",
    },
    progress: {
      collected: 185,
      target: 200,
      percentage: 92,
      unit: "bài viết",
    },
    startTime: "26/10/2026 11:20:05",
    endTime: "--:--:--",
    duration: "42m 10s",
    status: "RUNNING",
    config: {
      delay: "4 - 8s",
      minReactions: 10,
      minComments: 5,
      scanDays: "7 ngày gần nhất",
      extractFields: "Nội dung, Link bài, Tương tác (Likes, Comments, Shares)",
    },
    logs: [
      { time: "11:20:05", level: "INFO", message: "Bắt đầu phiên quét bài viết nhóm Ô Tô Cũ Hà Nội" },
      { time: "11:22:15", level: "INFO", message: "Tải bảng tin nhóm, phát hiện 32 bài viết trong 24h qua" },
      { time: "11:35:40", level: "INFO", message: "Đã bóc tách 90 bài viết đạt tiêu chí tương tác tối thiểu" },
      { time: "12:00:10", level: "INFO", message: "Tiến trình hiện tại: 185/200 bài viết. Đang cuộn tiếp..." },
    ],
    sampleResults: [
      { id: "post-98401", title: "Cần bán Mazda 3 sedan 2021 màu đỏ chính chủ...", reactions: "142 Likes", comments: "48 Cmt", shares: "12 Share" },
      { id: "post-98402", title: "Tìm xe gầm cao tài chính 500tr quay đầu tại Hà Nội...", reactions: "89 Likes", comments: "64 Cmt", shares: "3 Share" },
      { id: "post-98403", title: "Bảo dưỡng định kỳ các dòng xe Nhật, ưu đãi tháng 10...", reactions: "56 Likes", comments: "21 Cmt", shares: "8 Share" },
    ],
  },
  {
    id: "SCN-2026-8938",
    type: "GROUP_INFO",
    title: "Quét thông tin nhóm theo từ khóa",
    target: "bất động sản ven đô, đầu tư đất nền",
    targetType: "keywords",
    account: {
      uid: "100084920412845",
      name: "Nguyễn Văn Hùng (Nick Trâu)",
      avatarText: "NV",
      avatarBg: "bg-blue-600",
    },
    progress: {
      collected: 45,
      target: 60,
      percentage: 75,
      unit: "nhóm",
    },
    startTime: "25/10/2026 16:10:00",
    endTime: "25/10/2026 16:21:10",
    duration: "11m 10s",
    status: "PAUSED",
    config: {
      delay: "6 - 12s",
      privacy: "Chỉ nhóm Công khai (Public)",
      minMembers: "5.000 thành viên",
      maxKeywords: 2,
    },
    logs: [
      { time: "16:10:00", level: "INFO", message: "Bắt đầu phiên quét từ khóa Bất động sản" },
      { time: "16:15:30", level: "SUCCESS", message: "Từ khóa 1 'bất động sản ven đô' quét được 30 nhóm" },
      { time: "16:20:00", level: "INFO", message: "Từ khóa 2 'đầu tư đất nền' quét được 15 nhóm" },
      { time: "16:21:10", level: "WARN", message: "Người dùng bấm tạm dừng tiến trình quét qua bảng điều khiển" },
    ],
    sampleResults: [
      { id: "1083920192", name: "Cộng Đồng Đầu Tư Bất Động Sản Ven Đô", privacy: "Công khai", members: "152,000 TV", url: "https://facebook.com/groups/bds.vendo" },
      { id: "1094820194", name: "Hội Mua Bán Đất Nền Hòa Lạc & Quốc Oai", privacy: "Công khai", members: "88,400 TV", url: "https://facebook.com/groups/datnen.hoalac" },
    ],
  },
  {
    id: "SCN-2026-8937",
    type: "MEMBERS",
    title: "Quét UID thành viên nhóm tiềm năng",
    target: "Cộng Đồng Designer & Freelancer VN (UID: 6182940192)",
    targetType: "group",
    account: {
      uid: "100061829401924",
      name: "Vũ Hải Đăng (Acc Backup 03)",
      avatarText: "VH",
      avatarBg: "bg-purple-600",
    },
    progress: {
      collected: 540,
      target: 1000,
      percentage: 54,
      unit: "UID",
    },
    startTime: "25/10/2026 09:15:30",
    endTime: "25/10/2026 09:22:45",
    duration: "7m 15s",
    status: "FAILED",
    config: {
      delay: "3 - 6s",
      filterNewMembers: "Tắt",
      extractField: "UID, Họ tên, Link Profile",
      targetCount: "1.000 TV",
    },
    logs: [
      { time: "09:15:30", level: "INFO", message: "Khởi động phiên quét thành viên Designer" },
      { time: "09:18:20", level: "INFO", message: "Trích xuất thành công 540 UID" },
      { time: "09:22:40", level: "ERROR", message: "Facebook yêu cầu xác thực Checkpoint (956) trên tài khoản 100061829401924" },
      { time: "09:22:45", level: "FAILED", message: "Dừng tiến trình quét khẩn cấp để bảo vệ an toàn cho nick" },
    ],
    sampleResults: [
      { id: "100094820194812", name: "Nguyễn Minh Đức", extra: "Freelance UI/UX", url: "https://facebook.com/profile.php?id=100094820194812" },
      { id: "100083910294810", name: "Đặng Thị Huyền", extra: "Graphic Designer", url: "https://facebook.com/profile.php?id=100083910294810" },
    ],
  },
  {
    id: "SCN-2026-8936",
    type: "POSTS",
    title: "Quét bài viết & đo lường tương tác nhóm",
    target: "Hội Review Phim & Điện Ảnh Chiếu Rạp (UID: 5182940192)",
    targetType: "group",
    account: {
      uid: "100091847291048",
      name: "Trần Mai Anh (Seeding 02)",
      avatarText: "TM",
      avatarBg: "bg-emerald-600",
    },
    progress: {
      collected: 150,
      target: 150,
      percentage: 100,
      unit: "bài viết",
    },
    startTime: "24/10/2026 20:10:00",
    endTime: "24/10/2026 20:25:30",
    duration: "15m 30s",
    status: "SUCCESS",
    config: {
      delay: "5 - 10s",
      minReactions: 20,
      minComments: 10,
      scanDays: "3 ngày gần nhất",
      extractFields: "Nội dung, Link bài viết, Lượt tương tác",
    },
    logs: [
      { time: "20:10:00", level: "INFO", message: "Kết nối tài khoản tới nhóm Review Phim" },
      { time: "20:15:20", level: "INFO", message: "Bóc tách 80 bài viết có thảo luận sôi nổi" },
      { time: "20:25:30", level: "SUCCESS", message: "Đã hoàn tất quét 150 bài viết tương tác cao. Lưu vào CSDL." },
    ],
    sampleResults: [
      { id: "post-88201", title: "Cảm nhận sau khi xem suất chiếu sớm bom tấn hành động...", reactions: "840 Likes", comments: "310 Cmt", shares: "45 Share" },
      { id: "post-88202", title: "Top 5 chi tiết ẩn giấu mà bạn có thể bỏ lỡ trong phim...", reactions: "420 Likes", comments: "185 Cmt", shares: "29 Share" },
    ],
  },
];

export default function GroupScanHistoryPage() {
  const [historyList, setHistoryList] = useState(INITIAL_HISTORY_DATA);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectedSession, setSelectedSession] = useState(null);
  const [detailModalTab, setDetailModalTab] = useState("overview"); // overview | results | logs

  // Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterDateRange, setFilterDateRange] = useState("ALL");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Stats calculation
  const stats = useMemo(() => {
    const total = historyList.length;
    const success = historyList.filter((s) => s.status === "SUCCESS").length;
    const running = historyList.filter((s) => s.status === "RUNNING").length;
    const totalItemsCollected = historyList.reduce(
      (sum, s) => sum + (s.progress?.collected || 0),
      0
    );
    const successRate = total > 0 ? ((success / total) * 100).toFixed(1) : "0.0";
    return {
      total,
      success,
      running,
      successRate,
      totalItemsCollected,
    };
  }, [historyList]);

  // Filtered List
  const filteredList = useMemo(() => {
    return historyList.filter((item) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchId = item.id.toLowerCase().includes(q);
        const matchTitle = item.title.toLowerCase().includes(q);
        const matchTarget = item.target.toLowerCase().includes(q);
        const matchAcc =
          item.account.name.toLowerCase().includes(q) ||
          item.account.uid.includes(q);
        if (!matchId && !matchTitle && !matchTarget && !matchAcc) return false;
      }

      // 2. Type Filter
      if (filterType !== "ALL" && item.type !== filterType) return false;

      // 3. Status Filter
      if (filterStatus !== "ALL" && item.status !== filterStatus) return false;

      // 4. Date Range Filter
      if (filterDateRange === "TODAY") {
        const todayStr = "26/10/2026";
        if (!item.startTime.includes(todayStr)) return false;
      } else if (filterDateRange === "CUSTOM" && customStartDate && customEndDate) {
        // Simple string comparison for demo or valid dates
      }

      return true;
    });
  }, [
    historyList,
    searchQuery,
    filterType,
    filterStatus,
    filterDateRange,
    customStartDate,
    customEndDate,
  ]);

  // Pagination slice
  const totalPages = Math.max(1, Math.ceil(filteredList.length / pageSize));
  const paginatedList = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredList.slice(start, start + pageSize);
  }, [filteredList, currentPage, pageSize]);

  // Selection handlers
  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedIds(new Set(paginatedList.map((item) => item.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectOne = (id, checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  // Actions
  const handleRefresh = () => {
    toast.success("Đã làm mới danh sách lịch sử quét!");
  };


  const handleDeleteOne = (id) => {
    setHistoryList((prev) => prev.filter((item) => item.id !== id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    toast.success(`Đã xóa bản ghi ${id} khỏi lịch sử!`);
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    setHistoryList((prev) => prev.filter((item) => !selectedIds.has(item.id)));
    setSelectedIds(new Set());
    toast.success(`Đã xóa ${count} bản ghi lịch sử được chọn!`);
  };

  const handleRerun = (session) => {
    toast.info(
      `Đang khởi chạy lại phiên quét: ${session.title} (${session.target})...`
    );
  };

  // Export to Excel
  const handleExportExcel = () => {
    try {
      const dataToExport = (
        selectedIds.size > 0
          ? historyList.filter((item) => selectedIds.has(item.id))
          : filteredList
      ).map((item) => ({
        "Mã phiên": item.id,
        "Loại quét":
          item.type === "GROUP_INFO"
            ? "Quét thông tin nhóm"
            : item.type === "MEMBERS"
            ? "Quét thành viên nhóm"
            : "Quét bài viết nhóm",
        "Mục tiêu / Từ khóa": item.target,
        "Tài khoản UID": item.account.uid,
        "Tên tài khoản": item.account.name,
        "Đã thu thập": `${item.progress.collected} ${item.progress.unit}`,
        "Mục tiêu đặt ra": `${item.progress.target} ${item.progress.unit}`,
        "Tiến độ %": `${item.progress.percentage}%`,
        "Bắt đầu": item.startTime,
        "Kết thúc": item.endTime,
        "Thời lượng": item.duration,
        "Trạng thái":
          item.status === "SUCCESS"
            ? "Hoàn thành"
            : item.status === "RUNNING"
            ? "Đang quét"
            : item.status === "PAUSED"
            ? "Tạm dừng"
            : "Thất bại",
      }));

      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "LichSuQuetNhom");
      XLSX.writeFile(
        workbook,
        `Lich_Su_Quet_Nhom_Module10_${new Date().toISOString().slice(0, 10)}.xlsx`
      );
      toast.success(
        `Xuất thành công ${dataToExport.length} phiên quét ra file Excel!`
      );
    } catch (err) {
      console.error(err);
      toast.error("Có lỗi xảy ra khi xuất file Excel!");
    }
  };

  // Helper render Type Badge
  const renderTypeBadge = (type) => {
    switch (type) {
      case "GROUP_INFO":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <Search className="size-3" />
            <span>Quét nhóm</span>
          </span>
        );
      case "MEMBERS":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
            <Users className="size-3" />
            <span>Quét thành viên</span>
          </span>
        );
      case "POSTS":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <FileText className="size-3" />
            <span>Quét bài viết</span>
          </span>
        );
      default:
        return null;
    }
  };

  // Helper render Status Badge
  const renderStatusBadge = (status) => {
    switch (status) {
      case "SUCCESS":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            <span>Hoàn thành</span>
          </span>
        );
      case "RUNNING":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
            <RefreshCw className="size-3 animate-spin text-blue-600" />
            <span>Đang quét</span>
          </span>
        );
      case "PAUSED":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <span className="size-1.5 rounded-full bg-amber-500" />
            <span>Tạm dừng</span>
          </span>
        );
      case "FAILED":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <span className="size-1.5 rounded-full bg-rose-500" />
            <span>Thất bại</span>
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="-m-6 min-h-full space-y-5 bg-[#F4F7FC] p-6">
      {/* ======================================================== */}
      {/* 1. TOP STATS CARDS (4 Hàng Thẻ Thống Kê Nhanh)           */}
      {/* ======================================================== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Tổng phiên quét */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-[#64748B]">Tổng phiên quét</p>
            <p className="text-2xl font-bold text-[#0F172A]">{stats.total}</p>
            <p className="text-[11px] text-[#2563EB] font-medium flex items-center gap-1">
              <span>+12 phiên</span>
              <span className="text-[#94A3B8]">trong 7 ngày qua</span>
            </p>
          </div>
          <div className="size-11 rounded-xl bg-blue-50 flex items-center justify-center text-[#2563EB]">
            <Layers className="size-5.5" />
          </div>
        </div>

        {/* Card 2: Thành công */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-[#64748B]">Phiên thành công</p>
            <p className="text-2xl font-bold text-emerald-600">{stats.success}</p>
            <p className="text-[11px] text-[#059669] font-medium flex items-center gap-1">
              <span>Tỷ lệ hoàn thành</span>
              <span className="font-bold">{stats.successRate}%</span>
            </p>
          </div>
          <div className="size-11 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
            <CheckCircle2 className="size-5.5" />
          </div>
        </div>

        {/* Card 3: Đang thực thi */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-[#64748B]">Đang thực thi</p>
            <p className="text-2xl font-bold text-[#0284C7]">{stats.running}</p>
            <p className="text-[11px] text-[#64748B] font-medium flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-blue-500 animate-ping inline-block" />
              <span>Tiến trình nền ổn định</span>
            </p>
          </div>
          <div className="size-11 rounded-xl bg-sky-50 flex items-center justify-center text-[#0284C7]">
            <Activity className="size-5.5" />
          </div>
        </div>

        {/* Card 4: Tổng dữ liệu bóc tách */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-[#64748B]">Dữ liệu đã thu thập</p>
            <p className="text-2xl font-bold text-violet-700">
              {stats.totalItemsCollected.toLocaleString()}
            </p>
            <p className="text-[11px] text-[#64748B] font-medium">
              Nhóm • UID • Bài viết
            </p>
          </div>
          <div className="size-11 rounded-xl bg-violet-50 flex items-center justify-center text-violet-600">
            <Database className="size-5.5" />
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 2. FILTER & TOOLBAR WORKSPACE CARD                       */}
      {/* ======================================================== */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-xs p-4 space-y-3.5">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 max-w-lg">
            <Search className="size-4 absolute left-3 top-2.5 text-[#94A3B8]" />
            <input
              type="text"
              placeholder="Tìm theo mã phiên (#SCN), từ khóa, nhóm, UID tài khoản..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-9 pl-9 pr-3 text-xs text-[#0F172A] border border-[#E2E8F0] bg-[#F8FAFC] rounded-lg outline-none focus:border-[#2563EB] focus:bg-white transition-all placeholder:text-[#94A3B8]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          {/* Quick Filters Group */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Loại quét */}
            <select
              value={filterType}
              onChange={(e) => {
                setFilterType(e.target.value);
                setCurrentPage(1);
              }}
              className="h-9 px-3 text-xs font-medium text-[#1E293B] border border-[#CBD5E1] bg-white rounded-lg outline-none focus:border-[#2563EB] cursor-pointer"
            >
              <option value="ALL">Tất cả loại quét</option>
              <option value="GROUP_INFO">🔍 Quét thông tin nhóm</option>
              <option value="MEMBERS">👥 Quét thành viên nhóm</option>
              <option value="POSTS">📝 Quét bài viết nhóm</option>
            </select>

            {/* Trạng thái */}
            <select
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="h-9 px-3 text-xs font-medium text-[#1E293B] border border-[#CBD5E1] bg-white rounded-lg outline-none focus:border-[#2563EB] cursor-pointer"
            >
              <option value="ALL">Tất cả trạng thái</option>
              <option value="SUCCESS">🟢 Hoàn thành</option>
              <option value="RUNNING">🔵 Đang quét</option>
              <option value="PAUSED">🟡 Tạm dừng</option>
              <option value="FAILED">🔴 Thất bại</option>
            </select>

            {/* Thời gian */}
            <select
              value={filterDateRange}
              onChange={(e) => {
                setFilterDateRange(e.target.value);
                setCurrentPage(1);
              }}
              className="h-9 px-3 text-xs font-medium text-[#1E293B] border border-[#CBD5E1] bg-white rounded-lg outline-none focus:border-[#2563EB] cursor-pointer"
            >
              <option value="ALL">Toàn bộ thời gian</option>
              <option value="TODAY">Hôm nay</option>
              <option value="7DAYS">7 ngày qua</option>
              <option value="30DAYS">30 ngày qua</option>
              <option value="CUSTOM">Tùy chỉnh ngày</option>
            </select>

            {/* Action Buttons */}
            <button
              type="button"
              onClick={handleRefresh}
              title="Làm mới dữ liệu"
              className="size-9 flex items-center justify-center rounded-lg border border-[#CBD5E1] bg-white text-[#475569] hover:bg-slate-50 transition-colors"
            >
              <RotateCcw className="size-4" />
            </button>


            {/* Nút Xuất Excel */}
            <button
              type="button"
              onClick={handleExportExcel}
              className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-colors"
            >
              <FileSpreadsheet className="size-3.5" />
              <span>Xuất Excel</span>
            </button>

            {/* Nút Xóa nhiều */}
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={handleBulkDelete}
                className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200 text-xs font-semibold transition-colors"
              >
                <Trash2 className="size-3.5" />
                <span>Xóa ({selectedIds.size})</span>
              </button>
            )}
          </div>
        </div>

        {/* Custom Date Picker Inputs when selected */}
        {filterDateRange === "CUSTOM" && (
          <div className="pt-2 border-t border-[#F1F5F9] flex items-center gap-2 text-xs">
            <span className="text-[#64748B]">Từ ngày:</span>
            <input
              type="date"
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
              className="h-8 px-2 border border-[#CBD5E1] rounded-md text-xs bg-white text-[#1E293B]"
            />
            <span className="text-[#64748B]">Đến ngày:</span>
            <input
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              className="h-8 px-2 border border-[#CBD5E1] rounded-md text-xs bg-white text-[#1E293B]"
            />
          </div>
        )}
      </div>

      {/* ======================================================== */}
      {/* 3. MASTER DATA TABLE CARD                                */}
      {/* ======================================================== */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-xs overflow-hidden flex flex-col">
        {/* Table Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 bg-[#F8FAFC]/50 border-b border-[#F1F5F9]">
          <div className="flex items-center gap-2.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#1E293B]">
              NHẬT KÝ CÁC PHIÊN QUÉT NHÓM
            </h2>
            <span className="rounded-full bg-[#EFF6FF] border border-[#BFDBFE] px-2.5 py-0.5 text-[11px] font-semibold text-[#1D4ED8]">
              {filteredList.length} phiên ghi nhận
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs text-[#64748B]">
            <span>Đã chọn: <b className="text-[#0F172A]">{selectedIds.size}</b> phiên</span>
          </div>
        </div>

        {/* Table View */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[11px] font-bold uppercase tracking-wider text-[#475569]">
              <tr>
                <th className="py-3 px-4 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={
                      paginatedList.length > 0 &&
                      paginatedList.every((item) => selectedIds.has(item.id))
                    }
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="size-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </th>
                <th className="py-3 px-4 min-w-[170px]">Mã phiên & Loại quét</th>
                <th className="py-3 px-4 min-w-[220px]">Mục tiêu / Từ khóa</th>
                <th className="py-3 px-4 min-w-[180px]">Tài khoản thực thi</th>
                <th className="py-3 px-4 min-w-[170px]">Tiến độ & Kết quả</th>
                <th className="py-3 px-4 min-w-[150px]">Thời gian & Thời lượng</th>
                <th className="py-3 px-4 min-w-[120px]">Trạng thái</th>
                <th className="py-3 px-4 min-w-[120px] text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9] text-[#1E293B]">
              {paginatedList.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[#94A3B8]">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Layers className="size-8 text-slate-300 stroke-[1.5]" />
                      <p className="font-semibold text-slate-600">Không tìm thấy phiên quét nào phù hợp</p>
                      <p className="text-[11px] text-slate-400">Hãy thử thay đổi từ khóa tìm kiếm hoặc đặt lại bộ lọc</p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedList.map((item) => {
                  const isChecked = selectedIds.has(item.id);
                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-[#F8FAFC] transition-colors ${
                        isChecked ? "bg-blue-50/40" : ""
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="py-3 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => handleSelectOne(item.id, e.target.checked)}
                          className="size-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </td>

                      {/* Mã phiên & Loại quét */}
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-1">
                          <span className="font-bold text-[#0F172A] tracking-tight">
                            #{item.id}
                          </span>
                          {renderTypeBadge(item.type)}
                        </div>
                      </td>

                      {/* Mục tiêu / Từ khóa */}
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-1 max-w-[260px]">
                          <span className="font-semibold text-[#0F172A] truncate" title={item.target}>
                            {item.target}
                          </span>
                          <span className="text-[11px] text-[#64748B]">
                            {item.title}
                          </span>
                        </div>
                      </td>

                      {/* Tài khoản thực thi */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`size-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0 ${item.account.avatarBg}`}
                          >
                            {item.account.avatarText}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="font-semibold text-[#0F172A] truncate text-[11px]">
                              {item.account.name}
                            </span>
                            <span className="text-[10px] text-[#64748B] font-mono">
                              {item.account.uid}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Tiến độ & Kết quả */}
                      <td className="py-3 px-4">
                        <div className="space-y-1.5 w-36">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-bold text-[#0F172A]">
                              {item.progress.collected} / {item.progress.target}
                            </span>
                            <span className="font-medium text-[#64748B]">
                              {item.progress.percentage}%
                            </span>
                          </div>
                          {/* Progress bar */}
                          <div className="h-1.5 w-full rounded-full bg-[#E2E8F0] overflow-hidden">
                            <div
                              className={`h-full transition-all duration-300 ${
                                item.status === "FAILED"
                                  ? "bg-rose-500"
                                  : item.status === "PAUSED"
                                  ? "bg-amber-500"
                                  : item.progress.percentage === 100
                                  ? "bg-emerald-500"
                                  : "bg-[#2563EB]"
                              }`}
                              style={{ width: `${Math.min(100, item.progress.percentage)}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-[#94A3B8]">
                            Đơn vị: {item.progress.unit}
                          </span>
                        </div>
                      </td>

                      {/* Thời gian & Thời lượng */}
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[#334155] font-medium text-[11px]">
                            {item.startTime}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[10px] text-[#64748B]">
                            <Clock className="size-3 text-slate-400" />
                            <span>{item.duration}</span>
                          </span>
                        </div>
                      </td>

                      {/* Trạng thái */}
                      <td className="py-3 px-4">
                        {renderStatusBadge(item.status)}
                      </td>

                      {/* Thao tác */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* Nút Xem chi tiết */}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedSession(item);
                              setDetailModalTab("overview");
                            }}
                            title="Xem chi tiết phiên quét"
                            className="size-7 rounded-lg border border-[#E2E8F0] hover:border-[#2563EB] hover:text-[#2563EB] flex items-center justify-center text-[#475569] transition-colors"
                          >
                            <Eye className="size-3.5" />
                          </button>

                          {/* Nút Quét lại */}
                          <button
                            type="button"
                            onClick={() => handleRerun(item)}
                            title="Chạy lại phiên quét này"
                            className="size-7 rounded-lg border border-[#E2E8F0] hover:border-emerald-600 hover:text-emerald-600 flex items-center justify-center text-[#475569] transition-colors"
                          >
                            <RefreshCw className="size-3.5" />
                          </button>

                          {/* Nút Xóa */}
                          <button
                            type="button"
                            onClick={() => handleDeleteOne(item.id)}
                            title="Xóa phiên khỏi lịch sử"
                            className="size-7 rounded-lg border border-[#E2E8F0] hover:border-rose-500 hover:text-rose-500 flex items-center justify-center text-[#475569] transition-colors"
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

        {/* Pagination Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-t border-[#F1F5F9] bg-[#F8FAFC]/40 text-xs text-[#64748B]">
          <div className="flex items-center gap-2">
            <span>Hiển thị</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="h-7 px-2 border border-[#CBD5E1] rounded bg-white text-xs text-[#1E293B]"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
            <span>trên tổng số <b>{filteredList.length}</b> phiên</span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="size-7 flex items-center justify-center rounded border border-[#CBD5E1] bg-white text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              <ChevronLeft className="size-3.5" />
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => setCurrentPage(page)}
                className={`size-7 text-xs font-semibold rounded transition-colors ${
                  currentPage === page
                    ? "bg-[#2563EB] text-white"
                    : "border border-[#CBD5E1] bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {page}
              </button>
            ))}

            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="size-7 flex items-center justify-center rounded border border-[#CBD5E1] bg-white text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 4. DETAIL MODAL: XEM CHI TIẾT PHIÊN QUÉT                */}
      {/* ======================================================== */}
      {selectedSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs">
          <div className="relative w-full max-w-3xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[#F1F5F9] px-6 py-4 bg-[#F8FAFC]">
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#2563EB]">
                  <Layers className="size-4.5" />
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-[#0F172A]">
                      Chi tiết phiên #{selectedSession.id}
                    </h3>
                    {renderTypeBadge(selectedSession.type)}
                    {renderStatusBadge(selectedSession.status)}
                  </div>
                  <p className="text-[11px] text-[#64748B]">
                    Khởi tạo lúc: {selectedSession.startTime} • Thời lượng: {selectedSession.duration}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedSession(null)}
                className="size-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Modal Nav Tabs */}
            <div className="flex items-center gap-4 px-6 border-b border-[#F1F5F9] bg-white text-xs font-semibold">
              <button
                type="button"
                onClick={() => setDetailModalTab("overview")}
                className={`py-3 border-b-2 transition-colors ${
                  detailModalTab === "overview"
                    ? "border-[#2563EB] text-[#2563EB]"
                    : "border-transparent text-[#64748B] hover:text-[#0F172A]"
                }`}
              >
                Tổng quan & Cấu hình
              </button>
              <button
                type="button"
                onClick={() => setDetailModalTab("results")}
                className={`py-3 border-b-2 transition-colors ${
                  detailModalTab === "results"
                    ? "border-[#2563EB] text-[#2563EB]"
                    : "border-transparent text-[#64748B] hover:text-[#0F172A]"
                }`}
              >
                Dữ liệu mẫu ({selectedSession.sampleResults?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setDetailModalTab("logs")}
                className={`py-3 border-b-2 transition-colors ${
                  detailModalTab === "logs"
                    ? "border-[#2563EB] text-[#2563EB]"
                    : "border-transparent text-[#64748B] hover:text-[#0F172A]"
                }`}
              >
                Nhật ký tiến trình ({selectedSession.logs?.length || 0})
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-4 flex-1 text-xs">
              {/* TAB 1: OVERVIEW */}
              {detailModalTab === "overview" && (
                <div className="space-y-4">
                  {/* Account & Target Card */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-[#E2E8F0] p-4 bg-[#F8FAFC]/50 space-y-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                        Tài khoản thực thi
                      </span>
                      <div className="flex items-center gap-3 pt-1">
                        <div
                          className={`size-9 rounded-full flex items-center justify-center text-white text-xs font-bold ${selectedSession.account.avatarBg}`}
                        >
                          {selectedSession.account.avatarText}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-[#0F172A]">
                            {selectedSession.account.name}
                          </span>
                          <span className="text-[11px] text-[#64748B] font-mono">
                            UID: {selectedSession.account.uid}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#E2E8F0] p-4 bg-[#F8FAFC]/50 space-y-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                        Mục tiêu / Từ khóa quét
                      </span>
                      <div className="pt-1">
                        <p className="font-bold text-[#0F172A] text-sm">
                          {selectedSession.target}
                        </p>
                        <p className="text-[11px] text-[#64748B] mt-0.5">
                          {selectedSession.title}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Progress & Result Box */}
                  <div className="rounded-xl border border-[#E2E8F0] p-4 bg-white space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#0F172A]">
                        Kết quả thu thập: {selectedSession.progress.collected} /{" "}
                        {selectedSession.progress.target} {selectedSession.progress.unit}
                      </span>
                      <span className="font-bold text-[#2563EB]">
                        {selectedSession.progress.percentage}%
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-[#E2E8F0] overflow-hidden">
                      <div
                        className="h-full bg-[#2563EB] rounded-full"
                        style={{ width: `${selectedSession.progress.percentage}%` }}
                      />
                    </div>
                  </div>

                  {/* Config Grid */}
                  <div className="rounded-xl border border-[#E2E8F0] p-4 bg-white space-y-2.5">
                    <h4 className="font-bold text-[#0F172A] pb-2 border-b border-[#F1F5F9]">
                      Cấu hình tham số phiên chạy
                    </h4>
                    <div className="grid grid-cols-2 gap-y-2 text-[11px]">
                      {Object.entries(selectedSession.config || {}).map(([key, val]) => (
                        <div key={key} className="flex flex-col">
                          <span className="text-[#64748B] capitalize">{key}:</span>
                          <span className="font-semibold text-[#1E293B]">{String(val)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: SAMPLE RESULTS */}
              {detailModalTab === "results" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-[#F1F5F9]">
                    <span className="text-xs font-semibold text-[#64748B]">
                      Hiển thị mẫu các mục dữ liệu đã trích xuất được:
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          JSON.stringify(selectedSession.sampleResults, null, 2)
                        );
                        toast.success("Đã copy dữ liệu mẫu vào Clipboard!");
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563EB] hover:underline"
                    >
                      <Copy className="size-3" />
                      <span>Copy toàn bộ JSON</span>
                    </button>
                  </div>

                  <div className="space-y-2">
                    {selectedSession.sampleResults?.map((res, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]/50 hover:bg-white transition-colors flex items-center justify-between"
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="font-bold text-[#0F172A] truncate">
                            {res.name || res.title}
                          </span>
                          <span className="text-[11px] text-[#64748B]">
                            {res.members || res.extra || `${res.reactions || ""} • ${res.comments || ""}`}
                          </span>
                        </div>
                        {res.url && (
                          <a
                            href={res.url}
                            target="_blank"
                            rel="noreferrer"
                            className="size-7 rounded-md border border-[#CBD5E1] flex items-center justify-center text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors shrink-0"
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 3: LOGS */}
              {detailModalTab === "logs" && (
                <div className="rounded-xl bg-[#0F172A] p-4 text-[#F8FAFC] font-mono text-[11px] space-y-2 max-h-[350px] overflow-y-auto">
                  {selectedSession.logs?.map((lg, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-[#64748B] shrink-0">[{lg.time}]</span>
                      <span
                        className={`font-bold shrink-0 ${
                          lg.level === "ERROR" || lg.level === "FAILED"
                            ? "text-rose-400"
                            : lg.level === "SUCCESS"
                            ? "text-emerald-400"
                            : lg.level === "WARN"
                            ? "text-amber-400"
                            : "text-blue-400"
                        }`}
                      >
                        [{lg.level}]
                      </span>
                      <span className="text-slate-200 break-all">{lg.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-6 py-3.5 border-t border-[#F1F5F9] bg-[#F8FAFC]">
              <button
                type="button"
                onClick={() => setSelectedSession(null)}
                className="px-4 py-2 rounded-lg border border-[#CBD5E1] bg-white text-xs font-semibold text-[#334155] hover:bg-slate-50 transition-colors"
              >
                Đóng
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    handleRerun(selectedSession);
                    setSelectedSession(null);
                  }}
                  className="px-4 py-2 rounded-lg bg-[#2563EB] hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition-colors inline-flex items-center gap-1.5"
                >
                  <RefreshCw className="size-3.5" />
                  <span>Quét lại phiên này</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
