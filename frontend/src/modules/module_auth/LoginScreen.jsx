"use client";

import { useEffect, useRef, useState } from "react";
import { AuthFeedback } from "./components/AuthFeedback";
import api from "@/services/api";
import { AuthLayout } from "./components/AuthLayout";
import { LoginHeroBanner } from "./components/LoginHeroBanner";
import { LoginForm } from "./components/LoginForm";
import { ForgotPasswordModal } from "./components/ForgotPasswordModal";

export default function LoginScreen({ onAuthenticated, onStatus, onRegister, sessionNotice }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [hwid, setHwid] = useState("");
  const [hwidLoading, setHwidLoading] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [feedback, setFeedback] = useState(sessionNotice ? { title: "PHIÊN ĐĂNG NHẬP", message: sessionNotice } : null);
  const copyTimer = useRef(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const saved = localStorage.getItem("remembered_username");
    Promise.resolve().then(() => {
      if (alive.current && saved) { setUsername(saved); setRememberMe(true); }
    });
    api.get("/api/v1/auth/hwid")
      .then((data) => { if (alive.current) setHwid(data.hwid || ""); })
      .catch(() => { if (alive.current) setFeedback({ title: "KẾT NỐI PHẦN CỨNG", message: "Chưa nhận diện được mã máy. Vui lòng kiểm tra Local Engine rồi thử lại." }); })
      .finally(() => { if (alive.current) setHwidLoading(false); });
    return () => { alive.current = false; clearTimeout(copyTimer.current); };
  }, []);

  function clearFieldError(field) {
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    setFeedback(null);
  }

  async function copyHwid() {
    try {
      await navigator.clipboard.writeText(hwid);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setFeedback({ title: "SAO CHÉP HWID", message: "Không thể sao chép tự động. Bạn có thể chọn và sao chép mã máy." });
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (loading) return;
    setFeedback(null);
    const errors = {};
    if (!username.trim()) errors.username = "Vui lòng nhập tên đăng nhập.";
    if (!password) errors.password = "Vui lòng nhập mật khẩu.";
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    setLoading(true);
    try {
      let currentHwid = hwid;
      if (!currentHwid) {
        setHwidLoading(true);
        const data = await api.get("/api/v1/auth/hwid");
        currentHwid = data.hwid;
        setHwid(currentHwid || "");
        if (!currentHwid) throw new Error("Không nhận diện được mã máy (HWID). Vui lòng thử lại.");
      }
      const result = await api.post("/api/v1/auth/login", {
        username: username.trim(), password, hwid: currentHwid, remember_me: rememberMe,
      });
      if (rememberMe) localStorage.setItem("remembered_username", username.trim());
      else localStorage.removeItem("remembered_username");
      setFeedback({
        success: true,
        tone: result.status === "expired" ? "error" : "success",
        kind: result.status === "expired" ? "license" : undefined,
        title: result.status === "expired" ? "BẢN QUYỀN HẾT HẠN" : "XÁC THỰC THÀNH CÔNG",
        message: result.status === "expired"
          ? "Bản quyền của bạn đã hết hạn! Vui lòng gia hạn để sử dụng đầy đủ tính năng."
          : "Đăng nhập thành công! Đang chuyển hướng vào hệ thống...",
      });
      await new Promise((resolve) => setTimeout(resolve, 800));
      if (alive.current) await onAuthenticated();
    } catch (error) {
      if (!alive.current) return;
      const message = String(error.message || "Không thể kết nối đến máy chủ xác thực.");
      const statuses = { ACCOUNT_PENDING: "pending", ACCOUNT_REJECTED: "rejected", ACCOUNT_BANNED: "banned", ACCOUNT_LOCKED: "banned", ERR_HWID_MISMATCH: "hwid" };
      if (statuses[message]) {
        if (message === "ERR_HWID_MISMATCH") {
          setFeedback({ title: "LỖI XÁC THỰC PHẦN CỨNG HWID", message: "Mã máy hiện tại không trùng khớp với mã HWID đã được kích hoạt trong License của tài khoản này. Mỗi License chỉ có giá trị với duy nhất 1 thiết bị." });
          await new Promise((resolve) => setTimeout(resolve, 1000));
          if (!alive.current) return;
        }
        onStatus(statuses[message], username.trim());
        return;
      }
      const translated = { ACCOUNT_NOT_FOUND: "Tài khoản không tồn tại trên hệ thống.", INVALID_PASSWORD: "Mật khẩu không chính xác." }[message] || message;
      if (message === "ACCOUNT_NOT_FOUND") setFieldErrors({ username: translated });
      if (message === "INVALID_PASSWORD") setFieldErrors({ password: translated });
      setFeedback({ title: "ĐĂNG NHẬP THẤT BẠI", message: translated });
    } finally {
      if (alive.current) { setLoading(false); setHwidLoading(false); }
    }
  }

  return (
    <AuthLayout>
      <div className="auth-entry-frame">
        <LoginHeroBanner />
        <LoginForm {...{ username, setUsername, password, setPassword, showPassword, setShowPassword, rememberMe, setRememberMe, hwid, hwidLoading, copied, loading, fieldErrors, clearFieldError }}
          onCopyHwid={copyHwid} onSubmit={submit} onOpenForgotModal={() => setShowForgotModal(true)} onRegister={onRegister} />
      </div>
      <AuthFeedback feedback={feedback} onClose={() => setFeedback(null)} />
      <ForgotPasswordModal isOpen={showForgotModal} onClose={() => setShowForgotModal(false)} />
    </AuthLayout>
  );
}
