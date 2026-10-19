import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { TERMINAL_PHASES } from "../utils/account-realtime.mjs";

function harness() {
  let cursor = 0, time = 1000, timerId = 0, refreshes = 0, unknown = 0;
  const slots = [], effects = [], timers = new Map(), handlers = new Set(), patches = [], calls = [];
  const slot = (create) => { const id = cursor++; return slots[id] ??= create(); };
  const timer = (fn, delay, interval = false) => { const id = ++timerId; timers.set(id, { fn, at: time + delay, delay, interval }); return id; };
  const context = {
    TERMINAL_PHASES,
    Date: class extends Date { static now() { return time; } },
    setTimeout: (fn, delay) => timer(fn, delay), clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => timer(fn, delay, true), clearInterval: id => timers.delete(id),
    window: { addEventListener: (_, fn) => handlers.add(fn), removeEventListener: (_, fn) => handlers.delete(fn) },
    getAccountOperation: id => new Promise((resolve, reject) => calls.push({ id, resolve, reject })),
    useRef: value => slot(() => ({ current: value })),
    useState: value => { const h = slot(() => ({ value })); return [h.value, next => { h.value = typeof next === "function" ? next(h.value) : next; }]; },
    useCallback: fn => { slot(() => ({})); return fn; },
    useEffectEvent: fn => { const h = slot(() => ({ wrapper: (...args) => h.fn(...args) })); h.fn = fn; return h.wrapper; },
    useEffect: (fn, deps) => { const h = slot(() => ({})); if (!h.deps || deps.some((v,i) => v !== h.deps[i])) { h.deps = deps; effects.push(() => { h.cleanup?.(); h.cleanup = fn(); }); } },
  };
  const source = readFileSync(new URL("./useAccountRealtime.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?$/gm, "").replace("export default function", "function");
  vm.createContext(context); vm.runInContext(source, context);
  const options = { enabled: true, applyAccountPatches: rows => patches.push(...rows), requestRefresh: () => refreshes++, onUnknown: () => unknown++ };
  const render = () => { cursor = 0; const hook = context.useAccountRealtime(options); effects.splice(0).forEach(fn => fn()); return hook; };
  render();
  return {
    render, calls, patches, refreshes: () => refreshes, unknown: () => unknown,
    emit: detail => { for (const fn of handlers) fn({ detail }); },
    async advance(ms) { time += ms; for (const [id, item] of [...timers]) if (item.at <= time) { if (item.interval) item.at = time + item.delay; else timers.delete(id); item.fn(); } await Promise.resolve(); await Promise.resolve(); },
    dispose: () => slots.forEach(h => h.cleanup?.()),
  };
}
const event = (sequence, uid, phase, changes = {}, extra = {}) => ({
  event: "account_operation_updated", operation_id: "op", kind: "login", started_at: 2, sequence,
  done: false, account: { uid, phase, changes }, ...extra,
});

test("single-row progress is immediate; bursts batch patches and duplicate events do not refetch", async () => {
  const h = harness();
  assert.equal(h.render().begin("login", ["123"]), true);
  assert.equal(h.render().begin("login", ["123"]), false);
  h.emit(event(1, "123", "authenticated", { login_status: "logged_in" }));
  h.emit(event(1, "123", "authenticated", { login_status: "logged_in" }));
  assert.equal(h.render().progress["123"].phase, "authenticated");
  assert.equal(h.patches.length, 0);
  h.emit(event(2, "123", "completed", { login_status: "logged_in", profile_name: "Name" }, { done: true }));
  await h.advance(100);
  assert.equal(h.patches.length, 1);
  assert.equal(h.patches[0].changes.profile_name, "Name");
  assert.equal(h.refreshes(), 2);
  assert.equal(h.render().loggingIn, false);
  h.render().watch("op", "login", ["123"]); // POST response after completion.
  h.emit(event(1, "123", "opening"));
  await h.advance(5000);
  assert.equal(h.calls.length, 0, "old events must not resurrect completed operations");
  h.dispose();
});

test("final snapshots recover missed account events; old operations cannot overwrite newer results", async () => {
  const h = harness(); h.render().begin("login", ["123", "456"]);
  h.emit(event(2, "456", "completed", {}, { done: true, accounts: {
    "123": { uid: "123", phase: "completed", changes: { login_status: "logged_in" } },
    "456": { uid: "456", phase: "failed", changes: { login_status: "failed" } },
  } }));
  await h.advance(100);
  assert.equal(h.render().loggingIn, false);
  h.render().begin("browser", ["123"]);
  h.emit(event(1, "123", "completed", { login_status: "logged_in", profile_name: "New" }, { operation_id: "new", started_at: 3, kind: "browser", done: true }));
  await h.advance(100);
  h.emit(event(9, "123", "failed", { login_status: "failed" }, { started_at: 2, done: true }));
  await h.advance(100);
  assert.equal(h.render().progress["123"].changes.profile_name, "New");
  assert.equal(h.patches.at(-1).changes.profile_name, "New");
  h.dispose();
});

test("poll every 5 seconds without overlapping; recover on reconnect and stop on 404 or unmount", async () => {
  const h = harness(); h.render().begin("browser", ["123"]); h.render().watch("op", "browser", ["123"]);
  await h.advance(5000); await h.advance(5000);
  assert.equal(h.calls.length, 1);
  h.calls[0].resolve({ operation_id: "op", kind: "browser", started_at: 2, sequence: 1, done: false,
    accounts: { "123": { uid: "123", phase: "waiting", changes: {} } } });
  await h.advance(100);
  assert.equal(h.render().progress["123"].phase, "waiting");
  h.emit({ type: "connected" });
  assert.equal(h.calls.length, 2);
  h.calls[1].reject({ status: 404 }); // The shared Axios interceptor returns Error.status.
  await h.advance(100);
  assert.equal(h.render().progress["123"].phase, "unknown");
  assert.equal(h.unknown(), 1);
  assert.equal(h.render().begin("browser", ["123"]), true);
  h.render().watch("new", "browser", ["123"]);
  await h.advance(5000);
  h.dispose();
  h.calls[2].resolve({ operation_id: "new", sequence: 1, done: true, accounts: { "123": { uid: "123", phase: "completed", changes: { login_status: "logged_in" } } } });
  await h.advance(5000);
  assert.equal(h.calls.length, 3);
  assert.equal(h.patches.some(row => row.changes?.login_status === "logged_in"), false);
});

test("client clock ahead of Engine cannot discard completion before the POST response", async () => {
  const h = harness();
  await h.advance(1000000);
  h.render().begin("login", ["123"]);
  h.emit(event(1, "123", "completed", { login_status: "logged_in" }, { done: true }));
  h.render().watch("op", "login", ["123"]);
  await h.advance(100);
  assert.equal(h.render().loggingIn, false);
  assert.equal(h.patches[0].changes.login_status, "logged_in");
  await h.advance(5000);
  assert.equal(h.calls.length, 0);
  h.dispose();
});
