"use client";

import { useEffect, useRef } from "react";
import { ExternalLink, MessageSquareText, Send, X } from "lucide-react";
import { SUPPORT } from "@/config/support";
import styles from "./dashboard.module.css";

export default function RenewalContactDialog({ onClose }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  function closeBackdrop(event) {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }

  return <dialog ref={dialogRef} id="dashboard-renewal" className={styles.renewDialog} aria-labelledby="renewal-contact-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={closeBackdrop}>
    <button type="button" className={styles.renewClose} onClick={onClose} aria-label="Đóng popup gia hạn"><X size={20} /></button>
    <h2 id="renewal-contact-title">Vui lòng liên hệ với admin để Gia hạn bản quyền</h2>
    <div className={styles.renewContacts}>
      <a href={SUPPORT.zalo.url} target="_blank" rel="noreferrer" className={styles.renewContact}>
        <span className={styles.renewContactIcon}><MessageSquareText size={29} /></span>
        <span className={styles.renewContactText}><strong>Hỗ trợ Zalo CSKH</strong><span>Quét mã QR / Nhắn tin Zalo trực tiếp</span></span>
        <ExternalLink size={23} className={styles.renewExternal} />
      </a>
      <a href={SUPPORT.telegram.url} target="_blank" rel="noreferrer" className={styles.renewContact}>
        <span className={styles.renewContactIcon}><Send size={28} /></span>
        <span className={styles.renewContactText}><strong>Kỹ thuật viên Telegram</strong><span>Nhắn tin {SUPPORT.telegram.display} (24/7)</span></span>
        <ExternalLink size={23} className={styles.renewExternal} />
      </a>
    </div>
  </dialog>;
}
