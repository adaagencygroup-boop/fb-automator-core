/**
 * date-utils.js
 * Tiện ích xử lý và chuẩn hóa thời gian theo múi giờ Việt Nam (UTC+7 / Asia/Ho_Chi_Minh).
 */

export const VIETNAM_TIMEZONE = "Asia/Ho_Chi_Minh";

export function parseToVietnamDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  const hasTimezone = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(trimmed);
  const normalized = hasTimezone ? trimmed : `${trimmed.replace(" ", "T")}Z`;

  const date = new Date(normalized);
  return isNaN(date.getTime()) ? null : date;
}

export function formatVietnamDateTime(dateStr) {
  const defaultRes = {
    time: "--:--",
    timeWithSeconds: "--:--:--",
    date: "--/--/----",
    full: "--",
  };

  const d = parseToVietnamDate(dateStr);
  if (!d) return defaultRes;

  try {
    const dateFormatted = d.toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: VIETNAM_TIMEZONE,
    });

    const time = d.toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: VIETNAM_TIMEZONE,
    });

    const timeWithSeconds = d.toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: VIETNAM_TIMEZONE,
    });

    return {
      time,
      timeWithSeconds,
      date: dateFormatted,
      full: `${timeWithSeconds} - ${dateFormatted}`,
    };
  } catch {
    return defaultRes;
  }
}

export function formatVietnamTime(dateStr, includeSeconds = true) {
  const formatted = formatVietnamDateTime(dateStr);
  return includeSeconds ? formatted.timeWithSeconds : formatted.time;
}
