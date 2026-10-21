"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getAccountsPage, getAccountsStats } from "../service";
import { createRefreshQueue, mergeAccountRows, publicChanges } from "../utils/account-realtime.mjs";

export function useAccountPages(query, enabled, tableRef, clearSelection) {
  const [accounts, setAccounts] = useState([]);
  const [stats, setStats] = useState({ total: 0, live: 0, die: 0 });
  const [page, setPage] = useState({ total: 0, next_cursor: null, has_more: false });
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [moreError, setMoreError] = useState(null);
  const generation = useRef(0);
  const queryRef = useRef(query);
  useLayoutEffect(() => { queryRef.current = query; }, [query]);
  const current = useRef({ accounts, page });
  const busy = useRef(false);
  const retryRefresh = useRef(false);
  const patchVersion = useRef(0);
  const patches = useRef(new Map());
  const refreshQueue = useRef(null);
  useLayoutEffect(() => { current.current = { accounts, page }; }, [accounts, page]);

  const fetchAccounts = useCallback(async (reset = false) => {
    if (!reset && busy.current) { refreshQueue.current?.request(); return; }
    const id = ++generation.current;
    const version = patchVersion.current;
    const requestQuery = queryRef.current;
    busy.current = true;
    setIsLoadingMore(false);
    setMoreError(null);
    retryRefresh.current = false;
    const target = reset ? 10 : Math.max(10, current.current.accounts.length);
    const anchor = reset ? null : tableRef.current?.capture();
    if (reset) {
      clearSelection([]);
      current.current = { accounts: [], page: { total: 0, next_cursor: null, has_more: false } };
      setAccounts([]);
      setPage({ total: 0, next_cursor: null, has_more: false });
      setIsInitialLoading(true);
      setIsRefreshing(false);
      tableRef.current?.reset();
    } else if (current.current.accounts.length > 0) {
      setIsRefreshing(true);
    }
    const statsRequest = getAccountsStats().then(result => {
      if (id === generation.current && version === patchVersion.current) setStats(result);
    }).catch(() => {});
    try {
      let rows = [], result, cursor;
      do {
        result = await getAccountsPage({ ...requestQuery, cursor });
        if (id !== generation.current) return;
        const seen = new Set(rows.map(row => row.uid));
        rows.push(...result.accounts.filter(row => !seen.has(row.uid)));
        cursor = result.next_cursor;
      } while (result.has_more && (rows.length < target || (anchor?.id && cursor >= anchor.id && !rows.some(row => row.uid === anchor.uid))));
      const newer = new Map([...patches.current].filter(([, item]) => item.version > version).map(([uid, item]) => [uid, item.changes]));
      rows = mergeAccountRows(rows, newer, requestQuery);
      for (const [uid, item] of patches.current) if (item.version <= version) patches.current.delete(uid);
      current.current = { accounts: rows, page: result };
      setAccounts(rows);
      setPage(result);
      clearSelection(selected => selected.filter(uid => rows.some(row => row.uid === uid)));
      setLoadError(null);
      if (anchor) tableRef.current?.restore(anchor);
    } catch (error) {
      if (id === generation.current) {
        if (current.current.accounts.length) { retryRefresh.current = true; setMoreError(error.message); }
        else setLoadError(error.message);
      }
    } finally {
      await statsRequest;
      if (id === generation.current) {
        busy.current = false;
        setIsInitialLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [tableRef, clearSelection]);

  const loadMore = useCallback(async () => {
    if (busy.current || !current.current.page.has_more) return;
    const id = generation.current;
    const version = patchVersion.current;
    const requestQuery = queryRef.current;
    busy.current = true;
    setIsLoadingMore(true);
    setMoreError(null);
    try {
      const result = await getAccountsPage({ ...requestQuery, cursor: current.current.page.next_cursor });
      if (id !== generation.current) return;
      const seen = new Set(current.current.accounts.map(row => row.uid));
      const newer = new Map([...patches.current].filter(([, item]) => item.version > version).map(([uid, item]) => [uid, item.changes]));
      const rows = [...current.current.accounts, ...mergeAccountRows(result.accounts.filter(row => !seen.has(row.uid)), newer, requestQuery)];
      current.current = { accounts: rows, page: result };
      setAccounts(rows);
      setPage(result);
    } catch (error) {
      if (id === generation.current) setMoreError(error.message);
    } finally {
      if (id === generation.current) { busy.current = false; setIsLoadingMore(false); }
    }
  }, []);

  const applyAccountPatches = useCallback((updates) => {
    const changes = new Map();
    for (const update of updates) {
      const fields = publicChanges(update.changes);
      if (!Object.keys(fields).length) continue;
      const previous = patches.current.get(update.uid)?.changes || {};
      patches.current.set(update.uid, { version: ++patchVersion.current, changes: { ...previous, ...fields } });
      changes.set(update.uid, fields);
    }
    if (!changes.size) return;
    const previousRows = current.current.accounts;
    let live = 0, die = 0;
    for (const row of previousRows) {
      const nextStatus = changes.get(row.uid)?.status;
      if (nextStatus === undefined || nextStatus === row.status) continue;
      live += Number(nextStatus === "live") - Number(row.status === "live");
      die += Number(nextStatus === "die") - Number(row.status === "die");
    }
    if (live || die) setStats(value => ({ ...value, live: Math.max(0, value.live + live), die: Math.max(0, value.die + die) }));
    const rows = mergeAccountRows(previousRows, changes, queryRef.current);
    const removed = new Set(previousRows.filter(row => !rows.includes(row) && !rows.some(next => next.uid === row.uid)).map(row => row.uid));
    current.current = { ...current.current, accounts: rows };
    setAccounts(rows);
    if (removed.size) clearSelection(selected => selected.filter(uid => !removed.has(uid)));
  }, [clearSelection]);

  const requestRefresh = useCallback(() => refreshQueue.current?.request(), []);

  const retryMore = useCallback(() => retryRefresh.current ? fetchAccounts() : loadMore(), [fetchAccounts, loadMore]);

  useEffect(() => {
    let cancelled = false;
    const queue = createRefreshQueue(() => fetchAccounts(), () => busy.current);
    refreshQueue.current = queue;
    Promise.resolve().then(() => { if (enabled && !cancelled) fetchAccounts(true); });
    return () => { cancelled = true; queue.dispose(); generation.current += 1; busy.current = false; };
  }, [query, enabled, fetchAccounts]);
  return { ...page, accounts, setAccounts, stats, isInitialLoading, isRefreshing, isLoadingMore, loadError, moreError, fetchAccounts, loadMore, retryMore, applyAccountPatches, requestRefresh };
}
