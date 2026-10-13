"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { api, AdminMe, getVpsBase } from "@/lib/api";
import NotificationBell from "@/components/NotificationBell";
import "./dashboard-layout.css";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [adminInfo, setAdminInfo] = useState<AdminMe | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Global Toast event listener
  useEffect(() => {
    const handleToast = (e: any) => {
      if (e.detail?.msg) {
        setToast({ msg: e.detail.msg, type: e.detail.type || "success" });
        setTimeout(() => setToast(null), 3500);
      }
    };
    window.addEventListener("app_toast", handleToast);
    return () => window.removeEventListener("app_toast", handleToast);
  }, []);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const NAV = [
    { href: "/dashboard/users", label: "Quản lý người dùng" },
    { href: "/dashboard/notifications", label: "Nhật ký hoạt động" },
  ];

  const adminInfoRef = useRef<AdminMe | null>(null);
  adminInfoRef.current = adminInfo;

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/login");
      return;
    }

    // Fetch thông tin admin hiện tại
    const loadMe = () => {
      api.getAdminMe()
        .then((data) => {
          if (data.status === "banned" || data.status === "locked" || data.status === "rejected") {
            localStorage.removeItem("admin_token");
            sessionStorage.setItem("auth_error", "Tài khoản của bạn đã bị khóa");
            window.location.href = "/login?error=" + encodeURIComponent("Tài khoản của bạn đã bị khóa");
            return;
          }
          setAdminInfo(data);
        })
        .catch((err: any) => {
          if (sessionStorage.getItem("pending_logout_modal")) {
            return;
          }
          const rawMsg = err?.message || "";
          const isHardAuthError = /bị khóa|banned|locked|account_banned|session_revoked|invalid.*token|hết hạn|không hợp lệ|unauthorized/i.test(rawMsg);
          if (isHardAuthError) {
            localStorage.removeItem("admin_token");
            const msg = /bị khóa|banned|locked/i.test(rawMsg)
              ? "Tài khoản của bạn đã bị khóa"
              : "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
            sessionStorage.setItem("auth_error", msg);
            window.location.href = `/login?error=${encodeURIComponent(msg)}`;
          } else {
            console.warn("[DashboardLayout] Temporary loadMe error, retrying in 2.5s:", err);
            setTimeout(() => {
              if (!adminInfoRef.current) {
                loadMe();
              }
            }, 2500);
          }
        });
    };

    loadMe();
    window.addEventListener("admin_updated", loadMe);

    // Đồng bộ trạng thái khi có tab khác cùng trình duyệt đăng nhập tài khoản khác hoặc đăng xuất
    const handleStorageChange = (e: StorageEvent) => {
      if (sessionStorage.getItem("pending_logout_modal")) return;
      if (e.key === "admin_token") {
        if (!e.newValue) {
          router.push("/login");
        } else {
          loadMe();
        }
      }
    };
    window.addEventListener("storage", handleStorageChange);

    // Lắng nghe sự kiện SSE realtime: nếu admin hiện tại bị khóa thì logout lập tức
    const VPS_BASE = getVpsBase();
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${VPS_BASE}/api/v1/admin/notifications/stream`, { withCredentials: true });
      es.onmessage = (event) => {
        try {
          if (sessionStorage.getItem("pending_logout_modal")) return;
          const payload = JSON.parse(event.data);
          const currentUsername = adminInfoRef.current?.username;
          if (payload.type === "USER_LOCKED" && currentUsername && payload.username === currentUsername) {
            localStorage.removeItem("admin_token");
            sessionStorage.setItem("auth_error", "Tài khoản của bạn đã bị khóa");
            window.location.href = "/login?error=" + encodeURIComponent("Tài khoản của bạn đã bị khóa");
          }
        } catch {
          // ignore
        }
      };
    } catch {
      // ignore
    }

    return () => {
      window.removeEventListener("admin_updated", loadMe);
      window.removeEventListener("storage", handleStorageChange);
      if (es) es.close();
    };
  }, [router]);

  const handleLogout = async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("admin_token") : null;
    if (token) {
      try {
        await api.logout();
      } catch (e) {
        console.error("Admin logout error:", e);
      }
    }
    localStorage.removeItem("admin_token");
    router.push("/login");
  };

  const displayName = adminInfo?.username || "...";
  const displayRole = "Admin";

  return (
    <div className="dash-shell">
      <header className="dash-header">
        <div className="dash-header-inner">
          <div className="dash-header-left">
            <Link href="/dashboard/users" className="dash-brand">
              <div className="dash-brand-icon">
                <img src="/icons/users-brand-bolt.svg" alt="" />
              </div>
              <span className="dash-brand-title">FB Tool Admin</span>
            </Link>

            <nav className="dash-nav">
              {NAV.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`dash-nav-link${active ? " dash-nav-link--active" : ""}`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="dash-header-right">
            <NotificationBell />
            <div className="dash-divider" />
            <div className="dash-profile">
              <button type="button" onClick={() => setMenuOpen((v) => !v)} className="dash-profile-btn">
                <div className="dash-avatar">
                  <img src="/icons/users-avatar.svg" alt="" />
                </div>
                <div className="dash-profile-meta">
                  <span className="dash-profile-name">{displayRole}</span>
                  <span className="dash-profile-email">{displayName}</span>
                </div>
                <img src="/icons/users-chevron-down.svg" alt="" className="dash-profile-chevron" />
              </button>
              {menuOpen && (
                <div className="dash-profile-menu" ref={menuRef}>
                  <Link
                    href="/dashboard/profile"
                    className="dash-profile-menu-item"
                    onClick={() => setMenuOpen(false)}
                  >
                    Hồ sơ Admin
                  </Link>
                  <div className="dash-profile-menu-divider" />
                  <button type="button" onClick={handleLogout} className="dash-profile-logout">
                    Đăng xuất
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="dash-main">{children}</main>

      {/* Floating Global Toast Notification */}
      {toast && (
        <div className="fixed top-5 right-5 z-[99999] animate-in fade-in slide-in-from-top-4 duration-200">
          <div
            className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl border text-sm font-medium ${
              toast.type === "success"
                ? "bg-emerald-50 text-emerald-900 border-emerald-200 shadow-emerald-500/10"
                : "bg-rose-50 text-rose-900 border-rose-200 shadow-rose-500/10"
            }`}
          >
            {toast.type === "success" ? (
              <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                ✓
              </span>
            ) : (
              <span className="w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                ✕
              </span>
            )}
            <span>{toast.msg}</span>
          </div>
        </div>
      )}
    </div>
  );
}
