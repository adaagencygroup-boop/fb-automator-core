"use client";

import React, { useState } from "react";
import { Clipboard, FileSpreadsheet, Loader2, Plus, Trash2 } from "lucide-react";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import ExcelImportModal from "../../_components/ExcelImportModal";
import { totalVariants } from "../spintax.mjs";
import StepCard from "./StepCard";

export default function PostCommentsManager({
  step = 3,
  comments,
  onAddBulkComments,
  onRemoveComment,
  onClearAllComments,
  isRunning = false,
  commentPerPost = 0,
}) {
  const variantsTotal = totalVariants(comments);
  const notEnough = commentPerPost > 0 && comments.length > 0 && variantsTotal < commentPerPost;
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
      if (!text) {
        toast.warning("Clipboard hiện đang trống.", "KHÔNG CÓ VĂN BẢN");
        return;
      }
      setBulkText((current) => (current ? `${current.replace(/\s+$/, "")}\n${text}` : text));
      toast.success("Đã dán văn bản từ clipboard vào ô nhập.", "ĐÃ DÁN VĂN BẢN");
    } catch {
      toast.error("Không thể đọc clipboard. Hãy cấp quyền clipboard cho trình duyệt rồi thử lại.", "KHÔNG ĐỌC ĐƯỢC CLIPBOARD");
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
    if (isRunning) return;
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
    if (isRunning) return;
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
    <StepCard step={step} title="Danh sách bình luận (Random)">
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        {/* Cột trái: dán nhiều câu */}
        <div className="space-y-3">
          <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={handlePasteClipboard}
              disabled={isAddingBulk}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Clipboard className="size-3.5" aria-hidden="true" />
              Dán nhanh từ văn bản
            </button>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsExcelModalOpen(true)}
                disabled={isAddingBulk}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileSpreadsheet className="size-3.5 text-emerald-600" aria-hidden="true" />
                Import file (Excel)
              </button>
              <button
                type="button"
                onClick={handleBulkAdd}
                disabled={bulkText.trim().length === 0 || isAddingBulk}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"
              >
                {isAddingBulk ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
                {isAddingBulk ? "Đang thêm..." : "Thêm vào danh sách"}
              </button>
            </div>
          </div>

          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            aria-label="Dán danh sách bình luận, mỗi dòng 1 bình luận"
            placeholder={`Dán danh sách bình luận (mỗi dòng 1 bình luận)...\nBài viết rất hữu ích, cảm ơn ad!\nThông tin quá hay 👍\nMình rất thích, cảm ơn bạn đã chia sẻ!\nĐịa điểm này đẹp quá, nhất định sẽ đi!\nBài viết chất lượng, rất chi tiết!\nCảnh đẹp quá, cho mình xin thêm thông tin với ạ!`}
            className="h-[188px] w-full resize-none rounded-xl border border-slate-200 bg-white p-3.5 text-xs leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />

        </div>

        {/* Cột phải: danh sách đang dùng */}
        <div className="space-y-3">
          <div className="flex h-8 items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-800">
              Danh sách bình luận{" "}
              <span className="font-semibold text-slate-500">
                ({comments.length.toLocaleString("vi-VN")}
                {commentPerPost > 1 ? `/${commentPerPost.toLocaleString("vi-VN")}` : ""})
              </span>
            </span>
            <div className="flex items-center gap-1.5">
              {comments.length > 0 && (
                <button
                  type="button"
                  onClick={() => !isRunning && setClearAllOpen(true)}
                  disabled={isRunning}
                  title={isRunning ? "Đang chạy seeding, không thể xóa bình luận" : "Xóa toàn bộ bình luận"}
                  className="h-8 rounded-lg px-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Xóa tất cả
                </button>
              )}
            </div>
          </div>

          <div className="h-[188px] overflow-y-auto rounded-xl border border-slate-200 bg-white">
            {comments.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs italic text-slate-400">
                Chưa có bình luận nào trong danh sách.
              </div>
            ) : (
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                  <tr>
                    <th className="w-10 px-3 py-2.5">STT</th>
                    <th className="px-3 py-2.5">Nội dung bình luận</th>
                    <th className="w-20 px-3 py-2.5 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {comments.map((cmt, idx) => (
                    <tr key={idx} className="hover:bg-blue-50/30">
                      <td className="px-3 py-2.5 font-semibold text-blue-600">{idx + 1}</td>
                      <td className="max-w-xs truncate px-3 py-2.5" title={cmt}>
                        {cmt}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => !isRunning && setDeleteComment({ isOpen: true, text: cmt, index: idx })}
                          disabled={isRunning}
                          aria-label={`Xóa bình luận ${idx + 1}`}
                          title={isRunning ? "Đang chạy seeding, không thể xóa" : "Xóa bình luận này"}
                          className="inline-flex items-center justify-center rounded-md p-1 text-rose-500 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:text-slate-300"
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {comments.length > 0 && variantsTotal > comments.length && (
            <p className="text-[11px] text-slate-500">Spintax: {variantsTotal.toLocaleString("vi-VN")} câu khác nhau.</p>
          )}
          {notEnough && (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-900">
              Mỗi bài cần {commentPerPost} bình luận khác nhau nhưng danh sách mới có {variantsTotal} câu. Thêm ít nhất{" "}
              {commentPerPost - variantsTotal} câu (hoặc dùng spintax), hoặc giảm số bình luận mỗi bài — để không có 2 nick
              đăng cùng một câu trên cùng một bài.
            </div>
          )}
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
    </StepCard>
  );
}
