"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import api from "@/services/api";
import { isTauriShell } from "@/config/constants";

const HWID_TIMEOUT_MS = 8000;
const RETRY_GAP_MS = 800;
const RETRY_BUDGET_MS = 180000;
const HWID_CACHE_KEY = "fb_local_hwid_cache";

function readCachedHwid() {
  try {
    return String(sessionStorage.getItem(HWID_CACHE_KEY) || "").trim();
  } catch {
    return "";
  }
}

function writeCachedHwid(value) {
  try {
    if (value) sessionStorage.setItem(HWID_CACHE_KEY, value);
  } catch {
    /* private mode */
  }
}

async function readTauriHwid() {
  if (!isTauriShell()) return "";
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const value = String(await invoke("get_machine_hwid") || "").trim().toLowerCase();
    return value.length === 64 ? value : "";
  } catch {
    return "";
  }
}

/**
 * App đóng gói: lấy HWID từ Tauri ngay, không chờ Local Engine boot.
 * Web/dev: gọi API, retry khi engine chưa sẵn sàng.
 */
export function useMachineHwid() {
  const cached = typeof window !== "undefined" ? readCachedHwid() : "";
  const [hwid, setHwid] = useState(cached);
  const [hwidLoading, setHwidLoading] = useState(!cached);
  const [hwidError, setHwidError] = useState("");
  const alive = useRef(true);
  const runId = useRef(0);

  const load = useCallback(async () => {
    const myRun = ++runId.current;
    const started = Date.now();
    if (!readCachedHwid()) {
      setHwidLoading(true);
      setHwidError("");
    }

    const native = await readTauriHwid();
    if (native && alive.current && myRun === runId.current) {
      writeCachedHwid(native);
      setHwid(native);
      setHwidLoading(false);
      setHwidError("");
    }

    while (alive.current && myRun === runId.current && Date.now() - started < RETRY_BUDGET_MS) {
      try {
        const data = await api.get("/api/v1/auth/hwid", { timeout: HWID_TIMEOUT_MS });
        const value = String(data?.hwid || "").trim();
        if (value) {
          if (!alive.current || myRun !== runId.current) return native || "";
          writeCachedHwid(value);
          setHwid(value);
          setHwidLoading(false);
          setHwidError("");
          return value;
        }
      } catch {
        /* engine chưa sẵn sàng */
      }
      if (native) return native;
      await new Promise((resolve) => setTimeout(resolve, RETRY_GAP_MS));
    }

    if (!alive.current || myRun !== runId.current) return native || "";
    const fallback = native || readCachedHwid();
    if (fallback) {
      setHwid(fallback);
      setHwidLoading(false);
      setHwidError("");
      return fallback;
    }
    setHwidLoading(false);
    setHwidError("Chưa nhận diện được mã máy. Vui lòng kiểm tra Local Engine rồi thử lại.");
    return "";
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
      runId.current += 1;
    };
  }, [load]);

  return { hwid, hwidLoading, hwidError, setHwid, reloadHwid: load };
}
