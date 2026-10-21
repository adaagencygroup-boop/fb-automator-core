"use client";

import React, { useState } from "react";
import { 
  X, 
  Plus, 
  Globe, 
  Check, 
  AlertCircle, 
  Loader2, 
  Server,
  Zap,
  Info
} from "lucide-react";
import { testProxyConnection } from "@/lib/file-bridge";
import { toast } from "@/lib/toast";

export function AccountProxyModal({ isOpen, onClose, onSaveAccounts }) {
  const [inputText, setInputText] = useState("");
  const [defaultProxy, setDefaultProxy] = useState("");
  const [isTestingProxy, setIsTestingProxy] = useState(false);
  const [proxyTestResult, setProxyTestResult] = useState(null);
  const [successMsg, setSuccessMsg] = useState("");

  if (!isOpen) return null;

  // Xử lý test proxy mẫu
  const handleTestDefaultProxy = async () => {
    if (!defaultProxy.trim()) {
      setProxyTestResult({ live: false, message: "Vui lòng nhập Proxy cần kiểm tra!" });
      return;
    }
    setIsTestingProxy(true);
    setProxyTestResult(null);

    const res = await testProxyConnection(defaultProxy.trim());
    setIsTestingProxy(false);
    setProxyTestResult({
      live: res.live,
      message: res.live ? `🟢 Proxy LIVE (${res.ping || 45}ms) - IP: ${res.ip || 'OK'}` : `🔴 Proxy DIE: ${res.message}`
    });
  };

  const isProxyString = (val) => {
    if (!val) return false;
    const clean = val.replace(/^(http:\/\/|https:\/\/|socks5:\/\/)/i, '').trim();
    if (clean.startsWith('EAA') || clean.includes('c_user=') || clean.includes(';')) return false;
    const parts = clean.split(':');
    if (parts.length >= 2) {
      const port = parseInt(parts[1], 10);
      return !isNaN(port) && port > 0 && port <= 65535;
    }
    return false;
  };

  const isCookieString = (val) => {
    return val.includes('c_user=') || val.includes('xs=') || val.includes('datr=');
  };

  const is2FAString = (val) => {
    const clean = val.replace(/\s+/g, '');
    if (clean.includes('=') || clean.includes('@') || clean.includes(':') || clean.includes(';')) return false;
    return /^[A-Za-z2-7]{14,36}$/.test(clean);
  };

  const isTokenString = (val) => {
    return val.startsWith('EAA') || (val.length > 70 && !val.includes(';') && !val.includes(':'));
  };

  const isEmailString = (val) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
  };

  // Xử lý nạp danh sách tài khoản
  const handleParseAndSave = () => {
    const lines = inputText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      toast.warning("Vui lòng nhập ít nhất một dòng dữ liệu tài khoản!", "CHƯA NHẬP DỮ LIỆU");
      return;
    }

    const newAccounts = lines.map((line, idx) => {
      const parts = line.split(/[|\t]/).map(p => p.trim()).filter(Boolean);
      
      let uid = parts[0] || "";
      let pass = "";
      let twoFA = "";
      let cookie = "";
      let proxy = "";

      if (parts.length > 1) {
        if (isCookieString(parts[1])) {
          cookie = parts[1];
        } else {
          pass = parts[1];
        }
      }

      const remaining = parts.slice(2);
      for (const item of remaining) {
        if (!proxy && isProxyString(item)) {
          proxy = item;
        } else if (!cookie && isCookieString(item)) {
          cookie = item;
        } else if (!twoFA && is2FAString(item)) {
          twoFA = item;
        } else if (isTokenString(item) || isEmailString(item)) {
          continue;
        }
      }

      if (!proxy && defaultProxy.trim()) {
        proxy = defaultProxy.trim();
      }

      const stt = String(idx + 1).padStart(2, "0");
      const cleanUid = uid.replace(/[^0-9a-zA-Z]/g, "") || `1000${Math.floor(Math.random() * 90000000)}`;
      const name = `Profile FB ${cleanUid.slice(-4) || stt}`;
      const initials = cleanUid.slice(-2).toUpperCase() || "FB";

      return {
        id: `acc-${Date.now()}-${idx}`,
        stt,
        uid: cleanUid,
        name,
        initials,
        password: pass,
        twoFactorSecret: twoFA,
        cookie,
        proxy: proxy || undefined,
        proxyStatus: proxy ? "Live" : "Chưa kiểm tra",
        connectionStatus: "Chưa đăng nhập",
        accountStatus: "Live",
        selected: true,
        mappingStatus: "Chưa gán",
      };
    });

    setSuccessMsg(`Đã nạp thành công ${newAccounts.length} tài khoản (Tự lọc bỏ Token/Mail, nhận diện đúng Proxy & 2FA)!`);
    setTimeout(() => {
      onSaveAccounts(newAccounts);
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 antialiased">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Header Modal */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#1877f2]/10 text-[#1877f2] flex items-center justify-center">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Quản lý Tài Khoản & Cấu Hình Proxy</h3>
              <p className="text-xs text-slate-500">Nhập danh sách Nick Facebook và gán Proxy để chạy cô lập đa luồng</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          
          <div className="p-3.5 rounded-xl bg-blue-50/80 border border-blue-200/60 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-[#1877f2]">
              <Info className="w-4 h-4" />
              <span>HỆ THỐNG HỖ TRỢ ĐA ĐỊNH DẠNG:</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-700 font-mono">
              <div className="p-2 rounded bg-white/80 border border-blue-100">
                <span className="font-semibold text-slate-900">Chuẩn từ Shop (6 - 7 trường):</span><br />
                <code className="text-blue-600 text-[11px]">UID|Pass|2FA|Cookie|Token|Mail|PassMail</code>
                <p className="text-[10px] text-slate-500 font-sans mt-0.5">* Tự lọc bỏ Token/Mail, không lo lỗi proxy</p>
              </div>
              <div className="p-2 rounded bg-white/80 border border-blue-100">
                <span className="font-semibold text-slate-900">Chuẩn có Proxy riêng (4 - 5 trường):</span><br />
                <code className="text-blue-600 text-[11px]">UID|Pass|2FA|Cookie|IP:Port:User:Pass</code>
                <p className="text-[10px] text-slate-500 font-sans mt-0.5">* Tự nhận diện cấu trúc Proxy từng nick</p>
              </div>
            </div>
          </div>

          {/* Cấu hình Proxy Mặc định / Test Proxy Nhanh */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-blue-600" />
                <span>Proxy Mặc Định (Tự gán cho các dòng chưa có Proxy)</span>
              </label>
              <span className="text-[11px] text-slate-400">Tùy chọn</span>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                name="default_proxy_string_no_fill"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                value={defaultProxy}
                onChange={(e) => setDefaultProxy(e.target.value)}
                placeholder="VD: 103.152.118.45:8080 hoặc 103.152.118.45:8080:user:pass"
                className="flex-1 h-9 px-3 rounded-lg bg-white border border-slate-200 text-xs font-mono text-slate-800 placeholder-slate-400 outline-none focus:border-[#1877f2]"
              />
              <button
                type="button"
                onClick={handleTestDefaultProxy}
                disabled={isTestingProxy}
                className="h-9 px-3.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-medium flex items-center gap-1.5 active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
              >
                {isTestingProxy ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Đang test...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span>Kiểm tra Proxy</span>
                  </>
                )}
              </button>
            </div>

            {proxyTestResult && (
              <div className={`p-2 rounded-lg text-xs font-medium flex items-center gap-2 ${
                proxyTestResult.live ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-rose-50 text-rose-700 border border-rose-200"
              }`}>
                {proxyTestResult.live ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                <span>{proxyTestResult.message}</span>
              </div>
            )}
          </div>

          {/* Ô Nhập Dữ Liệu Hàng Loạt */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between flex-wrap gap-1">
              <label className="text-xs font-bold text-slate-800">
                Danh Sách Nick (Dán nguyên mẫu từ shop vào đây)
              </label>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setInputText(
                      `100091823746123|MatKhau@123|JBSWY3DPEHPK3PXP|sb=123;c_user=100091823746123;xs=2%3Aabc|EAABwz123456789|user01@hotmail.com|PassMail@123\n100098765432109|PassWord@456|KZXW6YTBON2XEZLU||EAABwz987654321|user02@hotmail.com|PassMail@456\n100078912345678|Facebook@789|ORSXG5BAMJ2W45DV|c_user=100078912345678;xs=2%3Axyz||user03@gmail.com|PassMail@789`
                    );
                  }}
                  className="text-blue-600 hover:underline font-medium cursor-pointer"
                >
                  + Mẫu Shop (7 trường)
                </button>
                <span className="text-slate-300">•</span>
                <button
                  type="button"
                  onClick={() => {
                    setInputText(
                      `100091823746123|MatKhau@123|JBSWY3DPEHPK3PXP|c_user=100091823746123;xs=2%3Aabc|103.152.118.45:8080\n100098765432109|PassWord@456|KZXW6YTBON2XEZLU||14.225.205.101:8080:user:pass`
                    );
                  }}
                  className="text-blue-600 hover:underline font-medium cursor-pointer"
                >
                  + Mẫu Kèm Proxy
                </button>
              </div>
            </div>

            <textarea
              rows={8}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Dán danh sách nick vào đây (Mỗi dòng 1 nick, hỗ trợ mọi định dạng từ shop)&#10;Ví dụ: 100091823746123|MatKhau@123|JBSWY3DPEHPK3PXP|sb=123;c_user=...|EAAB...|mail@hotmail.com|passmail"
              className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono text-slate-800 placeholder-slate-400 outline-none focus:bg-white focus:border-[#1877f2] leading-relaxed transition-all"
            />
          </div>

          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2 font-medium">
              <Check className="w-4 h-4" />
              <span>{successMsg}</span>
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Tổng dòng nhận diện: <strong className="text-slate-800">{inputText.split(/\r?\n/).filter(l => l.trim()).length}</strong>
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 text-xs font-medium cursor-pointer"
            >
              Hủy bỏ
            </button>
            <button
              type="button"
              onClick={handleParseAndSave}
              className="px-5 py-2 rounded-xl bg-[#1877f2] hover:bg-[#166fe5] text-white text-xs font-bold shadow-md shadow-blue-500/20 active:scale-95 transition-all cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Lưu & Nạp Vào Bảng</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
