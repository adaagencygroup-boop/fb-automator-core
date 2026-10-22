"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCategories, getAccountsStats } from "../service";

export function useAccountCategories(enabled) {
  const [data, setData] = useState({ categories: [], total: 0, hasLoaded: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const generation = useRef(0);
  const upsertCategory = useCallback(category => {
    setData(previous => ({ ...previous, categories: previous.categories.some(item => item.id === category.id)
      ? previous.categories.map(item => item.id === category.id ? category : item)
      : [...previous.categories, category] }));
  }, []);
  const refresh = useCallback(async () => {
    const id = ++generation.current;
    setLoading(true);
    try {
      const [categories, totals] = await Promise.all([getCategories(), getAccountsStats()]);
      if (!Array.isArray(categories)) throw new Error("Dữ liệu danh mục không hợp lệ. Vui lòng thử lại.");
      if (id === generation.current) {
        setData({ categories, total: totals.total, hasLoaded: true });
        setError(null);
      }
    } catch (err) {
      if (id === generation.current) setError(err.message);
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }, []);
  // Load once when enabled; mutations explicitly refresh categories and their counts.
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => { if (enabled && !cancelled) refresh(); });
    return () => { cancelled = true; generation.current += 1; };
  }, [enabled, refresh]);
  return { ...data, loading, isInitialLoading: loading && !data.hasLoaded, isRefreshing: loading && data.hasLoaded, error, refresh, upsertCategory };
}
