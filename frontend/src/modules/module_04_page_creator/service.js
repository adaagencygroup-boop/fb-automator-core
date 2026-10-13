import api from "@/services/api";

export function getCreatorSettings() {
  return api.get("/api/creator/settings");
}

export function saveCreatorSetting(key, value) {
  return api.post("/api/creator/settings", { key, value });
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

export function getCreatedPageHistory() {
  return api.get("/api/creator/pages/history");
}
