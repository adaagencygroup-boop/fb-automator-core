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
  getActiveKeywordCapacity,
  getCheckStatus,
  getKeywordCapacityStatus,
  getScanAccounts,
  startGroupScan,
  startKeywordCapacity,
  stopKeywordCapacity,
} from "../service";
import AccountMethodCard from "./_components/AccountMethodCard";
import ScanTargetConfigCard from "./_components/ScanTargetConfigCard";
import ScanResultSection from "./_components/ScanResultSection";
import LiveLogConsole from "./_components/LiveLogConsole";
import { downloadTable, groupExportTable } from "../utils/exportTable";
import ModulePageHeader from "../components/ModulePageHeader";
import { parseGroupLinkRows, splitTextRows } from "../utils/groupLinks";

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
  };
}

const fmtNum = (n) => Number(n || 0).toLocaleString("vi-VN");

/** Ô "Số nhóm quét được" của 1 từ khóa từ kết quả Kiểm tra (đang cuộn hoặc đã lưu DB). */
function capacityCell(row) {
  const started = row?.count !== null && row?.count !== undefined;
  if (!started) return { count: "…", detail: "", status: row?.status || "idle" };
  const total = Number(row.total) || 0;
  const ok = Number(row.count) || 0;
  const fresh = Number(row.fresh) || 0;
  const filtered = Math.max(0, total - ok); // riêng tư / ít thành viên / không rõ số thành viên
  const inDb = Math.max(0, ok - fresh); // qua bộ lọc nhưng đã quét trước đó
  return {
    count: `${fmtNum(ok)} nhóm`,
    detail: [
      `Facebook tìm thấy ${fmtNum(total)} nhóm`,
      filtered ? `loại ${fmtNum(filtered)} nhóm riêng tư hoặc ít thành viên` : null,
      inDb
        ? `${fmtNum(inDb)} nhóm đã có trong Danh sách nhóm quét, còn ${fmtNum(fresh)} nhóm chưa quét`
        : "tất cả đều là nhóm chưa quét",
      row.reason || null,
      row.checked_at ? `kiểm tra lúc ${row.checked_at}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    status: row.status || "done",
    cached: Boolean(row.cached),
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

  const [delayMin, setDelayMin] = useState(5);
  const [delayMax, setDelayMax] = useState(10);
  const [minMembers, setMinMembers] = useState(1000);
  const [minMembersEnabled, setMinMembersEnabled] = useState(true);

  const [runState, setRunState] = useState("idle"); // idle | running | paused
  const [checkJobId, setCheckJobId] = useState("");
  const [capacityJobId, setCapacityJobId] = useState(""); // phiên Kiểm tra từ khóa đang chạy
  const checkingKeywords = Boolean(capacityJobId);
  const running = runState === "running" || runState === "paused";
  const [pausing, setPausing] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [resultQuery, setResultQuery] = useState("");
  const [filterMembers, setFilterMembers] = useState("all");
  const [filterKeyword, setFilterKeyword] = useState("all");
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

  // fresh=true (nút Làm mới): bỏ cache để thấy ngay trạng thái Live / đăng nhập mới nhất.
  const loadAccounts = useCallback(async ({ fresh = false } = {}) => {
    setAccountsLoading(true);
    try {
      const data = await getScanAccounts({ fresh });
      const rows = (Array.isArray(data) ? data : data?.accounts || []).map(normalizeAccount);
      setAccounts(rows);
      setSelectedUids((current) => {
        const ready = new Set(rows.filter(isScanReady).map((acc) => acc.uid));
        const kept = current.filter((uid) => ready.has(uid));
        if (kept.length) return kept;
        return rows.filter(isScanReady).slice(0, 5).map((acc) => acc.uid);
      });
      return true;
    } catch (error) {
      toast.error(error.message || "Không tải được tài khoản Module 2.");
      setAccounts([]);
      setSelectedUids([]);
      return false;
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

  // Handler Phương thức Nhập Link
  const handleClearAllLinks = () => {
    setLinkText("");
    setParsedLinks([]);
    toast.info("Đã xóa toàn bộ liên kết.");
  };

  // Đọc ô Nhập link → danh sách xem trước (cũng là danh sách sẽ quét). Link trùng bị bỏ luôn.
  const applyLinkText = useCallback((text) => {
    const { rows } = parseGroupLinkRows(splitTextRows(text));
    const list = rows
      .filter((r) => r.status !== "duplicate")
      .map((r, idx) => ({ id: `link-${idx + 1}`, stt: idx + 1, url: r.url, raw: r.raw, status: r.status }));
    setParsedLinks(list);
    setLinkQuotas((current) => {
      const next = { ...current };
      list.forEach((item) => {
        if (item.status === "valid" && next[item.url] == null) next[item.url] = 30;
      });
      return next;
    });
    return { list, rows };
  }, []);

  // Dán / gõ / xoá trong ô là danh sách tự cập nhật — không để danh sách cũ bị quét nhầm.
  useEffect(() => {
    const timer = setTimeout(() => applyLinkText(linkText), 250);
    return () => clearTimeout(timer);
  }, [linkText, applyLinkText]);

  const handleCheckAndDeduplicateLinks = () => {
    const { list, rows } = applyLinkText(linkText);
    if (!rows.length) {
      toast.warning("Vui lòng nhập ít nhất 1 liên kết nhóm Facebook.");
      return;
    }
    const validCount = list.filter((r) => r.status === "valid").length;
    const dupCount = rows.length - list.length;
    if (!validCount) {
      toast.error("Không tìm thấy link nhóm Facebook nào trong nội dung đã nhập.");
      return;
    }
    toast.success(
      `Nhận ${validCount} link nhóm${dupCount ? `, bỏ ${dupCount} link trùng` : ""}`
      + `${list.length > validCount ? `, ${list.length - validCount} dòng không phải link nhóm` : ""}.`,
    );
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
      let rawRows = [];
      if (ext === "xlsx" || ext === "xls") {
        const XLSX = await import("xlsx");
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        // raw:true → ô số (ID nhóm) lấy giá trị gốc; kiểu hiển thị "General" của Excel sẽ ra 1.23E+15.
        rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" })
          .map((row) => row.map((cell) => (typeof cell === "number" ? String(Math.round(cell)) : cell)));
      } else {
        rawRows = splitTextRows(await file.text());
      }

      const { rows: parsed, truncated } = parseGroupLinkRows(rawRows, { maxLinks: 1000 });
      if (truncated) {
        toast.warning("Tệp có hơn 1.000 link nhóm — chỉ lấy 1.000 link đầu tiên.");
      }
      const rows = parsed.map((r, idx) => ({ ...r, id: `f-${idx + 1}` }));
      const validCount = rows.filter((r) => r.status === "valid").length;
      const dupCount = rows.filter((r) => r.status === "duplicate").length;
      const invalidCount = rows.filter((r) => r.status === "invalid").length;

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

  /**
   * Kiểm tra = mở Chrome bằng nick đã chọn, tìm nhóm theo từng từ khóa, cuộn tới khi Facebook
   * hết kết quả → từ khóa đó quét được TỐI ĐA bao nhiêu nhóm (theo bộ lọc công khai / số thành viên).
   */
  // recheckWords: "Kiểm tra lại" từng từ khóa → bỏ kết quả đã lưu, cuộn Facebook lại.
  const runKeywordCheck = async (recheckWords = null) => {
    if (capacityJobId) {
      toast.info("Đang kiểm tra từ khóa — chờ xong hoặc bấm Dừng kiểm tra.");
      return;
    }
    const force = Array.isArray(recheckWords) && recheckWords.length > 0;
    let wordList;
    if (force) {
      wordList = recheckWords;
    } else {
      const committed = keywordInput.trim() ? commitKeywords(keywordInput, { quiet: true }) : [];
      wordList = mergeKeywords(keywords, committed);
    }
    if (!wordList.length) {
      toast.warning("Nhập / thêm ít nhất một từ khóa rồi bấm Kiểm tra.");
      return;
    }
    try {
      const res = await startKeywordCapacity({
        uids: selectedUids,
        keywords: wordList,
        publicOnly: true,
        minMembers: minMembersEnabled ? Math.max(0, Number(minMembers) || 0) : null,
        force,
      });
      const cached = res?.cached || {};
      const pending = Array.isArray(res?.keywords) ? res.keywords : [];
      setKeywordStats((current) => {
        const next = { ...current };
        Object.entries(cached).forEach(([word, row]) => {
          next[word] = capacityCell(row);
        });
        pending.forEach((word) => {
          next[word] = { count: "…", detail: "", status: "idle" };
        });
        return next;
      });
      const cachedCount = Object.keys(cached).length;
      if (cachedCount) {
        pushLog(`Lấy kết quả đã lưu của ${cachedCount} từ khóa (không cần quét lại).`, "success");
      }
      if (res?.job_id) {
        setCapacityJobId(res.job_id);
        pushLog(`Kiểm tra ${pending.length} từ khóa mới: cuộn hết kết quả Facebook để đếm số nhóm quét được tối đa…`, "info");
        toast.info("Đang mở Chrome kiểm tra từ khóa — có thể mất vài phút mỗi từ khóa.");
      } else {
        toast.success("Đã điền kết quả Kiểm tra đã lưu. Bấm \"Kiểm tra lại\" ở từ khóa nếu muốn quét mới.");
      }
    } catch (error) {
      if (/tài khoản/i.test(error?.message || "")) setPickerOpen(true);
      toast.error(error.message || "Không bắt đầu kiểm tra được.");
      pushLog(error.message || "Kiểm tra từ khóa thất bại.", "error");
    }
  };

  const stopKeywordCheck = async () => {
    if (!capacityJobId) return;
    try {
      await stopKeywordCapacity(capacityJobId);
      toast.info("Đang dừng kiểm tra…");
    } catch (error) {
      toast.error(error.message || "Không dừng được phiên kiểm tra.");
    }
  };

  // Tải lại trang giữa lúc đang Kiểm tra → gắn lại vào phiên đó.
  useEffect(() => {
    let cancelled = false;
    getActiveKeywordCapacity()
      .then((res) => {
        if (!cancelled && res?.job_id) setCapacityJobId(res.job_id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Theo dõi tiến độ Kiểm tra: số nhóm từng từ khóa + log.
  useEffect(() => {
    if (!capacityJobId) return undefined;
    let stopped = false;
    let lastLogCount = 0;
    let notFound = 0;
    const tick = async () => {
      try {
        const res = await getKeywordCapacityStatus(capacityJobId);
        const job = res?.job;
        if (stopped || !job) return;
        notFound = 0;
        const remoteLogs = Array.isArray(job.logs) ? job.logs : [];
        if (remoteLogs.length > lastLogCount) {
          const fresh = remoteLogs.slice(lastLogCount);
          lastLogCount = remoteLogs.length;
          setLogs((current) => [...current, ...fresh].slice(-150));
        }
        const stats = job.keyword_stats || {};
        setKeywordStats((current) => {
          const next = { ...current };
          Object.entries(stats).forEach(([word, row]) => {
            next[word] = capacityCell(row);
          });
          return next;
        });
        if (["done", "aborted", "error"].includes(job.status)) {
          stopped = true;
          setCapacityJobId("");
          if (job.status === "done") toast.success("Đã kiểm tra xong số nhóm quét được của các từ khóa.");
          else if (job.status === "aborted") toast.warning("Đã dừng kiểm tra từ khóa.");
          else toast.error(job.error || "Kiểm tra từ khóa gặp lỗi.");
        }
      } catch (err) {
        if (err?.status === 404 && ++notFound >= 5) {
          // Phiên không còn trên Engine (Engine khởi động lại / tắt) → không để từ khóa treo "Đang quét".
          stopped = true;
          setCapacityJobId("");
          setKeywordStats((current) => {
            const next = { ...current };
            Object.entries(next).forEach(([word, row]) => {
              if (row?.status === "running" || row?.status === "idle") {
                next[word] = {
                  ...row,
                  status: "stopped",
                  detail: [row.detail, "bị gián đoạn — chưa xem hết, bấm Kiểm tra lại"].filter(Boolean).join(" · "),
                };
              }
            });
            return next;
          });
          toast.warning("Phiên kiểm tra bị gián đoạn (Engine vừa khởi động lại). Bấm Kiểm tra lại cho từ khóa đó.");
          pushLog("Phiên kiểm tra bị gián đoạn — Engine vừa khởi động lại. Kết quả dở dang không được lưu.", "warn");
        }
      }
    };
    tick();
    const timer = setInterval(tick, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [capacityJobId]);

  const buildScanBody = (wordList = []) => {
    let payloadKeywords = [];
    if (method === "keyword") {
      payloadKeywords = wordList.map((word) => ({
        keyword: word,
        limit: Math.max(1, Math.min(200, Number(quotas[word]) || 30)),
      }));
    } else if (method === "link") {
      const validLinks = (parsedLinks || []).filter((l) => l.status === "valid");
      payloadKeywords = validLinks.map((l) => ({
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
      keyword: firstWord,
      keywords: payloadKeywords,
      delay_min: Math.max(0, Number(delayMin) || 0),
      delay_max: Math.max(Number(delayMin) || 0, Number(delayMax) || 0),
      // Luồng quét chỉ lấy nhóm Public và không tham gia nhóm (backend cũng ép như vậy).
      public_only: true,
      private_only: false,
      min_members: minMembersEnabled ? Math.max(0, Number(minMembers) || 0) : null,
      auto_join: false,
      force: true,
    };
  };

  // Poll log + nhóm trong lúc job chạy
  useEffect(() => {
    if (!running || !checkJobId) return undefined;
    let stopped = false;
    let lastLogCount = 0;
    let finishedNotified = false;
    let notFound = 0;
    let timer;

    const tick = async () => {
      try {
        // Chỉ theo job_id: đổi danh sách nick lúc đang chạy không được reset vòng poll.
        const status = await getCheckStatus({ jobId: checkJobId });
        if (stopped || !status) return;
        notFound = 0;

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
              else if (row?.status === "stopped" || row?.status === "error") st = row.status;
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
          setPausing(false);
          setResuming(false);
          if (!finishedNotified) {
            finishedNotified = true;
            toast.info("Đã tạm dừng.");
          }
          return;
        }

        if (status.status === "running") {
          finishedNotified = false;
          setRunState("running");
          setResuming(false);
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
          setPausing(false);
          setAborting(false);
          setResuming(false);
          if (timer) clearInterval(timer);
        }
      } catch (err) {
        // Lỗi mạng thoáng qua: poll tiếp. Engine xác nhận không còn phiên (404 liên tiếp) → kết thúc UI.
        if (err?.status === 404 && ++notFound >= 5 && !finishedNotified) {
          finishedNotified = true;
          stopped = true;
          clearInterval(timer);
          setRunState("idle");
          setPausing(false);
          setAborting(false);
          setResuming(false);
          setKeywordStats((current) => {
            const next = { ...current };
            Object.entries(next).forEach(([word, row]) => {
              if (row?.status === "running") next[word] = { ...row, status: "stopped" };
            });
            return next;
          });
          toast.warning("Phiên quét bị gián đoạn (Engine vừa khởi động lại). Nhóm đã quét được vẫn được lưu.");
          pushLog("Phiên quét bị gián đoạn — Engine vừa khởi động lại. Các nhóm đã quét trước đó vẫn nằm trong danh sách.", "warn");
        }
      }
    };

    tick();
    timer = setInterval(tick, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [checkJobId, running]);

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
    if (method === "link") {
      const validLinks = (parsedLinks || []).filter((l) => l.status === "valid");
      if (!validLinks.length) {
        toast.warning("Vui lòng nhập và kiểm tra ít nhất 1 liên kết nhóm Facebook hợp lệ.");
        return;
      }
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
    setPausing(false);
    setAborting(false);
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
        `Bắt đầu thực thi: ${selectedUids.length} nick, ${wordList.length} từ khóa…`,
        "info",
      );
    } else if (method === "link") {
      const validLinks = (parsedLinks || []).filter((l) => l.status === "valid");
      pushLog(
        `Bắt đầu thực thi: ${selectedUids.length} nick, ${validLinks.length} link nhóm…`,
        "info",
      );
    } else {
      const validCnt = (fileData?.rows || []).filter((r) => r.status === "valid").length;
      pushLog(
        `Bắt đầu thực thi: ${selectedUids.length} nick, ${validCnt} link nhóm từ tệp ${fileData?.name || ""}…`,
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
    if (!checkJobId || runState !== "running" || pausing) return;
    setPausing(true);
    try {
      const res = await controlScanJob({ jobId: checkJobId, action: "pause" });
      setRunState("paused");
      toast.info(res?.message || "Đã gửi lệnh tạm dừng.");
      pushLog(res?.message || "Đã gửi lệnh tạm dừng.", "warn");
    } catch (error) {
      toast.error(error.message || "Không tạm dừng được.");
    } finally {
      setPausing(false);
    }
  };

  const resumeRun = async () => {
    if (!checkJobId || runState !== "paused" || resuming) return;
    setResuming(true);
    try {
      const res = await controlScanJob({ jobId: checkJobId, action: "resume" });
      setRunState("running");
      toast.success(res?.message || "Đang tiếp tục quét…");
      pushLog(res?.message || "▶️ Đã gửi lệnh tiếp tục quét.", "info");
    } catch (error) {
      toast.error(error.message || "Không tiếp tục được phiên quét.");
    } finally {
      setResuming(false);
    }
  };

  const abortRun = async () => {
    if (!checkJobId || (runState !== "running" && runState !== "paused") || aborting) return;
    setAborting(true);
    try {
      const res = await controlScanJob({ jobId: checkJobId, action: "abort" });
      toast.warning(res?.message || "Đang dừng khẩn cấp…");
      pushLog(res?.message || "Đã gửi dừng khẩn cấp.", "warn");
    } catch (error) {
      toast.error(error.message || "Không dừng được.");
    } finally {
      setAborting(false);
    }
  };

  const handlePrimaryAction = async () => {
    if (runState === "paused" && checkJobId) {
      await resumeRun();
    } else {
      await startRun();
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
      if (!q) return true;
      return `${row.name || ""} ${row.url || ""} ${row.keyword || ""}`.toLowerCase().includes(q);
    });
  }, [results, resultQuery, filterMembers, filterKeyword]);

  const exportFile = async (format = "xlsx") => {
    const rows = selectedRows.size
      ? filteredResults.filter((row) => selectedRows.has(row.id))
      : filteredResults;
    if (!rows.length) {
      toast.warning("Chưa có nhóm để xuất. Quét hoặc chọn dòng trước.");
      return;
    }
    try {
      const table = groupExportTable(rows);
      const fileName = await downloadTable({ format, baseName: "Ket_qua_quet_nhom", sheetName: "Nhom", ...table });
      toast.success(`Đã xuất ${rows.length} nhóm ra file: ${fileName}`);
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
        <ModulePageHeader navId="scan.info" />
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
            onRunKeywordCheck={() => runKeywordCheck()}
            onRecheckKeyword={(word) => runKeywordCheck([word])}
            checkingKeywords={checkingKeywords}
            onStopKeywordCheck={stopKeywordCheck}
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
            delayMin={delayMin}
            onDelayMinChange={setDelayMin}
            delayMax={delayMax}
            onDelayMaxChange={setDelayMax}
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
            onClick={handlePrimaryAction}
            disabled={runState === "running" || pausing || aborting || resuming || checkingKeywords}
            title={checkingKeywords ? "Đang kiểm tra từ khóa — chờ xong hoặc dừng kiểm tra trước" : undefined}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] text-sm font-bold tracking-wide text-white hover:bg-blue-600 disabled:opacity-60"
          >
            {runState === "running" || resuming ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <IconPlay color="#fff" />
            )}
            {runState === "running"
              ? "ĐANG QUÉT…"
              : resuming
              ? "ĐANG TIẾP TỤC…"
              : runState === "paused"
              ? "TIẾP TỤC QUÉT"
              : "BẮT ĐẦU THỰC THI"}
          </button>
          {/* Tạm dừng / Dừng khẩn cấp chỉ hiện khi đã bấm Bắt đầu thực thi (đang chạy hoặc tạm dừng). */}
          {(running || pausing || aborting || resuming) && (
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={runState !== "running" || pausing || aborting}
              onClick={pauseRun}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#FECACA] bg-white text-sm font-bold tracking-wide text-[#DC2626] disabled:opacity-40"
            >
              {pausing ? <Loader2 className="size-4 animate-spin text-[#DC2626]" /> : <IconPause color="#DC2626" />}
              {pausing ? "ĐANG TẠM DỪNG…" : "TẠM DỪNG"}
            </button>
            <button
              type="button"
              disabled={(runState !== "running" && runState !== "paused") || aborting || pausing}
              onClick={abortRun}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#EF4444] text-sm font-bold tracking-wide text-white disabled:opacity-40"
            >
              {aborting ? <Loader2 className="size-4 animate-spin text-white" /> : <IconStop color="#fff" />}
              {aborting ? "ĐANG DỪNG KHẨN CẤP…" : "DỪNG KHẨN CẤP"}
            </button>
          </div>
          )}
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
          filterMembers={filterMembers}
          onFilterMembersChange={setFilterMembers}
          filterKeyword={filterKeyword}
          onFilterKeywordChange={setFilterKeyword}
          keywordOptions={keywordOptions}
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
