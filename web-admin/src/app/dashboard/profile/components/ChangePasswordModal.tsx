"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { validatePassword } from "@/lib/validation";

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  username?: string;
}

export function ChangePasswordModal({
  isOpen,
  onClose,
  onSuccess,
  username,
}: ChangePasswordModalProps) {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showOldPw, setShowOldPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (isOpen) {
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowOldPw(false);
      setShowNewPw(false);
      setShowConfirmPw(false);
      setErrorMsg("");
      setSaving(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Validation rules
  const validation = validatePassword(newPassword);
  const hasMinLen = validation.hasMinLength;
  const hasLettersOrDigits = validation.hasUppercase && validation.hasLowercase && validation.hasNumber && validation.hasSpecialChar;
  const isDifferent =
    newPassword.length > 0 &&
    oldPassword.length > 0 &&
    newPassword !== oldPassword;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg("");

    if (!oldPassword.trim()) {
      setErrorMsg("Vui lòng nhập mật khẩu hiện tại.");
      return;
    }
    if (!newPassword.trim()) {
      setErrorMsg("Vui lòng nhập mật khẩu mới.");
      return;
    }
    if (!validation.isValid) {
      setErrorMsg(validation.message || "Mật khẩu không hợp lệ.");
      return;
    }
    if (oldPassword === newPassword) {
      setErrorMsg("Mật khẩu mới phải khác mật khẩu hiện tại.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg("Xác nhận mật khẩu mới không khớp.");
      return;
    }

    setSaving(true);
    try {
      await api.changePassword({
        old_password: oldPassword,
        new_password: newPassword,
        username: username || undefined,
      });
      onSuccess("Đã cập nhật mật khẩu thành công!");
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Đổi mật khẩu thất bại. Vui lòng kiểm tra lại mật khẩu hiện tại.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cpm-overlay" onClick={onClose}>
      <div
        className="cpm-container"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cpm-title"
      >
        {/* Header */}
        <div className="cpm-header">
          <div className="cpm-header-left">
            <div className="cpm-badge">
              <svg width="22" height="22" viewBox="0 0 20 20" fill="none">
                <path
                  d="M3.33 8.33H16.67C17.59 8.33 18.33 9.07 18.33 10V15.83C18.33 16.75 17.59 17.5 16.67 17.5H3.33C2.41 17.5 1.67 16.75 1.67 15.83V10C1.67 9.07 2.41 8.33 3.33 8.33Z"
                  stroke="#0866FF"
                  strokeWidth="1.66667"
                />
                <path
                  d="M5 8.33V5C5 2.7 6.87 0.83 9.17 0.83C11.47 0.83 13.33 2.7 13.33 5V8.33"
                  stroke="#0866FF"
                  strokeWidth="1.66667"
                />
              </svg>
            </div>
            <div className="cpm-titles">
              <h2 id="cpm-title" className="cpm-title">
                Đổi mật khẩu
              </h2>
              <p className="cpm-subtitle">
                Cập nhật mật khẩu định kỳ để bảo vệ tài khoản quản trị viên
              </p>
            </div>
          </div>
          <button
            type="button"
            className="cpm-close-btn"
            onClick={onClose}
            aria-label="Đóng"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M13 1L1 13"
                stroke="#94A3B8"
                strokeWidth="1.66667"
                strokeLinecap="round"
              />
              <path
                d="M1 1L13 13"
                stroke="#94A3B8"
                strokeWidth="1.66667"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Body Form */}
        <form className="cpm-body" onSubmit={handleSubmit}>
          {errorMsg && (
            <div className="cpm-error-alert" role="alert">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="#E11D48" strokeWidth="1.5" />
                <path d="M8 5V8.5" stroke="#E11D48" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="8" cy="11.5" r="0.75" fill="#E11D48" />
              </svg>
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Field 1: Mật khẩu hiện tại */}
          <div className="cpm-field">
            <label className="cpm-label">
              Mật khẩu hiện tại <span className="cpm-required">*</span>
            </label>
            <div className="cpm-input-wrap">
              <input
                type={showOldPw ? "text" : "password"}
                className="cpm-input"
                placeholder="Nhập mật khẩu hiện tại..."
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                autoFocus
                disabled={saving}
              />
              <button
                type="button"
                className="cpm-eye-btn"
                onClick={() => setShowOldPw(!showOldPw)}
                tabIndex={-1}
              >
                {showOldPw ? (
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path
                      d="M2.25 9C2.25 9 5.25 3.75 9 3.75C12.75 3.75 15.75 9 15.75 9C15.75 9 12.75 14.25 9 14.25C5.25 14.25 2.25 9 2.25 9Z"
                      stroke="#94A3B8"
                      strokeWidth="1.33333"
                    />
                    <path
                      d="M9 11.25C10.24 11.25 11.25 10.24 11.25 9C11.25 7.76 10.24 6.75 9 6.75C7.76 6.75 6.75 7.76 6.75 9C6.75 10.24 7.76 11.25 9 11.25Z"
                      stroke="#94A3B8"
                      strokeWidth="1.33333"
                    />
                    <path d="M2.5 15.5L15.5 2.5" stroke="#94A3B8" strokeWidth="1.33333" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path
                      d="M2.25 9C2.25 9 5.25 3.75 9 3.75C12.75 3.75 15.75 9 15.75 9C15.75 9 12.75 14.25 9 14.25C5.25 14.25 2.25 9 2.25 9Z"
                      stroke="#94A3B8"
                      strokeWidth="1.33333"
                    />
                    <circle cx="9" cy="9" r="2.25" stroke="#94A3B8" strokeWidth="1.33333" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Field 2: Mật khẩu mới */}
          <div className="cpm-field">
            <label className="cpm-label">
              Mật khẩu mới <span className="cpm-required">*</span>
            </label>
            <div className="cpm-input-wrap">
              <input
                type={showNewPw ? "text" : "password"}
                className="cpm-input"
                placeholder="Nhập mật khẩu mới..."
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={saving}
              />
              <button
                type="button"
                className="cpm-eye-btn"
                onClick={() => setShowNewPw(!showNewPw)}
                tabIndex={-1}
              >
                {showNewPw ? (
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path
                      d="M2.25 9C2.25 9 5.25 3.75 9 3.75C12.75 3.75 15.75 9 15.75 9C15.75 9 12.75 14.25 9 14.25C5.25 14.25 2.25 9 2.25 9Z"
                      stroke="#94A3B8"
                      strokeWidth="1.33333"
                    />
                    <path
                      d="M9 11.25C10.24 11.25 11.25 10.24 11.25 9C11.25 7.76 10.24 6.75 9 6.75C7.76 6.75 6.75 7.76 6.75 9C6.75 10.24 7.76 11.25 9 11.25Z"
                      stroke="#94A3B8"
                      strokeWidth="1.33333"
                    />
                    <path d="M2.5 15.5L15.5 2.5" stroke="#94A3B8" strokeWidth="1.33333" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path
                      d="M2.25 9C2.25 9 5.25 3.75 9 3.75C12.75 3.75 15.75 9 15.75 9C15.75 9 12.75 14.25 9 14.25C5.25 14.25 2.25 9 2.25 9Z"
                      stroke="#94A3B8"
                      strokeWidth="1.33333"
                    />
                    <circle cx="9" cy="9" r="2.25" stroke="#94A3B8" strokeWidth="1.33333" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Field 3: Xác nhận mật khẩu mới */}
          <div className="cpm-field">
            <label className="cpm-label">
              Xác nhận mật khẩu mới <span className="cpm-required">*</span>
            </label>
            <div className="cpm-input-wrap">
              <input
                type={showConfirmPw ? "text" : "password"}
                className={`cpm-input${
                  confirmPassword && newPassword
                    ? confirmPassword === newPassword
                      ? " cpm-input--valid"
                      : " cpm-input--invalid"
                    : ""
                }`}
                placeholder="Nhập lại mật khẩu mới..."
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={saving}
              />
              <button
                type="button"
                className="cpm-eye-btn"
                onClick={() => setShowConfirmPw(!showConfirmPw)}
                tabIndex={-1}
              >
                {showConfirmPw ? (
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path
                      d="M2.25 9C2.25 9 5.25 3.75 9 3.75C12.75 3.75 15.75 9 15.75 9C15.75 9 12.75 14.25 9 14.25C5.25 14.25 2.25 9 2.25 9Z"
                      stroke="#94A3B8"
                      strokeWidth="1.33333"
                    />
                    <path
                      d="M9 11.25C10.24 11.25 11.25 10.24 11.25 9C11.25 7.76 10.24 6.75 9 6.75C7.76 6.75 6.75 7.76 6.75 9C6.75 10.24 7.76 11.25 9 11.25Z"
                      stroke="#94A3B8"
                      strokeWidth="1.33333"
                    />
                    <path d="M2.5 15.5L15.5 2.5" stroke="#94A3B8" strokeWidth="1.33333" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path
                      d="M2.25 9C2.25 9 5.25 3.75 9 3.75C12.75 3.75 15.75 9 15.75 9C15.75 9 12.75 14.25 9 14.25C5.25 14.25 2.25 9 2.25 9Z"
                      stroke="#94A3B8"
                      strokeWidth="1.33333"
                    />
                    <circle cx="9" cy="9" r="2.25" stroke="#94A3B8" strokeWidth="1.33333" />
                  </svg>
                )}
              </button>
            </div>
            {confirmPassword && newPassword && (
              <span
                className={`cpm-match-hint ${
                  confirmPassword === newPassword ? "cpm-match-hint--ok" : "cpm-match-hint--err"
                }`}
              >
                {confirmPassword === newPassword
                  ? "✓ Mật khẩu xác nhận trùng khớp"
                  : "✗ Mật khẩu xác nhận không trùng khớp"}
              </span>
            )}
          </div>

          {/* Security Standards Box (Tiêu chuẩn bảo mật) */}
          <div className="cpm-security-box">
            <div className="cpm-security-header">
              <svg width="14" height="16" viewBox="0 0 14 16" fill="none">
                <path
                  d="M7 15C7 15 12.33 12.333 12.33 8.333V3.667L7 1.667L1.67 3.667V8.333C1.67 12.333 7 15 7 15Z"
                  stroke="#2563EB"
                  strokeWidth="1.33333"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>Tiêu chuẩn mật khẩu an toàn:</span>
            </div>
            <ul className="cpm-security-list">
              <li className={`cpm-rule ${hasMinLen ? "cpm-rule--met" : ""}`}>
                <span className="cpm-rule-icon">
                  {hasMinLen ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="7" r="6" fill="#ECFDF5" stroke="#10B981" strokeWidth="1.2" />
                      <path d="M4.5 7L6.2 8.7L9.5 5.3" stroke="#10B981" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="7" r="2.5" fill="#94A3B8" />
                    </svg>
                  )}
                </span>
                <span>Từ 8 đến 12 ký tự</span>
              </li>
              <li className={`cpm-rule ${hasLettersOrDigits ? "cpm-rule--met" : ""}`}>
                <span className="cpm-rule-icon">
                  {hasLettersOrDigits ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="7" r="6" fill="#ECFDF5" stroke="#10B981" strokeWidth="1.2" />
                      <path d="M4.5 7L6.2 8.7L9.5 5.3" stroke="#10B981" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="7" r="2.5" fill="#94A3B8" />
                    </svg>
                  )}
                </span>
                <span>Có chữ hoa, chữ thường, số và ký tự đặc biệt</span>
              </li>
              <li className={`cpm-rule ${isDifferent ? "cpm-rule--met" : ""}`}>
                <span className="cpm-rule-icon">
                  {isDifferent ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="7" r="6" fill="#ECFDF5" stroke="#10B981" strokeWidth="1.2" />
                      <path d="M4.5 7L6.2 8.7L9.5 5.3" stroke="#10B981" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="7" r="2.5" fill="#94A3B8" />
                    </svg>
                  )}
                </span>
                <span>Khác với mật khẩu hiện tại</span>
              </li>
            </ul>
          </div>

          {/* Footer Actions */}
          <div className="cpm-actions">
            <button
              type="button"
              className="cpm-btn-cancel"
              onClick={onClose}
              disabled={saving}
            >
              HỦY BỎ
            </button>
            <button
              type="submit"
              className="cpm-btn-submit"
              disabled={saving}
            >
              {saving ? (
                <>
                  <span className="cpm-btn-spinner" />
                  <span>ĐANG CẬP NHẬT...</span>
                </>
              ) : (
                "CẬP NHẬT MẬT KHẨU"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
