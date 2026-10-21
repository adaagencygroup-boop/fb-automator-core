"use client";

import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/ui/toast";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { checkExistingUids } from "../service";
import { DEFAULT_MAPPING, mapImportedRow, detectColumnMapping, isValidProxy } from "../utils/import-mapping.mjs";
import {
  Braces, Check, ChevronDown, CircleCheck, Eye, EyeOff, Info, ListFilter,
  ShieldCheck, Sparkles, Trash2, Upload, UserRoundPlus, X,
} from "lucide-react";

const FIELD_OPTIONS = [
  { value: "uid", label: "UID (Facebook ID) *", shortLabel: "UID" },
  { value: "password", label: "Mật khẩu (Pass) *", shortLabel: "MẬT KHẨU" },
  { value: "two_fa", label: "Mã bảo mật (2FA Key)", shortLabel: "2FA KEY" },
  { value: "cookie", label: "Cookie chuỗi", shortLabel: "COOKIE" },
  { value: "token", label: "Access Token (EAAB...)", shortLabel: "TOKEN" },
  { value: "email", label: "Email đăng nhập", shortLabel: "EMAIL" },
  { value: "pass_mail", label: "Mật khẩu Email (Pass Mail)", shortLabel: "PASS MAIL" },
  { value: "mail_recovery", label: "Mail khôi phục (Mailkp)", shortLabel: "MAIL KHÔI PHỤC" },
  { value: "token_hotmail", label: "Token Hotmail", shortLabel: "TOKEN HOTMAIL" },
  { value: "client_id", label: "Client ID", shortLabel: "CLIENT ID" },
  { value: "proxy", label: "Proxy (ip:port:user:pass)", shortLabel: "PROXY" },
  { value: "ignore", label: "Bỏ qua cột này", shortLabel: "BỎ QUA" },
];

const DELIMITERS = [
  { value: "|", label: "| (dấu gạch đứng – mặc định)" },
  { value: ":", label: ": (dấu hai chấm)" },
  { value: ",", label: ", (dấu phẩy)" },
  { value: "\t", label: "Tab" },
];

function truncateValue(value, visible = 16) {
  const text = String(value || "");
  if (!text) return "—";
  return text.length > visible ? `${text.slice(0, visible)}...` : text;
}

export default function DynamicImportModal({ isOpen, onClose, onImport }) {
  const toast = useToast();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const [rawText, setRawText] = useState("");
  const [delimiter, setDelimiter] = useState("|");
  const [manualColumnMap, setManualColumnMap] = useState(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const [checkAfterImport, setCheckAfterImport] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const handleToggleSkipDuplicates = (checked) => {
    if (!checked) {
      setShowOverwriteConfirm(true);
    } else {
      setSkipDuplicates(true);
    }
  };

  const lines = useMemo(
    () => rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 100),
    [rawText],
  );

  const detectedColumnCount = useMemo(() => {
    if (!lines.length) return DEFAULT_MAPPING.length;
    return Math.max(...lines.slice(0, 50).map((line) => line.split(delimiter).length), 1);
  }, [delimiter, lines]);

  const suggestedColumnMap = useMemo(
    () => detectColumnMapping(lines, delimiter, detectedColumnCount),
    [delimiter, detectedColumnCount, lines],
  );

  const columnMap = useMemo(() => {
    if (manualColumnMap) {
      if (manualColumnMap.length >= detectedColumnCount) return manualColumnMap;
      return Array.from({ length: detectedColumnCount }, (_, index) => manualColumnMap[index] || suggestedColumnMap[index] || "ignore");
    }
    return suggestedColumnMap;
  }, [manualColumnMap, detectedColumnCount, suggestedColumnMap]);

  const parsedAccounts = useMemo(() => {
    const parsed = [];
    const seen = new Set();
    for (const line of lines) {
      const account = mapImportedRow(line, delimiter, columnMap);
      if (!account.uid || seen.has(account.uid)) continue;
      seen.add(account.uid);
      parsed.push(account);
    }
    return parsed;
  }, [columnMap, delimiter, lines]);

  const [existingUidSet, setExistingUidSet] = useState(new Set());
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [duplicateError, setDuplicateError] = useState(null);
  useEffect(() => {
    if (!isOpen || !parsedAccounts.length) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      setCheckingDuplicates(true);
      setDuplicateError(null);
      return checkExistingUids(parsedAccounts.map(account => account.uid)).then(uids => {
        if (!cancelled) setExistingUidSet(new Set(uids));
      }).catch(error => {
        if (!cancelled) setDuplicateError(error.message);
      }).finally(() => { if (!cancelled) setCheckingDuplicates(false); });
    });
    return () => { cancelled = true; };
  }, [isOpen, parsedAccounts]);
  const accountsToImport = useMemo(
    () => skipDuplicates ? parsedAccounts.filter((account) => !existingUidSet.has(account.uid)) : parsedAccounts,
    [existingUidSet, parsedAccounts, skipDuplicates],
  );
  const skippedExistingCount = parsedAccounts.length - accountsToImport.length;
  const existingOverlapCount = useMemo(
    () => parsedAccounts.filter((account) => existingUidSet.has(account.uid)).length,
    [existingUidSet, parsedAccounts],
  );

  const visibleColumnCount = Math.max(detectedColumnCount, DEFAULT_MAPPING.length);
  const activeMappings = columnMap.slice(0, visibleColumnCount).filter((field) => field !== "ignore");
  const mappedFieldCount = new Set(activeMappings).size;
  const hasUidMapping = activeMappings.includes("uid");
  const hasPasswordMapping = activeMappings.includes("password");
  const hasDuplicateMappings = activeMappings.some((field, index) => activeMappings.indexOf(field) !== index);

  const previewColumns = useMemo(() => {
    return DEFAULT_MAPPING.map((field) => {
      const option = FIELD_OPTIONS.find((opt) => opt.value === field);
      return {
        field,
        shortLabel: option?.shortLabel || field.toUpperCase(),
        label: option?.label || field,
      };
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !isImporting) {
        setShowPreview(false);
        onClose();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isImporting, isOpen, onClose]);

  if (!isOpen || !mounted) return null;

  const handleClose = () => {
    setShowPreview(false);
    onClose();
  };

  const resetForm = () => {
    setRawText("");
    setManualColumnMap(null);
    setShowPreview(false);
  };

  const handleImport = async () => {
    if (!rawText.trim() || !lines.length) {
      toast.error("Vui lòng dán dữ liệu tài khoản vào khung nhập!", "LỖI NHẬP TÀI KHOẢN");
      return;
    }

    const totalLinesCount = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length;
    if (totalLinesCount > 100) {
      toast.error(
        `Bạn đang nhập ${totalLinesCount} tài khoản. Hệ thống chỉ cho phép tối đa 100 tài khoản cho mỗi lần import!`,
        "VƯỢT QUÁ GIỚI HẠN"
      );
      return;
    }

    if (!hasUidMapping && !hasPasswordMapping) {
      toast.error(
        "Thiếu trường bắt buộc: Cần cấu hình cả cột UID và Mật khẩu trong Field Mapping để thực hiện import!",
        "THIẾU TRƯỜNG BẮT BUỘC"
      );
      return;
    }
    if (!hasUidMapping) {
      toast.error(
        "Thiếu trường bắt buộc: Cần cấu hình cột UID (Facebook ID) trong Field Mapping!",
        "THIẾU CỘT UID"
      );
      return;
    }
    if (!hasPasswordMapping) {
      toast.error(
        "Thiếu trường bắt buộc: Cần cấu hình cột Mật khẩu (Pass) trong Field Mapping!",
        "THIẾU CỘT MẬT KHẨU"
      );
      return;
    }

    if (hasDuplicateMappings) {
      toast.error(
        "Cấu hình mapping không hợp lệ: Mỗi trường chỉ được gán cho một cột duy nhất.",
        "LỖI FIELD MAPPING"
      );
      return;
    }

    const uidRegex = /^[1-9][0-9]{3,19}$/;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const rowNumber = i + 1;
      const acc = mapImportedRow(line, delimiter, columnMap);

      const rowUid = (acc.uid || "").trim();
      const rowPassword = (acc.password || "").trim();

      if (!rowUid) {
        toast.error(`Dòng ${rowNumber}: Thiếu UID tài khoản! Yêu cầu nhập đầy đủ trường bắt buộc.`, "THIẾU DỮ LIỆU");
        return;
      }
      if (!uidRegex.test(rowUid)) {
        toast.error(
          `Dòng ${rowNumber}: UID "${rowUid}" không hợp lệ. UID chỉ được chứa chữ số (0-9) và không bắt đầu bằng số 0.`,
          "UID KHÔNG HỢP LỆ"
        );
        return;
      }

      if (!rowPassword) {
        toast.error(`Dòng ${rowNumber}: Thiếu Mật khẩu tài khoản! Yêu cầu nhập đầy đủ trường bắt buộc.`, "THIẾU DỮ LIỆU");
        return;
      }
      if (rowPassword.length < 4 || rowPassword.length > 250) {
        toast.error(
          `Dòng ${rowNumber}: Mật khẩu không hợp lệ. Yêu cầu độ dài từ 4 đến 250 ký tự.`,
          "MẬT KHẨU KHÔNG HỢP LỆ"
        );
        return;
      }

      if (!isValidProxy(acc.proxy)) {
        toast.error(`Dòng ${rowNumber}: Proxy không hợp lệ. Kiểm tra cột Proxy hoặc chọn "Bỏ qua cột này".`, "PROXY KHÔNG HỢP LỆ");
        return;
      }

      if (acc.mail_recovery && acc.mail_recovery.length > 150) {
        toast.error(
          `Dòng ${rowNumber}: Email khôi phục vượt quá 150 ký tự. Vui lòng kiểm tra lại cấu hình cột mapping (có thể cột này là Token Hotmail)!`,
          "EMAIL KHÔI PHỤC QUÁ DÀI"
        );
        return;
      }
    }

    setIsImporting(true);
    try {
      const success = await onImport(parsedAccounts, 0, skipDuplicates);
      if (success) {
        resetForm();
        handleClose();
      }
    } catch (err) {
      toast.error(err.message || "Lỗi khi lưu danh sách tài khoản", "LỖI IMPORT");
    } finally {
      setIsImporting(false);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-sm select-none w-screen h-screen overflow-y-auto animate-in fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isImporting) handleClose();
      }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-[1140px] flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl text-slate-800 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-1 shrink-0 bg-primary" />

        <header className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4 bg-white">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary border border-blue-100 shadow-sm">
              <UserRoundPlus className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 leading-snug">
                Nhập danh sách tài khoản Facebook
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 leading-normal">
                Nhập danh sách tài khoản theo định dạng phân tách để tự động nhận diện và lưu trữ an toàn
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isImporting}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
            title="Đóng"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 bg-slate-50/50">
          <div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
            {/* Cột trái: Section - Cột Trái: Nhập Dữ Liệu Raw Text (Figma Node 1010-3775) */}
            <section className="flex min-h-[380px] flex-col justify-between rounded-xl border border-[#E2E8F0] bg-white p-4 sm:p-5 shadow-[0_1px_2px_0_rgba(0,0,0,0.04)]">
              <div>
                {/* Tiêu đề & Badge đếm dòng */}
                <div className="mb-3 flex items-center justify-between border-b border-[#F1F5F9] pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sm text-[#2563EB] tracking-tight">
                      {"{ }"}
                    </span>
                    <h3 className="font-bold text-sm text-[#1E293B]">
                      Dữ liệu tài khoản
                    </h3>
                  </div>
                  <span className="rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-2.5 py-0.5 text-xs text-[#1D4ED8] font-normal">
                    {lines.length} / 100 dòng
                  </span>
                </div>

                {/* Trình nhập code / Textarea giả lập IDE với số dòng - Chuẩn Figma #F8FAFC */}
                <div className="flex min-h-[260px] overflow-hidden rounded-lg border border-[#E2E8F0]/90 bg-[#F8FAFC] focus-within:border-[#2563EB] focus-within:ring-2 focus-within:ring-[#2563EB]/15 transition-all">
                  {/* Cột số dòng (01, 02, 03...) */}
                  <div
                    aria-hidden="true"
                    className="w-10 shrink-0 select-none border-r border-[#E2E8F0]/80 bg-[#F8FAFC] py-3 text-right font-mono text-[11px] leading-[19.5px] text-[#94A3B8]"
                  >
                    {Array.from(
                      { length: Math.max(8, rawText.split(/\r?\n/).length) },
                      (_, index) => (
                        <div key={index} className="pr-2">
                          {String(index + 1).padStart(2, "0")}
                        </div>
                      )
                    )}
                  </div>

                  {/* Vùng nhập text */}
                  <textarea
                    value={rawText}
                    onChange={(event) => setRawText(event.target.value)}
                    spellCheck={false}
                    placeholder="...dán thêm tài khoản tại đây..."
                    className="min-h-[260px] w-full flex-1 resize-none bg-transparent p-3 font-mono text-xs leading-[19.5px] text-[#334155] outline-none placeholder:text-[#94A3B8] placeholder:font-mono placeholder:italic"
                  />
                </div>
              </div>

              {/* Tùy biến dấu phân cách & Nút thao tác nhanh */}
              <div className="mt-3.5 flex flex-col gap-2.5 border-t border-[#F1F5F9] pt-3 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-[#475569]">
                  <span className="shrink-0 font-normal">Ký tự phân cách:</span>
                  <span className="relative min-w-0 max-w-[210px] flex-1">
                    <select
                      value={delimiter}
                      onChange={(event) => {
                        setDelimiter(event.target.value);
                        setManualColumnMap(null);
                      }}
                      className="h-8 w-full appearance-none truncate rounded-lg border border-[#E2E8F0] bg-white py-0 pl-2.5 pr-8 text-xs text-[#334155] outline-none focus:border-[#2563EB] cursor-pointer"
                    >
                      {DELIMITERS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94A3B8]" />
                  </span>
                </label>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={resetForm}
                    disabled={!rawText}
                    className="flex h-8 shrink-0 whitespace-nowrap items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white hover:bg-slate-50 px-3 text-xs font-normal text-[#475569] transition-colors disabled:opacity-40 cursor-pointer shadow-2xs"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Xóa trắng</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPreview((prev) => !prev)}
                    className={`flex h-8 shrink-0 whitespace-nowrap items-center gap-1.5 rounded-lg border px-3 text-xs font-normal transition-colors cursor-pointer shadow-2xs ${
                      showPreview
                        ? "border-[#CBD5E1] bg-slate-100 text-[#334155] hover:bg-slate-200"
                        : "border-[#BFDBFE] bg-[#EFF6FF] text-[#2563EB] hover:bg-blue-100/70"
                    }`}
                  >
                    {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    <span>{showPreview ? "Ẩn xem trước" : "Xem trước"}</span>
                  </button>
                </div>
              </div>
            </section>

            {/* Cột phải: Field Mapping */}
            <section className="flex min-h-[380px] flex-col justify-between rounded-xl border border-[#E2E8F0] bg-white p-4 sm:p-5 shadow-[0_1px_2px_0_rgba(0,0,0,0.04)]">
              <div>
                <div className="mb-3 flex items-center justify-between border-b border-[#F1F5F9] pb-2.5">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-[#1E293B]">
                    <ListFilter className="h-4 w-4 text-[#2563EB]" />
                    <span>Field Mapping</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setManualColumnMap(null);
                    }}
                    disabled={!lines.length}
                    className="flex h-7 shrink-0 whitespace-nowrap items-center gap-1 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-2.5 text-xs font-normal text-[#2563EB] hover:bg-blue-100/70 transition-colors disabled:opacity-40 cursor-pointer shadow-2xs"
                  >
                    <Sparkles className="h-3 w-3" />
                    <span>Tự nhận dạng</span>
                  </button>
                </div>

                <div className="max-h-[300px] space-y-1.5 overflow-y-auto pr-1">
                  {Array.from({ length: visibleColumnCount }, (_, index) => (
                    <div
                      key={index}
                      className="flex h-9 items-center gap-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2.5"
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#2563EB] text-[10px] font-bold text-white">
                        {index + 1}
                      </span>
                      <span className="min-w-[56px] flex-1 text-xs text-[#475569] font-medium">
                        Cột {index + 1}
                      </span>
                      <span className="relative w-[58%] min-w-0">
                        <select
                          value={columnMap[index] || "ignore"}
                          onChange={(event) => {
                            const next = [...columnMap];
                            next[index] = event.target.value;
                            setManualColumnMap(next);
                          }}
                          className="h-7 w-full appearance-none truncate rounded-md border border-[#E2E8F0] bg-white py-0 pl-2 pr-7 text-xs text-[#334155] outline-none focus:border-[#2563EB] cursor-pointer"
                        >
                          {FIELD_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94A3B8]" />
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {hasDuplicateMappings && (
                <p className="mt-2 text-xs text-red-600 font-medium">
                  Mỗi trường dữ liệu chỉ được gán cho một cột duy nhất.
                </p>
              )}
            </section>
          </div>

          {/* Phần xem trước Preview Table */}
          <section className="mt-4">
            <div className={`${showPreview ? "mb-2.5" : ""} flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs`}>
              <h3 className="flex items-center gap-2 font-bold text-slate-800">
                <Eye className="h-4 w-4 text-primary" />Xem trước cấu trúc 11 trường (3 dòng đầu)
              </h3>
              <div className="flex items-center gap-3">
                <span className="rounded-md border border-border bg-white px-2.5 py-1 font-semibold text-slate-700 shadow-subtle">
                  Nhận dạng: {parsedAccounts.length} tài khoản
                </span>
                {checkingDuplicates ? <span className="text-slate-400">{ "Đang kiểm tra UID..." }</span> : duplicateError ? <span className="text-red-600">{duplicateError}</span> : skipDuplicates ? (
                  <span className={skippedExistingCount > 0 ? "text-amber-600 font-medium" : "text-slate-400"}>
                    {skippedExistingCount > 0 ? `${skippedExistingCount} UID đã có sẽ bỏ qua` : "Không có UID trùng"}
                  </span>
                ) : (
                  <span className={existingOverlapCount > 0 ? "text-blue-600 font-medium" : "text-slate-400"}>
                    {existingOverlapCount > 0 ? `${existingOverlapCount} UID trùng sẽ ghi đè` : "Không có UID trùng"}
                  </span>
                )}
                <span
                  className={`flex items-center gap-1.5 font-medium ${
                    !lines.length
                      ? "text-slate-400"
                      : hasUidMapping && hasPasswordMapping && !hasDuplicateMappings
                      ? "text-emerald-600"
                      : "text-red-600"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      !lines.length
                        ? "bg-slate-300"
                        : hasUidMapping && hasPasswordMapping && !hasDuplicateMappings
                        ? "bg-emerald-500"
                        : "bg-red-500"
                    }`}
                  />
                  {!lines.length
                    ? "Chờ nhập dữ liệu"
                    : hasDuplicateMappings
                    ? "Trùng trường mapping"
                    : !hasUidMapping && !hasPasswordMapping
                    ? "Thiếu cột UID và Mật khẩu"
                    : !hasUidMapping
                    ? "Thiếu cột UID"
                    : !hasPasswordMapping
                    ? "Thiếu cột Mật khẩu"
                    : `Đã khớp ${mappedFieldCount}/${DEFAULT_MAPPING.length} trường`}
                </span>
              </div>
            </div>

            {showPreview && (
              <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-subtle [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:bg-[#4B8EFF]/60 hover:[&::-webkit-scrollbar-thumb]:bg-[#2563EB] [&::-webkit-scrollbar-thumb]:rounded-full">
                <table className="w-full min-w-[1180px] text-left border-collapse text-xs">
                  <thead className="h-9 border-b border-border bg-slate-50 font-bold uppercase text-[11px] text-slate-600">
                    <tr>
                      <th className="w-10 px-3 py-2 text-center bg-slate-50 sticky left-0 z-10 shadow-[1px_0_0_0_#E2E8F0]">#</th>
                      {previewColumns.map((col) => (
                        <th key={col.field} className="px-3 py-2 whitespace-nowrap">
                          {col.shortLabel}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {parsedAccounts.slice(0, 3).map((account, index) => (
                      <tr key={`${account.uid}-${index}`} className="h-10 hover:bg-slate-50/60">
                        <td className="px-3 py-2 text-center text-slate-400 font-mono bg-white sticky left-0 z-10 shadow-[1px_0_0_0_#E2E8F0]">
                          {index + 1}
                        </td>
                        {previewColumns.map((col) => {
                          const val = account[col.field];
                          const hasValue = val !== undefined && val !== null && String(val).trim() !== "";
                          const rawStr = hasValue ? String(val).trim() : "--";
                          const isUid = col.field === "uid";
                          const isPassword = col.field === "password" || col.field === "pass_mail";
                          const isHighlight = col.field === "two_fa" || col.field === "token";
                          const isProxy = col.field === "proxy";

                          let colorClass = hasValue ? "text-slate-700 font-mono" : "text-slate-400 font-mono text-center";
                          if (hasValue) {
                            if (isUid) colorClass = "font-bold text-primary font-mono";
                            else if (isPassword) colorClass = "text-amber-700 font-mono";
                            else if (isHighlight) colorClass = "text-sky-700 font-mono";
                            else if (isProxy) colorClass = "text-emerald-700 font-mono";
                          }

                          return (
                            <td
                              key={col.field}
                              title={hasValue ? rawStr : "Trường này chưa có dữ liệu"}
                              className={`truncate px-3 py-2 whitespace-nowrap max-w-[180px] ${colorClass}`}
                            >
                              {hasValue ? truncateValue(rawStr, 20) : "--"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {!parsedAccounts.length && (
                      <tr>
                        <td colSpan={previewColumns.length + 1} className="py-8 text-center text-slate-400">
                          Dán dữ liệu tài khoản để xem trước cấu trúc 11 trường
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Tuỳ chọn Checkbox */}
          <div className="mt-4 flex flex-col gap-2.5 rounded-xl border border-border bg-white px-4 py-3 text-xs text-slate-700 shadow-subtle lg:flex-row lg:items-center lg:justify-between">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={skipDuplicates}
                onChange={(event) => handleToggleSkipDuplicates(event.target.checked)}
                className="h-4 w-4 rounded accent-primary cursor-pointer"
              />
              <span className="font-medium">Tự động bỏ qua UID trùng lặp trong hệ thống</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={checkAfterImport}
                onChange={(event) => setCheckAfterImport(event.target.checked)}
                className="h-4 w-4 rounded accent-primary cursor-pointer"
              />
              <span className="font-medium">Đánh dấu kiểm tra Live/Die sau khi import</span>
            </label>
            <span className="flex items-center gap-1.5 text-emerald-700 font-semibold text-xs">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />Mã hóa AES-256 an toàn
            </span>
          </div>
        </div>

        {/* Footer */}
        <footer className="flex shrink-0 flex-col gap-3 border-t border-border bg-white px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <Info className="h-4 w-4 text-primary" />Hệ thống hỗ trợ tối đa 100 tài khoản cho mỗi lần nhập
          </p>
          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={handleClose}
              disabled={isImporting}
              className="h-9 px-4 rounded-md border border-border bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition cursor-pointer disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={isImporting || !rawText.trim()}
              className="flex h-9 min-w-[140px] items-center justify-center gap-1.5 rounded-md bg-primary hover:bg-primary-hover px-4 text-xs font-semibold text-white shadow-sm transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 active:scale-95"
            >
              {isImporting ? (
                <>
                  <CircleCheck className="h-4 w-4 animate-spin" />
                  <span>Đang import...</span>
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  <span>Import {accountsToImport.length > 0 ? `(${accountsToImport.length})` : ""}</span>
                </>
              )}
            </button>
          </div>
        </footer>
      </div>

      <ConfirmDialog
        isOpen={showOverwriteConfirm}
        onClose={() => setShowOverwriteConfirm(false)}
        onConfirm={() => {
          setSkipDuplicates(false);
          setShowOverwriteConfirm(false);
          toast.warning(
            "Đã tắt bỏ qua trùng lặp: Nếu có UID trùng trong danh sách, thông tin cũ sẽ bị ghi đè!",
            "CHẾ ĐỘ GHI ĐÈ"
          );
        }}
        title="Xác nhận ghi đè thông tin tài khoản cũ"
        description="Khi bỏ chọn tính năng này, nếu danh sách có UID đã tồn tại trong hệ thống thì toàn bộ thông tin cũ (Mật khẩu, Cookie, 2FA, Token, Proxy...) sẽ bị GHI ĐÈ bằng thông tin mới. Bạn có chắc chắn muốn cho phép ghi đè không?"
        confirmText="Đồng ý ghi đè"
        cancelText="Hủy bỏ (Giữ bỏ qua)"
        variant="warning"
      />
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalContent, document.body) : null;
}
