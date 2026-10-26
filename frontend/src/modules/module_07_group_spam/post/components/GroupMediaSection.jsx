"use client";

import React, { useRef } from "react";
import {
  ImageIcon,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { SectionCard, Field } from "../../shared/components";

export default function GroupMediaSection({
  mediaFiles,
  setMediaFiles,
  minMedia,
  setMinMedia,
  maxMedia,
  setMaxMedia,
  stepNumber = "5",
}) {
  const mediaInputRef = useRef(null);

  const handleFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    setMediaFiles((prev) => {
      const merged = [...prev, ...incoming].slice(0, 10);
      return merged;
    });
  };

  const handleRemoveMedia = (indexToRemove) => {
    setMediaFiles((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleClearAllMedia = () => {
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

  return (
    <SectionCard number={stepNumber} title="Chọn media (ảnh/video)">
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
          {mediaFiles.length ? `Đã chọn ${mediaFiles.length} tệp media` : "Nhấp để tải ảnh lên hoặc kéo thả"}
        </span>
        <span className="mt-1 text-[10px] text-slate-400">Hỗ trợ JPG, PNG (tối đa 10 ảnh)</span>
      </button>

      {mediaFiles.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">
              Tệp đã chọn ({mediaFiles.length}/10):
            </span>
            <button
              type="button"
              onClick={handleClearAllMedia}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-500 transition-colors hover:text-rose-700 hover:underline"
            >
              <Trash2 className="size-3" />
              Xoá tất cả
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
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
          <Input type="number" min="0" value={minMedia} onChange={(event) => setMinMedia(event.target.value)} />
        </Field>
        <Field label="Tối đa media mỗi bài">
          <Input type="number" min="0" value={maxMedia} onChange={(event) => setMaxMedia(event.target.value)} />
        </Field>
      </div>
    </SectionCard>
  );
}
