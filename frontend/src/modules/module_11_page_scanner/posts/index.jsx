"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Users,
  Globe,
  Trash2,
  Search,
  ExternalLink,
  Eye,
  Loader2,
  FileSpreadsheet,
} from "lucide-react";
import Link from "next/link";
import { toast } from "@/lib/toast";
import { getAccounts } from "@/modules/module_02_account_manager/service";
import { AvatarImage } from "@/components/ui/avatar";
import { normalizeAccount, initialsOf } from "@/modules/module_07_group_spam/shared/components";
import { AVATAR_COLORS } from "@/modules/module_07_group_spam/shared/constants";
import {
  createPostScanSession,
  deleteScannedPosts,
  getActiveCampaign,
  getScannedPages,
  getScannedPosts,
  getSessionPostPages,
  stopScanSession,
  pauseScanSession,
  resumeScanSession,
  getScanSessionDetail,
} from "../service";
import { LiveLogConsole, nowStamp, LIVE_STATUSES, Pager, parseJsonField, runDelete, notifyExportResult } from "../_shared";
import { SelectAccountsModal, SelectPagesModal, isAccountUsable } from "../shared/SelectPagesModal";
import {
  loadSavedAccountUids,
  saveSelectedAccountUids,
  resolveUsableSavedUids,
} from "../shared/accountStorage";
import { ScanActionButtons } from "../shared/ScanActionButtons";
import { clearScanState, fetchSavedSessions, loadScanState, saveScanState } from "../shared/scanStateStorage";
import { useActionLock } from "../shared/useActionLock";
import { saveCsvContent } from "../shared/saveFile.mjs";
import { localIsoDate, toCsv } from "../utils.mjs";

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
    avatar_url: p.avatar_url || "",
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
    published_at: p.published_at || "",
    published_text: p.published_text || "",
    likes: Number(p.likes ?? p.reaction_count ?? p.reactions ?? 0),
    comments: Number(p.comments ?? p.comment_count ?? 0),
    shares: Number(p.shares ?? p.share_count ?? 0),
  };
}

/* Bộ lọc bảng kết quả (ảnh: Lọc Ngày Đăng / Lượt Like / Bình Luận / Lượt Share) — lọc phía server */
const POST_PAGE_SIZE = 5;
const DATE_FILTERS = [
  ["ALL", "Tất cả thời gian"],
  ["1", "Hôm nay"],
  ["3", "3 ngày qua"],
  ["7", "7 ngày qua"],
  ["30", "30 ngày qua"],
];
const LIKE_FILTERS = [
  ["ALL", "Tất cả like"],
  ["501", "> 500 Like"],
  ["1001", "> 1.000 Like"],
];
const COMMENT_FILTERS = [
  ["ALL", "Tất cả bình luận"],
  ["101", "> 100 bình luận"],
  ["301", "> 300 bình luận"],
];
const SHARE_FILTERS = [
  ["ALL", "Tất cả share"],
  ["51", "> 50 share"],
  ["101", "> 100 share"],
];
const POST_SORTS = [
  ["newest", "Mới nhất"],
  ["likes", "Lượt Like cao nhất"],
  ["comments", "Bình luận nhiều nhất"],
];

const optNum = (v) => (v === "ALL" ? undefined : Number(v));

/** Ngày đăng → "dd/mm/yyyy" (ngày lưu trong kho không có giờ). */
function fmtPostDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

/** "https://www.facebook.com/x/posts/123" → "fb.com/x/posts/123" */
function shortFbUrl(url) {
  return String(url || "").replace(/^https?:\/\/(www\.|m\.|web\.)?facebook\.com\//, "fb.com/");
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-medium text-[#475569]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-[#E2E8F0] bg-white px-3 text-xs text-[#1E293B] outline-none focus:border-[#2563EB]"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function PageScannerPosts() {
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [selectedUids, setSelectedUids] = useState([]);
  const [showAccountModal, setShowAccountModal] = useState(false);

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
  const [pagePostCounts, setPagePostCounts] = useState({}); // page_key -> số bài của phiên
  const [tableRows, setTableRows] = useState([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableTick, setTableTick] = useState(0);
  const [activePageKey, setActivePageKey] = useState(null);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [postSearch, setPostSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("ALL");
  const [likeFilter, setLikeFilter] = useState("ALL");
  const [commentFilter, setCommentFilter] = useState("ALL");
  const [shareFilter, setShareFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("newest");
  const [selectedPostIds, setSelectedPostIds] = useState(new Set());
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [previewPost, setPreviewPost] = useState(null);
  const [postTablePage, setPostTablePage] = useState(1);

  const logId = useRef(0);
  const pollRef = useRef(null);
  // Khoá nút trong lúc xử lý: bấm liên tục chỉ chạy 1 lần, không bắn ra nhiều thông báo / yêu cầu
  const [isToggling, guardToggle] = useActionLock();
  const [isPausing, guardPause] = useActionLock();
  const [isExportingPage, guardExportPage, isExportingPageApi] = useActionLock();
  const [isDeleting, guardDelete] = useActionLock();
  const restoreSeqRef = useRef(0); // tăng khi bắt đầu / quét mới / rời trang → bỏ kết quả khôi phục về muộn

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

  /** Số bài theo từng Page của phiên (cột trái) + làm mới bảng đang xem. */
  const refreshPosts = useCallback(async (sid) => {
    if (!sid) return;
    try {
      const data = await getSessionPostPages(sid);
      setPagePostCounts(
        Object.fromEntries((data.items || []).map((r) => [r.page_key, Number(r.post_count) || 0])),
      );
      setResultCount(Number(data.total_posts) || 0);
      setLastUpdatedAt(new Date());
      setTableTick((n) => n + 1);
    } catch {
      /* lần poll sau thử lại */
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
        const saved = loadSavedAccountUids("posts");
        if (saved && saved.length) {
          const usable = resolveUsableSavedUids(saved, list);
          setSelectedUids(usable);
        } else {
          setSelectedUids([]);
        }
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

  /* Khôi phục phiên POST_SCAN đang chạy; không có thì phiên quét xong gần nhất (giống Module 3) */
  useEffect(() => {
    const seq = ++restoreSeqRef.current;
    const stale = () => seq !== restoreSeqRef.current;
    (async () => {
      try {
        const saved = loadScanState("posts");
        const data = await getActiveCampaign("POST_SCAN").catch(() => null);
        if (stale()) return;
        const sessions =
          data?.active && data.sessions?.length
            ? data.sessions
            : await fetchSavedSessions("posts", saved?.sessionIds);
        if (stale() || !sessions.length) return;
        const top = sessions.find((s) => s.id === data?.primary_session_id) || sessions[sessions.length - 1];
        const isDone = DONE_STATUSES.includes(top.status);
        const cfg = (saved?.sessionIds || []).includes(top.id) ? saved.config || {} : {};
        const settings = parseJsonField(top.settings, {});
        const pageKeys = (settings.page_keys || []).filter(Boolean);
        let kho = [];
        try {
          kho = (await getScannedPages({ page: 1, page_size: 200, sort_by: "followers" })).items || [];
        } catch {
          kho = [];
        }
        if (stale()) return;
        // Page ngoài 200 dòng đầu của kho: lấy thông tin từ lựa chọn đã lưu
        const byKey = new Map([...(cfg.selectedPages || []), ...kho].map((p) => [p.page_key, p]));
        setSelectedPages(pageKeys.map((pk, i) => mapKhoToPage(byKey.get(pk) || { page_key: pk }, i)));
        if (settings.max_posts_per_page) setMaxPostsPerPage(Number(settings.max_posts_per_page));
        if (typeof settings.skip_existing === "boolean") setDeduplicatePosts(settings.skip_existing);
        if (cfg.selectedPages !== undefined) {
          // Lựa chọn lưu cũ chưa có avatar / link ảnh có thể hết hạn → ưu tiên avatar trong kho
          setSelectedPages(
            cfg.selectedPages.map((p) => ({
              ...p,
              avatar_url: byKey.get(p.page_key)?.avatar_url || p.avatar_url || "",
            })),
          );
        }
        if (cfg.delayMin !== undefined) setDelayMin(cfg.delayMin);
        if (cfg.delayMax !== undefined) setDelayMax(cfg.delayMax);
        if (cfg.autoRotateOnCheckpoint !== undefined) setAutoRotateOnCheckpoint(cfg.autoRotateOnCheckpoint);
        if (cfg.postsPerAccountSwitch !== undefined) setPostsPerAccountSwitch(cfg.postsPerAccountSwitch);
        if (cfg.maxPostsPerPage !== undefined) setMaxPostsPerPage(cfg.maxPostsPerPage);
        if (cfg.onlyRecentDays !== undefined) setOnlyRecentDays(cfg.onlyRecentDays);
        if (cfg.recentDaysLimit !== undefined) setRecentDaysLimit(cfg.recentDaysLimit);
        if (cfg.skipPinnedPosts !== undefined) setSkipPinnedPosts(cfg.skipPinnedPosts);
        if (cfg.deduplicatePosts !== undefined) setDeduplicatePosts(cfg.deduplicatePosts);
        if (cfg.activePageKey !== undefined) setActivePageKey(cfg.activePageKey);
        setSessionId(top.id);
        setResultCount(top.total_unique || 0);
        setRunPhase(isDone ? "done" : top.status === "PAUSED" ? "paused" : "running");
        syncSessionLogs(top);
        saveScanState("posts", { sessionIds: [top.id] });
        const statusVi =
          {
            RUNNING: "đang chạy",
            PAUSED: "đang tạm dừng",
            COMPLETED: "hoàn tất",
            PARTIAL: "một phần",
            STOPPED: "đã dừng",
            FAILED: "lỗi",
          }[String(top.status || "").toUpperCase()] || "đang chạy";
        pushLog(`Đã khôi phục phiên quét bài viết #${top.id} (${statusVi}).`, "info");
        refreshPosts(top.id);
        if (!isDone) startPoll(top.id);
      } catch {
        /* không có phiên đang chạy */
      }
    })();
    return () => {
      restoreSeqRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    return localIsoDate(d); // ngày theo giờ máy (toISOString là UTC → lệch 1 ngày trước 7h sáng)
  };

  const handleStart = () => {
    if (!selectedUids || !selectedUids.length) {
      toast.warning("Chưa chọn tài khoản", { key: "m11-posts-start" });
      return;
    }
    const usable = accounts.filter((a) => selectedUids.includes(a.uid) && isAccountUsable(a));
    if (!usable.length) {
      toast.warning("Không có tài khoản khả dụng (Live & Đã đăng nhập) trong danh sách đã chọn.", {
        key: "m11-posts-start",
      });
      return;
    }
    if (!selectedPages.length) {
      toast.warning("Chọn ít nhất 1 Page muốn quét.", { key: "m11-posts-start" });
      return;
    }
    const pageKeys = selectedPages.map((p) => p.page_key).filter(Boolean);
    if (!pageKeys.length) {
      toast.warning("Danh sách page thiếu page_key.", { key: "m11-posts-start" });
      return;
    }

    return (async () => {
      try {
        // Thứ tự xoay vòng = thứ tự acc Live đã chọn
        const accountUids = usable.map((a) => a.uid);
        const accountUid = accountUids[0];

        restoreSeqRef.current += 1;
        stopPolling();
        setRunPhase("running");
        setLogs([]);
        setResultCount(0);
        setPagePostCounts({});
        setTableRows([]);
        setTableTotal(0);
        setPostTablePage(1);
        setSelectedPostIds(new Set());
        pushLog(
          `Đang khởi tạo phiên quét bài viết cho ${pageKeys.length} Page (tối đa ${maxPostsPerPage.toLocaleString("vi-VN")} bài/Page · nghỉ ${delayMin}–${delayMax} giây)…`,
          "info",
        );

        const res = await createPostScanSession({
          page_keys: pageKeys,
          account_uid: accountUid,
          account_uids: accountUids,
          rotate_every: postsPerAccountSwitch,
          rotate_on_checkpoint: autoRotateOnCheckpoint,
          keep_browser: keepBrowser,
          max_posts_per_page: maxPostsPerPage,
          date_from: computeDateFrom(),
          date_to: null,
          post_types: ["all"],
          idle_timeout_s: 90,
          skip_existing: deduplicatePosts,
          skip_pinned_posts: skipPinnedPosts,
          // "Khoảng cách giữa các lần quét" = giãn cách ngẫu nhiên giữa 2 Page (không phải mỗi lần cuộn)
          page_delay_min_s: delayMin,
          page_delay_max_s: delayMax,
        });

        saveScanState("posts", { sessionIds: [res.session_id] });
        setSessionId(res.session_id);
        pushLog(`Đã bắt đầu phiên quét #${res.session_id}.`, "success");
        if (accountUids.length > 1) {
          pushLog(
            `Xoay vòng ${accountUids.length} tài khoản · đổi sau ${postsPerAccountSwitch} bài/tài khoản` +
              (autoRotateOnCheckpoint ? " · tự đổi khi gặp checkpoint" : "") +
              ".",
            "info",
          );
        }
        if (skipPinnedPosts) pushLog("Bỏ qua bài viết ghim của Quản trị viên.", "info");
        toast.success(`Đã bắt đầu quét bài viết (phiên #${res.session_id}).`, { key: "m11-posts-start" });
        startPoll(res.session_id);
      } catch (err) {
        setRunPhase("idle");
        const msg = err.message || "Lỗi tạo phiên";
        toast.error(msg, { key: "m11-posts-start" });
        pushLog(msg, "error");
      }
    })();
  };

  const handleToggleExecution = () => (isExecuting ? handleStop() : handleStart());

  /* Lưu cấu hình kèm phiên đang xem để vào lại trang vẫn còn */
  const configJson = JSON.stringify({
    selectedPages,
    delayMin,
    delayMax,
    autoRotateOnCheckpoint,
    postsPerAccountSwitch,
    maxPostsPerPage,
    onlyRecentDays,
    recentDaysLimit,
    skipPinnedPosts,
    deduplicatePosts,
    activePageKey,
  });
  useEffect(() => {
    if (runPhase !== "idle") saveScanState("posts", { config: JSON.parse(configJson) });
  }, [runPhase, configJson]);

  /** "Quét mới": bỏ phiên đang xem (dữ liệu trong kho không bị xóa). */
  const handleNewScan = () => {
    restoreSeqRef.current += 1;
    stopPolling();
    clearScanState("posts");
    setRunPhase("idle");
    setSessionId(null);
    setLogs([]);
    setResultCount(0);
    setPagePostCounts({});
    setTableRows([]);
    setTableTotal(0);
    setPostTablePage(1);
    setSelectedPostIds(new Set());
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
      toast.error(err.message, { key: "m11-posts-pause" });
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
      toast.error(err.message, { key: "m11-posts-stop" });
    }
  };

  const handleRemovePage = (pageKey) => {
    setSelectedPages((prev) => prev.filter((p) => p.page_key !== pageKey));
  };

  const filteredSidebarPages = useMemo(() => {
    const q = sidebarSearch.trim().toLowerCase();
    return selectedPages.filter((p) => !q || `${p.name} ${p.page_id} ${p.page_key}`.toLowerCase().includes(q));
  }, [selectedPages, sidebarSearch]);

  const activePage = selectedPages.find((p) => p.page_key === activePageKey) || selectedPages[0];
  const pageCount = (key) => Number(pagePostCounts[key]) || 0;

  /* Bảng bài viết của Page đang xem — phân trang, lọc, sắp xếp phía server (không giới hạn 200 bài) */
  useEffect(() => {
    if (!sessionId || !activePage?.page_key) {
      setTableRows([]);
      setTableTotal(0);
      return undefined;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setTableLoading(true);
      try {
        const data = await getScannedPosts({
          session_id: sessionId,
          page_key: activePage.page_key,
          page: postTablePage,
          page_size: POST_PAGE_SIZE,
          keyword: postSearch.trim() || undefined,
          days: optNum(dateFilter),
          min_reactions: optNum(likeFilter),
          min_comments: optNum(commentFilter),
          min_shares: optNum(shareFilter),
          sort_by: sortBy,
        });
        if (cancelled) return;
        setTableRows((data.items || []).map(normalizePostRow));
        setTableTotal(Number(data.total) || 0);
      } catch (err) {
        if (!cancelled) toast.error(`Lỗi tải bài viết: ${err.message}`);
      } finally {
        if (!cancelled) setTableLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [sessionId, activePage?.page_key, postTablePage, postSearch, dateFilter, likeFilter, commentFilter, shareFilter, sortBy, tableTick]);

  const totalPostPages = Math.max(1, Math.ceil(tableTotal / POST_PAGE_SIZE));
  const allRowsSelected = tableRows.length > 0 && tableRows.every((p) => selectedPostIds.has(p.id));

  const handleToggleSelectAllPosts = () => {
    setSelectedPostIds((prev) => {
      const next = new Set(prev);
      tableRows.forEach((p) => (allRowsSelected ? next.delete(p.id) : next.add(p.id)));
      return next;
    });
  };

  const handleToggleSelectPost = (id) => {
    setSelectedPostIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** "Xuất Page này" — toàn bộ bài viết của Page trong phiên (tải nối tiếp, không chỉ trang đang xem). */
  const handleExportActivePage = async () => {
    if (!sessionId || !activePage) return;
    try {
      const rows = [];
      for (let p = 1; p <= 50; p += 1) {
        const data = await getScannedPosts({
          session_id: sessionId,
          page_key: activePage.page_key,
          page: p,
          page_size: 200,
          sort_by: sortBy,
        });
        const batch = data.items || [];
        rows.push(...batch.map(normalizePostRow));
        if (!batch.length || rows.length >= (Number(data.total) || 0)) break;
      }
      if (!rows.length) {
        toast.info("Page này chưa có bài viết để xuất.", { key: "m11-posts-export" });
        return;
      }
      const csv = toCsv(
        ["STT", "Nội dung", "Link bài viết", "Ngày đăng", "Thời gian (FB)", "Lượt like", "Bình luận", "Chia sẻ"],
        rows.map((r, i) => [i + 1, r.content, r.post_url, fmtPostDate(r.published_at), r.published_text, r.likes, r.comments, r.shares]),
      );
      const res = await saveCsvContent(csv, `bai_viet_${String(activePage.page_key).replace(/[:/\\]/g, "_")}.csv`);
      notifyExportResult(res, {
        successMessage: `Đã xuất ${rows.length.toLocaleString("vi-VN")} bài viết thành công.`,
        key: "m11-posts-export",
      });
    } catch (err) {
      toast.error(`Lỗi xuất bài viết: ${err.message}`, { key: "m11-posts-export" });
    }
  };

  /* Trạng thái từng Page ở cột trái: Page cuối cùng đã có bài = đang thu thập, trước đó = hoàn tất */
  let lastScannedIdx = -1;
  selectedPages.forEach((p, i) => {
    if (pageCount(p.page_key) > 0) lastScannedIdx = i;
  });
  const pageStatusMeta = (page, idx) => {
    if (isBusy) {
      const cur = Math.max(0, lastScannedIdx);
      if (idx < cur) return { label: "Hoàn tất quét", color: "text-[#059669]" };
      if (idx === cur) {
        return isPaused
          ? { label: "Tạm dừng", color: "text-[#D97706]" }
          : { label: "Đang thu thập...", color: "text-[#2563EB]" };
      }
      return { label: "Đang chờ hàng đợi", color: "text-[#EA580C]" };
    }
    if (pageCount(page.page_key) > 0) return { label: "Hoàn tất quét", color: "text-[#059669]" };
    return runPhase === "done"
      ? { label: "Không có bài mới", color: "text-[#64748B]" }
      : { label: "Chưa quét", color: "text-[#64748B]" };
  };
  const processedPages = isBusy
    ? Math.min(selectedPages.length, Math.max(1, lastScannedIdx + 1))
    : selectedPages.filter((p) => pageCount(p.page_key) > 0).length;

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
              <p className="text-xs font-medium text-[#334155]">
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
              <p className="text-xs font-medium text-[#334155]">
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

            <div className="space-y-2">
              <span className="block text-xs font-medium text-[#334155]">
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
                Danh sách các trang đã được lập trình sẵn sàng quét bài viết
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
                          className={`relative flex overflow-hidden size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                            page.avatar_color || "bg-indigo-100 text-indigo-700"
                          }`}
                        >
                          {page.avatar_initials || initialsOf(page.name)}
                          <AvatarImage
                            src={page.avatar_url}
                            className="absolute inset-0"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
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
                      <span className="text-xs text-[#334155]">{page.category || "Fanpage"}</span>
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
      <ScanActionButtons
        live={isBusy}
        paused={isPaused}
        showNewScan={showResults}
        startDisabled={isToggling || accountsLoading}
        controlDisabled={isToggling || isPausing}
        onStart={() => guardToggle(handleToggleExecution)}
        onPauseResume={() => guardPause(handlePauseResume)}
        onStop={() => guardToggle(handleToggleExecution)}
        onNewScan={handleNewScan}
      />

      {/* Kết quả — ảnh "Quét bài viết page" */}
      {showResults ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-heading text-base font-bold text-[#0F172A]">Kết quả quét bài viết Fanpage</h2>
            <span className="rounded-full bg-[#E2E8F0] px-3 py-1 text-xs font-semibold text-[#334155]">
              Tổng {fmtNum(resultCount)} bài viết
            </span>
          </div>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
            {/* Trái: DANH MỤC PAGE */}
            <div className="flex min-h-[560px] flex-col overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white lg:col-span-4">
              <div className="flex items-center justify-between px-4 pt-4 pb-3">
                <span className="text-xs font-bold tracking-wide text-[#334155] uppercase">
                  Danh mục Page ({selectedPages.length})
                </span>
                <span className="rounded-md bg-[#DBEAFE] px-2 py-0.5 text-[11px] font-semibold text-[#1D4ED8]">
                  {isBusy ? "Đang chạy" : "Đã quét"} {processedPages}/{selectedPages.length}
                </span>
              </div>
              <div className="px-4 pb-3">
                <div className="relative">
                  <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[#94A3B8]" />
                  <input
                    type="text"
                    value={sidebarSearch}
                    onChange={(e) => setSidebarSearch(e.target.value)}
                    placeholder="Tìm tên hoặc ID Fanpage..."
                    className="h-9 w-full rounded-lg border border-[#E2E8F0] pr-3 pl-8 text-xs outline-none focus:border-[#2563EB]"
                  />
                </div>
              </div>
              <div className="flex-1 space-y-2.5 overflow-y-auto px-4 pb-4">
                {filteredSidebarPages.length === 0 ? (
                  <p className="py-8 text-center text-xs text-[#94A3B8]">Chưa chọn page</p>
                ) : (
                  filteredSidebarPages.map((page) => {
                    const idx = selectedPages.findIndex((p) => p.page_key === page.page_key);
                    const isSelected = page.page_key === activePage?.page_key;
                    const st = pageStatusMeta(page, idx);
                    return (
                      <button
                        key={page.page_key}
                        type="button"
                        onClick={() => {
                          setActivePageKey(page.page_key);
                          setPostTablePage(1);
                        }}
                        className={`flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition ${
                          isSelected
                            ? "border-2 border-[#2563EB] bg-white shadow-sm"
                            : "border-[#E2E8F0] bg-white hover:bg-[#F8FAFC]"
                        }`}
                      >
                        <div
                          className={`relative flex overflow-hidden size-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white ${
                            page.avatar_color || AVATAR_COLORS[idx % AVATAR_COLORS.length]
                          }`}
                        >
                          {page.avatar_initials || initialsOf(page.name)}
                          <AvatarImage
                            src={page.avatar_url}
                            className="absolute inset-0"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-bold text-[#0F172A]">{page.name}</div>
                          <div className={`mt-0.5 text-[11px] font-medium ${st.color}`}>{st.label}</div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
                            isSelected
                              ? "border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]"
                              : "border-[#E2E8F0] bg-[#F8FAFC] text-[#334155]"
                          }`}
                        >
                          {fmtNum(pageCount(page.page_key))} bài
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Phải: bài viết của Page đang xem */}
            <div className="overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white lg:col-span-8">
              {activePage ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-3">
                    <div>
                      <h3 className="font-heading text-base font-bold text-[#0F172A]">{activePage.name}</h3>
                      <p className="mt-0.5 text-xs text-[#64748B]">
                        Quy mô:{" "}
                        <strong className="text-[#0F172A]">
                          {activePage.followers_text || fmtNum(activePage.follower_count)} Followers
                        </strong>{" "}
                        • Đã quét: <strong className="text-[#2563EB]">{fmtNum(pageCount(activePage.page_key))}</strong> bài viết •
                        Cập nhật lúc: {lastUpdatedLabel}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => guardExportPage(handleExportActivePage)}
                      disabled={isExportingPage}
                      aria-busy={isExportingPageApi}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#BFDBFE] bg-white px-3.5 py-2 text-xs font-semibold text-[#1D4ED8] transition hover:bg-[#EFF6FF] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isExportingPageApi ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
                      {isExportingPageApi ? "Đang xuất…" : "Xuất Page này"}
                    </button>
                  </div>

                  <div className="space-y-3 border-b border-[#F1F5F9] px-5 pb-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="relative min-w-[240px] flex-1">
                        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#94A3B8]" />
                        <input
                          type="text"
                          value={postSearch}
                          onChange={(e) => {
                            setPostSearch(e.target.value);
                            setPostTablePage(1);
                          }}
                          placeholder="Tìm kiếm nội dung bài viết, hashtag (#sofa, #salong), SĐT..."
                          className="h-9 w-full rounded-lg border border-[#E2E8F0] bg-white pr-3 pl-9 text-xs outline-none focus:border-[#2563EB]"
                        />
                      </div>
                      <select
                        value={sortBy}
                        onChange={(e) => {
                          setSortBy(e.target.value);
                          setPostTablePage(1);
                        }}
                        className="h-9 min-w-[200px] rounded-lg border border-[#E2E8F0] bg-white px-3 text-xs font-medium text-[#1E293B] outline-none"
                      >
                        {POST_SORTS.map(([v, l]) => (
                          <option key={v} value={v}>
                            Sắp xếp: {l}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <FilterSelect
                        label="Lọc Ngày Đăng:"
                        value={dateFilter}
                        options={DATE_FILTERS}
                        onChange={(v) => {
                          setDateFilter(v);
                          setPostTablePage(1);
                        }}
                      />
                      <FilterSelect
                        label="Lọc Lượt Like:"
                        value={likeFilter}
                        options={LIKE_FILTERS}
                        onChange={(v) => {
                          setLikeFilter(v);
                          setPostTablePage(1);
                        }}
                      />
                      <FilterSelect
                        label="Lọc Bình Luận:"
                        value={commentFilter}
                        options={COMMENT_FILTERS}
                        onChange={(v) => {
                          setCommentFilter(v);
                          setPostTablePage(1);
                        }}
                      />
                      <FilterSelect
                        label="Lọc Lượt Share:"
                        value={shareFilter}
                        options={SHARE_FILTERS}
                        onChange={(v) => {
                          setShareFilter(v);
                          setPostTablePage(1);
                        }}
                      />
                    </div>
                  </div>

                  <div className="overflow-x-auto px-5 pt-3">
                    <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#F1F5F9] text-[11px] font-bold text-[#475569] uppercase">
                          <th className="w-10 px-2 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={allRowsSelected}
                              onChange={handleToggleSelectAllPosts}
                              className="size-3.5 rounded border-slate-300 text-blue-600"
                            />
                          </th>
                          <th className="w-12 px-2 py-3">STT</th>
                          <th className="min-w-[160px] px-2 py-3">Nội dung bài viết</th>
                          <th className="px-2 py-3">Link post</th>
                          <th className="px-2 py-3 text-center">Ngày đăng</th>
                          <th className="px-2 py-3 text-center">Lượt like</th>
                          <th className="px-2 py-3 text-center">Bình luận</th>
                          <th className="px-2 py-3 text-center">Chia sẻ</th>
                          <th className="w-16 px-2 py-3 text-center">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F1F5F9]">
                        {tableLoading && tableRows.length === 0 ? (
                          <tr>
                            <td colSpan={9} className="px-4 py-10 text-center text-[#64748B]">
                              <Loader2 className="mx-auto mb-2 size-5 animate-spin text-[#2563EB]" />
                              {isBusy ? "Đang thu thập bài viết..." : "Đang tải bài viết..."}
                            </td>
                          </tr>
                        ) : tableRows.length === 0 ? (
                          <tr>
                            <td colSpan={9} className="px-4 py-10 text-center text-[#94A3B8]">
                              {isBusy ? "Chưa có bài viết nào cho page này — đang quét..." : "Không có bài viết nào khớp bộ lọc."}
                            </td>
                          </tr>
                        ) : (
                          tableRows.map((post, idx) => {
                            const stt = (postTablePage - 1) * POST_PAGE_SIZE + idx + 1;
                            const url = post.post_url
                              ? post.post_url.startsWith("http")
                                ? post.post_url
                                : `https://${post.post_url}`
                              : "";
                            return (
                              <tr key={post.id} className="hover:bg-[#F8FAFC]">
                                <td className="px-2 py-4 text-center">
                                  <input
                                    type="checkbox"
                                    checked={selectedPostIds.has(post.id)}
                                    onChange={() => handleToggleSelectPost(post.id)}
                                    className="size-3.5 rounded border-slate-300 text-blue-600"
                                  />
                                </td>
                                <td className="px-2 py-4 font-mono text-[#64748B]">{padStt(stt)}</td>
                                <td className="max-w-[220px] px-2 py-4">
                                  <p className="truncate font-medium text-[#1E293B]" title={post.content}>
                                    {post.content}
                                  </p>
                                </td>
                                <td className="px-2 py-4">
                                  {url ? (
                                    <a
                                      href={url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex max-w-[150px] items-center gap-1 font-mono text-[11px] text-[#2563EB] hover:underline"
                                      title={url}
                                    >
                                      <span className="truncate">{shortFbUrl(url)}</span>
                                      <ExternalLink className="size-3 shrink-0" />
                                    </a>
                                  ) : (
                                    <span className="text-[#94A3B8]">—</span>
                                  )}
                                </td>
                                <td className="px-2 py-4 text-center whitespace-nowrap">
                                  <div className="font-semibold text-[#1E293B]">{fmtPostDate(post.published_at)}</div>
                                  {post.published_text ? (
                                    <div className="mx-auto max-w-[110px] truncate text-[11px] text-[#94A3B8]" title={post.published_text}>
                                      {post.published_text}
                                    </div>
                                  ) : null}
                                </td>
                                <td className="px-2 py-4 text-center">
                                  <span className="inline-flex min-w-12 justify-center rounded-full bg-[#DBEAFE] px-2.5 py-0.5 text-[11px] font-bold text-[#1D4ED8]">
                                    {fmtNum(post.likes)}
                                  </span>
                                </td>
                                <td className="px-2 py-4 text-center">
                                  <span className="inline-flex min-w-12 justify-center rounded-full bg-[#F3E8FF] px-2.5 py-0.5 text-[11px] font-bold text-[#7E22CE]">
                                    {fmtNum(post.comments)}
                                  </span>
                                </td>
                                <td className="px-2 py-4 text-center font-semibold text-[#334155]">{fmtNum(post.shares)}</td>
                                <td className="px-2 py-4 text-center">
                                  <div className="inline-flex items-center justify-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => setPreviewPost(post)}
                                      className="cursor-pointer rounded p-1 text-[#94A3B8] transition hover:bg-[#EFF6FF] hover:text-[#2563EB]"
                                      title="Xem chi tiết bài viết"
                                    >
                                      <Eye className="size-4" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isDeleting}
                                      onClick={() =>
                                        guardDelete(async () => {
                                          const n = await runDelete({
                                            count: 1,
                                            noun: "bài viết",
                                            request: () => deleteScannedPosts({ post_ids: [post.id] }),
                                          });
                                          if (n == null) return;
                                          setSelectedPostIds((prev) => {
                                            const next = new Set(prev);
                                            next.delete(post.id);
                                            return next;
                                          });
                                          refreshPosts(sessionId);
                                        })
                                      }
                                      className="cursor-pointer rounded p-1 text-[#94A3B8] transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
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

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[#F1F5F9] px-5 py-4 text-xs text-[#64748B]">
                    <span>
                      Hiển thị{" "}
                      <strong className="text-[#0F172A]">
                        {tableTotal === 0
                          ? 0
                          : `${(postTablePage - 1) * POST_PAGE_SIZE + 1} - ${Math.min(postTablePage * POST_PAGE_SIZE, tableTotal)}`}
                      </strong>{" "}
                      của <strong className="text-[#0F172A]">{fmtNum(tableTotal)}</strong> bài viết
                    </span>
                    <Pager page={postTablePage} totalPages={totalPostPages} onChange={setPostTablePage} />
                  </div>
                </>
              ) : (
                <div className="flex min-h-[320px] items-center justify-center text-sm text-[#94A3B8]">
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
        <LiveLogConsole logs={logs} phase={runPhase} />
      )}

      <SelectAccountsModal
        open={showAccountModal}
        onClose={() => setShowAccountModal(false)}
        accounts={accounts}
        loading={accountsLoading}
        selectedUids={selectedUids}
        onConfirm={(uids) => {
          setSelectedUids(uids);
          saveSelectedAccountUids("posts", uids);
          setShowAccountModal(false);
        }}
      />

      <SelectPagesModal
        open={showPageModal}
        onClose={() => setShowPageModal(false)}
        selectedPages={selectedPages}
        onConfirm={(pages) => {
          setSelectedPages(pages.map((p, i) => mapKhoToPage(p, i)));
          setShowPageModal(false);
        }}
      />
    </div>
  );
}
