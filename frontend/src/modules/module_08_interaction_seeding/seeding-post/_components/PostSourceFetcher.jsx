"use client";

/**
 * Nội dung popup "Lấy bài viết từ page/ trang cá nhân": lấy TOÀN BỘ bài (job chạy nền, bài hiện dần),
 * tìm / phân trang, chọn N bài đầu hoặc "Chọn tất cả kết quả lọc", rồi thêm vào danh sách seeding.
 * Nick dùng để lấy bài: nick đầu tiên đang chọn để seeding, không có thì nick Live + đã đăng nhập đầu tiên.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, CheckCircle2, FileText, Image as ImageIcon, Loader2, Search, Square, ThumbsUp, Video } from "lucide-react";
import Pagination from "@/components/ui/pagination";
import { toast } from "@/components/ui/toast";
import { postFetchApi } from "../../service";
import {
  emptySelection,
  isSelected,
  selectAllMatching,
  selectIds,
  selectedCount,
  toAddPayload,
  toggleOne,
} from "../postSelection.mjs";

const PAGE_SIZE = 20;
const POLL_MS = 2000;
const TYPES = {
  photo: { Icon: ImageIcon, label: "Ảnh" },
  video: { Icon: Video, label: "Video" },
  text: { Icon: FileText, label: "Bài viết" },
};
const INPUT =
  "min-w-0 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400";
const PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const CHECKBOX =
  "size-4 shrink-0 cursor-pointer appearance-none rounded-full border-2 border-slate-300 bg-white checked:border-blue-600 checked:bg-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50 disabled:checked:border-slate-400 disabled:checked:bg-slate-400 disabled:checked:opacity-100";
const fmt = (n) => Number(n || 0).toLocaleString("vi-VN");

function isActive(job) {
  return !!job && (job.is_running || job.status === "RUNNING" || job.status === "STOPPING");
}

function statusLine(job) {
  if (!job) return null;
  const n = fmt(job.found_count);
  const name = job.source_name ? ` · ${job.source_name}` : "";
  if (job.status === "RUNNING") return { tone: "run", text: `Đang lấy bài… đã quét được ${n} bài viết${name}` };
  if (job.status === "STOPPING") return { tone: "run", text: `Đang dừng… đã quét được ${n} bài viết${name}` };
  if (job.status === "COMPLETED") return { tone: "ok", text: `Đã quét được ${n} bài viết${name}.` };
  if (job.status === "STOPPED") return { tone: "warn", text: `Đã dừng lấy bài: quét được ${n} bài viết${name}.` };
  return {
    tone: "err",
    text: `Lấy bài thất bại${n !== "0" ? ` (đã quét được ${n} bài)` : ""}: ${job.error_message || job.stop_reason || "lỗi không rõ"}`,
  };
}

const TONE = {
  run: "text-blue-700",
  ok: "text-emerald-700",
  warn: "text-amber-700",
  err: "text-rose-700",
};

function splitContent(content) {
  const text = String(content || "").trim();
  if (!text) return { title: "Bài viết Facebook", desc: "" };
  const [first, ...rest] = text.split(/\r?\n+/);
  if (first.length > 100) return { title: `${first.slice(0, 100)}…`, desc: text };
  return { title: first, desc: rest.join(" ") };
}

export default function PostSourceFetcher({
  accounts = [],
  defaultAccountUid = "",
  disabled = false,
  targetsVersion = 0,
  onTargetsAdded,
  onFetchRunningChange,
  onAdded,
}) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [job, setJob] = useState(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [list, setList] = useState({ items: [], total: 0 });
  const [loadingList, setLoadingList] = useState(false);
  const [sel, setSel] = useState(emptySelection);
  const [firstN, setFirstN] = useState("3");
  const [adding, setAdding] = useState(false);

  const listSeq = useRef(0);
  const sourceKey = job?.source_key || "";
  const running = isActive(job);

  // Nick lấy bài: nick đang chạy lượt lấy bài (khôi phục) > nick đầu tiên chọn để seeding > nick khả dụng đầu tiên
  const accountUid = useMemo(() => {
    if (job?.account_uid && running) return job.account_uid;
    const preferred = accounts.find((a) => a.uid === defaultAccountUid) || accounts[0];
    return preferred?.uid || "";
  }, [accounts, defaultAccountUid, job?.account_uid, running]);

  // Khôi phục lượt lấy bài đang chạy / gần nhất khi mở lại màn
  useEffect(() => {
    let alive = true;
    postFetchApi
      .getActiveJob()
      .then((res) => {
        if (!alive || !res?.job) return;
        setJob(res.job);
        setSourceUrl((cur) => cur || res.job.source_url || "");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    onFetchRunningChange?.(running);
  }, [running, onFetchRunningChange]);

  // Tìm kiếm: chờ người dùng gõ xong
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  // Đổi nguồn / từ khoá → về trang 1 và bỏ lựa chọn ("tất cả kết quả lọc" gắn với từ khoá lúc chọn)
  useEffect(() => {
    setPage(1);
    setSel(emptySelection());
  }, [sourceKey, q]);

  const loadList = useCallback(async () => {
    if (!sourceKey) {
      setList({ items: [], total: 0 });
      return;
    }
    const seq = ++listSeq.current;
    setLoadingList(true);
    try {
      const res = await postFetchApi.listPosts({ source_key: sourceKey, q: q || undefined, type: "all", page, page_size: PAGE_SIZE });
      if (seq !== listSeq.current) return;
      setList({ items: res?.items || [], total: res?.total || 0 });
    } catch (err) {
      if (seq === listSeq.current) toast.error(err?.message || "Không tải được danh sách bài viết.", "LỖI TẢI BÀI");
    } finally {
      if (seq === listSeq.current) setLoadingList(false);
    }
  }, [sourceKey, q, page]);

  useEffect(() => {
    loadList();
  }, [loadList, targetsVersion]);

  // Đang lấy bài: hỏi tiến độ mỗi 2 giây, có bài mới thì tải lại trang đang xem
  const lastFound = useRef(-1);
  useEffect(() => {
    if (!running || !job?.id) return undefined;
    const timer = setInterval(async () => {
      try {
        const res = await postFetchApi.getJob(job.id);
        const next = res?.job;
        if (!next) return;
        setJob(next);
        if (next.found_count !== lastFound.current) {
          lastFound.current = next.found_count;
          loadList();
        }
        if (!isActive(next)) {
          loadList();
          const line = statusLine(next);
          if (next.status === "COMPLETED") toast.success(line.text, "ĐÃ LẤY XONG");
          else if (next.status === "STOPPED") toast.warning(line.text, "ĐÃ DỪNG");
          else toast.error(line.text, "LẤY BÀI THẤT BẠI");
        }
      } catch {
        /* thử lại ở vòng sau */
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, job?.id, loadList]);

  const chosen = selectedCount(sel, list.total);
  const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const pickN = Number(firstN);
  const pickValid = Number.isInteger(pickN) && pickN >= 1;

  const handleStart = async (event) => {
    event?.preventDefault();
    if (disabled || running || starting) return;
    if (!sourceUrl.trim()) {
      toast.warning("Nhập link page hoặc trang cá nhân Facebook.", "THIẾU LINK");
      return;
    }
    if (!accountUid) {
      toast.warning("Không có tài khoản Live + đã đăng nhập để lấy bài.", "THIẾU TÀI KHOẢN");
      return;
    }
    setStarting(true);
    try {
      const res = await postFetchApi.startJob(sourceUrl.trim(), accountUid);
      lastFound.current = -1;
      setJob(res?.job || null);
      toast.info("Đã bắt đầu lấy bài viết — bài sẽ hiện dần bên dưới.", "ĐANG LẤY BÀI");
    } catch (err) {
      toast.error(err?.message || "Không bắt đầu lấy bài được.", "LỖI");
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    if (!job?.id) return;
    setStopping(true);
    try {
      const res = await postFetchApi.stopJob(job.id);
      if (res?.job) setJob(res.job);
    } catch (err) {
      toast.error(err?.message || "Không dừng được.", "LỖI");
    } finally {
      setStopping(false);
    }
  };

  const handlePickFirst = async () => {
    if (!pickValid) return;
    const n = Math.min(5000, pickN);
    try {
      const res = await postFetchApi.firstPostIds({ source_key: sourceKey, q: q || undefined, type: "all", limit: n });
      const ids = res?.ids || [];
      setSel(selectIds(ids));
      if (ids.length < n) toast.info(`Chỉ còn ${fmt(ids.length)} bài chưa thêm khớp từ khoá.`, "ĐÃ CHỌN");
    } catch (err) {
      toast.error(err?.message || "Không chọn được.", "LỖI");
    }
  };

  const handleAdd = async () => {
    if (!chosen || adding) return;
    setAdding(true);
    try {
      const res = await postFetchApi.addToTargets(toAddPayload(sel, { sourceKey, q, type: "all" }));
      toast.success(res?.message || "Đã thêm bài vào danh sách seeding.", "ĐÃ THÊM");
      setSel(emptySelection());
      await onTargetsAdded?.();
      loadList();
      onAdded?.();
    } catch (err) {
      toast.error(err?.message || "Không thêm được bài vào danh sách.", "LỖI");
    } finally {
      setAdding(false);
    }
  };

  const line = statusLine(job);
  const lockInputs = disabled || running || starting;
  const busy = disabled || adding;

  return (
    <>
      <div className="space-y-4 p-5 sm:p-6">
        <form onSubmit={handleStart} className="space-y-3">
          <label className="block space-y-1.5 text-sm text-slate-600">
            <span>Link Page hoặc trang cá nhân Facebook</span>
            <input
              type="text"
              inputMode="url"
              placeholder="https://www.facebook.com/ten-trang"
              value={sourceUrl}
              disabled={lockInputs}
              onChange={(e) => setSourceUrl(e.target.value)}
              className={`${INPUT} block w-full shadow-sm`}
            />
          </label>
          {running ? (
            <button
              type="button"
              onClick={handleStop}
              disabled={stopping || job?.status === "STOPPING"}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
            >
              {stopping || job?.status === "STOPPING" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Square className="size-3.5 fill-current" aria-hidden="true" />
              )}
              Dừng lấy bài
            </button>
          ) : (
            <button type="submit" disabled={lockInputs || !accountUid} className={`${PRIMARY} w-full`}>
              {starting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
              {starting ? "Đang bắt đầu…" : "Lấy danh sách bài viết"}
            </button>
          )}
        </form>

        {!accounts.length && (
          <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
            Không có tài khoản Live + đã đăng nhập để lấy bài. Vui lòng kiểm tra trang Quản lý tài khoản.
          </p>
        )}

        {line && (
          <p role="status" className={`flex items-center gap-2 text-sm ${TONE[line.tone]}`}>
            {line.tone === "run" ? (
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
            ) : line.tone === "ok" ? (
              <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
            ) : (
              <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
            )}
            <span className="min-w-0">{line.text}</span>
          </p>
        )}

        {sourceKey && (
          <>
            <div className="space-y-3 border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900">Danh sách bài viết</h3>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{fmt(list.total)} kết quả</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  aria-label="Tìm bài viết theo tiêu đề"
                  placeholder="Tìm bài viết theo tiêu đề..."
                  value={qInput}
                  onChange={(e) => setQInput(e.target.value)}
                  className={`${INPUT} min-w-44 flex-1`}
                />
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  Số bài
                  <input
                    type="number"
                    min="1"
                    max="5000"
                    step="1"
                    value={firstN}
                    onChange={(e) => setFirstN(e.target.value)}
                    className={`${INPUT} w-20 px-2 text-center`}
                  />
                </label>
                <button
                  type="button"
                  onClick={handlePickFirst}
                  disabled={busy || !list.total || !pickValid}
                  className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                >
                  Chọn {pickValid ? fmt(pickN) : "N"} bài
                </button>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <label className="flex cursor-pointer items-center gap-2 text-slate-700">
                  <input
                    type="checkbox"
                    className={CHECKBOX}
                    checked={sel.mode === "all"}
                    onChange={(e) => setSel(e.target.checked ? selectAllMatching() : emptySelection())}
                    disabled={busy || !list.total}
                  />
                  Chọn tất cả kết quả lọc
                </label>
                <button
                  type="button"
                  disabled={busy || !chosen}
                  onClick={() => setSel(emptySelection())}
                  className="shrink-0 px-2 py-1 text-slate-500 hover:text-blue-700 disabled:opacity-50"
                >
                  Bỏ chọn
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {loadingList && !list.items.length ? (
                <p className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 p-4 text-sm text-slate-500">
                  <Loader2 className="size-4 animate-spin text-blue-600" aria-hidden="true" /> Đang tải bài viết...
                </p>
              ) : !list.items.length ? (
                <p className="rounded-xl border border-slate-200 p-4 text-center text-sm text-slate-500">
                  {running
                    ? "Đang chờ bài đầu tiên..."
                    : q
                      ? "Không có bài viết khớp với từ khóa."
                      : "Không tìm thấy bài viết có thể đọc từ nguồn này."}
                </p>
              ) : (
                list.items.map((p) => {
                  const { Icon, label } = TYPES[p.post_type] || TYPES.text;
                  const checked = p.added || isSelected(sel, p.id);
                  const { title, desc } = splitContent(p.content);
                  const date = p.published_at || p.published_text;
                  return (
                    <label
                      key={p.id}
                      className={`flex items-center gap-3 rounded-xl border p-3 ${
                        checked && !p.added ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"
                      } ${!p.added && !busy ? "cursor-pointer hover:border-blue-300" : ""}`}
                    >
                      <input
                        type="checkbox"
                        className={CHECKBOX}
                        checked={checked}
                        onChange={() => setSel((s) => toggleOne(s, p.id))}
                        disabled={busy || p.added}
                      />
                      <Icon className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                      <span className="min-w-0 space-y-1">
                        <span className="block break-words text-sm font-semibold text-slate-900">{title}</span>
                        {desc && <span className="line-clamp-2 break-words text-xs text-slate-500">{desc}</span>}
                        <span className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700">{label}</span>
                          {date && <span>{date}</span>}
                          {p.reaction_count != null && (
                            <span className="inline-flex items-center gap-1">
                              <ThumbsUp className="size-3" aria-label="Lượt tương tác" />
                              {fmt(p.reaction_count)}
                            </span>
                          )}
                          {p.added && <span className="font-medium text-emerald-700">Đã có trong danh sách seeding</span>}
                        </span>
                      </span>
                    </label>
                  );
                })
              )}
            </div>

            {totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>
                  Hiển thị {fmt((page - 1) * PAGE_SIZE + 1)}–{fmt(Math.min(page * PAGE_SIZE, list.total))} / {fmt(list.total)} bài
                </span>
                <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} siblingCount={1} />
              </div>
            )}
          </>
        )}
      </div>

      {sourceKey && (
        <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-white px-5 py-3 sm:px-6">
          <div aria-live="polite">
            <p className="text-sm font-bold text-slate-900">{fmt(chosen)} bài đã chọn</p>
            <p className="text-xs text-slate-500">Tổng số bài sẽ đưa vào danh sách seeding</p>
          </div>
          <button type="button" disabled={busy || !chosen} onClick={handleAdd} className={PRIMARY}>
            {adding ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
            {adding ? "Đang thêm bài viết…" : "Thêm bài viết đã chọn"}
          </button>
        </footer>
      )}
    </>
  );
}
