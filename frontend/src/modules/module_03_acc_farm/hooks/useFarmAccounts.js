"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { categoryQuery } from "@/modules/module_02_account_manager/utils/categories.mjs";
import { getFarmAccountsPage } from "../service";

const pageParams = (filter) => ({ search: filter.search, ...categoryQuery(filter.category) });
const sameFilter = (a, b) => a.search === b.search && a.category === b.category;
const mergeKnown = (rows) => (current) => ({ ...current, ...Object.fromEntries(rows.map((account) => [account.uid, account])) });

export function useFarmAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [knownAccounts, setKnownAccounts] = useState({});
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [moreError, setMoreError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const filter = useRef({ search: "", category: "all" });
  const page = useRef({ cursor: null, hasMore: false, filter: { search: "", category: "all" } });
  useLayoutEffect(() => { filter.current = { search: search.trim(), category }; }, [search, category]);

  const fetchPage = useCallback(async (cursor, requestFilter) => {
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
      page.current = { cursor: null, hasMore: false, filter: requestFilter };
    } else {
      setLoadingMore(true);
    }
    try {
      const result = await getFarmAccountsPage(pageParams(requestFilter), cursor ?? undefined);
      if (id !== generation.current) return;
      const rows = result.accounts || [];
      setAccounts((current) => {
        if (first) return rows;
        const seen = new Set(current.map((account) => account.uid));
        return [...current, ...rows.filter((account) => !seen.has(account.uid))];
      });
      setKnownAccounts(mergeKnown(rows));
      setTotal(result.total || 0);
      const hasNext = Boolean(result.has_more && result.next_cursor != null);
      page.current = { cursor: result.next_cursor, hasMore: hasNext, filter: requestFilter };
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

  const reload = useCallback(() => fetchPage(null, filter.current), [fetchPage]);
  const loadMore = useCallback(() => {
    if (!page.current.hasMore || !sameFilter(page.current.filter, filter.current)) return;
    return fetchPage(page.current.cursor, filter.current);
  }, [fetchPage]);

  const resetFor = useCallback((apply) => {
    // Invalidate an old page immediately, including during the debounce period.
    generation.current += 1;
    busy.current = false;
    apply();
    setLoading(true);
    setLoadingMore(false);
    setLoadError("");
  }, []);
  const changeSearch = useCallback((value) => resetFor(() => setSearch(value)), [resetFor]);
  const changeCategory = useCallback((value) => {
    if (value !== filter.current.category) resetFor(() => setCategory(value));
  }, [resetFor]);

  useEffect(() => {
    const timer = setTimeout(reload, 300);
    return () => {
      clearTimeout(timer);
      generation.current += 1;
      busy.current = false;
    };
  }, [search, category, reload]);

  return {
    accounts, knownAccounts, search, changeSearch, category, changeCategory, total,
    loading, loadingMore, loadError, moreError, hasMore, reload, loadMore,
  };
}
