/** Tiện ích thuần cho Module 13 (Quét profile) — không phụ thuộc React, chạy được bằng node. */

const FB_HOSTS = /^(?:www\.|m\.|web\.|mbasic\.|vi-vn\.)?(?:facebook|fb)\.com$/i;

/** Đoạn đầu đường dẫn không phải trang cá nhân */
const RESERVED = new Set([
  "groups", "pages", "page", "posts", "photo", "photos", "photo.php", "watch", "reel", "reels", "story.php",
  "stories", "events", "marketplace", "gaming", "hashtag", "search", "share", "sharer", "sharer.php", "login",
  "login.php", "help", "settings", "messages", "notifications", "friends", "permalink.php", "video.php", "videos",
  "l.php", "home.php", "business", "ads", "policies", "privacy",
]);

/** Link / UID trang cá nhân → { key, url } chuẩn hóa; không hợp lệ → null */
export function normalizeProfile(raw) {
  const text = String(raw || "").trim().replace(/^["']+|["']+$/g, "");
  if (!text) return null;
  if (/^\d{5,20}$/.test(text)) {
    return { key: text, url: `https://www.facebook.com/profile.php?id=${text}` };
  }
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!FB_HOSTS.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (!parts.length) return null;
  const first = parts[0].toLowerCase();
  const byId = (id) =>
    /^\d{5,20}$/.test(id || "") ? { key: id, url: `https://www.facebook.com/profile.php?id=${id}` } : null;
  if (first === "profile.php") return byId(u.searchParams.get("id"));
  if (first === "people") return byId(parts[2]);
  if (RESERVED.has(first) || parts.length > 1) return null;
  if (/^\d+$/.test(first)) return byId(first);
  if (!/^[a-z0-9.]{3,60}$/.test(first)) return null;
  return { key: first, url: `https://www.facebook.com/${parts[0]}` };
}

/**
 * Danh sách dòng → [{ id, raw, url, key, status: valid | duplicate | invalid }].
 * skipDuplicates / skipInvalid: bỏ hẳn dòng trùng / dòng trống, sai định dạng.
 */
export function parseProfileLines(lines, { skipDuplicates = false, skipInvalid = false } = {}) {
  const seen = new Set();
  const rows = [];
  lines.forEach((line, i) => {
    const raw = String(line ?? "").trim();
    if (!raw) return;
    const p = normalizeProfile(raw);
    if (!p) {
      if (!skipInvalid) rows.push({ id: `l${i}`, raw, url: raw, key: null, status: "invalid" });
      return;
    }
    const dup = seen.has(p.key);
    seen.add(p.key);
    if (dup && skipDuplicates) return;
    rows.push({ id: `l${i}`, raw, url: p.url, key: p.key, status: dup ? "duplicate" : "valid" });
  });
  return rows;
}

/** Mỗi dòng của tệp → ô đầu tiên là link / UID hợp lệ; không có thì lấy ô có chữ đầu tiên */
export function pickProfileCell(cells) {
  const texts = (cells || []).map((c) => String(c ?? "").trim()).filter(Boolean);
  return texts.find((c) => /facebook\.com|fb\.com/i.test(c) && normalizeProfile(c)) ||
    texts.find((c) => normalizeProfile(c)) ||
    texts[0] ||
    "";
}

export const SOURCE_TYPES = { group: "Nhóm", page: "Fanpage", post: "Bài viết" };
export const SCALE_UNITS = { group: "thành viên", page: "theo dõi", post: "tương tác" };

/** Danh mục hệ thống: profile chưa được xếp vào danh mục nào */
export const UNCATEGORIZED = "category:none";

export const sourceKey = (type, id) => `${type}:${id}`;

/** Đếm profile đã chọn theo từng loại nguồn */
export function summarizeSources(sources) {
  const out = { total: 0, group: 0, page: 0, post: 0, groupCount: 0, pageCount: 0, postCount: 0 };
  Object.values(sources || {}).forEach((s) => {
    const n = Object.keys(s.profiles).length;
    if (!n) return;
    out[s.type] += n;
    out[`${s.type}Count`] += 1;
    out.total += n;
  });
  return out;
}

export const fmtNum = (n) =>
  n === null || n === undefined || n === "" || Number.isNaN(Number(n)) ? "—" : Number(n).toLocaleString("vi-VN");

export const shortFbUrl = (url) =>
  String(url || "").replace(/^https?:\/\/(?:www\.|m\.|web\.)?(?:facebook|fb)\.com\//i, "fb.com/");
