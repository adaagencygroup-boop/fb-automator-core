import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { acceptSessionUser, clearSessionUserId, getSessionUserId } from "./sessionIdentity.mjs";

beforeEach(() => {
  const values = new Map();
  globalThis.window = { sessionStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) } };
  clearSessionUserId();
});

test("periodic profile refresh retains the user and rejects an admin identity", () => {
  acceptSessionUser({ id: 21, username: "member", role: "user" });
  assert.equal(acceptSessionUser({ id: 21, username: "member", role: "user" }).username, "member");
  assert.throws(() => acceptSessionUser({ id: 1, username: "admin", role: "admin" }), (error) => error.status === 401 && error.code === "SESSION_IDENTITY_CHANGED");
  assert.equal(getSessionUserId(), "21");
});

test("an explicit login can select a different account after clearing the previous binding", () => {
  acceptSessionUser({ id: 21 });
  clearSessionUserId();
  acceptSessionUser({ id: 22 });
  assert.equal(getSessionUserId(), "22");
});

test("unavailable session storage still prevents identity switching", () => {
  window.sessionStorage.getItem = () => { throw new Error("Storage blocked"); };
  window.sessionStorage.setItem = () => { throw new Error("Storage blocked"); };
  acceptSessionUser({ id: 21 });
  assert.throws(() => acceptSessionUser({ id: 1 }), (error) => error.code === "SESSION_IDENTITY_CHANGED");
});
