import { test } from "node:test";
import assert from "node:assert/strict";
import { getDashboardLicenseState, getLicenseState } from "./licenseState.mjs";

const now = Date.parse("2026-10-14T03:00:00Z");
test("warns for five remaining days without deactivating the license", () => {
  assert.deepEqual(getLicenseState({ status: "approved", modules_unlocked: true, expired_at: "2026-10-19T03:00:00Z" }, now), { tone: "warning", days: 5 });
});
test("time reaching expiry overrides stale approved status", () => {
  assert.deepEqual(getLicenseState({ status: "approved", modules_unlocked: true, expired_at: "2026-10-14T03:00:00Z" }, now), { tone: "expired", days: 0 });
});
test("expired licenses do not display a negative day count", () => {
  assert.deepEqual(getLicenseState({ status: "expired", modules_unlocked: false, expired_at: "2026-10-01T03:00:00Z" }, now), { tone: "expired", days: 0 });
});
test("longer and unlimited licenses keep their normal appearance", () => {
  assert.deepEqual(getLicenseState({ status: "approved", modules_unlocked: true, expired_at: "2026-10-24T03:00:00Z" }, now), { tone: "active", days: 10 });
  assert.deepEqual(getLicenseState({ status: "approved", modules_unlocked: true, expired_at: null }, now), { tone: "active", days: null });
});

const moduleLicense = (key, name, expired_at, extra = {}) => ({ key, name, expired_at, is_enabled: true, is_active: true, ...extra });
const account = (features) => ({ status: "approved", modules_unlocked: true, expired_at: "2027-02-11T03:00:00Z", features });

test("dashboard uses the earliest module expiry instead of the account term or API order", () => {
  const user = account([
    moduleLicense("fb_account", "1. Quản lý tài khoản Facebook", "2027-02-11T03:00:00Z"),
    moduleLicense("create_fanpage", "3. Tạo Fanpage hàng loạt", "2027-01-12T03:00:00Z"),
    moduleLicense("chat_fanpage", "5. Quản lý Chat Page", "2026-10-24T03:00:00Z", { days_remaining: 99 }),
  ]);
  const originalOrder = user.features.map((feature) => feature.key);
  assert.deepEqual(getDashboardLicenseState(user, now), {
    tone: "active", days: 10, expiredAt: "2026-10-24T03:00:00Z", moduleName: "Quản lý Chat Page",
  });
  assert.deepEqual(user.features.map((feature) => feature.key), originalOrder);
  assert.equal(getLicenseState(user, now).days, 120);
});

test("dashboard ignores disabled, unpurchased and invalid module terms", () => {
  const state = getDashboardLicenseState(account([
    moduleLicense("disabled", "Disabled", "2026-10-15T03:00:00Z", { is_enabled: false }),
    moduleLicense("unpurchased", "Unpurchased", null, { is_enabled: false }),
    moduleLicense("invalid", "Invalid", "invalid"),
    moduleLicense("create_fanpage", "3. Tạo Fanpage hàng loạt", "2026-10-19T03:00:00Z"),
  ]), now);
  assert.equal(state.days, 5);
  assert.equal(state.tone, "warning");
  assert.equal(state.moduleName, "Tạo Fanpage hàng loạt");
});

test("an expired module does not hide the next running module's countdown", () => {
  const state = getDashboardLicenseState(account([
    moduleLicense("expired", "Expired", "2026-10-01T03:00:00Z"),
    moduleLicense("ending", "Ending", "2026-10-14T03:00:00Z"),
    moduleLicense("chat_fanpage", "Chat Page", "2026-10-14T04:00:00Z"),
  ]), now);
  assert.equal(state.moduleName, "Chat Page");
  assert.equal(state.days, 1);
  assert.equal(state.tone, "warning");
});

test("all expired modules display expiry without a negative day count", () => {
  const state = getDashboardLicenseState(account([
    moduleLicense("chat_fanpage", "Chat Page", "2026-10-01T03:00:00Z", { is_active: false }),
  ]), now);
  assert.equal(state.tone, "expired");
  assert.equal(state.days, 0);
  assert.equal(state.moduleName, "Chat Page");
});

test("no enabled modules does not show the account's longer term", () => {
  for (const features of [[], [moduleLicense("chat_fanpage", "Chat Page", "2026-10-24T03:00:00Z", { is_enabled: false })]]) {
    assert.deepEqual(getDashboardLicenseState(account(features), now), {
      tone: "inactive", days: null, expiredAt: null, moduleName: null,
    });
  }
});

test("legacy payloads and loading keep the account fallback", () => {
  assert.deepEqual(getDashboardLicenseState(null, now), {
    tone: "loading", days: null, expiredAt: null, moduleName: null,
  });
  assert.equal(getDashboardLicenseState(account(undefined), now).days, 120);
});
