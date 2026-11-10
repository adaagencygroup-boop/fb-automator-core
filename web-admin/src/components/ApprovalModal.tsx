"use client";

import { useState, useEffect } from "react";
import { User, api } from "@/lib/api";
import { X, User as UserIcon, Contact, Cpu, Calendar, Copy, CheckCircle2, RotateCw } from "lucide-react";
import "./ApprovalModal.css";

interface Props {
  user: User | null;
  onClose: () => void;
  onSuccess: () => void;
  mode?: "approve" | "extend";
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

export default function ApprovalModal({ user, onClose, onSuccess, mode }: Props) {
  const [bulkDaysInput, setBulkDaysInput] = useState<string>("30");
  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [loadingApprove, setLoadingApprove] = useState(false);
  const [loadingReject, setLoadingReject] = useState(false);
  const [error, setError] = useState("");
  const [copiedHwid, setCopiedHwid] = useState(false);

  const isExtend = user?.status !== "pending" && (mode === "extend" || (user && (user.status === "approved" || user.status === "expired")));
  const isRejected = user?.status === "rejected";

  useEffect(() => {
    if (user) {
      setBulkDaysInput("30");
      setError("");
      setCopiedHwid(false);

      // Default: All 11 modules selected with 30 days as in Figma screenshot
      const userDays = user.days_remaining && user.days_remaining > 0 ? user.days_remaining : 30;
      setModules(
        DEFAULT_MODULES.map((m) => ({
          ...m,
          enabled: true,
          days: userDays,
        }))
      );
    }
  }, [user]);

  if (!user) return null;

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
    const parsed = parseInt(bulkDaysInput, 10);
    const targetDays = !isNaN(parsed) && parsed > 0 ? parsed : 30;
    setModules((prev) =>
      prev.map((m) => ({
        ...m,
        enabled: true,
        days: targetDays,
      }))
    );
  };

  const handleDeselectAll = () => {
    setModules((prev) =>
      prev.map((m) => ({
        ...m,
        enabled: false,
        days: 0,
      }))
    );
  };

  const handleConfirm = async () => {
    const activeModules = modules.filter((m) => m.enabled && m.days > 0);
    if (activeModules.length === 0) {
      setError("Vui lòng kích hoạt ít nhất một tính năng với số ngày lớn hơn 0!");
      return;
    }
    const maxDays = Math.max(...activeModules.map((m) => m.days));

    setLoadingApprove(true);
    setError("");
    try {
      let successMsg = "";
      if (isExtend) {
        if (user.status === "pending") {
          setError("Tài khoản đang chờ duyệt không thể gia hạn. Vui lòng phê duyệt tài khoản trước.");
          setLoadingApprove(false);
          return;
        }
        await api.extendUser(user.id, maxDays);
        successMsg = `Gia hạn thành công +${maxDays} ngày cho tài khoản ${user.username}!`;
      } else {
        await api.approveUser(user.id, maxDays);
        successMsg = isRejected
          ? `Phê duyệt lại tài khoản ${user.username} thành công (+${maxDays} ngày)!`
          : `Phê duyệt tài khoản ${user.username} thành công (+${maxDays} ngày)!`;
      }

      window.dispatchEvent(
        new CustomEvent("app_toast", {
          detail: { msg: successMsg, type: "success" },
        })
      );

      onSuccess();
      onClose();
    } catch (e: any) {
      setError(e.message || (isExtend ? "Cập nhật thời hạn thất bại" : "Phê duyệt thất bại"));
    } finally {
      setLoadingApprove(false);
    }
  };

  const handleReject = async () => {
    setLoadingReject(true);
    setError("");
    try {
      await api.rejectUser(user.id);
      window.dispatchEvent(
        new CustomEvent("app_toast", {
          detail: { msg: `Đã từ chối tài khoản ${user.username}!`, type: "success" },
        })
      );

      onSuccess();
      onClose();
    } catch (e: any) {
      setError(e.message || "Từ chối thất bại");
    } finally {
      setLoadingReject(false);
    }
  };

  const copyHwid = (hwidStr: string) => {
    if (!hwidStr) return;
    navigator.clipboard.writeText(hwidStr);
    setCopiedHwid(true);
    setTimeout(() => setCopiedHwid(false), 2000);
  };

  const parseUtcDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    const isoStr = dateStr.endsWith("Z") || dateStr.includes("+") ? dateStr : `${dateStr}Z`;
    const d = new Date(isoStr);
    return isNaN(d.getTime()) ? new Date(dateStr) : d;
  };

  const formattedCreatedAt = (() => {
    const d = parseUtcDate(user.created_at);
    return d
      ? d.toLocaleString("vi-VN", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";
  })();

  const displayUid = `UID: #USR-${String(user.id).padStart(5, "0")}-VN`;
  const displayStatus =
    user.status === "pending"
      ? "Pending"
      : user.status === "approved"
      ? "Active"
      : user.status === "rejected"
      ? "Rejected"
      : user.status === "banned"
      ? "Banned"
      : user.status === "expired"
      ? "Expired"
      : user.status;

  const activeCount = modules.filter((m) => m.enabled).length;

  return (
    <div className="apm-backdrop">
      <div className="apm-modal">
        {/* Button - Đóng modal */}
        <button
          type="button"
          onClick={onClose}
          className="apm-close-btn"
          title="Đóng popup"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>

        {/* Modal Content Body */}
        <div className="apm-modal-body">
          {/* Section - LeftColumn (User Information) */}
          <div className="apm-left-card">
            {/* Header User Profile Card */}
            <div className="apm-user-header">
              <div className="apm-user-profile">
                {/* Avatar with Online Status Dot */}
                <div className="apm-avatar-wrap">
                  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M24.9133 25.4627C27.5248 23.0088 29.0042 19.5835 29 16C29 8.82 23.18 3 16 3C8.82001 3 3.00001 8.82 3.00001 16C2.99586 19.5835 4.47518 23.0088 7.08668 25.4627C9.49592 27.7385 12.6858 29.0045 16 29C19.3142 29.0045 22.5041 27.7385 24.9133 25.4627V25.4627M8.19334 23.7493C10.0896 21.3769 12.9629 19.997 16 20C19.0371 19.997 21.9104 21.3769 23.8067 23.7493C21.7437 25.8331 18.9322 27.0038 16 27C13.0678 27.0038 10.2563 25.8331 8.19334 23.7493V23.7493M21 12C21 14.7596 18.7596 17 16 17C13.2404 17 11 14.7596 11 12C11 9.24043 13.2404 7 16 7C18.7596 7 21 9.24043 21 12V12" fillRule="evenodd" clipRule="evenodd" fill="#2563EB"/>
                  </svg>
                  <span className="apm-status-dot-bottom" />
                </div>

                {/* Username & UID */}
                <div className="apm-user-info">
                  <h3 className="apm-username">{user.username}</h3>
                  <p className="apm-uid">{displayUid}</p>
                </div>
              </div>

              {/* Status Badge */}
              <div className="apm-status-badge">
                <span className="apm-status-dot" />
                <span className="apm-status-text">{displayStatus}</span>
              </div>
            </div>

            {/* Info List Rows */}
            <div className="apm-details-list">
              {/* Item: Username */}
              <div className="apm-detail-item">
                <div className="apm-detail-left">
                  <UserIcon className="w-4 h-4 text-[#94A3B8]" />
                  <span className="apm-detail-left-text">Username</span>
                </div>
                <div className="apm-detail-val-badge">
                  {user.username}
                </div>
              </div>

              {/* Item: Thông tin liên hệ */}
              <div className="apm-detail-item apm-detail-item-contact">
                <div className="apm-detail-left">
                  <Contact className="w-4 h-4 text-[#94A3B8]" />
                  <span className="apm-detail-left-text">Thông tin liên hệ</span>
                </div>
                <div className="apm-contact-group">
                  <span className="apm-contact-phone">{user.contact_info || "0978765432"}</span>
                  <span className="apm-contact-email">{`${user.username}@gmail.com`}</span>
                </div>
              </div>

              {/* Item: HWID */}
              <div className="apm-detail-item">
                <div className="apm-detail-left">
                  <Cpu className="w-4 h-4 text-[#94A3B8]" />
                  <span className="apm-detail-left-text">Mã phần cứng (HWID)</span>
                </div>
                <div className="apm-hwid-wrap">
                  {user.hwid ? (
                    <>
                      <div className="apm-hwid-badge">
                        {user.hwid.length > 14 ? `${user.hwid.slice(0, 14)}...` : user.hwid}
                      </div>
                      <button
                        type="button"
                        onClick={() => copyHwid(user.hwid!)}
                        className="apm-copy-btn"
                        title="Copy HWID"
                      >
                        {copiedHwid ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </>
                  ) : (
                    <span className="text-xs italic text-slate-400">Chưa liên kết</span>
                  )}
                </div>
              </div>

              {/* Item: Registration Date */}
              <div className="apm-detail-item">
                <div className="apm-detail-left">
                  <Calendar className="w-4 h-4 text-[#94A3B8]" />
                  <span className="apm-detail-left-text">Ngày đăng ký</span>
                </div>
                <div className="apm-detail-date font-mono">
                  {formattedCreatedAt}
                </div>
              </div>
            </div>

            {/* Left Column Footer */}
            <div className="apm-left-footer">
              <div className="apm-ip-wrap">
                <span className="apm-ip-dot" />
                <span className="apm-footer-text">IP: {user.last_login_ip || "118.69.182.204"} (Hà Nội, VN)</span>
              </div>
              <span className="apm-footer-text">Phiên bản Client: v2.3.9</span>
            </div>
          </div>

          {/* Section - RightColumn (License & Permissions) */}
          <div className="apm-right-card">
            {/* Header Right Column */}
            <div className="apm-right-header">
              <div className="apm-right-title-wrap">
                <div className="apm-key-icon-box">
                  <svg width="17" height="17" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M10.8359 4.16063C11.7564 4.16063 12.5026 4.90682 12.5026 5.82729M15.8359 5.82729C15.8364 7.41098 15.0866 8.90125 13.8146 9.84469C12.5426 10.7881 10.8988 11.0732 9.38344 10.6131L7.5026 12.494H5.83594V14.1606H4.16927V15.8273H1.66927C1.20903 15.8273 0.835938 15.4542 0.835938 14.994V12.839C0.835985 12.618 0.923813 12.406 1.0801 12.2498L6.0501 7.27979C5.48208 5.40198 6.06471 3.36549 7.53996 2.07225C9.01521 0.779016 11.1105 0.468022 12.8977 1.27701C14.685 2.08599 15.834 3.86545 15.8359 5.82729L10.8359 4.16063" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round" stroke="#2563EB"/>
                  </svg>
                </div>
                <h3 className="apm-right-title">
                  {user.status === "pending" ? "Cấp license" : isExtend ? "Gia hạn license" : "Cấp license"}
                </h3>
              </div>
            </div>

            {/* Right Form Body */}
            <div className="apm-right-form">
              {/* Bulk Setup Bar & Header Info */}
              <div className="apm-bulk-section">
                <div className="apm-bulk-header">
                  <div className="apm-bulk-title-wrap">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M6.66406 4.0013V6.66797L8.66406 8.66797M12.6641 6.66797C12.6641 9.97946 9.97555 12.668 6.66406 12.668C3.35257 12.668 0.664063 9.97946 0.664062 6.66797C0.664062 3.35648 3.35257 0.667969 6.66406 0.667969C9.97555 0.667969 12.6641 3.35648 12.6641 6.66797L6.66406 4.0013" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round" stroke="#2563EB"/>
                    </svg>
                    <span>THIẾT LẬP THỜI HẠN HÀNG LOẠT</span>
                  </div>

                  <div className="apm-bulk-links">
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      className="apm-bulk-btn-link"
                    >
                      Chọn tất cả
                    </button>
                    <span className="apm-bulk-divider">|</span>
                    <button
                      type="button"
                      onClick={handleDeselectAll}
                      className="apm-bulk-btn-link apm-bulk-btn-deselect"
                    >
                      Bỏ chọn
                    </button>
                  </div>
                </div>

                <div className="apm-bulk-input-row">
                  <div className="apm-bulk-input-box">
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
                      placeholder="30"
                      className="apm-bulk-input"
                    />
                    <span className="apm-bulk-suffix">Ngày</span>
                  </div>

                  <button
                    type="button"
                    onClick={handleApplyBulkDays}
                    className="apm-bulk-apply-btn"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>Áp dụng cho tất cả</span>
                  </button>
                </div>
              </div>

              {/* FeaturesPermissions Section */}
              <div className="apm-modules-section">
                <div className="apm-modules-header">
                  <div className="apm-modules-title-wrap">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M4.08594 5.8647L5.25261 7.03136L7.58594 4.69803M10.8631 2.35536C9.01867 2.45332 7.2107 1.81556 5.83594 0.582031C4.46118 1.81556 2.65321 2.45332 0.808773 2.35536C0.660334 2.93001 0.585458 3.52119 0.58594 4.1147C0.58594 7.37611 2.81661 10.1172 5.83594 10.8942C8.85527 10.1172 11.0859 7.3767 11.0859 4.1147C11.0859 3.50686 11.0084 2.9177 10.8631 2.35536L4.08594 5.8647" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round" stroke="#2563EB"/>
                    </svg>
                    <span>DANH SÁCH TÍNH NĂNG KÍCH HOẠT ({modules.length} TÍNH NĂNG)</span>
                  </div>

                  <div className="apm-modules-counter">
                    Đã chọn: <strong>{activeCount}/{modules.length}</strong>
                  </div>
                </div>

                <div className="apm-modules-list">
                  {modules.map((m) => (
                    <div
                      key={m.id}
                      className={`apm-module-item ${
                        m.enabled ? "apm-module-item--active" : "apm-module-item--inactive"
                      }`}
                    >
                      <div
                        className="apm-module-item-left"
                        onClick={() => toggleModule(m.id)}
                      >
                        <input
                          type="checkbox"
                          checked={m.enabled}
                          onChange={() => {}}
                          className="apm-module-checkbox"
                        />
                        <span className="apm-module-name">{m.name}</span>
                      </div>

                      <div className="apm-module-item-right">
                        <input
                          type="number"
                          min={0}
                          disabled={!m.enabled}
                          value={m.days}
                          onChange={(e) => handleModuleDaysChange(m.id, e.target.value)}
                          className={`apm-module-days-input ${
                            m.enabled ? "apm-module-days-input--active" : "apm-module-days-input--disabled"
                          }`}
                        />
                        <span className="apm-module-unit">ngày</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {error && <div className="apm-error">{error}</div>}

              {/* Modal Action Buttons Footer */}
              <div className="apm-actions-grid">
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={loadingApprove || loadingReject}
                  className="apm-approve-btn"
                >
                  {loadingApprove ? (
                    <RotateCw className="w-4 h-4 animate-spin text-white" />
                  ) : user.status === "pending" ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19"/>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M6.66406 4.0013V6.66797L8.66406 8.66797M12.6641 6.66797C12.6641 9.97946 9.97555 12.668 6.66406 12.668C3.35257 12.668 0.664063 9.97946 0.664062 6.66797C0.664062 3.35648 3.35257 0.667969 6.66406 0.667969C9.97555 0.667969 12.6641 3.35648 12.6641 6.66797L6.66406 4.0013" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor"/>
                    </svg>
                  )}
                  <span>
                    {loadingApprove
                      ? isExtend
                        ? "Đang gia hạn..."
                        : "Đang duyệt..."
                      : user.status === "pending"
                      ? "Duyệt"
                      : isExtend
                      ? "Gia hạn"
                      : isRejected
                      ? "Phê duyệt lại"
                      : "Duyệt"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={user.status === "pending" ? handleReject : onClose}
                  disabled={loadingApprove || loadingReject}
                  className="apm-reject-btn"
                >
                  {user.status === "pending" ? (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                      </svg>
                      <span>{loadingReject ? "Đang xử lý..." : "Từ chối"}</span>
                    </>
                  ) : (
                    <>
                      <X className="w-4 h-4" />
                      <span>Hủy</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
