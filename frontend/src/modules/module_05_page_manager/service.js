import api from "@/services/api";

export async function getPages() {
  return api.get("/api/pages");
}

export async function fetchPageTokens(userToken) {
  return api.post("/api/pages/fetch-tokens", { user_token: userToken });
}

export async function getManagedPages() {
  return api.get("/api/pages/managed");
}

export async function syncPagesByAccount(payload) {
  return api.post("/api/pages/sync-by-account", payload);
}

export async function getOAuthConfig() {
  return api.get("/api/pages/oauth-config");
}

export async function syncPagesByToken(payload) {
  return api.post("/api/pages/sync-by-token", payload);
}

export async function oauthByProfile(payload) {
  return api.post("/api/pages/oauth-by-profile", payload);
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
