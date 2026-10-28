/** Token Bearer cho desktop Tauri — cookie cross-origin (tauri.localhost → 127.0.0.1) không dùng được. */

const ACCESS_KEY = "fb_user_access_token";
const REFRESH_KEY = "fb_user_refresh_token";

export function setAuthTokens({ access_token, refresh_token } = {}) {
  if (typeof window === "undefined") return;
  if (access_token) sessionStorage.setItem(ACCESS_KEY, access_token);
  if (refresh_token) localStorage.setItem(REFRESH_KEY, refresh_token);
}

export function getAccessToken() {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(ACCESS_KEY) || "";
}

export function getRefreshToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(REFRESH_KEY) || "";
}

export function clearAuthTokens() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem("fb_auth_token");
}
