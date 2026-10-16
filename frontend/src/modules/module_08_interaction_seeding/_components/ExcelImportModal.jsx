"use client";

import React, { useState, useRef, useCallback, useEffect, useSyncExternalStore, useMemo } from "react";
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
  Eye,
  EyeOff,
  Copy,
  Check,
  Search,
  ExternalLink,
  AlertCircle,
  Database,
} from "lucide-react";
import * as XLSX from "xlsx";
import { seedingApi } from "../service";
import {
  normalizeTargetUrl,
  isValidTargetUrl,
  sanitizeTargetInput,
  validateFacebookUrlAfterNormalize,
  extractTargetFbId,
  hasVietnameseTones,
} from "../validation";

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
  existingTargets = [],
  existingComments = [],
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
  const [duplicateTargets, setDuplicateTargets] = useState([]);
  const [invalidTargets, setInvalidTargets] = useState([]);

  // Database existing targets state (fetched fresh for current user)
  const [dbItems, setDbItems] = useState([]);

  // Preview states
  const [showPreview, setShowPreview] = useState(false);
  const [previewTab, setPreviewTab] = useState("VALID"); // "VALID" | "DUPLICATE" | "INVALID"
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const [errorMsg, setErrorMsg] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const mounted = useIsMounted();

  // Reset file state completely
  const handleResetFile = useCallback(() => {
    setFile(null);
    setFileStats(null);
    setProgress(0);
    setIsAnalyzing(false);
    setIsCompleted(false);
    setParsedTargets([]);
    setDuplicateTargets([]);
    setInvalidTargets([]);
    setShowPreview(false);
    setPreviewTab("VALID");
    setSearchQuery("");
    setCopiedIndex(null);
    setCopiedAll(false);
    setErrorMsg(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  // Whenever modal opens: fetch fresh DB targets and manage body scroll
  useEffect(() => {
    let active = true;
    if (isOpen) {
      document.body.style.overflow = "hidden";
      const fetchDbItems = async () => {
        try {
          if (targetType === "COMMENT") {
            const res = await seedingApi.getSeedingComments();
            if (active) setDbItems(res?.comments || []);
          } else {
            const res = await seedingApi.getSeedingTargets(targetType);
            if (active) setDbItems(res?.targets || []);
          }
        } catch {
          if (active) setDbItems([]);
        }
      };
      fetchDbItems();
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      active = false;
      document.body.style.overflow = "";
    };
  }, [isOpen, targetType]);

  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        handleResetFile();
        if (onClose) onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, handleResetFile]);

  // Combined database items for this user
  const allDbTargets = useMemo(() => {
    const combined = [...(targetType === "COMMENT" ? existingComments : existingTargets)];
    (dbItems || []).forEach((item) => {
      combined.push(item);
    });
    return combined;
  }, [targetType, existingComments, existingTargets, dbItems]);

  // Download sample .xlsx template
  const handleDownloadSample = () => {
    try {
      let sampleData;

      if (targetType === "PAGE") {
        sampleData = [
          ["Link Fanpage hoặc Page ID"],
          ["https://www.facebook.com/cuahangabc"],
          ["https://www.facebook.com/dulichvietnam"],
          ["100088888888888"],
        ];
      } else if (targetType === "PROFILE") {
        sampleData = [
          ["Link Trang cá nhân hoặc UID"],
          ["https://www.facebook.com/leminhanh"],
          ["https://www.facebook.com/tranquocbao"],
          ["100012345678901"],
        ];
      } else if (targetType === "POST") {
        sampleData = [
          ["Link Bài viết Facebook hoặc ID/Share Token"],
          ["https://web.facebook.com/share/p/18NvrpA3BJ"],
          ["https://www.facebook.com/100089234567890/posts/1234567890"],
          ["18NvrpA3BJ"],
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

  // Process and parse uploaded file with strict validation and user database deduplication
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
    setShowPreview(false);
    setProgress(15);

    try {
      let totalDataRows = 0;
      let duplicateCount = 0;
      let invalidCount = 0;
      const validList = [];
      const duplicateList = [];
      const invalidList = [];
      const seenUrls = new Set();
      const seenIds = new Set();

      // 1. Chuẩn bị tập hợp kiểm tra trùng lặp từ database của user
      let latestDbItems = [];
      try {
        if (targetType === "COMMENT") {
          const res = await seedingApi.getSeedingComments();
          latestDbItems = res?.comments || [];
        } else {
          const res = await seedingApi.getSeedingTargets(targetType);
          latestDbItems = res?.targets || [];
        }
      } catch (e) {
        console.warn("Không thể tải danh sách từ database:", e);
      }

      const combinedTargets = [
        ...(targetType === "COMMENT" ? existingComments : existingTargets),
        ...latestDbItems,
        ...(allDbTargets || []),
      ];

      const existingUrlSet = new Set();
      const existingIdSet = new Set();

      combinedTargets.forEach((t) => {
        const raw = typeof t === "string" ? t : t?.url || t?.fb_id || t?.content || "";
        if (!raw) return;

        if (targetType === "COMMENT") {
          existingUrlSet.add(raw.trim().toLowerCase());
        } else {
          const norm = normalizeTargetUrl(raw, targetType).toLowerCase();
          if (norm) existingUrlSet.add(norm);

          const fid = (typeof t === "object" && t?.fb_id ? t.fb_id : extractTargetFbId(raw, targetType)).toLowerCase();
          if (fid && fid !== "unknown") existingIdSet.add(fid);
        }
      });

      // 2. Hàm phân tích từng dòng
      const parseRow = (cleanVal, rowNum) => {
        if (!cleanVal) return;
        totalDataRows++;

        if (targetType === "COMMENT") {
          const commentKey = cleanVal.toLowerCase();
          const isDb = existingUrlSet.has(commentKey);
          const isFile = seenUrls.has(commentKey);

          if (isDb || isFile) {
            duplicateCount++;
            duplicateList.push({
              row: rowNum,
              raw: cleanVal,
              url: cleanVal,
              reason: isDb ? "Đã tồn tại trong database của bạn" : "Trùng lặp với dòng khác trong file",
              isDb,
            });
          } else {
            seenUrls.add(commentKey);
            validList.push({
              url: cleanVal,
              raw: cleanVal,
              row: rowNum,
            });
          }
          return;
        }

        // Với mục tiêu PAGE, PROFILE, POST:
        // a. Kiểm tra dấu tiếng Việt
        if (hasVietnameseTones(cleanVal)) {
          invalidCount++;
          invalidList.push({
            row: rowNum,
            raw: cleanVal,
            reason: "Chứa ký tự có dấu tiếng Việt",
          });
          return;
        }

        // b. Kiểm tra ký tự cấm hoặc khoảng trắng
        if (/[ ,;'"<>()[\]{}|\\^~`*!]/.test(cleanVal)) {
          invalidCount++;
          invalidList.push({
            row: rowNum,
            raw: cleanVal,
            reason: "Chứa khoảng trắng hoặc ký tự đặc biệt",
          });
          return;
        }

        // c. Kiểm tra độ dài tối thiểu
        if (cleanVal.length < 4) {
          invalidCount++;
          invalidList.push({
            row: rowNum,
            raw: cleanVal,
            reason: "Độ dài quá ngắn (< 4 ký tự)",
          });
          return;
        }

        // d. Tự động chuẩn hóa / gán https://web.facebook.com/
        const finalUrl = normalizeTargetUrl(cleanVal, targetType);
        if (!finalUrl) {
          invalidCount++;
          invalidList.push({
            row: rowNum,
            raw: cleanVal,
            reason: "Không thể chuẩn hóa liên kết Facebook",
          });
          return;
        }

        // e. KIỂM TRA CHẶT CHẼ CẢ LINK SAU KHI TỰ ĐỘNG GÁN https://web.facebook.com/
        const checkResult = validateFacebookUrlAfterNormalize(finalUrl, targetType);
        if (!checkResult.isValid) {
          invalidCount++;
          invalidList.push({
            row: rowNum,
            raw: cleanVal,
            reason: checkResult.reason || "Sai định dạng liên kết Facebook",
          });
          return;
        }

        // f. KIỂM TRA TRÙNG LẶP VỚI DATABASE CỦA USER HOẶC DÒNG KHÁC TRONG FILE
        const normKey = finalUrl.toLowerCase();
        const fbId = extractTargetFbId(finalUrl, targetType);
        const idKey = fbId ? fbId.toLowerCase() : "";

        const isDb = existingUrlSet.has(normKey) || (idKey && idKey !== "unknown" && existingIdSet.has(idKey));
        const isFile = seenUrls.has(normKey) || (idKey && idKey !== "unknown" && seenIds.has(idKey));

        if (isDb || isFile) {
          duplicateCount++;
          duplicateList.push({
            row: rowNum,
            raw: cleanVal,
            url: finalUrl,
            fbId: fbId && fbId !== "unknown" ? fbId : null,
            reason: isDb ? "Đã tồn tại trong database của bạn" : "Trùng lặp với dòng khác trong file",
            isDb,
          });
        } else {
          seenUrls.add(normKey);
          if (idKey && idKey !== "unknown") {
            seenIds.add(idKey);
          }
          validList.push({
            url: finalUrl,
            raw: cleanVal,
            row: rowNum,
            fbId: fbId && fbId !== "unknown" ? fbId : null,
          });
        }
      };

      if (ext === "TXT") {
        setProgress(45);
        const text = await selectedFile.text();
        setProgress(80);
        const lines = text
          .split("\n")
          .map((l) => l.trim().replace(/^["']|["']$/g, ""))
          .filter((l) => l.length > 0);

        lines.forEach((line, idx) => {
          parseRow(line, idx + 1);
        });
      } else {
        const buffer = await selectedFile.arrayBuffer();
        setProgress(45);

        const workbook = XLSX.read(buffer, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        const rawRows = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          blankrows: false,
        });

        setProgress(80);

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

          parseRow(cleanVal, idx + 1);
        });
      }

      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const dateStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(
        now.getHours()
      )}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

      const dbDupCount = duplicateList.filter((d) => d.isDb).length;

      setFileStats({
        name: selectedFile.name,
        ext: ext || "XLSX",
        sizeFormatted: formatFileSize(selectedFile.size),
        uploadedAt: dateStr,
        totalRows: totalDataRows,
        validRows: validList.length,
        duplicateRows: duplicateCount,
        dbDuplicateRows: dbDupCount,
        invalidRows: invalidCount,
      });

      setParsedTargets(validList);
      setDuplicateTargets(duplicateList);
      setInvalidTargets(invalidList);
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
  }, [targetType, allDbTargets, existingComments, existingTargets]);

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

  // Delete single item from valid preview list
  const handleDeleteItem = (targetIndex) => {
    const updated = parsedTargets.filter((_, idx) => idx !== targetIndex);
    setParsedTargets(updated);
    if (fileStats) {
      setFileStats((prev) => ({
        ...prev,
        validRows: updated.length,
      }));
    }
  };

  // Copy single link
  const handleCopyItem = (url, index) => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(url);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
    }
  };

  // Copy all valid links
  const handleCopyAllValid = () => {
    if (navigator?.clipboard && parsedTargets.length > 0) {
      const text = parsedTargets.map((t) => t.url).join("\n");
      navigator.clipboard.writeText(text);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    }
  };

  // Filtered lists for preview
  const filteredValid = useMemo(() => {
    if (!searchQuery.trim()) return parsedTargets;
    const q = searchQuery.toLowerCase();
    return parsedTargets.filter(
      (item) =>
        item.url.toLowerCase().includes(q) ||
        (item.raw && item.raw.toLowerCase().includes(q)) ||
        (item.fbId && String(item.fbId).toLowerCase().includes(q))
    );
  }, [parsedTargets, searchQuery]);

  const filteredDuplicates = useMemo(() => {
    if (!searchQuery.trim()) return duplicateTargets;
    const q = searchQuery.toLowerCase();
    return duplicateTargets.filter(
      (item) =>
        item.url.toLowerCase().includes(q) ||
        (item.raw && item.raw.toLowerCase().includes(q)) ||
        (item.reason && item.reason.toLowerCase().includes(q))
    );
  }, [duplicateTargets, searchQuery]);

  const filteredInvalid = useMemo(() => {
    if (!searchQuery.trim()) return invalidTargets;
    const q = searchQuery.toLowerCase();
    return invalidTargets.filter(
      (item) =>
        (item.raw && item.raw.toLowerCase().includes(q)) ||
        (item.reason && item.reason.toLowerCase().includes(q))
    );
  }, [invalidTargets, searchQuery]);

  const handleCloseModal = () => {
    handleResetFile();
    if (onClose) {
      onClose();
    }
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
    handleResetFile();
    if (onClose) {
      onClose();
    }
  };

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-fadeIn"
      onClick={handleCloseModal}
    >
      <div
        className="bg-white w-full max-w-4xl max-h-[92vh] rounded-3xl shadow-2xl border border-slate-100 flex flex-col overflow-hidden my-auto relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="overflow-y-auto p-6 sm:p-8 space-y-5">
          {/* Header Section */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500 flex items-center justify-center text-white shadow-sm shrink-0">
                <FileSpreadsheet className="w-6 h-6 text-white" />
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
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-semibold border border-blue-200/70 shadow-sm transition-all cursor-pointer"
              >
                <Download className="w-4 h-4 text-blue-600" />
                Tải file mẫu (.xlsx)
              </button>

              {onClose && (
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all cursor-pointer"
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
              <p className="font-bold text-slate-900">Quy chuẩn định dạng file & Tự động kiểm tra trùng lặp:</p>
              <p className="text-slate-600 leading-relaxed">
                {targetType === "COMMENT" ? (
                  <>
                    Hệ thống tự động nhận diện: <strong className="text-slate-900">Cột A:</strong> Điền danh sách nội dung câu bình luận (mỗi dòng 1 câu bình luận). Tự động kiểm tra và lọc bỏ các bình luận đã có trong database của bạn. Dung lượng file tối đa 10MB.
                  </>
                ) : (
                  <>
                    Hệ thống tự động nhận diện: <strong className="text-slate-900">Cột A:</strong> Điền danh sách Link Facebook hoặc UID hợp lệ. Hệ thống tự động gán <code className="px-1.5 py-0.5 rounded bg-blue-100/70 text-blue-800 font-mono font-semibold">https://web.facebook.com/</code>, kiểm tra toàn diện cấu trúc link, và <strong className="text-emerald-700">tự động đối soát lọc bỏ những link đã có trong database của bạn</strong>.
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
                    <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
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
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-sm transition-all cursor-pointer"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5 text-slate-500" />
                    Thay đổi file
                  </button>

                  <button
                    type="button"
                    onClick={handleResetFile}
                    className="p-2 rounded-xl text-red-500 hover:text-red-700 hover:bg-red-50 transition-all border border-transparent hover:border-red-100 cursor-pointer"
                    title="Xóa file (chọn lại file mới)"
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
                    className="h-full bg-emerald-600 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
              </div>

              {/* Stats Bar & Buttons: XEM TRƯỚC NHỮNG LINK HỢP LỆ & TRÙNG LẶP */}
              {isCompleted && (
                <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-semibold border border-blue-200">
                      Tổng: {fileStats.totalRows} dòng
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      Hợp lệ (mới): {parsedTargets.length}
                    </span>
                    {fileStats.duplicateRows > 0 && (
                      <span
                        className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 font-semibold border border-amber-200 flex items-center gap-1"
                        title={
                          fileStats.dbDuplicateRows > 0
                            ? `${fileStats.dbDuplicateRows} link đã có trong database của bạn`
                            : "Trùng lặp trong file"
                        }
                      >
                        <Copy className="w-3.5 h-3.5 text-amber-600" />
                        Trùng lặp: {fileStats.duplicateRows}
                        {fileStats.dbDuplicateRows > 0 && (
                          <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded bg-amber-200/70 text-amber-900 font-bold inline-flex items-center gap-0.5">
                            <Database className="w-2.5 h-2.5" />
                            {fileStats.dbDuplicateRows} đã có trong DB
                          </span>
                        )}
                      </span>
                    )}
                    {fileStats.invalidRows > 0 && (
                      <span className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 font-semibold border border-rose-200 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                        Không hợp lệ: {fileStats.invalidRows}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {parsedTargets.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowPreview((prev) => !prev || previewTab !== "VALID");
                          setPreviewTab("VALID");
                        }}
                        className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer ${
                          showPreview && previewTab === "VALID"
                            ? "bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-600/20"
                            : "bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                        }`}
                      >
                        {showPreview && previewTab === "VALID" ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4 text-emerald-600" />
                        )}
                        {showPreview && previewTab === "VALID"
                          ? "Đóng xem trước"
                          : `Xem trước link hợp lệ (${parsedTargets.length})`}
                      </button>
                    )}

                    {duplicateTargets.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (showPreview && previewTab === "DUPLICATE") {
                            setShowPreview(false);
                          } else {
                            setShowPreview(true);
                            setPreviewTab("DUPLICATE");
                          }
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer ${
                          showPreview && previewTab === "DUPLICATE"
                            ? "bg-amber-600 text-white hover:bg-amber-700"
                            : "bg-white border border-amber-300 text-amber-800 hover:bg-amber-50"
                        }`}
                      >
                        <Copy className="w-3.5 h-3.5 text-amber-600" />
                        {showPreview && previewTab === "DUPLICATE"
                          ? "Đóng link trùng"
                          : `Xem link trùng (${duplicateTargets.length})`}
                      </button>
                    )}

                    {invalidTargets.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (showPreview && previewTab === "INVALID") {
                            setShowPreview(false);
                          } else {
                            setShowPreview(true);
                            setPreviewTab("INVALID");
                          }
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer ${
                          showPreview && previewTab === "INVALID"
                            ? "bg-rose-600 text-white hover:bg-rose-700"
                            : "bg-white border border-rose-200 text-rose-700 hover:bg-rose-50"
                        }`}
                      >
                        <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                        {showPreview && previewTab === "INVALID"
                          ? "Đóng dòng lỗi"
                          : `Xem dòng lỗi (${invalidTargets.length})`}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* BẢNG XEM TRƯỚC (PREVIEW PANEL) */}
              {showPreview && (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3.5 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPreviewTab("VALID")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          previewTab === "VALID"
                            ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                            : "text-slate-500 hover:bg-slate-100"
                        }`}
                      >
                        Link hợp lệ mới ({parsedTargets.length})
                      </button>

                      {duplicateTargets.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setPreviewTab("DUPLICATE")}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                            previewTab === "DUPLICATE"
                              ? "bg-amber-100 text-amber-900 border border-amber-200"
                              : "text-slate-500 hover:bg-slate-100"
                          }`}
                        >
                          Trùng lặp ({duplicateTargets.length})
                        </button>
                      )}

                      {invalidTargets.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setPreviewTab("INVALID")}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                            previewTab === "INVALID"
                              ? "bg-rose-100 text-rose-800 border border-rose-200"
                              : "text-slate-500 hover:bg-slate-100"
                          }`}
                        >
                          Dòng lỗi ({invalidTargets.length})
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-1 max-w-sm">
                      <div className="relative w-full">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Tìm kiếm link, ID hoặc từ khóa..."
                          className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                        />
                      </div>
                      {previewTab === "VALID" && parsedTargets.length > 0 && (
                        <button
                          type="button"
                          onClick={handleCopyAllValid}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold shrink-0 cursor-pointer transition-all"
                          title="Sao chép toàn bộ danh sách link hợp lệ"
                        >
                          {copiedAll ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                          {copiedAll ? "Đã chép" : "Chép tất cả"}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 1. Bảng danh sách hợp lệ mới */}
                  {previewTab === "VALID" && (
                    filteredValid.length > 0 ? (
                      <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead className="bg-slate-50 text-slate-600 font-semibold sticky top-0 z-10 border-b border-slate-200">
                            <tr>
                              <th className="py-2.5 px-3 w-12 text-center">STT</th>
                              <th className="py-2.5 px-3 w-40">Dòng gốc trong file</th>
                              <th className="py-2.5 px-3">
                                {targetType === "COMMENT"
                                  ? "Nội dung câu bình luận"
                                  : "Link sau khi tự động gán & chuẩn hóa"}
                              </th>
                              {targetType !== "COMMENT" && (
                                <th className="py-2.5 px-3 w-32">ID / Token</th>
                              )}
                              <th className="py-2.5 px-3 w-24 text-center">Thao tác</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {filteredValid.map((item, idx) => {
                              const originalIndex = parsedTargets.indexOf(item);
                              return (
                                <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                                  <td className="py-2.5 px-3 text-center text-slate-400 font-mono text-[11px]">
                                    #{item.row || idx + 1}
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px] truncate max-w-[150px]">
                                    {item.raw}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    {targetType === "COMMENT" ? (
                                      <span className="text-slate-800 font-medium">{item.url}</span>
                                    ) : (
                                      <a
                                        href={item.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-blue-600 font-mono font-medium hover:underline inline-flex items-center gap-1 truncate max-w-md"
                                        title={item.url}
                                      >
                                        <span className="truncate">{item.url}</span>
                                        <ExternalLink className="w-3 h-3 shrink-0 opacity-70" />
                                      </a>
                                    )}
                                  </td>
                                  {targetType !== "COMMENT" && (
                                    <td className="py-2.5 px-3">
                                      {item.fbId ? (
                                        <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-mono font-bold">
                                          {item.fbId}
                                        </span>
                                      ) : (
                                        <span className="text-slate-400 text-[10px]">-</span>
                                      )}
                                    </td>
                                  )}
                                  <td className="py-2.5 px-3 text-center">
                                    <div className="flex items-center justify-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => handleCopyItem(item.url, originalIndex)}
                                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all cursor-pointer"
                                        title="Sao chép link này"
                                      >
                                        {copiedIndex === originalIndex ? (
                                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                                        ) : (
                                          <Copy className="w-3.5 h-3.5" />
                                        )}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteItem(originalIndex)}
                                        className="p-1.5 rounded-lg text-rose-400 hover:text-rose-600 hover:bg-rose-50 transition-all cursor-pointer"
                                        title="Xóa link này khỏi danh sách nhập"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="p-6 text-center text-slate-400 text-xs">
                        Không tìm thấy link hợp lệ nào khớp với từ khóa tìm kiếm.
                      </div>
                    )
                  )}

                  {/* 2. Bảng danh sách link trùng lặp (database hoặc trong file) */}
                  {previewTab === "DUPLICATE" && (
                    filteredDuplicates.length > 0 ? (
                      <div className="max-h-64 overflow-y-auto rounded-xl border border-amber-200 overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead className="bg-amber-50 text-amber-800 font-semibold sticky top-0 z-10 border-b border-amber-200">
                            <tr>
                              <th className="py-2.5 px-3 w-16 text-center">Dòng file</th>
                              <th className="py-2.5 px-3 w-40">Dữ liệu gốc</th>
                              <th className="py-2.5 px-3">Link Facebook</th>
                              <th className="py-2.5 px-3 w-56">Tình trạng trùng lặp</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-amber-100 bg-white">
                            {filteredDuplicates.map((item, idx) => (
                              <tr key={idx} className="hover:bg-amber-50/40 transition-colors">
                                <td className="py-2.5 px-3 text-center text-amber-700 font-mono text-[11px]">
                                  #{item.row}
                                </td>
                                <td className="py-2.5 px-3 text-slate-600 font-mono text-[11px] truncate max-w-[150px]">
                                  {item.raw}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-slate-700 truncate max-w-xs">
                                  {item.url}
                                </td>
                                <td className="py-2.5 px-3">
                                  {item.isDb ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 border border-amber-200 text-amber-800 font-semibold text-[11px]">
                                      <Database className="w-3 h-3 text-amber-600" />
                                      Đã có trong database của bạn
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-600 font-semibold text-[11px]">
                                      <Copy className="w-3 h-3 text-slate-500" />
                                      Trùng lặp dòng khác trong file
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="p-6 text-center text-slate-400 text-xs">
                        Không có liên kết trùng lặp nào khớp với từ khóa tìm kiếm.
                      </div>
                    )
                  )}

                  {/* 3. Bảng danh sách dòng không hợp lệ */}
                  {previewTab === "INVALID" && (
                    filteredInvalid.length > 0 ? (
                      <div className="max-h-64 overflow-y-auto rounded-xl border border-rose-200 overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead className="bg-rose-50 text-rose-700 font-semibold sticky top-0 z-10 border-b border-rose-200">
                            <tr>
                              <th className="py-2.5 px-3 w-16 text-center">Dòng file</th>
                              <th className="py-2.5 px-3 w-64">Dữ liệu trong file</th>
                              <th className="py-2.5 px-3">Lý do không hợp lệ</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-rose-100 bg-white">
                            {filteredInvalid.map((item, idx) => (
                              <tr key={idx} className="hover:bg-rose-50/40 transition-colors">
                                <td className="py-2.5 px-3 text-center text-rose-500 font-mono text-[11px]">
                                  #{item.row}
                                </td>
                                <td className="py-2.5 px-3 text-slate-700 font-mono text-[11px] truncate max-w-xs">
                                  {item.raw}
                                </td>
                                <td className="py-2.5 px-3 text-rose-600 font-medium flex items-center gap-1.5">
                                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-500" />
                                  <span>{item.reason}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="p-6 text-center text-slate-400 text-xs">
                        Không có dòng lỗi nào khớp với từ khóa tìm kiếm.
                      </div>
                    )
                  )}

                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                    <span>
                      {previewTab === "VALID"
                        ? `Hiển thị ${filteredValid.length} / ${parsedTargets.length} link hợp lệ`
                        : previewTab === "DUPLICATE"
                        ? `Hiển thị ${filteredDuplicates.length} / ${duplicateTargets.length} link trùng lặp`
                        : `Hiển thị ${filteredInvalid.length} / ${invalidTargets.length} dòng lỗi`}
                    </span>
                    <span className="text-slate-500">
                      * Các dòng lỗi và link đã có trong database sẽ tự động được loại bỏ khi bấm &quot;Áp dụng danh sách&quot;
                    </span>
                  </div>
                </div>
              )}
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
          <div className="flex items-center justify-between pt-3 border-t border-slate-100">
            <div className="text-xs text-slate-500 flex items-center gap-2">
              {parsedTargets.length > 0 ? (
                <>
                  <span className="flex items-center gap-1.5 text-emerald-700 font-semibold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Đã nhận diện {parsedTargets.length} {targetType === "COMMENT" ? "câu bình luận" : "mục tiêu"} mới hợp lệ
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPreview(true);
                      setPreviewTab("VALID");
                    }}
                    className="text-blue-600 hover:text-blue-800 underline font-semibold cursor-pointer"
                  >
                    (Xem trước)
                  </button>
                </>
              ) : (
                <span>Chưa có dữ liệu nào được nhận diện</span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {onClose && (
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-all shadow-sm cursor-pointer"
                >
                  Hủy bỏ
                </button>
              )}

              <button
                type="button"
                disabled={parsedTargets.length === 0}
                onClick={handleConfirmImport}
                className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold transition-all shadow-sm shadow-emerald-600/20 flex items-center gap-2 cursor-pointer active:scale-95"
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
