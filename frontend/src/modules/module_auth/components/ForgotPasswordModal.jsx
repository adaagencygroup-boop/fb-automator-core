"use client";

import { useEffect, useRef } from "react";
import { ExternalLink, MessageSquare, Send, X } from "lucide-react";

export function ForgotPasswordModal({ isOpen, onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement;
    dialog.current?.focus();
    const handleKey = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const items = dialog.current?.querySelectorAll("button, a[href]");
        if (!items?.length) return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); previous?.focus(); };
  }, [isOpen, onClose]);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="forgot-title" tabIndex={-1} onClick={(event) => event.stopPropagation()} className="relative w-full max-w-[480px] rounded-2xl bg-[#ffffff] border border-[#e2e8f0] shadow-sm p-5 sm:p-6 text-slate-900 flex flex-col gap-4 outline-none">
        <button type="button" aria-label="Đóng popup" onClick={onClose} className="absolute top-3 right-3 p-1.5 text-slate-500 hover:text-slate-900"><X className="size-4" /></button>
        <h3 id="forgot-title" className="text-center pt-1 px-4 font-bold text-sm">Vui lòng liên hệ với admin để lấy lại mật khẩu!</h3>
        {[
          { href: "https://zalo.me", Icon: MessageSquare, title: "Hỗ trợ Zalo CSKH", description: "Quét mã QR / Nhắn tin Zalo trực tiếp" },
          { href: "https://t.me", Icon: Send, title: "Kỹ thuật viên Telegram", description: "Nhắn tin @admin_support (24/7)" },
        ].map(({ href, Icon, title, description }) => (
          <a key={title} href={href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-4 rounded-2xl bg-[#f1f5ff] border border-[#dbe5fa] hover:border-[#245ff4]/70">
            <div className="size-10 rounded-xl bg-[#e8efff] border border-[#dbe5fa] grid place-items-center"><Icon className="size-5 text-blue-600" /></div>
            <div className="flex-1"><p className="font-semibold text-sm">{title}</p><p className="text-[#64748b] text-xs mt-1">{description}</p></div>
            <ExternalLink className="size-4 text-slate-500" />
          </a>
        ))}
        <p className="text-[#64748b] text-xs">Thời gian duyệt: 8:00 - 23:00</p>
      </div>
    </div>
  );
}
