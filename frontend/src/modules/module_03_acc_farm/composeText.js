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

// ── Một bộ bài chung cho 2 cách xem ("Từng bài" = thẻ nick, "Dạng văn bản" = 1 ô soạn) ──
// Ô (nick, khung) xếp theo thứ tự: khung 1 của mọi nick, rồi khung 2... Bài thứ k trong ô văn bản = ô thứ k.
// Bài thừa (nhiều hơn số ô) giữ ở content_text làm dự phòng, tự điền vào khi có thêm ô trống.

export function orderedCells(uids, rowCount) {
  const cells = [];
  for (let row = 0; row < rowCount; row += 1) for (const uid of uids) cells.push({ uid: String(uid), row });
  return cells;
}

/** Tách ô văn bản thành các bài theo dòng "---", GIỮ vị trí (bài rỗng vẫn chiếm 1 chỗ). */
export function splitPostChunks(text) {
  const raw = String(text || "").replace(/\r\n?/g, "\n");
  if (!raw.trim()) return [];
  const chunks = [];
  let current = [];
  for (const line of raw.split("\n")) {
    if (SEPARATOR_LINE.test(line)) {
      chunks.push(current.join("\n").trim());
      current = [];
    } else {
      current.push(line);
    }
  }
  chunks.push(current.join("\n").trim());
  return chunks;
}

const joinChunks = (chunks) => chunks.join(`\n${POST_SEPARATOR}\n`);

function setCell(posts, uid, row, patch) {
  const list = Array.isArray(posts[uid]) ? posts[uid].map((e) => ({ ...e })) : [];
  while (list.length <= row) list.push({ content: "", images: [] });
  list[row] = { ...accountEntry(posts, uid, row), ...patch };
  posts[uid] = list;
}

/** Nội dung ô văn bản: bài của các ô theo thứ tự (bỏ ô trống ở cuối) + bài dự phòng. */
export function cellsToText(accountPosts, cells, overflowText) {
  const chunks = cells.map((c) => accountEntry(accountPosts, c.uid, c.row).content.trim());
  while (chunks.length && !chunks[chunks.length - 1]) chunks.pop();
  const overflow = splitPostChunks(overflowText).filter(Boolean);
  return joinChunks([...chunks, ...overflow]);
}

/** Sửa ô văn bản → ghi bài thứ k vào ô thứ k (giữ ảnh của ô); phần thừa thành dự phòng. */
export function applyTextToCells(accountPosts, cells, text) {
  const chunks = splitPostChunks(text);
  const posts = { ...(accountPosts || {}) };
  cells.forEach((c, k) => setCell(posts, c.uid, c.row, { content: chunks[k] || "" }));
  return { account_posts: posts, content_text: joinChunks(chunks.slice(cells.length).filter(Boolean)) };
}

/** Điền bài dự phòng vào các ô còn trống (theo thứ tự). null nếu không có gì thay đổi. */
export function flowOverflowIntoCells(accountPosts, cells, overflowText) {
  const spare = splitPostChunks(overflowText).filter(Boolean);
  if (!spare.length) return null;
  const posts = { ...(accountPosts || {}) };
  let used = 0;
  for (const c of cells) {
    if (used >= spare.length) break;
    if (accountEntry(posts, c.uid, c.row).content.trim()) continue;
    setCell(posts, c.uid, c.row, { content: spare[used] });
    used += 1;
  }
  if (!used) return null;
  return { account_posts: posts, content_text: joinChunks(spare.slice(used)) };
}

/**
 * Gắn ảnh mới cho các bài chưa có ảnh (theo thứ tự ô, mỗi bài 1 ảnh). Ảnh mới hết mà vẫn còn bài thiếu
 * → dùng lại ảnh cũ (xoay vòng) nếu `reuse`. Trả về {account_posts, assigned, reused}.
 */
export function fillCellImages(accountPosts, cells, newImages, { reuse = true } = {}) {
  const posts = { ...(accountPosts || {}) };
  const fresh = [...newImages];
  const missing = cells.filter((c) => {
    const e = accountEntry(posts, c.uid, c.row);
    return e.content.trim() && e.images.length === 0;
  });
  let assigned = 0;
  let reused = 0;
  const pool = [...new Set([...cells.flatMap((c) => accountEntry(posts, c.uid, c.row).images), ...fresh])];
  let cursor = 0;
  for (const c of missing) {
    if (fresh.length) {
      setCell(posts, c.uid, c.row, { images: [fresh.shift()] });
      assigned += 1;
    } else if (reuse && pool.length) {
      setCell(posts, c.uid, c.row, { images: [pool[cursor % pool.length]] });
      cursor += 1;
      reused += 1;
    }
  }
  return { account_posts: posts, assigned, reused, unused: fresh.length };
}
