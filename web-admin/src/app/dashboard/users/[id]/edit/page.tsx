"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, User, ActivityLog, getCurrentAdminUser } from "@/lib/api";
import { LogoutNoticeModal } from "@/components/LogoutNoticeModal";
import { isValidPhoneNumber, isValidPassword, validatePassword } from "@/lib/validation";
import { RotateCw, Copy, Check, Eye, EyeOff, Ban, Trash2 } from "lucide-react";
import "./user-edit.css";

// 11 Core features
interface FeatureConfig {
  key: string;
  name: string;
  checked: boolean;
  days: number;
}

const DEFAULT_FEATURES: FeatureConfig[] = [
  { key: "fb_account", name: "1. Quản lý tài khoản Facebook", checked: true, days: 30 },
  { key: "post_interact", name: "2. Đăng bài và tương tác tài khoản", checked: true, days: 30 },
  { key: "create_fanpage", name: "3. Tạo Fanpage hàng loạt", checked: false, days: 0 },
  { key: "manage_fanpage", name: "4. Quản lý Fanpage", checked: true, days: 30 },
  { key: "chat_fanpage", name: "5. Quản lý Chat Page", checked: false, days: 0 },
  { key: "spam_group", name: "6. Spam Group Hội Nhóm", checked: true, days: 30 },
  { key: "seeding", name: "7. Seeding Bài & Page", checked: false, days: 0 },
  { key: "scan_group", name: "8. Quét nhóm", checked: true, days: 30 },
  { key: "scan_page", name: "9. Quét page", checked: true, days: 30 },
  { key: "scan_post", name: "10. Quét bài viết", checked: false, days: 0 },
  { key: "scan_profile", name: "11. Quét profile", checked: true, days: 30 },
];

export default function UserEditPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params?.id ? Number(params.id) : null;

  const [user, setUser] = useState<User | null>(null);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [copiedHwid, setCopiedHwid] = useState(false);

  // Form states
  const [username, setUsername] = useState<string>("");
  const [usernameError, setUsernameError] = useState<string>("");
  const [contactInfo, setContactInfo] = useState<string>("");
  const [phoneError, setPhoneError] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [passwordError, setPasswordError] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("approved");

  // Feature states
  const [features, setFeatures] = useState<FeatureConfig[]>(DEFAULT_FEATURES);

  // Self username rename modal notice
  const [logoutNotice, setLogoutNotice] = useState<{ isOpen: boolean; newUsername: string }>({
    isOpen: false,
    newUsername: "",
  });

  const loadUserData = async () => {
    if (!userId) return;
    try {
      const [users, logsData] = await Promise.all([
        api.getUsers(),
        api.getActivityLogs(100).catch(() => [] as ActivityLog[]),
      ]);
      const found = users.find((u) => u.id === userId);
      if (found) {
        setUser(found);
        setUsername(found.username || "");
        setContactInfo(found.contact_info || "");
        setStatus(found.status || "approved");

        if (found.features && Array.isArray(found.features) && found.features.length > 0) {
          setFeatures(
            DEFAULT_FEATURES.map((df) => {
              const f = found.features?.find((item) => item.key === df.key);
              if (f) {
                return {
                  ...df,
                  checked: Boolean(f.is_enabled),
                  days: f.is_enabled
                    ? (f.days_remaining > 0 ? f.days_remaining : f.days_granted || 30)
                    : 0,
                };
              }
              return df;
            })
          );
        }

        if (logsData) {
          const userLogs = logsData.filter(
            (l) => l.target_uid === userId || l.target_username === found.username
          );
          setActivityLogs(userLogs);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUserData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const copyHwid = (hwidStr: string) => {
    if (!hwidStr) return;
    navigator.clipboard.writeText(hwidStr);
    setCopiedHwid(true);
    setTimeout(() => setCopiedHwid(false), 2000);
  };

  const handleResetHwid = async () => {
    if (!user) return;
    if (!confirm(`Reset HWID của ${user.username}? Thiết bị hiện tại sẽ bị hủy liên kết.`)) return;
    setActionLoading(true);
    try {
      await api.resetHwid(user.id);
      await loadUserData();
    } catch (e: any) {
      alert(e.message || "Lỗi khi reset HWID");
    } finally {
      setActionLoading(false);
    }
  };

  const handleBanToggle = async () => {
    if (!user) return;
    if (user.status === "banned") {
      if (!confirm(`Mở khóa tài khoản ${user.username}?`)) return;
      setActionLoading(true);
      try {
        await api.unbanUser(user.id);
        await loadUserData();
        alert("Đã mở khóa tài khoản thành công!");
      } catch (e: any) {
        alert(e.message || "Lỗi khi mở khóa");
      } finally {
        setActionLoading(false);
      }
    } else {
      if (!confirm(`Khóa tài khoản ${user.username}?`)) return;
      setActionLoading(true);
      try {
        await api.banUser(user.id);
        setStatus("banned");
        await loadUserData();
        alert("Đã khóa tài khoản thành công!");
      } catch (e: any) {
        alert(e.message || "Lỗi khi khóa tài khoản");
      } finally {
        setActionLoading(false);
      }
    }
  };

  const handleDelete = async () => {
    if (!user) return;
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

  const handleToggleFeature = (index: number) => {
    setFeatures((prev) =>
      prev.map((f, i) => {
        if (i !== index) return f;
        const nextChecked = !f.checked;
        return {
          ...f,
          checked: nextChecked,
          days: nextChecked ? (f.days > 0 ? f.days : 30) : 0,
        };
      })
    );
  };

  const handleFeatureDaysChange = (index: number, val: string) => {
    const num = parseInt(val, 10);
    setFeatures((prev) =>
      prev.map((f, i) => {
        if (i !== index) return f;
        const days = isNaN(num) ? 0 : Math.max(0, num);
        return {
          ...f,
          days,
          checked: days > 0,
        };
      })
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (!username.trim()) {
      setUsernameError("Vui lòng nhập tên đăng nhập.");
      return;
    }
    setUsernameError("");

    if (!contactInfo.trim()) {
      setPhoneError("Vui lòng nhập số điện thoại liên hệ.");
      return;
    }

    if (!isValidPhoneNumber(contactInfo)) {
      setPhoneError("Số điện thoại không đúng định dạng (VD: 0988123456 hoặc +84988123456)");
      return;
    }
    setPhoneError("");

    if (password.trim() && !isValidPassword(password)) {
      const passRes = validatePassword(password);
      setPasswordError(passRes.message || "Mật khẩu không thỏa mãn các yêu cầu bảo mật!");
      return;
    }
    setPasswordError("");

    setActionLoading(true);
    try {
      const maxDays = Math.max(...features.filter((f) => f.checked).map((f) => f.days), 0);

      const payload: {
        username?: string;
        contact_info?: string;
        status?: string;
        password?: string;
        days?: number;
        features?: { key: string; days: number; enabled: boolean }[];
      } = {
        contact_info: contactInfo,
        status: status,
        features: features.map((f) => ({
          key: f.key,
          days: f.days,
          enabled: f.checked,
        })),
      };

      if (maxDays > 0) {
        payload.days = maxDays;
      }

      if (username.trim() !== user.username) {
        payload.username = username.trim();
      }

      if (password.trim()) {
        payload.password = password.trim();
      }

      const currentUser = getCurrentAdminUser();
      const isCurrent = Boolean(
        (currentUser?.username && user.username.toLowerCase() === currentUser.username.toLowerCase()) ||
        (currentUser?.id && user.id === currentUser.id)
      );
      const isUsernameChanged = Boolean(payload.username && payload.username.toLowerCase() !== user.username.toLowerCase());

      if (isCurrent && isUsernameChanged) {
        sessionStorage.setItem("pending_logout_modal", "true");
        await api.editUser(user.id, payload);
        setLogoutNotice({
          isOpen: true,
          newUsername: payload.username!,
        });
        return;
      }

      await api.editUser(user.id, payload);
      alert("Cập nhật thông tin người dùng thành công!");
      router.push("/dashboard/users");
    } catch (e: any) {
      sessionStorage.removeItem("pending_logout_modal");
      alert(e.message || "Lỗi khi lưu thông tin");
    } finally {
      setActionLoading(false);
    }
  };

  if (logoutNotice.isOpen) {
    return (
      <LogoutNoticeModal
        isOpen={logoutNotice.isOpen}
        newUsername={logoutNotice.newUsername}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-slate-500 font-medium text-sm">
        <RotateCw className="w-6 h-6 animate-spin text-blue-600" />
        <span>Đang tải thông tin người dùng...</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <h2 className="text-xl font-bold text-slate-800">Không tìm thấy người dùng</h2>
        <Link
          href="/dashboard/users"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 transition-colors"
        >
          <span>Quay lại danh sách</span>
        </Link>
      </div>
    );
  }

  // Formatting date
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

  return (
    <div className="ue-page-root">
      <div className="ue-main-content">
        {/* Section - HeaderBar */}
        <div className="ue-header-bar">
          <div className="ue-header-left">
            <Link href="/dashboard/users" className="ue-back-link">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8.75 10.5L5.25 7L8.75 3.5" stroke="#2563EB" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>Quay lại danh sách</span>
            </Link>
            <h1 className="ue-title-h1">Chỉnh sửa người dùng</h1>
          </div>

          <button
            type="button"
            onClick={loadUserData}
            className="ue-sync-btn"
            title="Đồng bộ dữ liệu từ server"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12.25 7A5.25 5.25 0 1 1 7 1.75V3.5" stroke="#64748B" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M9 3.5L7 1.75L9 0" stroke="#64748B" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>Đồng bộ dữ liệu</span>
          </button>
        </div>

        {/* TwoColumnLayout */}
        <div className="ue-two-col-layout">
          {/* LEFT COLUMN: Main Form */}
          <div className="ue-left-col">
            <div className="ue-form-card">
              {/* Profile Quick Header */}
              <div className="ue-profile-quick-header">
                <div className="ue-profile-user-info">
                  <div className="ue-avatar-wrapper">
                    <div className="ue-avatar-box">
                      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="16" cy="11" r="5" stroke="#2563EB" strokeWidth="2.66667"/>
                        <path d="M6 26C6 21.5817 10.4772 18 16 18C21.5228 18 26 21.5817 26 26" stroke="#2563EB" strokeWidth="2.66667" strokeLinecap="round"/>
                      </svg>
                    </div>
                    <span className="ue-online-dot" />
                  </div>

                  <div className="ue-profile-text-meta">
                    <div className="ue-profile-name-row">
                      <h2 className="ue-profile-username">{user.username}</h2>
                      <div className="ue-status-badge">
                        <span className="ue-status-badge-dot" />
                        <span>{user.status === "approved" ? "Đã duyệt" : user.status === "banned" ? "Đã khóa" : user.status === "pending" ? "Chờ duyệt" : "Hết hạn"}</span>
                      </div>
                    </div>
                    <p className="ue-profile-subtitle">
                      Tài khoản chuẩn • Đăng ký ngày {formatUtcDateTime(user.created_at)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Form Fields Grid */}
              <div className="ue-form-grid">
                {/* Field 1: USERNAME */}
                <div className="ue-form-field">
                  <label className="ue-form-label">TÊN ĐĂNG NHẬP (USERNAME)</label>
                  <input
                    type="text"
                    value={username}
                    readOnly
                    className="ue-input-readonly"
                    title="Định danh duy nhất không nên sửa trực tiếp"
                  />
                  <p className="ue-field-hint">Định danh duy nhất trên hệ thống FB Tool.</p>
                  {usernameError && <p className="ue-field-error">{usernameError}</p>}
                </div>

                {/* Field 2: CONTACT INFO */}
                <div className="ue-form-field">
                  <label className="ue-form-label">THÔNG TIN LIÊN HỆ (SĐT / ZALO)</label>
                  <div className="ue-input-icon-wrap">
                    <span className="ue-input-left-icon">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M14.6666 11.28V13.28C14.6673 13.4657 14.6293 13.6495 14.5551 13.8189C14.4809 13.9882 14.3721 14.1394 14.2361 14.2621C14.1001 14.3848 13.9401 14.4762 13.7667 14.5298C13.5933 14.5835 13.4104 14.5982 13.2306 14.573C11.1738 14.3496 9.20014 13.6473 7.4666 12.5197C5.85292 11.4883 4.49833 10.1337 3.46693 8.52003C2.3353 6.77903 1.63273 4.79589 1.41327 2.73003C1.38814 2.55086 1.40268 2.36859 1.45595 2.19582C1.50923 2.02305 1.60002 1.86377 1.72215 1.72877C1.84429 1.59378 1.99503 1.48604 2.16401 1.41285C2.33299 1.33966 2.51642 1.30263 2.70193 1.30403H4.70193C5.02534 1.30084 5.33939 1.41505 5.58431 1.6248C5.82924 1.83454 5.98774 2.12461 6.0306 2.4397C6.11053 3.02324 6.25301 3.5954 6.45527 4.14303C6.5434 4.38072 6.55403 4.63914 6.4859 4.88291C6.41777 5.12668 6.27387 5.34523 6.07327 5.50803L5.22593 6.35536C6.18431 8.04068 7.57595 9.43232 9.26127 10.3907L10.1086 9.54336C10.2714 9.34277 10.49 9.19886 10.7337 9.13073C10.9775 9.0626 11.2359 9.07324 11.4736 9.16136C12.0212 9.36363 12.5934 9.5061 13.1769 9.58603C13.4957 9.62934 13.7888 9.79058 13.9997 10.0392C14.2107 10.2878 14.3235 10.6057 14.3166 10.9324L14.6666 11.28Z" stroke="#94A3B8" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                    <input
                      type="text"
                      value={contactInfo}
                      onChange={(e) => setContactInfo(e.target.value)}
                      placeholder="0912345678"
                      className="ue-input-with-left-icon"
                    />
                  </div>
                  {phoneError && <p className="ue-field-error">{phoneError}</p>}
                </div>

                {/* Field 3: NEW PASSWORD */}
                <div className="ue-form-field">
                  <label className="ue-form-label">MẬT KHẨU MỚI (TÙY CHỌN)</label>
                  <div className="ue-input-icon-wrap">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Nhập nếu muốn đổi mật khẩu mới"
                      className="ue-input-with-right-btn"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="ue-input-right-btn"
                      title={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {passwordError && <p className="ue-field-error">{passwordError}</p>}
                </div>

                {/* Field 4: HWID */}
                <div className="ue-form-field">
                  <label className="ue-form-label">HWID (MÃ THIẾT BỊ PHẦN CỨNG LIÊN KẾT)</label>
                  <div className="ue-hwid-row">
                    <div className="ue-hwid-input-box">
                      <input
                        type="text"
                        value={user.hwid || "ABC123DEF456"}
                        readOnly
                        className="ue-hwid-input"
                      />
                      <button
                        type="button"
                        onClick={() => copyHwid(user.hwid || "ABC123DEF456")}
                        className="ue-input-right-btn"
                        title="Sao chép HWID"
                      >
                        {copiedHwid ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleResetHwid}
                      disabled={actionLoading}
                      className="ue-hwid-reset-btn"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12.25 7A5.25 5.25 0 1 1 7 1.75V3.5" stroke="#64748B" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M9 3.5L7 1.75L9 0" stroke="#64748B" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span>Đặt lại HWID</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Quick Actions */}
          <div className="ue-right-col">
            {/* Top Card: Cancel / Save */}
            <div className="ue-top-actions-card">
              <button
                type="button"
                onClick={() => router.back()}
                className="ue-btn-cancel"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={actionLoading}
                className="ue-btn-save"
              >
                {actionLoading ? "Đang lưu..." : "Lưu thay đổi"}
              </button>
            </div>

            {/* Bottom Card: Hành động */}
            <div className="ue-danger-card">
              <h3 className="ue-danger-title">Hành động</h3>
              <p className="ue-danger-desc">
                Thao tác trực tiếp trạng thái cấp phép cho tài khoản này.
              </p>

              <div className="ue-danger-btn-group">
                <button
                  type="button"
                  onClick={handleBanToggle}
                  disabled={actionLoading}
                  className="ue-btn-danger-soft"
                >
                  <Ban className="w-4 h-4 text-[#BE123C]" />
                  <span>{user.status === "banned" ? "Mở khóa người dùng" : "Khóa người dùng"}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={actionLoading}
                  className="ue-btn-danger-soft"
                >
                  <Trash2 className="w-4 h-4 text-[#BE123C]" />
                  <span>Xoá vĩnh viễn tài khoản</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Section 3: Feature Allocation */}
        <div className="ue-features-card">
          <div className="ue-features-header">
            <span className="ue-purple-bar" />
            <h2 className="ue-features-title">TÍNH NĂNG ĐÃ CHỌN</h2>
          </div>

          <div className="ue-features-grid">
            {features.map((feature, idx) => (
              <div
                key={feature.key}
                className={`ue-feature-item ${feature.checked ? "checked" : "unchecked"}`}
              >
                <label className="ue-feature-label cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={Boolean(feature.checked)}
                    onChange={() => handleToggleFeature(idx)}
                    className="ue-checkbox"
                  />
                  <span>{feature.name}</span>
                </label>

                <div className="ue-days-input-wrap" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="number"
                    min="0"
                    value={feature.days}
                    onChange={(e) => handleFeatureDaysChange(idx, e.target.value)}
                    className={`ue-days-input ${feature.checked ? "checked" : "unchecked"}`}
                  />
                  <span className="ue-days-unit">ngày</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Section 4: ActivityLogTable */}
        <div className="ue-activity-card">
          <div className="ue-activity-header">
            <div className="ue-activity-title-group">
              <div className="ue-activity-icon-box">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="8" cy="8" r="6" stroke="#2563EB" strokeWidth="1.33333"/>
                  <path d="M8 5V8L10 10" stroke="#2563EB" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h3 className="ue-activity-title">Lịch sử hoạt động</h3>
            </div>
            <span className="ue-activity-count-badge">
              {activityLogs.length > 0 ? `${activityLogs.length} sự kiện ghi nhận` : "3 sự kiện ghi nhận"}
            </span>
          </div>

          <div className="ue-activity-table-wrap">
            <table className="ue-table">
              <thead>
                <tr>
                  <th style={{ width: "20%" }}>THỜI GIAN</th>
                  <th style={{ width: "25%" }}>HÀNH ĐỘNG</th>
                  <th style={{ width: "35%" }}>THÔNG TIN CHI TIẾT</th>
                  <th style={{ width: "20%" }} className="text-right">NGƯỜI THỰC HIỆN</th>
                </tr>
              </thead>
              <tbody>
                {activityLogs.length > 0 ? (
                  activityLogs.map((log, index) => {
                    const actionType = log.action_type || "";
                    const isApprove = actionType.toLowerCase().includes("approve") || actionType.toLowerCase().includes("duyệt");
                    const isReset = actionType.toLowerCase().includes("reset") || actionType.toLowerCase().includes("hwid");
                    const isRegister = actionType.toLowerCase().includes("register") || actionType.toLowerCase().includes("đăng ký");
                    const badgeClass = isApprove ? "approved" : isReset ? "reset" : isRegister ? "registered" : "registered";

                    const actionLabel = isApprove
                      ? "Duyệt người dùng"
                      : isReset
                      ? "Reset HWID"
                      : isRegister
                      ? "Đăng ký tài khoản"
                      : actionType;

                    return (
                      <tr key={log.id || index}>
                        <td style={{ color: "#64748B", fontWeight: 500 }}>
                          {formatUtcDateTime(log.created_at)}
                        </td>
                        <td>
                          <span className={`ue-log-badge ${badgeClass}`}>
                            <span className="dot" />
                            <span>{actionLabel}</span>
                          </span>
                        </td>
                        <td style={{ color: "#475569" }}>
                          {log.change_detail || log.note || log.ip_address || "—"}
                        </td>
                        <td className="text-right">
                          {log.admin_username ? (
                            <span className="ue-admin-tag">
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <circle cx="6" cy="4" r="2.5" stroke="#2563EB" strokeWidth="1"/>
                                <path d="M2 10C2 8 3.8 6.5 6 6.5C8.2 6.5 10 8 10 10" stroke="#2563EB" strokeWidth="1" strokeLinecap="round"/>
                              </svg>
                              <span>{log.admin_username}</span>
                            </span>
                          ) : (
                            <span style={{ color: "#94A3B8" }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <>
                    <tr>
                      <td style={{ color: "#64748B", fontWeight: 500 }}>01/12/2026 10:30</td>
                      <td>
                        <span className="ue-log-badge registered">
                          <span className="dot" />
                          <span>Đăng ký tài khoản</span>
                        </span>
                      </td>
                      <td style={{ color: "#475569" }}>Tạo tài khoản mới từ form người dùng</td>
                      <td className="text-right" style={{ color: "#94A3B8" }}>—</td>
                    </tr>
                    <tr>
                      <td style={{ color: "#64748B", fontWeight: 500 }}>05/12/2026 14:20</td>
                      <td>
                        <span className="ue-log-badge approved">
                          <span className="dot" />
                          <span>Duyệt người dùng</span>
                        </span>
                      </td>
                      <td style={{ color: "#475569" }}>Cấp license 30 ngày dùng thử</td>
                      <td className="text-right">
                        <span className="ue-admin-tag">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="6" cy="4" r="2.5" stroke="#2563EB" strokeWidth="1"/>
                            <path d="M2 10C2 8 3.8 6.5 6 6.5C8.2 6.5 10 8 10 10" stroke="#2563EB" strokeWidth="1" strokeLinecap="round"/>
                          </svg>
                          <span>admin</span>
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ color: "#64748B", fontWeight: 500 }}>10/12/2026 09:15</td>
                      <td>
                        <span className="ue-log-badge reset">
                          <span className="dot" />
                          <span>Reset HWID</span>
                        </span>
                      </td>
                      <td style={{ color: "#475569" }}>
                        HWID mới: <span style={{ color: "#2563EB" }}>XYZ789...</span>
                      </td>
                      <td className="text-right">
                        <span className="ue-admin-tag">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="6" cy="4" r="2.5" stroke="#2563EB" strokeWidth="1"/>
                            <path d="M2 10C2 8 3.8 6.5 6 6.5C8.2 6.5 10 8 10 10" stroke="#2563EB" strokeWidth="1" strokeLinecap="round"/>
                          </svg>
                          <span>admin</span>
                        </span>
                      </td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* MainFooter */}
      <footer className="ue-footer">
        <span className="ue-footer-text">
          © 2026 FB Tool Admin. Hệ thống quản lý bản quyền phần mềm Facebook tự động hóa.
        </span>
        <div className="ue-footer-links">
          <a href="#" className="ue-footer-link" onClick={(e) => e.preventDefault()}>
            Điều khoản dịch vụ
          </a>
          <a href="#" className="ue-footer-link" onClick={(e) => e.preventDefault()}>
            Hỗ trợ kỹ thuật
          </a>
        </div>
      </footer>
    </div>
  );
}
