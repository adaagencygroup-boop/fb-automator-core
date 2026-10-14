"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { AlertCircle, ArrowRight, Eye, EyeOff, X, CheckCircle2 } from "lucide-react";
import "./login.css";

const REMEMBER_KEY = "admin_remember_username";

const ICONS = {
  brandShield: "/icons/admin-brand-shield.svg",
  loginShield: "/icons/admin-login-shield.svg",
  sslShield: "/icons/admin-ssl-shield.svg",
  hwLock: "/icons/admin-hw-lock.svg",
  user: "/icons/admin-input-user.svg",
  lock: "/icons/admin-input-lock.svg",
} as const;

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedUser = localStorage.getItem(REMEMBER_KEY);
    if (savedUser) {
      setUsername(savedUser);
    }
    const savedRemember = localStorage.getItem(REMEMBER_KEY);
    if (savedRemember !== null) {
      setRemember(Boolean(savedRemember));
    }

    const params = new URLSearchParams(window.location.search);
    const queryError = params.get("error");
    const querySuccess = params.get("success");
    const queryUsername = params.get("username");
    const sessionError = sessionStorage.getItem("auth_error");
    const initialError = queryError || sessionError;

    if (queryUsername) {
      setUsername(queryUsername);
    }
    if (querySuccess) {
      setSuccessMsg(querySuccess);
    }
    if (initialError) {
      setError(initialError);
      sessionStorage.removeItem("auth_error");
    }
    if (queryError || querySuccess || queryUsername) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Đọc fallback trực tiếp từ DOM input để bắt trọn browser autofill
    const userDom = (document.getElementById("admin-user") as HTMLInputElement)?.value ?? "";
    const passDom = (document.getElementById("admin-pass") as HTMLInputElement)?.value ?? "";

    const finalUsername = (username || userDom).trim();
    const finalPassword = password || passDom;

    const newErrors: { username?: string; password?: string } = {};
    if (!finalUsername) {
      newErrors.username = "Vui lòng điền vào trường này.";
      document.getElementById("admin-user")?.focus();
    } else if (!finalPassword) {
      newErrors.password = "Vui lòng nhập mật khẩu.";
      document.getElementById("admin-pass")?.focus();
    }
    if (Object.keys(newErrors).length > 0) {
      setFieldErrors(newErrors);
      return;
    }
    setFieldErrors({});
    setLoading(true);
    setError("");

    try {
      console.log(`[Admin Login] Sending login request for user: ${finalUsername}`);
      const data = await api.adminLogin(finalUsername, finalPassword, remember);
      console.log("[Admin Login] Login successful, redirecting to dashboard...");
      localStorage.setItem("admin_token", data.access_token);
      if (remember) localStorage.setItem(REMEMBER_KEY, finalUsername);
      else localStorage.removeItem(REMEMBER_KEY);
      window.location.href = "/dashboard/users";
    } catch (err: any) {
      console.error("[Admin Login] Login error:", err);
      setError(err.message || "Tài khoản hoặc mật khẩu không chính xác");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login-page fixed inset-0 z-0 flex min-h-[100dvh] w-full items-center justify-center overflow-auto bg-[#f8f9ff] p-4 sm:p-6">
      <div className="admin-login-main relative z-[1] w-full max-w-[1024px] shrink-0">
        <div className="admin-login-bloom admin-login-bloom--tl" aria-hidden />
        <div className="admin-login-bloom admin-login-bloom--br" aria-hidden />

        <div className="admin-login-shell">
          <aside className="admin-login-left">
            <div className="admin-login-left-bloom admin-login-left-bloom--tr" aria-hidden />
            <div className="admin-login-left-bloom admin-login-left-bloom--bl" aria-hidden />

            <div className="admin-login-brand">
              <div className="admin-login-brand-icon">
                <img
                  src={ICONS.brandShield}
                  alt=""
                  width={17}
                  height={22}
                  className="admin-login-brand-icon-svg"
                />
              </div>
              <div className="admin-login-brand-text">
                <p className="admin-login-brand-title">FB Page Tool</p>
                <p className="admin-login-brand-sub">ADMIN MANAGEMENT CONSOLE</p>
              </div>
            </div>

            <div className="admin-login-narrative">
              <div className="admin-login-status-pill">
                <span className="admin-login-status-dot" />
                <span>Hệ thống v2.6.4 ổn định</span>
              </div>
              <h2 className="admin-login-headline">Bảo mật &amp; Quản trị tập trung</h2>
              <p className="admin-login-desc">
                Nền tảng kiểm soát phân quyền tài khoản, cấp phát license tự động, đồng bộ HWID và
                theo dõi telemetry chuyên sâu cho nhà phát triển.
              </p>
              <div className="admin-login-metrics">
                <div className="admin-login-metric">
                  <p className="admin-login-metric-value admin-login-metric-value--blue">256-bit</p>
                  <p className="admin-login-metric-label">Mã hoá chuẩn quân sự</p>
                </div>
                <div className="admin-login-metric">
                  <p className="admin-login-metric-value admin-login-metric-value--sky">99.9%</p>
                  <p className="admin-login-metric-label">Uptime máy chủ cấp phép</p>
                </div>
              </div>
            </div>

            <div className="admin-login-left-footer">
              <div className="admin-login-hw-lock">
                <img
                  src={ICONS.hwLock}
                  alt=""
                  width={13}
                  height={13}
                  className="admin-login-hw-lock-icon"
                />
                <span>Bảo vệ bởi Hardware Lock</span>
              </div>
              <span className="admin-login-version">v2.6.4-prod</span>
            </div>
          </aside>

          <section className="admin-login-right">
            <div className="admin-login-ssl-row">
              <div className="admin-login-ssl-pill">
                <img src={ICONS.sslShield} alt="" width={12} height={15} className="admin-login-ssl-icon" />
                <span>Phiên bản bảo mật SSL/TLS</span>
              </div>
            </div>

            <div className="admin-login-center">
              <div className="admin-login-card">
                <div className="admin-login-header">
                  <div className="admin-login-shield-box">
                    <img
                      src={ICONS.loginShield}
                      alt=""
                      width={23}
                      height={28}
                      className="admin-login-shield-svg"
                    />
                  </div>
                  <h1 className="admin-login-h1">Đăng nhập Admin</h1>
                  <p className="admin-login-subtitle">
                    Vui lòng đăng nhập để tiếp tục vào hệ thống quản trị
                  </p>
                </div>

                <form
                  className="admin-login-form"
                  action="javascript:void(0);"
                  onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSubmit(e);
                  }}
                  noValidate
                >
                  <div className="admin-login-field">
                    <div className="admin-login-label-row">
                      <label htmlFor="admin-user">Tài khoản Quản trị</label>
                      <span>ADMIN ID</span>
                    </div>
                    <div className={`admin-login-input-wrap ${fieldErrors.username ? "has-error" : ""}`}>
                      <span className="admin-login-input-icon" aria-hidden>
                        <img src={ICONS.user} alt="" width={14} height={14} />
                      </span>
                      <input
                        id="admin-user"
                        type="text"
                        autoComplete="username"
                        value={username}
                        onInput={(e) => {
                          const val = (e.target as HTMLInputElement).value;
                          setUsername(val);
                          if (fieldErrors.username) {
                            setFieldErrors((prev) => ({ ...prev, username: undefined }));
                          }
                        }}
                        onChange={(e) => {
                          setUsername(e.target.value);
                          if (fieldErrors.username) {
                            setFieldErrors((prev) => ({ ...prev, username: undefined }));
                          }
                        }}
                        placeholder="admin_fbtools"
                      />
                    </div>
                    {fieldErrors.username && (
                      <div className="admin-login-field-error" role="alert">
                        <AlertCircle size={13} className="admin-login-field-error-icon" />
                        <span>{fieldErrors.username}</span>
                      </div>
                    )}
                  </div>

                  <div className="admin-login-field">
                    <div className="admin-login-label-row">
                      <label htmlFor="admin-pass">Mật khẩu</label>
                      <button
                        type="button"
                        className="admin-login-forgot"
                        onClick={() =>
                          alert(
                            "Liên hệ chủ hệ thống để reset mật khẩu admin trong file .env trên VPS."
                          )
                        }
                      >
                        Quên mật khẩu?
                      </button>
                    </div>
                    <div className={`admin-login-input-wrap ${fieldErrors.password ? "has-error" : ""}`}>
                      <span className="admin-login-input-icon admin-login-input-icon--lock" aria-hidden>
                        <img src={ICONS.lock} alt="" width={13} height={18} />
                      </span>
                      <input
                        id="admin-pass"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        value={password}
                        onInput={(e) => {
                          const val = (e.target as HTMLInputElement).value;
                          setPassword(val);
                          if (fieldErrors.password) {
                            setFieldErrors((prev) => ({ ...prev, password: undefined }));
                          }
                        }}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (fieldErrors.password) {
                            setFieldErrors((prev) => ({ ...prev, password: undefined }));
                          }
                        }}
                        placeholder="••••••••••••"
                        className="admin-login-input--password"
                      />
                      <button
                        type="button"
                        className="admin-login-eye"
                        aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                        onClick={() => setShowPassword((v) => !v)}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    {fieldErrors.password && (
                      <div className="admin-login-field-error" role="alert">
                        <AlertCircle size={13} className="admin-login-field-error-icon" />
                        <span>{fieldErrors.password}</span>
                      </div>
                    )}
                  </div>

                  <div className="admin-login-stay">
                    <label className="admin-login-remember">
                      <input
                        type="checkbox"
                        checked={remember}
                        onChange={(e) => setRemember(e.target.checked)}
                      />
                      <span>Ghi nhớ thiết bị này (30 ngày)</span>
                    </label>
                  </div>

                  <div className="admin-login-cta-wrap">
                    <button
                      type="submit"
                      className="admin-login-cta"
                      disabled={loading}
                      onClick={(e) => {
                        e.preventDefault();
                        handleSubmit();
                      }}
                    >
                      <span>{loading ? "Đang xác thực..." : "Đăng nhập"}</span>
                      {!loading && <ArrowRight size={13} />}
                    </button>
                  </div>

                  {successMsg && !error && (
                    <div className="admin-login-error-wrap">
                      <div className="admin-login-error" style={{ background: "#ecfdf5", borderColor: "#a7f3d0" }} role="alert">
                        <div className="admin-login-error-icon" style={{ background: "#d1fae5", color: "#059669" }}>
                          <CheckCircle2 size={16} strokeWidth={2.5} />
                        </div>
                        <div className="admin-login-error-text">
                          <p className="admin-login-error-title" style={{ color: "#065f46" }}>
                            Thông báo
                          </p>
                          <p className="admin-login-error-msg" style={{ color: "#047857" }}>{successMsg}</p>
                        </div>
                        <button
                          type="button"
                          className="admin-login-error-close"
                          aria-label="Đóng"
                          onClick={() => setSuccessMsg("")}
                        >
                          <X size={14} strokeWidth={2.5} />
                        </button>
                      </div>
                    </div>
                  )}

                  {error && (
                    <div className="admin-login-error-wrap">
                      <div className="admin-login-error" role="alert">
                        <div className="admin-login-error-icon">
                          <AlertCircle size={16} strokeWidth={2.5} />
                        </div>
                        <div className="admin-login-error-text">
                          <p className="admin-login-error-title">
                            {error.toLowerCase().includes("khóa") ? "Tài khoản bị khóa" : "Đăng nhập không thành công"}
                          </p>
                          <p className="admin-login-error-msg">{error}</p>
                        </div>
                        <button
                          type="button"
                          className="admin-login-error-close"
                          aria-label="Đóng"
                          onClick={() => setError("")}
                        >
                          <X size={14} strokeWidth={2.5} />
                        </button>
                      </div>
                    </div>
                  )}
                </form>
              </div>
            </div>

            <div className="admin-login-copy">
              <p>© 2026 FB Page Tool. All rights reserved.</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
