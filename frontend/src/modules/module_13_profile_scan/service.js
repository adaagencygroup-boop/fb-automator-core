import api from "@/services/api";
import { getScanCategories, getScannedGroups } from "@/modules/module_10_group_scan/service";
import { getPageLists, getPagesWithFollowers, getScannedPages } from "@/modules/module_11_page_scanner/service";

const BASE = "/api/profile-scan";

// ── Phiên quét ──
export const startProfileScan = (payload) => api.post(`${BASE}/sessions`, payload);
export const getLatestScan = async () => (await api.get(`${BASE}/sessions/latest`)).session;
/** { session, logs } — chỉ log mới hơn afterLog */
export const getScanProgress = (id, afterLog = 0) => api.get(`${BASE}/sessions/${id}`, { params: { after_log: afterLog } });
/** { items, sources } */
export const getScanResults = (id) => api.get(`${BASE}/sessions/${id}/results`);
/** action: pause | resume | stop */
export const controlScan = (id, action, body = {}) => api.post(`${BASE}/sessions/${id}/${action}`, body);
/** Lịch sử phiên: { items, total } — params: page, page_size, keyword, mode, status, date_from, date_to */
export const getScanSessions = (params = {}) => api.get(`${BASE}/sessions`, { params });
/** Profile trong 1 phiên: { items, total } — status: DONE | SKIPPED | FAILED | PENDING */
export const getSessionTargets = (id, params = {}) => api.get(`${BASE}/sessions/${id}/targets`, { params });

export const getProfileLists = async () => (await api.get(`${BASE}/categories`)).items;
/** Danh mục đang chứa các profile: [{ id, name, color, uids }] */
export const getProfileMemberships = async (uids) => (await api.post(`${BASE}/categories/memberships`, { uids })).items || [];
export const saveProfilesToList = ({ id, name, color, profiles }) =>
  api.post(`${BASE}/categories/save`, { category_id: id, name, color, uids: profiles.map((p) => p.uid) });

// ── Danh sách profile ──
/** [{ key, type: group|post|page|category, name, url, scale, color, profile_count, ... }] */
export const getProfileCollections = async () => (await api.get(`${BASE}/collections`)).items;
export const getCollectionProfiles = async (key) => (await api.get(`${BASE}/collections/profiles`, { params: { key } })).items;
const categoryId = (key) => key.replace("category:", "");
export const createProfileCategory = ({ name, color }) => api.post(`${BASE}/categories`, { name, color });
export const updateProfileCategory = (key, { name, color }) => api.put(`${BASE}/categories/${categoryId(key)}`, { name, color });
/** Xóa danh mục: profile bên trong về "Chưa có danh mục" */
export const deleteProfileCategory = (key) => api.delete(`${BASE}/categories/${categoryId(key)}`);
export const moveProfiles = (fromKey, toKey, uids) => api.post(`${BASE}/members/move`, { key: fromKey, to_key: toKey, uids });
export const deleteProfiles = (key, uids) => api.post(`${BASE}/members/delete`, { key, uids });

// ── Nguồn: nhóm (kho Module 10) ──
export async function loadGroupSource() {
  const [cats, res] = await Promise.all([getScanCategories(), getScannedGroups({ limit: 1000 })]);
  const groups = (res?.groups || []).map((g) => ({
    id: String(g.group_id),
    name: g.name,
    url: g.url,
    scale: g.membersCount,
    scaleLabel: g.members,
    categoryId: g.categoryId,
  }));
  return {
    items: groups,
    categories: cats.map((c) => ({ id: c.id, name: c.name })),
  };
}

// ── Nguồn: page (kho Module 11) ──
export async function loadPageSource() {
  const [lists, res] = await Promise.all([getPageLists(), getPagesWithFollowers()]);
  const items = (res?.items || []).map((p) => ({
    id: p.page_key,
    name: p.page_name,
    url: p.page_url,
    scale: p.follower_count,
    scanned: p.scanned_uid_count,
    avatar: p.avatar_url,
  }));
  return { items, categories: lists.map((l) => ({ id: l.id, name: l.name })) };
}

/** page_key thuộc 1 danh mục page */
export async function loadPageListKeys(listId) {
  const keys = new Set();
  for (let page = 1; page <= 20; page += 1) {
    const res = await getScannedPages({ list_id: listId, page, page_size: 1000 });
    (res?.items || []).forEach((p) => keys.add(p.page_key));
    if ((res?.items || []).length < 1000) break;
  }
  return keys;
}

// ── Nguồn: bài viết đã quét người tương tác (kho Module 12) ──
/** [{ id: post_key, name, url, likes, comments, ... }] */
export async function loadPostSource(search = "") {
  const res = await api.get(`${BASE}/source-posts`, { params: { search: search || undefined } });
  return (res?.items || []).map((p) => {
    const text = (p.content || "").replace(/\s+/g, " ").trim();
    return {
      ...p,
      name: text ? (text.length > 80 ? `${text.slice(0, 80)}…` : text) : p.fb_post_id ? `Bài viết ${p.fb_post_id}` : p.id,
      scale: (p.likes || 0) + (p.comments || 0),
      scaleLabel: `${p.likes || 0} like · ${p.comments || 0} bình luận`,
    };
  });
}

/** type: group | page | post → { [id nguồn]: { total, scanned } } — số profile đã quét thông tin / tổng số người */
export async function loadSourceStats(type) {
  const res = await api.get(`${BASE}/source-stats`, { params: { type } });
  return res?.items || {};
}

/** 1 trang profile của nguồn → { items: [{ …, scanned }], total }; người đã quét thông tin ở cuối. Bài viết: tab like | comment */
export async function loadSourceProfiles(type, id, { page = 1, pageSize = 20, search = "", tab } = {}) {
  const params = { type, id, page, page_size: pageSize, search: search || undefined, tab: type === "post" ? tab || "like" : undefined };
  const res = await api.get(`${BASE}/source-people`, { params });
  return { items: res.items.map((p) => ({ ...p, uid: String(p.uid), name: p.name || p.uid })), total: res.total };
}

/** N profile đầu tiên chưa quét thông tin của nguồn (từ trên xuống, theo đúng bộ lọc đang tìm) */
export async function loadTopProfiles(type, id, count, search = "", tab) {
  const size = 500;
  const out = [];
  for (let page = 1; out.length < count; page += 1) {
    const { items } = await loadSourceProfiles(type, id, { page, pageSize: size, search, tab });
    const fresh = items.filter((p) => !p.scanned);
    out.push(...fresh);
    if (fresh.length < size) break; // hết người chưa quét
  }
  return out.slice(0, count);
}
