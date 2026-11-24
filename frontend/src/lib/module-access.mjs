/** License keys match SYSTEM_DEFAULT_FEATURES in modules/module_auth/schema.py. */
export const NAV_FEATURE_KEYS = Object.freeze({
  accounts: "fb_account",
  interact: "post_interact",
  creator: "create_fanpage",
  pages: "manage_fanpage",
  chat: "chat_fanpage",
  groups: "spam_group",
  seeding: "seeding",
  scan: "scan_group",
  scanner: "scan_page",
  engage: "scan_post",
});

/** Shared by the sidebar and the route guard, including history/placeholder pages. */
export function canAccessNav(user, navId, now = Date.now()) {
  if (!user) return false;
  if (["dashboard", "profile"].includes(navId)) return true;
  if (["banned", "locked", "rejected"].includes(user.status)) return false;
  if (String(user.role).toLowerCase() === "admin") return true;

  const featureKey = NAV_FEATURE_KEYS[String(navId).split(".")[0]];
  if (!featureKey || user.status !== "approved" || user.modules_unlocked === false) return false;
  const accountExpiry = Date.parse(user.expired_at);
  if (!Number.isFinite(accountExpiry) || accountExpiry <= now) return false;

  // Detailed licenses let the UI lock at the exact expiry, even between /me polls.
  if (Array.isArray(user.features)) {
    const feature = user.features.find((item) => item.key === featureKey);
    return Boolean(feature?.is_enabled && feature.is_active && Date.parse(feature.expired_at) > now);
  }
  return Array.isArray(user.permissions) && user.permissions.includes(featureKey);
}

/** A never-purchased or disabled module must not inherit another module's expiry. */
export function getNavLicenseState(user, navId, now = Date.now()) {
  if (canAccessNav(user, navId, now)) return { status: "active", expiredAt: null };
  const featureKey = NAV_FEATURE_KEYS[String(navId).split(".")[0]];
  const inactive = { status: "inactive", expiredAt: null };
  if (!user || !featureKey) return inactive;

  const feature = Array.isArray(user.features) ? user.features.find((item) => item.key === featureKey) : null;
  if (Array.isArray(user.features) ? !feature?.is_enabled : !user.permissions?.includes(featureKey)) return inactive;

  // Both the module term and the account term can end access. Show the one that ended first.
  const expiries = [feature?.expired_at, user.expired_at]
    .filter((value) => value && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return expiries.length ? { status: "expired", expiredAt: expiries[0] } : inactive;
}

/** Next expiry to re-render the shared guard without waiting for a network poll. */
export function nextLicenseExpiry(user, now = Date.now()) {
  const dates = [user?.expired_at, ...(user?.features ?? []).map((feature) => feature.expired_at)]
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value) && value > now);
  return dates.length ? Math.min(...dates) : null;
}
