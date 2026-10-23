import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function harness() {
  const slots = [], calls = [], effects = [];
  let cursor = 0, cleanup;
  const context = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(callback, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return previous.callback;
      slots[index] = { callback, deps };
      return callback;
    },
    useEffect(callback, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) {
        slots[index] = deps;
        effects.push(() => { cleanup?.(); cleanup = callback(); });
      }
    },
    getCategories: () => new Promise((resolve, reject) => calls.push({ resolve, reject })),
    getAccountsStats: async () => ({ total: 250 }),
  };
  const source = readFileSync(new URL("./useAccountCategories.js", import.meta.url), "utf8")
    .replace(/^import .*;$/gm, "").replace("export function", "function");
  vm.createContext(context);
  vm.runInContext(source, context);
  const render = () => { cursor = 0; return context.useAccountCategories(true); };
  return { calls, render, mount: () => effects.splice(0).forEach(effect => effect()), unmount: () => cleanup?.() };
}

test("rerendering does not reload categories; an explicit mutation refresh does", async () => {
  const h = harness();
  h.render(); h.mount();
  await Promise.resolve();
  assert.equal(h.calls.length, 1);
  h.calls[0].resolve([{ id: 1, account_count: 5 }]);
  await new Promise(resolve => setImmediate(resolve));
  for (let i = 0; i < 5; i++) { h.render(); h.mount(); }
  await Promise.resolve();
  assert.equal(h.calls.length, 1);
  assert.equal(h.render().isRefreshing, false);
  const mutationRefresh = h.render().refresh();
  assert.equal(h.calls.length, 2);
  assert.equal(h.render().isRefreshing, true);
  h.calls[1].resolve([{ id: 1, account_count: 6 }]); await mutationRefresh;
  assert.equal(h.render().categories[0].account_count, 6);
  h.unmount();
});

test("category refresh ignores superseded responses and keeps global total independent of visible rows", async () => {
  const h = harness();
  const old = h.render().refresh();
  const fresh = h.render().refresh();
  h.calls[1].resolve([{ id: 2, name: "New", account_count: 120 }]); await fresh;
  h.calls[0].resolve([{ id: 1, name: "Old", account_count: 10 }]); await old;
  assert.equal(h.render().categories[0].id, 2);
  assert.equal(h.render().total, 250);
  assert.equal(h.render().loading, false);
});

test("initial skeleton is replaced by background loading even for an empty category list", async () => {
  const h = harness();
  assert.equal(h.render().isInitialLoading, true);
  assert.equal(h.render().isRefreshing, false);
  const first = h.render().refresh();
  h.calls[0].resolve([]); await first;
  assert.equal(h.render().isInitialLoading, false);
  const refresh = h.render().refresh();
  assert.equal(h.render().isInitialLoading, false);
  assert.equal(h.render().isRefreshing, true);
  assert.equal(h.render().total, 250);
  h.calls[1].reject(new Error("offline")); await refresh;
  assert.equal(h.render().isRefreshing, false);
  assert.equal(h.render().hasLoaded, true);
  const retry = h.render().refresh();
  assert.equal(h.render().isInitialLoading, false);
  assert.equal(h.render().isRefreshing, true);
  h.calls[2].resolve([{ id: 1, account_count: 2 }]); await retry;
  assert.equal(h.render().categories.length, 1);
  assert.equal(h.render().isRefreshing, false);
});

test("failed refresh preserves prior categories and can retry", async () => {
  const h = harness();
  const first = h.render().refresh();
  h.calls[0].resolve([{ id: 1, account_count: 5 }]); await first;
  const failed = h.render().refresh();
  h.calls[1].reject(new Error("offline")); await failed;
  assert.equal(h.render().error, "offline");
  assert.equal(h.render().categories.length, 1);
  const retry = h.render().refresh();
  h.calls[2].resolve([]); await retry;
  assert.equal(h.render().error, null);
  assert.equal(h.render().categories.length, 0);
});

test("created categories remain selectable even if the follow-up refresh fails", async () => {
  const h = harness();
  const first = h.render().refresh();
  h.calls[0].resolve([]); await first;
  const created = { id: 4, name: "New", color: "#2563EB", account_count: 0 };
  h.render().upsertCategory(created);
  h.render().upsertCategory({ ...created, name: "Updated" });
  assert.equal(h.render().categories.length, 1);
  assert.equal(h.render().categories[0].name, "Updated");
  const refresh = h.render().refresh();
  h.calls[1].reject(new Error("offline")); await refresh;
  assert.equal(h.render().categories[0].id, 4);
  assert.equal(h.render().total, 250);
});

test("an unexpected object cannot replace the category array or crash sidebar rendering", async () => {
  const h = harness();
  const first = h.render().refresh();
  h.calls[0].resolve([{ id: 1, account_count: 5 }]); await first;
  const invalid = h.render().refresh();
  h.calls[1].resolve({ detail: "unexpected response" }); await invalid;
  const state = h.render();
  assert.equal(Array.isArray(state.categories), true);
  assert.equal(state.categories.reduce((sum, category) => sum + category.account_count, 0), 5);
  assert.match(state.error, /Dữ liệu danh mục không hợp lệ/);
  assert.equal(state.loading, false);
});

test("unmount invalidates in-flight category responses", async () => {
  const h = harness();
  h.render(); h.mount();
  await Promise.resolve();
  h.unmount();
  h.calls[0].resolve([{ id: 9 }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.render().categories.length, 0);
});
