"use client";

import React, { useState } from "react";
import { Clipboard, FileSpreadsheet, Trash2, Plus, MessageSquare } from "lucide-react";
import ExcelImportModal from "../../_components/ExcelImportModal";

interface PostCommentsManagerProps {
  comments: string[];
  onAddComment: (comment: string) => void;
  onAddBulkComments: (comments: string[]) => void;
  onRemoveComment: (index: number) => void;
  onClearAllComments: () => void;
}

export default function PostCommentsManager({
  comments,
  onAddComment,
  onAddBulkComments,
  onRemoveComment,
  onClearAllComments,
}: PostCommentsManagerProps) {
  const [bulkText, setBulkText] = useState("");
  const [singleText, setSingleText] = useState("");
  const [isExcelModalOpen, setIsExcelModalOpen] = useState(false);

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        const lines = text
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0);
        if (lines.length > 0) {
          onAddBulkComments(lines);
        }
      }
    } catch {
      alert("Không thể đọc từ Clipboard. Vui lòng dán thủ công vào ô nhập.");
    }
  };

  const handleBulkAdd = () => {
    const lines = bulkText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length > 0) {
      onAddBulkComments(lines);
      setBulkText("");
    }
  };

  const handleSingleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!singleText.trim()) return;
    onAddComment(singleText.trim());
    setSingleText("");
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200/90 shadow-sm p-6 space-y-5">
      {/* Step Header */}
      <div className="flex items-center gap-3">
        <span className="w-6 h-6 rounded-full bg-rose-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
          3
        </span>
        <h2 className="text-base font-bold text-gray-900">
          Danh sách bình luận (Random)
        </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Bulk input */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePasteClipboard}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-all shadow-sm shadow-blue-500/20"
            >
              <Clipboard className="w-3.5 h-3.5" />
              Dán nhanh từ clipboard
            </button>

            <button
              type="button"
              onClick={() => setIsExcelModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100/80 text-emerald-700 border border-emerald-200/70 text-xs font-semibold transition-all shadow-sm active:scale-95 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              Import file (Excel)
            </button>
          </div>

          <textarea
            rows={8}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={`Bài viết rất hữu ích, cảm ơn ad!\nThông tin quý báu 👍\nMình rất thích, cảm ơn bạn đã chia sẻ\nĐịa điểm này đẹp quá, nhất định sẽ đi!\nBài viết chất lượng, rất chi tiết!\nCảnh đẹp quá, cho mình xin thêm thông tin với ạ!`}
            className="w-full text-xs font-mono p-3.5 rounded-xl border border-gray-200 bg-gray-50/50 text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-y"
          />

          <div className="flex items-center justify-between text-xs pt-1">
            <span className="text-gray-500 italic">
              Mỗi dòng 1 câu comment (Hệ thống tự động dùng ngẫu nhiên)
            </span>
            <button
              type="button"
              onClick={handleBulkAdd}
              disabled={bulkText.trim().length === 0}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                bulkText.trim().length > 0
                  ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm shadow-blue-500/20 cursor-pointer"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
              }`}
            >
              + Thêm vào danh sách
            </button>
          </div>
        </div>

        {/* Right Column: Active comments table */}
        <div className="space-y-3 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-gray-800">
              <MessageSquare className="w-4 h-4 text-blue-600" />
              <span>Danh sách bình luận:</span>
              <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 font-bold border border-blue-200/60">
                {comments.length}
              </span>
            </div>

            {comments.length > 0 && (
              <button
                type="button"
                onClick={onClearAllComments}
                className="flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700 font-semibold"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Xóa toàn bộ
              </button>
            )}
          </div>

          {/* Table */}
          <div className="border border-gray-100 rounded-xl overflow-hidden flex-1 max-h-56 overflow-y-auto">
            {comments.length === 0 ? (
              <div className="h-full py-12 text-center text-gray-400 text-xs italic">
                Chưa có bình luận nào trong danh sách.
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-gray-50/80 sticky top-0 z-10 text-gray-500 font-semibold border-b border-gray-100">
                  <tr>
                    <th className="py-2 px-3 w-10 text-center">#</th>
                    <th className="py-2 px-3">Nội dung bình luận</th>
                    <th className="py-2 px-3 w-14 text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700 font-medium">
                  {comments.map((cmt, idx) => (
                    <tr key={idx} className="hover:bg-blue-50/30 transition-colors">
                      <td className="py-2 px-3 text-center text-gray-400 font-mono text-[11px]">
                        {idx + 1}
                      </td>
                      <td className="py-2 px-3 truncate max-w-xs">{cmt}</td>
                      <td className="py-2 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => onRemoveComment(idx)}
                          className="p-1 rounded-md text-rose-500 hover:bg-rose-50"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Single add input */}
          <form onSubmit={handleSingleAdd} className="flex items-center gap-2 pt-1">
            <input
              type="text"
              value={singleText}
              onChange={(e) => setSingleText(e.target.value)}
              placeholder="Nhập bình luận..."
              className="flex-1 text-xs p-2.5 rounded-xl border border-gray-200 bg-gray-50/50 text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Thêm
            </button>
          </form>
        </div>
      </div>

      {/* Modal Import Excel for Comments */}
      {isExcelModalOpen && (
        <ExcelImportModal
          isOpen={isExcelModalOpen}
          onClose={() => setIsExcelModalOpen(false)}
          targetType="COMMENT"
          onImportComments={(newComments) => {
            onAddBulkComments(newComments);
          }}
        />
      )}
    </div>
  );
}
