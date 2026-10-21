"use client";

import { useSyncExternalStore } from "react";

/**
 * Toast thông báo dùng chung toàn app. Gọi ở bất kỳ đâu (không cần Provider):
 *
 *   import { toast } from "@/lib/toast";
 *   toast.success("Lưu tài khoản thành công", "THÀNH CÔNG");
 *   toast.error({ title: "Đăng nhập thất bại", message: "..." });
 *   toast.warning("Dữ liệu bị trùng lặp", "CẢNH BÁO");
 *   toast.info("Đang kiểm tra dữ liệu...", "THÔNG BÁO");
 *
 * Tùy chọn:
 *  - title, message : tiêu đề (in hoa) + nội dung
 *  - icon           : "check" | "alert" (mặc định) | "calendar" | "info"
 *  - variant        : "success" | "error" | "warning" | "info"
 *  - key            : toast cùng key sẽ thay thế nhau thay vì xếp chồng
 *  - duration       : ms tự tắt (mặc định 6000, 0 = không tự tắt)
 * Hiển thị bởi <Toaster /> trong src/app/layout.js.
 */

const EMPTY = [];
let toasts = EMPTY;
let seq = 0;
const listeners = new Set();
const timers = new Map();

const emit = () => listeners.forEach((fn) => fn());

function dismiss(id) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const next = toasts.filter((t) => t.id !== id);
  if (next.length !== toasts.length) {
    toasts = next.length ? next : EMPTY;
    emit();
  }
}

function schedule(t) {
  clearTimeout(timers.get(t.id));
  if (t.duration > 0) timers.set(t.id, setTimeout(() => dismiss(t.id), t.duration));
}

function show({ key, variant = "error", icon = "alert", title, message, duration = 6000 }) {
  const id = ++seq;
  const item = { id, key, variant, icon, title, message, duration };
  const old = key ? toasts.find((t) => t.key === key) : null;
  if (old) {
    clearTimeout(timers.get(old.id));
    timers.delete(old.id);
  }
  // Mới nhất ở trên cùng, tối đa 5 toast
  toasts = [item, ...toasts.filter((t) => t !== old)].slice(0, 5);
  schedule(item);
  emit();
  return id;
}

function normalizeOpts(first, second, defaultTitle, defaultVariant, defaultIcon) {
  if (typeof first === "string" || typeof first === "number") {
    return {
      message: String(first),
      title: typeof second === "string" ? second : defaultTitle,
      variant: defaultVariant,
      icon: defaultIcon,
      ...(typeof second === "object" && second !== null ? second : {}),
    };
  }
  if (first && typeof first === "object") {
    return {
      title: first.title || defaultTitle,
      message: first.message || "",
      variant: first.variant || defaultVariant,
      icon: first.icon || defaultIcon,
      ...first,
    };
  }
  return {
    title: defaultTitle,
    message: "",
    variant: defaultVariant,
    icon: defaultIcon,
  };
}

export const toast = {
  show,
  success: (first, second) => show(normalizeOpts(first, second, "THÀNH CÔNG", "success", "check")),
  error: (first, second) => show(normalizeOpts(first, second, "ĐÃ CÓ LỖI XẢY RA", "error", "alert")),
  warning: (first, second) => show(normalizeOpts(first, second, "CẢNH BÁO", "warning", "alert")),
  warn: (first, second) => show(normalizeOpts(first, second, "CẢNH BÁO", "warning", "alert")),
  info: (first, second) => show(normalizeOpts(first, second, "THÔNG BÁO", "info", "info")),
  dismiss,
  /** Xóa toast theo key (vd. khi đăng nhập thành công thì bỏ toast lỗi đăng nhập) */
  dismissKey: (key) => toasts.filter((t) => t.key === key).forEach((t) => dismiss(t.id)),
  /** Tạm dừng / chạy lại bộ đếm tự tắt (khi rê chuột vào toast) */
  pause: (id) => clearTimeout(timers.get(id)),
  resume: (id) => {
    const t = toasts.find((x) => x.id === id);
    if (t) schedule(t);
  },
};

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function useToasts() {
  return useSyncExternalStore(subscribe, () => toasts, () => EMPTY);
}
