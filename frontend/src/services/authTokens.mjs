/** Token Bearer cho desktop Tauri — cookie cross-origin (tauri.localhost → 127.0.0.1) không dùng được. */

const ACCESS_KEY = "fb_user_access_token";
const REFRESH_KEY = "fb_user_refresh_token";
const REGISTRATION_KEY = "fb_registration_token";

export function setAuthTokens({ access_token, refresh_token } = {}) {
  if (typeof window === "undefined") return;
  // localStorage: sống qua restart WebView / đóng app; sessionStorage mất khi đóng.
  if (access_token) {
    localStorage.setItem(ACCESS_KEY, access_token);
    sessionStorage.setItem(ACCESS_KEY, access_token);
  }
  if (refresh_token) localStorage.setItem(REFRESH_KEY, refresh_token);
}

export function getAccessToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(ACCESS_KEY) || sessionStorage.getItem(ACCESS_KEY) || "";
}

export function getRefreshToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(REFRESH_KEY) || "";
}

export function setRegistrationToken(token) {
  if (typeof window === "undefined" || !token) return;
  localStorage.setItem(REGISTRATION_KEY, token);
}

export function getRegistrationToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(REGISTRATION_KEY) || "";
}

export function clearRegistrationToken() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(REGISTRATION_KEY);
}

export function clearAuthTokens() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem("fb_auth_token");
}
