"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Phần đầu khung danh sách bên phải DÍNH khi cuộn trang — cùng cách làm với Danh sách page (Module 11,
 * list-pages/index.jsx), tách ra để Module 10 (Danh sách nhóm / thành viên) và Module 12 (Danh sách tài khoản) dùng chung.
 *
 * Vùng cuộn là <main> của AppShell (có p-6 → khe 24px phía trên khi phần đầu đang dính).
 * - headRef: gắn vào phần đầu (tiêu đề, nút, bộ lọc) — phần này `sticky top-0`.
 * - setTableBox: gắn vào khung bao bảng.
 * - headHeight: vị trí dính của tiêu đề cột (ngay dưới phần đầu).
 * - headStuck: đang dính → hiện dải phủ khe 24px phía trên (lớp STUCK_COVER) để nội dung cuộn qua không lộ ra.
 * - tableFits: bảng vừa khung → bỏ cuộn ngang để tiêu đề cột dính theo trang; không vừa thì giữ cuộn ngang.
 */
export default function useStickyListHead() {
  const headRef = useRef(null);
  const boxRef = useRef(null);
  const [boxEl, setBoxEl] = useState(null);
  const [headHeight, setHeadHeight] = useState(0);
  const [headStuck, setHeadStuck] = useState(false);
  const [tableFits, setTableFits] = useState(false);

  const setTableBox = useCallback((el) => {
    boxRef.current = el;
    setBoxEl(el);
  }, []);

  useEffect(() => {
    const head = headRef.current;
    const box = boxRef.current;
    const scroller = head?.closest("main");
    if (!head || !scroller) return undefined;
    const check = () => {
      const padTop = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
      const offset = head.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      setHeadStuck(scroller.scrollTop > 0 && offset <= padTop + 1);
      setHeadHeight(head.offsetHeight);
      const table = box?.querySelector("table");
      if (box && table) setTableFits(table.offsetWidth <= box.clientWidth + 1);
    };
    check();
    scroller.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(check) : null;
    ro?.observe(head);
    if (box) ro?.observe(box);
    return () => {
      scroller.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
      ro?.disconnect();
    };
  }, [boxEl]);

  return { headRef, setTableBox, headHeight, headStuck, tableFits };
}

/** Dải phủ khe 24px phía trên phần đầu khi đang dính (màu = nền trang `#F4F7FC` của Module 10 / 12). */
export const STUCK_COVER =
  "before:pointer-events-none before:absolute before:-inset-x-px before:-top-6 before:h-6 before:bg-[#F4F7FC] before:content-['']";
