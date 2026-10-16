import api from "@/services/api";

export function getCreatorSettings() {
  return api.get("/api/creator/settings");
}

export function saveCreatorSetting(key, value) {
  return api.post("/api/creator/settings", { key, value });
}

export function testCreatorGeminiKey(payload) {
  return api.post("/api/creator/gemini/test-key", payload);
}

export function startPageCreation(payload) {
  return api.post("/api/creator/tasks/start", payload);
}

export function pausePageCreation() {
  return api.post("/api/creator/tasks/pause");
}

export function resumePageCreation() {
  return api.post("/api/creator/tasks/resume");
}

export function stopPageCreation() {
  return api.post("/api/creator/tasks/stop");
}

export function getCreatorTaskStatus() {
  return api.get("/api/creator/tasks/status");
}

export async function getCreatedPageHistory() {
  try {
    return await api.get("/api/creator/pages/history", { timeout: 15000 });
  } catch (error) {
    // No creation history is available yet on this Engine: show the empty state.
    if (error.status === 404) return [];
    throw error;
  }
}
