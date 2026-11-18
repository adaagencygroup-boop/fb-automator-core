"use client";

import React, { useEffect, useState, useRef } from "react";
import { LogOut, ArrowRight, ShieldCheck } from "lucide-react";
import "./LogoutNoticeModal.css";

export interface LogoutNoticeModalProps {
  isOpen: boolean;
  newUsername: string;
  title?: string;
  message?: string;
  countdownSeconds?: number;
  onRedirect?: () => void;
}

export function LogoutNoticeModal({
  isOpen,
  newUsername,
  title = "Đổi tên đăng nhập thành công!",
  message,
  countdownSeconds = 5,
  onRedirect,
}: LogoutNoticeModalProps) {
  const [countdown, setCountdown] = useState(countdownSeconds);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const performLogout = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("pending_logout_modal");
      localStorage.removeItem("admin_token");
      if (onRedirect) {
        onRedirect();
        return;
      }
      const targetParam = newUsername ? `&username=${encodeURIComponent(newUsername)}` : "";
      const successMsg = encodeURIComponent("Đổi tên đăng nhập thành công! Vui lòng đăng nhập lại bằng thông tin mới.");
      window.location.href = `/login?success=${successMsg}${targetParam}`;
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    // Đánh dấu cờ pending_logout_modal để api.ts và layout.tsx không tự ý redirect gây giật màn hình
    if (typeof window !== "undefined") {
      sessionStorage.setItem("pending_logout_modal", "true");
    }

    setCountdown(countdownSeconds);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          performLogout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isOpen, countdownSeconds]);

  if (!isOpen) return null;

  const defaultMsg =
    "Tài khoản quản trị của bạn đã được cập nhật tên đăng nhập mới. Vì lý do bảo mật, phiên làm việc hiện tại đã kết thúc. Vui lòng đăng nhập lại với tên đăng nhập mới để tiếp tục.";

  const progressPercent = Math.max(0, Math.min(100, (countdown / countdownSeconds) * 100));

  return (
    <div className="logout-notice-overlay" role="dialog" aria-modal="true">
      <div className="logout-notice-box">
        <div className="logout-notice-icon-wrap">
          <ShieldCheck size={32} strokeWidth={2.2} />
        </div>

        <h3 className="logout-notice-title">{title}</h3>
        <p className="logout-notice-desc">{message || defaultMsg}</p>

        {newUsername && (
          <div className="logout-notice-badge-card">
            <div>
              <div className="logout-notice-badge-label">Tên đăng nhập mới</div>
              <div className="logout-notice-badge-val">{newUsername}</div>
            </div>
            <div className="logout-notice-badge-tag">
              <span className="logout-notice-badge-tag-dot" />
              Đã cập nhật
            </div>
          </div>
        )}

        <div className="logout-notice-countdown-bar">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>⏱️ Tự động chuyển hướng về trang đăng nhập...</span>
            <strong>{countdown}s</strong>
          </div>
          <div className="logout-notice-progress-bg">
            <div
              className="logout-notice-progress-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <div className="logout-notice-actions">
          <button
            type="button"
            className="logout-notice-btn"
            onClick={performLogout}
          >
            <span>Đăng nhập lại ngay</span>
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
