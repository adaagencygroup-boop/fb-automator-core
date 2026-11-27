"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CloudUpload, Download, FileText, History, Link2, Loader2, MessageCircle, Pause, Play, RotateCcw, Share2, Square, ThumbsUp, Trash2,
  Upload, Users, X,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { getSessionUserId } from "@/services/sessionIdentity.mjs";
import AccountSelectModal, { isScanReady } from "../components/AccountSelectModal";
import DelayRangeInput, { normalizeDelayRange } from "../components/DelayRangeInput";
import LiveConsole from "../components/LiveConsole";
import ModulePageHeader from "../components/ModulePageHeader";
import ResultsExplorer from "../components/ResultsExplorer";
import useRowMultiSelect from "../components/useRowMultiSelect";
import { INT_INPUT_PROPS, blockNonDigitKey, digitsOnly } from "../utils/intInput";
import { loadInputDraft, saveInputDraft } from "../utils/inputDraft.mjs";
import { downloadLinkTemplate } from "../utils/exportTable";
import { parseLinkRows, readLinkFile, shortLink, splitTextRows } from "../utils/postLinks";
import {
  controlScan, getAccounts, getActiveCheck, getActiveScan, getCheckStatus, getResumableSession, getScanStatus, lookupPosts,
  resumeSession, startCheck, startScan, stopCheck,
} from "../service";

const MAX_POSTS = 20;
// Không có ô Share: Facebook chỉ cho xem tổng số lượt chia sẻ, không cho xem ai đã chia sẻ
const LIMITS = { like: 10000, comment: 5000 };
const nf = (n) => Number(n || 0).toLocaleString("vi-VN");
const draftKey = () => {
  const uid = getSessionUserId();
  return uid ? `${uid}:engage-scan` : "";
};
// Ô số lượng: "" (để trống) = quét toàn bộ số hiện có; Facebook ẩn số đếm (null / 0) thì để trống thay vì điền 0
const defaultQuota = (meta) => {
  const pick = (count, max) => (Number(count) > 0 ? Math.min(max, Number(count)) : "");
  return { like: pick(meta?.fb_like_count, LIMITS.like), comment: pick(meta?.fb_comment_count, LIMITS.comment) };
};
const isBlank = (v) => v === "" || v === null || v === undefined;
const quotaValue = (v) => (isBlank(v) ? null : Number(v)); // null gửi lên Engine = quét toàn bộ
const countText = (n) => (n === null || n === undefined ? "?" : nf(n)); // ? = Facebook không cho biết số
const SOURCE_TEXT = { group: "Nhóm", page: "Page", profile: "Cá nhân" };

function StatusBadge({ status }) {
  const map = {
    valid: ["Hợp lệ", "bg-[#ECFDF5] border-[#A7F3D0] text-[#059669]"],
    duplicate: ["Trùng lặp", "bg-[#FFFBEB] border-[#FDE68A] text-[#D97706]"],
    invalid: ["Sai định dạng", "bg-[#FEF2F2] border-[#FECACA] text-[#DC2626]"],
    checking: ["Đang kiểm tra", "bg-[#EFF6FF] border-[#BFDBFE] text-[#2563EB]"],
    incomplete: ["Chưa kiểm tra xong", "bg-[#FFFBEB] border-[#FDE68A] text-[#B45309]"],
    available: ["Khả dụng", "bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]"],
    unavailable: ["Không khả dụng", "bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]"],
    over: ["Vượt 20 bài", "bg-slate-100 border-slate-200 text-slate-500"],
    error: ["Lỗi kiểm tra", "bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]"],
  };
  const [label, cls] = map[status] || map.valid;
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>;
}

function QuotaInput({ value, onChange, max, tone, label, disabled }) {
  const tones = {
    like: "border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]",
    comment: "border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]",
  };
  return (
    <label className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-[11px] font-semibold ${tones[tone]}`}>
      {label}
      <input
        {...INT_INPUT_PROPS}
        disabled={disabled}
        value={value}
        onKeyDown={blockNonDigitKey}
        onChange={(e) => {
          const d = digitsOnly(e.target.value);
          onChange(d === "" ? "" : Math.min(max, Number(d)));
        }}
        className="w-14 bg-transparent text-right text-[13px] font-bold text-[#0F172A] outline-none disabled:opacity-60"
      />
    </label>
  );
}

export default function PostEngagementScanPage() {
  const [draft] = useState(() => loadInputDraft(draftKey()) || {});

  // ---- Tài khoản
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedUids, setSelectedUids] = useState(() => draft.selectedUids || []);

  // ---- Link bài viết
  const [method, setMethod] = useState(draft.method || "link");
  const [linkText, setLinkText] = useState(draft.linkText || "");
  const [file, setFile] = useState(draft.file || null); // {name, size, rows}
  const [removed, setRemoved] = useState(() => new Set(draft.removed || []));
  const [checked, setChecked] = useState(draft.checked || {}); // post_key → {status, meta}
  const [quotas, setQuotas] = useState(draft.quotas || {}); // post_key → {like, comment}
  // Bài khả dụng KHÔNG tick ở bảng xem trước (mặc định mọi bài khả dụng đều tick; chỉ bài được tick mới quét)
  const [unselected, setUnselected] = useState(() => new Set(draft.unselected || []));
  const [delayMin, setDelayMin] = useState(draft.delayMin ?? 5);
  const [delayMax, setDelayMax] = useState(draft.delayMax ?? 10);

  // ---- Phiên
  const [checkJobId, setCheckJobId] = useState("");
  const [scanJobId, setScanJobId] = useState("");
  const [scanStatus, setScanStatus] = useState("idle"); // idle | running | paused | stopping | done | aborted | error
  const [logs, setLogs] = useState([]);
  const [sessionKeys, setSessionKeys] = useState(draft.sessionKeys || []);
  // Phiên quét vừa kết thúc → dọn danh sách link khi về màn cấu hình: {unfinished: [post_key chưa quét xong]}
  const [pendingCleanup, setPendingCleanup] = useState(draft.pendingCleanup || null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [resumable, setResumable] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);

  // Màn hình theo bước (giống Tab 1 Module 03): config → chưa bấm gì; check → đã bấm Kiểm tra (hiện terminal);
  // scan → đã bấm Bắt đầu thực thi / Chạy tiếp (hiện thêm Kết quả quét, khoá cấu hình tới khi "Quay về cấu hình ban đầu")
  const [view, setView] = useState("config");
  const running = ["running", "paused", "stopping"].includes(scanStatus);
  const checking = Boolean(checkJobId);
  const locked = running || checking || view === "scan";

  useEffect(() => {
    saveInputDraft(draftKey(), {
      selectedUids, method, linkText, file, removed: [...removed], checked, quotas, unselected: [...unselected],
      delayMin, delayMax, sessionKeys, pendingCleanup,
    });
  }, [selectedUids, method, linkText, file, removed, checked, quotas, unselected, delayMin, delayMax, sessionKeys, pendingCleanup]);

  // ---- Tải tài khoản Module 2
  const loadAccounts = useCallback(async ({ fresh = false } = {}) => {
    setAccountsLoading(true);
    try {
      setAccounts(await getAccounts({ fresh }));
      return true;
    } catch (err) {
      toast.error(err?.message || "Không tải được danh sách tài khoản.");
      return false;
    } finally {
      setAccountsLoading(false);
    }
  }, []);
  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);
  const readyCount = useMemo(() => accounts.filter(isScanReady).length, [accounts]);
  const validSelected = useMemo(() => {
    const ok = new Set(accounts.filter(isScanReady).map((a) => a.uid));
    return accounts.length ? selectedUids.filter((u) => ok.has(u)) : selectedUids;
  }, [accounts, selectedUids]);

  // ---- Danh sách link (ô dán hoặc tệp) → bảng xem trước
  const parsed = useMemo(() => {
    const rows = method === "file" ? file?.rows || [] : splitTextRows(linkText);
    return parseLinkRows(rows, { maxLinks: 500 });
  }, [method, file, linkText]);

  const previewRows = useMemo(() => {
    let validIdx = 0;
    return parsed.rows
      .filter((r) => !(r.post_key && removed.has(r.post_key)))
      .map((r, i) => {
        let status = r.status;
        if (status === "valid") {
          validIdx += 1;
          if (validIdx > MAX_POSTS) status = "over";
          else if (checked[r.post_key]?.status) status = checked[r.post_key].status;
        }
        return { ...r, id: `${r.post_key || "x"}-${i}`, view: status };
      });
  }, [parsed, removed, checked]);

  const targets = useMemo(
    () => previewRows.filter((r) => ["valid", "checking", "incomplete", "available", "unavailable", "error"].includes(r.view)),
    [previewRows],
  );
  const available = useMemo(() => targets.filter((r) => r.view === "available"), [targets]);
  // Bảng xem trước (khung 3) chỉ hiện bài ĐÃ KIỂM TRA: khả dụng + không khả dụng (mờ, để biết bài bị loại);
  // link chưa / đang / dở / lỗi kiểm tra chỉ thấy ở bảng link (khung 1)
  const checkedTargets = useMemo(() => targets.filter((r) => r.view === "available" || r.view === "unavailable"), [targets]);
  const picked = useMemo(() => available.filter((r) => !unselected.has(r.post_key)), [available, unselected]);
  const pickedKeys = useMemo(() => new Set(picked.map((r) => r.post_key)), [picked]);
  // "Chưa kiểm tra xong" (dừng Kiểm tra giữa chừng / rời màn hình) cũng phải Kiểm tra lại trước khi chạy
  const uncheckedCount = targets.filter((r) => ["valid", "error", "incomplete"].includes(r.view)).length;

  /**
   * Dọn danh sách link sau phiên quét (bấm "Quay về cấu hình ban đầu" hoặc mở lại trang sau khi phiên đã kết thúc):
   * bỏ bài đã quét xong / không khả dụng / đã kiểm tra mà không đưa vào phiên, link trùng / sai định dạng; GIỮ bài chưa
   * quét xong (Dừng khẩn cấp / lỗi giữa chừng) và bài chưa tới lượt (quá 20 bài, chưa kiểm tra). Không còn gì → rỗng.
   * Tài khoản, Delay, cách nhập giữ nguyên.
   */
  const applyCleanup = (cleanup) => {
    setPendingCleanup(null);
    if (!cleanup) return;
    const unfinished = new Set(cleanup.unfinished || []);
    const keep = previewRows.filter(
      (r) => r.post_key && !["duplicate", "invalid"].includes(r.view) && (unfinished.has(r.post_key) || !["available", "unavailable"].includes(r.view)),
    );
    const keepKeys = new Set(keep.map((r) => r.post_key));
    const pick = (obj) => Object.fromEntries(Object.entries(obj).filter(([key]) => keepKeys.has(key)));
    setRemoved(new Set());
    setUnselected(new Set());
    setChecked((cur) => pick(cur));
    setQuotas((cur) => pick(cur));
    if (!keep.length) {
      setLinkText("");
      setFile(null);
      return;
    }
    const lines = keep.map((r) => r.raw || r.url);
    if (method === "file" && file) setFile({ ...file, rows: lines });
    else setLinkText(lines.join("\n"));
    toast.info(`Giữ lại ${keep.length} bài chưa quét xong trong danh sách link.`);
  };

  const applyCleanupRef = useRef(applyCleanup);
  applyCleanupRef.current = applyCleanup;

  const backToConfig = () => {
    setView("config");
    setScanJobId("");
    setScanStatus("idle");
    setLogs([]);
    applyCleanup(pendingCleanup);
  };

  const totals = useMemo(() => picked.reduce((acc, r) => {
    const q = quotas[r.post_key] || defaultQuota(checked[r.post_key]?.meta);
    if (isBlank(q.like)) acc.likeAll = true;
    else acc.like += Number(q.like);
    if (isBlank(q.comment)) acc.commentAll = true;
    else acc.comment += Number(q.comment);
    return acc;
  }, { like: 0, comment: 0, likeAll: false, commentAll: false }), [picked, quotas, checked]);

  // Tick chọn bài ở bảng xem trước: kéo chuột bôi đen · Shift + click chọn khoảng · Ctrl + click thêm / bỏ từng bài
  const setPicked = (nextKeys) =>
    setUnselected((cur) => {
      const next = new Set(cur);
      available.forEach((r) => (nextKeys.has(r.post_key) ? next.delete(r.post_key) : next.add(r.post_key)));
      return next;
    });
  const togglePicked = (key) => {
    const next = new Set(pickedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  };
  const allPicked = available.length > 0 && picked.length === available.length;
  const { setContainer: setPreviewBox, rowProps: previewRowProps } = useRowMultiSelect({
    rows: available,
    selected: pickedKeys,
    onChange: setPicked,
    getId: (r) => r.post_key,
  });

  // Bài còn "Đang kiểm tra" (keys = null → mọi bài) chuyển sang "Chưa kiểm tra xong" để phải Kiểm tra lại
  const markIncomplete = useCallback((keys) => {
    setChecked((cur) => {
      const pick = keys || Object.keys(cur).filter((key) => cur[key]?.status === "checking");
      if (!pick.length) return cur;
      const next = { ...cur };
      pick.forEach((key) => {
        if (next[key]?.status === "checking" || keys) next[key] = { status: "incomplete" };
      });
      return next;
    });
  }, []);

  // ---- Khôi phục kết quả Kiểm tra đã lưu cho các link (mở lại trang / dán lại link cũ)
  useEffect(() => {
    const missing = targets.filter((r) => !checked[r.post_key]).map((r) => r.post_key);
    if (!missing.length) return undefined;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await lookupPosts(missing);
        if (cancelled) return;
        const found = res?.posts || {};
        const add = {};
        Object.entries(found).forEach(([key, p]) => {
          if (p.checked_at) add[key] = { status: p.availability === "unavailable" ? "unavailable" : "available", meta: p };
        });
        if (Object.keys(add).length) setChecked((cur) => ({ ...add, ...cur }));
      } catch {
        /* Engine chưa sẵn sàng — bấm Kiểm tra sẽ lấy lại */
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [targets, checked]);

  // ---- Gắn lại phiên đang chạy (chuyển màn khác rồi quay lại / tải lại trang)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, c] = await Promise.all([getActiveScan(), getActiveCheck()]);
        if (!alive) return;
        if (s?.job_id) {
          setScanJobId(s.job_id);
          setScanStatus("running");
          setView("scan");
        } else if (c?.job_id) {
          setCheckJobId(c.job_id);
          setView("check");
        }
        // Nháp cũ còn bài "Đang kiểm tra" mà không còn phiên Kiểm tra nào chạy → Chưa kiểm tra xong
        if (!c?.job_id) markIncomplete(null);
        if (!s?.job_id && draft.pendingCleanup) applyCleanupRef.current(draft.pendingCleanup);
        if (!s?.job_id) setResumable(await getResumableSession());
      } catch {
        /* bỏ qua */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ---- Theo dõi phiên Kiểm tra
  useEffect(() => {
    if (!checkJobId) return undefined;
    let stopped = false;
    const tick = async () => {
      try {
        const job = await getCheckStatus(checkJobId);
        if (stopped || !job) return;
        setLogs(job.logs || []);
        const next = {};
        Object.entries(job.progress || {}).forEach(([key, p]) => {
          if (p.status === "done") next[key] = { status: "available", meta: p.meta };
          else if (p.status === "unavailable") next[key] = { status: "unavailable", meta: p.meta };
          else if (p.status === "error") next[key] = { status: "error", meta: p.meta };
          else next[key] = { status: "checking" };
        });
        setChecked((cur) => ({ ...cur, ...next }));
        setQuotas((cur) => {
          const q = { ...cur };
          Object.entries(next).forEach(([key, v]) => {
            if (v.status === "available" && !q[key]) q[key] = defaultQuota(v.meta);
          });
          return q;
        });
        if (["done", "aborted", "error"].includes(job.status)) {
          stopped = true;
          setCheckJobId("");
          // Dừng Kiểm tra giữa chừng: bài chưa tới lượt / đang mở dở không được kẹt mãi ở "Đang kiểm tra"
          markIncomplete(Object.keys(next).filter((key) => next[key].status === "checking"));
          const okN = Object.values(next).filter((v) => v.status === "available").length;
          const badN = Object.values(next).filter((v) => v.status === "unavailable").length;
          if (job.status === "done") toast.success(`Kiểm tra xong: ${okN} bài khả dụng${badN ? `, ${badN} bài không khả dụng` : ""}.`);
          else toast.warning(job.error || "Đã dừng kiểm tra bài viết.");
        }
      } catch (err) {
        if (err?.status === 404) {
          // Phiên Kiểm tra không còn (Engine khởi động lại / đã dọn): bài còn "Đang kiểm tra" → Chưa kiểm tra xong
          stopped = true;
          setCheckJobId("");
          markIncomplete(null);
        }
      }
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [checkJobId]);

  // ---- Theo dõi phiên Quét
  useEffect(() => {
    if (!scanJobId) return undefined;
    let stopped = false;
    const tick = async () => {
      try {
        const job = await getScanStatus(scanJobId);
        if (stopped || !job) return;
        setLogs(job.logs || []);
        setSessionKeys((cur) => {
          const keys = (job.posts || []).map((p) => p.post_key);
          return cur.join(",") === keys.join(",") ? cur : keys;
        });
        setScanStatus(job.status);
        if (["done", "aborted", "error"].includes(job.status)) {
          stopped = true;
          // Ghi nhớ bài chưa quét xong để dọn danh sách link khi về màn cấu hình (lưu cả vào nháp: tải lại trang vẫn dọn)
          const progress = job.progress || {};
          const unfinished = job.status === "done" ? [] : (job.posts || []).map((p) => p.post_key)
            .filter((key) => !["done", "unavailable"].includes(progress[key]?.status));
          setPendingCleanup({ unfinished });
          setRefreshKey((k) => k + 1);
          if (job.status === "done") toast.success("Đã quét xong toàn bộ bài viết.");
          else if (job.status === "aborted") toast.warning(job.error ? `${job.error}.` : "Đã dừng phiên quét — dữ liệu đã quét vẫn được lưu.");
          else toast.error(job.error || "Phiên quét gặp lỗi.");
          getResumableSession().then(setResumable).catch(() => {});
        }
      } catch (err) {
        if (err?.status === 404) {
          stopped = true;
          setScanStatus("idle");
          setScanJobId("");
        }
      }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [scanJobId]);

  // ---- Hành động
  const onPickFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (!["txt", "csv", "xlsx", "xls"].includes(ext)) {
      toast.error("Chỉ hỗ trợ tệp .txt, .csv, .xlsx, .xls.");
      return;
    }
    try {
      const rows = await readLinkFile(f);
      const res = parseLinkRows(rows, { maxLinks: 500 });
      const ok = res.rows.filter((r) => r.status === "valid").length;
      setFile({ name: f.name, size: `${(f.size / 1024).toFixed(1)} KB`, rows });
      setRemoved(new Set());
      if (!ok) toast.error(`Tệp «${f.name}» không có link bài viết Facebook hợp lệ nào.`);
      else toast.success(`Đã đọc tệp ${f.name}: ${ok} link bài viết hợp lệ.`);
    } catch (err) {
      toast.error(`Lỗi đọc tệp: ${err?.message || "định dạng không hỗ trợ"}`);
    }
  };

  const clearAll = () => {
    setLinkText("");
    setFile(null);
    setRemoved(new Set());
    toast.info("Đã xoá toàn bộ link.");
  };

  const removeRow = (row) => {
    if (row.post_key) setRemoved((cur) => new Set([...cur, row.post_key]));
  };

  const runCheck = async () => {
    if (!validSelected.length) {
      toast.warning("Chọn ít nhất 1 tài khoản Facebook đã đăng nhập (Module 2).");
      setPickerOpen(true);
      return;
    }
    const links = targets.map((r) => r.url);
    if (!links.length) {
      toast.warning("Dán hoặc tải lên ít nhất 1 link bài viết Facebook hợp lệ.");
      return;
    }
    const dup = previewRows.filter((r) => r.view === "duplicate").length;
    const bad = previewRows.filter((r) => r.view === "invalid").length;
    try {
      setBusy(true);
      const res = await startCheck(validSelected, links);
      setChecked((cur) => {
        const next = { ...cur };
        (res?.posts || []).forEach((p) => {
          next[p.post_key] = { status: "checking" };
        });
        return next;
      });
      setCheckJobId(res.job_id);
      setLogs([]);
      setView("check");
      toast.info(`Đang mở Chrome kiểm tra ${links.length} bài viết${dup ? ` (bỏ ${dup} link trùng)` : ""}${bad ? `, ${bad} dòng sai định dạng` : ""}…`);
    } catch (err) {
      toast.error(err?.message || "Không bắt đầu được Kiểm tra.");
    } finally {
      setBusy(false);
    }
  };

  const runScan = async () => {
    if (!validSelected.length) {
      toast.warning("Chọn ít nhất 1 tài khoản Facebook đã đăng nhập (Module 2).");
      setPickerOpen(true);
      return;
    }
    if (uncheckedCount > 0) {
      toast.warning(`Bấm Kiểm tra & Lọc trùng lặp trước — còn ${uncheckedCount} bài chưa kiểm tra.`);
      return;
    }
    const posts = picked.map((r) => {
      const q = quotas[r.post_key] || defaultQuota(checked[r.post_key]?.meta);
      return {
        post_url: r.url,
        like_quota: quotaValue(q.like),
        comment_quota: quotaValue(q.comment),
        title: (checked[r.post_key]?.meta?.content || "").slice(0, 120),
      };
    }).filter((p) => p.like_quota !== 0 || p.comment_quota !== 0); // bỏ bài nhập 0 cả hai ô (để trống = quét toàn bộ)
    if (!posts.length) {
      toast.warning("Chưa có bài khả dụng nào có số lượng quét lớn hơn 0.");
      return;
    }
    const delay = normalizeDelayRange(delayMin, delayMax);
    try {
      setBusy(true);
      const res = await startScan({ uids: validSelected, posts, delayMin: delay.min, delayMax: delay.max });
      setSessionKeys((res?.posts || []).map((p) => p.post_key));
      setLogs([]);
      setPendingCleanup(null);
      setScanStatus("running");
      setScanJobId(res.job_id);
      setResumable(null);
      setView("scan");
      toast.success(`Bắt đầu quét ${posts.length} bài viết với ${validSelected.length} tài khoản.`);
    } catch (err) {
      toast.error(err?.message || "Không bắt đầu được phiên quét.");
    } finally {
      setBusy(false);
    }
  };

  const control = async (action) => {
    if (!scanJobId) return;
    try {
      await controlScan(scanJobId, action);
      setScanStatus(action === "pause" ? "paused" : action === "resume" ? "running" : "stopping");
      if (action === "abort") toast.info("Đang dừng — Chrome sẽ đóng sau vài giây, dữ liệu đã quét vẫn được lưu.");
    } catch (err) {
      toast.error(err?.message || "Không gửi được lệnh.");
    }
  };

  const doResume = async () => {
    if (!resumable) return;
    try {
      setBusy(true);
      const res = await resumeSession(resumable.session_id);
      setSessionKeys((res?.posts || []).map((p) => p.post_key));
      setLogs([]);
      setPendingCleanup(null);
      setScanStatus("running");
      setScanJobId(res.job_id);
      setResumable(null);
      setView("scan");
      toast.success(`Đang chạy tiếp ${res?.remaining || ""} bài còn thiếu của phiên trước.`);
    } catch (err) {
      toast.error(err?.message || "Không chạy tiếp được phiên này.");
    } finally {
      setBusy(false);
    }
  };

  const validCount = previewRows.filter((r) => r.view !== "duplicate" && r.view !== "invalid" && r.view !== "over").length;

  return (
    <div className="-m-6 min-h-full space-y-5 bg-[#F4F7FC] p-6">
      <ModulePageHeader navId="engage.scan" />

      {resumable && !running && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-start gap-3">
            <History className="mt-0.5 size-5 text-amber-600" />
            <div>
              <p className="text-sm font-semibold text-amber-900">
                Phiên quét trước {resumable.status === "ABORTED" ? "đã dừng giữa chừng" : "bị gián đoạn (app hoặc Engine tắt)"}
              </p>
              <p className="text-xs text-amber-800">
                {resumable.startTime ? `Bắt đầu lúc ${resumable.startTime} · ` : ""}còn {resumable.remaining} bài chưa quét xong — bấm Chạy tiếp để quét
                nốt (tài khoản đã có tự bỏ qua).
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={doResume} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60">
              <Play className="size-3.5" /> Chạy tiếp
            </button>
            <button type="button" onClick={() => setResumable(null)} className="rounded-lg p-1.5 text-amber-700 hover:bg-amber-100">
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* -------------------- Card 1 -------------------- */}
        <section className="rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <h2 className="flex items-center gap-2.5 text-[15px] font-bold text-[#0F172A]">
            <span className="flex size-6 items-center justify-center rounded-full bg-[#2563EB] text-xs font-bold text-white">1</span>
            Cấu hình chung, Chọn tài khoản &amp; Bài viết quét
          </h2>

          <p className="mt-5 text-[13px] font-medium text-[#334155]">Tài khoản Facebook thực thi:</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" disabled={locked} onClick={() => setPickerOpen(true)}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#2563EB] px-4 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
              <Users className="size-4" /> Chọn tài khoản
            </button>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-1 text-xs font-semibold text-[#047857]">
              <span className="size-1.5 rounded-full bg-[#10B981]" /> Đã chọn: {validSelected.length} tài khoản
            </span>
            {validSelected.length > 0 && validSelected.length < 3 && (
              <span className="text-[11px] text-amber-600">
                Khuyến nghị chọn từ 3 đến 5 tài khoản để chạy song song an toàn và không bị gián đoạn phiên quét.
              </span>
            )}
          </div>

          <p className="mt-5 text-[13px] font-medium text-[#334155]">Phương thức quét</p>
          <div className="mt-2 inline-flex rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-1">
            {[
              { id: "link", label: "Nhập Link", Icon: Link2 },
              { id: "file", label: "Tải tệp (.txt / .csv / .xlsx)", Icon: FileText },
            ].map(({ id, label, Icon }) => (
              <button key={id} type="button" disabled={locked} onClick={() => setMethod(id)}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors ${
                  method === id ? "bg-[#2563EB] text-white shadow-sm" : "text-[#475569] hover:text-[#0F172A]"}`}>
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>

          {method === "link" ? (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-[#334155]">Dán danh sách liên kết bài viết</span>
                <span className="rounded-lg bg-[#EFF6FF] px-2.5 py-1 text-xs font-semibold text-[#2563EB]">Đã nhận diện: {validCount} link</span>
              </div>
              <textarea
                value={linkText}
                disabled={locked}
                onChange={(e) => {
                  setLinkText(e.target.value);
                  setRemoved(new Set());
                }}
                rows={5}
                placeholder={"https://www.facebook.com/groups/109283749210/posts/123456789012345/\nhttps://www.facebook.com/tenfanpage/posts/pfbid0…\nMỗi dòng 1 link bài viết (tối đa 20 bài / phiên)"}
                className="w-full resize-y rounded-xl border border-[#CBD5E1] bg-white p-3 font-mono text-xs leading-relaxed text-[#0F172A] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] disabled:bg-slate-50"
              />
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-[#334155]">Tải tệp danh sách link bài viết</span>
                <span className="flex items-center gap-1.5 text-[11px] text-[#64748B]">
                  Tải file mẫu:
                  {["xlsx", "csv", "txt"].map((f) => (
                    <button key={f} type="button" onClick={() => downloadLinkTemplate(f)}
                      className="inline-flex items-center gap-1 rounded-md border border-[#E2E8F0] px-2 py-1 font-semibold text-[#2563EB] hover:bg-[#EFF6FF]">
                      <Download className="size-3" /> {f === "xlsx" ? "Excel" : f.toUpperCase()}
                    </button>
                  ))}
                </span>
              </div>
              <button type="button" disabled={locked} onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-4 py-6 text-center hover:border-[#2563EB] disabled:opacity-60">
                <CloudUpload className="size-7 text-[#2563EB]" />
                <span className="text-[13px] font-semibold text-[#0F172A]">Bấm để chọn tệp <span className="text-[#2563EB]">.txt / .csv / .xlsx</span></span>
                <span className="text-[11px] text-[#94A3B8]">Mỗi dòng 1 link bài viết Facebook. Dòng tiêu đề được tự bỏ qua.</span>
              </button>
              <input ref={fileInputRef} type="file" accept=".txt,.csv,.xlsx,.xls" className="hidden" onChange={onPickFile} />
              {file && (
                <div className="flex items-center justify-between rounded-xl border border-[#E2E8F0] px-4 py-2.5">
                  <span className="flex items-center gap-2 text-[13px] text-[#0F172A]">
                    <Upload className="size-4 text-[#2563EB]" /> {file.name} <span className="text-xs text-slate-400">{file.size}</span>
                  </span>
                  <button type="button" disabled={locked} onClick={() => setFile(null)} className="rounded p-1 text-slate-400 hover:text-rose-600">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between">
            <button type="button" disabled={locked} onClick={clearAll}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#EF4444] hover:text-[#DC2626] disabled:opacity-50">
              <Trash2 className="size-4" /> Xóa tất cả
            </button>
            <button type="button" disabled={locked || busy || !targets.length} onClick={runCheck}
              title="Bỏ link trùng / sai định dạng, mở Chrome lấy nội dung, nguồn và số tương tác hiện tại của từng bài"
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#2563EB] px-4 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
              {checking && <Loader2 className="size-4 animate-spin" />}
              Kiểm tra &amp; Lọc trùng lặp
            </button>
          </div>
          {checking && (
            <div className="mt-2 flex justify-end">
              <button type="button" onClick={() => stopCheck(checkJobId).catch(() => {})} className="text-xs font-semibold text-rose-600 hover:underline">
                Dừng kiểm tra
              </button>
            </div>
          )}

          <div className="mt-4 overflow-hidden rounded-xl border border-[#F1F5F9]">
            <p className="bg-[#F8FAFC] px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-[#334155]">
              Xem trước danh sách link đã nhập ({previewRows.length} link)
            </p>
            <div className="max-h-[260px] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-white text-[11px] font-bold text-[#64748B]">
                  <tr className="border-b border-[#F1F5F9]">
                    <th className="w-12 px-3 py-2 text-center">STT</th>
                    <th className="px-3 py-2">Đường dẫn bài viết</th>
                    <th className="w-28 px-3 py-2 text-center">Trạng thái</th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {previewRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-[#94A3B8]">
                        Chưa có liên kết nào. Hãy dán link hoặc tải tệp rồi bấm Kiểm tra &amp; Lọc trùng lặp.
                      </td>
                    </tr>
                  ) : (
                    previewRows.map((r, i) => (
                      <tr key={r.id} className="border-t border-[#F1F5F9]">
                        <td className="px-3 py-2 text-center font-mono text-[#94A3B8]">{i + 1}</td>
                        <td className="max-w-[360px] px-3 py-2">
                          <span className="block truncate font-mono text-[#2563EB]" title={r.url || r.raw}>
                            {shortLink(r.url || r.raw, 56)}
                          </span>
                          {r.reason && <span className="text-[10px] text-rose-500">{r.reason}</span>}
                        </td>
                        <td className="px-3 py-2 text-center"><StatusBadge status={r.view} /></td>
                        <td className="px-2 py-2 text-center">
                          {r.post_key && !locked && (
                            <button type="button" onClick={() => removeRow(r)} title="Bỏ link này"
                              className="rounded p-1 text-[#94A3B8] hover:bg-rose-50 hover:text-[#EF4444]">
                              <X className="size-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* -------------------- Card 2 -------------------- */}
        <section className="rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <h2 className="flex items-center gap-2.5 text-[15px] font-bold text-[#0F172A]">
            <span className="flex size-6 items-center justify-center rounded-full bg-[#2563EB] text-xs font-bold text-white">2</span>
            Cấu hình quét nâng cao &amp; Giới hạn
          </h2>
          <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
            <span className="pt-1.5 text-[13px] font-medium text-[#334155]">Khoảng cách giữa các lần quét:</span>
            <DelayRangeInput min={Number(delayMin) || 3} max={Number(delayMax) || 3} onChange={(lo, hi) => {
              setDelayMin(lo);
              setDelayMax(hi);
            }} />
          </div>
          <ul className="mt-5 space-y-2 rounded-xl border border-[#DBEAFE] bg-[#EFF6FF] px-4 py-3 text-xs leading-5 text-[#1E40AF]">
            <li>• Mỗi nick mở 1 Chrome (tối đa 5 chạy song song), bài viết chia đều cho các nick; nick bị checkpoint / chặn tạm thời tự nhường bài cho nick khác.</li>
            <li>• Nghỉ ngẫu nhiên trong khoảng trên giữa 2 lượt tải danh sách và giữa 2 bài viết.</li>
            <li>• <b>Like:</b> lấy hết người bày tỏ cảm xúc của bài trong nhóm. Bài fanpage / cá nhân: Facebook chỉ cho xem người là bạn bè của nick.</li>
            <li>• <b>Share:</b> Facebook chỉ cho xem tổng số lượt chia sẻ, không cho xem ai đã chia sẻ — chỉ ghi nhận tổng số, không tính vào mức tiềm năng.</li>
            <li>• <b>Bình luận:</b> lấy cả bình luận gốc và trả lời, kèm toàn văn nội dung.</li>
          </ul>
        </section>
      </div>

      {/* -------------------- Card 3: xem trước bài + hạn mức -------------------- */}
      {checkedTargets.length > 0 && (
        <section className="rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2.5 text-[15px] font-bold text-[#0F172A]">
              <span className="flex size-6 items-center justify-center rounded-full bg-[#2563EB] text-xs font-bold text-white">3</span>
              Xem trước danh sách bài viết muốn quét
            </h2>
            <span className="rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-1 text-xs font-semibold text-[#047857]">
              • Đã chọn: {picked.length} / {available.length} bài viết
            </span>
          </div>
          {available.length > 0 && (
            <p className="mt-3 text-[11px] text-[#94A3B8]">
              Chỉ bài được tick mới quét · giữ chuột trái và kéo để chọn nhiều bài · Ctrl + click chọn riêng lẻ · Shift + click chọn cả khoảng.
            </p>
          )}
          <div ref={setPreviewBox} className="mt-2 overflow-x-auto rounded-xl border border-[#E2E8F0]">
            <table className="w-full min-w-[920px] text-left text-[13px]">
              <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-bold uppercase text-[#475569]">
                <tr>
                  <th className="w-10 px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      aria-label="Chọn tất cả bài khả dụng"
                      checked={allPicked}
                      ref={(el) => {
                        if (el) el.indeterminate = picked.length > 0 && !allPicked;
                      }}
                      disabled={locked || !available.length}
                      onChange={() => setPicked(allPicked ? new Set() : new Set(available.map((r) => r.post_key)))}
                      className="size-4 cursor-pointer accent-[#2563EB] disabled:cursor-not-allowed"
                    />
                  </th>
                  <th className="w-12 px-3 py-3">STT</th>
                  <th className="px-3 py-3">Tiêu đề / nội dung bài viết</th>
                  <th className="px-3 py-3">Nguồn đăng</th>
                  <th className="px-3 py-3">Tương tác hiện tại</th>
                  <th className="px-3 py-3">Nhập số lượng quét</th>
                  <th className="w-16 px-3 py-3 text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {checkedTargets.map((r, i) => {
                  const info = checked[r.post_key] || {};
                  const meta = info.meta || {};
                  const q = quotas[r.post_key] || defaultQuota(meta);
                  const setQ = (k, v) => setQuotas((cur) => ({ ...cur, [r.post_key]: { ...(cur[r.post_key] || defaultQuota(meta)), [k]: v } }));
                  const ok = info.status === "available";
                  const on = ok && pickedKeys.has(r.post_key);
                  const pickIdx = ok ? available.indexOf(r) : -1;
                  return (
                    <tr key={r.id} {...(ok && !locked && pickIdx >= 0 ? previewRowProps(r, pickIdx) : {})}
                      className={ok ? `select-none ${locked ? "" : "cursor-pointer"} ${on ? "bg-[#EFF6FF]" : "hover:bg-slate-50/70"}` : "bg-slate-50/60"}>
                      <td className="px-3 py-3 text-center" data-no-row-selection>
                        <input
                          type="checkbox"
                          aria-label="Chọn bài này để quét"
                          checked={on}
                          disabled={locked || !ok}
                          onChange={() => togglePicked(r.post_key)}
                          className="size-4 cursor-pointer accent-[#2563EB] disabled:cursor-not-allowed disabled:opacity-40"
                        />
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-[#94A3B8]">{String(i + 1).padStart(2, "0")}</td>
                      <td className="max-w-[340px] px-3 py-3">
                        <p className="line-clamp-2 font-semibold text-[#0F172A]" title={meta.content}>
                          {meta.content || (info.status === "checking" ? "Đang kiểm tra…" : info.status === "unavailable" ? "Bài viết không khả dụng" : "—")}
                        </p>
                        <a href={r.url} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-[#2563EB] hover:underline">
                          {shortLink(r.url, 52)}
                        </a>
                        {meta.posted_at && <span className="ml-2 text-[11px] text-slate-400">Đăng {meta.posted_at}</span>}
                      </td>
                      <td className="px-3 py-3 text-xs text-[#475569]">
                        {meta.source_name ? (
                          <>
                            <span className="text-slate-400">{SOURCE_TEXT[meta.source_type] || "Nguồn"}:</span> {meta.source_name}
                          </>
                        ) : (
                          <StatusBadge status={info.status || "valid"} />
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-[#475569]">
                        {ok ? (
                          <span className="flex gap-3">
                            <span className="inline-flex items-center gap-1"><ThumbsUp className="size-3.5 text-[#2563EB]" /> {countText(meta.fb_like_count)}</span>
                            <span className="inline-flex items-center gap-1"><MessageCircle className="size-3.5 text-[#059669]" /> {countText(meta.fb_comment_count)}</span>
                            <span className="inline-flex items-center gap-1"><Share2 className="size-3.5 text-[#D97706]" /> {countText(meta.fb_share_count)}</span>
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-3">
                        {ok ? (
                          <div className="flex flex-wrap gap-1.5">
                            <QuotaInput label="Like" tone="like" max={LIMITS.like} value={q.like} disabled={locked} onChange={(v) => setQ("like", v)} />
                            <QuotaInput label="Cmt" tone="comment" max={LIMITS.comment} value={q.comment} disabled={locked} onChange={(v) => setQ("comment", v)} />
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">{info.status === "unavailable" ? "Bỏ qua — bài đã xoá / riêng tư" : "Chờ kiểm tra"}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <button type="button" disabled={locked} onClick={() => removeRow(r)} title="Bỏ bài khỏi hàng đợi (không xoá dữ liệu đã lưu)"
                          className="rounded p-1.5 text-[#94A3B8] hover:bg-rose-50 hover:text-[#EF4444] disabled:opacity-40">
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[13px] text-[#334155]">
            Tổng tương tác dự kiến quét:{" "}
            <b>{totals.likeAll || totals.commentAll ? "toàn bộ" : nf(totals.like + totals.comment)}</b> (
            {totals.likeAll ? "toàn bộ" : nf(totals.like)} Like, {totals.commentAll ? "toàn bộ" : nf(totals.comment)} Cmt) · để trống = quét toàn bộ số hiện có · nhập 0 = không quét loại đó.
          </p>
        </section>
      )}

      {/* -------------------- Nút điều khiển -------------------- */}
      <div className="space-y-2">
        {view === "scan" && !running ? (
          <button type="button" onClick={backToConfig}
            className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl border border-[#2563EB] bg-white text-base font-bold uppercase tracking-wide text-[#2563EB] hover:bg-blue-50">
            <RotateCcw className="size-5" />
            Quay về cấu hình ban đầu
          </button>
        ) : !running ? (
          <button type="button" onClick={runScan} disabled={busy || checking || !picked.length || uncheckedCount > 0}
            title={uncheckedCount > 0 ? "Bấm Kiểm tra & Lọc trùng lặp trước" : !available.length ? "Chưa có bài viết khả dụng" : !picked.length ? "Chọn ít nhất 1 bài viết để quét" : undefined}
            className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-[#2563EB] text-base font-bold uppercase tracking-wide text-white shadow-[0_8px_20px_rgba(37,99,235,0.25)] hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Play className="size-5" />}
            Bắt đầu thực thi
          </button>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            {scanStatus === "paused" ? (
              <button type="button" onClick={() => control("resume")}
                className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-[#2563EB] text-base font-bold uppercase text-white hover:bg-blue-700">
                <Play className="size-5" /> Tiếp tục quét
              </button>
            ) : (
              <button type="button" onClick={() => control("pause")} disabled={scanStatus === "stopping"}
                className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-amber-500 text-base font-bold uppercase text-white hover:bg-amber-600 disabled:opacity-60">
                {scanStatus === "stopping" ? <Loader2 className="size-5 animate-spin" /> : <Pause className="size-5" />}
                {scanStatus === "stopping" ? "Đang dừng…" : "Tạm dừng"}
              </button>
            )}
            <button type="button" onClick={() => control("abort")} disabled={scanStatus === "stopping"}
              className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-rose-600 text-base font-bold uppercase text-white hover:bg-rose-700 disabled:opacity-60">
              <Square className="size-5" /> Dừng khẩn cấp
            </button>
          </div>
        )}
        {!running && uncheckedCount > 0 && targets.length > 0 && (
          <p className="text-center text-xs text-amber-700">
            Bấm <b>Kiểm tra &amp; Lọc trùng lặp</b> trước để biết bài nào khả dụng và có bao nhiêu tương tác — còn {uncheckedCount} bài chưa kiểm tra.
          </p>
        )}
      </div>

      {view === "scan" && (
        <ResultsExplorer
          title="Kết quả quét"
          postKeys={sessionKeys}
          live={running}
          refreshKey={refreshKey}
          emptyText="Chưa có kết quả. Bài đang quét sẽ hiện ở đây và số liệu nhảy theo thời gian thực."
        />
      )}

      {view !== "config" && <LiveConsole logs={logs} sessionId={scanJobId || checkJobId} running={running || checking} />}

      <AccountSelectModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        accounts={accounts}
        loading={accountsLoading}
        selectedUids={selectedUids}
        onRefresh={loadAccounts}
        onConfirm={(uids) => {
          setSelectedUids(uids);
          setPickerOpen(false);
          if (uids.length) toast.success(`Đã chọn ${uids.length} tài khoản thực thi.`);
        }}
      />
      {readyCount === 0 && !accountsLoading && accounts.length > 0 && (
        <p className="text-center text-xs text-rose-600">
          Không tìm thấy tài khoản Facebook Live đủ điều kiện. Vui lòng kiểm tra lại dàn nick tại Module 02.
        </p>
      )}
    </div>
  );
}
