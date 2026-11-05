import api from "@/services/api";
import { API_BASE } from "@/config/constants";
export async function getPages() {
  try {
    const res = await api.get("/api/pages");
    if (res && Array.isArray(res.pages)) return res;
    if (Array.isArray(res)) return { pages: res, total: res.length };
    return { pages: [], total: 0 };
  } catch {
    return { pages: [], total: 0 };
  }
}
export async function fetchPageTokens(userToken, accountUid) {
  return followSyncJob(await api.post("/api/pages/fetch-tokens", { user_token: userToken, account_uid: accountUid }));
}
export async function getManagedPages() {
  return api.get("/api/pages/managed");
}
export async function syncPagesByAccount(payload, onProgress) {
  return followSyncJob(await api.post("/api/pages/sync-by-account", payload), onProgress);
}
export async function getOAuthConfig() {
  return api.get("/api/pages/oauth-config");
}
export async function syncPagesByToken(payload, onProgress) {
  return followSyncJob(await api.post("/api/pages/sync-by-token", payload), onProgress);
}
export async function oauthByProfile(payload, onProgress) {
  return followSyncJob(await api.post("/api/pages/oauth-by-profile", payload), onProgress);
}
export async function addManualPage(payload) {
  return api.post("/api/pages/manual", payload);
}
export async function verifyTokens(payload = {}) {
  return api.post("/api/pages/tokens/verify", payload);
}
export async function deleteManagedPage(pageId) {
  return api.delete(`/api/pages/${pageId}`);
}
export async function deletePage(pageId) {
  try {
    return await api.delete(`/api/pages/${pageId}`);
  } catch {
    return { success: false };
  }
}
export async function selectReelsFolder(initialDir) {
  try {
    const res = await api.post("/api/pages/reels/select-folder", { initial_dir: initialDir || "" });
    return {
      folder: res?.folder || res?.path || "",
      success: Boolean(res?.folder || res?.path)
    };
  } catch (err) {
    console.warn("Lỗi gọi selectReelsFolder:", err);
    return { folder: "", success: false };
  }
}
export async function getReelsAccountsPages() {
  return api.get("/api/pages/reels/accounts-pages");
}
export async function scanReelsFolders(rootDir) {
  return api.post("/api/pages/reels/scan-folders", { root_dir: rootDir });
}
export async function startReelsJob(payload) {
  return api.post("/api/pages/reels/start", payload);
}
export async function stopReelsJob() {
  return api.post("/api/pages/reels/stop");
}
export async function getReelsStatus() {
  return api.get("/api/pages/reels/status");
}
export async function clearReelsLogs() {
  return api.post("/api/pages/reels/clear-logs");
}
export async function getAiAccounts() {
  return api.get("/api/pages/ai/accounts");
}
export async function getAiSettings() {
  return api.get("/api/pages/ai/settings");
}
export async function saveAiSettings(payload) {
  return api.put("/api/pages/ai/settings", payload);
}
export async function loginAiAccount(uid) {
  return api.post("/api/pages/ai/login", { uid });
}
export async function openAiPage(uid, pageId) {
  return api.post("/api/pages/ai/open-page", { uid, page_id: pageId });
}
export async function testAiKeys(payload) {
  return api.post("/api/pages/ai/test-key", payload);
}

export async function testPixabayKey(payload) {
  return api.post("/api/pages/ai/test-pixabay-key", payload);
}

export async function startAiPost(payload) {
  return api.post("/api/pages/ai/start", payload);
}
export async function stopAiPost() {
  return api.post("/api/pages/ai/stop");
}
export async function getAiPostStatus() {
  return api.get("/api/pages/ai/status");
}
export async function startWebOAuth(accountUid) {
  return api.post("/api/pages/oauth-start", { account_uid: accountUid });
}
export async function followSyncJob(initial, onProgress = () => {}) {
  if (!initial?.job_id) throw new Error("Máy Chủ Không Trả Về Job_id.");
  for (;;) {
    const job = await api.get(`/api/pages/sync-jobs/${initial.job_id}`);
    onProgress(job);
    if (job.status === "SUCCEEDED") return job.result;
    if (["FAILED", "CANCELLED"].includes(job.status)) throw new Error(job.error || job.message);
    if (job.status === "AWAITING_CONFIRMATION") {
      const accept = window.confirm(`Facebook: ${job.identity.name} (App-scoped ID: ${job.identity.id})\nGhép Danh Tính Này Với Account UID ${job.account_uid}?`);
      await api.post(`/api/pages/sync-jobs/${initial.job_id}/confirm`, { accept });
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
export async function getSyncAccounts() {
  return api.get("/api/pages/accounts");
}
export const getWebConnection = () => api.get("/api/pages/web-connection");
export const startWebPopupOAuth = (reason = "connect", openBrowser = false) => api.post("/api/pages/web-oauth/start", { reason, open_browser: openBrowser });
export const completeWebPopupOAuth = (payload) => api.post("/api/pages/web-oauth/complete", payload);
export const getSyncJob = (id) => api.get(`/api/pages/sync-jobs/${id}`);
export const confirmSyncJob = (id, accept) => api.post(`/api/pages/sync-jobs/${id}/confirm`, { accept });
export const cancelWebOAuth = (id) => api.post(`/api/pages/web-oauth/${id}/cancel`);
export const syncWebConnection = () => api.post("/api/pages/web-connection/sync");
export async function startTikTokDownloadJob(payload) {
  try {
    return await api.post("/api/pages/tiktok-download", payload);
  } catch {
    return { success: false };
  }
}
export async function startYouTubeDownloadJob(payload) {
  try {
    return await api.post("/api/pages/youtube-download", payload);
  } catch {
    return { success: false };
  }
}
export async function getJobStatus(jobId) {
  try {
    return await api.get(`/api/pages/jobs/${jobId}`);
  } catch {
    return null;
  }
}
export async function stopJob(jobType) {
  try {
    return await api.post(`/api/pages/${jobType}-download/stop`);
  } catch {
    return { success: false };
  }
}
export async function getHistoryStats() {
  try {
    const res = await api.get("/api/pages/history/stats");
    if (res && res.ai) return res;
    return {
      total: 0,
      ai: { total: 0, success: 0, failed: 0 },
      reels: { total: 0, success: 0, failed: 0 },
      tiktok: { total: 0, success: 0, failed: 0 },
      youtube: { total: 0, success: 0, failed: 0 },
      delete: { total: 0, success: 0, failed: 0 }
    };
  } catch {
    return {
      total: 0,
      ai: { total: 0, success: 0, failed: 0 },
      reels: { total: 0, success: 0, failed: 0 },
      tiktok: { total: 0, success: 0, failed: 0 },
      youtube: { total: 0, success: 0, failed: 0 },
      delete: { total: 0, success: 0, failed: 0 }
    };
  }
}
export async function getHistory(postType, search, status, limit = 200, offset = 0) {
  try {
    const params = {};
    if (postType && postType !== "ALL") params.post_type = postType;
    if (search) params.search = search;
    if (status && status !== "ALL") params.status = status;
    if (limit) params.limit = limit;
    if (offset) params.offset = offset;
    const res = await api.get("/api/pages/history", { params });
    if (res && Array.isArray(res.history)) return res.history;
    if (Array.isArray(res)) return res;
    return [];
  } catch {
    return [];
  }
}
export async function getPageHistoryDetail(pageId, source) {
  try {
    const params = (source && source !== "ALL") ? { source } : {};
    const res = await api.get(`/api/pages/history/${pageId}`, { params });
    if (res && Array.isArray(res.items)) return res.items;
    if (Array.isArray(res)) return res;
    return [];
  } catch {
    return [];
  }
}
export async function getTerminalLogs(filterType, lines = 300) {
  try {
    const params = {};
    if (filterType && filterType !== "ALL") params.filter_type = filterType;
    if (lines) params.lines = lines;
    const res = await api.get("/api/pages/history/terminal-logs", { params });
    if (res && res.success) return res;
    return { success: false, lines: [], full_text: "", total_lines: 0 };
  } catch {
    return { success: false, lines: [], full_text: "", total_lines: 0 };
  }
}
export async function selectFolder(initialDir) {
  try {
    const res = await api.post("/api/pages/select-folder", { initial_dir: initialDir });
    return res;
  } catch {
    return { folder: "" };
  }
}
export async function clearPageVideos(pageId, source) {
  try {
    const params = source ? { source } : {};
    return await api.delete(`/api/pages/${pageId}/videos`, { params });
  } catch {
    return { success: false, deleted_count: 0 };
  }
}
export async function deletePageVideo(pageId, videoDbId) {
  try {
    return await api.delete(`/api/pages/${pageId}/videos/${videoDbId}`);
  } catch {
    return { success: false };
  }
}
export async function updatePageKeywords(pageId, data) {
  try {
    return await api.put(`/api/pages/${pageId}/keywords`, data);
  } catch {
    return { success: false };
  }
}
export async function bulkUpdateKeywords(keyword, source = "TIKTOK", url = "") {
  try {
    return await api.post("/api/pages/bulk-keywords", { keyword, source, url });
  } catch {
    return { success: false };
  }
}
export async function getPageToolConfig(tool) {
  try {
    const res = await api.get(`/api/pages/config/${tool}`);
    return res && res.config ? res.config : {};
  } catch {
    return {};
  }
}
export async function savePageToolConfig(tool, config) {
  try {
    return await api.post("/api/pages/config", { tool, config });
  } catch {
    return { success: false };
  }
}
export async function getPageVideos(pageId, source = null) {
  try {
    const params = source ? { source } : {};
    const res = await api.get(`/api/pages/${pageId}/videos`, { params });
    return res || { videos: [] };
  } catch {
    return { videos: [] };
  }
}
export async function getTikTokAuthStatus() {
  try {
    return await api.get("/api/pages/tiktok/auth-status");
  } catch {
    return { connected: false };
  }
}
export async function openTikTokLogin() {
  try {
    return await api.post("/api/pages/tiktok/open-login");
  } catch {
    return { status: "ERROR" };
  }
}
export async function disconnectTikTok() {
  try {
    return await api.post("/api/pages/tiktok/disconnect");
  } catch {
    return { success: false };
  }
}
export async function getTikTokConfig() {
  try {
    return await api.get("/api/pages/tiktok/config");
  } catch {
    return null;
  }
}
export async function saveTikTokConfig(config) {
  try {
    return await api.post("/api/pages/tiktok/config", config);
  } catch {
    return null;
  }
}
export async function getYoutubeConfig() {
  try {
    return await api.get("/api/pages/youtube/config");
  } catch {
    return null;
  }
}
export async function saveYoutubeConfig(config) {
  try {
    return await api.post("/api/pages/youtube/config", config);
  } catch {
    return null;
  }
}
export async function checkFolderData(folder) {
  try {
    const res = await api.post("/api/pages/check-folder", { folder });
    return res || { has_data: false, count: 0 };
  } catch {
    return { has_data: false, count: 0 };
  }
}
export async function clearAllVideos(source = null, folder = "") {
  try {
    const params = {};
    if (source) params.source = source;
    if (folder) params.folder = folder;
    return await api.delete("/api/pages/all-videos", { params });
  } catch {
    return { success: false, deleted_count: 0 };
  }
}
export function getVideoStreamUrl(path = "", videoId = null) {
  const base = API_BASE || "http://127.0.0.1:28129";
  const params = new URLSearchParams();
  if (videoId) params.append("video_id", videoId);
  if (path) params.append("path", path);
  return `${base}/api/pages/video-stream?${params.toString()}`;
}
