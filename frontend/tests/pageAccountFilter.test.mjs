import assert from "node:assert/strict";
import { ALL_ACCOUNTS, matchesPageAccount, pageAccountKey, pageAccountOptions } from "../src/modules/module_05_page_manager/pageAccountFilter.mjs";

const pages = [
  { id: 1, manager_uid: "123", manager_name: "Same name", status: "SUCCESS", page_name: "Page A" },
  { id: 2, manager_uid: 123, manager_name: "Same name", status: "ERROR", page_name: "Page B" },
  { id: 3, manager_uid: "456", manager_name: "Same name", status: "SUCCESS", page_name: "Page C" },
  { id: 4, manager_uid: "123", web_connection_id: 123, manager_kind: "web", manager_name: "Same name", status: "SUCCESS" },
  { id: 5, manager_uid: " ", manager_name: "Old name", status: "ERROR" },
];

// Account names and a shared numeric ID must never merge distinct sources.
const options = pageAccountOptions(pages);
assert.equal(options.length, 4);
assert.equal(options.find((option) => option.value === "account:123").count, 2);
assert.equal(options.find((option) => option.value === "web:123").count, 1);
assert.notEqual(options.find((option) => option.value === "account:123").detail,
  options.find((option) => option.value === "web:123").detail);
assert.equal(options.find((option) => option.value === "unassigned").name, "Chưa gán tài khoản");

const ids = (selected) => pages.filter((page) => matchesPageAccount(page, selected)).map((page) => page.id);
assert.deepEqual(ids(ALL_ACCOUNTS), [1, 2, 3, 4, 5]);
assert.deepEqual(ids("account:123"), [1, 2]);
assert.deepEqual(ids("account:456"), [3]);
assert.deepEqual(ids("web:123"), [4]);
assert.deepEqual(ids("unassigned"), [5]);
assert.deepEqual(ids("account:missing"), []);

// The account constraint composes with status and the existing Page search.
assert.deepEqual(pages.filter((page) => matchesPageAccount(page, "account:123")
  && page.status === "ERROR" && page.page_name.includes("B")).map((page) => page.id), [2]);
assert.equal(pageAccountKey({ manager_uid: " 456 " }), "account:456");
assert.equal(pageAccountKey({ web_connection_id: 0 }), "web:0");
assert.equal(pageAccountKey({}), "unassigned");
assert.deepEqual(pageAccountOptions([]), []);

// Refresh can retain an account while any of its Pages remain, or remove it.
assert.equal(pageAccountOptions(pages.slice(1)).some((option) => option.value === "account:123"), true);
assert.equal(pageAccountOptions(pages.slice(2)).some((option) => option.value === "account:123"), false);
console.log("PASS: account identity, counts, combined filters, missing identity and refreshed options");
