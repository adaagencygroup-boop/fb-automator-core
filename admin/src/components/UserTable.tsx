"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { User, api } from "@/lib/api";
import ApprovalModal from "./ApprovalModal";
import AdminUserModal from "./AdminUserModal";
import "./UserTable.css";

const MENU_WIDTH = 240;
const MENU_EST_HEIGHT = 260;

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  rangeStart: number;
  rangeEnd: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (n: number) => void;
}

export interface VisibleColumns {
  phone: boolean;
  hwid: boolean;
  status: boolean;
  expiry: boolean;
  activity: boolean;
  createdAt: boolean;
}

export const DEFAULT_VISIBLE_COLUMNS: VisibleColumns = {
  phone: true,
  hwid: true,
  status: true,
  expiry: true,
  activity: true,
  createdAt: true,
};

interface Props {
  users: User[];
  allFilteredCount: number;
  selectedIds: number[];
  onSelectionChange: (ids: number[]) => void;
  onRefresh: () => void;
  pagination: PaginationProps;
  visibleColumns?: VisibleColumns;
}

function StatusDot({ tone }: { tone: "green" | "amber" | "red" | "slate" }) {
  return <span aria-hidden className={`ut-dot ut-dot--${tone}`} />;
}

function StatusPill({ status, daysRemaining }: { status: string; daysRemaining: number | null }) {
  if (status === "pending") {
    return (
      <span className="ut-pill ut-pill--pending">
        <StatusDot tone="amber" />
        Chờ duyệt
      </span>
    );
  }
  if (status === "banned") {
    return (
      <span className="ut-pill ut-pill--banned">
        <StatusDot tone="slate" />
        Bị khóa
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="ut-pill ut-pill--rejected">
        <StatusDot tone="red" />
        Bị từ chối
      </span>
    );
  }
  if (status === "expired" || (daysRemaining !== null && daysRemaining <= 0)) {
    return (
      <span className="ut-pill ut-pill--expired">
        <StatusDot tone="red" />
        Hết hạn
      </span>
    );
  }
  return (
    <span className="ut-pill ut-pill--approved">
      <StatusDot tone="green" />
      Đã duyệt
    </span>
  );
}

function parseApiDate(iso?: string | null): Date | null {
  if (!iso) return null;
  try {
    const s = iso.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) return dt;
    const fallback = new Date(iso);
    return isNaN(fallback.getTime()) ? null : fallback;
  } catch {
    return null;
  }
}

function fmtLocalDate(iso?: string | null): string {
  const d = parseApiDate(iso);
  if (!d) return "—";
  return d.toLocaleDateString("vi-VN");
}

function fmtLocalDateTime(iso?: string | null): string {
  const d = parseApiDate(iso);
  if (!d) return "—";
  return d.toLocaleString("vi-VN");
}

function formatRelativeActivity(
  lastActiveAt?: string | null,
  isOnline?: boolean,
  lastLoginAt?: string | null
): { label: string; tone: "green" | "amber" | "slate" } {
  if (isOnline) {
    return { label: "Đang hoạt động", tone: "green" };
  }

  const effectiveTimeStr = lastActiveAt || lastLoginAt;
  if (!effectiveTimeStr) {
    return { label: "—", tone: "slate" };
  }

  const dt = parseApiDate(effectiveTimeStr);
  const time = dt ? dt.getTime() : 0;
  const diffMs = Date.now() - time;
  if (Number.isNaN(diffMs) || diffMs < 0) return { label: "Vừa xong", tone: "green" };

  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return { label: "Vừa xong", tone: "green" };
  if (mins < 60) return { label: `${mins} phút trước`, tone: "green" };
  const hours = Math.floor(mins / 60);
  if (hours < 24) return { label: `${hours} giờ trước`, tone: "amber" };
  const days = Math.floor(hours / 24);
  if (days < 7) return { label: `${days} ngày trước`, tone: "slate" };
  return { label: fmtLocalDate(effectiveTimeStr), tone: "slate" };
}

function ActivityCell({
  status,
  lastLoginAt,
  lastActiveAt,
  isOnline,
}: {
  status: string;
  lastLoginAt?: string | null;
  lastActiveAt?: string | null;
  isOnline?: boolean;
}) {
  const effectiveTimeStr = lastActiveAt || lastLoginAt;
  // Với tài khoản Chờ duyệt hoặc chưa từng có hoạt động/đăng nhập: hiển thị dấu gạch ngang (—)
  if (status === "pending" || (!effectiveTimeStr && !isOnline)) {
    return <span className="ut-dash" title="Chưa đăng nhập">—</span>;
  }

  const { label, tone } = formatRelativeActivity(lastActiveAt, isOnline, lastLoginAt);

  if (label === "Đang hoạt động") {
    return (
      <span
        className="ut-pill ut-pill--activity ut-pill--approved"
        title={effectiveTimeStr ? `Đang hoạt động (Đăng nhập: ${fmtLocalDateTime(effectiveTimeStr)})` : "Đang hoạt động"}
      >
        <StatusDot tone="green" />
        Đang hoạt động
      </span>
    );
  }

  const pillClass =
    status === "banned"
      ? "ut-pill--banned"
      : tone === "green"
        ? "ut-pill--approved"
        : tone === "amber"
          ? "ut-pill--pending"
          : "ut-pill--banned";

  return (
    <span
      className={`ut-pill ut-pill--activity ${pillClass}`}
      title={effectiveTimeStr ? `Hoạt động/Đăng xuất gần nhất: ${fmtLocalDateTime(effectiveTimeStr)}` : ""}
    >
      <StatusDot tone={tone} />
      {label}
    </span>
  );
}

function truncateHwid(hwid: string) {
  if (hwid.length <= 12) return hwid;
  return `${hwid.slice(0, 12)}...`;
}

interface TableCol {
  label: string;
  align: "left" | "center" | "right";
  key?: keyof VisibleColumns;
}

const ALL_COLS: TableCol[] = [
  { label: "USERNAME", align: "left" },
  { label: "SĐT", align: "left", key: "phone" },
  { label: "HWID", align: "left", key: "hwid" },
  { label: "TRẠNG THÁI", align: "center", key: "status" },
  { label: "HẾT HẠN", align: "center", key: "expiry" },
  { label: "HOẠT ĐỘNG", align: "center", key: "activity" },
  { label: "NGÀY TẠO", align: "center", key: "createdAt" },
  { label: "THAO TÁC", align: "right" },
];

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

export default function UserTable({
  users,
  selectedIds,
  onSelectionChange,
  onRefresh,
  pagination,
  visibleColumns = DEFAULT_VISIBLE_COLUMNS,
}: Props) {
  const [selectedUserForApprove, setSelectedUserForApprove] = useState<User | null>(null);
  const [selectedUserForExtend, setSelectedUserForExtend] = useState<User | null>(null);
  const [selectedUserForEdit, setSelectedUserForEdit] = useState<User | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [menuUserId, setMenuUserId] = useState<number | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const menuBtnRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Tự động re-render thời gian tương đối (Vừa xong, X phút trước...) mỗi 30 giây mà không cần F5
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  const closeMenu = () => {
    setMenuUserId(null);
    setMenuPos(null);
  };

  const calculatePos = (userId: number) => {
    const btn = menuBtnRefs.current[userId];
    if (!btn) return null;
    const rect = btn.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, rect.right - MENU_WIDTH),
      window.innerWidth - MENU_WIDTH - 8
    );
    const top = rect.bottom + 6;
    return { top, left };
  };

  const toggleMenu = (userId: number) => {
    if (menuUserId === userId) {
      closeMenu();
      return;
    }
    const initialPos = calculatePos(userId);
    setMenuPos(initialPos);
    setMenuUserId(userId);
  };

  const menuUser = menuUserId != null ? users.find((u) => u.id === menuUserId) ?? null : null;

  useLayoutEffect(() => {
    if (menuUserId == null) {
      setMenuPos(null);
      return;
    }
    const exactPos = calculatePos(menuUserId);
    if (exactPos) {
      setMenuPos((prev) => {
        if (prev && prev.top === exactPos.top && prev.left === exactPos.left) return prev;
        return exactPos;
      });
    }
  }, [menuUserId]);

  useEffect(() => {
    if (menuUserId == null) return;

    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (menuBtnRefs.current[menuUserId]?.contains(t)) return;
      closeMenu();
    };
    const onReposition = () => {
      if (menuUserId != null) {
        const newPos = calculatePos(menuUserId);
        if (newPos) setMenuPos(newPos);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };

    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuUserId]);

  const allSelected = users.length > 0 && users.every((u) => selectedIds.includes(u.id));

  const toggleAll = () => {
    if (allSelected) {
      onSelectionChange(selectedIds.filter((id) => !users.some((u) => u.id === id)));
    } else {
      const merged = new Set([...selectedIds, ...users.map((u) => u.id)]);
      onSelectionChange([...merged]);
    }
  };

  const toggleOne = (id: number) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((x) => x !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  };

  const copyHwid = async (hwid: string) => {
    try {
      await navigator.clipboard.writeText(hwid);
    } catch {
      alert("Không copy được HWID");
    }
  };

  const handleBan = async (user: User) => {
    if (user.status === "banned") {
      window.dispatchEvent(
        new CustomEvent("app_toast", {
          detail: { msg: "Tài khoản được chọn đã ở trạng thái bị khóa", type: "error" },
        })
      );
      closeMenu();
      return;
    }
    if (user.status === "rejected") {
      window.dispatchEvent(
        new CustomEvent("app_toast", {
          detail: { msg: "Tài khoản được chọn đã ở trạng thái bị từ chối", type: "error" },
        })
      );
      closeMenu();
      return;
    }
    if (!confirm(`Bạn có chắc chắn muốn KHÓA tài khoản ${user.username}?`)) return;
    setActionLoading(user.id);
    try {
      await api.banUser(user.id);
      onRefresh();
    } catch (e: any) {
      alert(e.message || "Lỗi khi khóa tài khoản");
    } finally {
      setActionLoading(null);
      closeMenu();
    }
  };

  const handleUnban = async (user: User) => {
    if (!confirm(`Xác nhận MỞ KHÓA tài khoản ${user.username}?`)) return;
    setActionLoading(user.id);
    try {
      const res: any = await api.unbanUser(user.id);
      const statusMap: Record<string, string> = {
        pending: "Chờ duyệt",
        approved: "Đã duyệt",
        rejected: "Bị từ chối",
        expired: "Hết hạn",
      };
      const restoredStatusName = (res && res.status && statusMap[res.status]) || "";
      const toastMsg = restoredStatusName
        ? `Đã mở khóa tài khoản ${user.username} và khôi phục trạng thái: ${restoredStatusName}`
        : `Đã mở khóa tài khoản ${user.username}`;
      window.dispatchEvent(
        new CustomEvent("app_toast", {
          detail: { msg: toastMsg, type: "success" },
        })
      );
      onRefresh();
    } catch (e: any) {
      alert(e.message || "Lỗi khi mở khóa tài khoản");
    } finally {
      setActionLoading(null);
      closeMenu();
    }
  };

  const handleDelete = async (user: User) => {
    if (!confirm(`CẢNH BÁO: XÓA VĨNH VIỄN tài khoản ${user.username}? Hành động không thể hoàn tác.`))
      return;
    setActionLoading(user.id);
    try {
      await api.deleteUser(user.id);
      onRefresh();
    } catch (e: any) {
      alert(e.message || "Lỗi khi xóa tài khoản");
    } finally {
      setActionLoading(null);
      closeMenu();
    }
  };

  const handleResetHwid = async (user: User) => {
    if (!confirm(`Reset HWID của ${user.username}? Thiết bị hiện tại sẽ bị hủy liên kết.`)) return;
    setActionLoading(user.id);
    try {
      await api.resetHwid(user.id);
      onRefresh();
    } catch (e: any) {
      alert(e.message || "Lỗi khi reset HWID");
    } finally {
      setActionLoading(null);
      closeMenu();
    }
  };

  return (
    <>
      <div className="ut-wrap">
        <div className="ut-scroll">
          {(() => {
            const visibleColList = ALL_COLS.filter(
              (col) => !col.key || visibleColumns[col.key]
            );
            const totalColSpan = 1 + visibleColList.length;

            return (
              <table className="ut-table">
                <thead>
                  <tr className="ut-thead-row">
                    <th className="ut-th ut-th--check">
                      <button
                        type="button"
                        onClick={toggleAll}
                        className={`ut-check${allSelected ? " ut-check--on" : ""}`}
                        aria-label="Chọn tất cả"
                      >
                        {allSelected && <img src="/icons/users-check.svg" alt="" />}
                      </button>
                    </th>
                    {visibleColList.map((col) => (
                      <th key={col.label} className={`ut-th ut-th--${col.align}`}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={totalColSpan} className="ut-empty">
                        Không tìm thấy người dùng nào
                      </td>
                    </tr>
                  ) : (
                    users.map((u) => {
                      const checked = selectedIds.includes(u.id);
                      return (
                        <tr
                          key={u.id}
                          className={`ut-row${checked ? " ut-row--selected" : ""}`}
                        >
                          <td className="ut-td ut-td--check">
                            <button
                              type="button"
                              onClick={() => toggleOne(u.id)}
                              className={`ut-check${checked ? " ut-check--on" : ""}`}
                              aria-label={`Chọn ${u.username}`}
                            >
                              {checked && <img src="/icons/users-check.svg" alt="" />}
                            </button>
                          </td>

                          <td className="ut-td">
                            <div>
                              <div className="ut-user-name">{u.username}</div>
                              <div className="ut-user-uid">UID: #{u.id}</div>
                            </div>
                          </td>

                          {visibleColumns.phone && (
                            <td className="ut-td ut-phone">{u.contact_info || "—"}</td>
                          )}

                          {visibleColumns.hwid && (
                            <td className="ut-td">
                              {u.hwid ? (
                                <div className="ut-hwid">
                                  <img src="/icons/users-hwid-key.svg" alt="" width={12} height={9} />
                                  <span className="ut-hwid-text">{truncateHwid(u.hwid)}</span>
                                  <button
                                    type="button"
                                    onClick={() => copyHwid(u.hwid!)}
                                    className="ut-hwid-copy"
                                    title="Copy HWID"
                                  >
                                    <img src="/icons/users-copy.svg" alt="" width={9} height={10} />
                                  </button>
                                </div>
                              ) : (
                                <span className="ut-hwid-empty">Chưa liên kết</span>
                              )}
                            </td>
                          )}

                          {visibleColumns.status && (
                            <td className="ut-td ut-td--center">
                              <StatusPill status={u.status} daysRemaining={u.days_remaining} />
                            </td>
                          )}

                          {visibleColumns.expiry && (
                            <td className="ut-td ut-td--center">
                              {u.expired_at ? (
                                <span className="ut-expiry">
                                  <img src="/icons/users-calendar-sm.svg" alt="" width={10} height={12} />
                                  {fmtLocalDate(u.expired_at)}
                                </span>
                              ) : u.status === "approved" ? (
                                <span className="ut-expiry text-amber-600 font-medium text-xs">
                                  Chưa cấp hạn
                                </span>
                              ) : (
                                <span className="ut-dash">—</span>
                              )}
                            </td>
                          )}

                          {visibleColumns.activity && (
                            <td className="ut-td ut-td--center">
                              <ActivityCell
                                status={u.status}
                                lastLoginAt={u.last_login_at}
                                lastActiveAt={u.last_active_at}
                                isOnline={u.is_online}
                              />
                            </td>
                          )}

                          {visibleColumns.createdAt && (
                            <td className="ut-td ut-date">
                              {fmtLocalDate(u.created_at)}
                            </td>
                          )}

                          <td className="ut-td ut-td--actions">
                            <div className="ut-actions">
                              <Link
                                href={`/dashboard/users/${u.id}`}
                                className="ut-action-btn"
                                title="Xem chi tiết"
                              >
                                <img src="/icons/users-eye.svg" alt="" width={16} height={16} />
                              </Link>

                              {u.status === "rejected" ? (
                                <button
                                  type="button"
                                  className="ut-action-btn opacity-35 cursor-not-allowed pointer-events-auto"
                                  title="Tài khoản bị từ chối chỉ được phép xem"
                                  disabled
                                >
                                  <img src="/icons/users-edit.svg" alt="" width={16} height={16} />
                                </button>
                              ) : (
                                <Link
                                  href={`/dashboard/users/${u.id}/edit`}
                                  className="ut-action-btn"
                                  title="Sửa"
                                >
                                  <img src="/icons/users-edit.svg" alt="" width={16} height={16} />
                                </Link>
                              )}

                              <div className="ut-action-menu-wrap">
                                <button
                                  type="button"
                                  ref={(el) => {
                                    menuBtnRefs.current[u.id] = el;
                                  }}
                                  onClick={() => toggleMenu(u.id)}
                                  className="ut-action-btn"
                                  title="Thêm thao tác"
                                  disabled={actionLoading === u.id}
                                  aria-expanded={menuUserId === u.id}
                                >
                                  <img src="/icons/users-more.svg" alt="" width={4} height={16} />
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            );
          })()}
        </div>

        <div className="ut-footer">
          <p className="ut-footer-text">
            Hiển thị{" "}
            <span className="ut-footer-strong">
              {pagination.rangeStart} - {pagination.rangeEnd}
            </span>{" "}
            của <span className="ut-footer-strong">{pagination.total}</span> người dùng
            {pagination.totalPages > 0 && (
              <span className="ut-footer-page-info">
                {" "}(Trang <span className="ut-footer-strong">{pagination.page} / {pagination.totalPages}</span>)
              </span>
            )}
          </p>

          <div className="ut-footer-controls">
            <div className="ut-page-size">
              <select
                value={pagination.pageSize}
                onChange={(e) => pagination.onPageSizeChange(Number(e.target.value))}
              >
                {[10, 20, 50].map((n) => (
                  <option key={n} value={n}>
                    {n} / trang
                  </option>
                ))}
              </select>
              <img
                src="/icons/users-chevron-sm-down.svg"
                alt=""
                className="ut-page-size-chevron"
              />
            </div>

            <div className="ut-pager">
              <button
                type="button"
                disabled={pagination.page <= 1}
                onClick={() => pagination.onPageChange(pagination.page - 1)}
                className="ut-pager-btn"
                title="Trang trước"
              >
                <img src="/icons/users-chevron-left.svg" alt="" width={5} height={9} />
              </button>
              {getPageNumbers(pagination.page, pagination.totalPages).map((p, idx) =>
                typeof p === "number" ? (
                  <button
                    key={p}
                    type="button"
                    onClick={() => pagination.onPageChange(p)}
                    className={`ut-pager-btn ${p === pagination.page ? "ut-pager-btn--current" : ""
                      }`}
                  >
                    {p}
                  </button>
                ) : (
                  <span key={`ellipsis-${idx}`} className="ut-pager-ellipsis">
                    ...
                  </span>
                )
              )}
              <button
                type="button"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => pagination.onPageChange(pagination.page + 1)}
                className="ut-pager-btn"
                title="Trang sau"
              >
                <img src="/icons/users-chevron-right.svg" alt="" width={5} height={9} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <ApprovalModal
        user={selectedUserForApprove}
        onClose={() => setSelectedUserForApprove(null)}
        onSuccess={onRefresh}
      />

      <ApprovalModal
        user={selectedUserForExtend}
        mode="extend"
        onClose={() => setSelectedUserForExtend(null)}
        onSuccess={onRefresh}
      />

      <AdminUserModal
        user={selectedUserForEdit}
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setSelectedUserForEdit(null);
        }}
        onSuccess={onRefresh}
      />

      {menuUser &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            className="ut-menu"
            style={{ top: menuPos.top, left: menuPos.left }}
            role="menu"
          >
            <div className="ut-menu-title">
              THAO TÁC • {menuUser.username.toUpperCase()}
            </div>
            {menuUser.status === "banned" ? (
              <button
                type="button"
                className="ut-menu-item"
                onClick={() => handleUnban(menuUser)}
              >
                <span className="ut-menu-icon ut-menu-icon--unlock" aria-hidden />
                Mở khóa
              </button>
            ) : menuUser.status === "rejected" ? (
              <button
                type="button"
                className="ut-menu-item ut-menu-item--approve"
                onClick={() => {
                  setSelectedUserForApprove(menuUser);
                  closeMenu();
                }}
              >
                <span className="ut-menu-icon ut-menu-icon--approve" aria-hidden />
                Phê duyệt lại
              </button>
            ) : (
              <>
                {menuUser.status === "pending" ? (
                  <button
                    type="button"
                    className="ut-menu-item ut-menu-item--approve"
                    onClick={() => {
                      setSelectedUserForApprove(menuUser);
                      closeMenu();
                    }}
                  >
                    <span className="ut-menu-icon ut-menu-icon--approve" aria-hidden />
                    Phê duyệt người dùng
                  </button>
                ) : (
                  <button
                    type="button"
                    className="ut-menu-item"
                    onClick={() => {
                      if (menuUser) {
                        setSelectedUserForExtend(menuUser);
                        closeMenu();
                      }
                    }}
                  >
                    <span className="ut-menu-icon ut-menu-icon--extend" aria-hidden />
                    Gia hạn
                  </button>
                )}
                <button
                  type="button"
                  className="ut-menu-item"
                  onClick={() => menuUser && handleResetHwid(menuUser)}
                >
                  <span className="ut-menu-icon ut-menu-icon--hwid" aria-hidden />
                  Đặt lại HWID
                </button>
                <button
                  type="button"
                  className="ut-menu-item"
                  onClick={() => menuUser && handleBan(menuUser)}
                >
                  <span className="ut-menu-icon ut-menu-icon--lock" aria-hidden />
                  Khoá tài khoản
                </button>
              </>
            )}
            <button
              type="button"
              className="ut-menu-item"
              onClick={() => menuUser && handleDelete(menuUser)}
            >
              <span className="ut-menu-icon ut-menu-icon--delete" aria-hidden />
              Xoá người dùng
            </button>
          </div>,
          document.body
        )}
    </>
  );
}
