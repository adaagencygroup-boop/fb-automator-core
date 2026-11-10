"use client";

import React, { useState, useEffect, useMemo } from "react";
import { FileSpreadsheet, RotateCcw, CheckCircle2, Trash2, ExternalLink, Copy, AlertCircle } from "lucide-react";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import ExcelImportModal from "../../_components/ExcelImportModal";
import { seedingApi } from "../../service";
import {
  normalizeTargetUrl,
  parseInputTargetsStats,
  hasVietnameseTones,
  removeVietnameseTones,
  removeDuplicateTargets,
  removeInvalidTargets,
} from "../../validation";

export default function PostTargetSection({
  targets,
  onAddTargets,
  onRemoveTarget,
  onClearTargets,
  successMessage,
  isRunning = false,
}) {
  const [textInput, setTextInput] = useState("");
  const [isExcelModalOpen, setIsExcelModalOpen] = useState(false);
  const [dbHistoryTargets, setDbHistoryTargets] = useState([]);

  // Tải danh sách toàn bộ mục tiêu trong DB (bao gồm cả các link đã chạy) để kiểm tra trùng lặp thời gian thực
  useEffect(() => {
    let active = true;
    seedingApi
      .getSeedingTargets("POST", true)
      .then((res) => {
        if (active) setDbHistoryTargets(res?.targets || []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [targets]);

  const allKnownTargets = useMemo(() => {
    return [...dbHistoryTargets, ...(targets || [])];
  }, [dbHistoryTargets, targets]);

  // Dialog states
  const [confirmAddOpen, setConfirmAddOpen] = useState(false);
  const [pendingLines, setPendingLines] = useState([]);
  const [isValidating, setIsValidating] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState({ isOpen: false, item: null, index: -1 });
  const [isDeleting, setIsDeleting] = useState(false);

  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // Kiểm tra xem nội dung nhập có chứa ký tự tiếng Việt có dấu hay không
  const hasAccents = hasVietnameseTones(textInput);

  // Thống kê liên tục tình trạng link nhập vào (tổng, hợp lệ, trùng lặp, lỗi định dạng)
  const stats = parseInputTargetsStats(textInput, allKnownTargets, "POST");

  // Tổng hợp danh sách các vấn đề để hiển thị thành 1 message cảnh báo duy nhất
  const issues = [];
  if (hasAccents) {
    issues.push("chứa dấu tiếng Việt");
  }
  if (stats.invalidCount > 0) {
    issues.push(`${stats.invalidCount} link sai định dạng`);
  }
  if (stats.duplicateCount > 0) {
    issues.push(`${stats.duplicateCount} link trùng lặp`);
  }
  const hasIssues = issues.length > 0;

  // Xử lý sự kiện gõ phím: Chặn Space và chặn 2 lần Enter xuống dòng liền nhau
  const handleKeyDown = (e) => {
    // 1. Chặn phím cách (Space)
    if (e.key === " ") {
      e.preventDefault();
      return;
    }

    // 2. Chặn 2 lần Enter xuống dòng liền nhau (không cho tạo dòng trống)
    if (e.key === "Enter") {
      const { selectionStart, selectionEnd, value } = e.target;
      if (value.length === 0 || selectionStart === 0) {
        e.preventDefault();
        return;
      }
      if (value[selectionStart - 1] === "\n") {
        e.preventDefault();
        return;
      }
      if (selectionStart === selectionEnd && value[selectionStart] === "\n") {
        e.preventDefault();
        return;
      }
    }
  };

  // Làm sạch dữ liệu khi nhập: loại bỏ dấu cách và nén nhiều Enter liền nhau
  const handleChangeTextarea = (e) => {
    const val = e.target.value
      .replace(/[^\S\r\n]+/g, "")
      .replace(/\r\n/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .replace(/^\n+/, "");
    setTextInput(val);
  };

  // Xử lý dán (Paste): Tách dấu phẩy/chấm phẩy thành xuống dòng và loại bỏ dấu cách
  const handlePaste = (e) => {
    e.preventDefault();
    const pasteData = (e.clipboardData || window.clipboardData)?.getData("text") || "";
    if (!pasteData) return;

    const formatted = pasteData
      .replace(/[,\t;]+/g, "\n")
      .replace(/[^\S\r\n]+/g, "")
      .replace(/\r\n/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .replace(/^\n+/, "");

    const { selectionStart, selectionEnd, value } = e.target;
    const before = value.substring(0, selectionStart);
    const after = value.substring(selectionEnd);
    setTextInput(`${before}${formatted}${after}`);
  };

  // Tự động làm sạch / xóa hết các dòng không hợp lệ, trùng lặp hoặc có dấu
  const handleAutoCleanIssues = () => {
    if (!textInput.trim()) return;

    let text = textInput;
    if (hasAccents) {
      text = removeVietnameseTones(text);
    }

    // Nếu chỉ có lỗi trùng lặp (không có lỗi định dạng hay có dấu)
    if (stats.invalidCount === 0 && stats.duplicateCount > 0 && !hasAccents) {
      const cleaned = removeDuplicateTargets(text, allKnownTargets, "POST");
      setTextInput(cleaned);
      toast.success(`Đã loại bỏ ${stats.duplicateCount} liên kết bị trùng lặp!`, "ĐÃ LỌC TRÙNG");
      return;
    }

    // Nếu chỉ có lỗi dấu tiếng Việt (không có lỗi khác)
    if (hasAccents && stats.invalidCount === 0 && stats.duplicateCount === 0) {
      const lines = text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((l) => normalizeTargetUrl(l, "POST"));
      setTextInput(lines.join("\n"));
      toast.success("Đã tự động chuyển đổi toàn bộ ký tự có dấu thành không dấu!", "ĐÃ XÓA DẤU");
      return;
    }

    // Nếu có dòng không hợp lệ hoặc kết hợp nhiều lỗi:
    let cleaned = removeInvalidTargets(text, "POST");
    if (stats.duplicateCount > 0) {
      cleaned = removeDuplicateTargets(cleaned, allKnownTargets, "POST");
    }

    setTextInput(cleaned);
    toast.success("Đã tự động xóa sạch các liên kết không hợp lệ!", "ĐÃ DỌN DẸP");
  };

  // Tự động chuẩn hóa UID / Share token -> https://web.facebook.com/share/p/ khi blur khỏi textarea
  const handleBlurTextarea = () => {
    if (!textInput.trim() || hasAccents) return;
    const lines = textInput
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const updated = lines.map((l) => normalizeTargetUrl(l, "POST"));
    setTextInput(updated.join("\n"));
  };

  // Click "Xác thực & Thêm danh sách"
  const handleValidateAndAddClick = () => {
    if (hasAccents) {
      toast.error(
        "Nội dung đang chứa ký tự có dấu tiếng Việt. Vui lòng xóa dấu trước khi bấm xác thực!",
        "NỘI DUNG CÓ DẤU"
      );
      return;
    }

    if (stats.totalCount === 0) {
      toast.warning("Vui lòng nhập ít nhất 1 link hoặc UID bài viết Facebook!", "CHƯA NHẬP DỮ LIỆU");
      return;
    }

    if (stats.validCount === 0) {
      if (stats.duplicateCount > 0) {
        toast.warning(
          `Tất cả ${stats.duplicateCount} link bạn nhập đều đã bị trùng lặp (trong ô nhập hoặc đã có trong danh sách)!`,
          "TRÙNG LẶP TOÀN BỘ"
        );
      } else {
        toast.error("Không tìm thấy link hoặc UID bài viết hợp lệ nào!", "DỮ LIỆU KHÔNG HỢP LỆ");
      }
      return;
    }

    setTextInput(stats.validList.join("\n"));
    setPendingLines(stats.validList);
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
    if (isRunning) return;
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
    if (isRunning) return;
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
          onClick={() => {
            if (isRunning) return;
            setIsExcelModalOpen(true);
          }}
          disabled={isRunning}
          title={isRunning ? "Đang chạy seeding, không thể import từ file" : "Import danh sách link từ tệp Excel"}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all shadow-sm shrink-0 ${
            isRunning
              ? "bg-gray-100 text-gray-400 border-gray-200 opacity-60 cursor-not-allowed select-none"
              : "bg-emerald-50 hover:bg-emerald-100/80 text-emerald-700 border-emerald-200/70 active:scale-95 cursor-pointer"
          }`}
        >
          <FileSpreadsheet className={`w-3.5 h-3.5 ${isRunning ? "text-gray-400" : "text-emerald-600"}`} />
          Import từ file (Excel)
        </button>
      </div>

      {/* Input Textarea Area */}
      <div className="space-y-3">
        <textarea
          rows={4}
          value={textInput}
          disabled={isRunning}
          onChange={handleChangeTextarea}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={handleBlurTextarea}
          placeholder={`https://web.facebook.com/share/p/18NvrpA3BJ\nhttps://web.facebook.com/username/posts/123456789`}
          className={`w-full text-xs font-mono p-3.5 rounded-xl border transition-all resize-y ${
            isRunning
              ? "border-gray-200 bg-gray-100/70 text-gray-400 cursor-not-allowed select-none"
              : hasIssues
              ? "border-rose-400 bg-rose-50/20 text-rose-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
              : "border-gray-200 bg-gray-50/50 text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          }`}
        />

        {/* Thông báo cảnh báo duy nhất (tổng hợp tất cả các lỗi) */}
        {hasIssues && (
          <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium animate-in fade-in slide-in-from-top-1 duration-200 shadow-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>
                {issues.length === 1 && hasAccents
                  ? "Phát hiện nội dung có chứa dấu tiếng Việt. Vui lòng chỉ nhập liên kết hoặc UID không dấu!"
                  : issues.length === 1 && stats.duplicateCount > 0
                  ? `Phát hiện có ${stats.duplicateCount} liên kết bị trùng lặp (trong ô nhập hoặc đã có trong cơ sở dữ liệu).`
                  : issues.length === 1 && stats.invalidCount > 0
                  ? `Phát hiện có ${stats.invalidCount} dòng liên kết không hợp lệ hoặc sai định dạng.`
                  : `Phát hiện nội dung chưa hợp lệ: ${issues.join(" • ")}.`}
              </span>
            </div>
            <button
              type="button"
              onClick={handleAutoCleanIssues}
              disabled={isRunning}
              className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-all shrink-0 shadow-sm ${
                isRunning
                  ? "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed"
                  : "bg-white border-rose-300 hover:bg-rose-100 text-rose-700 active:scale-95 cursor-pointer"
              }`}
            >
              {issues.length === 1 && hasAccents
                ? "Tự động xóa dấu"
                : issues.length === 1 && stats.duplicateCount > 0
                ? "Tự động xóa link trùng"
                : "Tự động xóa link không hợp lệ"}
            </button>
          </div>
        )}

        {/* Action Controls & Hint */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-1">
          <div className="flex flex-wrap items-center gap-2 text-gray-500">
            {stats.totalCount > 0 ? (
              <div className="inline-flex items-center gap-2 flex-wrap">
                <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-semibold border border-blue-200/60">
                  Đã nhập: {stats.totalCount}
                </span>
                <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200/60 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  Hợp lệ: {stats.validCount}
                </span>
                {stats.duplicateCount > 0 && (
                  <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 font-semibold border border-amber-200/60 flex items-center gap-1" title="Số link bị trùng lặp">
                    <Copy className="w-3.5 h-3.5 text-amber-600" />
                    Trùng lặp: {stats.duplicateCount}
                  </span>
                )}
                {stats.invalidCount > 0 && (
                  <span className="px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 font-semibold border border-rose-200/60 flex items-center gap-1" title="Số dòng không đúng định dạng">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                    Không hợp lệ: {stats.invalidCount}
                  </span>
                )}
              </div>
            ) : (
              <span>Mỗi dòng 1 link hoặc UID. Tự động lọc trùng & kiểm tra hợp lệ.</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleResetInput}
              disabled={!textInput.trim() || isRunning}
              title={isRunning ? "Đang chạy seeding, không thể làm mới" : undefined}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100/70 text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Làm mới
            </button>
            <button
              type="button"
              onClick={handleValidateAndAddClick}
              disabled={hasAccents || stats.validCount === 0 || isValidating || isRunning}
              title={
                isRunning
                  ? "Đang chạy seeding, không thể thêm mục tiêu mới"
                  : hasAccents
                  ? "Vui lòng xóa dấu tiếng Việt trước khi xác thực"
                  : undefined
              }
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                !hasAccents && stats.validCount > 0 && !isValidating && !isRunning
                  ? "bg-[#2563EB] text-white hover:bg-blue-700 shadow-sm shadow-blue-500/30 cursor-pointer"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed select-none"
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
              onClick={() => {
                if (isRunning) return;
                setClearAllOpen(true);
              }}
              disabled={isRunning}
              title={isRunning ? "Đang chạy seeding, không thể xóa mục tiêu" : undefined}
              className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md transition-colors ${
                isRunning
                  ? "text-gray-400 opacity-50 cursor-not-allowed"
                  : "text-rose-600 hover:text-rose-700 hover:bg-rose-50 cursor-pointer"
              }`}
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
                          onClick={() => {
                            if (isRunning) return;
                            setDeleteTarget({ isOpen: true, item, index: idx });
                          }}
                          disabled={isRunning}
                          title={isRunning ? "Đang chạy seeding, không thể xóa mục tiêu" : "Xóa link bài viết này"}
                          className={`p-1.5 rounded-lg transition-colors inline-flex items-center justify-center ${
                            isRunning
                              ? "text-gray-300 opacity-50 cursor-not-allowed"
                              : "text-rose-500 hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                          }`}
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
      {isExcelModalOpen && (
        <ExcelImportModal
          isOpen={isExcelModalOpen}
          onClose={() => setIsExcelModalOpen(false)}
          targetType="POST"
          existingTargets={allKnownTargets}
          onImportTargets={(imported) => {
            if (imported.length > 0) {
              onAddTargets(imported.map((item) => item.url));
              toast.success(`Đã nhập thành công ${imported.length} bài viết từ file Excel!`, "THÀNH CÔNG");
            }
          }}
        />
      )}

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
        description={`Bạn có chắc chắn muốn xóa toàn bộ ${targets.length} bài viết chưa chạy khỏi danh sách không? Các bài viết đã chạy trong lịch sử vẫn sẽ được bảo toàn.`}
        confirmText="Xóa toàn bộ"
        cancelText="Hủy bỏ"
        variant="danger"
        loading={isClearing}
      />
    </div>
  );
}
