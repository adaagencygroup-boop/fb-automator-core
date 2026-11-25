const HEADERS = [
  "STT", "Nguồn / Danh mục", "Họ và tên", "UID Facebook", "Link Facebook", "Bạn bè", "Followers", "Số điện thoại", "Tiểu sử",
  "Ngày sinh", "Quê quán", "Nơi ở hiện tại", "Học vấn", "Công việc & Chức danh", "Thời gian quét",
];
const WIDTHS = [6, 32, 26, 20, 42, 10, 11, 24, 44, 14, 18, 20, 30, 36, 20];

export const jobText = (r) => [r.job_title, r.job_place].filter(Boolean).join(" tại ");

/** Xuất .xlsx — UID là ô chữ để Excel không đổi thành số mũ */
export async function exportProfiles(rows, fileName, nameOf = () => "") {
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
  XLSX.writeFile(book, `${fileName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
