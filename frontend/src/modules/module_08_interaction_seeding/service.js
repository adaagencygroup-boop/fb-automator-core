import api from "@/services/api";

// Tên hiển thị của từng loại seeding (dùng khi báo lô đang chạy ở trang khác)
export const SEEDING_TYPE_LABELS = { POST: "Bài viết", PAGE: "Page", PROFILE: "Trang cá nhân" };

export const seedingApi = {
  getAccounts: async () => {
    try {
      const res = await api.get("/api/accounts");
      return Array.isArray(res) ? res : res?.accounts || [];
    } catch {
      return [];
    }
  },

  getCategories: async () => {
    try {
      const res = await api.get("/api/accounts/categories");
      return Array.isArray(res) ? res : res?.categories || res?.data || [];
    } catch {
      return [];
    }
  },

  validateSeedingTargets: async (targetType, urls) => {
    return await api.post("/api/seeding/targets/validate", { target_type: targetType, urls });
  },

  getSeedingTargets: async (targetType, includeCompleted = false) => {
    try {
      const params = {};
      if (targetType) params.target_type = targetType;
      if (includeCompleted) params.include_completed = true;
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
    // Nhiều bài (vd chọn hàng nghìn bài từ page) → tạo tác vụ lâu hơn timeout mặc định 60s
    return await api.post("/api/seeding/campaigns/create", payload, { timeout: 15 * 60 * 1000 });
  },

  // startAt: "YYYY-MM-DDTHH:MM" (giờ máy, VN) để hẹn giờ; bỏ trống = chạy ngay
  startSeedingCampaign: async (campaignId, startAt) => {
    return await api.post(
      `/api/seeding/campaigns/${campaignId}/start`,
      null,
      startAt ? { params: { start_at: startAt } } : undefined,
    );
  },

  pauseSeedingCampaign: async (campaignId) => api.post(`/api/seeding/campaigns/${campaignId}/pause`),

  resumeSeedingCampaign: async (campaignId) => api.post(`/api/seeding/campaigns/${campaignId}/resume`),

  // Tiến độ cả lô: { running, paused, scheduled_at, totals, post_count, posts[], retryable }
  getBatchProgress: async (campaignId) => api.get(`/api/seeding/campaigns/${campaignId}/batch-progress`),

  // Tạo lô mới từ các lượt lỗi → { id, campaign_ids, total_tasks, message }
  retryFailedTasks: async (campaignId) =>
    api.post(`/api/seeding/campaigns/${campaignId}/retry-failed`, null, { timeout: 5 * 60 * 1000 }),

  // Xem trước kế hoạch (cùng payload với tạo chiến dịch, không ghi DB)
  previewSeedingPlan: async (payload) =>
    api.post("/api/seeding/campaigns/preview", payload, { timeout: 2 * 60 * 1000 }),

  listTemplates: async (campaignType = "POST") => {
    const res = await api.get("/api/seeding/templates", { params: { campaign_type: campaignType } });
    return res?.items || [];
  },

  saveTemplate: async (name, config, campaignType = "POST") =>
    api.post("/api/seeding/templates", { name, config, campaign_type: campaignType }),

  deleteTemplate: async (templateId) => api.delete(`/api/seeding/templates/${templateId}`),

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
    try {
      return await api.get(`/api/seeding/campaigns/${campaignId}/detail`);
    } catch {
      return null;
    }
  },

  // Lô seeding đang chạy của user theo loại trang (PAGE | PROFILE | POST), không có thì campaign_id = null
  // Không truyền campaignType: lô đang chạy của mọi loại trang (mỗi lúc chỉ chạy 1 lô seeding)
  getActiveSeedingCampaign: async (campaignType) => {
    try {
      const params = campaignType ? { campaign_type: campaignType } : {};
      return await api.get("/api/seeding/campaigns/active", { params });
    } catch {
      return { campaign_id: null, campaign_type: null };
    }
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

// ── Lấy bài viết từ page / trang cá nhân (job chạy nền, không giới hạn số bài) ──
export const postFetchApi = {
  startJob: (sourceUrl, accountUid) =>
    api.post("/api/seeding/post-fetch/jobs", { source_url: sourceUrl, account_uid: accountUid }),
  // Lượt đang chạy; không có thì lượt gần nhất → { job | null }
  getActiveJob: () => api.get("/api/seeding/post-fetch/jobs/active"),
  getJob: (jobId) => api.get(`/api/seeding/post-fetch/jobs/${jobId}`),
  stopJob: (jobId) => api.post(`/api/seeding/post-fetch/jobs/${jobId}/stop`),
  // { source_key, q, type: all|photo|video|text, page, page_size } → { items, total, counts }
  listPosts: (params) => api.get("/api/seeding/post-fetch/posts", { params }),
  // Id N bài đầu (chưa có trong danh sách seeding) khớp bộ lọc → { ids }
  firstPostIds: (params) => api.get("/api/seeding/post-fetch/posts/ids", { params }),
  // { source_key, mode: ids|all|first, ids, exclude_ids, first_n, q, type } → { added, skipped, message }
  addToTargets: (payload) =>
    api.post("/api/seeding/post-fetch/posts/add-to-targets", payload, { timeout: 10 * 60 * 1000 }),
};

export async function startSeeding(data) {
  return seedingApi.createSeedingCampaign(data);
}

// Re-export toàn bộ các hàm validation & chuẩn hóa URL từ validation.js để đảm bảo tương thích ngược 100%
export * from "./validation";

export default seedingApi;
