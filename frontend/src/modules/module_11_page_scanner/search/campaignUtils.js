/**
 * Mục 11 — tách chip, biến thể từ khóa, hashtag suy ra.
 */

/** Chỉ còn tìm theo hashtag (đã bỏ Page lớn / Kết hợp). */
export const SEARCH_MODES = [
  {
    id: "NGACH",
    label: "Hashtag",
    hint: "Hashtag / bài viết → tác giả Page",
  },
];

/** Luôn NGACH — giữ hàm để tương thích chỗ gọi cũ. */
export function normalizeSearchMode(_mode) {
  return "NGACH";
}

export function isHashtagChip(chip) {
  return String(chip || "").trim().startsWith("#");
}

export function normalizeHashtag(chip) {
  const raw = String(chip || "").trim();
  const body = raw.replace(/^#+/, "").replace(/\s+/g, "");
  if (!body) return null;
  if (/[,#/?&]/.test(body)) return null;
  return `#${body}`;
}

export function normalizeKeyword(chip) {
  const raw = String(chip || "").trim().replace(/\s+/g, " ");
  if (!raw || raw.startsWith("#")) return null;
  return raw;
}

/** Tách chip hỗn hợp → từ khóa thường + hashtag nhập tay */
export function splitMixedChips(chips) {
  const keywords = [];
  const hashtags = [];
  const seenKw = new Set();
  const seenTag = new Set();
  for (const chip of chips || []) {
    if (isHashtagChip(chip)) {
      const tag = normalizeHashtag(chip);
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (seenTag.has(key)) continue;
      seenTag.add(key);
      hashtags.push(tag);
    } else {
      const kw = normalizeKeyword(chip);
      if (!kw) continue;
      const key = kw.toLowerCase();
      if (seenKw.has(key)) continue;
      seenKw.add(key);
      keywords.push(kw);
    }
  }
  return { keywords, hashtags };
}

export function removeDiacritics(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

/** "thời trang" → "thoitrang" */
export function keywordToHashtagBody(keyword) {
  return removeDiacritics(keyword)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "");
}

const EN_HINTS = {
  "thời trang": "fashion vietnam",
  "thoi trang": "fashion vietnam",
  "mỹ phẩm": "cosmetics vietnam",
  "my pham": "cosmetics vietnam",
  marketing: "digital marketing vietnam",
  "bán hàng": "online selling vietnam",
  "ban hang": "online selling vietnam",
};

/** Biến thể từ 1 từ khóa gốc (mục 11.2 kênh 2) */
export function generateKeywordVariants(keyword) {
  const base = String(keyword || "").trim();
  if (!base) return [];
  const noTone = removeDiacritics(base).toLowerCase();
  const set = new Set([base]);
  if (noTone && noTone !== base.toLowerCase()) set.add(noTone);
  set.add(`shop ${base}`);
  set.add(`cửa hàng ${base}`);
  set.add(`${base} Hà Nội`);
  set.add(`${base} nữ`);
  const en = EN_HINTS[base.toLowerCase()] || EN_HINTS[noTone];
  if (en) set.add(en);
  return [...set];
}

/**
 * Hashtag suy ra từ từ khóa thường + hashtag nhập tay (dedupe).
 */
export function collectHashtagsForCampaign(keywords, manualHashtags) {
  const seen = new Set();
  const out = [];
  const push = (tag) => {
    const n = normalizeHashtag(tag.startsWith("#") ? tag : `#${tag}`);
    if (!n) return;
    const key = n.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(n);
  };
  for (const kw of keywords || []) {
    const body = keywordToHashtagBody(kw);
    if (body) push(`#${body}`);
  }
  for (const tag of manualHashtags || []) push(tag);
  return out;
}

/**
 * Lập hàng đợi phiên theo chế độ (mục 11.4).
 * Mỗi item: { kind: 'keyword'|'hashtag', query, label, channel, rootKeyword? }
 */
export function buildCampaignJobs({ searchMode: _searchMode, keywords, manualHashtags }) {
  // Chỉ hashtag: suy ra từ từ khóa + hashtag nhập tay
  const jobs = [];
  const seenTag = new Set();

  const addHashtagJob = (tag, channel, rootKeyword) => {
    const n = normalizeHashtag(tag);
    if (!n) return;
    const key = n.toLowerCase();
    if (seenTag.has(key)) return;
    seenTag.add(key);
    jobs.push({
      kind: "hashtag",
      query: n.replace(/^#/, ""),
      label: n,
      channel,
      rootKeyword: rootKeyword || n,
    });
  };

  const tags = collectHashtagsForCampaign(keywords, manualHashtags);
  for (const tag of tags) addHashtagJob(tag, "hashtag", tag);
  if (!tags.length && manualHashtags?.length) {
    for (const tag of manualHashtags) addHashtagJob(tag, "hashtag", tag);
  }

  return jobs;
}

/** Gộp page theo page_key, cộng kênh phát hiện */
export function mergePagesByKey(pageLists, metaBySession = {}) {
  const map = new Map();
  for (const { sessionId, items } of pageLists) {
    const meta = metaBySession[sessionId] || {};
    for (const p of items || []) {
      const key = p.page_key || p.page_url;
      if (!key) continue;
      const channel = meta.channel || "unknown";
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          ...p,
          channels: [channel],
          channel_count: 1,
          source_keyword: meta.label || p.source_keyword,
          _sessions: [sessionId],
        });
      } else {
        if (!existing.channels.includes(channel)) {
          existing.channels.push(channel);
          existing.channel_count = existing.channels.length;
        }
        if (!existing._sessions.includes(sessionId)) existing._sessions.push(sessionId);
        if ((p.follower_count || 0) > (existing.follower_count || 0)) {
          existing.follower_count = p.follower_count;
          existing.follower_text = p.follower_text;
        }
        if (p.phone && !existing.phone) existing.phone = p.phone;
        if (p.email && !existing.email) existing.email = p.email;
        if (p.website && !existing.website) existing.website = p.website;
        if (p.address && !existing.address) existing.address = p.address;
        if (p.avatar_url && !existing.avatar_url) existing.avatar_url = p.avatar_url;
        if (p.page_name && !existing.page_name) existing.page_name = p.page_name;
      }
    }
  }
  return [...map.values()];
}

/** Sắp xếp kết quả — không tính điểm; ưu tiên follower rồi tên. */
export function sortPagesForMode(pages, _searchMode, _terms) {
  return [...(pages || [])].sort((a, b) => {
    const fl = (Number(b.follower_count) || 0) - (Number(a.follower_count) || 0);
    if (fl !== 0) return fl;
    return String(a.page_name || "").localeCompare(String(b.page_name || ""), "vi");
  });
}

/** Nhãn từ khóa hiển thị cột TỪ KHÓA */
export function pageKeywordLabel(page) {
  if (page?.source_keyword) return String(page.source_keyword).replace(/^#/, "");
  const tags = page?.matched_hashtags;
  if (Array.isArray(tags) && tags.length) return String(tags[0]).replace(/^#/, "");
  if (typeof tags === "string" && tags.trim()) {
    try {
      const parsed = JSON.parse(tags);
      if (Array.isArray(parsed) && parsed[0]) return String(parsed[0]).replace(/^#/, "");
    } catch {
      return tags.replace(/^#/, "").split(",")[0].trim();
    }
  }
  return "—";
}

export function newCampaignId() {
  return `camp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function channelBadge(channels = []) {
  const set = new Set(channels);
  const hasKw = [...set].some((c) => c === "pages_search" || c === "keyword_variant");
  const hasTag = set.has("hashtag");
  if (hasKw && hasTag) return "Cả hai";
  if (hasTag) return "Hashtag";
  if (hasKw) return "Từ khóa";
  return "—";
}
