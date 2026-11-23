import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, FileText, Image, Search, ThumbsUp, Video, X } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { seedingApi } from "../../service";
import { normalizeTargetUrl, parseInputTargetsStats, removeVietnameseTones } from "../../validation";

const TYPES = {
  photo: { icon: Image, label: "Ảnh" },
  video: { icon: Video, label: "Video" },
  text: { icon: FileText, label: "Bài viết" },
};
const INPUT = "min-w-0 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 placeholder:text-slate-400";
const PRIMARY = "inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const CHECKBOX = "size-4 shrink-0 appearance-none rounded-full border-2 border-slate-300 bg-white checked:border-blue-600 checked:bg-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50";

export default function PostSourcePicker({ existingTargets, onAddTargets, onClose, disabled }) {
  const dialog = useRef(null);
  const sourceInput = useRef(null);
  const scanRequest = useRef(null);
  const titleId = useId();
  const [source, setSource] = useState("");
  const [items, setItems] = useState(null);
  const [query, setQuery] = useState("");
  const [count, setCount] = useState("3");
  const [selected, setSelected] = useState(new Set());
  const [scanning, setScanning] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const busy = disabled || scanning || adding;

  useEffect(() => {
    const modal = dialog.current;
    modal.showModal();
    sourceInput.current.focus();
    return () => {
      scanRequest.current?.abort();
      modal.close();
    };
  }, []);

  const posts = useMemo(() => {
    const results = items ?? [];
    const { validList } = parseInputTargetsStats(results.map((item) => item.post_url).join("\n"), existingTargets, "POST");
    const available = new Set(validList);
    return results.map((item) => {
      const [firstLine, ...rest] = (item.content || "").trim().split(/\r?\n/);
      const url = normalizeTargetUrl(item.post_url, "POST");
      return {
        ...item,
        url,
        title: firstLine.length > 100 ? `${firstLine.slice(0, 100)}…` : firstLine || "Bài viết không có nội dung",
        description: firstLine.length > 100 ? item.content : rest.join(" "),
        available: available.delete(url),
      };
    });
  }, [items, existingTargets]);

  const search = removeVietnameseTones(query.trim()).toLowerCase();
  const filtered = posts.filter((post) => removeVietnameseTones(post.title).toLowerCase().includes(search));
  const selectable = filtered.filter((post) => post.available);
  const picked = posts.filter((post) => post.available && selected.has(post.id));
  const allFilteredSelected = selectable.length > 0 && selectable.every((post) => selected.has(post.id));
  const selectionLimit = Number(count);

  async function scan(event) {
    event.preventDefault();
    if (busy || scanRequest.current) return;
    if (!source.trim()) {
      setError("Vui lòng nhập link Page hoặc trang cá nhân Facebook.");
      return;
    }

    const request = new AbortController();
    scanRequest.current = request;
    setScanning(true);
    setError("");
    setItems(null);
    setQuery("");
    setSelected(new Set());
    try {
      const response = await seedingApi.scanPostSource(source.trim(), request.signal);
      if (!Array.isArray(response?.items)) throw new Error("Máy chủ trả về danh sách bài viết không hợp lệ.");
      if (!request.signal.aborted) setItems(response.items);
    } catch (err) {
      if (!request.signal.aborted) setError(err?.message || "Không thể lấy danh sách bài viết.");
    } finally {
      scanRequest.current = null;
      if (!request.signal.aborted) setScanning(false);
    }
  }

  function toggle(postsToToggle, checked) {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const post of postsToToggle) {
        if (checked) next.add(post.id);
        else next.delete(post.id);
      }
      return next;
    });
  }

  async function addSelected() {
    if (busy || !picked.length) return;
    setAdding(true);
    setError("");
    try {
      const saved = await onAddTargets(picked.map((post) => post.url));
      if (!Array.isArray(saved)) throw new Error("Máy chủ chưa xác nhận danh sách bài viết.");
      const savedUrls = new Set(saved.map((target) => normalizeTargetUrl(target.url, "POST")));
      const savedCount = picked.filter((post) => savedUrls.has(post.url)).length;
      if (!savedCount) throw new Error("Không tìm thấy bài viết đã chọn trong danh sách seeding trả về.");
      toast.success(`Đã thêm ${savedCount} bài viết vào danh sách seeding.`);
      onClose();
    } catch (err) {
      setError(err?.message || "Không thể thêm bài viết đã chọn.");
    } finally {
      setAdding(false);
    }
  }

  function changeSource(value) {
    setSource(value);
    setItems(null);
    setSelected(new Set());
    setError("");
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!adding) onClose();
      }}
      className="fixed inset-0 m-auto max-h-[90vh] w-[95vw] max-w-4xl overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-0 text-slate-800 shadow-2xl backdrop:bg-slate-900/60"
    >
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-100 bg-white px-5 py-3 sm:px-6">
        <h2 id={titleId} className="text-base font-bold text-slate-900">Lấy bài viết từ page/ trang cá nhân</h2>
        <button type="button" onClick={onClose} disabled={adding} aria-label="Đóng" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50">
          <X className="size-5" aria-hidden="true" />
        </button>
      </header>

      <div className="space-y-4 p-5 sm:p-6">
        <form onSubmit={scan} className="space-y-3">
          <label className="block space-y-1.5 text-sm text-slate-600">
            <span>Link Page hoặc trang cá nhân Facebook</span>
            <input
              ref={sourceInput}
              type="text"
              inputMode="url"
              placeholder="https://www.facebook.com/ten-trang"
              value={source}
              onChange={(event) => changeSource(event.target.value)}
              disabled={busy}
              className={`${INPUT} block w-full shadow-sm`}
            />
          </label>
          <button type="submit" disabled={busy} className={`${PRIMARY} w-full`}>
            <Search className="size-4" aria-hidden="true" />
            {scanning ? "Đang quét bài viết…" : "Lấy danh sách bài viết"}
          </button>
        </form>

        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        {items !== null && (
          <>
            <p role="status" className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
              Đã quét được {posts.length} bài viết.
            </p>
            <div className="space-y-3 border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900">Danh sách bài viết</h3>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{filtered.length} kết quả</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  aria-label="Tìm bài viết theo tiêu đề"
                  placeholder="Tìm bài viết theo tiêu đề..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className={`${INPUT} min-w-44 flex-1`}
                />
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  Số bài
                  <input type="number" min="1" step="1" value={count} onChange={(event) => setCount(event.target.value)} className={`${INPUT} w-16 px-2 text-center`} />
                </label>
                <button
                  type="button"
                  disabled={busy || !selectable.length || !Number.isInteger(selectionLimit) || selectionLimit < 1}
                  onClick={() => setSelected(new Set(selectable.slice(0, selectionLimit).map((post) => post.id)))}
                  className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                >
                  Chọn {Number.isInteger(selectionLimit) && selectionLimit > 0 ? selectionLimit : "N"} bài
                </button>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <label className="flex cursor-pointer items-center gap-2 text-slate-700">
                  <input type="checkbox" className={CHECKBOX} checked={allFilteredSelected} onChange={(event) => toggle(selectable, event.target.checked)} disabled={busy || !selectable.length} />
                  Chọn tất cả kết quả lọc
                </label>
                <button type="button" disabled={busy || !picked.length} onClick={() => setSelected(new Set())} className="shrink-0 px-2 py-1 text-slate-500 hover:text-blue-700 disabled:opacity-50">Bỏ chọn</button>
              </div>
            </div>

            <div className="space-y-2">
              {filtered.map((post) => {
                const { icon: Icon, label } = TYPES[post.post_type] || TYPES.text;
                const checked = post.available && selected.has(post.id);
                return (
                  <label key={post.id} className={`flex items-center gap-3 rounded-xl border p-3 ${checked ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"} ${post.available && !busy ? "cursor-pointer hover:border-blue-300" : ""}`}>
                    <input type="checkbox" className={CHECKBOX} checked={checked} onChange={(event) => toggle([post], event.target.checked)} disabled={busy || !post.available} />
                    <Icon className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                    <span className="min-w-0 space-y-1">
                      <span className="block break-words text-sm font-semibold">{post.title}</span>
                      {post.description && <span className="line-clamp-2 break-words text-xs text-slate-500">{post.description}</span>}
                      <span className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold">{label}</span>
                        {post.published_at && <time dateTime={post.published_at}>{post.published_at}</time>}
                        {post.reaction_count != null && <span className="inline-flex items-center gap-1"><ThumbsUp className="size-3" aria-label="Lượt tương tác" />{post.reaction_count}</span>}
                        {!post.available && <span>Bài đã có hoặc link không hợp lệ</span>}
                      </span>
                    </span>
                  </label>
                );
              })}
              {!filtered.length && <p className="rounded-xl border border-slate-200 p-4 text-center text-sm text-slate-500">{posts.length ? "Không có bài viết khớp với từ khóa." : "Không tìm thấy bài viết có thể đọc từ nguồn này."}</p>}
            </div>
          </>
        )}
      </div>

      {items !== null && (
        <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-white px-5 py-3 sm:px-6">
          <div aria-live="polite">
            <p className="text-sm font-bold">{picked.length} bài đã chọn</p>
            <p className="text-xs text-slate-500">Tổng số bài sẽ đưa vào danh sách seeding</p>
          </div>
          <button type="button" disabled={busy || !picked.length} onClick={addSelected} className={PRIMARY}>
            <Check className="size-4" aria-hidden="true" />
            {adding ? "Đang thêm bài viết…" : "Thêm bài viết đã chọn"}
          </button>
        </footer>
      )}
    </dialog>
  );
}
