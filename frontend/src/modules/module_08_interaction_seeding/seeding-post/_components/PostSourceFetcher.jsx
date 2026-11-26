"use client";

/**
 * Nội dung popup "Lấy bài viết từ page/ trang cá nhân": lấy TOÀN BỘ bài (job chạy nền, bài hiện dần),
 * tìm trong toàn bộ kết quả, chọn N bài đầu hoặc "Chọn tất cả kết quả lọc", rồi thêm vào danh sách seeding.
 * - Nick quét: nick ĐẦU TIÊN trong các nick đã tích chọn ở mục "Số lượng tài khoản sử dụng" (còn Live + đã đăng nhập).
 *   Chưa tích nick nào thì không cho lấy bài.
 * - Bài lấy về chỉ lưu TẠM (RAM + file trên máy); bấm "Thêm bài viết đã chọn" mới lưu các bài đã chọn vào DB.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, CheckCircle2, Loader2, RefreshCw, Search, Square } from "lucide-react";
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

const PAGE_SIZE = 100;
const POLL_MS = 2000;
const FETCH_ACCOUNT_CURSOR_KEY = "m8-seeding-post-fetch-account-cursor";
const INPUT =
  "min-w-0 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs text-gray-800 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-gray-400";
const PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-gray-400";
const CHECKBOX =
  "size-4 shrink-0 cursor-pointer appearance-none rounded-full border-2 border-slate-300 bg-white checked:border-blue-600 checked:bg-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50 disabled:checked:border-slate-400 disabled:checked:bg-slate-400 disabled:checked:opacity-100";
const fmt = (n) => Number(n || 0).toLocaleString("vi-VN");
function formatDateOnly(value) {
  if (!value) return "";
  const raw = String(value).trim();
  const exact = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (exact) return `${exact[1].padStart(2, "0")}-${exact[2].padStart(2, "0")}-${exact[3]}`;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getDate()).padStart(2, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${date.getFullYear()}`;
}

function ensureSelected(selection, id) {
  if (selection.mode === "all") {
    return selection.exclude.includes(id)
      ? { ...selection, exclude: selection.exclude.filter((excludedId) => excludedId !== id) }
      : selection;
  }
  return selection.ids.includes(id) ? selection : { ...selection, ids: [...selection.ids, id] };
}

function isActive(job) {
  return !!job && (job.is_running || job.status === "RUNNING" || job.status === "STOPPING");
}

function statusLine(job) {
  if (!job) return null;
  const n = fmt(job.found_count);
  const name = job.source_name ? ` · ${job.source_name}` : "";
  if (job.status === "RUNNING") return { tone: "run", text: `Đang lấy bài… đã quét được ${n} bài viết${name}` };
  if (job.status === "STOPPING") return { tone: "run", text: `Đang dừng… đã quét được ${n} bài viết${name}` };
  if (job.status === "COMPLETED") {
    return job.error_message
      ? { tone: "warn", text: "\u0110\u00e3 qu\u00e9t xong " + n + " b\u00e0i: " + job.error_message }
      : { tone: "ok", text: "\u0110\u00e3 qu\u00e9t \u0111\u01b0\u1ee3c " + n + " b\u00e0i vi\u1ebft" + name + "." };
  }
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
  if (!text || text === "Bài viết không có nội dung") {
    return "Bài viết không có nội dung";
  }
  return text.replace(/\r?\n+/g, " ");
}

export default function PostSourceFetcher({
  accounts = [],
  selectedUids = [],
  disabled = false,
  targetsVersion = 0,
  onTargetsAdded,
  onFetchRunningChange,
  onAdded,
}) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [job, setJob] = useState(null);
  const [fetchAccountCursor, setFetchAccountCursor] = useState(0);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [list, setList] = useState({ items: [], total: 0, available: true });
  const [loadingList, setLoadingList] = useState(false);
  const [sel, setSel] = useState(emptySelection);
  const [firstN, setFirstN] = useState("3");
  const [adding, setAdding] = useState(false);

  const listSeq = useRef(0);
  const listGeneration = useRef(0);
  const listRefreshPendingRef = useRef(false);
  const loadListRef = useRef(null);
  const loadingListRef = useRef(false);
  const listItemsRef = useRef([]);
  const dragSelectRef = useRef({ active: false, moved: false, startId: null });
  const terminalToastJobsRef = useRef(new Set());
  const sourceKey = job?.source_key || "";
  const running = isActive(job);
  const fetchBusy = running || starting;

  useEffect(() => {
    try {
      const savedCursor = Number(window.localStorage.getItem(FETCH_ACCOUNT_CURSOR_KEY));
      if (Number.isInteger(savedCursor) && savedCursor >= 0) setFetchAccountCursor(savedCursor);
    } catch {
      // Storage có thể bị trình duyệt chặn; khi đó luân phiên trong phiên hiện tại.
    }
  }, []);

  // Mỗi lượt lấy bài dùng tài khoản kế tiếp trong danh sách đã chọn.
  // Nếu job đang chạy thì giữ nguyên tài khoản đã gắn với job đó.
  const scanAccount = useMemo(() => {
    const byUid = new Map(accounts.map((a) => [a.uid, a]));
    if (job?.account_uid && running) return byUid.get(job.account_uid) || { uid: job.account_uid };
    const eligibleUids = selectedUids.filter((uid) => byUid.has(uid));
    if (eligibleUids.length === 0) return null;
    return byUid.get(eligibleUids[fetchAccountCursor % eligibleUids.length]);
  }, [accounts, selectedUids, fetchAccountCursor, job?.account_uid, running]);
  const accountUid = scanAccount?.uid || "";
  const accountLabel = scanAccount ? scanAccount.profile_name || scanAccount.name || scanAccount.uid : "";

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

  // Đổi nguồn / từ khoá → tải lại từ đầu và bỏ lựa chọn ("tất cả kết quả lọc" gắn với từ khoá lúc chọn)
  useEffect(() => {
    listGeneration.current += 1;
    listSeq.current += 1;
    loadingListRef.current = false;
    listRefreshPendingRef.current = false;
    listItemsRef.current = [];
    setList({ items: [], total: 0, available: true });
    setSel(emptySelection());
  }, [sourceKey, q]);

  const loadList = useCallback(async (allPages = true) => {
    const generation = listGeneration.current;
    if (!sourceKey) {
      listItemsRef.current = [];
      setList({ items: [], total: 0, available: true });
      return;
    }
    if (!allPages && loadingListRef.current) {
      listRefreshPendingRef.current = true;
      return;
    }
    if (allPages) listRefreshPendingRef.current = false;
    const seq = ++listSeq.current;
    loadingListRef.current = true;
    setLoadingList(true);
    try {
      // Khi đang quét, chỉ tải trang có bài mới; không tải lại toàn bộ kho ở mỗi lần heartbeat.
      const existingItems = allPages ? [] : listItemsRef.current;
      const firstPage = allPages ? 1 : Math.floor(existingItems.length / PAGE_SIZE) + 1;
      const res = await postFetchApi.listPosts({
        source_key: sourceKey,
        q: q || undefined,
        type: "all",
        page: firstPage,
        page_size: PAGE_SIZE,
      });
      if (seq !== listSeq.current) return;
      let total = Number(res?.total || 0);
      const mergeUnique = (rows) => {
        const byId = new Map();
        rows.forEach((item) => byId.set(item.id, item));
        return [...byId.values()];
      };
      let items = mergeUnique(allPages
        ? (res?.items || [])
        : [...existingItems, ...(res?.items || [])]);
      listItemsRef.current = items;
      setList({ items, total, available: res?.available !== false });

      let pageNumber = firstPage + 1;
      while (pageNumber <= Math.ceil(total / PAGE_SIZE) && items.length < total) {
        const pageRes = await postFetchApi.listPosts({
          source_key: sourceKey,
          q: q || undefined,
          type: "all",
          page: pageNumber,
          page_size: PAGE_SIZE,
        });
        if (seq !== listSeq.current) return;
        total = Number(pageRes?.total ?? total);
        items = mergeUnique([...items, ...(pageRes?.items || [])]);
        listItemsRef.current = items;
        setList({ items, total, available: pageRes?.available !== false });
        pageNumber += 1;
      }
    } catch (err) {
      if (seq === listSeq.current) toast.error(err?.message || "Không tải được danh sách bài viết.", "LỖI TẢI BÀI");
    } finally {
      if (seq === listSeq.current) {
        loadingListRef.current = false;
        setLoadingList(false);
        if (generation === listGeneration.current && listRefreshPendingRef.current) {
          listRefreshPendingRef.current = false;
          window.setTimeout(() => {
            if (generation === listGeneration.current) loadListRef.current?.(false);
          }, 0);
        }
      }
    }
  }, [sourceKey, q]);

  useEffect(() => {
    loadListRef.current = loadList;
  }, [loadList]);

  useEffect(() => {
    loadList();
  }, [loadList, targetsVersion]);

  useEffect(() => {
    const finishDrag = () => {
      const drag = dragSelectRef.current;
      drag.active = false;
      window.setTimeout(() => {
        dragSelectRef.current = { active: false, moved: false, startId: null };
      }, 0);
    };
    window.addEventListener("mouseup", finishDrag);
    return () => window.removeEventListener("mouseup", finishDrag);
  }, []);

  // Đang lấy bài: hỏi tiến độ mỗi 2 giây, có bài mới thì tải lại trang đang xem
  const lastFound = useRef(-1);
  useEffect(() => {
    if (!running || !job?.id) return undefined;
    let stopped = false;
    let busy = false;
    let timer;
    const poll = async () => {
      if (stopped || busy) return;
      busy = true;
      let retryDelay = POLL_MS;
      try {
        const res = await postFetchApi.getJob(job.id);
        const next = res?.job;
        if (next) {
          setJob(next);
          if (!isActive(next)) {
            const terminalKey = `${next.id || job.id}:${next.status}`;
            if (!terminalToastJobsRef.current.has(terminalKey)) {
              terminalToastJobsRef.current.add(terminalKey);
              loadList(true);
              if (next.status === "STOPPED") toast.warning(statusLine(next).text, "ĐÃ DỪNG");
              else if (next.status === "COMPLETED" && next.error_message) toast.warning(statusLine(next).text, "\u0110\u00c3 QU\u00c9T XONG");
              else if (next.status !== "COMPLETED") toast.error(statusLine(next).text, "LẤY BÀI THẤT BẠI");
            }
          } else if (next.found_count !== lastFound.current) {
            lastFound.current = next.found_count;
            loadList(false);
          }
        }
      } catch {
        // Không để request tiến độ chồng lấn khi engine phản hồi chậm hoặc đang khởi động lại.
        retryDelay = POLL_MS * 2;
      } finally {
        busy = false;
        if (!stopped) timer = window.setTimeout(poll, retryDelay);
      }
    };
    poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [running, job?.id, loadList]);

  const chosen = selectedCount(sel, list.total);
  const pickN = Number(firstN);
  const pickValid = Number.isInteger(pickN) && pickN >= 1 && pickN <= 5000;

  const handleStart = async (event) => {
    event?.preventDefault();
    if (disabled || running || starting) return;
    if (!sourceUrl.trim()) {
      toast.warning("Nhập link page hoặc trang cá nhân Facebook.", "THIẾU LINK");
      return;
    }
    if (!accountUid) {
      toast.warning(
        "Hãy tích chọn tài khoản ở mục \"Số lượng tài khoản sử dụng\" — tài khoản quét được lấy từ các tài khoản đã tích chọn.",
        "CHƯA CHỌN TÀI KHOẢN",
      );
      return;
    }
    setStarting(true);
    listSeq.current += 1;
    listItemsRef.current = [];
    setList({ items: [], total: 0, available: true });
    setSel(emptySelection());
    try {
      const res = await postFetchApi.startJob(sourceUrl.trim(), accountUid);
      const eligibleCount = selectedUids.filter((uid) => accounts.some((account) => account.uid === uid)).length;
      if (eligibleCount > 0) {
        const nextCursor = (fetchAccountCursor + 1) % eligibleCount;
        setFetchAccountCursor(nextCursor);
        try {
          window.localStorage.setItem(FETCH_ACCOUNT_CURSOR_KEY, String(nextCursor));
        } catch {
          // Không ảnh hưởng đến lượt lấy bài hiện tại nếu storage không khả dụng.
        }
      }
      lastFound.current = -1;
      setJob(res?.job || null);
      toast.info("Đã bắt đầu lấy bài viết — bài sẽ hiện dần bên dưới.", "ĐANG LẤY BÀI");
    } catch (err) {
      loadList(true);
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

  const handleClearResults = async () => {
    if (!sourceKey || fetchBusy || loadingList) return;
    const seq = ++listSeq.current;
    loadingListRef.current = false;
    setLoadingList(true);
    try {
      await postFetchApi.clearPosts(sourceKey);
      if (seq !== listSeq.current) return;
      listItemsRef.current = [];
      setList({ items: [], total: 0, available: true });
      setSel(emptySelection());
    } catch (err) {
      if (seq === listSeq.current) toast.error(err?.message || "Không xóa được danh sách bài viết.", "LỖI");
    } finally {
      if (seq === listSeq.current) setLoadingList(false);
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
    if (!chosen || adding || fetchBusy) return;
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
          <label className="block space-y-1.5 text-xs text-gray-600">
            <span>Link Page hoặc trang cá nhân Facebook</span>
            <input
              type="text"
              inputMode="url"
              placeholder="https://www.facebook.com/ten-trang"
              maxLength={2048}
              value={sourceUrl}
              disabled={lockInputs}
              onChange={(e) => setSourceUrl(e.target.value.replace(/[\s&]/g, "").slice(0, 2048))}
              className={`${INPUT} block w-full shadow-sm`}
            />
          </label>
          {running ? (
            <button
              type="button"
              onClick={handleStop}
              disabled={stopping || job?.status === "STOPPING"}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
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

        {accountUid ? (
          <p className="text-xs text-gray-500">
            Tài khoản quét lượt này: <b className="font-semibold text-gray-700">{accountLabel}</b> (luân phiên theo các tài khoản đã tích chọn)
          </p>
        ) : (
          <p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            Hãy tích chọn tài khoản ở mục <b>&quot;Số lượng tài khoản sử dụng&quot;</b> — tài khoản quét được lấy từ các tài khoản
            đã tích chọn (cần còn Live và đã đăng nhập).
          </p>
        )}

        {sourceKey && !running && !list.available && (
          <p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            Danh sách bài tạm đã hết hạn — bấm &quot;Lấy danh sách bài viết&quot; để lấy lại.
          </p>
        )}

        {line && (
          <p role="status" className={`flex items-center gap-2 text-xs ${TONE[line.tone]}`}>
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
                <h3 className="text-xs font-bold text-gray-900">Danh sách bài viết</h3>
                <div className="flex items-center gap-2">
                  {list.items.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearResults}
                      disabled={fetchBusy || loadingList}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw className={`size-3 ${loadingList ? "animate-spin" : ""}`} aria-hidden="true" />
                      Làm mới
                    </button>
                  )}
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-gray-600">{fmt(list.total)} kết quả</span>
                </div>
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
                <label className="flex items-center gap-2 text-xs text-gray-500">
                  Số bài
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={firstN}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === "") {
                        setFirstN("");
                        return;
                      }
                      if (!/^\d+$/.test(value)) return;
                      const count = Number(value);
                      if (count >= 1 && count <= 5000) setFirstN(String(count));
                    }}
                    onBlur={() => {
                      if (!pickValid) setFirstN("1");
                    }}
                    className={`${INPUT} w-20 px-2 text-center`}
                  />
                </label>
                <button
                  type="button"
                  onClick={handlePickFirst}
                  disabled={busy || !list.total || !pickValid}
                  className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs text-gray-700 hover:bg-slate-200 disabled:opacity-50"
                >
                  Chọn {pickValid ? fmt(pickN) : "N"} bài
                </button>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs">
                <label className="flex cursor-pointer items-center gap-2 text-gray-700">
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
                  className="shrink-0 px-2 py-1 text-gray-500 hover:text-blue-700 disabled:opacity-50"
                >
                  Bỏ chọn
                </button>
              </div>
            </div>

            <div className="max-h-[52vh] space-y-2 overflow-y-auto overscroll-contain pr-1">
              {loadingList && !list.items.length ? (
                <p className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 p-4 text-xs text-gray-500">
                  <Loader2 className="size-4 animate-spin text-blue-600" aria-hidden="true" /> Đang tải bài viết...
                </p>
              ) : !list.items.length ? (
                <p className="rounded-xl border border-slate-200 p-4 text-center text-xs text-gray-500">
                  {running
                    ? "Đang chờ bài đầu tiên..."
                    : q
                      ? "Không có bài viết khớp với từ khóa."
                      : "Không tìm thấy bài viết có thể đọc từ nguồn này."}
                </p>
              ) : (
                list.items.map((p) => {
                  const checked = p.added || isSelected(sel, p.id);
                  const contentPreview = splitContent(p.content);
                  const date = formatDateOnly(p.published_text) || formatDateOnly(p.published_at) || "\u0043\u0068\u01b0\u0061\u0020\u0111\u1ecdc\u0020\u0111\u01b0\u1ee3c\u0020ng\u00e0y\u0020\u0111\u0103ng";
                  return (
                    <label
                      key={p.id}
                      onMouseDown={(event) => {
                        if (event.button !== 0 || busy || p.added) return;
                        dragSelectRef.current = { active: true, moved: false, startId: p.id };
                      }}
                      onMouseEnter={() => {
                        const drag = dragSelectRef.current;
                        if (!drag.active) return;
                        if (p.id !== drag.startId) drag.moved = true;
                        if (!drag.moved) return;
                        setSel((selection) => ensureSelected(ensureSelected(selection, drag.startId), p.id));
                      }}
                      onClick={(event) => {
                        if (!dragSelectRef.current.moved) return;
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      className={`flex items-center gap-3 rounded-xl border p-3 ${
                        checked && !p.added ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"
                      } ${!p.added && !busy ? "cursor-pointer select-none hover:border-blue-300" : ""}`}
                    >
                      <input
                        type="checkbox"
                        className={CHECKBOX}
                        checked={checked}
                        onChange={() => {
                          if (dragSelectRef.current.moved) return;
                          setSel((s) => toggleOne(s, p.id));
                        }}
                        disabled={busy || p.added}
                      />
                      <span className="min-w-0 space-y-1">
                        <span className="line-clamp-2 break-words text-xs font-bold text-gray-900">{contentPreview}</span>
                        <span className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                          <span className={date.includes("ng\u00e0y") ? "text-amber-700" : ""}>{date}</span>
                          {p.added && <span className="font-medium text-emerald-700">Đã có trong danh sách seeding</span>}
                        </span>
                      </span>
                    </label>
                  );
                })
              )}
              {list.items.length > 0 && loadingList && (
                <div className="flex min-h-9 items-center justify-center gap-2 py-2 text-xs text-gray-500" aria-live="polite">
                  <Loader2 className="size-3.5 animate-spin text-blue-600" aria-hidden="true" />
                  Đang tải toàn bộ danh sách bài viết...
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {sourceKey && (
        <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-white px-5 py-3 sm:px-6">
          <div aria-live="polite">
            <p className="text-xs font-bold text-gray-900">{fmt(chosen)} bài đã chọn</p>
            <p className="text-xs text-gray-500">
              Bài viết chỉ lưu tạm — bấm &quot;Thêm bài viết đã chọn&quot; mới lưu vào danh sách seeding
            </p>
          </div>
          <button type="button" disabled={busy || fetchBusy || !chosen} onClick={handleAdd} className={PRIMARY}>
            {adding ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
            {adding ? "Đang thêm bài viết…" : "Thêm bài viết đã chọn"}
          </button>
        </footer>
      )}
    </>
  );
}
