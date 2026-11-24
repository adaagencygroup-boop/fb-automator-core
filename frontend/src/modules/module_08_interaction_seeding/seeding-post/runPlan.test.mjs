import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DISTRIBUTION_ROTATION,
  clampPerAccount,
  estimateSeconds,
  planTotals,
  preRunChecks,
  rotationPlan,
} from "./runPlan.mjs";

const ROT = DISTRIBUTION_ROTATION;

test("rotation: blocks of N posts go to accounts in order, then wrap around", () => {
  const plan = rotationPlan({ accountCount: 3, targetCount: 7, perAccount: 2 });
  assert.equal(plan.blocks, 4);
  assert.deepEqual(plan.accounts.map((a) => a.ranges), [[[1, 2], [7, 7]], [[3, 4]], [[5, 6]]]);
  assert.deepEqual(plan.accounts.map((a) => a.posts), [3, 2, 2]);
  assert.equal(plan.activeAccounts, 3);
});

test("rotation: 1000 posts, 5 accounts, 50 per account → 20 blocks, account 1 gets 1–50 then 251–300", () => {
  const plan = rotationPlan({ accountCount: 5, targetCount: 1000, perAccount: 50 });
  assert.equal(plan.blocks, 20);
  assert.deepEqual(plan.accounts[0].ranges.slice(0, 2), [[1, 50], [251, 300]]);
  assert.ok(plan.accounts.every((a) => a.posts === 200 && a.blocks === 4));
});

test("rotation: fewer posts than one block → only the first account works", () => {
  const plan = rotationPlan({ accountCount: 50, targetCount: 4, perAccount: 50 });
  assert.equal(plan.activeAccounts, 1);
  assert.equal(plan.accounts[0].posts, 4);
  assert.equal(rotationPlan({ accountCount: 0, targetCount: 4, perAccount: 50 }).blocks, 0);
});

test("rotation totals: each post gets one of every chosen interaction", () => {
  const t = planTotals({ accountCount: 5, targetCount: 1000, doLike: true, doComment: true, doShare: false, mode: ROT });
  assert.deepEqual([t.react, t.comment, t.shareMax], [1, 1, 0]);
  assert.equal(t.totalReacts, 1000);
  assert.equal(t.totalComments, 1000);
  assert.equal(t.total, 2000);
  assert.equal(planTotals({ accountCount: 0, targetCount: 10, doLike: true, mode: ROT }).total, 0);
});

test("rotation estimate: more Chrome lanes is faster, capped by number of accounts", () => {
  const base = { accountCount: 5, targetCount: 1000, delayMin: 30, delayMax: 60, mode: ROT, perAccount: 50 };
  const totals = planTotals({ ...base, doLike: true });
  const one = estimateSeconds({ ...base, totals, threads: 1 });
  const five = estimateSeconds({ ...base, totals, threads: 5 });
  assert.ok(one > 0 && five < one);
  const single = { ...base, accountCount: 1 };
  const t1 = planTotals({ ...single, doLike: true });
  assert.equal(estimateSeconds({ ...single, totals: t1, threads: 1 }), estimateSeconds({ ...single, totals: t1, threads: 5 }));
});

test("rotation pre-run check rejects an invalid posts-per-account value", () => {
  const base = {
    targetCount: 10, doLike: true, reactionCount: 1, accountCount: 2, liveAccounts: 2,
    delayMin: 30, delayMax: 60, mode: ROT,
  };
  assert.ok(preRunChecks({ ...base, perAccount: 50 }).every((c) => c.ok));
  assert.deepEqual(preRunChecks({ ...base, perAccount: 0 }).filter((c) => !c.ok).map((c) => c.key), ["perAccount"]);
  assert.equal(clampPerAccount("abc"), 50);
  assert.equal(clampPerAccount(99999), 5000);
});
