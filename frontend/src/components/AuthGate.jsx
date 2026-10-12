"use client";

import { useEffect, useState } from "react";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL || "http://127.0.0.1:3010";
const REFRESH_EVERY_MS = 10 * 60 * 1000;

const STATUS_COPY = {
  pending: {
    title: "Tài khoản đang chờ duyệt",
    body: "Đăng ký đã gửi tới admin. Khi được cấp hạn dùng, bạn đăng nhập lại trên chính máy này.",
  },
  rejected: {
    title: "Đơn đăng ký bị từ chối",
    body: "Admin đã từ chối tài khoản này. Liên hệ quản trị để được mở lại.",
  },
  banned: {
    title: "Tài khoản đã bị khóa",
    body: "Quyền đăng nhập đã bị thu hồi. Mọi phiên cũ không còn dùng được.",
  },
  hwid: {
    title: "Máy này chưa được cấp quyền",
    body: "HWID không khớp máy đã đăng ký. Nhờ admin reset HWID rồi đăng nhập lại.",
  },
};

export default function AuthGate({ children }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [screen, setScreen] = useState("login");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function loadMe() {
    const me = await api.get("/api/v1/auth/me");
    setUser(me);
    return me;
  }

  useEffect(() => {
    window.localStorage.removeItem("fb_auth_token");
    loadMe()
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    const kick = (err) => {
      const message = String(err?.message || "");
      setUser(null);
      if (message.includes("SESSION_REVOKED") || message.includes("ACCOUNT_BANNED") || message.includes("ACCOUNT_LOCKED")) {
        setScreen("banned");
      } else {
        setScreen("login");
      }
      setError("");
    };
    const refetch = () => {
      api.post("/api/v1/auth/refresh")
        .then(() => loadMe())
        .catch(kick);
    };
    const refreshTimer = setInterval(refetch, REFRESH_EVERY_MS);
    const watchTimer = setInterval(() => {
      loadMe().catch(kick);
    }, 15000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(refreshTimer);
      clearInterval(watchTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user]);

  async function onLogin(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") || "").trim();
    const password = String(form.get("password") || "");
    try {
      const hwidRes = await api.get("/api/v1/auth/hwid");
      let loggedIn = false;
      try {
        await api.post(
          `/api/v1/admin/login?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
          null,
          { headers: { "X-Auth-Client": "browser" } }
        );
        loggedIn = true;
      } catch (adminErr) {
        const adminMsg = String(adminErr.message || "");
        if (adminMsg.includes("khóa")) throw adminErr;
      }
      if (!loggedIn) {
        await api.post("/api/v1/auth/verify-license", {
          username,
          password,
          hwid: hwidRes.hwid,
        });
      }
      await loadMe();
    } catch (err) {
      const message = String(err.message || "");
      if (message.includes("ACCOUNT_PENDING") || message.includes("chờ")) setScreen("pending");
      else if (message.includes("ACCOUNT_REJECTED") || message.includes("từ chối")) setScreen("rejected");
      else if (message.includes("ACCOUNT_BANNED") || message.includes("ACCOUNT_LOCKED") || message.includes("khóa")) setScreen("banned");
      else if (message.includes("ERR_HWID_MISMATCH") || message.includes("HWID")) setScreen("hwid");
      else setError(translate(message));
    } finally {
      setSubmitting(false);
    }
  }

  async function onRegister(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const hwidRes = await api.get("/api/v1/auth/hwid");
      await api.post("/api/v1/auth/register", {
        username: String(form.get("username") || "").trim(),
        password: String(form.get("password") || ""),
        contact_info: String(form.get("contact_info") || "").trim(),
        hwid: hwidRes.hwid,
      });
      setScreen("pending");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function logout() {
    api.post("/api/v1/auth/logout").catch(() => {});
    setUser(null);
    setScreen("login");
    setNotice("");
  }

  if (!ready) {
    return <Shell><p className="text-sm text-slate-500">Đang kiểm tra phiên đăng nhập...</p></Shell>;
  }

  if (!user) {
    if (screen !== "login" && screen !== "register") {
      const copy = STATUS_COPY[screen] || STATUS_COPY.pending;
      return (
        <Shell>
          <Card className="w-full max-w-md shadow-sm">
            <CardHeader className="space-y-2">
              <Brand />
              <h1 className="text-lg font-bold tracking-tight text-sky-600">{copy.title}</h1>
              <p className="text-sm leading-5 text-slate-500">{copy.body}</p>
            </CardHeader>
            <CardContent>
              <Button className="w-full" onClick={() => { setScreen("login"); setError(""); }}>Quay lại đăng nhập</Button>
            </CardContent>
          </Card>
        </Shell>
      );
    }

    return (
      <Shell>
        <Card className="w-full max-w-md shadow-sm">
          <CardHeader className="space-y-2">
            <Brand />
            <h1 className="text-lg font-bold tracking-tight text-sky-600">
              {screen === "login" ? "Đăng nhập hệ thống" : "Đăng ký tài khoản"}
            </h1>
            <p className="text-xs leading-4 text-slate-500">
              {screen === "login"
                ? "Dùng đúng máy đã được gán HWID. Tài khoản mới cần admin duyệt trước khi vào các module."
                : "Mật khẩu tối thiểu 6 ký tự, chỉ gồm chữ hoặc số. Số điện thoại 10 số, bắt đầu bằng 0."}
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={screen === "login" ? onLogin : onRegister} className="space-y-3">
              <Input name="username" placeholder="Tên đăng nhập" autoComplete="username" required />
              <Input name="password" type="password" placeholder="Mật khẩu" autoComplete={screen === "login" ? "current-password" : "new-password"} required />
              {screen === "register" && (
                <Input name="contact_info" placeholder="Số điện thoại liên hệ" inputMode="numeric" required />
              )}
              {error && <p className="text-xs text-red-600">{error}</p>}
              {notice && <p className="text-xs text-emerald-700">{notice}</p>}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Đang xử lý..." : screen === "login" ? "Đăng nhập" : "Gửi đăng ký"}
              </Button>
              <button
                type="button"
                className="w-full text-xs font-medium text-sky-600 hover:underline"
                onClick={() => { setScreen(screen === "login" ? "register" : "login"); setError(""); setNotice(""); }}
              >
                {screen === "login" ? "Chưa có tài khoản? Đăng ký" : "Đã có tài khoản? Đăng nhập"}
              </button>
            </form>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  const isAdmin = ["admin", "ADMIN"].includes(user.role);
  return children({ user, isAdmin, adminUrl: ADMIN_URL, logout });
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      {children}
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span className="size-9 rounded-full bg-primary text-white text-xs font-bold grid place-items-center">FB</span>
      <span className="text-sm font-semibold text-slate-700">Facebook Automator</span>
    </div>
  );
}

function translate(message) {
  const map = {
    ACCOUNT_NOT_FOUND: "Không tìm thấy tài khoản.",
    INVALID_PASSWORD: "Sai mật khẩu.",
    ACCOUNT_PENDING: "Tài khoản đang chờ admin duyệt.",
    ACCOUNT_BANNED: "Tài khoản đã bị khóa.",
    ACCOUNT_LOCKED: "Tài khoản đã bị khóa.",
    ACCOUNT_REJECTED: "Đơn đăng ký đã bị từ chối.",
    ERR_HWID_MISMATCH: "Máy này không khớp HWID.",
    SESSION_REVOKED: "Phiên đăng nhập đã bị thu hồi.",
  };
  return map[message] || message;
}
