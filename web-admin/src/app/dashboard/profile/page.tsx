"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, UserSessionSummary, UserSession, AdminMe, User } from "@/lib/api";
import { AdminModal } from "@/app/dashboard/admins/components/AdminModal";
import { ChangePasswordModal } from "./components/ChangePasswordModal";
import { Toast, ToastState } from "@/app/dashboard/admins/components/Toast";
import "@/app/dashboard/admins/admins.css";
import "./profile.css";

function parseApiDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  try {
    const s = iso.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) return dt;
    const fallback = new Date(iso);
    return isNaN(fallback.getTime()) ? null : fallback;
  } catch {
    return null;
  }
}

function fmtDate(d: string | null | undefined) {
  const dt = parseApiDate(d);
  if (!dt) return "—";
  const day = String(dt.getDate()).padStart(2, "0");
  const mon = String(dt.getMonth() + 1).padStart(2, "0");
  const yr = dt.getFullYear();
  return `${day}/${mon}/${yr}`;
}

function fmtDateTime(d: string | null | undefined) {
  const dt = parseApiDate(d);
  if (!dt) return "—";
  const day = String(dt.getDate()).padStart(2, "0");
  const mon = String(dt.getMonth() + 1).padStart(2, "0");
  const yr = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${day}/${mon}/${yr} ${hh}:${mm}`;
}

function roleLabel(_role: string) {
  return "Quản trị viên";
}

function SessionCard({
  session,
  isCurrent,
}: {
  session: UserSession;
  isCurrent: boolean;
}) {
  const os = session.os || session.device_type || "Windows";
  const browser = session.browser || "Chrome";
  const ip = session.ip_address || "—";
  const loginTime = fmtDateTime(session.login_at);

  return (
    <div className={`prof-session-card${isCurrent ? " prof-session-card--active" : ""}`}>
      <div className={`prof-session-icon${isCurrent ? " prof-session-icon--active" : ""}`}>
        {isCurrent ? (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M2.5 3.333H17.5C18.42 3.333 19.167 4.08 19.167 5V13.333C19.167 14.254 18.42 15 17.5 15H2.5C1.58 15 0.833 14.254 0.833 13.333V5C0.833 4.08 1.58 3.333 2.5 3.333Z" stroke="#0866FF" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M1.667 16.667H18.333" stroke="#0866FF" strokeWidth="1.66667" strokeLinecap="round"/>
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M2.5 3.333H17.5C18.42 3.333 19.167 4.08 19.167 5V13.333C19.167 14.254 18.42 15 17.5 15H2.5C1.58 15 0.833 14.254 0.833 13.333V5C0.833 4.08 1.58 3.333 2.5 3.333Z" stroke="#64748B" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M5.833 16.667H14.167" stroke="#64748B" strokeWidth="1.66667" strokeLinecap="round"/>
            <path d="M10 15V16.667" stroke="#64748B" strokeWidth="1.66667"/>
          </svg>
        )}
      </div>
      <div className="prof-session-info">
        <div className="prof-session-title">
          <span className="prof-session-device">{browser} · {os}</span>
          {isCurrent && (
            <span className="prof-session-badge">
              <span className="prof-session-badge-dot" />
              Phiên hiện tại
            </span>
          )}
        </div>
        <div className="prof-session-sub">
          {isCurrent ? (
            <>
              IP: <strong>{ip}</strong> · <span className="prof-session-online">Đang hoạt động</span>
            </>
          ) : (
            <>Đăng nhập: {loginTime} · IP: {ip}</>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminProfilePage() {
  const router = useRouter();
  const [me, setMe] = useState<AdminMe | null>(null);
  const [sessions, setSessions] = useState<UserSessionSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handleLogout = () => {
    localStorage.removeItem("admin_token");
    router.push("/login");
  };

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/login");
      return;
    }

    const p1 = api.getAdminMe()
      .then((data) => {
        setMe(data);
      })
      .catch((err) => {
        console.error("Error loading admin profile:", err);
        if (err?.status === 401) {
          localStorage.removeItem("admin_token");
          router.push("/login");
        }
      });

    const p2 = api.getMySessions()
      .then((data) => {
        setSessions(data);
      })
      .catch((err) => {
        console.error("Error loading sessions:", err);
      });

    Promise.all([p1, p2]).finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <div className="prof-loading">
        <div className="prof-loading-spinner" />
        <span>Đang tải hồ sơ...</span>
      </div>
    );
  }

  const adminId = me ? `ADM-${String(me.id).padStart(4, "0")}-FBTOOL-PRO` : "ADM-0000-FBTOOL-PRO";
  const sessionList = sessions?.sessions || [];
  const activeCount = sessions?.active_sessions_count ?? sessionList.filter((s) => s.is_active).length;

  const meAsUser: User | null = me
    ? {
        id: me.id,
        username: me.username,
        contact_info: me.contact_info || "",
        hwid: null,
        role: me.role,
        status: me.status,
        expired_at: null,
        created_at: me.created_at || new Date().toISOString(),
        days_remaining: null,
        last_login_at: me.last_login_at || null,
        last_login_ip: me.last_login_ip || null,
      }
    : null;

  return (
    <div className="prof-page">
      {/* Page Header */}
      <div className="prof-page-header">
        <h1 className="prof-page-title">Hồ sơ quản trị viên</h1>
        <p className="prof-page-subtitle">Thông tin quản trị hệ thống FB Page Tool</p>
      </div>

      {/* Main Grid */}
      <div className="prof-grid">
        {/* ── LEFT: Admin Info ── */}
        <div className="prof-card">
          <div className="prof-card-top-bar">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M13.33 13V11.667C13.33 10.195 12.136 9 10.664 9H5.33C3.859 9 2.664 10.195 2.664 11.667V13" stroke="#0866FF" strokeWidth="1.33333"/>
              <path d="M5.336 3.667C5.336 5.138 6.531 6.333 8.003 6.333C9.474 6.333 10.669 5.138 10.669 3.667C10.669 2.195 9.474 1 8.003 1C6.531 1 5.336 2.195 5.336 3.667Z" stroke="#0866FF" strokeWidth="1.33333"/>
            </svg>
            <span>THÔNG TIN QUẢN TRỊ VIÊN</span>
          </div>

          <div className="prof-identity">
            <h3 className="prof-identity-name">{me?.username || "—"}</h3>
            <div className="prof-identity-role">{roleLabel(me?.role || "admin")}</div>
            <div className="prof-status-pill-wrap">
              <span className={`prof-status-pill${me?.status === "approved" ? " prof-status-pill--active" : " prof-status-pill--locked"}`}>
                <span className="prof-status-dot" />
                {me?.status === "approved" ? "Đang hoạt động" : "Tạm khóa"}
              </span>
            </div>
          </div>

          <div className="prof-info-rows">
            <div className="prof-info-row">
              <span className="prof-info-label">Tên đăng nhập</span>
              <span className="prof-info-val-bold">{me?.username || "—"}</span>
            </div>
            <div className="prof-info-row">
              <span className="prof-info-label">Thông tin liên hệ</span>
              <span className="prof-info-val-contact">{me?.contact_info || "Chưa cập nhật"}</span>
            </div>
            <div className="prof-info-row">
              <span className="prof-info-label">Vai trò</span>
              <span className="prof-role-badge">{roleLabel(me?.role || "admin")}</span>
            </div>
            <div className="prof-info-row">
              <span className="prof-info-label">Trạng thái</span>
              <span className="prof-status-inline">
                <span className="prof-dot-green" />
                {me?.status === "approved" ? "Đang hoạt động" : "Tạm khóa"}
              </span>
            </div>
            <div className="prof-info-row">
              <span className="prof-info-label">Ngày tạo tài khoản</span>
              <span className="prof-info-val-date">{fmtDate(me?.created_at)}</span>
            </div>
          </div>

          {/* Action button */}
          <div className="prof-card-footer-action">
            <button
              type="button"
              className="prof-btn-edit"
              onClick={() => setEditModalOpen(true)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M7.33 2.667H2.66C1.925 2.667 1.33 3.264 1.33 4V13.333C1.33 14.069 1.925 14.667 12 14.667H12C12.735 14.667 13.33 14.069 13.33 13.333V8.667" stroke="#334155" strokeWidth="1.33333"/>
                <path d="M12.33 1.667C12.88 1.115 13.78 1.115 14.33 1.667C14.88 2.219 14.88 3.115 14.33 3.667L8 10L5.33 10.667L6 8L12.33 1.667Z" stroke="#334155" strokeWidth="1.33333"/>
              </svg>
              <span>Chỉnh sửa thông tin</span>
            </button>
          </div>
        </div>

        {/* ── RIGHT: Security & Sessions ── */}
        <div className="prof-card">
          <div className="prof-card-top-bar prof-card-top-bar--right">
            <div className="prof-card-top-bar-left">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2.33 6.83H13.67C14.4 6.83 15 7.43 15 8.167V12.833C15 13.57 14.4 14.167 13.67 14.167H2.33C1.6 14.167 1 13.57 1 12.833V8.167C1 7.43 1.6 6.83 2.33 6.83Z" stroke="#0866FF" strokeWidth="1.33333"/>
                <path d="M3.66 6.83V4.167C3.66 2.328 5.15 0.833 7 0.833C8.84 0.833 10.33 2.328 10.33 4.167V6.83" stroke="#0866FF" strokeWidth="1.33333"/>
              </svg>
              <span>AN NINH &amp; PHIÊN TRUY CẬP</span>
            </div>
            <span className="prof-header-badge-right">Bảo mật hệ thống chuẩn cao cấp</span>
          </div>

          {/* MỤC 1: BẢO MẬT TÀI KHOẢN */}
          <div className="prof-section">
            <div className="prof-section-title">
              <svg width="14" height="16" viewBox="0 0 14 16" fill="none">
                <path d="M7 15C7 15 12.33 12.333 12.33 8.333V3.667L7 1.667L1.67 3.667V8.333C1.67 12.333 7 15 7 15Z" stroke="#2563EB" strokeWidth="1.33333"/>
              </svg>
              <span>BẢO MẬT TÀI KHOẢN</span>
            </div>

            <div className="prof-pw-row">
              <div className="prof-pw-row-left">
                <div className="prof-pw-icon-box">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M2.5 7.5H15.5C16.42 7.5 17.167 8.246 17.167 9.167V15C17.167 15.92 16.42 16.667 15.5 16.667H2.5C1.58 16.667 0.833 15.92 0.833 15V9.167C0.833 8.246 1.58 7.5 2.5 7.5Z" stroke="#0866FF" strokeWidth="1.5"/>
                    <path d="M4.5 7.5V4.5C4.5 2.015 6.515 0 9 0C11.485 0 13.5 2.015 13.5 4.5V7.5" stroke="#0866FF" strokeWidth="1.5"/>
                  </svg>
                </div>
                <div>
                  <div className="prof-pw-label">Mật khẩu</div>
                  <div className="prof-pw-dots">••••••••••••</div>
                </div>
              </div>
              <button
                type="button"
                className="prof-btn-changepw"
                onClick={() => setPwModalOpen(true)}
              >
                <svg width="12" height="14" viewBox="0 0 12 14" fill="none">
                  <path d="M1.67 5.25H10.33C10.98 5.25 11.5 5.77 11.5 6.417V10.5C11.5 11.144 10.98 11.667 10.33 11.667H1.67C1.02 11.667 0.5 11.144 0.5 10.5V6.417C0.5 5.77 1.02 5.25 1.67 5.25Z" stroke="#0866FF" strokeWidth="1"/>
                  <path d="M2.83 5.25V2.917C2.83 1.307 4.14 0 5.75 0C7.36 0 8.67 1.307 8.67 2.917V5.25" stroke="#0866FF" strokeWidth="1"/>
                </svg>
                <span>Đổi mật khẩu</span>
              </button>
            </div>
          </div>

          <div className="prof-section-divider" />

          {/* MỤC 2: PHIÊN ĐANG HOẠT ĐỘNG */}
          <div className="prof-section">
            <div className="prof-section-title-row">
              <div className="prof-section-title">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M1.83 2H13.5C14.236 2 14.833 2.597 14.833 3.333V10C14.833 10.736 14.236 11.333 13.5 11.333H1.83C1.094 11.333 0.5 10.736 0.5 10V3.333C0.5 2.597 1.094 2 1.83 2Z" stroke="#2563EB" strokeWidth="1.33333"/>
                  <path d="M4.5 14H10.83" stroke="#2563EB" strokeWidth="1.33333"/>
                  <path d="M7.67 11.33V14" stroke="#2563EB" strokeWidth="1.33333"/>
                </svg>
                <span>PHIÊN ĐANG HOẠT ĐỘNG</span>
              </div>
              <span className="prof-sessions-meta">{activeCount} thiết bị khả dụng</span>
            </div>

            <div className="prof-sessions-list">
              {sessionList.length === 0 ? (
                <div className="prof-sessions-empty">Chưa có phiên hoạt động nào được ghi nhận.</div>
              ) : (
                sessionList.slice(0, 10).map((s, i) => (
                  <SessionCard key={s.id} session={s} isCurrent={i === 0} />
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="prof-footer">
        <div className="prof-footer-id">
          Mã định danh quản trị viên: <strong>{adminId}</strong>
        </div>
        <button type="button" className="prof-btn-logout" onClick={handleLogout}>
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M5.5 13.5H2.83C2.1 13.5 1.5 12.9 1.5 12.167V2.833C1.5 2.1 2.1 1.5 2.83 1.5H5.5" stroke="#DC2626" strokeWidth="1.33333"/>
            <path d="M10.16 10.833L13.5 7.5L10.16 4.167" stroke="#DC2626" strokeWidth="1.33333"/>
            <path d="M13.5 7.5H5.5" stroke="#DC2626" strokeWidth="1.33333"/>
          </svg>
          <span>Đăng xuất</span>
        </button>
      </div>

      {/* ── Edit Admin Modal Dialog (Reused from Admins page) ── */}
      {editModalOpen && (
        <AdminModal
          isOpen={editModalOpen}
          editTarget={meAsUser}
          onClose={() => setEditModalOpen(false)}
          onSuccess={(msg) => {
            showToast(msg);
            api.getAdminMe().then((data) => {
              setMe(data);
              if (typeof window !== "undefined") {
                window.dispatchEvent(new Event("admin_updated"));
              }
            }).catch(console.error);
          }}
        />
      )}

      {/* ── Change Password Modal Dialog (Figma 1:1) ── */}
      {pwModalOpen && (
        <ChangePasswordModal
          isOpen={pwModalOpen}
          username={me?.username}
          onClose={() => setPwModalOpen(false)}
          onSuccess={(msg) => showToast(msg, "success")}
        />
      )}

      {/* ── Toast Alert ── */}
      <Toast toast={toast} />
    </div>
  );
}

