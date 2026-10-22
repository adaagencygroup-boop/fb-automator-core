import test from "node:test";
import assert from "node:assert/strict";
import { categoryPopupPosition } from "./category-popup.mjs";

test("prefers right and clamps vertical position near viewport bottom", () => {
  const result = categoryPopupPosition({ left: 20, right: 248, top: 700, bottom: 732 }, { height: 250 }, { width: 1440, height: 800 });
  assert.deepEqual(result, { left: 256, top: 538, width: 280, maxHeight: 776 });
});

test("flips left when the right side has insufficient space", () => {
  const result = categoryPopupPosition({ left: 900, right: 1000, top: 100, bottom: 132 }, { height: 250 }, { width: 1080, height: 800 });
  assert.equal(result.left, 612);
  assert.equal(result.top, 100);
});

test("uses below and then above on narrow screens", () => {
  const viewport = { width: 360, height: 800 };
  const below = categoryPopupPosition({ left: 20, right: 248, top: 100, bottom: 132 }, { height: 250 }, viewport);
  assert.equal(below.top, 140);
  const above = categoryPopupPosition({ left: 20, right: 248, top: 700, bottom: 732 }, { height: 250 }, viewport);
  assert.equal(above.top, 442);
});

test("constrains oversized popup to small viewport with 12px margins", () => {
  const result = categoryPopupPosition({ left: 200, right: 250, top: 50, bottom: 82 }, { height: 400 }, { width: 260, height: 200 });
  assert.deepEqual(result, { left: 12, top: 12, width: 236, maxHeight: 176 });
});
