import { User } from "@/lib/api";
import {
  IconCheck,
  IconEye,
  IconEdit,
  IconLockSmall,
  IconUnlock,
} from "./AdminIcons";
import { fmtDateTime, fmtDate, initials } from "../utils";

interface AdminTableProps {
  loading: boolean;
  pageItems: User[];
  allSelected: boolean;
  selectedIds: number[];
  safePage: number;
  pageSize: number;
  totalPages: number;
  rangeStart: number;
  rangeEnd: number;
  totalFiltered: number;
  toggleAll: () => void;
  toggleOne: (id: number) => void;
  setPage: (page: number) => void;
  onView: (user: User) => void;
  onEdit: (user: User) => void;
  onBan: (user: User) => void;
  onUnban: (user: User) => void;
}

function getPageNumbers(current: number, total: number): (number | string)[] {
  if (total <= 5) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  if (current <= 3) {
    return [1, 2, 3, "...", total];
  }
  if (current >= total - 2) {
    return [1, "...", total - 2, total - 1, total];
  }
  return [1, "...", current, "...", total];
}

export function AdminTable({
  loading,
  pageItems,
  allSelected,
  selectedIds,
  safePage,
  pageSize,
  totalPages,
  rangeStart,
  rangeEnd,
  totalFiltered,
  toggleAll,
  toggleOne,
  setPage,
  onView,
  onEdit,
  onBan,
  onUnban,
}: AdminTableProps) {
  if (loading) {
    return <div className="adm-loading">Đang tải danh sách admin...</div>;
  }

  return (
    <div className="adm-table-card">
      <div className="adm-table-scroll">
        <table className="adm-table">
          <thead>
            <tr>
              <th className="adm-th-check">
                <button
                  type="button"
                  className={`adm-check${allSelected ? " adm-check--on" : ""}`}
                  onClick={toggleAll}
                  aria-label="Chọn tất cả"
                >
                  {allSelected && <IconCheck />}
                </button>
              </th>
              <th>Username</th>
              <th className="adm-th-center">Trạng thái</th>
              <th>Đăng nhập gần nhất</th>
              <th>Ngày tạo</th>
              <th className="adm-th-right">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    textAlign: "center",
                    padding: "48px 16px",
                    color: "#94a3b8",
                    fontSize: 14,
                  }}
                >
                  Không tìm thấy admin nào
                </td>
              </tr>
            ) : (
              pageItems.map((u, idx) => {
                const checked = selectedIds.includes(u.id);
                const isLocked = u.status === "banned";
                const ordinal = (safePage - 1) * pageSize + idx + 1;
                const admId = `#ADM-${String(u.id).padStart(3, "0")}`;
                const loginAt = u.last_login_at;

                return (
                  <tr key={u.id} className={checked ? "adm-tr--selected" : ""}>
                    {/* Checkbox */}
                    <td style={{ paddingLeft: 20 }}>
                      <button
                        type="button"
                        className={`adm-check${checked ? " adm-check--on" : ""}`}
                        onClick={() => toggleOne(u.id)}
                        aria-label={`Chọn ${u.username}`}
                      >
                        {checked && <IconCheck />}
                      </button>
                    </td>

                    {/* Username + ID */}
                    <td>
                      <div className="adm-cell-user">
                        <div
                          className={`adm-avatar${
                            isLocked ? " adm-avatar--red" : ""
                          }`}
                        >
                          {isLocked ? (
                            <span style={{ fontSize: 11 }}>
                              {String(ordinal).padStart(2, "0")}
                            </span>
                          ) : (
                            initials(u.username)
                          )}
                        </div>
                        <div>
                          <div
                            className="adm-username"
                            style={{ cursor: "pointer" }}
                            title="Xem chi tiết"
                            onClick={() => onView(u)}
                          >
                            {u.username}
                          </div>
                          <div className="adm-uid">ID: {admId}</div>
                        </div>
                      </div>
                    </td>

                    {/* Trạng thái */}
                    <td style={{ textAlign: "center" }}>
                      {isLocked ? (
                        <span className="adm-pill adm-pill--locked">
                          <span className="adm-pill-dot adm-pill-dot--red" />
                          Đã khóa
                        </span>
                      ) : (
                        <span className="adm-pill adm-pill--active">
                          <span className="adm-pill-dot adm-pill-dot--green" />
                          Hoạt động
                        </span>
                      )}
                    </td>

                    {/* Đăng nhập gần nhất */}
                    <td>
                      <span className="adm-login-time">
                        {fmtDateTime(loginAt)}
                      </span>
                    </td>

                    {/* Ngày tạo */}
                    <td>
                      <span className="adm-date">{fmtDate(u.created_at)}</span>
                    </td>

                    {/* Thao tác */}
                    <td>
                      <div className="adm-actions">
                        {/* View */}
                        <button
                          type="button"
                          className="adm-action-btn"
                          title="Xem chi tiết"
                          onClick={() => onView(u)}
                        >
                          <IconEye />
                        </button>

                        {/* Edit */}
                        <button
                          type="button"
                          className="adm-action-btn"
                          title="Chỉnh sửa"
                          onClick={() => onEdit(u)}
                        >
                          <IconEdit />
                        </button>

                        {/* Lock / Unlock */}
                        <button
                          type="button"
                          className="adm-action-btn adm-action-btn--lock"
                          title={isLocked ? "Mở khóa" : "Khóa tài khoản"}
                          onClick={() => (isLocked ? onUnban(u) : onBan(u))}
                        >
                          {isLocked ? <IconUnlock /> : <IconLockSmall />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination footer ── */}
      <div className="adm-footer">
        <p className="adm-footer-info">
          Hiển thị{" "}
          <strong>
            {rangeStart} - {rangeEnd}
          </strong>{" "}
          trong <strong>{totalFiltered} admin</strong>
          {totalPages > 0 && (
            <span>
              {" "}(Trang <strong>{safePage} / {totalPages}</strong>)
            </span>
          )}
        </p>
        <div className="adm-pager">
          <button
            type="button"
            className="adm-pager-btn"
            disabled={safePage <= 1}
            onClick={() => setPage(safePage - 1)}
          >
            Trước
          </button>
          {getPageNumbers(safePage, totalPages).map((p, i) =>
            typeof p === "number" ? (
              <button
                key={p}
                type="button"
                className={`adm-pager-btn${
                  p === safePage ? " adm-pager-btn--active" : ""
                }`}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            ) : (
              <span key={`ellipsis-${i}`} className="adm-pager-ellipsis" style={{ padding: "0 4px", color: "#94a3b8" }}>
                ...
              </span>
            )
          )}
          <button
            type="button"
            className="adm-pager-btn"
            disabled={safePage >= totalPages}
            onClick={() => setPage(safePage + 1)}
          >
            Sau
          </button>
        </div>
      </div>
    </div>
  );
}
