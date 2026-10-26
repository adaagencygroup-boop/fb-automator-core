import api from "@/services/api";
import { formatVietnamDateTime, parseToVietnamDate } from "@/lib/date-utils";

// ── Tài khoản (Module 02): Tab 1 đọc nick local, giống adapters.py phía BE ──

// filters = { search, category_id | uncategorized } (categoryQuery của Module 02)
export const getFarmAccountsPage = (filters = {}, cursor) =>
  api.get("/api/accounts/page", { params: { limit: 10, active_only: true, ...filters, cursor } });

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

// CSV và Excel cùng lấy từ endpoint export của BE (cùng bộ lọc, cột, giới hạn số dòng)
const fetchHistoryCsv = (filters) =>
  api.get("/api/farm/history/export", { params: historyParams(filters), responseType: "blob" });

const exportFileName = (ext) => `lich_su_tuong_tac_${new Date().toISOString().slice(0, 19).replace(/\D/g, "")}.${ext}`;

export async function downloadFarmHistoryCsv(filters) {
  const blob = await fetchHistoryCsv(filters);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFileName("csv");
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Tách CSV do BE sinh (csv.writer của Python: dấu phẩy, ngoặc kép, CRLF); không dùng XLSX.read để đọc */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const UTC_SUFFIX = /\s*\(UTC\)$/;

function excelCell(value, { isUid, isTime }) {
  if (!value) return value;
  if (isTime) {
    if (!parseToVietnamDate(value)) return value;
    const t = formatVietnamDateTime(value);
    return `${t.date} ${t.timeWithSeconds}`;
  }
  // UID giữ dạng chữ để Excel không đổi thành 1.00E+14; số đếm thành số để cộng / lọc được
  if (!isUid && /^\d{1,15}$/.test(value)) return Number(value);
  // Dấu ' chống CSV injection không cần trong .xlsx: chuỗi ghi vào ô chữ, không bao giờ là công thức
  if (/^'[=+\-@\t\r]/.test(value)) return value.slice(1);
  return value;
}

export async function downloadFarmHistoryXlsx(filters) {
  const [blob, XLSX] = await Promise.all([fetchHistoryCsv(filters), import("xlsx")]);
  const [header = [], ...body] = parseCsv((await blob.text()).replace(/^﻿/, ""));
  const uidCol = header.indexOf("UID");
  const timeCols = new Set(header.flatMap((title, i) => (UTC_SUFFIX.test(title) ? [i] : [])));

  const rows = [
    header.map((title) => title.replace(UTC_SUFFIX, " (giờ VN)")),
    ...body.map((row) => row.map((value, i) => excelCell(value, { isUid: i === uidCol, isTime: timeCols.has(i) }))),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  // Độ rộng cột theo ô dài nhất (tối đa 50 ký tự); không spread vì có thể tới 50.000 dòng
  sheet["!cols"] = rows[0].map((_, i) => ({
    wch: Math.min(50, rows.reduce((max, row) => Math.max(max, String(row[i] ?? "").length + 2), 8)),
  }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Lich su tuong tac");
  XLSX.writeFile(book, exportFileName("xlsx"));
}
