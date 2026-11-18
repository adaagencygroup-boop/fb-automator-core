export function parseApiDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  try {
    const s = iso.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) return dt;
    const fallback = new Date(iso);
    return isNaN(fallback.getTime()) ? null : fallback;
  } catch {
    return null;
  }
}

/** Format datetime string → "DD/MM/YYYY HH:mm" (theo giờ địa phương/local của máy) */
export function fmtDateTime(iso: string | null): string {
  const d = parseApiDate(iso);
  if (!d) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

/** Format date only → "DD/MM/YYYY" (theo giờ địa phương/local của máy) */
export function fmtDate(iso: string | null | undefined): string {
  const d = parseApiDate(iso);
  if (!d) return "—";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** True if the date is today (local time) */
export function isToday(iso: string | null): boolean {
  const d = parseApiDate(iso);
  if (!d) return false;
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
}

/** Two-letter initials from username */
export function initials(username: string): string {
  return username.slice(0, 2).toUpperCase();
}

/** Parse phone and telegram from contact_info string */
export function parseContactInfo(info?: string) {
  if (!info) return { phone: "", telegram: "" };
  if (info.includes("|")) {
    const parts = info.split("|").map(s => s.trim());
    const phonePart = parts.find(p => !p.startsWith("@")) || "";
    const telePart = parts.find(p => p.startsWith("@")) || "";
    return { phone: phonePart, telegram: telePart };
  }
  if (info.trim().startsWith("@")) {
    return { phone: "", telegram: info.trim() };
  }
  return { phone: info.trim(), telegram: "" };
}
