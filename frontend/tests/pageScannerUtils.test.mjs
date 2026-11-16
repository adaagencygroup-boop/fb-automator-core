import test from "node:test";
import assert from "node:assert/strict";
import {
  filterScanResults,
  localIsoDate,
  pageWindow,
  parseJsonField,
  toCsv,
} from "../src/modules/module_11_page_scanner/utils.mjs";

const pagesFixture = Array.from({ length: 450 }, (_, i) => ({
  page_key: `user:p${i}`,
  page_name: `Page ${i}`,
  follower_count: 450 - i, // đã sắp xếp giảm dần
  source_keyword: i % 2 ? "#mypham" : "#thoitrang",
  phone: i === 7 ? "0988 123 456" : "",
}));

test("filterScanResults returns the FULL filtered list, not one table page", () => {
  const { pool, aboveMin, filtered } = filterScanResults(pagesFixture, {});
  assert.equal(pool, 450);
  assert.equal(aboveMin, 450);
  assert.equal(filtered.length, 450); // > 200: không còn bị cắt ở 200 / phiên
});

test("filterScanResults applies follower range, search, keyword, order and top N", () => {
  const r = filterScanResults(pagesFixture, {
    minFollowersEnabled: true,
    minFollowers: 100,
    maxFollowers: 300,
    filterKeyword: "#mypham",
  });
  assert.equal(r.aboveMin, 201); // follower 100..300
  assert.ok(r.filtered.every((p) => p.follower_count >= 100 && p.follower_count <= 300));
  assert.ok(r.filtered.every((p) => p.source_keyword === "#mypham"));

  assert.deepEqual(filterScanResults(pagesFixture, { resultSearch: "0988" }).filtered.map((p) => p.page_key), ["user:p7"]);
  assert.equal(filterScanResults(pagesFixture, { sortDir: "asc" }).filtered[0].page_key, "user:p449");
  assert.equal(filterScanResults(pagesFixture, { topN: "10" }).filtered.length, 10);
  assert.equal(filterScanResults(pagesFixture, { topN: "" }).filtered.length, 450);
});

test("localIsoDate uses the local calendar day, not the UTC day", () => {
  // 03:00 ngày 21/10 theo giờ máy — toISOString() có thể trả 20/10 ở múi giờ dương
  const early = new Date(2025, 9, 21, 3, 0, 0);
  assert.equal(localIsoDate(early), "2025-10-21");
  assert.equal(localIsoDate(new Date(2025, 0, 5, 23, 59)), "2025-01-05");
});

test("toCsv quotes every cell and escapes quotes", () => {
  assert.equal(toCsv(["A", "B"], [[1, 'say "hi"'], [null, "x,y"]]), '"A","B"\n"1","say ""hi"""\n"","x,y"');
});

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
