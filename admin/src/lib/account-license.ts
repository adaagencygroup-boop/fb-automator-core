import type { User } from "./api";

export const ACCOUNT_FEATURE = "fb_account";
const DAY_MS = 86400000;
const FREE_DAYS = 30;

export interface LicenseDraft { key: string; days: number; enabled: boolean; }

// Older profiles serialize a naive PostgreSQL UTC timestamp without a timezone.
const utcTimestamp = (value?: string | null) => value
  ? Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value.replace(" ", "T")}Z`)
  : NaN;

/** Preview the backend rule using exact saved dates for unchanged subscriptions. */
export function withAccountLicense<T extends LicenseDraft>(drafts: T[], user?: User | null, now = Date.now()): T[] {
  const signup = utcTimestamp(user?.created_at);
  let anchor = Number.isFinite(signup) ? signup : now;
  for (const draft of drafts) {
    if (draft.key === ACCOUNT_FEATURE) continue;
    const saved = user?.features?.find((feature) => feature.key === draft.key);
    const unchanged = saved?.is_enabled && draft.days === saved.days_remaining;
    let expiry: number;
    if (!draft.enabled) {
      if (!saved || !(saved.is_enabled || saved.days_granted > 0)) continue;
      expiry = Math.min(utcTimestamp(saved.expired_at), now);
    } else {
      expiry = unchanged ? utcTimestamp(saved.expired_at) : now + Math.max(0, draft.days) * DAY_MS;
    }
    if (Number.isFinite(expiry)) anchor = Math.max(anchor, expiry);
  }
  const days = Math.max(0, Math.ceil((anchor + FREE_DAYS * DAY_MS - now) / DAY_MS));
  return drafts.map((draft) => draft.key === ACCOUNT_FEATURE ? { ...draft, enabled: true, days } : draft);
}

/** Never send the managed field; edits send only changes to paid modules. */
export function featureChanges(drafts: LicenseDraft[], user?: User | null): LicenseDraft[] {
  return drafts.filter((draft) => {
    if (draft.key === ACCOUNT_FEATURE) return false;
    if (!user) return true;
    const saved = user.features?.find((feature) => feature.key === draft.key);
    return saved ? draft.enabled !== saved.is_enabled || draft.days !== saved.days_remaining : draft.enabled;
  }).map(({ key, days, enabled }) => ({ key, days, enabled }));
}
