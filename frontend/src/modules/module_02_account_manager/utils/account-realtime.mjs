export const TERMINAL_PHASES = new Set(["completed", "failed", "timeout", "closed"]);
export const PHASE_LABELS = {
  queued: "Đang chờ", opening: "Đang mở Chrome", waiting: "Chờ đăng nhập (tối đa 5 phút)",
  authenticated: "Đã đăng nhập · đang cập nhật hồ sơ", completed: "Đã hoàn tất",
  failed: "Thao tác thất bại", timeout: "Chưa phát hiện đăng nhập sau 5 phút", closed: "Đã dừng theo dõi",
};

export function isAccountBusy(progress) {
  return ["queued", "opening", "waiting", "authenticated"].includes(progress?.phase);
}

export function matchesAccountQuery(account, query) {
  if (query.status && query.status !== "all" && account.status !== query.status) return false;
  if (query.login_status && query.login_status !== "all" && account.login_status !== query.login_status) return false;
  const search = (query.search || "").trim().toLowerCase();
  return !search || [account.uid, account.profile_name, account.email].some(value => String(value || "").toLowerCase().includes(search));
}

// Only accept public row fields, even when consuming a recovered progress snapshot.
export function publicChanges(changes = {}) {
  return Object.fromEntries(["login_status", "status", "last_login_at", "profile_name", "avatar_url"]
    .filter(key => Object.hasOwn(changes, key)).map(key => [key, changes[key]]));
}

export function mergeAccountRows(rows, patches, query) {
  return rows.map(row => {
    const changes = patches.get(row.uid);
    if (!changes || Object.entries(changes).every(([key, value]) => row[key] === value)) return row;
    return { ...row, ...changes };
  }).filter(row => !patches.has(row.uid) || matchesAccountQuery(row, query));
}

// One network request at a time; requests received during it become one later pass.
export function createRefreshQueue(refresh, isBusy, { delay = 2000, now = Date.now, timer = setTimeout, cancel = clearTimeout } = {}) {
  let pending = false, running = false, timeout = null, last = -Infinity, disposed = false;
  const schedule = () => {
    if (disposed || timeout !== null || running || !pending) return;
    timeout = timer(run, Math.max(0, delay - (now() - last)));
  };
  const run = async () => {
    timeout = null;
    if (disposed) return;
    if (isBusy()) { timeout = timer(run, 100); return; }
    pending = false;
    running = true;
    last = now();
    try { await refresh(); } finally { running = false; schedule(); }
  };
  return {
    request() { pending = true; schedule(); },
    dispose() { disposed = true; pending = false; if (timeout !== null) cancel(timeout); },
  };
}
