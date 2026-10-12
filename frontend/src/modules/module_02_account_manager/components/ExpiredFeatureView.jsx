"use client";

import React, { useState, useEffect } from "react";
import {
  Clock,
  RefreshCw,
  Copy,
  Check,
  ExternalLink,
  MessageCircle,
  Send,
  User as UserIcon,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";

export default function ExpiredFeatureView({
  featureName = "Tính năng này",
  onRenewed,
}) {
  const toast = useToast();
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [copiedTele, setCopiedTele] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const zaloPhone = "0988.888.247";
  const rawZaloPhone = "0988888247";
  const telegramHandle = "@admin_support";

  const handleCopyPhone = () => {
    navigator.clipboard.writeText(rawZaloPhone);
    setCopiedPhone(true);
    toast.success("Đã sao chép số Zalo CSKH: " + zaloPhone, "SAO CHÉP THÀNH CÔNG");
    setTimeout(() => setCopiedPhone(false), 2000);
  };

  const handleCopyTele = () => {
    navigator.clipboard.writeText(telegramHandle);
    setCopiedTele(true);
    toast.success("Đã sao chép Telegram CSKH: " + telegramHandle, "SAO CHÉP THÀNH CÔNG");
    setTimeout(() => setCopiedTele(false), 2000);
  };

  const handleManualRefresh = async () => {
    setRefreshing(true);
    setTimeout(() => {
      setRefreshing(false);
      if (typeof window !== "undefined") {
        const status = localStorage.getItem("user_status");
        if (status !== "expired") {
          toast.success("Tài khoản của bạn đã sẵn sàng sử dụng!", "ĐÃ MỞ KHÓA");
          if (onRenewed) onRenewed();
        } else {
          toast.warning("Tài khoản vẫn chưa được gia hạn. Vui lòng liên hệ Admin.", "CHƯA GIA HẠN");
        }
      }
    }, 600);
  };

  return (
    <div className="w-full flex flex-col items-center justify-center py-10 px-4 select-none">
      <div className="w-full max-w-xl flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center shadow-sm">
          <Clock className="w-8 h-8 text-amber-600" />
        </div>

        <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-xs font-bold text-amber-700">
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="uppercase tracking-wider">BẢN QUYỀN CẦN GIA HẠN</span>
        </div>

        <h1 className="font-bold text-2xl text-slate-900 tracking-tight mt-3">
          Tạm khóa {featureName}
        </h1>

        <p className="text-slate-500 text-xs sm:text-sm leading-relaxed max-w-md mt-2">
          Thời hạn sử dụng của tính năng này đã tạm hết. Vui lòng liên hệ Quản trị viên để gia hạn.
        </p>

        {/* Support Cards */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-6">
          <div className="p-4 rounded-xl bg-white border border-border text-left shadow-subtle flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center text-primary">
                    <MessageCircle className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold text-slate-800">Zalo CSKH</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-primary font-semibold">
                  Hỗ trợ nhanh
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-2">Hotline Zalo chính thức:</p>
              <p className="text-sm font-bold text-slate-900 mt-1 font-mono">{zaloPhone}</p>
            </div>

            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={handleCopyPhone}
                className="flex-1 py-1.5 px-2 rounded-md bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 transition flex items-center justify-center gap-1 border border-border cursor-pointer"
              >
                {copiedPhone ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedPhone ? "Đã chép" : "Sao chép"}</span>
              </button>
              <a
                href={`https://zalo.me/${rawZaloPhone}`}
                target="_blank"
                rel="noreferrer"
                className="py-1.5 px-3 rounded-md bg-primary hover:bg-primary-hover text-xs font-bold text-white transition flex items-center justify-center gap-1 shadow-sm"
              >
                <span>Mở Zalo</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-white border border-border text-left shadow-subtle flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-sky-50 flex items-center justify-center text-sky-600">
                    <Send className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold text-slate-800">Telegram</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-sky-50 text-sky-600 font-semibold">
                  24/7
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-2">Tiếp nhận qua Telegram:</p>
              <p className="text-sm font-bold text-slate-900 mt-1 font-mono">{telegramHandle}</p>
            </div>

            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={handleCopyTele}
                className="flex-1 py-1.5 px-2 rounded-md bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 transition flex items-center justify-center gap-1 border border-border cursor-pointer"
              >
                {copiedTele ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedTele ? "Đã chép" : "Sao chép"}</span>
              </button>
              <a
                href={`https://t.me/${telegramHandle.replace("@", "")}`}
                target="_blank"
                rel="noreferrer"
                className="py-1.5 px-3 rounded-md bg-sky-500 hover:bg-sky-600 text-xs font-bold text-white transition flex items-center justify-center gap-1 shadow-sm"
              >
                <span>Telegram</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="h-9 px-5 rounded-md bg-primary hover:bg-primary-hover text-white text-xs font-semibold flex items-center gap-2 shadow-sm transition active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span>Kiểm tra lại trạng thái bản quyền</span>
          </button>
        </div>
      </div>
    </div>
  );
}
