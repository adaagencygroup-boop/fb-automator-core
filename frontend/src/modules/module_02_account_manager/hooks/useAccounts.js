"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getAccounts } from "../service";
import { createRefreshQueue, matchesAccountQuery, publicChanges } from "../utils/account-realtime.mjs";

export function useAccounts(query, enabled, tableRef, clearSelection) {
  const [allAccounts, setAllAccounts] = useState([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [refreshError, setRefreshError] = useState(null);
  const current = useRef([]);
  const active = useRef(false);
  const loaded = useRef(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const queryRef = useRef(query);
  const viewVersion = useRef(0);
  const patchVersion = useRef(0);
  const patches = useRef(new Map());
  const refreshQueue = useRef(null);

  useLayoutEffect(() => {
    queryRef.current = query;
    viewVersion.current++;
    clearSelection([]);
    tableRef.current?.reset();
  }, [query, tableRef, clearSelection]);

  const commitRows = useCallback((rows, retainedSelection = null) => {
    current.current = rows;
    setAllAccounts(rows);
    const available = new Set(rows.filter(row => matchesAccountQuery(row, queryRef.current)).map(row => row.uid));
    clearSelection(selected => {
      const source = retainedSelection ?? selected;
      const next = source.filter(uid => available.has(uid));
      return next.length === selected.length && next.every((uid, index) => uid === selected[index]) ? selected : next;
    });
  }, [clearSelection]);

  // Journal local edits/deletions as well as SSE patches so an in-flight read
  // cannot bring back deleted rows or overwrite a just-saved edit.
  const setAccounts = useCallback(updater => {
    const previous = new Map(current.current.map(row => [row.uid, row]));
    const rows = typeof updater === "function" ? updater(current.current) : updater;
    const next = new Map(rows.map(row => [row.uid, row]));
    for (const uid of previous.keys()) {
      if (!next.has(uid)) patches.current.set(uid, { version: ++patchVersion.current, removed: true });
    }
    for (const row of rows) {
      const old = previous.get(row.uid);
      if (old === row) continue;
      const changes = Object.fromEntries(Object.entries(row).filter(([key, value]) => !old || old[key] !== value));
      if (!Object.keys(changes).length) continue;
      const pending = patches.current.get(row.uid);
      patches.current.set(row.uid, {
        version: ++patchVersion.current,
        changes: { ...pending?.changes, ...changes },
        row: !old || pending?.row ? row : undefined,
      });
    }
    commitRows(rows);
  }, [commitRows]);

  const fetchAccounts = useCallback(async (reset = false, retainedSelection = null) => {
    if (!active.current) return;
    if (!reset && retainedSelection === null && busy.current) {
      refreshQueue.current?.request();
      return;
    }
    const id = ++generation.current;
    const version = patchVersion.current;
    const view = viewVersion.current;
    const anchor = reset ? null : tableRef.current?.capture();
    busy.current = true;
    setIsInitialLoading(!loaded.current);
    setIsRefreshing(loaded.current);
    setLoadError(null);
    setRefreshError(null);
    if (reset) {
      clearSelection([]);
      tableRef.current?.reset();
    }
    try {
      const result = await getAccounts();
      if (id !== generation.current) return;
      const rows = new Map(result.map(row => [row.uid, row]));
      for (const [uid, patch] of patches.current) {
        if (patch.version <= version) {
          patches.current.delete(uid);
          continue;
        }
        if (patch.removed) rows.delete(uid);
        else if (rows.has(uid)) rows.set(uid, { ...rows.get(uid), ...patch.changes });
        else if (patch.row) rows.set(uid, { ...patch.row, ...patch.changes });
      }
      commitRows([...rows.values()].sort((a, b) => b.id - a.id), view === viewVersion.current ? retainedSelection : null);
      loaded.current = true;
      if (anchor && view === viewVersion.current) tableRef.current?.restore(anchor);
    } catch (error) {
      if (id === generation.current) {
        if (loaded.current) setRefreshError(error.message);
        else setLoadError(error.message);
      }
    } finally {
      if (id === generation.current) {
        busy.current = false;
        setIsInitialLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [tableRef, clearSelection, commitRows]);

  const applyAccountPatches = useCallback(updates => {
    if (!active.current) return;
    const changes = new Map();
    for (const update of updates) {
      const fields = publicChanges(update.changes);
      if (!Object.keys(fields).length) continue;
      const previous = patches.current.get(update.uid);
      // A late status event must not resurrect a locally deleted account.
      if (previous?.removed) continue;
      patches.current.set(update.uid, {
        ...previous, version: ++patchVersion.current, changes: { ...previous?.changes, ...fields },
      });
      changes.set(update.uid, { ...changes.get(update.uid), ...fields });
    }
    if (changes.size) commitRows(current.current.map(row => changes.has(row.uid) ? { ...row, ...changes.get(row.uid) } : row));
  }, [commitRows]);

  const requestRefresh = useCallback(() => refreshQueue.current?.request(), []);
  const invalidateRequests = useCallback(() => {
    generation.current++;
    busy.current = false;
    patches.current.clear();
  }, []);

  useEffect(() => {
    active.current = enabled;
    let cancelled = false;
    const queue = enabled ? createRefreshQueue(() => fetchAccounts(), () => busy.current) : null;
    refreshQueue.current = queue;
    Promise.resolve().then(() => {
      if (cancelled) return;
      if (enabled) void fetchAccounts(true);
      else {
        commitRows([]);
        loaded.current = false;
        setIsInitialLoading(false);
        setIsRefreshing(false);
      }
    });
    return () => {
      cancelled = true;
      active.current = false;
      queue?.dispose();
      refreshQueue.current = null;
      invalidateRequests();
    };
  }, [enabled, fetchAccounts, commitRows, invalidateRequests]);

  const accounts = useMemo(() => allAccounts.filter(row => matchesAccountQuery(row, query)), [allAccounts, query]);
  const stats = useMemo(() => ({
    total: allAccounts.length,
    live: allAccounts.filter(row => row.status === "live").length,
    die: allAccounts.filter(row => row.status === "die").length,
  }), [allAccounts]);

  return { accounts, allAccounts, setAccounts, stats, total: allAccounts.length,
    isInitialLoading, isRefreshing, loadError, refreshError, fetchAccounts, applyAccountPatches, requestRefresh };
}
