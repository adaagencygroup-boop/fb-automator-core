"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { api, Notification } from "@/lib/api";
import "./NotificationBell.css";

function formatVietnamDateTime(dateStr?: string | null): string {
  if (!dateStr) return "—";
  const s = dateStr.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(dateStr) ? dateStr : `${dateStr}Z`;
  const d = new Date(s);
  const validDate = isNaN(d.getTime()) ? new Date(dateStr) : d;
  if (isNaN(validDate.getTime())) return dateStr;
  return validDate.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchNotifs = async () => {
    try {
      const data = await api.getNotifications();
      setNotifications(data);
      setUnreadCount(data.filter((n) => !n.is_read).length);
    } catch {
      // VPS offline
    }
  };

  useEffect(() => {
    fetchNotifs();
    const interval = setInterval(fetchNotifs, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  const handleMarkAllRead = async () => {
    try {
      await api.markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (e) {
      console.error(e);
    }
  };

  const handleItemClick = async (n: Notification) => {
    if (!n.is_read) {
      try {
        await api.markRead(n.id);
        setNotifications((prev) =>
          prev.map((item) => (item.id === n.id ? { ...item, is_read: true } : item))
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } catch (e) {
        console.error(e);
      }
    }
  };

  return (
    <div className="nb-root" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="nb-trigger"
        title="Thông báo hệ thống"
      >
        <img src="/icons/users-bell.svg" alt="" />
        {unreadCount > 0 && <span className="nb-dot" />}
      </button>

      {open && (
        <div className="nb-panel">
          <div className="nb-panel-head">
            <h4 className="nb-panel-title">Thông báo ({unreadCount})</h4>
            <button
              type="button"
              onClick={handleMarkAllRead}
              disabled={unreadCount === 0}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors duration-150"
            >
              Đánh dấu đã đọc
            </button>
          </div>

          <div className="nb-list">
            {notifications.length === 0 ? (
              <div className="nb-empty">Chưa có thông báo nào</div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => handleItemClick(n)}
                  className={`nb-item cursor-pointer transition-colors hover:bg-slate-50 ${
                    n.is_read ? "nb-item--read" : "nb-item--unread"
                  }`}
                >
                  <p>{n.message}</p>
                  <span className="nb-item-time">
                    {formatVietnamDateTime(n.created_at)}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-slate-100 bg-slate-50/80 p-2 text-center">
            <Link
              href="/dashboard/system-notifications"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center w-full py-1.5 px-3 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:bg-blue-50/80 rounded-md transition-all duration-150 gap-1.5"
            >
              <span>Xem tất cả</span>
              <span className="text-sm">→</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
