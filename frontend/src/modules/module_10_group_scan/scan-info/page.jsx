"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { useUnsavedChanges } from "@/components/UnsavedChangesContext";
import AccountSelectModal, { isScanReady } from "../components/AccountSelectModal";
import SaveSharedGroupModal from "../components/SaveSharedGroupModal";
import {
  IconPause,
  IconPlay,
  IconStop,
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
import AccountMethodCard from "./_components/AccountMethodCard";
import ScanTargetConfigCard from "./_components/ScanTargetConfigCard";
import ScanResultSection from "./_components/ScanResultSection";
import LiveLogConsole from "./_components/LiveLogConsole";

const KEYWORD_STATS_SEED = {};

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
    .replace(/^[\(\[]\d+\+?[\)\]]\s*/, "")
    .replace(/^(Profile photo of|Ảnh đại diện của|Anh dai dien cua)\s*/i, "")
    .replace(/\s*\|\s*Facebook$/i, "")
    .replace(/^[\(\[]\d+\+?[\)\]]\s*/, "")
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

export default function GroupScanInfoPage() {
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [selectedUids, setSelectedUids] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const { setUnsavedChanges } = useUnsavedChanges();
  const [hasSavedShared, setHasSavedShared] = useState(false);

  const [method, setMethod] = useState("keyword");
  const [keywordInput, setKeywordInput] = useState("");
  const [keywords, setKeywords] = useState([]);
  const [quotas, setQuotas] = useState({});

  // Tab Nhập Link
  const [linkText, setLinkText] = useState("");
  const [parsedLinks, setParsedLinks] = useState([]);
  const [linkQuotas, setLinkQuotas] = useState({});

  // Tab Tải tệp
  const [fileData, setFileData] = useState(null);
  const [fileQuotas, setFileQuotas] = useState({});
  const [fileFilter, setFileFilter] = useState("all"); // all | valid | duplicate
  const [skipInvalidRows, setSkipInvalidRows] = useState(true);

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

  // Cảnh báo chưa lưu kết quả quét khi dùng phương thức Nhập link hoặc Tải tệp
  useEffect(() => {
    const hasUnsaved = method !== "keyword" && results.length > 0 && !hasSavedShared;
    if (hasUnsaved) {
      setUnsavedChanges(
        true,
        null,
        "Bạn có kết quả quét nhóm chưa bấm 'Lưu vào danh sách chung'. Rời khỏi màn hình bây giờ sẽ làm mất các kết quả này. Bạn có chắc chắn muốn rời đi?"
      );
    } else {
      setUnsavedChanges(false);
    }
    return () => {
      setUnsavedChanges(false);
    };
  }, [results, method, hasSavedShared, setUnsavedChanges]);

  const handleMethodChange = useCallback(
    (newMethod) => {
      if (newMethod === method) return;
      if (results.length > 0 && !hasSavedShared && method !== "keyword") {
        const confirmChange = window.confirm(
          "Bạn có kết quả quét nhóm chưa bấm 'Lưu vào danh sách chung'. Đổi sang phương thức quét khác sẽ làm mới phiên làm việc và xóa kết quả hiện tại. Bạn có chắc chắn muốn chuyển không?"
        );
        if (!confirmChange) return;
      }
      setMethod(newMethod);
      setResults([]);
      setSelectedRows(new Set());
      setHasSavedShared(false);
      setUnsavedChanges(false);
    },
    [method, results, hasSavedShared, setUnsavedChanges]
  );

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

  // Helper kiểm tra & chuẩn hóa liên kết Facebook Group cho Tải tệp & Nhập link
  const isFbGroupLink = (raw) => {
    let clean = String(raw || "").trim();
    if (!clean) return false;
    if (/^[0-9]{5,}$/.test(clean)) return true;
    if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
      clean = `https://${clean}`;
    }
    return /(facebook\.com|fb\.com)\/(groups\/[0-9a-zA-Z._-]+|[0-9]{5,})/i.test(clean);
  };

  const normalizeFbGroupLink = (raw) => {
    let clean = String(raw || "").trim();
    if (/^[0-9]{5,}$/.test(clean)) {
      return `https://www.facebook.com/groups/${clean}`;
    }
    if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
      clean = `https://${clean}`;
    }
    try {
      const url = new URL(clean);
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/+$/, "");
    } catch {
      return clean.replace(/\/+$/, "");
    }
  };

  // Handler Phương thức Nhập Link
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
      const isFbGroup = isFbGroupLink(line);
      const clean = isFbGroup ? normalizeFbGroupLink(line) : (line.startsWith("http") ? line : `https://${line}`);
      const key = clean.toLowerCase().replace(/\/+$/, "");
      if (seen.has(key)) return;
      seen.add(key);
      list.push({
        id: `link-${list.length + 1}`,
        stt: list.length + 1,
        url: clean,
        raw: line,
        status: isFbGroup ? "valid" : "invalid",
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

  // Handler Phương thức Tải tệp (CHỈ chấp nhận link nhóm Facebook, loại bỏ hoàn toàn từ khóa)
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
              if (text && !text.startsWith("#") && !/^(stt|tên|link|nhóm|group|url|đường dẫn)/i.test(text)) {
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

      if (rawLines.length > 1000) {
        toast.warning("Tệp vượt quá 1.000 dòng. Hệ thống đã tự động giới hạn ở 1.000 dòng đầu tiên theo quy định an toàn.");
        rawLines = rawLines.slice(0, 1000);
      }

      const seen = new Set();
      const rows = [];
      let validCount = 0;
      let dupCount = 0;
      let invalidCount = 0;

      rawLines.forEach((line, idx) => {
        const isGroup = isFbGroupLink(line);
        if (!isGroup) {
          invalidCount += 1;
          rows.push({
            id: `f-${idx + 1}`,
            line: idx + 1,
            raw: line,
            url: line,
            status: "invalid",
            reason: "Không phải liên kết nhóm Facebook hợp lệ",
          });
          return;
        }

        const normalizedUrl = normalizeFbGroupLink(line);
        const normKey = normalizedUrl.toLowerCase().replace(/\/+$/, "");
        if (seen.has(normKey)) {
          dupCount += 1;
          rows.push({
            id: `f-${idx + 1}`,
            line: idx + 1,
            raw: line,
            url: normalizedUrl,
            status: "duplicate",
          });
        } else {
          seen.add(normKey);
          validCount += 1;
          rows.push({
            id: `f-${idx + 1}`,
            line: idx + 1,
            raw: line,
            url: normalizedUrl,
            status: "valid",
          });
        }
      });

      const sizeStr = (file.size / 1024).toFixed(1) + " KB";
      setFileData({
        name,
        size: sizeStr,
        totalCount: rows.length,
        validCount,
        dupCount,
        invalidCount,
        rows,
      });
      setFileQuotas((current) => {
        const next = { ...current };
        rows.forEach((item) => {
          const targetKey = item.url || item.raw;
          if (item.status === "valid" && next[targetKey] == null) next[targetKey] = 30;
        });
        return next;
      });

      if (validCount === 0) {
        toast.error(`Tệp «${name}» không chứa liên kết nhóm Facebook nào (${invalidCount} dòng sai định dạng). Vui lòng kiểm tra lại!`);
      } else {
        toast.success(
          `Đã nhận diện tệp ${name}: ${validCount} link nhóm hợp lệ${dupCount > 0 ? `, ${dupCount} trùng lặp` : ""}${invalidCount > 0 ? `, ${invalidCount} không phải link nhóm (loại trừ)` : ""}.`
        );
      }
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
    if (fileFilter === "invalid") return fileData.rows.filter((r) => r.status === "invalid");
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

      const loadedGroups = Array.isArray(res?.groups) ? res.groups : [];
      setResults(loadedGroups.map(mapGroupRow));

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
      payloadKeywords = validRows.map((r) => {
        const target = r.url || r.raw;
        return {
          keyword: target,
          limit: Math.max(1, Math.min(200, Number(fileQuotas[target] ?? fileQuotas[r.raw]) || 30)),
        };
      });
    }

    const firstWord = payloadKeywords[0]?.keyword || "";
    return {
      uid: selectedUids[0],
      uids: selectedUids,
      rotate_after: Math.max(1, Number(rotateAfter) || 50),
      keyword: firstWord,
      keywords: payloadKeywords,
      delay_min: Math.max(0, Number(delayMin) || 0),
      delay_max: Math.max(Number(delayMin) || 0, Number(delayMax) || 0),
      public_only: Boolean(publicOnly),
      private_only: Boolean(privateOnly),
      min_members: minMembersEnabled ? Math.max(0, Number(minMembers) || 0) : null,
      auto_join: true,
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
        toast.warning("Tệp không chứa liên kết nhóm Facebook hợp lệ nào. Vui lòng kiểm tra lại tệp!");
        return;
      }
    }

    setResults([]);
    setSelectedRows(new Set());
    setHasSavedShared(false);
    try {
      localStorage.removeItem("fb_scan_info_active_results");
    } catch {}

    const uid = selectedUids[0];
    const body = buildScanBody(wordList);
    setRunState("running");
    if (method === "keyword") {
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
        `Bắt đầu thực thi quét theo tệp: nick ${uid}, ${validCnt} liên kết nhóm Facebook từ ${fileData?.name || "tệp"}…`,
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
      if (filterNote !== "all") {
        const n = String(row.note || "—").toLowerCase();
        if (filterNote === "joined") {
          if (n !== "joined" && !n.includes("đã tham gia")) return false;
        } else if (filterNote === "pending") {
          if (n !== "pending" && !n.includes("đang chờ")) return false;
        } else if (filterNote === "not_joined") {
          if (n !== "not_joined" && !n.includes("chưa vào")) return false;
        } else if (filterNote === "none") {
          if (n !== "—" && n !== "") return false;
        }
      }
      if (!q) return true;
      return `${row.name || ""} ${row.url || ""} ${row.keyword || ""}`.toLowerCase().includes(q);
    });
  }, [results, resultQuery, filterType, filterMembers, filterKeyword, filterNote]);

  const exportFile = async (format = "xlsx") => {
    const rows = selectedRows.size
      ? filteredResults.filter((row) => selectedRows.has(row.id))
      : filteredResults;
    if (!rows.length) {
      toast.warning("Chưa có nhóm để xuất. Quét hoặc chọn dòng trước.");
      return;
    }
    try {
      const typeLabel = (t) => (t === "private" ? "Riêng tư" : "Công khai");
      const noteLabel = (n) => {
        if (n === "not_joined" || n === "Chưa vào nhóm") return "Chưa vào nhóm";
        if (n === "joined" || n === "Đã tham gia") return "Đã tham gia";
        if (n === "pending" || String(n).includes("Đang chờ")) return "Đang chờ QTV duyệt";
        return n && n !== "—" ? n : "";
      };
      const headers = ["STT", "Từ khóa", "Tên nhóm", "Loại nhóm", "Thành viên", "URL nhóm", "Ghi chú"];
      const dataRows = rows.map((row, index) => [
        index + 1,
        row.keyword || "",
        row.name || "",
        typeLabel(row.type),
        row.members || "",
        row.href || (row.url ? `https://${String(row.url).replace(/^https?:\/\//, "")}` : ""),
        noteLabel(row.note),
      ]);

      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
      const fileName = `GroupInfo_${stamp}.${format}`;

      if (format === "csv") {
        const escapeCsv = (val) => {
          const str = String(val == null ? "" : val);
          if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        };
        const csvContent = "\uFEFF" + [
          headers.map(escapeCsv).join(","),
          ...dataRows.map((r) => r.map(escapeCsv).join(",")),
        ].join("\r\n");
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        const XLSX = await import("xlsx");
        const sheet = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
        sheet["!cols"] = [
          { wch: 6 },
          { wch: 22 },
          { wch: 36 },
          { wch: 14 },
          { wch: 14 },
          { wch: 48 },
          { wch: 20 },
        ];
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, sheet, "Kho nhom");
        XLSX.writeFile(book, fileName);
      }
      toast.success(`Đã xuất thành công file báo cáo: ${fileName}`);
      pushLog(`Xuất file thành công: ${rows.length} nhóm → ${fileName}`, "success");
    } catch (error) {
      toast.error(error.message || "Xuất file thất bại.");
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
          {/* Card 1: Chọn tài khoản & Thiết lập phiên quét */}
          <AccountMethodCard
            onOpenAccountsModal={() => setPickerOpen(true)}
            selectedUidsCount={selectedAccounts.length}
            totalAccountsCount={accounts.length}
            method={method}
            onMethodChange={handleMethodChange}
            keywordInput={keywordInput}
            onKeywordInputChange={setKeywordInput}
            onAddKeywords={addKeywords}
            onRunKeywordCheck={runKeywordCheck}
            running={running}
            keywords={keywords}
            onRemoveKeyword={removeKeyword}
            onClearAllKeywords={() => setKeywords([])}
            keywordStats={keywordStats}
            linkText={linkText}
            onLinkTextChange={setLinkText}
            onClearAllLinks={handleClearAllLinks}
            onCheckAndDeduplicateLinks={handleCheckAndDeduplicateLinks}
            parsedLinks={parsedLinks}
            onRemoveLink={handleRemoveLink}
            fileData={fileData}
            onFileUpload={handleFileUpload}
            onClearFile={() => setFileData(null)}
            fileFilter={fileFilter}
            onFileFilterChange={setFileFilter}
            validFileRowsCount={validFileRows.length}
            duplicateFileRowsCount={(fileData?.rows || []).filter((r) => r.status === "duplicate").length}
            invalidFileRowsCount={(fileData?.rows || []).filter((r) => r.status === "invalid").length}
            displayedFileRows={displayedFileRows}
            skipInvalidRows={skipInvalidRows}
            onSkipInvalidRowsChange={setSkipInvalidRows}
          />

          {/* Card 2: Thiết lập cấu hình quét mục tiêu */}
          <ScanTargetConfigCard
            method={method}
            keywords={keywords}
            quotas={quotas}
            onQuotaChange={(word, val) =>
              setQuotas((current) => ({ ...current, [word]: val }))
            }
            parsedLinks={parsedLinks}
            linkQuotas={linkQuotas}
            onLinkQuotaChange={(url, val) =>
              setLinkQuotas((current) => ({ ...current, [url]: val }))
            }
            validFileRows={validFileRows}
            fileQuotas={fileQuotas}
            onFileQuotaChange={(raw, val) =>
              setFileQuotas((current) => ({ ...current, [raw]: val }))
            }
            fileData={fileData}
            rotateAfter={rotateAfter}
            onRotateAfterChange={setRotateAfter}
            delayMin={delayMin}
            onDelayMinChange={setDelayMin}
            delayMax={delayMax}
            onDelayMaxChange={setDelayMax}
            publicOnly={publicOnly}
            onPublicOnlyChange={(val) => {
              const on = Boolean(val);
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
            privateOnly={privateOnly}
            onPrivateOnlyChange={(val) => {
              const on = Boolean(val);
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
            minMembersEnabled={minMembersEnabled}
            onMinMembersEnabledChange={(val) => {
              const on = Boolean(val);
              setMinMembersEnabled(on);
              toast.info(
                on
                  ? `Đã bật: chỉ quét nhóm > ${minMembers} thành viên.`
                  : "Đã tắt lọc số thành viên.",
              );
            }}
            minMembers={minMembers}
            onMinMembersChange={setMinMembers}
          />
        </div>

        {/* Action Controls */}
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

        {/* Card 3: Kết quả quét */}
        <ScanResultSection
          results={results}
          filteredResults={filteredResults}
          onExportExcel={() => exportFile("xlsx")}
          onExportFile={exportFile}
          method={method}
          onOpenSaveModal={() => {
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
          selectedRows={selectedRows}
          resultQuery={resultQuery}
          onResultQueryChange={setResultQuery}
          filterType={filterType}
          onFilterTypeChange={setFilterType}
          filterMembers={filterMembers}
          onFilterMembersChange={setFilterMembers}
          filterKeyword={filterKeyword}
          onFilterKeywordChange={setFilterKeyword}
          keywordOptions={keywordOptions}
          filterNote={filterNote}
          onFilterNoteChange={setFilterNote}
          allVisibleSelected={allVisibleSelected}
          onToggleAllRows={toggleAllRows}
          onToggleRow={(id, checked) => {
            setSelectedRows((current) => {
              const next = new Set(current);
              if (checked) next.add(id);
              else next.delete(id);
              return next;
            });
          }}
        />

        {/* Card 4: Live Automation Log Console */}
        <LiveLogConsole
          runState={runState}
          logs={logs}
        />

        {/* Modals */}
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
            setHasSavedShared(true);
            setUnsavedChanges(false);
            pushLog(`Đã lưu các nhóm vào danh mục «${catName}»`, "success");
          }}
        />
      </div>
    </>
  );
}
