"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2, Copy, Database, Download, ExternalLink, FileSpreadsheet, FileUp, Link2, ListChecks, MessageCircle,
  Save, Search, Share2, ThumbsUp, Trash2, UserPlus, Users, X,
} from "lucide-react";

import CustomSelect from "@/components/ui/custom-select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/lib/toast";
import { getAccounts } from "@/modules/module_02_account_manager/service";
import { normalizeAccount } from "@/modules/module_07_group_spam/shared/components";
import { LiveLogConsole, nowStamp } from "@/modules/module_11_page_scanner/_shared";
import { SelectAccountsModal } from "@/modules/module_11_page_scanner/shared/SelectPagesModal";
import { ScanActionButtons } from "@/modules/module_11_page_scanner/shared/ScanActionButtons";
import { loadScanState, saveScanState } from "@/modules/module_11_page_scanner/shared/scanStateStorage";
import { askConfirm } from "@/modules/module_11_page_scanner/shared/askConfirm";
import { loadSavedAccountUids, resolveUsableSavedUids, saveSelectedAccountUids } from "@/modules/module_11_page_scanner/shared/accountStorage";
import { exportProfiles } from "../shared/exportProfiles";
import { controlScan, getLatestScan, getScanProgress, getScanResults, startProfileScan } from "../service";
import { SCALE_UNITS, SOURCE_TYPES, fmtNum, parseProfileLines, pickProfileCell, shortFbUrl, summarizeSources } from "../utils.mjs";
import ProfileTable, { rowId } from "./ProfileTable";
import SaveProfileListModal from "./SaveProfileListModal";
import SelectSourcesModal from "./SelectSourcesModal";
import { DEMO_LOGS, DEMO_RESULTS, DEMO_SOURCES } from "./demoData";

const CARD = "rounded-xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)]";
const MODES = [
  { id: "source", label: "Chọn từ Nhóm / Bài viết / Page", icon: Users },
  { id: "link", label: "Nhập Link", icon: Link2 },
  { id: "file", label: "Tải tệp CSV", icon: FileUp },
];
const STATUS = {
  valid: ["Hợp lệ", "border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]"],
  duplicate: ["Trùng lặp", "border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]"],
  invalid: ["Lỗi link", "border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]"],
};
const MAX_FILE_MB = 10;
const POLL_MS = 2500;

function NumCtrl({ label, value, onChange, min = 1, max = 500, step = 1 }) {
  const clamp = (n) => Math.min(max, Math.max(min, n));
  const btn = "flex h-full w-6 items-center justify-center text-xs text-[#64748B] hover:bg-slate-50 disabled:opacity-40";
  return (
    <div className="inline-flex h-[30px] items-center overflow-hidden rounded-md border border-[#CBD5E1] bg-white">
      <button type="button" aria-label={`Giảm ${label}`} disabled={value <= min} onClick={() => onChange(clamp(value - step))} className={btn}>-</button>
      <input
        aria-label={label}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value.replace(/\D/g, "")) || min))}
        className="h-full w-9 border-x border-[#E2E8F0] text-center text-xs font-bold text-[#0F172A] outline-none"
      />
      <button type="button" aria-label={`Tăng ${label}`} disabled={value >= max} onClick={() => onChange(clamp(value + step))} className={btn}>+</button>
    </div>
  );
}

function LinkPreview({ rows, onRemove }) {
  return (
    <div className="max-h-[420px] space-y-2.5 overflow-y-auto bg-[#F8FAFC] p-2.5">
      {rows.length === 0 && <p className="py-8 text-center text-xs text-[#94A3B8]">Chưa có link nào trong danh sách.</p>}
      {rows.map((r) => {
        const [text, cls] = STATUS[r.status];
        return (
          <div key={r.id} className="flex h-10 items-center gap-2 rounded-lg border border-[#E2E8F0] bg-white px-2.5">
            <Link2 className="size-3.5 shrink-0 text-[#94A3B8]" />
            {r.status === "invalid" ? (
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-[#94A3B8]">{r.raw}</span>
            ) : (
              <span className="min-w-0 flex-1 truncate">
                <a href={r.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-[#334155] underline">{r.url}</a>
              </span>
            )}
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{text}</span>
            <button type="button" aria-label="Xóa link" onClick={() => onRemove(r.id)} className="shrink-0 text-[#94A3B8] hover:text-[#DC2626]"><X className="size-4" /></button>
          </div>
        );
      })}
    </div>
  );
}

function SourcePreview({ sources, onRemove }) {
  const list = Object.entries(sources);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-xs">
        <thead className="bg-[#F8FAFC] text-[11px] uppercase tracking-[0.5px] text-[#475569] [&_th]:px-5 [&_th]:py-3 [&_th]:font-bold">
          <tr>
            <th className="w-16">STT</th>
            <th className="text-left">Tên nhóm / Nguồn</th>
            <th className="text-right">Số thành viên / Quy mô</th>
            <th className="text-center">Số profile chọn quét</th>
            <th className="text-center">Thao tác</th>
          </tr>
        </thead>
        <tbody className="[&_td]:px-5 [&_td]:py-3.5">
          {list.length === 0 && <tr><td colSpan={5} className="!py-10 text-center text-[#94A3B8]">Chưa chọn nguồn nào.</td></tr>}
          {list.map(([key, s], i) => (
            <tr key={key} className="border-t border-[#F1F5F9]">
              <td className="text-center font-mono text-[#64748B]">{String(i + 1).padStart(2, "0")}</td>
              <td>
                <p className="font-bold text-[#0F172A]">{s.type === "page" ? "Page" : SOURCE_TYPES[s.type]}: {s.name}</p>
                {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-[#2563EB] hover:underline">{shortFbUrl(s.url)} <ExternalLink className="size-3" /></a>}
              </td>
              <td className="text-right text-[#94A3B8]">{s.scale != null ? <><b className="text-[#0F172A]">{fmtNum(s.scale)}</b> {SCALE_UNITS[s.type]}</> : s.scaleLabel || "—"}</td>
              <td className="text-center font-bold text-[#0F172A]">{fmtNum(Object.keys(s.profiles).length)}</td>
              <td className="text-center"><button type="button" aria-label={`Xóa nguồn ${s.name}`} onClick={() => onRemove(key)} className="text-[#94A3B8] hover:text-[#DC2626]"><Trash2 className="size-4" /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ProfileScanInfo() {
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [uids, setUids] = useState([]);
  const [showAccounts, setShowAccounts] = useState(false);
  const [delay, setDelay] = useState({ min: 5, max: 8 });
  const [rotateEvery, setRotateEvery] = useState(50);
  const [workers, setWorkers] = useState(2);
  const [skipScanned, setSkipScanned] = useState(true);
  const [minFriends, setMinFriends] = useState(false);
  const [directIp, setDirectIp] = useState(true);

  const [mode, setMode] = useState("source");
  const [sources, setSources] = useState({});
  const [showSources, setShowSources] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkRows, setLinkRows] = useState([]);
  const [file, setFile] = useState(null);
  const [fileRows, setFileRows] = useState([]);
  const [skipDup, setSkipDup] = useState(true);
  const [skipInvalid, setSkipInvalid] = useState(true);
  const [reading, setReading] = useState(false);
  const fileRef = useRef(null);

  const [starting, setStarting] = useState(false);
  const [session, setSession] = useState(null);
  const [controlling, setControlling] = useState(null);
  const lastLogRef = useRef(0);
  const [results, setResults] = useState([]);
  const [resultSources, setResultSources] = useState({});
  const [logs, setLogs] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [activeSource, setActiveSource] = useState(null);
  const [sourceSearch, setSourceSearch] = useState("");
  const [sourceType, setSourceType] = useState("ALL");
  const [saveRows, setSaveRows] = useState(null);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    let ignore = false;
    getAccounts()
      .then((data) => {
        if (ignore) return;
        const list = (Array.isArray(data) ? data : data?.accounts || []).map((a, i) => normalizeAccount(a, i));
        setAccounts(list);
        setUids(resolveUsableSavedUids(loadSavedAccountUids("profile_scan"), list));
      })
      .catch((err) => !ignore && toast.error(`Lỗi tải tài khoản: ${err.message}`))
      .finally(() => !ignore && setAccountsLoading(false));
    return () => {
      ignore = true;
    };
  }, []);

  // ?demo=1: nạp dữ liệu mẫu để xem giao diện kết quả khi chưa có backend
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("demo") !== "1") return undefined;
    const id = setTimeout(() => {
      setDemo(true);
      setSources(DEMO_SOURCES);
      setResultSources(DEMO_SOURCES);
      setResults(DEMO_RESULTS);
      setLogs(DEMO_LOGS);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  // Mở trang: hiện lại phiên gần nhất (đang chạy thì theo dõi tiếp)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("demo") === "1") return undefined;
    let ignore = false;
    getLatestScan()
      .then((s) => {
        if (ignore || !s) return;
        // Đã bấm "Quét mới" với phiên này → không hiện lại
        const running = s.status === "RUNNING" || s.status === "PAUSED";
        if (!running && loadScanState("profile_scan")?.dismissedId === s.id) return;
        setSession((cur) => cur || s);
      })
      .catch((err) => !ignore && toast.error(`Lỗi tải phiên quét: ${err.message}`));
    return () => {
      ignore = true;
    };
  }, []);

  const sessionId = session?.id;
  const live = session?.status === "RUNNING" || session?.status === "PAUSED";
  const paused = session?.status === "PAUSED";
  const showResults = Boolean(session) || demo;
  useEffect(() => {
    if (!sessionId) return undefined;
    let ignore = false;
    let timer;
    const tick = async () => {
      let again = live;
      try {
        const res = await getScanProgress(sessionId, lastLogRef.current);
        if (ignore) return;
        if (res.logs.length) {
          lastLogRef.current = res.logs[res.logs.length - 1].id;
          setLogs((prev) => [...prev, ...res.logs.map((l) => ({ id: `s${l.id}`, timestamp: l.time, message: l.message, type: l.level }))].slice(-500));
        }
        setSession(res.session);
        again = res.session.status === "RUNNING" || res.session.status === "PAUSED";
      } catch {
        // Mất kết nối tạm thời: lần sau hỏi lại
      }
      if (!ignore && again) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [sessionId, live]);

  // Có thêm profile quét xong → tải lại kết quả
  const doneCount = session?.done ?? 0;
  useEffect(() => {
    if (!sessionId) return undefined;
    let ignore = false;
    getScanResults(sessionId)
      .then((res) => {
        if (ignore) return;
        setResults(res.items);
        setResultSources(Object.fromEntries(res.sources.map((s) => [s.key, { ...s, scaleLabel: s.scale_label, profiles: {} }])));
      })
      .catch((err) => !ignore && toast.error(`Lỗi tải kết quả: ${err.message}`));
    return () => {
      ignore = true;
    };
  }, [sessionId, doneCount]);

  const log = (message, type = "info") =>
    setLogs((prev) => [...prev, { id: `${Date.now()}_${prev.length}`, timestamp: nowStamp(), message, type }].slice(-500));

  const typedCount = linkText.split(/\r?\n/).filter((l) => l.trim()).length;
  const rows = mode === "link" ? linkRows : fileRows;
  const validRows = rows.filter((r) => r.status === "valid");
  const sum = useMemo(() => summarizeSources(sources), [sources]);
  // Một người có thể nằm ở nhiều nguồn → chỉ quét 1 lần
  const sourceTargets = useMemo(() => {
    const map = new Map();
    Object.entries(sources).forEach(([key, s]) =>
      Object.values(s.profiles).forEach((p) => {
        const old = map.get(p.uid);
        map.set(p.uid, { ...p, source_keys: [...(old?.source_keys || []), key] });
      }),
    );
    return [...map.values()];
  }, [sources]);
  const targets = mode === "source" ? sourceTargets : validRows;
  const sourceCount = mode === "source" ? Object.keys(sources).length : rows.length;

  const previewLinks = () => {
    const parsed = parseProfileLines(linkText.split(/\r?\n/));
    if (!parsed.length) return toast.warning("Chưa nhập link nào.");
    return setLinkRows(parsed);
  };
  const dedupeLinks = () => {
    const parsed = parseProfileLines(linkText.split(/\r?\n/), { skipDuplicates: true });
    const removed = typedCount - parsed.length;
    setLinkText(parsed.map((r) => r.raw).join("\n"));
    setLinkRows((prev) => (prev.length ? parsed : prev));
    toast.success(removed ? `Đã bỏ ${removed} link trùng.` : "Không có link trùng.");
  };
  const pickFile = (f) => {
    if (!f) return;
    if (!/\.(csv|txt|xlsx)$/i.test(f.name)) return toast.warning("Chỉ nhận tệp .csv, .txt hoặc .xlsx.");
    if (f.size > MAX_FILE_MB * 1024 * 1024) return toast.warning(`Tệp vượt quá ${MAX_FILE_MB} MB.`);
    setFile(f);
    return setFileRows([]);
  };
  const readFile = async () => {
    setReading(true);
    try {
      let lines;
      if (/\.txt$/i.test(file.name)) {
        lines = (await file.text()).replace(/^﻿/, "").split(/\r?\n/);
      } else {
        const XLSX = await import("xlsx");
        // raw: giữ UID dài dạng chữ, không bị làm tròn thành số
        const book = /\.csv$/i.test(file.name)
          ? XLSX.read((await file.text()).replace(/^﻿/, ""), { type: "string", raw: true })
          : XLSX.read(await file.arrayBuffer());
        lines = XLSX.utils
          .sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, raw: true, defval: "" })
          .map(pickProfileCell);
      }
      const parsed = parseProfileLines(lines, { skipDuplicates: skipDup, skipInvalid });
      setFileRows(parsed);
      if (parsed.length) toast.success(`Đã đọc ${fmtNum(parsed.length)} dòng.`);
      else toast.warning("Tệp không có link profile hợp lệ.");
    } catch (err) {
      toast.error(`Không đọc được tệp: ${err.message}`);
    } finally {
      setReading(false);
    }
  };

  const start = async () => {
    if (demo) return toast.warning("Đang ở chế độ xem mẫu (?demo=1).");
    if (!uids.length) return toast.warning("Chưa chọn tài khoản.");
    if (!targets.length) return toast.warning("Chưa có profile hợp lệ để quét.");
    setStarting(true);
    try {
      const res = await startProfileScan({
        account_uids: uids,
        delay_min: delay.min,
        delay_max: delay.max,
        rotate_every: rotateEvery,
        workers: Math.min(workers, uids.length),
        skip_scanned: skipScanned,
        min_friends: minFriends ? 500 : 0,
        allow_direct_ip: directIp,
        mode,
        targets: targets.map((t) => ({ uid: t.uid || t.key, url: t.url, name: t.name, avatar: t.avatar, source_keys: t.source_keys || [] })),
        sources:
          mode === "source"
            ? Object.entries(sources).map(([key, s]) => ({ key, type: s.type, name: s.name, url: s.url, scale: s.scale ?? null, scale_label: s.scaleLabel || null }))
            : [],
      });
      lastLogRef.current = 0;
      setLogs([]);
      setResults([]);
      setResultSources({});
      setSelected(new Set());
      setSession({ id: res.session_id, status: "RUNNING", mode, total: res.total, done: 0, skipped: 0, failed: 0, pending: res.total });
    } catch (err) {
      log(err.message, "error");
      toast.error(err.message);
    } finally {
      setStarting(false);
    }
    return undefined;
  };

  /** "Quét mới": bỏ kết quả đang xem và danh sách xem trước (dữ liệu trong kho không bị xóa). */
  const newScan = () => {
    if (sessionId) saveScanState("profile_scan", { dismissedId: sessionId });
    lastLogRef.current = 0;
    setSession(null);
    setDemo(false);
    setLogs([]);
    setResults([]);
    setResultSources({});
    setSelected(new Set());
    setActiveSource(null);
    setSourceSearch("");
    setSourceType("ALL");
    setSources({});
    setLinkText("");
    setLinkRows([]);
    setFile(null);
    setFileRows([]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const control = async (action) => {
    setControlling(action);
    try {
      await controlScan(sessionId, action, action === "resume" ? { allow_direct_ip: directIp } : {});
      const res = await getScanProgress(sessionId, lastLogRef.current);
      setSession(res.session);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setControlling(null);
    }
  };
  const emergencyStop = async () => {
    const ok = await askConfirm({
      title: "Dừng khẩn cấp",
      description: "Đóng ngay các Chrome đang quét profile. Dữ liệu đã quét được giữ lại.",
      confirmText: "Dừng",
      cancelText: "Hủy",
    });
    if (ok) control("stop");
  };

  const exportRows = async (list, name) => {
    if (!list.length) return toast.warning("Chưa có profile để xuất.");
    try {
      await exportProfiles(list, name, (r) => resultSources[r.sourceKey]?.name || "");
      return toast.success(`Đã xuất ${fmtNum(list.length)} profile.`);
    } catch (err) {
      return toast.error(`Không xuất được: ${err.message}`);
    }
  };
  const openSave = () => {
    const list = results.filter((r) => selected.has(rowId(r)));
    if (!list.length) return toast.warning("Hãy tick profile cần lưu.");
    return setSaveRows([...new Map(list.map((r) => [r.uid, r])).values()]);
  };

  const entries = Object.entries(resultSources);
  const shownSources = entries.filter(
    ([, s]) => (sourceType === "ALL" || s.type === sourceType) && s.name.toLowerCase().includes(sourceSearch.trim().toLowerCase()),
  );
  const activeKey = shownSources.some(([k]) => k === activeSource) ? activeSource : shownSources[0]?.[0];
  const active = resultSources[activeKey];
  const activeRows = results.filter((r) => r.sourceKey === activeKey);
  const bySource = mode === "source";
  const resultsBySource = session ? session.mode === "source" : bySource;
  // Số chạy song song không vượt quá số tài khoản live đã chọn (tối đa 5 Chrome)
  const maxWorkers = Math.min(5, Math.max(1, uids.length));
  const workerCount = Math.min(workers, maxWorkers);

  return (
    <div className="-m-6 min-h-full space-y-6 bg-[#F8FAFC] p-6">
      <div>
        <h1 className="font-heading text-xl font-bold text-[#0F172A]">Quét thông tin profile</h1>
        <p className="mt-1 text-xs text-[#64748B]">Quét các thông tin về tên, hồ sơ, UID, link facebook, số bạn bè của những profile nhập từ page, nhóm, bài viết hoặc nhập thủ công</p>
        {demo && <p className="mt-2 inline-block rounded-md bg-[#FEF3C7] px-2.5 py-1 text-xs font-semibold text-[#92400E]">Đang xem dữ liệu mẫu — không phải kết quả quét thật</p>}
      </div>

      <section className={`${CARD} p-6 ${live ? "hidden" : ""}`}>
        <div className="flex items-center gap-2.5 border-b border-[#F1F5F9] pb-3">
          <span className="flex size-6 items-center justify-center rounded-full bg-[#1877F2] text-xs font-bold text-white">1</span>
          <h2 className="text-sm font-bold text-[#0F172A]">Chọn tài khoản & Thiết lập phiên quét</h2>
        </div>
        <div className="mt-4 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
          <button type="button" onClick={() => setShowAccounts(true)} className="inline-flex h-8 items-center gap-2 rounded-lg bg-[#1877F2] px-4 text-xs font-semibold text-white hover:bg-[#1D4ED8]">
            <UserPlus className="size-4" /> Chọn tài khoản
          </button>
          <div className="mt-3 border-b border-[#E2E8F0] pb-3">
            {uids.length ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-1 text-xs text-[#047857]"><CheckCircle2 className="size-3.5" /> <span>Đã chọn: <b>{uids.length}</b> tài khoản · chạy song song <b>{workerCount}</b> · dự phòng <b>{uids.length - workerCount}</b></span></span>
            ) : (
              <span className="text-xs text-[#94A3B8]">{accountsLoading ? "Đang tải tài khoản…" : "Chưa chọn tài khoản"}</span>
            )}
          </div>
          <p className="mt-3 text-xs font-medium text-[#334155]">Khoảng cách giữa các lần quét:</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#64748B]">
            <NumCtrl label="khoảng cách tối thiểu" max={180} value={delay.min} onChange={(v) => setDelay((d) => ({ min: v, max: Math.max(v, d.max) }))} />
            -
            <NumCtrl label="khoảng cách tối đa" max={180} value={delay.max} onChange={(v) => setDelay((d) => ({ ...d, max: Math.max(d.min, v) }))} />
            giây
          </div>
          <p className="mt-5 text-xs font-medium text-[#334155]">Đổi tài khoản mới khi quét được:</p>
          <div className="mt-2 flex items-center gap-3 text-xs text-[#64748B]">
            <NumCtrl label="số profile mỗi tài khoản" value={rotateEvery} step={10} onChange={setRotateEvery} /> profile / acc
          </div>
          <p className="mt-5 text-xs font-medium text-[#334155]">Số tài khoản chạy song song:</p>
          <div className="mt-2 flex items-center gap-3 text-xs text-[#64748B]">
            <NumCtrl label="số tài khoản chạy song song" max={maxWorkers} value={workerCount} onChange={setWorkers} /> Chrome cùng lúc (tối đa {maxWorkers})
          </div>
          <div className="mt-5 space-y-2 text-xs text-[#334155]">
            <label className="flex cursor-pointer items-center gap-2"><Checkbox checked={skipScanned} onCheckedChange={setSkipScanned} /> Bỏ qua người đã quét (dùng lại dữ liệu có sẵn)</label>
            <label className="flex cursor-pointer items-center gap-2"><Checkbox checked={minFriends} onCheckedChange={setMinFriends} /> Chỉ lấy người có từ 500 bạn bè (ẩn số bạn bè vẫn lấy)</label>
            <label className="flex cursor-pointer items-center gap-2"><Checkbox checked={directIp} onCheckedChange={setDirectIp} /> Proxy lỗi thì tự chuyển sang IP của máy (có ghi log; bỏ tick để dừng tài khoản đó)</label>
          </div>
        </div>

        <p className="mt-5 text-xs font-bold uppercase tracking-[0.6px] text-[#64748B]">Nguồn thu thập dữ liệu profile</p>
        <div role="tablist" className="mt-3 flex flex-wrap gap-1 rounded-lg bg-[#F1F5F9] p-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => setMode(m.id)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-md px-5 text-xs font-medium ${mode === m.id ? "bg-[#1877F2] font-semibold text-white" : "text-[#475569] hover:bg-white"}`}
            >
              <m.icon className="size-4" /> {m.label}
            </button>
          ))}
        </div>

        {mode === "source" && (
          <button type="button" onClick={() => setShowSources(true)} className="mt-4 inline-flex h-8 items-center gap-2 rounded-lg border border-[#1877F2] bg-white px-3.5 text-xs font-semibold text-[#1877F2] hover:bg-[#EFF6FF]">
            <UserPlus className="size-4" /> + Chọn nguồn (Nhóm / Page / Bài viết)
          </button>
        )}

        {mode === "link" && (
          <div className="mt-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
            <label htmlFor="profile-links" className="flex flex-wrap items-center gap-2 text-xs font-medium text-[#334155]">
              Danh sách Link trang cá nhân (Mỗi dòng 1 link)
              <span className="rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-semibold text-[#1D4ED8]">Đã nhập: {typedCount} Link</span>
            </label>
            <textarea
              id="profile-links"
              rows={5}
              value={linkText}
              onChange={(e) => setLinkText(e.target.value)}
              placeholder={"https://www.facebook.com/username\nhttps://www.facebook.com/profile.php?id=1000..."}
              className="mt-2 w-full resize-y rounded-lg border border-[#E2E8F0] bg-white p-2.5 font-mono text-xs leading-5 text-[#334155] outline-none focus:border-[#1877F2]"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <button type="button" disabled={!typedCount} onClick={dedupeLinks} className="inline-flex h-[30px] items-center gap-2 rounded-lg border border-[#CBD5E1] bg-white px-3 text-xs text-[#334155] hover:bg-slate-50 disabled:opacity-50"><Copy className="size-3.5" /> Lọc trùng link</button>
              <button type="button" disabled={!typedCount} onClick={previewLinks} className="inline-flex h-[30px] items-center gap-2 rounded-lg bg-[#1877F2] px-3 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50"><CheckCircle2 className="size-3.5" /> Lưu & Xem trước danh sách mục tiêu</button>
            </div>
          </div>
        )}

        {mode === "file" && (
          <div className="mt-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.xlsx"
              className="hidden"
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {file ? (
              <div className="flex items-center gap-3 rounded-lg border border-[#E2E8F0] bg-white p-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] text-[#059669]"><FileSpreadsheet className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-[#0F172A]">{file.name}</p>
                  <p className="mt-1 font-mono text-[11px] text-[#94A3B8]">Dung lượng: {(file.size / 1024).toFixed(1)} KB</p>
                </div>
                <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#E2E8F0] bg-[#F1F5F9] px-2.5 py-1.5 text-xs text-[#334155]"><ExternalLink className="size-3.5" /> Đổi tệp khác</button>
                <button type="button" aria-label="Bỏ tệp" onClick={() => { setFile(null); setFileRows([]); }} className="text-[#94A3B8] hover:text-[#DC2626]"><X className="size-4" /></button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  pickFile(e.dataTransfer.files?.[0]);
                }}
                className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-[#93C5FD] bg-white py-7 text-xs text-[#475569] hover:border-[#1877F2]"
              >
                <FileUp className="size-6 text-[#1877F2]" /> Kéo thả hoặc bấm để chọn tệp .csv, .txt, .xlsx
              </button>
            )}
            <div className="mt-3 space-y-1.5 text-xs text-[#334155]">
              <label className="flex cursor-pointer items-center gap-2"><Checkbox checked={skipDup} onCheckedChange={setSkipDup} /> Bỏ qua trùng lặp profile/link trong tệp</label>
              <label className="flex cursor-pointer items-center gap-2"><Checkbox checked={skipInvalid} onCheckedChange={setSkipInvalid} /> Bỏ qua dòng trống và định dạng lỗi</label>
            </div>
            <button type="button" disabled={!file || reading} onClick={readFile} className="mt-3 inline-flex h-[30px] w-full items-center justify-center gap-2 rounded-lg border border-[#93C5FD] bg-[#EFF6FF] text-xs font-semibold text-[#1D4ED8] hover:bg-[#DBEAFE] disabled:opacity-50"><Database className="size-3.5" /> {reading ? "Đang đọc…" : "Đọc dữ liệu & Xem trước danh sách"}</button>
          </div>
        )}
      </section>

      <section className={`${CARD} overflow-hidden`}>
        <div className="flex items-center gap-3 border-b border-[#E2E8F0] px-5 py-5">
          <span className="flex h-10 w-8 shrink-0 items-center justify-center rounded-lg border border-[#DBEAFE] bg-[#EFF6FF] text-[#1877F2]"><ListChecks className="size-4" /></span>
          <div>
            <h2 className="text-base font-bold text-[#0F172A]">Xem trước danh sách mục tiêu muốn quét</h2>
            <p className="mt-0.5 text-xs text-[#64748B]">Xem trước các nguồn nhóm, fanpage hoặc bài viết liên kết cần quét profile và thiết lập số lượng profile muốn lấy cho từng nguồn.</p>
          </div>
        </div>
        {bySource ? (
          <SourcePreview
            sources={sources}
            onRemove={(key) =>
              setSources((prev) => {
                const next = { ...prev };
                delete next[key];
                return next;
              })
            }
          />
        ) : (
          <LinkPreview rows={rows} onRemove={(id) => (mode === "link" ? setLinkRows : setFileRows)((prev) => prev.filter((r) => r.id !== id))} />
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E2E8F0] bg-[#F8FAFC] px-5 py-3 text-xs text-[#475569]">
          <span><b>Tổng nguồn:</b> {fmtNum(sourceCount)} nguồn được liên kết</span>
          <span>
            <b>Tổng số profile chọn quét dự kiến:</b> <b className="text-sm text-[#1877F2]">{fmtNum(targets.length)}</b> profile
            {bySource && sum.total > targets.length && ` (đã gộp ${fmtNum(sum.total - targets.length)} profile trùng)`}
          </span>
        </div>
      </section>

      <ScanActionButtons
        live={live}
        paused={paused}
        stopping={controlling === "stop"}
        showNewScan={showResults}
        startDisabled={starting}
        controlDisabled={Boolean(controlling)}
        onStart={start}
        onPauseResume={() => control(paused ? "resume" : "pause")}
        onStop={emergencyStop}
        onNewScan={newScan}
      />

      {showResults && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-bold uppercase tracking-[0.6px] text-[#0F172A]">
                <Database className="size-4 text-[#1877F2]" /> Kết quả quét profile
                <span className="rounded-full bg-[#F1F5F9] px-2.5 py-0.5 text-xs font-normal normal-case tracking-normal text-[#64748B]">({fmtNum(results.length)} profile)</span>
              </h2>
              <p className="mt-1 text-xs text-[#64748B]">Danh sách dữ liệu người dùng bóc tách theo từng nguồn chiến dịch</p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <button type="button" onClick={() => exportRows(results, "quet_profile")} className="inline-flex h-8 items-center gap-2 rounded-lg border border-[#CBD5E1] bg-white px-4 text-xs font-semibold text-[#1E293B] hover:bg-slate-50"><Download className="size-3.5 text-[#059669]" /> {resultsBySource ? "Xuất toàn bộ file Excel" : "Xuất file"}</button>
              {!resultsBySource && <button type="button" onClick={openSave} className="inline-flex h-8 items-center gap-2 rounded-lg bg-[#2563EB] px-4 text-xs font-semibold text-white hover:bg-[#1D4ED8]"><Save className="size-3.5" /> Lưu vào danh sách chung</button>}
            </div>
          </div>

          {resultsBySource ? (
            <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
              <div className={`${CARD} p-4`}>
                <p className="flex items-center gap-2 border-b border-[#F1F5F9] pb-3 text-xs font-bold uppercase tracking-[0.5px] text-[#334155]"><ListChecks className="size-4 text-[#1877F2]" /> Danh mục nguồn quét ({entries.length})</p>
                <div className="mt-3 flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#94A3B8]" />
                    <input aria-label="Tìm nguồn" value={sourceSearch} onChange={(e) => setSourceSearch(e.target.value)} placeholder="Tìm kiếm" className="h-[30px] w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] pl-8 pr-2 text-xs outline-none focus:border-[#1877F2]" />
                  </div>
                  <CustomSelect className="w-[118px]" buttonClassName="!h-[30px] !border-[#E2E8F0] !shadow-none" value={sourceType} onChange={setSourceType} options={[{ value: "ALL", label: "Tất cả loại" }, ...Object.entries(SOURCE_TYPES).map(([value, label]) => ({ value, label }))]} />
                </div>
                <div className="mt-3 max-h-[420px] space-y-2.5 overflow-y-auto">
                  {shownSources.length === 0 && <p className="py-8 text-center text-xs text-[#94A3B8]">Chưa có nguồn nào.</p>}
                  {shownSources.map(([key, s]) => {
                    const n = results.filter((r) => r.sourceKey === key).length;
                    return (
                      <button key={key} type="button" onClick={() => setActiveSource(key)} className={`w-full rounded-xl border p-3 text-left text-xs ${key === activeKey ? "border-2 border-[#1877F2] bg-[#F8FAFF]" : "border-[#E2E8F0] hover:border-[#93C5FD]"}`}>
                        <span className="rounded bg-[#F1F5F9] px-1.5 py-0.5 text-[10px] text-[#475569]">{SOURCE_TYPES[s.type]}</span>
                        <span className={`mt-1.5 block truncate text-[#0F172A] ${key === activeKey ? "font-bold" : ""}`}>{s.name}</span>
                        {s.type === "post" && s.likes != null && (
                          <span className="mt-1 flex gap-3 text-[#64748B]">
                            <span className="inline-flex items-center gap-1"><ThumbsUp className="size-3" /> {s.likes}</span>
                            <span className="inline-flex items-center gap-1"><MessageCircle className="size-3" /> {s.comments}</span>
                            <span className="inline-flex items-center gap-1"><Share2 className="size-3" /> {s.shares}</span>
                          </span>
                        )}
                        <span className="mt-1 block text-[11px] text-[#64748B]">Đã quét <b className="text-[#1D4ED8]">{fmtNum(n)} profile</b> / {fmtNum(s.target_count ?? Object.keys(s.profiles).length)} đã chọn</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="min-w-0 space-y-4">
                {active && (
                  <div className={`${CARD} p-4`}>
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#F1F5F9] pb-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[#0F172A]">
                          {active.type === "page" ? "Page" : SOURCE_TYPES[active.type]}: {active.name}{" "}
                          {active.url && <a href={active.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs font-normal text-[#2563EB] hover:underline">{shortFbUrl(active.url)} <ExternalLink className="size-3" /></a>}
                        </p>
                        <p className="mt-0.5 text-xs text-[#64748B]">Quy mô: <b>{active.scale != null ? fmtNum(active.scale) : active.scaleLabel || "—"}</b> {active.scale != null && SCALE_UNITS[active.type]}</p>
                      </div>
                      <button type="button" onClick={() => exportRows(activeRows, "quet_profile_nguon")} className="inline-flex h-[26px] items-center gap-2 rounded-md bg-[#F1F5F9] px-3 text-xs font-semibold text-[#1E293B] hover:bg-slate-200"><FileSpreadsheet className="size-3.5 text-[#059669]" /> Xuất Excel</button>
                    </div>
                    <div className="mt-3 rounded-lg bg-[#F8FAFC] py-2.5 text-center">
                      <p className="text-[11px] text-[#64748B]">Số profile đã quét</p>
                      <p className="font-mono text-lg font-semibold text-[#0F172A]">{fmtNum(activeRows.length)}</p>
                    </div>
                  </div>
                )}
                <ProfileTable key={activeKey} rows={activeRows} selected={selected} onSelect={setSelected} />
              </div>
            </div>
          ) : (
            <ProfileTable rows={results} selected={selected} onSelect={setSelected} />
          )}
        </section>
      )}

      {(showResults || logs.length > 0) && (
        <LiveLogConsole title="Live Automation Console: Quét Profile" logs={logs} phase={session?.status === "PAUSED" ? "paused" : live ? "running" : session ? "done" : "idle"} />
      )}

      <SelectAccountsModal
        open={showAccounts}
        onClose={() => setShowAccounts(false)}
        accounts={accounts}
        loading={accountsLoading}
        selectedUids={uids}
        onConfirm={(next) => {
          setUids(next);
          saveSelectedAccountUids("profile_scan", next);
        }}
      />
      <SelectSourcesModal
        open={showSources}
        value={sources}
        onClose={() => setShowSources(false)}
        onConfirm={(next) => {
          setSources(next);
          setShowSources(false);
        }}
      />
      <SaveProfileListModal open={Boolean(saveRows)} profiles={saveRows || []} onClose={() => setSaveRows(null)} />
    </div>
  );
}
