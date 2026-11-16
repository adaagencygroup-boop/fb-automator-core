"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import api from "@/services/api";

const HWID_TIMEOUT_MS = 8000;
const RETRY_GAP_MS = 1500;
/** Engine cold-start có thể lâu — retry trong khoảng này rồi báo lỗi rõ. */
const RETRY_BUDGET_MS = 180000;

/**
 * Lấy HWID từ Local Engine, tự retry khi engine đang boot.
 * Phân biệt loading / failed — tránh spinner treo vô hạn sau 1 lần gọi fail.
 */
export function useMachineHwid() {
  const [hwid, setHwid] = useState("");
  const [hwidLoading, setHwidLoading] = useState(true);
  const [hwidError, setHwidError] = useState("");
  const alive = useRef(true);
  const runId = useRef(0);

  const load = useCallback(async () => {
    const myRun = ++runId.current;
    const started = Date.now();
    setHwidLoading(true);
    setHwidError("");

    while (alive.current && myRun === runId.current && Date.now() - started < RETRY_BUDGET_MS) {
      try {
        const data = await api.get("/api/v1/auth/hwid", { timeout: HWID_TIMEOUT_MS });
        const value = String(data?.hwid || "").trim();
        if (value) {
          if (!alive.current || myRun !== runId.current) return "";
          setHwid(value);
          setHwidLoading(false);
          setHwidError("");
          return value;
        }
      } catch {
        /* engine chưa sẵn sàng */
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_GAP_MS));
    }

    if (!alive.current || myRun !== runId.current) return "";
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
