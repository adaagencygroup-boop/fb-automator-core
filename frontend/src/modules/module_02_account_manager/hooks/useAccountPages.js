"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getAccountsPage, getAccountsStats } from "../service";

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
  useLayoutEffect(() => { current.current = { accounts, page }; }, [accounts, page]);

  const fetchAccounts = useCallback(async (reset = false) => {
    const id = ++generation.current;
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
      if (id === generation.current) setStats(result);
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
    const requestQuery = queryRef.current;
    busy.current = true;
    setIsLoadingMore(true);
    setMoreError(null);
    try {
      const result = await getAccountsPage({ ...requestQuery, cursor: current.current.page.next_cursor });
      if (id !== generation.current) return;
      const seen = new Set(current.current.accounts.map(row => row.uid));
      const rows = [...current.current.accounts, ...result.accounts.filter(row => !seen.has(row.uid))];
      current.current = { accounts: rows, page: result };
      setAccounts(rows);
      setPage(result);
    } catch (error) {
      if (id === generation.current) setMoreError(error.message);
    } finally {
      if (id === generation.current) { busy.current = false; setIsLoadingMore(false); }
    }
  }, []);

  const retryMore = useCallback(() => retryRefresh.current ? fetchAccounts() : loadMore(), [fetchAccounts, loadMore]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => { if (enabled && !cancelled) fetchAccounts(true); });
    return () => { cancelled = true; generation.current += 1; busy.current = false; };
  }, [query, enabled, fetchAccounts]);
  return { ...page, accounts, setAccounts, stats, isInitialLoading, isRefreshing, isLoadingMore, loadError, moreError, fetchAccounts, loadMore, retryMore };
}
