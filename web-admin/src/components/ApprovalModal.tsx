"use client";

import { useState, useEffect, useRef } from "react";
import { User, api } from "@/lib/api";
import { X, User as UserIcon, Contact, Cpu, Calendar, Copy, CheckCircle2, XCircle } from "lucide-react";

interface Props {
  user: User | null;
  onClose: () => void;
  onSuccess: () => void;
  mode?: "approve" | "extend";
}

export default function ApprovalModal({ user, onClose, onSuccess, mode }: Props) {
  const [days, setDays] = useState(30);
  const [customDaysInput, setCustomDaysInput] = useState("");
  const [loadingApprove, setLoadingApprove] = useState(false);
  const [loadingReject, setLoadingReject] = useState(false);
  const [error, setError] = useState("");
  const [copiedHwid, setCopiedHwid] = useState(false);
  const datePickerRef = useRef<HTMLInputElement>(null);

  const isExtend = user?.status !== "pending" && (mode === "extend" || (user && (user.status === "approved" || user.status === "expired")));
  const isRejected = user?.status === "rejected";

  useEffect(() => {
    if (user) {
      setDays(30);
      setCustomDaysInput("");
      setError("");
      setCopiedHwid(false);
    }
  }, [user]);

  if (!user) return null;

  const handleSelectDays = (d: number) => {
    setDays(d);
    setCustomDaysInput("");
  };

  const handleCustomDaysChange = (val: string) => {
    setCustomDaysInput(val);
    if (val === "" || val === "-") {
      setDays(0);
      return;
    }
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed)) {
      setDays(parsed);
    }
  };

  const handleDatePickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value; // Format YYYY-MM-DD
    if (!val) return;
    const selectedDate = new Date(val);
    let base = new Date();
    if (isExtend && user.expired_at) {
      const curExp = parseUtcDate(user.expired_at);
      if (curExp && curExp > new Date()) {
        base = new Date(curExp);
      }
    }
    base.setHours(0, 0, 0, 0);
    selectedDate.setHours(0, 0, 0, 0);

    const diffTime = selectedDate.getTime() - base.getTime();
    const calculatedDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    setDays(calculatedDays);
    setCustomDaysInput(String(calculatedDays));
  };

  const handleConfirm = async () => {
    if (days === 0) {
      setError("Vui lòng nhập số ngày khác 0");
      return;
    }
    setLoadingApprove(true);
    setError("");
    try {
      let successMsg = "";
      if (isExtend) {
        if (user.status === "pending") {
          setError("Tài khoản đang chờ duyệt không thể gia hạn. Vui lòng phê duyệt tài khoản trước.");
          setLoadingApprove(false);
          return;
        }
        await api.extendUser(user.id, days);
        successMsg =
          days >= 0
            ? `Gia hạn thành công +${days} ngày cho tài khoản ${user.username}!`
            : `Đã trừ thành công ${Math.abs(days)} ngày của tài khoản ${user.username}!`;
      } else {
        await api.approveUser(user.id, days);
        successMsg = isRejected
          ? `Phê duyệt lại tài khoản ${user.username} thành công (+${days} ngày)!`
          : `Phê duyệt tài khoản ${user.username} thành công (+${days} ngày)!`;
      }

      window.dispatchEvent(
        new CustomEvent("app_toast", {
          detail: { msg: successMsg, type: "success" },
        })
      );

      onSuccess();
      onClose();
    } catch (e: any) {
      setError(e.message || (isExtend ? "Cập nhật thời hạn thất bại" : "Phê duyệt thất bại"));
    } finally {
      setLoadingApprove(false);
    }
  };

  const handleReject = async () => {
    setLoadingReject(true);
    setError("");
    try {
      await api.rejectUser(user.id);
      window.dispatchEvent(
        new CustomEvent("app_toast", {
          detail: { msg: `Đã từ chối tài khoản ${user.username}!`, type: "success" },
        })
      );

      onSuccess();
      onClose();
    } catch (e: any) {
      setError(e.message || "Từ chối thất bại");
    } finally {
      setLoadingReject(false);
    }
  };

  const copyHwid = (hwidStr: string) => {
    if (!hwidStr) return;
    navigator.clipboard.writeText(hwidStr);
    setCopiedHwid(true);
    setTimeout(() => setCopiedHwid(false), 2000);
  };

  const parseUtcDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    const isoStr = dateStr.endsWith("Z") || dateStr.includes("+") ? dateStr : `${dateStr}Z`;
    const d = new Date(isoStr);
    return isNaN(d.getTime()) ? new Date(dateStr) : d;
  };

  // Tính ngày hết hạn dự kiến từ số ngày được chọn
  const calcExpiryDate = () => {
    let exp = new Date();
    if (isExtend && user.expired_at) {
      const curExp = parseUtcDate(user.expired_at);
      if (curExp && curExp > new Date()) {
        exp = new Date(curExp);
      }
    }
    exp.setDate(exp.getDate() + (days || 0));
    const d = String(exp.getDate()).padStart(2, "0");
    const m = String(exp.getMonth() + 1).padStart(2, "0");
    const y = exp.getFullYear();
    return `${d}/${m}/${y}`;
  };

  const formattedCreatedAt = (() => {
    const d = parseUtcDate(user.created_at);
    return d
      ? d.toLocaleString("vi-VN", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";
  })();

  const displayUid = `UID: #USR-${String(user.id).padStart(5, "0")}-VN`;
  const displayStatus =
    user.status === "pending"
      ? "Chờ duyệt"
      : user.status === "approved"
      ? "Đã duyệt"
      : user.status === "rejected"
      ? "Bị từ chối"
      : user.status === "banned"
      ? "Đã khóa"
      : user.status === "expired"
      ? "Hết hạn"
      : user.status;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[999] p-4 overflow-y-auto">
      <div className="relative w-[970px] max-w-[970px] h-[640px] max-h-[95vh] bg-[#F8F9FF] border border-[#9BA7B5] rounded-[15px] shadow-2xl overflow-hidden flex flex-col box-border">
        {/* Close Button Top Right */}
        <button
          type="button"
          onClick={onClose}
          className="absolute w-[36px] h-[36px] right-[20px] top-[8px] bg-[#F1F7FF] hover:bg-slate-200 text-[#0B1C30] hover:text-slate-800 rounded-[12px] flex items-center justify-center z-30 transition-all hover:scale-105"
          title="Đóng"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Main 2-Column Grid */}
        <div className="w-[970px] h-[640px] p-[50px_20px_20px] flex flex-row items-center gap-[24px] box-border">
          {/* LEFT COLUMN: USER DETAILS */}
          <div className="relative w-[531px] h-[568px] p-[32px] bg-white border border-[#E2E8F0] rounded-[16px] shadow-sm overflow-hidden flex flex-col justify-between items-start shrink-0 box-border">
            {/* Subtle Glow Layer */}
            <div className="absolute w-[208px] h-[208px] -left-[63px] -top-[63px] bg-[#DBEAFE]/60 blur-[32px] rounded-full pointer-events-none z-0" />

            <div className="w-full relative z-10">
              {/* User Avatar & Status */}
              <div className="w-full pb-[24px] border-b border-[#E2E8F0] flex flex-row justify-between items-center box-border">
                <div className="flex flex-row items-center gap-[16px]">
                  <div className="relative w-[64px] h-[64px] bg-[#EFF6FF] border border-[#DBEAFE] rounded-full shadow-sm flex items-center justify-center shrink-0">
                    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M5.775 22.65C7.05 21.675 8.475 20.9062 10.05 20.3438C11.625 19.7812 13.275 19.5 15 19.5C16.725 19.5 18.375 19.7812 19.95 20.3438C21.525 20.9062 22.95 21.675 24.225 22.65C25.1 21.625 25.7812 20.4625 26.2687 19.1625C26.7562 17.8625 27 16.475 27 15C27 11.675 25.8312 8.84375 23.4937 6.50625C21.1562 4.16875 18.325 3 15 3C11.675 3 8.84375 4.16875 6.50625 6.50625C4.16875 8.84375 3 11.675 3 15C3 16.475 3.24375 17.8625 3.73125 19.1625C4.21875 20.4625 4.9 21.625 5.775 22.65ZM15 16.5C13.525 16.5 12.2812 15.9937 11.2688 14.9812C10.2563 13.9688 9.75 12.725 9.75 11.25C9.75 9.775 10.2563 8.53125 11.2688 7.51875C12.2812 6.50625 13.525 6 15 6C16.475 6 17.7188 6.50625 18.7313 7.51875C19.7438 8.53125 20.25 9.775 20.25 11.25C20.25 12.725 19.7438 13.9688 18.7313 14.9812C17.7188 15.9937 16.475 16.5 15 16.5ZM15 30C12.925 30 10.975 29.6063 9.15 28.8188C7.325 28.0312 5.7375 26.9625 4.3875 25.6125C3.0375 24.2625 1.96875 22.675 1.18125 20.85C0.39375 19.025 0 17.075 0 15C0 12.925 0.39375 10.975 1.18125 9.15C1.96875 7.325 3.0375 5.7375 4.3875 4.3875C5.7375 3.0375 7.325 1.96875 9.15 1.18125C10.975 0.39375 12.925 0 15 0C17.075 0 19.025 0.39375 20.85 1.18125C22.675 1.96875 24.2625 3.0375 25.6125 4.3875C26.9625 5.7375 28.0312 7.325 28.8188 9.15C29.6063 10.975 30 12.925 30 15C30 17.075 29.6063 19.025 28.8188 20.85C28.0312 22.675 26.9625 24.2625 25.6125 25.6125C24.2625 26.9625 22.675 28.0312 20.85 28.8188C19.025 29.6063 17.075 30 15 30Z"
                        fill="#2563EB"
                      />
                    </svg>
                    <span className="absolute w-[16px] h-[16px] right-[1px] bottom-[1px] bg-white rounded-full flex items-center justify-center">
                      <span className="w-[12px] h-[12px] bg-[#2563EB] rounded-full" />
                    </span>
                  </div>
                  <div className="flex flex-col items-start">
                    <h3 className="font-['Plus_Jakarta_Sans',sans-serif] font-bold text-[22px] leading-[30px] -tracking-[0.55px] text-[#0B1C30] m-0">
                      {user.username}
                    </h3>
                    <p className="font-['Inter',sans-serif] font-medium text-[12px] leading-[16px] tracking-[0.24px] text-[#64748B] m-0">
                      {displayUid}
                    </p>
                  </div>
                </div>

                <div className="flex flex-row items-center px-[12px] py-[6px] gap-[6px] h-[32px] bg-[#FFFBEB] border border-[#FDE68A] shadow-sm rounded-full text-[#B45309] font-['Inter',sans-serif] font-bold text-[13px] leading-[18px] tracking-[0.325px]">
                  <span className="w-[8px] h-[8px] bg-[#F59E0B] shadow-[0_0_8px_#F59E0B] rounded-full" />
                  <span>{displayStatus}</span>
                </div>
              </div>

              {/* Details list */}
              <div className="flex flex-col justify-around items-start py-[18px] gap-[16px] w-full box-border">
                {/* Username */}
                <div className="flex flex-row justify-between items-center p-[14px_16px] w-full bg-[#F8FAFC] border border-[#F1F5F9] rounded-[12px] box-border">
                  <div className="flex flex-row items-center gap-[8px] font-['Inter',sans-serif] font-medium text-[13px] leading-[18px] tracking-[0.13px] text-[#475569]">
                    <UserIcon className="w-[15px] h-[15px] text-[#94A3B8]" />
                    <span>Username</span>
                  </div>
                  <div className="flex flex-col items-start px-[8px] py-[4px] bg-white border border-[#E2E8F0] shadow-sm rounded-[4px] font-['Inter',sans-serif] font-semibold text-[12px] leading-[16px] tracking-[0.24px] text-[#0B1C30]">
                    {user.username}
                  </div>
                </div>

                {/* Contact Info */}
                <div className="flex flex-row justify-between items-center p-[14px_16px] w-full bg-[#F8FAFC] border border-[#F1F5F9] rounded-[12px] box-border">
                  <div className="flex flex-row items-center gap-[8px] font-['Inter',sans-serif] font-medium text-[13px] leading-[18px] tracking-[0.13px] text-[#475569]">
                    <Contact className="w-[15px] h-[15px] text-[#94A3B8]" />
                    <span>Thông tin liên hệ</span>
                  </div>
                  <div>
                    <div className="font-['Inter',sans-serif] font-semibold text-[12px] leading-[16px] tracking-[0.24px] text-[#0B1C30] text-right">
                      {user.contact_info || "Chưa cập nhật"}
                    </div>
                  </div>
                </div>

                {/* HWID */}
                <div className="flex flex-row justify-between items-center p-[14px_16px] w-full bg-[#F8FAFC] border border-[#F1F5F9] rounded-[12px] box-border">
                  <div className="flex flex-row items-center gap-[8px] font-['Inter',sans-serif] font-medium text-[13px] leading-[18px] tracking-[0.13px] text-[#475569]">
                    <Cpu className="w-[15px] h-[15px] text-[#94A3B8]" />
                    <span>Mã phần cứng (HWID)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {user.hwid ? (
                      <div className="flex flex-row items-center px-[8px] py-[4px] bg-[#EFF6FF] border border-[#BFDBFE] rounded-[4px] font-['Inter',sans-serif] font-bold text-[12px] leading-[16px] tracking-[0.6px] text-[#2563EB]">
                        {user.hwid.length > 14 ? `${user.hwid.slice(0, 14)}...` : user.hwid}
                        <button
                          type="button"
                          onClick={() => copyHwid(user.hwid!)}
                          className="w-[28px] h-[28px] ml-1 bg-white hover:bg-slate-100 text-[#475569] hover:text-[#0B1C30] border border-[#E2E8F0] shadow-sm rounded-[8px] flex items-center justify-center transition-all cursor-pointer"
                          title="Copy HWID"
                        >
                          {copiedHwid ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs italic text-slate-400">Tự gán ở lần đầu login</span>
                    )}
                  </div>
                </div>

                {/* Registration Date */}
                <div className="flex flex-row justify-between items-center p-[14px_16px] w-full bg-[#F8FAFC] border border-[#F1F5F9] rounded-[12px] box-border">
                  <div className="flex flex-row items-center gap-[8px] font-['Inter',sans-serif] font-medium text-[13px] leading-[18px] tracking-[0.13px] text-[#475569]">
                    <Calendar className="w-[15px] h-[15px] text-[#94A3B8]" />
                    <span>Ngày đăng ký</span>
                  </div>
                  <div className="font-['Inter',sans-serif] font-semibold text-[12px] leading-[16px] tracking-[0.24px] text-[#0B1C30] font-mono text-right">
                    {formattedCreatedAt}
                  </div>
                </div>
              </div>
            </div>

            {/* Left Footer Info */}
            <div className="w-full pt-[16px] border-t border-[#E2E8F0] flex flex-row justify-between items-center relative z-10 box-border">
              <div className="flex flex-row items-center gap-[6px] font-['Inter',sans-serif] font-semibold text-[11px] leading-[16px] tracking-[0.55px] text-[#64748B]">
                <span className="w-[6px] h-[6px] bg-[#10B981] rounded-full inline-block shrink-0" />
                <span>IP: 118.69.182.204 (Hà Nội, VN)</span>
              </div>
              <div className="flex flex-row items-center gap-[6px] font-['Inter',sans-serif] font-semibold text-[11px] leading-[16px] tracking-[0.55px] text-[#64748B]">
                <span>Phiên bản Client: v2.3.9</span>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: LICENSE ALLOCATION */}
          <div className="relative w-[373px] h-[568px] p-[15px_32px_30px] bg-white border border-[#E2E8F0] rounded-[16px] shadow-sm overflow-hidden flex flex-col justify-between items-start shrink-0 box-border">
            {/* Ambient Decorative Bloom */}
            <div className="absolute w-[240px] h-[240px] -right-[79px] -top-[79px] bg-[#DBEAFE]/40 blur-[32px] rounded-full pointer-events-none z-0" />

            <div className="flex flex-col items-start w-[309px] gap-[16px] self-stretch relative z-10">
              {/* Header */}
              <div className="flex flex-row justify-between items-center w-full h-[36px]">
                <div className="flex flex-row items-center gap-[8px]">
                  <div className="w-[36px] h-[36px] bg-[#EFF6FF] border border-[#DBEAFE] shadow-sm rounded-[12px] flex items-center justify-center text-[#2563EB]">
                    <svg width="19" height="10" viewBox="0 0 19 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M5 10C3.61111 10 2.43056 9.51389 1.45833 8.54167C0.486111 7.56944 0 6.38889 0 5C0 3.61111 0.486111 2.43056 1.45833 1.45833C2.43056 0.486111 3.61111 0 5 0C5.91667 0 6.75694 0.229167 7.52083 0.6875C8.28472 1.14583 8.88889 1.75 9.33333 2.5H18.3333V7.5H16.6667V10H11.6667V7.5H9.33333C8.88889 8.25 8.28472 8.85417 7.52083 9.3125C6.75694 9.77083 5.91667 10 5 10ZM5 8.33333C5.91667 8.33333 6.65278 8.05208 7.20833 7.48958C7.76389 6.92708 8.09722 6.375 8.20833 5.83333H13.3333V8.33333H15V5.83333H16.6667V4.16667H8.20833C8.09722 3.625 7.76389 3.07292 7.20833 2.51042C6.65278 1.94792 5.91667 1.66667 5 1.66667C4.08333 1.66667 3.29861 1.99306 2.64583 2.64583C1.99306 3.29861 1.66667 4.08333 1.66667 5C1.66667 5.91667 1.99306 6.70139 2.64583 7.35417C3.29861 8.00694 4.08333 8.33333 5 8.33333ZM5 6.66667C5.45833 6.66667 5.85069 6.50347 6.17708 6.17708C6.50347 5.85069 6.66667 5.45833 6.66667 5C6.66667 4.54167 6.50347 4.14931 6.17708 3.82292C5.85069 3.49653 5.45833 3.33333 5 3.33333C4.54167 3.33333 4.14931 3.49653 3.82292 3.82292C3.49653 4.14931 3.33333 4.54167 3.33333 5C3.33333 5.45833 3.49653 5.85069 3.82292 6.17708C4.14931 6.50347 4.54167 6.66667 5 6.66667Z"
                        fill="#2563EB"
                      />
                    </svg>
                  </div>
                  <h3 className="font-['Plus_Jakarta_Sans',sans-serif] font-semibold text-[18px] leading-[26px] text-[#0B1C30] m-0">
                    {isExtend ? "Gia hạn license" : isRejected ? "Phê duyệt lại & Cấp license" : "Cấp license"}
                  </h3>
                </div>
                <span className="px-[8px] py-[4px] bg-[#EFF6FF] border border-[#DBEAFE] rounded-[4px] font-['Inter',sans-serif] font-bold text-[11px] leading-[16px] tracking-[0.55px] uppercase text-[#2563EB]">
                  PRO TIER
                </span>
              </div>

              {/* Section: Thời hạn sử dụng */}
              <div className="w-full">
                <label className="font-['Inter',sans-serif] font-semibold text-[13px] leading-[18px] tracking-[0.13px] text-[#334155] mb-[6px] block">
                  Thời hạn sử dụng
                </label>
                <div className="flex flex-col items-start gap-[6px] w-[309px] self-stretch">
                  {/* 30 ngày */}
                  <div
                    onClick={() => handleSelectDays(30)}
                    className={`flex flex-row justify-between items-center p-[12px_14px] w-[309px] rounded-[12px] cursor-pointer transition-all duration-150 box-border ${
                      days === 30 && !customDaysInput
                        ? "bg-[#EFF6FF] border-2 border-[#2563EB] shadow-sm"
                        : "bg-[#F8FAFC] border border-[#E2E8F0] shadow-sm hover:border-[#CBD5E1] hover:bg-[#F1F5F9]"
                    }`}
                  >
                    <div className="flex flex-row items-center gap-[8px]">
                      <div
                        className={
                          days === 30 && !customDaysInput
                            ? "w-[20px] h-[20px] bg-[#2563EB] shadow-[0_0_10px_rgba(37,99,235,0.35)] rounded-full flex items-center justify-center shrink-0 after:content-[''] after:w-[8px] after:h-[8px] after:bg-white after:rounded-full"
                            : "w-[20px] h-[20px] bg-[#E2E8F0] border border-[#CBD5E1] rounded-full shrink-0"
                        }
                      />
                      <span className="font-['Inter',sans-serif] font-semibold text-[14px] leading-[22px] text-[#0B1C30]">
                        30 ngày
                      </span>
                    </div>
                    <span className="px-[8px] py-[2px] bg-[#DBEAFE]/70 border border-[#BFDBFE] rounded-[4px] font-['Inter',sans-serif] font-bold text-[12px] leading-[16px] tracking-[0.24px] text-[#2563EB]">
                      Khuyên dùng
                    </span>
                  </div>

                  {/* 90 ngày */}
                  <div
                    onClick={() => handleSelectDays(90)}
                    className={`flex flex-row justify-between items-center p-[12px_14px] w-[309px] rounded-[12px] cursor-pointer transition-all duration-150 box-border ${
                      days === 90 && !customDaysInput
                        ? "bg-[#EFF6FF] border-2 border-[#2563EB] shadow-sm"
                        : "bg-[#F8FAFC] border border-[#E2E8F0] shadow-sm hover:border-[#CBD5E1] hover:bg-[#F1F5F9]"
                    }`}
                  >
                    <div className="flex flex-row items-center gap-[8px]">
                      <div
                        className={
                          days === 90 && !customDaysInput
                            ? "w-[20px] h-[20px] bg-[#2563EB] shadow-[0_0_10px_rgba(37,99,235,0.35)] rounded-full flex items-center justify-center shrink-0 after:content-[''] after:w-[8px] after:h-[8px] after:bg-white after:rounded-full"
                            : "w-[20px] h-[20px] bg-[#E2E8F0] border border-[#CBD5E1] rounded-full shrink-0"
                        }
                      />
                      <span className="font-['Inter',sans-serif] font-semibold text-[14px] leading-[22px] text-[#0B1C30]">
                        90 ngày
                      </span>
                    </div>
                    <span className="font-['Inter',sans-serif] font-medium text-[11px] leading-[16px] tracking-[0.55px] text-[#64748B]">
                      Gói quý
                    </span>
                  </div>

                  {/* 365 ngày */}
                  <div
                    onClick={() => handleSelectDays(365)}
                    className={`flex flex-row justify-between items-center p-[12px_14px] w-[309px] rounded-[12px] cursor-pointer transition-all duration-150 box-border ${
                      days === 365 && !customDaysInput
                        ? "bg-[#EFF6FF] border-2 border-[#2563EB] shadow-sm"
                        : "bg-[#F8FAFC] border border-[#E2E8F0] shadow-sm hover:border-[#CBD5E1] hover:bg-[#F1F5F9]"
                    }`}
                  >
                    <div className="flex flex-row items-center gap-[8px]">
                      <div
                        className={
                          days === 365 && !customDaysInput
                            ? "w-[20px] h-[20px] bg-[#2563EB] shadow-[0_0_10px_rgba(37,99,235,0.35)] rounded-full flex items-center justify-center shrink-0 after:content-[''] after:w-[8px] after:h-[8px] after:bg-white after:rounded-full"
                            : "w-[20px] h-[20px] bg-[#E2E8F0] border border-[#CBD5E1] rounded-full shrink-0"
                        }
                      />
                      <span className="font-['Inter',sans-serif] font-semibold text-[14px] leading-[22px] text-[#0B1C30]">
                        365 ngày
                      </span>
                    </div>
                    <span className="px-[8px] py-[2px] bg-[#ECFDF5] border border-[#A7F3D0] rounded-[4px] font-['Inter',sans-serif] font-semibold text-[11px] leading-[16px] tracking-[0.55px] text-[#059669]">
                      Tiết kiệm 25%
                    </span>
                  </div>
                </div>
              </div>

              {/* Custom time */}
              <div className="w-full">
                <label className="font-['Inter',sans-serif] font-semibold text-[13px] leading-[18px] tracking-[0.13px] text-[#334155] mb-[6px] block">
                  Nhập thời gian
                </label>
                <div className="w-[309px] h-[42px] px-[16px] bg-[#F8FAFC] border border-[#E2E8F0] rounded-[12px] shadow-[inset_0px_2px_4px_1px_rgba(0,0,0,0.05)] focus-within:border-[#2563EB] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#2563EB]/15 flex flex-row items-center relative transition-all duration-150 box-border">
                  <input
                    type="number"
                    value={customDaysInput}
                    onChange={(e) => handleCustomDaysChange(e.target.value)}
                    placeholder={isExtend ? "Nhập số ngày (VD: 30 hoặc -10 để trừ)" : "Nhập số ngày sử dụng"}
                    className="flex-1 h-full bg-transparent border-none outline-none font-['Inter',sans-serif] font-medium text-[12px] leading-[16px] tracking-[0.24px] text-[#0B1C30] p-0 min-w-0 placeholder:text-[#0B1C30]/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="font-['Inter',sans-serif] font-medium text-[12px] leading-[16px] tracking-[0.24px] text-[#0B1C30] ml-[8px] select-none pointer-events-none shrink-0">
                    Ngày
                  </span>
                </div>
              </div>

              {/* Expected Expiry Date */}
              <div className="w-full">
                <div className="flex flex-row justify-between items-center w-[309px] mb-[4px]">
                  <label className="font-['Inter',sans-serif] font-semibold text-[13px] leading-[18px] tracking-[0.13px] text-[#334155] mb-0">
                    Ngày hết hạn dự kiến
                  </label>
                  <span className="font-['Inter',sans-serif] font-semibold text-[11px] leading-[16px] text-center tracking-[0.55px] text-[#2563EB]">
                    Tự động tính
                  </span>
                </div>
                <div
                  className="w-[309px] h-[42px] px-[16px] bg-[#F8FAFC] hover:border-[#93C5FD] border border-[#E2E8F0] rounded-[12px] shadow-[inset_0px_2px_4px_1px_rgba(0,0,0,0.05)] flex flex-row items-center relative cursor-pointer transition-all duration-150 box-border"
                  onClick={() => datePickerRef.current?.showPicker ? datePickerRef.current.showPicker() : datePickerRef.current?.focus()}
                >
                  <input
                    type="text"
                    readOnly
                    value={calcExpiryDate()}
                    className="flex-1 h-full bg-transparent border-none outline-none font-['Inter',sans-serif] font-medium text-[12px] leading-[16px] tracking-[0.24px] text-[#0B1C30] p-0 cursor-pointer"
                  />
                  <button
                    type="button"
                    className="absolute w-[32px] h-[32px] right-[5px] top-[5px] bg-white hover:bg-[#F8FAFC] border border-[#E2E8F0] hover:border-[#BFDBFE] shadow-sm rounded-[8px] flex items-center justify-center text-[#475569] hover:text-[#2563EB] cursor-pointer transition-all duration-150 box-border"
                    onClick={(e) => {
                      e.stopPropagation();
                      datePickerRef.current?.showPicker ? datePickerRef.current.showPicker() : datePickerRef.current?.focus();
                    }}
                    title="Chọn ngày"
                  >
                    <Calendar className="w-3.5 h-3.5" />
                  </button>
                  <input
                    ref={datePickerRef}
                    type="date"
                    onChange={handleDatePickerChange}
                    className="sr-only absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                  />
                </div>
              </div>

              {error && (
                <div className="w-[309px] p-[8px_12px] mt-[6px] bg-[#FEF2F2] border border-[#FECACA] rounded-[8px] text-[#DC2626] text-[11px] box-border">
                  {error}
                </div>
              )}
            </div>

            {/* Bottom Actions */}
            <div className="w-[309px] pt-[16px] border-t border-[#E2E8F0] flex flex-row items-center gap-[8px] relative z-10 box-border">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={loadingApprove || loadingReject}
                className="w-[169px] h-[50px] p-[12px_16px] gap-[6px] bg-[#2563EB] hover:bg-[#1D4ED8] active:scale-98 disabled:opacity-60 disabled:cursor-not-allowed shadow-[0px_4px_6px_-1px_rgba(59,130,246,0.25),0px_2px_4px_-2px_rgba(59,130,246,0.25)] rounded-[12px] border-none font-['Plus_Jakarta_Sans',sans-serif] font-bold text-[18px] leading-[26px] text-white flex items-center justify-center cursor-pointer transition-all duration-150 whitespace-nowrap box-border"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {loadingApprove
                    ? isExtend
                      ? days < 0
                        ? "Đang trừ ngày..."
                        : "Đang gia hạn..."
                      : isRejected
                      ? "Đang duyệt lại..."
                      : "Đang duyệt..."
                    : isExtend
                    ? days < 0
                      ? "Trừ ngày"
                      : "Gia hạn"
                    : isRejected
                    ? "Phê duyệt lại"
                    : "Duyệt"}
                </span>
              </button>

              {isExtend || isRejected ? (
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loadingApprove}
                  className="w-[130px] h-[50px] p-[6px_16px] gap-[4px] bg-[#FEF2F2] hover:bg-[#FEE2E2] active:scale-98 disabled:opacity-60 disabled:cursor-not-allowed border border-[#FECACA] shadow-sm rounded-[12px] font-['Plus_Jakarta_Sans',sans-serif] font-semibold text-[18px] leading-[26px] text-[#DC2626] flex items-center justify-center cursor-pointer transition-all duration-150 whitespace-nowrap box-border"
                >
                  <X className="w-4 h-4" />
                  <span>Hủy</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={loadingApprove || loadingReject}
                  className="w-[130px] h-[50px] p-[6px_16px] gap-[4px] bg-[#FEF2F2] hover:bg-[#FEE2E2] active:scale-98 disabled:opacity-60 disabled:cursor-not-allowed border border-[#FECACA] shadow-sm rounded-[12px] font-['Plus_Jakarta_Sans',sans-serif] font-semibold text-[18px] leading-[26px] text-[#DC2626] flex items-center justify-center cursor-pointer transition-all duration-150 whitespace-nowrap box-border"
                >
                  <XCircle className="w-4 h-4" />
                  <span>{loadingReject ? "Đang xử lý..." : "Từ chối"}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
