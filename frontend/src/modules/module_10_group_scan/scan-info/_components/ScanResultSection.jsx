"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, FileSpreadsheet, FileText } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import CustomSelect from "@/components/ui/custom-select";
import {
  IconDownload,
  IconExternal,
  IconSearch,
} from "../../components/icons";

const RESULT_TYPE_OPTIONS = [
  { value: "all", label: "Loại nhóm: Tất cả" },
  { value: "public", label: "Công khai" },
  { value: "private", label: "Riêng tư" },
];

const RESULT_MEMBERS_OPTIONS = [
  { value: "all", label: "Thành viên: Tất cả" },
  { value: "under50k", label: "Dưới 50.000" },
  { value: "50k_200k", label: "50.000 - 200.000" },
  { value: "over200k", label: "Trên 200.000" },
];

const RESULT_NOTE_OPTIONS = [
  { value: "all", label: "Ghi chú: Tất cả" },
  { value: "not_joined", label: "Chưa vào nhóm" },
  { value: "joined", label: "Đã tham gia" },
  { value: "pending", label: "Đang chờ QTV duyệt" },
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

export function NoteBadge({ note }) {
  if (note === "joined" || note === "Đã tham gia") {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-[#DBEAFE] px-2 py-0.5 text-[10px] font-semibold text-[#1D4ED8]">
        Đã tham gia
      </span>
    );
  }
  if (note === "pending" || note === "Đang chờ QTV duyệt" || (typeof note === "string" && note.includes("Đang chờ"))) {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-[#FFEDD5] px-2 py-0.5 text-[10px] font-semibold text-[#C2410C]">
        Đang chờ QTV duyệt
      </span>
    );
  }
  if (note === "not_joined" || note === "Chưa vào nhóm") {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-[#FEE2E2] px-2 py-0.5 text-[10px] font-semibold text-[#B91C1C]">
        Chưa vào nhóm
      </span>
    );
  }
  return <span className="text-[11px] text-[#94A3B8]">{note || "—"}</span>;
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
  filterType,
  onFilterTypeChange,
  filterMembers,
  onFilterMembersChange,
  filterKeyword,
  onFilterKeywordChange,
  keywordOptions,
  filterNote,
  onFilterNoteChange,
  allVisibleSelected,
  onToggleAllRows,
  onToggleRow,
}) {
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportRef = useRef(null);

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
          <h2 className="text-sm font-bold text-[#0B1C30]">Kết quả quét</h2>
          <span className="rounded-full bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-semibold text-[#2563EB]">
            {filteredResults.length} nhóm
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
            value={filterType}
            onChange={onFilterTypeChange}
            options={RESULT_TYPE_OPTIONS}
            size="sm"
            className="w-full"
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
        <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[130px]">
          <CustomSelect
            value={filterNote}
            onChange={onFilterNoteChange}
            options={RESULT_NOTE_OPTIONS}
            size="sm"
            className="w-full"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-left text-xs">
          <thead className="bg-[#F8FAFC] text-[10px] font-bold uppercase tracking-wide text-[#64748B]">
            <tr>
              <th className="w-10 px-4 py-2.5">
                <Checkbox checked={allVisibleSelected} onCheckedChange={(value) => onToggleAllRows(Boolean(value))} />
              </th>
              <th className="w-14 px-2 py-2.5">STT</th>
              <th className="px-3 py-2.5">Từ khóa</th>
              <th className="px-3 py-2.5">Tên nhóm</th>
              <th className="whitespace-nowrap px-3 py-2.5">Loại nhóm</th>
              <th className="px-3 py-2.5">Thành viên</th>
              <th className="px-3 py-2.5">Liên kết / URL nhóm</th>
              <th className="px-3 py-2.5">Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {filteredResults.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-14 text-center text-sm text-[#94A3B8]">
                  Chưa có kết quả. Chọn tài khoản và bấm Bắt đầu khi luồng quét đã nối.
                </td>
              </tr>
            ) : (
              filteredResults.map((row, index) => (
                <tr key={row.id || index} className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC]/60">
                  <td className="px-4 py-2.5">
                    <Checkbox
                      checked={selectedRows.has(row.id)}
                      onCheckedChange={(value) => onToggleRow(row.id, Boolean(value))}
                    />
                  </td>
                  <td className="px-2 py-2.5 text-[#64748B]">{index + 1}</td>
                  <td className="px-3 py-2.5 text-[#64748B]">{row.keyword}</td>
                  <td className="px-3 py-2.5 font-semibold text-[#0F172A]">{row.name}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <TypeBadge type={row.type} />
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-[#0F172A]">{row.members}</td>
                  <td className="px-3 py-2.5">
                    <a
                      href={`https://${row.url}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[#2563EB] hover:underline"
                    >
                      {row.url}
                      <IconExternal color="#2563EB" />
                    </a>
                  </td>
                  <td className="px-3 py-2.5">
                    <NoteBadge note={row.note} />
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
