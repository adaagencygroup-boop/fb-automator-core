/** Kho mẫu trong bộ nhớ, cùng hàm với service.js — CHỈ dùng khi mở trang với ?demo=1. */
import { DEMO_RESULTS, DEMO_SOURCES } from "../scan-info/demoData";
import { UNCATEGORIZED } from "../utils.mjs";

export function createDemoStore() {
  let nextId = 2;
  let categories = [{ id: 1, name: "Danh mục A", color: "#2563EB" }];
  const base = DEMO_RESULTS.filter((r) => r.sourceKey === "group:buonban1001");
  let rows = [
    ...DEMO_RESULTS,
    ...Array.from({ length: 28 }, (_, i) => ({ ...base[i % 4], uid: `20000000${i + 10}`, name: `${base[i % 4].name} ${i + 1}`, friends: 200 * (i + 1), phone: i % 2 ? "0900000000" : "", sourceKey: i < 20 ? "category:1" : UNCATEGORIZED })),
  ];
  const count = (key) => rows.filter((r) => r.sourceKey === key).length;

  return {
    async getProfileCollections() {
      return [
        ...Object.entries(DEMO_SOURCES).map(([key, s]) => ({
          key, type: s.type, name: s.name, url: s.url, scale: s.scale, likes: s.likes, comments: s.comments, shares: s.shares,
          profile_count: count(key), target_count: 120,
          ...(s.type === "post" ? { source_name: "Nhóm Hội KD Online Thực Chiến", scanned_likes: 20, scanned_comments: 30 } : {}),
        })),
        ...categories.map((c) => ({ key: `category:${c.id}`, type: "category", name: c.name, color: c.color, profile_count: count(`category:${c.id}`) })),
        { key: UNCATEGORIZED, type: "category", name: "Chưa có danh mục", profile_count: count(UNCATEGORIZED) },
      ];
    },
    async getCollectionProfiles(key) {
      return rows.filter((r) => r.sourceKey === key);
    },
    async createProfileCategory({ name, color }) {
      const id = nextId++;
      categories = [...categories, { id, name, color }];
      return { key: `category:${id}` };
    },
    async updateProfileCategory(key, { name, color }) {
      categories = categories.map((c) => (`category:${c.id}` === key ? { ...c, name, color } : c));
    },
    async deleteProfileCategory(key) {
      categories = categories.filter((c) => `category:${c.id}` !== key);
      rows = rows.map((r) => (r.sourceKey === key ? { ...r, sourceKey: UNCATEGORIZED } : r));
    },
    async getProfileMemberships() {
      return [];
    },
    async moveProfiles(fromKey, toKey, uids) {
      const set = new Set(uids);
      const already = new Set(rows.filter((r) => r.sourceKey === toKey).map((r) => r.uid));
      rows = rows
        .filter((r) => !(r.sourceKey === fromKey && set.has(r.uid) && already.has(r.uid)))
        .map((r) => (r.sourceKey === fromKey && set.has(r.uid) ? { ...r, sourceKey: toKey } : r));
    },
    async deleteProfiles(key, uids) {
      const set = new Set(uids);
      rows = rows.filter((r) => !(r.sourceKey === key && set.has(r.uid)));
    },
  };
}
