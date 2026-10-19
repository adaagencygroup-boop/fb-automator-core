const PREFIX = "meta-web-popup:";
export const terminalJob = (status) => ["SUCCEEDED", "FAILED", "CANCELLED"].includes(status);

export function connectionLabel(connection) {
  if (!connection?.connected) return "Kết nối Facebook";
  const prefix = connection.token_state === "expired" ? "Cần kết nối lại" : "Đã kết nối";
  return `${prefix}: ${connection.identity.name}`;
}

export function safeReturnPath(path, origin) {
  try {
    const url = new URL(path || "/pages/list", origin);
    if (url.origin !== origin || !["http:", "https:"].includes(url.protocol)) return "/pages/list";
    return url.pathname + url.search + url.hash;
  } catch { return "/pages/list"; }
}

export function readPopupContext(state, storage) {
  try {
    const value = JSON.parse(storage.getItem(PREFIX + state));
    if (value && typeof value.owner === "string" && typeof value.jobId === "string") return value;
  } catch { /* Context may be unavailable after navigation. Backend still verifies state. */ }
  return null;
}

export function forgetPopupContext(state, storage) {
  try { storage.removeItem(PREFIX + state); } catch { /* Optional browser storage. */ }
}

export function storePopupContext(state, context, storage) {
  try { storage.setItem(PREFIX + state, JSON.stringify(context)); return true; }
  catch { return false; }
}

export function popupAttemptContext(attempt, owner, returnTo, reason = "connect") {
  return { owner: String(owner), jobId: attempt.job_id, mode: "popup", returnTo,
    ...(reason === "switch" ? { reason, authorizationUrl: attempt.authorization_url, previousIdentity: attempt.previous_identity || null } : {}) };
}

export function switchAuthorizationUrl(context, state) {
  try {
    const url = new URL(context?.authorizationUrl);
    if (context.reason !== "switch" || url.origin !== "https://www.facebook.com" ||
      !/^\/(v\d+\.\d+\/)?dialog\/oauth$/.test(url.pathname) || url.searchParams.get("state") !== state) return null;
    return url.href;
  } catch { return null; }
}

export function switchPreparationPath(state) {
  return `/oauth/meta/callback/?switch=1&state=${encodeURIComponent(state)}`;
}

export function announcePopupAttempt(owner) {
  // No token or job data is broadcast; dashboard reads the authoritative owner-bound job.
  try {
    const channel = new BroadcastChannel("meta-web-oauth");
    channel.postMessage({ type: "attempt-started", owner: String(owner) });
    channel.close();
  } catch { /* Returning focus to the dashboard also refreshes the connection. */ }
}

export async function openOAuthPopup(browser, start, owner, reason = "connect") {
  // Must run synchronously in the click handler, before the first await.
  const popup = browser.open("about:blank", `meta-oauth-${Date.now()}`, "popup=yes,width=600,height=760,resizable=yes,scrollbars=yes");
  if (!popup) throw new Error("Trình duyệt đã chặn popup. Hãy cho phép cửa sổ bật lên rồi thử lại.");
  try {
    const attempt = await start(reason);
    const context = popupAttemptContext(attempt, owner, safeReturnPath(browser.location.href, browser.location.origin), reason);
    // Only attempt identifiers are stored, never access tokens or Meta callback fragments.
    let stored = false;
    try { stored = storePopupContext(attempt.state, context, popup.sessionStorage); } catch { /* Storage is optional. */ }
    popup.location.replace(reason === "switch" && stored ? new URL(switchPreparationPath(attempt.state), browser.location.origin).href : attempt.authorization_url);
    return { attempt, popup };
  } catch (error) {
    try { popup.close(); } catch { /* The browser may have detached the popup. */ }
    throw error;
  }
}
