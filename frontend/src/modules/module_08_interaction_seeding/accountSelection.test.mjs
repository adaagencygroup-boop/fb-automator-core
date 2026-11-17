import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  loadSavedUids,
  resolveInitialUids,
  saveSelectedUids,
  selectionKey,
} from "./accountSelection.mjs";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
beforeEach(() => store.clear());

test("first visit (nothing saved) selects every usable account — old default", () => {
  assert.deepEqual(resolveInitialUids(["1", "2", "3"], null), { uids: ["1", "2", "3"], restored: false, dropped: 0 });
});

test("remembered choice is restored as-is", () => {
  assert.deepEqual(resolveInitialUids(["1", "2", "3"], ["2"]), { uids: ["2"], restored: true, dropped: 0 });
});

test("remembered accounts that are no longer usable are dropped", () => {
  assert.deepEqual(resolveInitialUids(["1", "3"], ["3", "2"]), { uids: ["3"], restored: true, dropped: 1 });
});

test("all remembered accounts unusable → nothing selected (no fallback to all)", () => {
  assert.deepEqual(resolveInitialUids(["1", "3"], ["2"]), { uids: [], restored: true, dropped: 1 });
});

test("saving an empty selection is remembered too", () => {
  saveSelectedUids("PAGE", []);
  assert.deepEqual(resolveInitialUids(["1"], loadSavedUids("PAGE")), { uids: [], restored: true, dropped: 0 });
});

test("save + load round trip, separate per seeding type", () => {
  saveSelectedUids("PAGE", ["100"]);
  assert.deepEqual(loadSavedUids("PAGE"), ["100"]);
  assert.equal(loadSavedUids("POST"), null);
  assert.equal(loadSavedUids("PROFILE"), null);
});

test("key is separate per app user and per type", () => {
  assert.notEqual(selectionKey("PAGE", "7"), selectionKey("PAGE", "8"));
  assert.notEqual(selectionKey("PAGE", "7"), selectionKey("POST", "7"));
  assert.equal(selectionKey("page", null), "seeding_selected_uids:anon:PAGE");
});

test("corrupted storage value is ignored", () => {
  store.set(selectionKey("PAGE"), "{not json");
  assert.equal(loadSavedUids("PAGE"), null);
  store.set(selectionKey("PAGE"), JSON.stringify({ a: 1 }));
  assert.equal(loadSavedUids("PAGE"), null);
});
