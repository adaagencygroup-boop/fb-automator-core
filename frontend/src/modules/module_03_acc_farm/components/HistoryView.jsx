"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Search,
  Download,
  Eraser,
  ExternalLink,
  Info,
  ChevronDown,
  Copy,
  Check,
  Video,
  FileText,
  Clock,
  Calendar,
  Loader2,
  X,
  AlertCircle,
  Terminal,
  Image as ImageIcon,
} from "lucide-react";
import { api } from "@/services/api";
import CustomSelect from "@/components/ui/custom-select";
import Pagination from "@/components/ui/pagination";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/lib/toast";
import { openPostInAccountBrowser } from "@/modules/module_03_acc_farm/openAccountPost";
import { mediaFileUrl, normalizeImagePaths } from "./PostImageModal";

function HistoryStatusImageCard({ path }) {
  const [broken, setBroken] = useState(false);
  const fileName = String(path || "").replace(/\\/g, "/").split("/").pop() || path;
  const src = mediaFileUrl(path);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 overflow-hidden flex flex-col min-w-0">
      <div className="aspect-square bg-slate-100 relative flex items-center justify-center overflow-hidden">
        {!broken && src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={fileName}
            className="h-full w-full object-cover"
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="px-2 text-center space-y-1">
            <ImageIcon size={18} className="mx-auto text-slate-400" />
            <p className="text-[10px] text-slate-500 leading-snug">
              Không tải được ảnh / file không còn trên máy
            </p>
          </div>
        )}
      </div>
      <div className="p-2 space-y-1.5 border-t border-slate-200/80">
        <p className="text-[10px] font-medium text-slate-700 truncate" title={fileName}>
          {fileName}
        </p>
        <p className="text-[9px] font-mono text-slate-400 break-all line-clamp-2" title={path}>
          {path}
        </p>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(path);
            toast.success("Đã sao chép đường dẫn ảnh");
          }}
          className="text-[10px] text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 cursor-pointer"
        >
          <Copy size={10} />
          <span>Sao chép đường dẫn</span>
        </button>
      </div>
    </div>
  );
}

const FORMAT_OPTIONS = [
  { value: "all", label: "Tất cả hình thức" },
  { value: "status", label: "Status" },
  { value: "reels", label: "Reels" },
  { value: "story", label: "Story" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "Tất cả trạng thái" },
  { value: "PUBLISHED", label: "Đã xuất bản" },
  { value: "STOPPED", label: "Đã dừng" },
  { value: "FAILED", label: "Lỗi hệ thống" },
];

/** Việt hóa thông báo lỗi đăng bài (kể cả bản ghi cũ còn stacktrace Selenium). */
export function humanizePostError(raw) {
  let text = String(raw || "").trim();
  if (!text) return "";
  for (const sep of ["Stacktrace:", "Stack trace:", "(Session info:", "Backtrace:"]) {
    const i = text.indexOf(sep);
    if (i >= 0) text = text.slice(0, i).trim();
  }
  text = text
    .split("\n")
    .filter((ln) => ln.trim() && !ln.includes("No symbol"))
    .join(" ")
    .trim() || String(raw || "").trim();
  const low = text.toLowerCase();

  if (low.includes("publishunconfirmed")) {
    const after = text.includes(":") ? text.split(":").slice(1).join(":").trim() : "";
    return after || "Không xác nhận được bài đã đăng lên Facebook (hết thời gian chờ).";
  }
  if (
    low.includes("maxretryerror") ||
    low.includes("newconnectionerror") ||
    low.includes("winerror 10061") ||
    low.includes("actively refused") ||
    low.includes("connection refused") ||
    low.includes("httpconnectionpool") ||
    low.includes("failed to establish a new connection") ||
    low.includes("invalid session id") ||
    low.includes("chrome not reachable")
  ) {
    return "Mất kết nối với trình duyệt Chrome trong lúc đăng bài (Chrome/ChromeDriver đã đóng hoặc không phản hồi). Hãy chạy lại bài này; tránh đóng cửa sổ Chrome khi đang đăng.";
  }
  if (low.includes("staleelement")) {
    return "Giao diện Facebook vừa thay đổi khi đang thao tác (phần tử DOM bị cũ). Hệ thống không bấm được nút đúng lúc — hãy thử đăng lại bài này.";
  }
  if (low.includes("nosuchelement")) {
    return "Không tìm thấy nút/ô nhập trên Facebook (giao diện đổi hoặc trang chưa tải xong). Hãy thử đăng lại hoặc kiểm tra phiên đăng nhập.";
  }
  if (low.includes("timeoutexception") || low.includes("timed out")) {
    return "Hết thời gian chờ phần tử trên Facebook phản hồi. Mạng chậm hoặc trang tải lâu — hãy thử đăng lại.";
  }
  if (low.includes("elementclickintercepted") || low.includes("element not interactable")) {
    return "Không thể bấm nút vì bị lớp giao diện khác che (popup/dialog). Hãy thử đăng lại bài này.";
  }
  if (/^[A-Za-z][A-Za-z0-9_]*Error:/.test(text) || /^[A-Za-z][A-Za-z0-9_]*Exception:/.test(text)) {
    const after = text.split(":").slice(1).join(":").trim();
    const short = (after || text).slice(0, 280);
    return `Lỗi đăng bài: ${short}${after.length > 280 ? "..." : ""}`;
  }
  return text.length > 400 ? `${text.slice(0, 397)}...` : text;
}

const CLEANUP_OPTIONS = [
  { value: 7, label: "Cũ hơn 7 ngày" },
  { value: 15, label: "Cũ hơn 15 ngày" },
  { value: 30, label: "Cũ hơn 30 ngày" },
  { value: 60, label: "Cũ hơn 60 ngày" },
  { value: 90, label: "Cũ hơn 90 ngày" },
  { value: 0, label: "Xóa toàn bộ lịch sử" },
];

export function HistoryView() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedAccountUid, setSelectedAccountUid] = useState("all");
  const [selectedFormat, setSelectedFormat] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedDate, setSelectedDate] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const [isLoading, setIsLoading] = useState(false);
  const [postHistory, setPostHistory] = useState([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [accountOptions, setAccountOptions] = useState([
    { value: "all", label: "Tất cả tài khoản" },
  ]);

  const [copiedUid, setCopiedUid] = useState(null);
  const [copiedMedia, setCopiedMedia] = useState(false);
  const [selectedDetailPost, setSelectedDetailPost] = useState(null);
  const [showSuccessLogs, setShowSuccessLogs] = useState(false);
  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [cleanupDays, setCleanupDays] = useState(30);
  const [isCleaning, setIsCleaning] = useState(false);
  const [reloadCounter, setReloadCounter] = useState(0);
  const [openingLinkKey, setOpeningLinkKey] = useState(null);

  const openHistoryPostLink = async (uid, url, key, title = "Mở liên kết bài viết") => {
    if (!url || openingLinkKey) return;
    setOpeningLinkKey(key);
    try {
      await openPostInAccountBrowser(uid, url, { title });
    } finally {
      setOpeningLinkKey(null);
    }
  };

  // Đóng modal khi bấm Escape và reset các state phụ
  useEffect(() => {
    if (!selectedDetailPost) {
      setCopiedMedia(false);
      setShowSuccessLogs(false);
      return;
    }
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setSelectedDetailPost(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedDetailPost]);

  // Helper format ngày giờ
  const formatDateTime = useCallback((dateStr) => {
    if (!dateStr) return { time: "--:--:--", date: "--/--/----" };
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return { time: "--:--:--", date: "--/--/----" };
      const hours = String(d.getHours()).padStart(2, "0");
      const mins = String(d.getMinutes()).padStart(2, "0");
      const secs = String(d.getSeconds()).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      return {
        time: `${hours}:${mins}:${secs}`,
        date: `${day}/${month}/${year}`
      };
    } catch {
      return { time: "--:--:--", date: "--/--/----" };
    }
  }, []);

  // ── Tải danh sách tài khoản cho bộ lọc ──
  useEffect(() => {
    let ignore = false;
    async function loadAccounts() {
      try {
        const res = await api.get("/api/accounts");
        if (ignore) return;
        let raw = [];
        if (Array.isArray(res)) raw = res;
        else if (Array.isArray(res?.accounts)) raw = res.accounts;
        else if (Array.isArray(res?.data)) raw = res.data;

        const opts = [{ value: "all", label: "Tất cả tài khoản" }];
        const seen = new Set();
        raw.forEach((acc) => {
          const uid = String(acc.uid || acc.fb_uid || acc.account_uid || "").trim();
          if (!uid || seen.has(uid)) return;
          // Chỉ hiện nick còn sống (Live) — khớp yêu cầu bỏ lọc Die/Blocked
          const status = String(acc.status || "").toLowerCase();
          if (status && status !== "live") return;
          seen.add(uid);
          const name = acc.name || acc.fb_name || acc.account_name || uid;
          opts.push({
            value: uid,
            label: `${name} (${uid})`,
          });
        });
        setAccountOptions(opts);
      } catch (err) {
        console.error("Lỗi khi tải danh sách tài khoản cho bộ lọc lịch sử:", err);
      }
    }
    loadAccounts();
    return () => {
      ignore = true;
    };
  }, []);

  // ── Tải dữ liệu lịch sử từ API ──
  useEffect(() => {
    let ignore = false;
    async function loadData() {
      setIsLoading(true);
      try {
        const params = {
          limit: pageSize,
          offset: (currentPage - 1) * pageSize,
        };

        if (searchTerm.trim()) params.search = searchTerm.trim();
        if (selectedAccountUid && selectedAccountUid !== "all") {
          params.account_uid = selectedAccountUid;
        }
        if (selectedFormat !== "all") params.post_type = selectedFormat;
        if (selectedStatus !== "all") params.status = selectedStatus;
        if (selectedDate) params.date = selectedDate;

        const res = await api.get("/api/post/history", { params });
        if (ignore) return;
        const raw = res?.data ?? res;
        const rows = Array.isArray(raw?.data) ? raw.data : (Array.isArray(raw) ? raw : []);
        const total = raw?.total ?? res?.total ?? rows.length;

        setPostHistory(rows);
        setTotalRecords(total);
      } catch (err) {
        console.error("Lỗi khi tải lịch sử đăng bài:", err);
      } finally {
        if (!ignore) setIsLoading(false);
      }
    }
    loadData();
    return () => {
      ignore = true;
    };
  }, [
    currentPage,
    searchTerm,
    selectedAccountUid,
    selectedFormat,
    selectedStatus,
    selectedDate,
    reloadCounter,
  ]);

  const handleCopyUid = (uid) => {
    if (!uid) return;
    navigator.clipboard?.writeText(String(uid));
    setCopiedUid(uid);
    setTimeout(() => setCopiedUid(null), 1800);
  };

  // ── Dọn dẹp nhật ký ──
  const handleCleanup = async () => {
    setIsCleaning(true);
    try {
      await api.post("/api/post/history/cleanup", { days: cleanupDays });
      setShowCleanupModal(false);
      setCurrentPage(1);
      setReloadCounter((c) => c + 1);
      toast.success(`Đã dọn dẹp các bài đăng cũ hơn ${cleanupDays} ngày thành công!`, "DỌN DẸP LỊCH SỬ");
    } catch (err) {
      toast.error("Lỗi khi dọn dẹp lịch sử: " + (err.message || err), "LỖI DỌN DẸP");
    } finally {
      setIsCleaning(false);
    }
  };

  // ── Xuất file CSV (UTF-8 with BOM mở trực tiếp trên Excel tiếng Việt) ──
  const handleExportCsv = useCallback(() => {
    if (postHistory.length === 0) {
      toast.warning("Không có dữ liệu bài đăng để xuất!", "XUẤT DỮ LIỆU");
      return;
    }

    const headers = [
      "STT",
      "Thời gian đăng",
      "Khung giờ hẹn",
      "Tên tài khoản",
      "UID Facebook",
      "Nguồn media/ảnh",
      "Hình thức",
      "Nội dung bài viết (Caption)",
      "Trạng thái",
      "Link Facebook",
      "Lý do lỗi (nếu có)"
    ];

    const csvRows = [headers.join(",")];

    postHistory.forEach((row, idx) => {
      const dt = formatDateTime(row.published_at || row.created_at);
      const statusText = row.status === "PUBLISHED" ? "Đã xuất bản" : row.status === "DIE" ? "Tài khoản chết" : row.status === "BLOCKED" ? "Bị chặn" : "Lỗi hệ thống";
      const cols = [
        `"${String(idx + 1).padStart(2, "0")}"`,
        `"${dt.time} ${dt.date}"`,
        `"${row.schedule_time || ""}"`,
        `"${(row.account_name || "").replace(/"/g, '""')}"`,
        `"${row.account_uid || ""}"`,
        `"${(row.media_path || row.image_path || "").replace(/"/g, '""')}"`,
        `"${row.post_type?.toUpperCase() || ""}"`,
        `"${(row.content || "").replace(/"/g, '""')}"`,
        `"${statusText}"`,
        `"${row.facebook_post_url || ""}"`,
        `"${(row.error_message || "").replace(/"/g, '""')}"`
      ];
      csvRows.push(cols.join(","));
    });

    const csvString = "\uFEFF" + csvRows.join("\r\n");
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Lich_su_dang_bai_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(
      `Xuất thành công ${postHistory.length} bài đăng ra file CSV!`,
      "XUẤT THÀNH CÔNG"
    );
  }, [postHistory, formatDateTime]);

  // ── Xuất file Excel (.xlsx) ──
  const handleExportXlsx = useCallback(async () => {
    if (postHistory.length === 0) {
      toast.warning("Không có dữ liệu bài đăng để xuất!", "XUẤT DỮ LIỆU");
      return;
    }

    try {
      const XLSX = await import("xlsx");
      const headers = [
        "STT",
        "Thời gian đăng",
        "Khung giờ hẹn",
        "Tên tài khoản",
        "UID Facebook",
        "Nguồn media/ảnh",
        "Hình thức",
        "Nội dung bài viết (Caption)",
        "Trạng thái",
        "Link Facebook",
        "Lý do lỗi (nếu có)"
      ];

      const rows = [headers];

      postHistory.forEach((row, idx) => {
        const dt = formatDateTime(row.published_at || row.created_at);
        const statusText =
          row.status === "PUBLISHED"
            ? "Đã xuất bản"
            : row.status === "DIE"
            ? "Tài khoản chết"
            : row.status === "BLOCKED"
            ? "Bị chặn"
            : row.status === "STOPPED"
            ? "Đã dừng"
            : "Lỗi hệ thống";

        rows.push([
          idx + 1,
          `${dt.time} ${dt.date}`,
          row.schedule_time || "",
          row.account_name || "",
          row.account_uid || "",
          row.media_path || row.image_path || "",
          row.post_type?.toUpperCase() || "",
          row.content || "",
          statusText,
          row.facebook_post_url || "",
          row.error_message || ""
        ]);
      });

      const sheet = XLSX.utils.aoa_to_sheet(rows);
      sheet["!cols"] = [
        { wch: 6 },
        { wch: 20 },
        { wch: 15 },
        { wch: 22 },
        { wch: 20 },
        { wch: 35 },
        { wch: 12 },
        { wch: 45 },
        { wch: 16 },
        { wch: 35 },
        { wch: 30 }
      ];
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, "Lich su dang bai");
      XLSX.writeFile(book, `Lich_su_dang_bai_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(
        `Xuất thành công ${postHistory.length} bài đăng ra file Excel!`,
        "XUẤT THÀNH CÔNG"
      );
    } catch (err) {
      toast.error("Lỗi khi xuất file Excel: " + (err.message || err), "KHÔNG XUẤT ĐƯỢC FILE");
    }
  }, [postHistory, formatDateTime]);

  useEffect(() => {
    const onCleanup = () => setShowCleanupModal(true);
    const onExport = (e) => {
      const fmt = e?.detail?.format || "xlsx";
      if (fmt === "csv") {
        handleExportCsv();
      } else {
        handleExportXlsx();
      }
    };
    window.addEventListener("trigger-post-cleanup", onCleanup);
    window.addEventListener("trigger-post-export", onExport);
    return () => {
      window.removeEventListener("trigger-post-cleanup", onCleanup);
      window.removeEventListener("trigger-post-export", onExport);
    };
  }, [handleExportCsv, handleExportXlsx]);

  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

  return (
    <div className="space-y-4">
      {/* ── Filter Bar: Tài khoản, tìm kiếm, Hình thức, Khung giờ, Trạng thái, Ngày ── */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <CustomSelect
          value={selectedAccountUid}
          onChange={(val) => {
            setSelectedAccountUid(val);
            setCurrentPage(1);
          }}
          options={accountOptions}
          className="min-w-[220px] max-w-[320px]"
          buttonClassName="h-10 rounded-lg border-border text-xs text-slate-700 font-medium"
          placeholder="Chọn tài khoản..."
        />

        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-blue-500" />
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Tìm theo nội dung bài viết..."
            className="h-10 w-full rounded-lg border border-blue-200 bg-white pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {/* Dropdown: Hình thức */}
        <CustomSelect
          value={selectedFormat}
          onChange={(val) => {
            setSelectedFormat(val);
            setCurrentPage(1);
          }}
          options={FORMAT_OPTIONS}
          className="min-w-[155px]"
          buttonClassName="h-10 rounded-lg border-border text-xs text-slate-700 font-medium"
        />

        {/* Dropdown: Trạng thái */}
        <CustomSelect
          value={selectedStatus}
          onChange={(val) => {
            setSelectedStatus(val);
            setCurrentPage(1);
          }}
          options={STATUS_OPTIONS}
          className="min-w-[150px]"
          buttonClassName="h-10 rounded-lg border-border text-xs text-slate-700 font-medium"
        />

        {/* Ngày */}
        <div className="relative flex items-center">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => {
              setSelectedDate(e.target.value);
              setCurrentPage(1);
            }}
            className="h-10 px-3 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-700 focus:outline-none focus:border-blue-500 shadow-2xs cursor-pointer"
          />
        </div>
      </div>

      {/* ── Counter: Hiển thị 5 / 3,842 bản ghi ── */}
      <div className="text-xs font-medium text-slate-500 pt-0.5">
        Hiển thị <span className="font-bold text-slate-800">{postHistory.length}</span> / {totalRecords.toLocaleString("vi-VN")} bản ghi
      </div>

      {/* ── Table Card ── */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50 text-[11px] font-bold text-slate-600 tracking-wider">
                <th className="py-3 px-3.5 w-14 text-center">STT</th>
                <th className="py-3 px-4 w-44">THỜI GIAN ĐĂNG</th>
                <th className="py-3 px-4 w-52">TÀI KHOẢN / UID</th>
                <th className="py-3 px-4 min-w-[240px]">HÌNH THỨC & NỘI DUNG</th>
                <th className="py-3 px-4 w-36 text-center">TRẠNG THÁI</th>
                <th className="py-3 px-4 w-24 text-center">THAO TÁC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 size={16} className="animate-spin text-blue-600" />
                      <span>Đang tải lịch sử đăng bài...</span>
                    </div>
                  </td>
                </tr>
              ) : postHistory.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    Không có bản ghi lịch sử đăng bài nào phù hợp với bộ lọc.
                  </td>
                </tr>
              ) : (
                postHistory.map((row, idx) => {
                  const dt = formatDateTime(row.published_at || row.created_at);
                  const stt = String((currentPage - 1) * pageSize + idx + 1).padStart(2, "0");
                  const isPublished = row.status === "PUBLISHED";
                  const pType = (row.post_type || "status").toLowerCase();

                  return (
                    <tr key={row.id || idx} className="hover:bg-slate-50/70 transition-colors">
                      {/* STT */}
                      <td className="py-4 px-3.5 text-center font-bold text-slate-800 font-mono">
                        {stt}
                      </td>

                      {/* THỜI GIAN ĐĂNG */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <div className="font-bold text-slate-900 text-xs tracking-tight">
                          {dt.time}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-slate-600 text-xs">{dt.date}</span>
                          {row.schedule_time && (
                            <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold text-blue-600 bg-blue-50 border border-blue-200/80 font-mono">
                              {row.schedule_time.slice(0, 5)}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* TÀI KHOẢN & NGUỒN */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <div className="font-bold text-slate-900 text-xs tracking-tight">
                          {row.account_name || `Nick ${row.account_uid}`}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span
                            onClick={() => handleCopyUid(row.account_uid)}
                            className="font-mono text-xs text-blue-600 hover:underline cursor-pointer"
                            title="Bấm để sao chép UID"
                          >
                            {row.account_uid}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopyUid(row.account_uid)}
                            className="p-0.5 text-slate-400 hover:text-blue-600 transition-colors cursor-pointer"
                            title="Sao chép UID"
                          >
                            {copiedUid === row.account_uid ? (
                              <Check size={12} className="text-emerald-500" />
                            ) : (
                              <Copy size={12} />
                            )}
                          </button>
                        </div>
                        {(row.media_path || row.image_path) && (
                          <div className="text-[10px] text-slate-400 font-mono truncate max-w-[190px] mt-0.5" title={row.media_path || row.image_path}>
                            📁 {String(row.media_path || row.image_path).split(/[\\/]/).pop()}
                          </div>
                        )}
                      </td>

                      {/* HÌNH THỨC & NỘI DUNG */}
                      <td className="py-4 px-4">
                        <div className="flex flex-col items-start gap-1">
                          {pType === "reels" && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200/90 shadow-2xs">
                              <Video size={13} className="text-blue-600" />
                              <span>Reels</span>
                            </span>
                          )}
                          {pType === "status" && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200/90 shadow-2xs">
                              <FileText size={13} className="text-blue-600" />
                              <span>Status</span>
                            </span>
                          )}
                          {pType === "story" && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200/90 shadow-2xs">
                              <Clock size={13} className="text-blue-600" />
                              <span>Story (24h)</span>
                            </span>
                          )}

                          {row.content && (
                            <p className="text-xs text-slate-600 line-clamp-2 max-w-xs md:max-w-md pt-0.5 leading-relaxed" title={row.content}>
                              {row.content}
                            </p>
                          )}
                        </div>
                      </td>

                      {/* TRẠNG THÁI */}
                      <td className="py-4 px-4 text-center whitespace-nowrap">
                        {isPublished ? (
                          <Badge variant="success" className="gap-1.5 px-3 py-1 rounded-full text-xs font-semibold shadow-2xs">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                            <span>Đã xuất bản</span>
                          </Badge>
                        ) : row.status === "STOPPED" ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-500 shrink-0" />
                            <span>Đã dừng</span>
                          </span>
                        ) : row.status === "DIE" ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800 border border-red-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" />
                            <span>Acc chết</span>
                          </span>
                        ) : row.status === "BLOCKED" ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-600 shrink-0" />
                            <span>Bị chặn</span>
                          </span>
                        ) : (
                          <Badge variant="destructive" className="gap-1.5 px-3 py-1 rounded-full text-xs font-semibold">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                            <span>Lỗi hệ thống</span>
                          </Badge>
                        )}
                      </td>

                      {/* THAO TÁC */}
                      <td className="py-4 px-4 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-2">
                          {(() => {
                            const targetUrl = row.facebook_post_url || (isPublished && row.account_uid ? (row.post_type === 'reels' ? `https://www.facebook.com/${row.account_uid}/reels` : row.post_type === 'story' ? `https://www.facebook.com/stories/${row.account_uid}` : `https://www.facebook.com/${row.account_uid}`) : null);
                            const rowKey = `row-${row.id || row.account_uid}-${targetUrl || ""}`;
                            const isOpening = openingLinkKey === rowKey;
                            return (
                              <button
                                type="button"
                                disabled={!isPublished || !targetUrl || !row.account_uid || Boolean(openingLinkKey)}
                                onClick={() => {
                                  if (targetUrl && row.account_uid) {
                                    openHistoryPostLink(
                                      row.account_uid,
                                      targetUrl,
                                      rowKey,
                                      row.facebook_post_url ? "Mở liên kết bài viết" : "Xem trang cá nhân",
                                    );
                                  }
                                }}
                                className={`p-1 transition-colors ${
                                  isPublished && targetUrl && row.account_uid
                                    ? "text-slate-400 hover:text-blue-600 cursor-pointer"
                                    : "text-slate-300 cursor-not-allowed opacity-30"
                                }`}
                                title={
                                  !isPublished
                                    ? "Không có liên kết (bài chưa xuất bản hoặc bị lỗi)"
                                    : !row.account_uid
                                    ? "Thiếu UID tài khoản — không mở được Chrome profile"
                                    : row.facebook_post_url
                                    ? "Mở bài viết trong Chrome profile nick"
                                    : "Mở trang cá nhân trong Chrome profile nick"
                                }
                              >
                                {isOpening ? <Loader2 size={15} className="animate-spin" /> : <ExternalLink size={15} />}
                              </button>
                            );
                          })()}
                          <button
                            type="button"
                            onClick={() => setSelectedDetailPost(row)}
                            className="p-1 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                            title="Xem chi tiết (Info)"
                          >
                            <Info size={15} />
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
      </div>

      {/* ── Pagination Footer: Hiển thị 05 / 3,842 kết quả ── */}
      <div className="flex items-center justify-between flex-wrap gap-3 pt-2 text-xs">
        <div className="text-slate-500 font-medium">
          Hiển thị <span className="font-bold text-slate-800">{String(postHistory.length).padStart(2, "0")}</span> / {totalRecords.toLocaleString("vi-VN")} kết quả
        </div>

        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      </div>

      {/* ── Modal Chi tiết Bài viết (Info Dialog theo UC-M03-10) ── */}
      {selectedDetailPost && (() => {
        const postDateObj = formatDateTime(selectedDetailPost.published_at || selectedDetailPost.updated_at || selectedDetailPost.created_at);
        const actualTimeStr = `${postDateObj.time} ${postDateObj.date}`;
        const scheduleLabel = selectedDetailPost.schedule_time && selectedDetailPost.schedule_time !== "all" && selectedDetailPost.schedule_time !== "Ngay lập tức"
          ? `Hẹn: ${selectedDetailPost.schedule_time}`
          : "Ngay lập tức";

        const isPublished = selectedDetailPost.status === "PUBLISHED";
        const isError = !isPublished;
        const statusImagePaths = normalizeImagePaths(selectedDetailPost);
        const postUrl = selectedDetailPost.facebook_post_url;
        const profileUrl = selectedDetailPost.account_uid ? `https://www.facebook.com/${selectedDetailPost.account_uid}` : null;

        // Parse logs
        const rawLogs = selectedDetailPost.logs;
        let logsList = [];
        if (Array.isArray(rawLogs)) {
          logsList = rawLogs;
        } else if (typeof rawLogs === "string") {
          try {
            const parsed = JSON.parse(rawLogs);
            if (Array.isArray(parsed)) logsList = parsed;
          } catch { }
        }

        if (logsList.length === 0) {
          const timeStr = formatDateTime(selectedDetailPost.created_at).time;
          logsList.push({
            timestamp: timeStr,
            thread: "System",
            type: "info",
            message: `Khởi tạo tiến trình đăng ${selectedDetailPost.post_type?.toUpperCase()} cho tài khoản ${selectedDetailPost.account_name || selectedDetailPost.account_uid}`
          });
          if (selectedDetailPost.media_path) {
            const fileName = selectedDetailPost.media_path.replace(/\\/g, '/').split('/').pop();
            logsList.push({
              timestamp: timeStr,
              thread: "Thread-01",
              type: "info",
              message: `Tệp đính kèm: ${fileName}`
            });
          } else if (statusImagePaths.length > 0) {
            logsList.push({
              timestamp: timeStr,
              thread: "Thread-01",
              type: "info",
              message: `Ảnh Status đính kèm (${statusImagePaths.length}): ${statusImagePaths
                .map((p) => String(p).replace(/\\/g, "/").split("/").pop())
                .join(", ")}`,
            });
          }
          if (isPublished) {
            logsList.push({
              timestamp: formatDateTime(selectedDetailPost.published_at || selectedDetailPost.updated_at).time,
              thread: "Thread-01",
              type: "success",
              message: `XUẤT BẢN THÀNH CÔNG! Link: ${selectedDetailPost.facebook_post_url || 'Đã lưu trên Facebook'}`
            });
          } else if (selectedDetailPost.status === "STOPPED") {
            logsList.push({
              timestamp: formatDateTime(selectedDetailPost.updated_at).time,
              thread: "System",
              type: "warn",
              message: `[ĐÃ DỪNG] ${selectedDetailPost.error_message || 'Tiến trình đã dừng theo yêu cầu của người dùng.'}`
            });
          } else if (selectedDetailPost.error_message) {
            logsList.push({
              timestamp: formatDateTime(selectedDetailPost.updated_at).time,
              thread: "Thread-01",
              type: "error",
              message: `[${selectedDetailPost.status || 'FAILED'}] ${humanizePostError(selectedDetailPost.error_message)}`
            });
          }
        }

        return (
          <div
            className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
            onClick={(e) => {
              if (e.target === e.currentTarget) setSelectedDetailPost(null);
            }}
          >
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-xl w-full overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
              {/* Header */}
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-200/60 flex items-center justify-center text-blue-600">
                    <Info size={16} />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-slate-900 leading-tight">Chi tiết nhật ký bài đăng</h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">Mã phiên: #{selectedDetailPost.id || selectedDetailPost._id || "N/A"}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedDetailPost(null)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                  title="Đóng (Esc)"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Scrollable Body */}
              <div className="p-5 space-y-4 overflow-y-auto text-xs">
                {/* 🔹 Phần 1: Header thông tin định danh & thời gian (Grid 2 cột) */}
                <div className="grid grid-cols-2 gap-3 p-3.5 bg-slate-50/90 rounded-2xl border border-slate-100">
                  {/* Tài khoản thực thi */}
                  <div className="space-y-0.5">
                    <span className="text-slate-400 block text-[10px] font-semibold uppercase tracking-wider">Tài khoản thực thi</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-slate-800 text-xs truncate max-w-[160px]" title={selectedDetailPost.account_name}>
                        {selectedDetailPost.account_name || "Chưa đặt tên"}
                      </span>
                      {selectedDetailPost.account_uid && (
                        <div className="flex items-center gap-1 bg-white px-1.5 py-0.5 rounded-md border border-slate-200 text-[10px] font-mono text-slate-600">
                          <span>{selectedDetailPost.account_uid}</span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(selectedDetailPost.account_uid);
                              setCopiedUid(selectedDetailPost.account_uid);
                              setTimeout(() => setCopiedUid(null), 2000);
                              toast.success("Đã chép UID tài khoản");
                            }}
                            className="text-slate-400 hover:text-blue-600 transition-colors p-0.5 cursor-pointer"
                            title="Sao chép UID"
                          >
                            {copiedUid === selectedDetailPost.account_uid ? (
                              <Check size={11} className="text-emerald-500" />
                            ) : (
                              <Copy size={11} />
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Trạng thái */}
                  <div className="space-y-0.5 text-right">
                    <span className="text-slate-400 block text-[10px] font-semibold uppercase tracking-wider">Trạng thái</span>
                    <div>
                      {selectedDetailPost.status === "PUBLISHED" ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                          <span>Đã xuất bản</span>
                        </span>
                      ) : selectedDetailPost.status === "STOPPED" ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                          <span>Đã dừng</span>
                        </span>
                      ) : selectedDetailPost.status === "DIE" ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-800 border border-red-300">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" />
                          <span>Acc chết</span>
                        </span>
                      ) : selectedDetailPost.status === "BLOCKED" ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-600 shrink-0" />
                          <span>Bị chặn</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                          <span>Lỗi hệ thống</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Hình thức & Khung giờ */}
                  <div className="space-y-0.5 pt-1.5 border-t border-slate-200/60">
                    <span className="text-slate-400 block text-[10px] font-semibold uppercase tracking-wider">Hình thức & Khung giờ</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      {selectedDetailPost.post_type === "reels" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          <Video size={11} />
                          <span>REELS</span>
                        </span>
                      ) : selectedDetailPost.post_type === "story" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-pink-50 text-pink-700 border border-pink-200">
                          <FileText size={11} />
                          <span>STORY</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                          <FileText size={11} />
                          <span>STATUS</span>
                        </span>
                      )}
                      <span className="text-[11px] font-medium text-slate-600 flex items-center gap-1">
                        <Clock size={11} className="text-slate-400" />
                        <span>{scheduleLabel}</span>
                      </span>
                    </div>
                  </div>

                  {/* Thời gian thực tế */}
                  <div className="space-y-0.5 pt-1.5 border-t border-slate-200/60 text-right">
                    <span className="text-slate-400 block text-[10px] font-semibold uppercase tracking-wider">Thời gian thực tế</span>
                    <div className="font-mono text-[11px] text-slate-700 flex items-center justify-end gap-1">
                      <Calendar size={11} className="text-slate-400" />
                      <span>{actualTimeStr}</span>
                    </div>
                  </div>
                </div>

                {/* 🔹 Phần 2: Toàn văn nội dung bài viết (Full Caption - Không cắt `...`) */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 font-bold text-xs flex items-center gap-1.5">
                      <FileText size={13} className="text-slate-500" />
                      <span>Toàn văn nội dung (Full Caption)</span>
                    </span>
                    {selectedDetailPost.content && (
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(selectedDetailPost.content);
                          toast.success("Đã sao chép nội dung bài viết");
                        }}
                        className="text-[11px] text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <Copy size={11} />
                        <span>Sao chép</span>
                      </button>
                    )}
                  </div>
                  <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-200/80 whitespace-pre-wrap font-sans text-xs text-slate-800 leading-relaxed max-h-44 overflow-y-auto selection:bg-blue-100">
                    {selectedDetailPost.content ? (
                      selectedDetailPost.content
                    ) : (
                      <span className="text-slate-400 italic font-sans">(Không có nội dung văn bản)</span>
                    )}
                  </div>
                </div>

                {/* 🔹 Phần 2b: Hình ảnh Status đã đăng (image_path / image_paths) */}
                {statusImagePaths.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 font-bold text-xs flex items-center gap-1.5">
                        <ImageIcon size={13} className="text-slate-500" />
                        <span>Hình ảnh đã đăng</span>
                        <span className="text-[10px] font-normal text-slate-400 font-mono">
                          ({statusImagePaths.length}/3)
                        </span>
                      </span>
                    </div>
                    <div
                      className={`grid gap-2 ${
                        statusImagePaths.length === 1
                          ? "grid-cols-1 max-w-[180px]"
                          : statusImagePaths.length === 2
                            ? "grid-cols-2"
                            : "grid-cols-3"
                      }`}
                    >
                      {statusImagePaths.map((path) => (
                        <HistoryStatusImageCard key={path} path={path} />
                      ))}
                    </div>
                  </div>
                )}

                {/* 🔹 Phần 2c: Đường dẫn Media nguồn Reels/Story (Nếu có) */}
                {selectedDetailPost.media_path && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 font-bold text-xs flex items-center gap-1.5">
                        <Video size={13} className="text-slate-500" />
                        <span>Đường dẫn tệp nguồn (Media Path)</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(selectedDetailPost.media_path);
                          setCopiedMedia(true);
                          setTimeout(() => setCopiedMedia(false), 2000);
                          toast.success("Đã sao chép đường dẫn file");
                        }}
                        className="text-[11px] text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        {copiedMedia ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                        <span>{copiedMedia ? "Đã chép" : "Sao chép đường dẫn"}</span>
                      </button>
                    </div>
                    <div className="p-2.5 bg-slate-100/90 border border-slate-200 rounded-xl font-mono text-[11px] text-slate-700 break-all select-all">
                      {selectedDetailPost.media_path}
                    </div>
                  </div>
                )}

                {/* Thông báo lỗi nếu có */}
                {selectedDetailPost.error_message && selectedDetailPost.status !== "STOPPED" && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5">
                    <AlertCircle size={16} className="text-rose-500 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <span className="font-bold text-rose-800 block text-xs">Thông báo lỗi:</span>
                      <p className="text-rose-700 text-[11px] leading-relaxed break-words">
                        {humanizePostError(selectedDetailPost.error_message)}
                      </p>
                    </div>
                  </div>
                )}

                {/* 🔹 Phần 3: Nhật ký thực thi (Execution Logs) */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-slate-700 font-bold text-xs">
                      <Terminal size={14} className="text-blue-600" />
                      <span>Nhật ký thực thi (Execution Logs)</span>
                      <span className="text-[10px] text-slate-400 font-normal font-mono">({logsList.length} sự kiện)</span>
                    </div>
                    {isPublished && (
                      <button
                        type="button"
                        onClick={() => setShowSuccessLogs((prev) => !prev)}
                        className="text-[11px] text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                      >
                        {showSuccessLogs ? "Thu gọn" : "Xem nhật ký kỹ thuật"}
                      </button>
                    )}
                  </div>

                  {(isError || showSuccessLogs) && (
                    <div className="bg-[#0f172a] rounded-xl p-3.5 border border-slate-800 font-mono text-[11px] max-h-48 overflow-y-auto space-y-1.5 shadow-inner">
                      {logsList.map((log, idx) => {
                        const rawMsg = String(log.message || "");
                        const isErrLine =
                          log.type === "error" || /\[(FAILED|DIE|BLOCKED|ERROR)\]/i.test(rawMsg);
                        const prefix = (rawMsg.match(/^\[[^\]]+\]/) || [""])[0];
                        const body = rawMsg.replace(/^\[[^\]]+\]\s*/, "");
                        const displayMsg = isErrLine
                          ? `${prefix} ${humanizePostError(body || rawMsg)}`.trim()
                          : rawMsg;
                        return (
                        <div key={idx} className="flex items-start gap-2 leading-relaxed font-mono">
                          <span className="text-slate-500 shrink-0 select-none">[{log.timestamp || "--:--:--"}]</span>
                          {log.thread && <span className="text-cyan-400 shrink-0 font-semibold">[{log.thread}]</span>}
                          <span className={
                            log.type === "error"
                              ? "text-rose-400 break-all"
                              : log.type === "warn"
                              ? "text-amber-300"
                              : log.type === "success"
                              ? "text-emerald-400 font-semibold"
                              : "text-slate-200"
                          }>
                            {displayMsg}
                          </span>
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* 🔹 Phần 4: Footer Action Buttons (Theo chuẩn BR-M03-HIS-01) */}
              <div className="p-3.5 px-5 bg-slate-50/70 border-t border-slate-100 flex items-center justify-between shrink-0">
                <div>
                  {isPublished && postUrl ? (
                    <button
                      type="button"
                      disabled={!selectedDetailPost.account_uid || Boolean(openingLinkKey)}
                      onClick={() =>
                        openHistoryPostLink(
                          selectedDetailPost.account_uid,
                          postUrl,
                          `detail-post-${selectedDetailPost.id}`,
                          "Mở liên kết bài viết",
                        )
                      }
                      className="px-3.5 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-colors border border-blue-200 cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                      title="Mở bài viết trong Chrome profile nick đã đăng nhập"
                    >
                      {openingLinkKey === `detail-post-${selectedDetailPost.id}` ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <ExternalLink size={13} />
                      )}
                      <span>Mở liên kết bài viết</span>
                    </button>
                  ) : profileUrl ? (
                    <button
                      type="button"
                      disabled={!selectedDetailPost.account_uid || Boolean(openingLinkKey)}
                      onClick={() =>
                        openHistoryPostLink(
                          selectedDetailPost.account_uid,
                          profileUrl,
                          `detail-profile-${selectedDetailPost.id}`,
                          "Xem trang cá nhân",
                        )
                      }
                      className="px-3.5 py-2 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-colors border border-slate-200 cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                      title="Mở trang cá nhân trong Chrome profile nick đã đăng nhập"
                    >
                      {openingLinkKey === `detail-profile-${selectedDetailPost.id}` ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <ExternalLink size={13} />
                      )}
                      <span>Xem trang cá nhân Facebook</span>
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedDetailPost(null)}
                  className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Modal Dọn Dẹp Nhật Ký ── */}
      {showCleanupModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-2">
              <Eraser size={18} className="text-blue-600" />
              <h3 className="font-bold text-sm text-slate-900">Dọn dẹp nhật ký đăng bài</h3>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Xóa bớt các bài đăng lịch sử cũ để tối ưu dung lượng cơ sở dữ liệu. Dữ liệu bị xóa sẽ không thể phục hồi.
            </p>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 block">
                Xóa bài đăng cũ hơn:
              </label>
              <CustomSelect
                value={cleanupDays}
                onChange={(val) => setCleanupDays(Number(val))}
                options={CLEANUP_OPTIONS}
                className="w-full"
                buttonClassName="h-9 px-3 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 bg-white"
                dropdownClassName="rounded-xl border-slate-200 shadow-lg text-xs"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowCleanupModal(false)}
                className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={isCleaning}
                onClick={handleCleanup}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isCleaning && <Loader2 size={13} className="animate-spin" />}
                <span>Xác nhận dọn dẹp</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
