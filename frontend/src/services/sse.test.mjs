import test from "node:test";
import assert from "node:assert/strict";
import { connectSSE, readSSE } from "./sse.mjs";

test("SSE decodes split UTF-8, CRLF, comments and multiline data", async () => {
  const bytes = new TextEncoder().encode(': heartbeat\r\ndata: {"message":\r\ndata: "Đã kết nối"}\r\n\r\ndata: ignored');
  const messages = [];
  const body = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  await readSSE(new Response(body), event => messages.push(JSON.parse(event.data)));
  assert.deepEqual(messages, [{ message: "Đã kết nối" }]);
});

test("SSE sends Bearer credentials, refreshes on 401 and cancels on close", async t => {
  const requests = [];
  let token = "expired";
  let refreshed = 0;
  let connection;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, ...options });
    if (requests.length === 1) return new Response("unauthorized", { status: 401 });
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: {"message":"ready"}\n\n')); },
    }), { headers: { "Content-Type": "text/event-stream" } });
  });
  await new Promise((resolve, reject) => {
    connection = connectSSE("http://127.0.0.1:28129/api/accounts/stream", {
      getHeaders: () => ({ Authorization: `Bearer ${token}`, "X-Auth-Client": "user" }),
      onUnauthorized: async () => { refreshed++; token = "fresh"; },
      onOpen: () => {},
      onMessage: event => {
        assert.equal(JSON.parse(event.data).message, "ready");
        connection.close();
        resolve();
      },
      onError: reject,
    });
  });
  assert.equal(refreshed, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers.Authorization, "Bearer expired");
  assert.equal(requests[1].headers.Authorization, "Bearer fresh");
  assert.equal(requests[1].headers["X-Auth-Client"], "user");
  assert.equal(requests[1].credentials, "include");
  assert.equal(requests[1].signal.aborted, true);
});

test("failed SSE handshake reports disconnected without reporting open", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("forbidden", { status: 403 }));
  let opened = false;
  let connection;
  await new Promise(resolve => {
    connection = connectSSE("http://localhost/stream", {
      getHeaders: () => ({}),
      onOpen: () => { opened = true; },
      onMessage: () => {},
      onError: error => { assert.match(error.message, /403/); resolve(); },
    });
  });
  connection.close();
  assert.equal(opened, false);
});
