import { IconTotalAdmin, IconActive, IconLocked } from "./AdminIcons";

interface AdminMetricsProps {
  totalAdmins: number;
  activeAdmins: number;
  lockedAdmins: number;
  activePct: number;
}

export function AdminMetrics({
  totalAdmins,
  activeAdmins,
  lockedAdmins,
  activePct,
}: AdminMetricsProps) {
  return (
    <div className="adm-metrics">
      {/* Tổng Admin */}
      <div className="adm-metric-card adm-metric-card--total">
        <div className="adm-metric-body">
          <span className="adm-metric-label">TỔNG ADMIN</span>
          <div className="adm-metric-row">
            <span className="adm-metric-value">{totalAdmins}</span>
          </div>
        </div>
        <div className="adm-metric-icon adm-metric-icon--blue">
          <IconTotalAdmin />
        </div>
      </div>

      {/* Đang hoạt động */}
      <div className="adm-metric-card adm-metric-card--active">
        <div className="adm-metric-body">
          <span className="adm-metric-label">ĐANG HOẠT ĐỘNG</span>
          <div className="adm-metric-row">
            <span className="adm-metric-value">{activeAdmins}</span>
            <span className="adm-metric-badge adm-metric-badge--green">
              <span className="adm-metric-dot adm-metric-dot--green" />
              {activePct}%
            </span>
          </div>
        </div>
        <div className="adm-metric-icon adm-metric-icon--green">
          <IconActive />
        </div>
      </div>

      {/* Đã khóa */}
      <div className="adm-metric-card adm-metric-card--locked">
        <div className="adm-metric-body">
          <span className="adm-metric-label">ĐÃ KHÓA</span>
          <div className="adm-metric-row">
            <span className="adm-metric-value">{lockedAdmins}</span>
            {lockedAdmins > 0 && (
              <span className="adm-metric-badge adm-metric-badge--red">
                Tạm ngưng
              </span>
            )}
          </div>
        </div>
        <div className="adm-metric-icon adm-metric-icon--red">
          <IconLocked />
        </div>
      </div>
    </div>
  );
}
