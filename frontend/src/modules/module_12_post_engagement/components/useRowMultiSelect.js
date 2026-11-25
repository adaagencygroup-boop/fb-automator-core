"use client";

import { useEffect, useRef, useState } from "react";
import { attachDragSelection } from "@/modules/module_02_account_manager/utils/drag-selection.mjs";

/**
 * Chọn nhiều dòng trong bảng bằng chuột / bàn phím (dùng chung cơ chế kéo chọn của Quản lý tài khoản):
 * - Giữ chuột trái trên 1 dòng rồi kéo: bôi đen các dòng liên tiếp (giữ Ctrl khi kéo để cộng thêm).
 * - Click 1 dòng: chỉ chọn dòng đó · Ctrl + click: thêm / bỏ từng dòng · Shift + click: chọn cả khoảng.
 *
 * rows: các dòng đang hiển thị (đúng thứ tự trên bảng) · allRows: mọi dòng có thể chọn (vd. mọi trang)
 * selected: Set id đang chọn · onChange(nextSet)
 * Trả về { setContainer (gắn vào ref của khung bảng), rowProps(row, index) (trải vào <tr>) }.
 * Ô checkbox nên có data-no-row-selection để bấm vào chỉ bật/tắt đúng dòng đó.
 */
export default function useRowMultiSelect({ rows, allRows = rows, selected, onChange, getId = (row) => row.id }) {
  const [container, setContainer] = useState(null);
  const rowsRef = useRef(rows);
  const allRef = useRef(allRows);
  const selectedRef = useRef(selected);
  const anchorRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const getIdRef = useRef(getId);
  rowsRef.current = rows;
  allRef.current = allRows;
  selectedRef.current = selected;
  onChangeRef.current = onChange;
  getIdRef.current = getId;

  useEffect(() => {
    if (!container) return undefined;
    const idOf = new Map();
    const key = (row) => {
      const id = getIdRef.current(row);
      const k = String(id);
      idOf.set(k, id);
      return k;
    };
    return attachDragSelection(container, {
      getVisibleUids: () => rowsRef.current.map(key),
      getAvailableUids: () => allRef.current.map(key),
      getSelectedUids: () => [...selectedRef.current].map(String),
      onSelectionChange: (keys) => {
        const next = new Set(keys.map((k) => (idOf.has(k) ? idOf.get(k) : k)));
        selectedRef.current = next;
        onChangeRef.current(next);
      },
    });
  }, [container]);

  const handleRowClick = (event, row, index) => {
    if (event.target.closest("a, button, input, select, textarea, [role='checkbox'], [data-no-row-selection]")) return;
    const id = getIdRef.current(row);
    const current = selectedRef.current;
    let next;
    if (event.shiftKey && anchorRef.current != null) {
      const ids = rowsRef.current.map((r) => getIdRef.current(r));
      const from = ids.indexOf(anchorRef.current);
      const [lo, hi] = from < 0 ? [index, index] : [Math.min(from, index), Math.max(from, index)];
      next = new Set(event.ctrlKey || event.metaKey ? current : []);
      ids.slice(lo, hi + 1).forEach((x) => next.add(x));
      window.getSelection?.()?.removeAllRanges?.();
    } else if (event.ctrlKey || event.metaKey) {
      next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      anchorRef.current = id;
    } else {
      next = current.size === 1 && current.has(id) ? new Set() : new Set([id]);
      anchorRef.current = id;
    }
    selectedRef.current = next;
    onChangeRef.current(next);
  };

  const rowProps = (row, index) => ({
    "data-account-uid": String(getIdRef.current(row)),
    onClick: (event) => handleRowClick(event, row, index),
  });

  return { setContainer, rowProps };
}
