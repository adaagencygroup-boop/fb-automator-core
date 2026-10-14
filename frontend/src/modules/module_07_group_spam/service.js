import api from "@/services/api";

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
