import api from "@/services/api";
import { API_BASE } from "@/config/constants";

export function getGroupSettings() {
  return api.get("/api/groups/settings");
}

export function saveGroupSettings(data) {
  return api.put("/api/groups/settings", data);
}

export function testGroupAiConnection(data) {
  return api.post("/api/groups/settings/test", data);
}

export function getGeminiModels(data) {
  return api.post("/api/groups/ai/gemini-models", data);
}

export function generateGroupPosts(data) {
  return api.post("/api/groups/ai/generate-posts", data);
}

export async function runGroupCampaign(data) {
  return api.post("/api/groups/campaign", data);
}

export function parseGroupFileSource(data) {
  return api.post("/api/groups/source/parse", data);
}

export function uploadGroupSourceFile(formData) {
  return api.post("/api/groups/source/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
}

export function searchGroupSource(data) {
  return api.post("/api/groups/source/search", data);
}

export function getGroupPostingHistory() {
  return api.get("/api/groups/source/history");
}

export function getGroupTemplateUrl() {
  return `${API_BASE}/api/groups/source/template`;
}

export async function downloadGroupTemplate() {
  try {
    const res = await api.get("/api/groups/source/template", { responseType: "blob" });
    const blob = new Blob([res], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mau_danh_sach_nhom_fb.txt";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (err) {
    window.open(`${API_BASE}/api/groups/source/template`, "_blank");
  }
}


