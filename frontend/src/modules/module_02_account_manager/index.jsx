"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  importAccounts,
  deleteAccount,
  bulkDeleteAccounts,
  getDeletePreview,
  checkAccountStatuses,
  loginAccounts,
  openLiveBrowser,
  setAccountCategory,
  saveCategory,
} from "./service";
import CategorySidebar from "./components/CategorySidebar";
import { MoveCategoryDialog } from "./components/CategoryDialogs";
import { useAccountCategories } from "./hooks/useAccountCategories";
import { categoryQuery, moveAccountBatches } from "./utils/categories.mjs";
import { importOutcome } from "./utils/import-categories.mjs";
import { useAccounts } from "./hooks/useAccounts";
import useAccountRealtime from "./hooks/useAccountRealtime";
import { isAccountBusy } from "./utils/account-realtime.mjs";
import { useLocalSSE } from "./hooks/useLocalSSE";
import AccountTable from "./components/AccountTable";
import DynamicImportModal from "./components/DynamicImportModal";
import SingleAccountModal from "./components/SingleAccountModal";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import ExpiredFeatureView from "./components/ExpiredFeatureView";
import {
  AlertTriangle,
  ChevronDown,
  Gauge,
  Loader2,
  Maximize2,
  Minimize2,
  RotateCw,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
} from "lucide-react";

// Helper render log message với màu highlight chuẩn Figma Terminal
function HighlightedLogMessage({ message = "" }) {
  // Regex tách các thành phần đặc biệt: UID, từ khóa thành công/thất bại, proxy, etc.
  const regex = /(\b\d{10,18}\b|thành công|hoàn tất|thất bại|lỗi|checkpoint|\(Proxy:[^)]+\))/gi;
  const parts = message.split(regex);

  return (
    <span>
      {parts.map((part, i) => {
        if (!part) return null;
        if (/^\d{10,18}$/.test(part)) {
          return (
            <span key={i} className="text-[#93C5FD] font-mono font-medium">
              {part}
            </span>
          );
        }
        if (/^(thành công|hoàn tất)$/i.test(part)) {
          return (
            <span key={i} className="text-[#34D399] font-bold">
              {part}
            </span>
          );
        }
        if (/^(thất bại|lỗi|checkpoint)$/i.test(part)) {
          return (
            <span key={i} className="text-[#F43F5E] font-bold">
              {part}
            </span>
          );
        }
        if (/^\(Proxy:/i.test(part)) {
          return (
            <span key={i} className="text-[#94A3B8]">
              {part}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

export default function AccountManagerModule() {
  const accountLayoutRef = useRef(null);
  const accountPanelRef = useRef(null);
  useEffect(() => {
    const layout = accountLayoutRef.current;
    const table = accountPanelRef.current?.querySelector("section");
    const viewport = table?.querySelector("[data-account-viewport]");
    if (!layout || !table || !viewport) return;
    const updateLimit = () => {
      const maxViewportHeight = parseFloat(getComputedStyle(viewport).maxHeight);
      if (Number.isFinite(maxViewportHeight)) {
        layout.style.setProperty("--category-max-height", `${table.getBoundingClientRect().height - viewport.getBoundingClientRect().height + maxViewportHeight}px`);
      }
    };
    const observer = new ResizeObserver(updateLimit);
    observer.observe(table);
    observer.observe(viewport);
    updateLimit();
    return () => observer.disconnect();
  }, []);
  const toast = useToast();
  const [isExpired, setIsExpired] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("user_status") === "expired";
    }
    return false;
  });

  const [selectedUids, setSelectedUids] = useState([]);
  const [isDynamicImportOpen, setIsDynamicImportOpen] = useState(false);
  const [isSingleModalOpen, setIsSingleModalOpen] = useState(false);
  const [editUid, setEditUid] = useState(null);
  const [customThreads, setCustomThreads] = useState(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [isLogExpanded, setIsLogExpanded] = useState(false);
  const [expandedLog, setExpandedLog] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletePreview, setDeletePreview] = useState({ loading: false, pagesTotal: 0, error: null });
  const [deletingPages, setDeletingPages] = useState(false);
  const deletingRef = useRef(false);

  const { logs, connected, clearLogs } = useLocalSSE();
  const logListRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);
  const tableRef = useRef(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const [loginFilter, setLoginFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [moveUids, setMoveUids] = useState(null);
  const [isMoving, setIsMoving] = useState(false);
  const moveLock = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchTerm.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);
  const query = useMemo(() => ({ search, status: accountFilter, login_status: loginFilter, ...categoryQuery(categoryFilter) }), [search, accountFilter, loginFilter, categoryFilter]);
  const { accounts, allAccounts, setAccounts, stats, total, isInitialLoading, isRefreshing, loadError, refreshError, fetchAccounts, applyAccountPatches, requestRefresh } = useAccounts(query, !isExpired, tableRef, setSelectedUids);
  const categoryData = useAccountCategories(!isExpired);
  const refreshCategoriesAndAccounts = async () => {
    await Promise.all([categoryData.refresh(), fetchAccounts(false)]);
  };
  const handleMoveCategory = async categoryId => {
    if (moveLock.current || !moveUids?.length) return;
    moveLock.current = true;
    setIsMoving(true);
    try {
      const result = await moveAccountBatches(moveUids, categoryId, setAccountCategory);
      const remainingSelection = result.remaining;
      setSelectedUids(remainingSelection);
      setMoveUids(null);
      if (result.error) toast.error(`Đã chuyển ${result.completed}/${moveUids.length} tài khoản. ${result.error.message}`, "CHUYỂN DANH MỤC");
      else toast.success(`Đã chuyển ${result.completed} tài khoản.`, "CHUYỂN DANH MỤC");
      await Promise.all([categoryData.refresh(), fetchAccounts(false, remainingSelection)]);
    } finally {
      moveLock.current = false;
      setIsMoving(false);
    }
  };
  const handleChangeAccountCategory = async (account, categoryId) => {
    if (moveLock.current) return false;
    moveLock.current = true;
    setIsMoving(true);
    try {
      await setAccountCategory([account.uid], categoryId);
      applyAccountPatches([{ uid: account.uid, changes: { category_id: categoryId } }]);
      toast.success(`Đã cập nhật danh mục cho tài khoản ${account.uid}.`, "DANH MỤC");
      await Promise.all([categoryData.refresh(), fetchAccounts(false)]);
      return true;
    } catch (error) {
      toast.error(error.message, "KHÔNG THỂ ĐỔI DANH MỤC");
      return false;
    } finally {
      moveLock.current = false;
      setIsMoving(false);
    }
  };
  const realtime = useAccountRealtime({
    enabled: !isExpired, applyAccountPatches, requestRefresh,
    onUnknown: () => toast.warning("Không xác định được kết quả thao tác. Đã yêu cầu đồng bộ dữ liệu mới nhất.", "ĐỒNG BỘ"),
  });
  const isLoggingIn = realtime.loggingIn;

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

  useEffect(() => {
    const handleLocalEngineEvent = (event) => {
      const data = event.detail;
      if (!data || isExpired) return;
      const rawMsg = String(data.message || "");
      const message = rawMsg.toLocaleLowerCase("vi-VN");

      if (!data.operation_id && (
        rawMsg.includes("Đăng nhập thành công") ||
        rawMsg.includes("Đăng nhập thất bại") ||
        rawMsg.includes("Đăng nhập lỗi (checkpoint)") ||
        rawMsg.includes("Hoàn tất đăng nhập") ||
        rawMsg.includes("Trình duyệt nick") ||
        rawMsg.includes("Không xác nhận được profile")
      )) {
        requestRefresh();
      }

      const importCheckUpdated =
        message.includes("đã kiểm tra live/die sau import") ||
        message.includes("hoàn tất kiểm tra sau import") ||
        message.includes("kiểm tra live/die sau import bị gián đoạn");
      if (data.event !== "account_statuses_updated" && !importCheckUpdated) {
        return;
      }

      const statuses = data.statuses;
      if (statuses) applyAccountPatches(Object.entries(statuses)
        .filter(([, status]) => status === "live" || status === "die")
        .map(([uid, status]) => ({ uid, changes: { status } })));
      requestRefresh();
    };

    window.addEventListener("local_engine_event", handleLocalEngineEvent);
    return () => window.removeEventListener("local_engine_event", handleLocalEngineEvent);
  }, [isExpired, requestRefresh, applyAccountPatches]);

  const handleOpenEdit = (uid) => {
    setEditUid(uid);
    setIsSingleModalOpen(true);
  };

  const handleImportBulk = async (accountsToImport, skippedCount = 0, skipExisting = false, checkStatus = false) => {
    try {
      const res = await importAccounts(accountsToImport, checkStatus, skipExisting);
      const outcome = importOutcome(res, skippedCount);
      toast[outcome.level](outcome.message, outcome.complete ? "NHẬP THÀNH CÔNG" : "KẾT QUẢ IMPORT");
      if (res?.checking > 0) {
        toast.info(`Đang kiểm tra Live/Die trong nền cho ${res.checking} tài khoản...`, "KIỂM TRA LIVE/DIE");
      }
      if (outcome.added > 0 || (outcome.updated > 0 && accountsToImport.some(account => Object.hasOwn(account, "category_id")))) {
        categoryData.refresh();
      }
      if (outcome.added + outcome.updated > 0) {
        tableRef.current?.reset();
        fetchAccounts(true).catch((err) => {
          toast.warning("Không thể đồng bộ danh sách mới nhất: " + (err.message || String(err)), "CẢNH BÁO");
        });
      }
      return { success: outcome.complete, failedUids: outcome.failedUids };
    } catch (error) {
      toast.error("Không thể nhập tài khoản: " + error.message, "LỖI NHẬP FILE");
      return false;
    }
  };

  const prepareDelete = (target) => {
    if (deletingRef.current) return;
    setDeletePreview({ loading: true, pagesTotal: 0, error: null });
    setDeleteTarget(target);
  };

  const handleDeleteSingle = (uid) => prepareDelete({ kind: "single", uid });

  const handleBulkDelete = () => {
    if (!selectedUids.length) return;
    prepareDelete({ kind: "bulk", uids: [...selectedUids] });
  };

  useEffect(() => {
    if (!deleteTarget) return;
    let cancelled = false;
    const uids = deleteTarget.kind === "single" ? [deleteTarget.uid] : deleteTarget.uids;
    getDeletePreview(uids).then(
      (result) => {
        if (!cancelled) setDeletePreview({ loading: false, pagesTotal: result.pages_total, error: null });
      },
      (error) => {
        if (!cancelled) setDeletePreview({ loading: false, pagesTotal: 0, error: error.message });
      }
    );
    return () => { cancelled = true; };
  }, [deleteTarget]);

  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  const handleManualRefresh = async () => {
    if (isManualRefreshing || isRefreshing) return;
    setIsManualRefreshing(true);
    try {
      await Promise.all([
        categoryData.refresh(),
        fetchAccounts(true),
      ]);
      toast.success("Đã làm mới dữ liệu thành công!", "LÀM MỚI");
    } catch (err) {
      toast.error("Không thể làm mới: " + (err.message || String(err)), "LỖI LÀM MỚI");
    } finally {
      setIsManualRefreshing(false);
    }
  };

  const handleCloseDelete = () => {
    if (!deletingRef.current) setDeleteTarget(null);
  };

  const handleConfirmDelete = async (deletePages = false) => {
    if (!deleteTarget || deletePreview.loading || deletePreview.error || deletingRef.current) return;
    deletingRef.current = true;
    setDeletingPages(deletePages);
    setIsDeleting(true);
    try {
      let result;
      let successfulUids;
      if (deleteTarget.kind === "single") {
        result = await deleteAccount(deleteTarget.uid, deletePages);
        successfulUids = [deleteTarget.uid];
      } else {
        result = await bulkDeleteAccounts(deleteTarget.uids, deletePages);
        successfulUids = result.deleted_uids;
      }
      const errors = result.errors || [];
      if (successfulUids.length) categoryData.refresh();
      setSelectedUids((prev) => prev.filter((id) => !successfulUids.includes(id)));
      const pageMessage = result.pages_deleted > 0
        ? ` Đã xóa ${result.pages_deleted} Fanpage liên quan.`
        : result.pages_unlinked > 0
        ? ` Đã giữ lại và ngắt liên kết ${result.pages_unlinked} Fanpage.`
        : "";
      const successMessage = deleteTarget.kind === "single"
        ? `Đã xóa tài khoản ${deleteTarget.uid}.`
        : `Đã xóa ${result.deleted} tài khoản.`;
      if (errors.length) {
        const details = errors.slice(0, 3).map((item) => `${item.uid}: ${item.error}`).join("; ");
        const remaining = errors.length > 3 ? `; và ${errors.length - 3} tài khoản khác` : "";
        if (successfulUids.length) {
          toast.warning(`${successMessage}${pageMessage} Không thể xóa ${errors.length} tài khoản. ${details}${remaining}`, "KẾT QUẢ XÓA");
        } else {
          toast.error(`Không thể xóa các tài khoản đã chọn. ${details}${remaining}`, "LỖI XÓA");
        }
      } else {
        toast.success(`${successMessage}${pageMessage}`, "XÓA THÀNH CÔNG");
      }
      if (successfulUids.length) {
        setAccounts((prev) => prev.filter((acc) => !successfulUids.includes(acc.uid)));
        setDeleteTarget(null);
      }
      fetchAccounts(false).catch((err) => {
        toast.warning("Không thể đồng bộ danh sách mới nhất: " + (err.message || String(err)), "CẢNH BÁO");
      });
    } catch (error) {
      toast.error("Lỗi khi xóa tài khoản: " + error.message, "LỖI XÓA");
    } finally {
      deletingRef.current = false;
      setIsDeleting(false);
    }
  };

  const handleOpenBrowser = async (uid) => {
    if (isAccountBusy(realtime.progress[uid])) return;
    if (!realtime.begin("browser", [uid])) return;
    try {
      toast.info(`Đang kích hoạt trình duyệt cho ${uid}...`, "Mở trình duyệt");
      const result = await openLiveBrowser(uid);
      realtime.watch(result.operation_id, "browser", [uid]);
    } catch (error) {
      toast.warning(error.message || `Không thể mở trình duyệt cho ${uid}`, "Trình duyệt");
      realtime.fail([uid]);
    }
  };

  const handleLogin = async () => {
    const uids = [...selectedUids];
    if (!uids.length || isLoggingIn) return;
    if (!realtime.begin("login", uids)) {
      toast.warning("Có tài khoản đang được xử lý. Hãy đợi hoặc bỏ chọn tài khoản đó.", "ĐĂNG NHẬP");
      return;
    }
    try {
      const result = await loginAccounts(uids, effectiveThreads);
      realtime.watch(result.operation_id, "login", uids);
      toast.info(`Bắt đầu đăng nhập ${uids.length} tài khoản với ${effectiveThreads} luồng...`, "ĐĂNG NHẬP");
    } catch (error) {
      toast.error("Không thể bắt đầu đăng nhập: " + error.message, "LỖI ĐĂNG NHẬP");
      realtime.fail(uids);
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
      toast.success(
        `Đã kiểm tra xong: ${res.live || 0} Live, ${res.die || 0} Die, ${res.inconclusive || 0} chưa kết luận được.`,
        "KIỂM TRA HOÀN TẤT"
      );
      fetchAccounts(false).catch((err) => {
        toast.warning("Không thể đồng bộ danh sách mới nhất: " + (err.message || String(err)), "CẢNH BÁO");
      });
    } catch (error) {
      toast.error(
        `Không thể kiểm tra trạng thái: ${error.message || String(error)}`,
        "LỖI KIỂM TRA"
      );
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const active = stats.live;
  const dead = stats.die;
  const checked = active + dead;
  const availability = checked ? `${((active / checked) * 100).toFixed(1)}%` : "--";

  const metricCards = [
    {
      label: "TỔNG TÀI KHOẢN",
      value: stats.total.toLocaleString("vi-VN"),
      icon: Users,
      labelColor: "text-[#94A3B8]",
      iconBg: "bg-[#F1F5F9] text-[#475569]",
    },
    {
      label: "ĐANG HOẠT ĐỘNG",
      value: checked ? active.toLocaleString("vi-VN") : "--",
      icon: ShieldCheck,
      labelColor: "text-[#059669]",
      iconBg: "bg-[#ECFDF5] text-[#059669]",
    },
    {
      label: "Die / Fail",
      value: checked ? dead.toLocaleString("vi-VN") : "--",
      icon: AlertTriangle,
      labelColor: "text-[#F43F5E]",
      iconBg: "bg-[#FFF1F2] text-[#E11D48]",
    },
    {
      label: "TỶ LỆ KHẢ DỤNG",
      value: availability,
      icon: Gauge,
      labelColor: "text-[#2563EB]",
      iconBg: "bg-[#EFF6FF] text-[#2563EB]",
    },
  ];

  const visibleLogs = logs.slice(-100);

  if (isExpired) {
    return (
      <ExpiredFeatureView
        featureName="Quản lý Tài khoản Facebook"
        onRenewed={() => {
          setIsExpired(false);
        }}
      />
    );
  }

  return (
    <div className="-m-6 p-6 min-h-full bg-[#F8F9FF] space-y-6">
      {/* 1. Section - PageTitleArea */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0F172A] sm:text-3xl">
            Quản lý tài khoản Facebook
          </h1>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Nút Refresh (Icon only) */}
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isManualRefreshing || isRefreshing}
            title="Làm mới dữ liệu trang"
            aria-label="Làm mới dữ liệu trang"
            className="flex items-center justify-center w-10 h-10 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-slate-700 shadow-sm transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RotateCw className={`w-4 h-4 text-slate-600 ${isManualRefreshing || isRefreshing ? "animate-spin text-primary" : ""}`} />
          </button>

          {/* Nút chính Figma: Thêm nhiều tài khoản */}
          <button
            type="button"
            onClick={() => setIsDynamicImportOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold shadow-[0_1px_2px_0_rgba(59,130,246,0.3)] transition-colors cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            <span>Thêm nhiều tài khoản</span>
          </button>
        </div>
      </div>

      {/* 2. Section - StatsGrid (4 Cards) */}
      <p role="status" className="sr-only">{isInitialLoading ? "Đang tải tài khoản" : ""}</p>
      <div aria-busy={isInitialLoading} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {metricCards.map(({ label, value, icon: Icon, labelColor, iconBg }) => (
          <div
            key={label}
            className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-[0_1px_2px_0_rgba(0,0,0,0.05)] flex items-center justify-between"
          >
            <div>
              <div className={`text-xs font-bold uppercase tracking-wider ${labelColor}`}>
                {label}
              </div>
              <div className="text-3xl font-extrabold text-[#0F172A] tracking-tight mt-1">
                {isInitialLoading ? (
                  <span aria-hidden="true" className="block h-9 w-24 rounded bg-slate-200/70 motion-safe:animate-pulse" />
                ) : loadError ? "--" : value}
              </div>
            </div>
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
              <Icon className="w-5 h-5" />
            </div>
          </div>
        ))}
      </div>

      {/* 3. Section - FilterAndTableContainer (Toolbar + Table + Bottom Action Bar) */}
      <div ref={accountLayoutRef} className="flex min-w-0 flex-col items-stretch gap-4 lg:flex-row">
      <CategorySidebar {...categoryData} value={categoryFilter} onChange={setCategoryFilter}
        onRetry={categoryData.refresh} onChanged={refreshCategoriesAndAccounts} disabled={isMoving} />
      <div ref={accountPanelRef} className="min-w-0 flex-1">
      <AccountTable
        categories={categoryData.categories}
        onMoveCategory={() => setMoveUids([...selectedUids])}
        onChangeAccountCategory={handleChangeAccountCategory}
        categoryUnavailable={categoryData.loading || Boolean(categoryData.error) || isMoving}
        tableRef={tableRef}
        searchTerm={searchTerm} setSearchTerm={setSearchTerm}
        accountFilter={accountFilter} setAccountFilter={setAccountFilter}
        loginFilter={loginFilter} setLoginFilter={setLoginFilter}
        total={total}
        refreshError={refreshError}
        isLoading={isInitialLoading}
        isRefreshing={isRefreshing}
        loadError={loadError}
        onRetry={() => fetchAccounts()}
        accounts={accounts}
        selectedUids={selectedUids}
        onToggleSelect={(uid) =>
          setSelectedUids((current) =>
            current.includes(uid) ? current.filter((id) => id !== uid) : [...current, uid]
          )
        }
        onSelectAll={handleSelectAll}
        onSelectionChange={setSelectedUids}
        onEditAccount={handleOpenEdit}
        onDeleteAccount={handleDeleteSingle}
        onOpenBrowser={handleOpenBrowser}
        onBulkDelete={handleBulkDelete}
        onRefresh={handleCheckStatus}
        isCheckingStatus={isCheckingStatus}
        accountProgress={realtime.progress}
        effectiveThreads={effectiveThreads}
        setCustomThreads={setCustomThreads}
        maxThreads={maxThreads}
        handleLogin={handleLogin}
        isLoggingIn={isLoggingIn}
      />
      </div>
      </div>

      {/* 4. Section - LiveLogsPanel (Nhật ký hoạt động Terminal Dark Theme) */}
      <section className="w-full flex flex-col rounded-2xl bg-white border border-[#E2E8F0] shadow-[0_1px_2px_0_rgba(0,0,0,0.05)] overflow-hidden">
        {/* Terminal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E2E8F0] bg-[#F8FAFC]/70">
          <div className="flex items-center gap-2.5">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                connected ? "bg-[#10B981] animate-pulse" : "bg-red-400"
              }`}
            />
            <h2 className="text-sm font-bold text-[#1E293B]">
              Nhật ký hoạt động (Live Logs)
            </h2>
            <span className="px-2 py-0.5 rounded bg-[#F1F5F9] text-xs font-mono font-medium text-[#94A3B8]">
              session#{logs.length > 0 ? String(logs.length).padStart(4, "0") : "live"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                clearLogs();
                setExpandedLog(null);
              }}
              className="px-2.5 py-1 text-xs font-semibold text-[#64748B] hover:text-[#1E293B] rounded-lg hover:bg-slate-200/50 transition-colors cursor-pointer"
            >
              Xóa logs
            </button>
            <button
              type="button"
              onClick={() => setIsLogExpanded((v) => !v)}
              title={isLogExpanded ? "Thu nhỏ nhật ký" : "Mở rộng nhật ký"}
              className="p-1 text-[#94A3B8] hover:text-[#1E293B] rounded-lg hover:bg-slate-200/50 transition-colors cursor-pointer"
            >
              {isLogExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Log Content Area - Dark Slate #0F172A */}
        <div
          ref={logListRef}
          onScroll={(event) => {
            const list = event.currentTarget;
            shouldAutoScrollRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
          }}
          className={`bg-[#0F172A] p-4 font-mono text-xs text-[#CBD5E1] overflow-y-auto space-y-2 select-text transition-[height] duration-200 ${
            isLogExpanded ? "min-h-[320px] max-h-[460px]" : "min-h-[160px] max-h-[240px]"
          }`}
        >
          {visibleLogs.length ? (
            visibleLogs.map((log, index) => {
              const isOpen = expandedLog === log;
              const isSuccess = log.type === "success";
              const isError = log.type === "error";

              return (
                <div key={`${log.timestamp}-${index}`} className="flex flex-col gap-1">
                  <div className="flex items-start gap-2.5 leading-relaxed">
                    {/* Icon: checkmark xanh lá cho success, dot xanh cho info, x cho lỗi */}
                    <span className="shrink-0 mt-0.5 select-none">
                      {isSuccess ? (
                        <span className="text-[#34D399] font-bold">✓</span>
                      ) : isError ? (
                        <span className="text-[#F43F5E] font-bold">×</span>
                      ) : (
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#60A5FA] my-1" />
                      )}
                    </span>

                    {/* Timestamp */}
                    <time className="shrink-0 text-[11px] text-[#94A3B8] tabular-nums select-none">
                      [{log.timestamp}]
                    </time>

                    {/* Log text với Highlight */}
                    <div className="flex-1 min-w-0 break-words">
                      <HighlightedLogMessage message={log.message} />
                    </div>

                    {/* Xem chi tiết nếu log dài hoặc có stacktrace */}
                    {log.message.includes("stacktrace") && (
                      <button
                        type="button"
                        onClick={() => setExpandedLog(isOpen ? null : log)}
                        className="text-[#94A3B8] hover:text-white shrink-0 ml-1"
                      >
                        <ChevronDown className={`w-3.5 h-3.5 ${isOpen ? "rotate-180" : ""}`} />
                      </button>
                    )}
                  </div>

                  {/* Collapsible raw details */}
                  {isOpen && (
                    <div className="pl-24 pr-2 py-1 text-[11px] text-slate-400 whitespace-pre-wrap border-l border-slate-700 ml-3">
                      {log.message}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="flex items-center gap-2 text-[#94A3B8] italic py-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#60A5FA]" />
              <span>Đang chờ sự kiện hoạt động từ hệ thống...</span>
            </div>
          )}
        </div>
      </section>

      {/* Modals */}
      {moveUids && <MoveCategoryDialog categories={categoryData.categories} count={moveUids.length} busy={isMoving}
        onClose={() => { if (!moveLock.current) setMoveUids(null); }} onMove={handleMoveCategory} />}
      <DynamicImportModal
        isOpen={isDynamicImportOpen}
        onClose={() => setIsDynamicImportOpen(false)}
        onImport={handleImportBulk}
        categories={categoryData.categories}
        categoriesLoading={categoryData.loading}
        categoriesError={categoryData.error}
        onRetryCategories={categoryData.refresh}
        onCreateCategory={async data => {
          const category = await saveCategory(data);
          categoryData.upsertCategory(category);
          categoryData.refresh();
          return category;
        }}
        existingAccounts={allAccounts}
      />

      <SingleAccountModal
        isOpen={isSingleModalOpen}
        editUid={editUid}
        onClose={() => setIsSingleModalOpen(false)}
        onSuccess={({ originalUid, uid, isEdit, savedData }) => {
          if (!isEdit) categoryData.refresh();
          setSelectedUids((current) => Array.from(new Set(current.map((selected) => selected === originalUid ? uid : selected))));
          if (isEdit) {
            setAccounts((prev) =>
              prev.map((acc) => {
                if (acc.uid !== originalUid && acc.uid !== uid) return acc;
                return {
                  ...acc,
                  uid,
                  email: savedData?.email ? savedData.email : acc.email,
                  proxy: savedData?.proxy ? savedData.proxy : acc.proxy,
                };
              })
            );
            toast.success(`Đã cập nhật thông tin tài khoản ${uid}.`, "CẬP NHẬT THÀNH CÔNG");
            fetchAccounts(false).catch((err) => {
              toast.warning("Không thể đồng bộ danh sách mới nhất: " + (err.message || String(err)), "CẢNH BÁO");
            });
          } else {
            toast.success(`Đã thêm mới tài khoản ${uid} thành công.`, "THÊM THÀNH CÔNG");
            tableRef.current?.reset();
            fetchAccounts(true).catch((err) => {
              toast.warning("Không thể đồng bộ danh sách mới nhất: " + (err.message || String(err)), "CẢNH BÁO");
            });
          }
        }}
        existingAccounts={allAccounts}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={handleCloseDelete}
        onConfirm={() => handleConfirmDelete(deletePreview.pagesTotal > 0)}
        title="Xác nhận xóa tài khoản"
        description={
          deletePreview.loading ? (
            <span role="status" className="inline-flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Đang kiểm tra dữ liệu liên quan…
            </span>
          ) : deletePreview.error ? (
            <span role="alert">
              Không thể kiểm tra Fanpage: {deletePreview.error}.{" "}
              <button type="button" className="font-semibold text-primary underline" onClick={() => prepareDelete({ ...deleteTarget })}>
                Thử lại
              </button>
            </span>
          ) : (
            <span>
              {deleteTarget?.kind === "single"
                ? `Xóa tài khoản ${deleteTarget.uid}?`
                : `Xóa ${deleteTarget?.uids.length ?? 0} tài khoản đã chọn?`}{" "}
              {deletePreview.pagesTotal > 0 && (
                <span className="mt-2 block">
                  Có {deletePreview.pagesTotal} Fanpage liên quan. Chỉ xóa tài khoản sẽ giữ Fanpage và ngắt liên kết; xóa cả hai sẽ gỡ Fanpage khỏi phần mềm.
                </span>
              )}
              <span className="mt-2 block">Dữ liệu trình duyệt và phiên đăng nhập của tài khoản sẽ bị xóa. Nếu thêm lại tài khoản, bạn cần đăng nhập lại.</span>
            </span>
          )
        }
        confirmText={deletePreview.pagesTotal > 0 ? "Xóa cả tài khoản & Fanpage" : "Xóa tài khoản"}
        secondaryText={deletePreview.pagesTotal > 0 ? "Chỉ xóa tài khoản" : undefined}
        onSecondaryConfirm={() => handleConfirmDelete(false)}
        hideConfirm={deletePreview.loading || Boolean(deletePreview.error)}
        loadingAction={deletePreview.pagesTotal > 0 && !deletingPages ? "secondary" : "confirm"}
        cancelText="Hủy bỏ"
        variant="danger"
        icon={<Trash2 className="h-5 w-5" />}
        loading={isDeleting}
      />
    </div>
  );
}
