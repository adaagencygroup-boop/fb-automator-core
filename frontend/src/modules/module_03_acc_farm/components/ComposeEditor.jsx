"use client";

import React, { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Sparkles, Square, Trash2, X, AlertTriangle, CheckCircle2 } from "lucide-react";
import { api } from "@/services/api";
import { toast } from "@/lib/toast";
import { Checkbox } from "@/components/ui/checkbox";
import { AuthedPostImage } from "./PostImageModal";
import {
  CONTENT_MULTI,
  CONTENT_SINGLE,
  IMAGE_MULTI,
  IMAGE_NONE,
  IMAGE_SINGLE,
  MAX_POST_CHARS,
} from "../composeText";

const MAX_GENERATE = 200;

async function uploadImage(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await api.post("/api/post/media/upload", formData, {
    headers: { "Content-Type": false },
    transformRequest: [
      (data, headers) => {
        if (headers && typeof headers.set === "function") headers.set("Content-Type", false);
        else if (headers) {
          delete headers["Content-Type"];
          delete headers["content-type"];
        }
        return data;
      },
    ],
  });
  const path = res?.data?.image_path || res?.image_path;
  if (!path) throw new Error(`Không nhận được đường dẫn cho file ${file.name}`);
  return path;
}

function Segmented({ value, options, onChange, disabled }) {
  return (
    <div className="inline-flex rounded-lg border border-[#E2E8F0] bg-slate-50 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
            value === opt.value ? "bg-white text-[#2563EB] shadow-xs" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function NumberSelect({ value, onChange, disabled, label }) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-8 rounded-lg border border-[#E2E8F0] bg-white px-2 text-xs font-semibold text-slate-700 focus:border-[#2563EB] focus:outline-none disabled:opacity-60"
    >
      {[1, 2, 3].map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}

/**
 * Ô soạn bài chung: các bài cách nhau bằng dòng "---", kho ảnh chung và AI tạo bài thêm vào cuối ô.
 */
export function ComposeEditor({
  compose,
  parsed,
  onChange,
  onClearAll,
  saveState,
  locked = false,
  lockedReason = "",
  ai,
}) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(0);
  const [aiCount, setAiCount] = useState(ai?.suggestedCount || 1);
  const [aiCountTouched, setAiCountTouched] = useState(false);
  const [withImages, setWithImages] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!aiCountTouched) setAiCount(Math.max(1, Math.min(MAX_GENERATE, ai?.suggestedCount || 1)));
  }, [ai?.suggestedCount, aiCountTouched]);

  const editingLocked = locked || ai?.generating;
  const images = compose.image_paths || [];
  const isMulti = compose.content_mode === CONTENT_MULTI;
  const job = ai?.job;

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setUploading(files.length);
    const added = [];
    for (const file of files) {
      try {
        added.push(await uploadImage(file));
      } catch (err) {
        toast.error(err?.message || `Không tải lên được ${file.name}`, "TẢI ẢNH");
      } finally {
        setUploading((n) => Math.max(0, n - 1));
      }
    }
    if (added.length) {
      onChange((prev) => ({
        image_paths: [...new Set([...(prev.image_paths || []), ...added])],
        image_mode: prev.image_mode === IMAGE_NONE ? (added.length > 1 ? IMAGE_MULTI : IMAGE_SINGLE) : prev.image_mode,
      }));
    }
  };

  const removeImage = (path) => onChange((prev) => ({ image_paths: (prev.image_paths || []).filter((p) => p !== path) }));

  const handleGenerate = () => {
    const n = Math.max(1, Math.min(MAX_GENERATE, parseInt(aiCount, 10) || 1));
    ai?.onGenerate?.(n, withImages);
  };

  const saveLabel =
    saveState === "saving" ? "Đang lưu nháp..." : saveState === "saved" ? "Đã tự lưu nháp" : saveState === "error" ? "Chưa lưu được nháp, sẽ thử lại" : "";

  return (
    <div className="space-y-5">
      {/* Chế độ nội dung + bộ đếm */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            value={compose.content_mode}
            disabled={editingLocked}
            onChange={(v) => onChange({ content_mode: v })}
            options={[
              { value: CONTENT_SINGLE, label: "1 nội dung" },
              { value: CONTENT_MULTI, label: "Nhiều nội dung" },
            ]}
          />
          <span className={`text-xs font-semibold ${parsed.count ? "text-[#2563EB]" : "text-slate-400"}`}>
            {parsed.summary}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {saveLabel && (
            <span className={`text-[11px] font-medium ${saveState === "error" ? "text-amber-600" : "text-slate-400"}`}>{saveLabel}</span>
          )}
          {confirmClear ? (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold">
              <span className="text-slate-600">Xoá hết bài và ảnh?</span>
              <button
                type="button"
                onClick={() => {
                  setConfirmClear(false);
                  onClearAll?.();
                }}
                className="rounded-md bg-red-600 px-2 py-1 text-white hover:bg-red-700"
              >
                Xoá
              </button>
              <button type="button" onClick={() => setConfirmClear(false)} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">
                Huỷ
              </button>
            </span>
          ) : (
            <button
              type="button"
              disabled={editingLocked || (!compose.content_text && images.length === 0)}
              onClick={() => setConfirmClear(true)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 size={13} />
              Xoá tất cả
            </button>
          )}
        </div>
      </div>

      {/* Ô soạn */}
      <div className="space-y-1.5">
        <textarea
          value={compose.content_text}
          readOnly={editingLocked}
          onChange={(e) => onChange({ content_text: e.target.value })}
          rows={14}
          placeholder={
            isMulti
              ? "Nhập từng bài, mỗi bài cách nhau bằng 1 dòng chỉ có ---\n\nVí dụ:\nChào buổi sáng cả nhà ☀️\n---\nCuối tuần này đi đâu chơi nhỉ?\n---\nCà phê sáng nay ngon quá ☕"
              : "Nhập 1 nội dung, tất cả nick sẽ đăng cùng nội dung này."
          }
          className={`w-full min-h-[280px] resize-y rounded-xl border p-4 font-mono text-xs leading-relaxed text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:ring-1 sm:text-sm ${
            editingLocked
              ? "cursor-not-allowed border-[#E2E8F0] bg-slate-50 text-slate-600"
              : "border-[#E2E8F0] bg-white focus:border-[#2563EB] focus:ring-[#2563EB]"
          }`}
        />
        {editingLocked && lockedReason && <p className="text-[11px] font-medium text-slate-500">{lockedReason}</p>}
        {parsed.tooLong.length > 0 && (
          <p className="text-[11px] font-medium text-red-500">
            Bài số {parsed.tooLong.join(", ")} dài quá {MAX_POST_CHARS.toLocaleString("vi-VN")} ký tự (giới hạn của Facebook).
          </p>
        )}
      </div>

      {/* AI tạo bài */}
      {ai && (
        <div className="rounded-xl border border-[#DBEAFE] bg-[#F8FAFF] p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-[#0F172A]">
            <Sparkles size={15} className="text-[#2563EB]" />
            AI tạo bài thêm vào cuối ô
          </div>
          {ai.disabledReason ? (
            <p className="text-[11px] font-medium text-slate-500">{ai.disabledReason}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                Số bài
                <input
                  type="text"
                  inputMode="numeric"
                  value={aiCount}
                  disabled={ai.generating}
                  onChange={(e) => {
                    setAiCountTouched(true);
                    setAiCount(e.target.value.replace(/\D/g, "").slice(0, 3));
                  }}
                  onBlur={() => setAiCount((v) => Math.max(1, Math.min(MAX_GENERATE, parseInt(v, 10) || 1)))}
                  className="h-8 w-16 rounded-lg border border-[#E2E8F0] bg-white text-center font-mono text-xs focus:border-[#2563EB] focus:outline-none disabled:opacity-60"
                />
              </label>
              {aiCountTouched && ai.suggestedCount > 0 && Number(aiCount) !== ai.suggestedCount && (
                <button
                  type="button"
                  onClick={() => {
                    setAiCountTouched(false);
                    setAiCount(ai.suggestedCount);
                  }}
                  className="text-[11px] font-semibold text-[#2563EB] hover:underline"
                >
                  Dùng gợi ý {ai.suggestedCount} (số nick × số khung)
                </button>
              )}
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
                <Checkbox checked={withImages} disabled={ai.generating} onCheckedChange={(v) => setWithImages(!!v)} />
                Kèm ảnh (vào kho ảnh)
              </label>
              {ai.generating ? (
                <button
                  type="button"
                  onClick={ai.onCancel}
                  className="ml-auto flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50"
                >
                  <Square size={12} className="fill-red-600" />
                  Huỷ
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={locked}
                  className="ml-auto flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Sparkles size={13} />
                  AI tạo bài
                </button>
              )}
            </div>
          )}
          {job && (job.status === "RUNNING" || job.processed > 0) && (
            <div className="space-y-1.5">
              <div className="h-1.5 overflow-hidden rounded-full bg-blue-100">
                <div
                  className="h-full rounded-full bg-[#2563EB] transition-all"
                  style={{ width: `${Math.round((100 * (job.processed || 0)) / Math.max(1, job.total))}%` }}
                />
              </div>
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
                {job.status === "RUNNING" && <Loader2 size={12} className="animate-spin text-[#2563EB]" />}
                {job.status === "RUNNING"
                  ? `Đang tạo ${job.processed}/${job.total} bài (đã thêm ${job.done}${job.failed ? `, lỗi ${job.failed}` : ""}). Ô soạn tạm khoá đến khi xong.`
                  : job.message}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Kho ảnh chung */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-bold text-[#0F172A] sm:text-sm">Kho ảnh chung</span>
          <Segmented
            value={compose.image_mode}
            disabled={editingLocked}
            onChange={(v) => onChange({ image_mode: v })}
            options={[
              { value: IMAGE_NONE, label: "Không ảnh" },
              { value: IMAGE_SINGLE, label: "1 ảnh" },
              { value: IMAGE_MULTI, label: "Nhiều ảnh" },
            ]}
          />
          {compose.image_mode === IMAGE_MULTI && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              Mỗi bài từ
              <NumberSelect
                label="Số ảnh tối thiểu mỗi bài"
                value={compose.min_images}
                disabled={editingLocked}
                onChange={(n) => onChange({ min_images: n, max_images: Math.max(n, compose.max_images) })}
              />
              đến
              <NumberSelect
                label="Số ảnh tối đa mỗi bài"
                value={compose.max_images}
                disabled={editingLocked}
                onChange={(n) => onChange({ max_images: n, min_images: Math.min(n, compose.min_images) })}
              />
              ảnh
            </span>
          )}
        </div>

        {compose.image_mode !== IMAGE_NONE && (
          <p className="text-[11px] text-slate-500">
            {compose.image_mode === IMAGE_SINGLE
              ? "Mọi nick dùng chung ảnh đầu tiên trong kho."
              : "Mỗi nick nhận ảnh khác nhau trong kho (trong cùng lượt không nick nào trùng ảnh)."}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          {images.map((path, idx) => (
            <div
              key={path}
              className={`group relative h-20 w-20 overflow-hidden rounded-lg border bg-slate-50 ${
                compose.image_mode === IMAGE_SINGLE && idx === 0 ? "border-[#2563EB] ring-1 ring-[#2563EB]" : "border-[#E2E8F0]"
              } ${compose.image_mode === IMAGE_NONE ? "opacity-40" : ""}`}
            >
              <AuthedPostImage path={path} alt={`Ảnh ${idx + 1}`} className="h-full w-full object-cover" />
              {!editingLocked && (
                <button
                  type="button"
                  onClick={() => removeImage(path)}
                  className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white group-hover:flex"
                  aria-label="Bỏ ảnh khỏi kho"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            disabled={editingLocked || uploading > 0}
            onClick={() => fileRef.current?.click()}
            className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-[#CBD5E1] text-[11px] font-semibold text-slate-500 hover:border-[#2563EB] hover:text-[#2563EB] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading > 0 ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
            {uploading > 0 ? `Còn ${uploading}` : "Thêm ảnh"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
        </div>
        {images.length > 0 && <p className="text-[11px] text-slate-400">{images.length} ảnh trong kho</p>}
      </div>
    </div>
  );
}

/** Lỗi (chặn) và cảnh báo từ /api/post/compose/check. */
export function PlanCheckNotice({ check, loading }) {
  if (!check && !loading) return null;
  const errors = check?.errors || [];
  const warnings = check?.warnings || [];
  if (!errors.length && !warnings.length) {
    return loading ? null : (
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600">
        <CheckCircle2 size={13} /> Kho bài và ảnh đủ cho số nick đã chọn.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {errors.map((msg) => (
        <p key={`e-${msg}`} className="flex items-start gap-1.5 text-[11px] font-medium text-red-600">
          <AlertTriangle size={13} className="mt-px shrink-0" /> {msg}
        </p>
      ))}
      {warnings.map((msg) => (
        <p key={`w-${msg}`} className="flex items-start gap-1.5 text-[11px] font-medium text-amber-600">
          <AlertTriangle size={13} className="mt-px shrink-0" /> {msg}
        </p>
      ))}
    </div>
  );
}
