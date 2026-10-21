"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Render danh sách dài theo kiểu tăng dần (chống render hết cả nghìn phần tử một lúc).
 * Hiển thị `step` phần tử đầu, cuộn gần đáy thì tải thêm `step` nữa (IntersectionObserver).
 * Tự quay về đầu khi danh sách đổi (lọc/tìm kiếm) nhờ khoá suy ra từ độ dài + phần tử đầu.
 *
 * Dùng: const { slice, sentinelRef, hasMore } = useIncrementalList(items, 30);
 * Gắn <li ref={sentinelRef} /> ở cuối danh sách khi hasMore.
 */
export function useIncrementalList(items, step = 30) {
  const list = useMemo(() => (Array.isArray(items) ? items : []), [items]);
  const [limit, setLimit] = useState(step);
  const sentinelRef = useRef(null);

  // Giới hạn chỉ tăng khi cuộn; khi danh sách bị lọc ngắn lại thì slice tự hiển thị đúng số còn.
  const slice = useMemo(() => list.slice(0, limit), [list, limit]);
  const hasMore = limit < list.length;

  useEffect(() => {
    if (!hasMore) return undefined;
    const el = sentinelRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setLimit((l) => Math.min(l + step, list.length));
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, step, list.length]);

  return { slice, sentinelRef, hasMore };
}
