"use client";

import { useState } from "react";
import { LoginHeader } from "./components/LoginHeader";
import { PendingStatusHeader } from "./components/PendingStatusHeader";
import { RejectedStatusHeader } from "./components/RejectedStatusHeader";
import { LockStatusHeader } from "./components/LockStatusHeader";
import { ForgotPasswordModal } from "./components/ForgotPasswordModal";

export default function AuthStatusScreen({ status, onBack }) {
  const [supportOpen, setSupportOpen] = useState(false);
  const Header = status === "pending" ? PendingStatusHeader : status === "rejected" ? RejectedStatusHeader : LockStatusHeader;
  return (
    <div className="min-h-screen bg-[#ffffff] text-slate-900 flex flex-col font-heading">
      <div className="px-5 py-4"><LoginHeader /></div>
      <main className="flex-1 flex items-center justify-center px-5 py-10 auth-login-background">
        <div className="w-full max-w-3xl flex flex-col items-center gap-6">
          <Header />
          {status === "hwid" && <p role="alert" className="text-sm text-amber-200 text-center">Mã máy không khớp với thiết bị đã đăng ký. Vui lòng nhờ quản trị viên đặt lại HWID.</p>}
          <div className="flex flex-wrap justify-center gap-3">
            <button type="button" onClick={() => setSupportOpen(true)} className="px-5 py-3 rounded-full bg-[#245ff4] text-white font-semibold text-sm">Liên hệ quản trị viên</button>
            <button type="button" onClick={onBack} className="px-5 py-3 rounded-full bg-[#eff3ff] border border-[#dbe5fa] text-sm">Quay lại đăng nhập</button>
          </div>
        </div>
      </main>
      <ForgotPasswordModal isOpen={supportOpen} onClose={() => setSupportOpen(false)} />
    </div>
  );
}
