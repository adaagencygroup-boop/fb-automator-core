import api from "@/services/api";
import { API_BASE } from "@/config/constants";

const SAVED_LISTS_KEY = "fb-automator.page-scanner.saved-lists";

// ── SOURCE: KEYWORD SEARCH ──
export async function searchPages(payload) {
  return api.post("/api/page-scanner/source/search", payload);
}

// ── SOURCE: HASHTAG SEARCH (Section 10) ──
export async function searchPagesByHashtag(payload) {
  return api.post("/api/page-scanner/source/hashtag-search", payload);
}

// ── SOURCE: PARSE (dán link trực tiếp) ──
export async function parsePageLinks(payload) {
  return api.post("/api/page-scanner/source/parse", payload);
}

// ── SOURCE: SCAN BY LINKS (quét thông tin Fanpage theo danh sách link) ──
export async function scanPageLinks(payload) {
  return api.post("/api/page-scanner/source/scan-links", payload);
}

// ── SOURCE: UPLOAD FILE .txt/.csv ──
export async function uploadPageFile(formData, params = { save_to_db: true, filter_existing: true }) {
  return api.post("/api/page-scanner/source/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    params,
  });
}

// ── TEMPLATE ──
export function getPageTemplateUrl() {
  return `${API_BASE}/api/page-scanner/source/template`;
}

export async function downloadPageTemplate() {
  try {
    const res = await api.get("/api/page-scanner/source/template", {
      responseType: "blob",
    });
    const blob = new Blob([res], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mau_danh_sach_fanpage_fb.txt";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch {
    window.open(`${API_BASE}/api/page-scanner/source/template`, "_blank");
  }
}

// ── SESSIONS ──
export async function getScanSessions(params = {}) {
  return api.get("/api/page-scanner/sessions", { params });
}

export async function getScanSessionDetail(sessionId) {
  return api.get(`/api/page-scanner/sessions/${sessionId}`);
}

export async function stopScanSession(sessionId) {
  return api.post(`/api/page-scanner/sessions/${sessionId}/stop`);
}

export async function pauseScanSession(sessionId) {
  return api.post(`/api/page-scanner/sessions/${sessionId}/pause`);
}

export async function resumeScanSession(sessionId) {
  return api.post(`/api/page-scanner/sessions/${sessionId}/resume`);
}

/** Đợt đang chạy (RUNNING/PAUSED) + toàn bộ phiên con cùng campaign_id. */
export async function getActiveCampaign() {
  return api.get("/api/page-scanner/campaigns/active");
}

/** @deprecated dùng getActiveCampaign */
export async function getActiveScanSessions() {
  const data = await getActiveCampaign().catch(() => ({ sessions: [] }));
  return data?.sessions || [];
}

// ── PAGES ──
export async function getScannedPages(params = {}) {
  return api.get("/api/page-scanner/pages", { params });
}

// ── LƯU DANH SÁCH (local, chờ API danh sách page) ──
export function loadSavedPageLists() {
  try {
    const raw = localStorage.getItem(SAVED_LISTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function savePageList({ name, pages }) {
  const lists = loadSavedPageLists();
  const entry = {
    id: `list_${Date.now()}`,
    name: name || `Danh sách ${new Date().toLocaleString("vi-VN")}`,
    created_at: new Date().toISOString(),
    count: pages.length,
    pages,
  };
  lists.unshift(entry);
  localStorage.setItem(SAVED_LISTS_KEY, JSON.stringify(lists.slice(0, 50)));
  return entry;
}
