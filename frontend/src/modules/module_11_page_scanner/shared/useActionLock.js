"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ACTION_LOCK_MS, createActionLock } from "./actionLock.mjs";

/**
 * Hook khoá nút trong lúc xử lý — mỗi nút / nhóm nút dùng 1 hook riêng:
 *
 *   const [stopping, guardStop, isStoppingApi] = useActionLock();
 *   <button disabled={stopping} aria-busy={isStoppingApi} onClick={() => guardStop(handleEmergencyStop)}>…</button>
 *
 * - `busy` (phần tử 0): true từ lúc bấm cho tới khi handler xong VÀ qua tối thiểu `minMs` (mặc định 1,5 giây) → gắn `disabled`.
 * - `guard` (phần tử 1): bọc handler; bấm liên tục chỉ chạy 1 lần.
 * - `running` (phần tử 2): chỉ true trong lúc tác vụ bất đồng bộ (API) đang thực sự chạy → gắn spinner / đổi nhãn.
 */
export function useActionLock(minMs = ACTION_LOCK_MS) {
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const mountedRef = useRef(true);
  const lockRef = useRef(null);
  if (!lockRef.current) {
    lockRef.current = createActionLock({
      minMs,
      onBusyChange: (value) => {
        if (mountedRef.current) setBusy(value);
      },
      onRunningChange: (value) => {
        if (mountedRef.current) setRunning(value);
      },
    });
  }

  useEffect(() => {
    mountedRef.current = true;
    const lock = lockRef.current;
    return () => {
      mountedRef.current = false;
      lock.dispose();
    };
  }, []);

  const run = useCallback((fn, ...args) => lockRef.current.run(fn, ...args), []);
  return [busy, run, running];
}

export default useActionLock;
