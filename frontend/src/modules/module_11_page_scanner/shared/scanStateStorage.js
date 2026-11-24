/**
 * Giữ lại phiên quét gần nhất của từng trang Module 11 ('search' | 'followers' | 'posts') theo user đăng nhập.
 * Giống Module 3: thoát ra vào lại vẫn còn kết quả cho tới khi bấm "Quét mới" hoặc chạy phiên khác.
 * Chỉ lưu mã phiên + cấu hình; trạng thái, log và kết quả luôn tải lại từ server.
 */
import { getSessionUserId } from "@/services/sessionIdentity.mjs";
import { getScanSessionDetail } from "../service";

const PREFIX = "page_scanner_last_scan";

const keyOf = (feature) => `${PREFIX}:${getSessionUserId() || "anon"}:${feature}`;

export function loadScanState(feature) {
  try {
    const parsed = JSON.parse(localStorage.getItem(keyOf(feature)) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Gộp patch vào trạng thái đã lưu. */
export function saveScanState(feature, patch) {
  const next = { ...loadScanState(feature), ...patch };
  try {
    localStorage.setItem(keyOf(feature), JSON.stringify(next));
  } catch {
    // Đầy bộ nhớ: bỏ bản xem trước tệp (phần nặng nhất), vẫn giữ mã phiên
    try {
      localStorage.setItem(keyOf(feature), JSON.stringify({ ...next, upload: null }));
    } catch {
      /* localStorage bị chặn — bỏ qua */
    }
  }
}

export function clearScanState(feature) {
  try {
    localStorage.removeItem(keyOf(feature));
  } catch {
    /* bỏ qua */
  }
}

/** Chi tiết các phiên đã lưu (cũ → mới). Phiên đã bị xóa thì bỏ qua; lỗi mạng không làm mất trạng thái lưu. */
export async function fetchSavedSessions(feature, sessionIds) {
  const ids = (sessionIds || []).filter(Boolean);
  if (!ids.length) return [];
  const results = await Promise.allSettled(ids.map((id) => getScanSessionDetail(id)));
  const sessions = results.filter((r) => r.status === "fulfilled" && r.value?.id).map((r) => r.value);
  if (!sessions.length && results.every((r) => r.reason?.status === 404)) clearScanState(feature);
  return sessions.sort((a, b) => a.id - b.id);
}
