"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getFarmAccountsPage } from "../service";

export function useFarmAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [knownAccounts, setKnownAccounts] = useState({});
  const [search, setSearch] = useState("");
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [moreError, setMoreError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const query = useRef("");
  const page = useRef({ cursor: null, hasMore: false, query: "" });
  useLayoutEffect(() => { query.current = search.trim(); }, [search]);

  const fetchPage = useCallback(async (cursor, requestQuery) => {
    const first = cursor == null;
    if (!first && busy.current) return;
    const id = ++generation.current;
    busy.current = true;
    setMoreError("");
    if (first) {
      setLoading(true);
      setLoadingMore(false);
      setLoadError("");
      setAccounts([]);
      setTotal(0);
      setHasMore(false);
      page.current = { cursor: null, hasMore: false, query: requestQuery };
    } else {
      setLoadingMore(true);
    }
    try {
      const result = await getFarmAccountsPage(requestQuery, cursor ?? undefined);
      if (id !== generation.current) return;
      const rows = result.accounts || [];
      setAccounts((current) => {
        if (first) return rows;
        const seen = new Set(current.map((account) => account.uid));
        return [...current, ...rows.filter((account) => !seen.has(account.uid))];
      });
      setKnownAccounts((current) => ({ ...current, ...Object.fromEntries(rows.map((account) => [account.uid, account])) }));
      setTotal(result.total || 0);
      const hasNext = Boolean(result.has_more && result.next_cursor != null);
      page.current = { cursor: result.next_cursor, hasMore: hasNext, query: requestQuery };
      setHasMore(hasNext);
    } catch (error) {
      if (id !== generation.current) return;
      if (first) setLoadError(error.message || "Không tải được tài khoản.");
      else setMoreError(error.message || "Không tải thêm được tài khoản.");
    } finally {
      if (id === generation.current) {
        busy.current = false;
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  const reload = useCallback(() => fetchPage(null, query.current), [fetchPage]);
  const loadMore = useCallback(() => {
    if (!page.current.hasMore || page.current.query !== query.current) return;
    return fetchPage(page.current.cursor, query.current);
  }, [fetchPage]);
  const changeSearch = useCallback((value) => {
    // Invalidate an old page immediately, including during the debounce period.
    generation.current += 1;
    busy.current = false;
    setSearch(value);
    setLoading(true);
    setLoadingMore(false);
    setLoadError("");
  }, []);

  useEffect(() => {
    const timer = setTimeout(reload, 300);
    return () => {
      clearTimeout(timer);
      generation.current += 1;
      busy.current = false;
    };
  }, [search, reload]);

  return { accounts, knownAccounts, search, changeSearch, total, loading, loadingMore, loadError, moreError, hasMore, reload, loadMore };
}
