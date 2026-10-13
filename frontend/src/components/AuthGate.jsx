"use client";

import { useCallback, useEffect, useState } from "react";
import api from "@/services/api";
import LoginScreen from "@/modules/module_auth/LoginScreen";
import RegisterScreen from "@/modules/module_auth/RegisterScreen";
import PendingScreen from "@/modules/module_auth/PendingScreen";
import LockScreen from "@/modules/module_auth/LockScreen";
import AuthStatusScreen from "@/modules/module_auth/AuthStatusScreen";

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL || "http://127.0.0.1:3010";
const REFRESH_EVERY_MS = 10 * 60 * 1000;

export default function AuthGate({ children }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [screen, setScreen] = useState("login");
  const [connectionError, setConnectionError] = useState(false);
  const [sessionNotice, setSessionNotice] = useState("");

  const loadMe = useCallback(async () => {
    const me = await api.get("/api/v1/auth/me");
    localStorage.removeItem("pending_username");
    localStorage.removeItem("locked_username");
    setConnectionError(false);
    setSessionNotice("");
    setUser(me);
    return me;
  }, []);

  const hasUser = Boolean(user);
  useEffect(() => {
    window.localStorage.removeItem("fb_auth_token");
    let stopped = false;
    let timer;
    let failures = 0;
    async function restore() {
      try {
        const me = await api.get("/api/v1/auth/me");
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
          timer = setTimeout(restore, Math.min(30000, 2000 * 2 ** failures++));
          return;
        }
        const statusScreen = { ACCOUNT_BANNED: "banned", ACCOUNT_LOCKED: "banned", ACCOUNT_PENDING: "pending", ACCOUNT_REJECTED: "rejected" }[error.code];
        if (statusScreen) setScreen(statusScreen);
        else if (error.code === "SESSION_REVOKED") {
          localStorage.removeItem("pending_username");
          localStorage.removeItem("locked_username");
          setSessionNotice("Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại.");
        } else if (localStorage.getItem("pending_username") || localStorage.getItem("locked_username")) {
          try {
            const profile = await api.get("/api/v1/auth/registration-status");
            if (stopped) return;
            if (profile.status === "pending") setScreen("pending");
            else if (["banned", "locked"].includes(profile.status) || profile.hwid_mismatch) setScreen("banned");
            else if (profile.status === "rejected") setScreen("rejected");
          } catch { /* Login is available when the status ticket has expired. */ }
        }
        if (!stopped) { setConnectionError(false); setReady(true); }
      }
    }
    restore();
    return () => { stopped = true; clearTimeout(timer); };
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
        setConnectionError(true);
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
        setSessionNotice(message === "SESSION_REVOKED" ? "Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại." : "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
        setScreen("login");
      }
    };
    const refetch = async () => {
      if (busy || stopped) return;
      busy = true;
      clearTimeout(timer);
      try {
        if (Date.now() - refreshedAt >= REFRESH_EVERY_MS) {
          await api.post("/api/v1/auth/refresh");
          refreshedAt = Date.now();
        }
        const me = await api.get("/api/v1/auth/me");
        if (!stopped) { setUser(me); setConnectionError(false); }
        failures = 0;
      } catch (error) {
        failures++;
        if (!stopped) kick(error);
      } finally {
        busy = false;
        if (!stopped) timer = setTimeout(refetch, Math.min(60000, 15000 * 2 ** failures));
      }
    };
    timer = setTimeout(refetch, 15000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hasUser, loadMe, sessionUsername]);

  async function logout() {
    await api.post("/api/v1/auth/logout").catch(() => { });
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
    return <Shell><p role="status" className="text-sm text-slate-500">{connectionError ? "Mất kết nối máy chủ. Đang thử kết nối lại..." : "Đang kiểm tra phiên đăng nhập..."}</p></Shell>;
  }

  if (!user) {
    if (screen === "login") {
      return <LoginScreen sessionNotice={sessionNotice} onAuthenticated={loadMe} onStatus={showStatus} onRegister={() => setScreen("register")} />;
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
  return <>{connectionError && <div role="status" className="fixed top-0 inset-x-0 z-50 bg-amber-100 text-amber-900 p-3 text-center">Mất kết nối máy chủ. Đang thử kết nối lại...</div>}{children({ user, isAdmin, adminUrl: ADMIN_URL, logout })}</>;
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      {children}
    </div>
  );
}
