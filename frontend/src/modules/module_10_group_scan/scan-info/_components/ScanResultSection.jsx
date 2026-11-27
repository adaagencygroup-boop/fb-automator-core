"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, FileSpreadsheet, FileText } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import CustomSelect from "@/components/ui/custom-select";
import { attachDragSelection } from "@/modules/module_02_account_manager/utils/drag-selection.mjs";
import {
  IconDownload,
  IconExternal,
  IconSearch,
} from "../../components/icons";

const RESULT_MEMBERS_OPTIONS = [
  { value: "all", label: "Thành viên: Tất cả" },
  { value: "under50k", label: "Dưới 50.000" },
  { value: "50k_200k", label: "50.000 - 200.000" },
  { value: "over200k", label: "Trên 200.000" },
];

export function TypeBadge({ type }) {
  if (type === "private") {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-[#F3E8FF] px-2.5 py-0.5 text-[10px] font-semibold text-[#7C3AED]">
        Riêng tư
      </span>
    );
  }
  return (
    <span className="inline-flex whitespace-nowrap rounded-full bg-[#DCFCE7] px-2.5 py-0.5 text-[10px] font-semibold text-[#15803D]">
      Công khai
    </span>
  );
}

export default function ScanResultSection({
  results,
  filteredResults,
  onExportExcel,
  onExportFile,
  method,
  onOpenSaveModal,
  selectedRows,
  resultQuery,
  onResultQueryChange,
  filterMembers,
  onFilterMembersChange,
  filterKeyword,
  onFilterKeywordChange,
  keywordOptions,
  allVisibleSelected,
  onToggleAllRows,
  onToggleRow,
  onSelectRows,
}) {
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportRef = useRef(null);

  // Chọn nhiều nhóm bằng chuột / bàn phím:
  // - Giữ chuột trái trên 1 dòng rồi kéo: bôi đen các dòng liên tiếp (giữ Ctrl khi kéo để cộng thêm).
  // - Click 1 dòng: chỉ chọn dòng đó · Ctrl + click: thêm / bỏ từng dòng riêng lẻ · Shift + click: chọn cả khoảng.
  const [tableBox, setTableBox] = useState(null);
  const rowsRef = useRef(filteredResults);
  const resultsRef = useRef(results);
  const selectedRef = useRef(selectedRows);
  const anchorRef = useRef(null);
  rowsRef.current = filteredResults;
  resultsRef.current = results;
  selectedRef.current = selectedRows;

  useEffect(() => {
    if (!tableBox || !onSelectRows) return undefined;
    const idOf = new Map();
    const key = (row) => {
      const k = String(row.id);
      idOf.set(k, row.id);
      return k;
    };
    return attachDragSelection(tableBox, {
      getVisibleUids: () => rowsRef.current.map(key),
      getAvailableUids: () => resultsRef.current.map(key),
      getSelectedUids: () => [...selectedRef.current].map(String),
      onSelectionChange: (keys) => {
        const next = new Set(keys.map((k) => (idOf.has(k) ? idOf.get(k) : k)));
        selectedRef.current = next;
        onSelectRows(next);
      },
    });
  }, [tableBox, onSelectRows]);

  const handleRowClick = (event, row, index) => {
    if (!onSelectRows || event.target.closest("a, button, input, [role='checkbox'], [data-no-row-selection]")) return;
    const current = selectedRef.current;
    let next;
    if (event.shiftKey && anchorRef.current != null) {
      const ids = rowsRef.current.map((r) => r.id);
      const from = ids.indexOf(anchorRef.current);
      const [lo, hi] = from < 0 ? [index, index] : [Math.min(from, index), Math.max(from, index)];
      next = new Set(event.ctrlKey || event.metaKey ? current : []);
      ids.slice(lo, hi + 1).forEach((id) => next.add(id));
    } else if (event.ctrlKey || event.metaKey) {
      next = new Set(current);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      anchorRef.current = row.id;
    } else {
      next = current.size === 1 && current.has(row.id) ? new Set() : new Set([row.id]);
      anchorRef.current = row.id;
    }
    if (event.shiftKey) window.getSelection?.()?.removeAllRanges?.();
    selectedRef.current = next;
    onSelectRows(next);
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (exportRef.current && !exportRef.current.contains(event.target)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleExport = (format) => {
    setExportMenuOpen(false);
    if (onExportFile) {
      onExportFile(format);
    } else if (onExportExcel) {
      onExportExcel();
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F1F5F9] px-5 py-4">
        <div className="flex items-center gap-2">
          <h2 className="font-heading text-base font-semibold text-[#0F172A]">Kết quả quét</h2>
          <span className="rounded-full bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-semibold text-[#2563EB]">
            {filteredResults.length !== results.length
              ? `${filteredResults.length} / ${results.length} nhóm (đang lọc)`
              : `${results.length} nhóm`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Menu Xuất file kép Excel / CSV (UC-GIS-08) */}
          <div className="relative" ref={exportRef}>
            <button
              type="button"
              onClick={() => setExportMenuOpen(!exportMenuOpen)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 text-xs font-semibold text-[#334155] hover:bg-slate-50 transition-colors shadow-2xs"
            >
              <IconDownload color="#475569" />
              <span>
                Xuất file {selectedRows.size > 0 ? `(${selectedRows.size} đã chọn)` : ""}
              </span>
              <ChevronDown className="size-3 text-slate-400" />
            </button>

            {exportMenuOpen && (
              <div className="absolute right-0 top-9 z-20 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg animate-in fade-in duration-150">
                <button
                  type="button"
                  onClick={() => handleExport("xlsx")}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <FileSpreadsheet className="size-4 text-emerald-600 shrink-0" />
                  <div>
                    <p className="font-semibold text-slate-800">Xuất Excel (.xlsx)</p>
                    <p className="text-[10px] text-slate-400">Khuyến nghị, định dạng chuẩn</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport("csv")}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <FileText className="size-4 text-blue-600 shrink-0" />
                  <div>
                    <p className="font-semibold text-slate-800">Xuất CSV (.csv)</p>
                    <p className="text-[10px] text-slate-400">Chuẩn UTF-8 with BOM</p>
                  </div>
                </button>
              </div>
            )}
          </div>

          {method !== "keyword" && (
            <button
              type="button"
              onClick={onOpenSaveModal}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 text-xs font-bold text-white shadow-xs hover:bg-blue-700 transition-colors"
            >
              Lưu vào danh sách chung
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 border-b border-[#F1F5F9] px-5 py-3 w-full">
        <div className="relative flex-1 min-w-[200px]">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8]">
            <IconSearch color="#94A3B8" />
          </span>
          <input
            value={resultQuery}
            onChange={(event) => onResultQueryChange(event.target.value)}
            placeholder="Tìm Tên, Link, Từ khóa..."
            className="h-8 w-full rounded-lg border border-[#E2E8F0] pl-8 pr-3 text-xs outline-none focus:border-[#2563EB] transition-colors"
          />
        </div>
        <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[130px]">
          <CustomSelect
            value={filterMembers}
            onChange={onFilterMembersChange}
            options={RESULT_MEMBERS_OPTIONS}
            size="sm"
            className="w-full"
          />
        </div>
        <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[130px]">
          <CustomSelect
            value={filterKeyword}
            onChange={onFilterKeywordChange}
            options={keywordOptions}
            size="sm"
            className="w-full"
          />
        </div>
      </div>

      {filteredResults.length > 0 && onSelectRows && (
        <p className="mb-2 text-[11px] text-[#94A3B8]">
          Mẹo: giữ chuột trái và kéo để chọn nhiều nhóm liên tiếp · Ctrl + click chọn từng nhóm riêng lẻ · Shift + click
          chọn cả khoảng.
        </p>
      )}
      <div ref={setTableBox} className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-left text-xs">
          <thead className="bg-[#F8FAFC] text-xs font-semibold uppercase tracking-[0.3px] [&_th]:font-semibold text-[#64748B]">
            <tr>
              <th className="w-10 px-4 py-2.5">
                <Checkbox checked={allVisibleSelected} onCheckedChange={(value) => onToggleAllRows(Boolean(value))} />
              </th>
              <th className="w-14 whitespace-nowrap px-2 py-2.5">STT</th>
              <th className="whitespace-nowrap px-3 py-2.5">Từ khóa</th>
              <th className="whitespace-nowrap px-3 py-2.5">Tên nhóm</th>
              <th className="whitespace-nowrap px-3 py-2.5">Thành viên</th>
              <th className="whitespace-nowrap px-3 py-2.5">Liên kết / URL nhóm</th>
            </tr>
          </thead>
          <tbody>
            {filteredResults.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-14 text-center text-sm text-[#94A3B8]">
                  Chưa có kết quả. Chọn tài khoản và bấm Bắt đầu khi luồng quét đã nối.
                </td>
              </tr>
            ) : (
              filteredResults.map((row, index) => (
                <tr
                  key={row.id || index}
                  data-account-uid={String(row.id)}
                  onClick={(event) => handleRowClick(event, row, index)}
                  className={`border-t border-[#F1F5F9] select-none ${
                    selectedRows.has(row.id) ? "bg-[#EFF6FF] hover:bg-[#DBEAFE]" : "hover:bg-[#F8FAFC]/60"
                  } ${onSelectRows ? "cursor-pointer" : ""}`}
                >
                  {/* Ô checkbox: bấm để thêm / bỏ đúng dòng này (không bỏ chọn các dòng khác) */}
                  <td className="px-4 py-2.5" data-no-row-selection>
                    <Checkbox
                      checked={selectedRows.has(row.id)}
                      onCheckedChange={(value) => onToggleRow(row.id, Boolean(value))}
                    />
                  </td>
                  <td className="px-2 py-2.5 text-[#64748B]">{index + 1}</td>
                  {/* Từ khóa luôn 1 dòng; dài (vd link nhóm) thì cắt "…" và hiện đủ khi rê chuột */}
                  <td className="max-w-[200px] truncate whitespace-nowrap px-3 py-2.5 text-[#64748B]" title={row.keyword}>
                    {row.keyword}
                  </td>
                  <td className="px-3 py-2.5 font-semibold text-[#0F172A]">{row.name}</td>
                  <td className="px-3 py-2.5 tabular-nums text-[#0F172A]">{row.members}</td>
                  <td className="px-3 py-2.5">
                    <a
                      href={`https://${row.url}`}
                      title={`https://${row.url}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[#2563EB] hover:underline"
                    >
                      {row.url}
                      <IconExternal color="#2563EB" />
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
