"use client";

import React, { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Info, AlertCircle, X, Loader2 } from "lucide-react";
import { Button } from "./button";

const variantStyles = {
  danger: {
    iconBg: "bg-red-50",
    iconBorder: "border-red-200",
    iconColor: "text-red-600",
    confirmBtn: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
    DefaultIcon: AlertTriangle,
  },
  warning: {
    iconBg: "bg-amber-50",
    iconBorder: "border-amber-200",
    iconColor: "text-amber-600",
    confirmBtn: "bg-amber-500 text-white hover:bg-amber-600",
    DefaultIcon: AlertTriangle,
  },
  info: {
    iconBg: "bg-blue-50",
    iconBorder: "border-blue-200",
    iconColor: "text-primary",
    confirmBtn: "bg-primary text-white hover:bg-primary-hover",
    DefaultIcon: Info,
  },
  primary: {
    iconBg: "bg-blue-50",
    iconBorder: "border-blue-200",
    iconColor: "text-primary",
    confirmBtn: "bg-primary text-white hover:bg-primary-hover",
    DefaultIcon: AlertCircle,
  },
};

export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title = "Xác nhận hành động",
  description = "Bạn có chắc chắn muốn thực hiện hành động này không?",
  confirmText = "Xác nhận",
  cancelText = "Hủy bỏ",
  variant = "danger",
  loading = false,
  secondaryText,
  onSecondaryConfirm,
  confirmDisabled = false,
  hideConfirm = false,
  hideCancel = false,
  loadingAction = "confirm",
  icon,
}) {
  const dialogRef = useRef(null);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const style = variantStyles[variant] || variantStyles.danger;
  const IconComponent = style.DefaultIcon;

  useEffect(() => {
    function handleKeyDown(e) {
      if (!isOpen) return;
      if (e.key === "Escape" && !loading) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  const content = (
    <div
      className="fixed inset-0 z-[100001] flex items-center justify-center p-4 select-none bg-slate-900/60 backdrop-blur-sm w-screen h-screen overflow-y-auto animate-in fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className={`relative w-full ${secondaryText ? "max-w-[560px]" : "max-w-[440px]"} rounded-2xl p-6 shadow-2xl border border-border bg-white text-card-foreground animate-in zoom-in-95 duration-200`}
      >
        {!loading && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            title="Đóng"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        <div className="flex items-start gap-4">
          <div
            className={`w-11 h-11 rounded-xl border ${style.iconBorder} ${style.iconBg} ${style.iconColor} flex items-center justify-center shrink-0 shadow-sm`}
          >
            {icon ? icon : <IconComponent className="w-5 h-5" />}
          </div>

          <div className="min-w-0 flex-1 pr-6">
            <h3 id="confirm-dialog-title" className="text-base font-bold text-slate-900 leading-snug">
              {title}
            </h3>
            <p className="mt-1.5 text-xs text-slate-500 leading-relaxed break-words">
              {description}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2.5">
          {!hideCancel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={loading}
            >
              {cancelText}
            </Button>
          )}

          {secondaryText && !hideConfirm && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onSecondaryConfirm}
              disabled={loading || confirmDisabled}
              className="h-auto min-h-8 whitespace-normal text-center"
            >
              {loading && loadingAction === "secondary" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {secondaryText}
            </Button>
          )}

          {!hideConfirm && <button
            type="button"
            onClick={onConfirm}
            disabled={loading || confirmDisabled}
            className={`inline-flex items-center justify-center gap-1.5 min-h-8 rounded-md px-4 py-1.5 text-xs font-semibold shadow-sm transition-all active:scale-[0.98] disabled:opacity-50 ${style.confirmBtn}`}
          >
            {loading && loadingAction === "confirm" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{confirmText}</span>
          </button>}
        </div>
      </div>
    </div>
  );

  return mounted && typeof document !== "undefined"
    ? createPortal(content, document.body)
    : null;
}
