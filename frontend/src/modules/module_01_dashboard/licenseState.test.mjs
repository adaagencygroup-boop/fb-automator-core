import { test } from "node:test";
import assert from "node:assert/strict";
import { getLicenseState } from "./licenseState.mjs";

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
