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
