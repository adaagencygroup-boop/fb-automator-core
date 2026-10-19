import { test } from "node:test";
import assert from "node:assert/strict";
import { detectColumnMapping, isValidProxy, mapImportedRow } from "./import-mapping.mjs";

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

test("Facebook EAA prefixes stay in token at different positions and lengths", () => {
  for (const prefix of ["EAAA", "EAAB", "EAAG", "eaab"]) {
    for (const length of [85, 180]) {
      const token = prefix + "a".repeat(length);
      for (const values of [["123456", "pass", token], [token, "123456", "pass"], ["123456", "pass", "M.C1_mail", token]]) {
        const mapping = map(values);
        assert.equal(mapping[values.indexOf(token)], "token");
        assert.notEqual(mapping[values.indexOf(token)], "token_hotmail");
      }
    }
  }
});

test("multiple rows may mix Facebook prefixes and empty cells in the same column", () => {
  const rows = ["123456|pass|  EAAB" + "a".repeat(160) + "  ", "234567|pass|", "345678|pass|EAAAabc", "456789|pass|EAAGdef"];
  assert.equal(detectColumnMapping(rows, "|", 3)[2], "token");
});

test("Facebook and supported Hotmail tokens remain separate in either order", () => {
  const facebook = "EAAB" + "a".repeat(180);
  for (const mail of ["M.C1_token", "MsaArtifacts_example", "EwBexample", "opaque_" + "x".repeat(100)]) {
    assert.deepEqual(map(["123456", "pass", facebook, mail]), ["uid", "password", "token", "token_hotmail"]);
    assert.deepEqual(map(["123456", "pass", mail, facebook]), ["uid", "password", "token_hotmail", "token"]);
  }
});

test("a conflicting token column is ignored even at password and token fallback positions", () => {
  for (const index of [1, 4, 8]) {
    const a = Array(index + 1).fill(""); a[0] = "123456"; a[index] = "EAAB" + "a".repeat(180);
    const b = [...a]; b[0] = "234567"; b[index] = "M.C1_mail";
    assert.equal(detectColumnMapping([a.join("|"), b.join("|")], "|", a.length)[index], "ignore");
  }
  assert.deepEqual(map(["123456", "pass", "EAABabc", "EAAAdef"]), ["uid", "password", "token", "ignore"]);
});

test("mapped rows preserve Facebook tokens and manual choices without moving mail_recovery", () => {
  const facebook = "EAAB" + "a".repeat(180);
  const line = `123456|pass| ${facebook} |M.C1_mail`;
  const suggested = detectColumnMapping([line], "|", 4);
  assert.deepEqual(mapImportedRow(line, "|", suggested), { uid: "123456", password: "pass", token: facebook, token_hotmail: "M.C1_mail" });
  assert.deepEqual(mapImportedRow(line, "|", ["uid", "password", "ignore", "token"]), { uid: "123456", password: "pass", token: "M.C1_mail" });
  const manual = mapImportedRow(line, "|", ["uid", "password", "mail_recovery", "token_hotmail"]);
  assert.equal(manual.mail_recovery, facebook);
  assert.equal(manual.token_hotmail, "M.C1_mail");
  assert.equal(mapImportedRow(`123456|pass|${facebook}`, "|", ["uid", "password", "mail_recovery"]).token_hotmail, undefined);
});
