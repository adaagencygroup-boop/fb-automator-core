import assert from "node:assert/strict";
import test from "node:test";
import { connectionLabel, forgetPopupContext, openOAuthPopup, readPopupContext, safeReturnPath, switchAuthorizationUrl, switchPreparationPath, terminalJob } from "../src/modules/module_05_page_manager/webOAuth.mjs";

test("popup is opened before the asynchronous API request and dashboard stays in place", async () => {
  const events = [];
  const values = new Map();
  const popup = { sessionStorage: { setItem: (key, value) => values.set(key, value), getItem: (key) => values.get(key), removeItem: (key) => values.delete(key) },
    location: { replace: (url) => events.push(url) }, close: () => events.push("close") };
  const browser = { location: { href: "http://localhost:3000/pages/list?filter=mine#table", origin: "http://localhost:3000" },
    open: () => { events.push("open"); return popup; } };
  const result = await openOAuthPopup(browser, async (reason) => {
    events.push("api:" + reason);
    return { job_id: "job", state: "web-popup.state", authorization_url: "https://www.facebook.com/dialog/oauth?state=web-popup.state" };
  }, "owner-a", "switch");
  assert.deepEqual(events, ["open", "api:switch", "http://localhost:3000" + switchPreparationPath("web-popup.state")]);
  assert.equal(result.attempt.job_id, "job");
  assert.equal(browser.location.href, "http://localhost:3000/pages/list?filter=mine#table");
  assert.deepEqual(readPopupContext("web-popup.state", popup.sessionStorage), {
    owner: "owner-a", jobId: "job", mode: "popup", returnTo: "/pages/list?filter=mine#table",
    reason: "switch", authorizationUrl: "https://www.facebook.com/dialog/oauth?state=web-popup.state", previousIdentity: null,
  });
  assert.doesNotMatch([...values.values()].join(), /access_token/);
  forgetPopupContext("web-popup.state", popup.sessionStorage);
  assert.equal(readPopupContext("web-popup.state", popup.sessionStorage), null);
});

test("switch continuation only accepts the Meta OAuth URL for its own state", () => {
  const context = { reason: "switch", authorizationUrl: "https://www.facebook.com/v20.0/dialog/oauth?state=web-popup.correct" };
  assert.equal(switchAuthorizationUrl(context, "web-popup.correct"), context.authorizationUrl);
  assert.equal(switchAuthorizationUrl(context, "web-popup.wrong"), null);
  for (const url of ["javascript:alert(1)", "https://evil.example/dialog/oauth?state=x", "https://www.facebook.com.evil.example/dialog/oauth?state=x", "https://www.facebook.com/logout?state=x"]) {
    assert.equal(switchAuthorizationUrl({ reason: "switch", authorizationUrl: url }, "x"), null);
  }
});

test("switch without browser storage falls back to OAuth without claiming a different identity", async () => {
  let target;
  const browser = { location: { href: "http://localhost:3000/pages/list", origin: "http://localhost:3000" },
    open: () => ({ sessionStorage: { setItem: () => { throw Error("blocked"); } }, location: { replace: (url) => { target = url; } }, close: () => {} }) };
  await openOAuthPopup(browser, async () => ({ job_id: "j", state: "s", authorization_url: "https://www.facebook.com/dialog/oauth?state=s" }), "a", "switch");
  assert.equal(target, "https://www.facebook.com/dialog/oauth?state=s");
});

test("a blocked popup never starts an OAuth job", async () => {
  let started = false;
  await assert.rejects(openOAuthPopup({ open: () => null }, async () => { started = true; }, "a"), /chặn popup/);
  assert.equal(started, false);
});

test("an API failure closes only the newly opened blank popup", async () => {
  let closed = 0;
  await assert.rejects(openOAuthPopup({ open: () => ({ close: () => closed++ }) }, async () => { throw new Error("failed"); }, "a"), /failed/);
  assert.equal(closed, 1);
});

test("return navigation cannot leave the dashboard origin", () => {
  const origin = "http://localhost:3000";
  for (const input of ["https://evil.example/path", "//evil.example/path", "javascript:alert(1)", "http://127.0.0.1:3000/pages/list"]) {
    assert.equal(safeReturnPath(input, origin), "/pages/list");
  }
  assert.equal(safeReturnPath("/pages/list?filter=mine#table", origin), "/pages/list?filter=mine#table");
});

test("button describes a saved connection and never claims a live browser login", () => {
  assert.equal(connectionLabel(null), "Kết nối Facebook");
  assert.equal(connectionLabel({ connected: true, identity: { name: "Person A" }, token_state: "valid_at_last_check" }), "Đã kết nối: Person A");
  assert.equal(connectionLabel({ connected: true, identity: { name: "Person A" }, token_state: "expired" }), "Cần kết nối lại: Person A");
  for (const status of ["AWAITING_OAUTH", "AWAITING_CONFIRMATION", "QUEUED", "RUNNING", "COMMITTING"]) assert.equal(terminalJob(status), false);
  for (const status of ["SUCCEEDED", "CANCELLED", "FAILED"]) assert.equal(terminalJob(status), true);
});
