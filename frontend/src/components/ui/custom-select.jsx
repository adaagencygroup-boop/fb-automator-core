"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

export default function CustomSelect({
  value,
  onChange,
  options = [],
  placeholder = "Chọn tùy chọn...",
  className = "",
  buttonClassName = "",
  dropdownClassName = "",
  size = "md",
  disabled = false,
  prefixIcon,
  direction = "down",
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
      document.addEventListener("touchstart", handleOutsideClick);
    }

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
    };
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const selectedOption = options.find((opt) => opt.value === value);

  const sizeStyles = {
    sm: {
      button: "h-8 px-2.5 text-xs rounded-lg",
      dropdown: "rounded-lg text-xs",
      item: "py-1.5 px-2.5 text-xs",
      icon: "w-3 h-3",
    },
    md: {
      button: "h-9 px-3 text-xs rounded-lg",
      dropdown: "rounded-lg text-xs",
      item: "py-2 px-3 text-xs",
      icon: "w-3.5 h-3.5",
    },
    lg: {
      button: "h-10 px-3.5 text-sm rounded-lg",
      dropdown: "rounded-xl text-sm",
      item: "py-2 px-3.5 text-sm",
      icon: "w-4 h-4",
    },
  };

  const currentSize = sizeStyles[size] || sizeStyles.md;

  return (
    <div ref={containerRef} className={`relative select-none ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        className={`w-full flex flex-row items-center justify-between gap-2 bg-white border border-border transition-all duration-150 font-medium cursor-pointer shadow-subtle ${
          currentSize.button
        } ${
          isOpen
            ? "border-primary ring-2 ring-primary/20 bg-white"
            : "hover:border-slate-300 hover:bg-slate-50/50"
        } ${disabled ? "opacity-50 cursor-not-allowed hover:border-border" : ""} ${buttonClassName}`}
      >
        <div className="flex items-center gap-2 min-w-0 truncate">
          {prefixIcon && <span className="shrink-0 text-slate-400">{prefixIcon}</span>}
          {selectedOption?.icon && (
            <span className="shrink-0">{selectedOption.icon}</span>
          )}
          <span
            className={`truncate ${
              selectedOption ? "text-slate-800" : "text-slate-400"
            }`}
          >
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>

        <ChevronDown
          className={`${currentSize.icon} text-slate-400 transition-transform duration-200 shrink-0 ${
            isOpen ? "rotate-180 text-primary" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div
          className={`absolute left-0 right-0 ${
            direction === "up"
              ? "bottom-[calc(100%+4px)] origin-bottom"
              : "top-[calc(100%+4px)] origin-top"
          } z-50 bg-white border border-border shadow-card p-1 overflow-hidden animate-in fade-in zoom-in-95 duration-150 ${currentSize.dropdown} ${dropdownClassName}`}
          style={{ minWidth: "100%" }}
        >
          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {options.map((option) => {
              const isSelected = option.value === value;
              const isDisabled = Boolean(option.disabled);

              return (
                <div
                  key={String(option.value)}
                  onClick={() => {
                    if (isDisabled) return;
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between gap-2 rounded-md transition-colors ${
                    currentSize.item
                  } ${
                    isDisabled
                      ? "opacity-50 cursor-not-allowed text-slate-400"
                      : isSelected
                      ? "bg-primary-subtle text-primary font-semibold cursor-pointer"
                      : "text-slate-700 hover:bg-slate-100 font-medium cursor-pointer"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 truncate">
                    {option.icon && (
                      <span className="shrink-0">{option.icon}</span>
                    )}
                    <span className="truncate">{option.label}</span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {option.badge && (
                      <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-[10px] text-slate-500">
                        {option.badge}
                      </span>
                    )}
                    {isSelected && (
                      <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
