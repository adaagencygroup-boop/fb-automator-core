"use client";

import { toast } from "@/lib/toast";

/**
 * Adapter tương thích ngược:
 * Chuyển tiếp toàn bộ các lệnh gọi toast cũ sang hệ thống Toast thống nhất (@/lib/toast & Toaster.jsx).
 */
export { toast };

export function useToast() {
  return toast;
}

export function ToastProvider({ children }) {
  return children;
}

export default toast;
