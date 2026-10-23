import test from "node:test";
import assert from "node:assert/strict";
import { importOutcome, withImportCategory } from "./import-categories.mjs";
import { DEFAULT_MAPPING, mapImportedRow } from "./import-mapping.mjs";

test("disabled category assignment omits the field and preserves original account data", () => {
  const accounts = [{ uid: "1234", password: "secret", category_id: 9 }];
  const result = withImportCategory(accounts, false, 9, []);
  assert.deepEqual(result, [{ uid: "1234", password: "secret" }]);
  assert.equal(accounts[0].category_id, 9);
});

test("selected category applies to every parsed account without altering field mapping", () => {
  const lines = ["1234|pass-one", "5678|pass-two"];
  const parsed = lines.map(line => mapImportedRow(line, "|", DEFAULT_MAPPING));
  const payload = withImportCategory(parsed, true, 4, [{ id: 4, name: "Main", color: "#2563EB" }]);
  assert.deepEqual(payload.map(account => account.category_id), [4, 4]);
  assert.deepEqual(payload.map(account => account.password), ["pass-one", "pass-two"]);
  assert.equal(Object.hasOwn(parsed[0], "category_id"), false);
});

test("enabled assignment blocks missing or deleted categories before import", () => {
  for (const id of [null, undefined, "4", 0, 2]) {
    assert.throws(() => withImportCategory([{ uid: "1234" }], true, id, [{ id: 4 }]), /chọn danh mục hợp lệ/);
  }
});

test("partial import warns, reports skips and returns only failed UIDs for retry", () => {
  const outcome = importOutcome({ added_count: 1, updated_count: 2, skipped_count: 3,
    errors: [{ uid: "1234", error: "Không thể lưu tài khoản" }] }, 1);
  assert.equal(outcome.complete, false);
  assert.equal(outcome.level, "warning");
  assert.deepEqual(outcome.failedUids, ["1234"]);
  assert.match(outcome.message, /Thêm mới: 1, cập nhật: 2, bỏ qua: 4, lỗi: 1/);
  assert.match(outcome.message, /1234: Không thể lưu tài khoản/);
});

test("all failed imports never report success and all-skipped imports can finish", () => {
  const failed = importOutcome({ added_count: 0, updated_count: 0, errors: [{ uid: "1234", error: "Unavailable" }] });
  assert.equal(failed.level, "error");
  assert.equal(failed.complete, false);
  const skipped = importOutcome({ added_count: 0, updated_count: 0, skipped_count: 2, errors: [] });
  assert.equal(skipped.level, "success");
  assert.equal(skipped.complete, true);
  assert.deepEqual(skipped.failedUids, []);
});
