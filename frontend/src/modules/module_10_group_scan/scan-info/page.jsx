"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, FileText, Loader2, Trash2, CloudUpload, X, Activity, Users } from "lucide-react";
import { toast } from "@/lib/toast";
import { Checkbox } from "@/components/ui/checkbox";
import CustomSelect from "@/components/ui/custom-select";
import AccountSelectModal, { isScanReady } from "../components/AccountSelectModal";
import SaveSharedGroupModal from "../components/SaveSharedGroupModal";
import {
  IconClose,
  IconDownload,
  IconExternal,
  IconInfo,
  IconLink,
  IconPause,
  IconPlay,
  IconProgress,
  IconSearch,
  IconStop,
  IconTags,
  IconUpload,
  IconUsers,
} from "../components/icons";
import {
  clearKeywordCheck,
  controlScanJob,
  createScanCategory,
  getCheckStatus,
  getScanAccounts,
  lookupKeywords,
  startGroupScan,
} from "../service";

const RESULT_TYPE_OPTIONS = [
  { value: "all", label: "Loại nhóm: Tất cả" },
  { value: "public", label: "Công khai" },
  { value: "private", label: "Riêng tư" },
];

const RESULT_MEMBERS_OPTIONS = [
  { value: "all", label: "Thành viên: Tất cả" },
  { value: "under50k", label: "Dưới 50.000" },
  { value: "50k_200k", label: "50.000 - 200.000" },
  { value: "over200k", label: "Trên 200.000" },
];

const RESULT_NOTE_OPTIONS = [
  { value: "all", label: "Ghi chú: Tất cả" },
  { value: "not_joined", label: "Chưa vào nhóm" },
  { value: "joined", label: "Đã tham gia" },
  { value: "pending", label: "Đang chờ QTV duyệt" },
];

const METHOD_TABS = [
  { id: "keyword", label: "Theo từ khóa", Icon: IconTags },
  { id: "link", label: "Nhập Link", Icon: IconLink },
  { id: "file", label: "Tải tệp (.txt / .csv / .excel)", Icon: IconUpload },
];

const KEYWORD_STATS_SEED = {};

const inputClass =
  "h-8 rounded-lg border border-[#E2E8F0] bg-white px-2 text-center text-xs font-bold text-[#0F172A] outline-none focus:border-[#2563EB] disabled:bg-slate-100";

function normalizeAccount(raw) {
  const status = String(raw.status || "").toLowerCase();
  let login = String(raw.login_status || "").toLowerCase();
  if (login === "success") login = "logged_in";
  if (!login && String(raw.login_status || "").toUpperCase() === "LOGGED_IN") login = "logged_in";
  return {
    ...raw,
    uid: String(raw.uid || ""),
    profile_name: raw.profile_name || raw.name || "",
    email: raw.email || raw.mail || "",
    status: status === "live" || status === "die" ? status : status || "unknown",
    login_status: login || "not_logged_in",
  };
}

/** So khớp từ khóa không phân biệt hoa/thường (vi). */
function keywordKey(text) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("vi");
}

function parseKeywords(text) {
  const out = [];
  const seen = new Set();
  String(text || "")
    .split(/[,;\n]+/)
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .forEach((word) => {
      const key = keywordKey(word);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(word);
    });
  return out.slice(0, 30);
}

function mergeKeywords(current, next) {
  const map = new Map();
  [...(current || []), ...(next || [])].forEach((word) => {
    const w = String(word || "").trim().replace(/\s+/g, " ");
    const key = keywordKey(w);
    if (!key || map.has(key)) return;
    map.set(key, w);
  });
  return [...map.values()].slice(0, 30);
}

function TypeBadge({ type }) {
  if (type === "private") {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-[#F3E8FF] px-2.5 py-0.5 text-[10px] font-semibold text-[#7C3AED]">
        Riêng tư
      </span>
    );
  }
  return (
    <span className="inline-flex whitespace-nowrap rounded-full bg-[#DCFCE7] px-2.5 py-0.5 text-[10px] font-semibold text-[#15803D]">
      Công khai
    </span>
  );
}

function NoteBadge({ note }) {
  if (note === "joined") {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-[#DBEAFE] px-2 py-0.5 text-[10px] font-semibold text-[#1D4ED8]">
        Đã tham gia
      </span>
    );
  }
  if (note === "pending") {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-[#FFEDD5] px-2 py-0.5 text-[10px] font-semibold text-[#C2410C]">
        Đang chờ QTV duyệt
      </span>
    );
  }
  if (note === "not_joined" || note === "Chưa vào nhóm") {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-[#FEE2E2] px-2 py-0.5 text-[10px] font-semibold text-[#B91C1C]">
        Chưa vào nhóm
      </span>
    );
  }
  return <span className="text-[11px] text-[#94A3B8]">{note || "—"}</span>;
}

function mapGroupRow(g) {
  const type = g?.type === "private" ? "private" : g?.type === "public" ? "public" : g?.type || "unknown";
  let note = g?.note || "—";
  if (type === "private" && (!note || note === "—")) note = "not_joined";
  let members = g?.members || "";
  let membersCount = Number(g?.members_count) || 0;
  if ((!members || members === "—") && g?.members_count != null) {
    const n = Number(g.members_count);
    if (Number.isFinite(n)) {
      if (n >= 1_000_000) members = `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
      else if (n >= 1_000) members = `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
      else members = String(n);
    }
  } else if (!membersCount && members) {
    const str = String(members).trim().toUpperCase();
    if (str.endsWith("M")) {
      membersCount = parseFloat(str.replace("M", "").replace(",", ".")) * 1_000_000;
    } else if (str.endsWith("K")) {
      membersCount = parseFloat(str.replace("K", "").replace(",", ".")) * 1_000;
    } else {
      membersCount = parseInt(str.replace(/[^0-9]/g, ""), 10) || 0;
    }
  }
  let name = String(g?.name || "")
    .replace(/^(Profile photo of|Ảnh đại diện của)\s*/i, "")
    .trim();
  return {
    id: g.id || g.href || g.url,
    keyword: g.keyword || "",
    name: name || g.name || "",
    type: type === "unknown" ? "public" : type,
    members: members || "—",
    membersCount,
    url: g.url || String(g.href || "").replace(/^https?:\/\/(www\.)?/, ""),
    href: g.href || "",
    note,
  };
}

function KeywordStatusBadge({ status }) {
  if (status === "done") {
    return (
      <span className="inline-flex rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[10px] font-semibold text-[#15803D]">
        Hoàn thành
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="inline-flex rounded-full bg-[#FFEDD5] px-2 py-0.5 text-[10px] font-semibold text-[#C2410C]">
        Đang quét
      </span>
    );
  }
  if (status === "paused") {
    return (
      <span className="inline-flex rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[10px] font-semibold text-[#B45309]">
        Tạm dừng
      </span>
    );
  }
  if (status === "ready") {
    return (
      <span className="inline-flex rounded-full bg-[#DBEAFE] px-2 py-0.5 text-[10px] font-semibold text-[#1D4ED8]">
        Sẵn sàng
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
      Chờ quét
    </span>
  );
}

export default function GroupScanInfoPage() {
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [selectedUids, setSelectedUids] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);

  const [method, setMethod] = useState("keyword");
  const [keywordInput, setKeywordInput] = useState("");
  const [keywords, setKeywords] = useState([]);
  const [quotas, setQuotas] = useState({});

  // Tab Nhập Link (Ảnh 1) — không dùng mock
  const [linkText, setLinkText] = useState("");
  const [parsedLinks, setParsedLinks] = useState([]);
  const [linkQuotas, setLinkQuotas] = useState({});

  // Tab Tải tệp (Ảnh 2) — không dùng mock
  const [fileData, setFileData] = useState(null);
  const [fileQuotas, setFileQuotas] = useState({});
  const [fileFilter, setFileFilter] = useState("all"); // all | valid | duplicate

  const [rotateAfter, setRotateAfter] = useState(50);
  const [delayMin, setDelayMin] = useState(5);
  const [delayMax, setDelayMax] = useState(10);
  const [publicOnly, setPublicOnly] = useState(false);
  const [privateOnly, setPrivateOnly] = useState(false);
  const [minMembers, setMinMembers] = useState(1000);
  const [minMembersEnabled, setMinMembersEnabled] = useState(true);

  const [runState, setRunState] = useState("idle"); // idle | running | paused
  const [checkJobId, setCheckJobId] = useState("");
  const running = runState === "running" || runState === "paused";
  const [resultQuery, setResultQuery] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterMembers, setFilterMembers] = useState("all");
  const [filterKeyword, setFilterKeyword] = useState("all");
  const [filterNote, setFilterNote] = useState("all");
  const [results, setResults] = useState([]);
  const [keywordStats, setKeywordStats] = useState(() => ({ ...KEYWORD_STATS_SEED }));
  const [selectedRows, setSelectedRows] = useState(() => new Set());
  const [logs, setLogs] = useState([
    {
      time: "—",
      thread: "System",
      text: "Module 10 sẵn sàng. Kiểm tra → điền bảng từ khóa. Bắt đầu thực thi → mở Chrome quét.",
      tone: "info",
    },
  ]);

  // Dọn dẹp cache cũ khi mở trang để luôn phản ánh dữ liệu thực từ CSDL
  useEffect(() => {
    try {
      localStorage.removeItem("fb_scan_info_active_results");
      localStorage.removeItem("fb_scanned_groups_cache");
      localStorage.removeItem("fb_scanned_sessions_cache");
    } catch {}
  }, []);

  const pushLog = useCallback((text, tone = "info") => {
    const time = new Date().toLocaleTimeString("vi-VN", { hour12: false });
    setLogs((current) => [...current.slice(-120), { time, thread: "Thread-01", text, tone }]);
  }, []);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const data = await getScanAccounts();
      const rows = (Array.isArray(data) ? data : data?.accounts || []).map(normalizeAccount);
      setAccounts(rows);
      setSelectedUids((current) => {
        const ready = new Set(rows.filter(isScanReady).map((acc) => acc.uid));
        const kept = current.filter((uid) => ready.has(uid));
        if (kept.length) return kept;
        return rows.filter(isScanReady).slice(0, 5).map((acc) => acc.uid);
      });
    } catch (error) {
      toast.error(error.message || "Không tải được tài khoản Module 2.");
      setAccounts([]);
      setSelectedUids([]);
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    setQuotas((current) => {
      const next = {};
      const keys = new Set(keywords.map(keywordKey));
      // Giữ hạn mức theo key không phân biệt hoa/thường
      keywords.forEach((word) => {
        const k = keywordKey(word);
        const prev =
          current[word] ??
          Object.entries(current).find(([label]) => keywordKey(label) === k)?.[1];
        next[word] = prev != null ? prev : 30;
      });
      Object.keys(current).forEach((label) => {
        if (!keys.has(keywordKey(label)) && keywords.includes(label)) {
          next[label] = current[label];
        }
      });
      return next;
    });
    setKeywordStats((current) => {
      const next = {};
      keywords.forEach((word) => {
        const k = keywordKey(word);
        const prev =
          current[word] ||
          Object.entries(current).find(([label]) => keywordKey(label) === k)?.[1];
        next[word] = prev || { count: "—", status: "idle" };
      });
      return next;
    });
  }, [keywords]);

  const selectedAccounts = useMemo(
    () => accounts.filter((acc) => selectedUids.includes(acc.uid)),
    [accounts, selectedUids],
  );

  const commitKeywords = (raw, { quiet = false } = {}) => {
    const next = parseKeywords(raw);
    if (!next.length) {
      if (!quiet) toast.warning("Nhập ít nhất một từ khóa.");
      return [];
    }
    const existingKeys = new Set(keywords.map(keywordKey));
    const added = next.filter((word) => !existingKeys.has(keywordKey(word)));
    setKeywords((current) => mergeKeywords(current, next));
    setKeywordInput("");
    if (!quiet && added.length) {
      toast.success(
        added.length === 1 ? `Đã thêm từ khóa «${added[0]}».` : `Đã thêm ${added.length} từ khóa.`,
      );
    } else if (!quiet && next.length && !added.length) {
      toast.info("Từ khóa này đã có (không phân biệt hoa/thường).");
    }
    return next;
  };

  const addKeywords = () => {
    commitKeywords(keywordInput);
  };

  const removeKeyword = (word) => {
    setKeywords((current) => current.filter((item) => item !== word));
  };

  // Handler Phương thức Nhập Link (Ảnh 1)
  const handleClearAllLinks = () => {
    setLinkText("");
    setParsedLinks([]);
    toast.info("Đã xóa toàn bộ liên kết.");
  };

  const handleCheckAndDeduplicateLinks = () => {
    const lines = linkText
      .split(/[\r\n]+/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) {
      toast.warning("Vui lòng nhập ít nhất 1 liên kết Facebook.");
      return;
    }
    const seen = new Set();
    const list = [];
    lines.forEach((line) => {
      let clean = line;
      if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
        clean = `https://${clean}`;
      }
      const key = clean.toLowerCase().replace(/\/+$/, "");
      if (seen.has(key)) return;
      seen.add(key);
      list.push({
        id: `link-${list.length + 1}`,
        stt: list.length + 1,
        url: clean,
        raw: line,
        status: "valid",
      });
    });
    setParsedLinks(list);
    setLinkQuotas((current) => {
      const next = { ...current };
      list.forEach((item) => {
        if (next[item.url] == null) next[item.url] = 30;
      });
      return next;
    });
    toast.success(`Đã nhận diện và lọc trùng ${list.length} liên kết hợp lệ!`);
  };

  const handleRemoveLink = (id) => {
    setParsedLinks((curr) => {
      const next = curr.filter((l) => l.id !== id).map((l, idx) => ({ ...l, stt: idx + 1 }));
      setLinkText(next.map((l) => l.url).join("\n"));
      return next;
    });
  };

  // Handler Phương thức Tải tệp (Ảnh 2)
  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const name = file.name;
      const ext = name.split(".").pop()?.toLowerCase();
      let rawLines = [];
      if (ext === "xlsx" || ext === "xls") {
        const XLSX = await import("xlsx");
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        json.forEach((row) => {
          if (Array.isArray(row)) {
            row.forEach((cell) => {
              const text = String(cell || "").trim();
              if (text && !text.startsWith("#") && !/^(stt|tên|link|nhóm|keyword|group)/i.test(text)) {
                rawLines.push(text);
              }
            });
          }
        });
      } else {
        const text = await file.text();
        rawLines = text
          .split(/[\r\n]+/)
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#"));
      }

      const seen = new Set();
      const rows = [];
      let validCount = 0;
      let dupCount = 0;

      rawLines.forEach((line, idx) => {
        const norm = line.toLowerCase().replace(/\/+$/, "");
        if (seen.has(norm)) {
          dupCount += 1;
          rows.push({
            id: `f-${idx + 1}`,
            line: idx + 1,
            raw: line,
            status: "duplicate",
          });
        } else {
          seen.add(norm);
          validCount += 1;
          rows.push({
            id: `f-${idx + 1}`,
            line: idx + 1,
            raw: line,
            status: "valid",
          });
        }
      });

      const sizeStr = (file.size / 1024).toFixed(1) + " KB";
      setFileData({
        fileName: name,
        fileSize: sizeStr,
        totalCount: rows.length,
        validCount,
        dupCount,
        rows,
      });
      setFileQuotas((current) => {
        const next = { ...current };
        rows.forEach((item) => {
          if (item.status === "valid" && next[item.raw] == null) next[item.raw] = 30;
        });
        return next;
      });
      toast.success(`Đã nhận diện tệp ${name}: ${validCount} dòng hợp lệ, ${dupCount} trùng lặp.`);
    } catch (err) {
      console.error(err);
      toast.error("Lỗi đọc tệp: " + (err.message || "Định dạng không hỗ trợ"));
    } finally {
      event.target.value = "";
    }
  };

  const displayedFileRows = useMemo(() => {
    if (!fileData?.rows) return [];
    if (fileFilter === "valid") return fileData.rows.filter((r) => r.status === "valid");
    if (fileFilter === "duplicate") return fileData.rows.filter((r) => r.status === "duplicate");
    return fileData.rows;
  }, [fileData, fileFilter]);

  const validFileRows = useMemo(
    () => (fileData?.rows || []).filter((r) => r.status === "valid"),
    [fileData],
  );

  /** Kiểm tra = đọc DB: số nhóm đã quét / từ khóa + fill bảng kết quả (không mở Chrome). */
  const runKeywordCheck = async () => {
    const committed = keywordInput.trim() ? commitKeywords(keywordInput, { quiet: true }) : [];
    const wordList = mergeKeywords(keywords, committed);
    if (!wordList.length) {
      toast.warning("Nhập / thêm ít nhất một từ khóa rồi bấm Kiểm tra.");
      return;
    }

    try {
      const res = await lookupKeywords(wordList, { includeGroups: true });
      const stats = res?.keyword_stats || {};
      setKeywordStats((current) => {
        const next = { ...current };
        wordList.forEach((word) => {
          const row = stats[word] || {};
          const n = Number(row.count) || 0;
          next[word] = {
            count: n > 0 ? String(n) : "—",
            status: n > 0 ? "done" : "ready",
          };
        });
        return next;
      });

      const groups = Array.isArray(res?.groups) ? res.groups : [];
      setResults(groups.map(mapGroupRow));

      toast.success(res?.message || `Đã kiểm tra ${wordList.length} từ khóa từ DB.`);
      pushLog(res?.message || `Kiểm tra DB: ${wordList.length} từ khóa.`, "success");
      wordList.forEach((word) => {
        const n = Number(stats[word]?.count) || 0;
        pushLog(
          n > 0 ? `  «${word}»: đã lưu ${n} nhóm.` : `  «${word}»: chưa có nhóm trong DB.`,
          n > 0 ? "success" : "info",
        );
      });
    } catch (error) {
      toast.error(error.message || "Không đọc được dữ liệu từ khóa từ DB.");
      pushLog(error.message || "Kiểm tra DB thất bại.", "error");
    }
  };

  const buildScanBody = (wordList = []) => {
    let payloadKeywords = [];
    if (method === "keyword") {
      payloadKeywords = wordList.map((word) => ({
        keyword: word,
        limit: Math.max(1, Math.min(200, Number(quotas[word]) || 30)),
      }));
    } else if (method === "link") {
      payloadKeywords = (parsedLinks || []).map((l) => ({
        keyword: l.url,
        limit: Math.max(1, Math.min(200, Number(linkQuotas[l.url]) || 30)),
      }));
    } else if (method === "file") {
      const validRows = (fileData?.rows || []).filter((r) => r.status === "valid");
      payloadKeywords = validRows.map((r) => ({
        keyword: r.raw,
        limit: Math.max(1, Math.min(200, Number(fileQuotas[r.raw]) || 30)),
      }));
    }

    const firstWord = payloadKeywords[0]?.keyword || "";
    return {
      uid: selectedUids[0],
      keyword: firstWord,
      keywords: payloadKeywords,
      delay_min: Math.max(0, Number(delayMin) || 0),
      delay_max: Math.max(Number(delayMin) || 0, Number(delayMax) || 0),
      // Cả hai tick (hoặc không tick) = Public + Private; chỉ tick 1 = lọc đúng loại đó
      public_only: Boolean(publicOnly),
      private_only: Boolean(privateOnly),
      min_members: minMembersEnabled ? Math.max(0, Number(minMembers) || 0) : null,
      force: true,
    };
  };

  // Poll log + nhóm trong lúc job chạy
  useEffect(() => {
    if (!running || !checkJobId) return undefined;
    let stopped = false;
    let lastLogCount = 0;
    let finishedNotified = false;
    let timer;

    const tick = async () => {
      try {
        const status = await getCheckStatus({
          jobId: checkJobId || undefined,
          uid: selectedUids[0] || undefined,
        });
        if (stopped || !status) return;

        const remoteLogs = Array.isArray(status.logs) ? status.logs : [];
        if (remoteLogs.length > lastLogCount) {
          const fresh = remoteLogs.slice(lastLogCount);
          lastLogCount = remoteLogs.length;
          setLogs((current) => [...current, ...fresh].slice(-150));
        }

        const groups = Array.isArray(status.groups) ? status.groups : [];
        if (groups.length) {
          const mapped = groups.map(mapGroupRow);
          setResults(mapped);
        }

        const remoteStats = status.keyword_stats && typeof status.keyword_stats === "object"
          ? status.keyword_stats
          : null;
        if (remoteStats) {
          setKeywordStats((current) => {
            const next = { ...current };
            Object.entries(remoteStats).forEach(([word, row]) => {
              let st = "idle";
              if (row?.status === "running") st = "running";
              else if (row?.status === "done") st = "done";
              else if (status.status === "paused" && row?.status === "idle") st = "paused";
              next[word] = {
                count: String(row?.count ?? (st === "running" ? "…" : "—")),
                status: st,
              };
            });
            return next;
          });
        }

        if (status.status === "paused") {
          setRunState("paused");
          if (!finishedNotified) {
            finishedNotified = true;
            toast.info("Đã tạm dừng sau từ khóa hiện tại.");
          }
          if (timer) clearInterval(timer);
          return;
        }

        if (status.status === "done" || status.status === "error" || status.status === "aborted") {
          if (!finishedNotified) {
            finishedNotified = true;
            if (status.status === "done") {
              toast.success(`Đã quét ${groups.length} nhóm (${(status.keywords || []).length || 1} từ khóa).`);
            } else if (status.status === "aborted") {
              toast.warning(status.error || "Đã dừng khẩn cấp.");
            } else if (status.error) {
              toast.error(status.error);
            }
          }
          setRunState("idle");
          if (timer) clearInterval(timer);
        }
      } catch {
        /* poll im lặng */
      }
    };

    tick();
    timer = setInterval(tick, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [checkJobId, running, selectedUids]);

  const startRun = async () => {
    if (runState === "running") {
      toast.info("Đang quét — dùng Tạm dừng / Dừng khẩn cấp nếu cần.");
      return;
    }
    if (!selectedUids.length) {
      toast.warning("Chọn ít nhất 1 tài khoản đã đăng nhập từ Module 2.");
      setPickerOpen(true);
      return;
    }
    const committed = keywordInput.trim() ? commitKeywords(keywordInput, { quiet: true }) : [];
    const wordList = mergeKeywords(keywords, committed);
    if (method === "keyword" && !wordList.length) {
      toast.warning("Thêm ít nhất một từ khóa, bấm Kiểm tra rồi Bắt đầu thực thi.");
      return;
    }
    if (method === "link" && (!parsedLinks || !parsedLinks.length)) {
      toast.warning("Vui lòng nhập danh sách liên kết và bấm Kiểm tra & Lọc trùng lặp.");
      return;
    }
    if (method === "file") {
      const validRows = (fileData?.rows || []).filter((r) => r.status === "valid");
      if (!validRows.length) {
        toast.warning("Vui lòng tải tệp danh sách nhóm trước khi bắt đầu.");
        return;
      }
    }

    // CHỈ XÓA KẾT QUẢ CŨ KHI BẮT ĐẦU CHẠY CÁI MỚI!
    setResults([]);
    setSelectedRows(new Set());
    try {
      localStorage.removeItem("fb_scan_info_active_results");
    } catch {}

    const uid = selectedUids[0];
    const body = buildScanBody(wordList);
    setRunState("running");
    if (method === "keyword") {
      // Tự động tạo mỗi từ khóa thành 1 danh mục trong scanned_group_categories ngay khi bắt đầu thực thi
      try {
        await Promise.all(
          wordList.map((word) =>
            createScanCategory(word, `Danh mục từ khóa: ${word}`).catch(() => null)
          )
        );
      } catch (err) {
        console.warn("[Group Scan] auto create categories on startRun:", err);
      }

      setKeywordStats((current) => {
        const next = { ...current };
        wordList.forEach((word, idx) => {
          next[word] = { count: "…", status: idx === 0 ? "running" : "idle" };
        });
        return next;
      });
      pushLog(
        `Bắt đầu thực thi: nick ${uid}, ${wordList.length} từ khóa (limit + delay + bộ lọc)…`,
        "info",
      );
    } else if (method === "link") {
      pushLog(
        `Bắt đầu thực thi quét liên kết: nick ${uid}, ${parsedLinks.length} link nhóm Facebook…`,
        "info",
      );
    } else {
      const validCnt = (fileData?.rows || []).filter((r) => r.status === "valid").length;
      pushLog(
        `Bắt đầu thực thi quét theo tệp: nick ${uid}, ${validCnt} mục từ ${fileData?.fileName || "tệp"}…`,
        "info",
      );
    }

    try {
      let res;
      try {
        res = await startGroupScan(body);
      } catch (firstError) {
        if (firstError?.status === 409 || /đang chạy/i.test(firstError?.message || "")) {
          pushLog("Job cũ còn khóa — đang gỡ rồi chạy lại…", "warn");
          await clearKeywordCheck(uid).catch(() => {});
          res = await startGroupScan(body);
        } else {
          throw firstError;
        }
      }
      setCheckJobId(res?.job_id || "");
      if (res?.scan_version !== 2) {
        toast.warning(
          "Engine chưa chạy bản scan-v2 (limit + nhiều từ khóa). Hãy restart Engine rồi quét lại.",
        );
        pushLog("⚠️ API không trả scan_version=2 — Engine có thể còn code cũ (hardcode 30 nhóm).", "warn");
      }
      const lim = res?.keyword_limits
        ? Object.entries(res.keyword_limits)
            .map(([k, v]) => `«${k}»×${v}`)
            .join(", ")
        : "";
      toast.success(res?.message || `Đang quét ${wordList.length} từ khóa.`);
      pushLog(
        (res?.message || `Đã bắt đầu quét nick ${uid}.`) + (lim ? ` Hạn mức: ${lim}` : ""),
        "success",
      );
    } catch (error) {
      toast.error(error.message || "Không bắt đầu được phiên quét.");
      pushLog(error.message || "Bắt đầu thực thi thất bại.", "error");
      setKeywordStats((current) => {
        const next = { ...current };
        wordList.forEach((word) => {
          next[word] = { count: current[word]?.count || "—", status: "ready" };
        });
        return next;
      });
      setRunState("idle");
    }
  };

  const pauseRun = async () => {
    if (!checkJobId || runState !== "running") return;
    try {
      const res = await controlScanJob({ jobId: checkJobId, action: "pause" });
      setRunState("paused");
      toast.info(res?.message || "Sẽ tạm dừng sau khi xong từ khóa hiện tại.");
      pushLog(res?.message || "Đã gửi lệnh tạm dừng.", "warn");
    } catch (error) {
      toast.error(error.message || "Không tạm dừng được.");
    }
  };

  const abortRun = async () => {
    if (!checkJobId || (runState !== "running" && runState !== "paused")) return;
    try {
      const res = await controlScanJob({ jobId: checkJobId, action: "abort" });
      toast.warning(res?.message || "Đang dừng khẩn cấp…");
      pushLog(res?.message || "Đã gửi dừng khẩn cấp.", "warn");
    } catch (error) {
      toast.error(error.message || "Không dừng được.");
    }
  };

  const keywordOptions = useMemo(() => {
    const set = new Set();
    results.forEach((r) => {
      if (r.keyword && String(r.keyword).trim()) {
        set.add(String(r.keyword).trim());
      }
    });
    keywords.forEach((k) => {
      if (k && String(k).trim()) {
        set.add(String(k).trim());
      }
    });
    const list = Array.from(set);
    return [
      { value: "all", label: "Từ khóa: Tất cả" },
      ...list.map((kw) => ({ value: kw, label: kw })),
    ];
  }, [results, keywords]);

  const filteredResults = useMemo(() => {
    const q = resultQuery.trim().toLowerCase();
    return results.filter((row) => {
      if (filterType !== "all" && row.type !== filterType) return false;
      if (filterMembers !== "all") {
        const count = row.membersCount || 0;
        if (filterMembers === "under50k" && count >= 50000) return false;
        if (filterMembers === "50k_200k" && (count < 50000 || count > 200000)) return false;
        if (filterMembers === "over200k" && count <= 200000) return false;
      }
      if (filterKeyword !== "all") {
        const kw = String(row.keyword || "").trim().toLowerCase();
        if (kw !== filterKeyword.trim().toLowerCase()) return false;
      }
      if (filterNote !== "all" && row.note !== filterNote) return false;
      if (!q) return true;
      return `${row.name || ""} ${row.url || ""} ${row.keyword || ""}`.toLowerCase().includes(q);
    });
  }, [results, resultQuery, filterType, filterMembers, filterKeyword, filterNote]);

  const exportExcel = async () => {
    const rows = selectedRows.size
      ? filteredResults.filter((row) => selectedRows.has(row.id))
      : filteredResults;
    if (!rows.length) {
      toast.warning("Chưa có nhóm để xuất. Quét hoặc chọn dòng trước.");
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const typeLabel = (t) => (t === "private" ? "Riêng tư" : "Công khai");
      const noteLabel = (n) => {
        if (n === "not_joined" || n === "Chưa vào nhóm") return "Chưa vào nhóm";
        if (n === "joined") return "Đã tham gia";
        if (n === "pending") return "Đang chờ QTV duyệt";
        return n && n !== "—" ? n : "";
      };
      const data = [
        ["STT", "Từ khóa", "Tên nhóm", "Loại nhóm", "Thành viên", "URL nhóm", "Ghi chú"],
        ...rows.map((row, index) => [
          index + 1,
          row.keyword || "",
          row.name || "",
          typeLabel(row.type),
          row.members || "",
          row.href || (row.url ? `https://${String(row.url).replace(/^https?:\/\//, "")}` : ""),
          noteLabel(row.note),
        ]),
      ];
      const sheet = XLSX.utils.aoa_to_sheet(data);
      sheet["!cols"] = [
        { wch: 6 },
        { wch: 22 },
        { wch: 36 },
        { wch: 12 },
        { wch: 12 },
        { wch: 48 },
        { wch: 16 },
      ];
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, "Ket qua quet");
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(book, `quet_nhom_${stamp}.xlsx`);
      toast.success(`Đã xuất Excel ${rows.length} nhóm.`);
      pushLog(`Xuất Excel: ${rows.length} nhóm → quet_nhom_${stamp}.xlsx`, "success");
    } catch (error) {
      toast.error(error.message || "Xuất Excel thất bại.");
    }
  };

  const allVisibleSelected =
    filteredResults.length > 0 && filteredResults.every((row) => selectedRows.has(row.id));

  const toggleAllRows = (checked) => {
    setSelectedRows((current) => {
      const next = new Set(current);
      filteredResults.forEach((row) => {
        if (checked) next.add(row.id);
        else next.delete(row.id);
      });
      return next;
    });
  };

  const logTone = (tone) => {
    if (tone === "success") return "text-emerald-400";
    if (tone === "warn") return "text-amber-400";
    if (tone === "error") return "text-rose-400";
    return "text-slate-200";
  };

  return (
    <>
      {/* Ẩn nút mũi tên tăng giảm số chỉ cho riêng Module 10 */}
      <style>{`
        input[type="number"]::-webkit-inner-spin-button,
        input[type="number"]::-webkit-outer-spin-button {
          -webkit-appearance: none !important;
          margin: 0 !important;
        }
        input[type="number"] {
          -moz-appearance: textfield !important;
          appearance: textfield !important;
        }
      `}</style>
      <div className="-m-6 min-h-full space-y-5 bg-[#F4F7FC] p-6">
        <div className="grid items-stretch gap-5 xl:grid-cols-2">
          {/* (1) Tài khoản + phương thức */}
          <section className="flex flex-col h-full rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-2.5 pb-3 mb-4 border-b border-[#F1F5F9]">
              <span className="flex size-6 items-center justify-center rounded-full bg-[#2563EB] text-[11px] font-bold text-white shrink-0">
                1
              </span>
              <h2 className="text-sm font-bold text-[#0B1C30]">Chọn tài khoản & Thiết lập phiên quét</h2>
            </div>

          <div className="space-y-2 mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#475569]">
              TÀI KHOẢN FACEBOOK THỰC THI:
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#1877F2] px-3.5 text-xs font-semibold text-white hover:bg-blue-600 transition-colors shadow-sm"
              >
                <Users className="size-3.5 shrink-0" />
                <span>Chọn tài khoản</span>
              </button>

              <div
                title={selectedAccounts.map((a) => a.profile_name || a.uid).join(", ")}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-3 text-xs font-medium text-[#059669] cursor-help"
              >
                <span className="size-1.5 rounded-full bg-[#10B981] shrink-0" />
                <span>
                  Đã chọn:{" "}
                  <strong className="text-emerald-950 font-bold">
                    {accountsLoading ? "..." : `${selectedAccounts.length} / ${accounts.length}`}
                  </strong>{" "}
                  tài khoản
                </span>
              </div>
              {accountsLoading ? <Loader2 className="size-3.5 animate-spin text-slate-400" /> : null}
            </div>
          </div>

          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">
            Phương thức quét
          </p>
          <div className="mb-4 flex flex-wrap gap-2">
            {METHOD_TABS.map((tab) => {
              const { Icon } = tab;
              const active = method === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setMethod(tab.id)}
                  className={`inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-xs font-bold transition-all shadow-xs ${
                    active
                      ? "bg-[#2563EB] text-white shadow-sm"
                      : "border border-[#E2E8F0] bg-white text-[#475569] hover:bg-slate-50 font-medium"
                  }`}
                >
                  <Icon color={active ? "#ffffff" : "#475569"} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {method === "keyword" ? (
            <div className="flex-1 flex flex-col min-h-0 space-y-3">
              <div className="space-y-2 shrink-0">
                {/* Thanh nhập từ khóa cố định 1 dòng theo yêu cầu */}
                <div className="flex items-center gap-2 h-10 rounded-lg border border-[#CBD5E1] bg-[#F8FAFC] px-3 shadow-2xs shrink-0 focus-within:border-[#2563EB] focus-within:bg-white focus-within:ring-1 focus-within:ring-[#2563EB] transition-all">
                  <input
                    value={keywordInput}
                    onChange={(event) => {
                      const value = event.target.value;
                      // Gõ dấu phẩy / chấm phẩy → chốt thành tag ngay
                      if (/[,;\n]/.test(value) && /[,;\n]\s*$/.test(value)) {
                        commitKeywords(value, { quiet: false });
                        return;
                      }
                      setKeywordInput(value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addKeywords();
                      }
                    }}
                    onBlur={() => {
                      if (keywordInput.trim()) commitKeywords(keywordInput, { quiet: true });
                    }}
                    placeholder="VD: marketing — Enter hoặc dấu phẩy để thêm"
                    className="flex-1 bg-transparent text-xs text-[#0F172A] outline-none placeholder:text-[#94A3B8]"
                  />
                  <button
                    type="button"
                    onClick={addKeywords}
                    className="inline-flex h-7 items-center rounded-md border border-[#CBD5E1] bg-white px-3 text-[11px] font-semibold text-[#0F172A] hover:bg-slate-50 shrink-0 shadow-2xs transition-colors"
                  >
                    Thêm
                  </button>
                  <button
                    type="button"
                    onClick={runKeywordCheck}
                    disabled={running}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[#2563EB] px-3 text-[11px] font-bold text-white hover:bg-blue-600 disabled:opacity-60 shrink-0 shadow-2xs transition-colors"
                  >
                    Kiểm tra
                  </button>
                </div>

                {/* Danh sách thẻ từ khóa đã thêm (hiển thị riêng biệt bên dưới thanh nhập cố định) */}
                {keywords.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 max-h-[58px] overflow-y-auto pr-1">
                    {keywords.map((word) => (
                      <span
                        key={word}
                        className="inline-flex items-center gap-1 rounded-md border border-[#BFDBFE] bg-white px-2 py-0.5 text-[11px] font-medium text-[#0F172A] shadow-2xs"
                      >
                        {word}
                        <button
                          type="button"
                          onClick={() => removeKeyword(word)}
                          className="rounded p-0.5 text-[#94A3B8] hover:bg-slate-100 hover:text-rose-600 transition-colors"
                          aria-label={`Xóa ${word}`}
                        >
                          <IconClose />
                        </button>
                      </span>
                    ))}
                    <button
                      type="button"
                      onClick={() => setKeywords([])}
                      className="text-[10px] text-rose-500 hover:underline font-medium ml-1"
                    >
                      Xóa tất cả
                    </button>
                  </div>
                )}

                <div className="flex items-center justify-between px-0.5">
                  <p className="text-[11px] text-[#94A3B8]">
                    {keywords.length
                      ? `Đã thêm ${keywords.length} từ khóa. Bấm Kiểm tra để điền bảng bên dưới.`
                      : "Nhập xong Enter / Thêm / dấu phẩy → thẻ. Kiểm tra = xác nhận vào bảng."}
                  </p>
                  {keywords.length > 5 && (
                    <span className="text-[10px] text-blue-600 font-medium shrink-0 ml-2">
                      Cuộn để xem thêm ({keywords.length} mục)
                    </span>
                  )}
                </div>
              </div>

              {/* Bảng Từ khóa: Cuộn xuống khi dài, thead cố định, chiều cao giới hạn */}
              <div className="flex-1 min-h-[140px] max-h-[260px] overflow-y-auto rounded-lg border border-[#E2E8F0] shadow-2xs">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 z-10 bg-[#F8FAFC] border-b border-[#E2E8F0] text-[10px] font-bold uppercase tracking-wide text-[#64748B]">
                    <tr>
                      <th className="px-3 py-2.5 bg-[#F8FAFC]">Từ khóa</th>
                      <th className="px-3 py-2.5 bg-[#F8FAFC]">Số nhóm quét được</th>
                      <th className="px-3 py-2.5 bg-[#F8FAFC]">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9]">
                    {keywords.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-3 py-6 text-center text-[#94A3B8]">
                          Chưa có từ khóa.
                        </td>
                      </tr>
                    ) : (
                      keywords.map((word) => {
                        const stat = keywordStats[word] || { count: "—", status: "idle" };
                        return (
                          <tr key={word} className="hover:bg-slate-50/60 transition-colors">
                            <td className="px-3 py-2.5 font-medium text-[#0F172A]">{word}</td>
                            <td className="px-3 py-2.5 tabular-nums text-[#64748B]">{stat.count}</td>
                            <td className="px-3 py-2.5">
                              <KeywordStatusBadge status={stat.status} />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* Phương thức Nhập Link — Thiết kế theo đúng Ảnh 1 */}
          {method === "link" ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#0F172A]">Dán danh sách liên kết Group Facebook</span>
                <span className="inline-flex items-center rounded-lg bg-[#EFF6FF] px-2.5 py-1 text-xs font-semibold text-[#2563EB]">
                  Đã nhận diện: {parsedLinks.length} link
                </span>
              </div>

              <textarea
                value={linkText}
                onChange={(event) => setLinkText(event.target.value)}
                rows={7}
                placeholder={`https://www.facebook.com/groups/109283749210\nhttps://facebook.com/groups/congdongmarketingvn\nhttps://www.facebook.com/groups/kinhdoanhonline99`}
                className="w-full rounded-xl border border-[#CBD5E1] bg-white p-3 font-mono text-xs text-[#0F172A] leading-relaxed outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] resize-y shadow-2xs"
              />

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleClearAllLinks}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#EF4444] hover:text-[#DC2626] transition-colors"
                >
                  <Trash2 className="size-4" />
                  Xóa tất cả
                </button>
                <button
                  type="button"
                  onClick={handleCheckAndDeduplicateLinks}
                  className="inline-flex h-9 items-center rounded-lg bg-[#2563EB] px-4 text-xs font-bold text-white shadow-sm hover:bg-blue-600 transition-colors"
                >
                  Kiểm tra & Lọc trùng lặp
                </button>
              </div>

              {/* Khối Xem trước danh sách link đã nhập (Ảnh 1) */}
              <div className="space-y-2 pt-1">
                <div className="rounded-lg bg-[#F8FAFC] px-4 py-2.5 font-bold text-xs uppercase tracking-wide text-[#334155] border border-[#F1F5F9]">
                  XEM TRƯỚC DANH SÁCH LINK ĐÃ NHẬP ({parsedLinks.length} LINK)
                </div>

                <div className="max-h-[220px] overflow-y-auto rounded-lg border border-[#E2E8F0] bg-white shadow-2xs">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 z-10 bg-[#F8FAFC] border-b border-[#E2E8F0] text-[10px] font-bold uppercase tracking-wide text-[#64748B]">
                      <tr>
                        <th className="w-14 px-3 py-2.5 text-center bg-[#F8FAFC]">STT</th>
                        <th className="px-3 py-2.5 bg-[#F8FAFC]">Đường dẫn Group Facebook</th>
                        <th className="w-24 px-3 py-2.5 text-center bg-[#F8FAFC]">Trạng thái</th>
                        <th className="w-10 px-2 py-2.5 bg-[#F8FAFC]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedLinks.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-3 py-6 text-center text-[#94A3B8]">
                            Chưa có liên kết nào. Hãy dán link và bấm Kiểm tra & Lọc trùng lặp.
                          </td>
                        </tr>
                      ) : (
                        parsedLinks.map((item) => (
                          <tr key={item.id} className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC]/60">
                            <td className="px-3 py-2 text-center text-[#64748B] font-mono">{item.stt}</td>
                            <td className="px-3 py-2">
                              <span
                                className="font-mono text-xs text-[#2563EB] hover:underline cursor-pointer"
                                title={item.url}
                              >
                                {item.url.replace(/^https?:\/\/(www\.)?/, "").length > 42
                                  ? `...${item.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 38)}...`
                                  : item.url.replace(/^https?:\/\/(www\.)?/, "")}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className="inline-flex items-center rounded-full bg-[#ECFDF5] border border-[#A7F3D0] px-2.5 py-0.5 text-[10px] font-semibold text-[#059669]">
                                Hợp lệ
                              </span>
                            </td>
                            <td className="px-2 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => handleRemoveLink(item.id)}
                                className="rounded p-1 text-[#94A3B8] hover:text-[#EF4444] hover:bg-rose-50 transition-colors"
                                title="Xóa dòng này"
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
          ) : null}

          {/* Phương thức Tải tệp — Thiết kế theo đúng Ảnh 2 */}
          {method === "file" ? (
            <div className="space-y-4">
              {/* Vùng kéo thả file */}
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#BFDBFE] bg-[#F8FAFC] py-6 px-4 text-center hover:bg-blue-50/20 hover:border-[#60A5FA] transition-colors">
                <div className="flex size-11 items-center justify-center rounded-full bg-[#DBEAFE] text-[#2563EB]">
                  <CloudUpload className="size-5" />
                </div>
                <p className="text-xs text-[#0F172A]">
                  Kéo thả file <strong className="text-[#2563EB]">.txt</strong> hoặc <strong className="text-[#2563EB]">.csv</strong> vào đây hoặc{" "}
                  <span className="font-semibold text-[#2563EB] underline">Bấm để tải lên</span>
                </p>
                <input
                  type="file"
                  accept=".txt,.csv,.xlsx,.xls"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </label>

              {/* Khung thông tin file đã tải lên */}
              {fileData ? (
                <div className="flex items-center justify-between rounded-xl border border-[#E2E8F0] bg-white p-3.5 shadow-2xs">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#DCFCE7] text-[#16A34A]">
                      <FileText className="size-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-[#0F172A]">
                        {fileData.fileName} <span className="font-normal text-[#64748B]">({fileData.fileSize})</span>
                      </p>
                      <p className="text-[11px] font-medium text-[#16A34A]">
                        ✓ Đã nhận diện: {fileData.totalCount} dòng dữ liệu
                      </p>
                    </div>
                  </div>
                  <label className="text-xs font-semibold text-[#2563EB] hover:underline cursor-pointer">
                    Thay đổi tệp
                    <input
                      type="file"
                      accept=".txt,.csv,.xlsx,.xls"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                  </label>
                </div>
              ) : null}

              {/* Khối Xem trước danh sách tải lên (Ảnh 2) */}
              {fileData ? (
                <div className="space-y-2.5 pt-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[#0B1C30]">
                      <Activity className="size-4 text-[#2563EB]" />
                      <span>XEM TRƯỚC DANH SÁCH TẢI LÊN</span>
                    </div>
                    <div className="flex items-center gap-1 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setFileFilter("all")}
                        className={`rounded-full px-2.5 py-1 font-semibold transition-colors ${
                          fileFilter === "all"
                            ? "bg-[#DBEAFE] text-[#1D4ED8]"
                            : "bg-[#F1F5F9] text-[#64748B] hover:bg-slate-200"
                        }`}
                      >
                        Tất cả ({fileData.totalCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setFileFilter("valid")}
                        className={`rounded-full px-2.5 py-1 font-semibold transition-colors ${
                          fileFilter === "valid"
                            ? "bg-[#DCFCE7] text-[#15803D]"
                            : "bg-[#F1F5F9] text-[#64748B] hover:bg-slate-200"
                        }`}
                      >
                        Hợp lệ ({fileData.validCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setFileFilter("duplicate")}
                        className={`rounded-full px-2.5 py-1 font-semibold transition-colors ${
                          fileFilter === "duplicate"
                            ? "bg-[#FEF3C7] text-[#D97706]"
                            : "bg-[#F1F5F9] text-[#64748B] hover:bg-slate-200"
                        }`}
                      >
                        Trùng lặp ({fileData.dupCount})
                      </button>
                    </div>
                  </div>

                  <div className="max-h-[220px] overflow-y-auto rounded-lg border border-[#E2E8F0] bg-white shadow-2xs">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="sticky top-0 z-10 bg-[#F8FAFC] border-b border-[#E2E8F0] text-[10px] font-bold uppercase tracking-wide text-[#64748B]">
                        <tr>
                          <th className="w-16 px-4 py-2.5 text-center bg-[#F8FAFC]">Dòng</th>
                          <th className="px-3 py-2.5 bg-[#F8FAFC]">Dữ liệu tệp</th>
                          <th className="w-24 px-3 py-2.5 text-center bg-[#F8FAFC]">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedFileRows.slice(0, 10).map((r, idx) => (
                          <tr key={r.id || idx} className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC]/60">
                            <td className="px-4 py-2 text-center text-[#64748B] font-mono">{r.line}</td>
                            <td className="px-3 py-2 font-mono text-xs text-[#0F172A]">{r.raw}</td>
                            <td className="px-3 py-2 text-center">
                              {r.status === "valid" ? (
                                <span className="inline-flex items-center rounded-full bg-[#ECFDF5] border border-[#A7F3D0] px-2.5 py-0.5 text-[10px] font-semibold text-[#059669]">
                                  Hợp lệ
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full bg-[#FEF3C7] border border-[#FDE68A] px-2.5 py-0.5 text-[10px] font-semibold text-[#D97706]">
                                  Trùng lặp
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <p className="text-right text-[11px] text-[#64748B]">
                    Hiển thị {Math.min(displayedFileRows.length, 5)} trên {fileData.totalCount} dòng được phân tích
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* (2) Cấu hình mục tiêu */}
        <section className="flex flex-col h-full rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center gap-2.5 pb-3 mb-4 border-b border-[#F1F5F9]">
            <span className="flex size-6 items-center justify-center rounded-full bg-[#2563EB] text-[11px] font-bold text-white shrink-0">
              2
            </span>
            <h2 className="text-sm font-bold text-[#0B1C30]">Thiết lập cấu hình quét mục tiêu</h2>
          </div>

          <div className="mb-4 space-y-2">
            {/* Phương thức 1: Theo từ khóa */}
            {method === "keyword" && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-[#64748B]">
                    Số nhóm cần quét / từ khóa {keywords.length > 0 && `(${keywords.length})`}
                  </p>
                  {keywords.length > 5 && (
                    <span className="text-[10px] text-blue-600 font-medium">Cuộn để xem thêm ({keywords.length} mục)</span>
                  )}
                </div>
                {keywords.length === 0 ? (
                  <p className="text-xs text-[#94A3B8]">Thêm từ khóa ở cột trái để đặt hạn mức số nhóm.</p>
                ) : (
                  <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                    {keywords.map((word) => (
                      <div
                        key={word}
                        className="flex items-center justify-between gap-3 rounded-lg border border-[#F1F5F9] bg-[#F8FAFC] px-3 py-2"
                      >
                        <span className="truncate text-xs font-medium text-[#0F172A]">{word}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <input
                            type="number"
                            min={1}
                            max={5000}
                            value={quotas[word] ?? 30}
                            onChange={(event) =>
                              setQuotas((current) => ({
                                ...current,
                                [word]: Math.max(1, Math.min(5000, Number(event.target.value) || 1)),
                              }))
                            }
                            className={`${inputClass} w-16`}
                          />
                          <span className="text-[11px] text-[#94A3B8]">nhóm</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Phương thức 2: Nhập Link */}
            {method === "link" && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-[#64748B]">
                    Số nhóm cần quét / liên kết {parsedLinks.length > 0 && `(${parsedLinks.length})`}
                  </p>
                  {parsedLinks.length > 5 && (
                    <span className="text-[10px] text-blue-600 font-medium">Cuộn để xem thêm ({parsedLinks.length} mục)</span>
                  )}
                </div>
                {parsedLinks.length === 0 ? (
                  <p className="text-xs text-[#94A3B8]">Dán danh sách link và bấm Kiểm tra & Lọc trùng lặp ở cột trái để đặt hạn mức.</p>
                ) : (
                  <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                    {parsedLinks.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-[#F1F5F9] bg-[#F8FAFC] px-3 py-2"
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <span className="text-xs font-bold text-[#2563EB]">#{item.stt}</span>
                          <span className="truncate text-xs font-medium text-[#0F172A]" title={item.url}>
                            {item.url}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <input
                            type="number"
                            min={1}
                            max={5000}
                            value={linkQuotas[item.url] ?? 30}
                            onChange={(event) =>
                              setLinkQuotas((current) => ({
                                ...current,
                                [item.url]: Math.max(1, Math.min(5000, Number(event.target.value) || 1)),
                              }))
                            }
                            className={`${inputClass} w-16`}
                          />
                          <span className="text-[11px] text-[#94A3B8]">nhóm</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Phương thức 3: Tải tệp */}
            {method === "file" && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-[#64748B]">
                    Số nhóm cần quét / mục tiêu tệp {validFileRows.length > 0 && `(${validFileRows.length})`}
                  </p>
                  {validFileRows.length > 5 && (
                    <span className="text-[10px] text-blue-600 font-medium">Cuộn để xem thêm ({validFileRows.length} mục)</span>
                  )}
                </div>
                {!fileData || validFileRows.length === 0 ? (
                  <p className="text-xs text-[#94A3B8]">Tải file .txt hoặc .csv ở cột trái để đặt hạn mức số nhóm.</p>
                ) : (
                  <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                    {validFileRows.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-[#F1F5F9] bg-[#F8FAFC] px-3 py-2"
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <span className="text-xs font-bold text-[#2563EB]">Dòng {item.line}</span>
                          <span className="truncate text-xs font-medium text-[#0F172A]" title={item.raw}>
                            {item.raw}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <input
                            type="number"
                            min={1}
                            max={5000}
                            value={fileQuotas[item.raw] ?? 30}
                            onChange={(event) =>
                              setFileQuotas((current) => ({
                                ...current,
                                [item.raw]: Math.max(1, Math.min(5000, Number(event.target.value) || 1)),
                              }))
                            }
                            className={`${inputClass} w-16`}
                          />
                          <span className="text-[11px] text-[#94A3B8]">nhóm</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2.5">
            <IconInfo className="mt-0.5" />
            <p className="min-w-0 flex-1 text-[11px] leading-5 text-[#92400E]">
              Kết quả tìm kiếm nằm ở top đầu thường có chất lượng tương tác tốt hơn. Nên đặt hạn mức vừa phải
              theo từng từ khóa để ưu tiên nhóm chất lượng.
            </p>
          </div>

          <div className="space-y-3.5 border-t border-[#F1F5F9] pt-4">
            {/* Stepper 1: Switch Account Threshold (Đồng nhất theo trang Quét thành viên) */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#334155]">
                Đổi tài khoản mới khi quét được:
              </span>
              <div className="flex items-center gap-2">
                <div className="flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7">
                  <button
                    type="button"
                    onClick={() => setRotateAfter((v) => Math.max(5, v - 5))}
                    className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-l-lg font-medium"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    value={rotateAfter}
                    onChange={(event) => setRotateAfter(Math.max(1, Number(event.target.value) || 1))}
                    className="w-10 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    title="Chỉ giao diện — chưa đổi nick tự động"
                  />
                  <button
                    type="button"
                    onClick={() => setRotateAfter((v) => v + 5)}
                    className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-r-lg font-medium"
                  >
                    +
                  </button>
                </div>
                <span className="text-xs text-[#64748B]">nhóm / tài khoản</span>
              </div>
            </div>

            {/* Stepper 2: Delay interval (Đồng nhất theo Ảnh 4 trang Quét thành viên) */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#334155]">
                Khoảng cách giữa các lần quét:
              </span>
              <div className="flex items-center gap-2">
                {/* Min delay stepper */}
                <div className="flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7">
                  <button
                    type="button"
                    onClick={() => setDelayMin((v) => Math.max(0, v - 1))}
                    className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-l-lg font-medium"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    value={delayMin}
                    onChange={(event) => setDelayMin(Math.max(0, Number(event.target.value) || 0))}
                    className="w-8 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    onClick={() => setDelayMin((v) => v + 1)}
                    className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-r-lg font-medium"
                  >
                    +
                  </button>
                </div>

                <span className="text-xs text-[#94A3B8]">-</span>

                {/* Max delay stepper */}
                <div className="flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7">
                  <button
                    type="button"
                    onClick={() => setDelayMax((v) => Math.max(delayMin, v - 1))}
                    className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-l-lg font-medium"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    value={delayMax}
                    onChange={(event) => setDelayMax(Math.max(delayMin, Number(event.target.value) || delayMin))}
                    className="w-8 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    onClick={() => setDelayMax((v) => v + 1)}
                    className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-r-lg font-medium"
                  >
                    +
                  </button>
                </div>

                <span className="text-xs text-[#64748B]">giây</span>
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-xs text-[#0F172A]">
              <Checkbox
                checked={publicOnly}
                onCheckedChange={(value) => {
                  const on = Boolean(value);
                  setPublicOnly(on);
                  const both = on && privateOnly;
                  const none = !on && !privateOnly;
                  toast.info(
                    both || none
                      ? "Đang quét cả công khai và riêng tư."
                      : on
                        ? "Đã bật: chỉ quét nhóm công khai (Public)."
                        : "Đã tắt lọc công khai — chỉ còn lọc riêng tư.",
                  );
                }}
              />
              Chỉ quét nhóm đang ở chế độ công khai
            </label>

            <label className="flex cursor-pointer items-center gap-2 text-xs text-[#0F172A]">
              <Checkbox
                checked={privateOnly}
                onCheckedChange={(value) => {
                  const on = Boolean(value);
                  setPrivateOnly(on);
                  const both = on && publicOnly;
                  const none = !on && !publicOnly;
                  toast.info(
                    both || none
                      ? "Đang quét cả công khai và riêng tư."
                      : on
                        ? "Đã bật: chỉ quét nhóm riêng tư (Private) — ghi chú Chưa vào nhóm."
                        : "Đã tắt lọc riêng tư — chỉ còn lọc công khai.",
                  );
                }}
              />
              Chỉ quét nhóm đang ở chế độ riêng tư
            </label>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-[#0F172A]">
                <Checkbox
                  checked={minMembersEnabled}
                  onCheckedChange={(value) => {
                    const on = Boolean(value);
                    setMinMembersEnabled(on);
                    toast.info(
                      on
                        ? `Đã bật: chỉ quét nhóm > ${minMembers} thành viên.`
                        : "Đã tắt lọc số thành viên.",
                    );
                  }}
                />
                <span>Chỉ quét nhóm có số lượng thành viên lớn hơn</span>
              </label>
              <div className="flex items-center gap-2">
                <div className={`flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7 ${!minMembersEnabled ? "opacity-50 pointer-events-none" : ""}`}>
                  <button
                    type="button"
                    disabled={!minMembersEnabled}
                    onClick={() => setMinMembers((v) => Math.max(0, v - 1000))}
                    className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-l-lg font-medium"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    disabled={!minMembersEnabled}
                    value={minMembers}
                    onChange={(event) => setMinMembers(Math.max(0, Number(event.target.value) || 0))}
                    className="w-16 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    disabled={!minMembersEnabled}
                    onClick={() => setMinMembers((v) => v + 1000)}
                    className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-r-lg font-medium"
                  >
                    +
                  </button>
                </div>
                <span className="text-xs text-[#64748B]">thành viên</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="space-y-3">
        <button
          type="button"
          onClick={startRun}
          disabled={runState === "running"}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] text-sm font-bold tracking-wide text-white hover:bg-blue-600 disabled:opacity-60"
        >
          {runState === "running" ? <Loader2 className="size-4 animate-spin" /> : <IconPlay color="#fff" />}
          {runState === "running" ? "ĐANG QUÉT…" : runState === "paused" ? "TIẾP TỤC / BẮT ĐẦU LẠI" : "BẮT ĐẦU THỰC THI"}
        </button>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={runState !== "running"}
            onClick={pauseRun}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#FECACA] bg-white text-sm font-bold tracking-wide text-[#DC2626] disabled:opacity-40"
          >
            <IconPause color="#DC2626" />
            TẠM DỪNG
          </button>
          <button
            type="button"
            disabled={runState !== "running" && runState !== "paused"}
            onClick={abortRun}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#EF4444] text-sm font-bold tracking-wide text-white disabled:opacity-40"
          >
            <IconStop color="#fff" />
            DỪNG KHẨN CẤP
          </button>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F1F5F9] px-5 py-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-[#0B1C30]">Kết quả quét</h2>
            <span className="rounded-full bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-semibold text-[#2563EB]">
              {filteredResults.length} nhóm
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={exportExcel}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E2E8F0] px-3 text-xs font-semibold text-[#64748B] hover:bg-slate-50"
            >
              <IconDownload color="#64748B" />
              Xuất Excel
            </button>
            {method !== "keyword" && (
              <button
                type="button"
                onClick={() => {
                  const toSave =
                    selectedRows.size > 0
                      ? results.filter((r) => selectedRows.has(r.id))
                      : results;
                  if (!toSave || toSave.length === 0) {
                    toast.warning(
                      "Chưa có nhóm nào trong kết quả quét để lưu. Hãy quét trước!"
                    );
                    return;
                  }
                  setSaveModalOpen(true);
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 text-xs font-bold text-white shadow-xs hover:bg-blue-700 transition-colors"
              >
                Lưu vào danh sách chung
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 border-b border-[#F1F5F9] px-5 py-3 w-full">
          <div className="relative flex-1 min-w-[200px]">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8]">
              <IconSearch color="#94A3B8" />
            </span>
            <input
              value={resultQuery}
              onChange={(event) => setResultQuery(event.target.value)}
              placeholder="Tìm Tên, Link, Từ khóa..."
              className="h-8 w-full rounded-lg border border-[#E2E8F0] pl-8 pr-3 text-xs outline-none focus:border-[#2563EB] transition-colors"
            />
          </div>
          <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[130px]">
            <CustomSelect
              value={filterType}
              onChange={(val) => setFilterType(val)}
              options={RESULT_TYPE_OPTIONS}
              size="sm"
              className="w-full"
            />
          </div>
          <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[130px]">
            <CustomSelect
              value={filterMembers}
              onChange={(val) => setFilterMembers(val)}
              options={RESULT_MEMBERS_OPTIONS}
              size="sm"
              className="w-full"
            />
          </div>
          <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[130px]">
            <CustomSelect
              value={filterKeyword}
              onChange={(val) => setFilterKeyword(val)}
              options={keywordOptions}
              size="sm"
              className="w-full"
            />
          </div>
          <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[130px]">
            <CustomSelect
              value={filterNote}
              onChange={(val) => setFilterNote(val)}
              options={RESULT_NOTE_OPTIONS}
              size="sm"
              className="w-full"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-xs">
            <thead className="bg-[#F8FAFC] text-[10px] font-bold uppercase tracking-wide text-[#64748B]">
              <tr>
                <th className="w-10 px-4 py-2.5">
                  <Checkbox checked={allVisibleSelected} onCheckedChange={(value) => toggleAllRows(Boolean(value))} />
                </th>
                <th className="w-14 px-2 py-2.5">STT</th>
                <th className="px-3 py-2.5">Từ khóa</th>
                <th className="px-3 py-2.5">Tên nhóm</th>
                <th className="whitespace-nowrap px-3 py-2.5">Loại nhóm</th>
                <th className="px-3 py-2.5">Thành viên</th>
                <th className="px-3 py-2.5">Liên kết / URL nhóm</th>
                <th className="px-3 py-2.5">Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {filteredResults.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-14 text-center text-sm text-[#94A3B8]">
                    Chưa có kết quả. Chọn tài khoản và bấm Bắt đầu khi luồng quét đã nối.
                  </td>
                </tr>
              ) : (
                filteredResults.map((row, index) => (
                  <tr key={row.id || index} className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC]/60">
                    <td className="px-4 py-2.5">
                      <Checkbox
                        checked={selectedRows.has(row.id)}
                        onCheckedChange={(value) => {
                          setSelectedRows((current) => {
                            const next = new Set(current);
                            if (value) next.add(row.id);
                            else next.delete(row.id);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td className="px-2 py-2.5 text-[#64748B]">{index + 1}</td>
                    <td className="px-3 py-2.5 text-[#64748B]">{row.keyword}</td>
                    <td className="px-3 py-2.5 font-semibold text-[#0F172A]">{row.name}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <TypeBadge type={row.type} />
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-[#0F172A]">{row.members}</td>
                    <td className="px-3 py-2.5">
                      <a
                        href={`https://${row.url}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[#2563EB] hover:underline"
                      >
                        {row.url}
                        <IconExternal color="#2563EB" />
                      </a>
                    </td>
                    <td className="px-3 py-2.5">
                      <NoteBadge note={row.note} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-lg bg-[#EFF6FF]">
              <IconProgress />
            </span>
            <h2 className="text-sm font-bold text-[#0F172A]">Theo dõi tiến trình</h2>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-600">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            {runState === "idle" ? "IDLE" : runState.toUpperCase()}
          </span>
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
                Live Automation Log Console [Thread-01]
              </span>
            </div>
          </div>
          <div className="max-h-52 space-y-1.5 overflow-y-auto px-4 py-3 font-mono text-[11px] leading-relaxed">
            {logs.map((line, index) => (
              <p key={`${line.time}-${index}`} className="flex flex-wrap items-start gap-2 text-slate-300">
                <span className="shrink-0 text-slate-500">[{line.time}]</span>
                <span className="shrink-0 text-teal-400">[{line.thread}]</span>
                <span className={`break-all ${logTone(line.tone)}`}>{line.text}</span>
              </p>
            ))}
          </div>
        </div>
      </section>

      <AccountSelectModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        accounts={accounts}
        loading={accountsLoading}
        selectedUids={selectedUids}
        onRefresh={loadAccounts}
        onConfirm={(uids) => {
          setSelectedUids(uids);
          toast.success(`Đã chọn ${uids.length} tài khoản để quét nhóm.`);
        }}
      />

      <SaveSharedGroupModal
        isOpen={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        groups={
          selectedRows.size > 0
            ? results.filter((r) => selectedRows.has(r.id))
            : results
        }
        onSaved={(catName) => {
          pushLog(`Đã lưu các nhóm vào danh mục «${catName}»`, "success");
        }}
      />
    </div>
    </>
  );
}
