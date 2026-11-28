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

/** Chuẩn hóa chuỗi bỏ dấu tiếng Việt, giữ chữ thường + 1 khoảng trắng. */
export function foldVietnamese(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,/\\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Danh sách đầy đủ 34 đơn vị hành chính cấp tỉnh Việt Nam theo Nghị quyết 202/2025/QH15. */
export const VN_PROVINCES_34 = {
  cities: [
    { value: "Hà Nội", label: "Hà Nội" },
    { value: "TP. Hồ Chí Minh", label: "TP. Hồ Chí Minh" },
    { value: "Đà Nẵng", label: "Đà Nẵng" },
    { value: "Hải Phòng", label: "Hải Phòng" },
    { value: "Cần Thơ", label: "Cần Thơ" },
    { value: "Huế", label: "Huế" },
  ],
  provinces: [
    "An Giang",
    "Bắc Ninh",
    "Cà Mau",
    "Cao Bằng",
    "Đắk Lắk",
    "Điện Biên",
    "Đồng Nai",
    "Đồng Tháp",
    "Gia Lai",
    "Hà Tĩnh",
    "Hưng Yên",
    "Khánh Hòa",
    "Lai Châu",
    "Lâm Đồng",
    "Lạng Sơn",
    "Lào Cai",
    "Nghệ An",
    "Ninh Bình",
    "Phú Thọ",
    "Quảng Ngãi",
    "Quảng Ninh",
    "Quảng Trị",
    "Sơn La",
    "Tây Ninh",
    "Thái Nguyên",
    "Thanh Hóa",
    "Tuyên Quang",
    "Vĩnh Long",
  ].map((name) => ({ value: name, label: name })),
};

const REGION_MATCHERS = {
  "ha noi": /(?:^|[^a-z0-9])(ha\s+noi|hanoi|tp\s+hn)(?:[^a-z0-9]|$)/i,
  hanoi: /(?:^|[^a-z0-9])(ha\s+noi|hanoi|tp\s+hn)(?:[^a-z0-9]|$)/i,
  "ho chi minh": /(?:^|[^a-z0-9])(ho\s+chi\s+minh|hochiminh|sai\s+gon|saigon|(?:tp\s+)?hcm)(?:[^a-z0-9]|$)/i,
  "tp ho chi minh": /(?:^|[^a-z0-9])(ho\s+chi\s+minh|hochiminh|sai\s+gon|saigon|(?:tp\s+)?hcm)(?:[^a-z0-9]|$)/i,
  hcm: /(?:^|[^a-z0-9])(ho\s+chi\s+minh|hochiminh|sai\s+gon|saigon|(?:tp\s+)?hcm)(?:[^a-z0-9]|$)/i,
  "da nang": /(?:^|[^a-z0-9])(da\s+nang|danang)(?:[^a-z0-9]|$)/i,
  danang: /(?:^|[^a-z0-9])(da\s+nang|danang)(?:[^a-z0-9]|$)/i,
  "hai phong": /(?:^|[^a-z0-9])(hai\s+phong|haiphong)(?:[^a-z0-9]|$)/i,
  haiphong: /(?:^|[^a-z0-9])(hai\s+phong|haiphong)(?:[^a-z0-9]|$)/i,
  "can tho": /(?:^|[^a-z0-9])(can\s+tho|cantho)(?:[^a-z0-9]|$)/i,
  cantho: /(?:^|[^a-z0-9])(can\s+tho|cantho)(?:[^a-z0-9]|$)/i,
  hue: /(?:^|[^a-z0-9])hue(?:[^a-z0-9]|$)/i,
  "dak lak": /(?:^|[^a-z0-9])(dak\s+lak|daklak|dac\s+lac|daclac)(?:[^a-z0-9]|$)/i,
  daklak: /(?:^|[^a-z0-9])(dak\s+lak|daklak|dac\s+lac|daclac)(?:[^a-z0-9]|$)/i,
};

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Khớp địa chỉ Page với 34 tỉnh/thành mới hoặc NO_ADDRESS (chỉ khớp đúng tỉnh/thành mới, có ranh giới từ). */
export function matchesRegion(address, region) {
  const reg = String(region || "").trim();
  if (!reg || reg.toUpperCase() === "ALL") return true;
  if (reg.toUpperCase() === "NO_ADDRESS") return !String(address || "").trim();
  const addrFolded = foldVietnamese(address);
  if (!addrFolded) return false;
  const key = foldVietnamese(reg).replace(/^(tp|thanh pho|tinh)\s+/, "").trim();
  if (!key) return true;
  const re = REGION_MATCHERS[key];
  if (re) return re.test(addrFolded);
  const parts = key.split(/\s+/).filter(Boolean).map(escapeRegex);
  if (!parts.length) return true;
  const body = parts.length >= 2 ? `(?:${parts.join("\\s+")}|${parts.join("")})` : parts[0];
  return new RegExp(`(?:^|[^a-z0-9])${body}(?:[^a-z0-9]|$)`, "i").test(addrFolded);
}

/** Khớp bộ lọc tình trạng thông tin liên hệ (HAS_PHONE | HAS_EMAIL | HAS_BOTH | HAS_WEBSITE | NO_CONTACT). */
export function matchesInfoFilter(row, infoFilter) {
  const f = String(infoFilter || "ALL").toUpperCase();
  const hasPhone = Boolean(String(row?.phone || "").trim());
  const hasEmail = Boolean(String(row?.email || "").trim());
  const hasWebsite = Boolean(String(row?.website || "").trim());
  if (f === "HAS_PHONE") return hasPhone;
  if (f === "HAS_EMAIL") return hasEmail;
  if (f === "HAS_BOTH") return hasPhone && hasEmail;
  if (f === "HAS_WEBSITE") return hasWebsite;
  if (f === "NO_CONTACT") return !hasPhone && !hasEmail;
  return true;
}
