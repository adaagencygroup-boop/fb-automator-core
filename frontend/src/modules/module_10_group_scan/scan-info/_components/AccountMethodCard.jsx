"use client";

import { Users, Trash2, CloudUpload, X } from "lucide-react";
import {
  IconClose,
  IconTags,
  IconLink,
  IconUpload,
} from "../../components/icons";

const METHOD_TABS = [
  { id: "keyword", label: "Theo từ khóa", Icon: IconTags },
  { id: "link", label: "Nhập Link", Icon: IconLink },
  { id: "file", label: "Tải tệp (.txt / .csv / .excel)", Icon: IconUpload },
];

export function KeywordStatusBadge({ status }) {
  if (status === "done") {
    return (
      <span className="inline-flex rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[10px] font-semibold text-[#15803D]">
        Hoàn thành
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="inline-flex rounded-full bg-[#FFEDD5] px-2 py-0.5 text-[10px] font-semibold text-[#C2410C]">
        Đang quét
      </span>
    );
  }
  if (status === "paused") {
    return (
      <span className="inline-flex rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[10px] font-semibold text-[#B45309]">
        Tạm dừng
      </span>
    );
  }
  if (status === "ready") {
    return (
      <span className="inline-flex rounded-full bg-[#DBEAFE] px-2 py-0.5 text-[10px] font-semibold text-[#1D4ED8]">
        Sẵn sàng
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
      Chờ quét
    </span>
  );
}

export default function AccountMethodCard({
  onOpenAccountsModal,
  selectedUidsCount = 0,
  totalAccountsCount = 0,
  method,
  onMethodChange,
  // Method 1: Keyword
  keywordInput,
  onKeywordInputChange,
  onAddKeywords,
  onRunKeywordCheck,
  running = false,
  keywords,
  onRemoveKeyword,
  onClearAllKeywords,
  keywordStats,
  // Method 2: Link
  linkText,
  onLinkTextChange,
  onClearAllLinks,
  onCheckAndDeduplicateLinks,
  parsedLinks,
  onRemoveLink,
  // Method 3: File
  fileData,
  onFileUpload,
  onClearFile,
  fileFilter,
  onFileFilterChange,
  validFileRowsCount = 0,
  duplicateFileRowsCount = 0,
  displayedFileRows = [],
  skipInvalidRows = true,
  onSkipInvalidRowsChange,
}) {
  return (
    <section className="flex flex-col h-full rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-2.5 pb-3 mb-4 border-b border-[#F1F5F9]">
        <span className="flex size-6 items-center justify-center rounded-full bg-[#2563EB] text-[11px] font-bold text-white shrink-0">
          1
        </span>
        <h2 className="text-sm font-bold text-[#0B1C30]">
          Chọn tài khoản & Thiết lập phiên quét
        </h2>
      </div>

      <div className="mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#475569] mb-2">
          Tài khoản Facebook thực thi:
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onOpenAccountsModal}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#1877F2] px-3.5 text-xs font-semibold text-white hover:bg-blue-600 transition-colors shadow-sm"
          >
            <Users className="size-3.5" />
            <span>Chọn tài khoản</span>
          </button>
          <div className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-3 text-xs font-medium text-[#059669]">
            <span className="size-1.5 rounded-full bg-[#10B981] shrink-0" />
            <span>
              Đã chọn:{" "}
              <strong className="text-emerald-950 font-bold">
                {selectedUidsCount} / {totalAccountsCount}
              </strong>{" "}
              tài khoản
            </span>
          </div>
        </div>
      </div>

      {/* Tabs Phương thức */}
      <div className="mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B] mb-2">
          PHƯƠNG THỨC QUÉT MỤC TIÊU:
        </p>
        <div className="flex flex-wrap gap-2 border-b border-[#F1F5F9] pb-3">
          {METHOD_TABS.map((tab) => {
            const active = method === tab.id;
            const TabIcon = tab.Icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onMethodChange(tab.id)}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                  active
                    ? "border border-[#2563EB] bg-[#EFF6FF] text-[#2563EB]"
                    : "border border-transparent text-[#64748B] hover:bg-slate-50"
                }`}
              >
                <TabIcon color={active ? "#2563EB" : "#64748B"} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Keyword */}
      {method === "keyword" && (
        <div className="flex flex-col flex-1 space-y-3">
          <div className="flex flex-col gap-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC]/50 p-3">
            <div className="flex items-center gap-2 rounded-lg border border-[#CBD5E1] bg-white px-2.5 py-1.5 focus-within:border-[#2563EB] shadow-2xs">
              <input
                value={keywordInput}
                onChange={(event) => onKeywordInputChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === ",") {
                    event.preventDefault();
                    onAddKeywords();
                  }
                }}
                placeholder="VD: marketing — Enter hoặc dấu phẩy để thêm"
                className="flex-1 bg-transparent text-xs text-[#0F172A] outline-none placeholder:text-[#94A3B8]"
              />
              <button
                type="button"
                onClick={onAddKeywords}
                className="inline-flex h-7 items-center rounded-md border border-[#CBD5E1] bg-white px-3 text-[11px] font-semibold text-[#0F172A] hover:bg-slate-50 shrink-0 shadow-2xs transition-colors"
              >
                Thêm
              </button>
              <button
                type="button"
                onClick={onRunKeywordCheck}
                disabled={running}
                className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[#2563EB] px-3 text-[11px] font-bold text-white hover:bg-blue-600 disabled:opacity-60 shrink-0 shadow-2xs transition-colors"
              >
                Kiểm tra
              </button>
            </div>

            {/* Danh sách thẻ từ khóa */}
            {keywords.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 max-h-[58px] overflow-y-auto pr-1">
                {keywords.map((word) => (
                  <span
                    key={word}
                    className="inline-flex items-center gap-1 rounded-md border border-[#BFDBFE] bg-white px-2 py-0.5 text-[11px] font-medium text-[#0F172A] shadow-2xs"
                  >
                    {word}
                    <button
                      type="button"
                      onClick={() => onRemoveKeyword(word)}
                      className="rounded p-0.5 text-[#94A3B8] hover:bg-slate-100 hover:text-rose-600 transition-colors"
                      aria-label={`Xóa ${word}`}
                    >
                      <IconClose />
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={onClearAllKeywords}
                  className="text-[10px] text-rose-500 hover:underline font-medium ml-1"
                >
                  Xóa tất cả
                </button>
              </div>
            )}

            <div className="flex items-center justify-between px-0.5">
              <p className="text-[11px] text-[#94A3B8]">
                {keywords.length
                  ? `Đã thêm ${keywords.length} từ khóa. Bấm Kiểm tra để điền bảng bên dưới.`
                  : "Nhập xong Enter / Thêm / dấu phẩy → thẻ. Kiểm tra = xác nhận vào bảng."}
              </p>
              {keywords.length > 5 && (
                <span className="text-[10px] text-blue-600 font-medium shrink-0 ml-2">
                  Cuộn để xem thêm ({keywords.length} mục)
                </span>
              )}
            </div>
          </div>

          {/* Bảng Từ khóa */}
          <div className="flex-1 min-h-[140px] max-h-[260px] overflow-y-auto rounded-lg border border-[#E2E8F0] shadow-2xs">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-[#F8FAFC] border-b border-[#E2E8F0] text-[10px] font-bold uppercase tracking-wide text-[#64748B]">
                <tr>
                  <th className="px-3 py-2.5 bg-[#F8FAFC]">Từ khóa</th>
                  <th className="px-3 py-2.5 bg-[#F8FAFC]">Số nhóm quét được</th>
                  <th className="px-3 py-2.5 bg-[#F8FAFC]">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {keywords.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-[#94A3B8]">
                      Chưa có từ khóa.
                    </td>
                  </tr>
                ) : (
                  keywords.map((word) => {
                    const stat = keywordStats[word] || { count: "—", status: "idle" };
                    return (
                      <tr key={word} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-3 py-2.5 font-medium text-[#0F172A]">{word}</td>
                        <td className="px-3 py-2.5 tabular-nums text-[#64748B]">{stat.count}</td>
                        <td className="px-3 py-2.5">
                          <KeywordStatusBadge status={stat.status} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab Link */}
      {method === "link" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#0F172A]">Dán danh sách liên kết Group Facebook</span>
            <span className="inline-flex items-center rounded-lg bg-[#EFF6FF] px-2.5 py-1 text-xs font-semibold text-[#2563EB]">
              Đã nhận diện: {parsedLinks.length} link
            </span>
          </div>

          <textarea
            value={linkText}
            onChange={(event) => onLinkTextChange(event.target.value)}
            rows={7}
            placeholder={`https://www.facebook.com/groups/109283749210\nhttps://facebook.com/groups/congdongmarketingvn\nhttps://www.facebook.com/groups/kinhdoanhonline99`}
            className="w-full rounded-xl border border-[#CBD5E1] bg-white p-3 font-mono text-xs text-[#0F172A] leading-relaxed outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] resize-y shadow-2xs"
          />

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={onClearAllLinks}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#EF4444] hover:text-[#DC2626] transition-colors"
            >
              <Trash2 className="size-4" />
              Xóa tất cả
            </button>
            <button
              type="button"
              onClick={onCheckAndDeduplicateLinks}
              className="inline-flex h-9 items-center rounded-lg bg-[#2563EB] px-4 text-xs font-bold text-white shadow-sm hover:bg-blue-600 transition-colors"
            >
              Kiểm tra & Lọc trùng lặp
            </button>
          </div>

          <div className="space-y-2 pt-1">
            <div className="rounded-lg bg-[#F8FAFC] px-4 py-2.5 font-bold text-xs uppercase tracking-wide text-[#334155] border border-[#F1F5F9]">
              XEM TRƯỚC DANH SÁCH LINK ĐÃ NHẬP ({parsedLinks.length} LINK)
            </div>

            <div className="max-h-[220px] overflow-y-auto rounded-lg border border-[#E2E8F0] bg-white shadow-2xs">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 z-10 bg-[#F8FAFC] border-b border-[#E2E8F0] text-[10px] font-bold uppercase tracking-wide text-[#64748B]">
                  <tr>
                    <th className="w-14 px-3 py-2.5 text-center bg-[#F8FAFC]">STT</th>
                    <th className="px-3 py-2.5 bg-[#F8FAFC]">Đường dẫn Group Facebook</th>
                    <th className="w-24 px-3 py-2.5 text-center bg-[#F8FAFC]">Trạng thái</th>
                    <th className="w-10 px-2 py-2.5 bg-[#F8FAFC]"></th>
                  </tr>
                </thead>
                <tbody>
                  {parsedLinks.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-[#94A3B8]">
                        Chưa có liên kết nào. Hãy dán link và bấm Kiểm tra & Lọc trùng lặp.
                      </td>
                    </tr>
                  ) : (
                    parsedLinks.map((item) => (
                      <tr key={item.id} className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC]/60">
                        <td className="px-3 py-2 text-center text-[#64748B] font-mono">{item.stt}</td>
                        <td className="px-3 py-2">
                          <span
                            className="font-mono text-xs text-[#2563EB] hover:underline cursor-pointer"
                            title={item.url}
                          >
                            {item.url.replace(/^https?:\/\/(www\.)?/, "").length > 42
                              ? `...${item.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 38)}...`
                              : item.url.replace(/^https?:\/\/(www\.)?/, "")}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          {item.status === "valid" ? (
                            <span className="inline-flex items-center rounded-full bg-[#ECFDF5] border border-[#A7F3D0] px-2.5 py-0.5 text-[10px] font-semibold text-[#059669]">
                              Hợp lệ
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-[#FEE2E2] border border-[#FECACA] px-2.5 py-0.5 text-[10px] font-semibold text-[#B91C1C]">
                              Sai định dạng
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => onRemoveLink(item.id)}
                            className="rounded p-1 text-[#94A3B8] hover:text-[#EF4444] hover:bg-rose-50 transition-colors"
                            title="Xóa dòng này"
                          >
                            <X className="size-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab File */}
      {method === "file" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-bold text-[#0F172A]">Tải tệp danh sách nhóm (.txt / .csv / .xlsx)</span>
            <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-medium text-slate-600 hover:text-slate-900">
              <input
                type="checkbox"
                checked={skipInvalidRows}
                onChange={(e) => onSkipInvalidRowsChange?.(e.target.checked)}
                className="size-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <span>Bỏ qua các dòng trống và định dạng sai</span>
            </label>
          </div>
          <label className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-[#CBD5E1] rounded-2xl bg-white hover:bg-[#F8FAFC] transition-colors cursor-pointer group">
            <input
              type="file"
              accept=".txt,.csv,.xlsx,.xls"
              onChange={onFileUpload}
              className="hidden"
            />
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-[#EFF6FF] text-[#2563EB] group-hover:scale-105 transition-transform">
                <CloudUpload className="size-5" />
              </div>
              <p className="text-xs text-[#0F172A] font-semibold">
                Kéo thả file vào đây hoặc <span className="text-[#2563EB] hover:underline">Duyệt tìm tệp</span>
              </p>
              <p className="text-[11px] text-[#64748B]">Hỗ trợ .txt, .csv, .xlsx, .xls (mỗi dòng 1 từ khóa hoặc link)</p>
            </div>
          </label>

          {fileData && (
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between p-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC]">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="size-8 rounded-lg bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center font-bold text-xs uppercase shrink-0">
                    {fileData.name.split(".").pop()}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[#0F172A] truncate">{fileData.name}</p>
                    <p className="text-[11px] text-[#64748B]">{fileData.size}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClearFile}
                  className="rounded p-1 text-[#94A3B8] hover:text-[#EF4444] hover:bg-rose-50 transition-colors"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>

              <div className="flex items-center gap-1.5 border-b border-[#F1F5F9] pb-2">
                <button
                  type="button"
                  onClick={() => onFileFilterChange("all")}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    fileFilter === "all"
                      ? "bg-[#2563EB] text-white"
                      : "bg-[#F1F5F9] text-[#64748B] hover:bg-slate-200"
                  }`}
                >
                  Tất cả ({fileData.totalCount})
                </button>
                <button
                  type="button"
                  onClick={() => onFileFilterChange("valid")}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    fileFilter === "valid"
                      ? "bg-[#059669] text-white"
                      : "bg-[#F1F5F9] text-[#64748B] hover:bg-slate-200"
                  }`}
                >
                  Hợp lệ ({validFileRowsCount})
                </button>
                <button
                  type="button"
                  onClick={() => onFileFilterChange("duplicate")}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    fileFilter === "duplicate"
                      ? "bg-[#D97706] text-white"
                      : "bg-[#F1F5F9] text-[#64748B] hover:bg-slate-200"
                  }`}
                >
                  Trùng lặp ({duplicateFileRowsCount})
                </button>
              </div>

              <div className="max-h-[220px] overflow-y-auto rounded-lg border border-[#E2E8F0] bg-white shadow-2xs">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 z-10 bg-[#F8FAFC] border-b border-[#E2E8F0] text-[10px] font-bold uppercase tracking-wide text-[#64748B]">
                    <tr>
                      <th className="w-16 px-4 py-2.5 text-center bg-[#F8FAFC]">Dòng</th>
                      <th className="px-3 py-2.5 bg-[#F8FAFC]">Dữ liệu tệp</th>
                      <th className="w-24 px-3 py-2.5 text-center bg-[#F8FAFC]">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedFileRows.slice(0, 10).map((r, idx) => (
                      <tr key={r.id || idx} className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC]/60">
                        <td className="px-4 py-2 text-center text-[#64748B] font-mono">{r.line}</td>
                        <td className="px-3 py-2 font-mono text-xs text-[#0F172A]">{r.raw}</td>
                        <td className="px-3 py-2 text-center">
                          {r.status === "valid" ? (
                            <span className="inline-flex items-center rounded-full bg-[#ECFDF5] border border-[#A7F3D0] px-2.5 py-0.5 text-[10px] font-semibold text-[#059669]">
                              Hợp lệ
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-[#FEF3C7] border border-[#FDE68A] px-2.5 py-0.5 text-[10px] font-semibold text-[#D97706]">
                              Trùng lặp
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-right text-[11px] text-[#64748B]">
                Hiển thị {Math.min(displayedFileRows.length, 5)} trên {fileData.totalCount} dòng được phân tích
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

