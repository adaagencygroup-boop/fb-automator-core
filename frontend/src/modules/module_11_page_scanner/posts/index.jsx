"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Users,
  Globe,
  Trash2,
  Play,
  Pause,
  Square,
  Download,
  Search,
  ExternalLink,
  Eye,
  Loader2,
  ThumbsUp,
  MessageSquare,
  FileSpreadsheet,
} from "lucide-react";
import Link from "next/link";
import { toast } from "@/lib/toast";
import { getAccounts } from "@/modules/module_02_account_manager/service";
import { normalizeAccount, initialsOf } from "@/modules/module_07_group_spam/shared/components";
import { AVATAR_COLORS } from "@/modules/module_07_group_spam/shared/constants";
import {
  createPostScanSession,
  getScannedPages,
  getScannedPosts,
  stopScanSession,
  pauseScanSession,
  resumeScanSession,
  getScanSessionDetail,
} from "../service";
import { LiveLogConsole, nowStamp, LIVE_STATUSES } from "../_shared";
import {
  DEFAULT_SCANNED_PAGES,
  SelectAccountsModal,
  SelectPagesModal,
} from "../shared/SelectPagesModal";

const DONE_STATUSES = ["COMPLETED", "PARTIAL", "STOPPED", "FAILED"];

function Stepper({ value, onChange, min = 1, max = 5000, step = 1, disabled, width = "w-8" }) {
  return (
    <div className="flex h-7 items-center rounded-lg border border-[#CBD5E1] bg-white">
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, Number(value || min) - step))}
        className="flex h-full w-5 items-center justify-center rounded-l-lg bg-[#F1F5F9] text-xs font-medium text-[#475569] hover:bg-slate-200 disabled:opacity-40"
      >
        -
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
        className={`${width} bg-transparent text-center text-xs font-medium text-[#1E293B] outline-none disabled:opacity-50`}
      />
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, Number(value || min) + step))}
        className="flex h-full w-5 items-center justify-center rounded-r-lg bg-[#F1F5F9] text-xs font-medium text-[#475569] hover:bg-slate-200 disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

function mapKhoToPage(p, idx = 0) {
  const uid = String(p.page_key || "").replace(/^id:|^user:/, "") || String(idx);
  return {
    id: p.id || p.page_key || `pg_${idx}`,
    page_key: p.page_key,
    page_id: uid,
    page_name: p.page_name || p.page_key,
    name: p.page_name || p.page_key,
    uid,
    page_url: p.page_url,
    category: p.category || "Fanpage",
    follower_count: p.follower_count || 0,
    followers_count: p.follower_count || 0,
    followers_text: p.follower_count ? Number(p.follower_count).toLocaleString("vi-VN") : "—",
    scanned_post_count: p.scanned_post_count || 0,
    posts_count: p.scanned_post_count || 0,
    avatar_initials: initialsOf(p.page_name || p.page_key || "PG"),
    avatar_color: AVATAR_COLORS[idx % AVATAR_COLORS.length],
    status: "QUEUE",
    status_label: "Đang chờ hàng đợi",
  };
}

function padStt(n) {
  return n < 10 ? `0${n}` : String(n);
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString("vi-VN");
}

function normalizePostRow(p, idx = 0) {
  return {
    id: p.id || p.post_id || `post_${idx}`,
    page_key: p.page_key || "",
    content: p.content || p.text || p.message || "(Không có nội dung)",
    post_url: p.post_url || p.url || "",
    published_at: p.published_at || p.posted_at || p.created_at || "",
    likes: Number(p.likes ?? p.reaction_count ?? p.reactions ?? 0),
    comments: Number(p.comments ?? p.comment_count ?? 0),
    shares: Number(p.shares ?? p.share_count ?? 0),
  };
}

export default function PageScannerPosts() {
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [selectedUids, setSelectedUids] = useState([]);
  const [showAccountModal, setShowAccountModal] = useState(false);

  const [availablePages, setAvailablePages] = useState(DEFAULT_SCANNED_PAGES);
  const [selectedPages, setSelectedPages] = useState([]);
  const [showPageModal, setShowPageModal] = useState(false);

  const [delayMin, setDelayMin] = useState(5);
  const [delayMax, setDelayMax] = useState(10);
  const [autoRotateOnCheckpoint, setAutoRotateOnCheckpoint] = useState(true);
  const [postsPerAccountSwitch, setPostsPerAccountSwitch] = useState(50);
  const [maxPostsPerPage, setMaxPostsPerPage] = useState(100);
  const [onlyRecentDays, setOnlyRecentDays] = useState(true);
  const [recentDaysLimit, setRecentDaysLimit] = useState(7);
  const [skipPinnedPosts, setSkipPinnedPosts] = useState(true);
  const [deduplicatePosts, setDeduplicatePosts] = useState(true);
  const keepBrowser = false;

  const [runPhase, setRunPhase] = useState("idle");
  const [sessionId, setSessionId] = useState(null);
  const [resultCount, setResultCount] = useState(0);
  const [logs, setLogs] = useState([]);
  const [scannedPosts, setScannedPosts] = useState([]);
  const [activePageKey, setActivePageKey] = useState(null);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [postSearch, setPostSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("ALL");
  const [likeFilter, setLikeFilter] = useState("ALL");
  const [commentFilter, setCommentFilter] = useState("ALL");
  const [shareFilter, setShareFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("NEWEST");
  const [selectedPostIds, setSelectedPostIds] = useState(new Set());
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [previewPost, setPreviewPost] = useState(null);
  const [postTablePage, setPostTablePage] = useState(1);
  const postPageSize = 5;

  const logId = useRef(0);
  const pollRef = useRef(null);

  const isBusy = runPhase === "running" || runPhase === "paused";
  const isPaused = runPhase === "paused";
  const isExecuting = isBusy;
  const showResults = runPhase !== "idle";

  const pushLog = useCallback((message, type = "info") => {
    logId.current += 1;
    setLogs((prev) => [...prev.slice(-200), { id: logId.current, timestamp: nowStamp(), message, type }]);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const syncSessionLogs = useCallback(
    (session) => {
      let lines = session?.logs;
      if (typeof lines === "string") {
        try {
          lines = JSON.parse(lines);
        } catch {
          lines = [];
        }
      }
      if (!Array.isArray(lines) || !lines.length) return;
      setLogs(
        lines.slice(-500).map((line, i) => ({
          id: `s${session.id || sessionId}_${line.ts}_${i}`,
          timestamp: line.ts || "—",
          message: line.message,
          type:
            line.level === "success"
              ? "success"
              : line.level === "warn"
                ? "warn"
                : line.level === "error"
                  ? "error"
                  : "info",
        })),
      );
    },
    [sessionId],
  );

  const refreshPosts = useCallback(async (sid) => {
    if (!sid) return;
    try {
      const data = await getScannedPosts({ session_id: sid, page: 1, page_size: 200 });
      const items = (data.items || data.posts || []).map(normalizePostRow);
      setScannedPosts(items);
      setResultCount(data.total ?? items.length);
      setLastUpdatedAt(new Date());
    } catch {
      /* ignore */
    }
  }, []);

  const startPoll = useCallback(
    (sid) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const session = await getScanSessionDetail(sid);
          if (session.status === "PAUSED") setRunPhase("paused");
          else if (session.status === "RUNNING") setRunPhase("running");
          syncSessionLogs(session);
          const count = session.total_unique || 0;
          setResultCount(count);
          if (count > 0) refreshPosts(sid);
          if (DONE_STATUSES.includes(session.status)) {
            stopPolling();
            setRunPhase("done");
            await refreshPosts(sid);
            toast.success(
              `Phiên POST_SCAN #${sid} · ${session.status}/${session.stop_reason || "—"} · ${count} bài`,
            );
          }
        } catch (e) {
          console.error(e);
        }
      }, 1500);
    },
    [stopPolling, syncSessionLogs, refreshPosts],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setAccountsLoading(true);
        const data = await getAccounts();
        if (cancelled) return;
        const list = (Array.isArray(data) ? data : data?.accounts || []).map((a, i) =>
          normalizeAccount(a, i),
        );
        setAccounts(list);
        setSelectedUids(list.filter((a) => LIVE_STATUSES.has(String(a.status))).map((a) => a.uid));
      } catch (err) {
        toast.error(`Lỗi tải tài khoản: ${err.message}`);
      } finally {
        if (!cancelled) setAccountsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getScannedPages({ page: 1, page_size: 100, sort_by: "followers" });
        if (cancelled || !data?.items?.length) return;
        const mapped = data.items.map(mapKhoToPage);
        const combined = [...DEFAULT_SCANNED_PAGES];
        for (const m of mapped) {
          if (!combined.some((c) => c.page_key === m.page_key)) combined.push(m);
        }
        setAvailablePages(combined);
      } catch {
        /* keep defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedPages.length) {
      setActivePageKey(null);
      return;
    }
    if (!activePageKey || !selectedPages.some((p) => p.page_key === activePageKey)) {
      setActivePageKey(selectedPages[0].page_key);
    }
  }, [selectedPages, activePageKey]);

  const computeDateFrom = () => {
    if (!onlyRecentDays) return null;
    const d = new Date();
    d.setDate(d.getDate() - Math.max(1, recentDaysLimit));
    return d.toISOString().slice(0, 10);
  };

  const handleStart = async () => {
    try {
      if (!selectedPages.length) throw new Error("Chọn ít nhất 1 Page muốn quét.");
      const live = accounts.filter(
        (a) => selectedUids.includes(a.uid) && LIVE_STATUSES.has(String(a.status)),
      );
      const accountUid = live[0]?.uid || selectedUids[0] || null;
      if (!accountUid) throw new Error("Chọn ít nhất 1 tài khoản Live.");

      const pageKeys = selectedPages.map((p) => p.page_key).filter(Boolean);
      if (!pageKeys.length) throw new Error("Danh sách page thiếu page_key.");

      stopPolling();
      setRunPhase("running");
      setLogs([]);
      setResultCount(0);
      setScannedPosts([]);
      setSelectedPostIds(new Set());
      pushLog(
        `Tạo phiên POST_SCAN · ${pageKeys.length} Page · max/page=${maxPostsPerPage} · delay ${delayMin}-${delayMax}s`,
        "info",
      );

      const res = await createPostScanSession({
        page_keys: pageKeys,
        account_uid: accountUid,
        keep_browser: keepBrowser,
        max_posts_per_page: maxPostsPerPage,
        date_from: computeDateFrom(),
        date_to: null,
        post_types: ["all"],
        idle_timeout_s: 90,
        skip_existing: deduplicatePosts,
        skip_pinned_posts: skipPinnedPosts,
        page_delay_s: delayMin,
        scroll_delay_s: delayMax,
      });

      setSessionId(res.session_id);
      pushLog(`Session #${res.session_id} · ${res.status || "RUNNING"} · ${res.message || "OK"}`, "success");
      if (autoRotateOnCheckpoint) {
        pushLog(`Đảo acc khi checkpoint · đổi sau ${postsPerAccountSwitch} bài/nick`, "info");
      }
      if (skipPinnedPosts) pushLog("Đã bật lọc bỏ bài viết ghim của Quản trị viên.", "info");
      toast.success(`Đã khởi động POST_SCAN #${res.session_id}`);
      startPoll(res.session_id);
    } catch (err) {
      setRunPhase("idle");
      const msg = err.message || "Lỗi tạo phiên";
      toast.error(msg);
      pushLog(msg, "error");
    }
  };

  const handleToggleExecution = () => {
    if (isExecuting) {
      handleStop();
    } else {
      handleStart();
    }
  };

  const handlePauseResume = async () => {
    if (!sessionId) return;
    try {
      if (isPaused) {
        await resumeScanSession(sessionId);
        setRunPhase("running");
        pushLog("Tiếp tục phiên.", "info");
      } else {
        await pauseScanSession(sessionId);
        setRunPhase("paused");
        pushLog("Tạm dừng phiên.", "warn");
      }
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleStop = async () => {
    if (!sessionId) {
      setRunPhase("idle");
      return;
    }
    try {
      await stopScanSession(sessionId);
      pushLog("Dừng khẩn cấp.", "warn");
      stopPolling();
      setRunPhase("done");
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleRemovePage = (pageKey) => {
    setSelectedPages((prev) => prev.filter((p) => p.page_key !== pageKey));
  };

  const postsByPage = useMemo(() => {
    const map = {};
    for (const post of scannedPosts) {
      const key = post.page_key || "_unknown";
      if (!map[key]) map[key] = [];
      map[key].push(post);
    }
    return map;
  }, [scannedPosts]);

  const filteredSidebarPages = useMemo(() => {
    const q = sidebarSearch.trim().toLowerCase();
    return selectedPages.filter((p) => {
      if (!q) return true;
      return `${p.name} ${p.page_id} ${p.page_key}`.toLowerCase().includes(q);
    });
  }, [selectedPages, sidebarSearch]);

  const activePage = selectedPages.find((p) => p.page_key === activePageKey) || selectedPages[0];
  const activePostsRaw = postsByPage[activePage?.page_key] || [];

  const filteredPosts = useMemo(() => {
    let list = [...activePostsRaw];
    const q = postSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          p.content.toLowerCase().includes(q) ||
          String(p.id).toLowerCase().includes(q) ||
          (p.post_url || "").toLowerCase().includes(q),
      );
    }

    const now = Date.now();
    if (dateFilter !== "ALL") {
      const days = dateFilter === "TODAY" ? 1 : dateFilter === "3DAYS" ? 3 : 7;
      const cutoff = now - days * 86400000;
      list = list.filter((p) => {
        const t = Date.parse(p.published_at);
        return Number.isFinite(t) ? t >= cutoff : true;
      });
    }
    if (likeFilter === "GT_500") list = list.filter((p) => p.likes > 500);
    if (likeFilter === "GT_1000") list = list.filter((p) => p.likes > 1000);
    if (commentFilter === "GT_100") list = list.filter((p) => p.comments > 100);
    if (commentFilter === "GT_300") list = list.filter((p) => p.comments > 300);
    if (shareFilter === "GT_50") list = list.filter((p) => p.shares > 50);
    if (shareFilter === "GT_100") list = list.filter((p) => p.shares > 100);

    list.sort((a, b) => {
      if (sortBy === "LIKES_DESC") return b.likes - a.likes;
      if (sortBy === "COMMENTS_DESC") return b.comments - a.comments;
      return String(b.published_at).localeCompare(String(a.published_at));
    });
    return list;
  }, [activePostsRaw, postSearch, dateFilter, likeFilter, commentFilter, shareFilter, sortBy]);

  const allFilteredSelected =
    filteredPosts.length > 0 && filteredPosts.every((p) => selectedPostIds.has(p.id));
  const totalPostPages = Math.max(1, Math.ceil(filteredPosts.length / postPageSize));
  const safePostPage = Math.min(postTablePage, totalPostPages);
  const pagedPosts = filteredPosts.slice(
    (safePostPage - 1) * postPageSize,
    safePostPage * postPageSize,
  );

  const handleToggleSelectAllPosts = () => {
    if (allFilteredSelected) setSelectedPostIds(new Set());
    else setSelectedPostIds(new Set(filteredPosts.map((p) => p.id)));
  };

  const handleToggleSelectPost = (id) => {
    setSelectedPostIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportCsv = (rows, filename) => {
    if (!rows.length) {
      toast.info("Chưa có bài viết để xuất.");
      return;
    }
    const header = ["id", "page_key", "content", "post_url", "published_at", "likes", "comments", "shares"];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        header
          .map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`)
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Đã xuất ${rows.length} bài viết.`);
  };

  const pageStatusMeta = (page) => {
    const count = (postsByPage[page.page_key] || []).length;
    if (runPhase === "running" && activePageKey === page.page_key) {
      return { label: "Đang thu thập...", color: "text-blue-600", status: "RUNNING" };
    }
    if (count > 0 || runPhase === "done") {
      return { label: "Hoàn tất quét", color: "text-emerald-600", status: "DONE" };
    }
    if (isBusy) return { label: "Đang chờ hàng đợi", color: "text-amber-600", status: "QUEUE" };
    return { label: "Chưa quét", color: "text-slate-500", status: "IDLE" };
  };

  const runningPagesCount = useMemo(() => {
    if (!isBusy) return selectedPages.filter((p) => (postsByPage[p.page_key] || []).length > 0).length;
    return Math.max(
      1,
      selectedPages.filter((p) => (postsByPage[p.page_key] || []).length > 0).length,
    );
  }, [isBusy, selectedPages, postsByPage]);

  const lastUpdatedLabel = lastUpdatedAt
    ? lastUpdatedAt.toLocaleTimeString("vi-VN", { hour12: false })
    : "—";

  return (
    <div className="-m-6 min-h-full space-y-5 bg-[#F4F7FC] p-6">
      <div>
        <h1 className="font-heading text-xl font-bold text-[#0B1C30]">Quét bài viết page</h1>
        <p className="mt-1 text-xs text-[#64748B]">
          Tìm kiếm và thu thập bài đăng, liên kết trích xuất và đo lường đa chỉ số tương tác
          (Reactions, Comments, Shares) Fanpage Facebook.
          {sessionId ? (
            <span className="text-[#475569]">
              {" "}
              Phiên #{sessionId}
              {resultCount > 0 ? ` · ${fmtNum(resultCount)} bài` : ""} ·{" "}
            </span>
          ) : (
            " "
          )}
          <Link href="/scanner/list-posts" className="text-[#1877F2] hover:underline">
            Xem DS bài viết
          </Link>
        </p>
      </div>

      {/* SECTION 1 & 2 — Figma 2931-42744 */}
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <section className="space-y-4 rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ">
          <div className="flex items-center gap-2.5 border-b border-[#F1F5F9] pb-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#1877F2] text-[11px] font-bold text-white">
              1
            </span>
            <h2 className="font-heading text-sm font-bold text-[#0B1C30]">
              Cấu hình chung, Chọn tài khoản &amp; Nhóm quét
            </h2>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold tracking-wide text-[#475569] uppercase">
                Tài khoản Facebook thực thi:
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setShowAccountModal(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#1877F2] px-3.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-600 disabled:opacity-50"
                >
                  <Users className="size-3.5" />
                  <span>Chọn tài khoản</span>
                </button>
                <div className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-3 text-xs font-medium text-[#059669]">
                  <span className="size-1.5 shrink-0 rounded-full bg-[#10B981]" />
                  <span>
                    Đã chọn:{" "}
                    <strong className="font-bold text-emerald-950">
                      {selectedUids.length} / {Math.max(accounts.length, 1)}
                    </strong>{" "}
                    tài khoản
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-semibold tracking-wide text-[#475569] uppercase">
                Danh sách nhóm mục tiêu:
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setShowPageModal(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#1877F2] px-3.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-600 disabled:opacity-50"
                >
                  <Globe className="size-3.5" />
                  <span>Chọn page muốn quét</span>
                </button>
                <div className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-3 text-xs font-medium text-[#059669]">
                  <span className="size-1.5 shrink-0 rounded-full bg-[#10B981]" />
                  <span>
                    Đã chọn: <strong className="text-emerald-950">{selectedPages.length} page</strong>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#334155]">
                Khoảng cách giữa các lần quét:
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#64748B]">Từ</span>
                <Stepper
                  value={delayMin}
                  onChange={(v) => {
                    setDelayMin(v);
                    if (v > delayMax) setDelayMax(v);
                  }}
                  min={1}
                  max={180}
                  disabled={isBusy}
                />
                <span className="text-xs text-[#64748B]">-</span>
                <Stepper
                  value={delayMax}
                  onChange={(v) => setDelayMax(Math.max(delayMin, v))}
                  min={1}
                  max={180}
                  disabled={isBusy}
                />
                <span className="text-xs text-[#64748B]">giây</span>
              </div>
            </div>

            <label className="flex cursor-pointer items-start gap-2 select-none">
              <input
                type="checkbox"
                checked={autoRotateOnCheckpoint}
                disabled={isBusy}
                onChange={(e) => setAutoRotateOnCheckpoint(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-slate-300 text-[#1877F2] focus:ring-blue-500"
              />
              <span className="text-xs leading-5 font-medium text-[#334155]">
                Tự động đảo tài khoản khi bị checkpoint hoặc rate limit
              </span>
            </label>
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center gap-2.5 border-b border-[#F1F5F9] pb-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#1877F2] text-[11px] font-bold text-white">
              2
            </span>
            <h2 className="font-heading text-sm font-bold text-[#0B1C30]">
              Cấu hình quét nâng cao &amp; Giới hạn
            </h2>
          </div>

          <div className="space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#334155]">
                Đổi tài khoản mới khi quét được:
              </span>
              <div className="flex items-center gap-2">
                <Stepper
                  value={postsPerAccountSwitch}
                  onChange={setPostsPerAccountSwitch}
                  min={5}
                  max={500}
                  step={5}
                  disabled={isBusy}
                  width="w-10"
                />
                <span className="text-xs text-[#64748B]">bài / nick</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#334155]">Mỗi page quét tối đa:</span>
              <div className="flex items-center gap-2">
                <Stepper
                  value={maxPostsPerPage}
                  onChange={setMaxPostsPerPage}
                  min={10}
                  max={5000}
                  step={10}
                  disabled={isBusy}
                  width="w-10"
                />
                <span className="text-xs text-[#64748B]">bài mới nhất</span>
              </div>
            </div>

            <div className="space-y-2 border-t border-[#F1F5F9] pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex cursor-pointer items-center gap-2 select-none">
                  <input
                    type="checkbox"
                    checked={onlyRecentDays}
                    disabled={isBusy}
                    onChange={(e) => setOnlyRecentDays(e.target.checked)}
                    className="size-4 cursor-pointer rounded border-slate-300 text-[#1877F2] focus:ring-blue-500"
                  />
                  <span className="text-xs font-medium text-[#334155]">
                    Chỉ quét các bài viết đăng trong vòng
                  </span>
                </label>
                <input
                  type="number"
                  disabled={isBusy || !onlyRecentDays}
                  value={recentDaysLimit}
                  onChange={(e) => setRecentDaysLimit(Math.max(1, Number(e.target.value) || 7))}
                  className="h-6 w-12 rounded border border-[#CBD5E1] text-center text-xs font-medium text-[#1E293B] outline-none disabled:bg-slate-100"
                />
                <span className="text-xs text-[#64748B]">ngày qua</span>
              </div>

              <label className="flex cursor-pointer items-center gap-2 select-none">
                <input
                  type="checkbox"
                  checked={skipPinnedPosts}
                  disabled={isBusy}
                  onChange={(e) => setSkipPinnedPosts(e.target.checked)}
                  className="size-4 cursor-pointer rounded border-slate-300 text-[#1877F2] focus:ring-blue-500"
                />
                <span className="text-xs font-medium text-[#334155]">
                  Bỏ qua bài viết ghim của Quản trị viên
                </span>
              </label>

              <label className="flex cursor-pointer items-center gap-2 select-none">
                <input
                  type="checkbox"
                  checked={deduplicatePosts}
                  disabled={isBusy}
                  onChange={(e) => setDeduplicatePosts(e.target.checked)}
                  className="size-4 cursor-pointer rounded border-slate-300 text-[#1877F2] focus:ring-blue-500"
                />
                <span className="text-xs font-medium text-[#334155]">
                  Tự động lọc trùng lặp bài viết giữa các page
                </span>
              </label>
            </div>
          </div>
        </section>
      </div>

      {/* Preview pages */}
      <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F1F5F9] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#EFF6FF] text-[#2563EB]">
              <Eye className="size-4" />
            </div>
            <div className="flex flex-col">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-heading text-sm font-bold text-[#0F172A]">
                  Xem trước danh sách page muốn quét
                </h3>
                <span className="rounded-full bg-[#DBEAFE] px-2.5 py-0.5 text-[11px] font-semibold text-[#1D4ED8]">
                  {selectedPages.length} page đã chọn
                </span>
              </div>
              <p className="text-xs text-[#94A3B8]">
                Kiểm tra ngành nghề và quy mô followers trước khi tiến hành quét
              </p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-xs">
            <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[10px] font-bold tracking-wide text-[#64748B] uppercase">
              <tr>
                <th className="w-14 px-4 py-3 text-center">STT</th>
                <th className="px-4 py-3">TÊN FANPAGE &amp; ID</th>
                <th className="w-44 px-4 py-3">NGÀNH NGHỀ / LOẠI PAGE</th>
                <th className="w-44 px-4 py-3">QUY MÔ / FOLLOWERS</th>
                <th className="w-20 px-4 py-3 text-center">THAO TÁC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {selectedPages.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[#94A3B8]">
                    Chưa chọn Fanpage. Nhấn &ldquo;Chọn page muốn quét&rdquo; để thêm.
                  </td>
                </tr>
              ) : (
                selectedPages.map((page, idx) => (
                  <tr key={page.page_key || page.id} className="transition-colors hover:bg-slate-50">
                    <td className="px-4 py-3 text-center font-bold text-[#94A3B8]">
                      {padStt(idx + 1)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                            page.avatar_color || "bg-indigo-100 text-indigo-700"
                          }`}
                        >
                          {page.avatar_initials || initialsOf(page.name)}
                        </div>
                        <div className="flex min-w-0 flex-col">
                          <span className="line-clamp-1 text-xs font-semibold text-[#0F172A]">
                            {page.name || page.page_name}
                          </span>
                          <span className="font-mono text-[11px] text-[#94A3B8]">
                            UID: {page.page_id || page.uid}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-semibold text-[#475569]">
                        {page.category || "Fanpage"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-[#0F172A]">
                      {page.followers_text || fmtNum(page.follower_count)} Followers
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleRemovePage(page.page_key)}
                        className="rounded p-1 text-[#94A3B8] transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                        title="Xóa page"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* CTA */}
      <div className="space-y-2.5">
        <button
          type="button"
          onClick={handleToggleExecution}
          disabled={!isExecuting && accountsLoading}
          className={`inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-xl text-sm font-bold tracking-wide text-white shadow-sm transition-colors ${
            isExecuting
              ? "bg-[#DC2626] hover:bg-rose-700"
              : "bg-[#004AC6] hover:bg-blue-800 disabled:opacity-60"
          }`}
        >
          {isExecuting ? (
            <>
              <Square className="size-4 fill-white" />
              <span>DỪNG THỰC THI QUÉT BÀI VIẾT</span>
            </>
          ) : (
            <>
              <Play className="size-4 fill-white" />
              <span>BẮT ĐẦU THỰC THI</span>
            </>
          )}
        </button>
        {isBusy && (
          <button
            type="button"
            onClick={handlePauseResume}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[#F59E0B] bg-white text-xs font-bold text-[#D97706] hover:bg-amber-50"
          >
            {isPaused ? (
              <>
                <Play className="size-3.5 fill-current" />
                TIẾP TỤC QUÉT
              </>
            ) : (
              <>
                <Pause className="size-3.5" />
                TẠM DỪNG QUÉT
              </>
            )}
          </button>
        )}
      </div>

      {/* Results — chỉ hiện khi quét xong */}
      {showResults ? (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="font-heading text-base font-bold text-slate-800">
              Kết quả quét bài viết Fanpage
            </h2>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
              Tổng {fmtNum(resultCount || scannedPosts.length)} bài viết
            </span>
          </div>
          <button
            type="button"
            onClick={() => exportCsv(scannedPosts, "toan_bo_bai_viet_fanpage.csv")}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs transition-colors hover:bg-emerald-700"
          >
            <FileSpreadsheet className="size-4" />
            Xuất toàn bộ file Excel
          </button>
        </div>

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
          {/* Left: DANH MỤC PAGE */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs lg:col-span-3">
            <div className="flex items-center justify-between border-b border-slate-100 p-3.5">
              <span className="text-xs font-bold tracking-wider text-slate-700 uppercase">
                DANH MỤC PAGE ({selectedPages.length})
              </span>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                Đang chạy {isBusy ? runningPagesCount : Math.min(runningPagesCount, selectedPages.length)}/
                {selectedPages.length || 0}
              </span>
            </div>

            <div className="border-b border-slate-100 p-3">
              <div className="relative">
                <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={sidebarSearch}
                  onChange={(e) => setSidebarSearch(e.target.value)}
                  placeholder="Tìm tên hoặc ID Fanpage..."
                  className="w-full rounded-lg border border-slate-200 py-1.5 pr-3 pl-8 text-xs focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
              {filteredSidebarPages.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-slate-400">Chưa chọn page</p>
              ) : (
                filteredSidebarPages.map((page, pIdx) => {
                  const isSelected = page.page_key === activePage?.page_key;
                  const count = (postsByPage[page.page_key] || []).length;
                  const st = pageStatusMeta(page);
                  return (
                    <button
                      key={page.page_key}
                      type="button"
                      onClick={() => {
                        setActivePageKey(page.page_key);
                        setPostTablePage(1);
                      }}
                      className={`flex w-full cursor-pointer items-start justify-between gap-2.5 p-3.5 text-left transition-colors ${
                        isSelected
                          ? "border-l-4 border-l-blue-600 bg-blue-50/80"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex min-w-0 items-start gap-2.5">
                        <div
                          className={`flex size-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white ${
                            page.avatar_color || AVATAR_COLORS[pIdx % AVATAR_COLORS.length]
                          }`}
                        >
                          {page.avatar_initials || initialsOf(page.name)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-xs font-bold text-slate-800">{page.name}</div>
                          <div className="mt-0.5 text-[11px] text-slate-400">
                            ID: {page.page_id || page.uid}
                          </div>
                          <div className={`mt-1 text-[11px] font-semibold ${st.color}`}>
                            ● {st.label}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          isSelected ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {count} bài
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right detail */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs lg:col-span-9">
            {activePage ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900">{activePage.name}</h3>
                      <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">
                        {activePage.category || "Fanpage"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Quy mô:{" "}
                      <strong className="text-slate-700">
                        {activePage.followers_text || fmtNum(activePage.follower_count)} Followers
                      </strong>{" "}
                      • Đã quét:{" "}
                      <strong className="text-blue-600">
                        {(postsByPage[activePage.page_key] || []).length} bài viết
                      </strong>{" "}
                      • Cập nhật lúc: {lastUpdatedLabel}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      exportCsv(
                        postsByPage[activePage.page_key] || [],
                        `bai_viet_${activePage.page_id || "page"}.csv`,
                      )
                    }
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-100"
                  >
                    <Download className="size-3.5" />
                    Xuất Page này
                  </button>
                </div>

                <div className="space-y-3 border-b border-slate-100 bg-slate-50/60 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="relative min-w-[240px] flex-1">
                      <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={postSearch}
                        onChange={(e) => setPostSearch(e.target.value)}
                        placeholder="Tìm từ khóa trong nội dung bài viết, ID post, hashtag..."
                        className="w-full rounded-xl border border-slate-200 bg-white py-2 pr-3 pl-9 text-xs focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-500">Sắp xếp:</span>
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none"
                      >
                        <option value="NEWEST">Mới nhất</option>
                        <option value="LIKES_DESC">Lượt Like cao nhất</option>
                        <option value="COMMENTS_DESC">Bình luận nhiều nhất</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <select
                      value={dateFilter}
                      onChange={(e) => setDateFilter(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700"
                    >
                      <option value="ALL">Lọc Ngày Đăng: Tất cả</option>
                      <option value="TODAY">Hôm nay</option>
                      <option value="3DAYS">3 ngày gần đây</option>
                      <option value="7DAYS">7 ngày gần đây</option>
                    </select>
                    <select
                      value={likeFilter}
                      onChange={(e) => setLikeFilter(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700"
                    >
                      <option value="ALL">Lọc Lượt Like: Tất cả</option>
                      <option value="GT_500">Trên 500 Likes</option>
                      <option value="GT_1000">Trên 1.000 Likes</option>
                    </select>
                    <select
                      value={commentFilter}
                      onChange={(e) => setCommentFilter(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700"
                    >
                      <option value="ALL">Lọc Bình Luận: Tất cả</option>
                      <option value="GT_100">Trên 100 Comments</option>
                      <option value="GT_300">Trên 300 Comments</option>
                    </select>
                    <select
                      value={shareFilter}
                      onChange={(e) => setShareFilter(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700"
                    >
                      <option value="ALL">Lọc Lượt Share: Tất cả</option>
                      <option value="GT_50">Trên 50 Shares</option>
                      <option value="GT_100">Trên 100 Shares</option>
                    </select>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase">
                        <th className="w-10 px-3 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={allFilteredSelected}
                            onChange={handleToggleSelectAllPosts}
                            className="size-3.5 rounded border-slate-300 text-blue-600"
                          />
                        </th>
                        <th className="w-12 px-3 py-3">STT</th>
                        <th className="min-w-[260px] px-3 py-3">NỘI DUNG BÀI VIẾT</th>
                        <th className="px-3 py-3">LINK POST</th>
                        <th className="px-3 py-3">NGÀY ĐĂNG</th>
                        <th className="px-3 py-3 text-center">LƯỢT LIKE</th>
                        <th className="px-3 py-3 text-center">BÌNH LUẬN</th>
                        <th className="px-3 py-3 text-center">CHIA SẺ</th>
                        <th className="w-20 px-3 py-3 text-center">THAO TÁC</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {isBusy && filteredPosts.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                            <Loader2 className="mx-auto mb-2 size-5 animate-spin text-blue-600" />
                            Đang thu thập bài viết...
                          </td>
                        </tr>
                      ) : filteredPosts.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                            Không có bài viết nào được thu thập cho page này.
                          </td>
                        </tr>
                      ) : (
                        pagedPosts.map((post, idx) => {
                          const realIdx = (safePostPage - 1) * postPageSize + idx;
                          const url = post.post_url
                            ? post.post_url.startsWith("http")
                              ? post.post_url
                              : `https://${post.post_url}`
                            : "";
                          const dateStr = post.published_at
                            ? String(post.published_at).slice(0, 10)
                            : "—";
                          const timeStr =
                            post.published_at && String(post.published_at).includes("T")
                              ? String(post.published_at).slice(11, 16)
                              : "";
                          return (
                            <tr key={post.id} className="hover:bg-slate-50/80">
                              <td className="px-3 py-3 text-center">
                                <input
                                  type="checkbox"
                                  checked={selectedPostIds.has(post.id)}
                                  onChange={() => handleToggleSelectPost(post.id)}
                                  className="size-3.5 rounded border-slate-300 text-blue-600"
                                />
                              </td>
                              <td className="px-3 py-3 font-mono font-semibold text-slate-500">
                                {String(realIdx + 1).padStart(2, "0")}
                              </td>
                              <td className="max-w-md px-3 py-3">
                                <p className="line-clamp-2 leading-relaxed font-medium text-slate-800">
                                  {post.content}
                                </p>
                                <span className="text-[10px] text-slate-400">
                                  Post ID: {String(post.id).replace(/^p_/, "")}
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                {url ? (
                                  <a
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:underline"
                                  >
                                    {(post.post_url || "").slice(0, 26)}
                                    {(post.post_url || "").length > 26 ? "..." : ""}
                                    <ExternalLink className="size-3" />
                                  </a>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                              <td className="px-3 py-3 whitespace-nowrap">
                                <div className="font-semibold text-slate-700">{dateStr}</div>
                                {timeStr ? (
                                  <div className="text-[11px] text-slate-400">{timeStr}</div>
                                ) : null}
                              </td>
                              <td className="px-3 py-3 text-center">
                                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-bold text-blue-700">
                                  <ThumbsUp className="size-3" />
                                  {fmtNum(post.likes)}
                                </span>
                              </td>
                              <td className="px-3 py-3 text-center">
                                <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2.5 py-0.5 text-[11px] font-bold text-purple-700">
                                  <MessageSquare className="size-3" />
                                  {fmtNum(post.comments)}
                                </span>
                              </td>
                              <td className="px-3 py-3 text-center font-semibold text-slate-600">
                                {fmtNum(post.shares)}
                              </td>
                              <td className="px-3 py-3 text-center">
                                <div className="inline-flex items-center justify-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setPreviewPost(post)}
                                    className="cursor-pointer rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600"
                                    title="Xem chi tiết bài viết"
                                  >
                                    <Eye className="size-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPostsByPage((prev) => ({
                                        ...prev,
                                        [activePage.page_key]: (
                                          prev[activePage.page_key] || []
                                        ).filter((p) => p.id !== post.id),
                                      }));
                                      toast.success("Đã xóa bài viết khỏi danh sách.");
                                    }}
                                    className="cursor-pointer rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                                    title="Xóa bài viết"
                                  >
                                    <Trash2 className="size-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
                  <span>
                    Hiển thị{" "}
                    <strong>
                      {filteredPosts.length === 0
                        ? 0
                        : `${(safePostPage - 1) * postPageSize + 1} - ${Math.min(
                            safePostPage * postPageSize,
                            filteredPosts.length,
                          )}`}
                    </strong>{" "}
                    trong tổng số{" "}
                    <strong>
                      {(postsByPage[activePage.page_key] || []).length || filteredPosts.length}
                    </strong>{" "}
                    bài viết
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={safePostPage <= 1}
                      onClick={() => setPostTablePage((p) => Math.max(1, p - 1))}
                      className="rounded border border-slate-200 px-2.5 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    >
                      Trước
                    </button>
                    {Array.from({ length: totalPostPages }, (_, i) => i + 1)
                      .slice(0, 5)
                      .map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setPostTablePage(p)}
                          className={`rounded px-2.5 py-1 font-bold ${
                            p === safePostPage
                              ? "bg-blue-600 text-white"
                              : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    <button
                      type="button"
                      disabled={safePostPage >= totalPostPages}
                      onClick={() => setPostTablePage((p) => Math.min(totalPostPages, p + 1))}
                      className="rounded border border-slate-200 px-2.5 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    >
                      Sau
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-400">
                Chọn page ở cột trái để xem kết quả
              </div>
            )}
          </div>
        </div>
      </div>
      ) : null}

      {previewPost ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-900">Chi tiết bài viết</h3>
              <button
                type="button"
                onClick={() => setPreviewPost(null)}
                className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100"
              >
                Đóng
              </button>
            </div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700">
              {previewPost.content}
            </p>
            <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-500">
              <span>Like: {fmtNum(previewPost.likes)}</span>
              <span>Cmt: {fmtNum(previewPost.comments)}</span>
              <span>Share: {fmtNum(previewPost.shares)}</span>
            </div>
            {previewPost.post_url ? (
              <a
                href={
                  previewPost.post_url.startsWith("http")
                    ? previewPost.post_url
                    : `https://${previewPost.post_url}`
                }
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
              >
                Mở trên Facebook <ExternalLink className="size-3" />
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {(runPhase !== "idle" || logs.length > 0) && (
        <LiveLogConsole title="Live Log · Quét bài viết page" logs={logs} phase={runPhase} />
      )}

      <SelectAccountsModal
        open={showAccountModal}
        onClose={() => setShowAccountModal(false)}
        accounts={accounts}
        loading={accountsLoading}
        selectedUids={selectedUids}
        onConfirm={(uids) => {
          setSelectedUids(uids);
          setShowAccountModal(false);
        }}
      />

      <SelectPagesModal
        open={showPageModal}
        onClose={() => setShowPageModal(false)}
        availablePages={availablePages}
        selectedPages={selectedPages}
        onConfirm={(pages) => {
          setSelectedPages(pages.map((p, i) => mapKhoToPage(p, i)));
          setShowPageModal(false);
        }}
      />
    </div>
  );
}
