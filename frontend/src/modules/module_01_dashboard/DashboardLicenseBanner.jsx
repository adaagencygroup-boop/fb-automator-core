"use client";

import { CalendarClock, CalendarDays, Shield, ShieldCheck, ShieldX, ShoppingCart, Zap } from "lucide-react";
import { formatVietnamDateTime } from "@/lib/date-utils";
import { getDashboardLicenseState, getLicenseState } from "./licenseState.mjs";
import styles from "./dashboard.module.css";

export default function DashboardLicenseBanner({ user, onRenew, now }) {
  const { tone, days, expiredAt, moduleName } = getDashboardLicenseState(user, now);
  const accountTone = getLicenseState(user, now).tone;
  const warning = tone === "warning";
  const expired = tone === "expired";
  const needsRenewal = warning || expired;
  const Icon = expired ? ShieldX : warning ? Shield : ShieldCheck;
  const Calendar = needsRenewal ? CalendarClock : CalendarDays;
  const date = expiredAt ? formatVietnamDateTime(expiredAt).date : null;
  const status = accountTone === "expired" ? "Đã hết hạn" : accountTone === "active" || accountTone === "warning" ? "Đang hoạt động" : accountTone === "loading" ? "Đang tải bản quyền" : "Chưa kích hoạt";

  return <section className={`${styles.license} ${warning ? styles.licenseWarning : expired ? styles.licenseExpired : ""}`} data-license-state={tone} aria-label="Bản quyền và xác thực HWID">
    <div className={styles.licenseInfo}>
      <div className={styles.shield}><Icon size={28} />{warning && <span className={styles.shieldAlert} aria-hidden="true">!</span>}</div>
      <div><h2>Bản quyền &amp; Xác thực HWID</h2><span className={`${styles.status} ${accountTone === "inactive" ? styles.inactive : accountTone === "expired" ? styles.statusExpired : ""}`}><span />{status}</span></div>
    </div>
    <div className={styles.expiry}>
      <div className={styles.calendar}><Calendar size={22} /></div>
      <div className={styles.expiryText}>
        {moduleName && <span className={styles.moduleName}>Module {moduleName}</span>}
        {expired ? <strong className={styles.expiredTitle}>Đã hết hạn</strong> : days != null ? <div>Còn <strong>{days} ngày</strong></div> : <div>{tone === "active" ? "Không giới hạn" : tone === "loading" ? "—" : "Chưa có module được kích hoạt"}</div>}
        {date && <small>{expired ? `(${date})` : `(Hết hạn: ${date})`}</small>}
      </div>
    </div>
    {needsRenewal && <button type="button" className={styles.renewButton} onClick={onRenew}>{expired ? <ShoppingCart size={19} /> : <Zap size={19} />}Gia hạn ngay</button>}
  </section>;
}
