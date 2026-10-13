"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import api from "@/services/api";
import { LockStatusHeader } from "./components/LockStatusHeader";
import { PendingSupportCards } from "./components/PendingSupportCards";
import { LockFooter } from "./components/LockFooter";
import { AuthFeedback } from "./components/AuthFeedback";

const ZALO_PHONE = "0988.888.247";
const RAW_ZALO_PHONE = "0988888247";
const TELEGRAM_HANDLE = "@admin_support";

export default function LockScreen({ onBack, onStatus }) {
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [copiedTele, setCopiedTele] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const alive = useRef(true);
  const checking = useRef(false);
  const moving = useRef(false);
  const timers = useRef(new Set());

  const later = useCallback((callback, delay) => {
    const timer = setTimeout(() => { timers.current.delete(timer); if (alive.current) callback(); }, delay);
    timers.current.add(timer);
  }, []);

  const checkStatus = useCallback(async (manual = false) => {
    if (checking.current || moving.current) return;
    checking.current = true;
    if (manual) setRefreshing(true);
    try {
      const profile = await api.get("/api/v1/auth/registration-status");
      if (!alive.current) return;
      if (["approved", "ACTIVE", "expired"].includes(profile.status) && !profile.hwid_mismatch) {
        moving.current = true;
        localStorage.removeItem("locked_username");
        setFeedback({ success: true, title: "ĐÃ MỞ KHÓA", message: "Tài khoản của bạn đã được mở khóa! Đang chuyển đến trang đăng nhập..." });
        later(onBack, 1000);
      } else if (profile.status === "pending") {
        moving.current = true;
        localStorage.setItem("pending_username", profile.username);
        localStorage.removeItem("locked_username");
        setFeedback({ title: "CHỜ DUYỆT", message: "Tài khoản của bạn đã được chuyển về trạng thái chờ duyệt! Đang chuyển hướng..." });
        later(() => onStatus("pending", profile.username), 1000);
      } else if (manual) {
        setFeedback({ title: "TÀI KHOẢN KHÓA", message: profile.hwid_mismatch
          ? "Mã máy vẫn chưa khớp với thiết bị đã đăng ký. Vui lòng nhờ quản trị viên đặt lại HWID."
          : "Tài khoản vẫn đang bị khóa bởi Quản trị viên hệ thống." });
      }
    } catch (error) {
      if (alive.current && manual) setFeedback({ title: "LỖI KẾT NỐI", message: error.message || "Không thể kết nối tới máy chủ xác thực." });
    } finally {
      checking.current = false;
      if (manual) later(() => setRefreshing(false), 600);
    }
  }, [later, onBack, onStatus]);

  useEffect(() => {
    alive.current = true;
    const activeTimers = timers.current;
    const interval = setInterval(() => checkStatus(), 5000);
    return () => {
      alive.current = false;
      clearInterval(interval);
      activeTimers.forEach(clearTimeout);
      activeTimers.clear();
    };
  }, [checkStatus]);

  async function copyContact(value, setCopied, message) {
    try {
      await navigator.clipboard.writeText(value);
      if (!alive.current) return;
      setCopied(true);
      setFeedback({ success: true, title: "SAO CHÉP THÀNH CÔNG", message });
      later(() => setCopied(false), 2000);
    } catch {
      if (alive.current) setFeedback({ title: "SAO CHÉP THẤT BẠI", message: "Không thể sao chép tự động. Vui lòng chọn và sao chép thông tin liên hệ." });
    }
  }

  return (
    <div className="w-full min-h-screen lg:h-screen flex flex-col justify-between bg-[#ffffff] font-heading text-slate-900 overflow-y-auto">
      <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8 max-w-[960px] mx-auto w-full my-auto">
        <div className="w-full flex flex-col items-center text-center py-4 lg:py-0">
          <LockStatusHeader />
          <PendingSupportCards zaloPhone={ZALO_PHONE} rawZaloPhone={RAW_ZALO_PHONE} telegramHandle={TELEGRAM_HANDLE} {...{ copiedPhone, copiedTele }}
            onCopyPhone={() => copyContact(RAW_ZALO_PHONE, setCopiedPhone, `Đã sao chép số Zalo Hotline: ${ZALO_PHONE}`)}
            onCopyTele={() => copyContact(TELEGRAM_HANDLE, setCopiedTele, `Đã sao chép Telegram Tag: ${TELEGRAM_HANDLE}`)} />
        </div>
      </main>
      <LockFooter refreshing={refreshing} onRefresh={() => checkStatus(true)} onBack={onBack} />
      <AuthFeedback feedback={feedback} onClose={() => setFeedback(null)} />
    </div>
  );
}
