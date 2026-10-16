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
