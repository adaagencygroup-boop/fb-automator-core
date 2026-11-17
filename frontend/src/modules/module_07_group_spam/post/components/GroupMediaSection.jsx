"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ImageIcon,
  Plus,
  Trash2,
  X,
  Cloud,
  Info,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";
import { SectionCard, Field } from "../../shared/components";

function LocalMediaPreviewItem({ file, index, onRemove, isLocked }) {
  const [objectUrl, setObjectUrl] = useState("");

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const isVideo = file.type?.startsWith("video/") || /\.(mp4|mov|avi|mkv)$/i.test(file.name);
  const sizeMb = (file.size / (1024 * 1024)).toFixed(1);

  return (
    <div className="group relative flex aspect-square min-h-28 flex-col overflow-hidden rounded-lg border border-blue-200 bg-blue-50/20 p-1.5 shadow-xs transition-all hover:border-blue-400 hover:shadow-sm">
      <div className="relative min-h-0 w-full flex-1 overflow-hidden rounded-md bg-slate-100">
        {isVideo ? (
          <video
            src={objectUrl}
            muted
            playsInline
            controls
            className="h-full w-full object-cover"
            preload="metadata"
          />
        ) : objectUrl ? (
          <img
            src={objectUrl}
            alt={file.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-400">
            <ImageIcon className="size-6" />
          </div>
        )}

        {!isLocked && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(index);
            }}
            className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-rose-500/90 text-white opacity-90 shadow-sm transition-transform hover:scale-110 hover:bg-rose-600 sm:opacity-0 sm:group-hover:opacity-100"
            title="Xoá ảnh này"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      <div className="mt-1.5 px-0.5">
        <p className="truncate text-xs font-medium text-slate-700" title={file.name}>
          {file.name}
        </p>
      </div>
    </div>
  );
}

function CloudMediaPreviewItem({ item, index, onRemove, isLocked }) {
  const itemUrl = typeof item === "string" ? item : (item.url || item.path || "");
  const itemName =
    (typeof item === "string"
      ? item.split("/").pop().split("?")[0]
      : item.name) || `Ảnh Cloud ${index + 1}`;
  const isVideo = /\.(mp4|mov|avi|mkv)$/i.test(itemName);

  return (
    <div className="group relative flex aspect-square min-h-28 flex-col overflow-hidden rounded-lg border border-emerald-200 bg-emerald-50/30 p-1.5 shadow-xs transition-all hover:border-emerald-400 hover:shadow-sm">
      <div className="relative min-h-0 w-full flex-1 overflow-hidden rounded-md bg-slate-100">
        {isVideo ? (
          <video
            src={itemUrl}
            muted
            playsInline
            controls
            className="h-full w-full object-cover"
            preload="metadata"
          />
        ) : itemUrl ? (
          <img
            src={itemUrl}
            alt={itemName}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-400">
            <ImageIcon className="size-6" />
          </div>
        )}

        {!isLocked && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(index);
            }}
            className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-rose-500/90 text-white opacity-90 shadow-sm transition-transform hover:scale-110 hover:bg-rose-600 sm:opacity-0 sm:group-hover:opacity-100"
            title="Xoá ảnh này"
          >
            <X className="size-3" />
          </button>
        )}

        <span className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded bg-emerald-700/85 px-1 py-0.5 text-[8px] font-medium text-white backdrop-blur-xs">
          <Cloud className="size-2.5" /> Supabase #{index + 1}
        </span>
      </div>

      <div className="mt-1.5 px-0.5">
        <p className="truncate text-[10px] font-medium text-slate-700" title={itemName}>
          {itemName}
        </p>
        <p className="text-[9px] text-emerald-600">Đã lưu trữ Cloud</p>
      </div>
    </div>
  );
}

export default function GroupMediaSection({
  mediaFiles = [],
  setMediaFiles,
  savedMedia = [],
  setSavedMedia,
  minMedia = "1",
  setMinMedia,
  maxMedia = "4",
  setMaxMedia,
  isLocked = false,
  stepNumber = "5",
  campaignId = null,
  onCampaignIdGenerated,
  isComment = false,
}) {
  const mediaInputRef = useRef(null);

  const totalCount = (savedMedia?.length || 0) + (mediaFiles?.length || 0);
  const actionLabel = isComment ? "bình luận" : "đăng bài";

  const handleFiles = (fileList) => {
    if (isLocked) return;
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;

    const remainingSlots = Math.max(0, 10 - totalCount);
    const toAdd = incoming.slice(0, remainingSlots);
    if (!toAdd.length) {
      toast.warning("Đã đạt giới hạn tối đa 10 tệp media", "GIỚI HẠN MEDIA");
      return;
    }

    if (!campaignId && onCampaignIdGenerated) {
      const activeCampaignId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `camp-${Date.now()}`;
      onCampaignIdGenerated(activeCampaignId);
    }

    const newTotal = totalCount + toAdd.length;

    // Tự động gán minMedia và maxMedia mặc định hợp lý khi bắt đầu chọn ảnh
    if (setMinMedia && (!minMedia || Number(minMedia) < 1)) {
      setMinMedia("1");
    }
    if (setMaxMedia && (!maxMedia || Number(maxMedia) < 1)) {
      setMaxMedia(String(Math.min(newTotal, 4)));
    }

    if (setMediaFiles) {
      setMediaFiles((prev) => [...prev, ...toAdd]);
    }

    if (mediaInputRef.current) {
      mediaInputRef.current.value = "";
    }
  };

  const handleRemoveMediaFile = (indexToRemove) => {
    if (isLocked || !setMediaFiles) return;
    setMediaFiles((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleRemoveSavedMedia = (indexToRemove) => {
    if (isLocked || !setSavedMedia) return;
    setSavedMedia((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleClearAllMedia = () => {
    if (isLocked) return;
    if (setMediaFiles) setMediaFiles([]);
    if (setSavedMedia) setSavedMedia([]);
    if (mediaInputRef.current) {
      mediaInputRef.current.value = "";
    }
  };

  return (
    <SectionCard
      number={stepNumber}
      title="Chọn media (ảnh/video)"
    >
      <div className="mb-4 flex h-9 items-center justify-center rounded-md bg-primary text-sm font-semibold text-white">
        <ImageIcon size={18} className="mr-2" /> Hình ảnh hoặc Video
      </div>
      <input
        ref={mediaInputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        className="hidden"
        disabled={isLocked}
        onChange={(event) => handleFiles(event.target.files)}
      />

      {/* Khu vực kéo thả / chọn file */}
      {totalCount === 0 && (
        <button
          type="button"
          onClick={() => mediaInputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            handleFiles(event.dataTransfer.files);
          }}
          disabled={isLocked || totalCount >= 10}
          className={`flex h-[360px] w-full flex-col items-center justify-center rounded-lg border border-dashed transition-colors text-center disabled:cursor-not-allowed disabled:opacity-60`}
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-blue-100 text-primary">
            <Plus size={16} />
          </span>
          <span className="mt-2 text-sm font-bold text-slate-700">
            {totalCount === 0 ? "Nhấp để tải ảnh/video lên hoặc kéo thả (Tuỳ chọn)" : "Nhấp để chọn thêm ảnh/video"}
          </span>
          <span className="mt-1 text-sm text-slate-400">
            Hỗ trợ JPG, PNG, MP4 (tối đa 10 tệp) — Nếu không chọn ảnh, hệ thống sẽ tự động {actionLabel} thuần văn bản
          </span>
        </button>
      )}


      {/* Danh sách ảnh đã chọn */}
      {totalCount > 0 && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">
              Tệp media đã chọn ({totalCount}/10):
            </span>
            {!isLocked && (
              <button
                type="button"
                onClick={handleClearAllMedia}
                className="inline-flex items-center gap-1 text-sm font-medium text-rose-500 transition-colors hover:text-rose-700 hover:underline disabled:opacity-50"
              >
                <Trash2 size={16} />
                Xoá tất cả
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
            {!isLocked && totalCount < 10 && (
              <button
                type="button"
                onClick={() => mediaInputRef.current?.click()}
                className="group flex aspect-square min-h-28 flex-col items-center justify-center rounded-lg border border-dashed border-blue-200 bg-slate-50/60 text-primary transition-colors hover:border-primary hover:bg-blue-50/50 disabled:cursor-not-allowed disabled:opacity-50"
                title="Thêm media"
                aria-label="Thêm media"
              >
                <span className="flex size-10 items-center justify-center rounded-full bg-blue-100 transition-transform group-hover:scale-105">
                  <Plus size={20} />
                </span>
                <span className="mt-2 text-sm font-semibold">Thêm ảnh</span>
              </button>
            )}

            {/* 1. Render ảnh từ Supabase Cloud (chạy lại) */}
            {savedMedia.map((item, idx) => (
              <CloudMediaPreviewItem
                key={`saved-${idx}-${typeof item === "string" ? item : item.name}`}
                item={item}
                index={idx}
                onRemove={handleRemoveSavedMedia}
                isLocked={isLocked}
              />
            ))}

            {/* 2. Render ảnh mới từ máy tính (chờ lưu sau khi chạy) */}
            {mediaFiles.map((file, idx) => (
              <LocalMediaPreviewItem
                key={`file-${idx}-${file.name}-${file.size}`}
                file={file}
                index={idx}
                onRemove={handleRemoveMediaFile}
                isLocked={isLocked}
              />
            ))}
          </div>

          {/* CHỈ HIỆN KHI CÓ MEDIA: Tối thiểu và Tối đa media mỗi bài / bình luận */}
          <div className="mt-4 grid gap-4 border-t border-slate-100 pt-3 sm:grid-cols-2">
            <Field label={`Tối thiểu media mỗi ${actionLabel}`}>
              <Input
                type="number"
                min="1"
                max={totalCount || undefined}
                value={minMedia}
                onChange={(event) => setMinMedia?.(event.target.value)}
                disabled={isLocked}
              />
            </Field>
            <Field label={`Tối đa media mỗi ${actionLabel}`}>
              <Input
                type="number"
                min={minMedia || "1"}
                max={totalCount || undefined}
                value={maxMedia}
                onChange={(event) => setMaxMedia?.(event.target.value)}
                disabled={isLocked}
              />
            </Field>
          </div>

          <div className="mt-2">
            {Number(maxMedia) > totalCount ? (
              <p className="text-[11px] font-medium text-rose-600">
                ⚠️ Số lượng tối đa ({maxMedia}) đang lớn hơn tổng số tệp đã có ({totalCount}). Vui lòng giảm số tối đa hoặc thêm tệp.
              </p>
            ) : Number(minMedia) > Number(maxMedia) ? (
              <p className="text-sm font-medium text-rose-600">
                ⚠️ Số lượng tối thiểu ({minMedia}) không được lớn hơn số lượng tối đa ({maxMedia}).
              </p>
            ) : (
              <p className="text-sm text-slate-500">
                💡 Hệ thống sẽ <strong>chọn ngẫu nhiên từ {minMedia || 1} đến {maxMedia || 1} tệp</strong> trong tổng số {totalCount} tệp cho mỗi lượt {actionLabel} vào nhóm. Ảnh sẽ được tự động lưu lên Supabase Storage sau khi chạy hoàn thành.
              </p>
            )}
          </div>
        </div>
      )}

    </SectionCard>
  );
}
