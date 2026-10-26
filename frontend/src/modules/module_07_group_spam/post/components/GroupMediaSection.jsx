"use client";

import React, { useRef } from "react";
import {
  Check,
  Edit3,
  ImageIcon,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";
import { SectionCard, Field } from "../../shared/components";

export default function GroupMediaSection({
  mediaFiles,
  setMediaFiles,
  minMedia,
  setMinMedia,
  maxMedia,
  setMaxMedia,
  isLocked = false,
  setIsLocked,
  onContinue,
  stepNumber = "5",
}) {
  const mediaInputRef = useRef(null);

  const handleFiles = (fileList) => {
    if (isLocked) return;
    const incoming = Array.from(fileList || []);
    setMediaFiles((prev) => {
      const merged = [...prev, ...incoming].slice(0, 10);
      return merged;
    });
  };

  const handleRemoveMedia = (indexToRemove) => {
    if (isLocked) return;
    setMediaFiles((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleClearAllMedia = () => {
    if (isLocked) return;
    setMediaFiles([]);
    if (mediaInputRef.current) {
      mediaInputRef.current.value = "";
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes && bytes !== 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleSave = () => {
    const totalMedia = mediaFiles.length;
    const minVal = parseInt(minMedia, 10) || 0;
    const maxVal = parseInt(maxMedia, 10) || 0;

    if (totalMedia > 0) {
      if (maxVal > totalMedia) {
        toast.error(
          `Số lượng media tối đa mỗi bài (${maxVal}) không được lớn hơn tổng số media đã chọn (${totalMedia}). Vui lòng điều chỉnh lại!`,
          "LỖI CẤU HÌNH MEDIA"
        );
        return;
      }
      if (minVal > totalMedia) {
        toast.error(
          `Số lượng media tối thiểu mỗi bài (${minVal}) không được lớn hơn tổng số media đã chọn (${totalMedia}). Vui lòng điều chỉnh lại!`,
          "LỖI CẤU HÌNH MEDIA"
        );
        return;
      }
      if (minVal > maxVal) {
        toast.error(
          `Số lượng media tối thiểu (${minVal}) không được lớn hơn số lượng tối đa (${maxVal}). Vui lòng điều chỉnh lại!`,
          "LỖI CẤU HÌNH MEDIA"
        );
        return;
      }
      if (maxVal < 1) {
        toast.error(
          "Số lượng media tối đa mỗi bài phải từ 1 trở lên khi có chọn media.",
          "LỖI CẤU HÌNH MEDIA"
        );
        return;
      }
      toast.success(
        `Đã lưu cấu hình: Mỗi bài viết sẽ chọn ngẫu nhiên từ ${minVal} đến ${maxVal} tệp trong tổng số ${totalMedia} tệp đã tải lên.`,
        "LƯU MEDIA THÀNH CÔNG"
      );
    } else {
      toast.info("Đã lưu cấu hình: Không sử dụng media (bài viết dạng văn bản thuần).", "CẤU HÌNH MEDIA");
    }

    setIsLocked?.(true);
    onContinue?.();
  };

  const handleEdit = () => {
    setIsLocked?.(false);
  };

  return (
    <SectionCard
      number={stepNumber}
      title="Chọn media (ảnh/video)"
      aside={isLocked ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/60 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
          <Check className="size-3 text-emerald-600" />
          Đã lưu cấu hình
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/60 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
          <Edit3 className="size-3 text-amber-600" />
          Đang thiết lập
        </span>
      )}
    >
      <div className="mb-4 flex h-9 items-center justify-center rounded-md bg-primary text-xs font-semibold text-white">
        <ImageIcon className="mr-2 size-4" /> Hình ảnh + Video
      </div>
      <input
        ref={mediaInputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        className="hidden"
        onChange={(event) => handleFiles(event.target.files)}
      />
      {mediaFiles.length === 0 && !isLocked && (
        <button
          type="button"
          onClick={() => mediaInputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            handleFiles(event.dataTransfer.files);
          }}
          className="flex min-h-40 w-full flex-col items-center justify-center rounded-lg border border-dashed border-blue-200 bg-slate-50/60 text-center transition-colors hover:bg-blue-50/40"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-blue-100 text-primary">
            <Plus className="size-5" />
          </span>
          <span className="mt-3 text-xs font-bold text-slate-700">
            Nhấp để tải ảnh lên hoặc kéo thả
          </span>
          <span className="mt-1 text-[10px] text-slate-400">Hỗ trợ JPG, PNG (tối đa 10 ảnh)</span>
        </button>
      )}

      {mediaFiles.length === 0 && isLocked && (
        <div className="flex min-h-20 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-500">
          Không sử dụng media
        </div>
      )}

      {mediaFiles.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">
              Tệp đã chọn ({mediaFiles.length}/10):
            </span>
            {!isLocked && (
              <button
                type="button"
                onClick={handleClearAllMedia}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-500 transition-colors hover:text-rose-700 hover:underline"
              >
                <Trash2 className="size-3" />
                Xoá tất cả
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
            {!isLocked && mediaFiles.length < 10 && (
              <button
                type="button"
                onClick={() => mediaInputRef.current?.click()}
                className="group flex aspect-square min-h-28 flex-col items-center justify-center rounded-lg border border-dashed border-blue-200 bg-slate-50/60 text-primary transition-colors hover:border-primary hover:bg-blue-50/50"
                title="Thêm media"
                aria-label="Thêm media"
              >
                <span className="flex size-10 items-center justify-center rounded-full bg-blue-100 transition-transform group-hover:scale-105">
                  <Plus className="size-5" />
                </span>
                <span className="mt-2 text-[10px] font-semibold">Thêm media</span>
              </button>
            )}

            {mediaFiles.map((file, idx) => {
              const isVideo = file.type?.startsWith("video/") || /\.(mp4|mov|avi|mkv)$/i.test(file.name || "");
              const previewUrl = file instanceof File ? URL.createObjectURL(file) : null;

              return (
                <div
                  key={`${file.name}-${idx}`}
                  className="group relative flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5 shadow-xs transition-all hover:border-blue-300 hover:shadow-sm"
                >
                  <div className="relative aspect-square w-full overflow-hidden rounded-md bg-slate-100">
                    {isVideo && previewUrl ? (
                      <div className="relative h-full w-full bg-black">
                        <video
                          src={previewUrl}
                          muted
                          playsInline
                          controls
                          className="h-full w-full object-cover"
                          preload="metadata"
                        />
                      </div>
                    ) : previewUrl ? (
                      <img
                        src={previewUrl}
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
                          handleRemoveMedia(idx);
                        }}
                        className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-rose-500/90 text-white opacity-90 shadow-sm transition-transform hover:scale-110 hover:bg-rose-600 sm:opacity-0 sm:group-hover:opacity-100"
                        title="Xoá tệp này"
                      >
                        <X className="size-3" />
                      </button>
                    )}

                    <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[8px] font-medium text-white backdrop-blur-xs">
                      #{idx + 1}
                    </span>
                  </div>

                  <div className="mt-1.5 px-0.5">
                    <p className="truncate text-[10px] font-medium text-slate-700" title={file.name}>
                      {file.name}
                    </p>
                    <p className="text-[9px] text-slate-400">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Tối thiểu media mỗi bài">
          <Input
            type="number"
            min="0"
            max={mediaFiles.length || undefined}
            value={minMedia}
            onChange={(event) => setMinMedia(event.target.value)}
            disabled={isLocked}
          />
        </Field>
        <Field label="Tối đa media mỗi bài">
          <Input
            type="number"
            min="0"
            max={mediaFiles.length || undefined}
            value={maxMedia}
            onChange={(event) => setMaxMedia(event.target.value)}
            disabled={isLocked}
          />
        </Field>
      </div>

      {mediaFiles.length > 0 && (
        <div className="mt-2.5">
          {Number(maxMedia) > mediaFiles.length ? (
            <p className="text-[11px] font-medium text-rose-600">
              ⚠️ Số lượng tối đa ({maxMedia}) đang lớn hơn tổng số tệp đã tải lên ({mediaFiles.length}). Vui lòng giảm số tối đa hoặc tải thêm tệp.
            </p>
          ) : Number(minMedia) > Number(maxMedia) ? (
            <p className="text-[11px] font-medium text-rose-600">
              ⚠️ Số lượng tối thiểu ({minMedia}) không được lớn hơn số lượng tối đa ({maxMedia}).
            </p>
          ) : (
            <p className="text-[11px] text-slate-500">
              💡 Hệ thống sẽ <strong>chọn ngẫu nhiên từ {minMedia || 0} đến {maxMedia || 0} tệp</strong> trong tổng số {mediaFiles.length} tệp đã chọn cho mỗi bài đăng vào nhóm.
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
        {isLocked ? (
          <Button type="button" variant="outline" size="sm" onClick={handleEdit}>
            <Edit3 className="mr-1.5 size-3.5" />
            Chỉnh sửa
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={handleSave}>
            <Check className="mr-1.5 size-3.5" />
            Lưu cấu hình
          </Button>
        )}
      </div>
    </SectionCard>
  );
}
