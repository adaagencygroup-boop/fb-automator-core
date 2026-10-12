"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { AlertTriangle, CheckCircle2, AlertCircle, Info, X } from "lucide-react";

const ToastContext = createContext(undefined);

const alertStyles = {
  error: {
    accentBar: "bg-destructive",
    containerBg: "bg-white",
    border: "border-red-200",
    glow: "shadow-lg shadow-red-500/10",
    iconBoxBg: "bg-red-50 border-red-200 text-red-600",
    titleColor: "text-red-700",
    messageColor: "text-slate-600",
    closeColor: "text-slate-400 hover:text-slate-700",
    defaultTitle: "ĐÃ CÓ LỖI XẢY RA",
    Icon: AlertTriangle,
  },
  success: {
    accentBar: "bg-emerald-500",
    containerBg: "bg-white",
    border: "border-emerald-200",
    glow: "shadow-lg shadow-emerald-500/10",
    iconBoxBg: "bg-emerald-50 border-emerald-200 text-emerald-600",
    titleColor: "text-emerald-700",
    messageColor: "text-slate-600",
    closeColor: "text-slate-400 hover:text-slate-700",
    defaultTitle: "THÀNH CÔNG",
    Icon: CheckCircle2,
  },
  warning: {
    accentBar: "bg-amber-500",
    containerBg: "bg-white",
    border: "border-amber-200",
    glow: "shadow-lg shadow-amber-500/10",
    iconBoxBg: "bg-amber-50 border-amber-200 text-amber-600",
    titleColor: "text-amber-800",
    messageColor: "text-slate-600",
    closeColor: "text-slate-400 hover:text-slate-700",
    defaultTitle: "CẢNH BÁO",
    Icon: AlertCircle,
  },
  info: {
    accentBar: "bg-primary",
    containerBg: "bg-white",
    border: "border-blue-200",
    glow: "shadow-lg shadow-blue-500/10",
    iconBoxBg: "bg-blue-50 border-blue-200 text-primary",
    titleColor: "text-primary",
    messageColor: "text-slate-600",
    closeColor: "text-slate-400 hover:text-slate-700",
    defaultTitle: "THÔNG BÁO",
    Icon: Info,
  },
};

function ToastNotificationItem({ toast, onDismiss }) {
  const [progress, setProgress] = useState(100);
  const style = alertStyles[toast.type] || alertStyles.info;
  const Icon = style.Icon;
  const duration = toast.duration ?? 4500;

  useEffect(() => {
    if (duration <= 0) return;
    const intervalTime = 30;
    const step = (intervalTime / duration) * 100;
    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev <= step) {
          clearInterval(timer);
          onDismiss(toast.id);
          return 0;
        }
        return prev - step;
      });
    }, intervalTime);

    return () => clearInterval(timer);
  }, [duration, toast.id, onDismiss]);

  return (
    <div
      role="alert"
      className={`relative w-80 sm:w-96 rounded-xl border ${style.border} ${style.containerBg} ${style.glow} overflow-hidden shadow-card transition-all duration-300 animate-in fade-in slide-in-from-top-4`}
    >
      <div className={`absolute top-0 left-0 bottom-0 w-1.5 ${style.accentBar}`} />
      <div className="p-3.5 pl-4 flex items-start gap-3">
        <div className={`p-1.5 rounded-lg border shrink-0 ${style.iconBoxBg}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0 pr-2">
          <h4 className={`text-xs font-bold leading-tight ${style.titleColor}`}>
            {toast.title || style.defaultTitle}
          </h4>
          <p className={`text-xs mt-1 leading-relaxed break-words ${style.messageColor}`}>
            {toast.message}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          className={`shrink-0 p-1 rounded-md transition-colors ${style.closeColor}`}
          aria-label="Đóng thông báo"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {duration > 0 && (
        <div className="h-0.5 w-full bg-slate-100">
          <div
            className={`h-full transition-all linear ${style.accentBar}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const hideToast = useCallback((id) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const showToast = useCallback((item) => {
    const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
    setToasts((prev) => [...prev, { id, ...item }]);
    return id;
  }, []);

  const error = useCallback((message, title, duration) => showToast({ type: "error", message, title, duration }), [showToast]);
  const success = useCallback((message, title, duration) => showToast({ type: "success", message, title, duration }), [showToast]);
  const warning = useCallback((message, title, duration) => showToast({ type: "warning", message, title, duration }), [showToast]);
  const info = useCallback((message, title, duration) => showToast({ type: "info", message, title, duration }), [showToast]);

  return (
    <ToastContext.Provider value={{ toasts, showToast, hideToast, error, success, warning, info }}>
      {children}
      <div className="fixed top-5 right-5 z-[99999] flex flex-col gap-2.5 pointer-events-auto">
        {toasts.map((toast) => (
          <ToastNotificationItem key={toast.id} toast={toast} onDismiss={hideToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    // Fallback safe nếu dùng ngoài ToastProvider
    return {
      error: (msg, title) => console.error(title ? `[${title}] ${msg}` : msg),
      success: (msg, title) => console.log(title ? `[${title}] ${msg}` : msg),
      warning: (msg, title) => console.warn(title ? `[${title}] ${msg}` : msg),
      info: (msg, title) => console.info(title ? `[${title}] ${msg}` : msg),
      showToast: () => {},
      hideToast: () => {},
      toasts: [],
    };
  }
  return context;
}
