"use client";

import React, { useState, useRef } from "react";
import {
  X,
  Image as ImageIcon,
  Upload,
  Sparkles,
  Trash2,
  ExternalLink,
  Loader2,
  Check,
  AlertCircle
} from "lucide-react";
import { API_BASE } from "@/config/constants";
import { api } from "@/services/api";

export function PostImageModal({
  isOpen,
  card,
  onClose,
  onUpdateImage,
  pixabayKey
}) {
  const initialKw = card?.content
    ? card.content.slice(0, 40).replace(/#\S+/g, "").replace(/\n/g, " ").trim()
    : "vietnam travel";

  const [isUploading, setIsUploading] = useState(false);
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlKeyword, setCrawlKeyword] = useState(initialKw);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [imageLoadError, setImageLoadError] = useState(false);
  const [version, setVersion] = useState(Date.now());
  const fileInputRef = useRef(null);

  if (!isOpen || !card) return null;

  const currentImagePath = card.imagePath || null;

  // 1. Tải ảnh từ máy tính (Upload)
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      setErrorMsg("");
      setSuccessMsg("");

      const formData = new FormData();
      formData.append("file", file);

      const res = await api.post("/api/post/media/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const uploadedPath = res?.data?.image_path || res?.image_path;
      if (!uploadedPath) {
        throw new Error("Không nhận được đường dẫn ảnh sau khi tải lên");
      }

      // Lưu cập nhật vào CSDL nếu bài nháp đã có
      if (card.draftId || card.account?.uid) {
        await api.post("/api/post/drafts", {
          id: card.draftId,
          account_uid: String(card.account?.uid || ""),
          account_name: card.authorName || "",
          post_type: "status",
          content: card.content || "",
          image_path: uploadedPath,
          status: "READY",
        });
      }

      onUpdateImage(uploadedPath);
      setImageLoadError(false);
      setVersion(Date.now());
      setSuccessMsg("Đã tải lên và lưu ảnh bài viết thành công!");
    } catch (err) {
      console.error("Lỗi tải ảnh lên:", err);
      setErrorMsg(err.message || "Tải ảnh thất bại. Vui lòng thử lại!");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // 2. Cào / Tìm ảnh từ Internet theo từ khóa (AI / Pixabay / Wikimedia)
  const handleCrawlImage = async () => {
    const kw = crawlKeyword.trim();
    if (!kw) {
      setErrorMsg("Vui lòng nhập từ khóa tìm ảnh!");
      return;
    }

    try {
      setIsCrawling(true);
      setErrorMsg("");
      setSuccessMsg("");

      const res = await api.post("/api/post/media/crawl", {
        query: kw,
        pixabay_key: pixabayKey || undefined,
        draft_id: card.draftId,
        account_uid: String(card.account?.uid || ""),
      });

      const crawledPath = res?.data?.image_path || res?.image_path;
      if (!crawledPath) {
        throw new Error("Không tìm thấy ảnh phù hợp với từ khóa này.");
      }

      // Cập nhật CSDL
      if (card.draftId || card.account?.uid) {
        await api.post("/api/post/drafts", {
          id: card.draftId,
          account_uid: String(card.account?.uid || ""),
          account_name: card.authorName || "",
          post_type: "status",
          content: card.content || "",
          image_path: crawledPath,
          status: "READY",
        });
      }

      onUpdateImage(crawledPath);
      setImageLoadError(false);
      setVersion(Date.now());
      setSuccessMsg(`Đã cào và lưu ảnh cho chủ đề '${kw}'!`);
    } catch (err) {
      console.error("Lỗi cào ảnh:", err);
      setErrorMsg(err.response?.data?.detail || err.message || "Không thể cào ảnh. Vui lòng thử từ khóa khác.");
    } finally {
      setIsCrawling(false);
    }
  };

  // 3. Xóa ảnh đính kèm
  const handleRemoveImage = async () => {
    if (!confirm("Bạn có chắc chắn muốn gỡ bỏ ảnh đính kèm của bài viết này?")) return;

    try {
      setErrorMsg("");
      setSuccessMsg("");

      if (card.draftId || card.account?.uid) {
        await api.post("/api/post/drafts", {
          id: card.draftId,
          account_uid: String(card.account?.uid || ""),
          account_name: card.authorName || "",
          post_type: "status",
          content: card.content || "",
          image_path: null,
          clear_image: true,
          status: "READY",
        });
      }

      onUpdateImage(null);
      setImageLoadError(false);
      setSuccessMsg("Đã gỡ ảnh thành công.");
    } catch (err) {
      console.error("Lỗi gỡ ảnh:", err);
      setErrorMsg("Lỗi khi gỡ ảnh: " + (err.message || "Vui lòng thử lại"));
    }
  };

  const imagePreviewUrl = currentImagePath
    ? `${API_BASE}/api/post/media/file?path=${encodeURIComponent(currentImagePath)}&t=${version}`
    : null;

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
                <span className={currentImagePath ? "text-emerald-600 font-medium" : "text-slate-500"}>
                  {currentImagePath ? "Đã có ảnh (1/3)" : "Chưa có ảnh (0/3)"}
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

        {/* Thông báo Alert */}
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

        {/* Body Content */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Hidden File Input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept="image/jpeg,image/png,image/webp,image/jpg"
            className="hidden"
          />

          {currentImagePath ? (
            /* Có ảnh: Hiển thị Preview To Rõ */
            <div className="space-y-3">
              <div className="relative rounded-xl border border-slate-200 bg-slate-900/5 p-2 flex items-center justify-center overflow-hidden group min-h-[140px]">
                {imageLoadError ? (
                  <div className="py-6 px-4 flex flex-col items-center justify-center text-center space-y-2">
                    <div className="w-10 h-10 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center border border-rose-100">
                      <AlertCircle size={20} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-rose-700">Không thể hiển thị ảnh xem trước</p>
                      <p className="text-[11px] text-slate-500 mt-0.5 max-w-sm">
                        File trên hệ thống có thể bị hỏng hoặc sai định dạng. Vui lòng bấm <strong>Cào lại ảnh AI</strong> hoặc <strong>Đổi ảnh từ máy</strong> để thay thế ảnh mới chuẩn đẹp.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      key={imagePreviewUrl}
                      src={imagePreviewUrl}
                      alt="Ảnh bài viết"
                      className="max-h-64 w-full object-contain rounded-lg shadow-2xs"
                      onError={() => {
                        setImageLoadError(true);
                        setErrorMsg("Ảnh không thể tải xem trước (file bị hỏng hoặc sai định dạng).");
                      }}
                    />
                    <div className="absolute top-3 left-3 bg-emerald-600/90 text-white text-[10px] font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-xs backdrop-blur-xs">
                      <Check size={11} />
                      <span>Đã lưu cùng bài viết</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => window.open(imagePreviewUrl, "_blank")}
                      className="absolute top-3 right-3 bg-black/60 hover:bg-black/80 text-white p-1.5 rounded-lg text-xs shadow-xs transition-colors cursor-pointer"
                      title="Mở xem ảnh gốc trong tab mới"
                    >
                      <ExternalLink size={13} />
                    </button>
                  </>
                )}
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span className="truncate pr-2 font-mono text-[10px]" title={currentImagePath}>
                  📁 {currentImagePath}
                </span>
                <span className={imageLoadError ? "text-rose-500 font-semibold shrink-0" : "text-emerald-600 font-semibold shrink-0"}>
                  {imageLoadError ? "Cần đổi ảnh" : "Sẵn sàng đăng"}
                </span>
              </div>

              {/* Action Toolbar */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading || isCrawling}
                  className="flex-1 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
                >
                  {isUploading ? <Loader2 size={13} className="animate-spin text-blue-600" /> : <Upload size={13} />}
                  <span>Đổi ảnh từ máy</span>
                </button>

                <button
                  type="button"
                  onClick={handleCrawlImage}
                  disabled={isUploading || isCrawling}
                  className="px-3 py-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
                  title="Tự động cào lại ảnh mới từ Internet"
                >
                  {isCrawling ? <Loader2 size={13} className="animate-spin text-indigo-600" /> : <Sparkles size={13} />}
                  <span>Cào lại ảnh AI</span>
                </button>

                <button
                  type="button"
                  onClick={handleRemoveImage}
                  disabled={isUploading || isCrawling}
                  className="px-3 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
                  title="Xóa ảnh khỏi bài viết"
                >
                  <Trash2 size={13} />
                  <span>Xóa ảnh</span>
                </button>
              </div>

              {/* Tùy chỉnh từ khóa cào ảnh */}
              <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
                <input
                  type="text"
                  value={crawlKeyword}
                  onChange={(e) => setCrawlKeyword(e.target.value)}
                  placeholder="Từ khóa cào ảnh (VD: du lịch việt nam)..."
                  className="flex-1 text-[11px] text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:bg-white focus:outline-none focus:border-indigo-400"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCrawlImage();
                  }}
                />
                <button
                  type="button"
                  onClick={handleCrawlImage}
                  disabled={isCrawling}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50 transition-colors shrink-0"
                >
                  <Sparkles size={12} className="text-amber-500" />
                  <span>Tìm ảnh</span>
                </button>
              </div>
            </div>
          ) : (
            /* Chưa có ảnh: Hiển thị Hướng Dẫn & Tùy Chọn Thêm Ảnh */
            <div className="space-y-4">
              <div className="border border-dashed border-slate-200 rounded-xl p-5 text-center bg-slate-50/50 space-y-2">
                <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                  <ImageIcon size={18} />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-700">Chưa có ảnh đính kèm</p>
                  <p className="text-[11px] text-slate-400 mt-0.5 max-w-sm mx-auto">
                    Ảnh bài viết là <strong>tùy chọn linh hoạt (không bắt buộc)</strong>. Gemini AI có thể tự động cào hoặc lấy ảnh tùy thuộc vào prompt của bạn.
                  </p>
                </div>
              </div>

              {/* Tùy chọn 1: Tải ảnh từ máy tính */}
              <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Upload size={13} className="text-blue-600" />
                    <span>Cách 1: Tải ảnh từ máy tính</span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
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

              {/* Tùy chọn 2: Cào ảnh từ Internet theo chủ đề */}
              <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Sparkles size={13} className="text-amber-500" />
                    <span>Cách 2: Cào ảnh tự động theo bài viết</span>
                  </span>
                  <span className="text-[10px] text-slate-400">Pixabay / Wikimedia</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={crawlKeyword}
                    onChange={(e) => setCrawlKeyword(e.target.value)}
                    placeholder="Nhập từ khóa tìm ảnh (ví dụ: coffee shop, mùa thu hà nội)..."
                    className="flex-1 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:bg-white focus:outline-none focus:border-blue-400"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCrawlImage();
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleCrawlImage}
                    disabled={isCrawling || !crawlKeyword.trim()}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-40 transition-colors shrink-0"
                  >
                    {isCrawling ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                    <span>{isCrawling ? "Đang cào..." : "Cào ảnh"}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
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
