export const EXPIRING_SOON_DAYS = 7;

export function getLicenseState(user, now = Date.now()) {
  if (!user) return { tone: "loading", days: null };
  const expiry = user.expired_at ? new Date(user.expired_at).getTime() : NaN;
  const hasExpiry = Number.isFinite(expiry);
  const days = hasExpiry ? Math.max(0, Math.ceil((expiry - now) / 86400000)) : null;
  if (user.status === "expired" || (hasExpiry && expiry <= now)) return { tone: "expired", days: 0 };
  if (hasExpiry && days <= EXPIRING_SOON_DAYS && user.modules_unlocked) return { tone: "warning", days };
  return { tone: user.modules_unlocked ? "active" : "inactive", days };
}
