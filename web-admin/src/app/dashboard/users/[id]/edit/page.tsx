"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, User, ActivityLog, getCurrentAdminUser } from "@/lib/api";
import { LogoutNoticeModal } from "@/components/LogoutNoticeModal";
import { isValidPhoneNumber, isValidPassword, validatePassword } from "@/lib/validation";
import {
  ArrowLeft,
  RotateCw,
  Copy,
  Check,
  Eye,
  EyeOff,
  Phone,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Ban,
  Unlock,
  Trash2,
  ShieldCheck,
  User as UserIcon,
  Calendar,
} from "lucide-react";

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

// Figma User avatar SVG
function FigmaUserAvatarIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 23 23" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M11.3333 11.3333C9.775 11.3333 8.44097 10.7785 7.33125 9.66875C6.22153 8.55903 5.66667 7.225 5.66667 5.66667C5.66667 4.10833 6.22153 2.77431 7.33125 1.66458C8.44097 0.554861 9.775 0 11.3333 0C12.8917 0 14.2257 0.554861 15.3354 1.66458C16.4451 2.77431 17 4.10833 17 5.66667C17 7.225 16.4451 8.55903 15.3354 9.66875C14.2257 10.7785 12.8917 11.3333 11.3333 11.3333ZM0 22.6667V18.7C0 17.8972 0.206597 17.1594 0.619792 16.4865C1.03299 15.8135 1.58194 15.3 2.26667 14.9458C3.73056 14.2139 5.21806 13.6649 6.72917 13.299C8.24028 12.933 9.775 12.75 11.3333 12.75C12.8917 12.75 14.4264 12.933 15.9375 13.299C17.4486 13.6649 18.9361 14.2139 20.4 14.9458C21.0847 15.3 21.6337 15.8135 22.0469 16.4865C22.4601 17.1594 22.6667 17.8972 22.6667 18.7V22.6667H0ZM2.83333 19.8333H19.8333V18.7C19.8333 18.4403 19.7684 18.2042 19.6385 17.9917C19.5087 17.7792 19.3375 17.6139 19.125 17.4958C17.85 16.8583 16.5632 16.3802 15.2646 16.0615C13.966 15.7427 12.6556 15.5833 11.3333 15.5833C10.0111 15.5833 8.7007 15.7427 7.40208 16.0615C6.10347 16.3802 4.81667 16.8583 3.54167 17.4958C3.32917 17.6139 3.15799 17.7792 3.02813 17.9917C2.89826 18.2042 2.83333 18.4403 2.83333 18.7V19.8333ZM11.3333 8.5C12.1125 8.5 12.7795 8.22257 13.3344 7.66771C13.8892 7.11285 14.1667 6.44583 14.1667 5.66667C14.1667 4.8875 13.8892 4.22049 13.3344 3.66563C12.7795 3.11076 12.1125 2.83333 11.3333 2.83333C10.5542 2.83333 9.88715 3.11076 9.33229 3.66563C8.77743 4.22049 8.5 4.8875 8.5 5.66667C8.5 6.44583 8.77743 7.11285 9.33229 7.66771C9.88715 8.22257 10.5542 8.5 11.3333 8.5Z"
        fill="#2563EB"
      />
    </svg>
  );
}

// Figma Activity history header SVG
function FigmaHistoryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M6.66406 4.0013V6.66797L8.66406 8.66797M12.6641 6.66797C12.6641 9.97946 9.97555 12.668 6.66406 12.668C3.35257 12.668 0.664063 9.97946 0.664062 6.66797C0.664062 3.35648 3.35257 0.667969 6.66406 0.667969C9.97555 0.667969 12.6641 3.35648 12.6641 6.66797L6.66406 4.0013"
        stroke="#2563EB"
        strokeWidth="1.33333"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Figma Admin Note SVG
function FigmaNoteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12.8 6.4C12.8 9.93226 9.93226 12.8 6.4 12.8C2.86774 12.8 0 9.93226 0 6.4C0 2.86774 2.86774 0 6.4 0C9.93226 0 12.8 2.86774 12.8 6.4ZM7.2 3.2C7.2 3.64153 6.84153 4 6.4 4C5.95847 4 5.6 3.64153 5.6 3.2C5.6 2.75847 5.95847 2.4 6.4 2.4C6.84153 2.4 7.2 2.75847 7.2 3.2ZM5.6 5.6C5.15847 5.6 4.8 5.95847 4.8 6.4C4.8 6.84153 5.15847 7.2 5.6 7.2V9.6C5.6 10.0415 5.95847 10.4 6.4 10.4H7.2C7.64153 10.4 8 10.0415 8 9.6C8 9.15847 7.64153 8.8 7.2 8.8V6.4C7.2 5.95847 6.84153 5.6 6.4 5.6H5.6Z"
        fill="#1D4ED8"
      />
    </svg>
  );
}

export default function UserEditPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params?.id ? Number(params.id) : null;

  const [user, setUser] = useState<User | null>(null);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [copiedHwid, setCopiedHwid] = useState(false);
  const [logPage, setLogPage] = useState(1);
  const [logPageSize, setLogPageSize] = useState(5);

  // Form states
  const [username, setUsername] = useState<string>("");
  const [usernameError, setUsernameError] = useState<string>("");
  const [status, setStatus] = useState<string>("approved");
  const [contactInfo, setContactInfo] = useState<string>("");
  const [packageOption, setPackageOption] = useState<string>("keep");
  const [password, setPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [phoneError, setPhoneError] = useState<string>("");
  const [passwordError, setPasswordError] = useState<string>("");
  const [expiryDateInput, setExpiryDateInput] = useState<string>("");
  const datePickerRef = useRef<HTMLInputElement>(null);
  const [logoutNotice, setLogoutNotice] = useState<{
    isOpen: boolean;
    newUsername: string;
  }>({
    isOpen: false,
    newUsername: "",
  });

  const loadUserData = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [users, logsData] = await Promise.all([
        api.getUsers(),
        api.getActivityLogs(200).catch(() => [] as ActivityLog[]),
      ]);
      const found = users.find((u) => u.id === userId);
      if (found) {
        if (found.status === "rejected") {
          window.dispatchEvent(
            new CustomEvent("app_toast", {
              detail: { msg: "Tài khoản bị từ chối chỉ được phép xem, không thể chỉnh sửa", type: "error" },
            })
          );
          router.replace(`/dashboard/users/${found.id}`);
          return;
        }
        setUser(found);
        setUsername(found.username || "");
        setStatus(found.status || "approved");
        setContactInfo(found.contact_info || "");
        if (found.expired_at) {
          setExpiryDateInput(formatDateToInput(found.expired_at));
        } else {
          const defaultExp = new Date(Date.now() + 30 * 86400000);
          setExpiryDateInput(formatDateToInput(defaultExp.toISOString()));
        }

        if (logsData) {
          const userLogs = logsData.filter(
            (l) => l.target_uid === userId || (found && l.target_username === found.username)
          );
          setActivityLogs(userLogs);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUserData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const formatUtcDateTime = (dateStr?: string | null): string => {
    if (!dateStr) return "—";
    const s = dateStr.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(dateStr) ? dateStr : `${dateStr}Z`;
    const d = new Date(s);
    const validDate = isNaN(d.getTime()) ? new Date(dateStr) : d;
    if (isNaN(validDate.getTime())) return dateStr;

    const day = String(validDate.getDate()).padStart(2, "0");
    const month = String(validDate.getMonth() + 1).padStart(2, "0");
    const year = validDate.getFullYear();
    const hours = String(validDate.getHours()).padStart(2, "0");
    const minutes = String(validDate.getMinutes()).padStart(2, "0");

    return `${day}/${month}/${year} ${hours}:${minutes}`;
  };

  const formatDateToInput = (dateStr?: string | null): string => {
    if (!dateStr) return "";
    const s = dateStr.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(dateStr) ? dateStr : `${dateStr}Z`;
    const d = new Date(s);
    const validDate = isNaN(d.getTime()) ? new Date(dateStr) : d;
    if (isNaN(validDate.getTime())) return "";

    const year = validDate.getFullYear();
    const month = String(validDate.getMonth() + 1).padStart(2, "0");
    const day = String(validDate.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  };

  const handlePackageSelect = (opt: string) => {
    setPackageOption(opt);
    if (opt === "keep") {
      if (user?.expired_at) {
        setExpiryDateInput(formatDateToInput(user.expired_at));
      }
    } else {
      const days = parseInt(opt, 10);
      if (!isNaN(days) && days > 0) {
        const projected = new Date(Date.now() + days * 86400000);
        setExpiryDateInput(formatDateToInput(projected.toISOString()));
      }
    }
  };

  const handleDateInputChange = (val: string) => {
    setExpiryDateInput(val);
    setPackageOption("custom");
  };

  const copyHwid = (hwidStr: string) => {
    if (!hwidStr) return;
    navigator.clipboard.writeText(hwidStr);
    setCopiedHwid(true);
    setTimeout(() => setCopiedHwid(false), 2000);
  };

  const handleResetHwid = async () => {
    if (!user) return;
    if (!confirm(`Reset HWID của ${user.username}? Thiết bị hiện tại sẽ bị hủy liên kết.`)) return;
    setActionLoading(true);
    try {
      await api.resetHwid(user.id);
      await loadUserData();
    } catch (e: any) {
      alert(e.message || "Lỗi khi reset HWID");
    } finally {
      setActionLoading(false);
    }
  };

  const handleBanToggle = async () => {
    if (!user) return;
    if (user.status === "rejected") {
      alert("Tài khoản đang ở trạng thái bị từ chối");
      return;
    }
    const isCurrentlyBanned = user.status === "banned";
    if (isCurrentlyBanned) {
      if (!confirm(`Mở khóa tài khoản ${user.username}?`)) return;
      setActionLoading(true);
      try {
        const res: any = await api.unbanUser(user.id);
        await loadUserData();
        const statusMap: Record<string, string> = {
          pending: "Chờ duyệt",
          approved: "Đã duyệt",
          rejected: "Bị từ chối",
          expired: "Hết hạn",
        };
        const restoredName = (res && res.status && statusMap[res.status]) || "";
        window.dispatchEvent(
          new CustomEvent("app_toast", {
            detail: {
              msg: restoredName
                ? `Đã mở khóa và khôi phục trạng thái: ${restoredName}`
                : "Đã mở khóa tài khoản thành công",
              type: "success",
            },
          })
        );
      } catch (e: any) {
        alert(e.message || "Lỗi khi mở khóa");
      } finally {
        setActionLoading(false);
      }
    } else {
      if (!confirm(`Khóa tài khoản ${user.username}?`)) return;
      setActionLoading(true);
      try {
        await api.banUser(user.id);
        setStatus("banned");
        await loadUserData();
      } catch (e: any) {
        alert(e.message || "Lỗi khi khóa tài khoản");
      } finally {
        setActionLoading(false);
      }
    }
  };

  const handleDelete = async () => {
    if (!user) return;
    if (!confirm(`CẢNH BÁO: XÓA VĨNH VIỄN tài khoản ${user.username}? Không thể hoàn tác.`)) return;
    setActionLoading(true);
    try {
      await api.deleteUser(user.id);
      router.push("/dashboard/users");
    } catch (e: any) {
      alert(e.message || "Lỗi khi xóa tài khoản");
      setActionLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (user.status === "rejected") {
      alert("Tài khoản đang bị từ chối chỉ được phép xem, không thể chỉnh sửa.");
      router.replace(`/dashboard/users/${user.id}`);
      return;
    }

    if (!username.trim()) {
      setUsernameError("Vui lòng nhập tên đăng nhập.");
      return;
    }
    setUsernameError("");

    if (!contactInfo.trim()) {
      setPhoneError("Vui lòng nhập số điện thoại liên hệ.");
      return;
    }

    if (!isValidPhoneNumber(contactInfo)) {
      setPhoneError("Số điện thoại không đúng định dạng (VD: 0988123456 hoặc +84988123456)");
      return;
    }
    setPhoneError("");

    if (password.trim() && !isValidPassword(password)) {
      const passRes = validatePassword(password);
      setPasswordError(passRes.message || "Mật khẩu không thỏa mãn các yêu cầu bảo mật!");
      return;
    }
    setPasswordError("");

    setActionLoading(true);
    try {
      const payload: {
        username?: string;
        contact_info?: string;
        status?: string;
        password?: string;
        days?: number;
      } = {
        contact_info: contactInfo,
        status: status,
      };

      if (username.trim() !== user.username) {
        payload.username = username.trim();
      }

      if (password.trim()) {
        payload.password = password.trim();
      }

      if (status === "pending" && packageOption !== "keep") {
        alert("Tài khoản ở trạng thái Chờ duyệt không thể cấp hoặc gia hạn thời hạn sử dụng. Vui lòng chuyển trạng thái sang Đã duyệt.");
        return;
      }

      if (status !== "pending" && expiryDateInput) {
        const origExpInput = user.expired_at ? formatDateToInput(user.expired_at) : "";
        if (packageOption !== "keep" || expiryDateInput !== origExpInput) {
          const targetDate = new Date(expiryDateInput + "T23:59:59");
          const now = new Date();
          const diffTime = targetDate.getTime() - now.getTime();
          const calculatedDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          if (!isNaN(calculatedDays)) {
            payload.days = calculatedDays;
          }
        }
      }

      const currentUser = getCurrentAdminUser();
      const isCurrent = Boolean(
        (currentUser?.username && user.username.toLowerCase() === currentUser.username.toLowerCase()) ||
        (currentUser?.id && user.id === currentUser.id)
      );
      const isUsernameChanged = Boolean(payload.username && payload.username.toLowerCase() !== user.username.toLowerCase());

      if (isCurrent && isUsernameChanged) {
        sessionStorage.setItem("pending_logout_modal", "true");
        await api.editUser(user.id, payload);
        setLogoutNotice({
          isOpen: true,
          newUsername: payload.username!,
        });
        return;
      }

      await api.editUser(user.id, payload);
      alert("Cập nhật thông tin người dùng thành công!");
      router.push("/dashboard/users");
    } catch (e: any) {
      sessionStorage.removeItem("pending_logout_modal");
      alert(e.message || "Lỗi khi lưu thông tin");
    } finally {
      setActionLoading(false);
    }
  };

  if (logoutNotice.isOpen) {
    return (
      <LogoutNoticeModal
        isOpen={logoutNotice.isOpen}
        newUsername={logoutNotice.newUsername}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-slate-500 font-medium text-sm">
        <RotateCw className="w-6 h-6 animate-spin text-blue-600" />
        <span>Đang tải thông tin người dùng...</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <h2 className="text-xl font-bold text-slate-800">Không tìm thấy người dùng</h2>
        <Link
          href="/dashboard/users"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Quay lại danh sách</span>
        </Link>
      </div>
    );
  }

  // Calculate projected expiration & days remaining
  let displayRemainingDays = 0;
  let remainingText = "Chưa kích hoạt";

  if (expiryDateInput) {
    const targetDate = new Date(expiryDateInput + "T23:59:59");
    const now = new Date();
    const diffTime = targetDate.getTime() - now.getTime();
    displayRemainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (displayRemainingDays > 0) {
      remainingText = `Còn ${displayRemainingDays} ngày`;
    } else {
      remainingText = "Đã hết hạn";
    }
  } else if (user.days_remaining !== null && user.days_remaining !== undefined) {
    displayRemainingDays = user.days_remaining;
    remainingText = user.days_remaining > 0 ? `Còn ${user.days_remaining} ngày` : user.expired_at ? "Đã hết hạn" : "Chưa kích hoạt";
  }

  const registeredDateStr = user.created_at ? formatUtcDateTime(user.created_at) : "01/12/2026 10:30";

  const getTimestamp = (dateStr?: string | null): number => {
    if (!dateStr) return 0;
    const s = dateStr.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(dateStr) ? dateStr : `${dateStr}Z`;
    const d = new Date(s).getTime();
    return isNaN(d) ? new Date(dateStr).getTime() || 0 : d;
  };

  const regTime = getTimestamp(user.created_at);

  const dbLogItems = activityLogs.map((log) => {
    const rawTime = getTimestamp(log.created_at);
    let action = log.action_type;
    let info = log.change_detail || "—";
    let tone: "green" | "amber" | "red" | "blue" | "slate" = "blue";

    if (log.action_type === "ban_user") {
      action = "Khóa người dùng";
      info = "Thay đổi trạng thái sang Đã khoá";
      tone = "red";
    } else if (log.action_type === "unban_user") {
      action = "Mở khóa người dùng";
      info = "Mở khóa và khôi phục trạng thái tài khoản";
      tone = "green";
    } else if (log.action_type === "reset_hwid") {
      action = "Reset HWID";
      info = log.change_detail ? `HWID mới: ${log.change_detail}` : "Đã reset HWID";
      tone = "blue";
    } else if (log.action_type === "approve_user") {
      action = "Duyệt người dùng";
      info = log.change_detail || "Cấp license sử dụng";
      tone = "green";
    } else if (log.action_type === "extend_license") {
      action = "Gia hạn license";
      info = log.change_detail || "Gia hạn thời hạn sử dụng";
      tone = "green";
    } else if (log.action_type === "reject_user") {
      action = "Từ chối đăng ký";
      info = log.change_detail || "Từ chối tài khoản";
      tone = "red";
    } else if (log.action_type === "delete_user") {
      action = "Xóa người dùng";
      info = log.change_detail || "Xóa tài khoản khỏi hệ thống";
      tone = "red";
    } else if (log.action_type === "edit_user") {
      action = "Cập nhật người dùng";
      info = log.change_detail || "Chỉnh sửa thông tin tài khoản";
      tone = "blue";
    }

    return {
      id: `db-${log.id}`,
      time: log.created_at ? formatUtcDateTime(log.created_at) : "—",
      rawTime,
      action,
      tone,
      info,
      executor: log.admin_username || "admin",
    };
  });

  const hasBanLog = dbLogItems.some((l) => l.action === "Khóa người dùng");
  const fallbackBanLog =
    user.status === "banned" && !hasBanLog
      ? [
          {
            id: "fallback-ban",
            time: formatUtcDateTime(user.created_at || new Date().toISOString()),
            rawTime: regTime + 2000,
            action: "Khóa người dùng",
            tone: "red" as const,
            info: "Thay đổi trạng thái sang Đã khoá",
            executor: "admin",
          },
        ]
      : [];

  const baseRegLog = user.created_at
    ? [
        {
          id: "base-reg",
          time: formatUtcDateTime(user.created_at),
          rawTime: regTime,
          action: "Đăng ký tài khoản",
          tone: "slate" as const,
          info: "Tạo tài khoản mới",
          executor: user.username,
        },
      ]
    : [];

  const logs = [...dbLogItems, ...fallbackBanLog, ...baseRegLog].sort((a, b) => b.rawTime - a.rawTime);

  const totalLogItems = logs.length;
  const totalLogPages = Math.max(1, Math.ceil(totalLogItems / logPageSize));
  const safeLogPage = Math.min(logPage, totalLogPages);
  const paginatedLogs = logs.slice(
    (safeLogPage - 1) * logPageSize,
    safeLogPage * logPageSize
  );
  const logRangeStart = totalLogItems === 0 ? 0 : (safeLogPage - 1) * logPageSize + 1;
  const logRangeEnd = Math.min(safeLogPage * logPageSize, totalLogItems);

  return (
    <div className="w-full max-w-[1280px] mx-auto px-6 py-8 flex flex-col gap-6 bg-[#F5F7FB] min-h-[calc(100vh-65px)]">
      {/* Top Bar Navigation */}
      <div className="flex flex-col gap-1 w-full">
        <Link
          href="/dashboard/users"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 transition-colors w-fit"
        >
          <ArrowLeft className="w-3.5 h-3.5 text-blue-600" />
          <span>Quay lại danh sách</span>
        </Link>

        <div className="flex items-center justify-between w-full h-10 mt-0.5">
          <h1 className="text-[32px] leading-10 font-bold tracking-[-0.8px] text-[#0F172A]">
            Chỉnh sửa người dùng
          </h1>
          <button
            type="button"
            onClick={loadUserData}
            className="inline-flex items-center gap-1.5 px-4 py-2 h-[34px] bg-white border border-[#E2E8F0] shadow-sm rounded-xl text-xs font-medium text-[#334155] hover:bg-slate-50 transition-colors cursor-pointer active:scale-95"
          >
            <RotateCw className="w-3.5 h-3.5 text-slate-600" />
            <span>Đồng bộ dữ liệu</span>
          </button>
        </div>
      </div>

      <form onSubmit={handleSave} className="flex flex-col lg:flex-row items-start gap-6 w-full">
        {/* LEFT COLUMN: Form + Activity Logs */}
        <div className="flex flex-col gap-6 flex-1 w-full min-w-0">
          {/* Card 1: User Edit Form */}
          <div className="bg-white border border-[#E2E8F0] shadow-sm rounded-xl p-6 flex flex-col gap-6 w-full">
            {/* Header: Avatar, Name, Status Dropdown */}
            <div className="flex items-center justify-between pb-5 border-b border-[#F1F5F9] w-full">
              <div className="flex items-center gap-4">
                <div className="relative flex items-center justify-center w-16 h-16 bg-[#EFF6FF] border border-[#DBEAFE] rounded-full shrink-0 shadow-sm">
                  <FigmaUserAvatarIcon />

                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-[22px] leading-7 font-bold tracking-[-0.5px] text-[#0F172A]">
                      {user.username}
                    </h2>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide border ${status === "approved"
                        ? "bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]"
                        : status === "pending"
                          ? "bg-[#FFFBEB] border-[#FDE68A] text-[#B45309]"
                          : status === "expired"
                            ? "bg-[#FEF2F2] border-[#FECACA] text-[#DC2626]"
                            : "bg-[#F1F5F9] border-[#E2E8F0] text-[#475569]"
                        }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${status === "approved"
                          ? "bg-[#10B981]"
                          : status === "pending"
                            ? "bg-[#F59E0B]"
                            : status === "expired"
                              ? "bg-[#EF4444]"
                              : "bg-[#64748B]"
                          }`}
                      />
                      {status === "approved"
                        ? "Đã duyệt"
                        : status === "pending"
                          ? "Chờ duyệt"
                          : status === "rejected"
                            ? "Bị từ chối"
                            : status === "expired"
                              ? "Hết hạn"
                              : "Bị khóa"}
                    </span>
                  </div>
                  <p className="text-[13px] text-[#64748B]">
                    Tài khoản chuẩn • Đăng ký ngày {registeredDateStr}
                  </p>
                </div>
              </div>

              {/* Top-Right Status Select */}

            </div>

            {/* 2-Column Form Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5 w-full">
              {/* Field 1: Username */}
              <div className="flex flex-col gap-1.5 min-w-0">
                <label className="text-[11px] font-bold tracking-[0.55px] uppercase text-[#475569]">
                  TÊN ĐĂNG NHẬP (USERNAME) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    if (usernameError) setUsernameError("");
                  }}
                  placeholder="Nhập tên đăng nhập"
                  className={`w-full h-[42px] bg-white border ${usernameError
                    ? "border-red-500 focus:border-red-500 focus:ring-red-100"
                    : "border-[#E2E8F0] focus:border-blue-500 focus:ring-blue-100"
                    } rounded-lg px-3 text-xs font-medium text-[#0F172A] focus:outline-none focus:ring-2 transition-all placeholder:text-slate-400`}
                />
                {usernameError && (
                  <p className="text-[11px] text-red-500 font-medium mt-0.5">
                    {usernameError}
                  </p>
                )}
                <p className="text-[11px] text-[#94A3B8]">
                  Định danh duy nhất trên hệ thống FB Tool.
                </p>
              </div>

              {/* Field 2: Contact Info (Phone / Zalo) */}
              <div className="flex flex-col gap-1.5 min-w-0">
                <label className="text-[11px] font-bold tracking-[0.55px] uppercase text-[#475569]">
                  THÔNG TIN LIÊN HỆ (SĐT / ZALO) <span className="text-red-500">*</span>
                </label>
                <div className="relative flex items-center w-full">
                  <Phone className="absolute left-3 text-slate-400 w-4 h-4 pointer-events-none" />
                  <input
                    type="text"
                    value={contactInfo}
                    onChange={(e) => {
                      setContactInfo(e.target.value);
                      if (phoneError) setPhoneError("");
                    }}
                    placeholder="0912345678"
                    className={`w-full h-[42px] bg-white border ${phoneError
                      ? "border-red-500 focus:border-red-500 focus:ring-red-100"
                      : "border-[#E2E8F0] focus:border-blue-500 focus:ring-blue-100"
                      } rounded-lg pl-9 pr-3 text-xs font-medium text-[#0F172A] focus:outline-none focus:ring-2 transition-all placeholder:text-slate-400`}
                  />
                </div>
                {phoneError && (
                  <p className="text-[11px] text-red-500 font-medium mt-0.5">
                    {phoneError}
                  </p>
                )}
              </div>

              {/* Field 3: Package Select */}
              <div className="flex flex-col gap-1.5 min-w-0">
                <label className="text-[11px] font-bold tracking-[0.55px] uppercase text-[#475569]">
                  GÓI BẢN QUYỀN
                </label>
                <div className="relative flex items-center w-full">
                  <select
                    value={status === "pending" ? "keep" : packageOption}
                    onChange={(e) => handlePackageSelect(e.target.value)}
                    disabled={status === "pending"}
                    className="appearance-none w-full h-[42px] bg-white border border-[#E2E8F0] rounded-lg pl-3 pr-9 text-xs font-medium text-[#0F172A] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all cursor-pointer disabled:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                  >
                    <option value="keep">
                      {status === "pending" ? "Chưa kích hoạt (Cần phê duyệt)" : "Giữ nguyên thời hạn hiện tại"}
                    </option>
                    <option value="7">Gói 7 ngày</option>
                    <option value="30">Gói 30 ngày (1 tháng)</option>
                    <option value="90">Gói 90 ngày (3 tháng)</option>
                    <option value="365">Gói 1 năm (365 ngày)</option>
                    <option value="730">Gói 2 năm (730 ngày)</option>
                    {packageOption === "custom" && (
                      <option value="custom">Tùy chọn ngày cụ thể (đã chọn trên lịch)</option>
                    )}
                  </select>
                  <ChevronDown className="absolute right-3 text-slate-400 w-4 h-4 pointer-events-none" />
                </div>
                {status === "pending" && (
                  <p className="text-[11px] text-amber-600 font-medium">
                    Tài khoản đang chờ duyệt không thể cấp hạn sử dụng. Hãy chuyển trạng thái sang &quot;Đã duyệt&quot; để cấp hạn.
                  </p>
                )}
              </div>

              {/* Field 4: HWID Box + Reset Button */}
              <div className="flex flex-col gap-1.5 min-w-0">
                <label className="text-[11px] font-bold tracking-[0.55px] uppercase text-[#475569]">
                  HWID (MÃ THIẾT BỊ PHẦN CỨNG LIÊN KẾT)
                </label>
                <div className="flex items-center gap-2 w-full">
                  <div className="flex-1 h-[42px] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 flex items-center justify-between min-w-0">
                    <span className="font-mono font-semibold text-xs text-[#1D4ED8] truncate tracking-wide">
                      {user.hwid || "Chưa liên kết thiết bị"}
                    </span>
                    {user.hwid && (
                      <button
                        type="button"
                        onClick={() => copyHwid(user.hwid || "")}
                        className="p-1 text-slate-400 hover:text-slate-700 transition-colors shrink-0"
                        title="Sao chép HWID"
                      >
                        {copiedHwid ? (
                          <Check className="w-3.5 h-3.5 text-green-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleResetHwid}
                    disabled={actionLoading || !user.hwid}
                    className="h-[42px] px-3.5 bg-[#F1F5F9] hover:bg-[#E2E8F0] active:scale-95 border border-[#E2E8F0] rounded-lg inline-flex items-center gap-1.5 text-xs font-semibold text-[#334155] cursor-pointer whitespace-nowrap shrink-0 transition-all disabled:opacity-50"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>Đặt lại HWID</span>
                  </button>
                </div>
              </div>

              {/* Field 5: New Password (Optional) */}
              <div className="flex flex-col gap-1.5 min-w-0">
                <label className="text-[11px] font-bold tracking-[0.55px] uppercase text-[#475569]">
                  MẬT KHẨU MỚI (TÙY CHỌN)
                </label>
                <div className="relative flex items-center w-full">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (passwordError) setPasswordError("");
                    }}
                    placeholder="Nhập nếu muốn đổi mật khẩu mới"
                    className={`w-full h-[42px] bg-white border ${
                      passwordError || (password.trim() !== "" && !isValidPassword(password))
                        ? "border-red-500 focus:border-red-500 focus:ring-red-100"
                        : "border-[#E2E8F0] focus:border-blue-500 focus:ring-blue-100"
                    } rounded-lg pl-3 pr-10 text-xs font-medium text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:ring-2 transition-all [&::-ms-reveal]:hidden [&::-ms-clear]:hidden`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 p-1 text-slate-400 hover:text-slate-600 transition-colors"
                    title={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {(passwordError || (password.trim() !== "" && !isValidPassword(password))) && (
                  <p className="text-[11px] text-red-500 font-medium mt-0.5">
                    {passwordError || validatePassword(password).message}
                  </p>
                )}
              </div>

              {/* Field 6: Expiry Date Box with Datepicker */}
              <div className="flex flex-col gap-1.5 min-w-0">
                <label className="text-[11px] font-bold tracking-[0.55px] uppercase text-[#475569]">
                  NGÀY HẾT HẠN BẢN QUYỀN
                </label>
                <div className="relative flex items-center w-full">
                  <input
                    ref={datePickerRef}
                    type="date"
                    value={expiryDateInput}
                    onChange={(e) => handleDateInputChange(e.target.value)}
                    onClick={() => {
                      if (status !== "pending") {
                        try { datePickerRef.current?.showPicker?.(); } catch (err) { }
                      }
                    }}
                    disabled={status === "pending"}
                    className="w-full h-[42px] bg-white border border-[#E2E8F0] rounded-lg pl-3 pr-28 text-xs font-semibold text-[#0F172A] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all cursor-pointer disabled:bg-slate-100 disabled:cursor-not-allowed [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:opacity-0"
                  />
                  <div className="absolute right-3 flex items-center gap-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold pointer-events-none ${displayRemainingDays > 0
                        ? "bg-[#ECFDF5] border border-[#A7F3D0] text-[#047857]"
                        : "bg-[#FEF2F2] border border-[#FECACA] text-[#DC2626]"
                        }`}
                    >
                      {remainingText}
                    </span>
                    <button
                      type="button"
                      disabled={status === "pending"}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (status !== "pending") {
                          try { datePickerRef.current?.showPicker?.(); } catch (err) { datePickerRef.current?.focus(); }
                        }
                      }}
                      className="p-1 text-slate-400 hover:text-blue-600 transition-colors cursor-pointer disabled:opacity-50"
                      title="Chọn ngày trên lịch"
                    >
                      <Calendar className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Activity Logs Table */}
          <div className="bg-white border border-[#E2E8F0] shadow-sm rounded-xl p-5 flex flex-col gap-4 w-full">
            <div className="flex items-center justify-between w-full h-8">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center w-8 h-8 bg-[#EFF6FF] rounded-lg shrink-0">
                  <FigmaHistoryIcon />
                </div>
                <h3 className="text-lg font-bold tracking-tight text-[#0F172A]">
                  Lịch sử hoạt động
                </h3>
              </div>
              <span className="text-xs font-medium text-[#64748B] bg-slate-100/70 px-2.5 py-1 rounded-full">
                {totalLogItems} sự kiện ghi nhận
              </span>
            </div>

            <div className="border border-[#E2E8F0] rounded-xl overflow-hidden w-full">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-[#F8FAFC]">
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold tracking-wider uppercase text-[#475569] border-b border-[#E2E8F0]">
                      THỜI GIAN
                    </th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold tracking-wider uppercase text-[#475569] border-b border-[#E2E8F0]">
                      HÀNH ĐỘNG
                    </th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold tracking-wider uppercase text-[#475569] border-b border-[#E2E8F0]">
                      THÔNG TIN CHI TIẾT
                    </th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-semibold tracking-wider uppercase text-[#475569] border-b border-[#E2E8F0]">
                      NGƯỜI THỰC HIỆN
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {paginatedLogs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center py-6 px-4 text-slate-400 text-xs">
                        Chưa có lịch sử hoạt động
                      </td>
                    </tr>
                  ) : (
                    paginatedLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-4 py-3.5 text-xs text-[#475569] whitespace-nowrap">
                          {log.time}
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium tracking-wide border ${
                              log.tone === "green"
                                ? "bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]"
                                : log.tone === "blue"
                                ? "bg-[#EFF6FF] border-[#BFDBFE] text-[#1D4ED8]"
                                : log.tone === "red"
                                ? "bg-[#FEF2F2] border-[#FECACA] text-[#DC2626]"
                                : "bg-[#F1F5F9] border-[#E2E8F0] text-[#334155]"
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                log.tone === "green"
                                  ? "bg-[#10B981]"
                                  : log.tone === "blue"
                                  ? "bg-[#3B82F6]"
                                  : log.tone === "red"
                                  ? "bg-[#EF4444]"
                                  : "bg-[#64748B]"
                              }`}
                            />
                            {log.action}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-xs text-[#334155]">
                          {log.info.includes("HWID mới:") ? (
                            <>
                              HWID mới:{" "}
                              <span className="font-mono font-medium text-blue-600">
                                {log.info.replace("HWID mới:", "").trim()}
                              </span>
                            </>
                          ) : (
                            log.info
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right whitespace-nowrap">
                          {log.executor === "admin" ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600">
                              <ShieldCheck className="w-3.5 h-3.5" />
                              <span>admin</span>
                            </span>
                          ) : log.executor === "—" ? (
                            <span className="text-slate-400 text-sm">—</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#475569]">
                              <UserIcon className="w-3.5 h-3.5" />
                              <span>{log.executor}</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-[#F1F5F9]">
              <p className="text-xs text-[#64748B]">
                Hiển thị <span className="font-semibold text-[#1E293B]">{logRangeStart} - {logRangeEnd}</span> của <span className="font-semibold text-[#1E293B]">{totalLogItems}</span> sự kiện
                {totalLogPages > 0 && (
                  <span className="text-slate-400"> (Trang <span className="font-semibold text-[#1E293B]">{safeLogPage} / {totalLogPages}</span>)</span>
                )}
              </p>
              <div className="flex items-center gap-3">
                <div className="relative flex items-center">
                  <select
                    value={logPageSize}
                    onChange={(e) => {
                      setLogPageSize(Number(e.target.value));
                      setLogPage(1);
                    }}
                    className="appearance-none h-8 bg-white border border-[#E2E8F0] rounded-lg pl-2.5 pr-7 text-xs font-medium text-[#334155] focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    {[5, 10, 20].map((n) => (
                      <option key={n} value={n}>{n} / trang</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 text-slate-400 w-3.5 h-3.5 pointer-events-none" />
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={safeLogPage <= 1}
                    onClick={() => setLogPage(safeLogPage - 1)}
                    className="w-8 h-8 rounded-lg border border-[#E2E8F0] flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title="Trang trước"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  {getPageNumbers(safeLogPage, totalLogPages).map((p, idx) =>
                    typeof p === "number" ? (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setLogPage(p)}
                        className={`w-8 h-8 rounded-lg text-xs font-semibold transition-colors ${
                          p === safeLogPage
                            ? "bg-blue-600 text-white shadow-sm"
                            : "border border-[#E2E8F0] text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {p}
                      </button>
                    ) : (
                      <span key={`ellipsis-${idx}`} className="px-1 text-slate-400 text-xs">...</span>
                    )
                  )}
                  <button
                    type="button"
                    disabled={safeLogPage >= totalLogPages}
                    onClick={() => setLogPage(safeLogPage + 1)}
                    className="w-8 h-8 rounded-lg border border-[#E2E8F0] flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title="Trang sau"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Actions, Note, Submit/Cancel */}
        <div className="flex flex-col gap-6 w-full lg:w-[380px] shrink-0">
          {/* Card 1: Direct Actions (Lock & Delete) */}
          <div className="bg-white border border-[#E2E8F0] shadow-sm rounded-xl p-5 flex flex-col gap-4 w-full">
            <div className="flex flex-col gap-1">
              <h3 className="text-base font-bold text-[#0F172A]">Hành động</h3>
              <p className="text-xs text-[#64748B]">
                Thao tác trực tiếp trạng thái cấp phép cho tài khoản này.
              </p>
            </div>

            <div className="flex flex-col gap-2.5 w-full">
              <button
                type="button"
                onClick={handleBanToggle}
                disabled={actionLoading || user.status === "rejected"}
                title={user.status === "rejected" ? "Tài khoản đang bị từ chối" : undefined}
                className="w-full h-11 bg-[#FEF2F2] hover:bg-[#FEE2E2] active:scale-[0.98] border border-[#FECACA] rounded-xl flex items-center justify-center gap-2 text-xs font-semibold text-[#DC2626] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {user.status === "banned" ? (
                  <>
                    <Unlock className="w-4 h-4" />
                    <span>Mở khóa người dùng</span>
                  </>
                ) : (
                  <>
                    <Ban className="w-4 h-4" />
                    <span>Khóa người dùng</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleDelete}
                disabled={actionLoading}
                className="w-full h-11 bg-[#FEF2F2] hover:bg-[#FEE2E2] active:scale-[0.98] border border-[#FECACA] rounded-xl flex items-center justify-center gap-2 text-xs font-semibold text-[#CF2828] transition-all cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                <span>Xoá vĩnh viễn tài khoản</span>
              </button>
            </div>
          </div>

          {/* Card 2: Admin Warning / Note */}
          <div className="bg-white border border-[#E2E8F0] shadow-sm rounded-xl p-4 flex flex-col gap-2.5 w-full">
            <div className="flex items-center gap-1.5">
              <FigmaNoteIcon />
              <h4 className="text-[11px] font-bold tracking-wider uppercase text-blue-700">
                LƯU Ý QUẢN TRỊ
              </h4>
            </div>
            <p className="text-xs leading-5 text-[#475569]">
              Mỗi lượt Reset HWID sẽ hủy liên kết phần cứng ngay tức thì trên tool người dùng. Giới
              hạn 2 lần reset trong chu kỳ 30 ngày đối với tài khoản tiêu chuẩn.
            </p>
            <div className="pt-2 border-t border-[#F1F5F9] flex items-center justify-between text-xs">
              <span className="text-[#64748B]">Lần reset gần nhất:</span>
              <span className="font-semibold text-[#1E293B]">
                {user.last_hwid_reset_at
                  ? formatUtcDateTime(user.last_hwid_reset_at)
                  : "Chưa reset lần nào"}
              </span>
            </div>
          </div>

          {/* Bottom Actions: Cancel & Save */}
          <div className="flex items-center gap-3 w-full">
            <Link
              href="/dashboard/users"
              className="flex-1 h-11 bg-[#F1F5F9] hover:bg-[#E2E8F0] active:scale-[0.98] border border-[#E2E8F0] rounded-xl text-xs font-semibold text-[#475569] flex items-center justify-center transition-all"
            >
              Hủy bỏ
            </Link>
            <button
              type="submit"
              disabled={actionLoading}
              className="flex-1 h-11 bg-[#2563EB] hover:bg-[#1D4ED8] active:scale-[0.98] shadow-sm shadow-blue-500/25 rounded-xl text-xs font-semibold text-white flex items-center justify-center transition-all disabled:opacity-60 cursor-pointer"
            >
              {actionLoading ? "Đang lưu..." : "Lưu thay đổi"}
            </button>
          </div>
        </div>
      </form>

      {/* Footer */}
      <footer className="mt-4 pt-6 border-t border-[#E2E8F0] flex flex-col sm:flex-row items-center justify-between text-xs text-[#64748B] gap-2 w-full">
        <p>© 2026 FB Tool Admin. Hệ thống quản lý bản quyền phần mềm Facebook tự động hóa.</p>
        <div className="flex items-center gap-4">
          <a href="#" className="hover:text-blue-600 transition-colors">
            Điều khoản dịch vụ
          </a>
          <a href="#" className="hover:text-blue-600 transition-colors">
            Hỗ trợ kỹ thuật
          </a>
        </div>
      </footer>
    </div>
  );
}
