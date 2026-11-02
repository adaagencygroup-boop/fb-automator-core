"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Hash,
  Link2,
  FileUp,
  Download,
  Play,
  Square,
  Pause,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  X,
  BadgeCheck,
  Search,
  Phone,
  Save,
  AlertTriangle,
  Plus,
  Copy,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "@/lib/toast";
import { WS_BASE } from "@/config/constants";
import { getAccounts } from "@/modules/module_02_account_manager/service";
import { normalizeAccount, initialsOf } from "@/modules/module_07_group_spam/shared/components";
import { AVATAR_COLORS } from "@/modules/module_07_group_spam/shared/constants";
import {
  searchPages,
  searchPagesByHashtag,
  parsePageLinks,
  uploadPageFile,
  downloadPageTemplate,
  stopScanSession,
  pauseScanSession,
  resumeScanSession,
  getScanSessionDetail,
  getScannedPages,
  getActiveCampaign,
  savePageList,
} from "../service";
import {
  isHashtagChip,
  splitMixedChips,
  buildCampaignJobs,
  collectHashtagsForCampaign,
  mergePagesByKey,
  sortPagesForMode,
  pageKeywordLabel,
  normalizeHashtag,
  newCampaignId,
} from "./campaignUtils";

/* ─── Figma tokens (khớp scan-info / node 2889-27377) ─── */
const FIGMA = {
  pageBg: "bg-[#F4F7FC]",
  card: "rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] h-full",
  input:
    "h-8 rounded-lg border border-[#E2E8F0] bg-white px-2 text-center text-xs font-bold text-[#0F172A] outline-none focus:border-[#2563EB] disabled:bg-slate-100",
};

function SectionCard({ number, title, children }) {
  return (
    <section className={FIGMA.card}>
      <div className="mb-4 flex items-center gap-2.5">
        {number ? (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#1877F2] text-[11px] font-bold text-white">
            {number}
          </span>
        ) : null}
        <h2 className="font-heading text-sm font-bold text-[#0B1C30]">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function NumCtrl({ value, onChange, min = 1, max = 500, step = 10, disabled, className = "" }) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
        className="flex size-7 items-center justify-center rounded-lg border border-[#E2E8F0] bg-white text-sm font-semibold text-[#64748B] hover:bg-slate-50 disabled:opacity-40"
      >
        −
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))}
        className={`${FIGMA.input} w-16`}
      />
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
        className="flex size-7 items-center justify-center rounded-lg border border-[#E2E8F0] bg-white text-sm font-semibold text-[#64748B] hover:bg-slate-50 disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

function KeywordDraftInput({ disabled, placeholder, onAdd, onBackspaceEmpty }) {
  const [draft, setDraft] = useState("");
  const commit = (raw) => {
    if (!String(raw || "").trim()) return;
    onAdd(raw);
    setDraft("");
  };
  return (
    <input
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === ",") {
          e.preventDefault();
          commit(draft);
        } else if (e.key === "Backspace" && !draft) {
          onBackspaceEmpty?.();
        }
      }}
      onBlur={() => commit(draft)}
      className="min-w-[140px] flex-1 bg-transparent py-1 text-xs text-[#0F172A] outline-none placeholder:text-[#94A3B8]"
    />
  );
}

const SOURCE_MODES = [
  { id: "keyword", label: "Theo hashtag", Icon: Hash },
  { id: "paste", label: "Nhập Link", Icon: Link2 },
  { id: "upload", label: "Tải tệp (.txt / .csv)", Icon: FileUp },
];

const DONE_STATUSES = ["COMPLETED", "PARTIAL", "STOPPED", "FAILED"];
const LIVE_STATUSES = new Set(["LIVE", "live", "Live"]);

function nowStamp() {
  return new Date().toLocaleTimeString("vi-VN", { hour12: false });
}

/* ════════════════════════════════════════════════════════════
   MAIN — Quét thông tin page (layout theo ảnh + tab Hashtag)
   ════════════════════════════════════════════════════════════ */
export default function PageScannerSearch() {
  /* Accounts — multi-select */
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [selectedUids, setSelectedUids] = useState([]);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [modalUids, setModalUids] = useState([]);

  /* Source */
  const [sourceMode, setSourceMode] = useState("keyword");
  /** Chip hỗn hợp: từ khóa thường + #hashtag (mức 3) */
  const [keywords, setKeywords] = useState([]);
  const [searchMode] = useState("NGACH"); // chỉ tìm theo hashtag
  const [campaignId, setCampaignId] = useState(null);
  const [maxFollowers, setMaxFollowers] = useState("");
  const [topN, setTopN] = useState(""); // Top N sau lọc — khác max_results
  const [pasteContent, setPasteContent] = useState("");
  const [uploadResult, setUploadResult] = useState(null);
  const fileInputRef = useRef(null);

  const { keywords: plainKeywords, hashtags: manualHashtags } = useMemo(
    () => splitMixedChips(keywords),
    [keywords],
  );
  const derivedHashtags = useMemo(
    () => collectHashtagsForCampaign(plainKeywords, manualHashtags),
    [plainKeywords, manualHashtags],
  );

  /* Card 2 config */
  const [rotateEvery, setRotateEvery] = useState(50);
  const [delayMin, setDelayMin] = useState(5);
  const [delayMax, setDelayMax] = useState(10);
  const [applyAllTarget, setApplyAllTarget] = useState(30);
  const [keywordTargets, setKeywordTargets] = useState({}); // keyword -> max_results
  const [minFollowersEnabled, setMinFollowersEnabled] = useState(true);
  const [minFollowers, setMinFollowers] = useState(1000);
  const [skipSaveBelowThreshold, setSkipSaveBelowThreshold] = useState(false);
  const [minPosts, setMinPosts] = useState(2);
  const [maxPostsPerHashtag, setMaxPostsPerHashtag] = useState(100);

  /* Run state: idle | running | paused | done */
  const [runPhase, setRunPhase] = useState("idle");
  const [sessionId, setSessionId] = useState(null);
  const [sessionIds, setSessionIds] = useState([]);
  const [keywordProgress, setKeywordProgress] = useState([]); // {keyword, count, status}
  const [logs, setLogs] = useState([]);

  /* Results */
  const [pages, setPages] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(10);
  const [resultSearch, setResultSearch] = useState("");
  const [filterKeyword, setFilterKeyword] = useState("ALL");
  const [selectedPageKeys, setSelectedPageKeys] = useState([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [sortDir, setSortDir] = useState("desc");

  const pollRef = useRef(null);
  const campaignRef = useRef({ paused: false, abort: false, queue: [], accIndex: 0 });
  const sessionMetaRef = useRef({}); // sessionId -> { channel, label, kind }
  const sessionIdsRef = useRef([]);
  const wsRef = useRef(null);
  const lastLoadedRef = useRef(0);
  const [poolStats, setPoolStats] = useState({ pool: 0, aboveMin: 0, showing: 0 });

  useEffect(() => {
    sessionIdsRef.current = sessionIds;
  }, [sessionIds]);

  const showResults = runPhase !== "idle";
  const isRunning = runPhase === "running";
  const isPaused = runPhase === "paused";
  const isBusy = isRunning || isPaused;

  const pushLog = useCallback((message, type = "info") => {
    setLogs((prev) => {
      const next = [...prev, { id: `${Date.now()}_${prev.length}`, timestamp: nowStamp(), message, type }];
      return next.slice(-500);
    });
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  /* Giữ hạn mức của các hashtag còn được chọn, bổ sung mặc định cho hashtag mới. */
  if (
    Object.keys(keywordTargets).length !== derivedHashtags.length ||
    derivedHashtags.some((tag) => keywordTargets[tag] == null)
  ) {
    setKeywordTargets(
      Object.fromEntries(derivedHashtags.map((tag) => [tag, keywordTargets[tag] ?? applyAllTarget])),
    );
  }

  /* Load accounts */
  useEffect(() => {
    let ignore = false;
    getAccounts()
      .then((data) => {
        if (ignore) return;
          const normalized = (Array.isArray(data) ? data : data?.accounts || []).map((a, i) =>
            normalizeAccount(a, i),
          );
          setAccounts(normalized);
      })
      .catch((err) => {
        if (!ignore) toast.error(`Lỗi tải tài khoản: ${err.message}`);
      })
      .finally(() => {
        if (!ignore) setAccountsLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  /* WS logs (best-effort) */
  useEffect(() => {
    if (!isBusy) return undefined;
    let ws;
    try {
      ws = new WebSocket(WS_BASE);
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          const msg = data.message || data.msg || data.text;
          if (msg && (String(msg).toLowerCase().includes("page") || data.module === "page_scanner" || data.scope === "page_scanner")) {
            pushLog(msg, data.level === "error" ? "error" : data.level === "warn" ? "warn" : "info");
          }
        } catch {
          /* ignore non-json */
        }
      };
    } catch {
      /* ignore */
    }
    return () => {
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [isBusy, pushLog]);

  const loadResults = useCallback(
    async (sid, page = 1, idsOverride = null) => {
      const ids = (
        idsOverride ||
        (sessionIds.length ? sessionIds : sid ? [sid] : [])
      ).filter(Boolean);
      if (!ids.length) return;
    setLoadingResults(true);
    try {
        const lists = await Promise.all(
          ids.map(async (id) => {
      const data = await getScannedPages({
              session_id: id,
              page: 1,
              page_size: 200,
              sort_by: "default",
            });
            return { sessionId: id, items: data.items || [] };
          }),
        );
        let merged = mergePagesByKey(lists, sessionMetaRef.current);
        const terms = [...plainKeywords, ...manualHashtags];
        merged = sortPagesForMode(merged, searchMode, terms);

        const pool = merged.length;
        const maxFl = maxFollowers === "" || maxFollowers == null ? null : Number(maxFollowers);
        const aboveMin = minFollowersEnabled
          ? merged.filter((p) => {
              const fl = p.follower_count || 0;
              if (fl < minFollowers) return false;
              if (maxFl != null && Number.isFinite(maxFl) && fl > maxFl) return false;
              return true;
            }).length
          : pool;
        let filtered = minFollowersEnabled
          ? merged.filter((p) => {
              const fl = p.follower_count || 0;
              if (fl < minFollowers) return false;
              if (maxFl != null && Number.isFinite(maxFl) && fl > maxFl) return false;
              return true;
            })
          : merged;

        if (resultSearch.trim()) {
          const q = resultSearch.trim().toLowerCase();
          filtered = filtered.filter((p) =>
            `${p.page_name || ""} ${p.page_url || ""} ${p.phone || ""} ${p.email || ""} ${p.website || ""} ${p.address || ""}`
              .toLowerCase()
              .includes(q),
          );
        }
        if (filterKeyword !== "ALL") {
          const needle = filterKeyword.toLowerCase().replace(/^#/, "");
          filtered = filtered.filter((p) => {
            const hay = `${p.source_keyword || ""} ${p.matched_hashtags || ""} ${(p.channels || []).join(" ")}`.toLowerCase();
            return hay.includes(needle);
          });
        }

        if (sortDir === "asc") {
          filtered = [...filtered].reverse();
        }

        const limitN = topN === "" || topN == null ? null : Number(topN);
        if (limitN != null && Number.isFinite(limitN) && limitN > 0) {
          filtered = filtered.slice(0, limitN);
        }

        const total = filtered.length;
        const start = (page - 1) * pageSize;
        const slice = filtered.slice(start, start + pageSize);
        setPages(slice);
        setTotalCount(total);
        setPoolStats({ pool, aboveMin, showing: slice.length });
    } catch (err) {
      toast.error(`Lỗi tải kết quả: ${err.message}`);
    } finally {
      setLoadingResults(false);
    }
    },
    [
      sessionIds,
      pageSize,
      resultSearch,
      minFollowersEnabled,
      minFollowers,
      maxFollowers,
      topN,
      sortDir,
      filterKeyword,
      searchMode,
      plainKeywords,
      manualHashtags,
    ],
  );

  const startPoll = useCallback(
    (sid) => {
      stopPolling();
      lastLoadedRef.current = 0;
      pollRef.current = setInterval(async () => {
        try {
          const session = await getScanSessionDetail(sid);
          const count = session.pages_count || session.total_unique || 0;
          if (session.status === "PAUSED") setRunPhase("paused");
          else if (session.status === "RUNNING") setRunPhase((p) => (p === "paused" ? "running" : p));

          setKeywordProgress((prev) =>
            prev.map((row) =>
              row.status === "scanning"
                ? {
                    ...row,
                    count,
                    status:
                      session.status === "PAUSED"
                        ? "paused"
                        : DONE_STATUSES.includes(session.status)
                          ? "done"
                          : row.status,
                  }
                : row,
            ),
          );

          // Đồng bộ log đã lưu kèm phiên
          let lines = session.logs;
          if (typeof lines === "string") {
            try {
              lines = JSON.parse(lines);
            } catch {
              lines = [];
            }
          }
          if (Array.isArray(lines) && lines.length) {
            setLogs((prev) => {
              const mapped = lines.map((line, i) => ({
                id: `s${sid}_${line.ts}_${i}`,
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
              }));
              return mapped.length >= prev.length ? mapped.slice(-500) : prev;
            });
          }

          if (count > lastLoadedRef.current) {
            lastLoadedRef.current = count;
            const ids = sessionIdsRef.current.length ? sessionIdsRef.current : [sid];
            loadResults(sid, 1, ids);
          }
          if (DONE_STATUSES.includes(session.status)) {
    stopPolling();
          }
        } catch (e) {
          console.error(e);
        }
      }, 1500);
    },
    [loadResults, stopPolling],
  );

  /* Restore đợt đang chạy theo campaign_id (chỉ dẫn 1.3) */
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const data = await getActiveCampaign();
        if (ignore || !data?.active || !(data.sessions || []).length) return;
        const sessions = data.sessions;
        const top = sessions.find((s) => s.id === data.primary_session_id) || sessions[sessions.length - 1];
        setCampaignId(data.campaign_id || null);
        setSessionId(top.id);
        setSessionIds(sessions.map((s) => s.id));
        setRunPhase(top.status === "PAUSED" || data.status === "PAUSED" ? "paused" : "running");

        let settings = {};
        try {
          settings = typeof top.settings === "string" ? JSON.parse(top.settings || "{}") : top.settings || {};
        } catch {
          settings = {};
        }
        if (Array.isArray(settings.keywords) || Array.isArray(settings.hashtags)) {
          const chips = [
            ...(settings.keywords || []),
            ...(settings.hashtags || []).map((t) => (String(t).startsWith("#") ? t : `#${t}`)),
          ];
          if (chips.length) setKeywords(chips);
        }

        setKeywordProgress(
          sessions.map((s) => ({
            keyword: s.keyword || "—",
            count: s.total_unique || 0,
            status:
              s.status === "RUNNING"
                ? "scanning"
                : s.status === "PAUSED"
                  ? "paused"
                  : DONE_STATUSES.includes(s.status)
                    ? "done"
                    : "pending",
            channel: s.source_type,
          })),
        );

        // Log đã lưu kèm phiên
        const allLogs = [];
        for (const s of sessions) {
          let lines = s.logs;
          if (typeof lines === "string") {
            try {
              lines = JSON.parse(lines);
            } catch {
              lines = [];
            }
          }
          for (const line of lines || []) {
            allLogs.push({
              id: `${s.id}_${line.ts}_${allLogs.length}`,
              timestamp: line.ts || "—",
              message: line.message,
              type: line.level === "success" ? "success" : line.level === "warn" ? "warn" : line.level === "error" ? "error" : "info",
            });
          }
        }
        if (allLogs.length) setLogs(allLogs.slice(-500));

        pushLog(
          `Khôi phục đợt ${data.campaign_id || `#${top.id}`} · ${sessions.length} phiên · ${top.status}`,
          "warn",
        );
        await loadResults(top.id, 1, sessions.map((s) => s.id));
        if (top.status === "RUNNING" || top.status === "PAUSED") startPoll(top.id);
      } catch {
        /* không có phiên active */
      }
    })();
    return () => {
      ignore = true;
      stopPolling();
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          /* ignore */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const waitForSession = (sid) =>
    new Promise((resolve) => {
      const tick = async () => {
        if (campaignRef.current.abort) {
          resolve({ status: "STOPPED", stop_reason: "USER_STOPPED" });
          return;
        }
        try {
          const session = await getScanSessionDetail(sid);
          const count = session.pages_count || session.total_unique || 0;
          if (count > lastLoadedRef.current) {
            lastLoadedRef.current = count;
            loadResults(sid, currentPage);
          }
          setKeywordProgress((prev) =>
            prev.map((row, idx) => {
              const isActive = prev.findIndex((r) => r.status === "scanning") === idx;
              return isActive ? { ...row, count } : row;
            }),
          );
          if (DONE_STATUSES.includes(session.status)) {
            resolve(session);
            return;
          }
        } catch {
          /* retry */
        }
        setTimeout(tick, 1500);
      };
      tick();
    });

  /**
   * Acc sticky theo rotate_every (Page đã quét), không xoay mỗi job/kênh.
   * state: { cursor, pagesOnAcc }
   */
  const currentCampaignUid = (accState) => {
    if (!selectedUids.length) return null;
    return selectedUids[accState.cursor % selectedUids.length];
  };

  const advanceAccountAfterJob = (accState, pagesAdded, threshold) => {
    const pagesOnAcc = (accState.pagesOnAcc || 0) + (Number(pagesAdded) || 0);
    const limit = Math.max(1, Number(threshold) || 50);
    if (selectedUids.length > 1 && pagesOnAcc >= limit) {
      return {
        cursor: (accState.cursor + 1) % selectedUids.length,
        pagesOnAcc: 0,
        rotated: true,
        prevPages: pagesOnAcc,
      };
    }
    return { cursor: accState.cursor, pagesOnAcc, rotated: false, prevPages: pagesOnAcc };
  };

  /* Validate trước khi Bắt đầu (không còn nút Kiểm tra riêng) */
  const validateBeforeStart = () => {
    const errors = [];
    if (sourceMode === "keyword") {
      if (!keywords.length) errors.push("Chưa nhập từ khóa hoặc hashtag (#).");
      if (!derivedHashtags.length) {
        errors.push("Cần ít nhất 1 hashtag (nhập #... hoặc từ khóa để suy ra #).");
      }
      keywords.forEach((chip) => {
        if (chip.length > 255) errors.push(`Chip quá dài: "${chip.slice(0, 40)}…"`);
        if (isHashtagChip(chip) && !normalizeHashtag(chip)) {
          errors.push(`Hashtag không hợp lệ: "${chip}"`);
        }
      });
      const jobs = buildCampaignJobs({ searchMode, keywords: plainKeywords, manualHashtags });
      if (!jobs.length) errors.push("Chế độ hiện tại không sinh được phiên quét nào.");
    } else if (sourceMode === "paste") {
      if (!pasteContent.trim()) errors.push("Chưa dán link Page.");
    } else if (sourceMode === "upload") {
      if (!uploadResult) errors.push("Chưa tải file lên.");
    }

    if (selectedUids.length) {
      const live = accounts.filter(
        (a) => selectedUids.includes(a.uid) && LIVE_STATUSES.has(String(a.status)),
      );
      if (!live.length) errors.push("Không có tài khoản Live trong danh sách đã chọn.");
    }

    if (delayMin > delayMax) errors.push("Khoảng giãn cách không hợp lệ (từ > đến).");

    if (errors.length) {
      toast.error(errors[0]);
      return false;
    }
    return true;
  };

  /** Campaign hashtag-only — gom pool theo campaign_id */
  const runMixedCampaign = async () => {
    const jobs = buildCampaignJobs({ searchMode, keywords: plainKeywords, manualHashtags });
    const campId = newCampaignId();
    setCampaignId(campId);
    campaignRef.current = { paused: false, abort: false, queue: jobs, accIndex: 0 };
    sessionMetaRef.current = {};
    setSessionIds([]);
    setKeywordProgress(jobs.map((j) => ({ keyword: j.label, count: 0, status: "pending", channel: j.channel })));
    setRunPhase("running");

    const mode = "NGACH";
    const modeLabel = "Hashtag";
    const campaignSettings = {
      search_mode: mode,
      keywords: plainKeywords,
      hashtags: manualHashtags,
      rotate_every: rotateEvery,
      delay_min_seconds: delayMin,
      delay_max_seconds: delayMax,
      min_followers: minFollowersEnabled ? minFollowers : null,
      skip_save_below_threshold: skipSaveBelowThreshold,
      max_followers: maxFollowers === "" ? null : Number(maxFollowers),
      top_n: topN === "" ? null : Number(topN),
    };
    pushLog(
      `Đợt ${campId} [${modeLabel}] · ${jobs.length} phiên · KW: ${plainKeywords.join(", ") || "—"} · Tag: ${derivedHashtags.join(", ") || "—"}`,
      "warn",
    );

    let accState = { cursor: 0, pagesOnAcc: 0 };
    const collectedIds = [];

    for (let i = 0; i < jobs.length; i += 1) {
      while (campaignRef.current.paused && !campaignRef.current.abort) {
        setRunPhase("paused");
        await new Promise((r) => setTimeout(r, 400));
      }
      if (campaignRef.current.abort) break;

      setRunPhase("running");
      const job = jobs[i];
      const uid = currentCampaignUid(accState);
      // Giữ Chrome nếu còn job sau (cùng acc tái dùng; đổi acc thì BE đóng scope cũ)
      const keepBrowser = i < jobs.length - 1 && !campaignRef.current.abort;

      setKeywordProgress((prev) =>
        prev.map((row) => (row.keyword === job.label ? { ...row, status: "scanning" } : row)),
      );
      pushLog(
        `[${job.channel}] ${job.label} · acc ${uid || "auto"} · pages/acc ${accState.pagesOnAcc}/${rotateEvery}`,
        "info",
      );

      try {
        let sid;
        if (job.kind === "keyword") {
          const maxResults =
            keywordTargets[job.rootKeyword] || keywordTargets[job.query] || applyAllTarget;
          const res = await searchPages({
            keyword: job.query,
            account_uid: uid,
            max_results: maxResults,
            include_sponsored: false,
            headless: false,
            allow_direct_fallback: true,
            campaign_id: campId,
            settings: campaignSettings,
            keep_browser: keepBrowser,
          });
          sid = res.session_id;
              } else {
          const tagKey = job.label?.startsWith("#") ? job.label : `#${job.query}`;
          const targetPages =
            keywordTargets[tagKey] ||
            keywordTargets[job.rootKeyword] ||
            keywordTargets[job.query] ||
            applyAllTarget;
          const res = await searchPagesByHashtag({
            hashtags: [job.query],
            context_keywords: plainKeywords,
            min_posts: minPosts,
            max_posts_per_hashtag: maxPostsPerHashtag,
            account_uid: uid,
            headless: false,
            allow_direct_fallback: true,
            campaign_id: campId,
            keep_browser: keepBrowser,
            target_pages: targetPages,
            min_followers: minFollowersEnabled ? minFollowers : 0,
            idle_timeout_s: 90,
          });
          sid = res.session_id;
        }

        sessionMetaRef.current[sid] = {
          channel: job.channel,
          label: job.label,
          kind: job.kind,
          account_uid: uid,
        };
        setSessionId(sid);
        collectedIds.push(sid);
        setSessionIds([...collectedIds]);
        startPoll(sid);
        const session = await waitForSession(sid);
        stopPolling();
        const count = session.pages_count || session.total_unique || 0;
        setKeywordProgress((prev) =>
          prev.map((row) =>
            row.keyword === job.label ? { ...row, count, status: "done" } : row,
          ),
        );
        pushLog(
          `Xong ${job.label}: +${count} · ${session.stop_reason || session.status}`,
          session.status === "FAILED" ? "error" : "success",
        );

        const nextAcc = advanceAccountAfterJob(accState, count, rotateEvery);
        if (nextAcc.rotated) {
          pushLog(
            `Đủ ~${rotateEvery} Page/acc → đổi nick → ${selectedUids[nextAcc.cursor] || "?"} (đã ${nextAcc.prevPages})`,
            "warn",
          );
        }
        accState = { cursor: nextAcc.cursor, pagesOnAcc: nextAcc.pagesOnAcc };
        campaignRef.current.accIndex = accState.cursor;

        await loadResults(sid, 1, [...collectedIds]);
      } catch (err) {
        setKeywordProgress((prev) =>
          prev.map((row) => (row.keyword === job.label ? { ...row, status: "error" } : row)),
        );
        pushLog(`Lỗi ${job.label}: ${err.message}`, "error");
        toast.error(err.message);
      }
    }

    stopPolling();
    setRunPhase("done");
    if (campaignRef.current.abort) {
      pushLog("Đã dừng khẩn cấp toàn bộ đợt quét.", "error");
    } else {
      pushLog(`Đợt [${modeLabel}] hoàn tất — đang xếp hạng pool chung.`, "success");
      toast.success(`Hoàn thành đợt ${modeLabel}.`);
      if (collectedIds.length) {
        await loadResults(collectedIds[collectedIds.length - 1], 1, collectedIds);
      }
    }
  };

  const handleStart = async () => {
    if (!validateBeforeStart()) return;
    setLogs([]);
    setPages([]);
    setSelectedPageKeys([]);
    setCurrentPage(1);
    setTotalCount(0);
    setPoolStats({ pool: 0, aboveMin: 0, showing: 0 });
    lastLoadedRef.current = 0;
    sessionMetaRef.current = {};

    if (sourceMode === "keyword") {
      await runMixedCampaign();
          return;
        }
    if (sourceMode === "paste") {
      setRunPhase("running");
      pushLog("Đang chuẩn hoá danh sách link…", "info");
      try {
        const res = await parsePageLinks({
          content: pasteContent.trim(),
          filter_existing: true,
          save_to_db: true,
        });
        setSessionId(res.session_id);
        setSessionIds(res.session_id ? [res.session_id] : []);
        setKeywordProgress([{ keyword: "Nhập link", count: res.valid_count || 0, status: "done" }]);
        if (res.session_id) await loadResults(res.session_id, 1);
        setRunPhase("done");
        pushLog(`Parse xong: ${res.valid_count} hợp lệ / trùng ${res.dedup_count} / lỗi ${res.invalid_count}`, "success");
        toast.success(`Đã nhập ${res.valid_count} Page hợp lệ.`);
      } catch (err) {
        setRunPhase("done");
        toast.error(err.message);
      }
          return;
        }
    if (sourceMode === "upload") {
      setRunPhase("running");
      try {
        setSessionId(uploadResult.session_id);
        setSessionIds(uploadResult.session_id ? [uploadResult.session_id] : []);
        setKeywordProgress([{ keyword: "Upload file", count: uploadResult.valid_count || 0, status: "done" }]);
        if (uploadResult.session_id) await loadResults(uploadResult.session_id, 1);
        setRunPhase("done");
        pushLog(`Upload: ${uploadResult.valid_count} page đã lưu.`, "success");
        toast.success(`Đã lưu ${uploadResult.valid_count} Page từ file.`);
    } catch (err) {
        setRunPhase("done");
        toast.error(err.message);
      }
    }
  };

  /* TẠM DỪNG / TIẾP TỤC — pause API riêng stop (chỉ dẫn 1.1) */
  const handlePauseResume = async () => {
    if (isPaused) {
      campaignRef.current.paused = false;
      setRunPhase("running");
      if (sessionId) {
        try {
          await resumeScanSession(sessionId);
        } catch (err) {
          pushLog(`Resume lỗi: ${err.message}`, "error");
        }
      }
      pushLog("Tiếp tục phiên đang tạm dừng.", "success");
      toast.info("Đã tiếp tục.");
      return;
    }
    campaignRef.current.paused = true;
    setRunPhase("paused");
    if (sessionId) {
    try {
        await pauseScanSession(sessionId);
    } catch (err) {
        pushLog(`Pause lỗi: ${err.message}`, "error");
      }
    }
    pushLog("Tạm dừng phiên tại điểm an toàn.", "warn");
    toast.info("Đã tạm dừng.");
  };

  const handleEmergencyStop = async () => {
    campaignRef.current.abort = true;
    campaignRef.current.paused = false;
      stopPolling();
    if (sessionId) {
      try {
        await stopScanSession(sessionId);
        pushLog(`Đã gửi dừng khẩn cấp phiên #${sessionId}.`, "error");
      } catch (err) {
        pushLog(`Lỗi dừng: ${err.message}`, "error");
      }
    }
    setRunPhase("done");
    toast.warning("Đã dừng khẩn cấp.");
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await uploadPageFile(formData);
      setUploadResult(res);
      toast.success(`Đã nhập ${res.valid_count} Page từ "${file.name}"`);
    } catch (err) {
      toast.error(`Lỗi đọc file: ${err.message}`);
    }
    e.target.value = "";
  };

  const handleExportCSV = () => {
    if (!pages.length) return;
    const headers = ["STT", "Từ khóa", "Tên Page", "Link Page", "SĐT", "Email", "Website", "Vị trí / Địa chỉ", "Tích xanh"];
    const rows = pages.map((p, i) => [
      (currentPage - 1) * pageSize + i + 1,
      pageKeywordLabel(p) === "—" ? (filterKeyword !== "ALL" ? filterKeyword : "") : pageKeywordLabel(p),
      p.page_name || "",
      p.page_url || "",
      p.phone || "",
      p.email || "",
      p.website || "",
      p.address || "",
      p.is_verified === true ? "Có" : "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quet_page_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Đã xuất file CSV.");
  };

  /* Q6 — tick → lưu tick; chưa tick → lưu toàn bộ đang lọc (trang hiện tại + nếu có thể lấy thêm) */
  const handleSaveList = async () => {
    let toSave = pages.filter((p) => selectedPageKeys.includes(p.page_key));
    if (!toSave.length) {
      toSave = [...pages];
      if (sessionId && totalCount > pages.length) {
        try {
          const all = await getScannedPages({
            session_id: sessionId,
            page: 1,
            page_size: Math.min(totalCount, 200),
            keyword: resultSearch || undefined,
            min_followers: minFollowersEnabled ? minFollowers : undefined,
            sort_by: "followers",
            sort_dir: sortDir,
          });
          toSave = all.items || toSave;
        } catch {
          /* dùng trang hiện tại */
        }
      }
    }
    if (!toSave.length) {
      toast.warning("Không có page để lưu.");
      return;
    }
    const entry = savePageList({ pages: toSave });
    toast.success(`Đã lưu ${entry.count} page vào danh sách "${entry.name}".`);
    pushLog(`Lưu danh sách: ${entry.count} page.`, "success");
  };

  /* Reload bảng khi đổi lọc / sort (sau khi đã có phiên) */
  useEffect(() => {
    if (!sessionId || runPhase === "idle") return undefined;
    const t = setTimeout(() => {
      setCurrentPage(1);
      loadResults(sessionId, 1);
    }, 300);
    return () => clearTimeout(t);
  }, [resultSearch, filterKeyword, minFollowersEnabled, minFollowers, sortDir, sessionId, runPhase, loadResults]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const keywordOptions = useMemo(() => {
    const opts = [...plainKeywords, ...manualHashtags];
    return opts;
  }, [plainKeywords, manualHashtags]);

  const selCount = selectedUids.length;

  return (
    <div className={`-m-6 min-h-full space-y-5 ${FIGMA.pageBg} p-6`}>
      <div>
        <h1 className="font-heading text-xl font-bold tracking-tight text-[#0B1C30]">Quét thông tin page</h1>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-[#64748B]">
          Tìm kiếm, lọc và xuất dữ liệu chi tiết (SĐT, Email, Website, Followers) từ Fanpage Facebook theo
          hashtag, link hoặc file tải lên.
        </p>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        {/* ═══ Card 1 — Figma 2889-27377 ═══ */}
        <SectionCard number="1" title="Chọn tài khoản & Thiết lập phiên quét">
          {/* Row: + Chọn tài khoản + badge xanh */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                setModalUids([...selectedUids]);
                setShowAccountModal(true);
              }}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#1877F2] px-4 text-xs font-bold text-white shadow-sm transition hover:bg-[#166FE5] disabled:opacity-60"
            >
              <Plus className="size-4 stroke-[2.5]" />
              Chọn tài khoản
            </button>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-3.5 py-1.5 text-xs font-semibold text-[#059669]">
              <span className="size-2 rounded-full bg-[#10B981]" />
              Đã chọn: <strong>{selCount} tài khoản</strong>
            </span>
          </div>

          {/* PHƯƠNG THỨC QUÉT — tab solid blue khi active */}
          <div className="mb-4">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
              PHƯƠNG THỨC QUÉT
            </p>
            <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-1">
              {SOURCE_MODES.map(({ id, label, Icon }) => {
                const active = sourceMode === id;
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={isBusy}
                    onClick={() => setSourceMode(id)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs transition disabled:opacity-60 ${
                      active
                        ? "bg-[#1877F2] font-bold text-white shadow-sm"
                        : "font-medium text-[#475569] hover:text-[#0F172A]"
                    }`}
                  >
                    <Icon className="size-3.5" />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {sourceMode === "keyword" && (
            <div className="space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#334155]">Nhập hashtag</span>
                <span className="text-xs text-[#64748B]">
                  Đã chọn:{" "}
                  <strong className="font-bold text-[#1877F2]">
                    {derivedHashtags.length || keywords.length} từ khóa
                  </strong>
                </span>
              </div>

              <div
                className={`flex min-h-[88px] w-full flex-wrap content-start items-start gap-1.5 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 transition focus-within:border-[#1877F2] focus-within:bg-white ${
                  isBusy ? "opacity-60" : ""
                }`}
              >
                {keywords.map((chip) => (
                  <span
                    key={chip}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-2.5 py-1 text-xs font-semibold text-[#1D4ED8]"
                  >
                    {chip}
                    {!isBusy && (
                      <button
                        type="button"
                        onClick={() => setKeywords(keywords.filter((c) => c !== chip))}
                        className="rounded-full p-0.5 text-[#1D4ED8]/70 hover:bg-[#BFDBFE]/60 hover:text-[#1E3A8A]"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </span>
                ))}
                <KeywordDraftInput
                  disabled={isBusy}
                  placeholder="Nhập thêm hashtag..."
                  onAdd={(raw) => {
                    const parts = String(raw || "")
                      .split(/[,;\n]+/)
                      .map((s) => s.trim())
                      .filter(Boolean);
                    if (!parts.length) return;
                    const next = [...keywords];
                    for (const p of parts) {
                      const n = normalizeHashtag(p.startsWith("#") ? p : `#${p}`);
                      if (!n) continue;
                      if (!next.some((c) => c.toLowerCase() === n.toLowerCase())) next.push(n);
                    }
                    setKeywords(next);
                  }}
                  onBackspaceEmpty={() => {
                    if (keywords.length) setKeywords(keywords.slice(0, -1));
                  }}
                />
              </div>
            </div>
          )}

          {sourceMode === "paste" && (
            <div className="space-y-3">
              <span className="text-xs font-bold text-[#1E293B]">
                Dán danh sách liên kết Fanpage Facebook
              </span>
              <textarea
                value={pasteContent}
                onChange={(e) => setPasteContent(e.target.value)}
                disabled={isBusy}
                rows={5}
                placeholder={
                  "https://www.facebook.com/tenpage\nhttps://facebook.com/profile.php?id=..."
                }
                className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 font-mono text-xs leading-relaxed text-[#0F172A] outline-none transition focus:border-[#1877F2] focus:bg-white disabled:opacity-60"
              />
            </div>
          )}

          {sourceMode === "upload" && (
            <div>
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-4 py-10 text-center hover:border-[#1877F2]/50">
                <FileUp className="size-6 text-[#94A3B8]" />
                <span className="text-xs font-semibold text-[#0F172A]">Chọn tệp .txt hoặc .csv</span>
                <span className="text-[11px] text-[#94A3B8]">Mỗi dòng một link Page</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.csv"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </label>
              {uploadResult && (
                <p className="mt-2 text-[11px] font-semibold text-emerald-700">
                  ✓ Hợp lệ {uploadResult.valid_count} · Trùng {uploadResult.dedup_count} · Lỗi{" "}
                  {uploadResult.invalid_count}
                </p>
              )}
              <button
                type="button"
                onClick={downloadPageTemplate}
                className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-[#1877F2] hover:underline"
              >
                <Download className="size-3" /> Tải file mẫu
              </button>
            </div>
          )}
        </SectionCard>

        {/* ═══ Card 2 ═══ */}
        <SectionCard number="2" title="Thiết lập cấu hình quét mục tiêu">
          {sourceMode === "keyword" && (
            <div className="mb-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold text-[#64748B]">Số page cần quét / hashtag</p>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[#94A3B8]">Áp dụng tất cả:</span>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    disabled={isBusy}
                    value={applyAllTarget}
                    onChange={(e) =>
                      setApplyAllTarget(Math.min(500, Math.max(1, Number(e.target.value) || 1)))
                    }
                    className={`${FIGMA.input} w-14`}
                  />
                  <button
                    type="button"
                    disabled={isBusy || !derivedHashtags.length}
                    onClick={() => {
                      const next = {};
                      derivedHashtags.forEach((tag) => {
                        next[tag] = applyAllTarget;
                      });
                      setKeywordTargets(next);
                    }}
                    className="inline-flex h-8 items-center rounded-lg bg-[#2563EB] px-3 text-[11px] font-bold text-white disabled:opacity-50"
                  >
                    Áp dụng
                  </button>
                </div>
              </div>
              {derivedHashtags.length === 0 ? (
                <p className="text-xs text-[#94A3B8]">Thêm hashtag ở cột trái để đặt hạn mức.</p>
              ) : (
                derivedHashtags.map((tag) => (
                  <div
                    key={tag}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[#F1F5F9] bg-[#F8FAFC] px-3 py-2"
                  >
                    <span className="truncate text-xs font-medium text-[#0F172A]">{tag}</span>
                    <div className="flex items-center gap-1.5">
                      <NumCtrl
                        value={keywordTargets[tag] || applyAllTarget}
                        onChange={(v) => setKeywordTargets((prev) => ({ ...prev, [tag]: v }))}
                        min={1}
                        max={500}
                        step={10}
                        disabled={isBusy}
                      />
                      <span className="text-[11px] text-[#94A3B8]">page</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {sourceMode === "keyword" && (
            <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
              <p className="min-w-0 flex-1 text-[11px] leading-5 text-[#92400E]">
                Kết quả đứng top thường có tương tác tốt hơn. Đặt hạn mức vừa phải theo từng hashtag để ưu
                tiên page chất lượng.
              </p>
            </div>
          )}

          <div className="space-y-3 border-t border-[#F1F5F9] pt-4">
            <label className="flex flex-wrap items-center gap-2 text-xs text-[#0F172A]">
              <span>Đổi tài khoản mới khi quét được</span>
              <input
                type="number"
                min={1}
                max={500}
                disabled={isBusy}
                value={rotateEvery}
                onChange={(e) => setRotateEvery(Math.max(1, Number(e.target.value) || 1))}
                className={`${FIGMA.input} w-16`}
              />
              <span className="text-[#64748B]">page / tài khoản</span>
            </label>

            <label className="flex flex-wrap items-center gap-2 text-xs text-[#0F172A]">
              <span>Khoảng cách giữa các lần quét</span>
              <input
                type="number"
                min={1}
                max={120}
                disabled={isBusy}
                value={delayMin}
                onChange={(e) => setDelayMin(Math.max(1, Number(e.target.value) || 1))}
                className={`${FIGMA.input} w-14`}
              />
              <span className="text-[#64748B]">đến</span>
              <input
                type="number"
                min={1}
                max={180}
                disabled={isBusy}
                value={delayMax}
                onChange={(e) => setDelayMax(Math.max(delayMin, Number(e.target.value) || delayMin))}
                className={`${FIGMA.input} w-14`}
              />
              <span className="text-[#64748B]">giây</span>
            </label>

            <label className="flex cursor-pointer flex-wrap items-center gap-2 text-xs text-[#0F172A]">
              <Checkbox
                checked={minFollowersEnabled}
                disabled={isBusy}
                onCheckedChange={(c) => setMinFollowersEnabled(!!c)}
              />
              <span>Chỉ quét page có số lượng followers lớn hơn</span>
              <input
                type="number"
                min={0}
                disabled={isBusy || !minFollowersEnabled}
                value={minFollowers}
                onChange={(e) => setMinFollowers(Math.max(0, Number(e.target.value) || 0))}
                className={`${FIGMA.input} w-20`}
              />
              <span className="text-[#64748B]">Followers</span>
            </label>

            <label className="flex cursor-pointer items-start gap-2.5 pl-6">
              <Checkbox
                checked={skipSaveBelowThreshold}
                disabled={isBusy || !minFollowersEnabled}
                onCheckedChange={(c) => setSkipSaveBelowThreshold(!!c)}
                className="mt-0.5"
              />
              <span className="text-[11px] text-[#64748B]">
                Không lưu page dưới ngưỡng vào DB{" "}
                <span className="text-[#94A3B8]">(mặc định: lưu hết, chỉ lọc khi xem)</span>
              </span>
            </label>
          </div>
        </SectionCard>
      </div>

      {/* Controls: idle = Start; đang chạy = Pause + Emergency */}
      <div className="space-y-3">
        {!isBusy && (
          <button
            type="button"
            onClick={handleStart}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] text-sm font-bold tracking-wide text-white hover:bg-blue-600"
          >
            <Play className="size-4 fill-current" />
            BẮT ĐẦU THỰC THI
          </button>
        )}
        {isBusy && (
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={handlePauseResume}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#FECACA] bg-white text-sm font-bold tracking-wide text-[#DC2626]"
            >
              {isPaused ? <Play className="size-4" /> : <Pause className="size-4 fill-current" />}
              {isPaused ? "TIẾP TỤC" : "TẠM DỪNG"}
            </button>
            <button
              type="button"
              onClick={handleEmergencyStop}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#EF4444] text-sm font-bold tracking-wide text-white"
            >
              <Square className="size-4 fill-current" />
              DỪNG KHẨN CẤP
            </button>
          </div>
        )}
      </div>

      {/* Kết quả + log: chỉ hiện sau khi bắt đầu chạy */}
      {showResults && (
        <>
      <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F1F5F9] px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-heading text-sm font-bold text-[#0B1C30]">Kết quả quét thông tin Page</h2>
              <span className="rounded-full bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-semibold text-[#2563EB]">
                {totalCount.toLocaleString("vi-VN")} page
              </span>
            </div>
            {keywordProgress.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-[#64748B]">Đã quét được:</span>
                {keywordProgress.map((row) => {
                  const target = keywordTargets[row.keyword] || applyAllTarget;
                  const count = Number(row.count) || 0;
                  const done = row.status === "done" || (target > 0 && count >= target);
                  return (
                    <span
                      key={row.keyword}
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                        done
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : row.status === "scanning"
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B]"
                      }`}
                    >
                      {row.keyword}{" "}
                      <span className="tabular-nums">
                        {count}/{target}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!pages.length}
              onClick={handleExportCSV}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
            >
              <Download className="size-3.5" />
              Xuất toàn bộ file
            </button>
            <button
              type="button"
              disabled={!pages.length && !totalCount}
              onClick={handleSaveList}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 text-xs font-bold text-white disabled:opacity-40"
            >
              <Save className="size-3.5" />
              Lưu danh sách
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-[#F1F5F9] px-5 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#94A3B8]" />
            <input
              value={resultSearch}
              onChange={(e) => setResultSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sessionId && loadResults(sessionId, 1)}
              placeholder="Tìm Tên, Link, SĐT, Email, Tỉnh thành..."
              className="h-8 w-full rounded-lg border border-[#E2E8F0] pl-8 pr-3 text-xs outline-none focus:border-[#2563EB]"
            />
          </div>
          <select
            value={filterKeyword}
            onChange={(e) => setFilterKeyword(e.target.value)}
            className="h-8 rounded-lg border border-[#E2E8F0] bg-white px-2 text-xs text-[#64748B] outline-none"
          >
            <option value="ALL">Tất cả từ khóa</option>
            {keywordOptions.map((kw) => (
              <option key={kw} value={kw}>
                {kw}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-xs">
            <thead className="bg-[#F8FAFC] text-[10px] font-bold uppercase tracking-wide text-[#64748B]">
              <tr>
                <th className="w-10 px-4 py-2.5">
                  <Checkbox
                    checked={pages.length > 0 && selectedPageKeys.length === pages.length}
                    onCheckedChange={(c) => setSelectedPageKeys(c ? pages.map((p) => p.page_key) : [])}
                  />
                </th>
                <th className="w-14 px-2 py-2.5">STT</th>
                <th className="px-3 py-2.5">Từ khóa</th>
                <th className="px-3 py-2.5">Tên page</th>
                <th className="px-3 py-2.5">Link page</th>
                <th className="px-3 py-2.5">Số điện thoại</th>
                <th className="px-3 py-2.5">Email</th>
                <th className="px-3 py-2.5">Website</th>
                <th className="px-3 py-2.5">Vị trí / Địa chỉ</th>
              </tr>
            </thead>
            <tbody>
              {loadingResults ? (
                <tr>
                  <td colSpan={9} className="px-4 py-14 text-center text-sm text-[#94A3B8]">
                    <Loader2 className="mx-auto mb-2 size-6 animate-spin text-[#2563EB]" />
                    Đang tải kết quả…
                  </td>
                </tr>
              ) : pages.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-14 text-center text-sm text-[#94A3B8]">
                    Chưa có page trong kết quả (hoặc đang lọc follower).
                  </td>
                </tr>
              ) : (
                pages.map((page, idx) => {
                  const globalIdx = (currentPage - 1) * pageSize + idx + 1;
                  const selected = selectedPageKeys.includes(page.page_key);
                  const kwLabel = pageKeywordLabel(page);
                  return (
                    <tr
                      key={page.page_key || page.id || idx}
                      className={`border-t border-[#F1F5F9] ${
                        selected ? "bg-[#EFF6FF]/60" : "hover:bg-[#F8FAFC]/60"
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <Checkbox
                          checked={selected}
                          onCheckedChange={(c) =>
                            setSelectedPageKeys((prev) =>
                              c ? [...prev, page.page_key] : prev.filter((k) => k !== page.page_key),
                            )
                          }
                        />
                      </td>
                      <td className="px-2 py-2.5 tabular-nums text-[#64748B]">#{globalIdx}</td>
                      <td className="px-3 py-2.5 text-[#64748B]">{kwLabel}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <Avatar className="size-8 border border-[#E2E8F0]">
                            {page.avatar_url && <AvatarImage src={page.avatar_url} />}
                            <AvatarFallback className={AVATAR_COLORS[idx % AVATAR_COLORS.length]}>
                              {initialsOf(page.page_name || "FB")}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex min-w-0 items-center gap-1">
                            <span className="max-w-[180px] truncate font-semibold text-[#0F172A]">
                              {page.page_name || "—"}
                            </span>
                            {page.is_verified === true && (
                              <BadgeCheck className="size-3.5 shrink-0 text-[#2563EB]" />
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {page.page_url ? (
                          <a
                            href={page.page_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex max-w-[180px] items-center gap-1 truncate text-[#2563EB] hover:underline"
                          >
                            {page.page_url.replace(/^https?:\/\/(m\.|www\.)?facebook\.com\//, "fb.com/")}
                            <ExternalLink className="size-3 shrink-0" />
                          </a>
                        ) : (
                          <span className="text-[#CBD5E1]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {page.phone ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald-600">
                            <Phone className="size-3 shrink-0" />
                            {page.phone}
                          </span>
                        ) : (
                          <span className="italic text-[#CBD5E1]">Chưa cập nhật</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[#0F172A]">
                        {page.email || <span className="italic text-[#CBD5E1]">Chưa cập nhật</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {page.website ? (
                          <a
                            href={page.website.startsWith("http") ? page.website : `https://${page.website}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block max-w-[140px] truncate text-[#2563EB] hover:underline"
                          >
                            {page.website.replace(/^https?:\/\//, "")}
                          </a>
                        ) : (
                          <span className="italic text-[#CBD5E1]">Chưa cập nhật</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[#0F172A]">
                        {page.address || <span className="italic text-[#CBD5E1]">Chưa cập nhật</span>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-[#F1F5F9] px-5 py-3">
          <span className="text-[11px] text-[#94A3B8]">
            Hiển thị {totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1} -{" "}
            {Math.min(currentPage * pageSize, totalCount)} của {totalCount.toLocaleString("vi-VN")} Page
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={currentPage <= 1 || !sessionId}
              onClick={() => {
                setCurrentPage(currentPage - 1);
                loadResults(sessionId, currentPage - 1);
              }}
              className="flex size-7 items-center justify-center rounded-md border border-[#E2E8F0] text-[#64748B] disabled:opacity-40"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                type="button"
                disabled={!sessionId}
                onClick={() => {
                  setCurrentPage(p);
                  loadResults(sessionId, p);
                }}
                className={`flex size-7 items-center justify-center rounded-md text-[11px] font-semibold ${
                  p === currentPage
                    ? "bg-[#2563EB] text-white"
                    : "text-[#64748B] hover:bg-slate-100"
                }`}
              >
                {p}
              </button>
            ))}
            {totalPages > 5 && <span className="px-1 text-[11px] text-[#94A3B8]">… {totalPages}</span>}
            <button
              type="button"
              disabled={currentPage >= totalPages || !sessionId}
              onClick={() => {
                setCurrentPage(currentPage + 1);
                loadResults(sessionId, currentPage + 1);
              }}
              className="flex size-7 items-center justify-center rounded-md border border-[#E2E8F0] text-[#64748B] disabled:opacity-40"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* Live log — khung trắng ngoài như Figma/scan-info */}
      <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-heading text-sm font-bold text-[#0F172A]">Theo dõi tiến trình</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!logs.length) {
                  toast.warning("Chưa có log để sao chép.");
                  return;
                }
                const text = logs.map((l) => `[${l.timestamp}] ${l.message}`).join("\n");
                navigator.clipboard
                  ?.writeText(text)
                  .then(() => toast.success(`Đã sao chép ${logs.length} dòng log`))
                  .catch(() => toast.error("Không thể sao chép log"));
              }}
              disabled={!logs.length}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#E2E8F0] px-2.5 py-1 text-[10px] font-semibold text-[#64748B] hover:bg-slate-50 disabled:opacity-40"
            >
              <Copy className="size-3.5" />
              Copy log
            </button>
            <span
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-0.5 font-mono text-[10px] font-semibold ${
                isPaused
                  ? "bg-amber-500/10 text-amber-600"
                  : isRunning
                    ? "bg-emerald-500/10 text-emerald-600"
                    : "bg-slate-100 text-slate-500"
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  isPaused ? "bg-amber-500" : isRunning ? "animate-pulse bg-emerald-500" : "bg-slate-400"
                }`}
              />
              {isPaused ? "PAUSED" : isRunning ? "RUNNING" : "IDLE"}
            </span>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#1e293b] shadow-inner">
          <div className="flex items-center justify-between border-b border-slate-800 bg-[#0f172a] px-4 py-2.5">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-rose-500" />
                <span className="size-2.5 rounded-full bg-amber-500" />
                <span className="size-2.5 rounded-full bg-emerald-500" />
              </div>
              <span className="font-mono text-xs font-semibold text-slate-300">
                Live Automation Log Console [Thread-01 - Quét Page]
              </span>
            </div>
          </div>
          <div className="max-h-52 space-y-1.5 overflow-y-auto px-4 py-3 font-mono text-[11px] leading-relaxed">
            {logs.length === 0 ? (
              <p className="text-slate-500">Chờ log phiên quét…</p>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="flex items-start gap-2 text-slate-300">
                  <span className="shrink-0 text-slate-500">[{log.timestamp}]</span>
                  <span
                    className={
                      log.type === "success"
                        ? "text-emerald-400"
                        : log.type === "warn"
                          ? "text-amber-400"
                          : log.type === "error"
                            ? "text-rose-400"
                            : "text-slate-200"
                    }
                  >
                    {log.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
        </>
      )}

      {/* Account multi-select modal */}
      {showAccountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h2 className="font-bold text-slate-800">Chọn tài khoản thực thi</h2>
                <p className="mt-0.5 text-[11px] text-slate-400">Có thể chọn nhiều acc — luân phiên theo từng từ khóa</p>
              </div>
              <button type="button" onClick={() => setShowAccountModal(false)} className="rounded-lg p-1.5 hover:bg-slate-100">
                <X className="size-4 text-slate-500" />
              </button>
            </div>
            <div className="max-h-[400px] overflow-auto px-6 py-4">
              {accountsLoading ? (
                <div className="py-10 text-center text-slate-400">
                  <Loader2 className="mx-auto mb-2 size-6 animate-spin" />
                  Đang tải tài khoản…
                </div>
              ) : (
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="border-b border-slate-200">
                      <th className="w-10 px-3 py-2.5">
                        <Checkbox
                          checked={accounts.length > 0 && modalUids.length === accounts.filter((a) => LIVE_STATUSES.has(String(a.status))).length}
                          onCheckedChange={(c) => {
                            if (c) setModalUids(accounts.filter((a) => LIVE_STATUSES.has(String(a.status))).map((a) => a.uid));
                            else setModalUids([]);
                          }}
                        />
                      </th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-500">TÀI KHOẢN</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-500">UID</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-500">TRẠNG THÁI</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-500">PROXY</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {accounts.map((acc, idx) => {
                      const checked = modalUids.includes(acc.uid);
                      return (
                        <tr
                          key={acc.uid}
                          onClick={() =>
                            setModalUids((prev) => (checked ? prev.filter((u) => u !== acc.uid) : [...prev, acc.uid]))
                          }
                          className={`cursor-pointer ${checked ? "bg-blue-50" : "hover:bg-slate-50"}`}
                        >
                          <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(c) =>
                                setModalUids((prev) => (c ? [...prev, acc.uid] : prev.filter((u) => u !== acc.uid)))
                              }
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <Avatar className="size-8">
                                <AvatarFallback className={AVATAR_COLORS[idx % AVATAR_COLORS.length]}>{initialsOf(acc.name)}</AvatarFallback>
                              </Avatar>
                              <span className="font-semibold text-slate-700">{acc.name}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-slate-500">{acc.uid}</td>
                          <td className="px-3 py-2.5">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${LIVE_STATUSES.has(String(acc.status)) ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                              • {acc.status}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[10px] text-slate-400">{acc.proxy || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
              <span className="text-[11px] text-slate-500">Đã chọn tạm: {modalUids.length}</span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowAccountModal(false)}>Hủy</Button>
                <Button
                  onClick={() => {
                    setSelectedUids(modalUids);
                    setShowAccountModal(false);
                  }}
                >
                  <Check className="mr-1.5 size-3.5" /> Xác nhận ({modalUids.length})
              </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
