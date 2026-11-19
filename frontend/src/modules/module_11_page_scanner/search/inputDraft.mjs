/**
 * Nháp ô nhập của "Quét thông tin page": tab nguồn đang chọn, link đã dán (Nhập link),
 * file đã tải + kết quả kiểm tra của server (Tải tệp).
 *
 * Giữ trong BỘ NHỚ của app (biến cấp module), không dùng localStorage: chuyển sang màn khác
 * rồi quay lại vẫn còn (điều hướng client-side không nạp lại JS); tải lại trang / đóng app thì mất.
 * Giữ được cả đối tượng File gốc nên lúc bấm "Bắt đầu" không phải chọn lại file.
 * Tách theo tài khoản đăng nhập — đổi tài khoản không thấy nháp của người khác.
 */

const drafts = new Map();

const keyOf = (userId) => (userId == null ? "" : String(userId).trim());

/** Nháp đã lưu của tài khoản (bản sao nông) hoặc null. */
export function loadInputDraft(userId) {
  const key = keyOf(userId);
  if (!key || !drafts.has(key)) return null;
  return { ...drafts.get(key) };
}

/** Ghi đè nháp của tài khoản. Chưa biết tài khoản → bỏ qua. */
export function saveInputDraft(userId, draft) {
  const key = keyOf(userId);
  if (!key) return;
  if (!draft) {
    drafts.delete(key);
    return;
  }
  drafts.set(key, { ...draft });
}
