import assert from "node:assert/strict";
import test from "node:test";
import { getCallbackAction, LOCAL_CALLBACK_URL, makeLocalCallbackUrl } from "./callback-routing.mjs";

test("profile callback keeps result available without changing its URL", () => {
  const hash = "#state=profile.xyz&access_token=TOKEN&expires_in=3600";
  const action = getCallbackAction(hash);
  assert.equal(action.type, "profile");
  assert.equal(action.result.accessToken, "TOKEN");
});

test("popup callback redirects only to fixed loopback and keeps OAuth result in fragment", () => {
  const action = getCallbackAction("#state=web-popup.xyz&access_token=TOKEN&expires_in=3600");
  const url = new URL(makeLocalCallbackUrl(action.result));
  assert.equal(action.type, "popup");
  assert.equal(url.origin + url.pathname, LOCAL_CALLBACK_URL);
  assert.equal(url.search, "");
  assert.equal(url.hash.includes("TOKEN"), true);
});

test("Facebook denial is forwarded only for the popup flow", () => {
  const action = getCallbackAction("#state=web-popup.xyz&error=access_denied&error_description=User+denied");
  assert.equal(action.type, "popup");
  assert.equal(new URL(makeLocalCallbackUrl(action.result)).hash.includes("User+denied"), true);
  assert.equal(getCallbackAction("#state=unknown.xyz&access_token=TOKEN").type, "invalid");
  assert.equal(getCallbackAction("#access_token=TOKEN").type, "invalid");
});
