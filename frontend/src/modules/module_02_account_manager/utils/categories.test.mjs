import test from "node:test";
import assert from "node:assert/strict";
import { categoryQuery, moveAccountBatches, parseCategoriesResponse } from "./categories.mjs";
import { matchesAccountQuery, mergeAccountRows, publicChanges } from "./account-realtime.mjs";

test("category API accepts a direct array or categories envelope and rejects invalid payloads", () => {
  const categories = [{ id: 1, name: "Main", account_count: 2 }];
  assert.equal(parseCategoriesResponse(categories), categories);
  assert.equal(parseCategoriesResponse({ categories }), categories);
  assert.deepEqual(parseCategoriesResponse({ categories: [] }), []);
  for (const payload of [null, undefined, {}, "", { categories: {} }, { detail: "Not Found" }]) {
    assert.throws(() => parseCategoriesResponse(payload), /Dữ liệu danh mục không hợp lệ/);
  }
});

test("category query produces mutually exclusive filters and composes with search/status", () => {
  assert.deepEqual(categoryQuery("all"), {});
  assert.deepEqual(categoryQuery("uncategorized"), { uncategorized: true });
  assert.deepEqual(categoryQuery("12"), { category_id: 12 });
  const account = { uid: "123", profile_name: "An", category_id: 12, status: "live", login_status: "logged_in" };
  const query = { ...categoryQuery("12"), search: "an", status: "live", login_status: "logged_in" };
  assert.equal(matchesAccountQuery(account, query), true);
  assert.equal(matchesAccountQuery({ ...account, category_id: 13 }, query), false);
  assert.equal(matchesAccountQuery(account, categoryQuery("uncategorized")), false);
  assert.equal(matchesAccountQuery({ ...account, category_id: null }, categoryQuery("uncategorized")), true);
  assert.equal(matchesAccountQuery(account, { ...query, search: "other" }), false);
  assert.equal(matchesAccountQuery(account, { ...query, status: "die" }), false);
});

test("category realtime changes remove moved rows without accepting private data", () => {
  const changes = publicChanges({ category_id: null, password: "secret" });
  assert.deepEqual(changes, { category_id: null });
  const rows = [{ uid: "1", category_id: 2 }, { uid: "2", category_id: 2 }];
  assert.deepEqual(mergeAccountRows(rows, new Map([["1", changes]]), categoryQuery("2")), [rows[1]]);
});

test("moves sequential batches of at most 100 and deduplicates selection", async () => {
  const uids = Array.from({ length: 225 }, (_, i) => String(i));
  const calls = [];
  let active = false;
  const result = await moveAccountBatches([...uids, "0"], 9, async (batch, id) => {
    assert.equal(active, false);
    active = true;
    assert.equal(id, 9);
    calls.push(batch);
    await Promise.resolve();
    active = false;
  });
  assert.deepEqual(calls.map(batch => batch.length), [100, 100, 25]);
  assert.deepEqual(calls.flat(), uids);
  assert.deepEqual(result, { completed: 225, remaining: [], error: null });
});

test("stops on the first failed batch and retains all unprocessed UIDs", async () => {
  const uids = Array.from({ length: 225 }, (_, i) => String(i));
  const failure = new Error("offline");
  let calls = 0;
  const result = await moveAccountBatches(uids, null, async (_, id) => {
    assert.equal(id, null);
    if (++calls === 2) throw failure;
  });
  assert.equal(calls, 2);
  assert.equal(result.completed, 100);
  assert.deepEqual(result.remaining, uids.slice(100));
  assert.equal(result.error, failure);
});
