import api from "@/services/api";

// ── Tài khoản (Module 02): Tab 1 đọc nick local, giống adapters.py phía BE ──

export const getFarmAccountsPage = (search = "", cursor) =>
  api.get("/api/accounts/page", { params: { limit: 10, active_only: true, search, cursor } });

// ── Chạy tương tác ──

export const startFarm = (uids, threads, config) => api.post("/api/farm/start", { uids, threads, config });
export const pauseFarm = () => api.post("/api/farm/pause");
export const resumeFarm = () => api.post("/api/farm/resume");
export const stopFarm = () => api.post("/api/farm/stop");
export const getFarmStatus = () => api.get("/api/farm/status");

// ── Cấu hình theo máy (giới hạn mỗi ngày) ──

export const getFarmSettings = () => api.get("/api/farm/settings");
export const saveFarmSetting = (key, value) => api.post("/api/farm/settings", { key, value: String(value) });

// ── Lịch sử ──

function historyParams(filters) {
  const params = {};
  for (const [key, value] of Object.entries(filters || {})) {
    if (value !== "" && value != null) params[key] = value;
  }
  return params;
}

export const getFarmHistory = (filters, page, pageSize) =>
  api.get("/api/farm/history", { params: { ...historyParams(filters), page, page_size: pageSize } });

export const getFarmHistoryDetail = (id) => api.get(`/api/farm/history/${encodeURIComponent(id)}`);

export const cleanupFarmHistory = (keepDays) => api.post("/api/farm/history/cleanup", { keep_days: keepDays });

export async function downloadFarmHistoryCsv(filters) {
  const blob = await api.get("/api/farm/history/export", { params: historyParams(filters), responseType: "blob" });
  const stamp = new Date().toISOString().slice(0, 19).replace(/\D/g, "");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `lich_su_tuong_tac_${stamp}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
