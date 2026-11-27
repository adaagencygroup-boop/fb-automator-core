import { pickSaveTarget, writeSaveTarget } from "@/modules/module_11_page_scanner/shared/saveFile.mjs";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const HEADERS = [
  "STT", "Nguồn / Danh mục", "Họ và tên", "UID Facebook", "Link Facebook", "Bạn bè", "Followers", "Số điện thoại", "Tiểu sử",
  "Ngày sinh", "Quê quán", "Nơi ở hiện tại", "Học vấn", "Công việc & Chức danh", "Thời gian quét",
];
const WIDTHS = [6, 32, 26, 20, 42, 10, 11, 24, 44, 14, 18, 20, 30, 36, 20];

export const jobText = (r) => [r.job_title, r.job_place].filter(Boolean).join(" tại ");

/**
 * Xuất .xlsx — UID là ô chữ để Excel không đổi thành số mũ.
 * Mở hộp thoại "Lưu thành" để chọn thư mục + tên tệp (Chrome / Edge và app Windows — WebView2) NGAY khi bấm,
 * rồi mới tải dữ liệu / dựng file — tránh mất quyền mở hộp thoại khi dữ liệu tải lâu (vd "Xuất toàn bộ").
 * input: mảng profile hoặc hàm async trả mảng (tải sau khi đã chọn nơi lưu).
 * Trả { status: "saved" | "cancelled" | "downloaded" | "empty", fileName, count }.
 */
export async function exportProfiles(input, fileName, nameOf = () => "") {
  const target = await pickSaveTarget({
    suggestedName: `${fileName}_${new Date().toISOString().slice(0, 10)}.xlsx`,
    types: [{ description: "Tệp Excel", accept: { [XLSX_MIME]: [".xlsx"] } }],
  });
  if (target.cancelled) return { status: "cancelled", fileName: target.fileName, count: 0 };
  const rows = typeof input === "function" ? await input() : input;
  if (!rows?.length) {
    await target.handle?.remove?.().catch(() => {}); // bỏ tệp rỗng vừa tạo (nếu trình duyệt hỗ trợ)
    return { status: "empty", fileName: target.fileName, count: 0 };
  }
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet([
    HEADERS,
    ...rows.map((r, i) => [
      i + 1, nameOf(r), r.name || "", String(r.uid), r.url || "", r.friends ?? "-", r.followers ?? "-", r.phone || "", r.bio || "",
      r.birthday || "", r.hometown || "", r.location || "", r.education || "", jobText(r), r.scraped_at || "",
    ]),
  ]);
  sheet["!cols"] = WIDTHS.map((wch) => ({ wch }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Profile");
  const data = XLSX.write(book, { bookType: "xlsx", type: "array" });
  return { ...(await writeSaveTarget(target, new Blob([data], { type: XLSX_MIME }))), count: rows.length };
}

/** Thông báo sau khi xuất: chỉ khẳng định "đã lưu" khi người dùng thực sự bấm Lưu */
export function exportMessage(result, count = result?.count) {
  const n = Number(count || 0).toLocaleString("vi-VN");
  if (result?.status === "cancelled") return { type: "info", text: "Đã hủy xuất file." };
  if (result?.status === "empty") return { type: "warning", text: "Chưa có profile để xuất." };
  if (result?.status === "saved") return { type: "success", text: `Đã lưu ${n} profile vào ${result.fileName}.` };
  return { type: "success", text: `Đã tải ${n} profile xuống: ${result?.fileName || ""} (thư mục Tải xuống).` };
}
