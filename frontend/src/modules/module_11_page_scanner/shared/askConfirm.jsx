"use client";

import React from "react";
import { createRoot } from "react-dom/client";
import ConfirmDialog from "@/components/ui/confirm-dialog";

let pending = null;

/**
 * Thay window.confirm bằng ConfirmDialog dùng chung của dự án.
 * Trả về Promise<boolean>; đang có hộp thoại mở thì lần gọi sau coi như hủy.
 */
export function askConfirm(options) {
  if (pending || typeof document === "undefined") return Promise.resolve(false);
  pending = new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      pending = null;
      window.removeEventListener("popstate", cancel);
      resolve(ok);
      // Gỡ sau sự kiện hiện tại để React không unmount giữa lúc xử lý click
      setTimeout(() => {
        root.unmount();
        host.remove();
      }, 0);
    };
    const cancel = () => finish(false);
    window.addEventListener("popstate", cancel);
    root.render(<ConfirmDialog {...options} isOpen onClose={cancel} onConfirm={() => finish(true)} />);
  });
  return pending;
}
