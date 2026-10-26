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
  ArrowDownWideNarrow,
  Save,
  Plus,
  Users,
  SlidersHorizontal,
  Trash2,
  Lightbulb,
  Phone,
  BarChart3,
  Copy,
  FileText,
  UploadCloud,
} from "lucide-react";

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
  scanPageLinks,
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
  normalizeHashtag,
  newCampaignId,
} from "./campaignUtils";

/* ─── Stepper Input (Figma style: [- | 50 | +]) ─── */
function StepperBox({ value, onChange, min = 1, max = 500, step = 1, disabled, widthClass = "w-12" }) {
  return (
    <div className="inline-flex h-8 items-center overflow-hidden rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]">
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, Number(value || min) - step))}
        className="flex h-full w-7 items-center justify-center text-xs font-bold text-[#64748B] transition hover:bg-[#E2E8F0]/60 hover:text-[#0F172A] disabled:opacity-40"
      >
        −
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
        className={`h-full ${widthClass} border-x border-[#E2E8F0] bg-white text-center text-xs font-bold text-[#0F172A] outline-none disabled:bg-slate-50`}
      />
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, Number(value || min) + step))}
        className="flex h-full w-7 items-center justify-center text-xs font-bold text-[#64748B] transition hover:bg-[#E2E8F0]/60 hover:text-[#0F172A] disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

/* ─── Client-side quick link parser for instant preview ─── */
function buildClientLinkPreview(rawText) {
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  const seen = new Set();
  return lines.map((raw, idx) => {
    const lower = raw.toLowerCase();
    const isBadPath = ["/search", "/reel/", "/stories/", "/events/", "/marketplace/", "/login", "/messages/"].some(
      (b) => lower.includes(b),
    );
    const isFbLink = lower.includes("facebook.com") || lower.includes("fb.com");
    const isUid = /^\d{6,25}$/.test(lower);
    const isSlug = /^[a-z0-9._-]{3,60}$/i.test(raw);

    if (isBadPath || (!isFbLink && !isUid && !isSlug)) {
      return {
        line_no: idx + 1,
        raw_input: raw,
        page_url: raw,
        page_key: "",
        status: "INVALID",
      };
    }

    let normalizedUrl = raw;
    if (isUid) {
      normalizedUrl = `https://www.facebook.com/profile.php?id=${raw}`;
    } else if (!/^https?:\/\//i.test(raw)) {
      if (lower.startsWith("facebook.com") || lower.startsWith("fb.com") || lower.startsWith("m.facebook.com")) {
        normalizedUrl = `https://${raw}`;
      } else {
        normalizedUrl = `https://www.facebook.com/${raw.replace(/^\/+/, "")}`;
      }
    }
    const key = normalizedUrl
      .toLowerCase()
      .replace(/^https?:\/\/(m\.|www\.)?(facebook\.com|fb\.com)\//, "")
      .split(/[?#]/)[0]
      .replace(/\/+$/, "");

    if (!key || seen.has(key)) {
      return {
        line_no: idx + 1,
        raw_input: raw,
        page_url: normalizedUrl,
        page_key: key,
        status: key ? "DUPLICATE" : "INVALID",
      };
    }
    seen.add(key);
    return {
      line_no: idx + 1,
      raw_input: raw,
      page_url: normalizedUrl,
      page_key: key,
      status: "VALID",
    };
  });
}

const SOURCE_MODES = [
  { id: "keyword", label: "Theo từ khóa", Icon: Search },
  { id: "paste", label: "Nhập Link", Icon: Link2 },
  { id: "upload", label: "Tải tệp (.txt / .csv)", Icon: FileUp },
];

const DONE_STATUSES = ["COMPLETED", "PARTIAL", "STOPPED", "FAILED"];
const LIVE_STATUSES = new Set(["LIVE", "live", "Live"]);
const DOT_COLORS = ["bg-[#1877F2]", "bg-[#F59E0B]", "bg-[#10B981]", "bg-[#8B5CF6]", "bg-[#EC4899]"];

function formatFollowers(n) {
  if (n == null || n === "") return "—";
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  return num.toLocaleString("vi-VN");
}

function nowStamp() {
  return new Date().toLocaleTimeString("vi-VN", { hour12: false });
}

/* ════════════════════════════════════════════════════════════
   MAIN — Quét thông tin Page (Module 11 - Chuẩn Figma 100%)
   ════════════════════════════════════════════════════════════ */
export default function PageScannerSearch() {
  /* Accounts — multi-select */
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [selectedUids, setSelectedUids] = useState([]);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [modalUids, setModalUids] = useState([]);
  const [modalSearch, setModalSearch] = useState("");
  const [modalCategory, setModalCategory] = useState("ALL");
  const [modalFarmTime, setModalFarmTime] = useState("ALL");

  /* Source Mode & Keyword State */
  const [sourceMode, setSourceMode] = useState("keyword");
  const [keywords, setKeywords] = useState([
    "Bất động sản Hà Nội",
    "Mua bán nhà đất",
    "Marketing thực chiến",
  ]);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [searchMode] = useState("NGACH");
  const [, setCampaignId] = useState(null);

  /* Paste Link State (Nhập Link) */
  const [pasteContent, setPasteContent] = useState(
    "https://www.facebook.com/innisfreevietnam\nhttps://www.facebook.com/biluxuryvn\nhttps://fb.com/profile.php?id=1098642819",
  );
  const [pasteServerItems, setPasteServerItems] = useState(null);
  const [checkingLinks, setCheckingLinks] = useState(false);

  /* Upload File State (Tải tệp) */
  const [uploadFileMeta, setUploadFileMeta] = useState(null);
  const [uploadContentText, setUploadContentText] = useState("");
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadFilterTab, setUploadFilterTab] = useState("ALL"); // ALL | VALID | DUPLICATE
  const fileInputRef = useRef(null);

  /* Card 2 Config State */
  const [rotateEvery, setRotateEvery] = useState(50);
  const [delayMin, setDelayMin] = useState(5);
  const [delayMax, setDelayMax] = useState(10);
  const [applyAllTarget, setApplyAllTarget] = useState(30);
  const [keywordTargets, setKeywordTargets] = useState({
    "Bất động sản Hà Nội": 30,
    "Mua bán nhà đất": 50,
    "Marketing thực chiến": 20,
  });
  const [linkTargetCount, setLinkTargetCount] = useState(30);
  const [publicOnly, setPublicOnly] = useState(true);
  const [minFollowersEnabled, setMinFollowersEnabled] = useState(true);
  const [minFollowers, setMinFollowers] = useState(1000);
  const [skipSaveBelowThreshold] = useState(false);
  const [minPosts] = useState(2);
  const [maxPostsPerHashtag] = useState(100);

  /* Run state: idle | running | paused | done */
  const [runPhase, setRunPhase] = useState("idle");
  const [sessionId, setSessionId] = useState(null);
  const [sessionIds, setSessionIds] = useState([]);
  const [keywordProgress, setKeywordProgress] = useState([]);
  const [logs, setLogs] = useState([
    {
      id: "init_1",
      timestamp: "09:30:12",
      message: "Khởi tạo cấu hình hoàn tất. Đang chờ lệnh thực thi...",
      type: "info",
    },
  ]);

  /* Results State */
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
  const sessionMetaRef = useRef({});
  const sessionIdsRef = useRef([]);
  const wsRef = useRef(null);
  const lastLoadedRef = useRef(0);

  useEffect(() => {
    sessionIdsRef.current = sessionIds;
  }, [sessionIds]);

  const isRunning = runPhase === "running";
  const isPaused = runPhase === "paused";
  const isBusy = isRunning || isPaused;

  const { keywords: plainKeywords, hashtags: manualHashtags } = useMemo(
    () => splitMixedChips(keywords),
    [keywords],
  );
  const derivedHashtags = useMemo(
    () => collectHashtagsForCampaign(plainKeywords, manualHashtags),
    [plainKeywords, manualHashtags],
  );

  /* Preview items for Nhập Link */
  const pastePreviewItems = useMemo(() => {
    if (pasteServerItems) return pasteServerItems;
    return buildClientLinkPreview(pasteContent);
  }, [pasteContent, pasteServerItems]);

  const validPasteCount = useMemo(
    () => pastePreviewItems.filter((item) => item.status === "VALID").length,
    [pastePreviewItems],
  );

  /* Preview items for Tải tệp */
  const uploadPreviewItems = useMemo(() => {
    if (uploadResult?.line_items?.length) return uploadResult.line_items;
    if (uploadContentText) return buildClientLinkPreview(uploadContentText);
    return [];
  }, [uploadResult, uploadContentText]);

  const filteredUploadItems = useMemo(() => {
    if (uploadFilterTab === "VALID") {
      return uploadPreviewItems.filter((i) => i.status === "VALID");
    }
    if (uploadFilterTab === "DUPLICATE") {
      return uploadPreviewItems.filter((i) => i.status === "DUPLICATE" || i.status === "INVALID");
    }
    return uploadPreviewItems;
  }, [uploadPreviewItems, uploadFilterTab]);

  /* Keyword rows for Card 1 table */
  const keywordTableRows = useMemo(() => {
    if (!keywords.length) return [];
    return keywords.map((kw) => {
      const bodyTag = `#${kw
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/gi, "d")
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "")}`;
      const matchProg = keywordProgress.find(
        (p) =>
          p.keyword === kw ||
          p.rootKeyword === kw ||
          String(p.keyword).toLowerCase() === kw.toLowerCase() ||
          String(p.keyword).toLowerCase() === bodyTag.toLowerCase(),
      );
      return {
        keyword: kw,
        count: matchProg ? matchProg.count : 0,
        status: matchProg ? matchProg.status : "idle",
      };
    });
  }, [keywords, keywordProgress]);

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
        const liveUids = normalized
          .filter((a) => LIVE_STATUSES.has(String(a.status)))
          .slice(0, 2)
          .map((a) => a.uid);
        if (liveUids.length) {
          setSelectedUids(liveUids);
        }
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

  /* Load Results */
  const loadResults = useCallback(
    async (sid, page = 1, idsOverride = null) => {
      const ids = (
        idsOverride ||
        (sessionIdsRef.current.length ? sessionIdsRef.current : sid ? [sid] : [])
      ).filter(Boolean);

      setLoadingResults(true);
      try {
        let merged = [];
        if (ids.length) {
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
          merged = mergePagesByKey(lists, sessionMetaRef.current);
          const terms = [...plainKeywords, ...manualHashtags];
          merged = sortPagesForMode(merged, searchMode, terms);
        } else {
          const data = await getScannedPages({
            page: 1,
            page_size: 200,
            sort_by: "followers",
            sort_dir: sortDir,
          });
          merged = data?.items || [];
        }

        let filtered = minFollowersEnabled
          ? merged.filter((p) => {
              if (p.follower_count == null) return true;
              return Number(p.follower_count) >= minFollowers;
            })
          : merged;

        if (resultSearch.trim()) {
          const q = resultSearch.trim().toLowerCase();
          filtered = filtered.filter((p) =>
            `${p.page_name || ""} ${p.page_url || ""} ${p.phone || ""} ${p.email || ""} ${p.website || ""} ${p.category || ""}`
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

        const total = filtered.length;
        const start = (page - 1) * pageSize;
        const slice = filtered.slice(start, start + pageSize);
        setPages(slice);
        setTotalCount(total);
      } catch (err) {
        toast.error(`Lỗi tải kết quả: ${err.message}`);
      } finally {
        setLoadingResults(false);
      }
    },
    [
      pageSize,
      resultSearch,
      minFollowersEnabled,
      minFollowers,
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
            const ids = sessionIdsRef.current.length ? sessionIdsRef.current : [sid];
            loadResults(sid, 1, ids);
            setRunPhase((prev) => (prev === "running" ? "done" : prev));
          }
        } catch (e) {
          console.error(e);
        }
      }, 1500);
    },
    [loadResults, stopPolling],
  );

  /* Restore active campaign or load initial pages */
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const data = await getActiveCampaign();
        if (ignore) return;
        if (!data?.active || !(data.sessions || []).length) {
          await loadResults(null, 1, []);
          return;
        }
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
            rootKeyword: s.keyword || "—",
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
              type:
                line.level === "success"
                  ? "success"
                  : line.level === "warn"
                    ? "warn"
                    : line.level === "error"
                      ? "error"
                      : "info",
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
        /* ignore */
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

  /* WS logs */
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
          if (
            msg &&
            (String(msg).toLowerCase().includes("page") ||
              data.module === "page_scanner" ||
              data.scope === "page_scanner")
          ) {
            pushLog(msg, data.level === "error" ? "error" : data.level === "warn" ? "warn" : "info");
          }
        } catch {
          /* ignore */
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

  /* Add/remove keyword chip */
  const handleAddKeywordChip = (raw) => {
    const parts = String(raw || "")
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...keywords];
    const nextTargets = { ...keywordTargets };
    for (const p of parts) {
      let value = p;
      if (p.startsWith("#")) {
        const n = normalizeHashtag(p);
        if (!n) continue;
        value = n;
      }
      if (!next.some((c) => c.toLowerCase() === value.toLowerCase())) {
        next.push(value);
        if (nextTargets[value] == null) nextTargets[value] = applyAllTarget;
      }
    }
    setKeywords(next);
    setKeywordTargets(nextTargets);
    setKeywordDraft("");
  };

  const handleRemoveKeywordChip = (chip) => {
    setKeywords((prev) => prev.filter((c) => c !== chip));
  };

  /* Apply all target to every keyword */
  const handleApplyAllTarget = () => {
    const val = Math.max(1, Math.min(500, Number(applyAllTarget) || 30));
    const next = {};
    for (const kw of keywords) {
      next[kw] = val;
    }
    setKeywordTargets(next);
    toast.success(`Đã áp dụng mục tiêu ${val} nhóm/page cho tất cả ${keywords.length} từ khóa.`);
  };

  /* Kiểm tra & Lọc trùng lặp (Nhập Link) */
  const handleCheckAndDeduplicateLinks = async () => {
    if (!pasteContent.trim()) {
      toast.warning("Vui lòng dán ít nhất 1 đường dẫn Fanpage để kiểm tra.");
      return;
    }
    setCheckingLinks(true);
    try {
      const res = await parsePageLinks({
        content: pasteContent.trim(),
        filter_existing: true,
        save_to_db: false,
      });
      if (Array.isArray(res.line_items) && res.line_items.length) {
        setPasteServerItems(res.line_items);
      }
      pushLog(
        `Kiểm tra Link: Tổng ${res.total_lines} dòng · Hợp lệ ${res.valid_count} · Trùng lặp ${res.dedup_count} · Không hợp lệ ${res.invalid_count}`,
        "success",
      );
      toast.success(
        `Đã kiểm tra: ${res.valid_count} hợp lệ, ${res.dedup_count} trùng lặp, ${res.invalid_count} không hợp lệ.`,
      );
    } catch (err) {
      toast.error(`Lỗi kiểm tra link: ${err.message}`);
    } finally {
      setCheckingLinks(false);
    }
  };

  const handleRemovePasteLine = (lineNo) => {
    const nonEmptyLines = pasteContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    const nextLines = nonEmptyLines.filter((_, idx) => idx + 1 !== lineNo);
    setPasteContent(nextLines.join("\n"));
    setPasteServerItems(null);
  };

  const handleRemoveUploadLine = (lineNo) => {
    if (uploadResult?.line_items) {
      const nextItems = uploadResult.line_items
        .filter((item) => item.line_no !== lineNo)
        .map((item, i) => ({ ...item, line_no: i + 1 }));
      const valid = nextItems.filter((i) => i.status === "VALID").length;
      const dedup = nextItems.filter((i) => i.status === "DUPLICATE").length;
      const invalid = nextItems.filter((i) => i.status === "INVALID").length;
      setUploadResult({
        ...uploadResult,
        line_items: nextItems,
        total_lines: nextItems.length,
        valid_count: valid,
        dedup_count: dedup,
        invalid_count: invalid,
      });
    }
  };

  /* Preflight check */
  const handlePreflight = () => {
    const errors = [];
    if (sourceMode === "keyword") {
      if (!keywords.length) errors.push("Vui lòng nhập ít nhất 1 từ khóa mục tiêu.");
      const jobs = buildCampaignJobs({ searchMode, keywords: plainKeywords, manualHashtags });
      if (!jobs.length) errors.push("Không tạo được phiên quét nào từ từ khóa đã nhập.");
      else {
        setKeywordProgress(
          jobs.map((j) => ({
            keyword: j.rootKeyword || j.label,
            rootKeyword: j.rootKeyword || j.label,
            count: 0,
            status: "pending",
            channel: j.channel,
          })),
        );
        pushLog(`Đã kiểm tra ${keywords.length} từ khóa: ${keywords.join(", ")}`, "info");
      }
    } else if (sourceMode === "paste") {
      if (!pasteContent.trim() || validPasteCount === 0) {
        errors.push("Vui lòng dán ít nhất 1 đường dẫn Fanpage Facebook hợp lệ.");
      }
    } else if (sourceMode === "upload") {
      if (!uploadResult && !uploadContentText.trim()) {
        errors.push("Vui lòng tải lên tệp danh sách (.txt / .csv).");
      }
    }

    if (delayMin > delayMax) errors.push("Khoảng cách giữa các lần quét không hợp lệ (tối thiểu > tối đa).");

    if (errors.length) {
      errors.forEach((e) => pushLog(e, "error"));
      toast.error(errors[0]);
      return false;
    }
    toast.success("Kiểm tra hợp lệ — sẵn sàng thực thi phiên quét.");
    return true;
  };

  /* Run Keyword Campaign */
  const runMixedCampaign = async () => {
    const jobs = buildCampaignJobs({ searchMode, keywords: plainKeywords, manualHashtags });
    const campId = newCampaignId();
    setCampaignId(campId);
    campaignRef.current = { paused: false, abort: false, queue: jobs, accIndex: 0 };
    sessionMetaRef.current = {};
    setSessionIds([]);
    setKeywordProgress(
      jobs.map((j) => ({
        keyword: j.rootKeyword || j.label,
        rootKeyword: j.rootKeyword || j.label,
        count: 0,
        status: "pending",
        channel: j.channel,
      })),
    );
    setRunPhase("running");

    const campaignSettings = {
      search_mode: "NGACH",
      keywords: plainKeywords,
      hashtags: manualHashtags,
      rotate_every: rotateEvery,
      delay_min_seconds: delayMin,
      delay_max_seconds: delayMax,
      min_followers: minFollowersEnabled ? minFollowers : null,
      skip_save_below_threshold: skipSaveBelowThreshold,
    };
    pushLog(
      `Khởi chạy chiến dịch ${campId} · ${jobs.length} từ khóa: ${keywords.join(", ")}`,
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
      const keepBrowser = i < jobs.length - 1 && !campaignRef.current.abort;
      const targetForJob =
        keywordTargets[job.rootKeyword] ?? keywordTargets[job.label] ?? applyAllTarget;

      setKeywordProgress((prev) =>
        prev.map((row) =>
          row.rootKeyword === job.rootKeyword || row.keyword === job.label
            ? { ...row, status: "scanning" }
            : row,
        ),
      );
      pushLog(
        `Đang quét từ khóa "${job.rootKeyword || job.label}" (mục tiêu ${targetForJob} page) · Tài khoản: ${uid || "Tự động"}`,
        "info",
      );

      try {
        let sid;
        if (job.kind === "keyword") {
          const res = await searchPages({
            keyword: job.query,
            account_uid: uid,
            max_results: targetForJob,
            include_sponsored: false,
            headless: false,
            allow_direct_fallback: true,
            campaign_id: campId,
            settings: campaignSettings,
            keep_browser: keepBrowser,
          });
          sid = res.session_id;
        } else {
          const res = await searchPagesByHashtag({
            hashtags: [job.query],
            context_keywords: plainKeywords,
            min_posts: minPosts,
            max_posts_per_hashtag: maxPostsPerHashtag,
            min_followers: minFollowersEnabled ? minFollowers : 0,
            target_pages: targetForJob,
            account_uid: uid,
            headless: false,
            allow_direct_fallback: true,
            campaign_id: campId,
            keep_browser: keepBrowser,
          });
          sid = res.session_id;
        }

        sessionMetaRef.current[sid] = {
          channel: job.channel,
          label: job.rootKeyword || job.label,
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
            row.rootKeyword === job.rootKeyword || row.keyword === job.label
              ? { ...row, count, status: "done" }
              : row,
          ),
        );
        pushLog(
          `Hoàn thành "${job.rootKeyword || job.label}": thu thập ${count} page (${session.stop_reason || session.status})`,
          session.status === "FAILED" ? "error" : "success",
        );

        const nextAcc = advanceAccountAfterJob(accState, count, rotateEvery);
        if (nextAcc.rotated) {
          pushLog(
            `Đã đạt ngưỡng ${rotateEvery} page/tài khoản → chuyển sang tài khoản ${selectedUids[nextAcc.cursor] || "tiếp theo"}`,
            "warn",
          );
        }
        accState = { cursor: nextAcc.cursor, pagesOnAcc: nextAcc.pagesOnAcc };
        campaignRef.current.accIndex = accState.cursor;

        await loadResults(sid, 1, [...collectedIds]);
      } catch (err) {
        setKeywordProgress((prev) =>
          prev.map((row) =>
            row.rootKeyword === job.rootKeyword || row.keyword === job.label
              ? { ...row, status: "error" }
              : row,
          ),
        );
        pushLog(`Lỗi quét "${job.rootKeyword || job.label}": ${err.message}`, "error");
        toast.error(err.message);
      }
    }

    stopPolling();
    setRunPhase("done");
    if (campaignRef.current.abort) {
      pushLog("Đã dừng khẩn cấp toàn bộ phiên quét.", "error");
    } else {
      pushLog("Chiến dịch quét thông tin Page theo từ khóa đã hoàn tất.", "success");
      toast.success("Hoàn thành phiên quét thông tin Page!");
      if (collectedIds.length) {
        await loadResults(collectedIds[collectedIds.length - 1], 1, collectedIds);
      }
    }
  };

  /* Start Execution (Keyword / Nhập Link / Tải tệp) */
  const handleStart = async () => {
    if (!handlePreflight()) return;
    setLogs([]);
    setPages([]);
    setSelectedPageKeys([]);
    setCurrentPage(1);
    setTotalCount(0);
    lastLoadedRef.current = 0;
    sessionMetaRef.current = {};

    if (sourceMode === "keyword") {
      await runMixedCampaign();
      return;
    }

    /* Nhập Link hoặc Tải tệp -> gọi scanPageLinks background worker */
    const rawLinksText =
      sourceMode === "paste"
        ? pasteContent.trim()
        : (uploadResult?.line_items || uploadPreviewItems)
            .filter((i) => i.status === "VALID")
            .map((i) => i.page_url)
            .join("\n") || uploadContentText.trim();

    if (!rawLinksText) {
      toast.error("Không có đường dẫn Fanpage hợp lệ để thực thi quét.");
      return;
    }

    const campId = newCampaignId();
    setCampaignId(campId);
    campaignRef.current = { paused: false, abort: false, queue: [], accIndex: 0 };
    setRunPhase("running");
    const labelName = sourceMode === "upload" ? "Tải tệp danh sách" : "Nhập Link trực tiếp";
    pushLog(
      `Khởi động phiên quét thông tin Page (${labelName}) · Mục tiêu tối đa: ${linkTargetCount} Page`,
      "info",
    );

    try {
      const res = await scanPageLinks({
        content: rawLinksText,
        account_uid: selectedUids[0] || null,
        account_uids: selectedUids.length ? selectedUids : null,
        max_results: linkTargetCount,
        min_followers: minFollowersEnabled ? minFollowers : 0,
        switch_account_every: rotateEvery,
        delay_min: delayMin,
        delay_max: delayMax,
        source_type: sourceMode === "upload" ? "UPLOAD" : "PARSE",
        headless: false,
        allow_direct_fallback: true,
        campaign_id: campId,
      });

      const sid = res.session_id;
      if (res.parsed?.line_items && sourceMode === "paste") {
        setPasteServerItems(res.parsed.line_items);
      }
      sessionMetaRef.current[sid] = {
        channel: sourceMode === "upload" ? "UPLOAD" : "PARSE",
        label: labelName,
        kind: "link",
      };
      setSessionId(sid);
      setSessionIds([sid]);
      setKeywordProgress([
        {
          keyword: labelName,
          rootKeyword: labelName,
          count: 0,
          status: "scanning",
          channel: sourceMode === "upload" ? "UPLOAD" : "PARSE",
        },
      ]);
      startPoll(sid);
      const session = await waitForSession(sid);
      stopPolling();
      const finalCount = session.pages_count || session.total_unique || 0;
      setKeywordProgress([
        {
          keyword: labelName,
          rootKeyword: labelName,
          count: finalCount,
          status: "done",
          channel: sourceMode === "upload" ? "UPLOAD" : "PARSE",
        },
      ]);
      await loadResults(sid, 1, [sid]);
      setRunPhase("done");
      pushLog(
        `Hoàn tất quét theo link: đã thu thập ${finalCount} Fanpage (${session.stop_reason || session.status}).`,
        "success",
      );
      toast.success(`Đã quét xong ${finalCount} Fanpage từ danh sách link!`);
    } catch (err) {
      stopPolling();
      setRunPhase("done");
      pushLog(`Lỗi quét theo link: ${err.message}`, "error");
      toast.error(err.message);
    }
  };

  /* TẠM DỪNG / TIẾP TỤC */
  const handlePauseResume = async () => {
    if (!isBusy) return;
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
      pushLog("Đã tiếp tục thực thi phiên quét.", "success");
      toast.info("Đã tiếp tục phiên quét.");
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
    pushLog("Đã tạm dừng phiên quét tại điểm an toàn.", "warn");
    toast.info("Đã tạm dừng phiên quét.");
  };

  /* DỪNG KHẨN CẤP */
  const handleEmergencyStop = async () => {
    if (!isBusy) return;
    campaignRef.current.abort = true;
    campaignRef.current.paused = false;
    stopPolling();
    if (sessionId) {
      try {
        await stopScanSession(sessionId);
        pushLog(`Đã gửi lệnh dừng khẩn cấp cho phiên #${sessionId}.`, "error");
      } catch (err) {
        pushLog(`Lỗi dừng khẩn cấp: ${err.message}`, "error");
      }
    }
    setRunPhase("done");
    toast.warning("Đã dừng khẩn cấp phiên quét.");
  };

  /* Upload File (.txt / .csv) */
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadFileMeta({
      name: file.name,
      sizeKB: Math.max(1, Math.round(file.size / 1024)),
    });
    try {
      const text = await file.text();
      setUploadContentText(text);
    } catch {
      /* ignore */
    }
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await uploadPageFile(formData, { save_to_db: false, filter_existing: true });
      setUploadResult(res);
      pushLog(
        `Đã tải tệp "${file.name}": nhận diện ${res.total_lines} dòng (${res.valid_count} hợp lệ, ${res.dedup_count} trùng lặp)`,
        "success",
      );
      toast.success(`Đã nhận diện ${res.valid_count} đường dẫn hợp lệ từ "${file.name}"`);
    } catch (err) {
      toast.error(`Lỗi đọc tệp: ${err.message}`);
    }
    e.target.value = "";
  };

  /* Export CSV */
  const handleExportCSV = () => {
    if (!pages.length) {
      toast.warning("Chưa có dữ liệu kết quả để xuất file.");
      return;
    }
    const headers = ["STT", "Từ khóa", "Tên Page", "Link Page", "Số điện thoại", "Email", "Website", "Followers", "Tích xanh"];
    const rows = pages.map((p, i) => [
      (currentPage - 1) * pageSize + i + 1,
      p.source_keyword || (filterKeyword !== "ALL" ? filterKeyword : "Chung"),
      p.page_name || "",
      p.page_url || "",
      p.phone || "",
      p.email || "",
      p.website || "",
      p.follower_count ?? "",
      p.is_verified === true ? "Có" : "",
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ket_qua_quet_page_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Đã xuất toàn bộ file CSV thành công.");
  };

  /* Save Page List */
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
          /* fallback */
        }
      }
    }
    if (!toSave.length) {
      toast.warning("Chưa có dữ liệu Page để lưu danh sách.");
      return;
    }
    const entry = savePageList({ pages: toSave });
    toast.success(`Đã lưu ${entry.count} Page vào danh sách "${entry.name}".`);
    pushLog(`Đã lưu danh sách: ${entry.count} Page.`, "success");
  };

  /* Reload table on filter/search change */
  useEffect(() => {
    const t = setTimeout(() => {
      setCurrentPage(1);
      loadResults(sessionId, 1);
    }, 300);
    return () => clearTimeout(t);
  }, [resultSearch, filterKeyword, minFollowersEnabled, minFollowers, sortDir, sessionId, loadResults]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const keywordOptions = useMemo(() => [...plainKeywords, ...manualHashtags], [plainKeywords, manualHashtags]);
  const selCount = selectedUids.length;

  /* Account modal filtered list */
  const accountCategories = useMemo(() => {
    const set = new Set();
    accounts.forEach((a) => {
      if (a.category || a.folder) set.add(a.category || a.folder);
    });
    return [...set];
  }, [accounts]);

  const filteredModalAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      if (modalCategory !== "ALL" && (acc.category || acc.folder || "Mặc định") !== modalCategory) {
        return false;
      }
      if (modalSearch.trim()) {
        const q = modalSearch.trim().toLowerCase();
        const hay = `${acc.name || ""} ${acc.uid || ""} ${acc.proxy || ""} ${acc.category || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [accounts, modalCategory, modalSearch]);

  return (
    <div className="space-y-5 pb-10">
      {/* ═══ TOP 2-COLUMN CARDS (Chuẩn Figma) ═══ */}
      <div className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-2">
        {/* ─── CARD 1: Chọn tài khoản & Thiết lập phiên quét ─── */}
        <div className="flex flex-col rounded-2xl border border-[#E2E8F0] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          {/* Card 1 Header */}
          <div className="flex items-center gap-3.5 border-b border-[#F1F5F9] px-6 py-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#EFF6FF] text-[#1877F2]">
              <Users className="size-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-bold text-[#0F172A]">
                Chọn tài khoản & Thiết lập phiên quét
              </h3>
              <p className="text-xs text-[#64748B]">
                Cấu hình tài khoản sử dụng và nguồn dữ liệu đầu vào
              </p>
            </div>
          </div>

          {/* Card 1 Body */}
          <div className="flex flex-1 flex-col space-y-4 px-6 py-5">
            {/* Row 1: + Chọn tài khoản + ● Đã chọn: X tài khoản (cùng hàng theo Figma) */}
            <div className="flex flex-wrap items-center gap-3">
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

            {/* Row 2: PHƯƠNG THỨC QUÉT (Segmented Tabs) */}
            <div>
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
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs transition ${
                        active
                          ? "bg-[#1877F2] font-bold text-white shadow-sm"
                          : "font-medium text-[#475569] hover:text-[#0F172A]"
                      } disabled:opacity-60`}
                    >
                      <Icon className="size-3.5" />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── TAB 1: Theo từ khóa (quét ttin page.png) ── */}
            {sourceMode === "keyword" && (
              <div className="flex flex-1 flex-col space-y-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#334155]">Từ khóa mục tiêu:</span>
                  <span className="text-xs text-[#64748B]">
                    Đã chọn:{" "}
                    <strong className="font-bold text-[#1877F2]">{keywords.length} từ khóa</strong>
                  </span>
                </div>

                {/* Chip Container + Tall Kiểm tra Button */}
                <div className="flex items-stretch gap-2.5">
                  <div
                    className={`flex min-h-[78px] flex-1 flex-wrap content-start items-start gap-1.5 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 transition focus-within:border-[#1877F2] focus-within:bg-white ${
                      isBusy ? "opacity-60" : ""
                    }`}
                  >
                    {keywords.map((chip) => {
                      const isTag = isHashtagChip(chip);
                      return (
                        <span
                          key={chip}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${
                            isTag
                              ? "border border-[#DDD6FE] bg-[#EDE9FE] text-[#6D28D9]"
                              : "bg-[#DBEAFE] text-[#1D4ED8]"
                          }`}
                        >
                          {isTag && <Hash className="size-3 shrink-0" />}
                          {chip}
                          {!isBusy && (
                            <button
                              type="button"
                              onClick={() => handleRemoveKeywordChip(chip)}
                              className="rounded-full p-0.5 text-[#1D4ED8]/70 hover:bg-[#BFDBFE]/60 hover:text-[#1E3A8A]"
                            >
                              <X className="size-3" />
                            </button>
                          )}
                        </span>
                      );
                    })}
                    <input
                      value={keywordDraft}
                      disabled={isBusy}
                      placeholder="Nhập thêm từ khóa..."
                      onChange={(e) => setKeywordDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === ",") {
                          e.preventDefault();
                          if (keywordDraft.trim()) handleAddKeywordChip(keywordDraft);
                        } else if (e.key === "Backspace" && !keywordDraft && keywords.length) {
                          handleRemoveKeywordChip(keywords[keywords.length - 1]);
                        }
                      }}
                      onBlur={() => keywordDraft.trim() && handleAddKeywordChip(keywordDraft)}
                      className="min-w-[130px] flex-1 bg-transparent py-1 text-xs text-[#0F172A] outline-none placeholder:text-[#94A3B8]"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={handlePreflight}
                    className="flex shrink-0 items-center justify-center rounded-xl bg-[#1877F2] px-5 text-xs font-bold text-white shadow-sm transition hover:bg-[#166FE5] disabled:opacity-60"
                  >
                    Kiểm tra
                  </button>
                </div>

                {/* Bảng SỐ LƯỢNG PAGE QUÉT ĐƯỢC THEO TỪ KHÓA */}
                <div className="flex-1 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC]/70 p-3.5">
                  <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#334155]">
                    <BarChart3 className="size-3.5 text-[#1877F2]" />
                    SỐ LƯỢNG PAGE QUÉT ĐƯỢC THEO TỪ KHÓA
                  </div>

                  <div className="overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[#E2E8F0] text-[11px] font-semibold text-[#64748B]">
                          <th className="pb-2 text-left">Từ khóa</th>
                          <th className="pb-2 text-center">Số page quét được</th>
                          <th className="pb-2 text-right">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F1F5F9]">
                        {keywordTableRows.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="py-4 text-center text-xs text-[#94A3B8]">
                              Chưa có từ khóa nào được chọn
                            </td>
                          </tr>
                        ) : (
                          keywordTableRows.map((row, idx) => {
                            const isScan = row.status === "scanning";
                            const isDone = row.status === "done";
                            const isErr = row.status === "error";
                            const dotColor = isScan
                              ? "bg-[#F59E0B]"
                              : DOT_COLORS[idx % DOT_COLORS.length];
                            return (
                              <tr key={row.keyword}>
                                <td className="py-2.5 pr-2 font-medium text-[#1E293B]">
                                  <div className="flex items-center gap-2">
                                    <span className={`size-2 shrink-0 rounded-full ${dotColor}`} />
                                    <span className="truncate">{row.keyword}</span>
                                  </div>
                                </td>
                                <td className="py-2.5 text-center font-bold text-[#0F172A]">
                                  {row.count > 0
                                    ? `${row.count.toLocaleString("vi-VN")} page`
                                    : `${(keywordTargets[row.keyword] ?? applyAllTarget).toLocaleString("vi-VN")} page`}
                                </td>
                                <td className="py-2.5 text-right">
                                  {isScan ? (
                                    <span className="inline-flex items-center rounded-md border border-[#FDE68A] bg-[#FEF3C7] px-2.5 py-0.5 text-[11px] font-bold text-[#B45309]">
                                      Đang quét
                                    </span>
                                  ) : isErr ? (
                                    <span className="inline-flex items-center rounded-md border border-[#FECACA] bg-[#FEF2F2] px-2.5 py-0.5 text-[11px] font-bold text-[#DC2626]">
                                      Lỗi
                                    </span>
                                  ) : isDone ? (
                                    <span className="inline-flex items-center rounded-md border border-[#86EFAC] bg-[#DCFCE7] px-2.5 py-0.5 text-[11px] font-bold text-[#15803D]">
                                      Hoàn thành
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center rounded-md border border-[#86EFAC] bg-[#DCFCE7] px-2.5 py-0.5 text-[11px] font-bold text-[#15803D]">
                                      Hoàn thành
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ── TAB 2: Nhập Link (quét ttin page (nhập link).png) ── */}
            {sourceMode === "paste" && (
              <div className="flex flex-1 flex-col space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#1E293B]">
                    Dán danh sách liên kết Fanpage Facebook
                  </span>
                  <span className="inline-flex items-center rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-2.5 py-0.5 text-[11px] font-bold text-[#1877F2]">
                    Đã nhận diện: {pastePreviewItems.length} link
                  </span>
                </div>

                <textarea
                  value={pasteContent}
                  onChange={(e) => {
                    setPasteContent(e.target.value);
                    setPasteServerItems(null);
                  }}
                  disabled={isBusy}
                  rows={5}
                  placeholder={
                    "https://www.facebook.com/innisfreevietnam\nhttps://www.facebook.com/biluxuryvn\nhttps://fb.com/profile.php?id=1098642819"
                  }
                  className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 font-mono text-xs leading-relaxed text-[#0F172A] outline-none transition focus:border-[#1877F2] focus:bg-white"
                />

                {/* Action row: Xóa tất cả + Kiểm tra & Lọc trùng lặp */}
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    disabled={isBusy || !pasteContent.trim()}
                    onClick={() => {
                      setPasteContent("");
                      setPasteServerItems(null);
                    }}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#EF4444] transition hover:text-[#DC2626] disabled:opacity-40"
                  >
                    <Trash2 className="size-3.5" />
                    Xóa tất cả
                  </button>

                  <button
                    type="button"
                    disabled={isBusy || checkingLinks}
                    onClick={handleCheckAndDeduplicateLinks}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#1877F2] px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-[#166FE5] disabled:opacity-60"
                  >
                    {checkingLinks && <Loader2 className="size-3.5 animate-spin" />}
                    Kiểm tra & Lọc trùng lặp
                  </button>
                </div>

                {/* Bảng XEM TRƯỚC DANH SÁCH LINK ĐÃ NHẬP */}
                <div className="pt-1">
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                    XEM TRƯỚC DANH SÁCH LINK ĐÃ NHẬP ({pastePreviewItems.length} LINK)
                  </p>
                  <div className="max-h-[190px] overflow-y-auto rounded-xl border border-[#E2E8F0] bg-white">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-[#F8FAFC] text-[11px] font-semibold text-[#64748B]">
                        <tr className="border-b border-[#E2E8F0]">
                          <th className="w-12 px-3 py-2 text-left">STT</th>
                          <th className="px-3 py-2 text-left">Đường dẫn Fanpage Facebook</th>
                          <th className="w-28 px-3 py-2 text-center">Trạng thái</th>
                          <th className="w-8 px-2 py-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F1F5F9]">
                        {pastePreviewItems.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-6 text-center text-xs text-[#94A3B8]">
                              Chưa có đường dẫn Fanpage nào được nhập
                            </td>
                          </tr>
                        ) : (
                          pastePreviewItems.map((item) => (
                            <tr key={`${item.line_no}_${item.raw_input}`} className="hover:bg-[#F8FAFC]">
                              <td className="px-3 py-2 font-mono text-[#64748B]">{item.line_no}</td>
                              <td className="max-w-[240px] truncate px-3 py-2 font-mono text-[#1E293B]">
                                {item.page_url || item.raw_input}
                              </td>
                              <td className="px-3 py-2 text-center">
                                {item.status === "VALID" ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-2.5 py-0.5 text-[10px] font-bold text-[#059669]">
                                    <span className="size-1.5 rounded-full bg-[#10B981]" />
                                    Hợp lệ
                                  </span>
                                ) : item.status === "DUPLICATE" ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-[#FDE68A] bg-[#FFFBEB] px-2.5 py-0.5 text-[10px] font-bold text-[#D97706]">
                                    <span className="size-1.5 rounded-full bg-[#F59E0B]" />
                                    Trùng lặp
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-[#FECACA] bg-[#FEF2F2] px-2.5 py-0.5 text-[10px] font-bold text-[#DC2626]">
                                    <span className="size-1.5 rounded-full bg-[#EF4444]" />
                                    Không hợp lệ
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-2 text-right">
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleRemovePasteLine(item.line_no)}
                                  className="rounded p-1 text-[#94A3B8] hover:bg-[#FEE2E2] hover:text-[#EF4444]"
                                >
                                  <X className="size-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ── TAB 3: Tải tệp .txt / .csv (quét ttin page (nhập link)-1.png) ── */}
            {sourceMode === "upload" && (
              <div className="flex flex-1 flex-col space-y-3">
                <div
                  onClick={() => !isBusy && fileInputRef.current?.click()}
                  className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#93C5FD] bg-[#F8FAFC] px-4 py-5 text-center transition hover:bg-[#EFF6FF]/50"
                >
                  <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-[#DBEAFE] text-[#1877F2]">
                    <UploadCloud className="size-5" />
                  </div>
                  <p className="text-xs font-bold text-[#1E293B]">
                    Nhấn để chọn tệp hoặc kéo thả vào đây
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#64748B]">
                    Hỗ trợ định dạng .txt, .csv, .excel (Tối đa 10MB)
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.csv"
                    hidden
                    onChange={handleFileUpload}
                  />
                </div>

                {uploadFileMeta && (
                  <div className="flex items-center justify-between rounded-xl border border-[#BFDBFE] bg-[#EFF6FF]/60 px-3.5 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-[#1877F2] text-white">
                        <FileText className="size-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-[#0F172A]">
                          {uploadFileMeta.name}{" "}
                          <span className="font-normal text-[#64748B]">({uploadFileMeta.sizeKB} KB)</span>
                        </p>
                        <p className="text-[11px] font-semibold text-[#059669]">
                          ✓ Đã nhận diện: {uploadPreviewItems.length.toLocaleString("vi-VN")} dòng dữ liệu
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs font-bold text-[#EF4444] hover:underline"
                    >
                      Thay đổi tệp
                    </button>
                  </div>
                )}

                {/* Preview Table for Upload */}
                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                      XEM TRƯỚC DANH SÁCH TẢI LÊN
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setUploadFilterTab("ALL")}
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                          uploadFilterTab === "ALL"
                            ? "bg-[#EFF6FF] text-[#1877F2]"
                            : "text-[#64748B] hover:bg-slate-100"
                        }`}
                      >
                        Tất cả ({uploadPreviewItems.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setUploadFilterTab("VALID")}
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                          uploadFilterTab === "VALID"
                            ? "bg-[#ECFDF5] text-[#059669]"
                            : "text-[#64748B] hover:bg-slate-100"
                        }`}
                      >
                        Hợp lệ ({uploadPreviewItems.filter((i) => i.status === "VALID").length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setUploadFilterTab("DUPLICATE")}
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                          uploadFilterTab === "DUPLICATE"
                            ? "bg-[#FFFBEB] text-[#D97706]"
                            : "text-[#64748B] hover:bg-slate-100"
                        }`}
                      >
                        Trùng lặp ({uploadPreviewItems.filter((i) => i.status !== "VALID").length})
                      </button>
                    </div>
                  </div>

                  <div className="max-h-[165px] overflow-y-auto rounded-xl border border-[#E2E8F0] bg-white">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-[#F8FAFC] text-[11px] font-semibold text-[#64748B]">
                        <tr className="border-b border-[#E2E8F0]">
                          <th className="w-12 px-3 py-2 text-left">STT</th>
                          <th className="px-3 py-2 text-left">Đường dẫn / UID Fanpage</th>
                          <th className="w-28 px-3 py-2 text-center">Trạng thái</th>
                          <th className="w-8 px-2 py-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F1F5F9]">
                        {filteredUploadItems.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-5 text-center text-xs text-[#94A3B8]">
                              Chưa có dữ liệu tệp tải lên
                            </td>
                          </tr>
                        ) : (
                          filteredUploadItems.map((item) => (
                            <tr key={`${item.line_no}_${item.raw_input}`} className="hover:bg-[#F8FAFC]">
                              <td className="px-3 py-2 font-mono text-[#64748B]">{item.line_no}</td>
                              <td className="max-w-[230px] truncate px-3 py-2 font-mono text-[#1E293B]">
                                {item.page_url || item.raw_input}
                              </td>
                              <td className="px-3 py-2 text-center">
                                {item.status === "VALID" ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-2.5 py-0.5 text-[10px] font-bold text-[#059669]">
                                    <span className="size-1.5 rounded-full bg-[#10B981]" />
                                    Hợp lệ
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-[#FDE68A] bg-[#FFFBEB] px-2.5 py-0.5 text-[10px] font-bold text-[#D97706]">
                                    <span className="size-1.5 rounded-full bg-[#F59E0B]" />
                                    Trùng lặp
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-2 text-right">
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleRemoveUploadLine(item.line_no)}
                                  className="rounded p-1 text-[#94A3B8] hover:bg-[#FEE2E2] hover:text-[#EF4444]"
                                >
                                  <X className="size-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <button
                    type="button"
                    onClick={downloadPageTemplate}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#1877F2] hover:underline"
                  >
                    <Download className="size-3.5" />
                    Tải tệp mẫu (.txt)
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── CARD 2: Thiết lập cấu hình quét mục tiêu ─── */}
        <div className="flex flex-col rounded-2xl border border-[#E2E8F0] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          {/* Card 2 Header */}
          <div className="flex items-center gap-3.5 border-b border-[#F1F5F9] px-6 py-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#EFF6FF] text-[#1877F2]">
              <SlidersHorizontal className="size-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-bold text-[#0F172A]">
                Thiết lập cấu hình quét mục tiêu
              </h3>
              <p className="text-xs text-[#64748B]">
                Giới hạn số lượng và bộ lọc chất lượng Page
              </p>
            </div>
          </div>

          {/* Card 2 Body */}
          <div className="flex flex-1 flex-col space-y-4 px-6 py-5">
            {/* Row 1: Đổi tài khoản mới khi quét được */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-semibold text-[#1E293B]">
                Đổi tài khoản mới khi quét được
              </span>
              <div className="flex items-center gap-2">
                <StepperBox
                  value={rotateEvery}
                  onChange={setRotateEvery}
                  min={1}
                  max={500}
                  step={10}
                  disabled={isBusy}
                />
                <span className="w-28 text-xs text-[#64748B]">nhóm / tài khoản</span>
              </div>
            </div>

            {/* Row 2: Khoảng cách giữa các lần quét */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-semibold text-[#1E293B]">
                Khoảng cách giữa các lần quét
              </span>
              <div className="flex items-center gap-2">
                <StepperBox
                  value={delayMin}
                  onChange={setDelayMin}
                  min={1}
                  max={120}
                  step={1}
                  disabled={isBusy}
                  widthClass="w-10"
                />
                <span className="text-xs text-[#64748B]">đến</span>
                <StepperBox
                  value={delayMax}
                  onChange={(v) => setDelayMax(Math.max(delayMin, v))}
                  min={1}
                  max={180}
                  step={1}
                  disabled={isBusy}
                  widthClass="w-10"
                />
                <span className="text-xs text-[#64748B]">giây</span>
              </div>
            </div>

            <div className="border-t border-[#F1F5F9]" />

            {/* ── MIDDLE SECTION: Keyword Mode (quét ttin page.png) ── */}
            {sourceMode === "keyword" ? (
              <div className="flex flex-1 flex-col space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[#1E293B]">
                    Cấu hình số nhóm mục tiêu theo từng từ khóa
                  </span>
                  <div className="inline-flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-1.5">
                    <span className="text-[11px] font-medium text-[#64748B]">Áp dụng tất cả:</span>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      disabled={isBusy}
                      value={applyAllTarget}
                      onChange={(e) =>
                        setApplyAllTarget(Math.max(1, Math.min(500, Number(e.target.value) || 1)))
                      }
                      className="h-7 w-12 rounded-lg border border-[#CBD5E1] bg-white text-center text-xs font-bold text-[#0F172A] outline-none focus:border-[#1877F2]"
                    />
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={handleApplyAllTarget}
                      className="rounded-lg bg-[#1877F2] px-2.5 py-1 text-[11px] font-bold text-white transition hover:bg-[#166FE5] disabled:opacity-50"
                    >
                      Áp dụng
                    </button>
                  </div>
                </div>

                {/* Per-keyword target list */}
                <div className="max-h-[165px] divide-y divide-[#F1F5F9] overflow-y-auto rounded-xl border border-[#E2E8F0] bg-white">
                  {keywords.length === 0 ? (
                    <div className="py-5 text-center text-xs text-[#94A3B8]">
                      Nhập từ khóa ở cột bên trái để thiết lập số lượng mục tiêu
                    </div>
                  ) : (
                    keywords.map((kw, idx) => {
                      const dotColor = DOT_COLORS[idx % DOT_COLORS.length];
                      const val = keywordTargets[kw] ?? applyAllTarget;
                      return (
                        <div
                          key={kw}
                          className="flex items-center justify-between px-4 py-2.5 hover:bg-[#F8FAFC]"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className={`size-2 shrink-0 rounded-full ${dotColor}`} />
                            <span className="truncate text-xs font-semibold text-[#1E293B]">
                              {kw}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <StepperBox
                              value={val}
                              onChange={(nextVal) =>
                                setKeywordTargets((prev) => ({ ...prev, [kw]: nextVal }))
                              }
                              min={1}
                              max={500}
                              step={5}
                              disabled={isBusy}
                            />
                            <span className="text-xs text-[#64748B]">nhóm</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Yellow Note Callout (Chuẩn Figma) */}
                <div className="flex items-start gap-2.5 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3.5">
                  <Lightbulb className="mt-0.5 size-4 shrink-0 text-[#D97706]" />
                  <p className="text-xs leading-relaxed text-[#92400E]">
                    <strong className="font-bold">Lưu ý:</strong> Các nhóm hiển thị ở vị trí đầu
                    tiên của mỗi từ khóa thường có tương tác cao và chất lượng tốt nhất. Bạn nên
                    tối ưu số lượng mục tiêu vừa đủ để quét được tệp nhóm tiềm năng nhất.
                  </p>
                </div>

                {/* Bottom filter checkbox */}
                <div className="pt-1">
                  <label className="flex cursor-pointer items-center gap-2.5">
                    <Checkbox
                      checked={minFollowersEnabled}
                      disabled={isBusy}
                      onCheckedChange={(c) => setMinFollowersEnabled(!!c)}
                    />
                    <span className="text-xs font-medium text-[#1E293B]">
                      Chỉ quét page có số lượng followers lớn hơn
                    </span>
                    <input
                      type="text"
                      disabled={isBusy || !minFollowersEnabled}
                      value={minFollowers.toLocaleString("vi-VN")}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/\D/g, "");
                        setMinFollowers(raw ? Number(raw) : 0);
                      }}
                      className="h-8 w-20 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-center text-xs font-bold text-[#0F172A] outline-none focus:border-[#1877F2] focus:bg-white"
                    />
                    <span className="text-xs text-[#64748B]">Followers</span>
                  </label>
                </div>
              </div>
            ) : (
              /* ── MIDDLE SECTION: Nhập Link / Tải tệp Mode (quét ttin page (nhập link).png) ── */
              <div className="flex flex-1 flex-col space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-[#1E293B]">
                    Số nhóm mục tiêu bạn muốn quét
                  </span>
                  <div className="flex items-center gap-2">
                    <StepperBox
                      value={linkTargetCount}
                      onChange={setLinkTargetCount}
                      min={1}
                      max={500}
                      step={5}
                      disabled={isBusy}
                    />
                    <span className="w-28 text-xs text-[#64748B]">Page</span>
                  </div>
                </div>

                <div className="border-t border-[#F1F5F9] pt-3 space-y-3">
                  <label className="flex cursor-pointer items-center gap-2.5">
                    <Checkbox
                      checked={publicOnly}
                      disabled={isBusy}
                      onCheckedChange={(c) => setPublicOnly(!!c)}
                    />
                    <span className="text-xs font-medium text-[#1E293B]">
                      Chỉ quét nhóm đang ở chế độ công khai
                    </span>
                  </label>

                  <label className="flex cursor-pointer items-center gap-2.5">
                    <Checkbox
                      checked={minFollowersEnabled}
                      disabled={isBusy}
                      onCheckedChange={(c) => setMinFollowersEnabled(!!c)}
                    />
                    <span className="text-xs font-medium text-[#1E293B]">
                      Chỉ quét nhóm có số lượng theo dõi lớn hơn
                    </span>
                    <input
                      type="text"
                      disabled={isBusy || !minFollowersEnabled}
                      value={minFollowers.toLocaleString("vi-VN")}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/\D/g, "");
                        setMinFollowers(raw ? Number(raw) : 0);
                      }}
                      className="h-8 w-20 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-center text-xs font-bold text-[#0F172A] outline-none focus:border-[#1877F2] focus:bg-white"
                    />
                    <span className="text-xs text-[#64748B]">Followers</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ EXECUTION BUTTONS (Chuẩn Figma: BẮT ĐẦU THỰC THI + TẠM DỪNG & DỪNG KHẨN CẤP) ═══ */}
      <div className="space-y-2.5">
        <button
          type="button"
          disabled={isBusy}
          onClick={handleStart}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1877F2] text-sm font-bold tracking-wide text-white shadow-sm transition hover:bg-[#166FE5] disabled:opacity-60"
        >
          {isBusy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              ĐANG THỰC THI PHIÊN QUÉT...
            </>
          ) : (
            <>
              <Play className="size-4 fill-current" />
              BẮT ĐẦU THỰC THI
            </>
          )}
        </button>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!isBusy}
            onClick={handlePauseResume}
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-[#FCA5A5] bg-white text-xs font-bold text-[#DC2626] transition hover:bg-[#FEF2F2] disabled:opacity-50"
          >
            {isPaused ? (
              <>
                <Play className="size-3.5 fill-current" />
                TIẾP TỤC
              </>
            ) : (
              <>
                <Pause className="size-3.5" />
                TẠM DỪNG
              </>
            )}
          </button>

          <button
            type="button"
            disabled={!isBusy}
            onClick={handleEmergencyStop}
            className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-[#FECACA] bg-[#FEE2E2] px-5 text-xs font-bold text-[#DC2626] transition hover:bg-[#FECACA] disabled:opacity-50"
          >
            <Square className="size-3.5 fill-current" />
            DỪNG KHẨN CẤP
          </button>
        </div>
      </div>

      {/* ═══ RESULTS TABLE CARD: Kết quả quét thông tin Page (Chuẩn Figma) ═══ */}
      <div className="overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        {/* Header Row 1: Title + Export/Save Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F1F5F9] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-[#EFF6FF] text-[#1877F2]">
              <FileText className="size-4" />
            </div>
            <h3 className="text-[15px] font-bold text-[#0F172A]">
              Kết quả quét thông tin Page
            </h3>
            {totalCount > 0 && (
              <span className="rounded-full bg-[#EFF6FF] px-2.5 py-0.5 text-xs font-bold text-[#1877F2]">
                {totalCount.toLocaleString("vi-VN")} page
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleExportCSV}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#86EFAC] bg-[#F0FDF4] px-3.5 text-xs font-bold text-[#15803D] transition hover:bg-[#DCFCE7]"
            >
              <Download className="size-3.5" />
              Xuất toàn bộ file
            </button>
            <button
              type="button"
              onClick={handleSaveList}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#93C5FD] bg-[#DBEAFE] px-3.5 text-xs font-bold text-[#1D4ED8] transition hover:bg-[#BFDBFE]"
            >
              <Save className="size-3.5" />
              Lưu danh sách
            </button>
          </div>
        </div>

        {/* Header Row 2: Search input + Keyword dropdown */}
        <div className="flex flex-wrap items-center gap-3 border-b border-[#F1F5F9] bg-[#F8FAFC]/50 px-6 py-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#94A3B8]" />
            <input
              value={resultSearch}
              onChange={(e) => setResultSearch(e.target.value)}
              placeholder="Tìm Tên, Link, SĐT, Email, Tỉnh thành..."
              className="h-9 w-full rounded-xl border border-[#E2E8F0] bg-white pl-10 pr-4 text-xs text-[#0F172A] outline-none transition focus:border-[#1877F2]"
            />
          </div>

          <select
            value={filterKeyword}
            onChange={(e) => setFilterKeyword(e.target.value)}
            className="h-9 min-w-[160px] rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs font-semibold text-[#334155] outline-none focus:border-[#1877F2]"
          >
            <option value="ALL">Tất cả từ khóa</option>
            {keywordOptions.map((kw) => (
              <option key={kw} value={kw}>
                {kw}
              </option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left text-xs">
            <thead className="bg-[#F8FAFC] text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
              <tr className="border-b border-[#E2E8F0]">
                <th className="w-10 px-4 py-3">
                  <Checkbox
                    checked={pages.length > 0 && selectedPageKeys.length === pages.length}
                    onCheckedChange={(c) =>
                      setSelectedPageKeys(c ? pages.map((p) => p.page_key) : [])
                    }
                  />
                </th>
                <th className="w-14 px-3 py-3">STT</th>
                <th className="px-3 py-3">TỪ KHÓA</th>
                <th className="px-3 py-3">TÊN PAGE</th>
                <th className="px-3 py-3">LINK PAGE</th>
                <th className="px-3 py-3">SỐ ĐIỆN THOẠI</th>
                <th className="px-3 py-3">EMAIL</th>
                <th className="px-3 py-3">WEBSITE</th>
                <th className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
                    className="inline-flex items-center gap-1 font-bold uppercase hover:text-[#1877F2]"
                  >
                    FOLLOWERS
                    <ArrowDownWideNarrow className="size-3.5" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {loadingResults ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-xs text-[#64748B]">
                    <Loader2 className="mx-auto mb-2 size-6 animate-spin text-[#1877F2]" />
                    Đang tải dữ liệu Fanpage...
                  </td>
                </tr>
              ) : pages.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-xs text-[#94A3B8]">
                    Chưa có kết quả Page nào hiển thị. Hãy bấm <strong>BẮT ĐẦU THỰC THI</strong> để bắt đầu quét.
                  </td>
                </tr>
              ) : (
                pages.map((page, idx) => {
                  const globalIdx = (currentPage - 1) * pageSize + idx + 1;
                  const selected = selectedPageKeys.includes(page.page_key);
                  const kwBadge =
                    page.source_keyword ||
                    page.matched_hashtags ||
                    (sourceMode === "paste" ? "Nhập Link" : "Chung");
                  return (
                    <tr
                      key={page.page_key || page.id || idx}
                      className={selected ? "bg-[#EFF6FF]/60" : "hover:bg-[#F8FAFC]"}
                    >
                      <td className="px-4 py-3">
                        <Checkbox
                          checked={selected}
                          onCheckedChange={(c) =>
                            setSelectedPageKeys((prev) =>
                              c
                                ? [...prev, page.page_key]
                                : prev.filter((k) => k !== page.page_key),
                            )
                          }
                        />
                      </td>
                      <td className="px-3 py-3 font-mono font-semibold text-[#64748B]">
                        {String(globalIdx).padStart(2, "0")}
                      </td>
                      <td className="px-3 py-3">
                        <span className="inline-block max-w-[130px] truncate rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-1 text-[11px] font-medium text-[#475569]">
                          {kwBadge}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar className="size-8 border border-[#E2E8F0]">
                            {page.avatar_url && <AvatarImage src={page.avatar_url} />}
                            <AvatarFallback className={AVATAR_COLORS[idx % AVATAR_COLORS.length]}>
                              {initialsOf(page.page_name || "FB")}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex min-w-0 items-center gap-1">
                            <span className="max-w-[180px] truncate font-bold text-[#0F172A]">
                              {page.page_name || "—"}
                            </span>
                            {page.is_verified === true && (
                              <BadgeCheck className="size-4 shrink-0 text-[#1877F2]" />
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {page.page_url ? (
                          <a
                            href={page.page_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex max-w-[180px] items-center gap-1 truncate font-medium text-[#1877F2] hover:underline"
                          >
                            <span className="truncate">
                              {page.page_url.replace(/^https?:\/\/(www\.)?facebook\.com\//, "fb.com/")}
                            </span>
                            <ExternalLink className="size-3 shrink-0" />
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {page.phone ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-[#A7F3D0] bg-[#ECFDF5] px-2.5 py-1 text-[11px] font-bold text-[#059669]">
                            <Phone className="size-3" />
                            {page.phone}
                          </span>
                        ) : (
                          <span className="text-[#CBD5E1]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-[#475569]">
                        {page.email || <span className="text-[#CBD5E1]">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        {page.website ? (
                          <a
                            href={
                              page.website.startsWith("http")
                                ? page.website
                                : `https://${page.website}`
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block max-w-[140px] truncate font-medium text-[#1877F2] hover:underline"
                          >
                            {page.website.replace(/^https?:\/\//, "")}
                          </a>
                        ) : (
                          <span className="text-[#CBD5E1]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-[#0F172A]">
                        {formatFollowers(page.follower_count)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#F1F5F9] px-6 py-3.5">
          <span className="text-xs text-[#64748B]">
            Đang hiển thị{" "}
            <strong className="text-[#0F172A]">
              {totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1} -{" "}
              {Math.min(currentPage * pageSize, totalCount)}
            </strong>{" "}
            trong tổng số <strong className="text-[#0F172A]">{totalCount.toLocaleString("vi-VN")}</strong> kết quả
          </span>

          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => {
                setCurrentPage(currentPage - 1);
                loadResults(sessionId, currentPage - 1);
              }}
              className="flex size-8 items-center justify-center rounded-lg border border-[#E2E8F0] bg-white text-[#64748B] hover:bg-[#F8FAFC] disabled:opacity-40"
            >
              <ChevronLeft className="size-4" />
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setCurrentPage(p);
                  loadResults(sessionId, p);
                }}
                className={`flex size-8 items-center justify-center rounded-lg text-xs font-bold transition ${
                  p === currentPage
                    ? "bg-[#1877F2] text-white shadow-sm"
                    : "border border-[#E2E8F0] bg-white text-[#475569] hover:bg-[#F8FAFC]"
                }`}
              >
                {p}
              </button>
            ))}
            {totalPages > 5 && <span className="px-1.5 text-xs text-[#94A3B8]">...</span>}
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => {
                setCurrentPage(currentPage + 1);
                loadResults(sessionId, currentPage + 1);
              }}
              className="flex size-8 items-center justify-center rounded-lg border border-[#E2E8F0] bg-white text-[#64748B] hover:bg-[#F8FAFC] disabled:opacity-40"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ═══ LIVE AUTOMATION LOG CONSOLE (Chuẩn Figma) ═══ */}
      <div className="overflow-hidden rounded-2xl border border-[#1E293B] bg-[#0B1120] shadow-md">
        <div className="flex items-center justify-between border-b border-[#1E293B] bg-[#0F172A] px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <span className="size-2.5 rounded-full bg-[#EF4444]" />
              <span className="size-2.5 rounded-full bg-[#F59E0B]" />
              <span className="size-2.5 rounded-full bg-[#10B981]" />
            </div>
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#94A3B8]">
              LIVE AUTOMATION LOG CONSOLE
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold text-[#10B981]">
            <span
              className={`size-2 rounded-full ${
                isPaused
                  ? "bg-[#F59E0B]"
                  : isRunning
                    ? "animate-pulse bg-[#10B981]"
                    : "bg-[#10B981]"
              }`}
            />
            {isPaused ? "Đang tạm dừng" : isRunning ? "Đang hoạt động" : "Đang hoạt động"}
          </span>
        </div>

        <div className="max-h-56 space-y-1.5 overflow-y-auto p-5 font-mono text-xs leading-relaxed">
          {logs.map((log) => {
            const tagLabel =
              log.type === "success"
                ? "[SUCCESS]"
                : log.type === "warn"
                  ? "[WARN]"
                  : log.type === "error"
                    ? "[ERROR]"
                    : "[INFO]";
            const tagColor =
              log.type === "success"
                ? "text-[#10B981]"
                : log.type === "warn"
                  ? "text-[#F59E0B]"
                  : log.type === "error"
                    ? "text-[#EF4444]"
                    : "text-[#38BDF8]";
            return (
              <div key={log.id} className="flex items-start gap-2 text-[#E2E8F0]">
                <span className="shrink-0 text-[#64748B]">[{log.timestamp}]</span>
                <span className={`shrink-0 font-bold ${tagColor}`}>{tagLabel}</span>
                <span className="text-[#CBD5E1]">{log.message}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ MODAL CHỌN TÀI KHOẢN FACEBOOK (Chuẩn Figma Chọn tài khoản.png) ═══ */}
      {showAccountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1px]">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[#F1F5F9] px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-[#EFF6FF] text-[#1877F2]">
                  <Users className="size-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-[#0F172A]">
                    Chọn tài khoản Facebook thực thi quét
                  </h2>
                  <p className="text-xs text-[#64748B]">
                    Lựa chọn các tài khoản đang hoạt động (Live) để phân bổ luồng quét tự động
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAccountModal(false)}
                className="rounded-lg p-1.5 text-[#64748B] hover:bg-[#F1F5F9]"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Modal Filter Bar */}
            <div className="flex flex-wrap items-center gap-3 border-b border-[#F1F5F9] bg-[#F8FAFC] px-6 py-3">
              <div className="relative min-w-[240px] flex-1">
                <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#94A3B8]" />
                <input
                  value={modalSearch}
                  onChange={(e) => setModalSearch(e.target.value)}
                  placeholder="Tìm theo Tên tài khoản, UID, Proxy, Thư mục..."
                  className="h-9 w-full rounded-xl border border-[#E2E8F0] bg-white pl-10 pr-4 text-xs text-[#0F172A] outline-none focus:border-[#1877F2]"
                />
              </div>

              <select
                value={modalCategory}
                onChange={(e) => setModalCategory(e.target.value)}
                className="h-9 rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs font-semibold text-[#334155] outline-none"
              >
                <option value="ALL">Tất cả danh mục</option>
                {accountCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <select
                value={modalFarmTime}
                onChange={(e) => setModalFarmTime(e.target.value)}
                className="h-9 rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs font-semibold text-[#334155] outline-none"
              >
                <option value="ALL">Tất cả thời gian nuôi</option>
                <option value="6M">Trên 6 tháng</option>
                <option value="1Y">Trên 1 năm</option>
              </select>
            </div>

            {/* Modal Table */}
            <div className="flex-1 overflow-auto px-6 py-3">
              {accountsLoading ? (
                <div className="py-12 text-center text-xs text-[#64748B]">
                  <Loader2 className="mx-auto mb-2 size-6 animate-spin text-[#1877F2]" />
                  Đang tải danh sách tài khoản...
                </div>
              ) : (
                <table className="w-full min-w-[860px] text-left text-xs">
                  <thead className="sticky top-0 bg-[#F8FAFC] text-[11px] font-bold uppercase text-[#64748B]">
                    <tr className="border-b border-[#E2E8F0]">
                      <th className="w-10 px-3 py-3">
                        <Checkbox
                          checked={
                            filteredModalAccounts.length > 0 &&
                            modalUids.length >=
                              filteredModalAccounts.filter((a) =>
                                LIVE_STATUSES.has(String(a.status)),
                              ).length
                          }
                          onCheckedChange={(c) => {
                            if (c) {
                              setModalUids(
                                filteredModalAccounts
                                  .filter((a) => LIVE_STATUSES.has(String(a.status)))
                                  .map((a) => a.uid),
                              );
                            } else {
                              setModalUids([]);
                            }
                          }}
                        />
                      </th>
                      <th className="w-12 px-2 py-3">STT</th>
                      <th className="px-3 py-3">TÀI KHOẢN & HỌ TÊN</th>
                      <th className="px-3 py-3">UID FACEBOOK</th>
                      <th className="px-3 py-3">DANH MỤC</th>
                      <th className="px-3 py-3">TRẠNG THÁI TK</th>
                      <th className="px-3 py-3">ĐĂNG NHẬP</th>
                      <th className="px-3 py-3">PROXY GÁN KÈM</th>
                      <th className="px-3 py-3 text-right">THỜI GIAN NUÔI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9]">
                    {filteredModalAccounts.map((acc, idx) => {
                      const checked = modalUids.includes(acc.uid);
                      const isLive = LIVE_STATUSES.has(String(acc.status));
                      return (
                        <tr
                          key={acc.uid}
                          onClick={() =>
                            setModalUids((prev) =>
                              checked ? prev.filter((u) => u !== acc.uid) : [...prev, acc.uid],
                            )
                          }
                          className={`cursor-pointer transition ${
                            checked ? "bg-[#EFF6FF]/70" : "hover:bg-[#F8FAFC]"
                          }`}
                        >
                          <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(c) =>
                                setModalUids((prev) =>
                                  c ? [...prev, acc.uid] : prev.filter((u) => u !== acc.uid),
                                )
                              }
                            />
                          </td>
                          <td className="px-2 py-3 font-mono text-[#64748B]">
                            {String(idx + 1).padStart(2, "0")}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2.5">
                              <Avatar className="size-8">
                                <AvatarFallback className={AVATAR_COLORS[idx % AVATAR_COLORS.length]}>
                                  {initialsOf(acc.name)}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="font-bold text-[#0F172A]">{acc.name}</p>
                                <p className="text-[11px] text-[#64748B]">
                                  {acc.email || `${acc.uid}@fb.com`}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 font-mono text-[#334155]">
                            <div className="inline-flex items-center gap-1.5">
                              <span>{acc.uid}</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard?.writeText(acc.uid);
                                  toast.success(`Đã sao chép UID ${acc.uid}`);
                                }}
                                className="text-[#94A3B8] hover:text-[#1877F2]"
                              >
                                <Copy className="size-3" />
                              </button>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <span className="rounded-md bg-[#EFF6FF] px-2.5 py-1 text-[11px] font-semibold text-[#1D4ED8]">
                              {acc.category || acc.folder || "Tài khoản Clone"}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                                isLive
                                  ? "bg-[#ECFDF5] text-[#059669]"
                                  : "bg-[#FEF2F2] text-[#DC2626]"
                              }`}
                            >
                              <span
                                className={`size-1.5 rounded-full ${
                                  isLive ? "bg-[#10B981]" : "bg-[#EF4444]"
                                }`}
                              />
                              {acc.status || "Live"}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#ECFDF5] px-2.5 py-0.5 text-[11px] font-bold text-[#059669]">
                              <CheckCircle2 className="size-3" />
                              Đã đăng nhập
                            </span>
                          </td>
                          <td className="px-3 py-3 font-mono text-[11px] text-[#475569]">
                            {acc.proxy || "Không dùng Proxy"}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-[#334155]">
                            {acc.farm_time || "8 tháng 12 ngày"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#F1F5F9] bg-[#F8FAFC] px-6 py-4">
              <div className="flex items-center gap-2 text-xs text-[#475569]">
                <CheckCircle2 className="size-4 text-[#10B981]" />
                <span>
                  Đã chọn:{" "}
                  <strong className="text-[#1877F2]">{modalUids.length} tài khoản</strong> (Sẵn
                  sàng thực thi)
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowAccountModal(false)}
                  className="h-9 rounded-xl border border-[#CBD5E1] bg-white px-4 text-xs font-bold text-[#475569] hover:bg-[#F1F5F9]"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedUids(modalUids);
                    setShowAccountModal(false);
                    toast.success(`Đã chọn ${modalUids.length} tài khoản thực thi.`);
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#1877F2] px-5 text-xs font-bold text-white shadow-sm hover:bg-[#166FE5]"
                >
                  <Check className="size-4" />
                  Xác nhận chọn ({modalUids.length})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
