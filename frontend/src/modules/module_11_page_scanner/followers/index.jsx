"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Pause,
  Square,
  Plus,
  Loader2,
  CheckCircle2,
  Search,
  Link2,
  FileUp,
  Download,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Trash2,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/lib/toast";
import { getAccounts } from "@/modules/module_02_account_manager/service";
import { normalizeAccount, initialsOf } from "@/modules/module_07_group_spam/shared/components";
import { AVATAR_COLORS } from "@/modules/module_07_group_spam/shared/constants";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  createFollowerSession,
  getScannedPages,
  getPageFollowers,
  loadSavedPageLists,
  resolvePageLinks,
  stopScanSession,
  pauseScanSession,
  resumeScanSession,
  getScanSessionDetail,
} from "../service";
import { SectionCard, LiveLogConsole, nowStamp, LIVE_STATUSES } from "../_shared";

const DONE_STATUSES = ["COMPLETED", "PARTIAL", "STOPPED", "FAILED"];
const PAGE_SIZE = 10;

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
    friends: row.friend_count != null ? Number(row.friend_count).toLocaleString("vi-VN") : "—",
    time: row.updated_at || row.created_at || "",
    page_key: row.page_key || "",
    page_name: row.page_name || row.page_key || "",
  };
}

export default function PageScannerFollowers() {
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [selectedUids, setSelectedUids] = useState([]);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [modalUids, setModalUids] = useState([]);

  const [sourceMode, setSourceMode] = useState("kho"); // kho | saved | paste
  const [khoPages, setKhoPages] = useState([]);
  const [khoSearch, setKhoSearch] = useState("");
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [savedLists, setSavedLists] = useState([]);
  const [savedListId, setSavedListId] = useState("");
  const [pasteText, setPasteText] = useState("");

  const [targetFollowers, setTargetFollowers] = useState(500);
  const [maxPerPage, setMaxPerPage] = useState(200);
  const [idleTimeout, setIdleTimeout] = useState(90);
  const [pageDelay, setPageDelay] = useState(2);
  const [keepBrowser, setKeepBrowser] = useState(true);
  const [skipExisting, setSkipExisting] = useState(true);

  const [runPhase, setRunPhase] = useState("idle");
  const [sessionId, setSessionId] = useState(null);
  const [resultCount, setResultCount] = useState(0);
  const [logs, setLogs] = useState([]);
  const logId = useRef(0);
  const pollRef = useRef(null);

  /* Kết quả master–detail (UI Figma) */
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
  const selCount = selectedUids.length;

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

  const syncSessionLogs = useCallback((session) => {
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
  }, [sessionId]);

  const refreshResults = useCallback(async (sid, pageKeys) => {
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
      /* Đảm bảo mọi page trong phiên đều xuất hiện sidebar */
      for (const pk of keys) {
        if (!byPage[pk]) byPage[pk] = [];
      }
      setFollowersByPage(byPage);
      setResultCount(fl.total ?? items.length);
      setUpdatedAt(nowStamp());

      setResultPages((prev) => {
        const meta = new Map(prev.map((p) => [p.page_key, p]));
        const next = keys.map((pk, idx) => {
          const existing = meta.get(pk);
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
            page_name: existing?.page_name || fromKho?.page_name || pk,
            page_url: existing?.page_url || fromKho?.page_url || "",
            follower_count: existing?.follower_count ?? fromKho?.follower_count ?? 0,
            scanned_uid_count: count,
            status,
            status_label,
            avatar_initials: initialsOf(existing?.page_name || fromKho?.page_name || pk),
          };
        });
        return next;
      });
    } catch (err) {
      console.error(err);
    }
  }, [khoPages, runPhase]);

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
      } catch (err) {
        toast.error(`Lỗi tải tài khoản: ${err.message}`);
      } finally {
        if (!cancelled) setAccountsLoading(false);
      }
    })();
    setSavedLists(loadSavedPageLists());
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getScannedPages({ page: 1, page_size: 100, sort_by: "followers" });
        if (!cancelled) setKhoPages(data.items || []);
      } catch {
        /* empty kho ok */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredKho = useMemo(() => {
    const q = khoSearch.trim().toLowerCase();
    if (!q) return khoPages;
    return khoPages.filter(
      (p) =>
        `${p.page_name || ""} ${p.page_url || ""} ${p.page_key || ""}`.toLowerCase().includes(q),
    );
  }, [khoPages, khoSearch]);

  const resolveSelectedPageKeys = async () => {
    if (sourceMode === "kho" || sourceMode === "saved") {
      if (sourceMode === "saved" && savedListId) {
        const list = savedLists.find((l) => l.id === savedListId);
        const keys = (list?.pages || []).map((p) => p.page_key).filter(Boolean);
        if (!keys.length) throw new Error("Danh sách đã lưu không có page_key.");
        return keys;
      }
      if (!selectedKeys.length) throw new Error("Chọn ít nhất 1 Page.");
      return [...selectedKeys];
    }
    if (!pasteText.trim()) throw new Error("Dán danh sách link Page.");
    const parsed = await resolvePageLinks({ content: pasteText, filter_existing: false });
    const keys = (parsed.pages || []).map((p) => p.page_key).filter(Boolean);
    if (!keys.length) throw new Error("Không parse được page_key hợp lệ.");
    return keys;
  };

  const handleStart = async () => {
    try {
      const pageKeys = await resolveSelectedPageKeys();
      const live = accounts.filter((a) => selectedUids.includes(a.uid) && LIVE_STATUSES.has(String(a.status)));
      const accountUid = live[0]?.uid || selectedUids[0] || null;
      if (!accountUid) throw new Error("Chọn ít nhất 1 tài khoản Live.");

      stopPolling();
      setRunPhase("running");
      setLogs([]);
      setResultCount(0);
      setFollowersByPage({});
      setSelectedRowIds([]);
      setTablePage(1);
      scanPageKeysRef.current = pageKeys;
      setResultPages(
        pageKeys.map((pk, idx) => {
          const fromKho = khoPages.find((p) => p.page_key === pk);
          return {
            page_key: pk,
            page_name: fromKho?.page_name || pk,
            page_url: fromKho?.page_url || "",
            follower_count: fromKho?.follower_count || 0,
            scanned_uid_count: 0,
            status: idx === 0 ? "RUNNING" : "QUEUE",
            status_label: idx === 0 ? "Đang thu thập..." : "Đang chờ hàng đợi",
            avatar_initials: initialsOf(fromKho?.page_name || pk),
          };
        }),
      );
      setActivePageKey(pageKeys[0] || "");
      pushLog(`Tạo phiên FOLLOW · ${pageKeys.length} Page · target=${targetFollowers}`, "info");

      const res = await createFollowerSession({
        page_keys: pageKeys,
        account_uid: accountUid,
        keep_browser: keepBrowser,
        target_followers: targetFollowers,
        max_per_page: maxPerPage,
        idle_timeout_s: idleTimeout,
        skip_existing: skipExisting,
        source_list_id: sourceMode === "saved" ? savedListId || null : null,
        page_delay_s: pageDelay,
      });

      setSessionId(res.session_id);
      pushLog(`Session #${res.session_id} · ${res.status || "RUNNING"} · ${res.message || "OK"}`, "success");
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
  const pagedFollowers = useMemo(() => {
    const start = (tablePage - 1) * PAGE_SIZE;
    return activeFollowers.slice(start, start + PAGE_SIZE);
  }, [activeFollowers, tablePage]);

  useEffect(() => {
    setTablePage(1);
    setSelectedRowIds([]);
  }, [activePageKey, rightSearch, sortBy]);

  useEffect(() => {
    if (tablePage > totalPages) setTablePage(totalPages);
  }, [tablePage, totalPages]);

  const runningCount = resultPages.filter((p) => p.status === "RUNNING").length;
  const showResults = resultPages.length > 0 || runPhase !== "idle";

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
    <div className="space-y-5 pb-8">
      <div>
        <h1 className="font-heading text-xl font-bold text-slate-900">Quét followers page</h1>
        <p className="mt-1 text-xs text-slate-500">
          Chọn Page từ kho mục 1 → cấu hình hạn mức FL · Selenium live.{" "}
          {sessionId ? (
            <span className="text-slate-600">
              Phiên #{sessionId}
              {resultCount > 0 ? ` · ${resultCount} FL` : ""} ·{" "}
            </span>
          ) : null}
          <Link href="/scanner/list-followers" className="text-primary hover:underline">
            Xem DS followers
          </Link>
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          number="1"
          title="Chọn tài khoản & nguồn Page"
          description="Acc Live + Page cần quét followers"
          aside={
            selCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                <CheckCircle2 className="size-3" /> {selCount} acc
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
              <span className="text-[11px] text-slate-400">Chưa chọn → Selenium sau sẽ tự chọn acc Live</span>
            )}
          </div>

          <p className="mb-2 text-[11px] font-bold tracking-wide text-slate-500">NGUỒN PAGE</p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {[
              { id: "kho", label: "Kho đã quét", Icon: Search },
              { id: "saved", label: "Danh sách đã lưu", Icon: FileUp },
              { id: "paste", label: "Dán link", Icon: Link2 },
            ].map(({ id, label, Icon }) => (
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

          {sourceMode === "kho" && (
            <div className="space-y-2">
              <Input
                value={khoSearch}
                onChange={(e) => setKhoSearch(e.target.value)}
                placeholder="Lọc tên / link Page…"
                className="h-8 text-[11px]"
                disabled={isBusy}
              />
              <div className="max-h-48 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="w-8 px-2 py-2">
                        <Checkbox
                          checked={filteredKho.length > 0 && selectedKeys.length === filteredKho.length}
                          onCheckedChange={(c) =>
                            setSelectedKeys(c ? filteredKho.map((p) => p.page_key).filter(Boolean) : [])
                          }
                        />
                      </th>
                      <th className="px-2 py-2 text-left">Page</th>
                      <th className="px-2 py-2 text-right">FL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredKho.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-3 py-6 text-center text-slate-400">
                          Chưa có Page trong kho — quét mục 1 trước.
                        </td>
                      </tr>
                    ) : (
                      filteredKho.map((p) => (
                        <tr key={p.page_key} className="hover:bg-slate-50">
                          <td className="px-2 py-1.5">
                            <Checkbox
                              checked={selectedKeys.includes(p.page_key)}
                              onCheckedChange={(c) =>
                                setSelectedKeys((prev) =>
                                  c ? [...prev, p.page_key] : prev.filter((k) => k !== p.page_key),
                                )
                              }
                            />
                          </td>
                          <td className="px-2 py-1.5 font-medium text-slate-800">{p.page_name || p.page_key}</td>
                          <td className="px-2 py-1.5 text-right text-slate-500">
                            {p.follower_count != null ? Number(p.follower_count).toLocaleString("vi-VN") : "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-slate-400">Đã chọn {selectedKeys.length} Page</p>
            </div>
          )}

          {sourceMode === "saved" && (
            <div className="space-y-2">
              <select
                value={savedListId}
                disabled={isBusy}
                onChange={(e) => {
                  setSavedListId(e.target.value);
                  const list = savedLists.find((l) => l.id === e.target.value);
                  setSelectedKeys((list?.pages || []).map((p) => p.page_key).filter(Boolean));
                }}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-[11px]"
              >
                <option value="">— Chọn danh sách —</option>
                {savedLists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.count})
                  </option>
                ))}
              </select>
              {!savedLists.length && (
                <p className="text-[11px] text-slate-400">Chưa có list — dùng &quot;Lưu danh sách&quot; ở mục 1.</p>
              )}
            </div>
          )}

          {sourceMode === "paste" && (
            <Textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              disabled={isBusy}
              rows={6}
              placeholder={"Mỗi dòng 1 link Page\nhttps://www.facebook.com/…"}
              className="text-[11px]"
            />
          )}
        </SectionCard>

        <SectionCard number="2" title="Hạn mức & an toàn" description="Contract Selenium — lưu vào settings phiên">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-[11px]">
              <span className="font-semibold text-slate-700">Target followers (tổng)</span>
              <Input
                type="number"
                min={1}
                value={targetFollowers}
                disabled={isBusy}
                onChange={(e) => setTargetFollowers(Math.max(1, Number(e.target.value) || 1))}
                className="h-8"
              />
            </label>
            <label className="space-y-1 text-[11px]">
              <span className="font-semibold text-slate-700">Max / Page</span>
              <Input
                type="number"
                min={1}
                value={maxPerPage}
                disabled={isBusy}
                onChange={(e) => setMaxPerPage(Math.max(1, Number(e.target.value) || 1))}
                className="h-8"
              />
            </label>
            <label className="space-y-1 text-[11px]">
              <span className="font-semibold text-slate-700">Idle timeout (s)</span>
              <Input
                type="number"
                min={5}
                value={idleTimeout}
                disabled={isBusy}
                onChange={(e) => setIdleTimeout(Math.max(5, Number(e.target.value) || 90))}
                className="h-8"
              />
            </label>
            <label className="space-y-1 text-[11px]">
              <span className="font-semibold text-slate-700">Delay giữa Page (s)</span>
              <Input
                type="number"
                min={0}
                step={0.5}
                value={pageDelay}
                disabled={isBusy}
                onChange={(e) => setPageDelay(Math.max(0, Number(e.target.value) || 0))}
                className="h-8"
              />
            </label>
          </div>
          <div className="mt-4 space-y-2">
            <label className="flex items-center gap-2 text-[12px] text-slate-800">
              <Checkbox checked={keepBrowser} disabled={isBusy} onCheckedChange={(c) => setKeepBrowser(!!c)} />
              Giữ browser sau phiên (keep_browser)
            </label>
            <label className="flex items-center gap-2 text-[12px] text-slate-800">
              <Checkbox checked={skipExisting} disabled={isBusy} onCheckedChange={(c) => setSkipExisting(!!c)} />
              Bỏ qua follower đã có trong kho
            </label>
          </div>
        </SectionCard>
      </div>

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
            <Button type="button" variant="outline" size="lg" className="gap-2 border-red-300 text-red-600" onClick={handlePauseResume}>
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
            <Button type="button" variant="outline" size="lg" className="gap-2 border-red-400 bg-red-50 text-red-700" onClick={handleStop}>
              <Square className="size-4" /> DỪNG KHẨN CẤP
            </Button>
          </div>
        )}
      </div>

      {/* ═══ Kết quả master–detail (UI Figma) ═══ */}
      {showResults && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-bold text-slate-800">Kết quả quét người theo dõi</h2>
              <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                Tổng {Number(resultCount || 0).toLocaleString("vi-VN")} UID
              </span>
            </div>
            <button
              type="button"
              onClick={handleExportAll}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700"
            >
              <FileSpreadsheet className="size-4" />
              Xuất toàn bộ file Excel
            </button>
          </div>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
            {/* Left: DANH MỤC PAGE */}
            <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs lg:col-span-3">
              <div className="flex items-center justify-between border-b border-slate-100 p-3.5">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  DANH MỤC PAGE ({resultPages.length})
                </span>
                <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                  Đang chạy {runningCount}/{resultPages.length || 0}
                </span>
              </div>

              <div className="border-b border-slate-100 p-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={leftSearch}
                    onChange={(e) => setLeftSearch(e.target.value)}
                    placeholder="Tìm tên hoặc ID Fanpage..."
                    className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-xs focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
                {filteredLeftPages.length === 0 ? (
                  <p className="p-4 text-center text-[11px] text-slate-400">Chưa có page trong phiên</p>
                ) : (
                  filteredLeftPages.map((p, idx) => {
                    const isSelected = activePage?.page_key === p.page_key;
                    const statusClass =
                      p.status === "RUNNING"
                        ? "text-blue-600"
                        : p.status === "DONE"
                          ? "text-emerald-600"
                          : "text-amber-600";
                    return (
                      <button
                        key={p.page_key}
                        type="button"
                        onClick={() => setActivePageKey(p.page_key)}
                        className={`flex w-full cursor-pointer items-start justify-between gap-2 p-3.5 text-left transition-colors ${
                          isSelected
                            ? "border-l-4 border-l-blue-600 bg-blue-50/80"
                            : "hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex min-w-0 items-start gap-2.5">
                          <div
                            className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${
                              AVATAR_COLORS[idx % AVATAR_COLORS.length]
                            }`}
                          >
                            {p.avatar_initials || initialsOf(p.page_name)}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-xs font-bold text-slate-800">{p.page_name}</div>
                            <div className={`mt-1 text-[11px] font-semibold ${statusClass}`}>
                              ● {p.status_label}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                            isSelected ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {p.scanned_uid_count || 0} UID
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right: chi tiết followers */}
            <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs lg:col-span-9">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {activePage?.page_name || "Chọn page bên trái"}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Quy mô:{" "}
                    <strong className="text-slate-700">
                      {Number(activePage?.follower_count || 0).toLocaleString("vi-VN")} Followers
                    </strong>{" "}
                    • Đã quét:{" "}
                    <strong className="text-blue-600">
                      {activeFollowers.length} UID
                    </strong>
                    {updatedAt ? ` • Cập nhật lúc: ${updatedAt}` : null}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleExportPage}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-blue-700"
                >
                  <Download className="size-3.5" />
                  Xuất Page này
                </button>
              </div>

              <div className="space-y-3 border-b border-slate-100 bg-slate-50/60 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative min-w-[240px] flex-1">
                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={rightSearch}
                      onChange={(e) => setRightSearch(e.target.value)}
                      placeholder="Tìm UID, tên, vị trí, profile..."
                      className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-500">Sắp xếp:</span>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none"
                    >
                      <option value="NEWEST">Mới nhất</option>
                      <option value="NAME">Theo tên A–Z</option>
                    </select>
                  </div>
                </div>

                {selectedRowIds.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3.5 py-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-blue-600">
                      <span className="flex size-5 items-center justify-center rounded-full bg-blue-600 text-[10px] text-white">
                        {selectedRowIds.length}
                      </span>
                      Đã chọn: {selectedRowIds.length} UID
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const rows = activeFollowers.filter((u) => selectedRowIds.includes(u.id));
                          exportFollowersCsv(rows, "followers_selected.csv");
                          toast.success(`Đã xuất ${rows.length} UID đã chọn.`);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100"
                      >
                        <Download className="size-3.5" />
                        Xuất file chọn
                      </button>
                      <button
                        type="button"
                        onClick={handleDeleteSelected}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100"
                      >
                        <Trash2 className="size-3.5" />
                        Xóa
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-[11px] font-bold uppercase text-slate-500">
                      <th className="w-10 px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={
                            pagedFollowers.length > 0 &&
                            pagedFollowers.every((u) => selectedRowIds.includes(u.id))
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedRowIds((prev) => [
                                ...new Set([...prev, ...pagedFollowers.map((u) => u.id)]),
                              ]);
                            } else {
                              const drop = new Set(pagedFollowers.map((u) => u.id));
                              setSelectedRowIds((prev) => prev.filter((id) => !drop.has(id)));
                            }
                          }}
                          className="size-3.5 rounded border-slate-300 text-blue-600"
                        />
                      </th>
                      <th className="w-12 px-3 py-3">STT</th>
                      <th className="min-w-[180px] px-3 py-3">HỌ VÀ TÊN</th>
                      <th className="px-3 py-3">UID / PROFILE</th>
                      <th className="px-3 py-3">ĐỊA CHỈ</th>
                      <th className="px-3 py-3 text-center">BẠN BÈ</th>
                      <th className="px-3 py-3 text-right">THỜI GIAN</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {pagedFollowers.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-10 text-center text-slate-400">
                          {isBusy
                            ? "Đang thu thập followers…"
                            : "Chưa có UID — bắt đầu quét hoặc chọn page khác."}
                        </td>
                      </tr>
                    ) : (
                      pagedFollowers.map((u, idx) => {
                        const stt = (tablePage - 1) * PAGE_SIZE + idx + 1;
                        return (
                          <tr key={u.id} className="hover:bg-slate-50/80">
                            <td className="px-3 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={selectedRowIds.includes(u.id)}
                                onChange={(e) =>
                                  setSelectedRowIds((prev) =>
                                    e.target.checked
                                      ? [...prev, u.id]
                                      : prev.filter((id) => id !== u.id),
                                  )
                                }
                                className="size-3.5 rounded border-slate-300 text-blue-600"
                              />
                            </td>
                            <td className="px-3 py-3 font-semibold text-slate-500">
                              {String(stt).padStart(2, "0")}
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2.5">
                                <Avatar className="size-7">
                                  <AvatarFallback className={AVATAR_COLORS[idx % AVATAR_COLORS.length]}>
                                    {initialsOf(u.name)}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="font-bold text-slate-800">{u.name}</span>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <a
                                href={u.profile_url || `https://www.facebook.com/${u.uid}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 font-mono font-medium text-blue-600 hover:underline"
                              >
                                {u.uid}
                                <ExternalLink className="size-3" />
                              </a>
                            </td>
                            <td className="px-3 py-3 text-slate-600">{u.location}</td>
                            <td className="px-3 py-3 text-center">
                              <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-bold text-blue-700">
                                {u.friends}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-right font-mono text-slate-500">
                              {u.time
                                ? String(u.time).replace("T", " ").slice(0, 19)
                                : "—"}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
                <span>
                  Hiển thị{" "}
                  <strong>
                    {activeFollowers.length === 0
                      ? "0"
                      : `${(tablePage - 1) * PAGE_SIZE + 1} - ${Math.min(
                          tablePage * PAGE_SIZE,
                          activeFollowers.length,
                        )}`}
                  </strong>{" "}
                  của <strong>{activeFollowers.length}</strong> UID
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={tablePage <= 1}
                    onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                    className="flex size-7 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ChevronLeft className="size-3.5" />
                  </button>
                  {(() => {
                    const windowSize = Math.min(5, totalPages);
                    let start = Math.max(1, tablePage - 2);
                    let end = start + windowSize - 1;
                    if (end > totalPages) {
                      end = totalPages;
                      start = Math.max(1, end - windowSize + 1);
                    }
                    const nums = [];
                    for (let n = start; n <= end; n += 1) nums.push(n);
                    return nums.map((pageNum) => (
                      <button
                        key={pageNum}
                        type="button"
                        onClick={() => setTablePage(pageNum)}
                        className={`flex size-7 items-center justify-center rounded text-xs font-bold ${
                          tablePage === pageNum
                            ? "bg-blue-600 text-white"
                            : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {pageNum}
                      </button>
                    ));
                  })()}
                  {totalPages > 5 && tablePage < totalPages - 2 && (
                    <>
                      <span className="px-1 text-slate-400">…</span>
                      <button
                        type="button"
                        onClick={() => setTablePage(totalPages)}
                        className="flex h-7 min-w-7 items-center justify-center rounded border border-slate-200 px-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                      >
                        {totalPages}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    disabled={tablePage >= totalPages}
                    onClick={() => setTablePage((p) => Math.min(totalPages, p + 1))}
                    className="flex size-7 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ChevronRight className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {(runPhase !== "idle" || logs.length > 0) && (
        <LiveLogConsole title="Live Log · Quét followers page" logs={logs} phase={runPhase} />
      )}

      {showAccountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="max-h-[80vh] w-full max-w-lg overflow-hidden border-slate-200 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h3 className="text-sm font-bold text-slate-800">Chọn tài khoản Live</h3>
              <Button type="button" size="sm" variant="outline" onClick={() => setShowAccountModal(false)}>
                Đóng
              </Button>
            </div>
            <div className="max-h-[50vh] overflow-auto p-2">
              {accountsLoading ? (
                <p className="p-4 text-center text-[11px] text-slate-400">Đang tải…</p>
              ) : (
                <table className="w-full text-[11px]">
                  <tbody>
                    {accounts.map((acc, idx) => {
                      const live = LIVE_STATUSES.has(String(acc.status));
                      return (
                        <tr key={acc.uid || idx} className={!live ? "opacity-40" : ""}>
                          <td className="px-2 py-2">
                            <Checkbox
                              disabled={!live}
                              checked={modalUids.includes(acc.uid)}
                              onCheckedChange={(c) =>
                                setModalUids((prev) =>
                                  c ? [...prev, acc.uid] : prev.filter((u) => u !== acc.uid),
                                )
                              }
                            />
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-2">
                              <Avatar className="size-7">
                                {acc.avatar && <AvatarImage src={acc.avatar} />}
                                <AvatarFallback className={AVATAR_COLORS[idx % AVATAR_COLORS.length]}>
                                  {initialsOf(acc.name || acc.uid || "A")}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <div className="font-semibold text-slate-800">{acc.name || acc.uid}</div>
                                <div className="text-[10px] text-slate-400">{acc.status}</div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setSelectedUids([...modalUids]);
                  setShowAccountModal(false);
                }}
              >
                Xác nhận
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
