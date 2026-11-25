// Ô nhập số nguyên dương (số nhóm, delay, số thành viên…): chặn dấu thập phân "," ".", dấu "-", "e".
// Dùng input type="text" + inputMode="numeric" vì input type="number" của trình duyệt vẫn cho gõ "1,5" / "1e3".

/** Chỉ giữ chữ số 0-9 (gõ hoặc dán "110,5" → "1105" bị chặn từ phím, dán thì lấy phần nguyên "110"). */
export function digitsOnly(text) {
  const s = String(text ?? "");
  const intPart = s.split(/[.,]/)[0]; // dán "110,5" / "2.5" → lấy phần nguyên
  return intPart.replace(/\D/g, "");
}

/** Chặn phím không phải chữ số (vẫn cho phím điều hướng, xoá, Ctrl/Cmd + phím tắt). */
export function blockNonDigitKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key.length === 1 && !/[0-9]/.test(event.key)) event.preventDefault();
}

/** Số nguyên an toàn để gửi lên Engine (nháp cũ có thể còn 110.5). */
export function toInt(value, fallback = 0) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

/** Props chung cho ô số nguyên. */
export const INT_INPUT_PROPS = { type: "text", inputMode: "numeric", pattern: "[0-9]*", autoComplete: "off" };
