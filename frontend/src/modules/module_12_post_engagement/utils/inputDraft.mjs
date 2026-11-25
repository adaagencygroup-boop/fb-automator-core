/**
 * Nháp cấu hình của "Quét thông tin nhóm": tài khoản đã chọn, phương thức, từ khóa + hạn mức + kết quả
 * Kiểm tra, link đã dán, tệp đã tải, khoảng nghỉ và bộ lọc thành viên.
 *
 * Giữ trong BỘ NHỚ của app (biến cấp module), không dùng localStorage: chuyển sang màn khác rồi quay lại
 * vẫn còn nguyên (điều hướng trong app không nạp lại JS); tải lại trang / đóng app thì mất.
 * Tách theo tài khoản đăng nhập — đổi tài khoản không thấy nháp của người khác.
 */

const drafts = new Map();

const keyOf = (userId) => (userId == null ? "" : String(userId).trim());

// Sao chép sâu: sửa dữ liệu đã đọc ra không làm hỏng nháp đang giữ (và ngược lại).
const copy = (value) => {
  try {
    return structuredClone(value);
  } catch {
    return { ...value };
  }
};

/** Nháp đã lưu của tài khoản (bản sao) hoặc null. */
export function loadInputDraft(userId) {
  const key = keyOf(userId);
  if (!key || !drafts.has(key)) return null;
  return copy(drafts.get(key));
}

/** Ghi đè nháp của tài khoản. Chưa biết tài khoản → bỏ qua. */
export function saveInputDraft(userId, draft) {
  const key = keyOf(userId);
  if (!key) return;
  if (!draft) {
    drafts.delete(key);
    return;
  }
  drafts.set(key, copy(draft));
}
