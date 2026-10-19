export const TOKEN_CACHE_TTL_MS = 15 * 60 * 1000;
export const tokenCacheKey = (owner) => `fb_token_verify_cache_v1:${owner}`;
export function tokenStorage() {
  try { return window.localStorage; }
  catch { return { getItem: () => null, setItem: () => {} }; }
}

export function readTokenCache(storage, owner) {
  try {
    const data = JSON.parse(storage.getItem(tokenCacheKey(owner)) || "{}");
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}

export function cachedTokenStatuses(storage, owner, now = Date.now()) {
  return Object.fromEntries(Object.entries(readTokenCache(storage, owner)).filter(([, item]) =>
    item && ["LIVE", "EXPIRED", "NONE", "RATE_LIMITED", "ERROR"].includes(item.status) &&
    Number.isFinite(item.timestamp) && now >= item.timestamp && now - item.timestamp < TOKEN_CACHE_TTL_MS
  ).map(([uid, item]) => [uid, item.status]));
}
