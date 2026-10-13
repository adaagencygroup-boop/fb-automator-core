"use client";

import React, { useState, useEffect, useMemo, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { api, getVpsBase, User, Stats } from "@/lib/api";
import UserTable, { VisibleColumns, DEFAULT_VISIBLE_COLUMNS } from "@/components/UserTable";
import AdminUserModal from "@/components/AdminUserModal";
import { AlertCircle } from "lucide-react";
import "./users.css";

type DateFilterType = "all" | "today" | "7d" | "30d" | "custom";

const COLUMN_CONFIG: { key: keyof VisibleColumns; label: string }[] = [
  { key: "phone", label: "Số điện thoại / Liên hệ" },
  { key: "hwid", label: "Mã HWID thiết bị" },
  { key: "status", label: "Trạng thái tài khoản" },
  { key: "expiry", label: "Thời hạn / Hết hạn" },
  { key: "activity", label: "Thời gian hoạt động" },
  { key: "createdAt", label: "Ngày tạo" },
];

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

function UsersPageContent() {
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get("status") || "all";

  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>(initialStatus);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // 1. Date Range Filter State
  const [dateFilter, setDateFilter] = useState<DateFilterType>("all");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");
  const [isDateOpen, setIsDateOpen] = useState(false);
  const dateRef = useRef<HTMLDivElement | null>(null);

  const isDateRangeInvalid = Boolean(
    dateFilter === "custom" &&
    customStartDate &&
    customEndDate &&
    customEndDate < customStartDate
  );

  // 3. Column Customization State
  const [visibleColumns, setVisibleColumns] = useState<VisibleColumns>(DEFAULT_VISIBLE_COLUMNS);
  const [isColumnOpen, setIsColumnOpen] = useState(false);
  const colRef = useRef<HTMLDivElement | null>(null);

  // Load saved visible columns from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("user_table_columns");
      if (saved) {
        setVisibleColumns((prev) => ({ ...prev, ...JSON.parse(saved) }));
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  // Click outside to close dropdown popovers
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dateRef.current && !dateRef.current.contains(e.target as Node)) {
        setIsDateOpen(false);
      }
      if (colRef.current && !colRef.current.contains(e.target as Node)) {
        setIsColumnOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleToggleColumn = (key: keyof VisibleColumns) => {
    setVisibleColumns((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem("user_table_columns", JSON.stringify(next));
      } catch (e) {
        console.error(e);
      }
      return next;
    });
  };

  const handleResetColumns = () => {
    setVisibleColumns(DEFAULT_VISIBLE_COLUMNS);
    try {
      localStorage.removeItem("user_table_columns");
    } catch (e) {
      console.error(e);
    }
  };

  const getDateLabel = () => {
    switch (dateFilter) {
      case "today":
        return "Hôm nay";
      case "7d":
        return "7 ngày qua";
      case "30d":
        return "30 ngày qua";
      case "custom":
        if (isDateRangeInvalid) {
          return "Khoảng ngày không hợp lệ";
        }
        return customStartDate || customEndDate ? "Tùy chỉnh (Đang lọc)" : "Tùy chỉnh";
      default:
        return "Thời gian";
    }
  };

  const loadUsers = async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const [data, s] = await Promise.all([
        api.getUsers(filterStatus === "all" ? undefined : filterStatus),
        api.getStats().catch(() => null),
      ]);
      const regularUsers = (data || []).filter(
        (u) => u.role !== "admin" && u.role !== "ADMIN"
      );
      setUsers(regularUsers);
      if (s) setStats(s);
    } catch (e) {
      console.error(e);
      setTimeout(() => {
        loadUsers(false);
      }, 3000);
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers(true);
    setPage(1);
    setSelectedIds([]);

    const VPS_BASE = getVpsBase();
    const es = new EventSource(`${VPS_BASE}/api/v1/admin/notifications/stream`);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (
          data.type === "NEW_REGISTRATION" ||
          data.type === "USER_STATUS_CHANGE" ||
          data.type === "USER_LOGOUT" ||
          data.type === "USER_LOGIN" ||
          data.type === "connected"
        ) {
          loadUsers(false);
        }
      } catch (e) {
        console.error("SSE parse error", e);
      }
    };

    // Tự động kiểm tra cập nhật ngầm dự phòng mỗi 45s (Realtime SSE đã xử lý sự kiện tức thời)
    const pollInterval = setInterval(() => {
      loadUsers(false);
    }, 45000);

    return () => {
      es.close();
      clearInterval(pollInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus]);

  const filteredUsers = useMemo(
    () =>
      users.filter((u) => {
        // Search term filter
        const matchesSearch =
          !searchTerm ||
          u.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
          u.contact_info.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (u.hwid && u.hwid.toLowerCase().includes(searchTerm.toLowerCase())) ||
          String(u.id).includes(searchTerm);

        if (!matchesSearch) return false;

        // Date range filter based on created_at
        if (dateFilter !== "all") {
          const d = parseApiDate(u.created_at);
          const createdTime = d ? d.getTime() : NaN;
          if (isNaN(createdTime)) return true;

          if (dateFilter === "today") {
            const now = new Date();
            if (
              !d ||
              d.getFullYear() !== now.getFullYear() ||
              d.getMonth() !== now.getMonth() ||
              d.getDate() !== now.getDate()
            ) {
              return false;
            }
          } else if (dateFilter === "7d") {
            const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
            if (createdTime < sevenDaysAgo) return false;
          } else if (dateFilter === "30d") {
            const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
            if (createdTime < thirtyDaysAgo) return false;
          } else if (dateFilter === "custom") {
            // Không áp dụng lọc khi khoảng ngày không hợp lệ (Đến ngày < Từ ngày)
            if (isDateRangeInvalid) {
              return true;
            }
            if (customStartDate) {
              const start = new Date(`${customStartDate}T00:00:00`).getTime();
              if (createdTime < start) return false;
            }
            if (customEndDate) {
              const end = new Date(`${customEndDate}T23:59:59.999`).getTime();
              if (createdTime > end) return false;
            }
          }
        }

        return true;
      }),
    [users, searchTerm, dateFilter, customStartDate, customEndDate]
  );

  // 2. Export to Excel (Zero-Dependency XML Spreadsheet) Handler
  const handleExportExcel = () => {
    if (filteredUsers.length === 0) {
      window.dispatchEvent(
        new CustomEvent("app_toast", {
          detail: { msg: "Không có dữ liệu người dùng để xuất", type: "error" },
        })
      );
      return;
    }

    const headers = [
      "ID",
      "Username",
      "SĐT / Liên hệ",
      "HWID",
      "Trạng thái",
      "Ngày hết hạn",
      "Ngày tạo",
    ];

    const getStatusText = (st: string, days: number | null) => {
      if (st === "pending") return "Chờ duyệt";
      if (st === "banned") return "Bị khóa";
      if (st === "rejected") return "Bị từ chối";
      if (st === "expired" || (days !== null && days <= 0)) return "Hết hạn";
      return "Đã duyệt";
    };

    const escapeXml = (str: string) => {
      return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
    };

    const rows = filteredUsers.map((u) => [
      `#${u.id}`,
      u.username || "",
      u.contact_info || "—",
      u.hwid || "Chưa liên kết",
      getStatusText(u.status, u.days_remaining),
      u.expired_at
        ? (parseApiDate(u.expired_at)?.toLocaleDateString("vi-VN") || "—")
        : u.status === "approved"
        ? "Chưa cấp hạn"
        : "—",
      parseApiDate(u.created_at)?.toLocaleDateString("vi-VN") || "—",
    ]);

    const headerXml = headers
      .map(
        (h) =>
          `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`
      )
      .join("");

    const rowsXml = rows
      .map((r) => {
        const cells = r
          .map(
            (val, cIdx) =>
              `<Cell ss:StyleID="${cIdx === 0 || cIdx >= 4 ? "Center" : "Left"}"><Data ss:Type="String">${escapeXml(val)}</Data></Cell>`
          )
          .join("");
        return `<Row ss:Height="22">${cells}</Row>`;
      })
      .join("\n");

    const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:html="http://www.w3.org/TR/REC-html40">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Alignment ss:Vertical="Center"/>
      <Font ss:FontName="Segoe UI" ss:Size="10" ss:Color="#334155"/>
    </Style>
    <Style ss:ID="Header">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
      <Font ss:FontName="Segoe UI" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>
      <Interior ss:Color="#2563EB" ss:Pattern="Solid"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1D4ED8"/>
      </Borders>
    </Style>
    <Style ss:ID="Left">
      <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
      </Borders>
    </Style>
    <Style ss:ID="Center">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
      </Borders>
    </Style>
  </Styles>
  <Worksheet ss:Name="Danh sách người dùng">
    <Table>
      <Column ss:Width="65"/>
      <Column ss:Width="130"/>
      <Column ss:Width="120"/>
      <Column ss:Width="260"/>
      <Column ss:Width="110"/>
      <Column ss:Width="110"/>
      <Column ss:Width="110"/>
      <Row ss:Height="26">
        ${headerXml}
      </Row>
      ${rowsXml}
    </Table>
  </Worksheet>
</Workbook>`;

    const blob = new Blob([xmlContent], {
      type: "application/vnd.ms-excel;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `danh_sach_nguoi_dung_${new Date().toISOString().slice(0, 10)}.xls`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    window.dispatchEvent(
      new CustomEvent("app_toast", {
        detail: {
          msg: `Đã xuất thành công ${filteredUsers.length} người dùng ra file Excel`,
          type: "success",
        },
      })
    );
  };

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageUsers = filteredUsers.slice((safePage - 1) * pageSize, safePage * pageSize);
  const rangeStart = filteredUsers.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, filteredUsers.length);

  const selectedUsers = useMemo(
    () => users.filter((u) => selectedIds.includes(u.id)),
    [users, selectedIds]
  );
  const allSelectedCannotBan =
    selectedUsers.length > 0 && selectedUsers.every((u) => u.status === "banned" || u.status === "rejected");
  const isBulkBanDisabled = selectedIds.length === 0 || allSelectedCannotBan;
  const bulkBanTitle =
    selectedIds.length === 0
      ? "Vui lòng chọn ít nhất một người dùng để thực hiện"
      : allSelectedCannotBan
      ? "Tài khoản được chọn đã ở trạng thái bị khóa hoặc bị từ chối"
      : "Khóa các tài khoản đã chọn";

  const isBulkDeleteDisabled = selectedIds.length === 0;
  const bulkDeleteTitle =
    selectedIds.length === 0
      ? "Vui lòng chọn ít nhất một người dùng để thực hiện"
      : "Xóa vĩnh viễn các tài khoản đã chọn";

  const handleBulkBan = async () => {
    if (selectedIds.length === 0) {
      window.dispatchEvent(
        new CustomEvent("app_toast", {
          detail: { msg: "Vui lòng chọn ít nhất một người dùng để thực hiện", type: "error" },
        })
      );
      return;
    }

    const activeToBan = selectedUsers.filter((u) => u.status !== "banned" && u.status !== "rejected");
    if (activeToBan.length === 0) {
      window.dispatchEvent(
        new CustomEvent("app_toast", {
          detail: { msg: "Tài khoản được chọn đã ở trạng thái bị khóa hoặc bị từ chối", type: "error" },
        })
      );
      return;
    }

    const skippedCount = selectedUsers.length - activeToBan.length;
    const confirmMsg =
      skippedCount > 0
        ? `Khóa ${activeToBan.length} tài khoản hợp lệ? (${skippedCount} tài khoản đã bị khóa hoặc bị từ chối trước đó sẽ được bỏ qua).`
        : `Khóa ${activeToBan.length} tài khoản đã chọn?`;

    if (!confirm(confirmMsg)) return;

    for (const u of activeToBan) {
      try {
        await api.banUser(u.id);
      } catch (e) {
        console.error(e);
      }
    }
    setSelectedIds([]);
    loadUsers(true);
    window.dispatchEvent(
      new CustomEvent("app_toast", {
        detail: { msg: `Đã khóa thành công ${activeToBan.length} tài khoản`, type: "success" },
      })
    );
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) {
      window.dispatchEvent(
        new CustomEvent("app_toast", {
          detail: { msg: "Vui lòng chọn ít nhất một người dùng để thực hiện", type: "error" },
        })
      );
      return;
    }
    if (!confirm(`XÓA VĨNH VIỄN ${selectedIds.length} tài khoản? Không thể hoàn tác.`)) return;
    for (const id of selectedIds) {
      try {
        await api.deleteUser(id);
      } catch (e) {
        console.error(e);
      }
    }
    setSelectedIds([]);
    loadUsers(true);
  };

  const total = stats?.total_users ?? users.length;
  const active = stats?.approved ?? users.filter((u) => u.status === "approved").length;
  const pending = stats?.pending ?? users.filter((u) => u.status === "pending").length;

  return (
    <div className="users-page">
      <div className="users-page-header">
        <div className="users-page-header-text">
          <h1 className="users-page-title">Quản lý người dùng</h1>
          <p className="users-page-subtitle">
            Danh sách người dùng đăng ký, trạng thái phê duyệt và quản lý license phần mềm.
          </p>
        </div>
        <button type="button" onClick={() => setIsAddModalOpen(true)} className="users-btn-primary">
          <img src="/icons/users-user-plus.svg" alt="" />
          Thêm người dùng
        </button>
      </div>

      <div className="users-metrics">
        <div className="users-metric-card users-metric-card--total">
          <div className="users-metric-icon users-metric-icon--total">
            <img src="/icons/users-stat-users.svg" alt="" width={25} height={20} />
          </div>
          <div className="users-metric-body">
            <span className="users-metric-label">TỔNG SỐ</span>
            <span className="users-metric-value users-metric-value--total">
              {total.toLocaleString("en-US")}
            </span>
          </div>
        </div>

        <div className="users-metric-card users-metric-card--active">
          <div className="users-metric-icon users-metric-icon--active">
            <img src="/icons/users-stat-shield.svg" alt="" width={20} height={20} />
          </div>
          <div className="users-metric-body">
            <span className="users-metric-label">ĐÃ DUYỆT</span>
            <span className="users-metric-value users-metric-value--active">
              {active.toLocaleString("en-US")}
            </span>
          </div>
        </div>

        <div className="users-metric-card users-metric-card--pending">
          <div className="users-metric-icon users-metric-icon--pending">
            <img src="/icons/users-stat-pending.svg" alt="" width={20} height={18} />
          </div>
          <div className="users-metric-body">
            <span className="users-metric-label">CHỜ DUYỆT</span>
            <span className="users-metric-value users-metric-value--pending">{pending}</span>
          </div>
        </div>
      </div>

      <div className="users-toolbar">
        <div className="users-toolbar-left">
          <div className="users-search">
            <span className="users-search-icon">
              <img src="/icons/users-search.svg" alt="" width={16} height={16} />
            </span>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              placeholder="Tìm kiếm username, email, SĐT, HWID..."
              className="users-search-input"
            />
          </div>

          <div className="users-select-wrap">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="users-select"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="pending">Chờ duyệt</option>
              <option value="approved">Đã duyệt</option>
              <option value="rejected">Bị từ chối</option>
              <option value="banned">Bị khóa</option>
              <option value="expired">Hết hạn</option>
            </select>
            <img
              src="/icons/users-select-chevron.svg"
              alt=""
              className="users-select-chevron"
            />
          </div>

          {/* Nút 1: Lọc thời gian */}
          <div className="users-tool-wrap" ref={dateRef}>
            <button
              type="button"
              onClick={() => {
                setIsDateOpen(!isDateOpen);
                setIsColumnOpen(false);
              }}
              className={`users-tool-btn ${dateFilter !== "all" ? "users-tool-btn--active" : ""}`}
              title="Lọc theo ngày tạo tài khoản"
            >
              <img src="/icons/users-calendar.svg" alt="" width={16} height={16} />
              <span>{getDateLabel()}</span>
              {dateFilter !== "all" && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDateFilter("all");
                    setCustomStartDate("");
                    setCustomEndDate("");
                    setPage(1);
                  }}
                  className="users-tool-clear"
                  title="Xoá bộ lọc thời gian"
                >
                  ×
                </span>
              )}
            </button>

            {isDateOpen && (
              <div className="users-popover users-popover--date">
                <div className="users-popover-title">LỌC THEO NGÀY TẠO</div>
                <div className="users-date-options">
                  {[
                    { key: "all", label: "Tất cả thời gian" },
                    { key: "today", label: "Hôm nay" },
                    { key: "7d", label: "7 ngày qua" },
                    { key: "30d", label: "30 ngày qua" },
                    { key: "custom", label: "Tùy chỉnh khoảng ngày" },
                  ].map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      className={`users-date-opt-btn ${dateFilter === opt.key ? "users-date-opt-btn--active" : ""}`}
                      onClick={() => {
                        setDateFilter(opt.key as DateFilterType);
                        setPage(1);
                        if (opt.key !== "custom") {
                          setIsDateOpen(false);
                        }
                      }}
                    >
                      <span>{opt.label}</span>
                      {dateFilter === opt.key && <span className="users-date-check">✓</span>}
                    </button>
                  ))}
                </div>

                {dateFilter === "custom" && (
                  <div className="users-custom-date-box">
                    <div className="users-custom-field">
                      <label className="users-custom-label">Từ ngày</label>
                      <input
                        type="date"
                        value={customStartDate}
                        max={customEndDate || undefined}
                        onChange={(e) => {
                          setCustomStartDate(e.target.value);
                          setPage(1);
                        }}
                        className={`users-date-input ${isDateRangeInvalid ? "has-error" : ""}`}
                      />
                    </div>
                    <div className="users-custom-field">
                      <label className="users-custom-label">Đến ngày</label>
                      <input
                        type="date"
                        value={customEndDate}
                        min={customStartDate || undefined}
                        onChange={(e) => {
                          setCustomEndDate(e.target.value);
                          setPage(1);
                        }}
                        className={`users-date-input ${isDateRangeInvalid ? "has-error" : ""}`}
                      />
                    </div>
                    {isDateRangeInvalid && (
                      <div className="users-custom-date-error" role="alert">
                        <AlertCircle size={13} className="shrink-0" />
                        <span>Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="users-popover-actions">
                  <button
                    type="button"
                    className="users-popover-btn-reset"
                    onClick={() => {
                      setDateFilter("all");
                      setCustomStartDate("");
                      setCustomEndDate("");
                      setPage(1);
                      setIsDateOpen(false);
                    }}
                  >
                    Đặt lại
                  </button>
                  <button
                    type="button"
                    className="users-popover-btn-apply"
                    disabled={isDateRangeInvalid}
                    onClick={() => {
                      if (isDateRangeInvalid) {
                        window.dispatchEvent(
                          new CustomEvent("app_toast", {
                            detail: {
                              msg: "Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu",
                              type: "error",
                            },
                          })
                        );
                        return;
                      }
                      setIsDateOpen(false);
                    }}
                  >
                    Xong
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Nút 2: Xuất dữ liệu Excel (Zero-Dependency) */}
          <button
            type="button"
            onClick={handleExportExcel}
            className="users-tool-btn users-tool-btn--icon"
            title="Xuất danh sách người dùng ra file Excel (.xls)"
          >
            <img src="/icons/users-download.svg" alt="" width={16} height={16} />
          </button>

          {/* Nút 3: Tuỳ chỉnh cột */}
          <div className="users-tool-wrap" ref={colRef}>
            <button
              type="button"
              onClick={() => {
                setIsColumnOpen(!isColumnOpen);
                setIsDateOpen(false);
              }}
              className={`users-tool-btn users-tool-btn--icon ${isColumnOpen ? "users-tool-btn--active" : ""}`}
              title="Tuỳ chỉnh cột hiển thị"
            >
              <img src="/icons/users-sliders.svg" alt="" width={16} height={16} />
            </button>

            {isColumnOpen && (
              <div className="users-popover users-popover--columns">
                <div className="users-popover-title">HIỂN THỊ CỘT</div>
                <div className="users-col-list">
                  {COLUMN_CONFIG.map((col) => {
                    const checked = visibleColumns[col.key];
                    return (
                      <label key={col.key} className="users-col-item">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleToggleColumn(col.key)}
                          className="users-col-checkbox"
                        />
                        <span className="users-col-label">{col.label}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="users-popover-actions">
                  <button
                    type="button"
                    className="users-popover-btn-reset"
                    onClick={handleResetColumns}
                  >
                    Mặc định
                  </button>
                  <button
                    type="button"
                    className="users-popover-btn-apply"
                    onClick={() => setIsColumnOpen(false)}
                  >
                    Đóng
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="users-toolbar-right">
          <button
            type="button"
            onClick={handleBulkBan}
            disabled={isBulkBanDisabled}
            title={bulkBanTitle}
            className={`users-btn-lock ${isBulkBanDisabled ? "users-btn-lock--disabled" : ""}`}
          >
            <img src="/icons/users-lock.svg" alt="" width={14} height={14} />
            Khóa tài khoản
          </button>
          <button
            type="button"
            onClick={handleBulkDelete}
            disabled={isBulkDeleteDisabled}
            title={bulkDeleteTitle}
            className={`users-btn-delete ${isBulkDeleteDisabled ? "users-btn-delete--disabled" : ""}`}
          >
            <img src="/icons/users-trash.png" alt="" width={14} height={14} />
            Xóa người dùng
          </button>
        </div>
      </div>

      {loading ? (
        <div className="users-loading">Đang tải danh sách người dùng...</div>
      ) : (
        <UserTable
          users={pageUsers}
          allFilteredCount={filteredUsers.length}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          onRefresh={() => loadUsers(true)}
          visibleColumns={visibleColumns}
          pagination={{
            page: safePage,
            pageSize,
            total: filteredUsers.length,
            rangeStart,
            rangeEnd,
            totalPages,
            onPageChange: setPage,
            onPageSizeChange: (n) => {
              setPageSize(n);
              setPage(1);
            },
          }}
        />
      )}

      <AdminUserModal
        user={null}
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={() => loadUsers(true)}
      />
    </div>
  );
}

export default function UsersPage() {
  return (
    <Suspense fallback={<div className="users-loading">Đang tải...</div>}>
      <UsersPageContent />
    </Suspense>
  );
}
