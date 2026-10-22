"use client";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { categoryPopupPosition } from "../utils/category-popup.mjs";
import styles from "./CategoryEditorPopup.module.css";

export default function CategoryEditorPopup({ anchor, title, busy, onClose, onSubmit, children, editing }) {
  const popup = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const panel = popup.current;
    let frame;
    const update = () => {
      if (!anchor?.isConnected) return;
      const position = categoryPopupPosition(anchor.getBoundingClientRect(), panel.getBoundingClientRect(), {
        width: window.innerWidth, height: window.innerHeight,
      });
      Object.assign(panel.style, Object.fromEntries(Object.entries(position).map(([key, value]) => [key, `${value}px`])));
      panel.style.visibility = "visible";
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    update();
    panel.querySelector("input")?.focus({ preventScroll: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(panel);
    if (anchor) observer.observe(anchor);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      if (anchor?.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor]);

  useEffect(() => {
    const close = () => { if (!busy) onClose(); };
    const outside = event => {
      if (!popup.current?.contains(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    const keydown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (event.key === "Tab") {
        const items = [...popup.current.querySelectorAll("button:not(:disabled), input:not(:disabled)")];
        const first = items[0], last = items.at(-1);
        if (!first) event.preventDefault();
        else if (event.shiftKey && (document.activeElement === first || !popup.current.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !popup.current.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    const observer = new MutationObserver(() => { if (!anchor?.isConnected) onClose(); });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", outside, true);
    document.addEventListener("keydown", keydown, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("click", outside, true);
      document.removeEventListener("keydown", keydown, true);
    };
  }, [anchor, busy, onClose]);

  return createPortal(<div ref={popup} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy}
    style={{ visibility: "hidden", width: 280 }}
    onClick={event => event.stopPropagation()}
    className={`${styles.popup} fixed z-[100010] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 font-sans text-xs text-slate-800 shadow-lg`}>
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id={titleId} className="text-sm font-semibold">{title}</h2>
        <button type="button" aria-label="Đóng" disabled={busy} onClick={onClose} className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"><X className="h-3.5 w-3.5" /></button>
      </div>
      {children}
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
        <button type="button" disabled={busy} onClick={onClose} className="h-8 cursor-pointer rounded-lg border border-slate-200 px-3 font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Hủy</button>
        <button type="submit" disabled={busy} className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{busy ? "Đang lưu…" : editing ? "Lưu" : "Tạo danh mục"}
        </button>
      </div>
    </form>
  </div>, document.body);
}
