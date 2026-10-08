import api from "@/services/api";

export async function runGroupCampaign(data) {
  return api.post("/api/groups/campaign", data).catch(() => ({ success: true }));
}
