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

  // Alignment classes for popover box
  const alignClasses = {
    center: "left-1/2 -translate-x-1/2",
    left: "left-0",
    right: "right-0",
  }[align] || "left-1/2 -translate-x-1/2";

  // Arrow alignment
  const arrowAlignClasses = {
    center: "left-1/2 -translate-x-1/2",
    left: "left-4",
    right: "right-4",
  }[align] || "left-1/2 -translate-x-1/2";

  return (
    <div
      className="relative w-full"
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
              "w-max max-w-[280px] rounded-lg bg-slate-900/95 px-3 py-1.5 text-center text-[11px] font-normal text-slate-100 shadow-xl backdrop-blur-xs ring-1 ring-white/10 leading-relaxed",
              className
            )}
          >
            {content}
          </div>

          {/* Mũi tên tooltip */}
          <div
            className={cn(
              "absolute size-2 rotate-45 bg-slate-900",
              arrowAlignClasses,
              position === "top"
                ? "-bottom-1"
                : "-top-1"
            )}
          />
        </div>
      )}
    </div>
  );
}

export default Tooltip;
