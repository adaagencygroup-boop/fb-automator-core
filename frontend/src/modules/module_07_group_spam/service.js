import api from "@/services/api";
import { API_BASE } from "@/config/constants";

export const getAiCredentials = () => api.get("/api/groups/credentials");
export const addAiCredential = (data) => api.post("/api/groups/credentials", data);
export const updateAiCredential = (id, data) => api.put(`/api/groups/credentials/${encodeURIComponent(id)}`, data);
export const deleteAiCredential = (id) => api.delete(`/api/groups/credentials/${encodeURIComponent(id)}`);

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

export const generateGroupComments = (data) => api.post("/api/groups/ai/generate-comments", data);

export async function runGroupCampaign(data) {
  return api.post("/api/groups/campaign", data);
}

export function getGroupCampaign(jobId) {
  return api.get(`/api/groups/campaign/${jobId}`);
}

export function getCurrentGroupCampaign() {
  return api.get("/api/groups/campaign/current");
}

export function stopGroupCampaign(jobId) {
  return api.post(`/api/groups/campaign/${jobId}/stop`);
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

export function uploadGroupMedia(formData, campaignId = null) {
  const url = campaignId
    ? `/api/groups/media/upload?campaign_id=${encodeURIComponent(campaignId)}`
    : "/api/groups/media/upload";
  return api.post(url, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
}

export function getGroupMediaList(campaignId = null) {
  const url = campaignId
    ? `/api/groups/media/list?campaign_id=${encodeURIComponent(campaignId)}`
    : "/api/groups/media/list";
  return api.get(url);
}

export function getGroupCampaigns(params) {
  return api.get("/api/groups/campaigns", { params });
}

export function getGroupCampaignDetails(campaignId) {
  return api.get(`/api/groups/campaigns/${encodeURIComponent(campaignId)}/details`);
}

export function getGroupCampaignRerunConfig(campaignId) {
  return api.get(`/api/groups/campaigns/${encodeURIComponent(campaignId)}/rerun`);
}

export function deleteGroupCampaign(campaignId) {
  return api.delete(`/api/groups/campaigns/${encodeURIComponent(campaignId)}`);
}

export function getGroupHistoryRecords(params) {
  return api.get("/api/groups/history", { params });
}

export function openGroupHistoryRecord(logId) {
  return api.post(`/api/groups/history/${encodeURIComponent(logId)}/open`);
}


