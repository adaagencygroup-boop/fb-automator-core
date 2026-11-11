import test from "node:test";
import assert from "node:assert/strict";
import { pageWindow, parseJsonField } from "../src/modules/module_11_page_scanner/utils.mjs";

test("pageWindow follows the design: 1 2 3 … N, window around current page", () => {
  assert.deepEqual(pageWindow(1, 1), [1]);
  assert.deepEqual(pageWindow(2, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(pageWindow(1, 575), [1, 2, 3, "…", 575]);
  assert.deepEqual(pageWindow(3, 575), [1, 2, 3, "…", 575]);
  assert.deepEqual(pageWindow(40, 575), [1, "…", 39, 40, 41, "…", 575]);
  assert.deepEqual(pageWindow(575, 575), [1, "…", 573, 574, 575]);
});

test("pageWindow clamps invalid input", () => {
  assert.deepEqual(pageWindow(0, 0), [1]);
  assert.deepEqual(pageWindow(99, 3), [1, 2, 3]);
  assert.deepEqual(pageWindow("2", "7"), [1, 2, 3, "…", 7]);
});

test("parseJsonField parses DB strings and falls back safely", () => {
  assert.deepEqual(parseJsonField('{"page_keys":["user:a"]}', {}), { page_keys: ["user:a"] });
  assert.deepEqual(parseJsonField({ a: 1 }, {}), { a: 1 });
  assert.deepEqual(parseJsonField("not json", []), []);
  assert.deepEqual(parseJsonField(null, []), []);
  assert.deepEqual(parseJsonField("null", { x: 1 }), { x: 1 });
});
