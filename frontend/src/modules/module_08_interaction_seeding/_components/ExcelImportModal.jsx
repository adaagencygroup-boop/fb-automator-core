"use client";

import React, { useState, useRef, useCallback, useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Download,
  Info,
  Cloud,
  ArrowLeftRight,
  Trash2,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
} from "lucide-react";
import * as XLSX from "xlsx";

const emptySubscribe = () => () => {};
const useIsMounted = () => useSyncExternalStore(emptySubscribe, () => true, () => false);

const formatFileSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function ExcelImportModal({
  isOpen = true,
  onClose,
  onImportTargets,
  onImportComments,
  targetType,
  title,
  subtitle,
}) {
  const fileInputRef = useRef(null);

  // Compute default title and subtitle based on targetType
  const computedTitle =
    title ||
    (targetType === "PAGE"
      ? "Nhập danh sách Page từ file Excel"
      : targetType === "PROFILE"
      ? "Nhập danh sách Trang cá nhân từ file Excel"
      : targetType === "POST"
      ? "Nhập danh sách Bài viết từ file Excel"
      : targetType === "COMMENT"
      ? "Nhập danh sách bình luận từ file Excel"
      : "Nhập danh sách từ file Excel");

  const computedSubtitle =
    subtitle ||
    (targetType === "PAGE"
      ? "Tải lên danh sách Fanpage Facebook để tiến hành tự động hoá seeding hàng loạt"
      : targetType === "PROFILE"
      ? "Tải lên danh sách trang cá nhân Facebook để tiến hành tự động hoá seeding hàng loạt"
      : targetType === "POST"
      ? "Tải lên danh sách bài viết Facebook để tiến hành tự động hoá seeding hàng loạt"
      : targetType === "COMMENT"
      ? "Tải lên file Excel (.xlsx, .csv, .txt) chứa danh sách câu bình luận để seeding ngẫu nhiên"
      : "Tải lên danh sách bài viết & trang cá nhân để tiến hành tự động hoá seeding hàng loạt");

  const [file, setFile] = useState(null);
  const [fileStats, setFileStats] = useState(null);

  const [progress, setProgress] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [parsedTargets, setParsedTargets] = useState([]);
  const [errorMsg, setErrorMsg] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const mounted = useIsMounted();

  // Lock body scroll and handle ESC key
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      const handleKeyDown = (e) => {
        if (e.key === "Escape" && onClose) {
          onClose();
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => {
        document.body.style.overflow = "";
        window.removeEventListener("keydown", handleKeyDown);
      };
    } else {
      document.body.style.overflow = "";
    }
  }, [isOpen, onClose]);

  // Download sample .xlsx template
  const handleDownloadSample = () => {
    try {
      let sampleData;

      if (targetType === "PAGE") {
        sampleData = [
          ["Link Fanpage hoặc Page ID"],
          ["https://www.facebook.com/cuahangabc"],
          ["https://www.facebook.com/dulichvietnam"],
        ];
      } else if (targetType === "PROFILE") {
        sampleData = [
          ["Link Trang cá nhân hoặc UID"],
          ["https://www.facebook.com/leminhanh"],
          ["https://www.facebook.com/tranquocbao"],
        ];
      } else if (targetType === "POST") {
        sampleData = [
          ["Link Bài viết Facebook"],
          ["https://www.facebook.com/100089234567890/posts/1234567890"],
          ["https://www.facebook.com/groups/123456789/posts/987654321"],
        ];
      } else if (targetType === "COMMENT") {
        sampleData = [
          ["Nội dung bình luận"],
          ["Bài viết rất hữu ích, cảm ơn ad!"],
          ["Thông tin quý báu 👍"],
          ["Mình rất thích, cảm ơn bạn đã chia sẻ"],
          ["Địa điểm này đẹp quá, nhất định sẽ đi!"],
          ["Bài viết chất lượng, rất chi tiết!"],
          ["Cảnh đẹp quá, cho mình xin thêm thông tin với ạ!"],
        ];
      } else {
        sampleData = [
          ["Link Facebook hoặc UID"],
          ["https://www.facebook.com/100089234567890/posts/1234567890"],
          ["https://www.facebook.com/cuahangabc"],
        ];
      }

      const ws = XLSX.utils.aoa_to_sheet(sampleData);

      // Auto fit column width
      ws["!cols"] = [{ wch: 65 }];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Danh_Sach_Mau");

      const fileName = targetType === "COMMENT" ? "file_mau_binh_luan.xlsx" : "file_mau_seeding.xlsx";
      XLSX.writeFile(wb, fileName);
    } catch (err) {
      console.error("Lỗi tạo file mẫu:", err);
      alert("Không thể tải file mẫu. Vui lòng thử lại!");
    }
  };

  // Process and parse uploaded file
  const processFile = useCallback(async (selectedFile) => {
    setErrorMsg(null);

    // Kiểm tra dung lượng (tối đa 10MB)
    const MAX_SIZE = 10 * 1024 * 1024;
    if (selectedFile.size > MAX_SIZE) {
      setErrorMsg("Dung lượng file vượt quá 10MB quy định.");
      return;
    }

    // Kiểm tra định dạng
    const extMatch = selectedFile.name.match(/\.([0-9a-z]+)$/i);
    const ext = extMatch ? extMatch[1].toUpperCase() : "";
    if (!["XLSX", "XLS", "CSV", "TXT"].includes(ext)) {
      setErrorMsg("Định dạng file không hợp lệ. Vui lòng chọn .xlsx, .xls, .csv hoặc .txt");
      return;
    }

    setFile(selectedFile);
    setIsAnalyzing(true);
    setIsCompleted(false);
    setProgress(15);

    try {
      const targets = [];
      let totalDataRows = 0;

      if (ext === "TXT") {
        setProgress(50);
        const text = await selectedFile.text();
        setProgress(85);
        const lines = text
          .split("\n")
          .map((l) => l.trim().replace(/^["']|["']$/g, ""))
          .filter((l) => l.length > 0);

        lines.forEach((cleanVal) => {
          if (cleanVal) {
            totalDataRows++;
            targets.push({ url: cleanVal });
          }
        });
      } else {
        const buffer = await selectedFile.arrayBuffer();
        setProgress(50);

        const workbook = XLSX.read(buffer, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        const rawRows = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          blankrows: false,
        });

        setProgress(85);

        rawRows.forEach((row, idx) => {
          const rawColA = row[0] !== undefined && row[0] !== null ? String(row[0]).trim() : "";
          const cleanVal = rawColA.replace(/^["']|["']$/g, "").trim();

          // Bỏ qua dòng tiêu đề nếu dòng 1 chứa các từ khoá header
          if (idx === 0 && cleanVal) {
            const lower = cleanVal.toLowerCase();
            const isCommentHeader =
              lower.includes("bình luận") ||
              lower.includes("comment") ||
              lower.includes("nội dung") ||
              lower.includes("stt");
            const isTargetHeader =
              lower.includes("link") ||
              lower.includes("uid") ||
              lower.includes("url") ||
              lower.includes("tiêu đề") ||
              lower.includes("stt");

            if (targetType === "COMMENT" ? isCommentHeader : isTargetHeader) {
              return;
            }
          }

          if (cleanVal && (targetType === "COMMENT" ? cleanVal.length > 0 : cleanVal.length >= 3)) {
            totalDataRows++;
            targets.push({
              url: cleanVal,
            });
          }
        });
      }

      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const dateStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(
        now.getHours()
      )}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

      setFileStats({
        name: selectedFile.name,
        ext: ext || "XLSX",
        sizeFormatted: formatFileSize(selectedFile.size),
        uploadedAt: dateStr,
        totalRows: totalDataRows,
        validRows: targets.length,
      });

      setParsedTargets(targets);
      setProgress(100);
      setIsAnalyzing(false);
      setIsCompleted(true);
    } catch (err) {
      console.error("Lỗi đọc file:", err);
      setErrorMsg(
        err?.message || "Không thể phân tích file Excel. Vui lòng kiểm tra lại định dạng tệp!"
      );
      setIsAnalyzing(false);
      setProgress(0);
    }
  }, [targetType]);

  const handleFileChange = (e) => {
    const selected = e.target.files?.[0];
    if (selected) {
      processFile(selected);
    }
    e.target.value = "";
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      processFile(droppedFile);
    }
  };

  const handleResetFile = () => {
    setFile(null);
    setFileStats(null);
    setProgress(0);
    setIsAnalyzing(false);
    setIsCompleted(false);
    setParsedTargets([]);
    setErrorMsg(null);
  };

  const handleConfirmImport = () => {
    if (parsedTargets.length > 0) {
      if (onImportComments) {
        onImportComments(parsedTargets.map((t) => t.url));
      }
      if (onImportTargets) {
        onImportTargets(parsedTargets);
      }
    }
    if (onClose) {
      onClose();
    }
  };

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-4xl max-h-[92vh] rounded-3xl shadow-2xl border border-slate-100 flex flex-col overflow-hidden my-auto relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="overflow-y-auto p-6 sm:p-8 space-y-6">
          {/* Header Section */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              {/* Green Document SVG matching screenshot */}
              <div className="w-12 h-12 rounded-2xl bg-[#34D399] flex items-center justify-center text-white shadow-sm shrink-0">
                <svg
                  width="26"
                  height="26"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z"
                    stroke="white"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M14 2V8H20"
                    stroke="white"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <line
                    x1="8"
                    y1="13"
                    x2="16"
                    y2="13"
                    stroke="white"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <line
                    x1="8"
                    y1="17"
                    x2="16"
                    y2="17"
                    stroke="white"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="text-xl font-bold text-slate-900">{computedTitle}</h2>
                  <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-600 font-bold text-xs tracking-wider border border-blue-100">
                    {targetType === "COMMENT" ? ".XLSX, .XLS, .CSV, .TXT" : ".XLSX, .XLS, .CSV"}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">{computedSubtitle}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleDownloadSample}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-semibold border border-blue-200/70 shadow-sm transition-all"
              >
                <Download className="w-4 h-4 text-blue-600" />
                Tải file mẫu (.xlsx)
              </button>

              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
                  title="Đóng"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>

          {/* Info Guide Box */}
          <div className="bg-[#EFF6FF] border border-[#DBEAFE] rounded-2xl p-4 sm:p-5 flex items-start gap-3.5 text-xs text-slate-700">
            <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold text-slate-900">Quy chuẩn định dạng file mẫu:</p>
              <p className="text-slate-600 leading-relaxed">
                {targetType === "COMMENT" ? (
                  <>
                    Hệ thống tự động nhận diện: <strong className="text-slate-900">Cột A:</strong> Điền danh sách nội dung câu bình luận (mỗi dòng 1 câu bình luận). Hỗ trợ định dạng .xlsx, .xls, .csv, .txt. Dung lượng file không vượt quá 10MB.
                  </>
                ) : (
                  <>
                    Hệ thống tự động nhận diện: <strong className="text-slate-900">Cột A:</strong> Điền danh sách Link Facebook hoặc UID hợp lệ (mỗi dòng 1 link hoặc UID). Dung lượng file không vượt quá 10MB.
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Uploaded Dataset Section or Dropzone */}
          {file && fileStats ? (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-5 space-y-4 shadow-sm">
              {/* Header of Section */}
              <div className="flex items-center justify-between pb-1">
                <div className="flex items-center gap-2.5">
                  <Cloud className="w-5 h-5 text-emerald-600" />
                  <h3 className="text-sm font-bold text-slate-900">Tệp dữ liệu đã tải lên</h3>
                </div>

                {isCompleted ? (
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 font-semibold">
                    <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block"></span>
                    Đã tải & phân tích xong 100%
                  </div>
                ) : isAnalyzing ? (
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-xs text-blue-700 font-semibold">
                    <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping inline-block"></span>
                    Đang phân tích {progress}%
                  </div>
                ) : null}
              </div>

              {/* File Info Box */}
              <div className="bg-[#F8FAFC] border border-slate-200/80 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center shrink-0">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <rect
                        x="3"
                        y="3"
                        width="18"
                        height="18"
                        rx="3"
                        stroke="#059669"
                        strokeWidth="2"
                      />
                      <path
                        d="M3 9H21M3 15H21M9 3V21"
                        stroke="#059669"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">{fileStats.name}</span>
                      <span className="bg-slate-200/70 text-slate-700 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">
                        {fileStats.ext}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Kích thước: {fileStats.sizeFormatted} &nbsp;•&nbsp; Tải lên:{" "}
                      {fileStats.uploadedAt} &nbsp;•&nbsp; {fileStats.totalRows} dòng ghi nhận
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-sm transition-all"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5 text-slate-500" />
                    Thay đổi file
                  </button>

                  <button
                    type="button"
                    onClick={handleResetFile}
                    className="p-2 rounded-xl text-red-500 hover:text-red-700 hover:bg-red-50 transition-all border border-transparent hover:border-red-100"
                    title="Xóa file"
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </button>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 font-medium">
                    Tiến trình đọc và kiểm tra tính hợp lệ dữ liệu:
                  </span>
                  <span className="font-bold text-emerald-800">
                    {progress}% {isCompleted ? "(Hoàn thành)" : ""}
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full bg-emerald-800 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
              </div>
            </div>
          ) : (
            /* Dropzone when no file selected */
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 sm:p-10 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                isDragging
                  ? "border-emerald-500 bg-emerald-50/40"
                  : "border-slate-200 hover:border-emerald-500 bg-slate-50/40 hover:bg-emerald-50/20"
              }`}
            >
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3.5 shadow-sm">
                <UploadCloud className="w-7 h-7 text-emerald-600" />
              </div>
              <h4 className="text-sm font-bold text-slate-800">
                Kéo thả file {targetType === "COMMENT" ? "Excel / Text (.xlsx, .xls, .csv, .txt)" : "Excel (.xlsx, .xls, .csv)"} vào đây
              </h4>
              <p className="text-xs text-slate-500 mt-1">
                hoặc <span className="text-blue-600 font-semibold underline">nhấn để chọn từ máy tính</span>
              </p>
              <p className="text-[11px] text-slate-400 mt-2">Dung lượng tối đa 10MB</p>
            </div>
          )}

          {/* Hidden File Input */}
          <input
            ref={fileInputRef}
            type="file"
            accept={targetType === "COMMENT" ? ".xlsx,.xls,.csv,.txt" : ".xlsx,.xls,.csv"}
            onChange={handleFileChange}
            className="hidden"
          />

          {/* Error Notification if any */}
          {errorMsg && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-center gap-3 text-xs text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <div className="text-xs text-slate-500">
              {parsedTargets.length > 0 ? (
                <span className="flex items-center gap-1.5 text-emerald-700 font-semibold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Đã nhận diện thành công {parsedTargets.length} {targetType === "COMMENT" ? "câu bình luận" : "mục tiêu"} hợp lệ
                </span>
              ) : (
                <span>Chưa có dữ liệu nào được nhận diện</span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-all shadow-sm"
                >
                  Hủy bỏ
                </button>
              )}

              <button
                type="button"
                disabled={parsedTargets.length === 0}
                onClick={handleConfirmImport}
                className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold transition-all shadow-sm shadow-emerald-600/20 flex items-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                Áp dụng danh sách ({parsedTargets.length})
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
