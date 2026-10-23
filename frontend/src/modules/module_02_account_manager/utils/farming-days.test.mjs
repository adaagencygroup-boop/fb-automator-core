import test from "node:test";
import assert from "node:assert/strict";
import { farmingDays } from "./farming-days.mjs";
import { mergeAccountRows, publicChanges } from "./account-realtime.mjs";

test("farming days counts completed 24-hour periods, including timezone offsets", () => {
  const start = Date.parse("2026-10-01T10:00:00Z");
  assert.equal(farmingDays("2026-10-01T10:00:00Z", start + 86399999), 0);
  assert.equal(farmingDays("2026-10-01T10:00:00Z", start + 86400000), 1);
  assert.equal(farmingDays("2026-10-01T17:00:00+07:00", start + 3 * 86400000), 3);
  assert.equal(farmingDays("2026-10-01 10:00:00", start + 86400000), 1);
  assert.equal(farmingDays("2026-10-01T10:00:00Z", start - 1000), 0);
});

test("missing and invalid farming dates remain unknown", () => {
  for (const value of [null, undefined, "", " ", "invalid", 123]) assert.equal(farmingDays(value), null);
  assert.equal(farmingDays("2026-10-01T10:00:00Z", NaN), null);
});

test("login realtime patches update the farming start without exposing credentials", () => {
  const changes = publicChanges({ first_login_at: "2026-10-01T10:00:00Z", password: "secret" });
  assert.deepEqual(changes, { first_login_at: "2026-10-01T10:00:00Z" });
  const [row] = mergeAccountRows([{ uid: "123", first_login_at: null }], new Map([["123", changes]]), {});
  assert.equal(farmingDays(row.first_login_at, Date.parse("2026-10-02T10:00:00Z")), 1);
});
