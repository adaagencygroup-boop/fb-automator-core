export const API_BASE = process.env.NEXT_PUBLIC_API_URL
  || (typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:28129`
    : "http://127.0.0.1:28129");
export const WS_BASE = process.env.NEXT_PUBLIC_WS_URL
  || (typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:28129/ws/logs`
    : "ws://127.0.0.1:28129/ws/logs");

// Người dùng hiển thị trên Header (tạm thời — thay bằng dữ liệu đăng nhập thật khi có)
export const CURRENT_USER = {
  name: "Đỗ Thị Thanh Thùy",
};
