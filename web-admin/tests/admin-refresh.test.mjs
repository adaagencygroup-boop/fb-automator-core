import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/api.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const response = (status, data) => ({ ok: status >= 200 && status < 300, status, statusText: "Error", json: async () => data });
const store = (values = {}) => {
  const items = new Map(Object.entries(values));
  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, value), removeItem: (key) => items.delete(key) };
};
function setup(fetch) {
  const localStorage = store({ admin_token: "expired" });
  const sessionStorage = store();
  const window = { location: { hostname: "localhost", protocol: "http:", href: "/dashboard/users" } };
  const exports = {};
  vm.runInNewContext(compiled, { exports, process: { env: {} }, fetch, localStorage, sessionStorage, window });
  return { api: exports.api, localStorage, window };
}

test("expired access refreshes and retries with new bearer, without logging out", async () => {
  const calls = [];
  const ctx = setup(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/auth/refresh")) return response(200, { access_token: "renewed" });
    return options.headers.Authorization === "Bearer renewed" ? response(200, { id: 1 }) : response(401, { detail: "TOKEN_INVALID" });
  });
  assert.equal((await ctx.api.getAdminMe()).id, 1);
  assert.equal(ctx.localStorage.getItem("admin_token"), "renewed");
  assert.equal(ctx.window.location.href, "/dashboard/users");
  assert.equal(calls.length, 3);
  assert.equal(calls[1].options.headers["X-Auth-Client"], "admin");
  assert.equal(calls[1].options.credentials, "include");
});

test("simultaneous 401 responses share one refresh request", async () => {
  let refreshes = 0;
  const ctx = setup(async (url, options) => {
    if (url.endsWith("/auth/refresh")) { refreshes++; return response(200, { access_token: "renewed" }); }
    return options.headers.Authorization === "Bearer renewed" ? response(200, []) : response(401, { detail: "TOKEN_INVALID" });
  });
  await Promise.all([ctx.api.getUsers(), ctx.api.getStats(), ctx.api.getNotifications()]);
  assert.equal(refreshes, 1);
  assert.equal(ctx.localStorage.getItem("admin_token"), "renewed");
});

test("temporary refresh failure keeps the session for a later retry", async () => {
  const ctx = setup(async (url) => url.endsWith("/auth/refresh") ? response(503, { detail: "Unavailable" }) : response(401, { detail: "TOKEN_INVALID" }));
  await assert.rejects(ctx.api.getStats(), (err) => err.status === 503);
  assert.equal(ctx.localStorage.getItem("admin_token"), "expired");
  assert.equal(ctx.window.location.href, "/dashboard/users");
});

test("revoked refresh requires login and removes the access token", async () => {
  const ctx = setup(async (url) => response(401, { detail: url.endsWith("/auth/refresh") ? "SESSION_REVOKED" : "TOKEN_INVALID" }));
  await assert.rejects(ctx.api.getStats(), (err) => err.code === "SESSION_REVOKED");
  assert.equal(ctx.localStorage.getItem("admin_token"), null);
  assert.match(ctx.window.location.href, /^\/login\?error=/);
});

test("refresh completing after logout cannot restore a token", async () => {
  let resolveRefresh;
  const ctx = setup(() => new Promise((resolve) => { resolveRefresh = resolve; }));
  const pending = ctx.api.refreshAdmin();
  ctx.localStorage.removeItem("admin_token");
  resolveRefresh(response(200, { access_token: "renewed" }));
  await pending;
  assert.equal(ctx.localStorage.getItem("admin_token"), null);
});

test("login sends remember preference in JSON and logout selects admin cookies", async () => {
  const calls = [];
  const ctx = setup(async (url, options) => { calls.push({ url, options }); return response(200, { success: true }); });
  await ctx.api.adminLogin("admin", "test-password", false);
  await ctx.api.logout();
  assert.equal(JSON.parse(calls[0].options.body).remember_me, false);
  assert.ok(!calls[0].url.includes("password"));
  assert.equal(calls[1].options.headers["X-Auth-Client"], "admin");
});

test("a revoked response from an old login retries the newer login without clearing it", async () => {
  let finishOldRequest;
  let ctx;
  ctx = setup(async (url, options) => {
    if (options.headers.Authorization === "Bearer newer-login") return response(200, { id: 1 });
    return new Promise((resolve) => { finishOldRequest = resolve; });
  });
  const pending = ctx.api.getAdminMe();
  ctx.localStorage.setItem("admin_token", "newer-login");
  finishOldRequest(response(401, { detail: "SESSION_REVOKED" }));
  assert.equal((await pending).id, 1);
  assert.equal(ctx.localStorage.getItem("admin_token"), "newer-login");
  assert.equal(ctx.window.location.href, "/dashboard/users");
});

test("a revoked refresh from an old login cannot log out the newer login", async () => {
  let finishRefresh;
  const ctx = setup(() => new Promise((resolve) => { finishRefresh = resolve; }));
  const pending = ctx.api.refreshAdmin();
  ctx.localStorage.setItem("admin_token", "newer-login");
  finishRefresh(response(401, { detail: "SESSION_REVOKED" }));
  await assert.rejects(pending, (err) => err.code === "AUTH_SESSION_CHANGED" && err.status === 409);
  assert.equal(ctx.localStorage.getItem("admin_token"), "newer-login");
  assert.equal(ctx.window.location.href, "/dashboard/users");
});
