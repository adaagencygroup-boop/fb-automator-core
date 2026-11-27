import api from "@/services/api";
import { API_BASE } from "@/config/constants";
import { saveBlobFile } from "./shared/saveFile.mjs";

/** Bắn sau mỗi lần đổi danh mục page để các màn đang mở tự tải lại (không lưu gì trong trình duyệt). */
export const PAGE_LISTS_EVENT = "fb-automator.page-scanner.page-lists-changed";

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

// ── DETAIL: quét SĐT / Email / Website / Địa chỉ cho danh sách Page (Nhập link / Tải tệp) ──
export async function createDetailSession(payload) {
  return api.post("/api/page-scanner/details/sessions", payload);
}

// ── SOURCE: UPLOAD FILE .txt/.csv ──
// Mặc định CHỈ xem trước / kiểm tra; truyền save_to_db: true khi người dùng bấm "Bắt đầu".
export async function uploadPageFile(formData, params = { save_to_db: false, filter_existing: true }) {
  return api.post("/api/page-scanner/source/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    params,
  });
}

// ── TEMPLATE ──
export function getPageTemplateUrl() {
  return `${API_BASE}/api/page-scanner/source/template`;
}

export const PAGE_TEMPLATE_FILE_NAME = "mau_danh_sach_fanpage_fb.txt";

/**
 * Tải file mẫu danh sách Fanpage. Trả về { status, fileName }:
 * - "saved"      : người dùng đã chọn nơi lưu, bấm Lưu và file đã ghi xong (Chrome / Edge — hộp thoại lưu file).
 * - "cancelled"  : người dùng bấm Huỷ ở hộp thoại lưu file.
 * - "downloaded" : trình duyệt không có hộp thoại lưu file (Firefox, Safari…) → đã giao file cho trình duyệt tải,
 *                  không biết người dùng có bấm Lưu hay không.
 * - "opened"     : không lấy được nội dung file → đã mở file mẫu ở tab mới.
 * Ném lỗi khi không làm được cách nào (vd trình duyệt chặn tab mới).
 */
export async function downloadPageTemplate() {
  const fileName = PAGE_TEMPLATE_FILE_NAME;
  let blob;
  try {
    // Lấy nội dung trước (backend trên máy, rất nhanh) để không tạo file rỗng khi tải lỗi
    const res = await api.get("/api/page-scanner/source/template", { responseType: "blob" });
    blob = new Blob([res], { type: "text/plain;charset=utf-8" });
  } catch {
    const opened = window.open(`${API_BASE}/api/page-scanner/source/template`, "_blank");
    if (!opened) throw new Error("Không tải được file mẫu.");
    return { status: "opened", fileName };
  }

  return saveBlobFile(blob, {
    suggestedName: fileName,
    types: [{ description: "Tệp văn bản", accept: { "text/plain": [".txt"] } }],
  });
}

// ── SESSIONS ──
export async function getScanSessions(params = {}) {
  return api.get("/api/page-scanner/sessions", { params });
}

export async function getScanSessionDetail(sessionId) {
  return api.get(`/api/page-scanner/sessions/${sessionId}`);
}

export async function emergencyStopAll() {
  return api.post("/api/page-scanner/stop");
}

export async function stopScanSession(sessionId) {
  return api.post(`/api/page-scanner/sessions/${sessionId}/stop`);
}

/** Chạy tiếp phiên đã dừng / lỗi (Lịch sử): phiên mới cùng cấu hình, chỉ quét các Page còn lại → { session_id, remaining_pages } */
export async function continueScanSession(sessionId) {
  return api.post(`/api/page-scanner/sessions/${sessionId}/continue`);
}

export async function pauseScanSession(sessionId) {
  return api.post(`/api/page-scanner/sessions/${sessionId}/pause`);
}

export async function resumeScanSession(sessionId) {
  return api.post(`/api/page-scanner/sessions/${sessionId}/resume`);
}

/**
 * Đợt đang chạy (RUNNING/PAUSED) + toàn bộ phiên con cùng campaign_id — theo đúng loại job
 * của trang: DISCOVERY (Quét thông tin page) | FOLLOW (followers) | POST_SCAN (bài viết).
 */
export async function getActiveCampaign(jobType = "DISCOVERY") {
  return api.get("/api/page-scanner/campaigns/active", { params: { job_type: jobType } });
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

/** Số bài theo từng Page của 1 phiên POST_SCAN: { items: [{page_key, post_count}], total_posts }. */
export async function getSessionPostPages(sessionId) {
  return api.get("/api/page-scanner/posts/session-pages", { params: { session_id: sessionId } });
}

/** Số UID theo từng Page của 1 phiên FOLLOW: { items: [{page_key, uid_count}], total_uids }. */
export async function getSessionFollowerPages(sessionId) {
  return api.get("/api/page-scanner/followers/session-pages", { params: { session_id: sessionId } });
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

// ── DANH MỤC PAGE ĐÃ LƯU (DB: page_list_categories) ──
function notifyPageListsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PAGE_LISTS_EVENT));
}

/** [{ id, name, page_count, created_at, updated_at }] — mới dùng gần nhất trước. */
export async function getPageLists() {
  const res = await api.get("/api/page-scanner/page-lists");
  return res?.items || [];
}

/** Tạo danh mục (trùng tên → trả danh mục cũ): { id, name, created }. */
export async function createPageList(name) {
  const res = await api.post("/api/page-scanner/page-lists", { name });
  notifyPageListsChanged();
  return res;
}

export async function deletePageList(id) {
  const res = await api.delete(`/api/page-scanner/page-lists/${id}`);
  notifyPageListsChanged();
  return res;
}

/**
 * Lưu page (theo page_key) vào danh mục có sẵn (categoryId) hoặc theo tên (chưa có thì tạo).
 * → { category: { id, name, page_count }, created, added, skipped_existing, not_found, message }
 */
export async function savePagesToList({ categoryId, categoryName, pageKeys, deduplicate = true }) {
  const res = await api.post("/api/page-scanner/page-lists/save", {
    category_id: categoryId ?? null,
    category_name: categoryName || null,
    page_keys: pageKeys,
    deduplicate,
  });
  notifyPageListsChanged();
  return res;
}
