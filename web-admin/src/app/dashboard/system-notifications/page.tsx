"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { api, Notification, User } from "@/lib/api";
import {
  ArrowLeft,
  Search,
  ChevronDown,
  CheckCheck,
  Trash2,
  Eye,
  UserPlus,
  Cpu,
  ChevronLeft,
  ChevronRight,
  X,
  ExternalLink,
  Clock,
  Bell,
} from "lucide-react";

export interface NotificationItem {
  id: number;
  type: string;
  user_id: number | null;
  username: string;
  content: string;
  rawMessage: string;
  is_read: boolean;
  created_at: string;
}

export default function SystemNotificationsPage() {
  const router = useRouter();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Filter states
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Viewing detail & action states
  const [viewingItem, setViewingItem] = useState<NotificationItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [notifsData, usersData] = await Promise.all([
        api.getNotifications(false, "admin"),
        api.getUsers().catch(() => [] as User[]),
      ]);
      // Chỉ lấy các dữ liệu có target là admin
      const adminOnlyNotifs = notifsData.filter(
        (n) => n.target === "admin" || (!n.target && n.type === "NEW_REGISTRATION")
      );
      setNotifications(adminOnlyNotifs);
      setUsers(usersData);
    } catch (e) {
      console.error("Lỗi tải thông báo:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const formatUtcDateTime = (dateStr?: string | null): string => {
    if (!dateStr) return "—";
    const s = dateStr.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(dateStr) ? dateStr : `${dateStr}Z`;
    const d = new Date(s);
    const validDate = isNaN(d.getTime()) ? new Date(dateStr) : d;
    if (isNaN(validDate.getTime())) return dateStr;

    return validDate.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  };

  // User mapping lookup
  const userMap = useMemo(() => {
    const map: Record<number, User> = {};
    users.forEach((u) => {
      map[u.id] = u;
    });
    return map;
  }, [users]);

  // Real data mapped from API
  const displayList = useMemo<NotificationItem[]>(() => {
    return notifications.map((n) => {
      const u = n.user_id ? userMap[n.user_id] : null;
      let username = u?.username;
      if (!username) {
        const match = n.message?.match(/đăng ký:\s*([^\s|]+)/i);
        username = match ? match[1] : (n.user_id ? `user00${n.user_id}` : `Hệ thống`);
      }

      const isNewReg = n.type === "NEW_REGISTRATION";
      const contentText = isNewReg
        ? "Có người dùng mới đăng ký tài khoản"
        : n.type.includes("HWID")
        ? "Đã reset HWID cho tài khoản"
        : n.message;

      return {
        id: n.id,
        type: n.type.includes("HWID") ? "RESET_HWID" : n.type,
        user_id: n.user_id || null,
        username,
        content: contentText,
        rawMessage: n.message,
        is_read: n.is_read,
        created_at: formatUtcDateTime(n.created_at),
      };
    });
  }, [notifications, userMap]);

  // Filtering
  const filteredList = useMemo(() => {
    return displayList.filter((item) => {
      // Search
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchUser = item.username.toLowerCase().includes(query);
        const matchContent = item.content.toLowerCase().includes(query);
        const matchType = item.type.toLowerCase().includes(query);
        if (!matchUser && !matchContent && !matchType) return false;
      }
      // Type filter
      if (typeFilter !== "ALL" && item.type !== typeFilter) {
        return false;
      }
      // Status filter
      if (statusFilter === "UNREAD" && item.is_read) return false;
      if (statusFilter === "READ" && !item.is_read) return false;

      return true;
    });
  }, [displayList, searchTerm, typeFilter, statusFilter]);

  // Pagination calculation
  const totalItems = filteredList.length;
  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedList = filteredList.slice(startIndex, startIndex + pageSize);
  const rangeStart = totalItems === 0 ? 0 : startIndex + 1;
  const rangeEnd = Math.min(startIndex + pageSize, totalItems);

  const unreadCount = displayList.filter((item) => !item.is_read).length;

  // Selection handlers
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(paginatedList.map((item) => item.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectRow = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const isAllSelected =
    paginatedList.length > 0 && paginatedList.every((item) => selectedIds.includes(item.id));

  // Mark all read
  const handleMarkAllRead = async () => {
    try {
      await api.markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (e) {
      console.error(e);
    }
  };

  // Mark single read
  const handleMarkSingleRead = async (id: number) => {
    try {
      await api.markRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
    } catch (e) {
      console.error(e);
    }
  };

  // View notification detail in modal & automatically mark read
  const handleViewNotification = async (item: NotificationItem) => {
    setViewingItem(item);
    if (!item.is_read) {
      try {
        await api.markRead(item.id);
        setNotifications((prev) =>
          prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n))
        );
      } catch (e) {
        console.error("Lỗi cập nhật trạng thái đã đọc:", e);
      }
    }
  };

  // Delete single notification
  const handleDeleteSingle = async (id: number) => {
    if (!confirm("Bạn có chắc muốn xóa thông báo này?")) return;
    try {
      setIsDeleting(true);
      await api.deleteNotification(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      setSelectedIds((prev) => prev.filter((i) => i !== id));
      if (viewingItem?.id === id) {
        setViewingItem(null);
      }
    } catch (e: any) {
      console.error("Lỗi khi xóa thông báo:", e);
      alert(e?.message || "Không thể xóa thông báo. Vui lòng thử lại!");
    } finally {
      setIsDeleting(false);
    }
  };

  // Batch delete selected notifications
  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Xóa ${selectedIds.length} thông báo đã chọn?`)) return;
    try {
      setIsDeleting(true);
      await api.batchDeleteNotifications(selectedIds);
      setNotifications((prev) => prev.filter((n) => !selectedIds.includes(n.id)));
      if (viewingItem && selectedIds.includes(viewingItem.id)) {
        setViewingItem(null);
      }
      setSelectedIds([]);
    } catch (e: any) {
      console.error("Lỗi khi xóa nhiều thông báo:", e);
      alert(e?.message || "Không thể xóa các thông báo đã chọn. Vui lòng thử lại!");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="w-full max-w-[1280px] mx-auto px-6 py-8 flex flex-col gap-6 bg-[#F5F7FB] min-h-[calc(100vh-65px)]">
      {/* Top Bar / Heading */}
      <div className="flex flex-col gap-1 w-full">
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2563EB] hover:text-blue-700 transition-colors w-fit mb-0.5 cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Quay lại</span>
        </button>

        <div className="flex items-center gap-3">
          <h1 className="text-[32px] leading-10 font-bold tracking-[-0.8px] text-[#0F172A]">
            Thông báo hệ thống
          </h1>
          <span className="inline-flex items-center px-3 py-1 bg-[#EFF6FF] border border-[#BFDBFE] rounded-full text-xs font-semibold text-[#2563EB]">
            {unreadCount} thông báo chưa đọc
          </span>
        </div>

        <p className="text-[13px] text-[#64748B] mt-0.5">
          Xem các thông báo sự kiện, cấp phép người dùng và hoạt động bảo mật từ hệ thống
        </p>
      </div>

      {/* Filter Bar & Action Card */}
      <div className="bg-white border border-[#E2E8F0] shadow-sm rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 w-full">
        {/* Left: Search & Filter Dropdowns */}
        <div className="flex flex-wrap items-center gap-3 flex-1">
          {/* Search Input */}
          <div className="relative flex items-center min-w-[220px] max-w-[300px] flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Tìm kiếm thông báo..."
              className="w-full h-10 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl pl-10 pr-3 text-xs text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
            />
          </div>

          {/* Type Filter */}
          <div className="relative flex items-center">
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="appearance-none h-10 bg-white border border-[#E2E8F0] rounded-xl pl-3.5 pr-9 text-xs font-medium text-[#334155] shadow-sm hover:border-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer transition-all"
            >
              <option value="ALL">Tất cả loại</option>
              <option value="NEW_REGISTRATION">NEW_REGISTRATION</option>
              <option value="RESET_HWID">RESET_HWID</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 pointer-events-none" />
          </div>

          {/* Status Filter */}
          <div className="relative flex items-center">
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="appearance-none h-10 bg-white border border-[#E2E8F0] rounded-xl pl-3.5 pr-9 text-xs font-medium text-[#334155] shadow-sm hover:border-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer transition-all"
            >
              <option value="ALL">Tất cả trạng thái</option>
              <option value="UNREAD">Chưa đọc</option>
              <option value="READ">Đã đọc</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 pointer-events-none" />
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleMarkAllRead}
            className="h-10 px-4 bg-white hover:bg-slate-50 active:scale-95 border border-[#E2E8F0] shadow-sm rounded-xl inline-flex items-center gap-2 text-xs font-semibold text-[#1E293B] cursor-pointer transition-all"
          >
            <CheckCheck className="w-4 h-4 text-[#2563EB]" />
            <span>Đánh dấu tất cả đã đọc</span>
          </button>

          <button
            type="button"
            onClick={handleDeleteSelected}
            disabled={selectedIds.length === 0 || isDeleting}
            className="h-10 px-4 bg-[#FEF2F2] hover:bg-[#FEE2E2] active:scale-95 border border-[#FECACA] rounded-xl inline-flex items-center gap-2 text-xs font-semibold text-[#DC2626] cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-4 h-4" />
            <span>{isDeleting ? "Đang xóa..." : "Xóa thông báo đã chọn"}</span>
          </button>
        </div>
      </div>

      {/* Notifications Table Card */}
      <div className="bg-white border border-[#E2E8F0] shadow-sm rounded-2xl overflow-hidden w-full">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                <th className="w-12 px-4 py-3.5 text-center">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={handleSelectAll}
                    className="w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500 cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3.5 text-left text-[11px] font-bold tracking-wider uppercase text-[#64748B]">
                  LOẠI
                </th>
                <th className="px-4 py-3.5 text-left text-[11px] font-bold tracking-wider uppercase text-[#64748B]">
                  NGƯỜI DÙNG
                </th>
                <th className="px-4 py-3.5 text-left text-[11px] font-bold tracking-wider uppercase text-[#64748B]">
                  NỘI DUNG
                </th>
                <th className="px-4 py-3.5 text-left text-[11px] font-bold tracking-wider uppercase text-[#64748B]">
                  TRẠNG THÁI
                </th>
                <th className="px-4 py-3.5 text-left text-[11px] font-bold tracking-wider uppercase text-[#64748B]">
                  THỜI GIAN
                </th>
                <th className="px-4 py-3.5 text-center text-[11px] font-bold tracking-wider uppercase text-[#64748B]">
                  THAO TÁC
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500 font-medium">
                    Đang tải thông báo...
                  </td>
                </tr>
              ) : paginatedList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500 font-medium">
                    Không tìm thấy thông báo nào
                  </td>
                </tr>
              ) : (
                paginatedList.map((item) => {
                  const isChecked = selectedIds.includes(item.id);
                  const isRegistration = item.type === "NEW_REGISTRATION";

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-slate-50/70 transition-colors ${
                        isChecked ? "bg-blue-50/20" : ""
                      }`}
                    >
                      {/* 1. Checkbox */}
                      <td className="px-4 py-4 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleSelectRow(item.id)}
                          className="w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500 cursor-pointer"
                        />
                      </td>

                      {/* 2. LOẠI */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        {isRegistration ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold tracking-wide bg-[#FEF2F2] border border-[#FECACA] text-[#DC2626]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444]" />
                            NEW_REGISTRATION
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold tracking-wide bg-[#ECFDF5] border border-[#A7F3D0] text-[#047857]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                            RESET_HWID
                          </span>
                        )}
                      </td>

                      {/* 3. NGƯỜI DÙNG */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {item.user_id ? (
                            <span className="w-7 h-6 flex items-center justify-center bg-[#EFF6FF] border border-[#DBEAFE] rounded text-[11px] font-bold text-[#2563EB]">
                              U{item.user_id}
                            </span>
                          ) : (
                            <span className="w-7 h-6 flex items-center justify-center bg-slate-100 border border-slate-200 rounded text-[10px] font-bold text-slate-500">
                              SYS
                            </span>
                          )}
                          <span className="text-sm font-semibold text-[#0F172A]">
                            {item.username}
                          </span>
                        </div>
                      </td>

                      {/* 4. NỘI DUNG */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2 text-xs font-medium text-[#1E293B]">
                          {isRegistration ? (
                            <UserPlus className="w-4 h-4 text-[#EF4444] shrink-0" />
                          ) : (
                            <Cpu className="w-4 h-4 text-[#10B981] shrink-0" />
                          )}
                          <span>{item.content}</span>
                        </div>
                      </td>

                      {/* 5. TRẠNG THÁI */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        {!item.is_read ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#FEF2F2] border border-[#FECACA] text-[#DC2626]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444]" />
                            Chưa đọc
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#F1F5F9] border border-[#E2E8F0] text-[#64748B]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#94A3B8]" />
                            Đã đọc
                          </span>
                        )}
                      </td>

                      {/* 6. THỜI GIAN */}
                      <td className="px-4 py-4 whitespace-nowrap text-xs text-[#64748B]">
                        {item.created_at}
                      </td>

                      {/* 7. THAO TÁC */}
                      <td className="px-4 py-4 whitespace-nowrap text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleViewNotification(item)}
                            className="w-8 h-8 rounded-lg bg-white hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600 border border-[#E2E8F0] flex items-center justify-center text-slate-500 transition-colors cursor-pointer"
                            title="Xem chi tiết thông báo"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={isDeleting}
                            onClick={() => handleDeleteSingle(item.id)}
                            className="w-8 h-8 rounded-lg bg-white hover:bg-red-50 hover:border-red-200 hover:text-red-600 border border-[#E2E8F0] flex items-center justify-center text-slate-500 transition-colors cursor-pointer disabled:opacity-50"
                            title="Xóa thông báo"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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

        {/* Table Footer / Pagination */}
        <div className="px-6 py-4 border-t border-[#F1F5F9] flex flex-col sm:flex-row items-center justify-between gap-4 w-full">
          <p className="text-xs text-[#64748B]">
            Hiển thị{" "}
            <span className="font-semibold text-[#0F172A]">
              {rangeStart}-{rangeEnd}
            </span>{" "}
            của <span className="font-semibold text-[#0F172A]">{totalItems}</span> thông báo
            {totalPages > 0 && (
              <span>
                {" "}(Trang <span className="font-semibold text-[#0F172A]">{currentPage} / {totalPages}</span>)
              </span>
            )}
          </p>

          <div className="flex items-center gap-3">
            {/* Pagination buttons */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="w-8 h-8 rounded-lg border border-[#E2E8F0] flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent transition-all cursor-pointer"
                title="Trang trước"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {(() => {
                const getPageNumbers = (current: number, total: number): (number | string)[] => {
                  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
                  if (current <= 3) return [1, 2, 3, "...", total];
                  if (current >= total - 2) return [1, "...", total - 2, total - 1, total];
                  return [1, "...", current, "...", total];
                };
                return getPageNumbers(currentPage, totalPages).map((p, idx) =>
                  typeof p === "number" ? (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setCurrentPage(p)}
                      className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-semibold transition-all cursor-pointer ${
                        p === currentPage
                          ? "bg-[#2563EB] text-white shadow-sm"
                          : "border border-[#E2E8F0] text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {p}
                    </button>
                  ) : (
                    <span key={`ellipsis-${idx}`} className="w-6 text-center text-xs text-slate-400 select-none">
                      ...
                    </span>
                  )
                );
              })()}

              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="w-8 h-8 rounded-lg border border-[#E2E8F0] flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent transition-all cursor-pointer"
                title="Trang sau"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Page Size Dropdown */}
            <div className="relative flex items-center">
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="appearance-none h-8 bg-white border border-[#E2E8F0] rounded-lg pl-3 pr-8 text-xs font-medium text-[#334155] shadow-sm hover:border-slate-300 focus:outline-none cursor-pointer transition-all"
              >
                <option value={5}>5 / trang</option>
                <option value={10}>10 / trang</option>
                <option value={20}>20 / trang</option>
                <option value={50}>50 / trang</option>
              </select>
              <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2.5 pointer-events-none" />
            </div>
          </div>
        </div>
      </div>

      {/* Modal chi tiết thông báo */}
      {viewingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-100/80 text-blue-600 flex items-center justify-center">
                  <Bell className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 leading-tight">
                    Chi tiết thông báo
                  </h3>
                  <span className="text-xs text-slate-400">Mã thông báo #{viewingItem.id}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingItem(null)}
                className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 flex flex-col gap-4 text-sm">
              {/* Badges */}
              <div className="flex flex-wrap items-center gap-2">
                {viewingItem.type === "NEW_REGISTRATION" ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold tracking-wide bg-rose-50 border border-rose-200 text-rose-600">
                    <UserPlus className="w-3.5 h-3.5" />
                    NEW_REGISTRATION
                  </span>
                ) : viewingItem.type.includes("HWID") ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold tracking-wide bg-emerald-50 border border-emerald-200 text-emerald-700">
                    <Cpu className="w-3.5 h-3.5" />
                    RESET_HWID
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold tracking-wide bg-blue-50 border border-blue-200 text-blue-700">
                    <Bell className="w-3.5 h-3.5" />
                    {viewingItem.type}
                  </span>
                )}

                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-slate-100 border border-slate-200 text-slate-700">
                  <CheckCheck className="w-3.5 h-3.5 text-blue-600" />
                  Đã đọc
                </span>
              </div>

              {/* User Info Box */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-600/10 text-blue-600 flex items-center justify-center font-bold text-sm">
                    {viewingItem.username ? viewingItem.username.charAt(0).toUpperCase() : "U"}
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900 flex items-center gap-2">
                      <span>{viewingItem.username}</span>
                      {viewingItem.user_id && (
                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                          UID: {viewingItem.user_id}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-500">Tài khoản liên quan</span>
                  </div>
                </div>

                {viewingItem.user_id && (
                  <button
                    type="button"
                    onClick={() => router.push(`/dashboard/users/${viewingItem.user_id}`)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors border border-blue-200 cursor-pointer"
                  >
                    <span>Xem hồ sơ</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Timestamp */}
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>Thời gian: <strong className="text-slate-700 font-medium">{viewingItem.created_at}</strong></span>
              </div>

              {/* Notification Content Box */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Nội dung chi tiết
                </label>
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 text-sm whitespace-pre-wrap leading-relaxed select-text">
                  {viewingItem.rawMessage || viewingItem.content}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => handleDeleteSingle(viewingItem.id)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 hover:border-red-200 rounded-xl border border-transparent transition-colors cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Xóa thông báo này</span>
              </button>

              <button
                type="button"
                onClick={() => setViewingItem(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
