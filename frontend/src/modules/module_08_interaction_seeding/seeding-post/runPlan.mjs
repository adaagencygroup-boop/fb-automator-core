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

// Cách chia lượt (giống backend seeding_plan.py):
//   - "all": mọi nick tương tác trên mọi bài (cách cũ, mô tả ở đầu file)
//   - "rotation": mỗi bài 1 nick làm đủ các loại đã chọn; nick 1 làm N bài đầu, nick 2 N bài tiếp…
//     hết nick thì quay lại nick 1. Mỗi khối N bài chạy trên 1 phiên Chrome, các khối chạy song song theo số luồng.
export const DISTRIBUTION_ALL = "all";
export const DISTRIBUTION_ROTATION = "rotation";
export const DEFAULT_POSTS_PER_ACCOUNT = 50;
export const MAX_POSTS_PER_ACCOUNT = 5000;

export function clampPerAccount(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_POSTS_PER_ACCOUNT;
  return Math.min(MAX_POSTS_PER_ACCOUNT, n);
}

/**
 * Chia xoay vòng: khối thứ k (k = 0, 1, …) gồm bài [k·N + 1, (k+1)·N] do nick (k mod số nick) làm.
 * @returns {{ perAccount: number, blocks: number, activeAccounts: number,
 *   accounts: { index: number, posts: number, blocks: number, ranges: [number, number][] }[] }}
 */
export function rotationPlan({ accountCount, targetCount, perAccount }) {
  const acc = Math.max(0, Math.floor(Number(accountCount) || 0));
  const posts = Math.max(0, Math.floor(Number(targetCount) || 0));
  const per = clampPerAccount(perAccount);
  const blocks = acc && posts ? Math.ceil(posts / per) : 0;
  const accounts = Array.from({ length: acc }, (_, index) => ({ index, posts: 0, blocks: 0, ranges: [] }));
  for (let b = 0; b < blocks; b += 1) {
    const row = accounts[b % acc];
    const from = b * per + 1;
    const to = Math.min(posts, (b + 1) * per);
    row.posts += to - from + 1;
    row.blocks += 1;
    row.ranges.push([from, to]);
  }
  return { perAccount: per, blocks, activeAccounts: accounts.filter((a) => a.posts > 0).length, accounts };
}

export function sharePerPostRange(accountCount, targetCount) {
  if (targetCount <= 1) return [accountCount, accountCount];
  if (accountCount > 0 && accountCount < targetCount) return [1, 1];
  return [
    Math.max(1, Math.floor((4 * accountCount) / (5 * targetCount))),
    Math.ceil((6 * accountCount) / (5 * targetCount)),
  ];
}

export function planTotals({ accountCount, targetCount, doLike, doComment, doShare, mode = DISTRIBUTION_ALL }) {
  const acc = Math.max(0, Number(accountCount) || 0);
  const posts = Math.max(0, Number(targetCount) || 0);
  if (mode === DISTRIBUTION_ROTATION) {
    // Mỗi bài đúng 1 nick làm mỗi loại đã chọn 1 lần
    const one = acc > 0 ? 1 : 0;
    const react = doLike ? one : 0;
    const comment = doComment ? one : 0;
    const share = doShare ? one : 0;
    return {
      react,
      comment,
      shareMin: share,
      shareMax: share,
      totalReacts: posts * react,
      totalComments: posts * comment,
      totalShares: posts * share,
      total: posts * (react + comment + share),
    };
  }
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
export function estimateSeconds({
  accountCount,
  targetCount,
  delayMin,
  delayMax,
  totals,
  threads = CHROME_THREADS,
  spreadHours = 0,
  mode = DISTRIBUTION_ALL,
  perAccount = DEFAULT_POSTS_PER_ACCOUNT,
}) {
  const acc = Math.max(0, Number(accountCount) || 0);
  const posts = Math.max(0, Number(targetCount) || 0);
  if (!acc || !posts || !totals?.total) return 0;
  if (Number(spreadHours) > 0) return Math.round(Number(spreadHours) * 3600);
  const lanes = Math.max(1, Math.min(5, Number(threads) || CHROME_THREADS));
  const avgDelay = (Math.max(0, Number(delayMin) || 0) + Math.max(0, Number(delayMax) || 0)) / 2;
  if (mode === DISTRIBUTION_ROTATION) {
    // Mỗi khối: mở Chrome 1 lần rồi làm lần lượt các bài (nghỉ giữa các thao tác và giữa 2 bài);
    // các khối chạy song song theo số luồng nhưng 1 nick không chạy 2 khối cùng lúc.
    const plan = rotationPlan({ accountCount: acc, targetCount: posts, perAccount });
    const actionsPerPost = totals.total / posts;
    const postsPerBlock = posts / plan.blocks;
    const postSeconds = actionsPerPost * ACTION_S + Math.max(0, actionsPerPost - 1) * avgDelay;
    const blockSeconds = CHROME_OPEN_S + postsPerBlock * postSeconds + Math.max(0, postsPerBlock - 1) * avgDelay;
    const parallel = Math.max(1, Math.min(lanes, plan.activeAccounts));
    return Math.round(Math.ceil(plan.blocks / parallel) * blockSeconds);
  }
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
  mode = DISTRIBUTION_ALL,
  perAccount = DEFAULT_POSTS_PER_ACCOUNT,
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
  if (mode === DISTRIBUTION_ROTATION) {
    const n = Number(perAccount);
    if (!Number.isInteger(n) || n < 1 || n > MAX_POSTS_PER_ACCOUNT) {
      checks.push({ key: "perAccount", ok: false, text: `Số bài mỗi tài khoản phải từ 1 đến ${MAX_POSTS_PER_ACCOUNT.toLocaleString("vi-VN")}` });
    }
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
