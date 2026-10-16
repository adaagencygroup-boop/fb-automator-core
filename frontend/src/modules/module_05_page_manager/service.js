import api from "@/services/api";

export async function getPages() {
  return api.get("/api/pages");
}

export async function fetchPageTokens(userToken) {
  return api.post("/api/pages/fetch-tokens", { user_token: userToken });
}

export async function getManagedPages() {
  return api.get("/api/creator/pages/managed");
}

export async function addManualPage(payload) {
  return api.post("/api/creator/pages/manual", payload);
}

export async function deleteManagedPage(pageId) {
  return api.delete(`/api/creator/pages/${pageId}`);
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
