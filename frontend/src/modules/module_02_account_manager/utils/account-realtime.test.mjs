import test from "node:test";
import assert from "node:assert/strict";
import { createRefreshQueue, isAccountBusy, mergeAccountRows, publicChanges } from "./account-realtime.mjs";

test("Chrome button busy state covers individual and bulk operations and stops for every terminal phase", () => {
  for (const kind of ["browser", "login"]) {
    for (const phase of ["queued", "opening", "waiting", "authenticated"]) assert.equal(isAccountBusy({ kind, phase }), true);
    for (const phase of ["completed", "failed", "timeout", "closed", "unknown"]) assert.equal(isAccountBusy({ kind, phase }), false);
  }
  assert.equal(isAccountBusy(undefined), false);
});

test("patch only changed rows, apply current filters, and never insert unloaded accounts", () => {
  const a = { uid: "a", login_status: "not_logged_in", profile_name: "Alice" };
  const b = { uid: "b", login_status: "not_logged_in" };
  const patches = new Map([["a", { login_status: "logged_in" }], ["not-loaded", { login_status: "logged_in" }]]);
  const rows = mergeAccountRows([a, b], patches, {});
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0], a);
  assert.equal(rows[1], b);
  assert.deepEqual(mergeAccountRows([a, b], patches, { login_status: "not_logged_in" }), [b]);
  assert.deepEqual(mergeAccountRows([a], new Map([["a", { profile_name: "Bob" }]]), { search: "alice" }), []);
  assert.deepEqual(publicChanges({ cookie: "secret", password: "secret", token: "secret", status: "live" }), { status: "live" });
});

test("100 completion events coalesce, request during a slow refresh queues once, disposal cancels", async () => {
  let now = 0, calls = 0, resolve, busy = false, id = 0;
  const timers = new Map();
  const queue = createRefreshQueue(() => { calls++; return new Promise(done => { resolve = done; }); }, () => busy, {
    now: () => now, timer: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id; }, cancel: key => timers.delete(key),
  });
  const tick = async (ms) => {
    now += ms;
    for (const [key, item] of [...timers]) if (item.at <= now) { timers.delete(key); void item.fn(); }
    await Promise.resolve(); await Promise.resolve();
  };
  for (let i = 0; i < 100; i++) queue.request();
  assert.equal(timers.size, 1);
  await tick(0); assert.equal(calls, 1);
  for (let i = 0; i < 100; i++) queue.request();
  await tick(3000); assert.equal(calls, 1);
  resolve(); await tick(0); await tick(0); assert.equal(calls, 2);
  resolve(); await tick(0);
  busy = true; queue.request(); await tick(2000); assert.equal(calls, 2);
  busy = false; await tick(100); assert.equal(calls, 3);
  resolve(); await tick(0); queue.request(); queue.dispose();
  await tick(5000); assert.equal(calls, 3);
});
