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
  createPostScanSession,
  getScannedPages,
  getScannedPosts,
  resolvePageLinks,
  stopScanSession,
  pauseScanSession,
  resumeScanSession,
  getScanSessionDetail,
} from "../service";
import { SectionCard, LiveLogConsole, nowStamp, LIVE_STATUSES } from "../_shared";
import { useSavedPageLists } from "../shared/useSavedPageLists";

const POST_TYPE_OPTS = [
  { id: "all", label: "Tất cả" },
  { id: "photo", label: "Ảnh" },
  { id: "video", label: "Video" },
  { id: "text", label: "Text" },
];

const DONE_STATUSES = ["COMPLETED", "PARTIAL", "STOPPED", "FAILED"];

export default function PageScannerPosts() {
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [selectedUids, setSelectedUids] = useState([]);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [modalUids, setModalUids] = useState([]);

  const [sourceMode, setSourceMode] = useState("kho");
  const [khoPages, setKhoPages] = useState([]);
  const [khoSearch, setKhoSearch] = useState("");
  const [selectedKeys, setSelectedKeys] = useState([]);
  const savedLists = useSavedPageLists();
  const [savedListId, setSavedListId] = useState("");
  const [pasteText, setPasteText] = useState("");

  const [maxPostsPerPage, setMaxPostsPerPage] = useState(50);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [postTypes, setPostTypes] = useState(["all"]);
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
          if (DONE_STATUSES.includes(session.status)) {
            stopPolling();
            setRunPhase("done");
            try {
              const posts = await getScannedPosts({ session_id: sid, page: 1, page_size: 1 });
              setResultCount(posts.total ?? count);
            } catch {
              /* ignore */
            }
            toast.success(
              `Phiên POST_SCAN #${sid} · ${session.status}/${session.stop_reason || "—"} · ${count} bài`,
            );
          }
        } catch (e) {
          console.error(e);
        }
      }, 1500);
    },
    [stopPolling, syncSessionLogs],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setAccountsLoading(true);
        const data = await getAccounts();
        if (cancelled) return;
        setAccounts((Array.isArray(data) ? data : data?.accounts || []).map((a, i) => normalizeAccount(a, i)));
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
        if (!cancelled) setKhoPages(data.items || []);
      } catch {
        /* ok */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredKho = useMemo(() => {
    const q = khoSearch.trim().toLowerCase();
    if (!q) return khoPages;
    return khoPages.filter((p) =>
      `${p.page_name || ""} ${p.page_url || ""} ${p.page_key || ""}`.toLowerCase().includes(q),
    );
  }, [khoPages, khoSearch]);

  const toggleType = (id) => {
    if (id === "all") {
      setPostTypes(["all"]);
      return;
    }
    setPostTypes((prev) => {
      const withoutAll = prev.filter((t) => t !== "all");
      if (withoutAll.includes(id)) {
        const next = withoutAll.filter((t) => t !== id);
        return next.length ? next : ["all"];
      }
      return [...withoutAll, id];
    });
  };

  const resolveSelectedPageKeys = async () => {
    if (sourceMode === "saved" && savedListId) {
      const list = savedLists.find((l) => l.id === savedListId);
      const keys = (list?.pages || []).map((p) => p.page_key).filter(Boolean);
      if (!keys.length) throw new Error("Danh sách đã lưu không có page_key.");
      return keys;
    }
    if (sourceMode === "kho" || sourceMode === "saved") {
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
      pushLog(`Tạo phiên POST_SCAN · ${pageKeys.length} Page · max/page=${maxPostsPerPage}`, "info");

      const res = await createPostScanSession({
        page_keys: pageKeys,
        account_uid: accountUid,
        keep_browser: keepBrowser,
        max_posts_per_page: maxPostsPerPage,
        date_from: dateFrom || null,
        date_to: dateTo || null,
        post_types: postTypes,
        idle_timeout_s: idleTimeout,
        skip_existing: skipExisting,
        page_delay_s: pageDelay,
        source_list_id: sourceMode === "saved" ? savedListId || null : null,
      });

      setSessionId(res.session_id);
      pushLog(`Session #${res.session_id} · ${res.status || "RUNNING"} · ${res.message || "OK"}`, "success");
      toast.success(`Đã khởi động POST_SCAN #${res.session_id}`);
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
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-5 pb-8">
      <div>
        <h1 className="font-heading text-xl font-bold text-slate-900">Quét bài viết page</h1>
        <p className="mt-1 text-xs text-slate-500">
          Chọn Page → cấu hình ngày / loại bài / max · Selenium live.{" "}
          {sessionId ? (
            <span className="text-slate-600">
              Phiên #{sessionId}
              {resultCount > 0 ? ` · ${resultCount} bài` : ""} ·{" "}
            </span>
          ) : null}
          <Link href="/scanner/list-posts" className="text-primary hover:underline">
            Xem DS bài viết
          </Link>
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          number="1"
          title="Chọn tài khoản & nguồn Page"
          description="Acc Live + Page cần quét bài viết"
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
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[11px] font-semibold ${
                  sourceMode === id
                    ? "border-primary bg-primary text-white"
                    : "border-slate-200 bg-white text-slate-500"
                }`}
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
                placeholder="Lọc Page…"
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
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredKho.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="px-3 py-6 text-center text-slate-400">
                          Chưa có Page trong kho.
                        </td>
                      </tr>
                    ) : (
                      filteredKho.map((p) => (
                        <tr key={p.page_key}>
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
                          <td className="px-2 py-1.5 font-medium">{p.page_name || p.page_key}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {sourceMode === "saved" && (
            <select
              value={savedListId}
              disabled={isBusy}
              onChange={(e) => {
                setSavedListId(e.target.value);
                const list = savedLists.find((l) => l.id === e.target.value);
                setSelectedKeys((list?.pages || []).map((p) => p.page_key).filter(Boolean));
              }}
              className="h-9 w-full rounded-md border border-slate-200 px-3 text-[11px]"
            >
              <option value="">— Chọn danh sách —</option>
              {savedLists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.count})
                </option>
              ))}
            </select>
          )}

          {sourceMode === "paste" && (
            <Textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              disabled={isBusy}
              rows={6}
              placeholder="Mỗi dòng 1 link Page"
              className="text-[11px]"
            />
          )}
        </SectionCard>

        <SectionCard number="2" title="Hạn mức bài viết & bộ lọc" description="Contract Selenium — lưu settings phiên">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-[11px]">
              <span className="font-semibold text-slate-700">Max bài / Page</span>
              <Input
                type="number"
                min={1}
                value={maxPostsPerPage}
                disabled={isBusy}
                onChange={(e) => setMaxPostsPerPage(Math.max(1, Number(e.target.value) || 1))}
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
              <span className="font-semibold text-slate-700">Từ ngày</span>
              <Input type="date" value={dateFrom} disabled={isBusy} onChange={(e) => setDateFrom(e.target.value)} className="h-8" />
            </label>
            <label className="space-y-1 text-[11px]">
              <span className="font-semibold text-slate-700">Đến ngày</span>
              <Input type="date" value={dateTo} disabled={isBusy} onChange={(e) => setDateTo(e.target.value)} className="h-8" />
            </label>
            <label className="col-span-2 space-y-1 text-[11px]">
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

          <p className="mb-2 mt-4 text-[11px] font-semibold text-slate-700">Loại bài</p>
          <div className="flex flex-wrap gap-1.5">
            {POST_TYPE_OPTS.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={isBusy}
                onClick={() => toggleType(t.id)}
                className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
                  postTypes.includes(t.id)
                    ? "border-primary bg-primary text-white"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-4 space-y-2">
            <label className="flex items-center gap-2 text-[12px]">
              <Checkbox checked={keepBrowser} disabled={isBusy} onCheckedChange={(c) => setKeepBrowser(!!c)} />
              Giữ browser sau phiên (keep_browser)
            </label>
            <label className="flex items-center gap-2 text-[12px]">
              <Checkbox checked={skipExisting} disabled={isBusy} onCheckedChange={(c) => setSkipExisting(!!c)} />
              Bỏ qua bài đã có trong kho
            </label>
          </div>
        </SectionCard>
      </div>

      <div className="flex flex-col gap-2">
        <Button type="button" size="lg" className="w-full gap-2 text-sm font-bold" disabled={isBusy} onClick={handleStart}>
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

      {(runPhase !== "idle" || logs.length > 0) && (
        <LiveLogConsole title="Live Log · Quét bài viết page" logs={logs} phase={runPhase} />
      )}

      {showAccountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="max-h-[80vh] w-full max-w-lg overflow-hidden shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-bold">Chọn tài khoản Live</h3>
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
                                <div className="font-semibold">{acc.name || acc.uid}</div>
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
            <div className="flex justify-end gap-2 border-t px-4 py-3">
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
