/**
 * Tách nội dung ô soạn bài chung — khớp với compose_service.parse_compose_text (backend).
 *   - "Nhiều nội dung": tách theo dòng chỉ có "---"; bỏ bài rỗng; bài giống hệt nhau gộp làm một.
 *   - "1 nội dung": cả ô là 1 bài.
 */
// "Từng bài": mỗi nick 1 bài riêng cho mỗi khung giờ | "Dạng văn bản": ô soạn chung chia ngẫu nhiên cho nick
export const LAYOUT_ACCOUNTS = "ACCOUNTS";
export const LAYOUT_TEXT = "TEXT";
export const MAX_ACCOUNT_POST_IMAGES = 10;
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

/** Bài thứ `index` của nick trong dạng "Từng bài" ({content, images}). */
export function accountEntry(accountPosts, uid, index) {
  const list = (accountPosts || {})[String(uid)];
  const e = Array.isArray(list) ? list[index] : null;
  return { content: String(e?.content || ""), images: Array.isArray(e?.images) ? e.images : [] };
}

/** Các ô (nick, khung) còn trống của dạng "Từng bài". */
export function emptyAccountCells(accountPosts, uids, rowCount) {
  const cells = [];
  for (const uid of uids) {
    for (let i = 0; i < rowCount; i += 1) {
      if (!accountEntry(accountPosts, uid, i).content.trim()) cells.push({ uid: String(uid), index: i });
    }
  }
  return cells;
}

function imageCount(compose) {
  if (compose.image_mode === IMAGE_SINGLE) return 1;
  if (compose.image_mode !== IMAGE_MULTI) return 0;
  const min = Math.max(1, Number(compose.min_images) || 1);
  const max = Math.max(min, Number(compose.max_images) || min);
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * "Dạng văn bản" → "Từng bài": điền lần lượt các bài trong ô soạn vào các ô còn trống
 * (khung 1 của mọi nick trước, rồi khung 2...). Ô đã có nội dung giữ nguyên; hết bài thì dừng (không lặp bài).
 * Ảnh lấy từ kho chung theo chế độ ảnh đang chọn, xoay vòng để các nick ít trùng ảnh nhất.
 */
export function textToAccountPosts(compose, uids, rowCount) {
  const posts = parseComposeText(compose.content_text, compose.content_mode).posts;
  const pool = (compose.image_paths || []).filter(Boolean);
  const next = { ...(compose.account_posts || {}) };
  let used = 0;
  let imgCursor = 0;
  for (let row = 0; row < rowCount && used < posts.length; row += 1) {
    for (const rawUid of uids) {
      if (used >= posts.length) break;
      const uid = String(rawUid);
      if (accountEntry(next, uid, row).content.trim()) continue;
      let images = [];
      if (pool.length && compose.image_mode === IMAGE_SINGLE) {
        images = [pool[0]];
      } else if (pool.length) {
        const n = Math.min(imageCount(compose), pool.length, MAX_ACCOUNT_POST_IMAGES);
        for (let k = 0; k < n; k += 1) images.push(pool[(imgCursor + k) % pool.length]);
        imgCursor = (imgCursor + n) % pool.length;
      }
      const list = Array.from({ length: Math.max(rowCount, (next[uid] || []).length) }, (_, i) => accountEntry(next, uid, i));
      list[row] = { content: posts[used], images };
      next[uid] = list;
      used += 1;
    }
  }
  return { accountPosts: next, filled: used, leftover: posts.length - used };
}

/**
 * "Từng bài" → "Dạng văn bản": nối bài của các nick đang chọn bằng "---" vào cuối ô soạn
 * (bỏ bài đã có trong ô), ảnh dồn vào kho chung.
 */
export function accountPostsToText(compose, uids, rowCount) {
  const existing = new Set(parseComposeText(compose.content_text, CONTENT_MULTI).posts);
  const added = [];
  const images = [];
  for (let row = 0; row < rowCount; row += 1) {
    for (const uid of uids) {
      const e = accountEntry(compose.account_posts, uid, row);
      const text = e.content.trim();
      if (!text) continue;
      if (!existing.has(text)) {
        existing.add(text);
        added.push(text);
      }
      images.push(...e.images);
    }
  }
  const base = String(compose.content_text || "").trim();
  const pool = [...new Set([...(compose.image_paths || []), ...images])];
  const newImages = pool.length - (compose.image_paths || []).length;
  return {
    patch: {
      content_text: [base, ...added].filter(Boolean).join(`\n${POST_SEPARATOR}\n`),
      content_mode: CONTENT_MULTI,
      image_paths: pool,
      image_mode: newImages > 0 && compose.image_mode === IMAGE_NONE ? IMAGE_MULTI : compose.image_mode,
    },
    added: added.length,
    newImages,
  };
}
