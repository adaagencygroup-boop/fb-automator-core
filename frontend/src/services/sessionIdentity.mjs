const KEY = "fb-automator.user-session-id";
let currentId = null;

export function getSessionUserId() {
  if (typeof window !== "undefined") {
    try { return window.sessionStorage.getItem(KEY) || currentId; } catch { /* Use the in-memory binding. */ }
  }
  return currentId;
}

export function clearSessionUserId() {
  currentId = null;
  if (typeof window !== "undefined") {
    try { window.sessionStorage.removeItem(KEY); } catch { /* Browser storage may be unavailable. */ }
  }
}

export function acceptSessionUser(user) {
  const id = String(user?.id ?? "");
  const expected = getSessionUserId();
  if (!id || (expected && expected !== id)) {
    const error = new Error("Danh tính phiên đăng nhập đã thay đổi. Vui lòng đăng nhập lại tài khoản của bạn.");
    error.status = 401;
    error.code = "SESSION_IDENTITY_CHANGED";
    throw error;
  }
  currentId = id;
  if (typeof window !== "undefined") {
    try { window.sessionStorage.setItem(KEY, id); } catch { /* Keep the in-memory binding. */ }
  }
  return user;
}
