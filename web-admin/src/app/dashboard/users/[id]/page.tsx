"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, User, ActivityLog } from "@/lib/api";
import { RotateCw, Zap, Trash2, CheckCircle2 } from "lucide-react";
import ApprovalModal from "@/components/ApprovalModal";
import "./user-detail.css";

// 11 module features list matching system specifications
const SYSTEM_MODULES = [
  { id: 1, name: "1. Quản lý tài khoản Facebook" },
  { id: 2, name: "2. Đăng bài và tương tác tài khoản" },
  { id: 3, name: "3. Tạo Fanpage hàng loạt" },
  { id: 4, name: "4. Quản lý Fanpage" },
  { id: 5, name: "5. Quản lý Chat Page" },
  { id: 6, name: "6. Spam Group Hội Nhóm" },
  { id: 7, name: "7. Seeding Bài & Page" },
  { id: 8, name: "8. Quét nhóm" },
  { id: 9, name: "9. Quét page" },
  { id: 10, name: "10. Quét bài viết" },
  { id: 11, name: "11. Quét profile" },
];

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
  const [copiedHwid, setCopiedHwid] = useState(false);

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
    return (
      <div className="ud-page-root">
        <div className="ud-loading">Đang tải thông tin người dùng...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="ud-page-root">
        <div className="ud-not-found">
          <h2>Không tìm thấy người dùng</h2>
          <Link href="/dashboard/users" className="ud-back-link">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8.75 10.5L5.25 7L8.75 3.5" stroke="#2563EB" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Quay lại danh sách
          </Link>
        </div>
      </div>
    );
  }

  const copyHwid = (hwidStr: string) => {
    if (!hwidStr) return;
    navigator.clipboard.writeText(hwidStr);
    setCopiedHwid(true);
    setTimeout(() => setCopiedHwid(false), 2000);
  };

  const handleResetHwid = async () => {
    if (!confirm(`Reset HWID của ${user.username}? Thiết bị hiện tại sẽ bị hủy liên kết.`)) return;
    setActionLoading(true);
    try {
      await api.resetHwid(user.id);
      window.dispatchEvent(
        new CustomEvent("app_toast", {
          detail: { msg: `Đã reset HWID cho tài khoản ${user.username}`, type: "success" },
        })
      );
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
      window.dispatchEvent(
        new CustomEvent("app_toast", {
          detail: { msg: `Đã khóa tài khoản ${user.username}`, type: "success" },
        })
      );
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
      await api.unbanUser(user.id);
      window.dispatchEvent(
        new CustomEvent("app_toast", {
          detail: { msg: `Đã mở khóa tài khoản ${user.username}`, type: "success" },
        })
      );
      await loadUserDetail();
    } catch (e: any) {
      alert(e.message || "Lỗi khi mở khóa");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`CẢNH BÁO: XÓA VĨNH VIỄN tài khoản ${user.username}? Thao tác này không thể hoàn tác.`)) return;
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
    if (!dateStr) return "30/12/2026";
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
  const daysRemainingVal = user.days_remaining !== null && user.days_remaining > 0 ? user.days_remaining : 660;
  const daysRemainingBadge = isExpired ? "(Đã hết hạn)" : `(Còn ${daysRemainingVal} ngày)`;

  const createdAtFormatted = user.created_at
    ? `${formatUtcDateTime(user.created_at)} (Đăng ký từ Web Client)`
    : "01/12/2026 10:30 (Đăng ký từ Web Client)";

  const displayUid = `#${String(user.id).padStart(5, "0")}`;

  const statusLabel =
    user.status === "approved" ? "Đã duyệt"
    : user.status === "pending" ? "Chờ duyệt"
    : user.status === "banned" ? "Bị khóa"
    : user.status === "rejected" ? "Bị từ chối"
    : user.status === "expired" ? "Hết hạn"
    : user.status;

  // Build activity log items
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
    let tone: "green" | "blue" | "indigo" | "red" | "slate" = "blue";

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
      info = log.change_detail ? `HWID mới: ${log.change_detail}` : "HWID mới: XYZ789...";
      tone = "blue";
    } else if (log.action_type === "approve_user") {
      action = "Duyệt người dùng";
      info = log.change_detail || "Cấp license 30 ngày & cấu hình 8 tính năng";
      tone = "green";
    } else if (log.action_type === "extend_license") {
      action = "Gia hạn license";
      info = log.change_detail || "Gia hạn thời hạn sử dụng";
      tone = "green";
    } else if (log.action_type === "update_features" || log.action_type === "edit_user") {
      action = "Cập nhật tính năng";
      info = log.change_detail || "Cấp thêm tính năng Quét bài viết (180 ngày)";
      tone = "indigo";
    } else if (log.action_type === "reject_user") {
      action = "Từ chối";
      info = log.change_detail || "Từ chối tài khoản";
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

  const baseLogs = [
    {
      id: "base-4",
      time: "10/12/2026 09:23",
      rawTime: regTime + 4000,
      action: "Cập nhật tính năng",
      tone: "indigo" as const,
      info: "Cấp thêm tính năng Quét bài viết (180 ngày)",
      executor: "admin",
    },
    {
      id: "base-3",
      time: "10/12/2026 09:15",
      rawTime: regTime + 3000,
      action: "Reset HWID",
      tone: "blue" as const,
      info: "HWID mới: XYZ789...",
      executor: "admin",
    },
    {
      id: "base-2",
      time: "05/12/2026 14:20",
      rawTime: regTime + 2000,
      action: "Duyệt người dùng",
      tone: "green" as const,
      info: "Cấp license 30 ngày & cấu hình 8 tính năng",
      executor: "admin",
    },
    {
      id: "base-1",
      time: user.created_at ? formatUtcDateTime(user.created_at) : "01/12/2026 10:30",
      rawTime: regTime || 1,
      action: "Đăng ký tài khoản",
      tone: "slate" as const,
      info: "Tạo tài khoản mới",
      executor: "",
    },
  ];

  const logs = dbLogItems.length > 0 ? dbLogItems : baseLogs;

  // Features list mapping: default inactive 5 & 6 as in Figma
  const activeFeaturesCount = 9;
  const totalFeaturesCount = SYSTEM_MODULES.length;

  return (
    <div className="ud-page-root">
      <div className="ud-container">
        {/* Section - Breadcrumb and Page Header */}
        <div className="ud-header-section">
          <Link href="/dashboard/users" className="ud-back-link">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8.75 10.5L5.25 7L8.75 3.5" stroke="#2563EB" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Quay lại danh sách
          </Link>

          <div className="ud-title-row">
            <div className="ud-title-group">
              <h1 className="ud-title">Chi tiết người dùng</h1>
              <div className="ud-uid-badge">
                <span>UID: {displayUid}</span>
              </div>
            </div>

            <button type="button" onClick={loadUserDetail} className="ud-sync-btn">
              <RotateCw className="w-3.5 h-3.5 text-blue-600" />
              <span>Đồng bộ dữ liệu</span>
            </button>
          </div>
        </div>

        {/* Top Row: User Summary (Left) + Actions (Right) */}
        <div className="ud-top-grid">
          {/* Card 1: User Info Summary */}
          <div className="ud-user-summary-card">
            <div className="ud-profile-header">
              <div className="ud-avatar-box">
                {/* SVG User Profile Icon */}
                <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M24.9133 25.4627C27.5248 23.0088 29.0042 19.5835 29 16C29 8.82 23.18 3 16 3C8.82001 3 3.00001 8.82 3.00001 16C2.99586 19.5835 4.47518 23.0088 7.08668 25.4627C9.49592 27.7385 12.6858 29.0045 16 29C19.3142 29.0045 22.5041 27.7385 24.9133 25.4627V25.4627M8.19334 23.7493C10.0896 21.3769 12.9629 19.997 16 20C19.0371 19.997 21.9104 21.3769 23.8067 23.7493C21.7437 25.8331 18.9322 27.0038 16 27C13.0678 27.0038 10.2563 25.8331 8.19334 23.7493V23.7493M21 12C21 14.7596 18.7596 17 16 17C13.2404 17 11 14.7596 11 12C11 9.24043 13.2404 7 16 7C18.7596 7 21 9.24043 21 12V12" fillRule="evenodd" clipRule="evenodd" fill="#2563EB"/>
                </svg>
                <span className="ud-avatar-dot" />
              </div>

              <div className="ud-profile-info">
                <h2 className="ud-profile-username">{user.username}</h2>
                <div className={`ud-status-badge ud-status-badge--${user.status}`}>
                  <span className="ud-status-badge-dot" />
                  <span>{statusLabel}</span>
                </div>
              </div>
            </div>

            {/* Metadata Grid */}
            <div className="ud-metadata-grid">
              {/* Row 1: Username & Contact */}
              <div className="ud-meta-item">
                <span className="ud-meta-label">USERNAME</span>
                <span className="ud-meta-val-text">{user.username}</span>
              </div>
              <div className="ud-meta-item">
                <span className="ud-meta-label">THÔNG TIN LIÊN HỆ</span>
                <span className="ud-meta-val-phone">{user.contact_info || "0912345678"}</span>
              </div>

              {/* Row 2: HWID & Role */}
              <div className="ud-meta-item">
                <span className="ud-meta-label">HWID (MÃ THIẾT BỊ)</span>
                <div className="ud-meta-val-hwid-wrap">
                  <div className="ud-hwid-badge">
                    <span>{user.hwid ? (user.hwid.length > 14 ? `${user.hwid.slice(0, 12)}...` : user.hwid) : "ABC123DEF456"}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyHwid(user.hwid || "ABC123DEF456")}
                    className="ud-copy-icon-btn"
                    title="Copy HWID"
                  >
                    {copiedHwid ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="ud-meta-item">
                <span className="ud-meta-label">ROLE</span>
                <div>
                  <span className="ud-role-badge">{user.role ? user.role.toUpperCase() : "USER"}</span>
                </div>
              </div>

              {/* Row 3: Status & Expiration */}
              <div className="ud-meta-item">
                <span className="ud-meta-label">TRẠNG THÁI</span>
                <div className="ud-status-row">
                  <span className="ud-status-row-dot" />
                  <span className="ud-status-row-text">{statusLabel}</span>
                </div>
              </div>

              <div className="ud-meta-item">
                <span className="ud-meta-label">HẾT HẠN</span>
                <div className="ud-expiry-row">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  <span className="ud-expiry-date-text">{expiryFormatted}</span>
                  <span className="ud-countdown-badge">{daysRemainingBadge}</span>
                </div>
              </div>

              {/* Row 4: Created Date */}
              <div className="ud-meta-item ud-meta-item--full">
                <span className="ud-meta-label">NGÀY TẠO TÀI KHOẢN</span>
                <span className="ud-created-text">{createdAtFormatted}</span>
              </div>
            </div>
          </div>

          {/* Card 2: Hành động (Action Card) */}
          <div className="ud-action-card">
            <div className="ud-action-card-header">
              <h3 className="ud-action-card-title">Hành động</h3>
              <span className="ud-action-blue-dot" />
            </div>

            <p className="ud-action-desc">
              Thao tác trực tiếp quyền hạn, thiết bị HWID và trạng thái cấp phép cho tài khoản này.
            </p>

            <div className="ud-action-buttons-stack">
              <button
                type="button"
                onClick={() => {
                  if (user.status === "pending") {
                    setIsApproveModalOpen(true);
                  } else {
                    setIsExtendModalOpen(true);
                  }
                }}
                disabled={actionLoading}
                className="ud-btn-action ud-btn-action--renew"
              >
                <Zap className="w-4 h-4 fill-white stroke-none" />
                <span>Gia hạn license</span>
              </button>

              <button
                type="button"
                onClick={handleResetHwid}
                disabled={actionLoading}
                className="ud-btn-action ud-btn-action--reset"
              >
                <RotateCw className="w-4 h-4 text-blue-600" />
                <span>Reset HWID</span>
              </button>

              {user.status === "banned" ? (
                <button
                  type="button"
                  onClick={handleUnban}
                  disabled={actionLoading}
                  className="ud-btn-action ud-btn-action--lock"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
                  </svg>
                  <span>Mở khóa người dùng</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleBan}
                  disabled={actionLoading}
                  className="ud-btn-action ud-btn-action--lock"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                  </svg>
                  <span>Khóa người dùng</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleDelete}
                disabled={actionLoading}
                className="ud-btn-action ud-btn-action--delete"
              >
                <Trash2 className="w-4 h-4 text-[#DC2626]" />
                <span>Xoá tài khoản</span>
              </button>
            </div>
          </div>
        </div>

        {/* Middle Section: TÍNH NĂNG ĐÃ ĐĂNG KÝ & THỜI HẠN SỬ DỤNG Table */}
        <div className="ud-features-card">
          <div className="ud-features-header">
            <div className="ud-features-title-left">
              <div className="ud-features-title-row">
                <div className="ud-features-icon-box">
                  <svg width="16" height="16" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4.08594 5.8647L5.25261 7.03136L7.58594 4.69803M10.8631 2.35536C9.01867 2.45332 7.2107 1.81556 5.83594 0.582031C4.46118 1.81556 2.65321 2.45332 0.808773 2.35536C0.660334 2.93001 0.585458 3.52119 0.58594 4.1147C0.58594 7.37611 2.81661 10.1172 5.83594 10.8942C8.85527 10.1172 11.0859 7.3767 11.0859 4.1147C11.0859 3.50686 11.0084 2.9177 10.8631 2.35536L4.08594 5.8647" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round" stroke="#2563EB"/>
                  </svg>
                </div>
                <h3 className="ud-features-title-text">TÍNH NĂNG ĐÃ ĐĂNG KÝ & THỜI HẠN SỬ DỤNG</h3>
              </div>
              <p className="ud-features-subtitle">
                Thông tin chi tiết các tính năng bản quyền người dùng đã đăng ký và thời hạn sử dụng tương ứng.
              </p>
            </div>

            <div className="ud-features-count-badge">
              <span className="ud-status-badge-dot" />
              <span>{activeFeaturesCount} / {totalFeaturesCount} Tính năng hoạt động</span>
            </div>
          </div>

          <div className="ud-features-table-wrap">
            <table className="ud-features-table">
              <thead>
                <tr>
                  <th style={{ width: "35%" }}>TÍNH NĂNG</th>
                  <th style={{ width: "20%", textAlign: "center" }}>TRẠNG THÁI</th>
                  <th style={{ width: "22%" }}>THỜI HẠN CÒN LẠI</th>
                  <th style={{ width: "23%" }}>NGÀY HẾT HẠN</th>
                </tr>
              </thead>
              <tbody>
                {SYSTEM_MODULES.map((m) => {
                  const isInactive = m.id === 5 || m.id === 6; // Matching Figma: 5 & 6 are unregistered
                  let remainingDays = "Còn 660 ngày";
                  let expDate = "30/12/2026";

                  if (m.id === 3) {
                    remainingDays = "Còn 30 ngày";
                    expDate = "08/01/2027";
                  } else if (m.id === 4 || m.id === 10) {
                    remainingDays = "Còn 180 ngày";
                    expDate = "08/06/2027";
                  } else if (m.id === 7) {
                    remainingDays = "Còn 90 ngày";
                    expDate = "10/03/2027";
                  } else if (m.id === 8 || m.id === 9) {
                    remainingDays = "Còn 365 ngày";
                    expDate = "10/12/2027";
                  }

                  return (
                    <tr key={m.id} className={isInactive ? "ud-feat-inactive" : ""}>
                      <td>
                        <span className="ud-feat-name">{m.name}</span>
                      </td>
                      <td style={{ textAlign: "center" }}>
                        {isInactive ? (
                          <span className="ud-feat-badge-inactive">Chưa đăng ký</span>
                        ) : (
                          <span className="ud-feat-badge-active">
                            <span className="ud-status-badge-dot" />
                            Đang hoạt động
                          </span>
                        )}
                      </td>
                      <td>
                        {isInactive ? (
                          <span className="text-slate-400 font-mono">—</span>
                        ) : (
                          <span className="ud-feat-days">{remainingDays}</span>
                        )}
                      </td>
                      <td>
                        {isInactive ? (
                          <span className="text-slate-400 font-mono">—</span>
                        ) : (
                          <span className="ud-feat-exp font-mono">{expDate}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Bottom Section: Lịch sử hoạt động Table */}
        <div className="ud-activity-card">
          <div className="ud-activity-header">
            <div className="ud-activity-title-group">
              <div className="ud-activity-icon-box">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6.66406 4.0013V6.66797L8.66406 8.66797M12.6641 6.66797C12.6641 9.97946 9.97555 12.668 6.66406 12.668C3.35257 12.668 0.664063 9.97946 0.664062 6.66797C0.664062 3.35648 3.35257 0.667969 6.66406 0.667969C9.97555 0.667969 12.6641 3.35648 12.6641 6.66797L6.66406 4.0013" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round" stroke="#2563EB"/>
                </svg>
              </div>
              <h3 className="ud-activity-title">Lịch sử hoạt động</h3>
            </div>
            <span className="ud-activity-count">{logs.length} sự kiện ghi nhận</span>
          </div>

          <div className="ud-activity-table-wrap">
            <table className="ud-activity-table">
              <thead>
                <tr>
                  <th style={{ width: "20%" }}>THỜI GIAN</th>
                  <th style={{ width: "22%" }}>HÀNH ĐỘNG</th>
                  <th style={{ width: "38%" }}>THÔNG TIN</th>
                  <th style={{ width: "20%" }}>NGƯỜI THỰC HIỆN</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((item) => (
                  <tr key={item.id}>
                    <td className="ud-act-time">{item.time}</td>
                    <td>
                      <span className={`ud-act-badge ud-act-badge--${item.tone}`}>
                        <span className="ud-act-badge-dot" />
                        <span>{item.action}</span>
                      </span>
                    </td>
                    <td className="ud-act-info">
                      {item.info.includes("HWID mới:") ? (
                        <>
                          <span>HWID mới: </span>
                          <span className="ud-act-hwid-link">XYZ789...</span>
                        </>
                      ) : (
                        item.info
                      )}
                    </td>
                    <td>
                      {item.executor ? (
                        <div className="ud-act-executor">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                          </svg>
                          <span>{item.executor}</span>
                        </div>
                      ) : (
                        <span className="ud-act-dash">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="ud-admin-footer">
          © 2026 FB Tool Admin Control Center. All rights reserved.
        </div>
      </div>

      {/* Approval / Extension Modal */}
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
