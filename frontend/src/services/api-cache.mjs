/**
 * Cache cho toàn bộ API GET, gắn ở tầng axios.
 *
 * Đặt ở đây thay vì sửa từng chỗ gọi là có chủ ý: cả frontend có 118 chỗ
 * `api.get` nằm rải trong 12 module của 12 người, nhưng tất cả đều đi qua một
 * instance axios duy nhất. Gắn một lần ở instance thì 89 endpoint có cache
 * ngay, không ai phải sửa một dòng nào trong module của mình.
 *
 * Vì sao cần: DB là Supabase ở ap-northeast-1 (Tokyo), nên mỗi query trả giá
 * RTT từ Việt Nam sang Nhật. Độ chậm là cấu trúc, không phải thiếu index —
 * giảm SỐ LẦN gọi là đòn hiệu quả nhất.
 *
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TRẢ CACHE NGAY, LUÔN GỌI LẠI Ở NỀN
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Mỗi lần một GET được cache phục vụ, cache đó cũng được gọi lại ngay ở nền.
 * Không có ngưỡng "đủ cũ mới làm mới" — cứ đọc là làm mới.
 *
 * Nghĩa là số request xuống server KHÔNG giảm so với lúc chưa có cache. Thứ
 * cache này mua về là độ trễ: màn hình có dữ liệu ngay thay vì chờ một vòng
 * sang Tokyo. Đó là lựa chọn có chủ ý, không phải sơ suất.
 *
 * Ngưỡng duy nhất còn lại là `hard`: quá mốc đó thì dữ liệu cũ quá, không dám
 * hiện — chịu chờ mạng. Phần lớn endpoint đặt KHONG_CHAN, tức không bao giờ
 * hiện loading từ lần thứ hai trở đi. Chỉ tin nhắn đặt hữu hạn, vì hiện nguyên
 * đoạn chat của hôm qua thì sai nghiêm trọng.
 *
 * Từ tầng axios không nhìn thấy được "đổi trang" — chỉ thấy component mount
 * rồi gọi API. Nên "làm mới khi đổi trang" ở đây hiện thực thành "làm mới mỗi
 * lần đọc từ cache". Trên thực tế trùng nhau, nhưng rộng hơn một chút.
 *
 * GIỚI HẠN PHẢI BIẾT: lượt gọi nền KHÔNG đẩy được dữ liệu mới vào component
 * đang hiển thị. Lúc nó về thì promise của component đã đóng và state đã set
 * xong rồi. Nên dữ liệu mới chỉ xuất hiện ở LẦN VÀO SAU — tức màn hình có thể
 * chậm một lượt so với server. Muốn hội tụ ngay trong lượt đang xem thì phải
 * có cơ chế đăng ký theo dõi để component render lại (TanStack Query), và việc
 * đó buộc phải sửa từng chỗ gọi.
 *
 * Bù lại: mọi lệnh ghi đều tự xoá cache liên quan, nên thao tác của chính
 * người dùng không bao giờ bị chậm một lượt. Chỉ thay đổi từ bên ngoài (máy
 * khác, hoặc Facebook tự đổi) mới có thể về muộn một lượt.
 *
 * Cache này cũng KHÔNG cứu được lần tải đầu sau khi mở app (cache còn rỗng,
 * không phải quá hạn) và mọi thao tác ghi.
 */

import { setupCache, buildMemoryStorage } from "axios-cache-interceptor";
import { getSessionUserId } from "./sessionIdentity.mjs";

/** Phân tách trong khoá cache — ký tự điều khiển nên không đụng dữ liệu thật */
const SEP = "\u0001";

/** Số entry giữ tối đa; vượt thì thư viện bỏ entry cũ nhất */
const MAX_ENTRIES = 300;

/**
 * Mốc "không bao giờ chặn" — 7 ngày. Dùng số thật thay cho Infinity vì thư
 * viện đem cộng với `createdAt` để tính hạn.
 */
const KHONG_CHAN = 7 * 24 * 60 * 60 * 1000;

/**
 * Những URL KHÔNG BAO GIỜ được cache.
 *
 * Đây là phần dễ gây lỗi nhất của cả file. Frontend có 36 chỗ `setInterval`
 * đang poll tiến trình công việc; cache vào đó là thanh tiến trình đứng im
 * vĩnh viễn và người dùng tưởng treo. Mấy endpoint này không liên quan tới
 * chuyện skeleton — chúng chạy ngầm, không ai nhìn — nên loại hẳn.
 *
 * Thêm endpoint mới kiểu "trạng thái, tiến độ, đang chạy" thì phải thêm vào đây.
 */
const NEVER_CACHE = [
  // Lưới an toàn: mọi đường dẫn kết thúc bằng `/status`. Cố tình để rộng, để
  // endpoint tiến trình do người khác thêm sau này mặc định được loại trừ mà
  // họ không cần biết tới file này. Cái nào rộng quá thì cho vào CACHE_ANYWAY.
  /\/status(\?|$)/,
  /\/sync-status(\?|$)/,                // getSyncStatus (module 06)
  /\/api\/post\/status/,                // module 03 đăng bài
  /\/api\/pages\/jobs\//,               // getJobStatus (module 05) — job đăng bài
  /\/sync-jobs\//,                      // module 05 job đồng bộ page
  /\/api\/pages\/tiktok\/auth-status/,  // getTikTokAuthStatus (module 05)
  /\/api\/group-scan\/check-status/,    // module 10
  /\/seeding\/campaigns\/[^/?]+(\?|$)/, // getSeedingCampaignDetail (module 08)
  /\/scan\/sessions\/[^/?]+(\?|$)/,     // getScanSessionDetail (module 10)
  /\/api\/v1\/auth\//,                  // đăng nhập, refresh, /me — danh tính không được cache
  /\/api\/v1\/admin\//,
];

/**
 * Ngoại lệ thắng NEVER_CACHE: đã xác minh là dữ liệu ổn định, không phải cờ
 * tiến trình, nên tên có chữ "status" chỉ là trùng.
 *
 * Mỗi dòng ở đây phải kiểm chứng được là KHÔNG nằm trong vòng `setInterval`
 * nào. Cách kiểm: grep các hàm được gọi trong setInterval ở src/modules.
 */
const CACHE_ANYWAY = [
  // getChatStatus — chỉ trả {has_accounts, has_pages, ...}, là cổng vào module
  // 06. Nó nằm trong `Promise.all` của fetchAll cùng pages/conversations/
  // notifications, nên loại trừ nó là cả bốn phải chờ mạng và ba cache hit
  // kia thành vô nghĩa: vào Chat vẫn thấy skeleton.
  /\/api\/facebook\/status(\?|$)/,
];

/**
 * [khớp URL, hard] — xét từ trên xuống, khớp đầu tiên thì lấy.
 *
 * Chỉ còn một ngưỡng: `hard`. Việc làm mới không cần ngưỡng nữa vì đọc là làm
 * mới, nên đặt hữu hạn ở đây chỉ để chặn hiện dữ liệu cũ tới mức sai.
 */
const RULES = [
  [/\/api\/accounts\/(stats|categories)/, KHONG_CHAN],
  [/\/api\/accounts\/page/, KHONG_CHAN],
  [/\/api\/accounts(\?|$)/, KHONG_CHAN],
  [/\/api\/pages\/(history|accounts)/, KHONG_CHAN],
  [/\/api\/pages(\?|$)/, KHONG_CHAN],
  [/\/api\/dashboard\//, KHONG_CHAN],
  [/\/api\/creator\//, KHONG_CHAN],
  [/\/api\/facebook\/pages/, KHONG_CHAN],
  [/\/api\/facebook\/status/, KHONG_CHAN],
  [/\/api\/facebook\/posts\//, 0],

  // Hội thoại và thông báo: hard = KHONG_CHAN, tức không bao giờ chặn.
  //
  // Hai lệnh này nằm trong `Promise.all` của `fetchAll` (module 06) cùng
  // pages và status. Promise.all chờ lệnh chậm nhất, nên chỉ cần MỘT lệnh quá
  // hard là cả bốn phải chờ mạng và màn hình lại hiện skeleton. Đặt hạn hữu
  // hạn ở đây đồng nghĩa "cứ rời Chat quá hạn đó là thấy skeleton khi quay
  // lại" — đúng thứ cần tránh.
  //
  // Đổi lại: danh sách có thể chậm một lượt so với server. Chấp nhận được vì
  // tin và thông báo mới vẫn về realtime qua WebSocket và được ghép thẳng vào
  // state, còn khi WebSocket chết thì vòng hỏi lại 10 giây đã gọi kèm `fresh`.
  [/\/api\/facebook\/conversations/, KHONG_CHAN],
  [/\/api\/facebook\/notifications/, KHONG_CHAN],

  // Tin nhắn là ngoại lệ duy nhất còn giữ hard hữu hạn, và có lý do riêng:
  // nó KHÔNG nằm trong fetchAll nên không gây skeleton lúc vào trang. Nó tải
  // khi bấm mở một hội thoại — một cú bấm có chủ đích, chờ một nhịp là bình
  // thường, còn hiện nguyên đoạn hội thoại cũ của hôm qua thì sai nghiêm trọng.
  [/\/api\/facebook\/messages/, 60_000],
];

const DEFAULT_HARD = KHONG_CHAN;

/**
 * Sàn chống bão: không kích lượt nền cho entry mới hơn mốc này.
 *
 * Không mâu thuẫn với "đọc là làm mới": đổi trang cách nhau ít nhất vài giây,
 * nên đổi trang luôn vượt sàn. Sàn chỉ chặn trường hợp một component gọi lại
 * cùng endpoint nhiều lần liên tiếp trong cùng một giây — lúc đó làm mới mỗi
 * lần là bơm request vô ích. Muốn đúng nghĩa "mọi lần" thì đặt về 0.
 */
const REFRESH_FLOOR = 1_000;

/**
 * Cờ tắt. Cache toàn cục là đổi hành vi của 11 module mình không sở hữu, nên
 * phải có đường về nguyên trạng tức thì mà không cần build lại:
 *
 *   localStorage.setItem("api-cache", "0")  rồi tải lại trang
 */
function readEnabled() {
  if (typeof window === "undefined") return false; // không cache khi render phía server
  try {
    return window.localStorage.getItem("api-cache") !== "0";
  } catch {
    return true; // localStorage bị chặn thì vẫn cache trong bộ nhớ
  }
}

function isNeverCached(url) {
  const target = String(url || "");
  if (CACHE_ANYWAY.some((re) => re.test(target))) return false;
  return NEVER_CACHE.some((re) => re.test(target));
}

function hardFor(url) {
  const target = String(url || "");
  for (const [re, hard] of RULES) {
    if (re.test(target)) return hard;
  }
  return DEFAULT_HARD;
}

/**
 * Params thành chuỗi ổn định: sắp khoá theo thứ tự chữ cái để `{a:1,b:2}` và
 * `{b:2,a:1}` ra cùng một khoá, không thì cùng một request lại thành hai entry.
 */
function stableParams(params) {
  if (!params || typeof params !== "object") return "";
  const keys = Object.keys(params).filter((k) => params[k] !== undefined).sort();
  return keys.map((k) => `${k}=${String(params[k])}`).join("&");
}

/**
 * Khoá cache. PHẢI có userId — thiếu nó là dữ liệu người này lọt sang người
 * khác khi đổi tài khoản, lỗi nặng nhất có thể gây ra ở file này.
 */
function keyOf(config) {
  const uid = getSessionUserId() || "anon";
  const method = String(config?.method || "get").toLowerCase();
  return [uid, method, config?.url || "", stableParams(config?.params)].join(SEP);
}

/** Phần URL nằm trong khoá, dùng lại khi xoá theo prefix */
function urlOfKey(key) {
  return String(key).split(SEP)[2] || "";
}

let storage = null;

/** Khoá đang có một lượt gọi nền — chặn nhiều component cùng kích một lượt */
const refreshing = new Set();

/**
 * Tuổi của entry đang dùng được, tính bằng ms. `null` nghĩa là không có gì
 * dùng được (chưa có, hoặc đang tải).
 */
function ageOf(key) {
  const entry = storage?.data?.get(key);
  if (!entry || entry.state !== "cached" || typeof entry.createdAt !== "number") return null;
  return Date.now() - entry.createdAt;
}

/**
 * Gọi lại ở nền để cập nhật cache. Không ai chờ kết quả này, nên lỗi thì im
 * lặng bỏ qua — người dùng đã nhận được dữ liệu cũ và không nên bị quấy vì
 * một lượt làm mới ngầm.
 */
function scheduleRefresh(api, config, key) {
  if (refreshing.has(key)) return;
  refreshing.add(key);

  api
    .get(config.url, {
      params: config.params,
      headers: config.headers,
      timeout: config.timeout,
      fresh: true,
      __bg: true, // đừng để chính nó kích thêm một lượt nền nữa
    })
    .catch(() => {})
    .finally(() => refreshing.delete(key));
}

/**
 * Gắn cache vào instance axios.
 *
 * PHẢI gọi ngay sau `axios.create()`, TRƯỚC mọi interceptor khác trong api.js.
 * Lý do: response interceptor của api.js trả về `response.data`, tức bóc mất
 * object response. Axios chạy response interceptor theo thứ tự đăng ký, nên
 * interceptor của cache phải đăng ký trước để chạy trước và còn thấy response
 * thật mà lưu. Đăng ký sau thì nó nhận `data` trần và không lưu được gì.
 * Có test giữ ràng buộc này: api-cache.test.mjs.
 */
export function installApiCache(api) {
  if (!readEnabled()) return api;

  storage = buildMemoryStorage(
    // true = nhân bản dữ liệu khi đọc/ghi. Tốn thêm một lần clone, nhưng
    // không có nó thì module nào vô tình sửa mảng vừa nhận là cache hỏng theo
    // — với 12 module không cùng người viết thì đó là rủi ro không đáng nhận.
    true,
    60_000,        // dọn entry hết hạn mỗi phút
    MAX_ENTRIES,
  );

  setupCache(api, {
    storage,
    methods: ["get"],

    // Server không gửi Cache-Control, và nếu có gửi thì cũng không nên để nó
    // ghi đè bảng RULES ở trên. Tự quyết hoàn toàn.
    interpretHeader: false,

    // TTL của thư viện = ngưỡng HARD. Trong khoảng này nó luôn trả cache mà
    // không ra mạng; việc làm mới nền do interceptor bên dưới lo.
    ttl: (response) => hardFor(response?.config?.url),

    // Chỉ cache phản hồi thành công. Cache lỗi thì một cú 500 nhất thời sẽ
    // dính lại suốt thời gian sống của entry.
    cachePredicate: {
      statusCheck: (status) => status >= 200 && status < 300,
    },

    // Quá hard mà request lỗi thì vẫn còn hơn màn hình trắng.
    staleIfError: true,

    generateKey: keyOf,
  });

  // Chạy TRƯỚC interceptor của cache (axios gọi request interceptor theo thứ
  // tự đăng ký ngược), nên quyết định ở đây là cache tôn trọng.
  api.interceptors.request.use((config) => {
    if (isNeverCached(config.url)) {
      config.cache = false;
      return config;
    }

    if (config.fresh) {
      // `api.get(url, { fresh: true })` — ép ra mạng và cập nhật lại cache.
      // Dùng cho nút "Làm mới" và cho các vòng hỏi lại cần số thật.
      config.cache = { override: true };
      return config;
    }

    // Chưa quá hard: trả ngay dữ liệu đang có (thư viện lo,
    // vì hạn của nó là hard), rồi làm mới ở nền cho lần sau.
    if (!config.__bg && String(config.method || "get").toLowerCase() === "get") {
      const key = keyOf(config);
      const age = ageOf(key);
      // Đọc là làm mới: không cần entry phải "đủ cũ". Hai điều kiện còn lại
      // đều cần thiết —
      //   age <= hard : quá hard thì chính request này đã phải ra mạng, kích
      //                 thêm lượt nền là gọi hai lần cùng một thứ.
      //   age > FLOOR : chặn bão khi một chỗ gọi lại liên tiếp trong cùng giây.
      if (age !== null && age > REFRESH_FLOOR && age <= hardFor(config.url)) {
        scheduleRefresh(api, config, key);
      }
    }

    return config;
  });

  // Ghi xong thì dữ liệu đọc liên quan đã cũ -> xoá cache tương ứng.
  api.interceptors.response.use((response) => {
    const method = String(response?.config?.method || "").toLowerCase();
    if (method && method !== "get" && method !== "head") {
      for (const prefix of prefixesToInvalidate(response.config?.url)) invalidate(prefix);
    }
    return response;
  });

  return api;
}

/**
 * Các lệnh ghi mà URL ghi KHÁC nhánh với URL đọc, nên suy từ URL sẽ trượt.
 *
 * Ví dụ rõ nhất: ẩn bình luận ghi vào `/api/facebook/comments/{id}/hide`,
 * nhưng danh sách bình luận lại đọc ở `/api/facebook/posts/{id}/comments`.
 * Chỉ xoá theo nhánh của URL ghi thì bình luận vừa ẩn vẫn hiện nguyên.
 *
 * Mỗi dòng: [URL ghi khớp, các prefix đọc cần xoá].
 */
const WRITE_INVALIDATES = [
  // Gửi tin -> đổi cả danh sách tin và dòng tóm tắt ở danh sách hội thoại
  [
    /\/api\/facebook\/send-(reply|attachment|attachment-url)/,
    ["/api/facebook/messages", "/api/facebook/conversations"],
  ],
  // Bình luận: trả lời / ẩn / xoá / thả cảm xúc -> bài viết và thông báo
  [
    /\/api\/facebook\/comments\//,
    ["/api/facebook/posts", "/api/facebook/notifications"],
  ],
  [
    /\/api\/facebook\/messages\//,
    ["/api/facebook/messages", "/api/facebook/conversations"],
  ],
  // Đánh dấu đã/chưa đọc chỉ đổi đúng danh sách hội thoại — giữ hẹp, vì thao
  // tác này chạy mỗi lần mở một hội thoại, xoá rộng là cache gần như vô dụng.
  [
    /\/api\/facebook\/conversations\/[^/]+\/[^/]+\/(read|unread)(\?|$)/,
    ["/api/facebook/conversations"],
  ],
  [
    /\/api\/facebook\/notifications\/[^/]+\/read(\?|$)/,
    ["/api/facebook/notifications"],
  ],
];

/**
 * Prefix cần xoá sau một lệnh ghi.
 *
 * Khớp bảng trên trước; không khớp thì lùi về hai đoạn đầu sau `/api`
 * (`/api/accounts/123/check` -> `/api/accounts`). Mặc định cố tình xoá RỘNG:
 * thà mất cache phải gọi lại, hơn là hiện dữ liệu cũ sau khi người dùng vừa
 * sửa. Module nào thấy xoá quá rộng thì thêm một dòng hẹp vào bảng trên.
 */
function prefixesToInvalidate(url) {
  const target = String(url || "");
  for (const [re, prefixes] of WRITE_INVALIDATES) {
    if (re.test(target)) return prefixes;
  }
  const path = target.split("?")[0];
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "api") return [path];
  return [`/${parts.slice(0, 2).join("/")}`];
}

/**
 * Xoá mọi entry có URL bắt đầu bằng `prefix`, cho MỌI người dùng.
 *
 * Gọi tay sau khi vừa đổi giao diện kiểu optimistic. Module 06 đổi state cục
 * bộ khi bấm thích / đã đọc, nhưng cache vẫn giữ response cũ — mở lại màn hình
 * mà không xoá là thấy trạng thái cũ, mất cái vừa bấm.
 */
export function invalidate(prefix) {
  if (!storage || !prefix) return;
  const target = String(prefix);
  for (const key of [...storage.data.keys()]) {
    if (urlOfKey(key).startsWith(target)) storage.remove(key);
  }
}

/** Xoá sạch — gọi khi đăng xuất, bị thu hồi phiên, hoặc đổi tài khoản */
export function clearApiCache() {
  if (!storage) return;
  storage.data.clear();
  refreshing.clear();
}
