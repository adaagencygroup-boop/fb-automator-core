"use client";

/**
 * Tab "Lấy bài viết từ page / trang cá nhân": lấy TOÀN BỘ bài (job chạy nền, bài hiện dần),
 * tìm / lọc / phân trang, tích chọn (kể cả "Chọn tất cả N bài") rồi thêm vào danh sách seeding.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Pin,
  Plus,
  Search,
  Share2,
  Square,
  ThumbsUp,
  Video,
} from "lucide-react";
import Pagination from "@/components/ui/pagination";
import { toast } from "@/components/ui/toast";
import { postFetchApi } from "../../service";
import {
  emptySelection,
  isSelected,
  pageState,
  selectAllMatching,
  selectIds,
  selectedCount,
  setPageSelected,
  toAddPayload,
  toggleOne,
} from "../postSelection.mjs";

const PAGE_SIZE = 20;
const POLL_MS = 2000;
const TYPE_TABS = [
  { id: "all", label: "Tất cả" },
  { id: "photo", label: "Ảnh" },
  { id: "video", label: "Video" },
  { id: "text", label: "Bài viết" },
];
const TYPE_META = {
  photo: { label: "Ảnh", Icon: ImageIcon, box: "bg-blue-50 text-blue-700" },
  video: { label: "Video", Icon: Video, box: "bg-violet-50 text-violet-700" },
  text: { label: "Bài viết", Icon: FileText, box: "bg-slate-100 text-slate-700" },
};
const fmt = (n) => Number(n || 0).toLocaleString("vi-VN");

function isActive(job) {
  return !!job && (job.is_running || job.status === "RUNNING" || job.status === "STOPPING");
}

function statusLine(job) {
  if (!job) return null;
  const n = fmt(job.found_count);
  const name = job.source_name ? ` · ${job.source_name}` : "";
  if (job.status === "RUNNING") return { tone: "run", text: `Đang lấy bài… đã lấy ${n} bài${name}` };
  if (job.status === "STOPPING") return { tone: "run", text: `Đang dừng… đã lấy ${n} bài${name}` };
  if (job.status === "COMPLETED") return { tone: "ok", text: `Đã lấy hết bài: ${n} bài${name}` };
  if (job.status === "STOPPED") return { tone: "warn", text: `Đã dừng lấy bài: ${n} bài${name}` };
  return { tone: "err", text: `Lấy bài thất bại${n !== "0" ? ` (đã lấy ${n} bài)` : ""}: ${job.error_message || job.stop_reason || "lỗi không rõ"}` };
}

function splitContent(content) {
  const text = String(content || "").trim();
  if (!text) return { title: "(Bài không có nội dung chữ)", desc: "" };
  const [first, ...rest] = text.split(/\n+/);
  return { title: first.slice(0, 140), desc: rest.join(" ").slice(0, 220) };
}

export default function PostSourceFetcher({
  accounts = [],
  defaultAccountUid = "",
  disabled = false,
  targetsVersion = 0,
  onTargetsAdded,
  onFetchRunningChange,
}) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [accountUid, setAccountUid] = useState("");
  const [job, setJob] = useState(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const [page, setPage] = useState(1);
  const [list, setList] = useState({ items: [], total: 0, counts: { all: 0, photo: 0, video: 0, text: 0 } });
  const [loadingList, setLoadingList] = useState(false);
  const [sel, setSel] = useState(emptySelection);
  const [firstN, setFirstN] = useState(20);
  const [adding, setAdding] = useState(false);

  const listSeq = useRef(0);
  const headerCheckbox = useRef(null);
  const sourceKey = job?.source_key || "";
  const running = isActive(job);

  // Tài khoản mặc định: nick đang chọn để seeding, không có thì nick khả dụng đầu tiên
  useEffect(() => {
    if (accountUid && accounts.some((a) => a.uid === accountUid)) return;
    const preferred = accounts.find((a) => a.uid === defaultAccountUid) || accounts[0];
    setAccountUid(preferred?.uid || "");
  }, [accounts, defaultAccountUid, accountUid]);

  // Khôi phục lượt lấy bài đang chạy / gần nhất khi mở lại màn
  useEffect(() => {
    let alive = true;
    postFetchApi
      .getActiveJob()
      .then((res) => {
        if (!alive || !res?.job) return;
        setJob(res.job);
        setSourceUrl((cur) => cur || res.job.source_url || "");
        if (res.job.account_uid) setAccountUid(res.job.account_uid);
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

  // Đổi nguồn / bộ lọc → về trang 1 và bỏ lựa chọn (chọn "tất cả" gắn với bộ lọc lúc chọn)
  useEffect(() => {
    setPage(1);
    setSel(emptySelection());
  }, [sourceKey, q, type]);

  const loadList = useCallback(async () => {
    if (!sourceKey) {
      setList({ items: [], total: 0, counts: { all: 0, photo: 0, video: 0, text: 0 } });
      return;
    }
    const seq = ++listSeq.current;
    setLoadingList(true);
    try {
      const res = await postFetchApi.listPosts({ source_key: sourceKey, q: q || undefined, type, page, page_size: PAGE_SIZE });
      if (seq !== listSeq.current) return;
      setList({ items: res?.items || [], total: res?.total || 0, counts: res?.counts || { all: 0, photo: 0, video: 0, text: 0 } });
    } catch (err) {
      if (seq === listSeq.current) toast.error(err?.message || "Không tải được danh sách bài viết.", "LỖI TẢI BÀI");
    } finally {
      if (seq === listSeq.current) setLoadingList(false);
    }
  }, [sourceKey, q, type, page]);

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

  const pageIds = useMemo(() => list.items.filter((p) => !p.added).map((p) => p.id), [list.items]);
  const headerState = pageState(sel, pageIds);
  useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = headerState === "some";
  }, [headerState]);
  const chosen = selectedCount(sel, list.total);
  const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));

  const handleStart = async () => {
    if (!sourceUrl.trim()) {
      toast.warning("Nhập link page hoặc trang cá nhân Facebook.", "THIẾU LINK");
      return;
    }
    if (!accountUid) {
      toast.warning("Chọn tài khoản dùng để lấy bài (cần Live + đã đăng nhập).", "THIẾU TÀI KHOẢN");
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
    const n = Math.min(5000, Math.max(1, Number(firstN) || 0));
    try {
      const res = await postFetchApi.firstPostIds({ source_key: sourceKey, q: q || undefined, type, limit: n });
      const ids = res?.ids || [];
      setSel(selectIds(ids));
      if (ids.length < n) toast.info(`Chỉ còn ${fmt(ids.length)} bài chưa thêm khớp bộ lọc.`, "ĐÃ CHỌN");
    } catch (err) {
      toast.error(err?.message || "Không chọn được.", "LỖI");
    }
  };

  const handleAdd = async () => {
    if (!chosen) return;
    setAdding(true);
    try {
      const res = await postFetchApi.addToTargets(toAddPayload(sel, { sourceKey, q, type }));
      toast.success(res?.message || "Đã thêm bài vào danh sách seeding.", "ĐÃ THÊM");
      setSel(emptySelection());
      await onTargetsAdded?.();
      loadList();
    } catch (err) {
      toast.error(err?.message || "Không thêm được bài vào danh sách.", "LỖI");
    } finally {
      setAdding(false);
    }
  };

  const line = statusLine(job);
  const lockInputs = disabled || running || starting;

  return (
    <div className="space-y-4">
      {/* Nguồn + tài khoản */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 items-end">
        <label className="lg:col-span-3 flex flex-col gap-1.5 text-xs font-medium text-gray-600">
          Link page hoặc trang cá nhân Facebook
          <input
            type="text"
            value={sourceUrl}
            disabled={lockInputs}
            onChange={(e) => setSourceUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !lockInputs && handleStart()}
            placeholder="https://www.facebook.com/tenpage"
            className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3 text-xs font-mono text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
          />
        </label>
        <label className="lg:col-span-2 flex flex-col gap-1.5 text-xs font-medium text-gray-600">
          Tài khoản dùng để lấy bài
          <select
            value={accountUid}
            disabled={lockInputs || accounts.length === 0}
            onChange={(e) => setAccountUid(e.target.value)}
            className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
          >
            {accounts.length === 0 && <option value="">Không có tài khoản Live + đã đăng nhập</option>}
            {accounts.map((a) => (
              <option key={a.uid} value={a.uid}>
                {(a.profile_name || a.name || a.uid) + (a.profile_name || a.name ? ` · ${a.uid}` : "")}
              </option>
            ))}
          </select>
        </label>
      </div>

      {running ? (
        <button
          type="button"
          onClick={handleStop}
          disabled={stopping || job?.status === "STOPPING"}
          className="w-full h-11 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {stopping || job?.status === "STOPPING" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-3.5 h-3.5 fill-current" />}
          Dừng lấy bài
        </button>
      ) : (
        <button
          type="button"
          onClick={handleStart}
          disabled={lockInputs || !sourceUrl.trim() || !accountUid}
          className="w-full h-11 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-sm shadow-blue-500/30 disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none disabled:cursor-not-allowed"
        >
          {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Lấy toàn bộ bài viết
        </button>
      )}

      {line && (
        <div
          role="status"
          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium ${
            line.tone === "run"
              ? "border-blue-200 bg-blue-50 text-blue-800"
              : line.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : line.tone === "warn"
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {line.tone === "run" ? (
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          ) : line.tone === "ok" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span className="min-w-0">{line.text}</span>
          {running && <span className="ml-auto shrink-0 text-[11px] text-blue-700">Không giới hạn số bài — chạy tới khi hết bài hoặc bấm Dừng</span>}
        </div>
      )}

      {sourceKey && (
        <>
          {/* Tìm / lọc / chọn nhanh */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
              <input
                type="text"
                aria-label="Tìm bài viết theo nội dung"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="Tìm bài viết theo nội dung..."
                className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TYPE_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={type === t.id}
                  onClick={() => setType(t.id)}
                  className={`h-9 px-3 rounded-full border text-xs font-semibold ${
                    type === t.id ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {t.label} {fmt(list.counts?.[t.id])}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-600">
              <label htmlFor="pick-first-n">Chọn</label>
              <input
                id="pick-first-n"
                type="number"
                min={1}
                max={5000}
                value={firstN}
                onChange={(e) => setFirstN(e.target.value)}
                className="h-9 w-20 rounded-lg border border-gray-200 px-2 text-center text-xs font-semibold"
              />
              <button
                type="button"
                onClick={handlePickFirst}
                disabled={disabled || !list.total}
                className="h-9 px-3 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
              >
                bài đầu chưa thêm
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer">
              <input
                ref={headerCheckbox}
                type="checkbox"
                checked={headerState === "all"}
                disabled={disabled || !pageIds.length}
                onChange={(e) => setSel((s) => setPageSelected(s, pageIds, e.target.checked))}
                className="w-4 h-4 accent-[#2563EB]"
              />
              Chọn cả trang này
            </label>
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={() => setSel(selectAllMatching())}
                disabled={disabled || !list.total}
                className="font-semibold text-blue-700 hover:underline disabled:opacity-50"
              >
                Chọn tất cả {fmt(list.total)} bài
              </button>
              <button
                type="button"
                onClick={() => setSel(emptySelection())}
                disabled={!chosen}
                className="font-semibold text-gray-600 hover:underline disabled:opacity-40"
              >
                Bỏ chọn
              </button>
            </div>
          </div>

          {/* Danh sách bài */}
          <div className="space-y-2">
            {loadingList && !list.items.length ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin text-blue-600" /> Đang tải bài viết...
              </div>
            ) : !list.items.length ? (
              <div className="py-8 text-center text-xs text-gray-500">
                {running ? "Đang chờ bài đầu tiên..." : q || type !== "all" ? "Không có bài khớp bộ lọc." : "Chưa có bài nào."}
              </div>
            ) : (
              list.items.map((p) => {
                const meta = TYPE_META[p.post_type] || TYPE_META.text;
                const checked = p.added || isSelected(sel, p.id);
                const { title, desc } = splitContent(p.content);
                return (
                  <div
                    key={p.id}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                      checked && !p.added ? "border-blue-500 bg-blue-50/40" : "border-gray-200 bg-white"
                    }`}
                  >
                    <label className="flex flex-1 min-w-0 items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled || p.added}
                        onChange={() => setSel((s) => toggleOne(s, p.id))}
                        className="w-4 h-4 shrink-0 accent-[#2563EB]"
                      />
                      <span className={`w-11 h-11 shrink-0 rounded-lg flex items-center justify-center ${meta.box}`}>
                        <meta.Icon className="w-5 h-5" />
                      </span>
                      <span className="min-w-0 flex flex-col gap-0.5">
                        <span className="text-xs font-semibold text-gray-900 truncate">{title}</span>
                        {desc && <span className="text-[11px] text-gray-500 truncate">{desc}</span>}
                        <span className="flex flex-wrap items-center gap-3 text-[11px] text-gray-600">
                          <span className="px-1.5 py-0.5 rounded bg-gray-100 font-semibold text-gray-700">{meta.label}</span>
                          {(p.published_at || p.published_text) && <span>{p.published_at || p.published_text}</span>}
                          <span className="inline-flex items-center gap-1"><ThumbsUp className="w-3 h-3" />{fmt(p.reaction_count)}</span>
                          <span className="inline-flex items-center gap-1"><MessageCircle className="w-3 h-3" />{fmt(p.comment_count)}</span>
                          <span className="inline-flex items-center gap-1"><Share2 className="w-3 h-3" />{fmt(p.share_count)}</span>
                          {p.is_pinned && <span className="inline-flex items-center gap-1 text-amber-700"><Pin className="w-3 h-3" />Ghim</span>}
                        </span>
                      </span>
                    </label>
                    {p.added && (
                      <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">Đã thêm</span>
                    )}
                    <a
                      href={p.post_url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Mở bài trên Facebook"
                      className="shrink-0 w-9 h-9 rounded-lg border border-gray-200 text-gray-500 hover:text-blue-600 hover:border-blue-300 flex items-center justify-center"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                );
              })
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
              <span>
                Hiển thị {fmt((page - 1) * PAGE_SIZE + 1)}–{fmt(Math.min(page * PAGE_SIZE, list.total))} / {fmt(list.total)} bài
              </span>
              <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} siblingCount={1} />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3">
            <div>
              <div className="text-xs font-bold text-gray-900">
                {chosen ? `${fmt(chosen)} bài đang chọn` : "Chưa chọn bài nào"}
              </div>
              <div className="text-[11px] text-gray-500">
                {sel.mode === "all" ? "Gồm mọi bài khớp bộ lọc — bài đã có trong danh sách sẽ được bỏ qua." : "Bài đã thêm sẽ không bị thêm trùng."}
              </div>
            </div>
            <button
              type="button"
              onClick={handleAdd}
              disabled={disabled || adding || !chosen}
              className="h-10 px-4 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-2 shadow-sm shadow-blue-500/30 disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none disabled:cursor-not-allowed"
            >
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {chosen ? `Thêm ${fmt(chosen)} bài vào danh sách` : "Thêm bài đã chọn"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
