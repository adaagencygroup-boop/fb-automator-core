"use client";

import React, { useEffect } from "react";
import { AlertTriangle, Info, Lock, ShieldAlert, Trash2, X } from "lucide-react";
import "./ConfirmModal.css";

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "info";
  icon?: "lock" | "trash" | "warning" | "info" | "shield";
  loading?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = "Xác nhận",
  cancelText = "Hủy bỏ",
  variant = "danger",
  icon,
  loading = false,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) {
        onClose();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  const getIcon = () => {
    if (icon === "lock") return <Lock size={22} />;
    if (icon === "trash") return <Trash2 size={22} />;
    if (icon === "shield") return <ShieldAlert size={22} />;
    if (variant === "danger") return <AlertTriangle size={22} />;
    if (variant === "warning") return <AlertTriangle size={22} />;
    return <Info size={22} />;
  };

  return (
    <div className="confirm-modal-overlay" onClick={loading ? undefined : onClose}>
      <div
        className={`confirm-modal-box confirm-modal-box--${variant}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          className="confirm-modal-close"
          aria-label="Đóng"
          disabled={loading}
          onClick={onClose}
        >
          <X size={16} />
        </button>

        <div className="confirm-modal-header">
          <div className={`confirm-modal-icon confirm-modal-icon--${variant}`}>
            {getIcon()}
          </div>
          <div className="confirm-modal-text">
            <h3 className="confirm-modal-title">{title}</h3>
            <p className="confirm-modal-message">{message}</p>
          </div>
        </div>

        <div className="confirm-modal-actions">
          <button
            type="button"
            className="confirm-modal-btn confirm-modal-btn--cancel"
            disabled={loading}
            onClick={onClose}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className={`confirm-modal-btn confirm-modal-btn--confirm confirm-modal-btn--${variant}`}
            disabled={loading}
            onClick={async () => {
              await onConfirm();
              onClose();
            }}
          >
            {loading ? "Đang xử lý..." : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
