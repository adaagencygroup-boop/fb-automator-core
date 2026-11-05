import axios from "axios";
import { API_BASE } from "../config/constants";
import { acceptSessionUser, getSessionUserId } from "./sessionIdentity.mjs";
import {
  clearAuthTokens,
  getAccessToken,
  getRefreshToken,
  getRegistrationToken,
  setAuthTokens,
  setRegistrationToken,
} from "./authTokens.mjs";

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
  const identityFree = ["/auth/login", "/auth/register", "/verify-license", "/registration-status", "/claim-approval"].some((path) =>
    String(config.url).includes(path)
  );
  if (userId && !identityFree) config.headers["X-Auth-User-Id"] = userId;
  else delete config.headers["X-Auth-User-Id"];

  // Bearer cho desktop Tauri (cookie cross-origin không可靠)
  const token = getAccessToken();
  if (token && !identityFree) config.headers.Authorization = `Bearer ${token}`;
  else if (identityFree) delete config.headers.Authorization;

  const registrationToken = getRegistrationToken();
  if (
    registrationToken
    && ["/registration-status", "/claim-approval"].some((path) => String(config.url).includes(path))
  ) {
    config.headers["X-Registration-Token"] = registrationToken;
  }

  return config;
});

export const NETWORK_ERROR_MESSAGE = "Không thể kết nối tới Local Engine. Hãy kiểm tra Engine đã được bật chưa.";

const warned = new Set();
function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

let refreshPromise = null;
const SESSION_EVENT = "fb-session-revoked";
const TERMINAL_AUTH = new Set([
  "SESSION_REVOKED",
  "ACCOUNT_BANNED",
  "ACCOUNT_LOCKED",
  "ACCOUNT_PENDING",
  "ACCOUNT_REJECTED",
  "ACCOUNT_NOT_FOUND",
]);

function authDetail(error) {
  const detail = error?.response?.data?.detail;
  return typeof detail === "string" ? detail : "";
}

function notifySessionLost(code) {
  if (typeof window === "undefined" || code !== "SESSION_REVOKED") return;
  window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: code }));
}

function extractErrorMessage(error) {
  if (error.code === "ECONNABORTED" || (typeof error.message === "string" && error.message.toLowerCase().includes("timeout"))) {
    return "Quá thời gian kết nối tới máy chủ (timeout 60s). Vui lòng thử lại sau.";
  }
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

function apiError(error) {
  const message = extractErrorMessage(error);
  const result = new Error(message);
  result.status = error.response?.status || 0;
  result.code = typeof error.response?.data?.detail === "string" ? error.response.data.detail : error.code;
  return result;
}

function captureTokensFromPayload(payload) {
  if (!payload || typeof payload !== "object") return;
  if (payload.access_token || payload.refresh_token) {
    setAuthTokens({
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
    });
  }
  if (payload.registration_token) {
    setRegistrationToken(payload.registration_token);
  }
}

function refreshAccess() {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(
        `${API_BASE}/api/v1/auth/refresh`,
        { refresh_token: getRefreshToken() || undefined },
        {
          withCredentials: true,
          timeout: 12000,
          headers: {
            "X-Auth-Client": "user",
            ...(getSessionUserId() ? { "X-Auth-User-Id": getSessionUserId() } : {}),
            ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
          },
        }
      )
      .then((response) => {
        captureTokensFromPayload(response.data);
        return response;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

function shouldSkipRefresh(url) {
  return ["/auth/refresh", "/auth/login", "/registration-status", "/claim-approval", "/verify-license", "/admin/login", "/auth/register", "/auth/logout"].some((part) =>
    String(url || "").includes(part)
  );
}

api.interceptors.response.use(
  (response) => {
    const path = String(response.config.url || "").split("?")[0];
    if (path.endsWith("/api/v1/auth/me")) acceptSessionUser(response.data);
    if (
      path.endsWith("/api/v1/auth/login")
      || path.endsWith("/api/v1/auth/register")
      || path.endsWith("/api/v1/auth/verify-license")
      || path.endsWith("/api/v1/auth/refresh")
      || path.endsWith("/api/v1/auth/claim-approval")
    ) {
      captureTokensFromPayload(response.data);
    }
    // Login pending/banned trả 403 kèm registration_token trong body lỗi
    if (path.endsWith("/api/v1/auth/login") && response.data?.registration_token) {
      setRegistrationToken(response.data.registration_token);
    }
    warned.delete("network");
    return response.data;
  },
  async (error) => {
    if (!error.response && error.request) {
      warnOnce("network", NETWORK_ERROR_MESSAGE);
    }
    const regToken = error.response?.data?.registration_token;
    if (typeof regToken === "string" && regToken) {
      setRegistrationToken(regToken);
    }
    const status = error.response?.status;
    const original = error.config;
    const detail = authDetail(error);
    const canRefreshMissingAuth =
      detail === "Thiếu thông tin xác thực đăng nhập" && Boolean(getRefreshToken());
    if (
      status === 401
      && original
      && !original._retry
      && !shouldSkipRefresh(original.url)
      && !TERMINAL_AUTH.has(detail)
      && detail !== "SESSION_IDENTITY_CHANGED"
      && (detail !== "Thiếu thông tin xác thực đăng nhập" || canRefreshMissingAuth)
    ) {
      original._retry = true;
      try {
        await refreshAccess();
        const token = getAccessToken();
        if (token) original.headers.Authorization = `Bearer ${token}`;
        return api.request(original);
      } catch (refreshError) {
        clearAuthTokens();
        const refreshDetail = authDetail(refreshError);
        notifySessionLost(refreshDetail);
        return Promise.reject(apiError(refreshError));
      }
    }
    if (TERMINAL_AUTH.has(detail) || detail === "SESSION_REVOKED") {
      clearAuthTokens();
      notifySessionLost(detail);
      return Promise.reject(apiError(error));
    }
    const errorMsg =
      error.response?.data?.detail ||
      error.response?.data?.message ||
      error.message ||
      "Không thể kết nối tới Local Engine (Port 28129)";
    if (status !== 401 && status !== 403) {
      console.warn("[API Error]", errorMsg);
    }
    return Promise.reject(apiError(error));
  }
);

export default api;
