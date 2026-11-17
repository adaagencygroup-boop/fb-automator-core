/**
 * Phiên còn dữ liệu UI (đang chạy / tạm dừng / dừng / vừa xong chưa reset).
 * Sau /api/post/reset BE idle → false.
 */
export function shouldRestoreProgressView(status) {
  if (!status || typeof status !== "object") return false;
  if (status.is_running || status.is_paused || status.is_stopped) return true;
  if (status.session_id) return true;
  if (Array.isArray(status.threads) && status.threads.length > 0) return true;
  return false;
}

/** URL xem bài từ row tiến trình (field postUrl hoặc parse từ currentActivity cũ). */
export function resolveProgressPostUrl(row) {
  if (!row) return null;
  const direct = (row.postUrl || row.facebook_post_url || "").trim();
  if (direct && /^https?:\/\//i.test(direct)) return direct;

  const activity = String(row.currentActivity || "");
  // StatusUrlResult(url='...', ...)
  const named = activity.match(/StatusUrlResult\(url=['"]([^'"]+)['"]/);
  if (named?.[1]) return named[1];
  // Link bài: https://... | link trang cá nhân: https://... | Link: https://...
  const labeled = activity.match(
    /(?:Link bài|link trang cá nhân|Link)\s*[:：]\s*(https?:\/\/\S+)/i,
  );
  if (labeled?.[1]) return labeled[1].replace(/[)\].,;]+$/, "");
  const anyHttp = activity.match(/(https?:\/\/(?:www\.|web\.)?facebook\.com\/[^\s)'"]+)/i);
  if (anyHttp?.[1]) return anyHttp[1].replace(/[)\].,;]+$/, "");
  return null;
}

export function isProgressPermalink(row, url = null) {
  if (typeof row?.isPermalink === "boolean") return row.isPermalink;
  const u = url || resolveProgressPostUrl(row) || "";
  return (
    u.includes("/posts/") ||
    u.includes("permalink.php") ||
    u.includes("story_fbid=") ||
    u.includes("pfbid") ||
    u.includes("/reel/") ||
    u.includes("/photo")
  );
}

/** True khi bài đã xuất bản thành công — dùng để hiện nút xem (không hiện khi lỗi có URL nháp). */
export function isProgressPublishSuccess(row) {
  if (!row) return false;
  if (String(row.status || "") === "Hoàn thành") return true;
  return /XUẤT BẢN THÀNH CÔNG/i.test(String(row.currentActivity || ""));
}

/** Nhãn hoạt động ngắn — bỏ phần URL / StatusUrlResult khỏi text. */
export function progressActivityLabel(row) {
  let t = String(row?.currentActivity || "");
  t = t.replace(/\s*StatusUrlResult\([^)]*\)\s*/g, " ").trim();
  t = t
    .replace(/\s*(?:Link bài|Chưa lấy được permalink[^:]*|link trang cá nhân|Link)\s*[:：]\s*https?:\/\/\S+/gi, "")
    .trim();
  t = t.replace(/\s*https?:\/\/\S+/g, "").trim();
  if (t) return t;
  if (row?.status === "Hoàn thành") {
    const ptype = String(row?.postType || row?.post_type || "").toLowerCase();
    if (ptype === "reels" || ptype === "reel") return "XUẤT BẢN THÀNH CÔNG REELS!";
    if (ptype === "story") return "XUẤT BẢN THÀNH CÔNG STORY!";
    if (ptype === "status") return "XUẤT BẢN THÀNH CÔNG STATUS!";
    return "XUẤT BẢN THÀNH CÔNG!";
  }
  return "";
}

export function mapProgressThreads(threads, defaultPostType = "status") {
  if (!Array.isArray(threads)) return [];
  return threads.map((t) => {
    const postUrl = t.postUrl || t.facebook_post_url || null;
    return {
      id: t.id || t.threadId,
      threadId: t.threadId,
      accountName: t.accountName || "Tài khoản",
      accountUid: t.accountUid || "-",
      status: t.status || "Đang chạy",
      contentPreview: t.contentPreview || "Đang xử lý...",
      currentActivity: t.currentActivity || "",
      elapsedTime: t.elapsedTime || "0:00",
      content: t.content || "",
      imagePaths: Array.isArray(t.imagePaths) ? t.imagePaths : [],
      mediaPath: t.mediaPath || "",
      mediaName: t.mediaName || "",
      postType: t.postType || defaultPostType,
      checkpoint: t.checkpoint || "",
      postUrl: postUrl || null,
      isPermalink: typeof t.isPermalink === "boolean" ? t.isPermalink : undefined,
    };
  });
}
