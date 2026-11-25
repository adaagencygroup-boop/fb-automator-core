// Nhận diện link bài viết Facebook (cùng quy tắc với Engine: modules/module_12_post_engagement/links.py).
// Hỗ trợ: bài nhóm (/groups/<nhóm>/posts|permalink/<id>), bài page / cá nhân (/<tên>/posts/<id|pfbid>),
// permalink.php / story.php?story_fbid=, /watch?v=, /reel/<id>, /photo?fbid=, /<tên>/videos/<id>, link chia sẻ /share/p/<mã>.

const HOST_RE = /^(?:https?:\/\/)?(?:(?:www|m|web|mbasic|touch|business)\.)?(?:facebook\.com|fb\.com|fb\.me)(?=\/|$)/i;
const URL_IN_TEXT = /(?:https?:\/\/)?(?:(?:www|m|web|mbasic|touch)\.)?(?:facebook\.com|fb\.com)\/[^\s,;"'<>]+/gi;
const PFBID = /^pfbid[0-9A-Za-z]{20,}$/;
const DIGITS = /^\d{5,}$/;
const BASE = "https://www.facebook.com";

const seg = (s) => String(s || "").trim().replace(/^\/+|\/+$/g, "").split(/[?#]/)[0];

/** {url, post_key, source_hint} cho link bài viết hợp lệ; null nếu không phải. */
export function parsePostLink(raw) {
  let text = String(raw ?? "").trim().replace(/^[<"' ]+|[>"' ]+$/g, "");
  if (!text || !HOST_RE.test(text)) return null;
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  let u;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  const segs = u.pathname.replace(/\/{2,}/g, "/").split("/").filter(Boolean);
  const low = segs.map((s) => s.toLowerCase());
  const q = (name) => (u.searchParams.get(name) || "").trim();

  if (segs.length >= 4 && low[0] === "groups" && (low[2] === "posts" || low[2] === "permalink")) {
    const group = seg(segs[1]);
    const pid = seg(segs[3]);
    if (DIGITS.test(pid) || PFBID.test(pid)) return { url: `${BASE}/groups/${group}/posts/${pid}/`, post_key: pid, source_hint: "group" };
    return null;
  }
  if (segs.length >= 2 && low[0] === "groups") {
    const pid = q("multi_permalinks").split(",")[0] || (q("view") === "permalink" ? q("id") : "");
    if (DIGITS.test(pid)) return { url: `${BASE}/groups/${seg(segs[1])}/posts/${pid}/`, post_key: pid, source_hint: "group" };
    return null;
  }
  if (segs.length && (low[0] === "permalink.php" || low[0] === "story.php")) {
    const fbid = q("story_fbid");
    const owner = q("id");
    if (fbid && (DIGITS.test(fbid) || PFBID.test(fbid))) {
      return { url: `${BASE}/permalink.php?story_fbid=${fbid}${owner ? `&id=${owner}` : ""}`, post_key: fbid, source_hint: "page" };
    }
    return null;
  }
  if (segs.length && low[0] === "watch") {
    const v = q("v");
    return DIGITS.test(v) ? { url: `${BASE}/watch/?v=${v}`, post_key: v, source_hint: "video" } : null;
  }
  if (segs.length >= 2 && low[0] === "reel") {
    const rid = seg(segs[1]);
    return DIGITS.test(rid) ? { url: `${BASE}/reel/${rid}/`, post_key: rid, source_hint: "video" } : null;
  }
  if (segs.length && (low[0] === "photo" || low[0] === "photo.php")) {
    const fbid = q("fbid");
    return DIGITS.test(fbid) ? { url: `${BASE}/photo/?fbid=${fbid}`, post_key: fbid, source_hint: "photo" } : null;
  }
  if (segs.length >= 3 && low[0] === "share" && ["p", "v", "r"].includes(low[1])) {
    const code = seg(segs[2]);
    return /^[0-9A-Za-z_-]{6,}$/.test(code)
      ? { url: `${BASE}/share/${low[1]}/${code}/`, post_key: `share:${code}`, source_hint: "share" }
      : null;
  }
  if (segs.length >= 3 && ["posts", "videos", "photos"].includes(low[1])) {
    const who = seg(segs[0]);
    const pid = seg(low[1] === "photos" ? segs[segs.length - 1] : segs[2]);
    if (DIGITS.test(pid) || (low[1] === "posts" && PFBID.test(pid))) {
      if (low[1] === "photos") return { url: `${BASE}/photo/?fbid=${pid}`, post_key: pid, source_hint: "photo" };
      return { url: `${BASE}/${who}/${low[1]}/${pid}/`, post_key: pid, source_hint: low[1] === "posts" ? "page" : "video" };
    }
  }
  return null;
}

export function findLinksInText(text) {
  return [...String(text ?? "").matchAll(URL_IN_TEXT)].map((m) => m[0].replace(/[).,;\]]+$/, ""));
}

const HEADER_RE = /(link|url|đường dẫn|bài viết|stt|ghi chú)/i;

/**
 * Đọc các dòng (mỗi dòng: chuỗi hoặc mảng ô) → [{line, raw, url, post_key, status, reason}].
 * status: valid | duplicate | invalid. Dòng tiêu đề không chứa link được bỏ qua.
 */
export function parseLinkRows(rows, { maxLinks = 200 } = {}) {
  const out = [];
  const seen = new Set();
  let truncated = false;
  (rows || []).forEach((row, i) => {
    const line = i + 1;
    const cells = Array.isArray(row) ? row : [row];
    const cellText = cells.filter((c) => c != null && String(c).trim()).map(String).join(" ");
    if (!cellText.trim()) return;
    const found = findLinksInText(cellText);
    if (!found.length) {
      if (line === 1 || HEADER_RE.test(cellText)) return;
      out.push({ line, raw: cellText.slice(0, 300), url: "", post_key: "", status: "invalid", reason: "Không phải link bài viết Facebook" });
      return;
    }
    found.forEach((raw) => {
      const info = parsePostLink(raw);
      if (!info) {
        out.push({ line, raw: raw.slice(0, 300), url: "", post_key: "", status: "invalid", reason: "Link Facebook nhưng không phải link bài viết" });
        return;
      }
      if (seen.has(info.post_key)) {
        out.push({ line, raw: raw.slice(0, 300), ...info, status: "duplicate" });
        return;
      }
      if (seen.size >= maxLinks) {
        truncated = true;
        return;
      }
      seen.add(info.post_key);
      out.push({ line, raw: raw.slice(0, 300), ...info, status: "valid" });
    });
  });
  return { rows: out, truncated };
}

export const splitTextRows = (text) => String(text ?? "").split(/\r?\n/);

/** Đọc tệp .txt / .csv / .xlsx / .xls → mảng dòng (mỗi dòng mảng ô). */
export async function readLinkFile(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (ext === "xlsx" || ext === "xls") {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" })
      .map((row) => row.map((c) => (typeof c === "number" ? String(Math.round(c)) : c)));
  }
  const text = await file.text();
  if (ext === "csv") return splitTextRows(text).map((l) => l.split(/[,;\t]/));
  return splitTextRows(text);
}

/** "...facebook.com/groups/1092837..." — rút gọn link cho bảng xem trước. */
export function shortLink(url, max = 46) {
  const s = String(url || "").replace(/^https?:\/\/(www\.)?/, "");
  return s.length > max ? `…${s.slice(0, max - 3)}…` : s;
}
