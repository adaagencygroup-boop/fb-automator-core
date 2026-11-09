"use client";

import React from "react";
import {
  User,
  Lock,
  Eye,
  EyeOff,
  Cpu,
  Copy,
  Check,
  AlertCircle,
  Loader2,
} from "lucide-react";



export function LoginForm({
  username,
  setUsername,
  password,
  setPassword,
  showPassword,
  setShowPassword,
  rememberMe,
  setRememberMe,
  hwid,
  hwidLoading = false,
  copied,
  onCopyHwid,
  loading,
  fieldErrors,
  clearFieldError,
  onSubmit,
  onOpenForgotModal,
  onRegister,
}) {
  return (
    <section className="auth-entry-form">
      <div className="auth-form-content flex flex-col gap-[18px] w-full">
        {/* Card Header */}
        <div className="flex flex-col gap-1.5">
          <h2 className="auth-form-title">
            Đăng nhập 123
          </h2>
          <p className="auth-form-description">
            Vui lòng đăng nhập để tiếp tục sử dụng phần mềm
          </p>
        </div>

        {/* Login Form */}
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {/* Field 1: Username */}
          <div className="flex flex-col gap-1">
            <label htmlFor="login-username" className="text-xs font-semibold text-slate-800">Tên đăng nhập <span className="text-red-500">*</span></label>
            <div
              className={`h-11 px-3.5 rounded-lg bg-[#eff3ff] border flex items-center gap-3 transition-all ${
                fieldErrors.username
                  ? "border-red-500 bg-red-50 focus-within:border-red-400 shadow-sm"
                  : "border-[#e6ecfa] focus-within:border-[#245ff4]"
              }`}
            >
              <User
                className={`w-5 h-5 flex-shrink-0 transition-colors ${
                  fieldErrors.username ? "text-red-500" : "text-[#7c8599]"
                }`}
              />
              <input
                type="text"
                name="username"
                id="login-username"
                autoComplete="username"
                aria-label="Tên đăng nhập"
                aria-invalid={Boolean(fieldErrors.username)}
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  clearFieldError("username");
                }}
                placeholder="Nhập tên đăng nhập"
                className="w-full min-w-0 bg-transparent text-sm text-slate-900 placeholder-[#7c8599] outline-none"
              />
            </div>
            {fieldErrors.username && (
              <span className="text-red-500 text-[11px] px-2 flex items-center gap-1 mt-0.5 animate-fadeIn">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {fieldErrors.username}
              </span>
            )}
          </div>

          {/* Field 2: Password */}
          <div className="flex flex-col gap-1">
            <label htmlFor="login-password" className="text-xs font-semibold text-slate-800">Mật khẩu <span className="text-red-500">*</span></label>
            <div
              className={`h-11 px-3.5 rounded-lg bg-[#eff3ff] border flex items-center gap-3 transition-all ${
                fieldErrors.password
                  ? "border-red-500 bg-red-50 focus-within:border-red-400 shadow-sm"
                  : "border-[#e6ecfa] focus-within:border-[#245ff4]"
              }`}
            >
              <Lock
                className={`w-5 h-5 flex-shrink-0 transition-colors ${
                  fieldErrors.password ? "text-red-500" : "text-[#7c8599]"
                }`}
              />
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                id="login-password"
                autoComplete="current-password"
                aria-label="Mật khẩu"
                aria-invalid={Boolean(fieldErrors.password)}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearFieldError("password");
                }}
                placeholder="Nhập mật khẩu"
                className="w-full min-w-0 bg-transparent text-sm text-slate-900 placeholder-[#7c8599] outline-none"
              />
              <button
                type="button"
                aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                onClick={() => setShowPassword(!showPassword)}
                className="text-[#7c8599] hover:text-slate-900 transition-colors ml-1 flex items-center cursor-pointer"
              >
                {showPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
            {fieldErrors.password && (
              <span className="text-red-500 text-[11px] px-2 flex items-center gap-1 mt-0.5 animate-fadeIn">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {fieldErrors.password}
              </span>
            )}
          </div>

          {/* Row: Remember Me & Forgot Password */}
          <div className="flex items-center justify-between text-xs px-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded-[4px] accent-[#245ff4] bg-[#eff3ff] border-[#e6ecfa] cursor-pointer"
              />
              <span className="text-[#475569]">Ghi nhớ đăng nhập</span>
            </label>

            <button
              type="button"
              onClick={onOpenForgotModal}
              className="text-[#245ff4] hover:underline cursor-pointer transition-colors"
            >
              Quên mật khẩu?
            </button>
          </div>

          {/* Field 3: HWID Readonly Info Box */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between px-0.5">
              <div className="flex items-center gap-1.5 text-[#2563eb]">
                <Cpu className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium text-[#475569]">
                  HWID (mã máy tự động thu thập)
                </span>
              </div>
              {hwid ? (
                <div className="flex items-center gap-1.5 text-[#0284c7]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0284c7]"></span>
                  <span className="text-[11px] font-medium">
                    Đã kết nối phần cứng
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-amber-600 animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                  <span className="text-[11px] font-medium">
                    Đang kết nối phần cứng...
                  </span>
                </div>
              )}
            </div>

            <div className="h-10 px-3.5 rounded-xl bg-[#e6eeff] border border-[#dbe5fa]/30 flex items-center justify-between">
              {hwid ? (
                <span className="font-mono text-xs sm:text-[13px] font-semibold tracking-wider text-[#2563eb] truncate mr-2 select-all">
                  {hwid}
                </span>
              ) : (
                <div className="flex items-center gap-2 text-slate-500 text-xs italic">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#2563eb]" />
                  <span>Đang nhận diện mã máy (HWID)...</span>
                </div>
              )}
              <button
                type="button"
                onClick={onCopyHwid}
                disabled={!hwid}
                title={hwid ? "Sao chép HWID" : "Đang chờ nhận diện HWID"}
                className={`flex items-center gap-1.5 text-xs font-medium transition-colors flex-shrink-0 ${
                  hwid
                    ? "text-[#2563eb] hover:text-slate-900 cursor-pointer"
                    : "text-slate-600 cursor-not-allowed opacity-50"
                }`}
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-600 text-xs">Đã chép</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Sao chép</span>
                  </>
                )}
              </button>
            </div>
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
                <span>Đang đăng nhập...</span>
              </>
            ) : (
              <span>Đăng nhập</span>
            )}
          </button>
        </form>

        {/* Separator & Register Navigation Link */}
        <div className="pt-1 flex items-center gap-3 w-full">
          
          <div className="font-sans text-xs text-[#475569] text-center flex items-center gap-1">
            <span>Chưa có tài khoản?</span>
            <button
              type="button"
              onClick={onRegister}
              className="text-[#245ff4] font-semibold hover:underline ml-0.5"
            >
              Đăng ký ngay
            </button>
          </div>
          
        </div>
      </div>
    </section>
  );
}
