import test from "node:test";
import assert from "node:assert/strict";
import { createAccountResource } from "../src/modules/module_05_page_manager/accountResource.mjs";
import { cachedTokenStatuses, readTokenCache, tokenCacheKey, TOKEN_CACHE_TTL_MS } from "../src/modules/module_05_page_manager/tokenStatusCache.mjs";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("prefetch coalesces opens, keeps cached rows during stale refresh and retries errors", async () => {
  let now = 1000, calls = 0;
  let response = deferred();
  const resource = createAccountResource(() => { calls++; return response.promise; }, () => now);
  resource.activate();
  const first = resource.load();
  assert.equal(first, resource.load());
  assert.equal(resource.getSnapshot().loading, true);
  response.resolve({ accounts: [{ uid: "a", has_token: true }] });
  await first;
  assert.equal(calls, 1);
  await resource.load();
  assert.equal(calls, 1);
  now += 30_000;
  response = deferred();
  const refresh = resource.load();
  assert.equal(resource.getSnapshot().accounts[0].uid, "a");
  assert.equal(resource.getSnapshot().loaded, true);
  response.reject(new Error("offline"));
  await refresh;
  assert.equal(resource.getSnapshot().error, "offline");
  assert.equal(resource.getSnapshot().loading, false);
  assert.equal(resource.getSnapshot().accounts[0].uid, "a");
  response = deferred();
  const retry = resource.load(true);
  response.resolve({ accounts: [] });
  await retry;
  assert.deepEqual(resource.getSnapshot().accounts, []);
  assert.equal(resource.getSnapshot().error, "");
  resource.dispose();
});

test("OAuth completion during an older GET queues one fresh read after it", async () => {
  const older = deferred(), latest = deferred();
  let calls = 0;
  const resource = createAccountResource(() => (++calls === 1 ? older : latest).promise);
  resource.activate();
  const first = resource.load();
  const afterSync = resource.load(true);
  assert.equal(afterSync, resource.load(true));
  older.resolve({ accounts: [{ uid: "a", has_token: false }] });
  await first;
  latest.resolve({ accounts: [{ uid: "a", has_token: true }] });
  await afterSync;
  assert.equal(calls, 2);
  assert.equal(resource.getSnapshot().accounts[0].has_token, true);
  resource.dispose();
});

test("disposed owner requests cannot publish into another owner or a remount", async () => {
  const old = deferred(), fresh = deferred();
  let calls = 0;
  const resource = createAccountResource(() => (++calls === 1 ? old : fresh).promise);
  resource.activate();
  const first = resource.load();
  await Promise.resolve();
  resource.dispose();
  resource.activate();
  const second = resource.load();
  const otherOwner = createAccountResource(async () => ({ accounts: [{ uid: "owner-b" }] }));
  otherOwner.activate();
  await otherOwner.load();
  fresh.resolve({ accounts: [{ uid: "fresh" }] });
  await second;
  old.resolve({ accounts: [{ uid: "obsolete" }] });
  await first;
  assert.equal(resource.getSnapshot().accounts[0].uid, "fresh");
  assert.equal(otherOwner.getSnapshot().accounts[0].uid, "owner-b");
  resource.dispose(); otherOwner.dispose();
});

test("initial errors and malformed responses remain retryable instead of appearing empty", async () => {
  let data = null;
  const resource = createAccountResource(async () => data);
  resource.activate();
  await resource.load();
  assert.equal(resource.getSnapshot().loaded, false);
  assert.ok(resource.getSnapshot().error);
  data = { accounts: [] };
  await resource.load(true);
  assert.equal(resource.getSnapshot().loaded, true);
  assert.equal(resource.getSnapshot().error, "");
  resource.dispose();
});

test("token badges are owner scoped, expire after 15 minutes and never restore CHECKING", () => {
  const now = 1_000_000;
  const storage = { getItem: (key) => key === tokenCacheKey("a") ? JSON.stringify({
    live: { status: "LIVE", timestamp: now - 1 },
    expiredCache: { status: "LIVE", timestamp: now - TOKEN_CACHE_TTL_MS },
    inFlight: { status: "CHECKING", timestamp: now },
    future: { status: "LIVE", timestamp: now + 1 },
  }) : null };
  assert.deepEqual(cachedTokenStatuses(storage, "a", now), { live: "LIVE" });
  assert.deepEqual(cachedTokenStatuses(storage, "b", now), {});
});

test("optional storage failures and invalid cache data do not block the modal", () => {
  for (const value of ["null", "[]", "broken"]) {
    assert.deepEqual(readTokenCache({ getItem: () => value }, "a"), {});
  }
  assert.deepEqual(cachedTokenStatuses({ getItem: () => { throw Error("blocked"); } }, "a"), {});
});
