import test from "node:test";
import assert from "node:assert/strict";
import { formatUidsForCopy, formatAccountRowForCopy, formatAccountsForCopy } from "./account-export.mjs";
import { DEFAULT_MAPPING, mapImportedRow } from "./import-mapping.mjs";

test("formatUidsForCopy outputs one UID per line and skips blanks", () => {
  const result = formatUidsForCopy([
    { uid: "100001" },
    { uid: "  " },
    { uid: "100002" },
    { uid: null },
  ]);
  assert.equal(result, "100001\n100002");
});

test("formatAccountRowForCopy preserves 11-column DEFAULT_MAPPING order and round-trips through mapImportedRow", () => {
  const row = {
    uid: "100012345678",
    password: "P@ssword\n123",
    twofa_secret: "JBSWY3DPEHPK3PXP",
    cookie: "c_user=100012345678; xs=abc",
    token: "EAAGm0PX4ZCpsBA",
    email: "user@example.com",
    pass_mail: "MailPass!",
    mail_recovery: "",
    token_hotmail: null,
    client_id: "cid-1",
    proxy: "1.2.3.4:8080:u:p",
  };

  const line = formatAccountRowForCopy(row);
  assert.equal(
    line,
    "100012345678|P@ssword 123|JBSWY3DPEHPK3PXP|c_user=100012345678; xs=abc|EAAGm0PX4ZCpsBA|user@example.com|MailPass!|||cid-1|1.2.3.4:8080:u:p",
  );
  assert.equal(line.split("|").length, DEFAULT_MAPPING.length);

  const parsed = mapImportedRow(line, "|", DEFAULT_MAPPING);
  assert.equal(parsed.uid, "100012345678");
  assert.equal(parsed.password, "P@ssword 123");
  assert.equal(parsed.two_fa, "JBSWY3DPEHPK3PXP");
  assert.equal(parsed.cookie, "c_user=100012345678; xs=abc");
  assert.equal(parsed.token, "EAAGm0PX4ZCpsBA");
  assert.equal(parsed.email, "user@example.com");
  assert.equal(parsed.pass_mail, "MailPass!");
  assert.equal(parsed.mail_recovery, "");
  assert.equal(parsed.token_hotmail, "");
  assert.equal(parsed.client_id, "cid-1");
  assert.equal(parsed.proxy, "1.2.3.4:8080:u:p");
});

test("formatAccountsForCopy joins multiple account rows with newlines", () => {
  const text = formatAccountsForCopy([
    { uid: "1001", password: "pw1" },
    { uid: "1002", two_fa: "2fa2", proxy: "1.1.1.1:80" },
  ]);
  const lines = text.split("\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "1001|pw1|||||||||");
  assert.equal(lines[1], "1002||2fa2||||||||1.1.1.1:80");
});
