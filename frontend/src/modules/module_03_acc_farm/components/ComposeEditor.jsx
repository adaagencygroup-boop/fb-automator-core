"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
  Maximize2,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/services/api";
import { toast } from "@/lib/toast";
import { AuthedPostImage } from "./PostImageModal";
import { FacebookEmojiMenu } from "./FacebookEmojiModal";
import {
  IMAGE_MULTI,
  LAYOUT_ACCOUNTS,
  LAYOUT_TEXT,
  MAX_ACCOUNT_POST_IMAGES,
  MAX_POST_CHARS,
  accountEntry,
  applyTextToCells,
  cellsToText,
  fillCellImages,
  flowOverflowIntoCells,
  orderedCells,
  splitPostChunks,
} from "../composeText";

const CARDS_PER_PAGE = 9;
const MAX_CRAWL_IMAGES = 50; // khớp post_routes.MAX_CRAWL_IMAGES

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
  const [expandedRow, setExpandedRow] = useState(-1); // ô đang mở phóng to (-1 = đóng)
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
      const paths = await onCrawlImage(text, 1);
      const merged = [...new Set([...entries[row].images, ...paths])].slice(0, MAX_ACCOUNT_POST_IMAGES);
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
                <span>
                  {entry.content.length.toLocaleString("vi-VN")} ký tự
                  {entry.content.length > MAX_POST_CHARS && <span className="ml-1.5 font-medium text-red-500">Quá dài</span>}
                </span>
                <button
                  type="button"
                  onClick={() => setExpandedRow(i)}
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 hover:bg-blue-50 hover:text-[#2563EB]"
                  title="Mở to để đọc / sửa cho rõ"
                >
                  <Maximize2 size={12} />
                  Phóng to
                </button>
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

      <Dialog open={expandedRow >= 0} onOpenChange={(open) => !open && setExpandedRow(-1)}>
        {expandedRow >= 0 && (
          <DialogContent className="max-h-[92vh] w-[94vw] max-w-4xl overflow-y-auto p-6 sm:max-w-4xl">
            <DialogHeader className="pr-8">
              <DialogTitle className="text-base font-bold text-slate-900">
                {name}
                {rowLabels[expandedRow] ? <span className="text-[#2563EB]"> · Khung {rowLabels[expandedRow]}</span> : null}
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">Sửa trực tiếp, nội dung tự lưu nháp.</DialogDescription>
            </DialogHeader>
            {rowLabels.length > 1 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {rowLabels.map((label, r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setExpandedRow(r)}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                      r === expandedRow
                        ? "border-[#2563EB] bg-[#EFF6FF] text-[#2563EB]"
                        : "border-[#E2E8F0] text-slate-500 hover:border-[#2563EB] hover:text-[#2563EB]"
                    }`}
                  >
                    Khung {label}
                    {!entries[r].content.trim() && <span className="ml-1 text-amber-500">•</span>}
                  </button>
                ))}
              </div>
            )}
            <textarea
              autoFocus
              value={entries[expandedRow].content}
              readOnly={locked}
              onChange={(e) => onChangeEntry(expandedRow, { content: e.target.value })}
              placeholder={`Nhập nội dung bài đăng cho ${name}...`}
              className={`mt-3 min-h-[50vh] w-full resize-y rounded-xl border p-4 text-sm leading-relaxed text-[#0F172A] focus:outline-none ${
                locked
                  ? "cursor-not-allowed border-[#E2E8F0] bg-slate-50 text-slate-600"
                  : "border-[#E2E8F0] bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
              }`}
            />
            <div className="mt-1 text-xs text-[#64748B]">
              {entries[expandedRow].content.length.toLocaleString("vi-VN")} ký tự
              {entries[expandedRow].content.length > MAX_POST_CHARS && (
                <span className="ml-1.5 font-medium text-red-500">Quá dài (tối đa {MAX_POST_CHARS.toLocaleString("vi-VN")})</span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {entries[expandedRow].images.map((path, k) => (
                <Thumb
                  key={path}
                  path={path}
                  alt={`Ảnh ${k + 1}`}
                  onRemove={
                    locked
                      ? null
                      : () => onChangeEntry(expandedRow, { images: entries[expandedRow].images.filter((p) => p !== path) })
                  }
                />
              ))}
              {!locked && entries[expandedRow].images.length < MAX_ACCOUNT_POST_IMAGES && (
                <>
                  <button
                    type="button"
                    disabled={uploadingRow >= 0}
                    onClick={() => pickImages(expandedRow)}
                    className="flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-[#CBD5E1] text-[10px] font-semibold text-slate-500 hover:border-[#2563EB] hover:text-[#2563EB] disabled:opacity-50"
                  >
                    {uploadingRow === expandedRow ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                    Thêm
                  </button>
                  {onCrawlImage && (
                    <button
                      type="button"
                      disabled={crawlingRow >= 0 || Boolean(crawlDisabledReason)}
                      onClick={() => crawlFor(expandedRow)}
                      title={crawlDisabledReason || "Cào 1 ảnh Pixabay hợp với nội dung bài"}
                      className="flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-[#BFDBFE] text-[10px] font-semibold text-[#2563EB] hover:bg-blue-50 disabled:opacity-50"
                    >
                      {crawlingRow === expandedRow ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                      Cào ảnh
                    </button>
                  )}
                </>
              )}
              <button
                type="button"
                onClick={() => setExpandedRow(-1)}
                className="ml-auto h-9 rounded-lg bg-[#2563EB] px-5 text-xs font-bold text-white hover:bg-blue-700"
              >
                Xong
              </button>
            </div>
          </DialogContent>
        )}
      </Dialog>

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
      {/* Số cột theo số thẻ để không chừa khoảng trắng: 1 thẻ = 1 cột, 2 thẻ = 2 cột, từ 3 thẻ = tối đa 3 cột */}
      <div
        className={`grid grid-cols-1 gap-5 [&>*]:min-w-0 ${
          visible.length >= 3 ? "md:grid-cols-2 xl:grid-cols-3" : visible.length === 2 ? "md:grid-cols-2" : ""
        }`}
      >
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

/**
 * "Dạng văn bản": CÙNG bộ bài với thẻ nick, soạn trong 1 ô (các bài cách nhau bằng dòng "---").
 * Bài thứ k = ô thứ k (khung 1 của mọi nick, rồi khung 2...), thứ tự hiện ngay dưới ô soạn.
 */
function TextView({ compose, onChange, accounts, rowLabels, locked, onCrawlImage, crawlDisabledReason }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [crawlQuery, setCrawlQuery] = useState("");
  const [crawling, setCrawling] = useState(false);
  const uidKey = accounts.map((a) => String(a.uid)).join(",");
  const cells = useMemo(() => orderedCells(uidKey ? uidKey.split(",") : [], rowLabels.length), [uidKey, rowLabels.length]);
  const names = useMemo(() => new Map(accounts.map((a) => [String(a.uid), a.name || String(a.uid)])), [accounts]);

  // Ô soạn giữ chữ đang gõ (kể cả khoảng trắng/dòng trống) khi đang focus; rời ô thì hiện lại bản chuẩn từ thẻ nick
  const serialized = useMemo(
    () => cellsToText(compose.account_posts, cells, compose.content_text),
    [compose.account_posts, cells, compose.content_text],
  );
  const [text, setText] = useState(serialized);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(serialized);
  }, [serialized, editing]);

  const entries = cells.map((c, k) => ({ ...c, k, ...accountEntry(compose.account_posts, c.uid, c.row) }));
  const withContent = entries.filter((e) => e.content.trim());
  const noImage = withContent.filter((e) => e.images.length === 0);
  const hasAnyImage = entries.some((e) => e.images.length > 0);
  const spare = splitPostChunks(compose.content_text).filter(Boolean).length;
  const tooLong = withContent.filter((e) => e.content.length > MAX_POST_CHARS).map((e) => e.k + 1);
  const crawlCount = Math.min(MAX_CRAWL_IMAGES, Math.max(1, noImage.length));

  const handleText = (value) => {
    setText(value);
    onChange((prev) => applyTextToCells(prev.account_posts, cells, value));
  };

  /** Gắn ảnh mới cho các bài chưa có ảnh (mỗi bài 1 ảnh); thiếu thì dùng lại ảnh cũ. */
  const attachImages = (paths) => {
    const res = fillCellImages(compose.account_posts, cells, paths);
    onChange({ account_posts: res.account_posts });
    return res;
  };

  const removeImages = (cell) =>
    onChange((prev) => {
      const posts = { ...(prev.account_posts || {}) };
      const list = Array.isArray(posts[cell.uid]) ? posts[cell.uid].map((e) => ({ ...e })) : [];
      if (list[cell.row]) list[cell.row] = { ...list[cell.row], images: [] };
      posts[cell.uid] = list;
      return { account_posts: posts };
    });

  const report = (res, source) => {
    const parts = [];
    if (res.assigned) parts.push(`gắn ${res.assigned} ảnh mới`);
    if (res.reused) parts.push(`${res.reused} bài dùng lại ảnh cũ`);
    if (parts.length) toast.success(`${source}: ${parts.join(", ")}.`, "ẢNH");
    else toast.info("Mọi bài đã có ảnh.", "ẢNH");
  };

  const handleCrawl = async () => {
    const q = crawlQuery.trim();
    if (!q) return;
    setCrawling(true);
    try {
      const paths = await onCrawlImage(q, crawlCount);
      report(attachImages(paths), `Cào ${paths.length} ảnh`);
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
    if (added.length) report(attachImages(added), `Tải ${added.length} ảnh`);
  };

  if (accounts.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/40 px-4 py-10 text-center text-xs text-slate-400">
        Chọn nick ở <strong className="text-slate-600">Bước 2</strong> trước: bài thứ 1, 2, 3… trong ô soạn sẽ lần lượt thuộc về từng nick / khung giờ.
        {spare > 0 && <p className="mt-1 text-slate-500">Đang giữ {spare} bài dự phòng, sẽ tự điền khi chọn nick.</p>}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <textarea
          value={text}
          readOnly={locked}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onChange={(e) => handleText(e.target.value)}
          rows={14}
          placeholder={
            "Nhập từng bài, mỗi bài cách nhau bằng 1 dòng chỉ có ---\nBài 1 cho ô 1, bài 2 cho ô 2... (thứ tự ở bên dưới)\n\nVí dụ:\nChào buổi sáng cả nhà ☀️\n---\nCuối tuần này đi đâu chơi nhỉ?"
          }
          className={`w-full min-h-[280px] resize-y rounded-xl border p-4 text-xs leading-relaxed text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:ring-1 sm:text-sm ${
            locked
              ? "cursor-not-allowed border-[#E2E8F0] bg-slate-50 text-slate-600"
              : "border-[#E2E8F0] bg-white focus:border-[#2563EB] focus:ring-[#2563EB]"
          }`}
        />
        {tooLong.length > 0 && (
          <p className="text-[11px] font-medium text-red-500">
            Bài số {tooLong.join(", ")} dài quá {MAX_POST_CHARS.toLocaleString("vi-VN")} ký tự (giới hạn của Facebook).
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-slate-500">Thứ tự bài:</span>
          {entries.map((e) => (
            <span
              key={`${e.uid}-${e.row}`}
              title={e.content.trim() ? e.content.slice(0, 120) : "Chưa có bài"}
              className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
                e.content.trim() ? "border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]" : "border-dashed border-slate-300 text-slate-400"
              }`}
            >
              <strong>{e.k + 1}</strong> · {names.get(e.uid)}
              {rowLabels[e.row] ? ` ${rowLabels[e.row]}` : ""}
            </span>
          ))}
        </div>
        {spare > 0 && (
          <p className="text-[11px] text-slate-500">
            Thừa {spare} bài (nhiều hơn số nick × khung giờ): giữ làm dự phòng, không đăng; sẽ tự điền khi có thêm ô trống.
          </p>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-bold text-[#0F172A] sm:text-sm">Ảnh của các bài</span>
          <span className="text-[11px] font-medium text-slate-500">Mỗi bài 1 ảnh, theo đúng thứ tự bài</span>
        </div>
        {withContent.length > 0 &&
          (!hasAnyImage ? (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-700">
              <AlertTriangle size={13} className="mt-px shrink-0" />
              Chưa có ảnh: các bài sẽ đăng KHÔNG có ảnh. Thêm ảnh hoặc cào ảnh Pixabay bên dưới để mỗi bài có 1 ảnh.
            </p>
          ) : noImage.length > 0 ? (
            <p className="flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-700">
              <AlertTriangle size={13} className="shrink-0" />
              {noImage.length} bài chưa có ảnh (bài {noImage.map((e) => e.k + 1).join(", ")}). Cào / thêm ảnh, hoặc
              {!locked && (
                <button
                  type="button"
                  onClick={() => report(attachImages([]), "Dùng lại ảnh")}
                  className="rounded-md border border-amber-300 bg-white px-2 py-0.5 font-semibold text-amber-700 hover:bg-amber-100"
                >
                  dùng lại ảnh cũ cho {noImage.length} bài
                </button>
              )}
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600">
              <CheckCircle2 size={13} className="shrink-0" />
              Mọi bài đều có ảnh.
            </p>
          ))}
        <div className="flex flex-wrap gap-3">
          {withContent.map((e) => (
            <div key={`${e.uid}-${e.row}`} className="w-20 space-y-1">
              <div className="group relative h-20 w-20 overflow-hidden rounded-lg border border-[#E2E8F0] bg-slate-50">
                {e.images.length ? (
                  <>
                    <AuthedPostImage path={e.images[0]} alt={`Ảnh bài ${e.k + 1}`} className="h-full w-full object-cover" />
                    {e.images.length > 1 && (
                      <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] font-bold text-white">
                        +{e.images.length - 1}
                      </span>
                    )}
                    {!locked && (
                      <button
                        type="button"
                        onClick={() => removeImages(e)}
                        className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white group-hover:flex"
                        aria-label={`Bỏ ảnh của bài ${e.k + 1}`}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </>
                ) : (
                  <span className="flex h-full w-full items-center justify-center border-2 border-dashed border-slate-200 text-[10px] text-slate-400">
                    Chưa có ảnh
                  </span>
                )}
              </div>
              <p className="truncate text-center text-[10px] text-slate-500">Bài {e.k + 1}</p>
            </div>
          ))}
          {!locked && (
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-[#CBD5E1] text-[11px] font-semibold text-slate-500 hover:border-[#2563EB] hover:text-[#2563EB] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
              {uploading ? "Đang tải" : "Thêm ảnh"}
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
        </div>
        {onCrawlImage && !locked && withContent.length > 0 && (
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
              disabled={crawling || !crawlQuery.trim() || Boolean(crawlDisabledReason) || noImage.length === 0}
              onClick={handleCrawl}
              title={crawlDisabledReason || (noImage.length ? `Cào ${crawlCount} ảnh Pixabay cho các bài chưa có ảnh` : "Mọi bài đã có ảnh")}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {crawling ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
              {crawling ? `Đang cào ${crawlCount} ảnh...` : `Cào ${crawlCount} ảnh cho bài thiếu`}
            </button>
          </div>
        )}
        {onCrawlImage && crawlDisabledReason && <p className="text-[11px] text-amber-600">{crawlDisabledReason}</p>}
      </div>
    </div>
  );
}

const VIEW_STORAGE_KEY = "m03.status.composeView";

/**
 * Soạn bài Status: MỘT bộ bài (mỗi nick 1 bài cho mỗi khung giờ), 2 cách xem / sửa:
 *   - Từng bài     : thẻ từng nick
 *   - Dạng văn bản : 1 ô soạn, bài thứ k thuộc ô thứ k
 * Sửa bên nào bên kia đổi theo; khi đăng, nick đăng đúng bài của nó.
 */
export function ComposeEditor({
  compose,
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
  const [view, setView] = useState("cards");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(VIEW_STORAGE_KEY) === "text") setView("text");
    } catch {
      // bỏ qua
    }
  }, []);
  const changeView = (v) => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, v);
    } catch {
      // bỏ qua
    }
  };

  const uidKey = accounts.map((a) => String(a.uid)).join(",");
  const cells = useMemo(() => orderedCells(uidKey ? uidKey.split(",") : [], rowLabels.length), [uidKey, rowLabels.length]);

  // Nháp cũ: dạng văn bản riêng (ô soạn + kho ảnh) → gộp vào bộ bài chung. Bài thừa / ảnh chưa dùng giữ làm dự phòng
  // và tự điền vào ô trống khi chọn thêm nick / khung giờ.
  useEffect(() => {
    if (locked) return;
    const patch = {};
    if (compose.layout === LAYOUT_TEXT) patch.layout = LAYOUT_ACCOUNTS;
    if (compose.image_mode !== IMAGE_MULTI || compose.min_images !== 1 || compose.max_images !== 1) {
      Object.assign(patch, { image_mode: IMAGE_MULTI, min_images: 1, max_images: 1 });
    }
    let posts = compose.account_posts;
    if (cells.length) {
      const flowed = flowOverflowIntoCells(posts, cells, compose.content_text);
      if (flowed) {
        posts = flowed.account_posts;
        patch.account_posts = posts;
        patch.content_text = flowed.content_text;
      }
      const pool = compose.image_paths || [];
      if (pool.length) {
        const res = fillCellImages(posts, cells, pool, { reuse: false });
        if (res.assigned) {
          patch.account_posts = res.account_posts;
          patch.image_paths = pool.slice(res.assigned);
        }
      }
    }
    if (Object.keys(patch).length) onChange(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, cells, compose.layout, compose.content_text, compose.image_paths, compose.account_posts, compose.image_mode]);

  const filled = useMemo(
    () => cells.filter((c) => accountEntry(compose.account_posts, c.uid, c.row).content.trim()).length,
    [cells, compose.account_posts],
  );
  const spare = splitPostChunks(compose.content_text).filter(Boolean).length;
  const hasContent = Object.keys(compose.account_posts || {}).length > 0 || spare > 0;

  const saveLabel =
    saveState === "saving" ? "Đang lưu nháp..." : saveState === "saved" ? "Đã tự lưu nháp" : saveState === "error" ? "Chưa lưu được nháp, sẽ thử lại" : "";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            value={view}
            onChange={changeView}
            options={[
              { value: "cards", label: "Từng bài" },
              { value: "text", label: "Dạng văn bản" },
            ]}
          />
          <span className={`text-xs font-semibold ${filled > 0 ? "text-[#2563EB]" : "text-slate-400"}`}>
            Đã có {filled}/{cells.length} bài{spare ? ` · ${spare} bài dự phòng` : ""}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {saveLabel && (
            <span className={`text-[11px] font-medium ${saveState === "error" ? "text-amber-600" : "text-slate-400"}`}>{saveLabel}</span>
          )}
          {confirmClear ? (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold">
              <span className="text-slate-600">Xoá bài của mọi nick?</span>
              <button
                type="button"
                onClick={() => {
                  setConfirmClear(false);
                  onClearAll?.("ALL");
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
        {view === "cards"
          ? "Mỗi nick đăng đúng bài trong thẻ của nó" + (rowLabels.length > 1 ? ", mỗi khung giờ 1 bài." : ".")
          : "Cùng các bài với dạng Từng bài, soạn trong 1 ô: bài thứ 1, 2, 3… lần lượt thuộc về các nick / khung giờ theo thứ tự bên dưới."}
      </p>

      {view === "cards" ? (
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
        <TextView
          compose={compose}
          onChange={onChange}
          accounts={accounts}
          rowLabels={rowLabels}
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
