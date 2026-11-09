import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { clearApiCache, installApiCache, invalidate } from "./api-cache.mjs";

/** Nhường vài lượt microtask cho lượt gọi nền chạy xong */
async function flush(times = 30) {
  for (let i = 0; i < times; i += 1) await new Promise((r) => setImmediate(r));
}

/**
 * Điều cần chứng minh ở đây là thứ tự interceptor.
 *
 * api.js có response interceptor `return response.data`, tức bóc mất object
 * response. Nếu interceptor của cache chạy SAU nó thì nó chỉ nhận được `data`
 * trần và không lưu được gì — cache im lặng không hoạt động, không báo lỗi.
 * Mọi test dưới đây dựng lại đúng thứ tự của api.js: installApiCache trước,
 * rồi mới tới interceptor bóc `.data`.
 */

let calls;

/** Số lần GET thật sự ra mạng — lệnh ghi luôn ra mạng nên không tính vào đây */
function gets(url) {
  return calls.filter((c) => c.method === "get" && (!url || c.url === url)).length;
}

/** Dựng instance mô phỏng api.js, kèm adapter ghi lại mọi request ra mạng */
function buildApi() {
  const api = axios.create({ baseURL: "http://engine.test" });

  api.defaults.adapter = async (config) => {
    calls.push({ url: config.url, method: String(config.method || "get").toLowerCase() });
    return {
      data: { url: config.url, n: calls.length },
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    };
  };

  installApiCache(api);

  // Đúng thứ tự của api.js: interceptor bóc `.data` đăng ký SAU cache
  api.interceptors.response.use((response) => response.data);

  return api;
}

beforeEach(() => {
  calls = [];
  const store = new Map();
  const session = new Map([["fb-automator.user-session-id", "7"]]);
  globalThis.window = {
    localStorage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
    sessionStorage: {
      getItem: (k) => session.get(k) ?? null,
      setItem: (k, v) => session.set(k, v),
      removeItem: (k) => session.delete(k),
    },
  };
  clearApiCache();
});

test("GET thứ hai lấy từ cache, và vẫn trả về data đã bóc", async () => {
  const api = buildApi();

  const first = await api.get("/api/accounts/stats");
  const second = await api.get("/api/accounts/stats");

  assert.equal(gets(), 1, "chỉ được ra mạng một lần");
  assert.deepEqual(second, first, "lần hai phải giống lần một");
  assert.equal(first.url, "/api/accounts/stats", "response interceptor vẫn bóc .data");
});

test("hai request trùng bay cùng lúc chỉ thành một lần gọi", async () => {
  const api = buildApi();

  const [a, b] = await Promise.all([
    api.get("/api/accounts/page", { params: { limit: 10 } }),
    api.get("/api/accounts/page", { params: { limit: 10 } }),
  ]);

  assert.equal(gets(), 1);
  assert.deepEqual(a, b);
});

test("params khác thứ tự nhưng cùng giá trị dùng chung một entry", async () => {
  const api = buildApi();

  await api.get("/api/accounts/page", { params: { limit: 10, active_only: true } });
  await api.get("/api/accounts/page", { params: { active_only: true, limit: 10 } });

  assert.equal(gets(), 1);
});

test("params khác giá trị thì là hai entry riêng", async () => {
  const api = buildApi();

  await api.get("/api/accounts/page", { params: { limit: 10 } });
  await api.get("/api/accounts/page", { params: { limit: 50 } });

  assert.equal(gets(), 2);
});

test("endpoint theo dõi tiến trình không bao giờ bị cache", async () => {
  const api = buildApi();

  for (const url of [
    "/api/post/status",
    "/api/facebook/sync-status",
    "/api/pages/sync-jobs/42",
    "/api/v1/auth/me",
  ]) {
    calls = [];
    await api.get(url);
    await api.get(url);
    assert.equal(gets(), 2, `${url} phải gọi lại mỗi lần`);
  }
});

test("fresh: true bỏ qua cache và cập nhật lại entry", async () => {
  const api = buildApi();

  const first = await api.get("/api/pages");
  const forced = await api.get("/api/pages", { fresh: true });

  assert.equal(gets(), 2, "fresh phải ra mạng");
  assert.notDeepEqual(forced, first, "phải là dữ liệu mới");

  const after = await api.get("/api/pages");
  assert.equal(gets(), 2, "lần sau dùng lại entry đã cập nhật");
  assert.deepEqual(after, forced);
});

test("lệnh ghi xoá cache cùng nhánh", async () => {
  const api = buildApi();

  await api.get("/api/accounts/stats");
  assert.equal(gets(), 1);

  await api.post("/api/accounts/123/check");
  await api.get("/api/accounts/stats");

  assert.equal(gets(), 2, "ghi vào /api/accounts phải làm stats hết hiệu lực");
});

test("ghi ở nhánh khác không xoá oan", async () => {
  const api = buildApi();

  await api.get("/api/accounts/stats");
  await api.post("/api/pages/sync");
  await api.get("/api/accounts/stats");

  assert.equal(gets(), 1, "ghi vào /api/pages không được ảnh hưởng /api/accounts");
});

test("ẩn bình luận xoá cache bài viết dù khác nhánh URL", async () => {
  const api = buildApi();

  await api.get("/api/facebook/posts/999/comments");
  assert.equal(gets(), 1);

  await api.post("/api/facebook/comments/abc/hide");
  await api.get("/api/facebook/posts/999/comments");

  assert.equal(gets(), 2, "ghi ở /comments phải làm /posts hết hiệu lực");
});

test("đánh dấu đã đọc chỉ xoá hội thoại, giữ cache bài viết", async () => {
  const api = buildApi();

  await api.get("/api/facebook/posts/999/comments");
  await api.get("/api/facebook/conversations");
  assert.equal(gets(), 2);

  await api.put("/api/facebook/conversations/p1/s1/read");

  await api.get("/api/facebook/posts/999/comments");
  assert.equal(gets(), 2, "bài viết phải còn trong cache");

  await api.get("/api/facebook/conversations");
  assert.equal(gets(), 3, "hội thoại phải được tải lại");
});

test("đổi người dùng thì không dùng chung cache", async () => {
  const api = buildApi();

  await api.get("/api/accounts/stats");
  globalThis.window.sessionStorage.setItem("fb-automator.user-session-id", "99");
  await api.get("/api/accounts/stats");

  assert.equal(gets(), 2, "userId khác phải là entry khác");
});

test("invalidate() xoá theo prefix cho optimistic update", async () => {
  const api = buildApi();

  await api.get("/api/facebook/posts/999");
  assert.equal(gets(), 1);

  invalidate("/api/facebook/posts");
  await api.get("/api/facebook/posts/999");

  assert.equal(gets(), 2);
});

test("cờ tắt đưa về nguyên trạng không cache", async () => {
  globalThis.window.localStorage.setItem("api-cache", "0");
  const api = buildApi();

  await api.get("/api/accounts/stats");
  await api.get("/api/accounts/stats");

  assert.equal(gets(), 2, "tắt cờ thì mọi request đều ra mạng");
});

/**
 * Hai ngưỡng soft / hard — phần quan trọng nhất của cache này.
 *
 * Chỉ giả lập `Date` chứ không giả lập setTimeout: thư viện và axios vẫn cần
 * timer thật để chạy, mình chỉ cần tua đồng hồ để entry "già" đi.
 */
afterEach(() => {
  mock.timers.reset();
});

test("đọc từ cache là trả ngay dữ liệu cũ rồi làm mới ở nền", async () => {
  mock.timers.enable({ apis: ["Date"] });
  const api = buildApi();
  const url = "/api/facebook/posts/1"; // soft 30s, hard 7 ngày

  const first = await api.get(url);
  assert.equal(first.n, 1);
  assert.equal(gets(), 1);

  mock.timers.tick(60_000); // quá soft, chưa quá hard

  const second = await api.get(url);
  assert.equal(second.n, 1, "phải trả dữ liệu cũ chứ không chờ mạng");

  await flush();
  assert.equal(gets(), 2, "nền phải đã gọi lại một lượt");

  const third = await api.get(url);
  assert.equal(third.n, 2, "lần vào sau đã thấy dữ liệu mới");
  assert.equal(gets(), 2, "và lần đó không phải ra mạng");
});

test("quá hard thì chịu chờ mạng, và chỉ gọi đúng một lượt", async () => {
  mock.timers.enable({ apis: ["Date"] });
  const api = buildApi();
  const url = "/api/facebook/messages"; // soft 10s, hard 60s

  const first = await api.get(url, { params: { page_id: "p", sender_id: "s" } });
  assert.equal(first.n, 1);

  mock.timers.tick(120_000); // quá hard

  const second = await api.get(url, { params: { page_id: "p", sender_id: "s" } });
  await flush();

  assert.equal(second.n, 2, "quá hard phải là dữ liệu mới");
  assert.equal(gets(), 2, "không được vừa chờ mạng vừa kích thêm lượt nền");
});

test("nhiều chỗ cùng gọi chỉ sinh một lượt nền", async () => {
  mock.timers.enable({ apis: ["Date"] });
  const api = buildApi();
  const url = "/api/accounts/stats"; // soft 120s

  await api.get(url);
  mock.timers.tick(300_000);

  await Promise.all([api.get(url), api.get(url), api.get(url)]);
  await flush();

  assert.equal(gets(), 2, "ba lần đọc + đúng một lượt làm mới nền");
});

test("lượt nền hỏng thì không làm vỡ gì, dữ liệu cũ vẫn dùng được", async () => {
  mock.timers.enable({ apis: ["Date"] });
  const api = buildApi();
  const url = "/api/dashboard/stats"; // soft 60s

  const first = await api.get(url);
  mock.timers.tick(120_000);

  // Từ đây engine trả 500. Adapter thật gọi settle() nên 4xx/5xx thành reject;
  // adapter tự viết thì phải tự ném AxiosError, không thì 500 lại hoá thành công.
  api.defaults.adapter = async (config) => {
    calls.push({ url: config.url, method: String(config.method || "get").toLowerCase() });
    const response = {
      data: { detail: "Internal Server Error" },
      status: 500,
      statusText: "Internal Server Error",
      headers: {},
      config,
    };
    throw new axios.AxiosError(
      "Request failed with status code 500",
      axios.AxiosError.ERR_BAD_RESPONSE,
      config,
      null,
      response,
    );
  };

  const second = await api.get(url);
  assert.equal(second.n, first.n, "vẫn trả dữ liệu cũ");

  await flush();

  const third = await api.get(url);
  assert.equal(third.n, first.n, "lượt nền lỗi không được xoá mất entry");
});

test("endpoint bị loại trừ không được hưởng cơ chế hai ngưỡng", async () => {
  mock.timers.enable({ apis: ["Date"] });
  const api = buildApi();

  await api.get("/api/post/status");
  mock.timers.tick(1_000);
  await api.get("/api/post/status");
  await flush();

  assert.equal(gets(), 2, "mỗi lần hỏi là một lần ra mạng, không có nền");
});

/**
 * Hồi quy cho đúng lỗi đã gặp: vào module 06 vẫn thấy skeleton.
 *
 * `fetchAll` của module 06 là Promise.all của bốn lệnh — pages, conversations,
 * notifications, status. Chỉ cần MỘT lệnh không được cache là cả bốn phải chờ
 * mạng và ba cache hit kia thành vô nghĩa. Regex `/status` ban đầu quét cả
 * `/api/facebook/status` nên gây ra đúng chuyện đó.
 */
test("/api/facebook/status được cache dù tên có chữ status", async () => {
  const api = buildApi();

  await api.get("/api/facebook/status");
  await api.get("/api/facebook/status");

  assert.equal(gets(), 1, "đây là cổng vào, không phải cờ tiến trình");
});

test("cả bốn lệnh của fetchAll đều hưởng cache", async () => {
  const api = buildApi();

  const fetchAll = () => Promise.all([
    api.get("/api/facebook/pages"),
    api.get("/api/facebook/conversations"),
    api.get("/api/facebook/notifications", { params: { type: "interaction", filter: "all" } }),
    api.get("/api/facebook/status"),
  ]);

  await fetchAll();
  assert.equal(gets(), 4, "lần đầu phải ra mạng đủ bốn");

  await fetchAll();
  assert.equal(gets(), 4, "lần vào lại không được ra mạng lần nào");
});

test("mọi endpoint tiến trình có vòng setInterval đều bị loại trừ", async () => {
  const api = buildApi();

  // Danh sách này lấy từ các hàm thật sự được gọi trong setInterval ở src/modules
  for (const url of [
    "/api/post/status",                 // module 03
    "/api/pages/ai/status",             // getAiPostStatus
    "/api/pages/jobs/77",               // getJobStatus
    "/api/pages/sync-jobs/42",          // job đồng bộ page
    "/api/pages/tiktok/auth-status",    // getTikTokAuthStatus
    "/api/facebook/sync-status",        // getSyncStatus
    "/api/group-scan/check-status",     // module 10
    "/api/farm/status",                 // module 03
  ]) {
    calls = [];
    await api.get(url);
    await api.get(url);
    assert.equal(gets(), 2, `${url} phải gọi lại mỗi lần`);
  }
});

test("rời Chat cả tiếng rồi quay lại: fetchAll vẫn không chờ mạng lần nào", async () => {
  mock.timers.enable({ apis: ["Date"] });
  const api = buildApi();

  const fetchAll = () => Promise.all([
    api.get("/api/facebook/pages"),
    api.get("/api/facebook/conversations"),
    api.get("/api/facebook/notifications", { params: { type: "interaction", filter: "all" } }),
    api.get("/api/facebook/status"),
  ]);

  const first = await fetchAll();
  assert.equal(gets(), 4, "lần đầu ra mạng đủ bốn");

  mock.timers.tick(60 * 60 * 1000); // một tiếng — quá mọi ngưỡng soft

  const second = await fetchAll();

  // Kiểm theo GIÁ TRỊ chứ không theo số lần gọi: bốn lượt làm mới nền chạy
  // xong ngay trong await (adapter test resolve tức thì), nên đếm số lần
  // không phân biệt được "trả từ cache" với "chờ mạng". Giá trị thì có.
  assert.deepEqual(
    second.map((r) => r.n),
    first.map((r) => r.n),
    "phải trả đúng dữ liệu cũ từ cache, không lệnh nào chờ mạng",
  );

  await flush();
  assert.equal(gets(), 8, "và bốn lượt làm mới nền đã chạy");
});

test("tin nhắn vẫn giữ hard hữu hạn vì không nằm trong fetchAll", async () => {
  mock.timers.enable({ apis: ["Date"] });
  const api = buildApi();
  const P = { params: { page_id: "p", sender_id: "s" } };

  await api.get("/api/facebook/messages", P);
  mock.timers.tick(10 * 60 * 1000); // 10 phút, quá hard 60s

  const after = await api.get("/api/facebook/messages", P);
  await flush();

  assert.equal(after.n, 2, "mở lại hội thoại cũ thì phải lấy tin mới");
});

test("đọc là làm mới: không cần entry phải cũ, chỉ cần vượt sàn chống bão", async () => {
  mock.timers.enable({ apis: ["Date"] });
  const api = buildApi();
  const url = "/api/accounts/stats";

  await api.get(url);
  assert.equal(gets(), 1);

  // Chỉ 2 giây — trước đây soft của endpoint này là 120s nên sẽ KHÔNG làm mới.
  mock.timers.tick(2_000);

  const second = await api.get(url);
  assert.equal(second.n, 1, "vẫn trả ngay dữ liệu cũ");

  await flush();
  assert.equal(gets(), 2, "và đã kích lượt làm mới nền dù entry mới 2 giây");
});

test("sàn chống bão: gọi lại trong cùng giây thì không kích lượt nền", async () => {
  mock.timers.enable({ apis: ["Date"] });
  const api = buildApi();
  const url = "/api/accounts/stats";

  await api.get(url);
  mock.timers.tick(200); // dưới sàn 1 giây

  await api.get(url);
  await flush();

  assert.equal(gets(), 1, "không được bơm thêm request");
});
