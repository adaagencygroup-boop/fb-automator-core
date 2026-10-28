"use client";

import { useMemo, useSyncExternalStore } from "react";
import { loadSavedPageLists, SAVED_LISTS_EVENT } from "../service";

function subscribe(onChange) {
  window.addEventListener("storage", onChange);
  window.addEventListener(SAVED_LISTS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SAVED_LISTS_EVENT, onChange);
  };
}

const getSnapshot = () => JSON.stringify(loadSavedPageLists());
const getServerSnapshot = () => "[]";

export function useSavedPageLists() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => JSON.parse(snapshot), [snapshot]);
}
