import axios from "axios";
import { API_BASE } from "../config/constants";
import { acceptSessionUser, getSessionUserId } from "./sessionIdentity.mjs";

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 60000,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    "X-Auth-Client": "user",
  },
});

api.interceptors.request.use((config) => {
  const userId = getSessionUserId();
  const identityFree = ["/auth/login", "/auth/register", "/verify-license", "/registration-status"].some((path) => String(config.url).includes(path));
  if (userId && !identityFree) config.headers["X-Auth-User-Id"] = userId;
  else delete config.headers["X-Auth-User-Id"];
  return config;
});

export const NETWORK_ERROR_MESSAGE = "Không thể kết nối tới Local Engine. Hãy kiểm tra Engine đã được bật chưa.";

// Engine tắt thì mọi request đều lỗi — chỉ ghi log 1 lần để console không bị spam
const warned = new Set();
function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

let refreshPromise = null;

function apiError(error) {
  const detail = error.response?.data?.detail || error.response?.data?.message;
  const result = new Error(typeof detail === "string" ? detail : error.message || "Không thể kết nối tới Local Engine");
  result.status = error.response?.status || 0;
  result.code = typeof detail === "string" ? detail : error.code;
  return result;
}

function refreshAccess() {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${API_BASE}/api/v1/auth/refresh`, {}, {
        withCredentials: true, timeout: 15000,
        headers: { "X-Auth-Client": "user", ...(getSessionUserId() ? { "X-Auth-User-Id": getSessionUserId() } : {}) },
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

function shouldSkipRefresh(url) {
  return ["/auth/refresh", "/auth/login", "/registration-status", "/verify-license", "/admin/login", "/auth/register", "/auth/logout"].some((part) =>
    String(url || "").includes(part)
  );
}

function extractErrorMessage(error) {
  const detail = error.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item?.msg) {
          const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : "";
          return field ? `${field}: ${item.msg}` : item.msg;
        }
        return JSON.stringify(item);
      })
      .join("; ");
  }
  if (detail && typeof detail === "object") {
    return detail.message || JSON.stringify(detail);
  }
  return (
    error.response?.data?.message ||
    error.message ||
    "Không thể kết nối tới Local Engine (Port 28129)"
  );
}

api.interceptors.response.use(
  (response) => {
    if (String(response.config.url).split("?")[0].endsWith("/api/v1/auth/me")) acceptSessionUser(response.data);
    warned.delete("network"); // Engine đã chạy lại -> lần mất kết nối sau vẫn được ghi log
    return response.data;
  },
  async (error) => {
    const status = error.response?.status;
    const original = error.config;
    const detail = error.response?.data?.detail;
    if (status === 401 && !["SESSION_IDENTITY_CHANGED", "SESSION_REVOKED"].includes(detail) && original && !original._retry && !shouldSkipRefresh(original.url)) {
      original._retry = true;
      try {
        await refreshAccess();
        return api.request(original);
      } catch (refreshError) {
        return Promise.reject(apiError(refreshError));
      }
    }
    const errorMsg =
      error.response?.data?.detail ||
      error.response?.data?.message ||
      error.message ||
      "Không thể kết nối tới Local Engine (Port 28129)";
    console.error("[API Error]", errorMsg);
    return Promise.reject(apiError(error));
  }
);

export default api;
