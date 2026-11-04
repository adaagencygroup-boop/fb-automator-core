"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Pause,
  Square,
  Search,
  Download,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Users,
  Layers,
  ListChecks,
  SlidersHorizontal,
  FolderInput,
  Eye,
} from "lucide-react";
import Link from "next/link";
import { toast } from "@/lib/toast";
import { getAccounts } from "@/modules/module_02_account_manager/service";
import { normalizeAccount, initialsOf } from "@/modules/module_07_group_spam/shared/components";
import { AVATAR_COLORS } from "@/modules/module_07_group_spam/shared/constants";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  createFollowerSession,
  getScannedPages,
  getPageFollowers,
  stopScanSession,
  pauseScanSession,
  resumeScanSession,
  getScanSessionDetail,
} from "../service";
import { LiveLogConsole, nowStamp, LIVE_STATUSES } from "../_shared";
import {
  DEFAULT_SCANNED_PAGES,
  SelectAccountsModal,
  SelectPagesModal,
} from "../shared/SelectPagesModal";

const DONE_STATUSES = ["COMPLETED", "PARTIAL", "STOPPED", "FAILED"];
const PAGE_SIZE = 10;

function StepperBox({ value, onChange, min = 1, max = 5000, step = 1, disabled }) {
  return (
    <div className="inline-flex h-8 items-center overflow-hidden rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]">
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, Number(value || min) - step))}
        className="flex h-full w-7 items-center justify-center text-xs font-bold text-[#64748B] hover:bg-[#E2E8F0]/60 disabled:opacity-40"
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
        className="h-full w-12 border-x border-[#E2E8F0] bg-white text-center text-xs font-bold text-[#0F172A] outline-none disabled:opacity-50"
      />
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, Number(value || min) + step))}
        className="flex h-full w-7 items-center justify-center text-xs font-bold text-[#64748B] hover:bg-[#E2E8F0]/60 disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

function SelectedBadge({ children }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3.5 py-2 text-xs font-medium text-[#334155]">
      <span className="size-2 shrink-0 rounded-full bg-[#10B981]" />
      {children}
    </span>
  );
}

function exportFollowersCsv(rows, filename) {
  const headers = ["STT", "Họ và tên", "UID / Key", "Profile", "Địa chỉ", "Bạn bè", "Page"];
  const body = rows.map((u, i) => [
    i + 1,
    u.name || "",
    u.uid || "",
    u.profile_url || "",
    u.location || "",
    u.friends || "",
    u.page_name || u.page_key || "",
  ]);
  const csv = [headers, ...body]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function mapFollowerRow(row, idx = 0) {
  const key = row.follower_key || "";
  const uid = key.replace(/^id:|^user:/, "") || String(row.id || idx);
  return {
    id: String(row.id || `${key}_${idx}`),
    name: row.follower_name || uid || "—",
    uid,
    follower_key: key,
    profile_url: row.profile_url || (uid ? `https://www.facebook.com/${uid}` : ""),
    location: row.location || "—",
    friends: row.friend_count != null ? `${Number(row.friend_count).toLocaleString("vi-VN")} bạn bè` : "—",
    time: row.updated_at || row.created_at || "",
    page_key: row.page_key || "",
    page_name: row.page_name || row.page_key || "",
  };
}

function mapKhoToPage(p, idx = 0) {
  const uid = String(p.page_key || "").replace(/^id:|^user:/, "") || String(idx);
  return {
    id: p.id || p.page_key || `pg_${idx}`,
    page_key: p.page_key,
    page_id: uid,
    page_name: p.page_name || p.page_key,
    name: p.page_name || p.page_key,
    uid,
    page_url: p.page_url,
    category: p.category || "Fanpage",
    follower_count: p.follower_count || 0,
    followers_text: p.follower_count ? Number(p.follower_count).toLocaleString("vi-VN") : "—",
    scanned_post_count: p.scanned_post_count || 0,
    avatar_initials: initialsOf(p.page_name || p.page_key || "PG"),
    avatar_color: AVATAR_COLORS[idx % AVATAR_COLORS.length],
  };
}

function padStt(n) {
  return n < 10 ? `0${n}` : String(n);
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString("vi-VN");
}

export default function PageScannerFollowers() {
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [selectedUids, setSelectedUids] = useState([]);
  const [showAccountModal, setShowAccountModal] = useState(false);

  const [availablePages, setAvailablePages] = useState(DEFAULT_SCANNED_PAGES);
  const [selectedPages, setSelectedPages] = useState([]);
  const [showPageModal, setShowPageModal] = useState(false);
  const [khoPages, setKhoPages] = useState([]);

  const [delayMin, setDelayMin] = useState(5);
  const [delayMax, setDelayMax] = useState(5);
  const [rotateEvery, setRotateEvery] = useState(50);
  const [maxPerPage, setMaxPerPage] = useState(50);
  const [prioritizeRecent, setPrioritizeRecent] = useState(true);
  const [dedupAcrossPages, setDedupAcrossPages] = useState(true);
  const keepBrowser = false;

  const [runPhase, setRunPhase] = useState("idle");
  const [sessionId, setSessionId] = useState(null);
  const [resultCount, setResultCount] = useState(0);
  const [logs, setLogs] = useState([]);
  const logId = useRef(0);
  const pollRef = useRef(null);

  const [resultPages, setResultPages] = useState([]);
  const [followersByPage, setFollowersByPage] = useState({});
  const [activePageKey, setActivePageKey] = useState("");
  const [leftSearch, setLeftSearch] = useState("");
  const [rightSearch, setRightSearch] = useState("");
  const [selectedRowIds, setSelectedRowIds] = useState([]);
  const [tablePage, setTablePage] = useState(1);
  const [sortBy, setSortBy] = useState("NEWEST");
  const [updatedAt, setUpdatedAt] = useState("");
  const scanPageKeysRef = useRef([]);

  const isBusy = runPhase === "running" || runPhase === "paused";
  const isPaused = runPhase === "paused";
  const showResults = runPhase !== "idle";

  const pushLog = useCallback((message, type = "info") => {
    logId.current += 1;
    setLogs((prev) => [...prev.slice(-200), { id: logId.current, timestamp: nowStamp(), message, type }]);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const syncSessionLogs = useCallback(
    (session) => {
      let lines = session?.logs;
      if (typeof lines === "string") {
        try {
          lines = JSON.parse(lines);
        } catch {
          lines = [];
        }
      }
      if (!Array.isArray(lines) || !lines.length) return;
      setLogs(
        lines.slice(-500).map((line, i) => ({
          id: `s${session.id || sessionId}_${line.ts}_${i}`,
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
        })),
      );
    },
    [sessionId],
  );

  const refreshResults = useCallback(
    async (sid, pageKeys) => {
      const keys = pageKeys?.length ? pageKeys : scanPageKeysRef.current;
      if (!sid && !keys.length) return;
      try {
        const fl = await getPageFollowers({
          session_id: sid || undefined,
          page: 1,
          page_size: 200,
        });
        const items = (fl.items || []).map(mapFollowerRow);
        const byPage = {};
        for (const row of items) {
          const pk = row.page_key || "_unknown";
          if (!byPage[pk]) byPage[pk] = [];
          byPage[pk].push(row);
        }
        for (const pk of keys) {
          if (!byPage[pk]) byPage[pk] = [];
        }
        setFollowersByPage(byPage);
        setResultCount(fl.total ?? items.length);
        setUpdatedAt(nowStamp());

        setResultPages((prev) => {
          const meta = new Map(prev.map((p) => [p.page_key, p]));
          return keys.map((pk, idx) => {
            const existing = meta.get(pk);
            const fromSel = selectedPages.find((p) => p.page_key === pk);
            const fromKho = khoPages.find((p) => p.page_key === pk);
            const count = (byPage[pk] || []).length;
            const isActive = runPhase === "running" || runPhase === "paused";
            let status = "QUEUE";
            let status_label = "Đang chờ hàng đợi";
            if (runPhase === "done") {
              status = count > 0 ? "DONE" : "QUEUE";
              status_label = count > 0 ? "Hoàn tất quét" : "Chưa có dữ liệu";
            } else if (isActive && (idx === 0 || count > 0)) {
              status = "RUNNING";
              status_label = "Đang thu thập...";
            } else if (!isActive && count > 0) {
              status = "DONE";
              status_label = "Hoàn tất quét";
            }
            return {
              page_key: pk,
              page_name:
                existing?.page_name || fromSel?.page_name || fromKho?.page_name || pk,
              page_url: existing?.page_url || fromSel?.page_url || fromKho?.page_url || "",
              follower_count:
                existing?.follower_count ??
                fromSel?.follower_count ??
                fromKho?.follower_count ??
                0,
              category: fromSel?.category || fromKho?.category || "Fanpage",
              scanned_uid_count: count,
              status,
              status_label,
              avatar_initials: initialsOf(
                existing?.page_name || fromSel?.page_name || fromKho?.page_name || pk,
              ),
            };
          });
        });
      } catch (err) {
        console.error(err);
      }
    },
    [khoPages, selectedPages, runPhase],
  );

  const startPoll = useCallback(
    (sid) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const session = await getScanSessionDetail(sid);
          if (session.status === "PAUSED") setRunPhase("paused");
          else if (session.status === "RUNNING") setRunPhase("running");
          syncSessionLogs(session);
          const count = session.total_unique || 0;
          setResultCount(count);
          await refreshResults(sid, scanPageKeysRef.current);
          if (DONE_STATUSES.includes(session.status)) {
            stopPolling();
            setRunPhase("done");
            await refreshResults(sid, scanPageKeysRef.current);
            toast.success(
              `Phiên FOLLOW #${sid} · ${session.status}/${session.stop_reason || "—"} · ${count} FL`,
            );
          }
        } catch (e) {
          console.error(e);
        }
      }, 1500);
    },
    [stopPolling, syncSessionLogs, refreshResults],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setAccountsLoading(true);
        const data = await getAccounts();
        if (cancelled) return;
        const normalized = (Array.isArray(data) ? data : data?.accounts || []).map((a, i) =>
          normalizeAccount(a, i),
        );
        setAccounts(normalized);
        setSelectedUids(
          normalized.filter((a) => LIVE_STATUSES.has(String(a.status))).map((a) => a.uid),
        );
      } catch (err) {
        toast.error(`Lỗi tải tài khoản: ${err.message}`);
      } finally {
        if (!cancelled) setAccountsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getScannedPages({ page: 1, page_size: 100, sort_by: "followers" });
        if (cancelled) return;
        const items = data.items || [];
        setKhoPages(items);
        if (items.length) {
          const mapped = items.map(mapKhoToPage);
          const combined = [...DEFAULT_SCANNED_PAGES];
          for (const m of mapped) {
            if (!combined.some((c) => c.page_key === m.page_key)) combined.push(m);
          }
          setAvailablePages(combined);
        }
      } catch {
        /* keep defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleStart = async () => {
    try {
      if (!selectedPages.length) throw new Error("Chọn ít nhất 1 Page muốn quét.");
      const pageKeys = selectedPages.map((p) => p.page_key).filter(Boolean);
      if (!pageKeys.length) throw new Error("Danh sách page thiếu page_key.");

      const live = accounts.filter(
        (a) => selectedUids.includes(a.uid) && LIVE_STATUSES.has(String(a.status)),
      );
      const accountUid = live[0]?.uid || selectedUids[0] || null;
      if (!accountUid) throw new Error("Chọn ít nhất 1 tài khoản Live.");

      const targetFollowers = Math.max(pageKeys.length * maxPerPage, maxPerPage);

      stopPolling();
      setRunPhase("running");
      setLogs([]);
      setResultCount(0);
      setFollowersByPage({});
      setSelectedRowIds([]);
      setTablePage(1);
      scanPageKeysRef.current = pageKeys;
      setResultPages(
        selectedPages.map((p, idx) => ({
          page_key: p.page_key,
          page_name: p.page_name || p.name || p.page_key,
          page_url: p.page_url || "",
          follower_count: p.follower_count || 0,
          category: p.category || "Fanpage",
          scanned_uid_count: 0,
          status: idx === 0 ? "RUNNING" : "QUEUE",
          status_label: idx === 0 ? "Đang thu thập..." : "Đang chờ hàng đợi",
          avatar_initials: p.avatar_initials || initialsOf(p.page_name || p.name || p.page_key),
        })),
      );
      setActivePageKey(pageKeys[0] || "");
      pushLog(
        `Tạo phiên FOLLOW · ${pageKeys.length} Page · max/page=${maxPerPage} · delay ${delayMin}-${delayMax}s`,
        "info",
      );

      const res = await createFollowerSession({
        page_keys: pageKeys,
        account_uid: accountUid,
        keep_browser: keepBrowser,
        target_followers: targetFollowers,
        max_per_page: maxPerPage,
        idle_timeout_s: 90,
        skip_existing: dedupAcrossPages,
        source_list_id: null,
        page_delay_s: delayMin,
      });

      setSessionId(res.session_id);
      pushLog(`Session #${res.session_id} · ${res.status || "RUNNING"} · ${res.message || "OK"}`, "success");
      if (prioritizeRecent) pushLog("Ưu tiên người theo dõi gần đây (UI flag).", "info");
      if (rotateEvery) pushLog(`Đổi acc sau ~${rotateEvery} page / tài khoản (UI flag).`, "info");
      toast.success(`Đã khởi động FOLLOW #${res.session_id}`);
      startPoll(res.session_id);
    } catch (err) {
      setRunPhase("idle");
      const msg = err.message || "Lỗi tạo phiên";
      toast.error(msg);
      pushLog(msg, "error");
    }
  };

  const handlePauseResume = async () => {
    if (!sessionId) return;
    try {
      if (isPaused) {
        await resumeScanSession(sessionId);
        setRunPhase("running");
        pushLog("Tiếp tục phiên.", "info");
      } else {
        await pauseScanSession(sessionId);
        setRunPhase("paused");
        pushLog("Tạm dừng phiên.", "warn");
      }
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleStop = async () => {
    if (!sessionId) {
      setRunPhase("idle");
      return;
    }
    try {
      await stopScanSession(sessionId);
      pushLog("Dừng khẩn cấp.", "warn");
      stopPolling();
      setRunPhase("done");
      await refreshResults(sessionId, scanPageKeysRef.current);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleToggleExecution = () => {
    if (isBusy) handleStop();
    else handleStart();
  };

  const filteredLeftPages = useMemo(() => {
    const q = leftSearch.trim().toLowerCase();
    if (!q) return resultPages;
    return resultPages.filter((p) =>
      `${p.page_name || ""} ${p.page_key || ""}`.toLowerCase().includes(q),
    );
  }, [resultPages, leftSearch]);

  const activePage = useMemo(
    () => resultPages.find((p) => p.page_key === activePageKey) || resultPages[0] || null,
    [resultPages, activePageKey],
  );

  const activeFollowers = useMemo(() => {
    const key = activePage?.page_key;
    let list = key ? followersByPage[key] || [] : [];
    const q = rightSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((u) =>
        `${u.name} ${u.uid} ${u.location} ${u.profile_url}`.toLowerCase().includes(q),
      );
    }
    if (sortBy === "NAME") {
      list = [...list].sort((a, b) => String(a.name).localeCompare(String(b.name), "vi"));
    } else {
      list = [...list].sort((a, b) => String(b.time).localeCompare(String(a.time)));
    }
    return list;
  }, [followersByPage, activePage, rightSearch, sortBy]);

  const totalPages = Math.max(1, Math.ceil(activeFollowers.length / PAGE_SIZE) || 1);

  useEffect(() => {
    if (tablePage > totalPages) setTablePage(totalPages);
  }, [tablePage, totalPages]);

  const pagedFollowers = useMemo(() => {
    const start = (tablePage - 1) * PAGE_SIZE;
    return activeFollowers.slice(start, start + PAGE_SIZE);
  }, [activeFollowers, tablePage]);

  const resetResultSelection = () => {
    setTablePage(1);
    setSelectedRowIds([]);
  };

  const handleExportAll = () => {
    const all = Object.values(followersByPage).flat();
    if (!all.length) {
      toast.warning("Chưa có UID để xuất.");
      return;
    }
    exportFollowersCsv(all, `followers_all_${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Đã xuất ${all.length} UID.`);
  };

  const handleExportPage = () => {
    if (!activeFollowers.length) {
      toast.warning("Page này chưa có UID.");
      return;
    }
    const slug = (activePage?.page_key || "page").replace(/[:/\\]/g, "_");
    exportFollowersCsv(activeFollowers, `followers_${slug}.csv`);
    toast.success(`Đã xuất ${activeFollowers.length} UID của page.`);
  };

  const handleDeleteSelected = () => {
    if (!selectedRowIds.length || !activePage?.page_key) return;
    const key = activePage.page_key;
    setFollowersByPage((prev) => ({
      ...prev,
      [key]: (prev[key] || []).filter((u) => !selectedRowIds.includes(u.id)),
    }));
    setResultPages((prev) =>
      prev.map((p) =>
        p.page_key === key
          ? {
              ...p,
              scanned_uid_count: Math.max(0, (p.scanned_uid_count || 0) - selectedRowIds.length),
            }
          : p,
      ),
    );
    setSelectedRowIds([]);
    toast.success("Đã xóa UID khỏi bảng xem trước (kho DB không đổi).");
  };

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="font-heading text-[22px] font-bold tracking-tight text-[#0F172A]">
          Quét danh sách theo dõi page
        </h1>
        <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-[#64748B]">
          Thu thập danh sách người thích hoặc theo dõi trang, lọc thành viên mới và trích xuất
          UID/Profile tự động
          {sessionId ? (
            <span className="text-[#475569]">
              . Phiên #{sessionId}
              {resultCount > 0 ? ` · ${fmtNum(resultCount)} FL` : ""} ·{" "}
            </span>
          ) : (
            ". "
          )}
          <Link href="/scanner/list-followers" className="font-medium text-[#1877F2] hover:underline">
            Xem DS followers
          </Link>
        </p>
      </div>

      {/* Figma 2890-35336 — 2 config cards */}
      <div className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-2">
        <div className="flex flex-col rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#1877F2] text-xs font-bold text-white">
              1
            </span>
            <h3 className="font-heading text-[15px] font-bold text-[#0F172A]">
              Cấu hình chung, Chọn tài khoản &amp; Nhóm quét
            </h3>
          </div>

          <div className="space-y-5">
            <div>
              <p className="mb-2.5 text-[11px] font-bold tracking-wider text-[#64748B] uppercase">
                TÀI KHOẢN THỰC THI QUÉT
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setShowAccountModal(true)}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#1877F2] px-4 text-xs font-bold text-white shadow-sm transition hover:bg-[#166FE5] disabled:opacity-50"
                >
                  <Users className="size-4" />
                  Chọn tài khoản
                </button>
                <SelectedBadge>
                  Đã chọn:{" "}
                  <strong className="font-bold text-[#0F172A]">
                    {selectedUids.length} / {Math.max(accounts.length, 1)}
                  </strong>{" "}
                  tài khoản
                </SelectedBadge>
              </div>
            </div>

            <div>
              <p className="mb-2.5 text-[11px] font-bold tracking-wider text-[#64748B] uppercase">
                CHỈ ĐỊNH NHÓM CẦN QUÉT
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setShowPageModal(true)}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#1877F2] px-4 text-xs font-bold text-white shadow-sm transition hover:bg-[#166FE5] disabled:opacity-50"
                >
                  <Layers className="size-4" />
                  Chọn page muốn quét
                </button>
                <SelectedBadge>
                  Đã chọn:{" "}
                  <strong className="font-bold text-[#0F172A]">{selectedPages.length} nhóm</strong>
                </SelectedBadge>
              </div>
            </div>

            <div className="pt-0.5">
              <p className="mb-2.5 text-xs font-semibold text-[#1E293B]">
                Khoảng cách giữa các lần quét:
              </p>
              <div className="flex items-center gap-2">
                <StepperBox
                  value={delayMin}
                  onChange={(v) => {
                    setDelayMin(v);
                    if (v > delayMax) setDelayMax(v);
                  }}
                  min={1}
                  max={180}
                  disabled={isBusy}
                />
                <span className="text-xs text-[#64748B]">-</span>
                <StepperBox
                  value={delayMax}
                  onChange={(v) => setDelayMax(Math.max(delayMin, v))}
                  min={1}
                  max={180}
                  disabled={isBusy}
                />
                <span className="text-xs text-[#64748B]">giây</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#1877F2] text-xs font-bold text-white">
              2
            </span>
            <h3 className="font-heading text-[15px] font-bold text-[#0F172A]">
              Cấu hình quét nâng cao &amp; Bộ lọc
            </h3>
          </div>

          <div className="flex flex-1 flex-col space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-semibold text-[#1E293B]">
                Đổi tài khoản mới khi quét được:
              </span>
              <div className="flex items-center gap-2">
                <StepperBox
                  value={rotateEvery}
                  onChange={setRotateEvery}
                  min={1}
                  max={500}
                  step={5}
                  disabled={isBusy}
                />
                <span className="min-w-[7.5rem] text-xs text-[#64748B]">page / tài khoản</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-semibold text-[#1E293B]">Mỗi nhóm quét tối đa:</span>
              <div className="flex items-center gap-2">
                <StepperBox
                  value={maxPerPage}
                  onChange={setMaxPerPage}
                  min={10}
                  max={5000}
                  step={10}
                  disabled={isBusy}
                />
                <span className="min-w-[7.5rem] text-xs text-[#64748B]">followers / page</span>
              </div>
            </div>

            <div className="mt-auto space-y-3.5 pt-2">
              <label className="flex cursor-pointer items-center gap-2.5 select-none">
                <Checkbox
                  checked={prioritizeRecent}
                  disabled={isBusy}
                  onCheckedChange={(c) => setPrioritizeRecent(!!c)}
                />
                <span className="text-xs font-medium text-[#1E293B]">
                  Ưu tiên quét người mới theo dõi gần đây
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-2.5 select-none">
                <Checkbox
                  checked={dedupAcrossPages}
                  disabled={isBusy}
                  onCheckedChange={(c) => setDedupAcrossPages(!!c)}
                />
                <span className="text-xs font-medium text-[#1E293B]">
                  Tự động kiểm tra trùng UID giữa các page
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Preview — Figma */}
      <div className="overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] bg-[#F0F7FF] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#1877F2] shadow-sm">
              <ListChecks className="size-4" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h3 className="font-heading text-sm font-bold text-[#0F172A]">
                  Xem trước danh sách page muốn quét
                </h3>
                <span className="rounded-full bg-[#EFF6FF] px-2.5 py-0.5 text-[11px] font-bold text-[#1877F2]">
                  {selectedPages.length} page hợp lệ
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-[#64748B]">
                Danh sách các trang đã sẵn sàng cào danh sách followers
              </p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-[#F8FAFC] text-[11px] font-bold text-[#64748B] uppercase">
              <tr className="border-b border-[#E2E8F0]">
                <th className="w-16 px-6 py-3">STT</th>
                <th className="px-4 py-3">TÊN FANPAGE &amp; ID</th>
                <th className="px-4 py-3">NGÀNH NGHỀ / LOẠI PAGE</th>
                <th className="px-4 py-3">QUY MÔ / FOLLOWERS</th>
                <th className="w-24 px-6 py-3 text-center">THAO TÁC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {selectedPages.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-[#94A3B8]">
                    Chưa chọn Fanpage. Nhấn &ldquo;Chọn page muốn quét&rdquo; để thêm.
                  </td>
                </tr>
              ) : (
                selectedPages.map((page, idx) => (
                  <tr key={page.page_key || page.id} className="hover:bg-[#F8FAFC]">
                    <td className="px-6 py-3.5 font-mono text-[#64748B]">{padStt(idx + 1)}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                            page.avatar_color || "bg-indigo-100 text-indigo-700"
                          }`}
                        >
                          {page.avatar_initials || initialsOf(page.name || page.page_name)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-[#0F172A]">
                            {page.name || page.page_name}
                          </p>
                          <p className="font-mono text-[11px] text-[#94A3B8]">
                            UID: {page.page_id || page.uid}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-[#475569]">{page.category || "Fanpage"}</td>
                    <td className="px-4 py-3.5 font-bold text-[#0F172A]">
                      {page.followers_text || fmtNum(page.follower_count)} Followers
                    </td>
                    <td className="px-6 py-3.5 text-center">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          setSelectedPages((prev) =>
                            prev.filter((p) => p.page_key !== page.page_key),
                          )
                        }
                        className="rounded-lg p-1.5 text-[#94A3B8] hover:bg-[#FEE2E2] hover:text-[#EF4444] disabled:opacity-40"
                        title="Xóa page"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CTA */}
      <div className="space-y-2.5">
        <button
          type="button"
          onClick={handleToggleExecution}
          disabled={!isBusy && accountsLoading}
          className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold tracking-wide text-white shadow-sm transition ${
            isBusy
              ? "bg-[#DC2626] hover:bg-rose-700"
              : "bg-[#1877F2] hover:bg-[#166FE5] disabled:opacity-60"
          }`}
        >
          {isBusy ? (
            <>
              <Square className="size-4 fill-white" />
              <span>DỪNG THỰC THI QUÉT FOLLOWERS</span>
            </>
          ) : (
            <>
              <Play className="size-4 fill-white" />
              <span>BẮT ĐẦU THỰC THI</span>
            </>
          )}
        </button>
        {isBusy && (
          <button
            type="button"
            onClick={handlePauseResume}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[#F59E0B] bg-white text-xs font-bold text-[#D97706] hover:bg-amber-50"
          >
            {isPaused ? (
              <>
                <Play className="size-3.5 fill-current" />
                TIẾP TỤC QUÉT
              </>
            ) : (
              <>
                <Pause className="size-3.5" />
                TẠM DỪNG QUÉT
              </>
            )}
          </button>
        )}
      </div>

      {/* Results — Figma master-detail, chỉ hiện khi quét xong */}
      {showResults ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <h3 className="font-heading text-base font-bold text-[#0F172A]">
                Kết quả quét người theo dõi
              </h3>
              <span className="rounded-full bg-[#EFF6FF] px-3 py-0.5 text-xs font-bold text-[#1877F2]">
                {fmtNum(resultCount)} UID thu thập
              </span>
            </div>
            <button
              type="button"
              onClick={handleExportAll}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white px-3.5 text-xs font-bold text-[#1E293B] shadow-sm hover:bg-[#F8FAFC]"
            >
              <Download className="size-3.5 text-[#1877F2]" />
              Xuất toàn bộ file (Excel/CSV)
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Left — Danh mục Page mục tiêu */}
            <div className="flex flex-col rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-sm lg:col-span-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-bold text-[#0F172A]">
                  Danh mục Page mục tiêu ({filteredLeftPages.length})
                </span>
                <SlidersHorizontal className="size-3.5 text-[#64748B]" />
              </div>

              <div className="relative mb-3">
                <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[#94A3B8]" />
                <input
                  value={leftSearch}
                  onChange={(e) => setLeftSearch(e.target.value)}
                  placeholder="Tìm tên Page, UID..."
                  className="h-9 w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] pr-3 pl-9 text-xs text-[#0F172A] outline-none focus:border-[#1877F2] focus:bg-white"
                />
              </div>

              <div className="max-h-[440px] flex-1 space-y-2.5 overflow-y-auto pr-1">
                {filteredLeftPages.length === 0 ? (
                  <p className="py-8 text-center text-[11px] text-[#94A3B8]">Chưa có page trong phiên</p>
                ) : (
                  filteredLeftPages.map((pg, idx) => {
                    const active = activePage?.page_key === pg.page_key;
                    const done = pg.status === "DONE" || (pg.scanned_uid_count || 0) > 0;
                    return (
                      <button
                        key={pg.page_key}
                        type="button"
                        onClick={() => {
                          setActivePageKey(pg.page_key);
                          resetResultSelection();
                        }}
                        className={`w-full cursor-pointer rounded-xl border p-3.5 text-left transition ${
                          active
                            ? "border-2 border-[#1877F2] bg-[#EFF6FF]/30 shadow-sm"
                            : "border-[#E2E8F0] bg-white hover:bg-[#F8FAFC]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-bold text-[#0F172A]">
                            {pg.page_name}
                          </span>
                          <span
                            className={`size-2 shrink-0 rounded-full ${
                              done ? "bg-[#10B981]" : "bg-[#CBD5E1]"
                            }`}
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-[#64748B]">
                          <span>
                            Quy mô:{" "}
                            <strong className="text-[#0F172A]">
                              {fmtNum(pg.follower_count)}
                            </strong>{" "}
                            followers
                          </span>
                          <span
                            className={
                              active
                                ? "font-bold text-[#1877F2]"
                                : "font-semibold text-[#334155]"
                            }
                          >
                            Đã quét: {fmtNum(pg.scanned_uid_count)} UID
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-[#F1F5F9] pt-3 text-xs">
                <span className="text-[#64748B]">Tổng UID đã xử lý:</span>
                <strong className="font-mono font-bold text-[#1877F2]">
                  {fmtNum(resultCount)} UID
                </strong>
              </div>
            </div>

            {/* Right — chi tiết UID */}
            <div className="flex flex-col rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm lg:col-span-8">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F1F5F9] pb-3.5">
                <div>
                  <h4 className="font-heading text-sm font-bold text-[#0F172A]">
                    {activePage?.page_name || "Chọn page bên trái"}
                  </h4>
                  <p className="mt-0.5 text-xs text-[#64748B]">
                    Quy mô:{" "}
                    <strong className="text-[#0F172A]">
                      {fmtNum(activePage?.follower_count)}
                    </strong>{" "}
                    Followers • Đã thu thập:{" "}
                    <strong className="font-mono text-[#1877F2]">
                      {fmtNum(activeFollowers.length)}
                    </strong>{" "}
                    UID
                    {updatedAt ? ` • Cập nhật: ${updatedAt}` : null}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleExportPage}
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl bg-[#1877F2] px-4 text-xs font-bold text-white shadow-sm hover:bg-[#166FE5]"
                >
                  <Download className="size-3.5" />
                  Xuất UID Page này
                </button>
              </div>

              <div className="relative my-3.5">
                <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[#94A3B8]" />
                <input
                  value={rightSearch}
                  onChange={(e) => {
                    setRightSearch(e.target.value);
                    resetResultSelection();
                  }}
                  placeholder="Tìm UID, Tên, Vị trí..."
                  className="h-9 w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] pr-4 pl-10 text-xs text-[#0F172A] outline-none focus:border-[#1877F2] focus:bg-white"
                />
              </div>

              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#F8FAFC] px-3.5 py-2">
                <div className="flex items-center gap-2 text-xs font-bold text-[#1877F2]">
                  <span className="flex size-5 items-center justify-center rounded-full bg-[#1877F2] text-[10px] text-white">
                    {selectedRowIds.length}
                  </span>
                  Đã chọn: {selectedRowIds.length} UID
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toast.info("Đã mở hộp thoại chuyển danh mục")}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#334155] hover:bg-slate-50"
                  >
                    <FolderInput className="size-3.5" />
                    Chuyển danh mục
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const rows = activeFollowers.filter((u) => selectedRowIds.includes(u.id));
                      if (!rows.length) {
                        toast.warning("Chưa chọn UID nào.");
                        return;
                      }
                      exportFollowersCsv(rows, "followers_selected.csv");
                      toast.success(`Đã xuất ${rows.length} UID đã chọn.`);
                    }}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-1.5 text-xs font-bold text-[#1877F2] hover:bg-[#DBEAFE]"
                  >
                    <Download className="size-3.5" />
                    Xuất file chọn
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteSelected}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-1.5 text-xs font-bold text-[#DC2626] hover:bg-[#FEE2E2]"
                  >
                    <Trash2 className="size-3.5" />
                    Xóa
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F8FAFC] text-[11px] font-bold text-[#64748B] uppercase">
                    <tr className="border-b border-[#E2E8F0]">
                      <th className="w-8 px-3 py-2.5">
                        <Checkbox
                          checked={
                            pagedFollowers.length > 0 &&
                            pagedFollowers.every((u) => selectedRowIds.includes(u.id))
                          }
                          onCheckedChange={(c) => {
                            if (c) {
                              setSelectedRowIds((prev) => [
                                ...new Set([...prev, ...pagedFollowers.map((u) => u.id)]),
                              ]);
                            } else {
                              const drop = new Set(pagedFollowers.map((u) => u.id));
                              setSelectedRowIds((prev) => prev.filter((id) => !drop.has(id)));
                            }
                          }}
                        />
                      </th>
                      <th className="w-12 px-2 py-2.5">STT</th>
                      <th className="px-3 py-2.5">HỌ VÀ TÊN</th>
                      <th className="px-3 py-2.5">UID / PROFILE LINK</th>
                      <th className="px-3 py-2.5">ĐỊA CHỈ</th>
                      <th className="px-3 py-2.5">SỐ BẠN BÈ</th>
                      <th className="px-3 py-2.5 text-right">THỜI GIAN</th>
                      <th className="px-3 py-2.5 text-right">THAO TÁC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9]">
                    {pagedFollowers.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-3 py-10 text-center text-[#94A3B8]">
                          Không có UID nào được thu thập cho page này.
                        </td>
                      </tr>
                    ) : (
                      pagedFollowers.map((u, idx) => {
                        const stt = (tablePage - 1) * PAGE_SIZE + idx + 1;
                        const checked = selectedRowIds.includes(u.id);
                        return (
                          <tr key={u.id} className="hover:bg-[#F8FAFC]">
                            <td className="px-3 py-3">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(c) =>
                                  setSelectedRowIds((prev) =>
                                    c ? [...prev, u.id] : prev.filter((id) => id !== u.id),
                                  )
                                }
                              />
                            </td>
                            <td className="px-2 py-3 font-mono text-[#64748B]">{padStt(stt)}</td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2.5">
                                <Avatar className="size-7">
                                  <AvatarFallback
                                    className={AVATAR_COLORS[idx % AVATAR_COLORS.length]}
                                  >
                                    {initialsOf(u.name)}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="font-bold text-[#0F172A]">{u.name}</span>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <a
                                href={u.profile_url || `https://www.facebook.com/${u.uid}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 font-mono font-medium text-[#1877F2] hover:underline"
                              >
                                {u.uid}
                                <ExternalLink className="size-3" />
                              </a>
                            </td>
                            <td className="px-3 py-3 text-[#475569]">{u.location}</td>
                            <td className="px-3 py-3 font-semibold text-[#1E293B]">{u.friends}</td>
                            <td className="px-3 py-3 text-right font-mono text-[#64748B]">
                              {u.time ? String(u.time).replace("T", " ").slice(0, 19) : "—"}
                            </td>
                            <td className="px-3 py-3 text-right">
                              <div className="inline-flex items-center justify-end gap-1.5">
                                <a
                                  href={u.profile_url || `https://www.facebook.com/${u.uid}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="Xem trang cá nhân"
                                  className="rounded p-1 text-[#94A3B8] hover:bg-slate-100 hover:text-[#1877F2]"
                                >
                                  <Eye className="size-3.5" />
                                </a>
                                <button
                                  type="button"
                                  title="Xóa UID"
                                  onClick={() => {
                                    setFollowersByPage((prev) => ({
                                      ...prev,
                                      [activePageKey]: (prev[activePageKey] || []).filter(
                                        (f) => f.id !== u.id,
                                      ),
                                    }));
                                    setSelectedRowIds((prev) => prev.filter((id) => id !== u.id));
                                    toast.success(`Đã xóa UID ${u.uid}`);
                                  }}
                                  className="rounded p-1 text-[#94A3B8] hover:bg-red-50 hover:text-[#DC2626]"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#F1F5F9] pt-3 text-xs">
                <span className="text-[#64748B]">
                  Hiển thị{" "}
                  <strong className="text-[#0F172A]">
                    {activeFollowers.length === 0
                      ? "0"
                      : `${(tablePage - 1) * PAGE_SIZE + 1} - ${Math.min(
                          tablePage * PAGE_SIZE,
                          activeFollowers.length,
                        )}`}
                  </strong>{" "}
                  của <strong className="text-[#0F172A]">{fmtNum(activeFollowers.length)}</strong> UID
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={tablePage <= 1}
                    onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                    className="flex size-7 items-center justify-center rounded-lg border border-[#E2E8F0] text-[#64748B] hover:bg-[#F8FAFC] disabled:opacity-40"
                  >
                    <ChevronLeft className="size-3.5" />
                  </button>
                  {Array.from({ length: Math.min(3, totalPages) }, (_, i) => i + 1).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setTablePage(p)}
                      className={`flex size-7 items-center justify-center rounded-lg text-xs font-bold ${
                        tablePage === p
                          ? "bg-[#1877F2] text-white"
                          : "border border-[#E2E8F0] text-[#475569] hover:bg-[#F8FAFC]"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                  {totalPages > 3 ? (
                    <>
                      <span className="px-1 text-[#94A3B8]">...</span>
                      <button
                        type="button"
                        onClick={() => setTablePage(totalPages)}
                        className="flex h-7 items-center justify-center rounded-lg border border-[#E2E8F0] px-2 text-xs font-semibold text-[#475569]"
                      >
                        {totalPages}
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    disabled={tablePage >= totalPages}
                    onClick={() => setTablePage((p) => Math.min(totalPages, p + 1))}
                    className="flex size-7 items-center justify-center rounded-lg border border-[#E2E8F0] text-[#64748B] hover:bg-[#F8FAFC] disabled:opacity-40"
                  >
                    <ChevronRight className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {(runPhase !== "idle" || logs.length > 0) && (
        <LiveLogConsole title="Live Log · Quét followers page" logs={logs} phase={runPhase} />
      )}

      <SelectAccountsModal
        open={showAccountModal}
        onClose={() => setShowAccountModal(false)}
        accounts={accounts}
        loading={accountsLoading}
        selectedUids={selectedUids}
        onConfirm={(uids) => {
          setSelectedUids(uids);
          setShowAccountModal(false);
        }}
      />

      <SelectPagesModal
        open={showPageModal}
        onClose={() => setShowPageModal(false)}
        availablePages={availablePages}
        selectedPages={selectedPages}
        onConfirm={(pages) => {
          setSelectedPages(pages.map((p, i) => mapKhoToPage(p, i)));
          setShowPageModal(false);
        }}
      />
    </div>
  );
}
