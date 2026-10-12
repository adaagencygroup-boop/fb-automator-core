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
        return Promise.reject(new Error(refreshMsg));
      }
    }
    const errorMsg =
      error.response?.data?.detail ||
      error.response?.data?.message ||
      error.message ||
      "Không thể kết nối tới Local Engine (Port 28129)";
    console.error("[API Error]", errorMsg);
    return Promise.reject(new Error(typeof errorMsg === "string" ? errorMsg : "Yêu cầu thất bại"));
  }
);

export default api;
