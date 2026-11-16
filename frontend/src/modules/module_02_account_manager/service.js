import api from "@/services/api";
import { API_BASE } from "@/config/constants";
import { parseCategoriesResponse } from "./utils/categories.mjs";

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
  if (trimmed === "Category name already exists") return "Tên danh mục đã tồn tại.";
  if (trimmed === "Category not found") return "Danh mục không còn tồn tại. Vui lòng tải lại danh sách.";

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
  if (/Cannot confirm Chrome is closed/i.test(trimmed)) {
    return "Không thể xác nhận Chrome đã đóng. Hệ thống đang tự động dọn dẹp tiến trình Chrome.";
  }
  if (/Close Chrome before changing UID/i.test(trimmed)) {
    return "Vui lòng đóng trình duyệt Chrome trước khi thay đổi UID.";
  }
  if (/UID already exists/i.test(trimmed)) {
    return "Tài khoản với UID này đã tồn tại trong hệ thống.";
  }
  if (/Destination profile already exists/i.test(trimmed)) {
    return "Thư mục dữ liệu hồ sơ đích đã tồn tại trên đĩa.";
  }
  if (/Profile is busy or queued/i.test(trimmed)) {
    return "Hồ sơ tài khoản đang bận hoặc đang trong hàng đợi xử lý.";
  }
  if (/Account not found/i.test(trimmed)) {
    return "Không tìm thấy tài khoản trong hệ thống.";
  }
  if (/Save failed and restoring/i.test(trimmed)) {
    return "Lưu thất bại và khôi phục thư mục hồ sơ cũ không thành công.";
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
    throw new Error(formatApiError(error));
  }
}

export async function importAccounts(accounts, checkStatus = false, skipExisting = false) {
  try {
    return await api.post("/api/accounts/import", {
      accounts,
      check_status: checkStatus,
      skip_existing: skipExisting,
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

export async function getDeletePreview(uids) {
  try {
    return await api.post("/api/accounts/delete-preview", { uids });
  } catch (error) {
    throw new Error(formatApiError(error));
  }
}

export async function deleteAccount(uid, deletePages = false) {
  try {
    return await api.delete(`/api/accounts/${encodeURIComponent(uid)}`, { params: { delete_pages: deletePages } });
  } catch (error) {
    throw new Error(formatApiError(error));
  }
}

export async function bulkDeleteAccounts(uids, deletePages = false) {
  try {
    return await api.post("/api/accounts/bulk-delete", { uids, delete_pages: deletePages });
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

export async function openLiveBrowser(uid, targetUrl) {
  try {
    const body = { uid };
    if (targetUrl) body.target_url = targetUrl;
    return await api.post("/api/accounts/open-browser", body);
  } catch (error) {
    throw new Error(formatApiError(error));
  }
}

export function getAccountOperation(operationId) {
  return api.get(`/api/accounts/operations/${encodeURIComponent(operationId)}`);
}

export async function testProxy(proxy) {
  try {
    return await api.post("/api/accounts/test-proxy", { proxy });
  } catch (error) {
    throw new Error(formatApiError(error));
  }
}

export async function getAccountsPage(query = {}) {
  try { return await api.get("/api/accounts/page", { params: { limit: 10, ...query } }); }
  catch (error) { throw new Error(formatApiError(error)); }
}
export async function getAccountsStats() {
  try { return await api.get("/api/accounts/stats"); }
  catch (error) { throw new Error(formatApiError(error)); }
}

export async function getCategories() {
  try { return parseCategoriesResponse(await api.get("/api/accounts/categories")); }
  catch (error) { throw new Error(formatApiError(error)); }
}

export async function saveCategory(data, id = null) {
  try {
    return id === null ? await api.post("/api/accounts/categories", data)
      : await api.patch(`/api/accounts/categories/${id}`, data);
  } catch (error) { throw new Error(formatApiError(error)); }
}

export async function deleteCategory(id) {
  try { return await api.delete(`/api/accounts/categories/${id}`); }
  catch (error) { throw new Error(formatApiError(error)); }
}

export async function setAccountCategory(uids, categoryId) {
  try { return await api.post("/api/accounts/bulk-set-category", { uids, category_id: categoryId }); }
  catch (error) { throw new Error(formatApiError(error)); }
}
export async function checkExistingUids(uids) {
  try { return (await api.post("/api/accounts/existing-uids", { uids })).uids; }
  catch (error) { throw new Error(formatApiError(error)); }
}
