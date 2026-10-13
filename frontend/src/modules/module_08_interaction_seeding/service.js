import api from "@/services/api";

export const seedingApi = {
  getAccounts: async () => {
    try {
      const res = await api.get("/api/accounts");
      return Array.isArray(res) ? res : res?.accounts || [];
    } catch {
      return [];
    }
  },

  validateSeedingTargets: async (targetType, urls) => {
    return await api.post("/api/seeding/targets/validate", { target_type: targetType, urls });
  },

  getSeedingTargets: async (targetType) => {
    try {
      const params = targetType ? { target_type: targetType } : {};
      const res = await api.get("/api/seeding/targets", { params });
      return res || { total: 0, targets: [] };
    } catch {
      return { total: 0, targets: [] };
    }
  },

  deleteSeedingTarget: async (url, targetType) => {
    try {
      const params = { url };
      if (targetType) params.target_type = targetType;
      return await api.delete("/api/seeding/targets/by-url", { params });
    } catch {
      return { success: false };
    }
  },

  clearSeedingTargets: async (targetType) => {
    try {
      const params = targetType ? { target_type: targetType } : {};
      return await api.delete("/api/seeding/targets/clear", { params });
    } catch {
      return { success: false };
    }
  },

  getSeedingComments: async () => {
    try {
      const res = await api.get("/api/seeding/comments");
      return res || { total: 0, comments: [] };
    } catch {
      return { total: 0, comments: [] };
    }
  },

  addSeedingComments: async (comments) => {
    return await api.post("/api/seeding/comments/add", { comments });
  },

  deleteSeedingComment: async (content) => {
    try {
      return await api.delete("/api/seeding/comments/delete", { params: { content } });
    } catch {
      return { success: false };
    }
  },

  clearSeedingComments: async () => {
    try {
      return await api.delete("/api/seeding/comments/clear");
    } catch {
      return { success: false };
    }
  },

  createSeedingCampaign: async (payload) => {
    return await api.post("/api/seeding/campaigns/create", payload);
  },

  startSeedingCampaign: async (campaignId) => {
    return await api.post(`/api/seeding/campaigns/${campaignId}/start`);
  },

  stopSeedingCampaign: async (campaignId) => {
    return await api.post(`/api/seeding/campaigns/${campaignId}/stop`);
  },

  stopAllSeeding: async () => {
    return await api.post("/api/seeding/stop-all");
  },

  getSeedingCampaigns: async (params = {}) => {
    try {
      const res = await api.get("/api/seeding/campaigns", { params });
      return res || { total: 0, page: 1, page_size: 10, items: [] };
    } catch {
      return { total: 0, page: 1, page_size: 10, items: [] };
    }
  },

  getSeedingCampaignDetail: async (campaignId) => {
    return await api.get(`/api/seeding/campaigns/${campaignId}/detail`);
  },

  getSeedingStats: async () => {
    try {
      const res = await api.get("/api/seeding/stats");
      return res || { total_campaigns: 0, total_interactions: 0, total_success: 0, total_failed: 0 };
    } catch {
      return { total_campaigns: 0, total_interactions: 0, total_success: 0, total_failed: 0 };
    }
  },
};

export async function startSeeding(data) {
  return seedingApi.createSeedingCampaign(data);
}

export default seedingApi;
