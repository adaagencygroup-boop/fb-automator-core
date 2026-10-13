"use client";

import React, { useState } from "react";
import { Link2, FileSpreadsheet, RotateCcw, CheckCircle2, Trash2, ExternalLink } from "lucide-react";
import { SeedingTargetItem } from "@/types/seeding";
import ExcelImportModal from "../../_components/ExcelImportModal";

interface ProfileTargetSectionProps {
  targets: SeedingTargetItem[];
  onAddTargets: (rawUrls: string[]) => void;
  onRemoveTarget: (index: number) => void;
  onClearTargets: () => void;
  successMessage?: string | null;
}

export default function ProfileTargetSection({
  targets,
  onAddTargets,
  onRemoveTarget,
  onClearTargets,
  successMessage,
}: ProfileTargetSectionProps) {
  const [activeTab, setActiveTab] = useState<"manual" | "excel">("manual");
  const [textInput, setTextInput] = useState("");
  const [isExcelModalOpen, setIsExcelModalOpen] = useState(false);

  const handleValidateAndAdd = () => {
    const lines = textInput
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) return;
    onAddTargets(lines);
    setTextInput("");
  };

  const currentCount = textInput
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0).length;

  return (
    <div className="bg-white rounded-2xl border border-gray-200/90 shadow-sm p-6 space-y-5">
      {/* Step Header */}
      <div className="flex items-center gap-3">
        <span className="w-6 h-6 rounded-full bg-rose-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
          1
        </span>
        <h2 className="text-base font-bold text-gray-900">
          Thêm Trang cá nhân cần seeding
        </h2>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab("manual")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeTab === "manual"
              ? "bg-[#2563EB] text-white shadow-sm shadow-blue-500/20"
              : "bg-gray-100/80 text-gray-600 hover:bg-gray-200/70"
          }`}
        >
          <Link2 className="w-3.5 h-3.5" />
          Nhập link trang cá nhân
        </button>

        <button
          type="button"
          onClick={() => setIsExcelModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-50 hover:bg-emerald-100/80 text-emerald-700 border border-emerald-200/70 transition-all shadow-sm active:scale-95 cursor-pointer"
        >
          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
          Import từ file (Excel)
        </button>
      </div>

      {/* Input Textarea Area */}
      <div className="space-y-3">
        <textarea
          rows={4}
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          placeholder={`https://www.facebook.com/leminhanh\nhttps://www.facebook.com/tranquocbao\nhttps://www.facebook.com/thaovynguyen`}
          className="w-full text-xs font-mono p-3.5 rounded-xl border border-gray-200 bg-gray-50/50 text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-y"
        />

        {/* Action Controls & Hint */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-1">
          <div className="flex items-center gap-2 text-gray-500">
            <span>Mỗi dòng 1 link hoặc UID. Tự động lọc trùng & kiểm tra hợp lệ.</span>
            {currentCount > 0 && (
              <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 font-semibold border border-blue-200/60 ml-1">
                Đã nhập: {currentCount} link hợp lệ
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setTextInput("");
              }}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100/70 text-xs font-medium transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Làm mới
            </button>
            <button
              type="button"
              onClick={handleValidateAndAdd}
              disabled={currentCount === 0}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                currentCount > 0
                  ? "bg-[#2563EB] text-white hover:bg-blue-700 shadow-sm shadow-blue-500/30"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed"
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Xác thực & Thêm danh sách
            </button>
          </div>
        </div>
      </div>



      {/* Targets Table */}
      {targets.length > 0 && (
        <div className="border border-gray-100 rounded-xl overflow-hidden mt-2">
          <div className="max-h-60 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-gray-50/80 sticky top-0 z-10 text-gray-500 font-semibold border-b border-gray-100">
                <tr>
                  <th className="py-2.5 px-4 w-14 text-center">STT</th>
                  <th className="py-2.5 px-4">Tên hiển thị</th>
                  <th className="py-2.5 px-4">Link Trang cá nhân</th>
                  <th className="py-2.5 px-4 w-20 text-center">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700 font-medium">
                {targets.map((item, idx) => (
                  <tr key={idx} className="hover:bg-blue-50/30 transition-colors">
                    <td className="py-2.5 px-4 text-center text-gray-400 font-mono">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-gray-900">
                      {item.display_name || `Trang cá nhân ${idx + 1}`}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-blue-600">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline flex items-center gap-1.5 truncate max-w-md"
                      >
                        <span className="truncate">{item.url}</span>
                        <ExternalLink className="w-3 h-3 text-blue-400 shrink-0" />
                      </a>
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => onRemoveTarget(idx)}
                        className="p-1 rounded-lg text-rose-500 hover:bg-rose-50 transition-colors"
                        title="Xóa link này"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Excel Import Modal */}
      <ExcelImportModal
        isOpen={isExcelModalOpen}
        onClose={() => setIsExcelModalOpen(false)}
        targetType="PROFILE"
        onImportTargets={(imported) => {
          if (imported.length > 0) {
            onAddTargets(imported.map((item) => item.url));
          }
        }}
      />
    </div>
  );
}
