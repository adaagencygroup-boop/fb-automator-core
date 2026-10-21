"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Kéo dãn độ rộng một cột (giống thanh sidebar): gán width thẳng vào style phần tử
 * để kéo mượt, không render lại nội dung; nhớ lại bằng localStorage.
 *
 *  - min/max/default : giới hạn và độ rộng mặc định (px)
 *  - storageKey      : khoá localStorage để nhớ độ rộng (bỏ trống thì không nhớ)
 *  - side            : "right" (tay kéo ở mép phải, cột bên trái) | "left" (tay kéo ở mép trái, cột bên phải)
 *
 * Trả về { ref, handleProps, dragging }. Gắn ref vào phần tử cần dãn, trải handleProps
 * vào thanh kéo (hoặc dùng <ResizeHandle />).
 */
export function useResizableWidth({ min, max, default: def, storageKey, side = "right", getAvailableMax }) {
  const ref = useRef(null);
  const handleRef = useRef(null);
  const drag = useRef(null);
  const [dragging, setDragging] = useState(false);
  const sign = side === "left" ? -1 : 1;
  const STEP = 16;
  const availRef = useRef(getAvailableMax);
  // Độ rộng NGƯỜI DÙNG muốn (đã lưu / lần kéo cuối). Khi khung hẹp lại thì kẹp nhỏ xuống,
  // khi rộng ra thì trả lại đúng mức mong muốn này.
  const preferredRef = useRef(def);
  useEffect(() => {
    availRef.current = getAvailableMax;
  });

  const clamp = useCallback(
    (w) => {
      // Giới hạn thêm theo không gian còn lại để không đẩy tràn ngang cả trang
      let hi = max;
      if (availRef.current && ref.current) {
        const avail = availRef.current(ref.current);
        if (Number.isFinite(avail)) hi = Math.min(hi, Math.max(min, avail));
      }
      return Math.min(hi, Math.max(min, Math.round(w)));
    },
    [min, max],
  );

  const applyWidth = useCallback(
    (w, persist = false) => {
      const width = clamp(w);
      if (ref.current) {
        ref.current.style.width = `${width}px`;
        ref.current.style.flex = "0 0 auto";
      }
      handleRef.current?.setAttribute("aria-valuenow", String(width));
      if (persist) {
        preferredRef.current = width;
      }
      if (persist && storageKey) {
        try {
          localStorage.setItem(storageKey, String(width));
        } catch {
          /* localStorage có thể bị chặn — chỉ mất tính năng nhớ độ rộng */
        }
      }
      return width;
    },
    [clamp, storageKey],
  );

  // Khôi phục độ rộng đã lưu sau khi hiển thị
  useEffect(() => {
    let saved = NaN;
    try {
      saved = Number(localStorage.getItem(storageKey));
    } catch {
      /* bỏ qua */
    }
    if (saved) {
      preferredRef.current = saved;
      applyWidth(saved);
    }
  }, [applyWidth, storageKey]);

  /**
   * Kẹp lại độ rộng theo chỗ trống hiện có. Gọi khi ĐỔI BỐ CỤC (thêm/bớt cột) —
   * lúc đó bề rộng khung cha không đổi nên ResizeObserver bên dưới không kích hoạt.
   */
  const reclamp = useCallback(() => applyWidth(preferredRef.current), [applyWidth]);

  // Khung cha đổi kích thước (thu nhỏ cửa sổ, ẩn/hiện sidebar)
  // -> kẹp lại độ rộng theo chỗ trống mới, tránh cột này lấn làm cắt nội dung cột kia.
  useEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => applyWidth(preferredRef.current));
    ro.observe(parent);
    return () => ro.disconnect();
  }, [applyWidth]);

  const currentWidth = () => ref.current?.getBoundingClientRect().width ?? def;

  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    applyWidth(currentWidth(), true);
  };

  const handleProps = {
    ref: handleRef,
    role: "separator",
    "aria-orientation": "vertical",
    "aria-label": "Kéo để đổi độ rộng cột",
    "aria-valuemin": min,
    "aria-valuemax": max,
    "aria-valuenow": def,
    tabIndex: 0,
    title: "Kéo để đổi độ rộng · Nhấp đúp để về mặc định",
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { startX: e.clientX, startWidth: currentWidth() };
      setDragging(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    onPointerMove: (e) => {
      if (!drag.current) return;
      applyWidth(drag.current.startWidth + sign * (e.clientX - drag.current.startX));
    },
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onLostPointerCapture: endDrag,
    onDoubleClick: () => applyWidth(def, true),
    onKeyDown: (e) => {
      const step = e.shiftKey ? STEP * 3 : STEP;
      const next = {
        ArrowLeft: currentWidth() - step,
        ArrowRight: currentWidth() + step,
        Home: min,
        End: max,
      }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      applyWidth(next, true);
    },
  };

  return { ref, handleProps, dragging, reclamp };
}

/** Thanh kéo đổi độ rộng (đặt trong phần tử relative). side quyết định đặt ở mép trái/phải. */
export function ResizeHandle({ handleProps, dragging, side = "right" }) {
  return (
    <div
      {...handleProps}
      // offset bằng inline style để không phụ thuộc Tailwind JIT:
      // tay kéo (w-3 = 12px) lọt trọn vào khe gap-3 (12px) → đường kẻ nằm chính giữa khe
      style={{ [side === "left" ? "left" : "right"]: "-12px" }}
      className={cn(
        "group absolute inset-y-0 z-20 w-3 cursor-col-resize outline-none flex justify-center",
      )}
    >
      <span
        className={cn(
          "h-full w-0.5 transition-colors",
          dragging ? "bg-sky-500" : "bg-transparent group-hover:bg-sky-300 group-focus-visible:bg-sky-500",
        )}
      />
    </div>
  );
}
