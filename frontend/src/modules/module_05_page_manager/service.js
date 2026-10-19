import api from "@/services/api";

export async function getPages() {
  return api.get("/api/pages");
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

// ================= MODULE 05: ĐĂNG REELS =================
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

// ================= MODULE 05: ĐĂNG BÀI AI =================
export async function getAiAccounts() {
  return api.get("/api/pages/ai/accounts");
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
  if (!initial?.job_id) throw new Error("Máy chủ không trả về job_id.");
  for (;;) {
    const job = await api.get(`/api/pages/sync-jobs/${initial.job_id}`);
    onProgress(job);
    if (job.status === "SUCCEEDED") return job.result;
    if (["FAILED", "CANCELLED"].includes(job.status)) throw new Error(job.error || job.message);
    if (job.status === "AWAITING_CONFIRMATION") {
      const accept = window.confirm(`Facebook: ${job.identity.name} (App-scoped ID: ${job.identity.id})\nGhép danh tính này với account UID ${job.account_uid}?`);
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
