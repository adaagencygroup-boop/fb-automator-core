import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptySelection,
  isSelected,
  pageState,
  selectAllMatching,
  selectIds,
  selectedCount,
  setPageSelected,
  toAddPayload,
  toggleOne,
} from "./postSelection.mjs";
import { estimateSeconds, formatDuration, planTotals, preRunChecks, sharePerPostRange } from "./runPlan.mjs";
import { countVariants, hasSpintax, totalVariants } from "./spintax.mjs";

test("spintax variant count matches backend rules", () => {
  assert.equal(countVariants("{Bài viết|Nội dung} rất hữu ích, cảm ơn {ad|shop} nha!"), 4);
  assert.equal(countVariants("{a|{b|c}} {x|y}"), 6);
  assert.equal(countVariants("Bài viết chất lượng!"), 1);
  assert.equal(countVariants("giá {100k"), 1);
  assert.equal(countVariants("  "), 0);
  assert.equal(totalVariants(["{Hay|Tuyệt} {quá|ghê} {ạ|nha}", "Cảm ơn {shop|ad}"]), 10);
  assert.equal(hasSpintax("{a|b}"), true);
  assert.equal(hasSpintax("{name}"), false);
});

test("estimate: more Chrome threads is faster, spread = chosen hours", () => {
  const totals = planTotals({ accountCount: 20, targetCount: 10, doLike: true });
  const two = estimateSeconds({ accountCount: 20, targetCount: 10, delayMin: 30, delayMax: 60, totals, threads: 2 });
  const four = estimateSeconds({ accountCount: 20, targetCount: 10, delayMin: 30, delayMax: 60, totals, threads: 4 });
  assert.ok(four < two);
  assert.equal(estimateSeconds({ accountCount: 20, targetCount: 10, totals, spreadHours: 3 }), 3 * 3600);
});

test("pre-run checks: not enough distinct comments, missing schedule", () => {
  const base = {
    targetCount: 4, doLike: false, doComment: true, doShare: false, reactionCount: 0, commentCount: 6,
    accountCount: 10, liveAccounts: 20, delayMin: 30, delayMax: 60, fetchRunning: false, otherRunningLabel: null,
  };
  assert.ok(preRunChecks({ ...base, commentVariants: 25, commentPerPost: 25 }).every((c) => c.ok));
  assert.deepEqual(
    preRunChecks({ ...base, commentVariants: 20, commentPerPost: 25, scheduleMissing: true }).filter((c) => !c.ok).map((c) => c.key),
    ["comments", "schedule"],
  );
});

test("ticking posts one by one builds an id list", () => {
  let sel = emptySelection();
  sel = toggleOne(sel, 1);
  sel = toggleOne(sel, 2);
  sel = toggleOne(sel, 1);
  assert.deepEqual(sel.ids, [2]);
  assert.equal(selectedCount(sel, 1000), 1);
  assert.deepEqual(toAddPayload(sel, { sourceKey: "user:x" }), { source_key: "user:x", mode: "ids", ids: [2] });
});

test("select all N matching posts works without knowing every id, unticking excludes", () => {
  let sel = selectAllMatching();
  assert.equal(selectedCount(sel, 1_000_000), 1_000_000);
  sel = toggleOne(sel, 7);
  assert.equal(isSelected(sel, 7), false);
  assert.equal(isSelected(sel, 8), true);
  assert.equal(selectedCount(sel, 1_000_000), 999_999);
  assert.deepEqual(toAddPayload(sel, { sourceKey: "id:9", q: "rau", type: "photo" }), {
    source_key: "id:9", mode: "all", exclude_ids: [7], q: "rau", type: "photo",
  });
});

test("page checkbox ticks / unticks the whole visible page in both modes", () => {
  const page = [10, 11, 12];
  let sel = setPageSelected(emptySelection(), page, true);
  assert.equal(pageState(sel, page), "all");
  sel = toggleOne(sel, 11);
  assert.equal(pageState(sel, page), "some");
  sel = setPageSelected(selectAllMatching(), page, false);
  assert.equal(pageState(sel, page), "none");
  assert.deepEqual(sel.exclude, page);
  sel = setPageSelected(sel, page, true);
  assert.deepEqual(sel.exclude, []);
  assert.equal(pageState(emptySelection(), []), "none");
});

test("'choose first N' selection keeps unique ids", () => {
  assert.deepEqual(selectIds([3, 3, 4]).ids, [3, 4]);
});

test("allocation matches backend: react all, comment half, shares spread ±20%", () => {
  const t = planTotals({ accountCount: 50, targetCount: 4, doLike: true, doComment: true, doShare: true });
  assert.equal(t.react, 50);
  assert.equal(t.comment, 25);
  assert.deepEqual([t.shareMin, t.shareMax], [10, 15]);
  assert.equal(t.totalReacts, 200);
  assert.equal(t.totalComments, 100);
  assert.equal(t.totalShares, 50);
  assert.equal(t.total, 350);
  assert.deepEqual(sharePerPostRange(3, 10), [1, 1]);
  assert.deepEqual(sharePerPostRange(5, 1), [5, 5]);
  assert.equal(planTotals({ accountCount: 3, targetCount: 10, doShare: true }).totalShares, 10);
});

test("time estimate grows with posts and is shown in a readable unit", () => {
  const totals = planTotals({ accountCount: 50, targetCount: 4, doLike: true, doComment: false, doShare: false });
  const s4 = estimateSeconds({ accountCount: 50, targetCount: 4, delayMin: 30, delayMax: 60, totals });
  const t1000 = planTotals({ accountCount: 50, targetCount: 1000, doLike: true });
  const s1000 = estimateSeconds({ accountCount: 50, targetCount: 1000, delayMin: 30, delayMax: 60, totals: t1000 });
  assert.ok(s4 > 0 && s1000 > s4 * 200);
  assert.equal(estimateSeconds({ accountCount: 0, targetCount: 4, totals }), 0);
  assert.equal(formatDuration(45), "~45 giây");
  assert.equal(formatDuration(90 * 60), "~1 giờ 30 phút");
  assert.equal(formatDuration(3 * 86400 + 2 * 3600), "~3 ngày 2 giờ");
});

test("pre-run checks block start for missing pieces, fetch running and another batch", () => {
  const base = {
    targetCount: 4, doLike: true, doComment: false, doShare: false, reactionCount: 2, commentCount: 0,
    accountCount: 10, liveAccounts: 20, delayMin: 30, delayMax: 60, fetchRunning: false, otherRunningLabel: null,
  };
  assert.ok(preRunChecks(base).every((c) => c.ok));
  const bad = preRunChecks({ ...base, targetCount: 0, reactionCount: 0, delayMax: 20, fetchRunning: true, otherRunningLabel: "Page #3" });
  assert.deepEqual(bad.filter((c) => !c.ok).map((c) => c.key), ["targets", "reactions", "delay", "fetch", "other"]);
  assert.deepEqual(
    preRunChecks({ ...base, doLike: false }).filter((c) => !c.ok).map((c) => c.key),
    ["actions"],
  );
});
