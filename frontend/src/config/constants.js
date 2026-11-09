const ENGINE_HTTP = "http://127.0.0.1:28129";
const ENGINE_WS = "ws://127.0.0.1:28129/ws/logs";

function isDesktopShell() {
  if (typeof window === "undefined") return false;
  if (window.__TAURI_INTERNALS__ || window.__TAURI__) return true;
  const { protocol, hostname } = window.location;
  // Tauri 2 custom protocol: https://tauri.localhost / http://tauri.localhost / tauri://localhost
  if (hostname === "tauri.localhost" || protocol === "tauri:") return true;
  return false;
}

function resolveApiBase() {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  // Desktop .exe luôn gọi Local Engine qua loopback HTTP — không dùng window.location
  // (tránh https://tauri.localhost:28129 khi WebView dùng custom protocol).
  if (isDesktopShell()) return ENGINE_HTTP;
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    if (protocol === "http:" || protocol === "https:") {
      return `${protocol}//${hostname}:28129`;
    }
  }
  return ENGINE_HTTP;
}

function resolveWsBase() {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (isDesktopShell()) return ENGINE_WS;
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    if (protocol === "http:" || protocol === "https:") {
      const wsProto = protocol === "https:" ? "wss" : "ws";
      return `${wsProto}://${hostname}:28129/ws/logs`;
    }
  }
  return ENGINE_WS;
}

export const API_BASE = resolveApiBase();
export const WS_BASE = resolveWsBase();
export const isTauriShell = isDesktopShell;

// Người dùng hiển thị trên Header (tạm thời — thay bằng dữ liệu đăng nhập thật khi có)
export const CURRENT_USER = {
  name: "Đỗ Thị Thanh Thùy",
};
