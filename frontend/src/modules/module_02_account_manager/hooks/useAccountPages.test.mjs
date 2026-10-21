import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRefreshQueue, mergeAccountRows, publicChanges } from "../utils/account-realtime.mjs";

// Exercise request orchestration with controlled network promises and hook state.
function harness({ statsFailure = false } = {}) {
  const slots = [], effects = [], calls = [], anchors = [];
  let cursor = 0, selected = ["old"], query = {}, cleanup;
  const tableRef = { current: { capture: () => ({ uid: "1", offset: 20 }), restore: anchor => anchors.push(anchor), reset: () => anchors.push("reset") } };
  const context = {
    createRefreshQueue, mergeAccountRows, publicChanges,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useCallback: callback => callback,
    useEffect: callback => { cleanup = callback(); },
    useLayoutEffect: callback => effects.push(callback),
    getAccountsStats: async () => { if (statsFailure) throw new Error("stats unavailable"); return { total: 37, live: 20, die: 17 }; },
    getAccountsPage: params => new Promise((resolve, reject) => calls.push({ params, resolve, reject })),
  };
  let source = readFileSync(new URL("./useAccountPages.js", import.meta.url), "utf8");
  source = source.replace(/^import .*;$/gm, "").replace("export function", "function");
  vm.createContext(context);
  vm.runInContext(source, context);
  function render(nextQuery = query) {
    query = nextQuery; cursor = 0;
    const hook = context.useAccountPages(query, false, tableRef, value => { selected = typeof value === "function" ? value(selected) : value; });
    effects.splice(0).forEach(effect => effect());
    return hook;
  }
  return { render, calls, anchors, selected: () => selected, unmount: () => cleanup?.() };
}
const result = (start, length = 10, has_more = true) => ({ accounts: Array.from({ length }, (_, index) => ({ uid: String(start + index) })), total: 37, next_cursor: has_more ? start + length : null, has_more });
const tick = () => new Promise(resolve => setImmediate(resolve));

test("initial page, one concurrent append, deduplication, failure and retry", async () => {
  const h = harness();
  const initial = h.render().fetchAccounts(true);
  h.calls[0].resolve(result(1)); await initial;
  let hook = h.render();
  assert.equal(hook.accounts.length, 10);
  assert.equal(h.selected().length, 0);
  assert.equal(hook.stats.total, 37);
  const more = hook.loadMore(); await hook.loadMore();
  assert.equal(h.calls.length, 2);
  h.calls[1].reject(new Error("offline")); await more;
  hook = h.render();
  assert.equal(hook.accounts.length, 10);
  assert.equal(hook.moreError, "offline");
  const retry = hook.retryMore();
  h.calls[2].resolve(result(10)); await retry;
  hook = h.render();
  assert.equal(hook.accounts.length, 19);
  assert.equal(new Set(hook.accounts.map(row => row.uid)).size, 19);
  const last = hook.loadMore();
  h.calls[3].resolve(result(20, 1, false)); await last;
  await h.render().loadMore();
  assert.equal(h.calls.length, 4);
});

test("a changed query ignores an old page and clears previous selection", async () => {
  const h = harness();
  const old = h.render({ search: "old" }).fetchAccounts(true);
  const latest = h.render({ search: "new" }).fetchAccounts(true);
  h.calls[1].resolve(result(100, 1, false)); await latest;
  h.calls[0].resolve(result(1)); await old;
  const hook = h.render();
  assert.equal(hook.accounts[0].uid, "100");
  assert.equal(hook.accounts.length, 1);
  assert.equal(h.selected().length, 0);
  assert.equal(h.calls[1].params.search, "new");
});

test("refresh reloads the loaded extent in pages and restores its anchor", async () => {
  const h = harness();
  const first = h.render().fetchAccounts(true);
  h.calls[0].resolve(result(1)); await first;
  const more = h.render().loadMore();
  h.calls[1].resolve(result(11)); await more;
  const refresh = h.render().fetchAccounts();
  h.calls[2].resolve(result(2)); await tick();
  assert.equal(h.calls[3].params.cursor, 12);
  h.calls[3].resolve(result(12)); await refresh;
  assert.equal(h.render().accounts.length, 20);
  assert.equal(h.anchors.at(-1).uid, "1");
  const failedRefresh = h.render().fetchAccounts();
  h.calls[4].reject(new Error("refresh failed")); await failedRefresh;
  assert.equal(h.render().accounts.length, 20);
  const retry = h.render().retryMore();
  assert.equal(h.calls[5].params.cursor, undefined);
  h.calls[5].resolve(result(2, 1, false)); await retry;
});

test("a pending append cannot overwrite a new query or release its request lock", async () => {
  const h = harness();
  const initial = h.render().fetchAccounts(true);
  h.calls[0].resolve(result(1)); await initial;
  const oldAppend = h.render().loadMore();
  const reset = h.render({ search: "new" }).fetchAccounts(true);
  h.calls[1].resolve(result(11)); await oldAppend;
  await h.render().loadMore();
  assert.equal(h.calls.length, 3);
  h.calls[2].resolve(result(200, 1, false)); await reset;
  assert.equal(h.render().accounts.length, 1);
  assert.equal(h.render().accounts[0].uid, "200");
});

test("mutation completion through an earlier callback refreshes the current query", async () => {
  const h = harness();
  const oldRefresh = h.render({ search: "old" }).fetchAccounts;
  h.render({ search: "current" });
  const pending = oldRefresh();
  assert.equal(h.calls[0].params.search, "current");
  h.calls[0].resolve(result(300, 1, false)); await pending;
  assert.equal(h.render().accounts[0].uid, "300");
});

test("FE06 stats failure still renders list and releases pagination lock", async () => {
  const h = harness({ statsFailure: true });
  const first = h.render().fetchAccounts(true);
  h.calls[0].resolve(result(1)); await first;
  assert.equal(h.render().accounts.length, 10);
  assert.equal(h.render().isInitialLoading, false);
  const more = h.render().loadMore();
  h.calls[1].resolve(result(11, 1, false)); await more;
  assert.equal(h.render().accounts.length, 11);
});

test("FE07 unmount invalidates a pending page", async () => {
  const h = harness();
  const request = h.render().fetchAccounts(true);
  h.unmount();
  h.calls[0].resolve(result(1)); await request;
  assert.equal(h.render().accounts.length, 0);
});

test("FE08 initial failure retries the first page through fetchAccounts", async () => {
  const h = harness();
  const first = h.render().fetchAccounts(true);
  h.calls[0].reject(new Error("list unavailable")); await first;
  assert.equal(h.render().loadError, "list unavailable");
  const retry = h.render().fetchAccounts(true);
  assert.equal(h.calls[1].params.cursor, undefined);
  h.calls[1].resolve(result(1, 1, false)); await retry;
  assert.equal(h.render().loadError, null);
  assert.equal(h.render().accounts.length, 1);
});

test("isRefreshing is true during background refresh and false upon completion", async () => {
  const h = harness();
  const first = h.render().fetchAccounts(true);
  h.calls[0].resolve(result(1)); await first;
  let hook = h.render();
  assert.equal(hook.isRefreshing, false);
  const refresh = hook.fetchAccounts(false);
  assert.equal(h.render().isRefreshing, true);
  h.calls[1].resolve(result(1)); await refresh;
  assert.equal(h.render().isRefreshing, false);
});

test("an older refresh or append cannot overwrite newer account events", async () => {
  const h = harness();
  const first = h.render().fetchAccounts(true);
  h.calls[0].resolve(result(1)); await first;
  let hook = h.render();
  const refresh = hook.fetchAccounts();
  hook.applyAccountPatches([{ uid: "1", changes: { login_status: "logged_in", profile_name: "Updated" } }]);
  h.calls[1].resolve(result(1)); await refresh;
  hook = h.render();
  assert.equal(hook.accounts[0].login_status, "logged_in");
  assert.equal(hook.accounts[0].profile_name, "Updated");
  const more = hook.loadMore();
  hook.applyAccountPatches([{ uid: "11", changes: { login_status: "failed" } }]);
  h.calls[2].resolve(result(11)); await more;
  assert.equal(h.render().accounts.find(row => row.uid === "11").login_status, "failed");
});

test("patch removes rows that no longer match filters without resetting the table", async () => {
  const h = harness();
  const first = h.render({ login_status: "not_logged_in" }).fetchAccounts(true);
  h.calls[0].resolve(result(1)); await first;
  const resets = h.anchors.length;
  h.render().applyAccountPatches([{ uid: "1", changes: { login_status: "logged_in" } }]);
  const hook = h.render();
  assert.equal(hook.accounts.length, 9);
  assert.equal(h.anchors.length, resets);
  assert.equal(hook.isInitialLoading, false);
});

