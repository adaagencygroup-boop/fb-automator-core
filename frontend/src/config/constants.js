export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:28129";
export const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || "ws://127.0.0.1:28129/ws/logs";

// Người dùng hiển thị trên Header (tạm thời — thay bằng dữ liệu đăng nhập thật khi có)
export const CURRENT_USER = {
  name: "Đỗ Thị Thanh Thùy",
};
