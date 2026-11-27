/**
 * Tách nội dung ô soạn bài chung — khớp với compose_service.parse_compose_text (backend).
 *   - "Nhiều nội dung": tách theo dòng chỉ có "---"; bỏ bài rỗng; bài giống hệt nhau gộp làm một.
 *   - "1 nội dung": cả ô là 1 bài.
 */
export const CONTENT_SINGLE = "SINGLE";
export const CONTENT_MULTI = "MULTI";
export const IMAGE_NONE = "NONE";
export const IMAGE_SINGLE = "SINGLE";
export const IMAGE_MULTI = "MULTI";
export const MAX_POST_CHARS = 63206;
export const MAX_TIME_SLOTS = 24;
export const POST_SEPARATOR = "---";

const SEPARATOR_LINE = /^[ \t]*---[ \t]*$/;

export function parseComposeText(text, contentMode = CONTENT_MULTI) {
  const raw = String(text || "").replace(/\r\n?/g, "\n");
  const chunks = [];
  if (contentMode === CONTENT_SINGLE) {
    chunks.push(raw);
  } else {
    let current = [];
    for (const line of raw.split("\n")) {
      if (SEPARATOR_LINE.test(line)) {
        chunks.push(current.join("\n"));
        current = [];
      } else {
        current.push(line);
      }
    }
    chunks.push(current.join("\n"));
  }

  const posts = [];
  const seen = new Set();
  let emptyDropped = 0;
  let duplicatesMerged = 0;
  const tooLong = [];
  for (const chunk of chunks) {
    const post = chunk.trim();
    if (!post) {
      if (contentMode !== CONTENT_SINGLE && raw.trim()) emptyDropped += 1;
      continue;
    }
    if (seen.has(post)) {
      duplicatesMerged += 1;
      continue;
    }
    seen.add(post);
    posts.push(post);
    if (post.length > MAX_POST_CHARS) tooLong.push(posts.length);
  }
  return { posts, count: posts.length, emptyDropped, duplicatesMerged, tooLong, summary: composeSummary(posts.length, emptyDropped, duplicatesMerged) };
}

export function composeSummary(count, emptyDropped = 0, duplicatesMerged = 0) {
  const parts = [];
  if (emptyDropped) parts.push(`bỏ ${emptyDropped} bài rỗng`);
  if (duplicatesMerged) parts.push(`gộp ${duplicatesMerged} bài trùng`);
  return `Đã nhận ${count} bài${parts.length ? ` (${parts.join(", ")})` : ""}`;
}

/** "9:5" / "09:05" → "09:05"; không hợp lệ → "" */
export function normalizeHHmm(value) {
  const m = String(value || "").trim().match(/^([01]?\d|2[0-3]):([0-5]?\d)$/);
  if (!m) return "";
  return `${m[1].padStart(2, "0")}:${m[2].padStart(2, "0")}`;
}

/** Số phút từ bây giờ tới HH:mm hôm nay (âm = đã qua). */
export function minutesUntil(hhmm, now = new Date()) {
  const norm = normalizeHHmm(hhmm);
  if (!norm) return null;
  const [h, m] = norm.split(":").map(Number);
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  return (target.getTime() - now.getTime()) / 60000;
}

export function sortSlots(slots) {
  return [...new Set(slots.map(normalizeHHmm).filter(Boolean))].sort();
}
