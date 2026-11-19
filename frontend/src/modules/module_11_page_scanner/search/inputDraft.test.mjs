import { test } from "node:test";
import assert from "node:assert/strict";
import { loadInputDraft, saveInputDraft } from "./inputDraft.mjs";

test("leaving the screen and coming back restores pasted links and the checked file", () => {
  const file = { name: "pages.csv" }; // the original File object is kept, not a copy
  saveInputDraft("7", {
    sourceMode: "upload",
    pasteContent: "https://www.facebook.com/thichcaulonglamnha",
    uploadFile: file,
    uploadPreviewRows: [{ id: "a", status: "valid" }],
  });
  const got = loadInputDraft("7");
  assert.equal(got.sourceMode, "upload");
  assert.equal(got.pasteContent, "https://www.facebook.com/thichcaulonglamnha");
  assert.equal(got.uploadFile, file);
  assert.equal(got.uploadPreviewRows.length, 1);
});

test("another logged-in account does not see someone else's draft", () => {
  saveInputDraft("1", { pasteContent: "link of user 1" });
  assert.equal(loadInputDraft("2"), null);
  assert.equal(loadInputDraft(2), null);
  assert.equal(loadInputDraft(1).pasteContent, "link of user 1"); // number and string id are the same user
});

test("unknown user (not logged in yet) never saves or reads a draft", () => {
  saveInputDraft(null, { pasteContent: "x" });
  saveInputDraft("", { pasteContent: "x" });
  assert.equal(loadInputDraft(null), null);
  assert.equal(loadInputDraft(""), null);
});

test("the stored draft is not changed by editing the returned copy", () => {
  saveInputDraft("9", { pasteContent: "a" });
  const got = loadInputDraft("9");
  got.pasteContent = "changed";
  assert.equal(loadInputDraft("9").pasteContent, "a");
});

test("saving null clears the draft", () => {
  saveInputDraft("5", { pasteContent: "a" });
  saveInputDraft("5", null);
  assert.equal(loadInputDraft("5"), null);
});
