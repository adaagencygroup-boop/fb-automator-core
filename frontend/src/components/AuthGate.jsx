"use client";

import { useCallback, useEffect, useState } from "react";
import api from "@/services/api";
import { clearSessionUserId } from "@/services/sessionIdentity.mjs";
import LoginScreen from "@/modules/module_auth/LoginScreen";
import RegisterScreen from "@/modules/module_auth/RegisterScreen";
import PendingScreen from "@/modules/module_auth/PendingScreen";
import LockScreen from "@/modules/module_auth/LockScreen";
import AuthStatusScreen from "@/modules/module_auth/AuthStatusScreen";
import SessionOverlay from "@/components/auth/SessionOverlay";

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL || "http://127.0.0.1:3010";
const REFRESH_EVERY_MS = 10 * 60 * 1000;
/** Timeout ngắn cho bước khôi phục phiên — tránh treo trắng 60s khi engine restart/chậm. */
const AUTH_BOOT_TIMEOUT_MS = 12000;

export default function AuthGate({ children }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [screen, setScreen] = useState("login");
  const [connectionError, setConnectionError] = useState(false);
  const [sessionNotice, setSessionNotice] = useState("");
  const [bootSlow, setBootSlow] = useState(false);

  const loadMe = useCallback(async () => {
    // Called after an explicit successful login: permit the newly selected user.
    clearSessionUserId();
    const me = await api.get("/api/v1/auth/me", { timeout: AUTH_BOOT_TIMEOUT_MS });
    localStorage.removeItem("pending_username");
    localStorage.removeItem("locked_username");
    setConnectionError(false);
    setSessionNotice("");
    setUser(me);
    return me;
  }, []);

  const hasUser = Boolean(user);

  useEffect(() => {
    const onRevoked = () => {
      setUser(null);
      setScreen("login");
      setSessionNotice("Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại.");
    };
    window.addEventListener("fb-session-revoked", onRevoked);
    return () => window.removeEventListener("fb-session-revoked", onRevoked);
  }, []);

  useEffect(() => {
    if (ready) {
      setBootSlow(false);
      return undefined;
    }
    const timer = setTimeout(() => setBootSlow(true), 3000);
    return () => clearTimeout(timer);
  }, [ready]);

  useEffect(() => {
    window.localStorage.removeItem("fb_auth_token");
    let stopped = false;
    let timer;
    let failures = 0;
    async function restore() {
      try {
        const me = await api.get("/api/v1/auth/me", { timeout: AUTH_BOOT_TIMEOUT_MS });
        if (stopped) return;
        localStorage.removeItem("pending_username");
        localStorage.removeItem("locked_username");
        setUser(me);
        setConnectionError(false);
        setReady(true);
      } catch (error) {
        if (stopped) return;
        if (![401, 403].includes(error.status)) {
          setConnectionError(true);
          // Retry nhanh hơn: 1.5s → 3s → 6s → tối đa 8s (không chờ 30s).
          timer = setTimeout(restore, Math.min(8000, 1500 * 2 ** failures++));
          return;
        }
        const statusScreen = {
          ACCOUNT_BANNED: "banned",
          ACCOUNT_LOCKED: "banned",
          ACCOUNT_PENDING: "pending",
          ACCOUNT_REJECTED: "rejected",
        }[error.code];
        if (statusScreen) setScreen(statusScreen);
        else if (error.code === "SESSION_REVOKED") {
          localStorage.removeItem("pending_username");
          localStorage.removeItem("locked_username");
          setSessionNotice("Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại.");
        } else if (error.code === "SESSION_IDENTITY_CHANGED") {
          setSessionNotice("Danh tính phiên đăng nhập đã thay đổi. Vui lòng đăng nhập lại tài khoản của bạn.");
        } else if (localStorage.getItem("pending_username") || localStorage.getItem("locked_username")) {
          try {
            const profile = await api.get("/api/v1/auth/registration-status", {
              timeout: AUTH_BOOT_TIMEOUT_MS,
            });
            if (stopped) return;
            if (profile.status === "pending") setScreen("pending");
            else if (["banned", "locked"].includes(profile.status) || profile.hwid_mismatch) setScreen("banned");
            else if (profile.status === "rejected") setScreen("rejected");
          } catch {
            /* Login is available when the status ticket has expired. */
          }
        }
        if (!stopped) {
          setConnectionError(false);
          setReady(true);
        }
      }
    }
    restore();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  const sessionUsername = user?.username;
  useEffect(() => {
    if (!hasUser) return undefined;
    let stopped = false;
    let busy = false;
    let timer;
    let failures = 0;
    let refreshedAt = Date.now();
    const kick = (err) => {
      if (![401, 403].includes(err.status)) {
        // Chỉ báo mất kết nối sau vài lần lỗi liên tiếp — tránh banner vàng
        // khi Engine đang bận mở Chrome / query Supabase chậm 1–2s.
        if (failures >= 2) setConnectionError(true);
        return;
      }
      stopped = true;
      clearTimeout(timer);
      setConnectionError(false);
      const message = err.code || err.message;
      localStorage.removeItem("pending_username");
      localStorage.removeItem("locked_username");
      setUser(null);
      if (["ACCOUNT_BANNED", "ACCOUNT_LOCKED"].includes(message)) {
        if (sessionUsername) localStorage.setItem("locked_username", sessionUsername);
        setScreen("banned");
      } else if (message === "ACCOUNT_PENDING") {
        if (sessionUsername) localStorage.setItem("pending_username", sessionUsername);
        setScreen("pending");
      } else if (message === "ACCOUNT_REJECTED") {
        setScreen("rejected");
      } else {
        setSessionNotice(
          message === "SESSION_IDENTITY_CHANGED"
            ? "Danh tính phiên đăng nhập đã thay đổi. Vui lòng đăng nhập lại tài khoản của bạn."
            : message === "SESSION_REVOKED"
              ? "Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại."
              : "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
        );
        setScreen("login");
      }
    };
    const refetch = async () => {
      if (busy || stopped) return;
      busy = true;
      clearTimeout(timer);
      try {
        if (Date.now() - refreshedAt >= REFRESH_EVERY_MS) {
          await api.post("/api/v1/auth/refresh", {}, { timeout: AUTH_BOOT_TIMEOUT_MS });
          refreshedAt = Date.now();
        }
        const me = await api.get("/api/v1/auth/me", { timeout: AUTH_BOOT_TIMEOUT_MS });
        if (!stopped) {
          setUser(me);
          setConnectionError(false);
        }
        failures = 0;
      } catch (error) {
        failures += 1;
        if (!stopped) kick(error);
      } finally {
        busy = false;
        if (!stopped) timer = setTimeout(refetch, Math.min(60000, 20000 * Math.max(1, failures)));
      }
    };
    timer = setTimeout(refetch, 30000);
    let lastVisibleAt = 0;
    const onVisible = () => {
      // Tránh spam /me mỗi lần alt-tab về từ cửa sổ Chrome Selenium.
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastVisibleAt < 20000) return;
      lastVisibleAt = now;
      refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hasUser, loadMe, sessionUsername]);

  async function logout() {
    await api.post("/api/v1/auth/logout").catch(() => {});
    clearSessionUserId();
    setUser(null);
    localStorage.removeItem("pending_username");
    localStorage.removeItem("locked_username");
    setScreen("login");
  }

  function backToLogin() {
    localStorage.removeItem("pending_username");
    localStorage.removeItem("locked_username");
    setScreen("login");
  }

  function showStatus(status, username) {
    localStorage.removeItem("pending_username");
    localStorage.removeItem("locked_username");
    setSessionNotice("");
    if (status === "pending" && username) localStorage.setItem("pending_username", username);
    if (["banned", "hwid"].includes(status) && username) localStorage.setItem("locked_username", username);
    setScreen(status);
  }

  if (!ready) {
    const message = connectionError
      ? "Mất kết nối máy chủ. Đang thử kết nối lại..."
      : bootSlow
        ? "Máy chủ phản hồi chậm — đang chờ Engine..."
        : "Đang kiểm tra phiên đăng nhập...";
    return <SessionOverlay message={message} />;
  }

  if (!user) {
    if (screen === "login") {
      return (
        <LoginScreen
          sessionNotice={sessionNotice}
          onAuthenticated={loadMe}
          onStatus={showStatus}
          onRegister={() => setScreen("register")}
        />
      );
    }
    if (screen === "pending") {
      return <PendingScreen onBack={backToLogin} onStatus={showStatus} />;
    }
    if (screen === "banned" || screen === "hwid") {
      return <LockScreen onBack={backToLogin} onStatus={showStatus} />;
    }
    if (screen !== "register") {
      return <AuthStatusScreen status={screen} onBack={backToLogin} />;
    }

    return <RegisterScreen onLogin={() => setScreen("login")} onRegistered={() => setScreen("pending")} />;
  }

  const isAdmin = ["admin", "ADMIN"].includes(user.role);
  return (
    <>
      {connectionError && (
        <div role="status" className="fixed inset-x-0 top-0 z-50 bg-amber-100 p-3 text-center text-amber-900">
          Mất kết nối máy chủ. Đang thử kết nối lại...
        </div>
      )}
      {children({ user, isAdmin, adminUrl: ADMIN_URL, logout })}
    </>
  );
}
