"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Link2,
  FileUp,
  Download,
  Check,
  ExternalLink,
  Loader2,
  X,
  BadgeCheck,
  Search,
  Phone,
  Save,
  Plus,
  Trash2,
  FileSpreadsheet,
} from "lucide-react";

import CustomSelect from "@/components/ui/custom-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "@/lib/toast";
import { WS_BASE } from "@/config/constants";
import { getAccounts } from "@/modules/module_02_account_manager/service";
import { normalizeAccount, initialsOf } from "@/modules/module_07_group_spam/shared/components";
import { AVATAR_COLORS } from "@/modules/module_07_group_spam/shared/constants";
import { SelectAccountsModal, isAccountUsable } from "../shared/SelectPagesModal";
import SavePageListModal from "../shared/SavePageListModal";
import { getSessionUserId } from "@/services/sessionIdentity.mjs";
import { loadInputDraft, saveInputDraft } from "./inputDraft.mjs";
import { EmergencyStopModal } from "../shared/EmergencyStopModal";
import {
  loadSavedAccountUids,
  saveSelectedAccountUids,
  resolveUsableSavedUids,
} from "../shared/accountStorage";
import { ScanActionButtons } from "../shared/ScanActionButtons";
import { clearScanState, fetchSavedSessions, loadScanState, saveScanState } from "../shared/scanStateStorage";
import { useActionLock } from "../shared/useActionLock";
import { pickSelectedPagesForSave, saveCsvContent } from "../shared/saveFile.mjs";
import {
  searchPages,
  searchPagesByHashtag,
  parsePageLinks,
  uploadPageFile,
  createDetailSession,
  downloadPageTemplate,
  emergencyStopAll,
  stopScanSession,
  pauseScanSession,
  resumeScanSession,
  getScanSessionDetail,
  getScannedPages,
  getActiveCampaign,
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
import { filterScanResults, toCsv } from "../utils.mjs";
import { LiveLogConsole, Pager, notifyExportResult } from "../_shared";

/* ─── Figma tokens (khớp scan-info / node 2889-27377) ─── */
const FIGMA = {
  pageBg: "bg-[#F4F7FC]",
  card: "rounded-xl border border-[#E2E8F0] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.05)]",
  input:
    "h-[26px] rounded-md border border-[#E2E8F0] bg-white px-2 text-center text-xs font-semibold text-[#1E293B] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none outline-none focus:border-[#2563EB] disabled:bg-slate-100",
};

function SectionCard({ number, title, children }) {
  return (
    <section className={FIGMA.card}>
      <div className="mb-5 flex items-center gap-2.5 border-b border-[#F1F5F9] pb-2">
        {number ? (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#2563EB] text-xs font-bold text-white">
            {number}
          </span>
        ) : null}
        <h2 className="font-heading text-base font-semibold text-[#0F172A]">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function NumCtrl({ value, onChange, min = 1, max = 500, step = 10, disabled, className = "" }) {
  return (
    <div className={`inline-flex h-[30px] items-center overflow-hidden rounded-md border border-[#E2E8F0] bg-white ${className}`}>
      <button
        type="button"
        aria-label="Giảm"
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
        className="flex h-full w-7 items-center justify-center border-r border-[#E2E8F0] text-xs font-bold text-[#94A3B8] hover:bg-slate-50 hover:text-[#475569] disabled:opacity-40"
      >
        -
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))}
        className="h-full w-10 bg-white text-center text-xs font-semibold text-[#1E293B] outline-none [appearance:textfield] disabled:bg-slate-100 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        aria-label="Tăng"
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
        className="flex h-full w-7 items-center justify-center border-l border-[#E2E8F0] text-xs font-bold text-[#94A3B8] hover:bg-slate-50 hover:text-[#475569] disabled:opacity-40"
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
  { id: "keyword", label: "Theo hashtag", Icon: Search },
  { id: "paste", label: "Nhập Link", Icon: Link2 },
  { id: "upload", label: "Tải tệp (.txt / .csv)", Icon: FileUp },
];

const DONE_STATUSES = ["COMPLETED", "PARTIAL", "STOPPED", "FAILED"];
const STATUS_LABELS_VI = {
  RUNNING: "đang chạy",
  PAUSED: "tạm dừng",
  COMPLETED: "hoàn thành",
  PARTIAL: "hoàn thành một phần",
  STOPPED: "đã dừng",
  FAILED: "gặp lỗi",
};
const STOP_REASON_LABELS_VI = {
  TARGET_REACHED: "đạt đủ mục tiêu",
  NO_NEW_RESULTS: "không còn kết quả mới",
  CYCLE_DETECTED: "đã hết danh sách mới",
  END_MARKER: "đã tới cuối danh sách",
  TIMEOUT: "hết thời gian chờ",
  MAX_SCROLLS: "đạt giới hạn cuộn",
  SAFETY_LIMIT: "đạt giới hạn bài an toàn",
  CHECKPOINT: "tài khoản bị checkpoint hoặc mất đăng nhập",
  USER_STOPPED: "đã dừng theo yêu cầu",
  ERROR: "gặp lỗi hệ thống",
  COMPLETED: "hoàn thành",
  PARTIAL: "hoàn thành một phần",
  BUSY_LOCKED: "tài khoản đang bận chạy phiên khác",
};
const statusLabelVi = (st) => STATUS_LABELS_VI[String(st || "").toUpperCase()] || st || "hoàn tất";
const stopReasonLabelVi = (r) => STOP_REASON_LABELS_VI[String(r || "").toUpperCase()] || "hoàn tất";
/* Đợt nhiều hashtag chạy tiếp khi rời trang → để ngoài component, vào lại trang vẫn dừng / theo dõi được */
const campaignRef = {
  current: { paused: false, abort: false, active: false, queue: [], accIndex: 0, sessionIds: [] },
};
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

/** line_items của /source/upload (VALID / DUPLICATE / INVALID) → dòng bảng xem trước. */
function previewRowsFromLineItems(lineItems) {
  const STATUS = { VALID: "valid", DUPLICATE: "duplicate", INVALID: "invalid" };
  return (lineItems || []).map((it, idx) => ({
    id: `srv_${it.line_no ?? idx}_${it.raw_input}`,
    lineNo: it.line_no ?? idx + 1,
    raw: it.raw_input || it.page_url || "",
    status: STATUS[it.status] || "invalid",
  }));
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

  /* Nháp ô nhập (tab / link đã dán / file đã kiểm tra) — chuyển màn rồi quay lại vẫn còn */
  const [draft] = useState(() => loadInputDraft(getSessionUserId()) || {});
  // Có nháp = mới hơn bản lưu theo phiên → khôi phục phiên không được ghi đè tab / link / file
  const hasInputDraft = !!draft.sourceMode;

  /* Source */
  const [sourceMode, setSourceMode] = useState(draft.sourceMode || "keyword");
  /** Chip hỗn hợp: từ khóa thường + #hashtag (mức 3) */
  const [keywords, setKeywords] = useState([]);
  const [searchMode] = useState("NGACH"); // chỉ tìm theo hashtag
  const [campaignId, setCampaignId] = useState(null);
  const [maxFollowers, setMaxFollowers] = useState("");
  const [topN, setTopN] = useState(""); // Top N sau lọc — khác max_results
  const [pasteContent, setPasteContent] = useState(draft.pasteContent || "");
  const [uploadResult, setUploadResult] = useState(draft.uploadResult ?? null);
  const [uploadFile, setUploadFile] = useState(draft.uploadFile ?? null); // File gốc — chỉ lưu DB khi bấm Bắt đầu
  const [uploadFileMeta, setUploadFileMeta] = useState(draft.uploadFileMeta ?? null);
  const [uploadPreviewRows, setUploadPreviewRows] = useState(draft.uploadPreviewRows || []);
  const [uploadFilterTab, setUploadFilterTab] = useState(draft.uploadFilterTab || "ALL");
  const fileInputRef = useRef(null);

  const draftMountedRef = useRef(false);

  useEffect(() => {
    if (!draftMountedRef.current) {
      draftMountedRef.current = true;
      return;
    }
    saveInputDraft(getSessionUserId(), {
      sourceMode,
      pasteContent,
      uploadFile,
      uploadFileMeta,
      uploadPreviewRows,
      uploadResult,
      uploadFilterTab,
    });
  }, [sourceMode, pasteContent, uploadFile, uploadFileMeta, uploadPreviewRows, uploadResult, uploadFilterTab]);

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
  const [saveListKeys, setSaveListKeys] = useState(null); // != null → mở modal "Lưu vào danh sách page chung"
  const [loadingResults, setLoadingResults] = useState(false);
  const [sortDir, setSortDir] = useState("desc");

  const pollRef = useRef(null);
  const ownsCampaignRef = useRef(false); // vòng runMixedCampaign thuộc chính lần mở trang này
  const mountedRef = useRef(true);
  const restoreSeqRef = useRef(0); // tăng khi bắt đầu / quét mới / rời trang → bỏ kết quả khôi phục về muộn
  const restoreScanRef = useRef(null);
  const sessionMetaRef = useRef({}); // sessionId -> { channel, label, kind }
  const sessionIdsRef = useRef([]);
  const wsRef = useRef(null);
  const lastLoadedRef = useRef(0);
  const [poolStats, setPoolStats] = useState({ pool: 0, aboveMin: 0, showing: 0 });
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);

  // Khoá nút trong lúc xử lý: bấm liên tục chỉ chạy 1 lần, không bắn ra nhiều thông báo / yêu cầu
  const [isDeduping, guardDedupe] = useActionLock();
  const [isDownloadingTemplate, guardTemplate] = useActionLock();
  const [isStarting, guardStart] = useActionLock();
  const [isPausing, guardPause] = useActionLock();
  const [isStopping, guardStop, isStoppingApi] = useActionLock();
  const [isExporting, guardExport] = useActionLock();
  const [isSavingList, guardSaveList] = useActionLock();

  /** Đặt phiên của đợt đang xem — cập nhật ref ngay để loadResults không đọc phiên của đợt trước. */
  const setActiveSessionIds = useCallback((ids) => {
    sessionIdsRef.current = ids;
    setSessionIds(ids);
  }, []);

  const showResults = runPhase !== "idle";
  const isRunning = runPhase === "running";
  const isPaused = runPhase === "paused";
  const isBusy = isRunning || isPaused;

  const handleCheckAndDedupe = () => {
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
    // Cùng key: nếu vẫn có thông báo cũ thì thay thế, không xếp chồng thêm
    toast.success(
      removed > 0
        ? `Đã lọc bỏ ${removed} link trùng lặp, còn ${uniqueLines.length} link hợp lệ.`
        : `Tất cả ${uniqueLines.length} link đều không trùng lặp.`,
      { key: "m11-paste-dedupe" },
    );
  };

  // "Tải file mẫu": chỉ báo "thành công" khi người dùng đã chọn nơi lưu và bấm Lưu (khoá nút bằng guardTemplate)
  const handleDownloadTemplate = async () => {
    try {
      const { status, fileName } = await downloadPageTemplate();
      if (status === "saved") {
        toast.success(`Đã tải file mẫu "${fileName}" thành công!`, {
          title: "TẢI FILE THÀNH CÔNG",
          key: "m11-template-download",
        });
      } else if (status === "cancelled") {
        toast.info("Đã huỷ lưu file mẫu.", { title: "TẢI FILE MẪU", key: "m11-template-download" });
      } else if (status === "downloaded") {
        // Trình duyệt không có hộp thoại lưu file → không biết người dùng có bấm Lưu hay không, không báo "thành công"
        toast.info(`Đã gửi file mẫu "${fileName}" cho trình duyệt — kiểm tra thư mục Tải xuống.`, {
          title: "TẢI FILE MẪU",
          key: "m11-template-download",
        });
      } else {
        toast.info("Đã mở file mẫu ở tab mới — hãy lưu file để dùng.", {
          title: "TẢI FILE MẪU",
          key: "m11-template-download",
        });
      }
    } catch {
      toast.error("Không tải được file mẫu. Vui lòng thử lại!", {
        title: "LỖI TẢI FILE",
        key: "m11-template-download",
      });
    }
  };

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
        const saved = loadSavedAccountUids("search");
        if (saved && saved.length) {
          const usable = resolveUsableSavedUids(saved, normalized);
          setSelectedUids(usable);
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

  /* Bộ lọc mới nhất cho các vòng poll (tránh closure cũ khi lọc / phân trang trong lúc quét) */
  const filtersRef = useRef({});
  filtersRef.current = {
    pageSize,
    resultSearch,
    // Link / tệp: BE đã bỏ page dưới ngưỡng followers; page chưa đọc được followers vẫn phải hiện
    minFollowersEnabled: sourceMode === "keyword" ? minFollowersEnabled : false,
    minFollowers,
    maxFollowers,
    topN,
    sortDir,
    filterKeyword,
    searchMode,
    terms: [...plainKeywords, ...manualHashtags],
  };
  const mergedRef = useRef([]); // pool đã gộp của các phiên đang xem
  const filteredAllRef = useRef([]); // toàn bộ kết quả sau lọc (chưa phân trang)
  const currentPageRef = useRef(1);
  const loadSeqRef = useRef(0);

  /** Lọc + phân trang trên pool đã tải (không gọi lại API). */
  const applyResultFilters = useCallback((page = 1) => {
    const f = filtersRef.current;
    const { pool, aboveMin, filtered } = filterScanResults(mergedRef.current, f);
    filteredAllRef.current = filtered;
    const lastPage = Math.max(1, Math.ceil(filtered.length / f.pageSize));
    const p = Math.min(Math.max(1, page), lastPage);
    const slice = filtered.slice((p - 1) * f.pageSize, p * f.pageSize);
    currentPageRef.current = p;
    setCurrentPage(p);
    setPages(slice);
    setTotalCount(filtered.length);
    setPoolStats({ pool, aboveMin, showing: slice.length });
  }, []);

  /** Mọi page của 1 phiên (API trả tối đa 200 / lần → tải nối tiếp đến hết). */
  const fetchAllSessionPages = useCallback(async (id) => {
    const items = [];
    for (let p = 1; p <= 50; p += 1) {
      const data = await getScannedPages({ session_id: id, page: p, page_size: 200, sort_by: "default" });
      const batch = data.items || [];
      items.push(...batch);
      if (!batch.length || items.length >= (Number(data.total) || 0)) break;
    }
    return { sessionId: id, items };
  }, []);

  /**
   * Tải lại pool kết quả của các phiên (mặc định: phiên của đợt hiện tại) rồi lọc + phân trang.
   * Đọc phiên / bộ lọc từ ref nên gọi từ vòng poll cũ vẫn đúng; kết quả về muộn bị bỏ qua.
   */
  const loadResults = useCallback(
    async (sid, page = 1, idsOverride = null) => {
      const ids = (
        idsOverride || (sessionIdsRef.current.length ? sessionIdsRef.current : sid ? [sid] : [])
      ).filter(Boolean);
      if (!ids.length) return;
      const seq = ++loadSeqRef.current;
      setLoadingResults(true);
      try {
        const lists = await Promise.all(ids.map(fetchAllSessionPages));
        if (seq !== loadSeqRef.current) return;
        const f = filtersRef.current;
        mergedRef.current = sortPagesForMode(mergePagesByKey(lists, sessionMetaRef.current), f.searchMode, f.terms);
        applyResultFilters(page);
      } catch (err) {
        toast.error(`Lỗi tải kết quả: ${err.message}`);
      } finally {
        if (seq === loadSeqRef.current) setLoadingResults(false);
      }
    },
    [applyResultFilters, fetchAllSessionPages],
  );

  /** Đợt chạy từ lần mở trang trước: chờ nó sang phiên kế tiếp / kết thúc rồi dựng lại màn hình. */
  const watchDetachedCampaign = useCallback(
    (lastSid) => {
      stopPolling();
      if (!mountedRef.current) return;
      pollRef.current = setInterval(() => {
        const camp = campaignRef.current;
        const newest = camp.sessionIds[camp.sessionIds.length - 1] ?? null;
        if (camp.active && newest === lastSid) return;
        stopPolling();
        restoreScanRef.current?.();
      }, 1500);
    },
    [stopPolling],
  );

  const startPoll = useCallback(
    (sid, onDone = null) => {
      stopPolling();
      lastLoadedRef.current = 0;
      let finished = false;
      const tick = async () => {
        if (finished) return;
        const camp = campaignRef.current;
        if (onDone && camp.abort) {
          finished = true;
          stopPolling();
          onDone({ status: "STOPPED", stop_reason: "USER_STOPPED" });
          return;
        }
        try {
          const session = await getScanSessionDetail(sid);
          if (finished) return;
          const count = session.pages_count || session.total_unique || 0;
          if (session.status === "PAUSED") setRunPhase("paused");
          else if (session.status === "RUNNING") setRunPhase((p) => (p === "paused" ? "running" : p));

          setKeywordProgress((prev) =>
            prev.map((row) =>
              row.status === "scanning" || row.status === "paused"
                ? {
                  ...row,
                  count,
                  status:
                    session.status === "PAUSED"
                      ? "paused"
                      : session.status === "FAILED"
                        ? "error"
                        : DONE_STATUSES.includes(session.status)
                          ? "done"
                          : session.status === "RUNNING"
                            ? "scanning"
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

          const ids = sessionIdsRef.current.length ? sessionIdsRef.current : [sid];
          if (count > lastLoadedRef.current) {
            lastLoadedRef.current = count;
            loadResults(sid, currentPageRef.current, ids);
          }
          if (DONE_STATUSES.includes(session.status)) {
            finished = true;
            stopPolling();
            // Luôn tải kết quả lần cuối khi phiên kết thúc để không sót page cuối cùng
            await loadResults(sid, currentPageRef.current, ids);
            if (onDone) {
              onDone(session);
              return;
            }
            // Đợt khôi phục sau reload không có vòng runMixedCampaign → tự kết thúc UI,
            // kể cả khi backend đánh FAILED phiên mồ côi (app đã tắt giữa chừng).
            const curCamp = campaignRef.current;
            if (curCamp.active && !curCamp.abort && !ownsCampaignRef.current) {
              watchDetachedCampaign(sid);
            } else if (!curCamp.active) {
              setRunPhase("done");
              pushLog(
                `Phiên quét kết thúc (${statusLabelVi(session.status)})${session.error_message ? ` — ${session.error_message}` : ""}.`,
                session.status === "FAILED" ? "error" : "info",
              );
            }
          }
        } catch (e) {
          console.error(e);
        }
      };
      pollRef.current = setInterval(tick, 1500);
    },
    [loadResults, stopPolling, pushLog, watchDetachedCampaign],
  );

  /* Khôi phục đợt đang chạy; không có thì đợt quét xong gần nhất (giống Module 3) */
  const restoreScan = async () => {
    const seq = ++restoreSeqRef.current;
    const stale = () => seq !== restoreSeqRef.current;
    try {
      const saved = loadScanState("search");
      const camp = campaignRef.current;
      let data = await getActiveCampaign("DISCOVERY").catch(() => null);
      // Không có đợt hashtag → thử phiên quét thông tin theo link / tệp (DETAIL)
      if (!data?.active && !camp.active) data = await getActiveCampaign("DETAIL").catch(() => null);
      if (stale()) return;
      const sessions =
        data?.active && data.sessions?.length
          ? data.sessions
          : await fetchSavedSessions("search", camp.active ? camp.sessionIds : saved?.sessionIds);
      if (stale() || (!sessions.length && !camp.active)) return;
      const ids = sessions.map((s) => s.id);
      const top = sessions.find((s) => s.id === data?.primary_session_id) || sessions[sessions.length - 1] || null;
      const campId = top?.campaign_id || (camp.active ? camp.campaignId : null);
      const isSaved =
        !!saved && ((campId && saved.campaignId === campId) || (top && (saved.sessionIds || []).includes(top.id)));
      const topDone = !top || DONE_STATUSES.includes(top.status);
      if (!hasInputDraft && top?.job_type === "DETAIL") setSourceMode(top.source_type === "UPLOAD" ? "upload" : "paste");
      setCampaignId(campId);
      setSessionId(top?.id ?? null);
      setActiveSessionIds(ids);
      sessionMetaRef.current = Object.fromEntries(
        sessions.map((s) => [
          s.id,
          s.job_type === "DETAIL"
            ? { channel: s.source_type === "UPLOAD" ? "FILE" : "LINK", label: s.keyword, kind: "detail" }
            : { channel: "hashtag", label: s.keyword, kind: "hashtag" },
        ]),
      );
      setRunPhase(
        topDone && !camp.active ? "done" : top?.status === "PAUSED" || (camp.active && camp.paused) ? "paused" : "running",
      );

      let settings = {};
      try {
        settings = typeof top?.settings === "string" ? JSON.parse(top.settings || "{}") : top?.settings || {};
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

      if (isSaved) {
        const cfg = saved.config || {};
        if (!hasInputDraft && cfg.sourceMode !== undefined) setSourceMode(cfg.sourceMode);
        if (cfg.keywords !== undefined) setKeywords(cfg.keywords);
        if (cfg.maxFollowers !== undefined) setMaxFollowers(cfg.maxFollowers);
        if (cfg.topN !== undefined) setTopN(cfg.topN);
        if (!hasInputDraft && cfg.pasteContent !== undefined) setPasteContent(cfg.pasteContent);
        if (cfg.rotateEvery !== undefined) setRotateEvery(cfg.rotateEvery);
        if (cfg.delayMin !== undefined) setDelayMin(cfg.delayMin);
        if (cfg.delayMax !== undefined) setDelayMax(cfg.delayMax);
        if (cfg.applyAllTarget !== undefined) setApplyAllTarget(cfg.applyAllTarget);
        if (cfg.targetPagesCount !== undefined) setTargetPagesCount(cfg.targetPagesCount);
        if (cfg.publicOnly !== undefined) setPublicOnly(cfg.publicOnly);
        if (cfg.keywordTargets !== undefined) setKeywordTargets(cfg.keywordTargets);
        if (cfg.minFollowersEnabled !== undefined) setMinFollowersEnabled(cfg.minFollowersEnabled);
        if (cfg.minFollowers !== undefined) setMinFollowers(cfg.minFollowers);
        if (cfg.skipSaveBelowThreshold !== undefined) setSkipSaveBelowThreshold(cfg.skipSaveBelowThreshold);
        if (cfg.minPosts !== undefined) setMinPosts(cfg.minPosts);
        if (cfg.maxPostsPerHashtag !== undefined) setMaxPostsPerHashtag(cfg.maxPostsPerHashtag);
        if (!hasInputDraft && saved.upload) {
          setUploadFileMeta(saved.upload.meta || null);
          setUploadPreviewRows(saved.upload.previewRows || []);
          setUploadResult(saved.upload.result || null);
        }
      }

      const doneLabels = new Set(sessions.map((s) => s.keyword));
      const pendingJobs = camp.active ? camp.queue.filter((j) => !doneLabels.has(j.label)) : [];
      setKeywordProgress([
        ...sessions.map((s) => ({
          keyword: s.keyword || "—",
          count: s.total_unique || 0,
          status:
            s.status === "RUNNING"
              ? "scanning"
              : s.status === "PAUSED"
                ? "paused"
                : s.status === "FAILED"
                  ? "error"
                  : DONE_STATUSES.includes(s.status)
                    ? "done"
                    : "pending",
          channel: s.source_type,
        })),
        ...pendingJobs.map((j) => ({ keyword: j.label, count: 0, status: "pending", channel: j.channel })),
      ]);

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

      if (top) {
        pushLog(`Đang theo dõi lại phiên quét (${statusLabelVi(top.status)}).`, "info");
      }
      if (!camp.active && ids.length) saveScanState("search", { sessionIds: ids, campaignId: campId });
      lastLoadedRef.current = 0;
      await loadResults(top?.id, 1, ids);
      if (stale()) return;
      if (!topDone) startPoll(top.id);
      else if (camp.active) watchDetachedCampaign(top?.id ?? null);
    } catch (err) {
      console.error("[PageScanner] Khôi phục phiên quét:", err);
    }
  };
  restoreScanRef.current = restoreScan;

  useEffect(() => {
    mountedRef.current = true;
    restoreScanRef.current?.();
    return () => {
      mountedRef.current = false;
      restoreSeqRef.current += 1;
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

  /* Lưu cấu hình kèm phiên đang xem để vào lại trang vẫn còn */
  const configJson = JSON.stringify({
    sourceMode,
    keywords,
    maxFollowers,
    topN,
    pasteContent,
    rotateEvery,
    delayMin,
    delayMax,
    applyAllTarget,
    targetPagesCount,
    publicOnly,
    keywordTargets,
    minFollowersEnabled,
    minFollowers,
    skipSaveBelowThreshold,
    minPosts,
    maxPostsPerHashtag,
  });
  useEffect(() => {
    if (runPhase !== "idle") saveScanState("search", { config: JSON.parse(configJson) });
  }, [runPhase, configJson]);

  /** "Quét mới": bỏ phiên đang xem (dữ liệu trong kho không bị xóa). */
  const handleNewScan = () => {
    restoreSeqRef.current += 1;
    loadSeqRef.current += 1;
    stopPolling();
    clearScanState("search");
    saveInputDraft(getSessionUserId(), null);
    setRunPhase("idle");
    setSessionId(null);
    setCampaignId(null);
    setActiveSessionIds([]);
    setKeywordProgress([]);
    setLogs([]);
    setPages([]);
    setSelectedPageKeys([]);
    setCurrentPage(1);
    setTotalCount(0);
    setLoadingResults(false);
    setPoolStats({ pool: 0, aboveMin: 0, showing: 0 });
    sessionMetaRef.current = {};
    mergedRef.current = [];
    filteredAllRef.current = [];
  };

  /** Dùng chung 1 vòng poll duy nhất với startPoll (tránh gọi trùng getScanSessionDetail). */
  const waitForSession = (sid) =>
    new Promise((resolve) => {
      startPoll(sid, resolve);
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
    if (!selectedUids || selectedUids.length === 0) {
      toast.warning("Chưa chọn tài khoản", { key: "m11-search-start" });
      return false;
    }
    const usable = accounts.filter((a) => selectedUids.includes(a.uid) && isAccountUsable(a));
    if (!usable.length) {
      toast.warning("Không có tài khoản khả dụng (Live & Đã đăng nhập) trong danh sách đã chọn.", {
        key: "m11-search-start",
      });
      return false;
    }

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
      if (!uploadFile && !uploadResult?.pages) errors.push("Chưa tải file lên.");
      else if (uploadResult && !uploadResult.valid_count) errors.push("File không có link Page hợp lệ.");
    }

    if (delayMin > delayMax) errors.push("Khoảng giãn cách không hợp lệ (từ > đến).");

    if (errors.length) {
      toast.error(errors[0], { key: "m11-search-start" });
      return false;
    }
    return true;
  };

  /** Campaign hashtag-only — gom pool theo campaign_id */
  const runMixedCampaign = async () => {
    const jobs = buildCampaignJobs({ searchMode, keywords: plainKeywords, manualHashtags });
    const campId = newCampaignId();
    setCampaignId(campId);
    const camp = {
      paused: false, abort: false, queue: jobs, accIndex: 0, active: true, campaignId: campId, sessionIds: [],
    };
    campaignRef.current = camp;
    ownsCampaignRef.current = true;
    saveScanState("search", { sessionIds: [], campaignId: campId, upload: null });
    sessionMetaRef.current = {};
    mergedRef.current = [];
    setActiveSessionIds([]);
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
      `Bắt đầu đợt quét ${jobs.length} mục tiêu: ${jobs.map((j) => j.label).join(", ")}.`,
      "info",
    );

    let accState = { cursor: 0, pagesOnAcc: 0 };
    const collectedIds = [];

    for (let i = 0; i < jobs.length; i += 1) {
      while (camp.paused && !camp.abort) {
        setRunPhase("paused");
        await new Promise((r) => setTimeout(r, 400));
      }
      if (camp.abort) break;

      setRunPhase("running");
      const job = jobs[i];
      const uid = currentCampaignUid(accState);
      // Giữ Chrome nếu còn job sau (cùng acc tái dùng; đổi acc thì BE đóng scope cũ)
      const keepBrowser = i < jobs.length - 1 && !camp.abort;

      setKeywordProgress((prev) =>
        prev.map((row) => (row.keyword === job.label ? { ...row, status: "scanning" } : row)),
      );
      pushLog(
        `Đang quét ${job.label}${uid ? ` · tài khoản ${uid}` : ""}.`,
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
          const orderedUids = selectedUids.length
            ? [
              ...selectedUids.slice(accState.cursor % selectedUids.length),
              ...selectedUids.slice(0, accState.cursor % selectedUids.length),
            ]
            : [];
          const res = await searchPagesByHashtag({
            hashtags: [job.query],
            context_keywords: plainKeywords,
            min_posts: minPosts,
            max_posts_per_hashtag: maxPostsPerHashtag,
            account_uid: uid,
            account_uids: orderedUids.length ? orderedUids : undefined,
            headless: false,
            allow_direct_fallback: true,
            campaign_id: campId,
            keep_browser: keepBrowser,
            target_pages: targetPages,
            min_followers: minFollowersEnabled ? minFollowers : 0,
            idle_timeout_s: 90,
            delay_min_seconds: delayMin,
            delay_max_seconds: delayMax,
            rotate_every: selectedUids.length > 1 ? rotateEvery : 0,
            pages_on_acc_start: accState.pagesOnAcc || 0,
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
        // Lưu thẳng (không qua effect) để phiên mở sau khi rời trang cũng được ghi nhớ
        camp.sessionIds = [...collectedIds];
        if (campaignRef.current === camp) saveScanState("search", { sessionIds: camp.sessionIds, campaignId: campId });
        setActiveSessionIds([...collectedIds]);
        const session = await waitForSession(sid);
        stopPolling();
        const count = session.pages_count || session.total_unique || 0;
        setKeywordProgress((prev) =>
          prev.map((row) =>
            row.keyword === job.label ? { ...row, count, status: "done" } : row,
          ),
        );
        const stopReason = session.stop_reason || session.status || "";
        const targetHint =
          job.kind === "hashtag"
            ? keywordTargets[job.label?.startsWith("#") ? job.label : `#${job.query}`] ||
            keywordTargets[job.rootKeyword] ||
            keywordTargets[job.query] ||
            applyAllTarget
            : null;
        const partialShort =
          targetHint != null &&
          count < Number(targetHint) &&
          ["NO_NEW_RESULTS", "CYCLE_DETECTED", "PARTIAL", "COMPLETED"].includes(String(stopReason));
        const reasonVi = stopReasonLabelVi(stopReason);
        pushLog(
          partialShort
            ? `Xong ${job.label}: tìm được ${count}/${targetHint} Page (${reasonVi}).`
            : `Xong ${job.label}: tìm được ${count} Page (${reasonVi}).`,
          session.status === "FAILED" ? "error" : partialShort ? "warn" : "success",
        );

        // Phiên hashtag tự đổi acc giữa chừng → lấy acc + số page thật từ BE, chỉ đổi thêm nếu acc đã đủ hạn mức
        let rotation = null;
        try {
          const st = typeof session.settings === "string" ? JSON.parse(session.settings) : session.settings;
          rotation = st?.rotation || null;
        } catch {
          /* không đọc được settings → tính theo số page của job */
        }
        const realCursor = rotation
          ? selectedUids.findIndex((u) => String(u) === String(rotation.account_uid))
          : -1;
        const nextAcc =
          realCursor >= 0
            ? advanceAccountAfterJob({ cursor: realCursor, pagesOnAcc: 0 }, rotation.pages_on_acc, rotateEvery)
            : advanceAccountAfterJob(accState, count, rotateEvery);
        // Chỉ báo đổi acc khi còn job phía sau
        if (nextAcc.rotated && i < jobs.length - 1) {
          pushLog(
            `Đã quét đủ ${nextAcc.prevPages} Page trên tài khoản hiện tại — chuyển sang tài khoản ${selectedUids[nextAcc.cursor] || "kế tiếp"}.`,
            "warn",
          );
        }
        accState = { cursor: nextAcc.cursor, pagesOnAcc: nextAcc.pagesOnAcc };
        camp.accIndex = accState.cursor;

        // Nghỉ theo cấu hình giữa các job (hashtag/kênh) — có thể ngắt ngay khi bấm Dừng khẩn cấp
        if (i < jobs.length - 1 && !camp.abort) {
          const lo = Math.min(delayMin, delayMax);
          const hi = Math.max(delayMin, delayMax);
          const gapSec = lo + Math.random() * Math.max(0, hi - lo);
          pushLog(`Nghỉ ${gapSec.toFixed(1)}s trước phiên tiếp theo...`, "info");
          const endAt = Date.now() + gapSec * 1000;
          while (!camp.abort && Date.now() < endAt) {
            await new Promise((r) => setTimeout(r, Math.min(250, Math.max(0, endAt - Date.now()))));
          }
        }

        await loadResults(sid, 1, [...collectedIds]);
      } catch (err) {
        setKeywordProgress((prev) =>
          prev.map((row) => (row.keyword === job.label ? { ...row, status: "error" } : row)),
        );
        pushLog(`Lỗi ${job.label}: ${err.message}`, "error");
        toast.error(err.message);
      }
    }

    camp.active = false;
    if (campaignRef.current !== camp) return; // đã bắt đầu đợt khác sau khi dừng khẩn cấp
    ownsCampaignRef.current = false;
    stopPolling();
    setRunPhase("done");
    if (camp.abort) {
      pushLog("Đã dừng khẩn cấp toàn bộ đợt quét.", "error");
    } else {
      pushLog("Hoàn tất toàn bộ đợt quét — đang cập nhật bảng kết quả.", "success");
      toast.success(`Hoàn thành đợt ${modeLabel}.`, { key: "m11-search-start" });
      if (collectedIds.length) {
        await loadResults(collectedIds[collectedIds.length - 1], 1, collectedIds);
      }
    }
  };

  const handleStart = () => {
    if (!validateBeforeStart()) return;
    restoreSeqRef.current += 1;
    setLogs([]);
    setPages([]);
    setSelectedPageKeys([]);
    setCurrentPage(1);
    setTotalCount(0);
    setPoolStats({ pool: 0, aboveMin: 0, showing: 0 });
    lastLoadedRef.current = 0;
    sessionMetaRef.current = {};
    mergedRef.current = [];
    filteredAllRef.current = [];

    if (sourceMode === "keyword") {
      // Chạy campaign nền — không giữ isStarting suốt nhiều phút (tránh khóa nút QUÉT MỚI sau Dừng khẩn cấp)
      void runMixedCampaign();
      return;
    }
    if (sourceMode === "paste" || sourceMode === "upload") {
      return runDetailScan();
    }
  };

  /**
   * Nhập link / Tải tệp: chuẩn hoá link (không lưu) → tạo phiên DETAIL chạy Chrome nền
   * (mở từng Page + About, lấy SĐT / Email / Website / Địa chỉ) → poll tiến độ như chế độ hashtag.
   */
  const runDetailScan = async () => {
    const isUpload = sourceMode === "upload";
    const fileName = uploadFile?.name || uploadFileMeta?.name || "";
    const label = isUpload ? `File ${fileName}`.trim() : "Nhập link";
    setRunPhase("running");
    campaignRef.current = { paused: false, abort: false, queue: [], accIndex: 0, active: false, sessionIds: [] };
    ownsCampaignRef.current = false;
    pushLog("Đang kiểm tra danh sách Page đầu vào…", "info");
    try {
      let parsed = isUpload ? uploadResult : null;
      if (isUpload && !parsed?.pages) {
        const formData = new FormData();
        formData.append("file", uploadFile);
        parsed = await uploadPageFile(formData, { save_to_db: false, filter_existing: true });
        setUploadResult(parsed);
      } else if (!isUpload) {
        parsed = await parsePageLinks({ content: pasteContent.trim(), filter_existing: true, save_to_db: false });
      }
      const targets = (parsed?.pages || []).filter((p) => p.page_key);
      if (!targets.length) throw new Error("Không có link Page hợp lệ để quét.");
      const extraInfo = [
        parsed.dedup_count ? `bỏ ${parsed.dedup_count} trùng lặp` : "",
        parsed.invalid_count ? `${parsed.invalid_count} link không hợp lệ` : "",
      ].filter(Boolean);
      pushLog(
        `Nhận diện ${targets.length} Page hợp lệ${extraInfo.length ? ` (${extraInfo.join(", ")})` : ""}.`,
        "info",
      );

      const usable = accounts.filter((a) => selectedUids.includes(a.uid) && isAccountUsable(a));
      const accountUids = usable.map((a) => a.uid);
      if (!accountUids.length) {
        toast.warning("Chưa chọn tài khoản", { key: "m11-search-start" });
        setRunPhase("idle");
        return;
      }
      const target = Math.min(targetPagesCount, targets.length);
      const res = await createDetailSession({
        pages: targets.map((p) => ({ page_key: p.page_key, page_url: p.page_url })),
        source_type: isUpload ? "UPLOAD" : "PARSE",
        source_label: label,
        account_uids: accountUids.length ? accountUids : null,
        rotate_every: rotateEvery,
        rotate_on_checkpoint: true,
        target_pages: target,
        min_followers: minFollowersEnabled ? minFollowers : 0,
        page_delay_min_s: delayMin,
        page_delay_max_s: delayMax,
      });
      const sid = res.session_id;
      sessionMetaRef.current[sid] = { channel: isUpload ? "FILE" : "LINK", label, kind: "detail" };
      saveScanState("search", {
        sessionIds: [sid],
        campaignId: null,
        upload: isUpload
          ? {
            meta: uploadFileMeta,
            previewRows: uploadPreviewRows.slice(0, 1000),
            result: {
              pages: targets.map((p) => ({ page_key: p.page_key, page_url: p.page_url })),
              valid_count: parsed.valid_count,
              dedup_count: parsed.dedup_count,
              invalid_count: parsed.invalid_count,
            },
          }
          : null,
      });
      setSessionId(sid);
      setActiveSessionIds([sid]);
      setKeywordProgress([{ keyword: label, count: 0, status: "scanning", target }]);
      pushLog(`Đã khởi động quét thông tin ${target} Page.`, "success");
      toast.success(`Bắt đầu quét thông tin ${target} page.`, { key: "m11-search-start" });
      startPoll(sid);
    } catch (err) {
      setRunPhase("idle");
      pushLog(err.message || "Không thể khởi động phiên quét.", "error");
      toast.error(err.message || "Lỗi khởi động phiên", { key: "m11-search-start" });
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
          pushLog(`Không thể tiếp tục phiên: ${err.message}`, "error");
        }
      }
      pushLog("Đã tiếp tục phiên đang tạm dừng.", "success");
      toast.info("Đã tiếp tục.", { key: "m11-search-pause" });
      return;
    }
    campaignRef.current.paused = true;
    setRunPhase("paused");
    if (sessionId) {
      try {
        await pauseScanSession(sessionId);
      } catch (err) {
        pushLog(`Không thể tạm dừng phiên: ${err.message}`, "error");
      }
    }
    pushLog("Đã tạm dừng phiên quét.", "warn");
    toast.info("Đã tạm dừng.", { key: "m11-search-pause" });
  };

  const handleEmergencyStop = () => {
    setShowEmergencyModal(true);
  };

  const handleConfirmEmergencyStop = async () => {
    campaignRef.current.abort = true;
    campaignRef.current.paused = false;
    stopPolling();
    try {
      if (sessionId) {
        await stopScanSession(sessionId).catch(() => {});
        pushLog("Đã gửi yêu cầu dừng khẩn cấp phiên hiện tại.", "error");
      }
      await emergencyStopAll().catch(() => {});
      pushLog("Đã đóng trình duyệt và giải phóng tài khoản.", "warn");
    } catch (err) {
      pushLog(`Lỗi khi dừng phiên: ${err.message}`, "error");
    } finally {
      setShowEmergencyModal(false);
      setRunPhase("done");
      toast.warning("Đã dừng khẩn cấp.", { key: "m11-search-stop" });
    }
  };

  /* Chọn file = CHỈ xem trước / kiểm tra (không lưu DB). Lưu khi bấm "Bắt đầu thực thi". */
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const isExcel = /\.xlsx$/i.test(file.name);
    // .xlsx là file nhị phân → bảng xem trước lấy từ kết quả kiểm tra của server bên dưới
    const rawText = isExcel ? "" : await file.text().catch(() => "");
    const parsedRows = parseRawLinesToPreview(rawText);
    setUploadPreviewRows(parsedRows);
    setUploadFileMeta({
      name: file.name,
      sizeKb: Math.max(0.1, Number((file.size / 1024).toFixed(1))),
      totalRows: parsedRows.length,
    });
    setUploadFile(file);
    setUploadResult(null);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await uploadPageFile(formData, { save_to_db: false, filter_existing: true });
      setUploadResult(res);
      // Bảng xem trước theo đúng kết quả kiểm tra của server (giống lúc lưu)
      const serverRows = previewRowsFromLineItems(res.line_items);
      if (serverRows.length) {
        setUploadPreviewRows(serverRows);
        setUploadFileMeta((m) => (m ? { ...m, totalRows: serverRows.length } : m));
      }
      toast.success(
        `Đã nhận diện ${serverRows.length || parsedRows.length || res.valid_count} dòng dữ liệu từ "${file.name}"`,
      );
    } catch (err) {
      toast.error(`Lỗi đọc file: ${err.message}`);
    }
  };

  /* "Xuất toàn bộ file" = TOÀN BỘ kết quả đang lọc của đợt (mọi phiên, mọi trang), không chỉ trang đang xem.
     Dùng showSaveFilePicker (giống Tải file mẫu): chỉ báo thành công sau khi người dùng chọn nơi lưu và bấm Lưu. */
  const handleExportCSV = async () => {
    const rowsSrc = filteredAllRef.current;
    if (!rowsSrc.length) {
      toast.warning("Chưa có page để xuất.", { key: "m11-search-export" });
      return;
    }
    const headers = [
      "STT", "Từ khóa", "Tên Page", "Link Page", "Followers", "SĐT", "Email", "Website", "Vị trí / Địa chỉ",
    ];
    const rows = rowsSrc.map((p, i) => [
      i + 1,
      pageKeywordLabel(p) === "—" ? (filterKeyword !== "ALL" ? filterKeyword : "") : pageKeywordLabel(p),
      p.page_name || "",
      p.page_url || "",
      p.follower_count ?? "",
      p.phone || "",
      p.email || "",
      p.website || "",
      p.address || "",
    ]);
    try {
      const res = await saveCsvContent(
        toCsv(headers, rows),
        `quet_page_${new Date().toISOString().slice(0, 10)}.csv`,
      );
      notifyExportResult(res, {
        successMessage: `Đã xuất ${rowsSrc.length.toLocaleString("vi-VN")} page ra file "${res.fileName}".`,
        key: "m11-search-export",
      });
    } catch (err) {
      toast.error(`Lỗi xuất file: ${err?.message || "Không lưu được file."}`, { key: "m11-search-export" });
    }
  };

  /* "Lưu danh sách": BẮT BUỘC phải tick chọn ít nhất 1 page trong bảng kết quả — không tự lấy toàn bộ.
     Mở modal chọn / tạo danh mục (lưu DB). */
  const handleSaveList = () => {
    const picked = pickSelectedPagesForSave(filteredAllRef.current, selectedPageKeys);
    if (!picked.ok) {
      toast.warning(
        picked.reason === "no_matching_pages"
          ? "Các page đã chọn không còn trong kết quả đang lọc — vui lòng chọn lại."
          : "Vui lòng chọn ít nhất 1 page để lưu vào danh sách.",
        { key: "m11-search-save-list" },
      );
      return;
    }
    setSaveListKeys(picked.keys);
  };

  const handleListSaved = (res) => {
    const name = res?.category?.name || "";
    pushLog(
      `Lưu danh sách: ${res?.added ?? 0} page → «${name}»` +
        (res?.skipped_existing ? ` · ${res.skipped_existing} page đã có` : "") +
        (res?.not_found ? ` · ${res.not_found} page chưa có trong kho` : ""),
      "success",
    );
  };

  /* Đổi lọc / sắp xếp → lọc lại trên pool đã tải (không cần gọi lại API) */
  useEffect(() => {
    if (runPhase === "idle") return undefined;
    const t = setTimeout(() => applyResultFilters(1), 200);
    return () => clearTimeout(t);
  }, [
    resultSearch,
    filterKeyword,
    minFollowersEnabled,
    minFollowers,
    maxFollowers,
    topN,
    sortDir,
    runPhase,
    applyResultFilters,
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const keywordOptions = useMemo(() => {
    const opts = [...plainKeywords, ...manualHashtags];
    return opts;
  }, [plainKeywords, manualHashtags]);

  const selCount = selectedUids.length;

  return (
    <div className={`-m-6 min-h-full space-y-6 ${FIGMA.pageBg} p-6`}>
      <div>
        <h1 className="font-heading text-xl font-bold text-[#0F172A]">Quét thông tin page</h1>
        <p className="mt-1 max-w-3xl text-xs text-[#64748B]">
          Tìm kiếm, lọc danh sách Fanpage Facebook theo từ khóa, dán danh sách link hoặc tải tệp file và trích
          xuất dữ liệu chi tiết liên hệ (Số điện thoại, Email, Website, Follower).
        </p>
      </div>

      <div className="grid items-stretch gap-6 xl:grid-cols-2">
        {/* ═══ Card 1 — Figma 2889-27377 ═══ */}
        <SectionCard number="1" title="Chọn tài khoản & Thiết lập phiên quét">
          {/* Row: + Chọn tài khoản + badge xanh */}
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                setModalUids([...selectedUids]);
                setShowAccountModal(true);
              }}
              className="inline-flex h-8 items-center gap-2 rounded-lg bg-[#2563EB] px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-[#1D4ED8] disabled:opacity-60"
            >
              <Plus className="size-3.5 stroke-[2.5]" />
              Chọn tài khoản
            </button>
            {selCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-1 text-xs font-medium text-[#047857]">
                <span className="size-2 rounded-full bg-[#10B981]" />
                Đã chọn: <strong className="font-bold">{selCount} tài khoản</strong>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                <span className="size-2 rounded-full bg-amber-500" />
                Chưa chọn tài khoản
              </span>
            )}
          </div>

          {/* PHƯƠNG THỨC QUÉT — tab solid blue khi active */}
          <div className="mb-5 border-t border-[#F1F5F9] pt-2.5">
            <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.6px] text-[#64748B]">
              PHƯƠNG THỨC QUÉT
            </p>
            <div className="inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-[#E2E8F0]/80 bg-[#F8FAFC] p-1">
              {SOURCE_MODES.map(({ id, label, Icon }) => {
                const active = sourceMode === id;
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={isBusy}
                    onClick={() => setSourceMode(id)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition disabled:opacity-60 ${active
                      ? "bg-[#2563EB] text-white shadow-sm"
                      : "text-[#475569] hover:text-[#0F172A]"
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
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#475569]">Nhập hashtag</span>
                <span className="text-[11px] text-[#94A3B8]">
                  Đã chọn:{" "}
                  <strong className="font-bold text-[#2563EB]">{derivedHashtags.length || keywords.length}</strong> từ
                  khóa
                </span>
              </div>

              <div
                className={`flex max-h-[200px] min-h-[68px] w-full flex-wrap content-start items-start gap-1.5 overflow-y-auto rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-1.5 transition focus-within:border-[#2563EB] focus-within:bg-white ${isBusy ? "opacity-60" : ""
                  }`}
              >
                {keywords.map((chip) => (
                  <span
                    key={chip}
                    className="inline-flex items-center gap-1 rounded bg-[#DBEAFE] px-2.5 py-1 text-xs font-medium text-[#1E40AF]"
                  >
                    {chip}
                    {!isBusy && (
                      <button
                        type="button"
                        onClick={() => setKeywords(keywords.filter((c) => c !== chip))}
                        aria-label={`Xóa ${chip}`}
                        className="text-[#3B82F6] hover:text-[#1E3A8A]"
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
                  disabled={isBusy || isDeduping || !pasteContent.trim()}
                  aria-busy={isDeduping}
                  onClick={() => guardDedupe(handleCheckAndDedupe)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#1877F2] px-3.5 text-xs font-bold text-white shadow-sm hover:bg-[#166FE5] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isDeduping && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
                  {isDeduping ? "Đang kiểm tra..." : "Kiểm tra & Lọc trùng lặp"}
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
                  Kéo thả file <span className="text-[#1877F2]">.txt</span>,{" "}
                  <span className="text-[#1877F2]">.csv</span> hoặc{" "}
                  <span className="text-[#1877F2]">.xlsx</span> vào đây hoặc{" "}
                  <span className="text-[#1877F2] underline">Bấm để tải lên</span>
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.csv,.xlsx"
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
                const invalidRows = uploadPreviewRows.filter((r) => r.status === "invalid");
                const displayRows =
                  uploadFilterTab === "VALID"
                    ? validRows
                    : uploadFilterTab === "DUP"
                      ? dupRows
                      : uploadFilterTab === "INVALID"
                        ? invalidRows
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
                          className={`rounded-full px-2.5 py-0.5 font-bold ${uploadFilterTab === "ALL"
                            ? "bg-[#DBEAFE] text-[#1D4ED8]"
                            : "bg-[#F1F5F9] text-[#64748B]"
                            }`}
                        >
                          Tất cả ({uploadPreviewRows.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setUploadFilterTab("VALID")}
                          className={`rounded-full px-2.5 py-0.5 font-bold ${uploadFilterTab === "VALID"
                            ? "bg-[#D1FAE5] text-[#059669]"
                            : "bg-[#F1F5F9] text-[#64748B]"
                            }`}
                        >
                          Hợp lệ ({validRows.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setUploadFilterTab("DUP")}
                          className={`rounded-full px-2.5 py-0.5 font-bold ${uploadFilterTab === "DUP"
                            ? "bg-[#FEF3C7] text-[#D97706]"
                            : "bg-[#FEF3C7]/60 text-[#D97706]"
                            }`}
                        >
                          Trùng lặp ({dupRows.length})
                        </button>
                        {invalidRows.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setUploadFilterTab("INVALID")}
                            className={`rounded-full px-2.5 py-0.5 font-bold ${uploadFilterTab === "INVALID"
                              ? "bg-[#FEE2E2] text-[#DC2626]"
                              : "bg-[#FEE2E2]/60 text-[#DC2626]"
                              }`}
                          >
                            Lỗi ({invalidRows.length})
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white">
                      <div className="max-h-[200px] overflow-y-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="sticky top-0 bg-[#F8FAFC] text-[11px] font-semibold text-[#64748B]">
                            <tr className="border-b border-[#E2E8F0]">
                              <th className="w-14 px-3 py-2">Dòng</th>
                              <th className="px-3 py-2">Dữ liệu tệp</th>
                              <th className="w-28 px-3 py-2 text-center">Trạng thái</th>
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
                                  ) : r.status === "duplicate" ? (
                                    <span className="rounded-full bg-[#FEF3C7] px-2.5 py-0.5 text-[10px] font-bold text-[#D97706]">
                                      Trùng lặp
                                    </span>
                                  ) : (
                                    <span className="rounded-full bg-[#FEE2E2] px-2.5 py-0.5 text-[10px] font-bold text-[#DC2626]">
                                      Không hợp lệ
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="border-t border-[#F1F5F9] bg-[#F8FAFC] px-3 py-1.5 text-right text-[11px] text-[#94A3B8]">
                        Hiển thị {displayRows.length} trên {uploadPreviewRows.length} dòng được phân tích
                      </div>
                    </div>
                  </div>
                );
              })()}

              <button
                type="button"
                onClick={() => guardTemplate(handleDownloadTemplate)}
                disabled={isDownloadingTemplate}
                aria-busy={isDownloadingTemplate}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-[#1877F2] hover:underline disabled:cursor-not-allowed disabled:opacity-60 disabled:no-underline"
              >
                {isDownloadingTemplate ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="size-3" aria-hidden="true" />
                )}
                {isDownloadingTemplate ? "Đang tải…" : "Tải file mẫu"}
              </button>
            </div>
          )}
        </SectionCard>

        {/* ═══ Card 2 ═══ */}
        <SectionCard number="2" title="Thiết lập cấu hình quét mục tiêu">
          {sourceMode === "keyword" && (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[#1E293B]">
                  Cấu hình số nhóm mục tiêu theo từng hashtag
                </p>
                <div className="flex items-center gap-1.5 rounded-md border border-[#E2E8F0]/90 bg-[#F8FAFC] px-2 py-1">
                  <span className="text-[11px] font-medium text-[#64748B]">Áp dụng tất cả:</span>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    disabled={isBusy}
                    value={applyAllTarget}
                    onChange={(e) =>
                      setApplyAllTarget(Math.min(500, Math.max(1, Number(e.target.value) || 1)))
                    }
                    className={`${FIGMA.input} !h-[22px] w-10 !rounded !px-0.5`}
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
                    className="inline-flex h-5 items-center rounded bg-[#2563EB] px-3.5 text-[11px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                  >
                    Áp dụng
                  </button>
                </div>
              </div>
              {derivedHashtags.length === 0 ? (
                <p className="text-xs text-[#94A3B8]">Thêm hashtag ở cột trái để đặt hạn mức.</p>
              ) : (
                <div className="max-h-[240px] overflow-y-auto rounded-lg border border-[#E2E8F0] bg-white">
                  {derivedHashtags.map((tag, i) => (
                    <div
                      key={tag}
                      className="flex items-center justify-between gap-3 border-t border-[#F1F5F9] px-3 py-2 first:border-t-0"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={`size-1.5 shrink-0 rounded-full ${i % 2 ? "bg-[#F59E0B]" : "bg-[#2563EB]"}`} />
                        <span className="truncate text-xs font-medium text-[#1E293B]">{tag}</span>
                      </span>
                      <div className="flex shrink-0 items-center gap-2">
                        <NumCtrl
                          value={keywordTargets[tag] || applyAllTarget}
                          onChange={(v) => setKeywordTargets((prev) => ({ ...prev, [tag]: v }))}
                          min={1}
                          max={500}
                          step={10}
                          disabled={isBusy}
                        />
                        <span className="min-w-9 text-xs text-[#64748B]">nhóm</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className={`max-w-[473px] space-y-4 ${sourceMode === "keyword" ? "p-5 pb-0" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 py-1 text-xs font-medium text-[#334155]">
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
                <span className="font-normal text-[#64748B]">page / tài khoản</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 py-1 text-xs font-medium text-[#334155]">
              <span>Khoảng cách giữa các lần quét</span>
              <div className="flex flex-wrap items-center gap-2">
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
                <span className="font-normal text-[#64748B]">giây</span>
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

            <div className="flex flex-wrap items-center gap-2 border-t border-[#F1F5F9] pt-3 text-xs font-medium text-[#334155]">
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={minFollowersEnabled}
                  disabled={isBusy}
                  onCheckedChange={(c) => setMinFollowersEnabled(!!c)}
                />
                <span>Chỉ quét page có số lượng followers lớn hơn</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label="Số followers tối thiểu"
                  disabled={isBusy || !minFollowersEnabled}
                  value={Number(minFollowers || 0).toLocaleString("vi-VN")}
                  onChange={(e) => setMinFollowers(Number(e.target.value.replace(/\D/g, "").slice(0, 9)) || 0)}
                  className={`${FIGMA.input} w-20`}
                />
                <span className="font-normal text-[#64748B]">Followers</span>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Controls: idle = Start; đang chạy = Pause + Emergency */}
      <ScanActionButtons
        live={isBusy}
        paused={isPaused}
        stopping={isStoppingApi}
        showNewScan={showResults}
        startDisabled={isStarting}
        controlDisabled={isPausing || isStopping}
        onStart={() => guardStart(handleStart)}
        onPauseResume={() => guardPause(handlePauseResume)}
        onStop={handleEmergencyStop}
        onNewScan={handleNewScan}
      />

      {/* Kết quả + log: chỉ hiện sau khi bắt đầu chạy */}
      {showResults && (
        <>
          <section className="space-y-4 rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-heading text-base font-bold text-[#0F172A]">Kết quả quét thông tin Page</h2>
              {keywordProgress.length > 0 && (
                <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-bold">
                  <span className="text-[#696E7A]">Đã quét được:</span>
                  {keywordProgress.map((row) => {
                    const target = row.target || keywordTargets[row.keyword] || applyAllTarget;
                    const count = Number(row.count) || 0;
                    const error = row.status === "error";
                    return (
                      <span
                        key={row.keyword}
                        title={error ? "Hashtag quét lỗi" : undefined}
                        className={`inline-flex items-center gap-1.5 ${error ? "text-rose-600" : "text-[#1D4ED8]"}`}
                      >
                        <span
                          className={`size-1 rounded-full bg-current ${row.status === "scanning" ? "animate-pulse" : ""}`}
                        />
                        {row.keyword}{" "}
                        <span className="tabular-nums">
                          {count}/{target}
                        </span>
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!pages.length || isExporting}
                  onClick={() => guardExport(handleExportCSV)}
                  className="inline-flex h-[34px] items-center gap-2 rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] px-3.5 text-xs font-semibold text-[#047857] hover:bg-emerald-100 disabled:opacity-40"
                >
                  <Download className="size-4" />
                  Xuất toàn bộ file
                </button>
                <button
                  type="button"
                  disabled={(!pages.length && !totalCount) || isSavingList}
                  onClick={() => guardSaveList(handleSaveList)}
                  className="inline-flex h-[34px] items-center gap-2 rounded-lg bg-[#2563EB] px-3.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-40"
                >
                  <Save className="size-3.5" />
                  {selectedPageKeys.length > 0 ? `Lưu danh sách (${selectedPageKeys.length})` : "Lưu danh sách"}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#94A3B8]" />
                <input
                  value={resultSearch}
                  onChange={(e) => setResultSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyResultFilters(1)}
                  placeholder="Tìm Tên, Link, SĐT, Email, Tỉnh thành..."
                  className="h-[34px] w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] pl-9 pr-3 text-xs outline-none placeholder:text-[#64748B] focus:border-[#2563EB]"
                />
              </div>
              <CustomSelect
                className="w-44"
                buttonClassName="!h-[34px] !border-[#E2E8F0] !shadow-none"
                value={filterKeyword}
                onChange={setFilterKeyword}
                options={[
                  { value: "ALL", label: "Tất cả từ khóa" },
                  ...keywordOptions.map((kw) => ({ value: kw, label: kw })),
                ]}
              />
            </div>

            <div className="overflow-x-auto rounded-lg border border-[#E2E8F0]">
              <table className="w-full min-w-[1180px] text-left text-xs">
                <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-xs uppercase tracking-[0.3px] text-[#64748B] [&_th]:py-3 [&_th]:font-semibold">
                  <tr>
                    <th className="w-10 px-4 py-2.5">
                      <Checkbox
                        checked={pages.length > 0 && pages.every((p) => selectedPageKeys.includes(p.page_key))}
                        onCheckedChange={(c) => {
                          const pageKeyList = pages.map((p) => p.page_key);
                          const pageKeySet = new Set(pageKeyList);
                          setSelectedPageKeys((prev) =>
                            c
                              ? Array.from(new Set([...prev, ...pageKeyList]))
                              : prev.filter((k) => !pageKeySet.has(k)),
                          );
                        }}
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
                          className={`border-t border-[#F1F5F9] ${selected ? "bg-[#EFF6FF]/60" : "hover:bg-[#F8FAFC]/60"
                            }`}
                        >
                          <td className="px-4 py-3">
                            <Checkbox
                              checked={selected}
                              onCheckedChange={(c) =>
                                setSelectedPageKeys((prev) =>
                                  c ? [...prev, page.page_key] : prev.filter((k) => k !== page.page_key),
                                )
                              }
                            />
                          </td>
                          <td className="px-2 py-3 tabular-nums font-mono text-[#94A3B8]">{String(globalIdx).padStart(2, "0")}</td>
                          <td className="px-3 py-3 font-bold text-[#94A3B8]">{kwLabel}</td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2.5">
                              <Avatar className="size-7">
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
                                  <BadgeCheck className="size-4 shrink-0 fill-[#3B82F6] text-white" />
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
                                className="inline-flex max-w-[200px] items-center gap-1 font-mono text-[#2563EB] hover:underline"
                              >
                                <span className="truncate">
                                  {page.page_url.replace(/^https?:\/\/(m\.|www\.)?facebook\.com\//, "fb.com/")}
                                </span>
                                <ExternalLink className="size-3 shrink-0 text-[#94A3B8]" />
                              </a>
                            ) : (
                              <span className="text-[#CBD5E1]">—</span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            {page.phone ? (
                              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-[#A7F3D0] bg-[#ECFDF5] px-2.5 py-1 font-mono font-bold text-[#047857]">
                                <Phone className="size-3 shrink-0 fill-current" />
                                {page.phone}
                              </span>
                            ) : (
                              <span className="font-sans italic text-[#94A3B8]">Chưa cập nhật</span>
                            )}
                          </td>
                          <td className="px-3 py-3 font-mono text-[#475569]">
                            {page.email || <span className="font-sans italic text-[#94A3B8]">Chưa cập nhật</span>}
                          </td>
                          <td className="px-3 py-3">
                            {page.website ? (
                              <a
                                href={page.website.startsWith("http") ? page.website : `https://${page.website}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-block max-w-[140px] truncate font-medium text-[#2563EB] hover:underline"
                              >
                                {page.website.replace(/^https?:\/\//, "")}
                              </a>
                            ) : (
                              <span className="font-sans italic text-[#94A3B8]">Chưa cập nhật</span>
                            )}
                          </td>
                          <td className="px-3 py-3 font-medium text-[#475569]">
                            {page.address || <span className="font-sans italic text-[#94A3B8]">Chưa cập nhật</span>}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-[#64748B]">
                Hiển thị{" "}
                <b className="text-[#0F172A]">
                  {totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1} -{" "}
                  {Math.min(currentPage * pageSize, totalCount)}
                </b>{" "}
                của <b className="text-[#0F172A]">{totalCount.toLocaleString("vi-VN")}</b> Page
              </span>
              <Pager page={currentPage} totalPages={totalPages} onChange={(p) => applyResultFilters(p)} />
            </div>
          </section>

          <LiveLogConsole task="Quét Page" logs={logs} phase={runPhase} />
        </>
      )}

      {/* Account multi-select modal (Ảnh 2) */}
      <SelectAccountsModal
        open={showAccountModal}
        onClose={() => setShowAccountModal(false)}
        accounts={accounts}
        loading={accountsLoading}
        selectedUids={selectedUids}
        onConfirm={(uids) => {
          setSelectedUids(uids);
          saveSelectedAccountUids("search", uids);
        }}
      />

      {/* Modal xác nhận DỪNG KHẨN CẤP */}
      <EmergencyStopModal
        isOpen={showEmergencyModal}
        onClose={() => setShowEmergencyModal(false)}
        onConfirm={() => guardStop(handleConfirmEmergencyStop)}
        isStopping={isStoppingApi}
      />

      <SavePageListModal
        isOpen={saveListKeys !== null}
        onClose={() => setSaveListKeys(null)}
        pageKeys={saveListKeys || []}
        onSaved={handleListSaved}
      />
    </div>
  );
}
