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

/** The dashboard counts down to the next enabled module's expiry. */
export function getDashboardLicenseState(user, now = Date.now()) {
  if (!Array.isArray(user?.features)) {
    return { ...getLicenseState(user, now), expiredAt: user?.expired_at ?? null, moduleName: null };
  }

  const modules = user.features
    .filter((feature) => feature.is_enabled && Number.isFinite(Date.parse(feature.expired_at)))
    .sort((a, b) => Date.parse(a.expired_at) - Date.parse(b.expired_at));
  const nextModule = modules.find((feature) => Date.parse(feature.expired_at) > now) ?? modules[0];
  if (!nextModule) return { tone: "inactive", days: null, expiredAt: null, moduleName: null };

  return {
    ...getLicenseState({ modules_unlocked: true, expired_at: nextModule.expired_at }, now),
    expiredAt: nextModule.expired_at,
    moduleName: (nextModule.name || nextModule.key).replace(/^\d+\.\s*/, ""),
  };
}
