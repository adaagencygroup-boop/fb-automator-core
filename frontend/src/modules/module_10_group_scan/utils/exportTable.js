// Xuất bảng dữ liệu Module 10 ra Excel (.xlsx) hoặc CSV — dùng chung cho mọi nút "Xuất".
// - .xlsx: ô ID / UID ghi dạng CHỮ → Excel không đổi thành 1,00034E+14, không mất số 0 / chữ số cuối.
// - .csv: có BOM UTF-8 để Excel đọc đúng tiếng Việt, thoát dấu phẩy / nháy / xuống dòng đúng chuẩn.

import api from "@/services/api";

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

/** Hậu tố thời gian theo giờ máy: 20261120_1124 */
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

function textToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Lưu file vào thư mục Tải về (Downloads). Trả về đường dẫn file đã lưu.
 * format: "xlsx" | "csv". Engine ghi file → lỗi (file đích đang mở / bị khóa...) được
 * ném ra thành Error để màn hình báo Toast; tải qua trình duyệt thì lỗi bị nuốt im lặng.
 */
export async function downloadTable({ format = "xlsx", baseName, headers, rows, sheetName, widths }) {
  const fileName = `${safeFileName(baseName)}_${fileStamp()}.${format}`;
  let contentBase64;
  if (format === "csv") {
    contentBase64 = textToBase64(buildCsv(headers, rows));
  } else {
    const XLSX = await import("xlsx");
    contentBase64 = XLSX.write(buildWorkbook(XLSX, { headers, rows, sheetName, widths }), { bookType: "xlsx", type: "base64" });
  }
  const res = await api.post("/api/group-scan/export-file", { file_name: fileName, content_base64: contentBase64 }, { timeout: 120000 });
  return res?.path || fileName;
}

/**
 * File mẫu cho "Tải tệp link nhóm". Ví dụ & hướng dẫn nằm ở dòng bắt đầu bằng # (txt/csv)
 * hoặc ở sheet "Huong dan" (xlsx) — khi tải lên không bị hiểu nhầm là link cần quét.
 */
export const LINK_TEMPLATE_HEADERS = ["STT", "Link nhóm Facebook", "Tên nhóm (không bắt buộc)"];
// Không dùng dấu phẩy / chấm phẩy: dòng hướng dẫn trong .csv phải bắt đầu bằng # (không bọc nháy)
// để khi tải lên được bỏ qua, và Excel không tách nó ra nhiều cột.
export const LINK_TEMPLATE_GUIDE = [
  "Mỗi dòng 1 nhóm. Chỉ cột Link nhóm Facebook là bắt buộc – các cột khác để ghi nhớ và có thể bỏ trống.",
  "Link nhận được: facebook.com/groups/123456789012345 – facebook.com/groups/ten-nhom – m.facebook.com/groups/... – hoặc chỉ ID số của nhóm.",
  "Link trùng tự bỏ – dòng không có link nhóm báo Sai định dạng – tối đa 1.000 link mỗi tệp.",
  "Chỉ quét nhóm công khai đủ số thành viên theo cài đặt – nhóm đã có trong Danh sách nhóm quét được cập nhật lại thông tin.",
];

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

/** Nội dung file mẫu dạng chữ (txt / csv). */
export function buildLinkTemplateText(format) {
  const guide = LINK_TEMPLATE_GUIDE.map((line) => `# ${line}`);
  if (format === "csv") {
    return "﻿" + [...guide, LINK_TEMPLATE_HEADERS.join(",")].join("\r\n") + "\r\n";
  }
  return [...guide, "# Dán link nhóm bên dưới – mỗi dòng 1 link:", ""].join("\r\n");
}

/** Workbook mẫu: sheet 1 để nhập (đọc khi tải lên), sheet 2 hướng dẫn + ví dụ. */
export function buildLinkTemplateWorkbook(XLSX) {
  const input = XLSX.utils.aoa_to_sheet([LINK_TEMPLATE_HEADERS]);
  input["!cols"] = [{ wch: 6 }, { wch: 60 }, { wch: 36 }];
  const guide = XLSX.utils.aoa_to_sheet([
    ["Hướng dẫn"],
    ...LINK_TEMPLATE_GUIDE.map((l) => [l]),
    [],
    ["Ví dụ cách điền ở sheet Link nhom:"],
    LINK_TEMPLATE_HEADERS,
    ["1", "https://www.facebook.com/groups/123456789012345", "Nhóm A"],
    ["2", "https://www.facebook.com/groups/ten-nhom-cua-ban", ""],
    ["3", "123456789012345", "Chỉ cần ID số"],
  ]);
  guide["!cols"] = [{ wch: 110 }, { wch: 50 }, { wch: 20 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, input, "Link nhom");
  XLSX.utils.book_append_sheet(book, guide, "Huong dan");
  return book;
}

/** Tải file mẫu. format: "xlsx" | "csv" | "txt". */
export async function downloadLinkTemplate(format = "xlsx") {
  const fileName = `Mau_link_nhom.${format}`;
  if (format === "xlsx") {
    const XLSX = await import("xlsx");
    XLSX.writeFile(buildLinkTemplateWorkbook(XLSX), fileName);
  } else {
    const type = format === "csv" ? "text/csv;charset=utf-8;" : "text/plain;charset=utf-8;";
    saveBlob(new Blob([buildLinkTemplateText(format)], { type }), fileName);
  }
  return fileName;
}

const ROLE_LABEL ={ admin: "Quản trị viên", moderator: "Kiểm duyệt viên" };

/** Bảng thành viên dùng chung cho trang Quét thành viên & Danh sách thành viên quét. */
export function memberExportTable(members) {
  const headers = ["STT", "Họ tên", "UID Facebook", "Nhóm", "Link cá nhân", "Vai trò", "Ngày tham gia nhóm", "Thời gian quét"];
  const rows = (members || []).map((m, idx) => {
    const uid = String(m.uid || m.member_uid || "");
    return [
      idx + 1,
      m.name || m.member_name || "",
      uid, // chuỗi → giữ nguyên đủ chữ số trong Excel
      m.group_name || m.groupName || m.group_id || "",
      m.profile_url || m.href || (uid ? `https://www.facebook.com/${uid}` : ""),
      ROLE_LABEL[m.role] || "Thành viên",
      m.joined_date || m.joinedText || "",
      m.scanned_at || m.time || "",
    ];
  });
  return { headers, rows, widths: [6, 28, 20, 36, 42, 16, 22, 20] };
}

const TYPE_LABEL = { public: "Công khai", private: "Riêng tư" };

/** Bảng nhóm dùng chung cho trang Quét thông tin nhóm & Danh sách nhóm quét. */
export function groupExportTable(groups) {
  const headers = ["STT", "Từ khóa", "Tên nhóm", "Loại nhóm", "Thành viên", "URL nhóm"];
  const rows = (groups || []).map((g, idx) => {
    const raw = g.href || g.url || "";
    const url = raw && !/^https?:\/\//i.test(raw) ? `https://${raw}` : raw;
    return [idx + 1, g.keyword || "", g.name || "", TYPE_LABEL[g.type] || "Không rõ", g.members || "", url];
  });
  return { headers, rows, widths: [6, 22, 40, 12, 12, 52] };
}
