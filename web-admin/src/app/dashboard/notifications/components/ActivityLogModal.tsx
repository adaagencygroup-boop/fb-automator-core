"use client";

import { useState } from "react";

export interface ActivityLogItem {
  id: string | number;
  timestamp: string;
  rawDate: string;
  admin: {
    username: string;
    badge: string;
    badgeColor: "blue" | "green" | "gray";
    role: string;
  };
  action: {
    name: string;
    type:
      | "reset_hwid"
      | "approve_user"
      | "extend_license"
      | "ban_user"
      | "unban_user"
      | "reset_password"
      | "login"
      | "add_admin"
      | "create_user"
      | "delete_user"
      | "reject_user"
      | "edit_user"
      | "register"
      | "other"
      | (string & {});
  };
  target: {
    name: string;
    subtext?: string;
    isLink?: boolean;
    userId?: number;
  };
  changeDetail: {
    text: string;
    highlight?: string;
    isDanger?: boolean;
  };
  result: "success" | "failed";
  ip?: string;
  userAgent?: string;
  note?: string;
}

interface ActivityLogModalProps {
  isOpen: boolean;
  log: ActivityLogItem | null;
  onClose: () => void;
}

// Format date: "25/09/2026 - 09:40:22"
function formatFullDateTime(iso: string) {
  try {
    const dt = new Date(iso);
    const dd = String(dt.getDate()).padStart(2, "0");
    const mo = String(dt.getMonth() + 1).padStart(2, "0");
    const yyyy = dt.getFullYear();
    const hh = String(dt.getHours()).padStart(2, "0");
    const mm = String(dt.getMinutes()).padStart(2, "0");
    const ss = String(dt.getSeconds()).padStart(2, "0");
    return `${dd}/${mo}/${yyyy} - ${hh}:${mm}:${ss}`;
  } catch {
    return iso;
  }
}

// Calculate relative time: "5 phút trước", "Hôm nay", etc.
function formatTimeAgo(iso: string) {
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    const diffSec = Math.max(0, Math.floor(diffMs / 1000));
    if (diffSec < 60) return "Vừa xong";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} phút trước`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours} giờ trước`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays} ngày trước`;
    return "Tháng trước";
  } catch {
    return "Gần đây";
  }
}

// Parse device info from user agent
function parseDeviceInfo(uaString?: string) {
  if (!uaString || uaString === "—") return "Thiết bị không xác định";
  const ua = uaString.toLowerCase();

  let browser = "Trình duyệt Web";
  if (ua.includes("edg/")) browser = "Edge";
  else if (ua.includes("chrome/") && !ua.includes("edg/")) browser = "Chrome";
  else if (ua.includes("firefox/")) browser = "Firefox";
  else if (ua.includes("safari/") && !ua.includes("chrome/")) browser = "Safari";
  else if (ua.includes("python-urllib") || ua.includes("python")) browser = "Python API";
  else if (ua.includes("postman")) browser = "Postman Client";

  let os = "Hệ thống";
  if (ua.includes("windows")) os = "Windows";
  else if (ua.includes("mac os") || ua.includes("macos")) os = "macOS";
  else if (ua.includes("android")) os = "Android";
  else if (ua.includes("iphone") || ua.includes("ipad")) os = "iOS";
  else if (ua.includes("linux")) os = "Linux";

  return `${browser} · ${os}`;
}

// Parse IP address with location
function parseIpAddress(ip?: string) {
  if (!ip || ip === "—") return "127.0.0.1 (Localhost)";
  if (ip === "127.0.0.1" || ip === "localhost" || ip === "::1") {
    return `${ip} (Máy chủ nội bộ / Localhost)`;
  }
  return `${ip} (Việt Nam)`;
}

// Parse before/after values from changeDetail
function parseChangeDiff(actionType: string, changeDetail: string) {
  const text = changeDetail || "";

  if (text.includes(" -> ")) {
    const [beforeRaw, afterRaw] = text.split(" -> ");
    let beforeVal = beforeRaw.trim();
    let afterVal = afterRaw.trim();

    if (actionType === "reset_hwid") {
      beforeVal = beforeVal === "(none)" ? "Chưa có thiết bị đăng ký" : `HWID: ${beforeVal}`;
      afterVal = "HWID: NULL (Đã xóa, chờ kích hoạt máy mới)";
      return {
        beforeSubtext: "Khóa thiết bị cũ",
        beforeValue: beforeVal,
        afterSubtext: "Trạng thái sẵn sàng",
        afterValue: afterVal,
      };
    }

    return {
      beforeSubtext: "Giá trị ban đầu",
      beforeValue: beforeVal.startsWith("HWID:") ? beforeVal : `Trạng thái: ${beforeVal}`,
      afterSubtext: "Đã cập nhật",
      afterValue: afterVal.startsWith("HWID:") ? afterVal : `Trạng thái: ${afterVal}`,
    };
  }

  if (actionType === "reset_hwid") {
    return {
      beforeSubtext: "Khóa thiết bị cũ",
      beforeValue: text ? `HWID: ${text}` : "HWID: ABC123DEF-99A1-22C0-7E81",
      afterSubtext: "Trạng thái sẵn sàng",
      afterValue: "HWID: NULL (Đã xóa, chờ kích hoạt máy mới)",
    };
  }

  if (actionType === "delete_user") {
    return {
      beforeSubtext: "Tài khoản trong hệ thống",
      beforeValue: "Tài khoản: Đang hoạt động / Khả dụng trên hệ thống",
      afterSubtext: "Đã xóa vĩnh viễn",
      afterValue: text || "Đã xóa toàn bộ tài khoản và phiên làm việc",
    };
  }

  if (actionType === "create_user" || actionType === "add_admin") {
    return {
      beforeSubtext: "Chưa tồn tại",
      beforeValue: "Tài khoản: NULL (Chưa có trong cơ sở dữ liệu)",
      afterSubtext: "Khởi tạo thành công",
      afterValue: text || "Tạo mới tài khoản với đầy đủ quyền hạn",
    };
  }

  if (actionType === "login") {
    return {
      beforeSubtext: "Phiên làm việc trước",
      beforeValue: "Trạng thái: Chưa có phiên đăng nhập mới",
      afterSubtext: "Xác thực thành công",
      afterValue: text || "Cấp quyền JWT Access Token 24h",
    };
  }

  return {
    beforeSubtext: "Dữ liệu ban đầu",
    beforeValue: "Bản ghi trước khi áp dụng thay đổi",
    afterSubtext: "Dữ liệu mới",
    afterValue: text || "Đã áp dụng thay đổi thành công",
  };
}

export function ActivityLogModal({ isOpen, log, onClose }: ActivityLogModalProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !log) return null;

  const diff = parseChangeDiff(log.action.type, log.changeDetail.text);
  const formattedDate = formatFullDateTime(log.rawDate);
  const timeAgo = formatTimeAgo(log.rawDate);
  const deviceInfo = parseDeviceInfo(log.userAgent);
  const ipInfo = parseIpAddress(log.ip);

  // Copy JSON details to clipboard
  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(log, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  // Avatar initials (e.g. "admin01" -> "01", "superadmin" -> "SA", "admin" -> "AD")
  const adminInitial = log.admin.badge || (log.admin.username ? log.admin.username.slice(0, 2).toUpperCase() : "AD");

  return (
    <div className="fig-alm-overlay" onClick={onClose}>
      <div
        className="fig-alm-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* ── 1. Top Header Banner ── */}
        <div className="fig-alm-topbar">
          <div className="fig-alm-title-wrap">
            <span className="fig-alm-blue-dot" />
            <h2 className="fig-alm-title">CHI TIẾT HOẠT ĐỘNG</h2>
          </div>

          <button
            type="button"
            className="fig-alm-close-circle"
            onClick={onClose}
            aria-label="Đóng"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M13 1L1 13M1 1L13 13"
                stroke="#424656"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <div className="fig-alm-body">
          {/* ── 2. Admin Profile Card ── */}
          <div className="fig-alm-admin-card">
            <div className="fig-alm-admin-left">
              <div className="fig-alm-avatar">{adminInitial}</div>
              <div className="fig-alm-admin-info">
                <div className="fig-alm-admin-name-row">
                  <span className="fig-alm-admin-name">{log.admin.username}</span>
                  {/* Verified checkmark badge icon */}
                  <svg
                    className="fig-alm-verified-icon"
                    width="15"
                    height="14"
                    viewBox="0 0 15 14"
                    fill="none"
                  >
                    <path
                      d="M5.06667 14L3.8 11.8667L1.4 11.3333L1.63333 8.86667L0 7L1.63333 5.13333L1.4 2.66667L3.8 2.13333L5.06667 0L7.33333 0.966667L9.6 0L10.8667 2.13333L13.2667 2.66667L13.0333 5.13333L14.6667 7L13.0333 8.86667L13.2667 11.3333L10.8667 11.8667L9.6 14L7.33333 13.0333L5.06667 14ZM5.63333 12.3L7.33333 11.5667L9.06667 12.3L10 10.7L11.8333 10.2667L11.6667 8.4L12.9 7L11.6667 5.56667L11.8333 3.7L10 3.3L9.03333 1.7L7.33333 2.43333L5.6 1.7L4.66667 3.3L2.83333 3.7L3 5.56667L1.76667 7L3 8.4L2.83333 10.3L4.66667 10.7L5.63333 12.3ZM6.63333 9.36667L10.4 5.6L9.46667 4.63333L6.63333 7.46667L5.2 6.06667L4.26667 7L6.63333 9.36667Z"
                      fill="#0866FF"
                    />
                  </svg>
                </div>
                <div className="fig-alm-admin-sub">
                  {log.admin.username}@fbtool.internal
                </div>
              </div>
            </div>

            {/* Result Badge */}
            {log.result === "success" ? (
              <div className="fig-alm-status-badge fig-alm-status-badge--success">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M10 3L4.5 8.5L2 6"
                    stroke="#15803D"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>Thành công</span>
              </div>
            ) : (
              <div className="fig-alm-status-badge fig-alm-status-badge--failed">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M9 3L3 9M3 3L9 9"
                    stroke="#DC2626"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>Thất bại</span>
              </div>
            )}
          </div>

          {/* ── 3. Info Cards Grid: Hành động & Đối tượng ── */}
          <div className="fig-alm-grid-cards">
            {/* Card Left: HÀNH ĐỘNG */}
            <div className="fig-alm-field-card">
              <span className="fig-alm-field-label">HÀNH ĐỘNG</span>
              <div className="fig-alm-action-pill">
                {log.action.name}
              </div>
            </div>

            {/* Card Right: ĐỐI TƯỢNG CAN THIỆP */}
            <div className="fig-alm-field-card">
              <span className="fig-alm-field-label">ĐỐI TƯỢNG CAN THIỆP</span>
              <div className="fig-alm-target-wrap">
                <span className="fig-alm-target-name">{log.target.name}</span>
                {log.target.subtext && (
                  <span className="fig-alm-target-subtext">
                    ({log.target.subtext})
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ── 4. Timestamp & Time Ago Row ── */}
          <div className="fig-alm-time-row">
            <div className="fig-alm-timestamp">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6.67" stroke="#424656" strokeWidth="1.33" />
                <path d="M8 4.67V8L10.33 9.33" stroke="#424656" strokeWidth="1.33" strokeLinecap="round" />
              </svg>
              <span>{formattedDate}</span>
            </div>
            <div className="fig-alm-timeago">{timeAgo}</div>
          </div>

          {/* ── 5. Comparison: SO SÁNH THAY ĐỔI DỮ LIỆU ── */}
          <div className="fig-alm-diff-section">
            <h4 className="fig-alm-section-heading">SO SÁNH THAY ĐỔI DỮ LIỆU</h4>

            {/* Box 1: GIÁ TRỊ TRƯỚC */}
            <div className="fig-alm-diff-box fig-alm-diff-box--before">
              <div className="fig-alm-diff-header">
                <div className="fig-alm-diff-tag fig-alm-diff-tag--before">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6.5" stroke="#BA1A1A" strokeWidth="1.3" />
                    <path d="M4.67 8H11.33" stroke="#BA1A1A" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <span>GIÁ TRỊ TRƯỚC</span>
                </div>
                <span className="fig-alm-diff-sub fig-alm-diff-sub--before">
                  {diff.beforeSubtext}
                </span>
              </div>
              <div className="fig-alm-diff-content">
                <code>{diff.beforeValue}</code>
              </div>
            </div>

            {/* Down Arrow Divider */}
            <div className="fig-alm-arrow-wrap">
              <div className="fig-alm-arrow-circle">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M8 2.5V13.5M8 13.5L3.5 9M8 13.5L12.5 9"
                    stroke="white"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>

            {/* Box 2: GIÁ TRỊ SAU */}
            <div className="fig-alm-diff-box fig-alm-diff-box--after">
              <div className="fig-alm-diff-header">
                <div className="fig-alm-diff-tag fig-alm-diff-tag--after">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6.5" stroke="#15803D" strokeWidth="1.3" />
                    <path
                      d="M5 8L7.2 10.2L11 5.8"
                      stroke="#15803D"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>GIÁ TRỊ SAU</span>
                </div>
                <span className="fig-alm-diff-sub fig-alm-diff-sub--after">
                  {diff.afterSubtext}
                </span>
              </div>
              <div className="fig-alm-diff-content">
                <code>{diff.afterValue}</code>
              </div>
            </div>
          </div>

          {/* ── 6. Environment: MÔI TRƯỜNG THAO TÁC ── */}
          <div className="fig-alm-env-card">
            <h4 className="fig-alm-env-title">MÔI TRƯỜNG THAO TÁC</h4>
            <div className="fig-alm-env-row">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6.5" stroke="#424656" strokeWidth="1.3" />
                <path d="M1.5 8H14.5M8 1.5C9.5 3.5 10.5 5.5 10.5 8C10.5 10.5 9.5 12.5 8 14.5C6.5 12.5 5.5 10.5 5.5 8C5.5 5.5 6.5 3.5 8 1.5Z" stroke="#424656" strokeWidth="1.2" />
              </svg>
              <span>
                <strong>Địa chỉ IP Admin:</strong> {ipInfo}
              </span>
            </div>
            <div className="fig-alm-env-row">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="3" width="12" height="8.5" rx="1.5" stroke="#424656" strokeWidth="1.3" />
                <path d="M1 13.5H15" stroke="#424656" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              <span>
                <strong>Thiết bị & Trình duyệt:</strong> {deviceInfo}
              </span>
            </div>
          </div>

          {/* ── 7. Footer Actions ── */}
          <div className="fig-alm-footer">
            <button
              type="button"
              className="fig-alm-btn-copy"
              onClick={handleCopyJson}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <rect x="5" y="5" width="8" height="8" rx="1.5" stroke="#191C1E" strokeWidth="1.3" />
                <path d="M3 11V3.5C3 3.2 3.2 3 3.5 3H11" stroke="#191C1E" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              <span>{copied ? "✓ Đã sao chép JSON!" : "Sao chép JSON"}</span>
            </button>

            <button
              type="button"
              className="fig-alm-btn-close"
              onClick={onClose}
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
