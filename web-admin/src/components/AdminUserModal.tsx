"use client";

import { useState, useEffect } from "react";
import { User, api } from "@/lib/api";
import { isValidPhoneNumber, isValidPassword, validatePassword } from "@/lib/validation";
import { Eye, EyeOff, Phone, Monitor, Clock, Plus, Check, AlertCircle } from "lucide-react";
import "./AdminUserModal.css";

interface Props {
  user: User | null; // If null => Add mode, if User => Edit mode
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface ModuleOption {
  id: number;
  key: string;
  name: string;
  enabled: boolean;
  days: number;
}

const DEFAULT_MODULES: Omit<ModuleOption, "enabled" | "days">[] = [
  { id: 1, key: "accounts", name: "1. Quản lý tài khoản Facebook" },
  { id: 2, key: "farm", name: "2. Đăng bài và tương tác tài khoản" },
  { id: 3, key: "page_creator", name: "3. Tạo Fanpage hàng loạt" },
  { id: 4, key: "page_manager", name: "4. Quản lý Fanpage" },
  { id: 5, key: "chat", name: "5. Quản lý Chat Page" },
  { id: 6, key: "group_spam", name: "6. Spam Group Hội Nhóm" },
  { id: 7, key: "seeding", name: "7. Seeding Bài & Page" },
  { id: 8, key: "group_scan", name: "8. Quét nhóm" },
  { id: 9, key: "page_scanner", name: "9. Quét page" },
  { id: 10, key: "post_scanner", name: "10. Quét bài viết" },
  { id: 11, key: "profile_scanner", name: "11. Quét profile" },
];

export default function AdminUserModal({ user, isOpen, onClose, onSuccess }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [contactInfo, setContactInfo] = useState("");
  const [hwid, setHwid] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    username?: boolean;
    contactInfo?: boolean;
    password?: boolean;
  }>({});

  // Module state list
  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [bulkDaysInput, setBulkDaysInput] = useState<string>("30");

  const generateRandomPassword = () => {
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const prefixes = ["FbTool", "AdaTool", "AutoFb", "PagePro"];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const pass = `${prefix}#${randomNum}@`;
    setPassword(pass);
    if (fieldErrors.password) {
      setFieldErrors((prev) => ({ ...prev, password: false }));
    }
  };

  useEffect(() => {
    if (isOpen) {
      setError("");
      setFieldErrors({});
      setShowPassword(false);
      setBulkDaysInput("30");

      // Default checked modules matching the Figma design screenshot:
      // Active: 1, 2, 4, 6, 8, 9, 11 (all 30 days)
      // Inactive: 3, 5, 7, 10 (0 days)
      const defaultActiveIds = [1, 2, 4, 6, 8, 9, 11];

      if (user) {
        setUsername(user.username);
        setPassword("");
        setContactInfo(user.contact_info || "");
        setHwid(user.hwid || "");
        const userDays = user.days_remaining && user.days_remaining > 0 ? user.days_remaining : 30;

        setModules(
          DEFAULT_MODULES.map((m) => ({
            ...m,
            enabled: true,
            days: userDays,
          }))
        );
      } else {
        setUsername("");
        setPassword("FbTool#9821@");
        setContactInfo("");
        setHwid("");

        setModules(
          DEFAULT_MODULES.map((m) => {
            const isChecked = defaultActiveIds.includes(m.id);
            return {
              ...m,
              enabled: isChecked,
              days: isChecked ? 30 : 0,
            };
          })
        );
      }
    }
  }, [isOpen, user]);

  if (!isOpen) return null;

  const toggleModule = (id: number) => {
    const parsedBulk = parseInt(bulkDaysInput, 10);
    const fallbackDays = !isNaN(parsedBulk) && parsedBulk > 0 ? parsedBulk : 30;
    setModules((prev) =>
      prev.map((m) => {
        if (m.id === id) {
          const nextEnabled = !m.enabled;
          return {
            ...m,
            enabled: nextEnabled,
            days: nextEnabled ? (m.days > 0 ? m.days : fallbackDays) : 0,
          };
        }
        return m;
      })
    );
  };

  const handleModuleDaysChange = (id: number, val: string) => {
    const num = parseInt(val, 10);
    setModules((prev) =>
      prev.map((m) => {
        if (m.id === id) {
          return {
            ...m,
            days: isNaN(num) ? 0 : Math.max(0, num),
          };
        }
        return m;
      })
    );
  };

  const handleApplyBulkDays = () => {
    const parsed = parseInt(bulkDaysInput, 10);
    const targetDays = !isNaN(parsed) && parsed > 0 ? parsed : 30;
    setModules((prev) =>
      prev.map((m) => (m.enabled ? { ...m, days: targetDays } : m))
    );
  };

  const handleSelectAll = () => {
    const parsedBulk = parseInt(bulkDaysInput, 10);
    const targetDays = !isNaN(parsedBulk) && parsedBulk > 0 ? parsedBulk : 30;
    const allChecked = modules.every((m) => m.enabled);
    setModules((prev) =>
      prev.map((m) => ({
        ...m,
        enabled: !allChecked,
        days: !allChecked ? targetDays : 0,
      }))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (user && user.status === "rejected") {
      setError("Tài khoản bị từ chối chỉ được phép xem, không thể chỉnh sửa.");
      return;
    }

    // Validation
    const errors: { username?: boolean; contactInfo?: boolean; password?: boolean } = {};

    if (!username.trim()) {
      errors.username = true;
    }
    if (!contactInfo.trim() || !isValidPhoneNumber(contactInfo)) {
      errors.contactInfo = true;
    }
    if (!user) {
      if (!password.trim() || !isValidPassword(password)) {
        errors.password = true;
      }
    } else {
      if (password.trim() && !isValidPassword(password)) {
        errors.password = true;
      }
    }

    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      if (errors.username) {
        setError("Vui lòng nhập Tên đăng nhập!");
      } else if (errors.contactInfo) {
        if (!contactInfo.trim()) {
          setError("Vui lòng nhập Số điện thoại!");
        } else {
          setError("Số điện thoại không đúng định dạng. Vui lòng nhập SĐT hợp lệ (ví dụ: 0988.123.456 hoặc 0988123456)");
        }
      } else if (errors.password) {
        if (!password.trim() && !user) {
          setError("Vui lòng nhập Mật khẩu khởi tạo!");
        } else {
          const passRes = validatePassword(password);
          setError(passRes.message || "Mật khẩu không thỏa mãn các yêu cầu bảo mật!");
        }
      }
      return;
    }

    // Determine max active days from modules
    const activeModules = modules.filter((m) => m.enabled && m.days > 0);
    const maxDays = activeModules.length > 0 ? Math.max(...activeModules.map((m) => m.days)) : 30;

    setLoading(true);

    try {
      if (user) {
        // Edit mode
        await api.editUser(user.id, {
          contact_info: contactInfo.trim(),
          status: "approved",
          days: maxDays,
          ...(password.trim() ? { password: password.trim() } : {}),
          hwid: hwid.trim(),
        });
      } else {
        // Add mode
        await api.createUser({
          username: username.trim(),
          password: password.trim(),
          contact_info: contactInfo.trim(),
          days: maxDays,
          status: "approved",
          role: "user",
          ...(hwid.trim() ? { hwid: hwid.trim() } : {}),
        });
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || "Lưu thông tin thất bại");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="aum-backdrop">
      <div className="aum-modal">
        {/* Modal Header */}
        <div className="aum-header">
          <div className="aum-header-left">
            <div className="aum-icon-box">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M16 7V10M16 10V13M16 10H19M16 10H13M11 5C11 7.20766 9.20766 9 7 9C4.79234 9 3 7.20766 3 5C3 2.79234 4.79234 1 7 1C9.20766 1 11 2.79234 11 5L16 7M1 18C1 14.6885 3.68851 12 7 12C10.3115 12 13 14.6885 13 18V19H1V18V18" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="#2563EB"/>
              </svg>
            </div>
            <div className="aum-header-info">
              <h2 className="aum-title">
                {user ? `Chỉnh sửa: ${user.username}` : "Thêm người dùng mới"}
              </h2>
              <p className="aum-subtitle">
                {user
                  ? "Cập nhật thông tin tài khoản, phân bổ tính năng và quản lý HWID thiết bị."
                  : "Tạo tài khoản người dùng, cấp bản quyền (license) và phân bổ HWID thiết bị."}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="aum-close-btn"
            title="Đóng popup"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Modal Form */}
        <form noValidate onSubmit={handleSubmit} className="aum-form" autoComplete="off">
          <input type="text" name="fake_username_remember" className="hidden" tabIndex={-1} autoComplete="off" />
          <input type="password" name="fake_password_remember" className="hidden" tabIndex={-1} autoComplete="new-password" />

          {error && (
            <div className="aum-error flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* SECTION 1: ACCOUNT & CONTACT INFO */}
          <div className="aum-section-1">
            <div className="aum-section-header">
              <div className="aum-pill-bar" />
              <h4 className="aum-section-title">1. THÔNG TIN TÀI KHOẢN & LIÊN HỆ</h4>
            </div>

            <div className="aum-row-grid">
              {/* Username Input */}
              <div className="aum-form-group">
                <label className="aum-label">
                  Tên đăng nhập (Username) <span className="aum-required">*</span>
                </label>
                <div className="aum-input-wrap">
                  <span className="aum-input-icon">@</span>
                  <input
                    type="text"
                    name="admin_user_username"
                    autoComplete="off"
                    disabled={Boolean(user)}
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      if (fieldErrors.username) {
                        setFieldErrors((prev) => ({ ...prev, username: false }));
                      }
                    }}
                    placeholder="ví dụ: user006"
                    className={`aum-input ${fieldErrors.username ? "aum-input-error" : ""}`}
                  />
                </div>
              </div>

              {/* Phone Input */}
              <div className="aum-form-group">
                <label className="aum-label">
                  Số điện thoại <span className="aum-required">*</span>
                </label>
                <div className="aum-input-wrap">
                  <span className="aum-input-icon">
                    <Phone className="w-3.5 h-3.5" />
                  </span>
                  <input
                    type="text"
                    name="admin_user_contact"
                    autoComplete="off"
                    value={contactInfo}
                    onChange={(e) => {
                      setContactInfo(e.target.value);
                      if (fieldErrors.contactInfo) {
                        setFieldErrors((prev) => ({ ...prev, contactInfo: false }));
                      }
                    }}
                    placeholder="0988.123.456"
                    className={`aum-input ${fieldErrors.contactInfo ? "aum-input-error" : ""}`}
                  />
                </div>
              </div>
            </div>

            {/* Password Row */}
            <div className="aum-form-group">
              <div className="aum-pass-header">
                <label className="aum-label">
                  {user ? "Mật khẩu mới (để trống nếu không đổi)" : "Mật khẩu khởi tạo"}{" "}
                  {!user && <span className="aum-required">*</span>}
                </label>
                <button
                  type="button"
                  onClick={generateRandomPassword}
                  className="aum-gen-btn"
                >
                  Tạo ngẫu nhiên
                </button>
              </div>

              <div className="aum-input-wrap">
                <input
                  type={showPassword ? "text" : "password"}
                  name="admin_user_password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (fieldErrors.password) {
                      setFieldErrors((prev) => ({ ...prev, password: false }));
                    }
                  }}
                  placeholder={user ? "Nhập mật khẩu mới nếu muốn đổi" : "FbTool#9821@"}
                  className={`aum-pass-input ${
                    fieldErrors.password || (password.trim() !== "" && !isValidPassword(password))
                      ? "aum-input-error"
                      : ""
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="aum-pass-toggle"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {(fieldErrors.password || (password.trim() !== "" && !isValidPassword(password))) && (
                <span className="text-[11px] text-red-500 mt-1 block font-medium">
                  {!password.trim()
                    ? "Vui lòng nhập mật khẩu khởi tạo!"
                    : validatePassword(password).message}
                </span>
              )}
            </div>
          </div>

          {/* SECTION 2: MODULE FEATURES & HWID */}
          <div className="aum-section-2">
            <div className="aum-section-header">
              <div className="aum-pill-bar" />
              <h4 className="aum-section-title">2. CẤP PHÁT TÍNH NĂNG & MÃ PHẦN CỨNG (HWID)</h4>
            </div>

            {/* Action Bar */}
            <div className="aum-module-control-bar">
              <div className="aum-module-control-left">
                <div className="aum-module-control-dot" />
                <span className="aum-module-control-text">
                  Tick chọn tính năng muốn cấp quyền và nhập số ngày sử dụng riêng cho từng tính năng
                </span>
              </div>

              <div className="aum-module-control-right">
                <div className="aum-bulk-days-wrap">
                  <span className="aum-bulk-days-label">Số ngày:</span>
                  <input
                    type="number"
                    min={1}
                    value={bulkDaysInput}
                    onChange={(e) => setBulkDaysInput(e.target.value)}
                    onBlur={() => {
                      if (!bulkDaysInput || parseInt(bulkDaysInput, 10) <= 0 || isNaN(parseInt(bulkDaysInput, 10))) {
                        setBulkDaysInput("30");
                      }
                    }}
                    className="aum-bulk-days-input"
                  />
                  <button
                    type="button"
                    onClick={handleApplyBulkDays}
                    className="aum-bulk-apply-btn"
                  >
                    Áp dụng cho tất cả
                  </button>
                </div>

                <div className="aum-control-divider" />

                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="aum-select-all-btn"
                >
                  {modules.every((m) => m.enabled) ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                </button>
              </div>
            </div>

            {/* Modules 2-column Grid */}
            <div className="aum-modules-grid">
              {modules.map((m) => (
                <div
                  key={m.id}
                  className={`aum-module-card ${
                    m.enabled ? "aum-module-card--active" : "aum-module-card--inactive"
                  }`}
                >
                  <div
                    className="aum-module-left"
                    onClick={() => toggleModule(m.id)}
                  >
                    <input
                      type="checkbox"
                      checked={m.enabled}
                      onChange={() => {}}
                      className="aum-module-checkbox"
                    />
                    <span className="aum-module-name">{m.name}</span>
                  </div>

                  <div className="aum-module-right">
                    <input
                      type="number"
                      min={0}
                      disabled={!m.enabled}
                      value={m.days}
                      onChange={(e) => handleModuleDaysChange(m.id, e.target.value)}
                      className={`aum-module-days-input ${
                        m.enabled ? "aum-module-days-input--active" : "aum-module-days-input--disabled"
                      }`}
                    />
                    <span className="aum-module-unit">ngày</span>
                  </div>
                </div>
              ))}
            </div>

            {/* HWID Field */}
            <div className="aum-form-group w-full">
              <div className="aum-hwid-header">
                <label className="aum-label">Mã phần cứng máy tính (HWID)</label>
                <span className="aum-hwid-optional">Không bắt buộc khi tạo mới</span>
              </div>
              <div className="aum-input-wrap">
                <span className="aum-input-icon">
                  <Monitor className="w-3.5 h-3.5" />
                </span>
                <input
                  type="text"
                  name="admin_user_hwid"
                  autoComplete="off"
                  value={hwid}
                  onChange={(e) => setHwid(e.target.value)}
                  placeholder="Để trống nếu muốn tự động gán HWID khi user login lần đầu"
                  className="aum-hwid-input"
                />
              </div>
            </div>
          </div>

          {/* FOOTER ACTIONS */}
          <div className="aum-footer">
            <div className="aum-footer-left">
              <Clock className="w-4 h-4 text-slate-400" />
              <span className="aum-footer-text">Dữ liệu sẽ được ghi nhận vào nhật ký hệ thống</span>
            </div>

            <div className="aum-footer-right">
              <button
                type="button"
                onClick={onClose}
                className="aum-cancel-btn"
              >
                Hủy bỏ
              </button>

              <button
                type="submit"
                disabled={loading}
                className="aum-submit-btn"
              >
                {loading ? (
                  <span>Đang xử lý...</span>
                ) : (
                  <span>{user ? "Lưu thông tin" : "Tạo người dùng mới"}</span>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

