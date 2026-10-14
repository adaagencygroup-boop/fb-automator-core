import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const creatorSource = (await readFile(new URL("../module_04_page_creator/service.js", import.meta.url), "utf8"))
  .replace('import api from "@/services/api";', "");
const source = creatorSource + (await readFile(new URL("./service.js", import.meta.url), "utf8"))
  .replace('import api from "@/services/api";', "const api = globalThis.dashboardTestApi;")
  .replace('import { getCreatedPageHistory } from "@/modules/module_04_page_creator/service";', "");
let moduleId = 0;
async function run(responses) {
  globalThis.dashboardTestApi = { get: async (path) => {
    const result = responses[path];
    if (result instanceof Error) throw result;
    assert.notEqual(result, undefined, `Unexpected API: ${path}`);
    return result;
  } };
  const serviceModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${moduleId++}`);
  return serviceModule.getDashboardStats();
}

test("counts all creation results without treating PARTIAL or unknown as failed", async () => {
  const data = await run({
    "/api/accounts/stats": { total: 0, live: 0, die: 0 },
    "/api/creator/pages/history": [{ status: "success" }, { status: " FAILED " }, { status: "PARTIAL" }, null],
  });
  assert.deepEqual(data.pages, { total: 4, success: 1, failed: 1, other: 2 });
  assert.deepEqual(data.errors, {});
});

test("a Fanpage API failure preserves account statistics and identifies the failed block", async () => {
  const data = await run({
    "/api/accounts/stats": { total: 120, live: 96, die: 24 },
    "/api/creator/pages/history": Object.assign(new Error("database unavailable"), { status: 500 }),
  });
  assert.equal(data.accounts.total, 120);
  assert.equal(data.pages, null);
  assert.match(data.errors.pages, /cơ sở dữ liệu/);
  assert.equal(data.errors.accounts, undefined);
});

test("an account API failure preserves empty Fanpage history as real zero counts", async () => {
  const data = await run({
    "/api/accounts/stats": Object.assign(new Error("missing route"), { status: 404 }),
    "/api/creator/pages/history": [],
  });
  assert.equal(data.accounts, null);
  assert.equal(data.pages.total, 0);
  assert.match(data.errors.accounts, /khởi động lại Engine/);
});

test("unexpected history payload shows a data error rather than an empty success", async () => {
  const data = await run({ "/api/accounts/stats": { total: 0, live: 0, die: 0 }, "/api/creator/pages/history": {} });
  assert.equal(data.pages, null);
  assert.match(data.errors.pages, /định dạng/);
});

test("missing creation history shows zero counts without a Fanpage error", async () => {
  const data = await run({
    "/api/accounts/stats": { total: 2, live: 1, die: 0 },
    "/api/creator/pages/history": Object.assign(new Error("Not Found"), { status: 404 }),
  });
  assert.deepEqual(data.pages, { total: 0, success: 0, failed: 0, other: 0 });
  assert.deepEqual(data.errors, {});
  assert.equal(data.accounts.total, 2);
});

test("authorization failures still show a Fanpage error", async () => {
  const data = await run({
    "/api/accounts/stats": { total: 0, live: 0, die: 0 },
    "/api/creator/pages/history": Object.assign(new Error("Unauthorized"), { status: 401 }),
  });
  assert.equal(data.pages, null);
  assert.match(data.errors.pages, /Phiên đăng nhập/);
});
