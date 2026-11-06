"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  X,
  Image as ImageIcon,
  Upload,
  Sparkles,
  Trash2,
  Loader2,
  Check,
  AlertCircle,
  Plus,
  RefreshCw,
} from "lucide-react";
import { API_BASE } from "@/config/constants";
import { api } from "@/services/api";

export const MAX_STATUS_IMAGES = 3;

/** Chuẩn hóa danh sách path ảnh từ card / API (tối đa 3). */
export function normalizeImagePaths(cardOrPaths) {
  if (!cardOrPaths) return [];
  let raw = cardOrPaths;
  if (!Array.isArray(raw) && typeof raw === "object") {
    raw = cardOrPaths.imagePaths ?? cardOrPaths.image_paths ?? null;
    if (!raw && (cardOrPaths.imagePath || cardOrPaths.image_path)) {
      raw = [cardOrPaths.imagePath || cardOrPaths.image_path];
    }
  }
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      raw = Array.isArray(parsed) ? parsed : [text];
    } catch {
      raw = [text];
    }
  }
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const p = String(item || "").trim();
    if (p && !out.includes(p)) out.push(p);
    if (out.length >= MAX_STATUS_IMAGES) break;
  }
  return out;
}

export function mediaFileUrl(path, version = 0) {
  if (!path) return null;
  return `${API_BASE}/api/post/media/file?path=${encodeURIComponent(path)}&t=${version}`;
}

export function PostImageModal({
  isOpen,
  card,
  onClose,
  onUpdateImages,
  /** @deprecated dùng onUpdateImages */
  onUpdateImage,
  pixabayKey,
  apiKeySource,
}) {
  const initialKw = card?.content
    ? card.content.slice(0, 40).replace(/#\S+/g, "").replace(/\n/g, " ").trim()
    : "vietnam travel";

  const [paths, setPaths] = useState(() => normalizeImagePaths(card));
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlKeyword, setCrawlKeyword] = useState(initialKw);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [imageLoadError, setImageLoadError] = useState(false);
  const [version, setVersion] = useState(Date.now());
  const [replaceIndex, setReplaceIndex] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!isOpen || !card) return;
    const next = normalizeImagePaths(card);
    setPaths(next);
    setSelectedIndex(0);
    setImageLoadError(false);
    setErrorMsg("");
    setSuccessMsg("");
    setCrawlKeyword(initialKw);
    setVersion(Date.now());
    setReplaceIndex(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync khi mở modal / đổi card
  }, [isOpen, card?.draftId, card?.account?.uid, card?.imagePath, JSON.stringify(card?.imagePaths || [])]);

  const count = paths.length;
  const selectedPath = paths[selectedIndex] || null;
  const canAddMore = count < MAX_STATUS_IMAGES;
  const imagePreviewUrl = mediaFileUrl(selectedPath, version);
  const statusLabel = count ? `Đã có ảnh (${count}/${MAX_STATUS_IMAGES})` : "Chưa có ảnh";

  if (!isOpen || !card) return null;

  const notifyParent = (nextPaths) => {
    const list = normalizeImagePaths(nextPaths);
    if (typeof onUpdateImages === "function") {
      onUpdateImages(list);
    } else if (typeof onUpdateImage === "function") {
      onUpdateImage(list[0] || null);
    }
  };

  const persistPaths = async (nextPaths) => {
    const list = normalizeImagePaths(nextPaths);
    if (!(card.draftId || card.account?.uid)) {
      notifyParent(list);
      return list;
    }
    await api.post("/api/post/drafts", {
      id: card.draftId,
      account_uid: String(card.account?.uid || ""),
      account_name: card.authorName || "",
      post_type: "status",
      content: card.content || "",
      image_path: list[0] || null,
      image_paths: list,
      clear_image: list.length === 0,
      status: "READY",
    });
    notifyParent(list);
    return list;
  };

  const uploadOneFile = async (file) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await api.post("/api/post/media/upload", formData, {
      // false = bỏ header; để browser gắn boundary multipart
      headers: { "Content-Type": false },
      transformRequest: [
        (data, headers) => {
          if (typeof FormData !== "undefined" && data instanceof FormData) {
            if (headers && typeof headers.set === "function") headers.set("Content-Type", false);
            else if (headers) {
              delete headers["Content-Type"];
              delete headers["content-type"];
            }
          }
          return data;
        },
      ],
    });
    const uploadedPath = res?.data?.image_path || res?.image_path;
    if (!uploadedPath) {
      throw new Error(`Không nhận được đường dẫn cho file ${file.name}`);
    }
    return uploadedPath;
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    try {
      setIsUploading(true);
      setErrorMsg("");
      setSuccessMsg("");

      let next = [...paths];
      const replacing = replaceIndex != null && replaceIndex >= 0 && replaceIndex < next.length;

      if (replacing) {
        const uploadedPath = await uploadOneFile(files[0]);
        next[replaceIndex] = uploadedPath;
        setSelectedIndex(replaceIndex);
        setSuccessMsg("Đã đổi ảnh thành công!");
      } else {
        const slots = MAX_STATUS_IMAGES - next.length;
        if (slots <= 0) {
          throw new Error(`Chỉ được đính kèm tối đa ${MAX_STATUS_IMAGES} ảnh.`);
        }
        const toUpload = files.slice(0, slots);
        const uploaded = [];
        for (const file of toUpload) {
          uploaded.push(await uploadOneFile(file));
        }
        next = normalizeImagePaths([...next, ...uploaded]);
        setSelectedIndex(Math.max(0, next.length - uploaded.length));
        setSuccessMsg(
          uploaded.length > 1
            ? `Đã tải lên ${uploaded.length} ảnh (${next.length}/${MAX_STATUS_IMAGES}).`
            : `Đã tải lên và lưu ảnh (${next.length}/${MAX_STATUS_IMAGES}).`
        );
        if (files.length > slots) {
          setErrorMsg(`Chỉ thêm được ${slots} ảnh nữa (tối đa ${MAX_STATUS_IMAGES}).`);
        }
      }

      await persistPaths(next);
      setPaths(next);
      setImageLoadError(false);
      setVersion(Date.now());
    } catch (err) {
      console.error("Lỗi tải ảnh lên:", err);
      setErrorMsg(err.message || "Tải ảnh thất bại. Vui lòng thử lại!");
    } finally {
      setIsUploading(false);
      setReplaceIndex(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const openFilePicker = (mode = "add", index = null) => {
    if (mode === "add" && !canAddMore) {
      setErrorMsg(`Đã đủ ${MAX_STATUS_IMAGES} ảnh. Xóa bớt hoặc đổi ảnh hiện có.`);
      return;
    }
    setReplaceIndex(mode === "replace" ? index : null);
    fileInputRef.current?.click();
  };

  const hasPixabayKey = Boolean(String(pixabayKey || "").trim());

  const handleCrawlImage = async () => {
    const kw = crawlKeyword.trim();
    if (!kw) {
      setErrorMsg("Vui lòng nhập từ khóa tìm ảnh!");
      return;
    }
    if (!hasPixabayKey) {
      setErrorMsg("Cần nhập Pixabay API Key ở Bước 1 trước khi cào ảnh.");
      return;
    }
    if (!canAddMore) {
      setErrorMsg(`Đã đủ ${MAX_STATUS_IMAGES} ảnh. Xóa bớt trước khi cào thêm.`);
      return;
    }

    try {
      setIsCrawling(true);
      setErrorMsg("");
      setSuccessMsg("");

      const res = await api.post("/api/post/media/crawl", {
        query: kw,
        pixabay_key: pixabayKey.trim(),
        api_key_source: apiKeySource || undefined,
        // Không để crawl tự ghi đè 1 ảnh — FE lưu list đầy đủ sau
        draft_id: undefined,
        account_uid: String(card.account?.uid || ""),
      });

      const payload = res?.data ?? res;
      const crawledPath = payload?.image_path || payload?.data?.image_path;
      const optimizedKw = payload?.optimized_keyword || payload?.data?.optimized_keyword;
      if (!crawledPath) {
        setErrorMsg("Pixabay không trả về ảnh. Thử từ khóa khác hoặc kiểm tra API Key.");
        return;
      }

      const next = normalizeImagePaths([...paths, crawledPath]);
      await persistPaths(next);
      setPaths(next);
      setSelectedIndex(next.length - 1);
      setImageLoadError(false);
      setVersion(Date.now());
      const kwLabel = optimizedKw && optimizedKw !== kw ? `${kw} → ${optimizedKw}` : (optimizedKw || kw);
      setSuccessMsg(`Đã cào 1 ảnh Pixabay (${kwLabel}) · ${next.length}/${MAX_STATUS_IMAGES}.`);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      const msg =
        (typeof detail === "string" && detail) ||
        err?.message ||
        "Không thể cào ảnh. Vui lòng thử từ khóa khác.";
      setErrorMsg(msg);
    } finally {
      setIsCrawling(false);
    }
  };

  const handleRemoveSelected = async () => {
    if (!selectedPath) return;
    if (!confirm("Gỡ ảnh đang chọn khỏi bài viết?")) return;

    try {
      setErrorMsg("");
      setSuccessMsg("");
      const next = paths.filter((_, i) => i !== selectedIndex);
      await persistPaths(next);
      setPaths(next);
      setSelectedIndex(Math.max(0, Math.min(selectedIndex, next.length - 1)));
      setImageLoadError(false);
      setVersion(Date.now());
      setSuccessMsg(next.length ? `Đã gỡ ảnh. Còn ${next.length}/${MAX_STATUS_IMAGES}.` : "Đã gỡ hết ảnh.");
    } catch (err) {
      console.error("Lỗi gỡ ảnh:", err);
      setErrorMsg("Lỗi khi gỡ ảnh: " + (err.message || "Vui lòng thử lại"));
    }
  };

  const handleRemoveAt = async (index) => {
    if (index < 0 || index >= paths.length) return;
    if (!confirm("Gỡ ảnh này khỏi bài viết?")) return;
    try {
      setErrorMsg("");
      const next = paths.filter((_, i) => i !== index);
      await persistPaths(next);
      setPaths(next);
      setSelectedIndex(Math.max(0, Math.min(index > selectedIndex ? selectedIndex : index - 1, next.length - 1)));
      setImageLoadError(false);
      setVersion(Date.now());
      setSuccessMsg(next.length ? `Đã gỡ ảnh. Còn ${next.length}/${MAX_STATUS_IMAGES}.` : "Đã gỡ hết ảnh.");
    } catch (err) {
      setErrorMsg("Lỗi khi gỡ ảnh: " + (err.message || "Vui lòng thử lại"));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 max-w-lg w-full flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100">
              <ImageIcon size={16} />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs font-bold text-slate-800 truncate">
                Ảnh bài viết — {card.authorName}
              </h3>
              <p className="text-[11px] text-slate-400 truncate">
                UID: {card.account?.uid || "Chưa xác định"} • Trạng thái:{" "}
                <span className={count ? "text-emerald-600 font-medium" : "text-slate-500"}>
                  {statusLabel}
                </span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        {errorMsg && (
          <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
            <AlertCircle size={14} className="shrink-0" />
            <span className="flex-1">{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2">
            <Check size={14} className="shrink-0" />
            <span className="flex-1">{successMsg}</span>
          </div>
        )}

        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept="image/jpeg,image/png,image/webp,image/jpg"
            multiple={replaceIndex == null}
            className="hidden"
          />

          {count > 0 ? (
            <div className="space-y-3">
              {/* Preview lớn */}
              <div className="relative rounded-xl border border-slate-200 bg-slate-900/5 p-2 flex items-center justify-center overflow-hidden min-h-[140px]">
                {imageLoadError || !selectedPath ? (
                  <div className="py-6 px-4 flex flex-col items-center justify-center text-center space-y-2">
                    <div className="w-10 h-10 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center border border-rose-100">
                      <AlertCircle size={20} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-rose-700">Không thể hiển thị ảnh xem trước</p>
                      <p className="text-[11px] text-slate-500 mt-0.5 max-w-sm">
                        Đổi ảnh đang chọn hoặc cào ảnh AI mới.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      key={imagePreviewUrl}
                      src={imagePreviewUrl}
                      alt={`Ảnh ${selectedIndex + 1}`}
                      className="max-h-64 w-full object-contain rounded-lg shadow-2xs"
                      onError={() => {
                        setImageLoadError(true);
                        setErrorMsg("Ảnh không thể tải xem trước (file bị hỏng hoặc sai định dạng).");
                      }}
                    />
                    <div className="absolute top-3 left-3 bg-emerald-600/90 text-white text-[10px] font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-xs backdrop-blur-xs">
                      <Check size={11} />
                      <span>
                        Ảnh {selectedIndex + 1}/{count}
                      </span>
                    </div>
                  </>
                )}
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span className="truncate pr-2 font-mono text-[10px]" title={selectedPath || ""}>
                  {selectedPath ? `📁 ${selectedPath}` : "—"}
                </span>
                <span
                  className={
                    imageLoadError
                      ? "text-rose-500 font-semibold shrink-0"
                      : "text-emerald-600 font-semibold shrink-0"
                  }
                >
                  {imageLoadError ? "Cần đổi ảnh" : "Sẵn sàng đăng"}
                </span>
              </div>

              {/* Thumbnail strip */}
              <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
                {paths.map((p, idx) => {
                  const thumbUrl = mediaFileUrl(p, version);
                  const active = idx === selectedIndex;
                  return (
                    <div key={`${p}-${idx}`} className="relative group shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedIndex(idx);
                          setImageLoadError(false);
                          setErrorMsg("");
                        }}
                        className={`w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors cursor-pointer ${
                          active
                            ? "border-blue-500 ring-2 ring-blue-100"
                            : "border-slate-200 hover:border-slate-300"
                        }`}
                        title={`Ảnh ${idx + 1}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
                      </button>
                      <div className="absolute inset-0 rounded-lg bg-slate-900/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 pointer-events-none group-hover:pointer-events-auto">
                        <button
                          type="button"
                          title="Đổi ảnh này"
                          disabled={isUploading || isCrawling}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            openFilePicker("replace", idx);
                          }}
                          className="w-6 h-6 rounded-md bg-white text-slate-700 flex items-center justify-center cursor-pointer hover:bg-blue-50 hover:text-blue-600"
                        >
                          <RefreshCw size={12} />
                        </button>
                        <button
                          type="button"
                          title="Xóa ảnh này"
                          disabled={isUploading || isCrawling}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            handleRemoveAt(idx);
                          }}
                          className="w-6 h-6 rounded-md bg-white text-rose-600 flex items-center justify-center cursor-pointer hover:bg-rose-50"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {canAddMore && (
                  <button
                    type="button"
                    onClick={() => openFilePicker("add")}
                    disabled={isUploading || isCrawling}
                    className="w-16 h-16 rounded-lg border-2 border-dashed border-slate-200 text-slate-400 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50/50 flex flex-col items-center justify-center gap-0.5 shrink-0 cursor-pointer disabled:opacity-50 transition-colors"
                    title="Thêm ảnh"
                  >
                    <Plus size={16} />
                    <span className="text-[9px] font-semibold">Thêm</span>
                  </button>
                )}
              </div>

              {/* Toolbar */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => openFilePicker("add")}
                  disabled={isUploading || isCrawling || !canAddMore}
                  className="flex-1 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
                >
                  {isUploading ? (
                    <Loader2 size={13} className="animate-spin text-blue-600" />
                  ) : (
                    <Upload size={13} />
                  )}
                  <span>{canAddMore ? "Thêm ảnh từ máy" : "Đã đủ 3 ảnh"}</span>
                </button>

                <button
                  type="button"
                  onClick={handleCrawlImage}
                  disabled={isUploading || isCrawling || !canAddMore || !hasPixabayKey}
                  className="px-3 py-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
                  title={
                    !hasPixabayKey
                      ? "Cần Pixabay API Key ở Bước 1"
                      : "Gemini tối ưu từ khóa → cào 1 ảnh Pixabay"
                  }
                >
                  {isCrawling ? (
                    <Loader2 size={13} className="animate-spin text-indigo-600" />
                  ) : (
                    <Sparkles size={13} />
                  )}
                  <span>Cào AI</span>
                </button>

                <button
                  type="button"
                  onClick={handleRemoveSelected}
                  disabled={isUploading || isCrawling || !selectedPath}
                  className="px-3 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
                  title="Xóa ảnh đang chọn"
                >
                  <Trash2 size={13} />
                  <span>Xóa</span>
                </button>
              </div>

              {/* Cào theo từ khóa */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={crawlKeyword}
                  onChange={(e) => setCrawlKeyword(e.target.value)}
                  placeholder="Từ khóa cào ảnh..."
                  className="flex-1 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:bg-white focus:outline-none focus:border-blue-400"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCrawlImage();
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="border border-dashed border-slate-200 rounded-xl p-5 text-center bg-slate-50/50 space-y-2">
                <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                  <ImageIcon size={18} />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-700">Chưa có ảnh đính kèm</p>
                  <p className="text-[11px] text-slate-400 mt-0.5 max-w-sm mx-auto">
                    Có thể đính kèm tối đa <strong>{MAX_STATUS_IMAGES} ảnh</strong>. Ảnh là tùy chọn
                    (không bắt buộc).
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-2">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Upload size={13} className="text-blue-600" />
                  <span>Cách 1: Tải ảnh từ máy (có thể chọn nhiều)</span>
                </span>
                <button
                  type="button"
                  onClick={() => openFilePicker("add")}
                  disabled={isUploading}
                  className="w-full py-2 px-3 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-xs flex items-center justify-center gap-1.5 border border-blue-200 cursor-pointer transition-colors"
                >
                  {isUploading ? (
                    <>
                      <Loader2 size={13} className="animate-spin text-blue-600" />
                      <span>Đang tải ảnh lên...</span>
                    </>
                  ) : (
                    <>
                      <Upload size={13} />
                      <span>Chọn file ảnh (.jpg, .png, .webp)</span>
                    </>
                  )}
                </button>
              </div>

              <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Sparkles size={13} className="text-amber-500" />
                    <span>Cách 2: Cào ảnh theo từ khóa</span>
                  </span>
                  <span className="text-[10px] text-slate-400 shrink-0">Gemini tối ưu → Pixabay</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={crawlKeyword}
                    onChange={(e) => setCrawlKeyword(e.target.value)}
                    placeholder="Nhập nội dung / từ khóa (Gemini sẽ tối ưu để tìm trên Pixabay)..."
                    className="flex-1 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:bg-white focus:outline-none focus:border-blue-400"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCrawlImage();
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleCrawlImage}
                    disabled={isCrawling || !crawlKeyword.trim() || !hasPixabayKey}
                    title={
                      !hasPixabayKey
                        ? "Cần nhập Pixabay API Key ở Bước 1"
                        : "Gemini tối ưu từ khóa rồi cào 1 ảnh trên Pixabay"
                    }
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-40 transition-colors shrink-0"
                  >
                    {isCrawling ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                    <span>{isCrawling ? "Đang cào..." : "Cào ảnh"}</span>
                  </button>
                </div>
                {!hasPixabayKey && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                    Cần nhập <strong>Pixabay API Key</strong> ở Bước 1 mới dùng được Cào ảnh.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold text-xs transition-colors cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
