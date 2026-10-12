"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  getAccounts,
  importAccounts,
  deleteAccount,
  bulkDeleteAccounts,
  checkAccountStatuses,
  loginAccounts,
  openLiveBrowser,
} from "./service";
import { useLocalSSE } from "./hooks/useLocalSSE";
import AccountTable from "./components/AccountTable";
import DynamicImportModal from "./components/DynamicImportModal";
import SingleAccountModal from "./components/SingleAccountModal";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import ExpiredFeatureView from "./components/ExpiredFeatureView";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  ChevronDown,
  Gauge,
  Loader2,
  LogIn,
  Maximize2,
  Minimize2,
  PlusCircle,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
} from "lucide-react";

export default function AccountManagerModule() {
  const toast = useToast();
  const [isExpired, setIsExpired] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("user_status") === "expired";
    }
    return false;
  });

  const [accounts, setAccounts] = useState([]);
  const [selectedUids, setSelectedUids] = useState([]);
  const [isDynamicImportOpen, setIsDynamicImportOpen] = useState(false);
  const [isSingleModalOpen, setIsSingleModalOpen] = useState(false);
  const [editUid, setEditUid] = useState(null);
  const [customThreads, setCustomThreads] = useState(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [openingBrowserUids, setOpeningBrowserUids] = useState(new Set());
  const [isLogExpanded, setIsLogExpanded] = useState(false);
  const [expandedLog, setExpandedLog] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { logs, connected, clearLogs } = useLocalSSE();
  const logListRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);
  const accountsRequestRef = useRef(0);

  useEffect(() => {
    if (shouldAutoScrollRef.current && logListRef.current) {
      logListRef.current.scrollTop = logListRef.current.scrollHeight;
    }
  }, [logs]);

  const maxThreads = selectedUids.length > 0 ? Math.min(selectedUids.length, 10) : 10;
  const effectiveThreads =
    customThreads !== null
      ? Math.min(customThreads, maxThreads)
      : selectedUids.length > 0
      ? Math.min(selectedUids.length, 10)
      : 3;

  const fetchAccounts = async () => {
    const requestId = ++accountsRequestRef.current;
    try {
      const updatedAccounts = await getAccounts();
      if (requestId === accountsRequestRef.current) {
        setAccounts(updatedAccounts);
      }
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    const handleLocalEngineEvent = (event) => {
      const data = event.detail;
      if (!data || isExpired) return;
      const rawMsg = String(data.message || "");
      const message = rawMsg.toLocaleLowerCase("vi-VN");

      if (rawMsg.includes("Trình duyệt nick") || rawMsg.includes("Không thể mở trình duyệt cho")) {
        setOpeningBrowserUids((prev) => {
          const next = new Set(prev);
          for (const uid of Array.from(next)) {
            if (rawMsg.includes(uid)) next.delete(uid);
          }
          return next;
        });
      }
      if (rawMsg.includes("Hoàn tất đăng nhập tất cả tài khoản!")) {
        setIsLoggingIn(false);
      }
      if (
        rawMsg.includes("Đăng nhập thành công") ||
        rawMsg.includes("Đăng nhập thất bại") ||
        rawMsg.includes("Đăng nhập lỗi (checkpoint)") ||
        rawMsg.includes("Hoàn tất đăng nhập") ||
        rawMsg.includes("Trình duyệt nick") ||
        rawMsg.includes("Không xác nhận được profile")
      ) {
        fetchAccounts();
      }

      const importCheckUpdated =
        message.includes("đã kiểm tra live/die sau import") ||
        message.includes("hoàn tất kiểm tra sau import") ||
        message.includes("kiểm tra live/die sau import bị gián đoạn");
      if (data.event !== "account_statuses_updated" && !importCheckUpdated && data.type !== "connected") {
        return;
      }

      const statuses = data.statuses;
      if (statuses) {
        setAccounts((currentAccounts) =>
          currentAccounts.map((account) => {
            const status = statuses[account.uid];
            return status === "live" || status === "die" ? { ...account, status } : account;
          })
        );
      }

      fetchAccounts();
    };

    window.addEventListener("local_engine_event", handleLocalEngineEvent);
    return () => window.removeEventListener("local_engine_event", handleLocalEngineEvent);
  }, [isExpired]);

  useEffect(() => {
    if (isExpired) return;
    let ignore = false;
    getAccounts()
      .then((data) => {
        if (!ignore) {
          setAccounts(data);
        }
      })
      .catch((err) => console.error(err));
    return () => {
      ignore = true;
    };
  }, [isExpired]);

  const handleImportBulk = async (newAccounts, checkAfterImport) => {
    try {
      const result = await importAccounts(newAccounts, checkAfterImport);
      await fetchAccounts();
      if (result.errors?.length) {
        toast.warning(
          `Đã import ${result.imported} tài khoản, bỏ qua ${result.errors.length} tài khoản bị lỗi.`,
          "IMPORT HOÀN TẤT"
        );
      } else {
        toast.success(`Đã import thành công ${result.imported} tài khoản vào hệ thống!`, "THÀNH CÔNG");
      }
      return result.imported > 0;
    } catch (error) {
      toast.error(error.message || "Lỗi khi lưu danh sách tài khoản", "LỖI IMPORT");
      return false;
    }
  };

  const handleOpenAddSingle = () => {
    setEditUid(null);
    setIsSingleModalOpen(true);
  };

  const handleOpenEdit = (uid) => {
    setEditUid(uid);
    setIsSingleModalOpen(true);
  };

  const handleDeleteSingle = (uid) => {
    setDeleteTarget({ kind: "single", uid });
  };

  const handleBulkDelete = () => {
    if (selectedUids.length) {
      setDeleteTarget({ kind: "bulk", uids: [...selectedUids] });
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    try {
      if (deleteTarget.kind === "single") {
        await deleteAccount(deleteTarget.uid);
        setSelectedUids((current) => current.filter((id) => id !== deleteTarget.uid));
        toast.success(`Đã xóa tài khoản ${deleteTarget.uid}`, "THÀNH CÔNG");
      } else {
        const result = await bulkDeleteAccounts(deleteTarget.uids);
        const failedUids = (result.errors || []).map((item) => item.uid);
        setSelectedUids((current) => [
          ...current.filter((id) => !deleteTarget.uids.includes(id)),
          ...failedUids,
        ]);
        if (failedUids.length) {
          toast.error(
            `Không thể xóa profile của UID: ${failedUids.join(", ")}. Hãy đóng Chrome rồi thử lại.`,
            "Lỗi khi xóa tài khoản"
          );
        } else {
          toast.success(`Đã xóa thành công ${deleteTarget.uids.length} tài khoản`, "THÀNH CÔNG");
        }
      }
      await fetchAccounts();
    } catch (error) {
      toast.error(`Lỗi khi xóa tài khoản: ${error.message || String(error)}`, "Lỗi khi xóa");
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleOpenBrowser = async (uid) => {
    if (openingBrowserUids.has(uid)) return;
    setOpeningBrowserUids((prev) => new Set(prev).add(uid));
    try {
      await openLiveBrowser(uid);
      setTimeout(() => {
        setOpeningBrowserUids((prev) => {
          if (!prev.has(uid)) return prev;
          const next = new Set(prev);
          next.delete(uid);
          return next;
        });
      }, 10000);
    } catch (error) {
      toast.warning(error.message || `Không thể mở trình duyệt cho ${uid}`, "Trình duyệt");
      setOpeningBrowserUids((prev) => {
        const next = new Set(prev);
        next.delete(uid);
        return next;
      });
    }
  };

  const handleLogin = async () => {
    const uids = selectedUids;
    if (!uids.length) return;
    setIsLoggingIn(true);
    try {
      await loginAccounts(uids, effectiveThreads);
      toast.info(`Bắt đầu đăng nhập ${uids.length} tài khoản với ${effectiveThreads} luồng...`, "ĐĂNG NHẬP");
      setTimeout(() => setIsLoggingIn(false), 120000);
    } catch (error) {
      toast.error("Không thể bắt đầu đăng nhập: " + error.message, "LỖI ĐĂNG NHẬP");
      setIsLoggingIn(false);
    }
  };

  const handleSelectAll = (filteredUids) => {
    const targetUids = filteredUids || accounts.map((account) => account.uid);
    const allTargetSelected =
      targetUids.length > 0 && targetUids.every((uid) => selectedUids.includes(uid));
    if (allTargetSelected) {
      setSelectedUids((current) => current.filter((id) => !targetUids.includes(id)));
    } else {
      setSelectedUids((current) => Array.from(new Set([...current, ...targetUids])));
    }
  };

  const handleCheckStatus = async () => {
    if (!selectedUids.length || isCheckingStatus) return;
    setIsCheckingStatus(true);
    try {
      const res = await checkAccountStatuses(selectedUids);
      await fetchAccounts();
      toast.success(
        `Đã kiểm tra xong: ${res.live || 0} Live, ${res.die || 0} Die.`,
        "KIỂM TRA HOÀN TẤT"
      );
    } catch (error) {
      toast.error(
        `Không thể kiểm tra trạng thái: ${error.message || String(error)}`,
        "LỖI KIỂM TRA"
      );
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const active = accounts.filter((account) => account.status === "live").length;
  const dead = accounts.filter((account) => account.status === "die").length;
  const checked = active + dead;
  const availability = checked ? `${((active / checked) * 100).toFixed(1)}%` : "--";

  const metricCards = [
    {
      label: "TỔNG TÀI KHOẢN",
      value: accounts.length.toLocaleString("vi-VN"),
      subtext: "Đã lưu trong CSDL",
      icon: Users,
      borderClass: "border-l-sky-500",
      valueColor: "text-sky-600",
      iconBg: "bg-sky-50 text-sky-600",
    },
    {
      label: "ĐANG HOẠT ĐỘNG (LIVE)",
      value: checked ? active.toLocaleString("vi-VN") : "--",
      subtext: checked ? `${active} tài khoản live` : "Chưa kiểm tra",
      icon: ShieldCheck,
      borderClass: "border-l-emerald-500",
      valueColor: "text-emerald-600",
      iconBg: "bg-emerald-50 text-emerald-600",
    },
    {
      label: "TÀI KHOẢN DIE",
      value: checked ? dead.toLocaleString("vi-VN") : "--",
      subtext: checked ? `${dead} tài khoản die` : "Chưa kiểm tra",
      icon: AlertTriangle,
      borderClass: "border-l-red-500",
      valueColor: "text-red-600",
      iconBg: "bg-red-50 text-red-600",
    },
    {
      label: "TỶ LỆ KHẢ DỤNG",
      value: availability,
      subtext: "Tỉ lệ Live / Tổng đã check",
      icon: Gauge,
      borderClass: "border-l-blue-500",
      valueColor: "text-primary",
      iconBg: "bg-primary-subtle text-primary",
    },
  ];

  const visibleLogs = logs.slice(-100);

  if (isExpired) {
    return (
      <ExpiredFeatureView
        featureName="Quản lý Tài khoản Facebook"
        onRenewed={() => {
          setIsExpired(false);
          fetchAccounts();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Quản Lý Tài Khoản Facebook
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Quản lý tài khoản Facebook đã lưu trên máy, hỗ trợ mở profile Chrome và kiểm tra trạng thái
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleOpenAddSingle}
            className="gap-1.5"
          >
            <PlusCircle className="h-4 w-4 text-primary" />
            <span>Thêm một tài khoản</span>
          </Button>

          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => setIsDynamicImportOpen(true)}
            className="gap-1.5"
          >
            <Upload className="h-4 w-4" />
            <span>Thêm nhiều tài khoản</span>
          </Button>
        </div>
      </div>

      {/* 4 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {metricCards.map(({ label, value, subtext, icon: Icon, borderClass, valueColor, iconBg }) => (
          <Card key={label} className={`border-l-4 ${borderClass}`}>
            <CardHeader className="p-4 pb-1 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase text-slate-500">
                {label}
              </CardTitle>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
                <Icon className="w-4 h-4" />
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-1">
              <div className={`text-2xl font-black ${valueColor}`}>{value}</div>
              <p className="text-[11px] text-slate-500 mt-0.5">{subtext}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Account Table */}
      <AccountTable
        accounts={accounts}
        selectedUids={selectedUids}
        onToggleSelect={(uid) =>
          setSelectedUids((current) =>
            current.includes(uid) ? current.filter((id) => id !== uid) : [...current, uid]
          )
        }
        onSelectAll={handleSelectAll}
        onEditAccount={handleOpenEdit}
        onDeleteAccount={handleDeleteSingle}
        onOpenBrowser={handleOpenBrowser}
        onBulkDelete={handleBulkDelete}
        onRefresh={handleCheckStatus}
        isCheckingStatus={isCheckingStatus}
        openingBrowserUids={openingBrowserUids}
      />

      {/* Action Footer Bar for Multi-threaded Batch Login */}
      <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 rounded-xl border border-border bg-card p-4 shadow-subtle">
        <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-slate-50 px-3 text-xs text-slate-700">
          <span className="text-amber-500 font-bold">⚡</span>
          <span>Số luồng đăng nhập đồng thời:</span>
          <input
            type="number"
            min={1}
            max={maxThreads}
            value={effectiveThreads}
            onChange={(event) =>
              setCustomThreads(Math.max(1, Math.min(maxThreads, Number(event.target.value))))
            }
            className="h-6 w-12 rounded border border-border bg-white text-center font-bold text-slate-800 outline-none focus:border-primary"
          />
        </label>

        <Button
          type="button"
          onClick={handleLogin}
          disabled={isLoggingIn || !selectedUids.length}
          size="sm"
          className="gap-1.5"
        >
          {isLoggingIn ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LogIn className="h-4 w-4" />
          )}
          <span>
            {isLoggingIn ? "Đang đăng nhập..." : "Bắt đầu đăng nhập"}
            {selectedUids.length > 0 ? ` (${selectedUids.length})` : ""}
          </span>
        </Button>
      </div>

      {/* Embedded Activity Log box */}
      <section
        className={`flex w-full flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-card transition-[height] duration-200 ${
          isLogExpanded ? "h-[360px]" : "h-[190px]"
        }`}
      >
        <div className="flex min-h-[42px] shrink-0 items-center justify-between gap-3 border-b border-slate-800 px-4 bg-slate-900/80">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                connected ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-red-400"
              }`}
            />
            <span className="truncate text-xs font-bold text-slate-200">
              Nhật ký hoạt động tài khoản (SSE Realtime)
            </span>
            <span className="shrink-0 text-[11px] text-slate-500">
              {logs.length} dòng
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                clearLogs();
                setExpandedLog(null);
              }}
              className="rounded px-2 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            >
              Xóa logs
            </button>
            <button
              type="button"
              onClick={() => setIsLogExpanded((value) => !value)}
              title={isLogExpanded ? "Thu nhỏ nhật ký" : "Mở rộng nhật ký"}
              className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            >
              {isLogExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <div
          ref={logListRef}
          onScroll={(event) => {
            const list = event.currentTarget;
            shouldAutoScrollRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
          }}
          className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2 font-mono text-[11px]"
        >
          {visibleLogs.length ? (
            visibleLogs.map((log, index) => {
              const isOpen = expandedLog === log;
              const color =
                log.type === "success"
                  ? "text-emerald-400"
                  : log.type === "error"
                  ? "text-red-400"
                  : log.type === "warning"
                  ? "text-amber-400"
                  : "text-sky-400";
              const symbol =
                log.type === "success"
                  ? "✓"
                  : log.type === "error"
                  ? "×"
                  : log.type === "warning"
                  ? "!"
                  : "•";
              const summary = log.message.split(/stacktrace:/i)[0].trim() || log.message;

              return (
                <div
                  key={`${log.timestamp}-${index}`}
                  className="rounded border border-transparent bg-slate-900/60 transition-colors hover:border-slate-800"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedLog(isOpen ? null : log)}
                    className="flex min-h-7 w-full items-center gap-2 px-2.5 py-1 text-left"
                  >
                    <span className={`w-3 shrink-0 text-center font-bold ${color}`}>{symbol}</span>
                    <time className="w-16 shrink-0 text-[10px] tabular-nums text-slate-500">
                      {log.timestamp}
                    </time>
                    <span className={`min-w-0 flex-1 truncate leading-tight ${color}`}>{summary}</span>
                    <ChevronDown
                      className={`h-3 w-3 shrink-0 text-slate-500 transition-transform ${
                        isOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="select-text whitespace-pre-wrap border-t border-slate-800 px-3 py-2 pl-24 text-[11px] leading-relaxed text-slate-300">
                      {log.message}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <p className="px-3 py-3 text-slate-500 italic">
              Đang chờ hoạt động từ Local Python Engine...
            </p>
          )}
        </div>
      </section>

      {/* Modals */}
      <DynamicImportModal
        isOpen={isDynamicImportOpen}
        onClose={() => setIsDynamicImportOpen(false)}
        onImport={handleImportBulk}
        existingAccounts={accounts}
      />

      <SingleAccountModal
        isOpen={isSingleModalOpen}
        editUid={editUid}
        onClose={() => setIsSingleModalOpen(false)}
        onSuccess={fetchAccounts}
        existingAccounts={accounts}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Xác nhận xóa tài khoản"
        description={
          deleteTarget?.kind === "single"
            ? `Bạn có chắc chắn muốn xóa tài khoản ${deleteTarget.uid}? Toàn bộ profile trình duyệt sẽ bị gỡ bỏ.`
            : `Bạn có chắc chắn muốn xóa ${deleteTarget?.uids.length ?? 0} tài khoản đã chọn?`
        }
        confirmText="Xóa"
        cancelText="Hủy bỏ"
        variant="danger"
        icon={<Trash2 className="h-5 w-5" />}
        loading={isDeleting}
      />
    </div>
  );
}
