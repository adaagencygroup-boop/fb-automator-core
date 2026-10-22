export function farmingDays(firstLoginAt, now = Date.now()) {
  if (!firstLoginAt || typeof firstLoginAt !== "string") return null;
  const value = firstLoginAt.trim();
  if (!value) return null;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const start = Date.parse(normalized);
  return Number.isFinite(start) && Number.isFinite(now) ? Math.max(0, Math.floor((now - start) / 86400000)) : null;
}
