// Xuất bảng dữ liệu Module 10 ra Excel (.xlsx) hoặc CSV — dùng chung cho mọi nút "Xuất".
// - .xlsx: ô ID / UID ghi dạng CHỮ → Excel không đổi thành 1,00034E+14, không mất số 0 / chữ số cuối.
// - .csv: có BOM UTF-8 để Excel đọc đúng tiếng Việt, thoát dấu phẩy / nháy / xuống dòng đúng chuẩn.

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

/** Tải file về máy. format: "xlsx" | "csv". Trả về tên file. */
export async function downloadTable({ format = "xlsx", baseName, headers, rows, sheetName, widths }) {
  const fileName = `${safeFileName(baseName)}_${fileStamp()}.${format}`;
  if (format === "csv") {
    const blob = new Blob([buildCsv(headers, rows)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } else {
    const XLSX = await import("xlsx");
    XLSX.writeFile(buildWorkbook(XLSX, { headers, rows, sheetName, widths }), fileName);
  }
  return fileName;
}

const ROLE_LABEL = { admin: "Quản trị viên", moderator: "Kiểm duyệt viên" };

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
