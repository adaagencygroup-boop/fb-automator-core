/**
 * Kênh hỗ trợ hiển thị ở màn "Tài khoản đang chờ duyệt" / "Tài khoản bị khóa".
 * Đổi bằng biến môi trường (file .env.local) — không cần sửa code:
 *   NEXT_PUBLIC_SUPPORT_ZALO=0988888247
 *   NEXT_PUBLIC_SUPPORT_ZALO_QR=/images/support_zalo_qr.png      (ảnh QR thật, đặt trong public/)
 *   NEXT_PUBLIC_SUPPORT_TELEGRAM=admin_support                  (không có @)
 *   NEXT_PUBLIC_SUPPORT_TELEGRAM_QR=/images/support_telegram_qr.png
 * Chưa có ảnh QR -> dùng ảnh giữ chỗ của placehold.co.
 */

const zaloPhone = (process.env.NEXT_PUBLIC_SUPPORT_ZALO || "0988888247").replace(/\D/g, "");
const telegramHandle = (process.env.NEXT_PUBLIC_SUPPORT_TELEGRAM || "admin_support").replace(/^@/, "");

/** Ảnh QR giữ chỗ (placehold.co), 224px để nét ở khung 112px */
const qrPlaceholder = (text, bg, fg) =>
  `https://placehold.co/224x224/${bg}/${fg}/png?text=${encodeURIComponent(text)}&font=roboto`;

/** "0988888247" -> "0988.888.247" */
const formatPhone = (p) => (p.length === 10 ? `${p.slice(0, 4)}.${p.slice(4, 7)}.${p.slice(7)}` : p);

export const SUPPORT = {
  zalo: {
    phone: zaloPhone,
    display: formatPhone(zaloPhone),
    url: `https://zalo.me/${zaloPhone}`,
    qrImage: process.env.NEXT_PUBLIC_SUPPORT_ZALO_QR || qrPlaceholder("QR Zalo", "EFF6FF", "1E40AF"),
  },
  telegram: {
    handle: telegramHandle,
    display: `@${telegramHandle}`,
    url: `https://t.me/${telegramHandle}`,
    qrImage: process.env.NEXT_PUBLIC_SUPPORT_TELEGRAM_QR || qrPlaceholder("QR Telegram", "ECFEFF", "0891B2"),
  },
};
