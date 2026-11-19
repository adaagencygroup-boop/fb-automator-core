"use client";

import { useCallback } from "react";

// Tự thêm tooltip (title) cho mọi chữ bị cắt "…" (truncate / line-clamp) trong Module 10.
// Gắn 1 lần ở gốc module; sự kiện React đi qua cả modal render bằng portal.
const MAX_DEPTH = 4;

function isClipped(el) {
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
}

export function useOverflowTooltip() {
  return useCallback((event) => {
    let el = event.target;
    for (let depth = 0; el && depth < MAX_DEPTH; depth += 1, el = el.parentElement) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.hasAttribute("title") || el.closest("[title]")) return; // đã có tooltip riêng
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName)) return;
      const style = window.getComputedStyle(el);
      const clipsText =
        style.textOverflow === "ellipsis" || Number.parseInt(style.webkitLineClamp || "0", 10) > 0;
      if (!clipsText || !isClipped(el)) continue;
      const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (text) el.setAttribute("title", text);
      return;
    }
  }, []);
}

export default function OverflowTooltip({ children, className = "" }) {
  const onMouseOver = useOverflowTooltip();
  return (
    <div className={className} onMouseOver={onMouseOver}>
      {children}
    </div>
  );
}
