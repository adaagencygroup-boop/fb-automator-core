"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getPageLists, PAGE_LISTS_EVENT } from "../service";

/**
 * Danh mục page đã lưu (DB). Tự tải lại khi màn nào đó tạo / lưu / xoá danh mục
 * (service bắn PAGE_LISTS_EVENT sau mỗi lệnh ghi).
 */
export function usePageLists({ enabled = true } = {}) {
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(false);
  const seqRef = useRef(0);

  const reload = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const items = await getPageLists();
      if (seq === seqRef.current) setLists(items);
      return items;
    } catch (err) {
      console.error("[PageScanner] tải danh mục page lỗi:", err);
      return null;
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    reload();
    const onChange = () => reload();
    window.addEventListener(PAGE_LISTS_EVENT, onChange);
    return () => window.removeEventListener(PAGE_LISTS_EVENT, onChange);
  }, [enabled, reload]);

  return { lists, loading, reload };
}
