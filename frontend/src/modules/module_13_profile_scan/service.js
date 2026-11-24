import api from "@/services/api";
import { getScanCategories, getScannedGroups } from "@/modules/module_10_group_scan/service";
import { UNCATEGORIZED } from "./utils.mjs";
import { getPageLists, getPagesWithFollowers, getPageFollowers, getScannedPages } from "@/modules/module_11_page_scanner/service";

/** Backend Module 13 chưa có: các thao tác dưới báo rõ thay vì giả vờ thành công. */
export const BACKEND_READY = false;
const NOT_READY = "Backend Quét profile (module 13) chưa được xây dựng.";

export async function startProfileScan() {
  throw new Error(NOT_READY);
}
export async function getProfileLists() {
  return [];
}
export async function saveProfilesToList() {
  throw new Error(NOT_READY);
}

// ── Danh sách profile ──
/** [{ key, type: group|post|page|category, name, url, scale, color, profile_count, ... }] */
export async function getProfileCollections() {
  return [{ key: UNCATEGORIZED, type: "category", name: "Chưa có danh mục", profile_count: 0 }];
}
export async function getCollectionProfiles() {
  return [];
}
export async function createProfileCategory() {
  throw new Error(NOT_READY);
}
export async function updateProfileCategory() {
  throw new Error(NOT_READY);
}
/** Xóa danh mục: profile bên trong về "Chưa có danh mục" */
export async function deleteProfileCategory() {
  throw new Error(NOT_READY);
}
export async function moveProfiles() {
  throw new Error(NOT_READY);
}
export async function deleteProfiles() {
  throw new Error(NOT_READY);
}

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

const toFollower = (f) => ({ uid: String(f.follower_key), name: f.follower_name || f.follower_key, url: f.profile_url, avatar: f.avatar_url });
const toMember = (m) => ({ uid: String(m.uid), name: m.name, url: m.profile_url, avatar: m.avatar_url });

/** 1 trang profile đã quét của nguồn → { items, total } */
export async function loadSourceProfiles(type, id, { page = 1, pageSize = 20, search = "" } = {}) {
  if (type === "group") {
    const res = await api.get("/api/group-scan/members", {
      params: { group_id: id, page, page_size: pageSize, search: search || undefined },
    });
    return { items: (res?.members || []).map(toMember), total: res?.total || 0 };
  }
  if (type === "page") {
    const res = await getPageFollowers({ page_key: id, page, page_size: pageSize, keyword: search || undefined });
    return { items: (res?.items || []).map(toFollower), total: res?.total || 0 };
  }
  return { items: [], total: 0 };
}

/** N profile đầu tiên của nguồn (từ trên xuống, theo đúng bộ lọc đang tìm) */
export async function loadTopProfiles(type, id, count, search = "") {
  const size = 500;
  const out = [];
  for (let page = 1; out.length < count; page += 1) {
    const { items } = await loadSourceProfiles(type, id, { page, pageSize: size, search });
    out.push(...items);
    if (items.length < size) break;
  }
  return out.slice(0, count);
}
