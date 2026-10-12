"use client";

import { useSyncExternalStore } from "react";

/**
 * Toast thông báo dùng chung toàn app. Gọi ở bất kỳ đâu (không cần Provider):
 *
 *   import { toast } from "@/lib/toast";
 *   toast.error({ title: "Đăng nhập thất bại", message: "..." });
 *   toast.error({ key: "license", icon: "calendar", title: "...", message: "..." });
 *
 * Tùy chọn:
 *  - title, message : tiêu đề (in hoa) + nội dung
 *  - icon           : "alert" (mặc định) | "calendar" | "info"
 *  - toast.info(...) : toast thông báo màu xanh (không phải lỗi)
 *  - key            : toast cùng key sẽ thay thế nhau thay vì xếp chồng
 *  - duration       : ms tự tắt (mặc định 7000, 0 = không tự tắt)
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

function show({ key, variant = "error", icon = "alert", title, message, duration = 7000 }) {
  const id = ++seq;
  const item = { id, key, variant, icon, title, message, duration };
  const old = key ? toasts.find((t) => t.key === key) : null;
  if (old) {
    clearTimeout(timers.get(old.id));
    timers.delete(old.id);
  }
  // Mới nhất ở trên cùng, tối đa 4 toast
  toasts = [item, ...toasts.filter((t) => t !== old)].slice(0, 4);
  schedule(item);
  emit();
  return id;
}

export const toast = {
  show,
  error: (opts) => show({ ...opts, variant: "error" }),
  info: (opts) => show({ icon: "info", ...opts, variant: "info" }),
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
