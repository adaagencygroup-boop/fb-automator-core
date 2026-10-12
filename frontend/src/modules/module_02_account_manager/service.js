import api from "@/services/api";
import { API_BASE } from "@/config/constants";

export const FIELD_LABEL_MAP = {
  threads: "Số luồng",
  proxy: "Proxy",
  uid: "UID",
  password: "Mật khẩu",
  two_fa: "Mã 2FA",
  cookie: "Cookie",
  token: "Token",
  email: "Email",
  pass_mail: "Mật khẩu Email",
  mail_recovery: "Mail khôi phục",
  token_hotmail: "Token Hotmail",
  client_id: "Client ID",
};

export function translateErrorMessage(msg) {
  if (!msg) return "Dữ liệu không hợp lệ";
  const trimmed = String(msg).trim();

  if (/input should be a valid integer/i.test(trimmed)) {
    return "Yêu cầu nhập số nguyên hợp lệ";
  }
  if (/field required/i.test(trimmed)) {
    return "Thông tin bắt buộc, không được để trống";
  }
  if (/failed to fetch/i.test(trimmed) || /networkerror/i.test(trimmed)) {
    return "Không thể kết nối đến máy chủ Local Engine";
  }
  if (/engine offline/i.test(trimmed)) {
    return "Dịch vụ Local Engine chưa sẵn sàng hoặc đã bị tắt";
  }
  if (/Profile đang được sử dụng/i.test(trimmed)) {
    return "Trình duyệt của tài khoản này đang mở. Vui lòng đóng cửa sổ Chrome trước khi xóa.";
  }
  return trimmed;
}

export function formatApiError(err) {
  if (!err) return "Lỗi không xác định";
  const data = err.response?.data || err;
  let detail = data.detail ?? data.message ?? err.message ?? data;

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (!item || typeof item !== "object") return translateErrorMessage(String(item));
        const loc = Array.isArray(item.loc) ? item.loc : [];
        const rawField = loc[loc.length - 1];
        const fieldName = rawField && typeof rawField === "string" ? (FIELD_LABEL_MAP[rawField] || rawField) : "";
        const rawMsg = item.msg || item.message || JSON.stringify(item);
        const translated = translateErrorMessage(rawMsg);
        return fieldName ? `Trường '${fieldName}': ${translated}` : translated;
      })
      .join(", ");
  }

  if (typeof detail === "object" && detail !== null) {
    if (detail.msg || detail.message) {
      return translateErrorMessage(detail.msg || detail.message);
    }
    return JSON.stringify(detail);
  }

  return translateErrorMessage(String(detail));
}

// ── Account API Endpoints ──

export async function getAccounts() {
  try {
    const data = await api.get("/api/accounts");
    return Array.isArray(data) ? data : data?.accounts || [];
  } catch (error) {
    console.error("Lỗi tải danh sách tài khoản:", error);
    return [];
  }
}

export async function importAccounts(accounts, checkStatus = false) {
  try {
    return await api.post("/api/accounts/import", {
      accounts,
      check_status: checkStatus,
    });
  } catch (error) {
    throw new Error(formatApiError(error));
  }
}

export async function getAccountDetail(uid) {
  try {
    return await api.get(`/api/accounts/${encodeURIComponent(uid)}`);
  } catch (error) {
    throw new Error(formatApiError(error));
  }
}

export async function saveSingleAccount(account) {
  try {
    return await api.post("/api/accounts/single", account);
  } catch (error) {
    throw new Error(formatApiError(error));
  }
}

export async function deleteAccount(uid) {
  try {
    return await api.delete(`/api/accounts/${encodeURIComponent(uid)}`);
  } catch (error) {
    throw new Error(formatApiError(error));
  }
}

export async function bulkDeleteAccounts(uids) {
  try {
    return await api.post("/api/accounts/bulk-delete", { uids });
  } catch (error) {
    throw new Error(formatApiError(error));
  }
}

export async function checkAccountStatuses(uids) {
  try {
    return await api.post("/api/accounts/check-status", { uids });
  } catch (error) {
    throw new Error(formatApiError(error));
  }
}

export async function loginAccounts(uids, threads = 3) {
  try {
    return await api.post("/api/accounts/login", { uids, threads });
  } catch (error) {
    throw new Error(formatApiError(error));
  }
}

export async function openLiveBrowser(uid) {
  try {
    return await api.post("/api/accounts/open-browser", { uid });
  } catch (error) {
    throw new Error(formatApiError(error));
  }
}

export async function testProxy(proxy) {
  try {
    return await api.post("/api/accounts/test-proxy", { proxy });
  } catch (error) {
    throw new Error(formatApiError(error));
  }
}
