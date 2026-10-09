import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Hiển thị một file SVG gốc từ Figma (trong /public/icons) dưới dạng mask,
 * để icon ăn theo màu chữ hiện tại (currentColor) — dùng cho trạng thái
 * active / hover của Sidebar & Header.
 *
 * `width` / `height` PHẢI bằng đúng kích thước gốc của file SVG.
 */
export function MaskIcon({ src, width, height, className, style, ...props }) {
  const url = `url("${src}")`;
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block shrink-0 bg-current", className)}
      style={{
        width,
        height,
        WebkitMaskImage: url,
        maskImage: url,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskSize: "100% 100%",
        maskSize: "100% 100%",
        ...style,
      }}
      {...props}
    />
  );
}
