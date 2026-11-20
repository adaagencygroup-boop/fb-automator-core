// Đọc link nhóm Facebook từ ô Nhập link / tệp .txt .csv .xlsx.
// Một dòng (hoặc một hàng Excel) có thể chứa nhiều cột: STT, tên nhóm, link, số thành viên… → chỉ lấy phần là link nhóm.

const GROUP_URL_RE = /(?:https?:\/\/)?(?:www\.|m\.|web\.|mbasic\.)?(?:facebook\.com|fb\.com)\/groups\/[0-9A-Za-z._-]+/gi;
// ID nhóm dạng số đứng riêng (ID thật dài 9–20 chữ số; số thành viên như 38000 không bị nhận nhầm).
const GROUP_ID_RE = /^[0-9]{9,20}$/;
// Ranh giới từ theo Unicode (\b của JS không hiểu chữ có dấu như "chú").
const HEADER_RE = /^(stt|tt|#|tên|ten|name|link|url|nhóm|nhom|group|đường dẫn|duong dan|liên kết|lien ket|thành viên|thanh vien|members?|ghi chú|ghi chu|note)(?=$|[^\p{L}\p{N}])/iu;

/** Chuẩn hoá về https://www.facebook.com/groups/<id-hoặc-slug> (không query, không / cuối). */
export function normalizeGroupLink(raw) {
  const text = String(raw || "").trim();
  if (GROUP_ID_RE.test(text)) return `https://www.facebook.com/groups/${text}`;
  const m = text.match(/(?:facebook\.com|fb\.com)\/groups\/([0-9A-Za-z._-]+)/i);
  if (m) return `https://www.facebook.com/groups/${m[1].replace(/\.+$/, "")}`;
  return text;
}

/** Tách các link nhóm trong một đoạn văn bản (1 dòng hoặc nhiều ô ghép lại). */
export function extractGroupLinks(cells) {
  const list = Array.isArray(cells) ? cells : [cells];
  const found = [];
  list.forEach((cell) => {
    const text = String(cell ?? "").trim();
    if (!text) return;
    const urls = text.match(GROUP_URL_RE);
    if (urls) {
      urls.forEach((u) => found.push(normalizeGroupLink(u)));
      return;
    }
    // Ô / cột chỉ có ID số → coi là ID nhóm.
    text.split(/[\s,;\t|]+/).forEach((token) => {
      if (GROUP_ID_RE.test(token)) found.push(normalizeGroupLink(token));
    });
  });
  return found;
}

/** Dòng tiêu đề (STT, Tên nhóm, Link…) — bỏ qua, không tính là dòng lỗi. */
export function isHeaderRow(cells) {
  const list = (Array.isArray(cells) ? cells : String(cells || "").split(/[,;\t|]/))
    .map((c) => String(c ?? "").trim())
    .filter(Boolean);
  return list.length > 0 && list.every((c) => HEADER_RE.test(c));
}

/**
 * Đọc danh sách dòng → [{line, raw, url, status: valid|duplicate|invalid, reason}].
 * Dòng rỗng, dòng chú thích (#…) và dòng tiêu đề được bỏ qua.
 * `rows`: mảng các dòng; mỗi dòng là chuỗi (txt/csv/ô nhập) hoặc mảng ô (xlsx).
 */
export function parseGroupLinkRows(rows, { maxLinks = 1000 } = {}) {
  const seen = new Set();
  const out = [];
  let truncated = false;
  rows.forEach((row, idx) => {
    const cells = Array.isArray(row) ? row : [row];
    const raw = cells.map((c) => String(c ?? "").trim()).filter(Boolean).join(" · ");
    if (!raw || raw.startsWith("#")) return;
    const links = extractGroupLinks(cells);
    // Chỉ coi là dòng tiêu đề khi không có link ("Nhóm hay nè: <link>" vẫn là dòng dữ liệu).
    if (!links.length && isHeaderRow(Array.isArray(row) ? row : raw)) return;
    if (!links.length) {
      out.push({ line: idx + 1, raw, url: raw, status: "invalid", reason: "Không có link nhóm Facebook" });
      return;
    }
    links.forEach((url) => {
      if (out.filter((r) => r.status === "valid").length >= maxLinks) {
        truncated = true;
        return;
      }
      const key = url.toLowerCase();
      const status = seen.has(key) ? "duplicate" : "valid";
      seen.add(key);
      out.push({ line: idx + 1, raw, url, status });
    });
  });
  return { rows: out, truncated };
}

/** Tách nội dung tệp text/csv thành các dòng. */
export function splitTextRows(text) {
  return String(text || "").replace(/^﻿/, "").split(/\r?\n/);
}
