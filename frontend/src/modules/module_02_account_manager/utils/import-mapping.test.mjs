import { test } from "node:test";
import assert from "node:assert/strict";
import { detectColumnMapping, isValidProxy } from "./import-mapping.mjs";

const first = "9e5f94bc-e8a4-4e73-b8be-63364c29d753";
const extra = "8b4ba9dd-3ea5-4e5f-86f1-ddba2230dcf2";
const map = (values) => detectColumnMapping([values.join("|")], "|", values.length);

test("extra UUID stays ignored at the default proxy position", () => {
  const fields = map(["123456", "pass", "", "", "", "", "", "", "", first, extra]);
  assert.equal(fields[9], "client_id");
  assert.equal(fields[10], "ignore");
});

test("extra UUID cannot become password or mail password", () => {
  assert.equal(map([first, "123456", extra])[2], "ignore");
  assert.equal(map([first, "a@example.com", extra])[2], "ignore");
});

test("proxy detection uses format rather than position", () => {
  assert.equal(map(["123456", "pass", "proxy.example:8080"])[2], "proxy");
  assert.equal(map(["123456", "pass", "", "", "", "", "", "", "", first, "invalid"])[10], "ignore");
});

test("valid proxies and empty values pass; UUID and invalid ports fail", () => {
  for (const value of ["", " ", null, "host:1", "host:65535:user:pass", "user:pass@host:8080", "http://host:80", "https://user:pass@host:443", "http://[::1]:8080"]) {
    assert.equal(isValidProxy(value), true, String(value));
  }
  for (const value of [first, extra, "host", "host:0", "host:65536", "host:abc", "socks5://host:8080"]) {
    assert.equal(isValidProxy(value), false, value);
  }
});

test("existing account fields still map correctly", () => {
  assert.deepEqual(map(["123456", "secret", "ABCDEFGHIJKLMNOP", "c_user=123456; xs=abc", "EAAAabc", "a@example.com", "mailpass", "recovery@example.com", "M.C1_token", first, "host:8080"]),
    ["uid", "password", "two_fa", "cookie", "token", "email", "pass_mail", "mail_recovery", "token_hotmail", "client_id", "proxy"]);
});
