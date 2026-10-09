import * as React from "react";
import { cn } from "@/lib/utils";

const maskStyle = (src) => {
  const url = `url("${src}")`;
  return {
    WebkitMaskImage: url,
    maskImage: url,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
  };
};

/**
 * Hiển thị một file SVG gốc từ Figma (trong /public/icons) dưới dạng mask,
 * để icon ăn theo màu chữ hiện tại (currentColor) — dùng cho trạng thái
 * active / hover của Sidebar & Header.
 *
 * `width` / `height` PHẢI bằng đúng kích thước gốc của file SVG.
 */
// `glyph` là số đo dùng cho FitMaskIcon, tách ra để không đưa xuống DOM
export function MaskIcon({ src, width, height, className, style, glyph: _glyph, ...props }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block shrink-0 bg-current", className)}
      style={{
        width,
        height,
        ...maskStyle(src),
        WebkitMaskSize: "100% 100%",
        maskSize: "100% 100%",
        ...style,
      }}
      {...props}
    />
  );
}

/**
 * Như MaskIcon nhưng đặt icon vào khung vuông `size`×`size`: phần hình thật (`glyph` = [x, y, rộng, cao],
 * xem src/config/iconGlyphs.js) được phóng/thu để cạnh dài nhất = `size` và căn giữa khung.
 * Giữ nguyên file SVG gốc, chỉ thay đổi cách hiển thị — giúp các icon từ nhiều bộ khác nhau cùng cỡ.
 */
export function FitMaskIcon({ src, width, height, glyph, size = 16, className, style, ...props }) {
  const [gx, gy, gw, gh] = glyph || [0, 0, width, height];
  const k = size / Math.max(gw, gh);
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block shrink-0 bg-current", className)}
      style={{
        width: size,
        height: size,
        ...maskStyle(src),
        WebkitMaskSize: `${width * k}px ${height * k}px`,
        maskSize: `${width * k}px ${height * k}px`,
        WebkitMaskPosition: `${(size - gw * k) / 2 - gx * k}px ${(size - gh * k) / 2 - gy * k}px`,
        maskPosition: `${(size - gw * k) / 2 - gx * k}px ${(size - gh * k) / 2 - gy * k}px`,
        ...style,
      }}
      {...props}
    />
  );
}
