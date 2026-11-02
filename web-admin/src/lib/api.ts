export function getVpsBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_VPS_API_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    return `${window.location.protocol}//${window.location.hostname}:28129`;
  }
  return "http://127.0.0.1:28129";
}

export interface User {
  id: number;
  username: string;
  contact_info: string;
  hwid: string | null;
  role: string;
  status: string;
  expired_at: string | null;
  created_at: string;
  days_remaining: number | null;
  // Login session info
  last_login_at: string | null;
  last_login_ip: string | null;
  is_online?: boolean;
  last_active_at?: string | null;
  // HWID reset tracking
  last_hwid_reset_at?: string | null;
}

export interface UserSession {
  id: number;
  user_id: number;
  ip_address: string | null;
  device_type: string | null;
  browser: string | null;
  os: string | null;
  login_at: string;
  last_active_at: string;
  is_active: boolean;
  logout_at: string | null;
}

export interface UserSessionSummary {
  last_login_at: string | null;
  last_login_ip: string | null;
  last_device_type: string | null;
  last_browser: string | null;
  last_os: string | null;
  active_sessions_count: number;
  total_sessions: number;
  sessions: UserSession[];
}

export interface Notification {
  id: number;
  user_id: number | null;
  type: string;
  target?: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface ActivityLog {
  id: number;
  admin_username: string;
  admin_role: string;
  action_type: string;
  target_username: string | null;
  target_uid: number | null;
  target_role: string | null;
  change_detail: string | null;
  result: string;
  error_message: string | null;
  ip_address: string | null;
  user_agent: string | null;
  note: string | null;
  created_at: string;
}

export interface Stats {
  total_users: number;
  pending: number;
  approved: number;
  banned: number;
  expired?: number;
  expiring_soon: number;
  unread_notifications: number;
}

export function translateApiError(raw: any): string {
  if (!raw) return "Lỗi không xác định từ máy chủ";
  let str = typeof raw === "string" ? raw : (raw.detail || raw.message || "");
  if (typeof str !== "string") {
    if (Array.isArray(str)) {
      str = str.map((item: any) => item.msg || JSON.stringify(item)).join(", ");
    } else {
      str = JSON.stringify(str);
    }
  }
  str = str.trim();
  if (/bị khóa|banned|locked|account_banned/i.test(str)) {
    return "Tài khoản của bạn đã bị khóa";
  }
  if (/session_revoked|session.*revoked/i.test(str)) {
    return "Phiên đăng nhập đã bị vô hiệu hóa";
  }
  if (/username already exists/i.test(str)) {
    return "Tên đăng nhập đã tồn tại trên hệ thống.";
  }
  if (/user not found/i.test(str)) {
    return "Không tìm thấy người dùng trên hệ thống.";
  }
  if (/invalid.*credentials/i.test(str)) {
    return "Tên đăng nhập hoặc mật khẩu không chính xác.";
  }
  if (/missing authorization/i.test(str)) {
    return "Phiên làm việc hết hạn hoặc thiếu thông tin xác thực.";
  }
  if (/token_invalid|invalid.*token/i.test(str) || /expired token/i.test(str)) {
    return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  }
  if (/admin only|unauthorized|forbidden/i.test(str)) {
    return "Bạn không có quyền thực hiện thao tác này.";
  }
  return str || "Lỗi xử lý yêu cầu";
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
    this.name = "ApiError";
  }
}

const ADMIN_REFRESH_KEY = "admin_refresh_token";

export function setAdminTokens(access?: string | null, refresh?: string | null) {
  if (typeof window === "undefined") return;
  if (access) localStorage.setItem("admin_token", access);
  if (refresh) localStorage.setItem(ADMIN_REFRESH_KEY, refresh);
}

export function clearAdminTokens() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("admin_token");
  localStorage.removeItem(ADMIN_REFRESH_KEY);
}

let refreshPromise: Promise<void> | null = null;

function refreshAdminToken(): Promise<void> {
  if (!refreshPromise) {
    const previousToken = typeof window !== "undefined" ? localStorage.getItem("admin_token") : null;
    const refreshToken = typeof window !== "undefined" ? localStorage.getItem(ADMIN_REFRESH_KEY) : null;
    refreshPromise = fetchApi("/api/v1/auth/refresh", {
      method: "POST",
      headers: { "X-Auth-Client": "admin" },
      // Cross-origin Render: cookie API không gửi được → bắt buộc body
      body: JSON.stringify(refreshToken ? { refresh_token: refreshToken } : {}),
    }, false).then((data) => {
      if (typeof data.access_token !== "string" || !data.access_token) {
        throw new ApiError("Máy chủ chưa hỗ trợ làm mới phiên admin. Vui lòng thử lại sau.", 502, "ADMIN_REFRESH_UNAVAILABLE");
      }
      // Do not restore a session after logout or overwrite a newer login in another tab.
      if (typeof window !== "undefined" && localStorage.getItem("admin_token") === previousToken && previousToken) {
        localStorage.setItem("admin_token", data.access_token);
        if (typeof data.refresh_token === "string" && data.refresh_token) {
          localStorage.setItem(ADMIN_REFRESH_KEY, data.refresh_token);
        }
      }
    }).finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function fetchApi(path: string, options?: RequestInit, allowRefresh = true): Promise<any> {
  const token = typeof window !== "undefined" ? localStorage.getItem("admin_token") : null;
  const res = await fetch(`${getVpsBase()}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const rawDetail = typeof err.detail === "string" ? err.detail : (Array.isArray(err.detail) ? err.detail.map((d: any) => d.msg).join(", ") : res.statusText);
    const translatedMsg = translateApiError(rawDetail || "Lỗi kết nối máy chủ");
    const isLocked = /bị khóa|banned|locked|account_banned/i.test(rawDetail);
    const isSessionRevoked = /session_revoked|revoked/i.test(rawDetail);
    const skipRefresh = ["/admin/login", "/auth/refresh", "/auth/logout"].some((part) => path.includes(part));

    // A late failure from an old session must not clear a newer login/refresh.
    if (typeof window !== "undefined" && token && localStorage.getItem("admin_token") !== token &&
        (res.status === 401 || isLocked || (res.status === 403 && path.includes("/auth/refresh")))) {
      if (allowRefresh && !skipRefresh && localStorage.getItem("admin_token")) return fetchApi(path, options, false);
      throw new ApiError("Phản hồi thuộc phiên đăng nhập cũ.", 409, "AUTH_SESSION_CHANGED");
    }

    if (res.status === 401 && allowRefresh && !skipRefresh && !isLocked && !isSessionRevoked &&
        typeof window !== "undefined" && token && !sessionStorage.getItem("pending_logout_modal")) {
      // A concurrent request may already have renewed this token.
      if (localStorage.getItem("admin_token") === token) await refreshAdminToken();
      return fetchApi(path, options, false);
    }

    // Tự động đăng xuất bị động (passive logout) nếu tài khoản bị khóa hoặc phiên bị hủy
    if (typeof window !== "undefined" && !path.includes("/admin/login")) {
      // Nếu đang trong quá trình hiển thị popup thông báo logout (ví dụ sau khi đổi username),
      // tạm dừng tự động điều hướng để popup hiển thị trọn vẹn cho người dùng
      if (sessionStorage.getItem("pending_logout_modal")) {
        throw new ApiError(translatedMsg, res.status, rawDetail);
      }

      if (isLocked) {
        clearAdminTokens();
        sessionStorage.setItem("auth_error", "Tài khoản của bạn đã bị khóa");
        window.location.href = `/login?error=${encodeURIComponent("Tài khoản của bạn đã bị khóa")}`;
      } else if (res.status === 401 && isSessionRevoked) {
        clearAdminTokens();
        const msg = "Phiên đã bị thu hồi: tài khoản đăng nhập ở phiên khác, đã đăng xuất hoặc thông tin bảo mật đã thay đổi. Vui lòng đăng nhập lại.";
        sessionStorage.setItem("auth_error", msg);
        window.location.href = `/login?error=${encodeURIComponent(msg)}`;
      } else if (
        // Chỉ đá phiên khi refresh thật sự fail auth — tránh out vì lỗi tạm / cold start
        (res.status === 401 && path.includes("/auth/refresh"))
        || (res.status === 403 && path.includes("/auth/refresh"))
        || (res.status === 401 && !allowRefresh && !path.includes("/auth/logout"))
      ) {
        clearAdminTokens();
        sessionStorage.setItem("auth_error", translatedMsg);
        window.location.href = `/login?error=${encodeURIComponent(translatedMsg)}`;
      }
    }

    throw new ApiError(translatedMsg, res.status, rawDetail);
  }
  return res.json();
}

export function getCurrentAdminUser(): { username: string; id?: number } | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem("admin_token");
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length >= 2) {
      const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const json = decodeURIComponent(
        Array.prototype.map
          .call(atob(base64), (c: string) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
          .join("")
      );
      const payload = JSON.parse(json);
      const storedUsername = localStorage.getItem("admin_username");
      const storedId = localStorage.getItem("admin_id");
      return {
        username: storedUsername || payload.sub || "",
        id: storedId ? Number(storedId) : (payload.user_id ? Number(payload.user_id) : undefined),
      };
    }
  } catch {
    // fallback to stored values
  }
  const storedUsername = localStorage.getItem("admin_username");
  if (storedUsername) {
    const storedId = localStorage.getItem("admin_id");
    return {
      username: storedUsername,
      id: storedId ? Number(storedId) : undefined,
    };
  }
  return null;
}

export interface AdminMe {
  id: number;
  username: string;
  role: string;
  contact_info: string;
  status: string;
  created_at: string | null;
  last_login_at?: string | null;
  last_login_ip?: string | null;
}

export const api = {
  refreshAdmin: refreshAdminToken,
  adminLogin: (username: string, password: string, rememberMe = true) =>
    fetchApi("/api/v1/admin/login", { method: "POST", body: JSON.stringify({ username, password, remember_me: rememberMe }) }),

  getAdminMe: async (): Promise<AdminMe> => {
    const data: AdminMe = await fetchApi("/api/v1/admin/me");
    if (typeof window !== "undefined" && data) {
      if (data.username) localStorage.setItem("admin_username", data.username);
      if (data.id) localStorage.setItem("admin_id", String(data.id));
    }
    return data;
  },

  getStats: (): Promise<Stats> => fetchApi("/api/v1/admin/stats"),

  getUsers: (status?: string): Promise<User[]> =>
    fetchApi(`/api/v1/admin/users${status ? `?status_filter=${status}` : ""}`),

  getAdmins: (status?: string): Promise<User[]> =>
    fetchApi(`/api/v1/admin/admins${status ? `?status_filter=${status}` : ""}`),

  approveUser: (id: number, days: number) =>
    fetchApi(`/api/v1/admin/users/${id}/approve`, { method: "PUT", body: JSON.stringify({ days }) }),

  extendUser: (id: number, days: number) =>
    fetchApi(`/api/v1/admin/users/${id}/extend`, { method: "PUT", body: JSON.stringify({ days }) }),

  banUser: (id: number) =>
    fetchApi(`/api/v1/admin/users/${id}/ban`, { method: "PUT" }),

  createUser: (payload: { username: string; password: string; contact_info?: string; days: number; status: string; role?: string; hwid?: string }) =>
    fetchApi("/api/v1/admin/users", { method: "POST", body: JSON.stringify(payload) }),

  editUser: (id: number, payload: { username?: string; contact_info?: string; days?: number; password?: string; status?: string; role?: string; hwid?: string }) =>
    fetchApi(`/api/v1/admin/users/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  unbanUser: (id: number) =>
    fetchApi(`/api/v1/admin/users/${id}/unban`, { method: "PUT" }),

  deleteUser: (id: number) =>
    fetchApi(`/api/v1/admin/users/${id}`, { method: "DELETE" }),

  rejectUser: (id: number) =>
    fetchApi(`/api/v1/admin/users/${id}/reject`, { method: "PUT" }),

  resetHwid: (id: number) =>
    fetchApi(`/api/v1/admin/users/${id}/hwid`, { method: "DELETE", body: JSON.stringify({ reason: "User request" }) }),

  getNotifications: (unreadOnly = false, target: string = "admin"): Promise<Notification[]> =>
    fetchApi(`/api/v1/admin/notifications?unread_only=${unreadOnly}&target=${encodeURIComponent(target)}`),

  markRead: (id: number) =>
    fetchApi(`/api/v1/admin/notifications/${id}/read`, { method: "PUT" }),

  markAllRead: () =>
    fetchApi("/api/v1/admin/notifications/read-all", { method: "PUT" }),

  deleteNotification: (id: number) =>
    fetchApi(`/api/v1/admin/notifications/${id}`, { method: "DELETE" }),

  batchDeleteNotifications: (ids: number[]) =>
    fetchApi("/api/v1/admin/notifications/batch-delete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),

  getUserSessions: (userId: number): Promise<UserSessionSummary> =>
    fetchApi(`/api/v1/auth/user-sessions/${userId}`),

  getMySessions: (): Promise<UserSessionSummary> =>
    fetchApi("/api/v1/auth/my-sessions"),

  changePassword: (payload: { old_password: string; new_password: string; username?: string }): Promise<{ success: boolean; message: string }> =>
    fetchApi("/api/v1/auth/change-password", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  logout: async (): Promise<{ success: boolean; message: string }> => {
    try {
      return await fetchApi("/api/v1/auth/logout", { method: "POST", headers: { "X-Auth-Client": "admin" } });
    } finally {
      clearAdminTokens();
    }
  },

  getActivityLogs: (limit = 200): Promise<ActivityLog[]> =>
    fetchApi(`/api/v1/admin/activity-logs?limit=${limit}`),
};

