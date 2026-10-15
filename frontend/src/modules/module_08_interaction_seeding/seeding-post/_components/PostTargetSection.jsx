"use client";

import React, { useState } from "react";
import { FileSpreadsheet, RotateCcw, CheckCircle2, Trash2, ExternalLink } from "lucide-react";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import ExcelImportModal from "../../_components/ExcelImportModal";

export default function PostTargetSection({
  targets,
  onAddTargets,
  onRemoveTarget,
  onClearTargets,
  successMessage,
}) {
  const [textInput, setTextInput] = useState("");
  const [isExcelModalOpen, setIsExcelModalOpen] = useState(false);

  // Dialog states
  const [confirmAddOpen, setConfirmAddOpen] = useState(false);
  const [pendingLines, setPendingLines] = useState([]);
  const [isValidating, setIsValidating] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState({ isOpen: false, item: null, index: -1 });
  const [isDeleting, setIsDeleting] = useState(false);

  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // Click "Xác thực & Thêm danh sách"
  const handleValidateAndAddClick = () => {
    const lines = textInput
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      toast.warning("Vui lòng nhập ít nhất 1 link hoặc UID bài viết Facebook!", "CHƯA NHẬP DỮ LIỆU");
      return;
    }

    setPendingLines(lines);
    setConfirmAddOpen(true);
  };

  // Confirm execute add
  const handleConfirmAdd = async () => {
    setIsValidating(true);
    try {
      await onAddTargets(pendingLines);
      setTextInput("");
      setConfirmAddOpen(false);
      toast.success(
        `Đã xác thực và lưu thành công ${pendingLines.length} bài viết vào danh sách!`,
        "THÊM THÀNH CÔNG"
      );
    } catch (e) {
      toast.error(
        e?.message || "Đã xảy ra lỗi khi kiểm tra và xác thực liên kết bài viết. Vui lòng thử lại!",
        "LỖI XÁC THỰC"
      );
    } finally {
      setIsValidating(false);
    }
  };

  // Confirm delete single post
  const handleConfirmDelete = async () => {
    if (deleteTarget.index < 0) return;
    setIsDeleting(true);
    try {
      await onRemoveTarget(deleteTarget.index);
      toast.success(
        `Đã xóa bài viết "${deleteTarget.item?.display_name || deleteTarget.item?.url || "mục tiêu"}" thành công!`,
        "ĐÃ XÓA"
      );
      setDeleteTarget({ isOpen: false, item: null, index: -1 });
    } catch (e) {
      toast.error(e?.message || "Không thể xóa bài viết này. Vui lòng thử lại!", "LỖI XÓA");
    } finally {
      setIsDeleting(false);
    }
  };

  // Confirm clear all posts
  const handleConfirmClearAll = async () => {
    setIsClearing(true);
    try {
      await onClearTargets();
      toast.success("Đã xóa toàn bộ danh sách bài viết thành công!", "ĐÃ DỌN DẸP");
      setClearAllOpen(false);
    } catch (e) {
      toast.error(e?.message || "Không thể dọn dẹp danh sách. Vui lòng thử lại!", "LỖI XÓA");
    } finally {
      setIsClearing(false);
    }
  };

  // Handle reset input textarea
  const handleResetInput = () => {
    if (textInput.trim().length > 0) {
      setTextInput("");
      toast.info("Đã làm mới khung nhập liên kết.", "LÀM MỚI");
    } else {
      toast.info("Khung nhập liên kết đang trống.", "THÔNG BÁO");
    }
  };

  const currentCount = textInput
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0).length;

  return (
    <div className="bg-white rounded-2xl border border-gray-200/90 shadow-sm p-6 space-y-5">
      {/* Step Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="w-6 h-6 rounded-full bg-rose-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
            1
          </span>
          <h2 className="text-base font-bold text-gray-900">
            Thêm bài viết cần seeding
          </h2>
        </div>

        <button
          type="button"
          onClick={() => setIsExcelModalOpen(true)}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-50 hover:bg-emerald-100/80 text-emerald-700 border border-emerald-200/70 transition-all shadow-sm active:scale-95 cursor-pointer shrink-0"
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
          placeholder={`https://www.facebook.com/post/post123\nhttps://www.facebook.com/post/post456\nhttps://www.facebook.com/post/post789\nhttps://www.facebook.com/post/post321`}
          className="w-full text-xs font-mono p-3.5 rounded-xl border border-gray-200 bg-gray-50/50 text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-y"
        />

        {/* Action Controls & Hint */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-1">
          <div className="flex items-center gap-2 text-gray-500">
            <span>Mỗi dòng 1 link hoặc UID. Tự động lọc trùng & kiểm tra hợp lệ.</span>
            {currentCount > 0 && (
              <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 font-semibold border border-blue-200/60 ml-1">
                Đã nhập: {currentCount} link
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleResetInput}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100/70 text-xs font-medium transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Làm mới
            </button>
            <button
              type="button"
              onClick={handleValidateAndAddClick}
              disabled={currentCount === 0}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                currentCount > 0
                  ? "bg-[#2563EB] text-white hover:bg-blue-700 shadow-sm shadow-blue-500/30 cursor-pointer"
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
        <div className="space-y-2 mt-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-gray-800">
              Danh sách bài viết đã thêm:{" "}
              <span className="text-blue-600 font-semibold">({targets.length})</span>
            </span>
            <button
              type="button"
              onClick={() => setClearAllOpen(true)}
              className="flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700 font-semibold px-2 py-1 rounded-md hover:bg-rose-50 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Xóa toàn bộ
            </button>
          </div>

          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <div className="max-h-60 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-gray-50/80 sticky top-0 z-10 text-gray-500 font-semibold border-b border-gray-100">
                  <tr>
                    <th className="py-2.5 px-4 w-14 text-center whitespace-nowrap">STT</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Tên hiển thị</th>
                    <th className="py-2.5 px-4">Link bài viết</th>
                    <th className="py-2.5 px-4 w-28 min-w-[90px] text-center whitespace-nowrap">Hành động</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700 font-medium">
                  {targets.map((item, idx) => (
                    <tr key={idx} className="hover:bg-blue-50/30 transition-colors">
                      <td className="py-2.5 px-4 text-center text-gray-400 font-mono whitespace-nowrap">
                        {idx + 1}
                      </td>
                      <td className="py-2.5 px-4 font-semibold text-gray-900 truncate max-w-xs">
                        {item.display_name || `Bài viết ${idx + 1}`}
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
                      <td className="py-2.5 px-4 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setDeleteTarget({ isOpen: true, item, index: idx })}
                          className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer inline-flex items-center justify-center"
                          title="Xóa link bài viết này"
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
        </div>
      )}

      {/* Excel Import Modal */}
      <ExcelImportModal
        isOpen={isExcelModalOpen}
        onClose={() => setIsExcelModalOpen(false)}
        targetType="POST"
        onImportTargets={(imported) => {
          if (imported.length > 0) {
            onAddTargets(imported.map((item) => item.url));
            toast.success(`Đã nhập thành công ${imported.length} bài viết từ file Excel!`, "THÀNH CÔNG");
          }
        }}
      />

      {/* Confirm Dialog: Xác thực & Thêm danh sách */}
      <ConfirmDialog
        isOpen={confirmAddOpen}
        onClose={() => !isValidating && setConfirmAddOpen(false)}
        onConfirm={handleConfirmAdd}
        title="Xác nhận thêm danh sách bài viết"
        description={`Bạn có chắc chắn muốn xác thực và lưu ${pendingLines.length} bài viết vào danh sách seeding không?`}
        confirmText="Xác thực & Thêm"
        cancelText="Hủy bỏ"
        variant="primary"
        loading={isValidating}
      />

      {/* Confirm Dialog: Xóa 1 mục tiêu */}
      <ConfirmDialog
        isOpen={deleteTarget.isOpen}
        onClose={() => !isDeleting && setDeleteTarget({ isOpen: false, item: null, index: -1 })}
        onConfirm={handleConfirmDelete}
        title="Xác nhận xóa bài viết"
        description={`Bạn có chắc chắn muốn xóa bài viết "${deleteTarget.item?.display_name || deleteTarget.item?.url || ""}" khỏi danh sách không?`}
        confirmText="Xóa ngay"
        cancelText="Hủy bỏ"
        variant="danger"
        loading={isDeleting}
      />

      {/* Confirm Dialog: Xóa toàn bộ danh sách */}
      <ConfirmDialog
        isOpen={clearAllOpen}
        onClose={() => !isClearing && setClearAllOpen(false)}
        onConfirm={handleConfirmClearAll}
        title="Xác nhận xóa toàn bộ danh sách bài viết"
        description={`Bạn có chắc chắn muốn xóa toàn bộ ${targets.length} bài viết khỏi danh sách không? Hành động này không thể hoàn tác.`}
        confirmText="Xóa toàn bộ"
        cancelText="Hủy bỏ"
        variant="danger"
        loading={isClearing}
      />
    </div>
  );
}
