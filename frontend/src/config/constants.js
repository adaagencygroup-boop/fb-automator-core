const isTauriOrLocal = () => {
  if (typeof window === "undefined") return true;
  const host = window.location.hostname;
  const proto = window.location.protocol;
  return (
    proto === "tauri:" ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.includes("tauri") ||
    Boolean(window.__TAURI_INTERNALS__) ||
    Boolean(window.__TAURI__)
  );
};

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  (isTauriOrLocal()
    ? "http://127.0.0.1:28129"
    : `${typeof window !== "undefined" ? window.location.protocol : "http:"}//${typeof window !== "undefined" ? window.location.hostname : "127.0.0.1"}:28129`);

export const WS_BASE =
  process.env.NEXT_PUBLIC_WS_URL ||
  (isTauriOrLocal()
    ? "ws://127.0.0.1:28129/ws/logs"
    : `${typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws"}://${typeof window !== "undefined" ? window.location.hostname : "127.0.0.1"}:28129/ws/logs`);

// Người dùng hiển thị trên Header (tạm thời — thay bằng dữ liệu đăng nhập thật khi có)
export const CURRENT_USER = {
  name: "Đỗ Thị Thanh Thùy",
};
