/**
 * Mục 11 — tách chip, biến thể từ khóa, hashtag suy ra, điểm kết hợp.
 */

/** Chỉ còn tìm theo hashtag (đã bỏ Page lớn / Kết hợp). */
export const SEARCH_MODES = [
  {
    id: "NGACH",
    label: "Hashtag",
    hint: "Hashtag / bài viết → tác giả Page · xếp theo điểm liên quan",
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

  for (const kw of keywords || []) {
    const body = keywordToHashtagBody(kw);
    if (body) addHashtagJob(`#${body}`, "hashtag", kw);
  }
  for (const tag of manualHashtags || []) {
    addHashtagJob(tag, "hashtag", tag);
  }

  return jobs;
}

export function followerBandScore(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return 30;
  if (v >= 500_000) return 25;
  if (v >= 100_000) return 20;
  if (v >= 50_000) return 15;
  if (v >= 10_000) return 10;
  if (v >= 1_000) return 5;
  return 0;
}

/**
 * Điểm kết hợp thang 100 (mục 11.4).
 * @param {object} page
 * @param {{ terms?: string[], channelCount?: number }} ctx
 */
export function computeHybridScore(page, ctx = {}) {
  const terms = (ctx.terms || []).map((t) =>
    String(t).toLowerCase().replace(/^#/, "").trim(),
  ).filter(Boolean);
  let score = followerBandScore(page.follower_count);
  const name = String(page.page_name || "").toLowerCase();
  if (terms.some((t) => t && name.includes(t))) score += 20;
  const rel = Number(page.relevance_score) || 0;
  score += Math.min(30, Math.round(rel * 0.3));
  if (page.is_verified === true) score += 10;
  const channels = ctx.channelCount ?? page.channel_count ?? 1;
  if (channels >= 2) score += 10;
  return Math.min(100, Math.max(0, Math.round(score)));
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
        // giữ follower / relevance cao hơn
        if ((p.follower_count || 0) > (existing.follower_count || 0)) {
          existing.follower_count = p.follower_count;
          existing.follower_text = p.follower_text;
        }
        if ((p.relevance_score || 0) > (existing.relevance_score || 0)) {
          existing.relevance_score = p.relevance_score;
          existing.relevance_status = p.relevance_status;
        }
        if (p.phone && !existing.phone) existing.phone = p.phone;
        if (p.email && !existing.email) existing.email = p.email;
        if (p.website && !existing.website) existing.website = p.website;
        if (p.avatar_url && !existing.avatar_url) existing.avatar_url = p.avatar_url;
      }
    }
  }
  return [...map.values()];
}

export function sortPagesForMode(pages, searchMode, terms) {
  const scored = pages.map((p) => ({
    ...p,
    hybrid_score: computeHybridScore(p, { terms, channelCount: p.channel_count }),
  }));
  // Hashtag-only: xếp theo điểm liên quan
  scored.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0));
  return scored;
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
