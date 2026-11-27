"use client";

import React, { useMemo, useRef, useState } from "react";
import {
  ImagePlus,
  Loader2,
  Trash2,
  X,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Smile,
  Image as ImageIcon,
  Users,
  Search,
  ArrowRightLeft,
} from "lucide-react";
import { api } from "@/services/api";
import { toast } from "@/lib/toast";
import { AuthedPostImage } from "./PostImageModal";
import { FacebookEmojiMenu } from "./FacebookEmojiModal";
import {
  CONTENT_MULTI,
  IMAGE_MULTI,
  IMAGE_NONE,
  IMAGE_SINGLE,
  LAYOUT_ACCOUNTS,
  LAYOUT_TEXT,
  MAX_ACCOUNT_POST_IMAGES,
  MAX_POST_CHARS,
  accountEntry,
  accountPostsToText,
  parseComposeText,
  textToAccountPosts,
} from "../composeText";

const CARDS_PER_PAGE = 9;

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

async function uploadFiles(files) {
  const added = [];
  for (const file of files) {
    try {
      added.push(await uploadImage(file));
    } catch (err) {
      toast.error(err?.message || `Không tải lên được ${file.name}`, "TẢI ẢNH");
    }
  }
  return added;
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

function Thumb({ path, alt, onRemove }) {
  return (
    <div className="group relative h-14 w-14 overflow-hidden rounded-lg border border-[#E2E8F0] bg-slate-50">
      <AuthedPostImage path={path} alt={alt} className="h-full w-full object-cover" />
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-0.5 top-0.5 hidden h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white group-hover:flex"
          aria-label="Bỏ ảnh"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

const footerBtn =
  "flex h-[30px] min-w-0 cursor-pointer items-center justify-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-1.5 text-[11px] font-semibold text-[#565E74] transition-colors disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Thẻ bài của 1 nick (giống Khu vực Xem trước cũ): tên nick, nút emoji, ô nội dung cho mỗi khung giờ,
 * số ký tự và Ảnh / Tạo lại / Xoá. Mọi thay đổi tự lưu vào nháp.
 */
function AccountCard({
  account, entries, rowLabels, locked, onChangeEntry, onRegenerate, regenerateState, onRemove, onCrawlImage, crawlDisabledReason,
}) {
  const [imagesOpen, setImagesOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [uploadingRow, setUploadingRow] = useState(-1);
  const [crawlingRow, setCrawlingRow] = useState(-1);
  const textareas = useRef([]);
  const lastFocused = useRef(0);
  const fileRef = useRef(null);
  const uploadRowRef = useRef(0);
  const imageCount = entries.reduce((n, e) => n + e.images.length, 0);
  const filled = entries.filter((e) => e.content.trim()).length;
  const name = account.name || account.uid;

  const insertEmoji = (emoji) => {
    const row = Math.min(lastFocused.current, entries.length - 1);
    const el = textareas.current[row];
    const text = entries[row].content;
    const start = el ? el.selectionStart : text.length;
    const end = el ? el.selectionEnd : text.length;
    onChangeEntry(row, { content: text.slice(0, start) + emoji + text.slice(end) });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  // Cào 1 ảnh Pixabay hợp với nội dung bài ở ô `row`
  const crawlFor = async (row) => {
    const text = entries[row].content.trim();
    if (!text) {
      toast.warning("Nhập hoặc tạo nội dung bài trước, ảnh sẽ được cào theo nội dung đó.", "CÀO ẢNH");
      return;
    }
    setCrawlingRow(row);
    try {
      const path = await onCrawlImage(text);
      const merged = [...new Set([...entries[row].images, path])].slice(0, MAX_ACCOUNT_POST_IMAGES);
      onChangeEntry(row, { images: merged });
    } catch (err) {
      toast.error(err?.message || "Không cào được ảnh.", "CÀO ẢNH");
    } finally {
      setCrawlingRow(-1);
    }
  };

  const pickImages = (row) => {
    uploadRowRef.current = row;
    fileRef.current?.click();
  };

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    const row = uploadRowRef.current;
    setUploadingRow(row);
    const added = await uploadFiles(files);
    setUploadingRow(-1);
    if (!added.length) return;
    const merged = [...new Set([...entries[row].images, ...added])];
    if (merged.length > MAX_ACCOUNT_POST_IMAGES) {
      toast.warning(`Mỗi bài tối đa ${MAX_ACCOUNT_POST_IMAGES} ảnh, đã bỏ bớt ảnh thừa.`, "ẢNH");
    }
    onChangeEntry(row, { images: merged.slice(0, MAX_ACCOUNT_POST_IMAGES) });
  };

  return (
    <div
      className={`relative flex min-w-0 flex-col justify-between rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 transition-all hover:shadow-xs sm:p-5 ${
        emojiOpen ? "z-30 shadow-md ring-1 ring-blue-300" : "z-10"
      }`}
    >
      <div>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${filled === entries.length ? "bg-[#10B981]" : "bg-amber-400"}`}
              title={filled === entries.length ? "Đã đủ bài" : "Còn ô trống"}
            />
            <span className="truncate text-sm font-bold text-[#0F172A] sm:text-base" title={name}>
              {name}
            </span>
          </div>
          <div className="relative shrink-0">
            <button
              type="button"
              disabled={locked}
              onClick={() => setEmojiOpen((v) => !v)}
              className={`flex items-center justify-center rounded-lg p-1.5 transition-colors disabled:opacity-40 ${
                emojiOpen ? "bg-amber-100 text-amber-600 ring-1 ring-amber-300" : "text-[#64748B] hover:bg-slate-200/60 hover:text-amber-500"
              }`}
              title="Chèn biểu tượng cảm xúc vào ô đang gõ"
            >
              <Smile size={18} />
            </button>
            {emojiOpen && (
              <FacebookEmojiMenu
                isOpen
                onClose={() => setEmojiOpen(false)}
                onSelectEmoji={insertEmoji}
                targetTitle={name}
                align="right"
              />
            )}
          </div>
        </div>

        <div className="mt-3 space-y-3">
          {entries.map((entry, i) => (
            <div key={i} className="space-y-1.5">
              {rowLabels[i] && <div className="text-[11px] font-bold text-[#2563EB]">Khung {rowLabels[i]}</div>}
              <textarea
                ref={(el) => {
                  textareas.current[i] = el;
                }}
                rows={rowLabels.length > 1 ? 4 : 6}
                value={entry.content}
                readOnly={locked}
                onFocus={() => {
                  lastFocused.current = i;
                }}
                onChange={(e) => onChangeEntry(i, { content: e.target.value })}
                placeholder={`Nhập nội dung bài đăng cho ${name}${rowLabels[i] ? ` (khung ${rowLabels[i]})` : ""}...`}
                className={`w-full resize-y rounded-xl border p-3.5 font-sans text-xs leading-relaxed text-[#0F172A] transition-all focus:outline-none sm:text-[13px] [scrollbar-width:thin] ${
                  rowLabels.length > 1 ? "min-h-[100px]" : "min-h-[145px]"
                } ${
                  locked
                    ? "cursor-not-allowed border-[#E2E8F0] bg-slate-50 text-slate-600"
                    : "border-[#E2E8F0] bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
                }`}
              />
              <div className="flex items-center justify-between text-xs text-[#64748B]">
                <span>{entry.content.length.toLocaleString("vi-VN")} ký tự</span>
                {entry.content.length > MAX_POST_CHARS && <span className="font-medium text-red-500">Quá dài</span>}
              </div>
              {imagesOpen && (
                <div className="flex flex-wrap gap-2">
                  {entry.images.map((path, k) => (
                    <Thumb
                      key={path}
                      path={path}
                      alt={`Ảnh ${k + 1}`}
                      onRemove={
                        locked ? null : () => onChangeEntry(i, { images: entry.images.filter((p) => p !== path) })
                      }
                    />
                  ))}
                  {!locked && entry.images.length < MAX_ACCOUNT_POST_IMAGES && (
                    <>
                      <button
                        type="button"
                        disabled={uploadingRow >= 0}
                        onClick={() => pickImages(i)}
                        className="flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-[#CBD5E1] text-[10px] font-semibold text-slate-500 hover:border-[#2563EB] hover:text-[#2563EB] disabled:opacity-50"
                        title="Tải ảnh từ máy"
                      >
                        {uploadingRow === i ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                        Thêm
                      </button>
                      {onCrawlImage && (
                        <button
                          type="button"
                          disabled={crawlingRow >= 0 || Boolean(crawlDisabledReason)}
                          onClick={() => crawlFor(i)}
                          className="flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-[#BFDBFE] text-[10px] font-semibold text-[#2563EB] hover:bg-blue-50 disabled:opacity-50"
                          title={crawlDisabledReason || "Cào 1 ảnh Pixabay hợp với nội dung bài"}
                        >
                          {crawlingRow === i ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                          Cào ảnh
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
      </div>

      <div className="mt-4 grid w-full min-w-0 grid-cols-3 gap-1.5 border-t border-[#E2E8F0] pt-3">
        <button
          type="button"
          onClick={() => setImagesOpen((v) => !v)}
          className={`${footerBtn} ${imagesOpen ? "border-[#2563EB] text-[#2563EB]" : "hover:bg-slate-50"}`}
          title="Xem / thêm ảnh đính kèm"
        >
          <ImageIcon size={12} className="shrink-0" />
          <span className="truncate">Ảnh ({imageCount})</span>
        </button>
        <button
          type="button"
          onClick={onRegenerate}
          disabled={Boolean(regenerateState.disabledReason) || regenerateState.running}
          className={`${footerBtn} hover:bg-slate-50`}
          title={regenerateState.disabledReason || "AI tạo lại nội dung cho nick này"}
        >
          <RefreshCw size={12} className={`shrink-0 ${regenerateState.running ? "animate-spin" : ""}`} />
          <span className="truncate">Tạo lại</span>
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={locked}
          className={`${footerBtn} hover:bg-rose-50 hover:text-rose-600`}
          title="Xoá bài và bỏ chọn nick này"
        >
          <Trash2 size={12} className="shrink-0" />
          <span className="truncate">Xoá</span>
        </button>
      </div>
    </div>
  );
}

/** Dạng "Từng bài": mỗi nick đã chọn 1 thẻ, mỗi khung giờ 1 ô nội dung. */
function AccountCards({
  compose, onChange, accounts, rowLabels, locked, onRegenerate, regenerating, regenerateDisabledReason, onRemoveAccount,
  onCrawlImage, crawlDisabledReason,
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(accounts.length / CARDS_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * CARDS_PER_PAGE;
  const visible = accounts.slice(start, start + CARDS_PER_PAGE);

  const changeEntry = (uid, index, patch) =>
    onChange((prev) => {
      const posts = { ...(prev.account_posts || {}) };
      const list = Array.isArray(posts[uid]) ? [...posts[uid]] : [];
      while (list.length <= index) list.push({ content: "", images: [] });
      list[index] = { ...accountEntry(posts, uid, index), ...patch };
      posts[uid] = list;
      return { account_posts: posts };
    });

  const removeAccount = (uid) => {
    onChange((prev) => {
      const posts = { ...(prev.account_posts || {}) };
      delete posts[uid];
      return { account_posts: posts };
    });
    onRemoveAccount?.(uid);
  };

  if (accounts.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/40 px-4 py-12 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-500">
          <Users size={22} />
        </div>
        <h4 className="text-xs font-bold text-slate-700">Chưa chọn nick nào</h4>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
          Chọn nick ở <strong>Bước 2</strong>, mỗi nick sẽ có 1 ô bài ở đây. Bấm <strong>THỰC THI</strong> để AI điền nội dung.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
        {visible.map((acc) => {
          const uid = String(acc.uid);
          const entries = rowLabels.map((_, i) => accountEntry(compose.account_posts, uid, i));
          return (
            <AccountCard
              key={uid}
              account={acc}
              entries={entries}
              rowLabels={rowLabels}
              locked={locked}
              onChangeEntry={(i, patch) => changeEntry(uid, i, patch)}
              onRegenerate={() => onRegenerate?.(uid)}
              regenerateState={{ running: regenerating === uid, disabledReason: regenerateDisabledReason }}
              onRemove={() => removeAccount(uid)}
              onCrawlImage={onCrawlImage}
              crawlDisabledReason={crawlDisabledReason}
            />
          );
        })}
      </div>
      {pageCount > 1 && (
        <div className="flex items-center justify-between text-xs text-[#475569]">
          <span className="font-medium">
            Hiển thị {start + 1}–{start + visible.length}/{accounts.length} nick
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
              className="rounded-md p-1.5 hover:bg-slate-100 disabled:opacity-40"
              aria-label="Trang trước"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="font-semibold">
              {safePage + 1}/{pageCount}
            </span>
            <button
              type="button"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
              className="rounded-md p-1.5 hover:bg-slate-100 disabled:opacity-40"
              aria-label="Trang sau"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Dạng văn bản: ô soạn chung (các bài cách nhau bằng dòng "---") + kho ảnh chung, chia ngẫu nhiên cho nick. */
function TextComposer({ compose, parsed, onChange, locked, onCrawlImage, crawlDisabledReason }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [crawlQuery, setCrawlQuery] = useState("");
  const [crawling, setCrawling] = useState(false);
  const images = compose.image_paths || [];

  const addToPool = (added) =>
    onChange((prev) => ({
      image_paths: [...new Set([...(prev.image_paths || []), ...added])],
      image_mode: prev.image_mode === IMAGE_NONE ? IMAGE_MULTI : prev.image_mode,
    }));

  // Cào 1 ảnh Pixabay theo từ khoá (tiếng Việt cũng được, tự dịch) vào kho ảnh chung
  const handleCrawl = async () => {
    const q = crawlQuery.trim();
    if (!q) return;
    setCrawling(true);
    try {
      addToPool([await onCrawlImage(q)]);
    } catch (err) {
      toast.error(err?.message || "Không cào được ảnh.", "CÀO ẢNH");
    } finally {
      setCrawling(false);
    }
  };

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setUploading(true);
    const added = await uploadFiles(files);
    setUploading(false);
    if (added.length) {
      onChange((prev) => ({
        image_paths: [...new Set([...(prev.image_paths || []), ...added])],
        image_mode: prev.image_mode === IMAGE_NONE ? (added.length > 1 ? IMAGE_MULTI : IMAGE_SINGLE) : prev.image_mode,
      }));
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <textarea
          value={compose.content_text}
          readOnly={locked}
          onChange={(e) => onChange({ content_text: e.target.value })}
          rows={14}
          placeholder={
            "Nhập từng bài, mỗi bài cách nhau bằng 1 dòng chỉ có ---\nMỗi nick nhận ngẫu nhiên 1 bài khác nhau.\n\nVí dụ:\nChào buổi sáng cả nhà ☀️\n---\nCuối tuần này đi đâu chơi nhỉ?\n---\nCà phê sáng nay ngon quá ☕"
          }
          className={`w-full min-h-[280px] resize-y rounded-xl border p-4 font-mono text-xs leading-relaxed text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:ring-1 sm:text-sm ${
            locked
              ? "cursor-not-allowed border-[#E2E8F0] bg-slate-50 text-slate-600"
              : "border-[#E2E8F0] bg-white focus:border-[#2563EB] focus:ring-[#2563EB]"
          }`}
        />
        {parsed.tooLong.length > 0 && (
          <p className="text-[11px] font-medium text-red-500">
            Bài số {parsed.tooLong.join(", ")} dài quá {MAX_POST_CHARS.toLocaleString("vi-VN")} ký tự (giới hạn của Facebook).
          </p>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-bold text-[#0F172A] sm:text-sm">Kho ảnh chung</span>
          <Segmented
            value={compose.image_mode}
            disabled={locked}
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
                disabled={locked}
                onChange={(n) => onChange({ min_images: n, max_images: Math.max(n, compose.max_images) })}
              />
              đến
              <NumberSelect
                label="Số ảnh tối đa mỗi bài"
                value={compose.max_images}
                disabled={locked}
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
              {!locked && (
                <button
                  type="button"
                  onClick={() => onChange((prev) => ({ image_paths: (prev.image_paths || []).filter((p) => p !== path) }))}
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
            disabled={locked || uploading}
            onClick={() => fileRef.current?.click()}
            className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-[#CBD5E1] text-[11px] font-semibold text-slate-500 hover:border-[#2563EB] hover:text-[#2563EB] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
            {uploading ? "Đang tải" : "Thêm ảnh"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
        </div>
        {images.length > 0 && <p className="text-[11px] text-slate-400">{images.length} ảnh trong kho</p>}
        {onCrawlImage && !locked && (
          <div className="flex max-w-md items-center gap-2">
            <input
              type="text"
              value={crawlQuery}
              maxLength={200}
              onChange={(e) => setCrawlQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCrawl();
                }
              }}
              placeholder="Từ khoá ảnh, vd: cà phê sáng"
              className="h-8 min-w-0 flex-1 rounded-lg border border-[#E2E8F0] bg-white px-3 text-xs focus:border-[#2563EB] focus:outline-none"
            />
            <button
              type="button"
              disabled={crawling || !crawlQuery.trim() || Boolean(crawlDisabledReason)}
              onClick={handleCrawl}
              title={crawlDisabledReason || "Cào 1 ảnh Pixabay vào kho"}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {crawling ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
              Cào ảnh Pixabay
            </button>
          </div>
        )}
        {onCrawlImage && crawlDisabledReason && <p className="text-[11px] text-amber-600">{crawlDisabledReason}</p>}
      </div>
    </div>
  );
}

/**
 * Soạn bài Status, 2 dạng (cả hai cùng được giữ trong nháp, dạng đang chọn là dạng dùng khi đăng):
 *   - Từng bài     : mỗi nick 1 thẻ bài riêng (có hẹn giờ thì mỗi khung 1 ô), nick đăng đúng bài của nó
 *   - Dạng văn bản : ô soạn chung tách bằng "---" + kho ảnh chung, chia ngẫu nhiên cho nick
 */
export function ComposeEditor({
  compose,
  parsed,
  onChange,
  onClearAll,
  saveState,
  locked = false,
  lockedReason = "",
  accounts = [],
  rowLabels = [""],
  onRegenerate,
  regenerating = null,
  regenerateDisabledReason = "",
  onRemoveAccount,
  onCrawlImage,
  crawlDisabledReason = "",
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  const isAccounts = compose.layout !== LAYOUT_TEXT;

  const accountStats = useMemo(() => {
    let filled = 0;
    for (const acc of accounts) {
      rowLabels.forEach((_, i) => {
        if (accountEntry(compose.account_posts, acc.uid, i).content.trim()) filled += 1;
      });
    }
    return { filled, total: accounts.length * rowLabels.length };
  }, [accounts, rowLabels, compose.account_posts]);

  // Chuyển bài qua lại giữa 2 dạng (chủ động, không tự đồng bộ)
  const textPostCount = useMemo(
    () => parseComposeText(compose.content_text, compose.content_mode).count,
    [compose.content_text, compose.content_mode],
  );
  const emptyCellCount = accountStats.total - accountStats.filled;
  const uids = accounts.map((a) => String(a.uid));

  const pullFromText = () => {
    const res = textToAccountPosts(compose, uids, rowLabels.length);
    if (!res.filled) {
      toast.warning("Không còn ô trống nào để điền.", "CHUYỂN BÀI");
      return;
    }
    onChange({ account_posts: res.accountPosts });
    toast.success(
      `Đã điền ${res.filled} bài từ Dạng văn bản vào thẻ nick${res.leftover ? ` (thừa ${res.leftover} bài vì hết ô trống)` : ""}.`,
      "CHUYỂN BÀI",
    );
  };

  const pullFromAccounts = () => {
    const res = accountPostsToText(compose, uids, rowLabels.length);
    if (!res.added && !res.newImages) {
      toast.warning("Các bài ở dạng Từng bài đã có sẵn trong ô soạn.", "CHUYỂN BÀI");
      return;
    }
    onChange(res.patch);
    toast.success(
      `Đã gộp ${res.added} bài${res.newImages ? ` và ${res.newImages} ảnh` : ""} từ dạng Từng bài vào ô soạn.`,
      "CHUYỂN BÀI",
    );
  };

  let convert = null;
  if (isAccounts && textPostCount > 0) {
    convert = {
      label: `Lấy ${textPostCount} bài từ Dạng văn bản`,
      onClick: pullFromText,
      disabledReason: accounts.length === 0 ? "Chọn nick trước." : emptyCellCount === 0 ? "Mọi ô đã có bài." : "",
      hint: "Điền bài từ ô soạn văn bản vào các ô còn trống, kèm ảnh từ kho chung. Ô đã có bài giữ nguyên.",
    };
  } else if (!isAccounts && accountStats.filled > 0) {
    convert = {
      label: `Gộp ${accountStats.filled} bài từ dạng Từng bài`,
      onClick: pullFromAccounts,
      disabledReason: "",
      hint: "Nối bài của các nick đang chọn vào cuối ô soạn (ngăn bằng ---), ảnh dồn vào kho chung.",
    };
  }

  const hasContent = isAccounts
    ? Object.keys(compose.account_posts || {}).length > 0
    : Boolean(compose.content_text) || (compose.image_paths || []).length > 0;
  const summary = isAccounts
    ? `Đã có ${accountStats.filled}/${accountStats.total} bài`
    : parsed.summary;
  const summaryActive = isAccounts ? accountStats.filled > 0 : parsed.count > 0;

  const saveLabel =
    saveState === "saving" ? "Đang lưu nháp..." : saveState === "saved" ? "Đã tự lưu nháp" : saveState === "error" ? "Chưa lưu được nháp, sẽ thử lại" : "";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            value={isAccounts ? LAYOUT_ACCOUNTS : LAYOUT_TEXT}
            disabled={locked}
            onChange={(v) => onChange(v === LAYOUT_TEXT ? { layout: LAYOUT_TEXT, content_mode: CONTENT_MULTI } : { layout: LAYOUT_ACCOUNTS })}
            options={[
              { value: LAYOUT_ACCOUNTS, label: "Từng bài" },
              { value: LAYOUT_TEXT, label: "Dạng văn bản" },
            ]}
          />
          <span className={`text-xs font-semibold ${summaryActive ? "text-[#2563EB]" : "text-slate-400"}`}>{summary}</span>
          {convert && !locked && (
            <button
              type="button"
              disabled={Boolean(convert.disabledReason)}
              onClick={convert.onClick}
              title={convert.disabledReason || convert.hint}
              className="flex items-center gap-1.5 rounded-lg border border-[#BFDBFE] bg-blue-50 px-2.5 py-1 text-xs font-semibold text-[#2563EB] hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowRightLeft size={13} />
              {convert.label}
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {saveLabel && (
            <span className={`text-[11px] font-medium ${saveState === "error" ? "text-amber-600" : "text-slate-400"}`}>{saveLabel}</span>
          )}
          {confirmClear ? (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold">
              <span className="text-slate-600">{isAccounts ? "Xoá bài của mọi nick?" : "Xoá hết ô soạn và kho ảnh?"}</span>
              <button
                type="button"
                onClick={() => {
                  setConfirmClear(false);
                  onClearAll?.(isAccounts ? LAYOUT_ACCOUNTS : LAYOUT_TEXT);
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
              disabled={locked || !hasContent}
              onClick={() => setConfirmClear(true)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 size={13} />
              Xoá tất cả
            </button>
          )}
        </div>
      </div>

      <p className="text-[11px] text-slate-500">
        {isAccounts
          ? "Mỗi nick đăng đúng bài trong thẻ của nó" + (rowLabels.length > 1 ? ", mỗi khung giờ 1 bài." : ".")
          : "Mỗi nick nhận ngẫu nhiên 1 bài khác nhau trong ô; ảnh lấy từ kho ảnh chung."}
      </p>

      {isAccounts ? (
        <AccountCards
          compose={compose}
          onChange={onChange}
          accounts={accounts}
          rowLabels={rowLabels}
          locked={locked}
          onRegenerate={onRegenerate}
          regenerating={regenerating}
          regenerateDisabledReason={regenerateDisabledReason}
          onRemoveAccount={onRemoveAccount}
          onCrawlImage={onCrawlImage}
          crawlDisabledReason={crawlDisabledReason}
        />
      ) : (
        <TextComposer
          compose={compose}
          parsed={parsed}
          onChange={onChange}
          locked={locked}
          onCrawlImage={onCrawlImage}
          crawlDisabledReason={crawlDisabledReason}
        />
      )}
      {locked && lockedReason && <p className="text-[11px] font-medium text-slate-500">{lockedReason}</p>}
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
        <CheckCircle2 size={13} /> Đủ bài cho các nick đã chọn.
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
