"use client";

import { useEffect, useRef, useState } from "react";
import { AuthFeedback } from "./components/AuthFeedback";
import { loginFeedback } from "./loginFeedback";
import api from "@/services/api";
import { AuthLayout } from "./components/AuthLayout";
import { LoginHeroBanner } from "./components/LoginHeroBanner";
import { LoginForm } from "./components/LoginForm";
import { ForgotPasswordModal } from "./components/ForgotPasswordModal";
import { useMachineHwid } from "./useMachineHwid";

export default function LoginScreen({ onAuthenticated, onStatus, onRegister, sessionNotice }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { hwid, hwidLoading, hwidError, setHwid, reloadHwid } = useMachineHwid();
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
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
    if (saved) {
      setUsername(saved);
      setRememberMe(true);
    }
    return () => {
      alive.current = false;
      clearTimeout(copyTimer.current);
    };
  }, []);

  useEffect(() => {
    if (hwidError) {
      setFeedback({ title: "KẾT NỐI PHẦN CỨNG", message: hwidError });
    }
  }, [hwidError]);

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
    if (hwidLoading) {
      setFeedback({ title: "KẾT NỐI PHẦN CỨNG", message: "Đang nhận diện mã máy. Vui lòng đợi HWID hiện lên rồi đăng nhập." });
      return;
    }
    setLoading(true);
    try {
      let currentHwid = hwid;
      if (!currentHwid) {
        currentHwid = await reloadHwid();
        setHwid(currentHwid || "");
        if (!currentHwid) throw new Error("Không nhận diện được mã máy (HWID). Vui lòng thử lại.");
      }
      const result = await api.post("/api/v1/auth/login", {
        username: username.trim(), password, hwid: currentHwid, remember_me: rememberMe,
      });
      if (rememberMe) localStorage.setItem("remembered_username", username.trim());
      else localStorage.removeItem("remembered_username");
      setFeedback(result.status === "expired" ? loginFeedback.license : {
        success: true,
        title: "XÁC THỰC THÀNH CÔNG",
        message: "Đăng nhập thành công! Đang chuyển hướng vào hệ thống...",
      });
      await new Promise((resolve) => setTimeout(resolve, 800));
      if (alive.current) await onAuthenticated();
    } catch (error) {
      if (!alive.current) return;
      const message = String(error.message || "Không thể kết nối đến máy chủ xác thực.");
      const statuses = { ACCOUNT_PENDING: "pending", ACCOUNT_REJECTED: "rejected", ACCOUNT_BANNED: "banned", ACCOUNT_LOCKED: "banned", ERR_HWID_MISMATCH: "hwid" };
      if (statuses[message]) {
        if (message === "ERR_HWID_MISMATCH") {
          setFeedback(loginFeedback.hwid);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          if (!alive.current) return;
        }
        onStatus(statuses[message], username.trim());
        return;
      }
      const translated = { ACCOUNT_NOT_FOUND: "Tài khoản không tồn tại trên hệ thống.", INVALID_PASSWORD: "Mật khẩu không chính xác." }[message] || message;
      if (message === "ACCOUNT_NOT_FOUND") setFieldErrors({ username: translated });
      if (message === "INVALID_PASSWORD") setFieldErrors({ password: translated });
      setFeedback(message === "INVALID_PASSWORD" ? loginFeedback.credentials
        : message === "LICENSE_EXPIRED" ? loginFeedback.license
        : { title: "ĐĂNG NHẬP THẤT BẠI", message: translated });
    } finally {
      if (alive.current) setLoading(false);
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
