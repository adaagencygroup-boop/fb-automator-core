"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Theo dõi một media query (vd "(max-width: 1279px)").
 * Dùng useSyncExternalStore nên an toàn với SSR và không cần setState trong effect.
 * Lúc render phía server luôn trả false (coi như màn rộng) để tránh lệch hydrate.
 */
export function useMediaQuery(query) {
  const subscribe = useCallback(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  }, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
