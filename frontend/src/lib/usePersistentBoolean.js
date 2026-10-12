"use client";

import { useCallback, useSyncExternalStore } from "react";

const CHANGE_EVENT = "persistent-boolean-change";
// Dự phòng khi localStorage bị chặn (chế độ riêng tư, chính sách trình duyệt...)
const memoryFallback = new Map();

function read(key, defaultValue) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? defaultValue : raw === "1";
  } catch {
    return memoryFallback.has(key) ? memoryFallback.get(key) : defaultValue;
  }
}

/**
 * Giá trị true/false được nhớ trong localStorage (đồng bộ giữa các tab).
 * Khi render phía server / lần đầu hydrate dùng `defaultValue`, sau đó đọc giá trị đã lưu.
 */
export function usePersistentBoolean(key, defaultValue) {
  const subscribe = useCallback(
    (onChange) => {
      const handler = (e) => {
        if (e.type === "storage" ? e.key === key : e.detail === key) onChange();
      };
      window.addEventListener("storage", handler);
      window.addEventListener(CHANGE_EVENT, handler);
      return () => {
        window.removeEventListener("storage", handler);
        window.removeEventListener(CHANGE_EVENT, handler);
      };
    },
    [key],
  );

  const value = useSyncExternalStore(
    subscribe,
    () => read(key, defaultValue),
    () => defaultValue,
  );

  const setValue = useCallback(
    (next) => {
      const resolved = typeof next === "function" ? next(read(key, defaultValue)) : next;
      try {
        localStorage.setItem(key, resolved ? "1" : "0");
      } catch {
        memoryFallback.set(key, resolved);
      }
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }));
    },
    [key, defaultValue],
  );

  return [value, setValue];
}
