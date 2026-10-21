"use client";

import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

/**
 * Reusable Tooltip Component
 * Displays an elegant popover hint when hovering or focusing an element.
 */
export function Tooltip({
  content,
  children,
  position = "top",
  align = "center",
  delay = 120,
  className = "",
  containerClassName = "w-full",
  variant = "dark",
}) {
  const [isOpen, setIsOpen] = useState(false);
  const timeoutRef = useRef(null);

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => {
      setIsOpen(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsOpen(false);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  if (!content) return children;

  const isLight = variant === "light";

  // Alignment classes for popover box
  const alignClasses = {
    center: "left-1/2 -translate-x-1/2",
    left: "left-0",
    right: "right-0",
  }[align] || "left-1/2 -translate-x-1/2";

  // Arrow alignment
  const arrowAlignClasses = {
    center: "left-1/2 -translate-x-1/2",
    left: "left-2.5",
    right: "right-2.5",
  }[align] || "left-1/2 -translate-x-1/2";

  return (
    <div
      className={cn("relative", containerClassName)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
    >
      {children}

      {isOpen && (
        <div
          role="tooltip"
          className={cn(
            "pointer-events-none absolute z-50 flex flex-col",
            position === "top"
              ? "bottom-[calc(100%+7px)]"
              : "top-[calc(100%+7px)]",
            alignClasses,
            "animate-in fade-in zoom-in-95 duration-150"
          )}
        >
          <div
            className={cn(
              "w-max max-w-[280px] rounded-lg px-3 py-2 text-center text-[11px] leading-relaxed shadow-xl",
              isLight
                ? "bg-white text-slate-700 border border-slate-200/90 shadow-slate-300/40 ring-1 ring-slate-900/5 font-normal"
                : "bg-slate-900/95 text-slate-100 ring-1 ring-white/10 backdrop-blur-xs font-normal",
              className
            )}
          >
            {content}
          </div>

          {/* Mũi tên tooltip */}
          <div
            className={cn(
              "absolute size-2 rotate-45",
              arrowAlignClasses,
              position === "top"
                ? isLight
                  ? "-bottom-1 bg-white border-b border-r border-slate-200/90"
                  : "-bottom-1 bg-slate-900"
                : isLight
                  ? "-top-1 bg-white border-t border-l border-slate-200/90"
                  : "-top-1 bg-slate-900"
            )}
          />
        </div>
      )}
    </div>
  );
}

export default Tooltip;
