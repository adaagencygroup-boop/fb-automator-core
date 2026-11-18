/**
 * Ghi nhớ tài khoản đã chọn để seeding — riêng cho từng trang (PAGE / POST / PROFILE)
 * và từng người dùng app trên cùng máy. Lần sau mở trang vẫn giữ đúng lựa chọn cũ.
 */
import { getSessionUserId } from "../../services/sessionIdentity.mjs";

const PREFIX = "seeding_selected_uids";

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null; // localStorage bị chặn
  }
}

export function selectionKey(type, userId = getSessionUserId()) {
  return `${PREFIX}:${userId || "anon"}:${String(type || "").toUpperCase()}`;
}

/** Danh sách UID đã lưu, hoặc null nếu chưa từng lưu / không đọc được. */
export function loadSavedUids(type) {
  try {
    const raw = storage()?.getItem(selectionKey(type));
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : null;
  } catch {
    return null;
  }
}

export function saveSelectedUids(type, uids) {
  try {
    storage()?.setItem(selectionKey(type), JSON.stringify((uids || []).map(String)));
  } catch {
    /* Không lưu được thì lần sau dùng mặc định — không chặn seeding */
  }
}

/**
 * Lựa chọn ban đầu khi mở trang.
 * - Chưa từng lưu → mọi tài khoản khả dụng (mặc định cũ).
 * - Đã lưu → chỉ giữ tài khoản còn khả dụng (Live + đã đăng nhập), giữ thứ tự đã chọn.
 */
export function resolveInitialUids(validUids, saved) {
  const valid = (validUids || []).map(String);
  if (!Array.isArray(saved)) {
    return { uids: valid, restored: false, dropped: 0 };
  }
  const validSet = new Set(valid);
  const uids = [...new Set(saved.map(String))].filter((uid) => validSet.has(uid));
  return { uids, restored: true, dropped: new Set(saved.map(String)).size - uids.length };
}
