import api from "./api";

export const accountService = {
  // Lấy toàn bộ danh sách tài khoản
  getAccounts: () => api.get("/api/accounts"),

  // Nhập tài khoản dạng text nhiều dòng (UID|PASS|2FA|COOKIE|TOKEN...)
  importAccounts: (rawData) =>
    api.post("/api/accounts/import", { raw_data: rawData }),

  // Lấy thống kê tổng quan
  getStats: () => api.get("/api/dashboard/stats"),
};

export default accountService;
