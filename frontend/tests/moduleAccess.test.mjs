import { test } from "node:test";
import assert from "node:assert/strict";
import { canAccessNav, getNavLicenseState, nextLicenseExpiry, NAV_FEATURE_KEYS } from "../src/lib/module-access.mjs";

const now = Date.parse("2026-11-16T08:00:00Z");
const later = "2026-12-16T08:00:00Z";
const user = { role: "user", status: "approved", modules_unlocked: true, expired_at: later, permissions: [] };
const license = (key, changes = {}) => ({ key, is_enabled: true, is_active: true, expired_at: later, ...changes });

test("an approved account with no module subscriptions keeps every business module locked", () => {
  for (const navId of Object.keys(NAV_FEATURE_KEYS)) {
    assert.equal(canAccessNav(user, navId, now), false, navId);
    assert.equal(canAccessNav({ ...user, features: [] }, `${navId}.history`, now), false, navId);
  }
  assert.equal(canAccessNav(user, "dashboard", now), true);
  assert.equal(canAccessNav(user, "profile", now), true);
});

test("one subscription unlocks only its own group and all its child routes", () => {
  const subscriber = { ...user, features: [license("create_fanpage")] };
  for (const route of ["creator", "creator.create", "creator.history"]) {
    assert.equal(canAccessNav(subscriber, route, now), true, route);
  }
  for (const route of ["accounts", "pages.list", "scan.posts", "scanner.posts", "groups.post", "seeding.history"]) {
    assert.equal(canAccessNav(subscriber, route, now), false, route);
  }
});

test("scan group and page subscriptions are independent and use their backend keys", () => {
  const subscriber = { ...user, permissions: ["scan_group"] };
  assert.equal(canAccessNav(subscriber, "scan.posts", now), true);
  assert.equal(canAccessNav(subscriber, "scanner.posts", now), false);
  assert.equal(canAccessNav({ ...subscriber, permissions: ["scan_page"] }, "scanner.posts", now), true);
});

test("disabled, inactive, missing and expired licenses override a stale permissions list", () => {
  for (const features of [[], [license("spam_group", { is_enabled: false })],
    [license("spam_group", { is_active: false })], [license("spam_group", { expired_at: new Date(now).toISOString() })],
    [license("spam_group", { expired_at: "invalid" })], [license("spam_group", { expired_at: null })]]) {
    assert.equal(canAccessNav({ ...user, permissions: ["spam_group"], features }, "groups.post", now), false);
  }
});

test("a feature locks at the exact expiry without waiting for another profile response", () => {
  const expiry = "2026-11-16T08:00:01Z";
  const subscriber = { ...user, features: [license("fb_account", { expired_at: expiry })] };
  assert.equal(canAccessNav(subscriber, "accounts", now), true);
  assert.equal(canAccessNav(subscriber, "accounts", now + 1000), false);
  assert.equal(nextLicenseExpiry(subscriber, now), now + 1000);
  assert.equal(nextLicenseExpiry(subscriber, now + 1000), Date.parse(later));
  assert.equal(nextLicenseExpiry(subscriber, Date.parse(later)), null);
});

test("account expiry and status take precedence over enabled features", () => {
  const subscriber = { ...user, features: [license("fb_account")] };
  for (const status of ["pending", "banned", "locked", "rejected", "expired"]) {
    assert.equal(canAccessNav({ ...subscriber, status }, "accounts", now), false);
  }
  for (const expired_at of [null, "bad-date", new Date(now).toISOString()]) {
    assert.equal(canAccessNav({ ...subscriber, expired_at }, "accounts", now), false);
  }
  assert.equal(canAccessNav({ ...subscriber, modules_unlocked: false }, "accounts", now), false);
});

test("admins retain access and missing permission data never unlocks a regular user", () => {
  for (const role of ["admin", "ADMIN"]) {
    assert.equal(canAccessNav({ role, status: "approved" }, "groups.post", now), true);
    assert.equal(canAccessNav({ role, status: "banned" }, "groups.post", now), false);
  }
  assert.equal(canAccessNav({ ...user, permissions: undefined }, "accounts", now), false);
  assert.equal(canAccessNav(null, "accounts", now), false);
  assert.equal(canAccessNav(user, "unknown", now), false);
});

test("expired and never-activated modules have separate states on the same account", () => {
  const expiredAt = "2026-11-15T08:00:00Z";
  const subscriber = { ...user, features: [license("scan_group", { is_active: false, expired_at: expiredAt }), license("fb_account")] };
  assert.deepEqual(getNavLicenseState(subscriber, "scan.posts", now), { status: "expired", expiredAt });
  assert.deepEqual(getNavLicenseState(subscriber, "scan.history", now), { status: "expired", expiredAt });
  assert.deepEqual(getNavLicenseState(subscriber, "scanner.posts", now), { status: "inactive", expiredAt: null });
  assert.deepEqual(getNavLicenseState(subscriber, "accounts", now), { status: "active", expiredAt: null });
});

test("disabled default licenses with a past date are not presented as expired purchases", () => {
  const expired_at = "2026-11-15T08:00:00Z";
  const subscriber = { ...user, status: "expired", expired_at, features: [license("scan_group", { is_enabled: false, is_active: false, days_granted: 0, expired_at })] };
  assert.deepEqual(getNavLicenseState(subscriber, "scan.info", now), { status: "inactive", expiredAt: null });
  assert.deepEqual(getNavLicenseState({ ...subscriber, features: [] }, "scan.info", now), { status: "inactive", expiredAt: null });
});

test("module expiry is used instead of another module's or the later account expiry", () => {
  const expiredAt = new Date(now).toISOString();
  const subscriber = { ...user, features: [license("scan_group", { expired_at: expiredAt }), license("fb_account", { expired_at: "2026-11-01T00:00:00Z" })] };
  assert.deepEqual(getNavLicenseState(subscriber, "scan.info", now - 1), { status: "active", expiredAt: null });
  assert.deepEqual(getNavLicenseState(subscriber, "scan.info", now), { status: "expired", expiredAt });
});

test("an earlier account expiry applies only to modules that were subscribed", () => {
  const expiredAt = "2026-11-15T08:00:00Z";
  const subscriber = { ...user, status: "expired", expired_at: expiredAt, features: [license("create_fanpage")] };
  assert.deepEqual(getNavLicenseState(subscriber, "creator.history", now), { status: "expired", expiredAt });
  assert.deepEqual(getNavLicenseState(subscriber, "scan.info", now), { status: "inactive", expiredAt: null });
  assert.deepEqual(getNavLicenseState({ ...subscriber, features: undefined, permissions: ["create_fanpage"] }, "creator.history", now), { status: "expired", expiredAt });
});
