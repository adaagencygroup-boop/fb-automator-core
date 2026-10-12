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

export default function AdminUserModal({ user, isOpen, onClose, onSuccess }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [contactInfo, setContactInfo] = useState("");
  const [hwid, setHwid] = useState("");
  const [days, setDays] = useState(30);
  const [isCustomDays, setIsCustomDays] = useState(false);
  const [customDaysInput, setCustomDaysInput] = useState("30");
  const [status, setStatus] = useState<"approved" | "pending">("approved");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    username?: boolean;
    contactInfo?: boolean;
    password?: boolean;
    customDays?: boolean;
  }>({});

  const PRESET_DURATIONS = [
    { label: "7 ngày", sub: "Dùng thử", days: 7 },
    { label: "30 ngày", sub: "1 tháng", days: 30 },
    { label: "90 ngày", sub: "3 tháng", days: 90 },
    { label: "365 ngày", sub: "1 năm", days: 365 },
  ];

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
      if (user) {
        setUsername(user.username);
        setPassword("");
        setContactInfo(user.contact_info || "");
        setHwid(user.hwid || "");
        const userDays = user.days_remaining && user.days_remaining > 0 ? user.days_remaining : 30;
        setDays(userDays);
        const isPreset = PRESET_DURATIONS.some((p) => p.days === userDays);
        setIsCustomDays(!isPreset);
        setCustomDaysInput(String(userDays));
        setStatus(user.status === "pending" ? "pending" : "approved");
      } else {
        setUsername("");
        setPassword("");
        setContactInfo("");
        setHwid("");
        setDays(30);
        setIsCustomDays(false);
        setCustomDaysInput("30");
        setStatus("approved");
      }
    }
  }, [isOpen, user]);

  if (!isOpen) return null;

  const handleSelectPresetDays = (selectedDays: number) => {
    setIsCustomDays(false);
    setDays(selectedDays);
    setCustomDaysInput(String(selectedDays));
    if (fieldErrors.customDays) {
      setFieldErrors((prev) => ({ ...prev, customDays: false }));
    }
  };

  const handleSelectCustomDays = () => {
    setIsCustomDays(true);
    const parsed = parseInt(customDaysInput, 10);
    if (!isNaN(parsed) && parsed > 0) {
      setDays(parsed);
    }
  };

  const handleCustomDaysChange = (val: string) => {
    setCustomDaysInput(val);
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed > 0) {
      setDays(parsed);
      if (fieldErrors.customDays) {
        setFieldErrors((prev) => ({ ...prev, customDays: false }));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (user && user.status === "rejected") {
      setError("Tài khoản bị từ chối chỉ được phép xem, không thể chỉnh sửa.");
      return;
    }

    // Custom Validation
    const errors: { username?: boolean; contactInfo?: boolean; password?: boolean; customDays?: boolean } = {};

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
    if (isCustomDays) {
      const parsedDays = parseInt(customDaysInput, 10);
      if (isNaN(parsedDays) || parsedDays <= 0) {
        errors.customDays = true;
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
          setError("Số điện thoại không đúng định dạng. Vui lòng nhập SĐT hợp lệ (ví dụ: 0988123456 hoặc +84988123456)");
        }
      } else if (errors.password) {
        if (!password.trim() && !user) {
          setError("Vui lòng nhập Mật khẩu khởi tạo!");
        } else {
          const passRes = validatePassword(password);
          setError(passRes.message || "Mật khẩu không thỏa mãn các yêu cầu bảo mật!");
        }
      } else if (errors.customDays) {
        setError("Số ngày hết hạn bản quyền phải là số nguyên dương lớn hơn 0 (ví dụ: 1, 30, 90...)!");
      } else {
        setError("Vui lòng điền đầy đủ các thông tin bắt buộc (*)");
      }
      return;
    }

    setLoading(true);

    try {
      if (user) {
        // Edit mode
        await api.editUser(user.id, {
          contact_info: contactInfo.trim(),
          status,
          ...(status === "pending" ? {} : { days }),
          ...(password.trim() ? { password: password.trim() } : {}),
        });
      } else {
        // Add mode
        await api.createUser({
          username: username.trim(),
          password: password.trim(),
          contact_info: contactInfo.trim(),
          days,
          status,
          role: "user",
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
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M18 9V12M18 12V15M18 12H21M18 12H15M13 7C13 9.20766 11.2077 11 9 11C6.79234 11 5 9.20766 5 7C5 4.79234 6.79234 3 9 3C11.2077 3 13 4.79234 13 7L18 9M3 20C3 16.6885 5.68851 14 9 14C12.3115 14 15 16.6885 15 20V21H3V20V20"
                  stroke="#2563EB"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="aum-header-info">
              <h2 className="aum-title">
                {user ? `Chỉnh sửa: ${user.username}` : "Thêm người dùng mới"}
              </h2>
              <p className="aum-subtitle">
                {user
                  ? "Cập nhật thông tin tài khoản, gia hạn bản quyền và trạng thái."
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
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Modal Form */}
        <form noValidate onSubmit={handleSubmit} className="aum-form" autoComplete="off">
          {/* Prevent Chromium aggressive autofill */}
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
                {fieldErrors.contactInfo && (
                  <span className="text-[11px] text-red-500 mt-1 block font-medium">
                    {!contactInfo.trim()
                      ? "Vui lòng nhập số điện thoại!"
                      : "SĐT không đúng định dạng (VD: 0988123456 hoặc +84988123456)"}
                  </span>
                )}
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
                  placeholder={user ? "Nhập mật khẩu mới nếu muốn đổi" : "Nhập mật khẩu khởi tạo"}
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

          {/* SECTION 2: LICENSE & HWID BINDING */}
          <div className="aum-section-2">
            <div className="aum-section-header">
              <div className="aum-pill-bar" />
              <h4 className="aum-section-title">2. CẤP BẢN QUYỀN (LICENSE) & THIẾT BỊ HWID</h4>
            </div>

            <div className="aum-form-group">
              <label className="aum-label">
                Thời hạn bản quyền <span className="aum-required">*</span>
              </label>

              <div className="aum-durations-grid">
                {PRESET_DURATIONS.map((preset) => {
                  const isSelected = !isCustomDays && days === preset.days;
                  return (
                    <div
                      key={preset.days}
                      onClick={() => handleSelectPresetDays(preset.days)}
                      className={`aum-duration-card ${isSelected ? "aum-duration-card--active" : ""}`}
                    >
                      {isSelected && (
                        <div className="aum-duration-badge">
                          <Check className="w-2.5 h-2.5 text-white stroke-[3]" />
                        </div>
                      )}
                      <div className="aum-duration-title">{preset.label}</div>
                      <div className="aum-duration-sub">{preset.sub}</div>
                    </div>
                  );
                })}

                {/* Custom days */}
                <div
                  onClick={handleSelectCustomDays}
                  className={`aum-duration-card aum-duration-card--custom ${
                    isCustomDays ? "aum-duration-card--active" : ""
                  }`}
                >
                  {isCustomDays && (
                    <div className="aum-duration-badge">
                      <Check className="w-2.5 h-2.5 text-white stroke-[3]" />
                    </div>
                  )}
                  <div className="aum-duration-title">Tùy chỉnh</div>
                  <div className="aum-duration-sub">
                    {isCustomDays
                      ? !isNaN(parseInt(customDaysInput, 10)) && parseInt(customDaysInput, 10) > 0
                        ? `${parseInt(customDaysInput, 10)} ngày`
                        : "Không hợp lệ"
                      : "Chọn ngày..."}
                  </div>
                </div>
              </div>

              {isCustomDays && (
                <div>
                  <div className="aum-custom-input-row">
                    <span className="aum-label" style={{ fontSize: "11px" }}>Nhập số ngày:</span>
                    <input
                      type="number"
                      min={1}
                      value={customDaysInput}
                      onChange={(e) => handleCustomDaysChange(e.target.value)}
                      className={`aum-custom-days-input ${
                        fieldErrors.customDays ||
                        (customDaysInput !== "" &&
                          (isNaN(parseInt(customDaysInput, 10)) || parseInt(customDaysInput, 10) <= 0))
                          ? "aum-input-error"
                          : ""
                      }`}
                      placeholder="Số ngày"
                    />
                    <span className="aum-label" style={{ fontSize: "11px" }}>ngày</span>
                  </div>
                  {(fieldErrors.customDays ||
                    (customDaysInput !== "" &&
                      (isNaN(parseInt(customDaysInput, 10)) || parseInt(customDaysInput, 10) <= 0))) && (
                    <span className="text-[11px] text-red-500 mt-1 block font-medium">
                      Số ngày hết hạn phải là số nguyên dương lớn hơn 0 (ví dụ: 1, 30, 90...)
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* HWID Field */}
            <div className="aum-form-group">
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
              <Clock className="w-3.5 h-3.5 text-[#94A3B8]" />
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
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    <span>{user ? "Lưu thông tin" : "Tạo người dùng mới"}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
