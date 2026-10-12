"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { api, ActivityLog } from "@/lib/api";
import {
  ActivityLogItem,
  ActivityLogModal,
} from "./components/ActivityLogModal";
import "./notifications.css";

// Map admin role -> badge color
function getBadgeColor(role: string): "blue" | "green" | "gray" {
  const r = (role || "").toLowerCase();
  if (r === "superadmin") return "blue";
  if (r === "admin") return "green";
  return "gray";
}

// Map admin username -> initials badge
function getBadge(username: string): string {
  if (!username) return "?";
  const m = username.match(/^([a-zA-Z]+?)(\d+)$/);
  if (m) return (m[1][0] + m[2]).toUpperCase().slice(0, 2);
  return username.slice(0, 2).toUpperCase();
}

// Map action_type -> display name
function getActionName(actionType: string): string {
  const map: Record<string, string> = {
    approve_user: "Duyệt người dùng",
    extend_license: "Gia hạn license",
    ban_user: "Khóa người dùng",
    unban_user: "Mở khóa người dùng",
    reset_hwid: "Reset HWID",
    reset_password: "Reset Pass Admin",
    login: "Đăng nhập Admin",
    add_admin: "Thêm Admin",
    delete_user: "Xóa người dùng",
    reject_user: "Từ chối đăng ký",
    create_user: "Tạo người dùng",
    edit_user: "Chỉnh sửa tài khoản",
    other: "Hệ thống",
  };
  return map[actionType] || actionType;
}

function formatApiDate(iso: string) {
  try {
    const s = iso.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
    const dt = new Date(s);
    const valid = isNaN(dt.getTime()) ? new Date(iso) : dt;
    return isNaN(valid.getTime())
      ? iso
      : valid.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  } catch {
    return iso;
  }
}

function mapActivityLogToItem(log: ActivityLog): ActivityLogItem {
  const isDangerAction = ["ban_user", "delete_user", "reject_user"].includes(log.action_type);
  const isDangerDetail =
    isDangerAction ||
    (log.change_detail || "").toLowerCase().includes("banned") ||
    (log.change_detail || "").toLowerCase().includes("rejected");

  return {
    id: `LOG-${String(log.id).padStart(4, "0")}`,
    timestamp: formatApiDate(log.created_at),
    rawDate: log.created_at,
    admin: {
      username: log.admin_username || "unknown",
      badge: getBadge(log.admin_username || "?"),
      badgeColor: getBadgeColor(log.admin_role || ""),
      role:
        log.admin_role === "superadmin"
          ? "Super Admin"
          : log.admin_role === "admin"
          ? "Admin"
          : log.admin_role || "Unknown",
    },
    action: {
      name: getActionName(log.action_type),
      type: (log.action_type as ActivityLogItem["action"]["type"]) || "other",
    },
    target: log.target_username
      ? {
          name: log.target_username,
          subtext: log.target_uid
            ? `UID: #${String(log.target_uid).padStart(5, "0")}`
            : log.target_role
            ? `Role: ${log.target_role}`
            : undefined,
          isLink: !["admin", "superadmin"].includes(log.target_role || ""),
          userId: log.target_uid || undefined,
        }
      : { name: "—" },
    changeDetail: {
      text: log.change_detail || "—",
      isDanger: isDangerDetail,
    },
    result: log.result === "failed" ? "failed" : "success",
    ip: log.ip_address || "—",
    userAgent: log.user_agent || "—",
    note: log.note || undefined,
  };
}

function ActivityLogsContent() {
  const searchParams = useSearchParams();
  const [logs, setLogs] = useState<ActivityLogItem[]>([]);
  const [adminUsernames, setAdminUsernames] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAdmin, setSelectedAdmin] = useState("all");
  const [selectedAction, setSelectedAction] = useState("all");
  const [selectedResult, setSelectedResult] = useState("all");
  const [dateRange, setDateRange] = useState<"today" | "7d" | "30d" | "custom">("7d");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  const isDateRangeInvalid = Boolean(
    dateRange === "custom" &&
    customStartDate &&
    customEndDate &&
    customEndDate < customStartDate
  );

  // Pagination
  const [perPage, setPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  // Detail Modal
  const [activeLog, setActiveLog] = useState<ActivityLogItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Synchronize URL search params (?search=..., ?admin=..., ?admin_id=...)
  useEffect(() => {
    const q = searchParams.get("search") || searchParams.get("q") || "";
    const adm = searchParams.get("admin") || searchParams.get("admin_username") || "";
    const admId = searchParams.get("admin_id") || "";
    const action = searchParams.get("action") || "";

    const query = q || adm || (admId ? `#${admId}` : "");
    if (query) {
      setSearchQuery(query);
      setDateRange("30d");
      setCurrentPage(1);
    }
    if (action) {
      setSelectedAction(action);
      setCurrentPage(1);
    }
  }, [searchParams]);

  // Fetch real data from backend /activity-logs API
  const fetchLiveLogs = async () => {
    setLoading(true);
    try {
      const [activityLogs, admins] = await Promise.all([
        api.getActivityLogs(200),
        api.getAdmins().catch(() => null),
      ]);
      setAdminUsernames(Array.isArray(admins) ? admins.map((u) => u.username) : null);
      if (Array.isArray(activityLogs) && activityLogs.length > 0) {
        setLogs(activityLogs.map(mapActivityLogToItem));
      } else {
        setLogs([]);
      }
    } catch {
      setLogs([]);
    } finally {
      setTimeout(() => setLoading(false), 300);
    }
  };

  useEffect(() => {
    fetchLiveLogs();
  }, []);

  // Reset filters
  const handleResetFilters = () => {
    setSearchQuery("");
    setSelectedAdmin("all");
    setSelectedAction("all");
    setSelectedResult("all");
    setDateRange("7d");
    setCustomStartDate("");
    setCustomEndDate("");
    setCurrentPage(1);
  };

  // Filtered logs
  const filteredLogs = useMemo(() => {
    // Khoảng ngày không hợp lệ thì không trả dữ liệu, tránh hiển thị/xuất log không đúng ý định lọc
    if (isDateRangeInvalid) return [];

    return logs.filter((item) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const cleanDigits = q.replace(/\D/g, "");
        const matchAdmin = item.admin.username.toLowerCase().includes(q);
        const matchTarget = item.target.name.toLowerCase().includes(q);
        const matchSub = (item.target.subtext || "").toLowerCase().includes(q);
        const matchAction = item.action.name.toLowerCase().includes(q);
        const matchDetail = item.changeDetail.text.toLowerCase().includes(q);
        const matchId = String(item.id).toLowerCase().includes(q);
        const matchTargetUid = Boolean(cleanDigits && item.target.userId && String(item.target.userId) === cleanDigits);
        if (!matchAdmin && !matchTarget && !matchSub && !matchAction && !matchDetail && !matchId && !matchTargetUid) {
          return false;
        }
      }

      // 2. Admin Filter
      if (selectedAdmin !== "all" && item.admin.username !== selectedAdmin) {
        return false;
      }

      // 3. Action Filter
      if (selectedAction !== "all") {
        if (item.action.type !== selectedAction && item.action.name !== selectedAction) {
          return false;
        }
      }

      // 4. Result Filter
      if (selectedResult !== "all" && item.result !== selectedResult) {
        return false;
      }

      // 5. Date filter
      if (dateRange === "today") {
        const d = new Date(item.rawDate);
        const now = new Date();
        if (
          d.getFullYear() !== now.getFullYear() ||
          d.getMonth() !== now.getMonth() ||
          d.getDate() !== now.getDate()
        ) {
          return false;
        }
      } else if (dateRange === "7d") {
        const d = new Date(item.rawDate).getTime();
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        if (d < weekAgo) return false;
      } else if (dateRange === "30d") {
        const d = new Date(item.rawDate).getTime();
        const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        if (d < monthAgo) return false;
      } else if (dateRange === "custom") {
        const itemTime = new Date(item.rawDate).getTime();
        if (customStartDate) {
          const startTime = new Date(customStartDate + "T00:00:00").getTime();
          if (itemTime < startTime) return false;
        }
        if (customEndDate) {
          const endTime = new Date(customEndDate + "T23:59:59").getTime();
          if (itemTime > endTime) return false;
        }
      }

      return true;
    });
  }, [logs, searchQuery, selectedAdmin, selectedAction, selectedResult, dateRange, customStartDate, customEndDate, isDateRangeInvalid]);

  // Pagination calculation
  const totalItems = filteredLogs.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  const validCurrentPage = Math.min(currentPage, totalPages);

  const paginatedLogs = useMemo(() => {
    const start = (validCurrentPage - 1) * perPage;
    return filteredLogs.slice(start, start + perPage);
  }, [filteredLogs, validCurrentPage, perPage]);

  // Export to CSV/Excel
  const handleExportCSV = () => {
    const headers = [
      "Mã nhật ký",
      "Thời gian",
      "Admin",
      "Vai trò",
      "Hành động",
      "Đối tượng",
      "Chi tiết thay đổi",
      "Kết quả",
      "Địa chỉ IP",
      "Thiết bị",
      "Ghi chú",
    ];

    const rows = filteredLogs.map((item) => [
      `"${item.id}"`,
      `"${item.timestamp}"`,
      `"${item.admin.username}"`,
      `"${item.admin.role}"`,
      `"${item.action.name}"`,
      `"${item.target.name} ${item.target.subtext || ""}"`,
      `"${item.changeDetail.text.replace(/"/g, '""')}"`,
      `"${item.result === "success" ? "Thành công" : "Thất bại"}"`,
      `"${item.ip || ""}"`,
      `"${item.userAgent || ""}"`,
      `"${item.note || ""}"`,
    ]);

    const csvContent =
      "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `Nhat_ky_hoat_dong_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleOpenDetail = (log: ActivityLogItem) => {
    setActiveLog(log);
    setIsModalOpen(true);
  };

  // Lấy từ API để có cả admin chưa phát sinh log; chỉ suy từ log khi API admin lỗi
  const logAdminUsernames = Array.from(new Set(logs.map((l) => l.admin.username)));
  const adminOptions = adminUsernames ?? logAdminUsernames;
  // Admin đã bị xóa nhưng còn log: vẫn cho lọc, không tính vào tổng để khớp màn Quản lý Admin
  const deletedAdminOptions = adminUsernames
    ? logAdminUsernames.filter((u) => !adminUsernames.includes(u))
    : [];

  return (
    <div className="act-page">
      {/* ── 1. Page Header ── */}
      <div className="act-header">
        <div className="act-header-titles">
          <h1 className="act-title">NHẬT KÝ HOẠT ĐỘNG</h1>
          <p className="act-subtitle">
            Theo dõi và đối soát mọi thao tác quản trị được thực hiện trong hệ thống FB Tool.
          </p>
        </div>

        <div className="act-header-actions">
          <button
            type="button"
            className="act-btn-export"
            onClick={handleExportCSV}
            disabled={isDateRangeInvalid}
            title={isDateRangeInvalid ? "Khoảng ngày không hợp lệ" : undefined}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path
                d="M9.33 1.33H3.33C2.6 1.33 2 1.93 2 2.67V13.33C2 14.07 2.6 14.67 3.33 14.67H12.67C13.4 14.67 14 14.07 14 13.33V6L9.33 1.33Z"
                stroke="#424656"
                strokeWidth="1.33"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M9.33 1.33V6H14"
                stroke="#424656"
                strokeWidth="1.33"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M8 12V8.67M8 12L6.33 10.33M8 12L9.67 10.33"
                stroke="#424656"
                strokeWidth="1.33"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Xuất CSV/Excel</span>
          </button>

          <button
            type="button"
            className={`act-btn-refresh ${loading ? "act-btn-refresh--loading" : ""}`}
            onClick={fetchLiveLogs}
            disabled={loading}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M13.65 6.67A6 6 0 1 0 14 8h-1.67A4.33 4.33 0 1 1 12 5.53L10.33 7.2h5.34V1.87L13.65 3.53Z"
                fill="currentColor"
              />
            </svg>
            <span>{loading ? "Đang tải..." : "Làm mới nhật ký"}</span>
          </button>
        </div>
      </div>

      {/* ── 2. Filter Box Card (Figma 1:1) ── */}
      <div className="act-filter-card">
        {/* Row 1: Search + 3 Dropdowns */}
        <div className="act-filter-row-1">
          <div className="act-search-wrap">
            <span className="act-search-icon">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <circle cx="6.67" cy="6.67" r="5" stroke="#424656" strokeWidth="1.33" />
                <path d="M10.33 10.33L14.67 14.67" stroke="#424656" strokeWidth="1.33" strokeLinecap="round" />
              </svg>
            </span>
            <input
              type="text"
              className="act-search-input"
              placeholder="Tìm Admin, User, UID hoặc hành động..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>

          {/* Dropdown 1: Admin Filter */}
          <div className="act-dropdown-wrap">
            <select
              className="act-select"
              value={selectedAdmin}
              onChange={(e) => {
                setSelectedAdmin(e.target.value);
                setCurrentPage(1);
              }}
            >
              <option value="all">Tất cả Admin ({adminOptions.length})</option>
              {adminOptions.map((admin) => (
                <option key={admin} value={admin}>
                  {admin}
                </option>
              ))}
              {deletedAdminOptions.map((admin) => (
                <option key={`deleted-${admin}`} value={admin}>
                  {admin} (đã xóa)
                </option>
              ))}
            </select>
            <span className="act-select-arrow">
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
                <path d="M1 1L5 5L9 1" stroke="#424656" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>

          {/* Dropdown 2: Action Filter */}
          <div className="act-dropdown-wrap">
            <select
              className="act-select"
              value={selectedAction}
              onChange={(e) => {
                setSelectedAction(e.target.value);
                setCurrentPage(1);
              }}
            >
              <option value="all">Tất cả hành động</option>
              <option value="reset_hwid">Reset HWID</option>
              <option value="approve_user">Duyệt người dùng</option>
              <option value="extend_license">Gia hạn license</option>
              <option value="ban_user">Khóa người dùng</option>
              <option value="unban_user">Mở khóa người dùng</option>
              <option value="reset_password">Reset Pass Admin</option>
              <option value="login">Đăng nhập Admin</option>
              <option value="add_admin">Thêm Admin</option>
              <option value="delete_user">Xóa người dùng</option>
              <option value="reject_user">Từ chối đăng ký</option>
              <option value="create_user">Tạo người dùng</option>
              <option value="edit_user">Chỉnh sửa tài khoản</option>
            </select>
            <span className="act-select-arrow">
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
                <path d="M1 1L5 5L9 1" stroke="#424656" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>

          {/* Dropdown 3: Result Filter */}
          <div className="act-dropdown-wrap">
            <select
              className="act-select"
              value={selectedResult}
              onChange={(e) => {
                setSelectedResult(e.target.value);
                setCurrentPage(1);
              }}
            >
              <option value="all">Tất cả kết quả</option>
              <option value="success">Thành công</option>
              <option value="failed">Thất bại</option>
            </select>
            <span className="act-select-arrow">
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
                <path d="M1 1L5 5L9 1" stroke="#424656" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        </div>

        {/* Row 2: Date Pills + Reset Button */}
        <div className="act-filter-row-2">
          <div className="act-date-pills">
            <button
              type="button"
              className={`act-date-pill ${dateRange === "today" ? "act-date-pill--active" : ""}`}
              onClick={() => {
                setDateRange("today");
                setCurrentPage(1);
              }}
            >
              Hôm nay
            </button>
            <button
              type="button"
              className={`act-date-pill ${dateRange === "7d" ? "act-date-pill--active" : ""}`}
              onClick={() => {
                setDateRange("7d");
                setCurrentPage(1);
              }}
            >
              7 ngày qua
            </button>
            <button
              type="button"
              className={`act-date-pill ${dateRange === "30d" ? "act-date-pill--active" : ""}`}
              onClick={() => {
                setDateRange("30d");
                setCurrentPage(1);
              }}
            >
              30 ngày qua
            </button>
            <button
              type="button"
              className={`act-date-pill ${dateRange === "custom" ? "act-date-pill--active" : ""}`}
              onClick={() => {
                setDateRange("custom");
                setCurrentPage(1);
              }}
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                <rect x="1.5" y="2.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M4 1.5V3.5M10 1.5V3.5M1.5 5.5H12.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <span>Tùy chọn ngày</span>
            </button>

            {dateRange === "custom" && (
              <div className="act-custom-date-box">
                <span className="act-custom-date-label">Từ:</span>
                <input
                  type="date"
                  className={`act-custom-date-input ${isDateRangeInvalid ? "has-error" : ""}`}
                  value={customStartDate}
                  max={customEndDate || undefined}
                  onChange={(e) => {
                    setCustomStartDate(e.target.value);
                    setCurrentPage(1);
                  }}
                />
                <span className="act-custom-date-label">Đến:</span>
                <input
                  type="date"
                  className={`act-custom-date-input ${isDateRangeInvalid ? "has-error" : ""}`}
                  value={customEndDate}
                  min={customStartDate || undefined}
                  onChange={(e) => {
                    setCustomEndDate(e.target.value);
                    setCurrentPage(1);
                  }}
                />
                {(customStartDate || customEndDate) && (
                  <button
                    type="button"
                    className="act-custom-date-clear"
                    onClick={() => {
                      setCustomStartDate("");
                      setCustomEndDate("");
                      setCurrentPage(1);
                    }}
                    title="Xóa khoảng ngày"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}

            {isDateRangeInvalid && (
              <div className="act-custom-date-error" role="alert">
                <AlertCircle size={13} className="shrink-0" />
                <span>Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu</span>
              </div>
            )}
          </div>

          <button
            type="button"
            className="act-btn-reset-filter"
            onClick={handleResetFilters}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path
                d="M2.5 8A5.5 5.5 0 1 1 8 13.5M2.5 8H6M2.5 8V4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Đặt lại bộ lọc</span>
          </button>
        </div>
      </div>

      {/* ── 3. Main Activity Table Card (Figma 1:1) ── */}
      <div className="act-table-card">
        <div className="act-table-responsive">
          <table className="act-table">
            <thead>
              <tr>
                <th className="act-th">THỜI GIAN</th>
                <th className="act-th">ADMIN</th>
                <th className="act-th">HÀNH ĐỘNG</th>
                <th className="act-th">ĐỐI TƯỢNG</th>
                <th className="act-th">CHI TIẾT THAY ĐỔI</th>
                <th className="act-th">KẾT QUẢ</th>
                <th className="act-th" style={{ textAlign: "right" }}>
                  THAO TÁC
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7}>
                    <div className="act-empty">
                      <span>Đang tải dữ liệu...</span>
                    </div>
                  </td>
                </tr>
              ) : paginatedLogs.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="act-empty">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="#CBD5E1" strokeWidth="1.5" />
                        <path d="M12 7V12M12 16H12.01" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      <span>
                        {isDateRangeInvalid
                          ? "Khoảng ngày không hợp lệ"
                          : logs.length === 0
                          ? "Chưa có nhật ký hoạt động nào. Hãy thực hiện một số thao tác quản trị để tạo nhật ký."
                          : "Không tìm thấy nhật ký hoạt động nào phù hợp với bộ lọc"}
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedLogs.map((item) => (
                  <tr key={item.id} className="act-tr">
                    {/* 1. Thời gian */}
                    <td className="act-td act-time">{item.timestamp}</td>

                    {/* 2. Admin */}
                    <td className="act-td">
                      <div className="act-admin-cell">
                        <span className={`act-avatar act-avatar--${item.admin.badgeColor}`}>
                          {item.admin.badge}
                        </span>
                        <span className="act-admin-name">{item.admin.username}</span>
                      </div>
                    </td>

                    {/* 3. Hành động */}
                    <td className="act-td">
                      <span className={`act-pill act-pill--${item.action.type}`}>
                        {item.action.name}
                      </span>
                    </td>

                    {/* 4. Đối tượng */}
                    <td className="act-td">
                      <div className="act-target-cell">
                        {item.target.isLink && item.target.userId ? (
                          <Link
                            href={`/dashboard/users/${item.target.userId}`}
                            className="act-target-name hover:underline"
                          >
                            {item.target.name}
                          </Link>
                        ) : (
                          <span
                            className={`act-target-name ${
                              !item.target.isLink ? "act-target-name--admin" : ""
                            }`}
                          >
                            {item.target.name}
                          </span>
                        )}
                        {item.target.subtext && (
                          <span className="act-target-sub">{item.target.subtext}</span>
                        )}
                      </div>
                    </td>

                    {/* 5. Chi tiết thay đổi */}
                    <td className="act-td">
                      <div
                        className={`act-detail ${
                          item.changeDetail.isDanger ? "act-detail-danger" : ""
                        }`}
                      >
                        {item.changeDetail.text}
                      </div>
                    </td>

                    {/* 6. Kết quả */}
                    <td className="act-td">
                      {item.result === "success" ? (
                        <span className="act-result act-result--success">
                          ✓ Thành công
                        </span>
                      ) : (
                        <span className="act-result act-result--failed">
                          ✕ Thất bại
                        </span>
                      )}
                    </td>

                    {/* 7. Thao tác */}
                    <td className="act-td" style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="act-btn-detail"
                        onClick={() => handleOpenDetail(item)}
                      >
                        Xem chi tiết
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ── 4. Pagination Footer ── */}
        <div className="act-pagination-bar">
          <div className="act-pagination-left">
            <span>
              Hiển thị{" "}
              <strong>
                {totalItems === 0
                  ? 0
                  : (validCurrentPage - 1) * perPage + 1}
                {" - "}
                {Math.min(validCurrentPage * perPage, totalItems)}
              </strong>{" "}
              trên tổng số <strong>{totalItems}</strong> bản ghi
            </span>

            <div className="flex items-center gap-1.5 ml-2">
              <span>Xem</span>
              <select
                className="act-per-page-select"
                value={perPage}
                onChange={(e) => {
                  setPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
              >
                <option value={10}>10 / trang</option>
                <option value={20}>20 / trang</option>
                <option value={50}>50 / trang</option>
              </select>
            </div>
          </div>

          <div className="act-pagination-controls">
            <button
              type="button"
              className="act-page-btn"
              disabled={validCurrentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              aria-label="Trang trước"
            >
              ‹
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => {
              if (
                pageNum === 1 ||
                pageNum === totalPages ||
                (pageNum >= validCurrentPage - 1 && pageNum <= validCurrentPage + 1)
              ) {
                return (
                  <button
                    key={pageNum}
                    type="button"
                    className={`act-page-btn ${
                      pageNum === validCurrentPage ? "act-page-btn--active" : ""
                    }`}
                    onClick={() => setCurrentPage(pageNum)}
                  >
                    {pageNum}
                  </button>
                );
              }
              if (
                pageNum === validCurrentPage - 2 ||
                pageNum === validCurrentPage + 2
              ) {
                return (
                  <span key={pageNum} className="act-page-ellipsis">
                    ...
                  </span>
                );
              }
              return null;
            })}

            <button
              type="button"
              className="act-page-btn"
              disabled={validCurrentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Trang tiếp theo"
            >
              ›
            </button>
          </div>
        </div>
      </div>

      {/* ── Detail Modal Dialog ── */}
      {isModalOpen && (
        <ActivityLogModal
          isOpen={isModalOpen}
          log={activeLog}
          onClose={() => {
            setIsModalOpen(false);
            setActiveLog(null);
          }}
        />
      )}
    </div>
  );
}

export default function ActivityLogsPage() {
  return (
    <Suspense
      fallback={
        <div className="act-page" style={{ padding: 48, textAlign: "center", color: "#64748b" }}>
          Đang tải nhật ký hoạt động...
        </div>
      }
    >
      <ActivityLogsContent />
    </Suspense>
  );
}
