const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/lib/api.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
}

function setup(handler) {
  const localStorage = storage({ admin_token: "expired" });
  const sessionStorage = storage();
  const window = { location: { href: "", hostname: "127.0.0.1", protocol: "http:" } };
  const exports = {};
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({ url, options });
    return handler(url, options);
  };
  vm.runInNewContext(compiled, { exports, process: { env: {} }, localStorage, sessionStorage, window, fetch, console });
  return { api: exports.api, localStorage, sessionStorage, window, requests };
}

const response = (status, data) => ({ ok: status >= 200 && status < 300, status, statusText: "error", json: async () => data });

test("concurrent expired requests refresh once and retry with the new bearer token", async () => {
  let refreshes = 0;
  const ctx = setup(async (url, options) => {
    if (url.endsWith("/auth/refresh")) {
      refreshes++;
      assert.equal(options.credentials, "include");
      assert.equal(options.headers["X-Auth-Client"], "admin");
      await new Promise((resolve) => setImmediate(resolve));
      return response(200, { ok: true, access_token: "renewed" });
    }
    if (options.headers.Authorization === "Bearer expired") return response(401, { detail: "TOKEN_INVALID" });
    assert.equal(options.headers.Authorization, "Bearer renewed");
    return response(200, url.endsWith("/me") ? { username: "admin", id: 1 } : []);
  });
  await Promise.all([ctx.api.getAdminMe(), ctx.api.getUsers(), ctx.api.getStats()]);
  assert.equal(refreshes, 1);
  assert.equal(ctx.localStorage.getItem("admin_token"), "renewed");
  assert.equal(ctx.window.location.href, "");
});

test("revoked session redirects without attempting refresh", async () => {
  const ctx = setup(async () => response(401, { detail: "SESSION_REVOKED" }));
  await assert.rejects(ctx.api.getUsers(), { code: "SESSION_REVOKED" });
  assert.equal(ctx.requests.length, 1);
  assert.equal(ctx.localStorage.getItem("admin_token"), null);
  assert.match(ctx.window.location.href, /^\/login\?error=/);
});

test("expired refresh token logs out and does not retry the failed API", async () => {
  const ctx = setup(async () => response(401, { detail: "TOKEN_INVALID" }));
  await assert.rejects(ctx.api.getAdminMe(), { status: 401 });
  assert.equal(ctx.requests.length, 2);
  assert.equal(ctx.localStorage.getItem("admin_token"), null);
  assert.match(ctx.window.location.href, /^\/login\?error=/);
});

for (const failure of ["network", "server"]) {
  test(`temporary ${failure} failure during refresh keeps the session`, async () => {
    const ctx = setup(async (url) => {
      if (url.endsWith("/auth/refresh")) {
        if (failure === "network") throw new TypeError("Failed to fetch");
        return response(503, { detail: "Database unavailable" });
      }
      return response(401, { detail: "TOKEN_INVALID" });
    });
    await assert.rejects(ctx.api.getAdminMe());
    assert.equal(ctx.localStorage.getItem("admin_token"), "expired");
    assert.equal(ctx.window.location.href, "");
  });
}

test("retry remains unauthorized: refresh is bounded to one attempt", async () => {
  const ctx = setup(async (url) => url.endsWith("/auth/refresh")
    ? response(200, { access_token: "renewed" }) : response(401, { detail: "TOKEN_INVALID" }));
  await assert.rejects(ctx.api.getUsers());
  assert.equal(ctx.requests.length, 3);
  assert.match(ctx.window.location.href, /^\/login\?error=/);
});

test("refresh response cannot restore a session after logout", async () => {
  let finish;
  const ctx = setup(() => new Promise((resolve) => { finish = resolve; }));
  const refreshing = ctx.api.refreshAdmin();
  ctx.localStorage.removeItem("admin_token");
  finish(response(200, { access_token: "renewed" }));
  await refreshing;
  assert.equal(ctx.localStorage.getItem("admin_token"), null);
});

test("login failures do not trigger refresh", async () => {
  const ctx = setup(async () => response(401, { detail: "Invalid credentials" }));
  await assert.rejects(ctx.api.adminLogin("admin", "wrong"));
  assert.equal(ctx.requests.length, 1);
  assert.equal(ctx.window.location.href, "");
});
