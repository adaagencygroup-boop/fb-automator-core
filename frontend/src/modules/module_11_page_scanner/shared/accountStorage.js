/**
 * Quản lý lưu trữ và khôi phục tài khoản đã chọn cho Module 11 (Page Scanner).
 * - Ghi nhớ riêng theo từng tính năng: 'search' (Quét thông tin page), 'followers', 'posts'.
 * - Gắn theo user đăng nhập (getSessionUserId).
 * - Khi khôi phục: Tự động lọc bỏ các tài khoản không còn khả dụng (chỉ giữ lại tài khoản Live & Đã đăng nhập).
 */
import { getSessionUserId } from "@/services/sessionIdentity.mjs";
import { isAccountUsable } from "./SelectPagesModal";

const PREFIX = "page_scanner_selected_uids";

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function selectionStorageKey(feature, userId = getSessionUserId()) {
  return `${PREFIX}:${userId || "anon"}:${String(feature || "").toLowerCase()}`;
}

/** Tải danh sách UID đã lưu cho tính năng, trả về mảng chuỗi hoặc null */
export function loadSavedAccountUids(feature) {
  try {
    const raw = storage()?.getItem(selectionStorageKey(feature));
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : null;
  } catch {
    return null;
  }
}

/** Lưu danh sách UID đã chọn cho tính năng */
export function saveSelectedAccountUids(feature, uids) {
  try {
    storage()?.setItem(
      selectionStorageKey(feature),
      JSON.stringify((uids || []).map(String).filter(Boolean))
    );
  } catch {
    /* localStorage bị chặn hoặc đầy — bỏ qua */
  }
}

/**
 * Lọc danh sách UID đã lưu để chỉ giữ lại các tài khoản còn khả dụng (Live & Đã đăng nhập).
 * Giữ nguyên thứ tự đã chọn của người dùng.
 */
export function resolveUsableSavedUids(savedUids, accounts) {
  if (!Array.isArray(savedUids) || !savedUids.length) return [];
  if (!Array.isArray(accounts) || !accounts.length) return [];

  const usableMap = new Map();
  accounts.forEach((acc) => {
    if (acc && isAccountUsable(acc)) {
      usableMap.set(String(acc.uid), acc);
    }
  });

  const validUids = [];
  const seen = new Set();
  for (const rawUid of savedUids) {
    const uid = String(rawUid);
    if (usableMap.has(uid) && !seen.has(uid)) {
      validUids.push(uid);
      seen.add(uid);
    }
  }
  return validUids;
}
