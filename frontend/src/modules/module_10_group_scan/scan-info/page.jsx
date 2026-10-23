"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { Checkbox } from "@/components/ui/checkbox";
import AccountSelectModal, { isScanReady } from "../components/AccountSelectModal";
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
  getCheckStatus,
  getScanAccounts,
  lookupKeywords,
  startGroupScan,
} from "../service";

const METHOD_TABS = [
  { id: "keyword", label: "Theo từ khóa", Icon: IconTags },
  { id: "link", label: "Nhập Link", Icon: IconLink },
  { id: "file", label: "Tải tệp (.txt / .csv)", Icon: IconUpload },
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
  if ((!members || members === "—") && g?.members_count != null) {
    const n = Number(g.members_count);
    if (Number.isFinite(n)) {
      if (n >= 1_000_000) members = `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
      else if (n >= 1_000) members = `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
      else members = String(n);
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

  const [method, setMethod] = useState("keyword");
  const [keywordInput, setKeywordInput] = useState("");
  const [keywords, setKeywords] = useState(["Bán hàng online", "marketing", "kinh doanh sỉ"]);
  const [linkText, setLinkText] = useState("");
  const [quotas, setQuotas] = useState({
    "Bán hàng online": 30,
    marketing: 20,
    "kinh doanh sỉ": 50,
  });
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
      if (groups.length) {
        setResults(groups.map(mapGroupRow));
      }

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

  const buildScanBody = (wordList) => {
    const payloadKeywords = wordList.map((word) => ({
      keyword: word,
      limit: Math.max(1, Math.min(200, Number(quotas[word]) || 30)),
    }));
    return {
      uid: selectedUids[0],
      keyword: wordList[0],
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
          setResults(groups.map(mapGroupRow));
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

    const uid = selectedUids[0];
    const body = buildScanBody(wordList);
    setRunState("running");
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

  const filteredResults = useMemo(() => {
    const q = resultQuery.trim().toLowerCase();
    return results.filter((row) => {
      if (filterType !== "all" && row.type !== filterType) return false;
      if (filterNote !== "all" && row.note !== filterNote) return false;
      if (!q) return true;
      return `${row.name || ""} ${row.url || ""} ${row.keyword || ""}`.toLowerCase().includes(q);
    });
  }, [results, resultQuery, filterType, filterNote]);

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
    <div className="-m-6 min-h-full space-y-5 bg-[#F4F7FC] p-6">
      <div className="grid items-start gap-5 xl:grid-cols-2">
        {/* (1) Tài khoản + phương thức */}
        <section className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="flex size-6 items-center justify-center rounded-full bg-[#2563EB] text-[11px] font-bold text-white">
              1
            </span>
            <h2 className="text-sm font-bold text-[#0B1C30]">Chọn tài khoản & Thiết lập phiên quét</h2>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#2563EB] px-3.5 text-xs font-bold text-white hover:bg-blue-600"
            >
              <IconUsers color="#fff" />
              Chọn tài khoản
            </button>
            <span className="text-xs font-medium text-[#64748B]">
              Đã chọn:{" "}
              <strong className="text-[#0B1C30]">
                {accountsLoading ? "..." : `${selectedAccounts.length} tài khoản`}
              </strong>
            </span>
            {accountsLoading ? <Loader2 className="size-3.5 animate-spin text-slate-400" /> : null}
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
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[11px] font-semibold transition-colors ${
                    active
                      ? "border-[#BFDBFE] bg-[#EFF6FF] text-[#2563EB]"
                      : "border-[#E2E8F0] bg-white text-[#64748B] hover:bg-slate-50"
                  }`}
                >
                  <Icon color={active ? "#2563EB" : "#64748B"} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {method === "keyword" ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-2.5">
                  {keywords.map((word) => (
                    <span
                      key={word}
                      className="inline-flex items-center gap-1 rounded-md border border-[#BFDBFE] bg-white px-2 py-1 text-[11px] font-medium text-[#0F172A]"
                    >
                      {word}
                      <button
                        type="button"
                        onClick={() => removeKeyword(word)}
                        className="rounded p-0.5 text-[#94A3B8] hover:bg-slate-100 hover:text-slate-700"
                        aria-label={`Xóa ${word}`}
                      >
                        <IconClose />
                      </button>
                    </span>
                  ))}
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
                    className="min-w-[180px] flex-1 bg-transparent text-xs text-[#0F172A] outline-none placeholder:text-[#94A3B8]"
                  />
                  <button
                    type="button"
                    onClick={addKeywords}
                    className="inline-flex h-7 items-center rounded-md border border-[#E2E8F0] bg-white px-2.5 text-[11px] font-semibold text-[#0F172A] hover:bg-slate-50"
                  >
                    Thêm
                  </button>
                  <button
                    type="button"
                    onClick={runKeywordCheck}
                    disabled={running}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[#2563EB] px-2.5 text-[11px] font-bold text-white disabled:opacity-60"
                  >
                    Kiểm tra
                  </button>
                </div>
                <p className="px-0.5 text-[11px] text-[#94A3B8]">
                  {keywords.length
                    ? `Đã thêm ${keywords.length} từ khóa. Bấm Kiểm tra để điền bảng bên dưới — Bắt đầu thực thi mới mở Chrome quét.`
                    : "Nhập xong Enter / Thêm / dấu phẩy → thẻ. Kiểm tra = xác nhận vào bảng. Bắt đầu thực thi = quét."}
                </p>
              </div>

              <div className="overflow-hidden rounded-lg border border-[#E2E8F0]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F8FAFC] text-[10px] font-bold uppercase tracking-wide text-[#64748B]">
                    <tr>
                      <th className="px-3 py-2.5">Từ khóa</th>
                      <th className="px-3 py-2.5">Số nhóm quét được</th>
                      <th className="px-3 py-2.5">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
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
                          <tr key={word} className="border-t border-[#F1F5F9]">
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

          {method === "link" ? (
            <textarea
              value={linkText}
              onChange={(event) => setLinkText(event.target.value)}
              rows={6}
              placeholder={"Dán link nhóm, mỗi dòng một link\nhttps://facebook.com/groups/..."}
              className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-xs text-[#0F172A] outline-none focus:border-[#2563EB]"
            />
          ) : null}

          {method === "file" ? (
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-4 py-10 text-center">
              <IconUpload className="size-6" color="#94A3B8" />
              <span className="text-xs font-semibold text-[#0F172A]">Chọn tệp .txt hoặc .csv</span>
              <span className="text-[11px] text-[#94A3B8]">Mỗi dòng một từ khóa hoặc một link nhóm</span>
              <input
                type="file"
                accept=".txt,.csv"
                className="hidden"
                onChange={() => toast.info("Đọc tệp sẽ nối ở bước quét tiếp theo.")}
              />
            </label>
          ) : null}
        </section>

        {/* (2) Cấu hình mục tiêu */}
        <section className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="flex size-6 items-center justify-center rounded-full bg-[#2563EB] text-[11px] font-bold text-white">
              2
            </span>
            <h2 className="text-sm font-bold text-[#0B1C30]">Thiết lập cấu hình quét mục tiêu</h2>
          </div>

          <div className="mb-4 space-y-2">
            <p className="text-[11px] font-semibold text-[#64748B]">Số nhóm cần quét / từ khóa</p>
            {keywords.length === 0 ? (
              <p className="text-xs text-[#94A3B8]">Thêm từ khóa ở cột trái để đặt hạn mức.</p>
            ) : (
              keywords.map((word) => (
                <div
                  key={word}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[#F1F5F9] bg-[#F8FAFC] px-3 py-2"
                >
                  <span className="truncate text-xs font-medium text-[#0F172A]">{word}</span>
                  <div className="flex items-center gap-1.5">
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
              ))
            )}
          </div>

          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2.5">
            <IconInfo className="mt-0.5" />
            <p className="min-w-0 flex-1 text-[11px] leading-5 text-[#92400E]">
              Kết quả tìm kiếm nằm ở top đầu thường có chất lượng tương tác tốt hơn. Nên đặt hạn mức vừa phải
              theo từng từ khóa để ưu tiên nhóm chất lượng.
            </p>
          </div>

          <div className="space-y-3 border-t border-[#F1F5F9] pt-4">
            <label className="flex flex-wrap items-center gap-2 text-xs text-[#0F172A]">
              <span>Đổi tài khoản mới khi quét được</span>
              <input
                type="number"
                min={1}
                max={5000}
                value={rotateAfter}
                onChange={(event) => setRotateAfter(Math.max(1, Number(event.target.value) || 1))}
                className={`${inputClass} w-16`}
                title="Chỉ giao diện — chưa đổi nick tự động"
              />
              <span className="text-[#64748B]">nhóm / tài khoản</span>
              <span className="text-[10px] font-medium text-[#94A3B8]">(UI tạm — chưa chạy)</span>
            </label>

            <label className="flex flex-wrap items-center gap-2 text-xs text-[#0F172A]">
              <span>Khoảng cách giữa các lần quét</span>
              <input
                type="number"
                min={0}
                max={3600}
                value={delayMin}
                onChange={(event) => setDelayMin(Math.max(0, Number(event.target.value) || 0))}
                className={`${inputClass} w-14`}
              />
              <span className="text-[#64748B]">đến</span>
              <input
                type="number"
                min={0}
                max={3600}
                value={delayMax}
                onChange={(event) => setDelayMax(Math.max(delayMin, Number(event.target.value) || 0))}
                className={`${inputClass} w-14`}
              />
              <span className="text-[#64748B]">giây</span>
            </label>

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

            <label className="flex flex-wrap items-center gap-2 text-xs text-[#0F172A]">
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
              <input
                type="number"
                min={0}
                disabled={!minMembersEnabled}
                value={minMembers}
                onChange={(event) => setMinMembers(Math.max(0, Number(event.target.value) || 0))}
                className={`${inputClass} w-20`}
              />
              <span className="text-[#64748B]">thành viên</span>
            </label>
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
            <button
              type="button"
              onClick={() => toast.info("Lưu danh sách chung sẽ làm ở bước sau.")}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 text-xs font-bold text-white"
            >
              Lưu vào danh sách chung
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-[#F1F5F9] px-5 py-3">
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8]">
              <IconSearch color="#94A3B8" />
            </span>
            <input
              value={resultQuery}
              onChange={(event) => setResultQuery(event.target.value)}
              placeholder="Tìm Tên, Link"
              className="h-8 w-48 rounded-lg border border-[#E2E8F0] pl-8 pr-3 text-xs outline-none focus:border-[#2563EB]"
            />
          </div>
          <select
            value={filterType}
            onChange={(event) => setFilterType(event.target.value)}
            className="h-8 rounded-lg border border-[#E2E8F0] bg-white px-2 text-xs text-[#64748B] outline-none"
          >
            <option value="all">Loại nhóm</option>
            <option value="public">Công khai</option>
            <option value="private">Riêng tư</option>
          </select>
          <select
            value={filterNote}
            onChange={(event) => setFilterNote(event.target.value)}
            className="h-8 rounded-lg border border-[#E2E8F0] bg-white px-2 text-xs text-[#64748B] outline-none"
          >
            <option value="all">Ghi chú</option>
            <option value="not_joined">Chưa vào nhóm</option>
            <option value="joined">Đã tham gia</option>
            <option value="pending">Đang chờ QTV duyệt</option>
          </select>
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
    </div>
  );
}
