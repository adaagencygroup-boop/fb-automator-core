import assert from "node:assert/strict";
import test from "node:test";
import { tokenExpiryLabel } from "../src/modules/module_05_page_manager/tokenExpiry.mjs";

test("only Meta-confirmed zero expiry has no fixed expiry date", () => {
  assert.match(tokenExpiryLabel({ is_valid: true, expires_at: 0 }), /không có ngày hết hạn cố định/);
  for (const metadata of [undefined, {}, { expires_at: 0 }, { is_valid: false, expires_at: 0 }, { is_valid: true }, { is_valid: true, expires_at: "0" }]) {
    assert.match(tokenExpiryLabel(metadata), /chưa được Meta xác nhận/);
  }
});

test("dated and expired tokens keep their actual expiry date", () => {
  for (const expiry of [1, 4102444800]) {
    const label = tokenExpiryLabel({ is_valid: true, expires_at: expiry });
    assert.match(label, /^Hạn token: \d/);
    assert.doesNotMatch(label, /không có ngày hết hạn/);
  }
});
