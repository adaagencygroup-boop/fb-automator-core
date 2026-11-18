"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { api, User } from "@/lib/api";
import "./admins.css";

import { IconPlus } from "./components/AdminIcons";
import { AdminMetrics } from "./components/AdminMetrics";
import { AdminToolbar } from "./components/AdminToolbar";
import { AdminTable } from "./components/AdminTable";
import { AdminBulkBar } from "./components/AdminBulkBar";
import { AdminModal } from "./components/AdminModal";
import { AdminDetailDrawer } from "./components/AdminDetailDrawer";
import { Toast, ToastState } from "./components/Toast";
import { ConfirmModal } from "@/components/ConfirmModal";
import { fmtDateTime } from "./utils";

const PAGE_SIZE = 8;

export default function AdminsPage() {
  const router = useRouter();
  const [allAdmins, setAllAdmins] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState<ToastState>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [detailTarget, setDetailTarget] = useState<User | null>(null);
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    variant?: "danger" | "warning" | "info";
    onConfirm: () => Promise<void> | void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadAdmins = async (spinner = true) => {
    if (spinner) setLoading(true);
    try {
      let data: User[] = [];
      try {
        data = await api.getAdmins();
      } catch (err) {
        const all = await api.getUsers();
        data = all.filter((u) => u.role === "admin" || u.role === "superadmin");
      }
      setAllAdmins(data);
    } catch (e: any) {
      console.error(e);
      showToast(e.message || "Lỗi khi tải danh sách admin", "error");
    } finally {
      if (spinner) setLoading(false);
    }
  };

  useEffect(() => {
    loadAdmins();
  }, []);

  /* ── Derived stats ── */
  const totalAdmins = allAdmins.length;
  const activeAdmins = allAdmins.filter((u) => u.status === "approved").length;
  const lockedAdmins = allAdmins.filter((u) => u.status === "banned").length;
  const activePct =
    totalAdmins > 0 ? Math.round((activeAdmins / totalAdmins) * 100) : 0;

  /* ── Filter + search + sort ── */
  const filtered = useMemo(() => {
    const list = allAdmins.filter((u) => {
      const matchStatus =
        filterStatus === "all" ||
        (filterStatus === "active" && u.status === "approved") ||
        (filterStatus === "locked" && u.status === "banned");
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        u.username.toLowerCase().includes(q) ||
        String(u.id).includes(q);
      return matchStatus && matchSearch;
    });

    list.sort((a, b) => {
      const da = new Date(a.created_at).getTime();
      const db = new Date(b.created_at).getTime();
      return sortOrder === "newest" ? db - da : da - db;
    });

    return list;
  }, [allAdmins, filterStatus, search, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );
  const rangeStart = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, filtered.length);

  /* ── Selection ── */
  const allSelected =
    pageItems.length > 0 && pageItems.every((u) => selectedIds.includes(u.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(
        selectedIds.filter((id) => !pageItems.some((u) => u.id === id))
      );
    } else {
      setSelectedIds([
        ...new Set([...selectedIds, ...pageItems.map((u) => u.id)]),
      ]);
    }
  };

  const toggleOne = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  /* ── Actions ── */
  const handleBan = (user: User) => {
    setConfirmConfig({
      isOpen: true,
      title: "Khóa tài khoản Admin",
      message: `Bạn có chắc muốn KHÓA tài khoản Admin "${user.username}"? Phiên đăng nhập của tài khoản này sẽ bị thu hồi ngay lập tức.`,
      confirmText: "Khóa tài khoản",
      variant: "danger",
      onConfirm: async () => {
        try {
          await api.banUser(user.id);
          showToast(`Đã khóa Admin ${user.username}`);
          setDetailTarget((prev) =>
            prev?.id === user.id ? { ...prev, status: "banned" } : prev
          );
          loadAdmins(false);
        } catch (e: any) {
          showToast(e.message || "Lỗi khi khóa", "error");
        }
      },
    });
  };

  const handleUnban = (user: User) => {
    setConfirmConfig({
      isOpen: true,
      title: "Mở khóa tài khoản Admin",
      message: `Bạn có chắc muốn MỞ KHÓA tài khoản Admin "${user.username}"?`,
      confirmText: "Mở khóa",
      variant: "info",
      onConfirm: async () => {
        try {
          await api.unbanUser(user.id);
          showToast(`Đã mở khóa Admin ${user.username}`);
          setDetailTarget((prev) =>
            prev?.id === user.id ? { ...prev, status: "approved" } : prev
          );
          loadAdmins(false);
        } catch (e: any) {
          showToast(e.message || "Lỗi khi mở khóa", "error");
        }
      },
    });
  };

  const handleDelete = (user: User) => {
    setConfirmConfig({
      isOpen: true,
      title: "Xóa vĩnh viễn tài khoản Admin",
      message: `Bạn có chắc chắn muốn XOÁ VĨNH VIỄN tài khoản Admin "${user.username}"? Thao tác này không thể hoàn tác!`,
      confirmText: "Xóa vĩnh viễn",
      variant: "danger",
      onConfirm: async () => {
        try {
          await api.deleteUser(user.id);
          showToast(`Đã xoá tài khoản Admin ${user.username}`);
          setDetailTarget(null);
          loadAdmins(false);
        } catch (e: any) {
          showToast(e.message || "Lỗi khi xoá tài khoản", "error");
        }
      },
    });
  };

  /* ── Bulk actions ── */
  const selectedAdmins = allAdmins.filter((u) => selectedIds.includes(u.id));

  // Gọi tuần tự từng request (tránh SQLite bị lock), đếm số thành công / lỗi
  const runBulk = async (
    targets: User[],
    action: (id: number) => Promise<unknown>
  ) => {
    let failed = 0;
    for (const u of targets) {
      try {
        await action(u.id);
      } catch (e) {
        console.error(e);
        failed++;
      }
    }
    return { ok: targets.length - failed, failed };
  };

  const handleBulkBan = () => {
    const toBan = selectedAdmins.filter((u) => u.status !== "banned");
    if (toBan.length === 0) {
      showToast("Các tài khoản đã chọn đều đang bị khóa", "error");
      return;
    }
    const skipped = selectedAdmins.length - toBan.length;
    setConfirmConfig({
      isOpen: true,
      title: "Khóa tài khoản hàng loạt",
      message:
        `Bạn có chắc muốn KHÓA ${toBan.length} tài khoản Admin đã chọn?` +
        (skipped > 0 ? ` (${skipped} tài khoản đã bị khóa sẽ được bỏ qua.)` : "") +
        " Phiên đăng nhập của các tài khoản này sẽ bị thu hồi ngay lập tức.",
      confirmText: `Khóa ${toBan.length} tài khoản`,
      variant: "danger",
      onConfirm: async () => {
        const { ok, failed } = await runBulk(toBan, api.banUser);
        setSelectedIds([]);
        loadAdmins(false);
        showToast(
          failed > 0
            ? `Đã khóa ${ok} tài khoản, ${failed} tài khoản bị lỗi`
            : `Đã khóa ${ok} tài khoản Admin`,
          failed > 0 ? "error" : "success"
        );
      },
    });
  };

  const handleBulkDelete = () => {
    if (selectedAdmins.length === 0) return;
    setConfirmConfig({
      isOpen: true,
      title: "Xóa vĩnh viễn tài khoản hàng loạt",
      message: `Bạn có chắc chắn muốn XOÁ VĨNH VIỄN ${selectedAdmins.length} tài khoản Admin đã chọn? Thao tác này không thể hoàn tác!`,
      confirmText: `Xóa ${selectedAdmins.length} tài khoản`,
      variant: "danger",
      onConfirm: async () => {
        const { ok, failed } = await runBulk(selectedAdmins, api.deleteUser);
        setSelectedIds([]);
        loadAdmins(false);
        showToast(
          failed > 0
            ? `Đã xoá ${ok} tài khoản, ${failed} tài khoản bị lỗi`
            : `Đã xoá ${ok} tài khoản Admin`,
          failed > 0 ? "error" : "success"
        );
      },
    });
  };

  const handleExportExcel = () => {
    if (allAdmins.length === 0 || filtered.length === 0) {
      showToast("Không có dữ liệu để xuất", "error");
      return;
    }

    const headers = [
      "ID",
      "Username",
      "Vai trò",
      "Trạng thái",
      "Ngày tạo",
    ];

    const escapeXml = (str: string) => {
      return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
    };

    const rows = filtered.map((u) => [
      `#ADM-${String(u.id).padStart(3, "0")}`,
      u.username || "",
      u.role === "superadmin" ? "Super Admin" : "Admin",
      u.status === "approved" ? "Hoạt động" : "Đã khóa",
      fmtDateTime(u.created_at),
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
              `<Cell ss:StyleID="${cIdx === 0 || cIdx >= 3 ? "Center" : "Left"}"><Data ss:Type="String">${escapeXml(val)}</Data></Cell>`
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
  <Worksheet ss:Name="Danh sách Admin">
    <Table>
      <Column ss:Width="90"/>
      <Column ss:Width="140"/>
      <Column ss:Width="120"/>
      <Column ss:Width="110"/>
      <Column ss:Width="150"/>
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
      `danh_sach_admin_${new Date().toISOString().slice(0, 10)}.xls`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Đã xuất thành công ${filtered.length} admin ra file Excel`);
  };

  return (
    <div className="adm-page">
      {/* ── Page Header ── */}
      <div className="adm-header">
        <div className="adm-header-text">
          <h1 className="adm-title">Quản lý Admin</h1>
          <p className="adm-subtitle">
            Quản lý tài khoản quản trị hệ thống và trạng thái truy cập.
          </p>
        </div>
        <button
          type="button"
          className="adm-btn-primary"
          onClick={() => {
            setEditTarget(null);
            setModalOpen(true);
          }}
        >
          <IconPlus />
          Thêm Admin
        </button>
      </div>

      {/* ── Summary Cards ── */}
      <AdminMetrics
        totalAdmins={totalAdmins}
        activeAdmins={activeAdmins}
        lockedAdmins={lockedAdmins}
        activePct={activePct}
      />

      {/* ── Filter / Search Toolbar ── */}
      <AdminToolbar
        search={search}
        setSearch={setSearch}
        filterStatus={filterStatus}
        setFilterStatus={setFilterStatus}
        sortOrder={sortOrder}
        setSortOrder={setSortOrder}
        onResetPage={() => setPage(1)}
        onExportCSV={handleExportExcel}
      />

      {/* ── Bulk Actions Bar ── */}
      <AdminBulkBar
        selectedCount={selectedIds.length}
        onBulkBan={handleBulkBan}
        onBulkDelete={handleBulkDelete}
        onClearSelection={() => setSelectedIds([])}
      />

      {/* ── Table & Pagination ── */}
      <AdminTable
        loading={loading}
        pageItems={pageItems}
        allSelected={allSelected}
        selectedIds={selectedIds}
        safePage={safePage}
        pageSize={PAGE_SIZE}
        totalPages={totalPages}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        totalFiltered={filtered.length}
        toggleAll={toggleAll}
        toggleOne={toggleOne}
        setPage={setPage}
        onView={(u) => setDetailTarget(u)}
        onEdit={(u) => {
          setEditTarget(u);
          setModalOpen(true);
        }}
        onBan={handleBan}
        onUnban={handleUnban}
      />

      {/* ── Detail Drawer (Figma 1:1) ── */}
      <AdminDetailDrawer
        isOpen={Boolean(detailTarget)}
        admin={detailTarget}
        onClose={() => setDetailTarget(null)}
        onEdit={(u) => {
          setDetailTarget(null);
          setEditTarget(u);
          setModalOpen(true);
        }}
        onBan={handleBan}
        onUnban={handleUnban}
        onDelete={handleDelete}
        onViewLogs={(u) => {
          setDetailTarget(null);
          router.push(`/dashboard/notifications?search=${encodeURIComponent(u.username)}`);
        }}
      />

      {/* ── Add / Edit Modal ── */}
      <AdminModal
        isOpen={modalOpen}
        editTarget={editTarget}
        onClose={() => {
          setModalOpen(false);
          setEditTarget(null);
        }}
        onSuccess={(msg) => {
          showToast(msg);
          loadAdmins(false);
        }}
        onDelete={handleDelete}
      />

      {/* ── Toast Alert ── */}
      <Toast toast={toast} />

      {/* ── Custom Confirmation Modal ── */}
      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        confirmText={confirmConfig.confirmText}
        variant={confirmConfig.variant}
        onConfirm={confirmConfig.onConfirm}
        onClose={() => setConfirmConfig((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
