/**
 * Module 08: Interaction Seeding - Validation & URL Normalization
 * Tập trung toàn bộ logic kiểm tra hợp lệ, chuẩn hóa URL, lọc trùng lặp và làm sạch input Facebook
 */

/**
 * Danh sách tham số tracking rác thường gắn theo link chia sẻ của Facebook
 */
export const TRACKING_PARAMS = new Set([
  "mibextid", "ref", "rc", "rdid", "epa", "notif_t", "notif_id",
  "locale", "set", "type", "__tn__", "__cft__", "fref", "sfnsn",
  "fbclid", "utm_source", "utm_medium", "utm_campaign", "paipv", "eav",
  "comment_tracking", "feed_referrer", "acontext"
]);

/**
 * 1. Loại bỏ toàn bộ dấu tiếng Việt (sắc, huyền, hỏi, ngã, nặng, các ký tự đ, ê, ư, ơ, ...)
 */
export const removeVietnameseTones = (str) => {
  if (!str) return "";
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
};

/**
 * Kiểm tra xem văn bản có chứa ký tự tiếng Việt có dấu hoặc ký tự non-ASCII hay không
 */
export const hasVietnameseTones = (str) => {
  if (!str) return false;
  return (
    /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđĐ]/i.test(str) ||
    /[^\x00-\x7F]/.test(str)
  );
};

/**
 * 2. Làm sạch văn bản nhập vào ô Textarea:
 * - Chặn/loại bỏ toàn bộ dấu tiếng Việt
 * - Chặn/loại bỏ dấu cách (space) và các dấu câu cấm (phẩy, chấm phẩy, nháy, ngoặc, v.v.)
 * - Chỉ cho phép các ký tự chuẩn URL/UID: [a-zA-Z0-9.:/_\-?&=#%] và ký tự xuống dòng \n
 * - Nén nhiều lần Enter liên tiếp thành 1 lần xuống dòng duy nhất
 */
export const sanitizeTargetInput = (text) => {
  if (!text) return "";
  const noTones = removeVietnameseTones(text);
  return noTones
    .replace(/[^a-zA-Z0-9.:/_\-?&=#%\r\n]+/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/^\n+/, "");
};

/**
 * 3. Làm sạch URL Facebook:
 * - Chuẩn hóa tên miền về web.facebook.com
 * - Loại bỏ các tham số tracking như ?mibextid=..., ?ref=..., ?locale=...
 * - Loại bỏ dấu gạch chéo cuối URL (trailing slash)
 */
export const cleanFacebookUrl = (rawUrl) => {
  if (!rawUrl) return "";
  let val = String(rawUrl).trim();
  if (!val) return "";

  val = removeVietnameseTones(val);

  if (/^(?:(?:www\.|web\.|m\.)?facebook\.com|fb\.watch|fb\.com)/i.test(val)) {
    val = `https://${val.replace(/^\/+/, "")}`;
  }

  if (/^https?:\/\//i.test(val)) {
    try {
      const urlObj = new URL(val);
      const host = urlObj.hostname.toLowerCase();
      if (
        host === "facebook.com" ||
        host === "www.facebook.com" ||
        host === "m.facebook.com" ||
        host === "web.facebook.com" ||
        host === "fb.com"
      ) {
        urlObj.hostname = "web.facebook.com";
      }

      // Xóa các tham số tracking
      const searchParams = new URLSearchParams(urlObj.search);
      const toDelete = [];
      searchParams.forEach((_, key) => {
        const k = key.toLowerCase();
        if (TRACKING_PARAMS.has(k) || k.startsWith("utm_")) {
          toDelete.push(key);
        }
      });
      toDelete.forEach((k) => searchParams.delete(k));

      let cleanPath = urlObj.pathname.replace(/\/+$/, "");
      if (!cleanPath) cleanPath = "/";

      const queryStr = searchParams.toString();
      return `${urlObj.protocol}//${urlObj.hostname}${cleanPath}${queryStr ? `?${queryStr}` : ""}`;
    } catch {
      return val.replace(/\/+$/, "");
    }
  }

  return val;
};

/**
 * 4. Trích xuất Facebook ID / Share Token cốt lõi để so sánh trùng lặp chuẩn xác
 */
export const extractTargetFbId = (urlOrText, targetType = "") => {
  if (!urlOrText) return "";
  const clean = removeVietnameseTones(String(urlOrText).trim());
  if (!clean) return "";

  // Share post / reel / video: /share/(?:p|r|v)/([a-zA-Z0-9_\-]+)
  let m = clean.match(/\/share\/(?:p|r|v)\/([a-zA-Z0-9_\-]+)/i);
  if (m) return m[1];

  // Tiền tố ngắn share: share/p/18NvrpA3BJ hoặc p/18NvrpA3BJ
  m = clean.match(/^(?:share\/)?(?:p|r|v)\/([a-zA-Z0-9_\-]+)/i);
  if (m) return m[1];

  // Post ID từ permalink: story_fbid / fbid là số hoặc chuỗi pfbid... (link kiểu mới).
  // Phải lấy trước ?id= vì id= trong permalink là ID của Page: lấy nhầm thì 2 bài khác nhau của cùng 1 Page bị coi là trùng.
  m = clean.match(/[?&](?:story_fbid|fbid)=([a-zA-Z0-9]+)/i);
  if (m) return m[1];

  // Link video rút gọn: fb.watch/abcDEF
  m = clean.match(/fb\.watch\/([a-zA-Z0-9_\-]+)/i);
  if (m) return m[1];

  // Post ID từ /posts/([a-zA-Z0-9_\-]+)
  m = clean.match(/\/posts\/([a-zA-Z0-9_\-]+)/i);
  if (m) return m[1];

  // Video / Reel / Watch: /reel/..., /videos/..., v=(\d+)
  m = clean.match(/\/(?:reel|videos)\/([a-zA-Z0-9_\-]+)/i);
  if (m) return m[1];
  m = clean.match(/[?&]v=(\d+)/i);
  if (m) return m[1];

  // Group post: /groups/[^/]+/(?:posts|permalink)\/([a-zA-Z0-9_\-]+)
  m = clean.match(/\/groups\/[^/]+\/(?:posts|permalink)\/([a-zA-Z0-9_\-]+)/i);
  if (m) return m[1];

  // Page format: /p/Ten-Page-(\d+) hoặc /pages/[^/]+/(\d+)
  m = clean.match(/\/p\/[^/]+-(\d+)/i) || clean.match(/\/pages\/[^/]+\/(\d+)/i);
  if (m) return m[1];

  // Profile UID từ ?id=(\d+)
  m = clean.match(/[?&]id=(\d+)/i);
  if (m) return m[1];

  // People format: /people/[^/]+/(\d+)
  m = clean.match(/\/people\/[^/]+\/(\d+)/i);
  if (m) return m[1];

  // Username/slug sau domain: facebook.com/username
  m = clean.match(/facebook\.com\/([a-zA-Z0-9._\-]+)/i);
  if (m) {
    const slug = m[1];
    const systemSlugs = [
      "groups", "pages", "watch", "photo", "events", "share", "profile.php",
      "marketplace", "gaming", "home.php", "login", "notifications", "friends"
    ];
    if (slug && !systemSlugs.includes(slug.toLowerCase())) {
      return slug;
    }
  }

  // Nếu là token hoặc UID đứng một mình
  const token = clean.replace(/^\/+/, "").replace(/\/+$/, "");
  if (/^[a-zA-Z0-9._\-]+$/.test(token)) {
    return token;
  }

  return clean;
};

/**
 * 5. Chuẩn hóa liên kết / UID Facebook:
 * - Chuẩn hóa tên miền về web.facebook.com
 * - Dạng share token (vd: 18NvrpA3BJ, share/p/18NvrpA3BJ) trong POST -> https://web.facebook.com/share/p/{id}
 * - UID (chuỗi số) cho Page/Profile -> https://web.facebook.com/{uid}
 * - Loại bỏ các query tracking rác (?mibextid=..., ?ref=...)
 */
export const normalizeTargetUrl = (input, targetType = "") => {
  if (!input) return "";
  let val = String(input).trim();
  if (!val) return "";

  // Bỏ dấu tiếng Việt nếu có
  val = removeVietnameseTones(val);
  const type = String(targetType || "").toUpperCase();

  // 1. Kiểm tra nếu là dạng share link có domain hoặc không domain (share/p/..., share/r/..., share/v/...)
  const shareMatch = val.match(
    /^(?:(?:https?:\/\/)?(?:(?:www\.|web\.|m\.)?facebook\.com|fb\.com)\/)?share\/(p|r|v)\/([a-zA-Z0-9_\-]+)/i
  );
  if (shareMatch) {
    return cleanFacebookUrl(`https://web.facebook.com/share/${shareMatch[1]}/${shareMatch[2]}`);
  }

  // 2. Tiền tố ngắn p/ hoặc r/ hoặc v/ (vd: p/18NvrpA3BJ)
  const shortShareMatch = val.match(
    /^(?:(?:https?:\/\/)?(?:(?:www\.|web\.|m\.)?facebook\.com|fb\.com)\/)?(p|r|v)\/([a-zA-Z0-9_\-]+)/i
  );
  if (shortShareMatch && !val.toLowerCase().startsWith("http")) {
    return cleanFacebookUrl(`https://web.facebook.com/share/${shortShareMatch[1]}/${shortShareMatch[2]}`);
  }

  // 3. Đã có protocol http:// hoặc https://
  if (/^https?:\/\//i.test(val)) {
    // Nếu trong mục POST mà link lại có dạng https://web.facebook.com/18NvrpA3BJ (chỉ có slug token chứa cả chữ và số)
    if (type === "POST") {
      const singleSlugMatch = val.match(
        /^https?:\/\/(?:(?:www\.|web\.|m\.)?facebook\.com|fb\.com)\/([a-zA-Z0-9_\-]{6,30})\/?$/i
      );
      if (singleSlugMatch) {
        const slug = singleSlugMatch[1];
        const systemSlugs = ["watch", "groups", "pages", "photo", "events", "gaming", "marketplace", "reel", "reels"];
        if (!systemSlugs.includes(slug.toLowerCase()) && /[a-zA-Z]/.test(slug) && /\d/.test(slug)) {
          return cleanFacebookUrl(`https://web.facebook.com/share/p/${slug}`);
        }
      }
    }
    return cleanFacebookUrl(val);
  }

  // 4. Chứa domain Facebook nhưng thiếu protocol (vd: facebook.com/...)
  if (
    /^(?:www\.|web\.|m\.)?facebook\.com/i.test(val) ||
    /^fb\.watch/i.test(val) ||
    /^fb\.com/i.test(val)
  ) {
    if (type === "POST") {
      const singleSlugMatch = val.match(
        /^(?:(?:www\.|web\.|m\.)?facebook\.com|fb\.com)\/([a-zA-Z0-9_\-]{6,30})\/?$/i
      );
      if (singleSlugMatch) {
        const slug = singleSlugMatch[1];
        const systemSlugs = ["watch", "groups", "pages", "photo", "events", "gaming", "marketplace", "reel", "reels"];
        if (!systemSlugs.includes(slug.toLowerCase()) && /[a-zA-Z]/.test(slug) && /\d/.test(slug)) {
          return cleanFacebookUrl(`https://web.facebook.com/share/p/${slug}`);
        }
      }
    }
    return cleanFacebookUrl(`https://${val.replace(/^\/+/, "")}`);
  }

  const clean = val.replace(/^\/+/, "").replace(/\/+$/, "");

  // 5. Nếu đang ở mục POST:
  if (type === "POST") {
    // Dạng UID_PostID
    if (/^\d+_\d+$/.test(clean)) {
      return cleanFacebookUrl(`https://web.facebook.com/${clean}`);
    }
    // Mã token share post (chứa cả chữ và số, ví dụ: 18NvrpA3BJ)
    if (/^[a-zA-Z0-9_\-]{6,30}$/.test(clean) && /[a-zA-Z]/.test(clean) && /\d/.test(clean)) {
      return cleanFacebookUrl(`https://web.facebook.com/share/p/${clean}`);
    }
    // Mặc định gán https://web.facebook.com/
    return cleanFacebookUrl(`https://web.facebook.com/${clean}`);
  }

  // 6. Cho PAGE, PROFILE hoặc UID thông thường (chuỗi số thuần):
  return cleanFacebookUrl(`https://web.facebook.com/${clean}`);
};

/**
 * 6. Kiểm tra tính hợp lệ của liên kết Facebook SAU KHI đã được chuẩn hóa / tự động gán https://web.facebook.com/
 * @param {string} fullUrl - URL đầy đủ (ví dụ: https://web.facebook.com/...)
 * @param {string} targetType - "PAGE" | "PROFILE" | "POST"
 * @returns {{ isValid: boolean, reason?: string }}
 */
export const validateFacebookUrlAfterNormalize = (fullUrl, targetType = "") => {
  if (!fullUrl || typeof fullUrl !== "string") {
    return { isValid: false, reason: "URL trống" };
  }

  const clean = fullUrl.trim();

  // 1. Kiểm tra dấu tiếng Việt và ký tự non-ASCII
  if (hasVietnameseTones(clean) || /[^\x20-\x7E]/.test(clean)) {
    return { isValid: false, reason: "Chứa ký tự có dấu hoặc ký tự đặc biệt" };
  }

  // 2. Chặn các ký tự cấm trong URL Facebook
  if (/[ ,;'"<>()[\]{}|\\^~`*!]/.test(clean)) {
    return { isValid: false, reason: "Chứa khoảng trắng hoặc ký tự không hợp lệ" };
  }

  // 3. Phải là URL hợp lệ có protocol http/https
  let parsed;
  try {
    parsed = new URL(clean);
  } catch {
    return { isValid: false, reason: "Định dạng URL không hợp lệ" };
  }

  // 4. Kiểm tra hostname
  const host = parsed.hostname.toLowerCase();
  const isFbHost =
    host === "web.facebook.com" ||
    host === "facebook.com" ||
    host === "www.facebook.com" ||
    host === "m.facebook.com" ||
    host === "fb.com" ||
    host === "fb.watch";

  if (!isFbHost) {
    return { isValid: false, reason: "Không phải tên miền Facebook" };
  }

  // 5. Kiểm tra pathname và searchParams
  const path = parsed.pathname.toLowerCase().replace(/\/+$/, "") || "/";
  const searchParams = parsed.searchParams;

  // Danh sách các trang hệ thống của Facebook (không thể dùng làm mục tiêu seeding)
  const systemPaths = new Set([
    "/", "", "/home.php", "/login", "/login.php", "/checkpoint",
    "/messages", "/notifications", "/friends", "/bookmarks",
    "/settings", "/privacy", "/help", "/recover", "/events",
    "/gaming", "/marketplace", "/saved", "/stories", "/pages",
    "/groups", "/watch", "/search", "/fundraisers", "/live",
    "/allactivity", "/me"
  ]);

  const type = String(targetType || "").toUpperCase();

  if (systemPaths.has(path)) {
    // Ngoại lệ: /watch có tham số v=(\d+) là video Facebook hợp lệ cho POST
    if (path === "/watch" && searchParams.has("v") && type === "POST") {
      // Cho phép tiếp tục kiểm tra POST
    } else {
      return { isValid: false, reason: "Liên kết trang hệ thống Facebook" };
    }
  }

  // 6. KIỂM TRA CHO MỤC TIÊU "POST" (Bài viết / Reel / Video)
  if (type === "POST") {
    // fb.watch là link video rút gọn -> hợp lệ cho POST
    if (host === "fb.watch") {
      return { isValid: true };
    }

    // a. Share link: /share/(p|r|v)/...
    const isSharePost = /\/share\/(?:p|r|v)\/([a-zA-Z0-9_\-]+)/i.test(path);
    // b. Posts slug: /{user_or_page}/posts/{postId} hoặc /posts/{postId}
    const isPostsSlug = /\/posts\/([a-zA-Z0-9_\-]+)/i.test(path);
    // c. Permalink: /permalink.php?story_fbid=... hoặc /permalink/{postId} hoặc story.php
    const isPermalink =
      path.includes("/permalink") ||
      searchParams.has("story_fbid") ||
      (path === "/story.php" && searchParams.has("story_fbid"));
    // d. Photo post: /photo.php?fbid=... hoặc /photo/?fbid=... hoặc /photos/...
    const isPhoto =
      (path.includes("/photo") || path.includes("/photos")) &&
      (searchParams.has("fbid") || /\/photos\/[^/]+\/(\d+)/i.test(path));
    // e. Reel: /reel/{reelId} hoặc /reels/{reelId}
    const isReel = /\/reels?\/([a-zA-Z0-9_\-]+)/i.test(path);
    // f. Video: /watch/?v=... hoặc /videos/{videoId}
    const isVideo =
      (path === "/watch" && searchParams.has("v")) ||
      /\/videos\/([a-zA-Z0-9_\-]+)/i.test(path);
    // g. Group post: /groups/{groupId}/posts/{postId} hoặc /groups/{groupId}/permalink/{postId}
    const isGroupPost = /\/groups\/[^/]+\/(?:posts|permalink)\/([a-zA-Z0-9_\-]+)/i.test(path);
    // h. UID_PostID format: /{uid}_{postId}
    const isUidPostId = /^\/\d+_\d+$/.test(path);

    const isPostValid =
      isSharePost ||
      isPostsSlug ||
      isPermalink ||
      isPhoto ||
      isReel ||
      isVideo ||
      isGroupPost ||
      isUidPostId;

    if (!isPostValid) {
      return { isValid: false, reason: "Không phải liên kết bài viết / Reel / Video Facebook" };
    }

    return { isValid: true };
  }

  // 7. KIỂM TRA CHO MỤC TIÊU "PAGE" (Fanpage Facebook)
  if (type === "PAGE") {
    // Không nhận fb.watch
    if (host === "fb.watch") {
      return { isValid: false, reason: "Liên kết video fb.watch, không phải Fanpage" };
    }

    // Không được là link bài viết, share post, reel, video, photo, group
    if (
      path.includes("/share/") ||
      path.includes("/posts/") ||
      path.includes("/permalink") ||
      path.includes("/reel/") ||
      path.includes("/reels/") ||
      path.includes("/videos/") ||
      path.includes("/photo") ||
      path.includes("/photos") ||
      path.includes("/groups/") ||
      path.startsWith("/watch") ||
      searchParams.has("story_fbid") ||
      searchParams.has("fbid") ||
      searchParams.has("v") ||
      /^\/\d+_\d+$/.test(path)
    ) {
      return { isValid: false, reason: "Liên kết bài viết hoặc nhóm, không phải Fanpage" };
    }

    // Chặn các mục không phải Fanpage
    if (
      path.startsWith("/events") ||
      path.startsWith("/gaming") ||
      path.startsWith("/marketplace")
    ) {
      return { isValid: false, reason: "Không phải liên kết Fanpage Facebook" };
    }

    // Các định dạng Fanpage hợp lệ:
    // a. /pages/{name}/{id}
    const isPagesFormat = /^\/pages\/[^/]+\/(\d+)$/i.test(path);
    // b. /p/{name}-{id}
    const isShortPageFormat = /^\/p\/[^/]+-(\d+)$/i.test(path);
    // c. /profile.php?id={id}
    const isProfilePhp = path === "/profile.php" && searchParams.has("id");
    // d. /people/{name}/{id}
    const isPeopleFormat = /^\/people\/[^/]+\/(\d+)$/i.test(path);
    // e. /{slug_or_uid} (độ dài >= 4, một cấp slug duy nhất)
    const isSingleSlug = /^\/[a-zA-Z0-9._\-]{4,60}$/.test(path);

    if (isPagesFormat || isShortPageFormat || isProfilePhp || isPeopleFormat || isSingleSlug) {
      return { isValid: true };
    }

    return { isValid: false, reason: "Định dạng liên kết không phải Fanpage hợp lệ" };
  }

  // 8. KIỂM TRA CHO MỤC TIÊU "PROFILE" (Trang cá nhân Facebook)
  if (type === "PROFILE") {
    // Không nhận fb.watch
    if (host === "fb.watch") {
      return { isValid: false, reason: "Liên kết video fb.watch, không phải Profile cá nhân" };
    }

    // Không được là link bài viết, reel, video, photo, group, hoặc fanpage-specific
    if (
      path.includes("/share/") ||
      path.includes("/posts/") ||
      path.includes("/permalink") ||
      path.includes("/reel/") ||
      path.includes("/reels/") ||
      path.includes("/videos/") ||
      path.includes("/photo") ||
      path.includes("/photos") ||
      path.includes("/groups/") ||
      path.startsWith("/pages/") ||
      path.startsWith("/p/") ||
      path.startsWith("/watch") ||
      searchParams.has("story_fbid") ||
      searchParams.has("fbid") ||
      searchParams.has("v") ||
      /^\/\d+_\d+$/.test(path)
    ) {
      return { isValid: false, reason: "Liên kết bài viết, nhóm hoặc Fanpage, không phải Profile cá nhân" };
    }

    // Chặn các mục không phải Profile
    if (
      path.startsWith("/events") ||
      path.startsWith("/gaming") ||
      path.startsWith("/marketplace")
    ) {
      return { isValid: false, reason: "Không phải liên kết Profile Facebook" };
    }

    // Các định dạng Profile cá nhân hợp lệ:
    // a. /profile.php?id={id}
    const isProfilePhp = path === "/profile.php" && searchParams.has("id");
    // b. /people/{name}/{id}
    const isPeopleFormat = /^\/people\/[^/]+\/(\d+)$/i.test(path);
    // c. /{username_or_uid} (độ dài >= 4, một cấp slug duy nhất)
    const isSingleSlug = /^\/[a-zA-Z0-9._\-]{4,60}$/.test(path);

    if (isProfilePhp || isPeopleFormat || isSingleSlug) {
      return { isValid: true };
    }

    return { isValid: false, reason: "Định dạng liên kết không phải Profile cá nhân hợp lệ" };
  }

  // Mặc định hợp lệ nếu không có targetType cụ thể
  return { isValid: true };
};

/**
 * 7. Kiểm tra tính hợp lệ chặt chẽ của liên kết / UID Facebook
 * TỰ ĐỘNG GÁN https://web.facebook.com/ NẾU CẦN VÀ KIỂM TRA TOÀN DIỆN CẢ LINK SAU KHI GÁN
 */
export const isValidTargetUrl = (rawLine, targetType = "") => {
  if (!rawLine || typeof rawLine !== "string") return false;
  const line = rawLine.trim();
  if (line.length < 4) return false;

  // 1. Chặn tuyệt đối nếu còn sót dấu tiếng Việt hoặc ký tự non-ASCII
  if (hasVietnameseTones(line) || /[^\x20-\x7E]/.test(line)) {
    return false;
  }

  // 2. Chặn các dấu câu cấm (khoảng trắng, phẩy, chấm phẩy, nháy, ngoặc, v.v.)
  if (/[ ,;'"<>()[\]{}|\\^~`*!]/.test(line)) {
    return false;
  }

  // 3. Tự động chuẩn hóa / gán https://web.facebook.com/
  const normalized = normalizeTargetUrl(line, targetType);
  if (!normalized) return false;

  // 4. KIỂM TRA CHẶT CHẼ CẢ LINK SAU KHI TỰ ĐỘNG GÁN https://web.facebook.com/
  const checkResult = validateFacebookUrlAfterNormalize(normalized, targetType);
  return checkResult.isValid;
};

/**
 * 8. Phân tích và thống kê danh sách link/UID đã nhập với độ chuẩn xác tuyệt đối:
 * - Tổng số dòng
 * - Số link hợp lệ (đã làm sạch, chuẩn hóa và duy nhất)
 * - Số link bị trùng lặp (trong ô nhập hoặc đã tồn tại trong danh sách đã lưu)
 * - Số link không hợp lệ (kiểm tra cả sau khi tự động gán https://web.facebook.com/)
 */
export const parseInputTargetsStats = (text, existingTargets = [], targetType = "") => {
  const lines = (text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Tập hợp URL và ID cốt lõi đã lưu trong cơ sở dữ liệu
  const existingUrlSet = new Set();
  const existingIdSet = new Set();

  (existingTargets || []).forEach((t) => {
    const raw = typeof t === "string" ? t : t?.url || t?.fb_id || "";
    if (!raw) return;

    const norm = normalizeTargetUrl(raw, targetType).toLowerCase();
    if (norm) existingUrlSet.add(norm);

    const fid = (typeof t === "object" && t?.fb_id ? t.fb_id : extractTargetFbId(raw, targetType)).toLowerCase();
    if (fid && fid !== "unknown") existingIdSet.add(fid);
  });

  const seenUrls = new Set();
  const seenIds = new Set();
  const validList = [];
  let duplicateCount = 0;
  let invalidCount = 0;

  for (const line of lines) {
    // 1. Kiểm tra tính hợp lệ cơ bản của dòng nhập
    if (
      line.length < 4 ||
      hasVietnameseTones(line) ||
      /[^\x20-\x7E]/.test(line) ||
      /[ ,;'"<>()[\]{}|\\^~`*!]/.test(line)
    ) {
      invalidCount++;
      continue;
    }

    // 2. Tự động chuẩn hóa / gán https://web.facebook.com/
    const normalized = normalizeTargetUrl(line, targetType);
    if (!normalized) {
      invalidCount++;
      continue;
    }

    // 3. KIỂM TRA CẢ LINK SAU KHI TỰ ĐỘNG GÁN https://web.facebook.com/
    const checkResult = validateFacebookUrlAfterNormalize(normalized, targetType);
    if (!checkResult.isValid) {
      invalidCount++;
      continue;
    }

    // 4. Trích xuất ID cốt lõi
    const normKey = normalized.toLowerCase();
    const fbIdKey = extractTargetFbId(normalized, targetType).toLowerCase();

    // 5. Kiểm tra trùng lặp qua cả URL chuẩn hóa lẫn ID cốt lõi
    const isDuplicate =
      seenUrls.has(normKey) ||
      existingUrlSet.has(normKey) ||
      (fbIdKey && fbIdKey !== "unknown" && (seenIds.has(fbIdKey) || existingIdSet.has(fbIdKey)));

    if (isDuplicate) {
      duplicateCount++;
    } else {
      seenUrls.add(normKey);
      if (fbIdKey && fbIdKey !== "unknown") {
        seenIds.add(fbIdKey);
      }
      validList.push(normalized);
    }
  }

  return {
    totalCount: lines.length,
    validCount: validList.length,
    duplicateCount,
    invalidCount,
    validList,
  };
};

/**
 * 9. Loại bỏ các dòng liên kết bị trùng lặp (trong text nhập hoặc đã có trong danh sách đã lưu)
 */
export const removeDuplicateTargets = (text, existingTargets = [], targetType = "") => {
  if (!text) return "";
  const lines = text.split("\n");

  const existingUrlSet = new Set();
  const existingIdSet = new Set();
  (existingTargets || []).forEach((t) => {
    const raw = typeof t === "string" ? t : t?.url || t?.fb_id || "";
    if (!raw) return;
    const norm = normalizeTargetUrl(raw, targetType).toLowerCase();
    if (norm) existingUrlSet.add(norm);
    const fid = (typeof t === "object" && t?.fb_id ? t.fb_id : extractTargetFbId(raw, targetType)).toLowerCase();
    if (fid && fid !== "unknown") existingIdSet.add(fid);
  });

  const seenUrls = new Set();
  const seenIds = new Set();
  const result = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (!isValidTargetUrl(line, targetType)) {
      result.push(line);
      continue;
    }

    const normalized = normalizeTargetUrl(line, targetType);
    const normKey = normalized.toLowerCase();
    const fbIdKey = extractTargetFbId(normalized, targetType).toLowerCase();

    const isDuplicate =
      seenUrls.has(normKey) ||
      existingUrlSet.has(normKey) ||
      (fbIdKey && fbIdKey !== "unknown" && (seenIds.has(fbIdKey) || existingIdSet.has(fbIdKey)));

    if (!isDuplicate) {
      seenUrls.add(normKey);
      if (fbIdKey && fbIdKey !== "unknown") {
        seenIds.add(fbIdKey);
      }
      result.push(normalized);
    }
  }

  return result.join("\n");
};

/**
 * 10. Loại bỏ các dòng liên kết không hợp lệ (kiểm tra cả sau khi tự động gán https://web.facebook.com/)
 */
export const removeInvalidTargets = (text, targetType = "") => {
  if (!text) return "";
  const lines = text.split("\n");
  const result = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (isValidTargetUrl(line, targetType)) {
      result.push(normalizeTargetUrl(line, targetType));
    }
  }

  return result.join("\n");
};
