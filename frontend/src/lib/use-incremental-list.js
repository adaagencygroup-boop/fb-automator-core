"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Render danh sách dài theo kiểu tăng dần (chống render hết cả nghìn phần tử một lúc).
 * Hiển thị `step` phần tử đầu, cuộn gần đáy thì tải thêm `step` nữa (IntersectionObserver).
 * Tự quay về đầu khi danh sách đổi (lọc/tìm kiếm) nhờ khoá suy ra từ độ dài + phần tử đầu.
 *
 * Dùng: const { slice, sentinelRef, hasMore } = useIncrementalList(items, 30);
 * Gắn <li ref={sentinelRef} /> ở cuối danh sách khi hasMore.
 *
 * `sentinelRef` là ref dạng HÀM chứ không phải useRef, và đó là có chủ ý: nơi gọi
 * có thể dựng danh sách muộn hơn component (ví dụ popover `{open && ...}`). Với
 * useRef thì effect chạy lúc phần tử chưa tồn tại, thấy ref rỗng nên thoát sớm, và
 * sau đó không có gì kích nó chạy lại — observer không bao giờ được gắn, cuộn
 * tới đáy cũng không tải thêm. Ref dạng hàm thì phần tử xuất hiện là báo ngay.
 */
export function useIncrementalList(items, step = 30) {
  const list = useMemo(() => (Array.isArray(items) ? items : []), [items]);
  const [limit, setLimit] = useState(step);
  const [sentinel, setSentinel] = useState(null);
  const sentinelRef = useCallback((el) => setSentinel(el), []);

  // Giới hạn chỉ tăng khi cuộn; khi danh sách bị lọc ngắn lại thì slice tự hiển thị đúng số còn.
  const slice = useMemo(() => list.slice(0, limit), [list, limit]);
  const hasMore = limit < list.length;

  useEffect(() => {
    if (!hasMore || !sentinel) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setLimit((l) => Math.min(l + step, list.length));
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [hasMore, step, list.length, sentinel]);

  return { slice, sentinelRef, hasMore };
}
