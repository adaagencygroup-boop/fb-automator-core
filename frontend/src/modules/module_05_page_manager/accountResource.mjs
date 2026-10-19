// One instance belongs to one owner-keyed component; no account data is persisted.
export function createAccountResource(fetchAccounts, now = Date.now) {
  let snapshot = { accounts: [], loading: true, loaded: false, error: "" };
  let generation = null;
  let pending = null;
  let refresh = null;
  let updatedAt = null;
  const listeners = new Set();
  const publish = (patch) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((notify) => notify());
  };
  const resource = {
    getSnapshot: () => snapshot,
    subscribe: (notify) => { listeners.add(notify); return () => listeners.delete(notify); },
    activate: () => { generation = {}; resource.load(); },
    dispose: () => { generation = null; pending = null; refresh = null; },
    load: (force = false) => {
      if (!generation) return Promise.resolve();
      if (pending) {
        if (!force) return pending;
        // A completed OAuth job may invalidate an older, still-running GET.
        if (!refresh) {
          const current = generation;
          refresh = pending.then(() => {
            if (generation !== current) return;
            refresh = null;
            return resource.load(true);
          });
        }
        return refresh;
      }
      if (!force && updatedAt !== null && now() - updatedAt < 30_000) return Promise.resolve();
      const current = generation;
      publish({ loading: true, error: "" });
      const request = Promise.resolve().then(fetchAccounts).then((data) => {
        if (generation !== current) return;
        const accounts = Array.isArray(data) ? data : data?.accounts;
        if (!Array.isArray(accounts)) throw new Error("Dữ liệu danh sách tài khoản không hợp lệ.");
        updatedAt = now();
        publish({ accounts, loaded: true });
      }).catch((failure) => {
        if (generation === current) publish({ error: failure.message || "Không tải được danh sách tài khoản." });
      }).finally(() => {
        if (pending === request) pending = null;
        if (generation === current) publish({ loading: false });
      });
      pending = request;
      return request;
    },
  };
  return resource;
}
