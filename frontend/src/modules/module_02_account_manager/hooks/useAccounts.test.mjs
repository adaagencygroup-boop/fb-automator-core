import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRefreshQueue, matchesAccountQuery, publicChanges } from "../utils/account-realtime.mjs";

// Controlled hook lifecycle, deferred requests and refresh timers; no live DB.
function harness() {
  const slots = [], layouts = [], effects = [], calls = [], anchors = [], timers = new Map();
  let cursor = 0, selected = [], query = {}, enabled = true, time = 0, timerId = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const slot = create => { const i = cursor++; return slots[i] ??= create(); };
  const effect = queue => (callback, deps) => {
    const state = slot(() => ({}));
    if (!same(state.deps, deps)) {
      state.deps = deps;
      queue.push(() => { state.cleanup?.(); state.cleanup = callback(); });
    }
  };
  const clearSelection = value => { selected = typeof value === "function" ? value(selected) : value; };
  const tableRef = { current: {
    capture: () => ({ uid: "15", offset: 20 }),
    restore: anchor => anchors.push(anchor), reset: () => anchors.push("reset"),
  } };
  const context = {
    matchesAccountQuery, publicChanges,
    createRefreshQueue: (refresh, isBusy) => createRefreshQueue(refresh, isBusy, {
      now: () => time,
      timer: (callback, delay) => { timers.set(++timerId, { callback, at: time + delay }); return timerId; },
      cancel: id => timers.delete(id),
    }),
    useState(initial) {
      const state = slot(() => ({ value: typeof initial === "function" ? initial() : initial }));
      return [state.value, value => { state.value = typeof value === "function" ? value(state.value) : value; }];
    },
    useRef: initial => slot(() => ({ current: initial })),
    useMemo(callback, deps) {
      const state = slot(() => ({}));
      if (!same(state.deps, deps)) { state.deps = deps; state.value = callback(); }
      return state.value;
    },
    useCallback: (callback, deps) => context.useMemo(() => callback, deps),
    useLayoutEffect: effect(layouts), useEffect: effect(effects),
    getAccounts: (...args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject })),
  };
  let source = readFileSync(new URL("./useAccounts.js", import.meta.url), "utf8");
  source = source.replace(/^import .*;$/gm, "").replace("export function", "function");
  vm.createContext(context); vm.runInContext(source, context);
  const render = (nextQuery = query, nextEnabled = enabled) => {
    query = nextQuery; enabled = nextEnabled; cursor = 0;
    const hook = context.useAccounts(query, enabled, tableRef, clearSelection);
    layouts.splice(0).forEach(fn => fn()); effects.splice(0).forEach(fn => fn());
    return hook;
  };
  const unmount = () => slots.forEach(state => state.cleanup?.());
  return {
    render, calls, anchors, unmount,
    selected: () => [...selected], select: uids => { selected = uids; },
    async advance(ms) {
      time += ms;
      for (const [id, item] of [...timers]) if (item.at <= time) { timers.delete(id); void item.callback(); }
      await tick();
    },
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
const rows = (count = 37) => Array.from({ length: count }, (_, i) => ({
  id: i + 1, uid: String(i + 1), profile_name: `Name ${i + 1}`, email: `mail${i + 1}@example.com`,
  status: i % 3 === 0 ? "live" : i % 3 === 1 ? "die" : null,
  login_status: i % 2 ? "logged_in" : "not_logged_in", category_id: i % 2 ? 1 : null,
})).reverse();
async function loaded(t, data = rows(), query = {}) {
  const h = harness(); t.after(h.unmount);
  h.render(query); await tick();
  h.calls[0].resolve(data); await tick(); h.render();
  return h;
}

test("loads more than ten accounts with a single unfiltered request and derives global stats", async t => {
  const h = await loaded(t);
  const hook = h.render();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].args, []);
  assert.equal(hook.accounts.length, 37);
  assert.equal(hook.accounts.at(-1).uid, "1");
  assert.equal(hook.total, 37);
  assert.deepEqual(plain(hook.stats), { total: 37, live: 13, die: 12 });
  assert.equal(hook.isInitialLoading, false);
  assert.equal(hook.loadMore, undefined);
});

test("filters the whole dataset locally, clears selection and resets scroll without fetching", async t => {
  const h = await loaded(t);
  for (const search of ["mail37@EXAMPLE.COM", "nAmE 37", "37"]) {
    h.select(["1", "37"]);
    const hook = h.render({ search });
    assert.deepEqual([...hook.accounts.map(row => row.uid)], ["37"]);
    assert.deepEqual(h.selected(), []);
    assert.equal(h.anchors.at(-1), "reset");
    assert.equal(hook.allAccounts.length, 37);
    assert.equal(hook.stats.total, 37);
  }
  const query = { status: "live", login_status: "logged_in", category_id: 1 };
  assert.deepEqual(plain(h.render(query).accounts), rows().filter(row => matchesAccountQuery(row, query)));
  assert.equal(h.render({ uncategorized: true }).accounts.length, 19);
  assert.equal(h.render({ search: "missing" }).accounts.length, 0);
  assert.equal(h.calls.length, 1);
});

test("SSE updates filtered-out rows, recomputes stats and prunes only hidden selections", async t => {
  const h = await loaded(t, rows(), { status: "live" });
  h.select(["1", "4"]);
  const resets = h.anchors.length;
  h.render().applyAccountPatches([
    { uid: "1", changes: { status: "die", cookie: "never accepted" } },
    { uid: "2", changes: { status: "live" } },
    { uid: "2", changes: { profile_name: "Updated in same batch" } },
  ]);
  const hook = h.render();
  assert.equal(hook.accounts.some(row => row.uid === "1"), false);
  assert.equal(hook.accounts.some(row => row.uid === "2"), true);
  assert.equal(hook.accounts.find(row => row.uid === "2").profile_name, "Updated in same batch");
  assert.deepEqual(h.selected(), ["4"]);
  assert.equal(hook.stats.live, 13);
  assert.equal(hook.stats.die, 12);
  assert.equal(hook.allAccounts.find(row => row.uid === "1").cookie, undefined);
  assert.equal(hook.allAccounts.length, 37);
  assert.equal(h.anchors.length, resets);
  assert.equal(h.calls.length, 1);
});

test("SSE during a request wins over its stale snapshot even for an initially unloaded row", async t => {
  const h = harness(); t.after(h.unmount);
  h.render({ login_status: "logged_in" }); await tick();
  h.render().applyAccountPatches([{ uid: "1", changes: { login_status: "logged_in", profile_name: "Updated" } }]);
  h.calls[0].resolve(rows()); await tick();
  let hook = h.render();
  assert.equal(hook.accounts.find(row => row.uid === "1").profile_name, "Updated");
  const request = hook.fetchAccounts();
  hook.applyAccountPatches([{ uid: "1", changes: { profile_name: "Newest" } }]);
  h.calls[1].resolve(rows()); await request;
  assert.equal(h.render().allAccounts.find(row => row.uid === "1").profile_name, "Newest");
});

test("refresh preserves scroll and valid selection; failure keeps rows and supports retry", async t => {
  const h = await loaded(t);
  h.select(["1", "37"]);
  let pending = h.render().fetchAccounts();
  assert.equal(h.render().isRefreshing, true);
  h.calls[1].resolve(rows(36)); await pending;
  assert.deepEqual(h.selected(), ["1"]);
  assert.equal(h.anchors.at(-1).uid, "15");
  pending = h.render().fetchAccounts(true);
  h.calls[2].reject(new Error("offline")); await pending;
  let hook = h.render();
  assert.equal(hook.accounts.length, 36);
  assert.equal(hook.loadError, null);
  assert.equal(hook.refreshError, "offline");
  assert.equal(hook.isRefreshing, false);
  pending = hook.fetchAccounts(); h.calls[3].resolve(rows()); await pending;
  assert.equal(h.render().refreshError, null);
  assert.equal(h.render().accounts.length, 37);
});

test("changing filters while refreshing keeps the new scroll and selection state", async t => {
  const h = await loaded(t);
  const pending = h.render().fetchAccounts(false, ["1"]);
  h.render({ search: "mail37@" });
  const resets = h.anchors.length;
  h.calls[1].resolve(rows()); await pending;
  assert.equal(h.render().accounts[0].uid, "37");
  assert.deepEqual(h.selected(), []);
  assert.equal(h.anchors.length, resets);
  assert.equal(h.calls.length, 2);
});

test("latest request wins and an older response cannot release its request lock", async t => {
  const h = harness(); t.after(h.unmount);
  h.render(); await tick();
  const latest = h.render().fetchAccounts(true);
  h.calls[0].resolve(rows(10)); await tick();
  assert.equal(h.render().allAccounts.length, 0);
  assert.equal(h.render().isInitialLoading, true);
  h.calls[1].resolve(rows()); await latest;
  assert.equal(h.render().allAccounts.length, 37);
});

test("local deletion/edit during refresh survives a stale snapshot and updates hidden rows", async t => {
  const h = await loaded(t, rows(), { category_id: 1 });
  const pending = h.render().fetchAccounts();
  h.render().setAccounts(previous => previous.filter(row => row.uid !== "1").map(row => row.uid === "3" ? { ...row, email: "changed@example.com" } : row));
  h.render().applyAccountPatches([{ uid: "1", changes: { status: "live" } }]);
  h.calls[1].resolve(rows()); await pending;
  const hook = h.render();
  assert.equal(hook.allAccounts.length, 36);
  assert.equal(hook.allAccounts.some(row => row.uid === "1"), false);
  assert.equal(hook.allAccounts.find(row => row.uid === "3").email, "changed@example.com");
  assert.equal(h.render({ search: "changed@example.com" }).accounts[0].uid, "3");
});

test("empty list is a successful load and initial failure can be retried", async t => {
  const h = harness(); t.after(h.unmount);
  h.render(); await tick(); h.calls[0].reject(new Error("unavailable")); await tick();
  assert.equal(h.render().loadError, "unavailable");
  const retry = h.render().fetchAccounts(); h.calls[1].resolve([]); await retry;
  const hook = h.render();
  assert.equal(hook.loadError, null);
  assert.equal(hook.total, 0);
  assert.deepEqual(plain(hook.stats), { total: 0, live: 0, die: 0 });
  assert.equal(hook.isInitialLoading, false);
});

test("unmount and disabling invalidate pending responses", async t => {
  const h = harness(); t.after(h.unmount);
  h.render(); await tick(); h.unmount(); h.calls[0].resolve(rows()); await tick();
  assert.equal(h.render().allAccounts.length, 0);
  const other = await loaded(t);
  const pending = other.render().fetchAccounts();
  other.select(["1"]); other.render(undefined, false);
  other.calls[1].resolve(rows()); await pending;
  assert.equal(other.render().allAccounts.length, 0);
  assert.deepEqual(other.selected(), []);
});

test("completion bursts coalesce into full-list refreshes and events during a request queue one more", async t => {
  const h = await loaded(t);
  for (let i = 0; i < 100; i++) h.render().requestRefresh();
  await h.advance(0);
  assert.equal(h.calls.length, 2);
  for (let i = 0; i < 100; i++) h.render().requestRefresh();
  await h.advance(3000); assert.equal(h.calls.length, 2);
  h.calls[1].resolve(rows()); await tick(); await h.advance(0);
  assert.equal(h.calls.length, 3);
  h.calls[2].resolve(rows()); await tick();
});
