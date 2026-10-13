"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { User, UserSessionSummary, api } from "@/lib/api";
import {
  IconDetailBadge,
  IconClose,
  IconActivityLog,
  IconDetailPencil,
  IconDetailLock,
  IconDetailTrash,
} from "./AdminIcons";
import { fmtDate, fmtDateTime } from "../utils";

interface AdminDetailDrawerProps {
  isOpen: boolean;
  admin: User | null;
  onClose: () => void;
  onEdit: (user: User) => void;
  onBan: (user: User) => void;
  onUnban: (user: User) => void;
  onDelete: (user: User) => void;
  onViewLogs?: (user: User) => void;
}

export function AdminDetailDrawer({
  isOpen,
  admin,
  onClose,
  onEdit,
  onBan,
  onUnban,
  onDelete,
  onViewLogs,
}: AdminDetailDrawerProps) {
  const router = useRouter();
  const [sessionData, setSessionData] = useState<UserSessionSummary | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    if (isOpen) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Fetch session data when drawer opens
  useEffect(() => {
    if (!isOpen || !admin) {
      setSessionData(null);
      return;
    }

    const fetchSessions = async () => {
      try {
        const data = await api.getUserSessions(admin.id);
        setSessionData(data);
      } catch (err) {
        console.error("Failed to fetch sessions:", err);
        setSessionData(null);
      }
    };

    fetchSessions();
  }, [isOpen, admin]);

  if (!isOpen || !admin) return null;

  const isLocked = admin.status === "banned";
  
  // Lấy thông tin đăng nhập từ session data thật
  const loginDateStr = sessionData?.last_login_at 
    ? fmtDateTime(sessionData.last_login_at) 
    : admin.last_login_at 
      ? fmtDateTime(admin.last_login_at) 
      : "Chưa đăng nhập";
  
  // IP từ session hoặc user.last_login_ip fallback
  const ipLocationStr = sessionData?.last_login_ip 
    ? `IP: ${sessionData.last_login_ip}` 
    : admin.last_login_ip 
      ? `IP: ${admin.last_login_ip}` 
      : admin.hwid 
        ? `HWID: ${admin.hwid.slice(0, 16)}...` 
        : "Không có dữ liệu";
  
  // Số phiên hoạt động từ session data
  const activeSessions = isLocked ? 0 : (sessionData?.active_sessions_count ?? 0);

  return (
    <div className="adm-drawer-backdrop" onClick={onClose}>
      <div
        className="adm-drawer-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="adm-drawer-title"
      >
        {/* ── Drawer Header ── */}
        <div className="adm-drawer-header">
          <div className="adm-drawer-header-left">
            <div className="adm-drawer-badge-icon">
              <IconDetailBadge />
            </div>
            <h2 id="adm-drawer-title" className="adm-drawer-title">
              CHI TIẾT ADMIN
            </h2>
          </div>
          <button
            type="button"
            className="adm-drawer-close-btn"
            onClick={onClose}
            aria-label="Đóng"
          >
            <IconClose />
          </button>
        </div>

        {/* ── Drawer Content Area ── */}
        <div className="adm-drawer-content">
          <div className="adm-drawer-section">
            <div className="adm-drawer-section-title">THÔNG TIN TÀI KHOẢN</div>
            
            {/* Card with details */}
            <div className="adm-drawer-card">
              {/* Row 1: Username */}
              <div className="adm-drawer-row">
                <span className="adm-drawer-label">Username</span>
                <span className="adm-drawer-val-username">{admin.username}</span>
              </div>

              {/* Row 2: Thông tin liên hệ */}
              <div className="adm-drawer-row adm-drawer-row--bordered">
                <span className="adm-drawer-label">Thông tin liên hệ</span>
                <span className="adm-drawer-val-contact">
                  {admin.contact_info || "Chưa cập nhật"}
                </span>
              </div>

              {/* Row 3: Ngày tạo */}
              <div className="adm-drawer-row adm-drawer-row--bordered">
                <span className="adm-drawer-label">Ngày tạo</span>
                <span className="adm-drawer-val-date">{fmtDate(admin.created_at)}</span>
              </div>

              {/* Row 4: Đăng nhập gần nhất */}
              <div className="adm-drawer-row adm-drawer-row--bordered adm-drawer-row--stacked">
                <span className="adm-drawer-label">Đăng nhập gần nhất</span>
                <div className="adm-drawer-stacked-val">
                  <span className="adm-drawer-val-login">{loginDateStr}</span>
                  <span className="adm-drawer-val-sub">{ipLocationStr}</span>
                </div>
              </div>

              {/* Row 5: Phiên đang hoạt động */}
              <div className="adm-drawer-row adm-drawer-row--bordered">
                <span className="adm-drawer-label">Phiên đang hoạt động</span>
                <div className="adm-drawer-session-box">
                  <div className="adm-drawer-session-badge">
                    <span className="adm-drawer-session-dot" />
                    <span>{activeSessions} phiên</span>
                  </div>
                  {sessionData && sessionData.last_device_type && (
                    <span className="adm-drawer-session-device">
                      ({sessionData.last_device_type}, {sessionData.last_browser})
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Button: Xem nhật ký hoạt động */}
            <button
              type="button"
              className="adm-drawer-btn-logs"
              onClick={() => {
                if (onViewLogs) {
                  onViewLogs(admin);
                } else {
                  router.push(`/dashboard/notifications?search=${encodeURIComponent(admin.username)}`);
                }
              }}
            >
              <IconActivityLog />
              <span>XEM NHẬT KÝ HOẠT ĐỘNG</span>
            </button>
          </div>
        </div>

        {/* ── Drawer Footer Buttons ── */}
        <div className="adm-drawer-footer">
          {/* Edit */}
          <button
            type="button"
            className="adm-drawer-action-btn adm-drawer-action-btn--edit"
            onClick={() => {
              onClose();
              onEdit(admin);
            }}
          >
            <IconDetailPencil />
            <span>CHỈNH SỬA</span>
          </button>

          {/* Lock / Unlock */}
          <button
            type="button"
            className="adm-drawer-action-btn adm-drawer-action-btn--danger"
            onClick={() => {
              if (isLocked) {
                onUnban(admin);
              } else {
                onBan(admin);
              }
            }}
          >
            <IconDetailLock />
            <span>{isLocked ? "MỞ KHÓA" : "KHÓA TÀI KHOẢN"}</span>
          </button>

          {/* Delete */}
          <button
            type="button"
            className="adm-drawer-action-btn adm-drawer-action-btn--danger"
            onClick={() => onDelete(admin)}
          >
            <IconDetailTrash />
            <span>XOÁ TÀI KHOẢN</span>
          </button>
        </div>
      </div>
    </div>
  );
}
