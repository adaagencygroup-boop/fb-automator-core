"use client";

import { useEffect, useRef, useState } from "react";
import { attachDragSelection } from "@/modules/module_02_account_manager/utils/drag-selection.mjs";

/**
 * Kéo chọn nhiều dòng trong danh sách có phân trang (cùng cơ chế kéo chọn của Quản lý tài khoản):
 * - Kéo chuột: chọn dải dòng liên tiếp của trang đang xem (giữ Ctrl để cộng thêm).
 * - Click: bật / tắt 1 dòng · Shift + click: chọn cả dải từ dòng bấm trước.
 * Lựa chọn ở các trang khác do nơi gọi giữ nguyên.
 *
 * ids: id các dòng đang hiển thị · isSelected(id)
 * onSet(ids đang hiển thị được chọn) · onToggle(id)
 */
export default function useDragRowSelect({ ids, isSelected, onSet, onToggle }) {
  const [container, setContainer] = useState(null);
  const latest = useRef({ keys: [], selected: [], onSet });
  const anchor = useRef(null);

  useEffect(() => {
    const keys = ids.map(String);
    latest.current = { keys, selected: keys.filter((k) => isSelected(k)), onSet };
  });

  useEffect(() => {
    if (!container) return undefined;
    return attachDragSelection(container, {
      getVisibleUids: () => latest.current.keys,
      getAvailableUids: () => latest.current.keys,
      getSelectedUids: () => latest.current.selected,
      onSelectionChange: (next) => {
        latest.current.selected = next;
        latest.current.onSet(next);
      },
    });
  }, [container]);

  const rowProps = (rawId) => {
    const id = String(rawId);
    return {
      "data-account-uid": id,
      onClick: (e) => {
        if (e.target.closest("a, button, input, [data-no-row-selection]")) return;
        const { keys, selected } = latest.current;
        const from = keys.indexOf(anchor.current);
        if (e.shiftKey && from >= 0) {
          const to = keys.indexOf(id);
          onSet([...new Set([...selected, ...keys.slice(Math.min(from, to), Math.max(from, to) + 1)])]);
          return;
        }
        anchor.current = id;
        onToggle(id);
      },
    };
  };

  return { setContainer, rowProps };
}
