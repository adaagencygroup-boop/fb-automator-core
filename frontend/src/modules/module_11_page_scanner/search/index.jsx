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
  CheckCircle2,
  BadgeCheck,
  Search,
  Phone,
  Save,
  AlertTriangle,
  Plus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

/* ─── Atoms ─── */
function SectionCard({ number, title, description, aside, children }) {
  return (
    <Card className="overflow-hidden border-slate-200 shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
        <div className="flex min-w-0 items-start gap-3">
          {number && (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
              {number}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="font-heading text-sm font-bold leading-5 text-slate-800">{title}</h3>
            {description && <p className="mt-0.5 text-[11px] leading-4 text-slate-400">{description}</p>}
          </div>
        </div>
        {aside}
      </div>
      <div className="px-6 py-5">{children}</div>
    </Card>
  );
}

function NumCtrl({ value, onChange, min = 1, max = 500, step = 10, disabled, className = "" }) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
        className="flex size-7 items-center justify-center rounded border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
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
        className="h-7 w-16 rounded border border-slate-200 bg-white text-center text-xs font-semibold text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50"
      />
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
        className="flex size-7 items-center justify-center rounded border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

function ChipInput({ chips, onChange, placeholder, disabled, onEnter, mixed = false }) {
  const [draft, setDraft] = useState("");
  const add = (raw) => {
    const parts = String(raw || "")
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...chips];
    for (const p of parts) {
      let value = p;
      if (mixed && p.startsWith("#")) {
        const n = normalizeHashtag(p);
        if (!n) continue;
        value = n;
      }
      if (!next.some((c) => c.toLowerCase() === value.toLowerCase())) next.push(value);
    }
    onChange(next);
    setDraft("");
  };
  return (
    <div className={`flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1.5 ${disabled ? "opacity-60" : "focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20"}`}>
      {chips.map((chip) => {
        const tag = mixed && isHashtagChip(chip);
        return (
          <span
            key={chip}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
              tag
                ? "bg-violet-100 text-violet-700 border border-violet-200"
                : "bg-primary/10 text-primary"
            }`}
          >
            {tag && <Hash className="size-3 shrink-0" />}
            {chip}
            {!disabled && (
              <button type="button" onClick={() => onChange(chips.filter((c) => c !== chip))} className="hover:text-red-600">
                <X className="size-3" />
              </button>
            )}
          </span>
        );
      })}
      <input
        value={draft}
        disabled={disabled}
        placeholder={chips.length ? "" : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            if (draft.trim()) add(draft);
            else if (e.key === "Enter" && onEnter) onEnter();
          } else if (e.key === "Backspace" && !draft && chips.length) {
            onChange(chips.slice(0, -1));
          }
        }}
        onBlur={() => draft.trim() && add(draft)}
        className="min-w-[120px] flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400"
      />
    </div>
  );
}

const SOURCE_MODES = [
  { id: "keyword", label: "Theo từ khóa", Icon: Search },
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
  const campaignPreviewJobs = useMemo(
    () =>
      sourceMode === "keyword"
        ? buildCampaignJobs({ searchMode, keywords: plainKeywords, manualHashtags })
        : [],
    [sourceMode, searchMode, plainKeywords, manualHashtags],
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
  const [pageSize] = useState(5);
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

  /* Sync hạn mức page mục tiêu theo từng hashtag sẽ quét */
  useEffect(() => {
    setKeywordTargets((prev) => {
      const next = { ...prev };
      for (const tag of derivedHashtags) {
        if (next[tag] == null) next[tag] = applyAllTarget;
      }
      Object.keys(next).forEach((k) => {
        if (!derivedHashtags.includes(k)) delete next[k];
      });
      return next;
    });
  }, [derivedHashtags, applyAllTarget]);

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

  /* Q5 — Kiểm tra: chip hợp lệ + acc còn sống (không quét thử) */
  const handlePreflight = () => {
    const errors = [];
    if (sourceMode === "keyword") {
      if (!keywords.length) errors.push("Chưa nhập từ khóa hoặc hashtag (#).");
      if (!plainKeywords.length && !manualHashtags.length) {
        errors.push("Không tách được chip hợp lệ.");
      }
      if (!derivedHashtags.length) {
        errors.push("Cần ít nhất 1 hashtag (nhập #... hoặc từ khóa để suy ra #).");
      }
      keywords.forEach((chip) => {
        if (chip.length > 255) errors.push(`Chip quá dài: "${chip.slice(0, 40)}…"`);
        if (isHashtagChip(chip) && !normalizeHashtag(chip)) {
          errors.push(`Hashtag không hợp lệ: "${chip}" (không dấu phẩy / khoảng trắng).`);
        }
      });
      const jobs = buildCampaignJobs({ searchMode, keywords: plainKeywords, manualHashtags });
      if (!jobs.length) errors.push("Chế độ hiện tại không sinh được phiên quét nào.");
      else pushLog(`Sẽ chạy ${jobs.length} phiên: ${jobs.map((j) => j.label).join(" · ")}`, "info");
    } else if (sourceMode === "paste") {
      if (!pasteContent.trim()) errors.push("Chưa dán link Page.");
    } else if (sourceMode === "upload") {
      if (!uploadResult) errors.push("Chưa tải file lên.");
    }

    if (selectedUids.length) {
      const live = accounts.filter((a) => selectedUids.includes(a.uid) && LIVE_STATUSES.has(String(a.status)));
      const dead = selectedUids.filter((uid) => !live.some((a) => a.uid === uid));
      if (!live.length) errors.push("Không có tài khoản Live trong danh sách đã chọn.");
      else if (dead.length) errors.push(`${dead.length} tài khoản không Live sẽ bị bỏ qua khi chạy.`);
    } else {
      errors.push("Chưa chọn tài khoản — hệ thống sẽ tự chọn nếu có acc Live.");
    }

    if (delayMin > delayMax) errors.push("Khoảng giãn cách không hợp lệ (từ > đến).");

    if (errors.length) {
      errors.forEach((e) => pushLog(e, "error"));
      toast.error(errors[0]);
      return false;
    }
    toast.success("Kiểm tra OK — chip & tài khoản sẵn sàng.");
    pushLog("Preflight OK · chỉ quét theo hashtag.", "success");
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
    if (!handlePreflight()) return;
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
    <div className="space-y-5 pb-8">
      {/* Header copy */}
      <div>
        <h1 className="font-heading text-xl font-bold text-slate-900">Quét thông tin page</h1>
        <p className="mt-1 text-xs text-slate-500">
          Tab Từ khóa / #hashtag — chỉ quét theo hashtag (bài viết → Page) · kèm Follower, SĐT, Email, Website.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ═══ Card 1 ═══ */}
        <SectionCard
          number="1"
          title="Chọn tài khoản & Thiết lập phiên quét"
          description="Chọn dàn acc, phương thức quét và danh sách mục tiêu"
          aside={
            selCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 border border-emerald-200">
                <CheckCircle2 className="size-3" /> Đã chọn: {selCount} tài khoản
              </span>
            ) : null
          }
        >
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={isBusy}
              onClick={() => {
                setModalUids([...selectedUids]);
                setShowAccountModal(true);
              }}
              className="gap-1.5"
            >
              <Plus className="size-3.5" /> Chọn tài khoản
            </Button>
            {selCount === 0 && (
              <span className="text-[11px] text-slate-400">Chưa chọn → hệ thống tự chọn acc Live</span>
            )}
          </div>

          <p className="mb-2 text-[11px] font-bold tracking-wide text-slate-500">PHƯƠNG THỨC QUÉT</p>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {SOURCE_MODES.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                disabled={isBusy}
                onClick={() => setSourceMode(id)}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[11px] font-semibold transition-all ${
                  sourceMode === id
                    ? "border-primary bg-primary text-white"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                } disabled:opacity-60`}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>

          {sourceMode === "keyword" && (
            <div className="space-y-3">
              <p className="text-[10px] text-slate-400">
                Chỉ tìm theo hashtag
                {campaignId ? ` · campaign ${campaignId}` : ""}
                {derivedHashtags.length > 0 ? ` · sẽ quét: ${derivedHashtags.join(", ")}` : ""}
                {campaignPreviewJobs.length > 0 ? ` · ${campaignPreviewJobs.length} phiên` : ""}
              </p>

              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                    Hashtag mục tiêu
                  </label>
                  <ChipInput
                    chips={keywords}
                    onChange={setKeywords}
                    disabled={isBusy}
                    mixed
                    placeholder="Vd: #mypham, thời trang (suy ra #thoitrang)…"
                  />
                  <p className="mt-1 text-[10px] text-slate-400">
                    {manualHashtags.length} hashtag nhập tay
                    {plainKeywords.length > 0 ? ` · ${plainKeywords.length} từ khóa → suy ra #` : ""}
                    {derivedHashtags.length > 0 ? ` · quét: ${derivedHashtags.join(", ")}` : ""}
                  </p>
                </div>
                <Button type="button" size="sm" variant="outline" className="mt-5 shrink-0" disabled={isBusy} onClick={handlePreflight}>
                  Kiểm tra
                </Button>
              </div>

              {keywordProgress.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Truy vấn</th>
                        <th className="px-3 py-2 text-left font-semibold">Kênh</th>
                        <th className="px-3 py-2 text-left font-semibold">Số page</th>
                        <th className="px-3 py-2 text-left font-semibold">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {keywordProgress.map((row) => (
                        <tr key={row.keyword}>
                          <td className="px-3 py-2 font-medium text-slate-700">
                            {String(row.keyword).startsWith("#") ? (
                              <span className="inline-flex items-center gap-1 text-violet-700">
                                <Hash className="size-3" />
                                {row.keyword}
                              </span>
                            ) : (
                              row.keyword
                            )}
                          </td>
                          <td className="px-3 py-2 text-[10px] text-slate-500">{row.channel || "—"}</td>
                          <td className="px-3 py-2 text-slate-600">
                            {row.count > 0 ? `${row.count.toLocaleString("vi-VN")} page` : "—"}
                          </td>
                          <td className="px-3 py-2">
                            {row.status === "done" && (
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Hoàn thành</span>
                            )}
                            {row.status === "scanning" && (
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">Đang quét</span>
                            )}
                            {row.status === "pending" && (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">Chờ</span>
                            )}
                            {row.status === "paused" && (
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">Tạm dừng</span>
                            )}
                            {row.status === "error" && (
                              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600">Lỗi</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {sourceMode === "paste" && (
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">Dán link Page (mỗi dòng 1 link)</label>
              <Textarea
                value={pasteContent}
                onChange={(e) => setPasteContent(e.target.value)}
                disabled={isBusy}
                rows={7}
                placeholder={"https://www.facebook.com/tenpage\nhttps://facebook.com/profile.php?id=..."}
                className="font-mono text-[11px]"
              />
            </div>
          )}

          {sourceMode === "upload" && (
            <div>
              <div
                className="relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 p-8 text-center hover:border-primary/40"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUp className="size-8 text-slate-400" />
                <p className="text-sm font-semibold text-slate-700">Kéo thả .txt / .csv hoặc bấm để tải lên</p>
                <input ref={fileInputRef} type="file" accept=".txt,.csv" hidden onChange={handleFileUpload} />
              </div>
              {uploadResult && (
                <p className="mt-2 text-[11px] text-emerald-700 font-semibold">
                  ✓ Hợp lệ {uploadResult.valid_count} · Trùng {uploadResult.dedup_count} · Lỗi {uploadResult.invalid_count}
                </p>
              )}
              <button type="button" onClick={downloadPageTemplate} className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline">
                <Download className="size-3" /> Tải file mẫu
              </button>
            </div>
          )}
        </SectionCard>

        {/* ═══ Card 2 ═══ */}
        <SectionCard number="2" title="Thiết lập cấu hình quét mục tiêu">
          <div className="space-y-4">
            <label className="flex flex-wrap items-center gap-2 text-[12px] text-slate-800">
              <span>Đổi tài khoản mới khi quét được</span>
              <NumCtrl value={rotateEvery} onChange={setRotateEvery} min={1} max={500} step={10} disabled={isBusy} />
              <span className="text-slate-500">page / tài khoản</span>
            </label>

            <label className="flex flex-wrap items-center gap-2 text-[12px] text-slate-800">
              <span>Khoảng cách giữa các lần quét</span>
              <input
                type="number"
                min={1}
                max={120}
                disabled={isBusy}
                value={delayMin}
                onChange={(e) => setDelayMin(Math.max(1, Number(e.target.value) || 1))}
                className="h-7 w-14 rounded border border-slate-200 text-center text-xs font-semibold"
              />
              <span className="text-slate-500">đến</span>
              <input
                type="number"
                min={1}
                max={180}
                disabled={isBusy}
                value={delayMax}
                onChange={(e) => setDelayMax(Math.max(delayMin, Number(e.target.value) || delayMin))}
                className="h-7 w-14 rounded border border-slate-200 text-center text-xs font-semibold"
              />
              <span className="text-slate-500">giây</span>
            </label>

            {sourceMode === "keyword" && (
              <div className="space-y-3 border-t border-slate-100 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold text-slate-700">
                    Cấu hình số page mục tiêu theo từng từ khóa
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-500">Áp dụng tất cả:</span>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      disabled={isBusy}
                      value={applyAllTarget}
                      onChange={(e) => setApplyAllTarget(Math.min(500, Math.max(1, Number(e.target.value) || 1)))}
                      className="h-7 w-14 rounded border border-slate-200 text-center text-xs font-semibold"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={isBusy || !derivedHashtags.length}
                      onClick={() => {
                        const next = {};
                        derivedHashtags.forEach((tag) => {
                          next[tag] = applyAllTarget;
                        });
                        setKeywordTargets(next);
                      }}
                    >
                      Áp dụng
                    </Button>
                  </div>
                </div>

                <div className="space-y-2 rounded-lg border border-slate-100 bg-slate-50/60 p-2">
                  {derivedHashtags.length === 0 ? (
                    <p className="px-1 py-2 text-[11px] text-slate-400">
                      Thêm hashtag / từ khóa ở Card 1 để đặt hạn mức page.
                    </p>
                  ) : (
                    derivedHashtags.map((tag, idx) => (
                      <div
                        key={tag}
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={`size-2 shrink-0 rounded-full ${
                              idx % 2 === 0 ? "bg-blue-500" : "bg-orange-400"
                            }`}
                          />
                          <span className="truncate text-[12px] font-medium text-slate-800">{tag}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <NumCtrl
                            value={keywordTargets[tag] || applyAllTarget}
                            onChange={(v) => setKeywordTargets((prev) => ({ ...prev, [tag]: v }))}
                            min={1}
                            max={500}
                            step={10}
                            disabled={isBusy}
                          />
                          <span className="text-[11px] text-slate-400">page</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                  <p className="text-[11px] leading-5 text-amber-900">
                    Lưu ý: Các page hiển thị ở vị trí đầu tiên của mỗi từ khóa thường có tương tác cao và chất
                    lượng tốt nhất. Bạn nên tối ưu số lượng mục tiêu vừa đủ để quét được tệp page tiềm năng nhất.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-2 border-t border-slate-100 pt-4">
              <label className="flex cursor-pointer flex-wrap items-center gap-2 text-[12px] text-slate-800">
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
                  className="h-7 w-20 rounded border border-slate-200 px-1 text-center text-xs font-semibold"
                />
                <span className="text-slate-500">Followers</span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 pl-6">
                <Checkbox
                  checked={skipSaveBelowThreshold}
                  disabled={isBusy || !minFollowersEnabled}
                  onCheckedChange={(c) => setSkipSaveBelowThreshold(!!c)}
                  className="mt-0.5"
                />
                <span className="text-[11px] text-slate-600">
                  Không lưu page dưới ngưỡng vào DB{" "}
                  <span className="text-slate-400">(mặc định: lưu hết, chỉ lọc khi xem)</span>
                </span>
              </label>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          size="lg"
          className="w-full gap-2 text-sm font-bold shadow-md shadow-primary/20"
          disabled={isBusy}
          onClick={handleStart}
        >
          {isBusy ? (
            <>
              <Loader2 className="size-4 animate-spin" /> ĐANG THỰC THI…
            </>
          ) : (
            <>
              <Play className="size-4" /> BẮT ĐẦU THỰC THI
            </>
          )}
        </Button>

        {isBusy && (
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="gap-2 border-red-300 text-red-600 hover:bg-red-50"
              onClick={handlePauseResume}
            >
              {isPaused ? (
                <>
                  <Play className="size-4" /> TIẾP TỤC
                </>
              ) : (
                <>
                  <Pause className="size-4" /> TẠM DỪNG
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="gap-2 border-red-400 bg-red-50 text-red-700 hover:bg-red-100"
              onClick={handleEmergencyStop}
            >
              <Square className="size-4" /> DỪNG KHẨN CẤP
            </Button>
          </div>
        )}
      </div>

      {/* Results + Log — chỉ hiện sau khi đã bắt đầu (trạng thái 2 / xong) */}
      {showResults && (
        <>
          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-3">
              <div>
                <h3 className="font-heading text-sm font-bold text-slate-800">Kết quả quét thông tin Page</h3>
                {poolStats.pool > 0 && (
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    Pool {poolStats.pool.toLocaleString("vi-VN")} → đạt ngưỡng FL: {poolStats.aboveMin.toLocaleString("vi-VN")} → đang hiện trang: {poolStats.showing}
                    {topN ? ` · Top ${topN}` : ""}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-emerald-200 bg-emerald-50 text-[11px] text-emerald-700 hover:bg-emerald-100"
                  disabled={!pages.length}
                  onClick={handleExportCSV}
                >
                  <Download className="size-3.5" /> Xuất toàn bộ file
                </Button>
                <Button type="button" size="sm" className="gap-1.5 text-[11px]" disabled={!pages.length && !totalCount} onClick={handleSaveList}>
                  <Save className="size-3.5" /> Lưu danh sách
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 pb-4">
              <div className="relative min-w-[220px] flex-1">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  value={resultSearch}
                  onChange={(e) => setResultSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sessionId && loadResults(sessionId, 1)}
                  placeholder="Tìm Tên, Link, SĐT, Email, Tỉnh thành..."
                  className="h-9 w-full pl-8 text-[11px]"
                />
              </div>
              <select
                value={filterKeyword}
                onChange={(e) => setFilterKeyword(e.target.value)}
                className="h-9 rounded-md border border-slate-200 bg-white px-3 text-[11px] font-medium text-slate-600"
              >
                <option value="ALL">Tất cả từ khóa</option>
                {keywordOptions.map((kw) => (
                  <option key={kw} value={kw}>
                    {kw}
                  </option>
                ))}
              </select>
            </div>

            <div className="overflow-auto">
              <table className="w-full min-w-[1100px] text-left text-[11px]">
                <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="w-10 px-4 py-3">
                      <Checkbox
                        checked={pages.length > 0 && selectedPageKeys.length === pages.length}
                        onCheckedChange={(c) => setSelectedPageKeys(c ? pages.map((p) => p.page_key) : [])}
                      />
                    </th>
                    <th className="w-12 px-3 py-3 font-semibold">STT</th>
                    <th className="px-3 py-3 font-semibold">TỪ KHÓA</th>
                    <th className="px-3 py-3 font-semibold">TÊN PAGE</th>
                    <th className="px-3 py-3 font-semibold">LINK PAGE</th>
                    <th className="px-3 py-3 font-semibold">SỐ ĐIỆN THOẠI</th>
                    <th className="px-3 py-3 font-semibold">EMAIL</th>
                    <th className="px-3 py-3 font-semibold">WEBSITE</th>
                    <th className="px-3 py-3 font-semibold">VỊ TRÍ / ĐỊA CHỈ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingResults ? (
                    <tr>
                      <td colSpan={9} className="py-14 text-center text-slate-400">
                        <Loader2 className="mx-auto mb-2 size-6 animate-spin text-primary" />
                        Đang tải kết quả…
                      </td>
                    </tr>
                  ) : pages.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-14 text-center text-slate-400">
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
                          className={selected ? "bg-blue-50/50" : "hover:bg-slate-50"}
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
                          <td className="px-3 py-2.5 font-mono text-slate-400">{String(globalIdx).padStart(2, "0")}</td>
                          <td className="px-3 py-2.5 font-medium text-slate-700">{kwLabel}</td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <Avatar className="size-8 border border-slate-200">
                                {page.avatar_url && <AvatarImage src={page.avatar_url} />}
                                <AvatarFallback className={AVATAR_COLORS[idx % AVATAR_COLORS.length]}>
                                  {initialsOf(page.page_name || "FB")}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex min-w-0 items-center gap-1">
                                <span className="truncate max-w-[180px] font-semibold text-slate-800">{page.page_name || "—"}</span>
                                {page.is_verified === true && <BadgeCheck className="size-3.5 shrink-0 text-blue-500" />}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            {page.page_url ? (
                              <a href={page.page_url} target="_blank" rel="noreferrer" className="inline-flex max-w-[180px] items-center gap-1 truncate text-primary hover:underline">
                                {page.page_url.replace(/^https?:\/\/(m\.|www\.)?facebook\.com\//, "fb.com/")}
                                <ExternalLink className="size-3 shrink-0" />
                              </a>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            {page.phone ? (
                              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                                <Phone className="size-3 shrink-0" />
                                {page.phone}
                              </span>
                            ) : (
                              <span className="italic text-slate-300">Chưa cập nhật</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-slate-600">
                            {page.email || <span className="italic text-slate-300">Chưa cập nhật</span>}
                          </td>
                          <td className="px-3 py-2.5">
                            {page.website ? (
                              <a
                                href={page.website.startsWith("http") ? page.website : `https://${page.website}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-block max-w-[140px] truncate text-primary hover:underline"
                              >
                                {page.website.replace(/^https?:\/\//, "")}
                              </a>
                            ) : (
                              <span className="italic text-slate-300">Chưa cập nhật</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-slate-600">
                            {page.address || <span className="italic text-slate-300">Chưa cập nhật</span>}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3">
              <span className="text-[11px] text-slate-400">
                Hiển thị {totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, totalCount)} của{" "}
                {totalCount.toLocaleString("vi-VN")} Page
                {minFollowersEnabled ? ` (lọc ≥ ${minFollowers.toLocaleString("vi-VN")} FL)` : ""}
              </span>
              <div className="flex items-center gap-1">
                <Button type="button" variant="outline" size="icon" className="size-7" disabled={currentPage <= 1} onClick={() => { setCurrentPage(currentPage - 1); loadResults(sessionId, currentPage - 1); }}>
                  <ChevronLeft className="size-3.5" />
                </Button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => { setCurrentPage(p); loadResults(sessionId, p); }}
                    className={`flex size-7 items-center justify-center rounded-md text-[11px] font-semibold ${p === currentPage ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-100"}`}
                  >
                    {p}
                  </button>
                ))}
                {totalPages > 5 && <span className="px-1 text-[11px] text-slate-400">… {totalPages}</span>}
                <Button type="button" variant="outline" size="icon" className="size-7" disabled={currentPage >= totalPages} onClick={() => { setCurrentPage(currentPage + 1); loadResults(sessionId, currentPage + 1); }}>
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          </Card>

          {/* Live log */}
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#1e293b] shadow-md">
            <div className="flex items-center justify-between border-b border-slate-800 bg-[#0f172a] px-4 py-2.5">
              <div className="flex items-center gap-2.5">
                <div className="flex gap-1.5">
                  <span className="size-2.5 rounded-full bg-rose-500" />
                  <span className="size-2.5 rounded-full bg-amber-500" />
                  <span className="size-2.5 rounded-full bg-emerald-500" />
                </div>
                <span className="font-mono text-xs font-semibold text-slate-300">
                  Live Automation Log Console [Thread-01 - Quét Page]
                </span>
              </div>
              <span
                className={`inline-flex items-center gap-1.5 rounded px-2.5 py-0.5 font-mono text-[10px] font-semibold ${
                  isPaused
                    ? "border border-amber-500/20 bg-amber-500/10 text-amber-400"
                    : isRunning
                      ? "border border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                      : "border border-slate-500/20 bg-slate-500/10 text-slate-400"
                }`}
              >
                <span className={`size-1.5 rounded-full ${isPaused ? "bg-amber-400" : isRunning ? "bg-emerald-400 animate-pulse" : "bg-slate-400"}`} />
                {isPaused ? "PAUSED" : isRunning ? "RUNNING" : "IDLE"}
              </span>
            </div>
            <div className="max-h-56 space-y-1.5 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed">
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
