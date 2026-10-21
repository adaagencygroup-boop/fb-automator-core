"use client";

import React from "react";
import {
  User,
  Eye,
  EyeOff,
  Cpu,
  Copy,
  Check,
  AlertCircle,
  Loader2,
  Phone,
} from "lucide-react";



export function RegisterForm({
  username,
  setUsername,
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  contactInfo,
  setContactInfo,
  hwid,
  hwidLoading = false,
  showPassword,
  setShowPassword,
  showConfirmPassword,
  setShowConfirmPassword,
  agreed,
  setAgreed,
  copied,
  onCopyHwid,
  loading,
  fieldErrors,
  clearFieldError,
  onSubmit,
  onLogin,
}) {
  return (
    <section className="auth-entry-form">
      <div className="auth-form-content flex flex-col gap-[18px] w-full">
        {/* Card Header */}
        <div className="flex flex-col gap-1.5">
          <h2 className="auth-form-title">
            Đăng ký tài khoản mới
          </h2>
          <p className="auth-form-description">
            Vui lòng điền thông tin bên dưới để thiết lập quyền truy cập phần
            mềm
          </p>
        </div>

        {/* Registration Form */}
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {/* Field: Username */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="register-username" className="text-[#475569] text-xs font-medium px-1">
              Tên đăng nhập <span className="text-red-500">*</span>
            </label>
            <div
              className={`h-11 px-3.5 rounded-lg bg-[#eff3ff] border flex items-center justify-between transition-all ${
                fieldErrors.username
                  ? "border-red-500 bg-red-50 focus-within:border-red-400 shadow-sm"
                  : "border-[#e6ecfa] focus-within:border-[#245ff4]"
              }`}
            >
              <input
                type="text"
                id="register-username"
                name="username"
                autoComplete="username"
                aria-invalid={Boolean(fieldErrors.username)}
                aria-describedby={fieldErrors.username ? "register-username-error" : undefined}
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value.replace(/\s+/g, ""));
                }}
                onKeyDown={(e) => {
                  if (e.key === " " || e.code === "Space") {
                    e.preventDefault();
                  }
                }}
                placeholder="username123"
                className="w-full min-w-0 bg-transparent text-sm text-slate-900 placeholder-[#7c8599] outline-none"
              />
              <User
                className={`w-5 h-5 flex-shrink-0 ml-3 transition-colors ${
                  fieldErrors.username ? "text-red-500" : "text-[#7c8599]"
                }`}
              />
            </div>
            {fieldErrors.username && (
              <span id="register-username-error" className="text-red-500 text-[11px] px-2 flex items-center gap-1 mt-0.5 animate-fadeIn">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {fieldErrors.username}
              </span>
            )}
          </div>

          {/* Row: Password & Confirm Password */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Account Password */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="register-password" className="text-[#475569] text-xs font-medium px-1">
                Mật khẩu <span className="text-red-500">*</span>
              </label>
              <div
                className={`h-11 px-3.5 rounded-lg bg-[#eff3ff] border flex items-center justify-between transition-all ${
                  fieldErrors.password
                    ? "border-red-500 bg-red-50 focus-within:border-red-400 shadow-sm"
                    : "border-[#e6ecfa] focus-within:border-[#245ff4]"
                }`}
              >
                <input
                  type={showPassword ? "text" : "password"}
                  id="register-password"
                name="password"
                autoComplete="new-password"
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={fieldErrors.password ? "register-password-error" : undefined}
                value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                  }}
                  placeholder="Nhập mật khẩu"
                  className="w-full min-w-0 bg-transparent text-sm text-slate-900 placeholder-[#7c8599] outline-none"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-[#7c8599] hover:text-slate-900 transition-colors ml-2 flex items-center cursor-pointer"
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
              {fieldErrors.password && (
                <span id="register-password-error" className="text-red-500 text-[11px] px-2 flex items-center gap-1 mt-0.5 animate-fadeIn">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  {fieldErrors.password}
                </span>
              )}
            </div>

            {/* Confirm Password */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="register-confirmPassword" className="text-[#475569] text-xs font-medium px-1">
                Xác nhận mật khẩu <span className="text-red-500">*</span>
              </label>
              <div
                className={`h-11 px-3.5 rounded-lg bg-[#eff3ff] border flex items-center justify-between transition-all ${
                  fieldErrors.confirmPassword
                    ? "border-red-500 bg-red-50 focus-within:border-red-400 shadow-sm"
                    : "border-[#e6ecfa] focus-within:border-[#245ff4]"
                }`}
              >
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  id="register-confirmPassword"
                name="confirmPassword"
                autoComplete="new-password"
                aria-invalid={Boolean(fieldErrors.confirmPassword)}
                aria-describedby={fieldErrors.confirmPassword ? "register-confirmPassword-error" : undefined}
                value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                  }}
                  placeholder="Xác nhận lại mật khẩu"
                  className="w-full min-w-0 bg-transparent text-sm text-slate-900 placeholder-[#7c8599] outline-none"
                />
                <button
                  type="button"
                  aria-label={showConfirmPassword ? "Ẩn mật khẩu xác nhận" : "Hiện mật khẩu xác nhận"}
                  onClick={() =>
                    setShowConfirmPassword(!showConfirmPassword)
                  }
                  className="text-[#7c8599] hover:text-slate-900 transition-colors ml-2 flex items-center cursor-pointer"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
              {fieldErrors.confirmPassword && (
                <span id="register-confirmPassword-error" className="text-red-500 text-[11px] px-2 flex items-center gap-1 mt-0.5 animate-fadeIn">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  {fieldErrors.confirmPassword}
                </span>
              )}
            </div>
          </div>

          {/* Field: Contact Info */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="register-contactInfo" className="text-[#475569] text-xs font-medium px-1">
              Thông tin liên hệ (Số điện thoại) <span className="text-red-500">*</span>
            </label>
            <div
              className={`h-11 px-3.5 rounded-lg bg-[#eff3ff] border flex items-center justify-between transition-all ${
                fieldErrors.contactInfo
                  ? "border-red-500 bg-red-50 focus-within:border-red-400 shadow-sm"
                  : "border-[#e6ecfa] focus-within:border-[#245ff4]"
              }`}
            >
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={10}
                id="register-contactInfo"
                name="contactInfo"
                autoComplete="tel"
                aria-invalid={Boolean(fieldErrors.contactInfo)}
                aria-describedby={fieldErrors.contactInfo ? "register-contactInfo-error" : undefined}
                value={contactInfo}
                onChange={(e) => {
                  setContactInfo(e.target.value.replace(/\D/g, "").slice(0, 10));
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "Backspace" ||
                    e.key === "Tab" ||
                    e.key === "Delete" ||
                    e.key === "ArrowLeft" ||
                    e.key === "ArrowRight" ||
                    e.key === "ArrowUp" ||
                    e.key === "ArrowDown" ||
                    e.key === "Home" ||
                    e.key === "End" ||
                    e.key === "Enter" ||
                    e.ctrlKey ||
                    e.metaKey
                  ) {
                    return;
                  }
                  if (!/[0-9]/.test(e.key)) {
                    e.preventDefault();
                  }
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  const pasted = e.clipboardData.getData("text");
                  const clean = pasted.replace(/\D/g, "");
                  setContactInfo(clean.slice(0, 10));
                }}
                placeholder="0987654321"
                className="w-full min-w-0 bg-transparent text-sm text-slate-900 placeholder-[#7c8599] outline-none font-mono"
              />
              <Phone
                className={`w-5 h-5 flex-shrink-0 ml-3 transition-colors ${
                  fieldErrors.contactInfo ? "text-red-500" : "text-[#7c8599]"
                }`}
              />
            </div>
            {fieldErrors.contactInfo && (
              <span id="register-contactInfo-error" className="text-red-500 text-[11px] px-2 flex items-center gap-1 mt-0.5 animate-fadeIn">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {fieldErrors.contactInfo}
              </span>
            )}
          </div>

          {/* Machine HWID (Auto Collected) */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between px-1 gap-2 flex-wrap sm:flex-nowrap">
              <label className="text-[#475569] text-xs font-medium">
                HWID (mã máy tự động thu thập)
              </label>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {hwid ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-[#0284c7]"></span>
                    <span className="text-[#0284c7] font-mono text-[11px] tracking-wider">
                      Đã kết nối phần cứng
                    </span>
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                    <span className="text-amber-600 font-mono text-[11px] tracking-wider animate-pulse">
                      Đang kết nối phần cứng...
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="h-11 px-3.5 rounded-lg bg-[#eff3ff] border border-[#e6ecfa] flex items-center justify-between">
              <div className="flex items-center gap-3 overflow-hidden mr-2">
                <Cpu className="w-5 h-5 text-[#7c8599] flex-shrink-0" />
                {hwid ? (
                  <span className="font-mono text-xs sm:text-[13px] text-[#1e293b] tracking-wide truncate select-all">
                    {hwid}
                  </span>
                ) : (
                  <div className="flex items-center gap-2 text-slate-500 text-xs italic">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#2563eb]" />
                    <span>Đang nhận diện mã máy (HWID)...</span>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={onCopyHwid}
                disabled={!hwid}
                title={hwid ? "Sao chép HWID" : "Đang chờ nhận diện HWID"}
                className={`p-1 flex items-center gap-1.5 text-xs font-medium transition-colors flex-shrink-0 ${
                  hwid
                    ? "text-[#7c8599] hover:text-[#245ff4] cursor-pointer"
                    : "text-slate-600 cursor-not-allowed opacity-50"
                }`}
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span className="text-emerald-600 text-xs">Đã chép</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span className="text-xs">Sao chép</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Policy Agreement Checkbox */}
          <div className="flex flex-col gap-1 pt-0.5">
            <div className="flex items-start sm:items-center gap-2.5">
              <input
                id="policy-checkbox"
                type="checkbox"
                checked={agreed}
                onChange={(e) => {
                  setAgreed(e.target.checked);
                }}
                className="w-4 h-4 mt-0.5 sm:mt-0 rounded-[4px] accent-[#245ff4] bg-[#eff3ff] border-[#e6ecfa] cursor-pointer flex-shrink-0"
              />
              <label
                htmlFor="policy-checkbox"
                className="text-xs font-medium text-[#475569] tracking-wide cursor-pointer select-none leading-tight"
              >
                Tôi đồng ý với{" "}
                <span className="text-[#245ff4] hover:underline">
                  Điều khoản dịch vụ
                </span>{" "}
                và bảo mật HWID
              </label>
            </div>
            {fieldErrors.agreed && (
              <span className="text-red-500 text-[11px] px-2 flex items-center gap-1 mt-0.5 animate-fadeIn">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {fieldErrors.agreed}
              </span>
            )}
          </div>

          {/* Submit Button (Vibrant Glowing Pill Button) */}
          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 mt-1 rounded-lg bg-[#245ff4] text-white font-bold text-sm tracking-wide shadow-sm hover:brightness-110 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>Đang xử lý đăng ký...</span>
              </>
            ) : (
              <span>Tạo tài khoản</span>
            )}
          </button>
        </form>

        {/* Separator & Alternate Entry Option */}
        <div className="pt-1 flex items-center gap-3 w-full">
          
          <div className="font-sans text-xs text-[#475569] text-center flex items-center gap-1">
            <span>Đã có tài khoản?</span>
            <button
              type="button"
              onClick={onLogin}
              className="text-[#245ff4] font-semibold hover:underline ml-0.5"
            >
              Đăng nhập ngay
            </button>
          </div>
          
        </div>
      </div>
    </section>
  );
}
