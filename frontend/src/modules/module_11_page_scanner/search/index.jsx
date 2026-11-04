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
  Trash2,
  FileSpreadsheet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "@/lib/toast";
import { WS_BASE } from "@/config/constants";
import { getAccounts } from "@/modules/module_02_account_manager/service";
import { normalizeAccount, initialsOf } from "@/modules/module_07_group_spam/shared/components";
import { AVATAR_COLORS } from "@/modules/module_07_group_spam/shared/constants";
import { SelectAccountsModal } from "../shared/SelectPagesModal";
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
  { id: "upload", label: "Tải tệp (.txt / .csv / .excel)", Icon: FileUp },
];

const DONE_STATUSES = ["COMPLETED", "PARTIAL", "STOPPED", "FAILED"];
const LIVE_STATUSES = new Set(["LIVE", "live", "Live"]);

function nowStamp() {
  return new Date().toLocaleTimeString("vi-VN", { hour12: false });
}

function parseRawLinesToPreview(rawText) {
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const seen = new Set();
  return lines.map((line, idx) => {
    const key = line.toLowerCase().replace(/\/+$/, "");
    const isValid =
      /^(https?:\/\/)?(www\.|m\.|mbasic\.)?(facebook\.com|fb\.com)\/.+/i.test(line) ||
      /^\d{6,25}$/.test(line);
    let status = "valid";
    if (!isValid) status = "invalid";
    else if (seen.has(key)) status = "duplicate";
    else seen.add(key);
    return {
      id: `ln_${idx}_${line}`,
      lineNo: idx + 1,
      raw: line,
      status,
    };
  });
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
  const [uploadFileMeta, setUploadFileMeta] = useState(null);
  const [uploadPreviewRows, setUploadPreviewRows] = useState([]);
  const [uploadFilterTab, setUploadFilterTab] = useState("ALL");
  const fileInputRef = useRef(null);

  const pastePreviewRows = useMemo(
    () => parseRawLinesToPreview(pasteContent),
    [pasteContent],
  );

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
  const [targetPagesCount, setTargetPagesCount] = useState(30);
  const [publicOnly, setPublicOnly] = useState(true);
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
    const rawText = await file.text().catch(() => "");
    const parsedRows = parseRawLinesToPreview(rawText);
    setUploadPreviewRows(parsedRows);
    setUploadFileMeta({
      name: file.name,
      sizeKb: Math.max(0.1, Number((file.size / 1024).toFixed(1))),
      totalRows: parsedRows.length,
    });
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await uploadPageFile(formData);
      setUploadResult(res);
      toast.success(`Đã nhận diện ${parsedRows.length || res.valid_count} dòng dữ liệu từ "${file.name}"`);
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
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#1E293B]">
                  Dán danh sách liên kết Fanpage Facebook
                </span>
                <span className="rounded-full bg-[#EFF6FF] px-3 py-0.5 text-[11px] font-bold text-[#1877F2]">
                  Đã nhận diện: {pastePreviewRows.length} link
                </span>
              </div>
              <textarea
                value={pasteContent}
                onChange={(e) => setPasteContent(e.target.value)}
                disabled={isBusy}
                rows={5}
                placeholder={
                  "https://www.facebook.com/groups/109283749218\nhttps://facebook.com/groups/congdongmarketingvn"
                }
                className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 font-mono text-xs leading-relaxed text-[#0F172A] outline-none transition focus:border-[#1877F2] focus:bg-white disabled:opacity-60"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={isBusy || !pasteContent.trim()}
                  onClick={() => setPasteContent("")}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#EF4444] hover:underline disabled:opacity-40"
                >
                  <Trash2 className="size-3.5" />
                  Xóa tất cả
                </button>
                <button
                  type="button"
                  disabled={isBusy || !pasteContent.trim()}
                  onClick={() => {
                    const uniqueLines = [];
                    const seen = new Set();
                    pasteContent
                      .split(/\r?\n/)
                      .map((l) => l.trim())
                      .filter(Boolean)
                      .forEach((l) => {
                        const k = l.toLowerCase().replace(/\/+$/, "");
                        if (!seen.has(k)) {
                          seen.add(k);
                          uniqueLines.push(l);
                        }
                      });
                    const removed = pastePreviewRows.length - uniqueLines.length;
                    setPasteContent(uniqueLines.join("\n"));
                    toast.success(
                      removed > 0
                        ? `Đã lọc bỏ ${removed} link trùng lặp, còn ${uniqueLines.length} link hợp lệ.`
                        : `Tất cả ${uniqueLines.length} link đều không trùng lặp.`,
                    );
                  }}
                  className="inline-flex h-8 items-center rounded-lg bg-[#1877F2] px-3.5 text-xs font-bold text-white shadow-sm hover:bg-[#166FE5] disabled:opacity-50"
                >
                  Kiểm tra & Lọc trùng lặp
                </button>
              </div>

              {/* XEM TRƯỚC DANH SÁCH LINK ĐÃ NHẬP (Ảnh 9) */}
              {pastePreviewRows.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white">
                  <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-3.5 py-2 text-[11px] font-bold uppercase tracking-wide text-[#334155]">
                    XEM TRƯỚC DANH SÁCH LINK ĐÃ NHẬP ({pastePreviewRows.length} LINK)
                  </div>
                  <div className="max-h-[210px] overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-white text-[11px] font-semibold text-[#64748B]">
                        <tr className="border-b border-[#F1F5F9]">
                          <th className="w-12 px-3 py-2">STT</th>
                          <th className="px-3 py-2">Đường dẫn Fanpage Facebook</th>
                          <th className="w-24 px-3 py-2 text-center">Trạng thái</th>
                          <th className="w-10 px-2 py-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F1F5F9]">
                        {pastePreviewRows.map((row, idx) => (
                          <tr key={row.id} className="hover:bg-[#F8FAFC]">
                            <td className="px-3 py-2 font-mono text-[#64748B]">
                              {idx + 1}
                            </td>
                            <td className="max-w-[260px] truncate px-3 py-2 font-mono text-[#1877F2]">
                              {row.raw}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {row.status === "valid" ? (
                                <span className="rounded-full bg-[#ECFDF5] px-2.5 py-0.5 text-[10px] font-bold text-[#059669]">
                                  Hợp lệ
                                </span>
                              ) : row.status === "duplicate" ? (
                                <span className="rounded-full bg-[#FEF3C7] px-2.5 py-0.5 text-[10px] font-bold text-[#D97706]">
                                  Trùng lặp
                                </span>
                              ) : (
                                <span className="rounded-full bg-[#FEF2F2] px-2.5 py-0.5 text-[10px] font-bold text-[#DC2626]">
                                  Lỗi link
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  const lines = pasteContent
                                    .split(/\r?\n/)
                                    .map((l) => l.trim())
                                    .filter(Boolean);
                                  lines.splice(idx, 1);
                                  setPasteContent(lines.join("\n"));
                                }}
                                className="rounded p-1 text-[#94A3B8] hover:bg-slate-100 hover:text-[#EF4444]"
                              >
                                <X className="size-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {sourceMode === "upload" && (
            <div className="space-y-3">
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#93C5FD] bg-[#F8FAFC] px-4 py-7 text-center hover:border-[#1877F2]">
                <div className="flex size-10 items-center justify-center rounded-full bg-[#EFF6FF] text-[#1877F2]">
                  <FileUp className="size-5" />
                </div>
                <span className="text-xs font-semibold text-[#0F172A]">
                  Kéo thả file <span className="text-[#1877F2]">.txt</span> hoặc{" "}
                  <span className="text-[#1877F2]">.csv</span> vào đây hoặc{" "}
                  <span className="text-[#1877F2] underline">Bấm để tải lên</span>
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.csv"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </label>

              {/* Card thông tin file đã chọn (Ảnh 8) */}
              {uploadFileMeta && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-[#E2E8F0] bg-white px-3.5 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-[#ECFDF5] text-[#059669]">
                      <FileSpreadsheet className="size-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-[#0F172A]">
                        {uploadFileMeta.name}{" "}
                        <span className="font-normal text-[#94A3B8]">
                          ({uploadFileMeta.sizeKb} KB)
                        </span>
                      </p>
                      <p className="text-[11px] font-semibold text-[#059669]">
                        ✓ Đã nhận diện: {uploadFileMeta.totalRows} dòng dữ liệu
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs font-semibold text-[#1877F2] hover:underline"
                  >
                    Thay đổi tệp
                  </button>
                </div>
              )}

              {/* XEM TRƯỚC DANH SÁCH TẢI LÊN (Ảnh 8) */}
              {uploadPreviewRows.length > 0 && (() => {
                const validRows = uploadPreviewRows.filter((r) => r.status === "valid");
                const dupRows = uploadPreviewRows.filter((r) => r.status === "duplicate");
                const displayRows =
                  uploadFilterTab === "VALID"
                    ? validRows
                    : uploadFilterTab === "DUP"
                      ? dupRows
                      : uploadPreviewRows;
                return (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-[#0F172A]">
                        XEM TRƯỚC DANH SÁCH TẢI LÊN
                      </span>
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <button
                          type="button"
                          onClick={() => setUploadFilterTab("ALL")}
                          className={`rounded-full px-2.5 py-0.5 font-bold ${
                            uploadFilterTab === "ALL"
                              ? "bg-[#DBEAFE] text-[#1D4ED8]"
                              : "bg-[#F1F5F9] text-[#64748B]"
                          }`}
                        >
                          Tất cả ({uploadPreviewRows.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setUploadFilterTab("VALID")}
                          className={`rounded-full px-2.5 py-0.5 font-bold ${
                            uploadFilterTab === "VALID"
                              ? "bg-[#D1FAE5] text-[#059669]"
                              : "bg-[#F1F5F9] text-[#64748B]"
                          }`}
                        >
                          Hợp lệ ({validRows.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setUploadFilterTab("DUP")}
                          className={`rounded-full px-2.5 py-0.5 font-bold ${
                            uploadFilterTab === "DUP"
                              ? "bg-[#FEF3C7] text-[#D97706]"
                              : "bg-[#FEF3C7]/60 text-[#D97706]"
                          }`}
                        >
                          Trùng lặp ({dupRows.length})
                        </button>
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white">
                      <div className="max-h-[200px] overflow-y-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="sticky top-0 bg-[#F8FAFC] text-[11px] font-semibold text-[#64748B]">
                            <tr className="border-b border-[#E2E8F0]">
                              <th className="w-14 px-3 py-2">Dòng</th>
                              <th className="px-3 py-2">Dữ liệu tệp</th>
                              <th className="w-24 px-3 py-2 text-center">Trạng thái</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#F1F5F9]">
                            {displayRows.map((r) => (
                              <tr key={r.id} className="hover:bg-[#F8FAFC]">
                                <td className="px-3 py-2 font-mono text-[#64748B]">
                                  {r.lineNo}
                                </td>
                                <td className="max-w-[260px] truncate px-3 py-2 font-mono text-[#334155]">
                                  {r.raw}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  {r.status === "valid" ? (
                                    <span className="rounded-full bg-[#ECFDF5] px-2.5 py-0.5 text-[10px] font-bold text-[#059669]">
                                      Hợp lệ
                                    </span>
                                  ) : (
                                    <span className="rounded-full bg-[#FEF3C7] px-2.5 py-0.5 text-[10px] font-bold text-[#D97706]">
                                      Trùng lặp
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="border-t border-[#F1F5F9] bg-[#F8FAFC] px-3 py-1.5 text-right text-[11px] text-[#94A3B8]">
                        Hiển thị {Math.min(5, displayRows.length)} trên {uploadPreviewRows.length} dòng được phân tích
                      </div>
                    </div>
                  </div>
                );
              })()}

              <button
                type="button"
                onClick={downloadPageTemplate}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-[#1877F2] hover:underline"
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
                <p className="text-[11px] font-semibold text-[#64748B]">
                  Cấu hình số nhóm mục tiêu theo từng hashtag
                </p>
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

          <div className="space-y-3.5 border-t border-[#F1F5F9] pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#0F172A]">
              <span>Đổi tài khoản mới khi quét được</span>
              <div className="flex items-center gap-2">
                <NumCtrl
                  value={rotateEvery}
                  onChange={setRotateEvery}
                  min={1}
                  max={500}
                  step={10}
                  disabled={isBusy}
                />
                <span className="text-[#64748B]">page / tài khoản</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#0F172A]">
              <span>Khoảng cách giữa các lần quét</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <NumCtrl
                  value={delayMin}
                  onChange={(v) => {
                    setDelayMin(v);
                    if (v > delayMax) setDelayMax(v);
                  }}
                  min={1}
                  max={120}
                  step={1}
                  disabled={isBusy}
                />
                <span className="text-[#64748B]">đến</span>
                <NumCtrl
                  value={delayMax}
                  onChange={(v) => setDelayMax(Math.max(delayMin, v))}
                  min={1}
                  max={180}
                  step={1}
                  disabled={isBusy}
                />
                <span className="text-[#64748B]">giây</span>
              </div>
            </div>

            {sourceMode !== "keyword" && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#0F172A]">
                <span>Số nhóm mục tiêu bạn muốn quét</span>
                <div className="flex items-center gap-2">
                  <NumCtrl
                    value={targetPagesCount}
                    onChange={setTargetPagesCount}
                    min={1}
                    max={1000}
                    step={5}
                    disabled={isBusy}
                  />
                  <span className="text-[#64748B]">Page</span>
                </div>
              </div>
            )}

            {sourceMode !== "keyword" && (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-[#0F172A]">
                <Checkbox
                  checked={publicOnly}
                  disabled={isBusy}
                  onCheckedChange={(c) => setPublicOnly(!!c)}
                />
                <span>Chỉ quét nhóm đang ở chế độ công khai</span>
              </label>
            )}

            <label className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-xs text-[#0F172A]">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={minFollowersEnabled}
                  disabled={isBusy}
                  onCheckedChange={(c) => setMinFollowersEnabled(!!c)}
                />
                <span>Chỉ quét page có số lượng followers lớn hơn</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  disabled={isBusy || !minFollowersEnabled}
                  value={minFollowers}
                  onChange={(e) => setMinFollowers(Math.max(0, Number(e.target.value) || 0))}
                  className={`${FIGMA.input} w-20`}
                />
                <span className="text-[#64748B]">Followers</span>
              </div>
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

      {/* Account multi-select modal (Ảnh 2) */}
      <SelectAccountsModal
        open={showAccountModal}
        onClose={() => setShowAccountModal(false)}
        accounts={accounts}
        loading={accountsLoading}
        selectedUids={selectedUids}
        onConfirm={(uids) => setSelectedUids(uids)}
      />
    </div>
  );
}
