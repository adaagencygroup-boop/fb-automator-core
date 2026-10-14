"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Flag, Headset, RefreshCw, UserRound, XCircle } from "lucide-react";
import { getDashboardStats } from "./service";
import { SUPPORT } from "@/config/support";
import { useSession } from "@/components/SessionContext";
import DashboardLicenseBanner from "./DashboardLicenseBanner";
import RenewalContactDialog from "./RenewalContactDialog";
import styles from "./dashboard.module.css";

const percent = (count, total) => total > 0 ? Math.round(count / total * 1000) / 10 : 0;
const display = (number) => number == null ? "—" : number;

function Metric({ label, value, ratio, tone = "success", icon: Icon, showRatio = true }) {
  return <div className={styles.metric}>
    <div className={styles.metricLabel}>{Icon ? <Icon size={14} className={styles[tone]} /> : <span className={`${styles.dot} ${styles[tone]}`} />}{label}</div>
    <div className={styles.metricValue}>{display(value)}{showRatio && ratio != null && <span className={styles[tone]}> ({ratio}%)</span>}</div>
    <div className={styles.track}><span className={styles[tone]} style={{ width: `${ratio ?? 0}%` }} /></div>
  </div>;
}

function Total({ icon: Icon, label, value, href, account = false }) {
  return <div className={styles.total}>
    <div className={`${styles.totalIcon} ${account ? styles.accountIcon : ""}`}><Icon size={22} fill="currentColor" strokeWidth={1.5} /></div>
    <div><div className={styles.totalLabel}>{label}</div><div className={styles.totalValue}>{display(value)}</div><Link href={href} className={styles.detail}>Xem chi tiết <ArrowRight size={12} /></Link></div>
  </div>;
}

function Destination({ href, children }) {
  return <Link href={href} className={styles.destination}><span>{children}</span><ArrowRight size={15} /></Link>;
}

export default function DashboardModule() {
  const session = useSession();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showRenewal, setShowRenewal] = useState(false);

  async function fetchStats() {
    setLoading(true);
    setError("");
    try { setData(await getDashboardStats()); }
    catch { setError("Không thể tải dữ liệu tổng quan. Vui lòng thử làm mới."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let cancelled = false;
    getDashboardStats().then((result) => { if (!cancelled) setData(result); })
      .catch(() => { if (!cancelled) setError("Không thể tải dữ liệu tổng quan. Vui lòng thử làm mới."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const { accounts, pages, errors = {} } = data || {};
  const user = session?.user;
  const available = accounts ? percent(accounts.live, accounts.total) : null;

  return <div className={styles.dashboard} aria-busy={loading}>
    <div className={styles.heading}><h1>Tổng quan FB Automation</h1><button type="button" className={styles.refresh} onClick={fetchStats} disabled={loading} aria-label="Làm mới tổng quan" title="Làm mới tổng quan"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <DashboardLicenseBanner user={user} onRenew={() => setShowRenewal(true)} />
    <section className={styles.section} aria-labelledby="accounts-overview">
      <h2 id="accounts-overview" className={styles.sectionTitle}><span>1</span>Tổng quan tài khoản Facebook</h2>
      {errors.accounts && <p role="alert" className={styles.error}>{errors.accounts}</p>}
      <div className={styles.overview}>
        <Total icon={UserRound} label="TỔNG SỐ ACCOUNT" value={accounts?.total} href="/accounts" account />
        <div className={styles.accountMetrics}>
          <Metric label="Live" value={accounts?.live} ratio={available} showRatio={false} />
          <Metric label="Die / Failed" value={accounts?.die} ratio={accounts ? percent(accounts.die, accounts.total) : null} tone="failure" showRatio={false} />
          <div><div className={styles.metricLabel}>Tỷ lệ khả dụng</div><div className={styles.metricValue}>{available == null ? "—" : `${available}%`}</div></div>
        </div>
        <Destination href="/accounts">Đi tới Quản lý tài khoản Facebook</Destination>
      </div>
    </section>
    <section className={styles.section} aria-labelledby="pages-overview">
      <h2 id="pages-overview" className={styles.sectionTitle}><span>2</span>Tổng quan Fanpage</h2>
      {errors.pages && <p role="alert" className={styles.error}>{errors.pages}</p>}
      <div className={styles.overview}>
        <Total icon={Flag} label="TỔNG SỐ FANPAGE" value={pages?.total} href="/creator/history" />
        <div className={styles.pageMetrics}>
          <Metric label="Đã khởi tạo thành công" value={pages?.success} ratio={pages ? percent(pages.success, pages.total) : null} icon={CheckCircle2} />
          <Metric label="Đã khởi tạo thất bại" value={pages?.failed} ratio={pages ? percent(pages.failed, pages.total) : null} icon={XCircle} tone="failure" />
        </div>
        <Destination href="/creator/create">Đi tới Tạo Fanpage</Destination>
      </div>
      {pages?.other > 0 && <p className={styles.note}>{pages.other} kết quả đang xử lý hoặc có trạng thái khác. Tổng Fanpage tính theo lượt tạo được ghi nhận.</p>}
    </section>
    <footer className={styles.support}>
      <div><Headset size={17} /><span>Cần trợ giúp kích hoạt lại tài khoản bản quyền hoặc thay đổi thiết bị HWID?</span></div>
      <nav aria-label="Hỗ trợ bản quyền"><a href={SUPPORT.telegram.url} target="_blank" rel="noreferrer">Liên hệ Kỹ thuật viên</a><span>•</span><button type="button" onClick={() => setShowRenewal((open) => !open)} aria-expanded={showRenewal} aria-controls="dashboard-renewal">Hướng dẫn gia hạn</button></nav>
    </footer>
    {showRenewal && <RenewalContactDialog onClose={() => setShowRenewal(false)} />}
  </div>;
}
