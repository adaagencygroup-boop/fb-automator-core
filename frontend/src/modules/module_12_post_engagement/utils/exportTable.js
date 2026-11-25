// Xuất dữ liệu Module 12 ra Excel (.xlsx), CSV hoặc TXT (chỉ UID) — copy phần lõi từ Module 10, không import chéo.
// - .xlsx: ô UID ghi dạng CHỮ → Excel không đổi thành 1,00034E+14.
// - .csv: có BOM UTF-8 để Excel đọc đúng tiếng Việt / emoji, thoát dấu phẩy / nháy / xuống dòng đúng chuẩn.
// - .txt: mỗi dòng 1 UID, không khoảng trắng / ký tự thừa.

const pad = (n) => String(n).padStart(2, "0");

/** "Đại học Phenikaa (K20)" → "Dai_hoc_Phenikaa_K20" — tên file không dấu, không ký tự lạ. */
export function safeFileName(name, fallback = "Export") {
  const clean = String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return clean || fallback;
}

/** Hậu tố thời gian theo giờ máy: 20261124_1124 */
export function fileStamp(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** Nội dung CSV (BOM + CRLF), ô có , " hoặc xuống dòng được bọc nháy kép. */
export function buildCsv(headers, rows) {
  const esc = (val) => {
    const str = val == null ? "" : String(val);
    return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  return "﻿" + [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}

/** Workbook .xlsx (để test được ngoài trình duyệt). Mọi giá trị chuỗi giữ nguyên là chữ. */
export function buildWorkbook(XLSX, { headers, rows, sheetName = "Sheet1", widths = [] }) {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  sheet["!cols"] = headers.map((h, i) => ({
    wch: widths[i] || Math.min(60, Math.max(8, String(h).length + 2)),
  }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, String(sheetName).slice(0, 31));
  return book;
}

/** Danh sách UID (mỗi dòng 1 UID, bỏ trùng, chỉ chữ số). */
export function buildUidText(uids) {
  const seen = new Set();
  const out = [];
  (uids || []).forEach((u) => {
    const v = String(u ?? "").replace(/\D/g, "");
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  });
  return out.join("\r\n");
}

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Tải file về máy. format: "xlsx" | "csv". Trả về tên file. */
export async function downloadTable({ format = "xlsx", baseName, headers, rows, sheetName, widths }) {
  const fileName = `${safeFileName(baseName)}_${fileStamp()}.${format}`;
  if (format === "csv") {
    saveBlob(new Blob([buildCsv(headers, rows)], { type: "text/csv;charset=utf-8;" }), fileName);
  } else {
    const XLSX = await import("xlsx");
    XLSX.writeFile(buildWorkbook(XLSX, { headers, rows, sheetName, widths }), fileName);
  }
  return fileName;
}

/** Tải danh sách UID dạng .txt. */
export function downloadUidText(baseName, uids) {
  const fileName = `${safeFileName(baseName)}_UID_${fileStamp()}.txt`;
  saveBlob(new Blob([buildUidText(uids)], { type: "text/plain;charset=utf-8;" }), fileName);
  return fileName;
}

const TIER_TEXT = { 1: "Mức 1 (Cao)", 2: "Mức 2 (Cơ bản)" };
const ACTION_TEXT = { like: "Cảm xúc", share: "Chia sẻ", comment: "Bình luận" };
export const REACTION_TEXT = {
  LIKE: "Thích", LOVE: "Yêu thích", CARE: "Thương thương", HAHA: "Haha", WOW: "Wow", SAD: "Buồn", ANGRY: "Phẫn nộ",
};

/** Bảng xuất tương tác: STT, Tên, UID (chữ), Link cá nhân, Thời gian, Hành động, Nội dung bình luận, Loại cảm xúc, Mức quan tâm. */
export function engagementExportTable(rows) {
  const headers = ["STT", "Tên tài khoản", "UID Facebook", "Link cá nhân", "Thời gian tương tác", "Hành động",
    "Nội dung bình luận", "Loại cảm xúc", "Mức độ quan tâm", "Link bài viết"];
  const body = (rows || []).map((r, i) => [
    i + 1,
    r.name || "",
    String(r.uid || ""),
    r.profile_url || (r.uid ? `https://www.facebook.com/${r.uid}` : ""),
    r.time || "",
    ACTION_TEXT[r.action] || "",
    r.action === "comment" ? r.text || "" : "",
    r.action === "like" ? REACTION_TEXT[r.reaction] || r.reaction || "" : "",
    TIER_TEXT[r.tier] || "",
    r.post_url || "",
  ]);
  return { headers, rows: body, widths: [6, 28, 20, 42, 18, 12, 60, 14, 16, 50] };
}

// ---------------------------------------------------------------------------
// File mẫu cho tab "Tải tệp": mỗi dòng 1 link bài viết
// ---------------------------------------------------------------------------

export const LINK_TEMPLATE_HEADERS = ["STT", "Link bài viết Facebook", "Ghi chú (không bắt buộc)"];
export const LINK_TEMPLATE_ROWS = [
  [1, "https://www.facebook.com/groups/123456789012345/posts/987654321098765/", "Bài trong nhóm"],
  [2, "https://www.facebook.com/tenfanpage/posts/pfbid0AbCdEfGh1234567890abcdefghijk", "Bài fanpage"],
  [3, "https://www.facebook.com/permalink.php?story_fbid=987654321098765&id=100012345678901", "Bài trang cá nhân"],
];

export function buildLinkTemplateText(format) {
  if (format === "csv") return buildCsv(LINK_TEMPLATE_HEADERS, LINK_TEMPLATE_ROWS);
  return LINK_TEMPLATE_ROWS.map((r) => r[1]).join("\r\n");
}

export async function downloadLinkTemplate(format = "xlsx") {
  const name = `Mau_link_bai_viet.${format}`;
  if (format === "xlsx") {
    const XLSX = await import("xlsx");
    XLSX.writeFile(buildWorkbook(XLSX, { headers: LINK_TEMPLATE_HEADERS, rows: LINK_TEMPLATE_ROWS, sheetName: "Link bai viet",
      widths: [6, 80, 24] }), name);
    return name;
  }
  const type = format === "csv" ? "text/csv;charset=utf-8;" : "text/plain;charset=utf-8;";
  saveBlob(new Blob([buildLinkTemplateText(format)], { type }), name);
  return name;
}
