"use client";

import { useState } from "react";
import { Check, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// Ô nhập, nút dùng chung cho màn Đăng nhập / Đăng ký
// Bố cục theo Figma "Đăng nhập"/"Đăng ký", màu theo theme sáng "Background+Shadow"

export const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/60 focus-visible:ring-offset-0";

const INPUT_BASE =
  "h-[52px] w-full rounded-xl border border-transparent bg-[#EFF4FF] text-[#0B1C30] shadow-[0px_1px_2px_rgba(0,0,0,0.05)] outline-none transition-colors " +
  "placeholder:text-[#737686] focus:border-[#2563EB]/60 focus:bg-white focus:ring-2 focus:ring-[#2563EB]/15 disabled:opacity-60";

/* ------------------------------------------------------------------ */
/* Màn Đăng nhập: ô nhập to, icon bên trái, không có nhãn               */
/* ------------------------------------------------------------------ */

export function LoginInput({ icon: Icon, password = false, label, className, ...props }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        aria-label={label}
        type={password && !visible ? "password" : props.type || "text"}
        className={cn(
          INPUT_BASE,
          "pl-12 text-sm leading-[17px] font-sans",
          password ? "pr-12" : "pr-4",
          className,
        )}
        {...props}
      />
      {Icon && (
        <Icon
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 size-5 text-[#737686]"
          strokeWidth={1.5}
        />
      )}
      {password && (
        <PasswordToggle visible={visible} onToggle={() => setVisible((v) => !v)} className="right-3.5" iconClassName="size-5" />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Màn Đăng ký: nhãn phía trên, icon bên phải                           */
/* ------------------------------------------------------------------ */

export function Field({ label, htmlFor, required, aside, className, children }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-2 px-1">
        <label htmlFor={htmlFor} className="font-heading text-[11px] leading-4 font-semibold text-[#0B1C30]">
          {label}
          {required && <span className="text-[#2563EB]"> *</span>}
        </label>
        {aside}
      </div>
      {children}
    </div>
  );
}

export function RegisterInput({ icon: Icon, password = false, className, ...props }) {
  const [visible, setVisible] = useState(false);
  const hasRight = Icon || password;
  return (
    <div className="relative">
      <input
        type={password && !visible ? "password" : props.type || "text"}
        className={cn(
          INPUT_BASE,
          "pl-4 font-heading text-xs leading-[15px]",
          hasRight ? "pr-10" : "pr-4",
          className,
        )}
        {...props}
      />
      {Icon && !password && (
        <Icon
          aria-hidden="true"
          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 size-3 text-[#737686]"
          strokeWidth={2.25}
        />
      )}
      {password && (
        <PasswordToggle visible={visible} onToggle={() => setVisible((v) => !v)} className="right-3" iconClassName="size-[15px]" />
      )}
    </div>
  );
}

function PasswordToggle({ visible, onToggle, className, iconClassName }) {
  const Icon = visible ? EyeOff : Eye;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
      aria-pressed={visible}
      className={cn(
        "absolute top-1/2 -translate-y-1/2 grid place-items-center size-7 rounded-md text-[#737686] hover:text-[#0B1C30]",
        FOCUS_RING,
        className,
      )}
    >
      <Icon className={iconClassName} strokeWidth={1.75} />
    </button>
  );
}

/** Checkbox vuông màu xanh (18px ở màn đăng nhập, 16px ở màn đăng ký) */
export function Checkbox({ size = 18, className, labelClassName, children, ...props }) {
  return (
    <label className={cn("inline-flex items-center gap-[9px] cursor-pointer select-none", className)}>
      <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
        <input
          type="checkbox"
          className={cn(
            "peer absolute inset-0 m-0 cursor-pointer appearance-none rounded border border-[#C3CCDD] bg-white transition-colors",
            "checked:border-[#2563EB] checked:bg-[#2563EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/50",
            size < 18 && "rounded-[2.5px]",
          )}
          {...props}
        />
        <Check
          aria-hidden="true"
          className="pointer-events-none relative size-3 text-white opacity-0 peer-checked:opacity-100"
          strokeWidth={3.5}
        />
      </span>
      <span className={cn("text-xs leading-4 text-[#565E74]", labelClassName)}>{children}</span>
    </label>
  );
}

/** Nút chính bo tròn, bóng xanh nhẹ */
export const GLOW_BUTTON =
  "bg-[#2563EB] text-white shadow-[0px_4px_14px_-2px_rgba(37,99,235,0.45),0px_1px_2px_rgba(0,0,0,0.05)] " +
  "transition-[background-color,box-shadow] hover:bg-[#1D4ED8] hover:shadow-[0px_6px_18px_-2px_rgba(37,99,235,0.55),0px_1px_2px_rgba(0,0,0,0.05)]";

export function SubmitButton({ loading, children, loadingText = "Đang xử lý..." }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className={cn(
        "flex h-11 w-full items-center justify-center gap-2 rounded-full font-heading text-sm leading-5 font-bold tracking-[0.35px] disabled:cursor-wait disabled:opacity-70",
        GLOW_BUTTON,
        "outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
      )}
    >
      {loading && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
      {loading ? loadingText : children}
    </button>
  );
}

/** Thông báo lỗi / thành công phía trên nút gửi */
export function FormAlert({ error, notice }) {
  if (!error && !notice) return null;
  return (
    <p
      role={error ? "alert" : "status"}
      className={cn(
        "rounded-xl border px-3.5 py-2.5 text-xs leading-4",
        error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700",
      )}
    >
      {error || notice}
    </p>
  );
}

/** "──── Chưa có tài khoản? Đăng ký ngay ────" */
export function SwitchDivider({ question, action, onClick, lineClassName = "bg-[#E2E8F0]", textClassName = "text-[#565E74]" }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className={cn("h-px flex-1", lineClassName)} />
      <p className={cn("flex items-center gap-1 text-xs leading-4", textClassName)}>
        {question}
        <button
          type="button"
          onClick={onClick}
          className={cn("rounded px-0.5 font-semibold text-[#2563EB] hover:text-[#1D4ED8] hover:underline", FOCUS_RING)}
        >
          {action}
        </button>
      </p>
      <span aria-hidden="true" className={cn("h-px flex-1", lineClassName)} />
    </div>
  );
}
