export function tokenExpiryLabel(metadata) {
  if (metadata?.is_valid !== true || typeof metadata.expires_at !== "number") {
    return "Hạn token: chưa được Meta xác nhận";
  }
  const expiry = metadata.expires_at;
  if (expiry === 0) return "Token: không có ngày hết hạn cố định";
  if (expiry <= 0) return "Hạn token: chưa được Meta xác nhận";
  return `Hạn token: ${new Date(expiry * 1000).toLocaleDateString("vi-VN")}`;
}
