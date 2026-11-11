/**
 * Kiểm tra từng dòng trong danh sách Fanpage dán vào module Tạo Page.
 *
 * Tách khỏi index.jsx để test được bằng node:test — index.jsx là component
 * 2000 dòng, không import được vào test runner. Cùng cách module 02 làm với
 * utils/account-pages.mjs.
 *
 * Dữ liệu vào là một dòng đã cắt theo ký tự phân cách:
 *   { page_name, phone, email, address }
 */

/** Facebook giới hạn tên Page 75 ký tự */
export const PAGE_NAME_MAX = 75;

/** Giới hạn địa chỉ theo yêu cầu nghiệp vụ */
export const ADDRESS_MAX = 60;

/** Số điện thoại Việt Nam: đúng 10 chữ số (đã bỏ ký tự phân cách) */
export const PHONE_DIGITS = 10;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Bỏ các ký tự người dùng hay chen vào số điện thoại khi dán từ Excel:
 * khoảng trắng, dấu chấm, gạch ngang, ngoặc đơn.
 *
 * KHÔNG bỏ dấu `+`: nếu còn `+` thì sau khi đếm sẽ lệch 10 chữ số và báo lỗi
 * — đúng ý, vì mã quốc gia đã có ô chọn riêng, không nhập kèm vào đây.
 */
export function normalizePhone(value) {
  return String(value || "").replace(/[\s.\-()]/g, "");
}

/**
 * Danh sách lỗi của một dòng. Mảng rỗng = dòng hợp lệ.
 *
 * Mỗi trường báo tối đa MỘT lỗi: thiếu thì không xét tiếp định dạng, vì hiện
 * "Thiếu SĐT" kèm "SĐT phải đúng 10 chữ số" là nhiễu chứ không thêm thông tin.
 */
export function rowIssues(page) {
  const issues = [];

  const name = String(page?.page_name || "").trim();
  if (!name) issues.push("Thiếu tên page");
  else if (name.length > PAGE_NAME_MAX) issues.push(`Tên page quá ${PAGE_NAME_MAX} ký tự`);

  const phone = normalizePhone(page?.phone);
  if (!phone) issues.push("Thiếu SĐT");
  else if (!new RegExp(`^\\d{${PHONE_DIGITS}}$`).test(phone)) {
    issues.push(`SĐT phải đúng ${PHONE_DIGITS} chữ số`);
  }

  const email = String(page?.email || "").trim();
  if (!email) issues.push("Thiếu email");
  else if (!EMAIL_RE.test(email)) issues.push("Sai email");

  const address = String(page?.address || "").trim();
  if (!address) issues.push("Thiếu địa chỉ");
  else if (address.length > ADDRESS_MAX) issues.push(`Địa chỉ quá ${ADDRESS_MAX} ký tự`);

  return issues;
}

/**
 * Đoán ký tự phân cách của một dòng (dùng khi nạp tệp).
 * Dấu phẩy xét cuối vì địa chỉ hay chứa dấu phẩy.
 */
export function guessDelimiter(line) {
  return ["|", "\t", ";", ","].find((item) => line.includes(item)) || null;
}

/** forced: ký tự phân cách người dùng chọn; bỏ trống thì tự đoán (dùng khi nạp tệp) */
export function splitLine(line, forced) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) return null;
  const delimiter = forced || guessDelimiter(trimmed);
  const parts = delimiter ? trimmed.split(delimiter).map((part) => part.trim()) : [trimmed];
  return {
    page_name: parts[0] || "",
    phone: parts[1] || "",
    email: parts[2] || "",
    address: parts[3] || "",
  };
}

/**
 * Soi từng dòng của cả khối text, GIỮ chỉ số dòng gốc.
 *
 * Cần chỉ số gốc để bôi vàng đúng dòng trong textarea: `parsePageLines` bỏ
 * dòng trống và dòng không có tên page, nên chỉ số của nó không còn khớp với
 * dòng người dùng đang nhìn.
 *
 * `page = null` nghĩa là dòng đó không tạo ra page nào (trống, hoặc thiếu tên
 * page). Những dòng đó KHÔNG bị tính lỗi, để bảng đối soát và vệt vàng trên
 * textarea luôn nói cùng một chuyện.
 */
export function annotateLines(text, delimiter) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((raw, index) => {
      const page = splitLine(raw, delimiter);
      if (!page || !page.page_name) return { index, raw, page: null, issues: [] };
      return { index, raw, page, issues: rowIssues(page) };
    });
}
