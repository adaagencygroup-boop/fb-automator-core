"use client";

import { useState } from "react";
import { LockKeyhole, Clock3, TriangleAlert, Send, ArrowRight, ExternalLink, Copy, Check } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { SUPPORT } from "@/config/support";
import { toast } from "@/lib/toast";
import { findNavItem } from "@/config/navigation";
import { getNavLicenseState } from "@/lib/module-access.mjs";
import styles from "./ModuleLockedView.module.css";

function SupportCard({ kind }) {
  const [copied, setCopied] = useState(false);
  const [qrFailed, setQrFailed] = useState(false);
  const zalo = kind === "zalo";
  const contact = SUPPORT[kind];
  const customQr = !contact.qrImage.includes("placehold.co/");

  async function copyContact() {
    try {
      await navigator.clipboard.writeText(zalo ? contact.phone : contact.display);
      setCopied(true);
      toast.success(zalo ? "Đã sao chép số Zalo CSKH" : "Đã sao chép Telegram Tag");
    } catch {
      toast.error("Không thể sao chép. Vui lòng chọn và sao chép thông tin liên hệ bên trên.");
    }
  }

  return <article className={`${styles.card} ${zalo ? styles.zalo : styles.telegram}`}>
    <div className={styles.cardHeader}>
      <span className={styles.brand} aria-hidden="true">{zalo ? <span>Zalo</span> : <Send size={19} fill="currentColor" />}</span>
      <div>
        <h2>{zalo ? "Hỗ trợ Zalo CSKH" : "Kỹ thuật viên Telegram"}</h2>
        <p>{zalo ? "Kích hoạt giấy phép & Tư vấn bảng giá" : "Xử lý HWID, Proxy & Kích hoạt tự động"}</p>
      </div>
    </div>
    <div className={styles.cardBody}>
      <a className={styles.qr} href={contact.url} target="_blank" rel="noopener noreferrer" aria-label={`Mở ${zalo ? "Zalo" : "Telegram"} hỗ trợ`}>
        {customQr && !qrFailed
          ? <img src={contact.qrImage} alt={`Mã QR liên hệ ${zalo ? "Zalo" : "Telegram"}`} width={104} height={104} onError={() => setQrFailed(true)} />
          : <QRCodeSVG value={contact.url} size={104} level="M" marginSize={4} fgColor={zalo ? "#2442bc" : "#0095b6"} title={`Mã QR ${contact.url}`} />}
        <span>{zalo ? "QUÉT MÃ ZALO" : "QUÉT TELEGRAM"}</span>
      </a>
      <div className={styles.contactInfo}>
        <p>{zalo
          ? "Mở ứng dụng Zalo trên điện thoại, chọn biểu tượng Quét mã QR hoặc liên hệ hotline để gửi thông tin HWID nhận hỗ trợ kích hoạt."
          : "Nhắn tin trực tiếp với support qua Telegram để gửi mã HWID hoặc thông tin đăng ký module cần sử dụng."}</p>
        <div className={styles.contactValue}>
          <span>{zalo ? "Zalo Hotline:" : "Telegram:"}</span>
          <strong>{contact.display}</strong>
        </div>
      </div>
    </div>
    <div className={styles.actions}>
      <a href={contact.url} target="_blank" rel="noopener noreferrer" className={styles.primary}>
        {zalo ? "Mở Zalo Chat" : "Nhắn Telegram"}
        {zalo ? <ExternalLink size={13} /> : <ArrowRight size={15} />}
      </a>
      <button type="button" onClick={copyContact} onBlur={() => setCopied(false)}>
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? "Đã sao chép" : zalo ? "Sao chép số" : "Sao chép Tag"}
      </button>
    </div>
  </article>;
}

export default function ModuleLockedView({ user, navId, now }) {
  const { status, expiredAt } = getNavLicenseState(user, navId, now);
  const expired = status === "expired";
  const { item, parent } = findNavItem(navId);
  const moduleName = (parent ?? item).label;
  const expiryDate = expired ? new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(expiredAt)) : null;

  return <section className={styles.view} aria-labelledby="module-locked-title">
    <div className={`${styles.intro} ${expired ? styles.expiredIntro : ""}`}>
      <div className={`${styles.lock} ${expired ? styles.expiredIcon : ""}`} aria-hidden="true">
        {expired ? <>
          <Clock3 size={37} className={styles.expiredClock} strokeWidth={2.5} />
          <span className={styles.lockSeal}><LockKeyhole size={14} /></span>
        </> : <LockKeyhole size={31} />}
      </div>
      <span className={`${styles.badge} ${expired ? styles.expiredBadge : ""}`}>
        {expired ? <TriangleAlert size={11} aria-hidden="true" /> : <span />}
        {expired ? "HẠN SỬ DỤNG TÍNH NĂNG ĐÃ KẾT THÚC" : "BẢN QUYỀN CHƯA KÍCH HOẠT"}
      </span>
      <h1 id="module-locked-title">{expired ? `Module ${moduleName} Đã Hết Hạn Sử Dụng` : "Bạn chưa được cấp quyền sử dụng ở module này"}</h1>
      {expired ? <p>
        Thời hạn sử dụng bản quyền của tính năng này đã kết thúc vào ngày <time className={styles.expiryDate} dateTime={expiredAt}>{expiryDate}</time>.
        {" "}Để tiếp tục sử dụng các tác vụ của module {moduleName}, bạn vui lòng liên hệ <strong>Quản trị viên (Admin)</strong> để gia hạn giấy phép.
      </p> : <p>Tài khoản của bạn hiện tại chưa được đăng ký hoặc cấp phép quyền sử dụng tính năng này trên thiết bị.
        Để mở khóa toàn bộ tác vụ của module và nâng cấp hệ thống, vui lòng liên hệ <strong>Quản trị viên (Admin)</strong> để đăng ký mua và cấp quyền gia hạn sử dụng tính năng.</p>}
    </div>
    <div className={`${styles.cards} ${expired ? styles.expiredCards : ""}`}><SupportCard kind="zalo" /><SupportCard kind="telegram" /></div>
  </section>;
}
