/**
 * Kế hoạch chạy Seeding Bài viết: phân bổ lượt, ước tính thời gian, kiểm tra trước khi chạy.
 * Phân bổ GIỐNG backend create_seeding_campaign (seeding_routes.py):
 *   - cảm xúc: mọi nick trên mỗi bài
 *   - bình luận: 1 nửa số nick trên mỗi bài (tối thiểu 1)
 *   - chia sẻ: tổng = số nick, chia ngẫu nhiên cho các bài trong khoảng ±20% (share_range_per_post), mỗi bài ≥ 1
 * Hàm thuần (không React) để test bằng `node --test`.
 */

// Ước tính theo cách runner chạy (_run_single_campaign / _process_account_tasks):
// các bài chạy lần lượt; mỗi bài 2 luồng Chrome song song; mỗi nick mở Chrome + kiểm tra đăng nhập rồi làm các tác vụ,
// nghỉ delay giữa 2 tác vụ của cùng nick; giữa 2 bài nghỉ delay.
export const CHROME_THREADS = 2;
export const CHROME_OPEN_S = 25;
export const ACTION_S = 10;

export function sharePerPostRange(accountCount, targetCount) {
  if (targetCount <= 1) return [accountCount, accountCount];
  if (accountCount > 0 && accountCount < targetCount) return [1, 1];
  return [
    Math.max(1, Math.floor((4 * accountCount) / (5 * targetCount))),
    Math.ceil((6 * accountCount) / (5 * targetCount)),
  ];
}

export function planTotals({ accountCount, targetCount, doLike, doComment, doShare }) {
  const acc = Math.max(0, Number(accountCount) || 0);
  const posts = Math.max(0, Number(targetCount) || 0);
  const react = doLike ? acc : 0;
  const comment = doComment && acc > 0 ? Math.max(1, Math.floor(acc / 2)) : 0;
  const [shareMin, shareMax] = doShare && acc > 0 ? sharePerPostRange(acc, posts) : [0, 0];
  const totalReacts = posts * react;
  const totalComments = posts * comment;
  const totalShares = doShare && posts > 0 && acc > 0 ? Math.max(acc, posts) : 0;
  return {
    react,
    comment,
    shareMin,
    shareMax,
    totalReacts,
    totalComments,
    totalShares,
    total: totalReacts + totalComments + totalShares,
  };
}

/** Ước tính số giây chạy hết (xấp xỉ). Rải đều N giờ thì chính là N giờ. */
export function estimateSeconds({ accountCount, targetCount, delayMin, delayMax, totals, threads = CHROME_THREADS, spreadHours = 0 }) {
  const acc = Math.max(0, Number(accountCount) || 0);
  const posts = Math.max(0, Number(targetCount) || 0);
  if (!acc || !posts || !totals?.total) return 0;
  if (Number(spreadHours) > 0) return Math.round(Number(spreadHours) * 3600);
  const lanes = Math.max(1, Math.min(5, Number(threads) || CHROME_THREADS));
  const avgDelay = (Math.max(0, Number(delayMin) || 0) + Math.max(0, Number(delayMax) || 0)) / 2;
  // Số nick có việc ở mỗi bài = loại có nhiều lượt nhất (mỗi nick làm mỗi loại tối đa 1 lần / bài)
  const busyNicks = Math.min(acc, Math.max(1, totals.react || 0, totals.comment || 0, totals.shareMax || 0));
  const tasksPerNick = totals.total / posts / busyNicks;
  const nickSeconds = CHROME_OPEN_S + tasksPerNick * ACTION_S + Math.max(0, tasksPerNick - 1) * avgDelay;
  const postSeconds = Math.ceil(busyNicks / lanes) * nickSeconds;
  return Math.round(posts * postSeconds + Math.max(0, posts - 1) * avgDelay);
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `~${s} giây`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `~${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `~${hours} giờ ${rest} phút` : `~${hours} giờ`;
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return h ? `~${days} ngày ${h} giờ` : `~${days} ngày`;
}

/**
 * Các mục "Kiểm tra trước khi chạy". ok=false là lỗi chặn nút Bắt đầu.
 * @returns {{ key: string, ok: boolean, text: string }[]}
 */
export function preRunChecks({
  targetCount,
  doLike,
  doComment,
  doShare,
  reactionCount,
  commentCount,
  accountCount,
  liveAccounts,
  delayMin,
  delayMax,
  fetchRunning,
  otherRunningLabel,
  commentVariants = Infinity,
  commentPerPost = 0,
  scheduleMissing = false,
}) {
  const checks = [];
  checks.push(
    targetCount > 0
      ? { key: "targets", ok: true, text: `Đã có ${targetCount.toLocaleString("vi-VN")} bài viết sẽ seeding` }
      : { key: "targets", ok: false, text: "Chưa có bài viết nào trong danh sách seeding" },
  );
  if (!doLike && !doComment && !doShare) {
    checks.push({ key: "actions", ok: false, text: "Chưa chọn loại tương tác (cảm xúc, bình luận hoặc chia sẻ)" });
  }
  if (doLike && !reactionCount) checks.push({ key: "reactions", ok: false, text: "Chưa chọn cảm xúc Facebook nào" });
  if (doComment && !commentCount) {
    checks.push({ key: "comments", ok: false, text: "Chưa có câu bình luận mẫu" });
  } else if (doComment && commentPerPost > 0 && commentVariants < commentPerPost) {
    checks.push({
      key: "comments",
      ok: false,
      text: `Bình luận chưa đủ: mỗi bài cần ${commentPerPost} câu khác nhau, mới có ${commentVariants}`,
    });
  }
  if (scheduleMissing) checks.push({ key: "schedule", ok: false, text: "Chưa chọn giờ hẹn chạy (hoặc giờ hẹn đã qua)" });
  if (!liveAccounts) {
    checks.push({ key: "accounts", ok: false, text: "Không có tài khoản Live + đã đăng nhập" });
  } else if (!accountCount) {
    checks.push({ key: "accounts", ok: false, text: "Chưa chọn tài khoản chạy" });
  } else {
    checks.push({ key: "accounts", ok: true, text: `Dùng ${accountCount} / ${liveAccounts} tài khoản khả dụng` });
  }
  const lo = Number(delayMin);
  const hi = Number(delayMax);
  if (!lo || !hi || hi <= lo || hi > 3600) {
    checks.push({ key: "delay", ok: false, text: "Thời gian nghỉ không hợp lệ (tối đa phải lớn hơn tối thiểu, ≤ 3600 giây)" });
  }
  if (fetchRunning) checks.push({ key: "fetch", ok: false, text: "Đang lấy bài viết từ page — dừng lấy bài trước khi chạy" });
  if (otherRunningLabel) checks.push({ key: "other", ok: false, text: `Đang chạy seeding ${otherRunningLabel} ở trang khác` });
  return checks;
}
