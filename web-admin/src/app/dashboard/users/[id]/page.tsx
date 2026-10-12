"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, User, ActivityLog } from "@/lib/api";
import {
  ArrowLeft,
  RotateCw,
  Zap,
  Lock,
  Unlock,
  Trash2,
  Copy,
  Calendar as CalendarIcon,
  Info,
  ShieldCheck,
  User as UserIcon,
  CheckCircle2,
} from "lucide-react";
import ApprovalModal from "@/components/ApprovalModal";
import "./user-detail.css";

// 1st SVG from Figma: User avatar icon inside badge
function FigmaUserAvatarIcon() {
  return (
    <svg width="23" height="23" viewBox="0 0 23 23" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M11.3333 11.3333C9.775 11.3333 8.44097 10.7785 7.33125 9.66875C6.22153 8.55903 5.66667 7.225 5.66667 5.66667C5.66667 4.10833 6.22153 2.77431 7.33125 1.66458C8.44097 0.554861 9.775 0 11.3333 0C12.8917 0 14.2257 0.554861 15.3354 1.66458C16.4451 2.77431 17 4.10833 17 5.66667C17 7.225 16.4451 8.55903 15.3354 9.66875C14.2257 10.7785 12.8917 11.3333 11.3333 11.3333ZM0 22.6667V18.7C0 17.8972 0.206597 17.1594 0.619792 16.4865C1.03299 15.8135 1.58194 15.3 2.26667 14.9458C3.73056 14.2139 5.21806 13.6649 6.72917 13.299C8.24028 12.933 9.775 12.75 11.3333 12.75C12.8917 12.75 14.4264 12.933 15.9375 13.299C17.4486 13.6649 18.9361 14.2139 20.4 14.9458C21.0847 15.3 21.6337 15.8135 22.0469 16.4865C22.4601 17.1594 22.6667 17.8972 22.6667 18.7V22.6667H0ZM2.83333 19.8333H19.8333V18.7C19.8333 18.4403 19.7684 18.2042 19.6385 17.9917C19.5087 17.7792 19.3375 17.6139 19.125 17.4958C17.85 16.8583 16.5632 16.3802 15.2646 16.0615C13.966 15.7427 12.6556 15.5833 11.3333 15.5833C10.0111 15.5833 8.7007 15.7427 7.40208 16.0615C6.10347 16.3802 4.81667 16.8583 3.54167 17.4958C3.32917 17.6139 3.15799 17.7792 3.02813 17.9917C2.89826 18.2042 2.83333 18.4403 2.83333 18.7V19.8333ZM11.3333 8.5C12.1125 8.5 12.7795 8.22257 13.3344 7.66771C13.8892 7.11285 14.1667 6.44583 14.1667 5.66667C14.1667 4.8875 13.8892 4.22049 13.3344 3.66563C12.7795 3.11076 12.1125 2.83333 11.3333 2.83333C10.5542 2.83333 9.88715 3.11076 9.33229 3.66563C8.77743 4.22049 8.5 4.8875 8.5 5.66667C8.5 6.44583 8.77743 7.11285 9.33229 7.66771C9.88715 8.22257 10.5542 8.5 11.3333 8.5Z"
        fill="#2563EB"
      />
    </svg>
  );
}

// 2nd SVG from Figma: Activity history header icon
function FigmaHistoryIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M0 5.83333V0.833333H1.66667V2.79167C2.375 1.90278 3.23958 1.21528 4.26042 0.729167C5.28125 0.243056 6.36111 0 7.5 0C9.58333 0 11.3542 0.729167 12.8125 2.1875C14.2708 3.64583 15 5.41667 15 7.5H13.3333C13.3333 5.875 12.7674 4.49653 11.6354 3.36458C10.5035 2.23264 9.125 1.66667 7.5 1.66667C6.54167 1.66667 5.64583 1.88889 4.8125 2.33333C3.97917 2.77778 3.27778 3.38889 2.70833 4.16667H5V5.83333H0ZM0.0416667 8.33333H1.75C1.91667 9.625 2.44792 10.7188 3.34375 11.6146C4.23958 12.5104 5.3125 13.0556 6.5625 13.25L7.5625 15C5.64583 15 3.96528 14.3646 2.52083 13.0938C1.07639 11.8229 0.25 10.2361 0.0416667 8.33333ZM8.625 9.79167L6.66667 7.83333V3.33333H8.33333V7.16667L9.5 8.33333L8.625 9.79167ZM12.4792 17.5L12.2292 16.25C12.0625 16.1806 11.9062 16.1076 11.7604 16.0312C11.6146 15.9549 11.4653 15.8611 11.3125 15.75L10.1042 16.125L9.27083 14.7083L10.2292 13.875C10.2014 13.6944 10.1875 13.5139 10.1875 13.3333C10.1875 13.1528 10.2014 12.9722 10.2292 12.7917L9.27083 11.9583L10.1042 10.5417L11.3125 10.9167C11.4653 10.8056 11.6146 10.7118 11.7604 10.6354C11.9062 10.559 12.0625 10.4861 12.2292 10.4167L12.4792 9.16667H14.1458L14.3958 10.4167C14.5625 10.4861 14.7222 10.566 14.875 10.6562C15.0278 10.7465 15.1736 10.8472 15.3125 10.9583L16.5208 10.5417L17.3542 12L16.3958 12.8333C16.4236 13.0139 16.4375 13.1875 16.4375 13.3542C16.4375 13.5208 16.4236 13.6944 16.3958 13.875L17.3542 14.7083L16.5208 16.125L15.3125 15.75C15.1597 15.8611 15.0104 15.9549 14.8646 16.0312C14.7188 16.1076 14.5625 16.1806 14.3958 16.25L14.1458 17.5H12.4792ZM13.3125 15C13.7708 15 14.1632 14.8368 14.4896 14.5104C14.816 14.184 14.9792 13.7917 14.9792 13.3333C14.9792 12.875 14.816 12.4826 14.4896 12.1562C14.1632 11.8299 13.7708 11.6667 13.3125 11.6667C12.8542 11.6667 12.4618 11.8299 12.1354 12.1562C11.809 12.4826 11.6458 12.875 11.6458 13.3333C11.6458 13.7917 11.809 14.184 12.1354 14.5104C12.4618 14.8368 12.8542 15 13.3125 15Z"
        fill="#2563EB"
      />
    </svg>
  );
}

function getPageNumbers(current: number, total: number): (number | string)[] {
  if (total <= 5) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  if (current <= 3) {
    return [1, 2, 3, "...", total];
  }
  if (current >= total - 2) {
    return [1, "...", total - 2, total - 1, total];
  }
  return [1, "...", current, "...", total];
}

export default function UserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params?.id ? Number(params.id) : null;

  const [user, setUser] = useState<User | null>(null);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [isExtendModalOpen, setIsExtendModalOpen] = useState(false);
  const [isApproveModalOpen, setIsApproveModalOpen] = useState(false);
  const [logPage, setLogPage] = useState(1);
  const [logPageSize, setLogPageSize] = useState(5);

  const loadUserDetail = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [users, logsData] = await Promise.all([
        api.getUsers(),
        api.getActivityLogs(200).catch(() => [] as ActivityLog[]),
      ]);
      const found = users.find((u) => u.id === userId);
      if (found) setUser(found);
      if (logsData) {
        const userLogs = logsData.filter(
          (l) => l.target_uid === userId || (found && l.target_username === found.username)
        );
        setActivityLogs(userLogs);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUserDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (loading) {
    return <div className="ud-loading">Đang tải thông tin người dùng...</div>;
  }

  if (!user) {
    return (
      <div className="ud-not-found">
        <h2>Không tìm thấy người dùng</h2>
        <Link href="/dashboard/users" className="ud-back-link">
          <ArrowLeft className="w-3.5 h-3.5" /> Quay lại danh sách
        </Link>
      </div>
    );
  }

  const copyHwid = (hwidStr: string) => {
    if (!hwidStr) return;
    navigator.clipboard.writeText(hwidStr);
  };

  const handleResetHwid = async () => {
    if (!confirm(`Reset HWID của ${user.username}? Thiết bị hiện tại sẽ bị hủy liên kết.`)) return;
    setActionLoading(true);
    try {
      await api.resetHwid(user.id);
      await loadUserDetail();
    } catch (e: any) {
      alert(e.message || "Lỗi khi reset HWID");
    } finally {
      setActionLoading(false);
    }
  };

  const handleBan = async () => {
    if (!confirm(`Khóa tài khoản ${user.username}?`)) return;
    setActionLoading(true);
    try {
      await api.banUser(user.id);
      await loadUserDetail();
    } catch (e: any) {
      alert(e.message || "Lỗi khi khóa tài khoản");
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnban = async () => {
    if (!confirm(`Mở khóa tài khoản ${user.username}?`)) return;
    setActionLoading(true);
    try {
      const res: any = await api.unbanUser(user.id);
      await loadUserDetail();
      const statusMap: Record<string, string> = {
        pending: "Chờ duyệt",
        approved: "Đã duyệt",
        rejected: "Bị từ chối",
        expired: "Hết hạn",
      };
      const restoredName = (res && res.status && statusMap[res.status]) || "";
      window.dispatchEvent(
        new CustomEvent("app_toast", {
          detail: {
            msg: restoredName
              ? `Đã mở khóa và khôi phục trạng thái: ${restoredName}`
              : "Đã mở khóa tài khoản thành công",
            type: "success",
          },
        })
      );
    } catch (e: any) {
      alert(e.message || "Lỗi khi mở khóa");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`CẢNH BÁO: XÓA VĨNH VIỄN tài khoản ${user.username}? Không thể hoàn tác.`)) return;
    setActionLoading(true);
    try {
      await api.deleteUser(user.id);
      router.push("/dashboard/users");
    } catch (e: any) {
      alert(e.message || "Lỗi khi xóa tài khoản");
      setActionLoading(false);
    }
  };

  const formatUtcDateTime = (dateStr?: string | null): string => {
    if (!dateStr) return "—";
    const s = dateStr.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(dateStr) ? dateStr : `${dateStr}Z`;
    const d = new Date(s);
    const validDate = isNaN(d.getTime()) ? new Date(dateStr) : d;
    if (isNaN(validDate.getTime())) return dateStr;

    const day = String(validDate.getDate()).padStart(2, "0");
    const month = String(validDate.getMonth() + 1).padStart(2, "0");
    const year = validDate.getFullYear();
    const hours = String(validDate.getHours()).padStart(2, "0");
    const minutes = String(validDate.getMinutes()).padStart(2, "0");

    return `${day}/${month}/${year} ${hours}:${minutes}`;
  };

  const formatUtcDateOnly = (dateStr?: string | null): string => {
    if (!dateStr) return "Chưa cấp";
    const s = dateStr.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(dateStr) ? dateStr : `${dateStr}Z`;
    const d = new Date(s);
    const validDate = isNaN(d.getTime()) ? new Date(dateStr) : d;
    if (isNaN(validDate.getTime())) return dateStr;

    const day = String(validDate.getDate()).padStart(2, "0");
    const month = String(validDate.getMonth() + 1).padStart(2, "0");
    const year = validDate.getFullYear();

    return `${day}/${month}/${year}`;
  };

  const expiryFormatted = formatUtcDateOnly(user.expired_at);

  const isExpired = user.status === "expired" || (user.days_remaining !== null && user.days_remaining <= 0);
  const daysRemainingText =
    isExpired
      ? "(Đã hết hạn)"
      : user.days_remaining !== null && user.days_remaining > 0
      ? `(Còn ${user.days_remaining} ngày)`
      : "";

  const createdAtFormatted = user.created_at
    ? `${formatUtcDateTime(user.created_at)} (Đăng ký từ Web Client)`
    : "—";

  const displayUid = `#${String(user.id).padStart(5, "0")}`;

  const statusLabel =
    user.status === "approved" ? "Đã duyệt"
    : user.status === "pending" ? "Chờ duyệt"
    : user.status === "rejected" ? "Bị từ chối"
    : user.status === "banned" ? "Bị khóa"
    : user.status === "expired" ? "Hết hạn"
    : user.status;

  const getTimestamp = (dateStr?: string | null): number => {
    if (!dateStr) return 0;
    const s = dateStr.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(dateStr) ? dateStr : `${dateStr}Z`;
    const d = new Date(s).getTime();
    return isNaN(d) ? new Date(dateStr).getTime() || 0 : d;
  };

  const regTime = getTimestamp(user.created_at);

  const dbLogItems = activityLogs.map((log) => {
    const rawTime = getTimestamp(log.created_at);
    let action = log.action_type;
    let info = log.change_detail || "—";
    let tone: "green" | "amber" | "red" | "blue" | "slate" = "blue";

    if (log.action_type === "ban_user") {
      action = "Khóa người dùng";
      info = "Thay đổi trạng thái sang Đã khoá";
      tone = "red";
    } else if (log.action_type === "unban_user") {
      action = "Mở khóa người dùng";
      info = "Mở khóa và khôi phục trạng thái tài khoản";
      tone = "green";
    } else if (log.action_type === "reset_hwid") {
      action = "Reset HWID";
      info = log.change_detail ? `HWID mới: ${log.change_detail}` : "Đã reset HWID";
      tone = "blue";
    } else if (log.action_type === "approve_user") {
      action = "Duyệt người dùng";
      info = log.change_detail || "Cấp license sử dụng";
      tone = "green";
    } else if (log.action_type === "extend_license") {
      action = "Gia hạn license";
      info = log.change_detail || "Gia hạn thời hạn sử dụng";
      tone = "green";
    } else if (log.action_type === "reject_user") {
      action = "Từ chối đăng ký";
      info = log.change_detail || "Từ chối tài khoản";
      tone = "red";
    } else if (log.action_type === "delete_user") {
      action = "Xóa người dùng";
      info = log.change_detail || "Xóa tài khoản khỏi hệ thống";
      tone = "red";
    }

    return {
      id: `db-${log.id}`,
      time: log.created_at ? formatUtcDateTime(log.created_at) : "—",
      rawTime,
      action,
      tone,
      info,
      executor: log.admin_username || "admin",
    };
  });

  const hasBanLog = dbLogItems.some((l) => l.action === "Khóa người dùng");
  const fallbackBanLog =
    user.status === "banned" && !hasBanLog
      ? [
          {
            id: "fallback-ban",
            time: formatUtcDateTime(user.created_at || new Date().toISOString()),
            rawTime: regTime + 2000,
            action: "Khóa người dùng",
            tone: "red" as const,
            info: "Thay đổi trạng thái sang Đã khoá",
            executor: "admin",
          },
        ]
      : [];

  const baseRegLog = user.created_at
    ? [
        {
          id: "base-reg",
          time: formatUtcDateTime(user.created_at),
          rawTime: regTime,
          action: "Đăng ký tài khoản",
          tone: "slate" as const,
          info: "Tạo tài khoản mới",
          executor: user.username,
        },
      ]
    : [];

  const logs = [...dbLogItems, ...fallbackBanLog, ...baseRegLog].sort((a, b) => b.rawTime - a.rawTime);

  const totalLogItems = logs.length;
  const totalLogPages = Math.max(1, Math.ceil(totalLogItems / logPageSize));
  const safeLogPage = Math.min(logPage, totalLogPages);
  const paginatedLogs = logs.slice(
    (safeLogPage - 1) * logPageSize,
    safeLogPage * logPageSize
  );
  const logRangeStart = totalLogItems === 0 ? 0 : (safeLogPage - 1) * logPageSize + 1;
  const logRangeEnd = Math.min(safeLogPage * logPageSize, totalLogItems);

  return (
    <div className="ud-container">
      {/* Top Bar Navigation */}
      <div className="ud-top-bar">
        <Link href="/dashboard/users" className="ud-back-link">
          <ArrowLeft className="w-3.5 h-3.5 text-blue-600" />
          Quay lại danh sách
        </Link>
        <div className="ud-title-row">
          <div className="ud-title-group">
            <h1 className="ud-title">Chi tiết người dùng</h1>
            <div className="ud-uid-badge">
              <span className="ud-uid-label">UID:</span>
              <span className="ud-uid-value">{displayUid}</span>
            </div>
          </div>
          <button type="button" onClick={loadUserDetail} className="ud-sync-btn">
            <RotateCw className="w-3.5 h-3.5 text-blue-600" />
            <span>Đồng bộ dữ liệu</span>
          </button>
        </div>
      </div>

      <div className="ud-grid">
        {/* LEFT COLUMN: Info Card + Activity Logs */}
        <div className="ud-main-col">
          {/* Card 1: User Info Card */}
          <div className="ud-card ud-card--user">
            <div className="ud-card-glow" />

            <div className="ud-user-header">
              <div className="ud-user-header-left">
                <div className="ud-avatar">
                  <FigmaUserAvatarIcon />
                  {user.is_online && <span className="ud-avatar-online" />}
                </div>
                <div className="ud-user-name-group">
                  <h2 className="ud-username">{user.username}</h2>
                  <span className={`ud-status-pill ud-status-pill--${user.status}`}>
                    <span className="ud-status-dot" />
                    {statusLabel}
                  </span>
                </div>
              </div>
            </div>

            <div className="ud-info-box">
              {/* Row 1: Username & Contact Info */}
              <div className="ud-info-row">
                <div className="ud-info-col">
                  <span className="ud-info-label">USERNAME</span>
                  <span className="ud-info-val ud-info-val--username">{user.username}</span>
                </div>
                <div className="ud-info-col">
                  <span className="ud-info-label">THÔNG TIN LIÊN HỆ</span>
                  <span className="ud-info-val">{user.contact_info || "—"}</span>
                </div>
              </div>

              {/* Row 2: HWID & Role */}
              <div className="ud-info-row">
                <div className="ud-info-col">
                  <span className="ud-info-label">HWID (MÃ THIẾT BỊ)</span>
                  <div className="ud-hwid-group">
                    {user.hwid ? (
                      <>
                        <div className="ud-hwid-box" title={user.hwid}>
                          <span className="ud-hwid-text">
                            {user.hwid.length > 16 ? `${user.hwid.slice(0, 12)}...` : user.hwid}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyHwid(user.hwid!)}
                          className="ud-hwid-copy-btn"
                          title="Copy HWID"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <span className="ud-empty-text">Chưa liên kết</span>
                    )}
                  </div>
                </div>
                <div className="ud-info-col">
                  <span className="ud-info-label">ROLE</span>
                  <div>
                    <span className="ud-role-badge">USER</span>
                  </div>
                </div>
              </div>

              {/* Row 3: Status & Expiration */}
              <div className="ud-info-row">
                <div className="ud-info-col">
                  <span className="ud-info-label">TRẠNG THÁI</span>
                  <div>
                    <span className={`ud-status-pill ud-status-pill--${user.status}`}>
                      <span className="ud-status-dot" />
                      {statusLabel}
                    </span>
                  </div>
                </div>
                <div className="ud-info-col">
                  <span className="ud-info-label">HẾT HẠN</span>
                  <div className="ud-expiry-group">
                    <CalendarIcon className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                    <span className="ud-expiry-date">{expiryFormatted}</span>
                    {daysRemainingText && (
                      <span className="ud-days-remaining">{daysRemainingText}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Row 4: Created At */}
              <div className="ud-info-footer">
                <span className="ud-info-label">NGÀY TẠO TÀI KHOẢN</span>
                <span className="ud-info-created">{createdAtFormatted}</span>
              </div>
            </div>
          </div>

          {/* Card 2: Activity Logs Card */}
          <div className="ud-card ud-card--logs">
            <div className="ud-logs-header">
              <div className="ud-logs-title-group">
                <div className="ud-logs-icon-box">
                  <FigmaHistoryIcon />
                </div>
                <h3 className="ud-card-title">Lịch sử hoạt động</h3>
              </div>
              <span className="ud-logs-count">{totalLogItems} sự kiện ghi nhận</span>
            </div>

            <div className="ud-table-wrapper">
              <table className="ud-table">
                <thead>
                  <tr>
                    <th>THỜI GIAN</th>
                    <th>HÀNH ĐỘNG</th>
                    <th>THÔNG TIN</th>
                    <th>NGƯỜI THỰC HIỆN</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedLogs.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: "center", padding: "24px 16px", color: "#94a3b8", fontSize: "13px" }}>
                        Chưa có lịch sử hoạt động
                      </td>
                    </tr>
                  ) : (
                    paginatedLogs.map((log, index) => (
                      <tr key={log.id} className={index === 0 && safeLogPage === 1 ? "ud-row-highlight" : ""}>
                        <td className="ud-table-time">{log.time}</td>
                        <td>
                          <span className={`ud-log-pill ud-log-pill--${log.tone}`}>
                            <span className="ud-log-dot" />
                            {log.action}
                          </span>
                        </td>
                        <td className="ud-table-info">
                          {log.info.startsWith("HWID mới:") ? (
                            <>
                              <span style={{ color: "#94A3B8" }}>HWID mới: </span>
                              <span className="ud-table-info-hwid">{log.info.replace("HWID mới:", "").trim()}</span>
                            </>
                          ) : (
                            log.info
                          )}
                        </td>
                        <td className="ud-table-executor">
                          {log.executor ? (
                            <span
                              className={`ud-executor-tag${
                                log.executor !== "admin" ? " ud-executor-tag--user" : ""
                              }`}
                            >
                              {log.executor === "admin" ? (
                                <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                              ) : (
                                <UserIcon className="w-3.5 h-3.5 text-slate-500" />
                              )}
                              <span>{log.executor}</span>
                            </span>
                          ) : (
                            <span className="ud-dash">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              <div className="ud-logs-footer">
                <p className="ud-logs-footer-text">
                  Hiển thị{" "}
                  <span className="ud-logs-footer-strong">
                    {logRangeStart} - {logRangeEnd}
                  </span>{" "}
                  của <span className="ud-logs-footer-strong">{totalLogItems}</span> sự kiện
                  {totalLogPages > 0 && (
                    <span className="ud-logs-footer-page-info">
                      {" "}(Trang <span className="ud-logs-footer-strong">{safeLogPage} / {totalLogPages}</span>)
                    </span>
                  )}
                </p>

                <div className="ud-logs-footer-controls">
                  <div className="ud-logs-page-size">
                    <select
                      value={logPageSize}
                      onChange={(e) => {
                        setLogPageSize(Number(e.target.value));
                        setLogPage(1);
                      }}
                    >
                      {[5, 10, 20].map((n) => (
                        <option key={n} value={n}>
                          {n} / trang
                        </option>
                      ))}
                    </select>
                    <img
                      src="/icons/users-chevron-sm-down.svg"
                      alt=""
                      className="ud-logs-page-size-chevron"
                    />
                  </div>

                  <div className="ud-logs-pager">
                    <button
                      type="button"
                      disabled={safeLogPage <= 1}
                      onClick={() => setLogPage(safeLogPage - 1)}
                      className="ud-logs-pager-btn"
                      title="Trang trước"
                    >
                      <img src="/icons/users-chevron-left.svg" alt="" width={5} height={9} />
                    </button>
                    {getPageNumbers(safeLogPage, totalLogPages).map((p, idx) =>
                      typeof p === "number" ? (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setLogPage(p)}
                          className={`ud-logs-pager-btn ${
                            p === safeLogPage ? "ud-logs-pager-btn--current" : ""
                          }`}
                        >
                          {p}
                        </button>
                      ) : (
                        <span key={`ellipsis-${idx}`} className="ud-logs-pager-ellipsis">
                          ...
                        </span>
                      )
                    )}
                    <button
                      type="button"
                      disabled={safeLogPage >= totalLogPages}
                      onClick={() => setLogPage(safeLogPage + 1)}
                      className="ud-logs-pager-btn"
                      title="Trang sau"
                    >
                      <img src="/icons/users-chevron-right.svg" alt="" width={5} height={9} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Action Stack + Admin Notice */}
        <div className="ud-side-col">
          {/* Card 3: Actions Card */}
          <div className="ud-card ud-card--actions">
            <div className="ud-actions-header">
              <h3 className="ud-card-title">Hành động</h3>
              <span className="ud-active-dot" />
            </div>
            <p className="ud-actions-desc">
              Thao tác trực tiếp quyền hạn, thiết bị HWID và trạng thái cấp phép cho tài khoản này.
            </p>
            <div className="ud-actions-stack">
              <button
                type="button"
                onClick={() => {
                  if (user.status === "pending") {
                    window.dispatchEvent(
                      new CustomEvent("app_toast", {
                        detail: {
                          msg: "Tài khoản đang chờ duyệt. Vui lòng phê duyệt tài khoản trước khi gia hạn.",
                          type: "error",
                        },
                      })
                    );
                    return;
                  }
                  setIsExtendModalOpen(true);
                }}
                disabled={actionLoading || user.status === "banned" || user.status === "rejected" || user.status === "pending"}
                title={
                  user.status === "pending"
                    ? "Tài khoản đang chờ duyệt. Vui lòng phê duyệt tài khoản trước khi gia hạn."
                    : user.status === "banned"
                    ? "Tài khoản đang bị khóa"
                    : user.status === "rejected"
                    ? "Tài khoản đang bị từ chối"
                    : undefined
                }
                className={`ud-btn ud-btn--renew ${
                  user.status === "banned" || user.status === "rejected" || user.status === "pending"
                    ? "opacity-50 cursor-not-allowed"
                    : ""
                }`}
              >
                <Zap className="w-4 h-4 fill-white stroke-none" />
                <span>Gia hạn</span>
              </button>
              <button
                type="button"
                onClick={handleResetHwid}
                disabled={actionLoading || user.status === "banned" || user.status === "rejected"}
                title={
                  user.status === "banned"
                    ? "Tài khoản đang bị khóa"
                    : user.status === "rejected"
                    ? "Tài khoản đang bị từ chối"
                    : undefined
                }
                className={`ud-btn ud-btn--reset ${
                  user.status === "banned" || user.status === "rejected" ? "opacity-50 cursor-not-allowed" : ""
                }`}
              >
                <RotateCw className="w-4 h-4 text-blue-600" />
                <span>Reset HWID</span>
              </button>
              {user.status === "banned" ? (
                <button
                  type="button"
                  onClick={handleUnban}
                  disabled={actionLoading}
                  className="ud-btn ud-btn--lock"
                >
                  <Unlock className="w-4 h-4" />
                  <span>Mở khóa người dùng</span>
                </button>
              ) : user.status === "rejected" ? (
                <button
                  type="button"
                  onClick={() => setIsApproveModalOpen(true)}
                  disabled={actionLoading}
                  className="ud-btn ud-btn--approve"
                >
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <span>Phê duyệt lại</span>
                </button>
              ) : (
                <>
                  {user.status === "pending" && (
                    <button
                      type="button"
                      onClick={() => setIsApproveModalOpen(true)}
                      disabled={actionLoading}
                      className="ud-btn ud-btn--approve"
                    >
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      <span>Phê duyệt người dùng</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleBan}
                    disabled={actionLoading}
                    className="ud-btn ud-btn--lock"
                  >
                    <Lock className="w-4 h-4" />
                    <span>Khóa người dùng</span>
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={handleDelete}
                disabled={actionLoading}
                className="ud-btn ud-btn--delete"
              >
                <Trash2 className="w-4 h-4 text-[#BE123C]" />
                <span>Xoá tài khoản</span>
              </button>
            </div>
          </div>

          {/* Card 4: Admin Notice Card */}
          <div className="ud-card ud-card--note">
            <div className="ud-note-header">
              <Info className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
              <h4 className="ud-note-title">Lưu ý quản trị</h4>
            </div>
            <p className="ud-note-text">
              Mỗi lượt <strong>Reset HWID</strong> sẽ hủy liên kết phần cứng ngay tức thì trên tool người dùng. Giới hạn 2 lần reset trong chu kỳ 30 ngày đối với tài khoản tiêu chuẩn.
            </p>
            <div className="ud-note-footer">
              <span className="ud-note-footer-label">Lần reset gần nhất:</span>
              <span className="ud-note-date">
                {user.last_hwid_reset_at
                  ? formatUtcDateTime(user.last_hwid_reset_at)
                  : "Chưa reset lần nào"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <ApprovalModal
        user={isExtendModalOpen || isApproveModalOpen ? user : null}
        mode={isExtendModalOpen ? "extend" : "approve"}
        onClose={() => {
          setIsExtendModalOpen(false);
          setIsApproveModalOpen(false);
        }}
        onSuccess={loadUserDetail}
      />
    </div>
  );
}
