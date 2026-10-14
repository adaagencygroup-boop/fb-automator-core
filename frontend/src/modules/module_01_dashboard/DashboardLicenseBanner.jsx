"use client";

import { CalendarClock, CalendarDays, Shield, ShieldCheck, ShieldX, ShoppingCart, Zap } from "lucide-react";
import { formatVietnamDateTime } from "@/lib/date-utils";
import { getLicenseState } from "./licenseState.mjs";
import styles from "./dashboard.module.css";

export default function DashboardLicenseBanner({ user, onRenew, now }) {
  const { tone, days } = getLicenseState(user, now);
  const warning = tone === "warning";
  const expired = tone === "expired";
  const needsRenewal = warning || expired;
  const Icon = expired ? ShieldX : warning ? Shield : ShieldCheck;
  const Calendar = needsRenewal ? CalendarClock : CalendarDays;
  const date = user?.expired_at ? formatVietnamDateTime(user.expired_at).date : null;
  const status = expired ? "Đã hết hạn" : tone === "active" || warning ? "Đang hoạt động" : tone === "loading" ? "Đang tải bản quyền" : "Chưa kích hoạt";

  return <section className={`${styles.license} ${warning ? styles.licenseWarning : expired ? styles.licenseExpired : ""}`} data-license-state={tone} aria-label="Bản quyền và xác thực HWID">
    <div className={styles.licenseInfo}>
      <div className={styles.shield}><Icon size={28} />{warning && <span className={styles.shieldAlert} aria-hidden="true">!</span>}</div>
      <div><h2>Bản quyền &amp; Xác thực HWID</h2><span className={`${styles.status} ${tone === "inactive" ? styles.inactive : ""}`}><span />{status}</span></div>
    </div>
    <div className={styles.expiry}>
      <div className={styles.calendar}><Calendar size={22} /></div>
      <div>{expired ? <strong className={styles.expiredTitle}>Đã hết hạn</strong> : days != null ? <div>Còn <strong>{days} ngày</strong></div> : <div>{tone === "active" ? "Không giới hạn" : tone === "loading" ? "—" : "Chưa có bản quyền"}</div>}
        {date && <small>{expired ? `(${date})` : `(Hết hạn: ${date})`}</small>}
      </div>
    </div>
    {needsRenewal && <button type="button" className={styles.renewButton} onClick={onRenew}>{expired ? <ShoppingCart size={19} /> : <Zap size={19} />}Gia hạn ngay</button>}
  </section>;
}
