// Hàm thuần (không JSX) của Module 11 — test bằng node:test trong frontend/tests.

/**
 * Các nút trang theo thiết kế: 1 2 3 … N (trang hiện tại ở giữa thì 1 … c-1 c c+1 … N).
 * Trả về mảng số trang và chuỗi "…".
 */
export function pageWindow(current, total) {
  const n = Math.max(1, Number(total) || 1);
  const c = Math.min(Math.max(1, Number(current) || 1), n);
  if (n <= 5) return Array.from({ length: n }, (_, i) => i + 1);
  if (c <= 3) return [1, 2, 3, "…", n];
  if (c >= n - 2) return [1, "…", n - 2, n - 1, n];
  return [1, "…", c - 1, c, c + 1, "…", n];
}

/**
 * Lọc TOÀN BỘ kết quả quét (đã gộp theo page_key) theo các bộ lọc trên màn Quét page.
 * Trả về { pool, aboveMin, filtered } — filtered là danh sách đầy đủ (chưa phân trang),
 * dùng chung cho bảng, "Xuất toàn bộ file" và "Lưu danh sách".
 */
export function filterScanResults(merged, opts = {}) {
  const rows = Array.isArray(merged) ? merged : [];
  const {
    minFollowersEnabled = false,
    minFollowers = 0,
    maxFollowers = null,
    resultSearch = "",
    filterKeyword = "ALL",
    sortDir = "desc",
    topN = null,
  } = opts;
  const maxFl = maxFollowers === "" || maxFollowers == null ? null : Number(maxFollowers);
  const inRange = (p) => {
    const fl = Number(p.follower_count) || 0;
    if (fl < (Number(minFollowers) || 0)) return false;
    if (maxFl != null && Number.isFinite(maxFl) && fl > maxFl) return false;
    return true;
  };

  let filtered = minFollowersEnabled ? rows.filter(inRange) : rows;
  const aboveMin = filtered.length;

  const q = String(resultSearch || "").trim().toLowerCase();
  if (q) {
    filtered = filtered.filter((p) =>
      `${p.page_name || ""} ${p.page_url || ""} ${p.phone || ""} ${p.email || ""} ${p.website || ""} ${p.address || ""}`
        .toLowerCase()
        .includes(q),
    );
  }
  if (filterKeyword && filterKeyword !== "ALL") {
    const needle = String(filterKeyword).toLowerCase().replace(/^#/, "");
    filtered = filtered.filter((p) =>
      `${p.source_keyword || ""} ${p.matched_hashtags || ""} ${(p.channels || []).join(" ")}`
        .toLowerCase()
        .includes(needle),
    );
  }
  if (sortDir === "asc") filtered = [...filtered].reverse();

  const limitN = topN === "" || topN == null ? null : Number(topN);
  if (limitN != null && Number.isFinite(limitN) && limitN > 0) filtered = filtered.slice(0, limitN);

  return { pool: rows.length, aboveMin, filtered };
}

/** CSV (UTF-8 BOM do nơi gọi thêm) — mọi ô được bọc nháy kép, nháy kép bên trong được nhân đôi. */
export function toCsv(headers, rows) {
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\n");
}

/**
 * Ngày YYYY-MM-DD theo giờ MÁY NGƯỜI DÙNG (toISOString() là ngày UTC → trước 7h sáng ở VN bị lùi 1 ngày).
 */
export function localIsoDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Trường JSON lưu dạng chuỗi trong DB (settings, logs) → object/array an toàn. */
export function parseJsonField(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}
