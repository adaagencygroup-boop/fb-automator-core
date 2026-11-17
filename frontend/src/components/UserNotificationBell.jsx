"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, Loader2, RefreshCw, X } from "lucide-react";
import api from "@/services/api";
import { formatVietnamDateTime } from "@/lib/date-utils";
import styles from "./UserNotificationBell.module.css";

const NOTIFICATIONS_URL = "/api/v1/auth/notifications";
const TITLES = {
  ACCOUNT_APPROVED: "Tài khoản được phê duyệt", MODULE_ACTIVATED: "Module được kích hoạt",
  MODULE_RENEWED: "Module được gia hạn", MODULE_EXPIRED: "Module hết hạn", MODULE_UPDATED: "Cập nhật thời hạn module",
  LICENSE_EXTENDED: "Bản quyền", ACCOUNT_ALERT: "Tài khoản", SYSTEM_UPDATE: "Hệ thống", RESET_HWID: "Mã thiết bị",
};

function useUserNotifications(userId) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [action, setAction] = useState(null);
  const mounted = useRef(false);
  const revision = useRef(0);
  const writing = useRef(false);
  const reload = useRef(() => {});

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const controller = new AbortController();
    let fetching = false;
    async function load() {
      if (fetching || writing.current) return;
      fetching = true;
      const version = revision.current;
      setLoading(true);
      try {
        const data = await api.get(NOTIFICATIONS_URL, { signal: controller.signal, timeout: 15000 });
        if (!Array.isArray(data)) throw new Error("Invalid notifications response");
        if (active && revision.current === version) {
          setItems(data);
          setError("");
        }
      } catch (error) {
        if (active && revision.current === version) setError(error.status === 404
          ? "Engine đang chạy chưa có API thông báo. Vui lòng khởi động lại engine."
          : error.status === 0
            ? "Không kết nối được engine để tải thông báo. Vui lòng kiểm tra engine đang chạy."
            : "Không tải được thông báo. Vui lòng thử lại.");
      } finally {
        fetching = false;
        if (active) setLoading(false);
      }
    }
    reload.current = load;
    load();
    const interval = setInterval(() => { if (document.visibilityState === "visible") load(); }, 30000);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      active = false;
      controller.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId]);

  const markRead = useCallback(async (id = null) => {
    if (writing.current) return;
    writing.current = true;
    revision.current += 1; // An older GET must not restore unread flags after a successful write.
    setAction(id ?? "all");
    setError("");
    try {
      await api.put(id === null ? `${NOTIFICATIONS_URL}/read-all` : `${NOTIFICATIONS_URL}/${id}/read`);
      if (mounted.current) setItems((previous) => previous.map((item) => id === null || item.id === id ? { ...item, is_read: true } : item));
    } catch {
      if (mounted.current) setError("Không đánh dấu đã đọc được. Vui lòng thử lại.");
    } finally {
      revision.current += 1;
      writing.current = false;
      if (mounted.current) setAction(null);
    }
  }, []);

  return { items, loading, error, action, markRead, refresh: () => reload.current() };
}

export default function UserNotificationBell({ userId }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const root = useRef(null);
  const trigger = useRef(null);
  const panel = useRef(null);
  const { items, loading, error, action, markRead, refresh } = useUserNotifications(userId);
  const unread = items.filter((item) => !item.is_read).length;
  const visible = filter === "unread" ? items.filter((item) => !item.is_read) : items;

  useEffect(() => {
    if (!open) return undefined;
    panel.current?.focus();
    const closeOutside = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return <div ref={root} className={styles.root} onBlur={(event) => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} type="button" aria-label="Thông báo" title={unread ? `Bạn có ${unread} thông báo chưa đọc` : "Thông báo"}
      aria-expanded={open} aria-haspopup="dialog" aria-controls="user-notifications-panel"
      onClick={() => { if (!open) refresh(); setOpen((value) => !value); }} className={styles.trigger}>
      <img src="/icons/icon_bell.svg" alt="" width={13} height={14} />
      {unread > 0 && <span className={styles.count} data-testid="user-notification-count" aria-label={`${unread} thông báo chưa đọc`}>{unread > 99 ? "99+" : unread}</span>}
    </button>
    {open && <section ref={panel} id="user-notifications-panel" role="dialog" aria-label="Thông báo của bạn" tabIndex={-1} className={styles.panel}>
      <div className={styles.header}>
        <h2>Thông báo <span>{unread} chưa đọc</span></h2>
        <div className={styles.controls}>
          <button type="button" onClick={refresh} disabled={loading} aria-label="Làm mới thông báo" title="Làm mới thông báo"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button>
          <button type="button" onClick={() => { setOpen(false); trigger.current?.focus(); }} aria-label="Đóng thông báo" title="Đóng"><X size={17} /></button>
        </div>
      </div>
      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>Tất cả</button>
          <button type="button" aria-pressed={filter === "unread"} onClick={() => setFilter("unread")}>Chưa đọc</button>
        </div>
        <button type="button" className={styles.readAll} disabled={!unread || action !== null} onClick={() => markRead()} aria-label="Đánh dấu tất cả đã đọc">
          {action === "all" ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={15} />} Đọc tất cả
        </button>
      </div>
      {error && <div role="alert" className={styles.error}>{error}<button type="button" disabled={loading} onClick={refresh}>Thử lại</button></div>}
      <div className={styles.list}>
        {loading && items.length === 0 ? <p role="status" className={styles.empty}><Loader2 size={22} className="animate-spin" />Đang tải thông báo…</p>
          : !error && visible.length === 0 ? <p className={styles.empty}><Bell size={26} />{filter === "unread" ? "Bạn đã đọc hết thông báo." : "Bạn chưa có thông báo."}</p>
          : <ul>{visible.map((item) => <li key={item.id}>
            <button type="button" onClick={() => { if (!item.is_read) markRead(item.id); }} disabled={action !== null}
              aria-label={`${item.is_read ? "Thông báo đã đọc" : "Đánh dấu đã đọc"}: ${item.message}`}
              className={`${styles.item} ${item.is_read ? styles.read : styles.unread}`}>
              <span className={styles.itemTop}><strong className={item.type === "MODULE_EXPIRED" ? styles.expiredTitle : item.type === "ACCOUNT_APPROVED" ? styles.approvedTitle : ""}>{TITLES[item.type] || "Thông báo hệ thống"}</strong>{!item.is_read && <span className={styles.dot} aria-label="Chưa đọc" />}</span>
              <span className={styles.message}>{item.message}</span>
              <span className={styles.time}>{formatVietnamDateTime(item.created_at).full}</span>
            </button>
          </li>)}</ul>}
      </div>
    </section>}
  </div>;
}
