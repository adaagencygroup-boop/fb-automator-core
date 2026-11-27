"use client";

import { useMemo } from "react";
import useRowMultiSelect from "@/modules/module_10_group_scan/components/useRowMultiSelect";

/**
 * Chọn nhiều dòng trong hộp chọn "Lấy từ danh sách quét" bằng chuột / bàn phím (dùng lại hook của Module 10):
 * kéo chuột bôi đen · Shift + click chọn khoảng · Ctrl + click thêm / bỏ từng dòng · click thường chỉ chọn dòng đó.
 * Khác Module 10: mọi thao tác CHỈ thay lựa chọn của các dòng đang hiện (trang đang xem) — người / nhóm đã chọn ở
 * trang khác, danh mục khác, tab khác hay link có sẵn trong ô nhập luôn được giữ.
 *
 * rows: các dòng chọn được, đúng thứ tự trên bảng · getKey(row) -> key lựa chọn · getUrl(row) -> link lưu vào Map
 * selected: Map key -> url · setSelected: setState của Map đó.
 * Trả về { setContainer (ref khung cuộn của bảng), rowProps(row, index) } — index là vị trí trong `rows`.
 */
export default function usePickerMultiSelect({ rows, getKey, getUrl, selected, setSelected }) {
  const selectedInView = useMemo(() => new Set(rows.map(getKey).filter((key) => selected.has(key))), [rows, getKey, selected]);

  return useRowMultiSelect({
    rows,
    allRows: rows,
    selected: selectedInView,
    getId: getKey,
    onChange: (nextInView) =>
      setSelected((prev) => {
        const next = new Map(prev);
        rows.forEach((row) => {
          const key = getKey(row);
          if (nextInView.has(key)) next.set(key, getUrl(row));
          else next.delete(key);
        });
        return next;
      }),
  });
}
