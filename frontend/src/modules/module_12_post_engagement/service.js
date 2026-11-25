import api from "@/services/api";
import { getAccounts as getModule2Accounts } from "@/modules/module_02_account_manager/service";

const BASE = "/api/post-engagement";

/** Tài khoản Module 2 — nguồn nick để quét. fresh: bỏ cache, lấy trạng thái Live / đăng nhập mới nhất. */
export async function getAccounts({ fresh = false } = {}) {
  if (!fresh) return getModule2Accounts();
  const data = await api.get("/api/accounts", { fresh: true });
  return Array.isArray(data) ? data : data?.accounts || [];
}

// ---------------------------------------------------------------- Kiểm tra bài viết
export const startCheck = (uids, links) => api.post(`${BASE}/check/start`, { uids, links });
export const getCheckStatus = (jobId) => api.get(`${BASE}/check/status`, { params: { job_id: jobId } });
export const getActiveCheck = () => api.get(`${BASE}/check/active`);
export const stopCheck = (jobId) => api.post(`${BASE}/check/control`, { job_id: jobId, action: "abort" });

// ---------------------------------------------------------------- Quét
export const startScan = ({ uids, posts, delayMin, delayMax }) =>
  api.post(`${BASE}/scan/start`, { uids, posts, delay_min: delayMin, delay_max: delayMax });
export const getScanStatus = (jobId) => api.get(`${BASE}/scan/status`, { params: { job_id: jobId } });
export const getActiveScan = () => api.get(`${BASE}/scan/active`);
export const controlScan = (jobId, action) => api.post(`${BASE}/scan/control`, { job_id: jobId, action });

// ---------------------------------------------------------------- Kho dữ liệu
export const listPosts = ({ search = "", source = "all", sort = "newest", keys = null, limit = 200, offset = 0 } = {}) =>
  api.get(`${BASE}/posts`, {
    params: { search, source, sort, limit, offset, ...(keys ? { keys: keys.join(",") } : {}) },
  });
export const lookupPosts = (keys) => api.get(`${BASE}/posts/lookup`, { params: { keys: (keys || []).join(",") } });
export const listEngagements = (postKey, { tab = "like", search = "", tier = null, limit = 20, offset = 0 } = {}) =>
  api.get(`${BASE}/posts/${encodeURIComponent(postKey)}/engagements`, {
    params: { tab, search, limit, offset, ...(tier ? { tier } : {}) },
  });
// allPosts: xuất mọi bài trong kho khớp bộ lọc postSearch / postSource (Engine tự lấy, không giới hạn số bài đã tải)
export const exportEngagements = ({ postKeys = [], scope = "all", tab = "like", search = "", tier = null, allPosts = false,
  postSearch = "", postSource = "all" }) =>
  api.post(`${BASE}/export`, {
    post_keys: postKeys, scope, tab, search, tier, all_posts: allPosts, post_search: postSearch, post_source: postSource,
  });
export const deletePosts = (postKeys) => api.post(`${BASE}/posts/delete`, { post_keys: postKeys });

// ---------------------------------------------------------------- Chạy tiếp phiên bị gián đoạn
export const getResumableSession = async () => (await api.get(`${BASE}/sessions/resumable`))?.session || null;
export const resumeSession = (sessionId) => api.post(`${BASE}/sessions/${encodeURIComponent(sessionId)}/resume`, {});
