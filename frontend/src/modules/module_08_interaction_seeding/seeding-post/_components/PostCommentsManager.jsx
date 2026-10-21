"use client";

import React, { useState } from "react";
import { Clipboard, FileSpreadsheet, Trash2, MessageSquare, Loader2 } from "lucide-react";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import ExcelImportModal from "../../_components/ExcelImportModal";

export default function PostCommentsManager({
  comments,
  onAddComment,
  onAddBulkComments,
  onRemoveComment,
  onClearAllComments,
}) {
  const [bulkText, setBulkText] = useState("");
  const [isAddingBulk, setIsAddingBulk] = useState(false);
  const [isExcelModalOpen, setIsExcelModalOpen] = useState(false);

  // Dialog states for deleting comments
  const [deleteComment, setDeleteComment] = useState({ isOpen: false, text: "", index: -1 });
  const [isDeleting, setIsDeleting] = useState(false);

  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        const lines = text
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0);
        if (lines.length > 0) {
          setIsAddingBulk(true);
          try {
            await Promise.all([
              onAddBulkComments(lines),
              new Promise((resolve) => setTimeout(resolve, 600)),
            ]);
            toast.success(`Đã dán và thêm ${lines.length} câu bình luận từ clipboard!`, "THÀNH CÔNG");
          } finally {
            setIsAddingBulk(false);
          }
        } else {
          toast.warning("Nội dung trong Clipboard không chứa dòng văn bản hợp lệ!", "CẢNH BÁO");
        }
      } else {
        toast.warning("Clipboard hiện tại đang trống!", "THÔNG BÁO");
      }
    } catch {
      toast.error("Không thể đọc từ Clipboard. Vui lòng dán thủ công vào ô nhập.", "LỖI TRUY CẬP");
    }
  };

  const handleBulkAdd = async () => {
    const lines = bulkText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length > 0) {
      setIsAddingBulk(true);
      try {
        await Promise.all([
          onAddBulkComments(lines),
          new Promise((resolve) => setTimeout(resolve, 600)),
        ]);
        setBulkText("");
        toast.success(`Đã thêm ${lines.length} câu bình luận vào danh sách!`, "THÊM THÀNH CÔNG");
      } catch (e) {
        toast.error(e?.message || "Không thể thêm bình luận!", "LỖI");
      } finally {
        setIsAddingBulk(false);
      }
    }
  };

  // Confirm delete single comment
  const handleConfirmDeleteComment = async () => {
    if (deleteComment.index < 0) return;
    setIsDeleting(true);
    try {
      await onRemoveComment(deleteComment.index);
      toast.success("Đã xóa câu bình luận khỏi danh sách!", "ĐÃ XÓA");
      setDeleteComment({ isOpen: false, text: "", index: -1 });
    } catch (e) {
      toast.error(e?.message || "Không thể xóa bình luận này!", "LỖI XÓA");
    } finally {
      setIsDeleting(false);
    }
  };

  // Confirm clear all comments
  const handleConfirmClearAllComments = async () => {
    setIsClearing(true);
    try {
      await onClearAllComments();
      toast.success("Đã xóa toàn bộ danh sách bình luận thành công!", "ĐÃ DỌN DẸP");
      setClearAllOpen(false);
    } catch (e) {
      toast.error(e?.message || "Không thể dọn dẹp danh sách bình luận!", "LỖI XÓA");
    } finally {
      setIsClearing(false);
    }
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left Column: Bulk input */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 h-8">
            <button
              type="button"
              onClick={handlePasteClipboard}
              disabled={isAddingBulk}
              className="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-all shadow-sm shadow-blue-500/20 cursor-pointer disabled:opacity-60"
            >
              <Clipboard className="w-3.5 h-3.5" />
              Dán nhanh từ clipboard
            </button>

            <button
              type="button"
              onClick={() => setIsExcelModalOpen(true)}
              className="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-emerald-50 hover:bg-emerald-100/80 text-emerald-700 border border-emerald-200/70 text-xs font-semibold transition-all shadow-sm active:scale-95 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              Import file (Excel)
            </button>
          </div>

          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={`Bài viết rất hữu ích, cảm ơn ad!\nThông tin quý báu 👍\nMình rất thích, cảm ơn bạn đã chia sẻ\nĐịa điểm này đẹp quá, nhất định sẽ đi!\nBài viết chất lượng, rất chi tiết!\nCảnh đẹp quá, cho mình xin thêm thông tin với ạ!`}
            className="w-full h-[180px] text-xs font-mono p-3.5 rounded-xl border border-gray-200 bg-gray-50/50 text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none leading-relaxed"
          />

          <div className="flex items-center justify-between text-xs h-8">
            <span className="text-gray-500 italic">
              Mỗi dòng 1 câu comment (Hệ thống tự động dùng ngẫu nhiên)
            </span>
            <button
              type="button"
              onClick={handleBulkAdd}
              disabled={bulkText.trim().length === 0 || isAddingBulk}
              className={`flex items-center gap-1.5 px-3.5 h-8 rounded-xl text-xs font-semibold transition-all shrink-0 ${
                bulkText.trim().length > 0 && !isAddingBulk
                  ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm shadow-blue-500/20 cursor-pointer active:scale-95"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
              }`}
            >
              {isAddingBulk ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Đang thêm...</span>
                </>
              ) : (
                "+ Thêm vào danh sách"
              )}
            </button>
          </div>
        </div>

        {/* Right Column: Active comments table */}
        <div className="space-y-3">
          <div className="flex items-center justify-between h-8">
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
                onClick={() => setClearAllOpen(true)}
                className="flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700 font-semibold px-2 py-1 rounded-md hover:bg-rose-50 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Xóa toàn bộ
              </button>
            )}
          </div>

          {/* Table */}
          <div className="border border-gray-100 rounded-xl overflow-hidden overflow-y-auto h-[224px] bg-white">
            {comments.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-400 text-xs italic">
                Chưa có bình luận nào trong danh sách.
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-gray-50/80 sticky top-0 z-10 text-gray-500 font-semibold border-b border-gray-100">
                  <tr>
                    <th className="py-2.5 px-3 w-10 text-center whitespace-nowrap">#</th>
                    <th className="py-2.5 px-3">Nội dung bình luận</th>
                    <th className="py-2.5 px-3 w-24 min-w-[75px] text-center whitespace-nowrap">Hành động</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700 font-medium">
                  {comments.map((cmt, idx) => (
                    <tr key={idx} className="hover:bg-blue-50/30 transition-colors">
                      <td className="py-2.5 px-3 text-center text-gray-400 font-mono text-[11px] whitespace-nowrap">
                        {idx + 1}
                      </td>
                      <td className="py-2.5 px-3 truncate max-w-xs">{cmt}</td>
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setDeleteComment({ isOpen: true, text: cmt, index: idx })}
                          className="p-1 rounded-md text-rose-500 hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer inline-flex items-center justify-center"
                          title="Xóa bình luận này"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Modal Import Excel for Comments */}
      {isExcelModalOpen && (
        <ExcelImportModal
          isOpen={isExcelModalOpen}
          onClose={() => setIsExcelModalOpen(false)}
          targetType="COMMENT"
          existingComments={comments}
          onImportComments={(newComments) => {
            onAddBulkComments(newComments);
            toast.success(`Đã nhập thành công ${newComments.length} bình luận từ file Excel!`, "THÀNH CÔNG");
          }}
        />
      )}

      {/* Confirm Dialog: Xóa 1 bình luận */}
      <ConfirmDialog
        isOpen={deleteComment.isOpen}
        onClose={() => !isDeleting && setDeleteComment({ isOpen: false, text: "", index: -1 })}
        onConfirm={handleConfirmDeleteComment}
        title="Xác nhận xóa bình luận"
        description={`Bạn có chắc chắn muốn xóa bình luận "${deleteComment.text}" khỏi danh sách không?`}
        confirmText="Xóa ngay"
        cancelText="Hủy bỏ"
        variant="danger"
        loading={isDeleting}
      />

      {/* Confirm Dialog: Xóa toàn bộ bình luận */}
      <ConfirmDialog
        isOpen={clearAllOpen}
        onClose={() => !isClearing && setClearAllOpen(false)}
        onConfirm={handleConfirmClearAllComments}
        title="Xác nhận xóa toàn bộ bình luận"
        description={`Bạn có chắc chắn muốn xóa toàn bộ ${comments.length} bình luận trong danh sách không? Hành động này không thể hoàn tác.`}
        confirmText="Xóa toàn bộ"
        cancelText="Hủy bỏ"
        variant="danger"
        loading={isClearing}
      />
    </div>
  );
}
