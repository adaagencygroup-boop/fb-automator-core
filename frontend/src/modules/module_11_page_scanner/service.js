import api from "@/services/api";
import { API_BASE } from "@/config/constants";

const SAVED_LISTS_KEY = "fb-automator.page-scanner.saved-lists";
export const SAVED_LISTS_EVENT = "fb-automator.page-scanner.saved-lists-changed";

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
  // URLSearchParams encode "#" → %23 (tránh source_keyword=#tag bị cắt fragment)
  return api.get("/api/page-scanner/pages", {
    params,
    paramsSerializer: (p) => {
      const usp = new URLSearchParams();
      Object.entries(p || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") return;
        usp.append(key, String(value));
      });
      return usp.toString();
    },
  });
}

/** Danh mục từ khóa / hashtag đã tìm (sidebar DS page). */
export async function getSearchKeywords() {
  try {
    return await api.get("/api/page-scanner/keywords");
  } catch {
    // Fallback khi backend chưa reload route /keywords
    const data = await getScanSessions({ page: 1, page_size: 100 });
    const map = new Map();
    for (const s of data.items || []) {
      const kw = String(s.keyword || "").trim();
      if (!kw) continue;
      if (s.source_type !== "SEARCH" && s.source_type !== "HASHTAG") continue;
      if ((s.job_type || "DISCOVERY") !== "DISCOVERY") continue;
      const prev = map.get(kw) || {
        keyword: kw,
        source_type: s.source_type || "SEARCH",
        page_count: 0,
        session_count: 0,
        last_at: s.created_at,
      };
      prev.session_count += 1;
      prev.page_count = Math.max(prev.page_count, Number(s.total_unique) || 0);
      if (!prev.last_at || (s.created_at && s.created_at > prev.last_at)) prev.last_at = s.created_at;
      map.set(kw, prev);
    }
    const items = [...map.values()];
    return { items, total: items.length };
  }
}

export async function resolvePageLinks(payload) {
  return api.post("/api/page-scanner/source/resolve-pages", payload);
}

// ── FOLLOWERS (mục 2) ──
export async function createFollowerSession(payload) {
  return api.post("/api/page-scanner/followers/sessions", payload);
}

export async function importFollowers(payload) {
  return api.post("/api/page-scanner/followers/import", payload);
}

export async function getPageFollowers(params = {}) {
  return api.get("/api/page-scanner/followers", { params });
}

// ── POSTS (mục 3) ──
export async function createPostScanSession(payload) {
  return api.post("/api/page-scanner/posts/sessions", payload);
}

export async function importPosts(payload) {
  return api.post("/api/page-scanner/posts/import", payload);
}

export async function getScannedPosts(params = {}) {
  return api.get("/api/page-scanner/posts", {
    params,
    paramsSerializer: (p) => {
      const usp = new URLSearchParams();
      Object.entries(p || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") return;
        usp.append(key, String(value));
      });
      return usp.toString();
    },
  });
}

/** Sidebar DS bài viết: page có bài + post_count. */
export async function getPagesWithPosts() {
  return api.get("/api/page-scanner/posts/pages");
}

/** Sidebar DS followers: page có followers + follower_uid_count. */
export async function getPagesWithFollowers() {
  return api.get("/api/page-scanner/followers/pages");
}

export async function deleteScannedPages(payload) {
  return api.delete("/api/page-scanner/pages", { data: payload });
}

export async function deleteScannedPosts(payload) {
  return api.delete("/api/page-scanner/posts", { data: payload });
}

export async function deletePageFollowers(payload) {
  return api.delete("/api/page-scanner/followers", { data: payload });
}

export function deleteSavedPageList(id) {
  const lists = loadSavedPageLists().filter((l) => l.id !== id);
  localStorage.setItem(SAVED_LISTS_KEY, JSON.stringify(lists));
  window.dispatchEvent(new Event(SAVED_LISTS_EVENT));
  return lists;
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
  window.dispatchEvent(new Event(SAVED_LISTS_EVENT));
  return entry;
}
