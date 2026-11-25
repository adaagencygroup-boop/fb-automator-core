import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Chống bấm liên tục: chạy handler ngay lần bấm đầu, bỏ qua mọi lần bấm trong `ms` tiếp theo.
 * Khóa bằng ref (có hiệu lực tức thì, không chờ render); `locked` dùng để disable nút.
 */
export function useClickLock(ms = 1000) {
  const lockedRef = useRef(false);
  const timerRef = useRef(null);
  const [locked, setLocked] = useState(false);

  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      lockedRef.current = false;
    },
    [],
  );

  const runLocked = useCallback(
    (handler) => {
      if (lockedRef.current) return;
      lockedRef.current = true;
      setLocked(true);
      timerRef.current = setTimeout(() => {
        lockedRef.current = false;
        setLocked(false);
      }, ms);
      handler();
    },
    [ms],
  );

  return [locked, runLocked];
}
