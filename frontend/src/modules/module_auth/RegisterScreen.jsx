"use client";

import { useEffect, useRef, useState } from "react";
import api from "@/services/api";
import { AuthLayout } from "./components/AuthLayout";
import { LoginHeroBanner } from "./components/LoginHeroBanner";
import { RegisterForm } from "./components/RegisterForm";
import { AuthFeedback } from "./components/AuthFeedback";
import { validateRegistrationField } from "./registrationValidation";

export default function RegisterScreen({ onLogin, onRegistered }) {
  const [fields, setFields] = useState({ username: "", password: "", confirmPassword: "", contactInfo: "", agreed: false });
  const [fieldErrors, setFieldErrors] = useState({});
  const [hwid, setHwid] = useState("");
  const [hwidLoading, setHwidLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const alive = useRef(true);
  const submitting = useRef(false);
  const copyTimer = useRef(null);

  useEffect(() => {
    alive.current = true;
    api.get("/api/v1/auth/hwid")
      .then((data) => { if (alive.current) setHwid(data.hwid || ""); })
      .catch(() => { if (alive.current) setFeedback({ title: "KẾT NỐI PHẦN CỨNG", message: "Chưa nhận diện được mã máy. Vui lòng kiểm tra Local Engine rồi thử lại." }); })
      .finally(() => { if (alive.current) setHwidLoading(false); });
    return () => { alive.current = false; clearTimeout(copyTimer.current); };
  }, []);

  function changeField(field, rawValue) {
    const value = field === "username" ? rawValue.replace(/\s+/g, "") : field === "contactInfo" ? rawValue.replace(/\D/g, "").slice(0, 10) : rawValue;
    setFields((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => {
      const next = { ...prev, [field]: validateRegistrationField(field, value, fields.password) };
      if (field === "password" && fields.confirmPassword) next.confirmPassword = validateRegistrationField("confirmPassword", fields.confirmPassword, value);
      return next;
    });
    setFeedback(null);
  }

  async function copyHwid() {
    try {
      await navigator.clipboard.writeText(hwid);
      if (!alive.current) return;
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setFeedback({ title: "SAO CHÉP HWID", message: "Không thể sao chép tự động. Bạn có thể chọn và sao chép mã máy." });
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    setFeedback(null);
    const errors = Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, validateRegistrationField(field, value, fields.password)]).filter(([, error]) => error));
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    submitting.current = true;
    setLoading(true);
    try {
      let currentHwid = hwid;
      if (!currentHwid) {
        setHwidLoading(true);
        const data = await api.get("/api/v1/auth/hwid");
        currentHwid = data.hwid;
        if (alive.current) setHwid(currentHwid || "");
        if (!currentHwid) throw new Error("Không nhận diện được mã máy (HWID). Vui lòng thử lại.");
      }
      const result = await api.post("/api/v1/auth/register", { username: fields.username, password: fields.password, contact_info: fields.contactInfo, hwid: currentHwid });
      if (!alive.current) return;
      if (!result.user_id || result.status !== "pending") throw new Error("Đăng ký không thành công. Vui lòng thử lại sau.");
      localStorage.setItem("pending_username", fields.username);
      setFeedback({ success: true, title: "ĐĂNG KÝ THÀNH CÔNG", message: "Đăng ký tài khoản thành công! Đang chuyển hướng đến trang chờ kích hoạt..." });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (alive.current) onRegistered(fields.username);
    } catch (error) {
      if (!alive.current) return;
      const message = String(error.message || "Không thể kết nối tới máy chủ xác thực.");
      if (/đã tồn tại|already exists|already registered/i.test(message)) setFieldErrors((prev) => ({ ...prev, username: "Tên đăng nhập đã tồn tại. Vui lòng chọn tên khác." }));
      else if (message.startsWith("Tên đăng nhập")) setFieldErrors((prev) => ({ ...prev, username: message }));
      else if (message.startsWith("Mật khẩu")) setFieldErrors((prev) => ({ ...prev, password: message }));
      else if (message.startsWith("Số điện thoại")) setFieldErrors((prev) => ({ ...prev, contactInfo: message }));
      setFeedback({ title: "ĐĂNG KÝ THẤT BẠI", message });
    } finally {
      submitting.current = false;
      if (alive.current) { setLoading(false); setHwidLoading(false); }
    }
  }

  return (
    <AuthLayout>
      <div className="auth-entry-frame">
        <LoginHeroBanner />
        <RegisterForm {...fields} {...{ hwid, hwidLoading, copied, showPassword, setShowPassword, showConfirmPassword, setShowConfirmPassword, loading, fieldErrors, onLogin }}
          setUsername={(value) => changeField("username", value)} setPassword={(value) => changeField("password", value)}
          setConfirmPassword={(value) => changeField("confirmPassword", value)} setContactInfo={(value) => changeField("contactInfo", value)} setAgreed={(value) => changeField("agreed", value)}
          onCopyHwid={copyHwid} onSubmit={submit} />
      </div>
      <AuthFeedback feedback={feedback} onClose={() => setFeedback(null)} />
    </AuthLayout>
  );
}
