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

export const NETWORK_ERROR_MESSAGE = "Không thể kết nối tới Local Engine. Hãy kiểm tra Engine đã được bật chưa.";

// Engine tắt thì mọi request đều lỗi — chỉ ghi log 1 lần để console không bị spam
const warned = new Set();
function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

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
  (response) => {
    warned.delete("network"); // Engine đã chạy lại -> lần mất kết nối sau vẫn được ghi log
    return response.data;
  },
  async (error) => {
    const status = error.response?.status;
    const original = error.config;
    if (status === 401 && original && !original._retry && !shouldSkipRefresh(original.url)) {
      original._retry = true;
      try {
        await refreshAccess();
        return api.request(original);
      } catch (refreshError) {
        if (!refreshError.response) {
          const networkError = new Error(NETWORK_ERROR_MESSAGE);
          networkError.isNetworkError = true;
          return Promise.reject(networkError);
        }
        const refreshMsg =
          refreshError.response?.data?.detail ||
          refreshError.message ||
          "Phiên đăng nhập đã hết hạn";
        return Promise.reject(new Error(refreshMsg));
      }
    }
    // Không nhận được phản hồi: Local Engine chưa chạy / sai cổng / bị chặn
    if (!error.response) {
      warnOnce("network", `[API] Không kết nối được Local Engine (${API_BASE}) — ${error.message}`);
      const networkError = new Error(NETWORK_ERROR_MESSAGE);
      networkError.isNetworkError = true;
      return Promise.reject(networkError);
    }
    const errorMsg = error.response.data?.detail || error.response.data?.message || error.message || "Yêu cầu thất bại";
    // Dùng console.warn thay vì console.error: lỗi đã được báo trên giao diện,
    // console.error sẽ bật màn "Console Error" của Next.js khi chạy dev.
    if (status !== 401) console.warn(`[API ${status}] ${original?.method?.toUpperCase() || ""} ${original?.url || ""}`, errorMsg);
    const httpError = new Error(typeof errorMsg === "string" ? errorMsg : "Yêu cầu thất bại");
    httpError.status = status;
    return Promise.reject(httpError);
  }
);

export default api;
