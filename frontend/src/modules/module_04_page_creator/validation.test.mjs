import { test } from "node:test";
import assert from "node:assert/strict";
import { ADDRESS_MAX, PAGE_NAME_MAX, annotateLines, normalizePhone, rowIssues } from "./validation.mjs";

const line = (over = {}) => ({
  page_name: "Luna Coffee Premium",
  phone: "0988888888",
  email: "abc@gmail.com",
  address: "Hoàn Kiếm, Hà Nội",
  ...over,
});

test("dòng đầy đủ và đúng định dạng thì không có lỗi", () => {
  assert.deepEqual(rowIssues(line()), []);
});

test("thiếu từng trường bắt buộc đều báo lỗi riêng", () => {
  assert.deepEqual(rowIssues(line({ page_name: "" })), ["Thiếu tên page"]);
  assert.deepEqual(rowIssues(line({ phone: "" })), ["Thiếu SĐT"]);
  assert.deepEqual(rowIssues(line({ email: "" })), ["Thiếu email"]);
  assert.deepEqual(rowIssues(line({ address: "" })), ["Thiếu địa chỉ"]);
});

test("chỉ có khoảng trắng cũng coi là thiếu", () => {
  assert.deepEqual(rowIssues(line({ email: "   " })), ["Thiếu email"]);
  assert.deepEqual(rowIssues(line({ address: "  " })), ["Thiếu địa chỉ"]);
});

test("mỗi trường báo tối đa một lỗi, không vừa thiếu vừa sai định dạng", () => {
  assert.deepEqual(rowIssues(line({ phone: "" })), ["Thiếu SĐT"]);
  assert.deepEqual(rowIssues(line({ email: "" })), ["Thiếu email"]);
});

test("email sai định dạng", () => {
  for (const email of ["abc", "abc@", "@gmail.com", "abc@gmail", "a b@gmail.com"]) {
    assert.deepEqual(rowIssues(line({ email })), ["Sai email"], email);
  }
});

test("số điện thoại phải đúng 10 chữ số", () => {
  assert.deepEqual(rowIssues(line({ phone: "0988888888" })), [], "đúng 10 số");
  assert.deepEqual(rowIssues(line({ phone: "098888888" })), ["SĐT phải đúng 10 chữ số"], "9 số");
  assert.deepEqual(rowIssues(line({ phone: "09888888888" })), ["SĐT phải đúng 10 chữ số"], "11 số");
  assert.deepEqual(rowIssues(line({ phone: "0988abc888" })), ["SĐT phải đúng 10 chữ số"], "có chữ");
});

test("số điện thoại bỏ qua dấu phân cách khi dán từ Excel", () => {
  for (const phone of ["098 888 8888", "098.888.8888", "098-888-8888", "(098) 8888888"]) {
    assert.deepEqual(rowIssues(line({ phone })), [], phone);
  }
});

test("mã quốc gia nhập kèm thì báo lỗi, vì đã có ô chọn riêng", () => {
  assert.deepEqual(rowIssues(line({ phone: "+84988888888" })), ["SĐT phải đúng 10 chữ số"]);
});

test(`tên page quá ${PAGE_NAME_MAX} ký tự`, () => {
  assert.deepEqual(rowIssues(line({ page_name: "a".repeat(PAGE_NAME_MAX) })), [], "đúng mức tối đa");
  assert.deepEqual(
    rowIssues(line({ page_name: "a".repeat(PAGE_NAME_MAX + 1) })),
    [`Tên page quá ${PAGE_NAME_MAX} ký tự`],
  );
});

test(`địa chỉ quá ${ADDRESS_MAX} ký tự`, () => {
  assert.deepEqual(rowIssues(line({ address: "a".repeat(ADDRESS_MAX) })), [], "đúng mức tối đa");
  assert.deepEqual(
    rowIssues(line({ address: "a".repeat(ADDRESS_MAX + 1) })),
    [`Địa chỉ quá ${ADDRESS_MAX} ký tự`],
  );
});

test("nhiều lỗi cùng lúc thì liệt kê hết", () => {
  assert.deepEqual(
    rowIssues({ page_name: "", phone: "123", email: "sai", address: "" }),
    ["Thiếu tên page", "SĐT phải đúng 10 chữ số", "Sai email", "Thiếu địa chỉ"],
  );
});

test("dòng rỗng hoặc undefined không làm vỡ", () => {
  assert.equal(rowIssues({}).length, 4);
  assert.equal(rowIssues(undefined).length, 4);
});

test("normalizePhone giữ lại dấu cộng để mã quốc gia còn bị phát hiện", () => {
  assert.equal(normalizePhone("+84 988 888 888"), "+84988888888");
  assert.equal(normalizePhone("098.888.8888"), "0988888888");
  assert.equal(normalizePhone(null), "");
});

/**
 * annotateLines giữ CHỈ SỐ DÒNG GỐC — đây là thứ quyết định vệt vàng trên
 * textarea có nằm đúng dòng hay không. Lệch một dòng là bôi sai chỗ.
 */
test("annotateLines giữ đúng chỉ số dòng khi có dòng trống ở giữa", () => {
  const text = [
    "Luna Coffee | 0988888888 | a@b.com | Hà Nội", // dòng 0 — hợp lệ
    "",                                             // dòng 1 — trống
    "Mộc Spa | 0977777777 | sai-email | Hà Nội",    // dòng 2 — sai email
    "   ",                                          // dòng 3 — chỉ khoảng trắng
    "Tiệm Bánh | 123 | c@d.com | Hà Nội",           // dòng 4 — SĐT sai
  ].join("\n");

  const lines = annotateLines(text, "|");

  assert.equal(lines.length, 5, "phải giữ đủ cả dòng trống");
  assert.deepEqual(lines.map((l) => l.index), [0, 1, 2, 3, 4]);
  assert.deepEqual(
    lines.filter((l) => l.issues.length > 0).map((l) => l.index),
    [2, 4],
    "chỉ dòng 2 và 4 bị bôi vàng",
  );
});

test("annotateLines: dòng trống không tạo page và không bị tính lỗi", () => {
  const lines = annotateLines("\n\n", "|");
  assert.equal(lines.every((l) => l.page === null), true);
  assert.equal(lines.every((l) => l.issues.length === 0), true);
});

test("annotateLines: dòng thiếu tên page bị bỏ qua, khớp với bảng đối soát", () => {
  // parsePageLines cũ cũng bỏ dòng này, nên vệt vàng và bảng phải cùng im lặng
  const lines = annotateLines("| 0988888888 | a@b.com | Hà Nội", "|");
  assert.equal(lines[0].page, null);
  assert.deepEqual(lines[0].issues, []);
});

test("annotateLines: số dòng tạo page khớp số dòng có tên", () => {
  const text = "A | 0988888888 | a@b.com | HN\n\nB | 0977777777 | b@c.com | HN";
  const lines = annotateLines(text, "|");
  assert.equal(lines.filter((l) => l.page).length, 2);
});

test("annotateLines xử lý CRLF của tệp Windows", () => {
  const lines = annotateLines("A | 0988888888 | a@b.com | HN\r\nB | 123 | b@c.com | HN", "|");
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[1].issues, ["SĐT phải đúng 10 chữ số"]);
});

test("annotateLines tôn trọng ký tự phân cách được chọn", () => {
  const lines = annotateLines("A ; 0988888888 ; a@b.com ; HN", ";");
  assert.deepEqual(lines[0].issues, []);
  // Cùng dòng đó đọc bằng dấu | thì thành một trường duy nhất -> thiếu hết
  const wrong = annotateLines("A ; 0988888888 ; a@b.com ; HN", "|");
  assert.deepEqual(wrong[0].issues, ["Thiếu SĐT", "Thiếu email", "Thiếu địa chỉ"]);
});
