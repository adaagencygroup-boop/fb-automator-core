import { useState, useEffect } from "react";
import { api, User, getCurrentAdminUser } from "@/lib/api";
import { isValidPassword, validatePassword } from "@/lib/validation";
import { LogoutNoticeModal } from "@/components/LogoutNoticeModal";
import {
  IconClose,
  IconLockField,
  IconRefreshLock,
  IconEyeModal,
  IconCheckCircle,
  IconEditAdminHeader,
  IconSectionAccountBadge,
  IconUsernameAt,
  IconSuspendedLock,
  IconDeleteTrashRed,
  IconSaveDiskWhite,
  IconModalHeaderUser,
  IconPlus,
} from "./AdminIcons";
import { fmtDate } from "../utils";

interface AdminModalProps {
  isOpen: boolean;
  editTarget: User | null;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onDelete?: (user: User) => void;
}

export function AdminModal({
  isOpen,
  editTarget,
  onClose,
  onSuccess,
  onDelete,
}: AdminModalProps) {
  const isEdit = editTarget !== null;

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<"active" | "locked">("active");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [logoutNotice, setLogoutNotice] = useState<{
    isOpen: boolean;
    newUsername: string;
  }>({
    isOpen: false,
    newUsername: "",
  });

  useEffect(() => {
    if (isOpen) {
      setUsername(editTarget?.username ?? "");
      setPassword("");
      setConfirmPassword("");
      setShowPassword(false);
      setStatus(
        editTarget
          ? editTarget.status === "banned" || editTarget.status === "locked"
            ? "locked"
            : "active"
          : "active"
      );
      setErrorMsg("");
      setSubmitted(false);
      setLogoutNotice({ isOpen: false, newUsername: "" });
    }
  }, [isOpen, editTarget, isEdit]);

  if (logoutNotice.isOpen) {
    return (
      <LogoutNoticeModal
        isOpen={logoutNotice.isOpen}
        newUsername={logoutNotice.newUsername}
      />
    );
  }

  if (!isOpen) return null;

  const daysAgo = editTarget?.created_at
    ? Math.max(
        1,
        Math.floor(
          (Date.now() - new Date(editTarget.created_at).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      )
    : 31;

  const handleSave = async () => {
    setSubmitted(true);
    if (!username.trim()) {
      setErrorMsg("Vui lòng nhập tên đăng nhập.");
      return;
    }

    // Validate username: must contain both letters and numbers, no spaces
    const hasLetter = /[a-zA-Z]/.test(username);
    const hasNumber = /[0-9]/.test(username);
    const hasSpace = /\s/.test(username);

    if (hasSpace) {
      setErrorMsg("Tên đăng nhập không được chứa khoảng trắng.");
      return;
    }

    if (!hasLetter || !hasNumber) {
      setErrorMsg("Tên đăng nhập phải chứa cả chữ (a-z/A-Z) và số (0-9).");
      return;
    }

    if (!isEdit && !password.trim()) {
      setErrorMsg("Vui lòng nhập mật khẩu khởi tạo.");
      return;
    }

    if (password) {
      const passValidation = validatePassword(password);
      if (!passValidation.isValid) {
        setErrorMsg(passValidation.message || "Mật khẩu không thỏa mãn các điều kiện bảo mật.");
        return;
      }
    }

    if (password && !confirmPassword.trim()) {
      setErrorMsg("Vui lòng nhập xác nhận lại mật khẩu.");
      return;
    }

    if (password && confirmPassword && password !== confirmPassword) {
      setErrorMsg("Mật khẩu xác nhận không khớp.");
      return;
    }

    setErrorMsg("");
    setSaving(true);

    try {
      if (isEdit && editTarget) {
        const currentUser = getCurrentAdminUser();
        const isCurrent = Boolean(
          (currentUser?.username && editTarget.username.toLowerCase() === currentUser.username.toLowerCase()) ||
          (currentUser?.id && editTarget.id === currentUser.id)
        );
        const isUsernameChanged = username.trim().toLowerCase() !== editTarget.username.toLowerCase();

        if (isCurrent && isUsernameChanged) {
          // Bắt đầu quy trình đổi username của chính tài khoản đang đăng nhập
          sessionStorage.setItem("pending_logout_modal", "true");
          await api.editUser(editTarget.id, {
            username: username.trim(),
            status: status === "active" ? "approved" : "banned",
            role: editTarget.role || "admin",
            ...(password ? { password } : {}),
          });

          // Hiển thị modal popup logout trước khi thoát ra màn hình đăng nhập
          setLogoutNotice({
            isOpen: true,
            newUsername: username.trim(),
          });
          return;
        }

        await api.editUser(editTarget.id, {
          username: username.trim(),
          status: status === "active" ? "approved" : "banned",
          role: editTarget.role || "admin",
          ...(password ? { password } : {}),
        });
        onSuccess(`Đã cập nhật thông tin admin ${username.trim()}`);
      } else {
        await api.createUser({
          username: username.trim(),
          password: password,
          contact_info: "",
          days: 3650,
          status: status === "active" ? "approved" : "banned",
          role: "admin",
        });
        onSuccess(`Đã thêm admin ${username.trim()}`);
      }
      onClose();
    } catch (e: any) {
      sessionStorage.removeItem("pending_logout_modal");
      setErrorMsg(e.message || "Lỗi khi lưu thông tin");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSelf = () => {
    if (!editTarget || !onDelete) return;
    onClose();
    onDelete(editTarget);
  };

  const isPasswordInvalid =
    (password.length > 0 && !isValidPassword(password)) ||
    (submitted && !isEdit && !password.trim());

  const showPasswordError = isPasswordInvalid;

  return (
    <div
      className="adm-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="adm-modal adm-modal--edit">
        {/* ── Modal Header ── */}
        <div className="adm-modal-header">
          <div className="adm-modal-header-left">
            <div className="adm-modal-icon-badge adm-modal-icon-badge--blue">
              {isEdit ? <IconEditAdminHeader /> : <IconModalHeaderUser />}
            </div>
            <div className="adm-modal-header-info">
              <div className="adm-modal-title-row">
                <h2 className="adm-modal-title">
                  {isEdit
                    ? "Chỉnh sửa thông tin Admin"
                    : "Thêm Quản trị viên mới"}
                </h2>

                {/* Status Pill in Header */}
                {isEdit && (
                  <span
                    className={`adm-header-status-pill ${
                      status === "active"
                        ? "adm-header-status-pill--active"
                        : "adm-header-status-pill--locked"
                    }`}
                  >
                    <span className="adm-header-status-dot" />
                    <span>
                      {status === "active" ? "Đang hoạt động" : "Tạm khóa"}
                    </span>
                  </span>
                )}
              </div>

              {/* ID Badge */}
              {isEdit && editTarget && (
                <div className="adm-modal-id-badge">
                  ID: #ADM-{String(editTarget.id).padStart(3, "0")}
                </div>
              )}

              <p className="adm-modal-subtitle">
                {isEdit ? (
                  <>
                    Cập nhật thông tin tài khoản, quyền hạn và cấu hình bảo mật
                    cho quản trị viên <strong>{username || "admin"}</strong>.
                  </>
                ) : (
                  "Tạo tài khoản quản trị hệ thống FB Tool Admin."
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            className="adm-modal-close"
            onClick={onClose}
            aria-label="Đóng"
          >
            <IconClose />
          </button>
        </div>

        {/* ── Modal Body ── */}
        <div className="adm-modal-body">
          {/* Section 1: Account & Role Info */}
          <div className="adm-modal-section-header">
            <div className="adm-modal-section-title-left">
              <span className="adm-modal-section-icon">
                <IconSectionAccountBadge />
              </span>
              <span className="adm-modal-section-heading">
                1. THÔNG TIN TÀI KHOẢN &amp; VAI TRÒ
              </span>
            </div>
            {isEdit && editTarget && (
              <span className="adm-modal-section-meta">
                Khởi tạo: {fmtDate(editTarget.created_at)}
              </span>
            )}
          </div>

          {/* Username */}
          <div className="adm-form-group">
            <label className="adm-form-label">
              Tên đăng nhập{" "}
              {!isEdit && <span className="adm-req">*</span>}
            </label>
            <div className="adm-input-wrap">
              <span className="adm-input-icon">
                <IconUsernameAt />
              </span>
              <input
                type="text"
                className="adm-form-input"
                placeholder="admin01"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <span className="adm-form-hint">
              {isEdit
                ? "Tên đăng nhập phải chứa cả chữ (a-z/A-Z) và số (0-9), không chứa khoảng trắng."
                : "Dùng để đăng nhập vào portal quản trị."}
            </span>
          </div>

          {/* Password Section */}
          <div className="adm-form-group">
            <div className="adm-form-row">
              <div className="adm-form-group">
                <label className="adm-form-label">
                  {isEdit ? "Mật khẩu mới" : "Mật khẩu khởi tạo"}{" "}
                  {!isEdit ? (
                    <span className="adm-req">*</span>
                  ) : (
                    <span className="adm-form-hint" style={{ fontSize: "11px", fontWeight: "normal" }}>
                      (để trống nếu không đổi)
                    </span>
                  )}
                </label>
                <div
                  className={`adm-input-wrap ${
                    isPasswordInvalid ? "adm-input-wrap--error" : ""
                  }`}
                >
                  <span className="adm-input-icon">
                    <IconLockField />
                  </span>
                  <input
                    type={showPassword ? "text" : "password"}
                    className="adm-form-input"
                    placeholder={
                      isEdit
                        ? "Để trống nếu không đổi mật khẩu"
                        : "Nhập mật khẩu khởi tạo..."
                    }
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="adm-input-toggle-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={
                      showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"
                    }
                  >
                    <IconEyeModal />
                  </button>
                </div>
                {showPasswordError && (
                  <span
                    className="adm-match-text adm-match-text--error"
                    style={{ fontSize: "11.5px", lineHeight: "1.4", marginTop: "4px", display: "flex", alignItems: "flex-start" }}
                  >
                    {!password.trim()
                      ? "Vui lòng nhập mật khẩu khởi tạo."
                      : validatePassword(password).message}
                  </span>
                )}
                {password && isValidPassword(password) && (
                  <span
                    className="adm-match-text adm-match-text--success"
                    style={{ fontSize: "11.5px", marginTop: "4px", display: "flex", alignItems: "center" }}
                  >
                    <IconCheckCircle />
                    Mật khẩu mạnh hợp lệ
                  </span>
                )}
              </div>

              <div className="adm-form-group">
                <label className="adm-form-label">
                  {isEdit ? "Xác nhận mật khẩu mới" : "Xác nhận mật khẩu"}{" "}
                  {!isEdit && <span className="adm-req">*</span>}
                </label>
                <div className="adm-input-wrap">
                  <span className="adm-input-icon">
                    <IconRefreshLock />
                  </span>
                  <input
                    type={showPassword ? "text" : "password"}
                    className="adm-form-input"
                    placeholder={
                      isEdit
                        ? "Nhập lại mật khẩu mới..."
                        : "Nhập lại mật khẩu..."
                    }
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    disabled={isEdit && !password}
                  />
                </div>
                {password &&
                confirmPassword &&
                password === confirmPassword ? (
                  <span className="adm-match-text adm-match-text--success">
                    <IconCheckCircle />
                    Mật khẩu hoàn toàn khớp
                  </span>
                ) : confirmPassword && password !== confirmPassword ? (
                  <span className="adm-match-text adm-match-text--error">
                    Mật khẩu không khớp
                  </span>
                ) : null}
              </div>
            </div>
            {isEdit && (
              <span className="adm-form-hint" style={{ marginTop: "4px" }}>
                Lần cập nhật cuối:{" "}
                {fmtDate(
                  editTarget?.created_at || new Date().toISOString()
                )}{" "}
                ({daysAgo} ngày trước)
              </span>
            )}
          </div>

          {/* Section: Status Selection */}
          <div className="adm-form-group">
            <label className="adm-form-label">
              Tùy chọn trạng thái tài khoản
            </label>
            <div className="adm-status-cards">
              {/* Active Card */}
              <div
                className={`adm-status-card${
                  status === "active" ? " adm-status-card--active" : ""
                }`}
                onClick={() => setStatus("active")}
              >
                <span className="adm-status-radio">
                  {status === "active" ? (
                    <span className="adm-radio-dot" />
                  ) : null}
                </span>
                <div className="adm-status-card-text">
                  <div className="adm-status-card-name">
                    ● Đang hoạt động
                  </div>
                  <div className="adm-status-card-desc">
                    Đang kích hoạt, cho phép đăng nhập và thao tác API bình thường.
                  </div>
                </div>
              </div>

              {/* Locked / Suspended Card */}
              <div
                className={`adm-status-card${
                  status === "locked" ? " adm-status-card--locked" : ""
                }`}
                onClick={() => setStatus("locked")}
              >
                <span className="adm-status-radio">
                  {status === "locked" ? (
                    <span className="adm-radio-dot adm-radio-dot--locked" />
                  ) : (
                    <span className="adm-status-radio-lock">
                      <IconSuspendedLock />
                    </span>
                  )}
                </span>
                <div className="adm-status-card-text">
                  <div className="adm-status-card-name">
                    🔒 Tạm khóa
                  </div>
                  <div className="adm-status-card-desc">
                    Tạm ngưng quyền truy cập, thu hồi toàn bộ token đăng nhập.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {errorMsg && (
            <div className="adm-modal-error-banner">
              ✕ {errorMsg}
            </div>
          )}
        </div>

        {/* ── Modal Footer ── */}
        <div className="adm-modal-footer">
          <div className="adm-modal-footer-left">
            {isEdit && onDelete && (
              <button
                type="button"
                className="adm-btn-delete-modal"
                onClick={handleDeleteSelf}
              >
                <IconDeleteTrashRed />
                <span>XÓA TÀI KHOẢN</span>
              </button>
            )}
          </div>

          <div className="adm-modal-footer-right">
            <button
              type="button"
              className="adm-btn-cancel-modal"
              onClick={onClose}
            >
              HỦY BỎ
            </button>
            <button
              type="button"
              className="adm-btn-save-modal"
              onClick={handleSave}
              disabled={saving}
            >
              {isEdit ? (
                <>
                  <IconSaveDiskWhite />
                  <span>{saving ? "ĐANG LƯU..." : "LƯU THAY ĐỔI"}</span>
                </>
              ) : (
                <>
                  <IconPlus />
                  <span>{saving ? "ĐANG TẠO..." : "TẠO TÀI KHOẢN ADMIN"}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
