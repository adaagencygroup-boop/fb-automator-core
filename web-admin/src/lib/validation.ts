/**
 * Validation utilities cho Web Admin
 */

/**
 * Kiểm tra định dạng số điện thoại hợp lệ (SĐT Việt Nam)
 * - Bắt đầu bằng 0 hoặc +84
 * - Tiếp theo là 9 đến 10 chữ số (cho cả di động và máy bàn)
 * - Hỗ trợ các ký tự phân cách thông dụng: khoảng trắng, dấu chấm, dấu gạch ngang, ngoặc đơn
 */
export function isValidPhoneNumber(phone: string): boolean {
  if (!phone || !phone.trim()) return false;
  const cleaned = phone.trim().replace(/[\s.\-()]/g, "");
  const vnPhoneRegex = /^(0|\+84)[235789]\d{8,9}$/;
  return vnPhoneRegex.test(cleaned);
}

export interface PasswordValidationResult {
  isValid: boolean;
  message?: string;
  hasMinLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSpecialChar: boolean;
}

/**
 * Kiểm tra định dạng mật khẩu hợp lệ:
 * - Độ dài: Từ 8 đến 12 ký tự, thống nhất với đăng ký và backend.
 * - Chữ cái viết hoa: Chứa ít nhất 1 chữ cái in hoa (A-Z).
 * - Chữ cái viết thường: Chứa ít nhất 1 chữ cái thường (a-z).
 * - Chữ số: Chứa ít nhất 1 chữ số (0-9).
 * - Ký tự đặc biệt: Chứa ít nhất 1 ký tự đặc biệt (@, #, $, %, *, !,...).
 */
export function validatePassword(password: string): PasswordValidationResult {
  const p = password || "";
  const hasMinLength = p.length >= 8 && p.length <= 12;
  const hasUppercase = /[A-Z]/.test(p);
  const hasLowercase = /[a-z]/.test(p);
  const hasNumber = /[0-9]/.test(p);
  const hasSpecialChar = /[^a-zA-Z0-9]/.test(p);

  const isValid = hasMinLength && hasUppercase && hasLowercase && hasNumber && hasSpecialChar;

  let message = "";
  if (!isValid) {
    const missing: string[] = [];
    if (!hasMinLength) missing.push("từ 8 đến 12 ký tự");
    if (!hasUppercase) missing.push("1 chữ hoa (A-Z)");
    if (!hasLowercase) missing.push("1 chữ thường (a-z)");
    if (!hasNumber) missing.push("1 chữ số (0-9)");
    if (!hasSpecialChar) missing.push("1 ký tự đặc biệt (@, #, $, %, *, !...)");
    message = `Mật khẩu yêu cầu: ${missing.join(", ")}.`;
  }

  return {
    isValid,
    message,
    hasMinLength,
    hasUppercase,
    hasLowercase,
    hasNumber,
    hasSpecialChar,
  };
}

export function isValidPassword(password: string): boolean {
  return validatePassword(password).isValid;
}
