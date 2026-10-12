import axios from "axios";
import { API_BASE } from "../config/constants";

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 60000,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

let refreshPromise = null;

function refreshAccess() {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${API_BASE}/api/v1/auth/refresh`, {}, { withCredentials: true, timeout: 15000 })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

function shouldSkipRefresh(url) {
  return ["/auth/refresh", "/verify-license", "/admin/login", "/auth/register", "/auth/logout"].some((part) =>
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
  (response) => response.data,
  async (error) => {
    const status = error.response?.status;
    const original = error.config;
    if (status === 401 && original && !original._retry && !shouldSkipRefresh(original.url)) {
      original._retry = true;
      try {
        await refreshAccess();
        return api.request(original);
      } catch (refreshError) {
        const refreshMsg =
          refreshError.response?.data?.detail ||
          refreshError.message ||
          "Phiên đăng nhập đã hết hạn";
        return Promise.reject(new Error(typeof refreshMsg === "string" ? refreshMsg : "Phiên đăng nhập đã hết hạn"));
      }
    }
    const errorMsg = extractErrorMessage(error);
    console.warn("[API Error]", errorMsg);
    return Promise.reject(new Error(errorMsg));
  }
);

export default api;
