"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Folder,
  FolderOpen,
  FolderInput,
  Zap,
  Search,
  Play,
  Pause,
  Square,
  Activity,
  Check,
  CheckCircle2,
  RotateCcw,
  Plus,
  Loader2,
  Database,
  Info,
  ShieldCheck,
  Copy,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { api } from "@/services/api";
import { openFolderPicker } from "@/lib/file-bridge";
import { toast } from "@/lib/toast";
import { Switch } from "@/components/ui/switch";
import { EmergencyStopModal } from "./EmergencyStopModal";
import { PastScheduleModal } from "./PastScheduleModal";
import { PostProgressPreview } from "./PostProgressPreview";
import {
  mapProgressThreads,
  shouldRestoreProgressView,
} from "@/modules/module_03_acc_farm/postSessionUi";
import { ProgressActivityCell } from "./ProgressPostLink";
import { useAccountCategories } from "@/modules/module_02_account_manager/hooks/useAccountCategories";
import { categoryLabelStyle } from "@/modules/module_02_account_manager/components/CategorySelect";

export function ReelsPostView({ mode, initialState = "config" }) {
  const router = useRouter();
  const isReels = mode === "reels";
  const mediaLabel = isReels ? "video" : "ảnh/video";
  const unitLabel = isReels ? "clips" : "files";

  const [viewState, setViewState] = useState(initialState);
  // Vừa mở / quay lại tab: đang hỏi Engine phiên đăng còn chạy không → khoá nút ĐĂNG BÀI
  const [syncing, setSyncing] = useState(true);

  // ── Step 1: Master Folder & Account Mapping ──
  const [masterFolder, setMasterFolder] = useState(
    isReels
      ? "D:\\video_tiktok\\reels_export"
      : "D:\\video_tiktok\\story_export"
  );

  const [searchAccount, setSearchAccount] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const categoryList = useAccountCategories(true);
  const categoriesById = useMemo(
    () => new Map((categoryList.categories || []).map((item) => [item.id, item])),
    [categoryList.categories]
  );

  // Cấu hình hẹn giờ & tiến trình
  const [checkDuplicate, setCheckDuplicate] = useState(true);
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [scheduleTime, setScheduleTime] = useState("08:00");
  const [threadCount, setThreadCount] = useState(1);
  const [minDelay, setMinDelay] = useState(600);
  const [maxDelay, setMaxDelay] = useState(900);

  // ── Running State Monitoring ──
  const [metrics, setMetrics] = useState({
    running: 0,
    paused: 0,
    waiting: 0,
    completed: 0,
    systemError: 0,
    deadAccount: 0,
    stopped: 0,
  });

  const [threadRows, setThreadRows] = useState([]);
  const [previewPostId, setPreviewPostId] = useState(null);
  const [logs, setLogs] = useState([]);
  const [isPaused, setIsPaused] = useState(false);
  // BE đã đứng yên hẳn (lưu checkpoint xong) sau khi Tạm dừng → mới cho bấm Tiếp tục
  const [pauseSettled, setPauseSettled] = useState(true);
  const [isStopped, setIsStopped] = useState(false);
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [showPastScheduleModal, setShowPastScheduleModal] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const pollingRef = useRef(null);
  const settingsBaselineRef = useRef(null);

  const mergeProgressRows = (prev, incoming) => {
    if (!Array.isArray(incoming) || incoming.length === 0) return prev || [];
    if (!Array.isArray(prev) || prev.length === 0) return incoming;
    if (incoming.length >= prev.length) return incoming;
    const used = new Set();
    const updated = prev.map((row) => {
      const byId = incoming.find((t) => String(t.id) === String(row.id));
      if (byId) {
        used.add(String(byId.id));
        return { ...row, ...byId };
      }
      return row;
    });
    for (const t of incoming) {
      const tid = String(t.id || t.threadId || "");
      if (tid && !used.has(tid) && !updated.some((r) => String(r.id) === tid)) {
        updated.push(t);
      }
    }
    return updated;
  };

  const snapshotSettings = (vals) =>
    JSON.stringify({
      masterFolder: vals.masterFolder || "",
      checkDuplicate: !!vals.checkDuplicate,
      scheduleEnabled: !!vals.scheduleEnabled,
      scheduleTime: vals.scheduleTime || "",
      minDelay: Number(vals.minDelay) || 0,
      maxDelay: Number(vals.maxDelay) || 0,
      threadCount: Number(vals.threadCount) || 0,
    });

  // Tải cấu hình
  const loadSettingsFromDb = async () => {
    try {
      const res = await api.get(`/api/post/settings?post_type=${mode}`);
      const s = res?.data ?? res;
      if (s && typeof s === "object") {
        const nextFolder = s.master_folder_path || masterFolder;
        const nextDup =
          s.check_duplicate !== undefined ? s.check_duplicate : checkDuplicate;
        const nextSched =
          s.schedule_enabled !== undefined ? s.schedule_enabled : scheduleEnabled;
        const nextTime = s.schedule_time ? s.schedule_time.slice(0, 5) : scheduleTime;
        const nextMin = s.min_delay || minDelay;
        const nextMax = s.max_delay || maxDelay;
        const nextThreads = s.thread_count || threadCount;

        if (s.master_folder_path) setMasterFolder(s.master_folder_path);
        if (s.check_duplicate !== undefined) setCheckDuplicate(s.check_duplicate);
        if (s.schedule_enabled !== undefined) setScheduleEnabled(s.schedule_enabled);
        if (s.schedule_time) setScheduleTime(s.schedule_time.slice(0, 5));
        if (s.min_delay) setMinDelay(s.min_delay);
        if (s.max_delay) setMaxDelay(s.max_delay);
        if (s.thread_count) setThreadCount(s.thread_count);

        settingsBaselineRef.current = snapshotSettings({
          masterFolder: nextFolder,
          checkDuplicate: nextDup,
          scheduleEnabled: nextSched,
          scheduleTime: nextTime,
          minDelay: nextMin,
          maxDelay: nextMax,
          threadCount: nextThreads,
        });
      } else {
        settingsBaselineRef.current = snapshotSettings({
          masterFolder,
          checkDuplicate,
          scheduleEnabled,
          scheduleTime,
          minDelay,
          maxDelay,
          threadCount,
        });
      }
    } catch (err) {
      console.error("Lỗi khi tải cấu hình:", err);
      settingsBaselineRef.current = snapshotSettings({
        masterFolder,
        checkDuplicate,
        scheduleEnabled,
        scheduleTime,
        minDelay,
        maxDelay,
        threadCount,
      });
    }
  };

  const handleSaveSettingsToDb = async (overrideCheckDup = null, overrideFolder = null) => {
    try {
      const dup = overrideCheckDup !== null ? overrideCheckDup : checkDuplicate;
      const folder = overrideFolder !== null ? overrideFolder : masterFolder;
      await api.post("/api/post/settings", {
        post_type: mode,
        master_folder_path: folder,
        check_duplicate: dup,
        schedule_enabled: scheduleEnabled,
        schedule_time: scheduleTime,
        min_delay: minDelay,
        max_delay: maxDelay,
        thread_count: threadCount,
      });
      settingsBaselineRef.current = snapshotSettings({
        masterFolder: folder,
        checkDuplicate: dup,
        scheduleEnabled,
        scheduleTime,
        minDelay,
        maxDelay,
        threadCount,
      });
    } catch (err) {
      console.error("Lỗi khi lưu cấu hình:", err);
    }
  };

  const handleSelectFolder = async () => {
    if (viewState !== "config") return;
    const selected = await openFolderPicker();
    if (selected) {
      setMasterFolder(selected);
      // Ticket #57: nhớ thư mục nguồn ngay sau khi chọn thành công
      await handleSaveSettingsToDb(null, selected);
    }
  };

  // Tải danh sách tài khoản từ Module 02 + khôi phục mapping thư mục đã lưu
  const loadAccountsFromDb = async () => {
    try {
      setIsLoadingAccounts(true);
      const prevByUid = new Map(
        (accounts || []).map((a) => [String(a.uid || a.id), a])
      );

      const [res, mapRes] = await Promise.all([
        api.get("/api/accounts"),
        api
          .get(`/api/post/folders/mappings?post_type=${mode}`)
          .catch((err) => {
            console.warn("Không tải được folder mappings:", err);
            return null;
          }),
      ]);

      let rawAccounts = [];
      if (Array.isArray(res)) {
        rawAccounts = res;
      } else if (Array.isArray(res?.accounts)) {
        rawAccounts = res.accounts;
      } else if (Array.isArray(res?.data)) {
        rawAccounts = res.data;
      } else if (Array.isArray(res?.items)) {
        rawAccounts = res.items;
      }

      const mapRaw = mapRes?.data ?? mapRes;
      const mapList = Array.isArray(mapRaw)
        ? mapRaw
        : Array.isArray(mapRaw?.data)
          ? mapRaw.data
          : [];
      const mappingsMap = new Map(
        mapList
          .filter((m) => m && m.account_uid)
          .map((m) => [String(m.account_uid), m])
      );

      const formatted = rawAccounts.map((a, idx) => {
        const uidStr = String(a.uid || a.id);
        const rawStatus = (a.status || "").toLowerCase();
        const isLive = rawStatus === "live";
        const isDie = rawStatus === "die";
        let accountStatusLabel = "Chưa check";
        if (isLive) accountStatusLabel = "Live";
        else if (isDie) accountStatusLabel = "Die";

        const rawLoginStatus = (a.login_status || "").toLowerCase();
        let connectionStatusLabel = "Chưa đăng nhập";
        if (rawLoginStatus === "logged_in") connectionStatusLabel = "Đã đăng nhập";
        else if (rawLoginStatus === "failed" || rawLoginStatus === "error") connectionStatusLabel = "Đăng nhập lỗi";

        const prev = prevByUid.get(uidStr);
        const m = mappingsMap.get(uidStr);
        let subfolder = "";
        let availableClips = 0;
        let mappingStatus = "Chưa gán";
        let totalClips = 0;
        let allPosted = false;
        if (m?.subfolder_path) {
          // Ưu tiên mapping đã lưu DB (sau Gán tự động / chọn thư mục riêng)
          subfolder = String(m.subfolder_path);
          availableClips = Number(m.available_media_count) || 0;
          mappingStatus = m.mapping_status === "MAPPED" ? "Đã gán" : "Chưa gán";
          totalClips = prev?.totalClips || availableClips;
          allPosted = !!prev?.allPosted;
        } else if (prev?.subfolder) {
          // Fallback: giữ state UI nếu API mappings lỗi / chưa kịp ghi DB
          subfolder = prev.subfolder;
          availableClips = prev.availableClips || 0;
          mappingStatus = prev.mappingStatus || "Đã gán";
          totalClips = prev.totalClips || availableClips;
          allPosted = !!prev.allPosted;
        }

        return {
          id: String(a.id || a.uid),
          stt: String(idx + 1).padStart(2, "0"),
          uid: uidStr,
          name: a.profile_name || a.name || `Nick ${uidStr}`,
          initials: (a.profile_name || a.name || uidStr || "FB").slice(0, 2).toUpperCase(),
          proxy: a.proxy || "",
          proxyStatus: a.proxy ? "Live" : "Chưa kiểm tra",
          connectionStatus: connectionStatusLabel,
          connectionStatusCode: rawLoginStatus,
          accountStatus: accountStatusLabel,
          accountStatusCode: rawStatus,
          category_id: a.category_id ?? null,
          // Đổi tab Reels ↔ Story: luôn bỏ chọn; phiên đang chạy sẽ được gắn lại bởi applySessionAccountSelection
          selected: false,
          subfolder,
          mappingStatus,
          availableClips,
          totalClips,
          allPosted,
        };
      });
      setAccounts(formatted);
      await applySessionAccountSelection(formatted);
    } catch (err) {
      console.error("Lỗi khi tải tài khoản:", err);
    } finally {
      setIsLoadingAccounts(false);
    }
  };

  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const sessionAccountsRef = useRef([]);

  const handleCheckLiveDie = async () => {
    if (accounts.length === 0) return;
    try {
      setIsCheckingStatus(true);
      const uids = accounts.map((a) => a.uid).filter(Boolean);
      const res = await api.post("/api/accounts/check-status", { uids });
      const resData = res?.data ?? res;
      const statuses = resData?.statuses || {};

      setAccounts((prev) =>
        prev.map((acc) => {
          const newStatus = statuses[acc.uid];
          if (newStatus) {
            const isLive = newStatus.toLowerCase() === "live";
            const isDie = newStatus.toLowerCase() === "die";
            return {
              ...acc,
              accountStatus: isLive ? "Live" : isDie ? "Die" : acc.accountStatus,
              accountStatusCode: newStatus.toLowerCase(),
            };
          }
          return acc;
        })
      );
    } catch (err) {
      console.error("Lỗi khi kiểm tra Live/Die:", err);
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const applySessionAccountSelection = async (currentAccounts = []) => {
    const uids = sessionAccountsRef.current;
    if (!Array.isArray(uids) || uids.length === 0) return;
    const runningUidSet = new Set(uids.map(String));
    setAccounts((prev) => {
      const baseList = prev.length > 0 ? prev : currentAccounts;
      if (!baseList.length) return prev;
      return baseList.map((a) => ({
        ...a,
        selected: runningUidSet.has(String(a.uid || a.id)),
      }));
    });
  };

  const checkActiveSessionOnMount = async () => {
    setSyncing(true);
    try {
      const res = await api.get("/api/post/status");
      const d = res?.data ?? res;
      if (!shouldRestoreProgressView(d)) return;
      if (d.post_type !== mode) return;

      setViewState("running");
      setSyncing(false); // đã biết phiên còn chạy → mở khoá ngay, phần còn lại nạp sau
      setIsPaused(!!d.is_paused);
      setPauseSettled(!d.is_paused || d.pause_settled !== false);
      setIsStopped(!!d.is_stopped);
      if (d.metrics) setMetrics(d.metrics);
      if (Array.isArray(d.recent_logs) && d.recent_logs.length > 0) {
        setLogs(d.recent_logs);
      }
      if (Array.isArray(d.threads) && d.threads.length > 0) {
        setThreadRows(mapProgressThreads(d.threads, mode));
      }
      if (Array.isArray(d.session_accounts) && d.session_accounts.length > 0) {
        sessionAccountsRef.current = d.session_accounts;
        await applySessionAccountSelection();
      }
      if (d.is_running || d.is_paused || !d.session_finished) {
        startStatusPolling();
      }
    } catch {
      // quiet error
    } finally {
      setSyncing(false);
    }
  };

  // Restore màn tiến trình ngay khi mount / đổi mode (không chờ load accounts)
  useEffect(() => {
    checkActiveSessionOnMount();
  }, [mode]);

  // Ticket #61: refs kéo chọn / Shift+Click (khai báo trước effect đổi mode)
  const isDraggingRef = useRef(false);
  const dragModeRef = useRef(true);
  const dragVisitedIdsRef = useRef(new Set());
  const lastClickedIndexRef = useRef(null);

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      isDraggingRef.current = false;
      dragVisitedIdsRef.current.clear();
    };
    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
  }, []);

  useEffect(() => {
    // Đổi Reels ↔ Story: bỏ acc đã chọn + reset neo Shift+Click
    lastClickedIndexRef.current = null;
    isDraggingRef.current = false;
    dragVisitedIdsRef.current.clear();
    setAccounts((prev) => prev.map((a) => ({ ...a, selected: false })));
    loadAccountsFromDb();
    loadSettingsFromDb();
  }, [mode]);

  // Hiển thị: Live + Đã đăng nhập. Chọn được: thêm điều kiện đã có media sẵn sàng (> 0)
  const isAccountEligible = (acc) =>
    acc.accountStatusCode === "live" && acc.connectionStatusCode === "logged_in";

  const hasReadyMedia = (acc) => (Number(acc.availableClips) || 0) > 0;

  const canSelectAccount = (acc) => isAccountEligible(acc) && hasReadyMedia(acc);

  const eligibleAccounts = useMemo(
    () => accounts.filter(isAccountEligible),
    [accounts]
  );

  const selectableAccounts = useMemo(
    () => accounts.filter(canSelectAccount),
    [accounts]
  );

  // Bỏ chọn các nick hết / chưa có video (sau map, đổi chống trùng, v.v.)
  useEffect(() => {
    if (viewState !== "config") return;
    setAccounts((prev) => {
      let changed = false;
      const next = prev.map((a) => {
        if (a.selected && !canSelectAccount(a)) {
          changed = true;
          return { ...a, selected: false };
        }
        return a;
      });
      return changed ? next : prev;
    });
  }, [accounts, viewState]);

  // Ticket #61: danh sách đang hiển thị (dùng cho Shift+Click / kéo chọn)
  const filteredAccounts = useMemo(() => {
    return accounts
      .filter((a) => (viewState === "running" ? a.selected : isAccountEligible(a)))
      .filter((a) => {
        if (!searchAccount) return true;
        const q = searchAccount.toLowerCase();
        const cat = a.category_id == null ? null : categoriesById.get(a.category_id);
        const catName =
          cat?.name || (a.category_id != null ? `Danh mục #${a.category_id}` : "");
        return (
          (a.name && a.name.toLowerCase().includes(q)) ||
          (a.uid && a.uid.includes(searchAccount)) ||
          (catName && catName.toLowerCase().includes(q))
        );
      });
  }, [accounts, viewState, searchAccount, categoriesById]);

  const toggleSelectAccount = (id) => {
    setAccounts((prev) =>
      prev.map((acc) => {
        if (acc.id !== id) return acc;
        if (!canSelectAccount(acc)) return { ...acc, selected: false };
        return { ...acc, selected: !acc.selected };
      })
    );
  };

  // Ticket #61: kéo thả bôi đen / Shift+Click chọn dải / click toggle (Ctrl+Click cũng toggle không xóa nick khác)
  const handleRowMouseDown = (acc, index, e) => {
    if (viewState !== "config") return;
    if (e.button !== 0) return;
    if (e.target.closest("button") || e.target.closest("a") || e.target.closest("input")) return;
    if (!canSelectAccount(acc)) return;

    if (e.shiftKey && lastClickedIndexRef.current !== null) {
      e.preventDefault();
      const start = Math.min(lastClickedIndexRef.current, index);
      const end = Math.max(lastClickedIndexRef.current, index);
      const inRangeSelectableIds = new Set(
        filteredAccounts.slice(start, end + 1).filter(canSelectAccount).map((a) => a.id)
      );
      setAccounts((prev) =>
        prev.map((a) => (inRangeSelectableIds.has(a.id) ? { ...a, selected: true } : a))
      );
      return;
    }

    isDraggingRef.current = true;
    lastClickedIndexRef.current = index;
    const nextSelected = !acc.selected;
    dragModeRef.current = nextSelected;
    dragVisitedIdsRef.current = new Set([acc.id]);

    setAccounts((prev) =>
      prev.map((a) => (a.id === acc.id ? { ...a, selected: nextSelected } : a))
    );
  };

  const handleRowMouseEnter = (acc) => {
    if (!isDraggingRef.current) return;
    if (viewState !== "config") return;
    if (!canSelectAccount(acc)) return;
    if (dragVisitedIdsRef.current.has(acc.id)) return;

    dragVisitedIdsRef.current.add(acc.id);
    setAccounts((prev) =>
      prev.map((a) => (a.id === acc.id ? { ...a, selected: dragModeRef.current } : a))
    );
  };

  const selectOnlyLiveAccounts = () => {
    setAccounts((prev) =>
      prev.map((a) => ({
        ...a,
        selected: canSelectAccount(a),
      }))
    );
  };

  const toggleSelectAll = () => {
    const allSelected =
      selectableAccounts.length > 0 && selectableAccounts.every((a) => a.selected);
    const selectableIds = new Set(selectableAccounts.map((a) => a.id));
    setAccounts((prev) =>
      prev.map((a) =>
        selectableIds.has(a.id) ? { ...a, selected: !allSelected } : { ...a, selected: false }
      )
    );
  };

  // Tự động quét và ánh xạ thư mục
  const handleAutoMap = async () => {
    if (viewState !== "config") return;
    if (!masterFolder) {
      toast.warning("Vui lòng chọn hoặc nhập Thư Mục Gốc trước!", "CHƯA CHỌN THƯ MỤC");
      return;
    }
    setIsLoadingAccounts(true);
    try {
      const res = await api.post("/api/post/folders/scan", {
        master_folder_path: masterFolder,
        accounts: accounts,
        post_type: isReels ? "reels" : "story",
      });
      const raw = res?.data ?? res;
      const data = Array.isArray(raw) ? raw : (raw?.data || []);
      if (Array.isArray(data)) {
        const mappingsMap = new Map(
          data.map((m) => [String(m.account_uid), m])
        );
        const allPostedCount = data.filter((m) => m?.subfolder_path && m.all_posted).length;
        const mappedCount = data.filter((m) => m?.subfolder_path).length;
        const nameByUid = new Map(
          accounts.map((a) => [String(a.uid), a.name || String(a.uid)])
        );
        const missingNames = data
          .filter((m) => !m?.subfolder_path)
          .map((m) => nameByUid.get(String(m.account_uid)) || m.account_uid)
          .filter(Boolean);

        setAccounts((prev) =>
          prev.map((acc) => {
            const m = mappingsMap.get(String(acc.uid));
            if (m && m.subfolder_path) {
              return {
                ...acc,
                subfolder: m.subfolder_path,
                mappingStatus: m.mapping_status === "MAPPED" ? "Đã gán" : "Chưa gán",
                availableClips: m.available_media_count ?? 0,
                totalClips: m.total_media_count ?? m.available_media_count ?? 0,
                allPosted: !!m.all_posted,
              };
            }
            // Ticket #62: không tìm thấy thư mục → để trống, không tự gắn UID
            return {
              ...acc,
              subfolder: "",
              mappingStatus: "Chưa gán",
              availableClips: 0,
              totalClips: 0,
              allPosted: false,
            };
          })
        );
        if (allPostedCount > 0 && checkDuplicate) {
          toast.warning(
            `Có ${allPostedCount} tài khoản đã đăng hết toàn bộ video trong thư mục. Vui lòng thêm video mới hoặc tắt "Chống trùng lặp" để đăng lại.`,
            "VIDEO ĐÃ ĐĂNG HẾT"
          );
        }
        if (mappedCount > 0 || missingNames.length > 0) {
          const missingLine = missingNames.length
            ? ` Không tìm thấy thư mục cho: ${missingNames.join(", ")}.`
            : "";
          toast.success(
            `Đã quét xong! Map thành công ${mappedCount} tài khoản.${missingLine}`,
            "QUÉT THƯ MỤC THÀNH CÔNG"
          );
        } else {
          toast.info("Không có tài khoản nào để map.", "QUÉT THƯ MỤC");
        }
      }
    } catch (err) {
      console.error("Lỗi scan folder:", err);
      toast.error(err.message || "Lỗi khi quét thư mục.", "LỖI QUÉT THƯ MỤC");
    } finally {
      setIsLoadingAccounts(false);
    }
  };

  // Chọn thư mục riêng cho một tài khoản
  const handlePickFolderForAccount = async (acc) => {
    // Ticket #65: khóa chỉnh sửa khi đang chạy tiến trình
    if (viewState !== "config") return;
    try {
      const selected = await openFolderPicker();
      if (!selected) return;

      const res = await api.post("/api/post/folders/scan-single", {
        subfolder: selected,
        post_type: isReels ? "reels" : "story",
        account_uid: acc.uid,
      });

      const resData = res?.data ?? res;
      const count = resData?.count ?? 0;
      const totalCount = resData?.total_count ?? count;
      const allPosted = !!resData?.all_posted;
      const status = resData?.status === "MAPPED" ? "Đã gán" : "Chưa gán";

      setAccounts((prev) =>
        prev.map((a) =>
          a.id === acc.id
            ? {
              ...a,
              subfolder: selected,
              availableClips: count,
              totalClips: totalCount,
              allPosted: allPosted,
              mappingStatus: status,
            }
            : a
        )
      );

      if (allPosted && checkDuplicate) {
        toast.warning(
          `Thư mục có ${totalCount} ${unitLabel} nhưng tất cả đã từng đăng thành công bởi nick này!`,
          "ĐÃ ĐĂNG HẾT MEDIA"
        );
      } else {
        toast.success(
          `Đã gán thư mục cho ${acc.name}: ${count} ${unitLabel} sẵn sàng!`,
          "GÁN THƯ MỤC THÀNH CÔNG"
        );
      }
    } catch (err) {
      console.error("Lỗi chọn thư mục cho tài khoản:", err);
      toast.error(err.message || "Lỗi khi gán thư mục.", "LỖI");
    }
  };

  // Polling Runner Status
  const startStatusPolling = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const res = await api.get("/api/post/status");
        const d = res?.data ?? res;
        // Phiên của loại bài khác (Reels ↔ Story) → không đổ vào màn này
        if (d && d.post_type && d.post_type !== mode) return;
        if (d) {
          if (d.metrics) setMetrics(d.metrics);
          if (Array.isArray(d.threads) && d.threads.length > 0) {
            setThreadRows((prev) => mergeProgressRows(prev, d.threads));
          }
          if (Array.isArray(d.recent_logs) && d.recent_logs.length > 0) setLogs(d.recent_logs);
          if (d.is_paused !== undefined) setIsPaused(d.is_paused);
          if (d.pause_settled !== undefined) setPauseSettled(!d.is_paused || !!d.pause_settled);
          if (d.session_finished) {
            setIsStopped(false);
            setThreadRows((prev) => {
              const base =
                Array.isArray(d.threads) && d.threads.length > 0
                  ? mergeProgressRows(prev, d.threads)
                  : prev;
              return base.map((row) =>
                row.status === "Đang chạy" || row.status === "Chờ thực thi" || row.status === "Đang chờ"
                  ? {
                      ...row,
                      status: "Hoàn thành",
                      currentActivity: row.currentActivity || `Đăng ${isReels ? "Reels" : "Story"} hoàn tất.`,
                    }
                  : row
              );
            });
            if (pollingRef.current) clearInterval(pollingRef.current);
          }
          if (d.is_stopped) {
            setIsStopped(true);
            if (pollingRef.current) clearInterval(pollingRef.current);
          }
        }
      } catch (e) {
        // quiet error
      }
    }, 1500);
  };

  useEffect(() => {
    if (viewState === "running") {
      startStatusPolling();
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [viewState]);

  const selectedAccs = useMemo(() => accounts.filter((a) => a.selected), [accounts]);

  // Kiểm tra tính hợp lệ của khung giờ đăng (VR-M03-PUB-05, VR-M03-PUB-02)
  const scheduleTimeInvalid = useMemo(() => {
    if (!scheduleEnabled) return false;
    if (!scheduleTime || typeof scheduleTime !== "string") return true;
    const trimmed = scheduleTime.trim();
    const regex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    return !regex.test(trimmed);
  }, [scheduleEnabled, scheduleTime]);

  const validationStatus = useMemo(() => {
    if (scheduleEnabled) {
      if (!scheduleTime || typeof scheduleTime !== "string" || !scheduleTime.trim()) {
        return {
          ready: false,
          reason: "Vui lòng nhập giờ hẹn hoặc tắt tính năng Khung giờ đăng.",
        };
      }
      if (scheduleTimeInvalid) {
        return {
          ready: false,
          reason: "Khung giờ đăng không hợp lệ (Bắt buộc định dạng HH:mm, ví dụ 08:00, 14:30 khi BẬT hẹn giờ).",
        };
      }
    }
    if (selectedAccs.length === 0) {
      return {
        ready: false,
        reason: "Chưa chọn tài khoản nào (Vui lòng tick chọn ít nhất 1 nick ở Bước 2).",
      };
    }
    const threads = parseInt(threadCount, 10) || 0;
    const maxThreads = Math.min(10, selectedAccs.length);
    if (threads > maxThreads) {
      return {
        ready: false,
        reason: `Số luồng chạy (${threads}) không được vượt quá số tài khoản đã chọn (${selectedAccs.length}), tối đa 10.`,
      };
    }
    const missingAccounts = selectedAccs.filter((acc) => {
      return !acc.subfolder || acc.mappingStatus !== "Đã gán";
    });
    if (missingAccounts.length > 0) {
      return {
        ready: false,
        reason: `Còn ${missingAccounts.length}/${selectedAccs.length} tài khoản chưa được gán thư mục (yêu cầu bấm "Gán thư mục tự động" trước).`,
      };
    }

    const allPostedAccounts = selectedAccs.filter((acc) => {
      return (acc.allPosted || (acc.totalClips > 0 && (acc.availableClips || 0) <= 0)) && checkDuplicate;
    });
    if (allPostedAccounts.length > 0) {
      const names = allPostedAccounts.map((a) => a.name).slice(0, 3).join(", ");
      const extra = allPostedAccounts.length > 3 ? "..." : "";
      return {
        ready: false,
        reason: `Có ${allPostedAccounts.length} nick (${names}${extra}) đã đăng hết toàn bộ video trong thư mục. Vui lòng thêm video mới hoặc tắt "Chống trùng lặp" ở Bước 1 để đăng lại.`,
      };
    }

    const zeroMediaAccounts = selectedAccs.filter((acc) => (acc.availableClips || 0) <= 0);
    if (zeroMediaAccounts.length > 0) {
      return {
        ready: false,
        reason: `Còn ${zeroMediaAccounts.length} tài khoản có 0 video trong thư mục.`,
      };
    }

    return {
      ready: true,
      reason: `Đã sẵn sàng kích hoạt đăng cho ${selectedAccs.length} tài khoản.`,
    };
  }, [scheduleEnabled, scheduleTime, scheduleTimeInvalid, selectedAccs, checkDuplicate, threadCount]);

  // BR-M03-PUB-01: Kiểm tra giờ hẹn ở Quá khứ
  const scheduleIsInPast = useMemo(() => {
    if (!scheduleEnabled || !scheduleTime || scheduleTimeInvalid) return false;
    const parts = scheduleTime.trim().split(":");
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return false;
    const now = new Date();
    const target = new Date();
    target.setHours(h, m, 0, 0);
    return target.getTime() <= now.getTime();
  }, [scheduleEnabled, scheduleTime, scheduleTimeInvalid]);

  const handleStartPost = (e) => {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    startPostingFlow(false);
  };

  const startPostingFlow = (forceImmediate = false) => {
    // Chưa đồng bộ xong phiên đang chạy → không cho tạo phiên mới (Engine sẽ báo lỗi vì phiên cũ còn chạy)
    if (syncing) return;
    if (!validationStatus.ready) {
      toast.warning(validationStatus.reason, "CHƯA ĐỦ ĐIỀU KIỆN ĐĂNG");
      return;
    }

    // BR-M03-PUB-01: Nhánh 2 - Giờ hẹn ở QUÁ KHỨ -> BẮT BUỘC hiển thị Modal + Toast cảnh báo
    const willSchedule = scheduleEnabled && forceImmediate !== true;
    if (willSchedule && scheduleIsInPast) {
      toast.warning(
        `Giờ hẹn ${scheduleTime} đã qua so với hiện tại! Vui lòng chọn Đăng bài ngay hoặc Sửa giờ.`,
        "CẢNH BÁO GIỜ HẸN"
      );
      setShowPastScheduleModal(true);
      return;
    }

    executeStartSession(willSchedule);
  };

  const handleConfirmPastScheduleImmediate = () => {
    setShowPastScheduleModal(false);
    toast.success("Đang tiến hành đăng bài ngay lập tức!", "ĐĂNG NGAY");
    startPostingFlow(true); // forceImmediate = true: người dùng chọn CÓ -> Đăng ngay
  };

  const handleCancelPastSchedule = () => {
    setShowPastScheduleModal(false);
    toast.info("Đã hủy lệnh đăng. Vui lòng nhập lại khung giờ đăng phù hợp.", "CHỌN LẠI GIỜ");
  };

  const executeStartSession = async (isScheduled) => {
    handleSaveSettingsToDb();
    // Bước 5 UC-M03-07: Lập tức chuyển sang view running để khóa thao tác chỉnh sửa
    setViewState("running");
    setIsPaused(false);
    setIsStopped(false);

    // Bug 14: đủ số bài/nick, không cắt theo số luồng
    const tc = Math.max(1, parseInt(threadCount, 10) || 1);
    const initialRows = selectedAccs.map((acc, idx) => {
      const mediaHint = acc.mediaPath || acc.media_path || acc.subfolder || "";
      const isActiveSlot = idx < tc;
      return {
        id: acc.id,
        threadId: isActiveSlot ? `T-${String(idx + 1).padStart(2, "0")}` : "—",
        accountName: acc.name,
        accountUid: acc.uid,
        status: isScheduled || !isActiveSlot ? "Chờ thực thi" : "Đang chạy",
        contentPreview: isScheduled
          ? `Hẹn giờ đăng: ${scheduleTime}`
          : `Upload ${isReels ? "Reels" : "Story"}: ${acc.subfolder || "Mặc định"}`,
        currentActivity: isScheduled
          ? `Đang chờ đến khung giờ ${scheduleTime} để kích nổ...`
          : isActiveSlot
          ? `Đang khởi chạy Chrome & tải lên ${isReels ? "Reels video" : "Story"}...`
          : "Đang chờ trong hàng đợi...",
        elapsedTime: "0:00",
        content: (acc.content || "").trim(),
        imagePaths: [],
        mediaPath: mediaHint,
        mediaName: mediaHint ? String(mediaHint).split(/[/\\]/).pop() : "",
        postType: mode,
      };
    });

    setMetrics({
      running: isScheduled ? 0 : Math.min(tc, selectedAccs.length),
      paused: 0,
      waiting: isScheduled
        ? selectedAccs.length
        : Math.max(0, selectedAccs.length - Math.min(tc, selectedAccs.length)),
      completed: 0,
      systemError: 0,
      deadAccount: 0,
      stopped: 0,
    });
    setThreadRows(initialRows);
    setPreviewPostId(initialRows[0] ? String(initialRows[0].id) : null);
    setLogs([
      {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleTimeString(),
        thread: "System",
        type: "info",
        message: isScheduled
          ? `Đang chờ đến khung giờ ${scheduleTime} để kích nổ...`
          : `Khởi chạy tiến trình đăng ${isReels ? "Reels" : "Story"} với ${selectedAccs.length} tài khoản...`,
      },
    ]);

    try {
      const res = await api.post("/api/post/start", {
        post_type: isReels ? "reels" : "story",
        accounts: selectedAccs,
        thread_count: threadCount,
        min_delay: minDelay,
        max_delay: maxDelay,
        schedule_enabled: isScheduled,
        schedule_time: isScheduled ? scheduleTime : null,
      });

      const resData = res?.data ?? res;
      if (resData?.success === false) {
        throw new Error(resData?.message || "Không thể khởi động phiên đăng bài.");
      }
      toast.success(`Đã kích hoạt phiên đăng ${isReels ? "Reels" : "Story"} thành công!`, "BẮT ĐẦU ĐĂNG");
      startStatusPolling();
    } catch (err) {
      toast.error(`Lỗi kết nối Engine: ${err.message || err}`, "KHÔNG THỂ BẮT ĐẦU");
      setViewState("config");
      setLogs((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          timestamp: new Date().toLocaleTimeString(),
          thread: "System",
          type: "error",
          message: `Lỗi kết nối Engine: ${err.message || err}`,
        },
      ]);
    }
  };

  const handleTogglePause = async () => {
    if (isPaused && !pauseSettled) return; // đang chờ luồng lưu checkpoint
    if (!isPaused) {
      setIsPaused(true);
      setPauseSettled(false);
      setMetrics((prev) => ({ ...prev, paused: prev.running || 1, running: 0 }));
      setThreadRows((prev) =>
        prev.map((r) => ({ ...r, status: "Tạm dừng", currentActivity: "Đã tạm dừng theo yêu cầu" }))
      );
      try {
        await api.post("/api/post/pause");
      } catch { }
      setLogs((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          timestamp: new Date().toLocaleTimeString(),
          thread: "Thread-01",
          type: "warn",
          message: "Tiến trình đang tạm dừng...",
        },
      ]);
    } else {
      setIsPaused(false);
      setMetrics((prev) => ({ ...prev, running: prev.paused || 1, paused: 0 }));
      setThreadRows((prev) =>
        prev.map((r) => ({ ...r, status: "Đang chạy", currentActivity: "Tiếp tục chạy..." }))
      );
      try {
        await api.post("/api/post/resume");
      } catch { }
      setLogs((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          timestamp: new Date().toLocaleTimeString(),
          thread: "Thread-01",
          type: "info",
          message: "Tiếp tục chạy tiến trình...",
        },
      ]);
    }
  };

  const handleConfirmEmergencyStop = async () => {
    setIsStopping(true);
    setIsStopped(true);
    setIsPaused(false);
    if (pollingRef.current) clearInterval(pollingRef.current);

    // Giữ màn giám sát giống khi chạy xong — không nhảy về config
    setThreadRows((prev) =>
      prev.map((r) =>
        r.status === "Hoàn thành" || r.status === "Lỗi hệ thống" || r.status === "Acc chết"
          ? r
          : { ...r, status: "Đã dừng", currentActivity: "Đã dừng theo yêu cầu (khẩn cấp)" }
      )
    );
    setMetrics((prev) => {
      const stoppedNow = Math.max(
        1,
        (prev.running || 0) + (prev.paused || 0) + (prev.waiting || 0) + (prev.stopped || 0)
      );
      return {
        ...prev,
        running: 0,
        paused: 0,
        waiting: 0,
        stopped: stoppedNow,
      };
    });
    setLogs((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleTimeString(),
        thread: "System",
        type: "error",
        message: "Đã nhận lệnh Dừng khẩn cấp: đóng toàn bộ Chrome profiles.",
      },
    ]);

    try {
      await api.post("/api/post/stop");
    } catch { }
    finally {
      setIsStopping(false);
      setShowEmergencyModal(false);
    }
  };

  const handleResetToConfig = async () => {
    try {
      await api.post("/api/post/reset");
    } catch { }
    setViewState("config");
    setIsPaused(false);
    setIsStopped(false);
    setAccounts((prev) => prev.map((a) => ({ ...a, selected: false })));
  };

  const selectedCount = accounts.filter((a) => a.selected).length;
  // Ticket #63: max = số acc đã chọn, không vượt 10; chưa chọn acc → max 1
  const maxThreadCount = selectedCount > 0 ? Math.min(10, selectedCount) : 1;
  const threadCountNum = parseInt(threadCount, 10) || 0;
  const threadExceedsAccounts = threadCountNum > maxThreadCount;

  const clampThreadCount = (raw) => {
    let val = parseInt(raw, 10);
    if (!val || val <= 0) val = 1;
    if (val > maxThreadCount) val = maxThreadCount;
    return val;
  };

  // Ticket #64: mũi tên delay ±10s; auto-swap nếu min > max
  const DELAY_STEP = 10;
  const normalizeDelayPair = (minRaw, maxRaw) => {
    let curMin = parseInt(minRaw, 10);
    let curMax = parseInt(maxRaw, 10);
    if (isNaN(curMin) || curMin <= 0) curMin = 1;
    if (isNaN(curMax) || curMax <= 0) curMax = 1;
    if (curMin > curMax) return { min: curMax, max: curMin };
    return { min: curMin, max: curMax };
  };
  const applyDelayPair = (minRaw, maxRaw) => {
    const pair = normalizeDelayPair(minRaw, maxRaw);
    setMinDelay(pair.min);
    setMaxDelay(pair.max);
  };
  const stepMinDelay = (delta) => {
    const next = Math.max(1, (parseInt(minDelay, 10) || 0) + delta);
    applyDelayPair(next, maxDelay);
  };
  const stepMaxDelay = (delta) => {
    const next = Math.max(1, (parseInt(maxDelay, 10) || 0) + delta);
    applyDelayPair(minDelay, next);
  };
  const minDelayNum = parseInt(minDelay, 10) || 0;
  const maxDelayNum = parseInt(maxDelay, 10) || 0;

  useEffect(() => {
    const val = parseInt(threadCount, 10);
    if (!val || val <= 0) {
      setThreadCount(1);
      return;
    }
    if (val > maxThreadCount) setThreadCount(maxThreadCount);
  }, [selectedCount, maxThreadCount, threadCount]);

  return (
    <div className="space-y-6 pb-20">
      {/* ── BƯỚC 1: cấu hình nguồn — ẩn khi đang giám sát; hiện lại khi quay về cấu hình ── */}
      {viewState === "config" && (
      <div className="space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
            1
          </div>
          <h2 className="text-sm font-bold text-slate-800 tracking-tight">
            Bước 1: Thiết lập cấu hình thư mục nguồn {isReels ? "Reels" : "Story"}
          </h2>
        </div>

        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2 text-[#0F172A] font-bold text-sm tracking-wide">
            <Image src="/icons/icon_post_folder.svg" alt="Folder Icon" width={16} height={18} className="block" />
            <span>THƯ MỤC GỐC</span>
          </div>

          <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
            <input
              type="text"
              value={masterFolder}
              readOnly
              onClick={handleSelectFolder}
              placeholder="Chọn thư mục nguồn..."
              title="Bấm Đổi Thư Mục để chọn đường dẫn"
              className="flex-1 min-w-[240px] h-11 px-4 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-xs sm:text-sm text-[#0F172A] font-mono cursor-pointer focus:outline-none focus:bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-all"
            />
            <button
              type="button"
              onClick={handleSelectFolder}
              className="h-11 px-4 sm:px-5 bg-[#E0EAFF] hover:bg-[#D0E0FF] text-[#0F172A] text-xs sm:text-sm font-semibold rounded-xl flex items-center gap-2 transition-colors cursor-pointer shrink-0"
            >
              <FolderInput size={16} className="text-[#0F172A]" />
              <span>Đổi Thư Mục</span>
            </button>
            <button
              type="button"
              onClick={handleAutoMap}
              disabled={isLoadingAccounts}
              className="h-11 px-5 sm:px-6 bg-[#0055D4] hover:bg-[#0047B3] active:bg-[#003D99] text-white text-xs sm:text-sm font-bold rounded-xl flex items-center gap-2 shadow-[0_3px_10px_rgba(0,85,212,0.3)] transition-all cursor-pointer shrink-0 disabled:opacity-50"
            >
              <Image src="/icons/icon_post_folder2.svg" alt="Folder Icon" width={16} height={18} className="block" />
              <span>Gán thư mục tự động</span>
            </button>
          </div>

          {/* Tuỳ chọn Chống trùng lặp (Anti-duplicate) */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Switch
                checked={checkDuplicate}
                onCheckedChange={(checked) => {
                  setCheckDuplicate(checked);
                  handleSaveSettingsToDb(checked);
                }}
              />
              <div>
                <span className="text-xs font-bold text-slate-800 tracking-wide uppercase">
                  CHỐNG TRÙNG LẶP VIDEO (ANTI-DUPLICATE)
                </span>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Tự động bỏ qua các video đã từng đăng thành công trên tài khoản đó. Tắt tuỳ chọn này nếu bạn muốn đăng lại video cũ.
                </p>
              </div>
            </div>
            {!checkDuplicate && (
              <span className="text-[11px] text-amber-700 font-semibold bg-amber-50 border border-amber-200 px-3 py-1 rounded-xl">
                ⚠️ Đang tắt chống trùng (cho phép đăng lại video cũ)
              </span>
            )}
          </div>
        </div>
      </div>
      )}

      {/* ── BƯỚC 2: CHỌN DANH SÁCH THỰC THI — ẩn khi đang tiến trình (Ticket #65) ── */}
      {viewState === "config" && (
      <div className="space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
            2
          </div>
          <h2 className="text-sm font-bold text-slate-800 tracking-tight">
            Bước 2: Danh sách tài khoản thực thi & Thư mục gán
          </h2>
        </div>

        <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-xs overflow-hidden">
          {/* Header & Subtitle chuẩn Figma */}
          <div className="p-4 sm:p-5 flex items-center justify-between bg-white border-b border-[#F1F5F9]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center shrink-0">
                <Image src="/icons/icon_user.svg" alt="User Icon" width={16} height={18} className="block" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm sm:text-base font-bold text-[#0F172A] leading-tight">
                  {viewState === "config" ? "Danh Sách Thực Thi" : "Danh Sách Thực Thi Đã chọn"}
                </span>
                <span className="text-xs font-semibold text-[#2563EB] mt-0.5">
                  Đã chọn {selectedCount} / {selectableAccounts.length} tài khoản (có {unitLabel} sẵn sàng)
                </span>
              </div>
            </div>
          </div>

          {/* Search bar chuẩn Figma */}
          {viewState === "config" && (
            <div className="px-4 sm:px-5 pt-3 pb-4 bg-white border-b border-[#F1F5F9]">
              <div className="relative w-full">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748B]" />
                <input
                  type="text"
                  value={searchAccount}
                  onChange={(e) => setSearchAccount(e.target.value)}
                  placeholder="Tìm UID, tên nick, proxy..."
                  className="w-full h-10 pl-10 pr-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs sm:text-sm text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-all"
                />
              </div>
            </div>
          )}

          {/* Bảng Danh Sách Thực Thi chuẩn Figma */}
          <div className="w-full overflow-x-auto max-h-[520px] overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#3B82F6] [&::-webkit-scrollbar-thumb]:rounded-full">
            <table className="w-full border-collapse min-w-[920px] table-fixed">
              <colgroup>
                {viewState === "config" && <col className="w-12" />}
                <col className="w-16" />
                <col className="w-48" />
                <col className="w-40" />
                <col className="w-auto" />
                <col className="w-44" />
                <col className="w-36" />
                {viewState === "config" && <col className="w-28" />}
              </colgroup>

              <thead className="sticky top-0 z-10 bg-[#F0F5FF]">
                <tr className="h-11 border-b border-[#E2E8F0]">
                  {viewState === "config" && (
                    <th className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={
                          selectableAccounts.length > 0 &&
                          selectableAccounts.every((a) => a.selected)
                        }
                        onChange={toggleSelectAll}
                        disabled={selectableAccounts.length === 0}
                        className="w-4 h-4 rounded border-[#CBD5E1] accent-[#2563EB] cursor-pointer align-middle"
                        title={
                          selectableAccounts.length === 0
                            ? `Không có tài khoản nào còn ${unitLabel} sẵn sàng để chọn`
                            : `Chọn tất cả tài khoản đã có ${unitLabel}`
                        }
                      />
                    </th>
                  )}
                  <th className="px-2 py-2 font-bold text-xs uppercase tracking-wider text-[#334155] text-center">
                    STT
                  </th>
                  <th className="px-4 py-2 font-bold text-xs uppercase tracking-wider text-[#334155] text-left">
                    TÊN TÀI KHOẢN
                  </th>
                  <th className="px-3 py-2 font-bold text-xs uppercase tracking-wider text-[#334155] text-left">
                    DANH MỤC
                  </th>
                  <th className="px-4 py-2 font-bold text-xs uppercase tracking-wider text-[#334155] text-left">
                    BỘ NỘI DUNG MAP (THƯ MỤC CON)
                  </th>
                  <th className="px-3 py-2 font-bold text-xs uppercase tracking-wider text-[#334155] text-center">
                    SỐ {isReels ? "VIDEO" : "MEDIA"} SẴN SÀNG
                  </th>
                  <th className="px-3 py-2 font-bold text-xs uppercase tracking-wider text-[#334155] text-center">
                    TRẠNG THÁI GÁN
                  </th>
                  {viewState === "config" && (
                    <th className="px-3 py-2 font-bold text-xs uppercase tracking-wider text-[#334155] text-center">
                      THAO TÁC
                    </th>
                  )}
                </tr>
              </thead>

              <tbody className="divide-y divide-[#F1F5F9] text-xs">
                {isLoadingAccounts && accounts.length === 0 ? (
                  <tr>
                    <td colSpan={viewState === "config" ? 8 : 6} className="py-12 text-center text-slate-500">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 size={16} className="animate-spin text-[#2563EB]" />
                        <span className="text-sm font-medium">Đang đồng bộ dữ liệu tài khoản...</span>
                      </div>
                    </td>
                  </tr>
                ) : accounts.length === 0 ? (
                  <tr>
                    <td colSpan={viewState === "config" ? 8 : 6} className="py-12 text-center text-slate-400">
                      Chưa có tài khoản nào. Vui lòng thêm nick ở Module 02 Quản lý tài khoản.
                    </td>
                  </tr>
                ) : eligibleAccounts.length === 0 && viewState === "config" ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400">
                      Không có tài khoản Live & Đã đăng nhập. Chỉ hiển thị nick đủ điều kiện — kiểm tra Module 02.
                    </td>
                  </tr>
                ) : (
                  filteredAccounts.map((acc, index) => {
                      const accCategory =
                        acc.category_id == null ? null : categoriesById.get(acc.category_id);
                      const selectable = canSelectAccount(acc);
                      return (
                        <tr
                          key={acc.id}
                          onMouseDown={(e) => handleRowMouseDown(acc, index, e)}
                          onMouseEnter={() => handleRowMouseEnter(acc)}
                          className={`h-13 transition-colors select-none border-b border-[#F1F5F9] ${
                            !selectable
                              ? "bg-[#F8FAFC]/90 text-[#94A3B8] opacity-60 cursor-not-allowed"
                              : acc.selected
                                ? "bg-[#EFF6FF]/60 hover:bg-[#EFF6FF] cursor-pointer"
                                : "bg-white hover:bg-slate-50/80 cursor-pointer"
                          }`}
                          title={
                            !selectable
                              ? `Không chọn được: chưa có ${unitLabel} sẵn sàng (gán thư mục / thêm media trước)`
                              : undefined
                          }
                        >
                          {/* 1. Checkbox */}
                          {viewState === "config" && (
                            <td
                              className="px-2 py-3 text-center"
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={acc.selected}
                                onChange={() => toggleSelectAccount(acc.id)}
                                disabled={!selectable}
                                className="w-4 h-4 rounded border-[#CBD5E1] accent-[#2563EB] cursor-pointer align-middle disabled:cursor-not-allowed disabled:opacity-50"
                              />
                            </td>
                          )}

                          {/* 2. STT */}
                          <td className="px-2 py-3 text-center font-mono font-medium text-slate-400">
                            {String(index + 1).padStart(2, "0")}
                          </td>

                          {/* 3. TÊN TÀI KHOẢN (Dot + Bold Name) */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="w-2 h-2 rounded-full bg-[#2563EB] shrink-0" />
                              <span className="font-bold text-[#0F172A] text-xs sm:text-[13px] truncate">
                                {acc.name}
                              </span>
                            </div>
                          </td>

                          {/* 4. Danh mục (khớp Module 02 / Status) */}
                          <td className="px-3 py-3 text-left">
                            {acc.category_id == null ? (
                              <span className="text-[#94A3B8]">—</span>
                            ) : (
                              <span
                                style={categoryLabelStyle(accCategory)}
                                title={accCategory?.name || `Danh mục #${acc.category_id}`}
                                className="inline-block max-w-[160px] truncate whitespace-nowrap rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold"
                              >
                                {accCategory?.name || `Danh mục #${acc.category_id}`}
                              </span>
                            )}
                          </td>

                          {/* 5. BỘ NỘI DUNG MAP (THƯ MỤC CON) */}
                          <td className="px-4 py-3">
                            {acc.subfolder ? (
                              <div
                                className="flex items-center gap-1.5 text-xs text-[#2563EB] font-medium truncate"
                                title={acc.subfolder}
                              >
                                <Folder size={14} className="text-[#2563EB] shrink-0" />
                                <span className="truncate">
                                  {acc.subfolder.replace(/^[A-Za-z]:\\/, "\\")}
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-xs text-slate-400 italic">
                                <Folder size={14} className="text-slate-300 shrink-0" />
                                <span>Chưa gán</span>
                              </div>
                            )}
                          </td>

                          {/* 6. SỐ VIDEO SẴN SÀNG */}
                          <td className="px-3 py-3 text-center">
                            {acc.allPosted && checkDuplicate ? (
                              <div className="inline-flex flex-col items-center">
                                <span
                                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200"
                                  title={`Đã đăng hết toàn bộ ${acc.totalClips || 0} video trong thư mục`}
                                >
                                  0 / {acc.totalClips || 0} (Đã đăng hết)
                                </span>
                                <span className="text-[10px] text-amber-600 mt-0.5 font-medium">
                                  Thêm video hoặc tắt chống trùng
                                </span>
                              </div>
                            ) : (
                              <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-semibold bg-[#EFF6FF] text-[#1D4ED8]">
                                {acc.totalClips && acc.totalClips > (acc.availableClips || 0) && checkDuplicate ? (
                                  `${acc.availableClips || 0}/${acc.totalClips} ${unitLabel}`
                                ) : (
                                  `${acc.availableClips || 0} ${unitLabel}`
                                )}
                              </span>
                            )}
                          </td>

                          {/* 7. TRẠNG THÁI GÁN */}
                          <td className="px-3 py-3 text-center">
                            {acc.allPosted && checkDuplicate ? (
                              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-300">
                                <span>Đã đăng hết</span>
                              </span>
                            ) : acc.mappingStatus === "Đã gán" ? (
                              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-[#F0FDF4] text-[#16A34A] border border-[#BBF7D0]">
                                <CheckCircle2 size={13} className="text-[#16A34A] shrink-0" />
                                <span>Đã gán</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-slate-50 text-slate-500 border border-slate-200">
                                <span>Chưa gán</span>
                              </span>
                            )}
                          </td>

                          {/* 8. THAO TÁC — chỉ khi cấu hình (Ticket #65 khóa khi running) */}
                          {viewState === "config" && (
                            <td
                              className="px-3 py-3 text-center"
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handlePickFolderForAccount(acc)}
                                  className="w-7 h-7 rounded-lg text-slate-500 hover:text-[#2563EB] hover:bg-blue-50 flex items-center justify-center transition-colors cursor-pointer"
                                  title="Chọn thư mục riêng cho nick này"
                                >
                                  <FolderOpen size={16} />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      )}

      {/* ── BƯỚC 3: KÍCH HOẠT ĐĂNG BÀI — ẩn khi đang tiến trình (Ticket #65) ── */}
      {viewState === "config" && (
      <div className="space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
            3
          </div>
          <h2 className="text-sm font-bold text-slate-800 tracking-tight">
            Bước 3: Kích hoạt đăng {isReels ? "Reels" : "Story"}
          </h2>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
            {/* Khung giờ đăng (VR-M03-PUB-05, VR-M03-PUB-02) */}
            <div className="flex items-center gap-3">
              <Switch
                checked={scheduleEnabled}
                onCheckedChange={setScheduleEnabled}
              />
              <span className="text-xs font-bold text-slate-700 whitespace-nowrap">
                THIẾT LẬP KHUNG GIỜ ĐĂNG
              </span>
              <input
                type="text"
                disabled={!scheduleEnabled}
                value={scheduleTime}
                placeholder="HH:mm"
                maxLength={5}
                onChange={(e) => {
                  let val = e.target.value.replace(/[^0-9:]/g, "");
                  setScheduleTime(val);
                }}
                onBlur={(e) => {
                  let val = (e.target.value || "").trim();
                  if (/^\d:[0-5]\d$/.test(val)) {
                    setScheduleTime("0" + val);
                  }
                }}
                className={`w-20 h-8 text-center border rounded-lg text-xs font-mono font-semibold transition-all ${!scheduleEnabled
                    ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed opacity-60"
                    : scheduleTimeInvalid
                      ? "bg-rose-50 border-rose-500 text-rose-700 focus:outline-none focus:ring-1 focus:ring-rose-500"
                      : scheduleIsInPast
                        ? "bg-amber-50 border-amber-400 text-amber-900 focus:border-amber-500 focus:outline-none"
                        : "bg-white border-slate-300 text-slate-800 focus:border-blue-500 focus:outline-none shadow-2xs"
                  }`}
                title={
                  scheduleTimeInvalid
                    ? "Khung giờ phải có định dạng HH:mm hợp lệ (00:00 - 23:59)"
                    : scheduleIsInPast
                      ? "Giờ hẹn đã qua so với hiện tại. Hệ thống sẽ hỏi xác nhận khi đăng bài."
                      : "Định dạng HH:mm"
                }
              />
              {scheduleEnabled && !scheduleTimeInvalid && scheduleIsInPast && (
                <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 font-semibold shrink-0">
                  Đã qua giờ
                </span>
              )}
            </div>

            {/* Số lượng chạy: min 1, max = min(10, số acc đã chọn) + mũi tên ↑↓ */}
            <div className="flex flex-col items-start sm:items-center gap-1">
              <div className="flex items-center justify-start sm:justify-center gap-3">
                <span className="text-xs font-bold text-slate-700 whitespace-nowrap">
                  SỐ LUỒNG CHẠY
                </span>
                <div
                  className={`flex items-stretch h-8 rounded-lg border bg-slate-50 overflow-hidden ${
                    threadExceedsAccounts
                      ? "border-red-400"
                      : "border-slate-200 focus-within:border-blue-500"
                  }`}
                >
                  <input
                    type="text"
                    inputMode="numeric"
                    value={threadCount}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/\D/g, "");
                      if (cleaned === "") {
                        setThreadCount("");
                        return;
                      }
                      const n = parseInt(cleaned, 10);
                      if (n > maxThreadCount) {
                        toast.warning(
                          `Số luồng tối đa ${maxThreadCount} (≤ số acc đã chọn, tối đa 10).`,
                          "GIỚI HẠN LUỒNG",
                        );
                        setThreadCount(maxThreadCount);
                        return;
                      }
                      setThreadCount(cleaned);
                    }}
                    onBlur={() => setThreadCount(clampThreadCount(threadCount))}
                    className="w-12 h-full text-center bg-transparent text-xs font-semibold focus:outline-none font-mono"
                    aria-label="Số luồng chạy"
                  />
                  <div className="flex flex-col border-l border-slate-200 w-6 shrink-0">
                    <button
                      type="button"
                      disabled={threadCountNum >= maxThreadCount}
                      onClick={() =>
                        setThreadCount(clampThreadCount(threadCountNum + 1))
                      }
                      className="flex-1 flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      title={`Tăng (tối đa ${maxThreadCount})`}
                      aria-label="Tăng số luồng"
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      type="button"
                      disabled={threadCountNum <= 1}
                      onClick={() =>
                        setThreadCount(clampThreadCount(threadCountNum - 1))
                      }
                      className="flex-1 flex items-center justify-center border-t border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      title="Giảm (tối thiểu 1)"
                      aria-label="Giảm số luồng"
                    >
                      <ChevronDown size={12} />
                    </button>
                  </div>
                </div>
                <span className="text-xs text-slate-500 font-medium">Luồng</span>
              </div>
              <span className="text-[10px] font-medium text-slate-400">
                Tối đa {maxThreadCount}
                {selectedCount > 0
                  ? ` (theo ${selectedCount} acc đã chọn)`
                  : " (chọn acc trước)"}
              </span>
            </div>

            {/* Giãn cách + mũi tên ±10s (Ticket #64); auto-swap khi Min > Max */}
            <div className="flex items-center justify-start sm:justify-end gap-1.5 text-xs whitespace-nowrap">
              <span className="font-bold text-slate-700 shrink-0">GIÃN CÁCH TỪ</span>
              <div className="inline-flex items-center gap-1 shrink-0">
                <div className="flex items-stretch h-8 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden focus-within:border-blue-500">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={minDelay}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/\D/g, "");
                      setMinDelay(cleaned);
                    }}
                    onBlur={() => applyDelayPair(minDelay, maxDelay)}
                    className="w-12 h-full text-center bg-transparent text-xs font-semibold font-mono focus:outline-none"
                    aria-label="Giãn cách tối thiểu (giây)"
                  />
                  <div className="flex flex-col border-l border-slate-200 w-5 shrink-0">
                    <button
                      type="button"
                      onClick={() => stepMinDelay(DELAY_STEP)}
                      className="flex-1 flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
                      title={`Tăng ${DELAY_STEP}s`}
                      aria-label="Tăng giãn cách tối thiểu"
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      type="button"
                      disabled={minDelayNum <= 1}
                      onClick={() => stepMinDelay(-DELAY_STEP)}
                      className="flex-1 flex items-center justify-center border-t border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      title={`Giảm ${DELAY_STEP}s`}
                      aria-label="Giảm giãn cách tối thiểu"
                    >
                      <ChevronDown size={12} />
                    </button>
                  </div>
                </div>
                <span className="text-slate-400 shrink-0">giây</span>
              </div>
              <span className="font-bold text-slate-700 shrink-0">ĐẾN</span>
              <div className="inline-flex items-center gap-1 shrink-0">
                <div className="flex items-stretch h-8 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden focus-within:border-blue-500">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={maxDelay}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/\D/g, "");
                      setMaxDelay(cleaned);
                    }}
                    onBlur={() => applyDelayPair(minDelay, maxDelay)}
                    className="w-12 h-full text-center bg-transparent text-xs font-semibold font-mono focus:outline-none"
                    aria-label="Giãn cách tối đa (giây)"
                  />
                  <div className="flex flex-col border-l border-slate-200 w-5 shrink-0">
                    <button
                      type="button"
                      onClick={() => stepMaxDelay(DELAY_STEP)}
                      className="flex-1 flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
                      title={`Tăng ${DELAY_STEP}s`}
                      aria-label="Tăng giãn cách tối đa"
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      type="button"
                      disabled={maxDelayNum <= 1}
                      onClick={() => stepMaxDelay(-DELAY_STEP)}
                      className="flex-1 flex items-center justify-center border-t border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      title={`Giảm ${DELAY_STEP}s`}
                      aria-label="Giảm giãn cách tối đa"
                    >
                      <ChevronDown size={12} />
                    </button>
                  </div>
                </div>
                <span className="text-slate-400 shrink-0">giây</span>
              </div>
            </div>
          </div>

          <div className="pt-2 space-y-2">
            <button
              type="button"
              onClick={handleStartPost}
              disabled={!validationStatus.ready || syncing}
              aria-busy={syncing}
              className={`w-full py-3 rounded-xl font-bold text-xs shadow-sm flex items-center justify-center gap-2 transition-all ${validationStatus.ready && !syncing
                  ? "bg-blue-600 hover:bg-blue-700 text-white cursor-pointer active:scale-[0.99] shadow-blue-500/20"
                  : "bg-slate-100 border border-slate-200 text-slate-400 cursor-not-allowed opacity-80"
                }`}
            >
              {syncing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Play size={14} className={validationStatus.ready ? "fill-white" : "fill-slate-400"} />
              )}
              <span>{syncing ? "ĐANG ĐỒNG BỘ PHIÊN ĐĂNG..." : `KÍCH HOẠT ĐĂNG ${isReels ? "REELS" : "STORY"}`}</span>
            </button>
            {!validationStatus.ready && !syncing && (
              <p className="text-[11px] text-amber-600 font-medium text-center flex items-center justify-center gap-1.5 pt-0.5">
                <Info size={13} />
                <span>{validationStatus.reason}</span>
              </p>
            )}
          </div>
        </div>
      </div>
      )}

      {/* ── RUNNING STATE ONLY (FIGMA NODE 1613:3170) ── */}
      {viewState === "running" && (
        <div className="space-y-5 animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            {!(
              isStopped ||
              (metrics.running === 0 && !isPaused && (metrics.paused || 0) === 0 &&
                metrics.waiting === 0 &&
                metrics.completed + metrics.systemError + metrics.deadAccount + metrics.stopped > 0)
            ) ? (
              <>
                <button
                  type="button"
                  onClick={handleTogglePause}
                  disabled={isPaused && !pauseSettled}
                  title={isPaused && !pauseSettled ? "Đang chờ luồng lưu checkpoint — xong sẽ mở nút Tiếp tục" : undefined}
                  className={`flex-1 py-3 px-6 rounded-2xl border text-xs font-bold tracking-wider flex items-center justify-center gap-2 shadow-2xs cursor-pointer transition-all active:scale-[0.99] disabled:cursor-wait disabled:opacity-70 disabled:active:scale-100 ${
                    isPaused
                      ? "bg-rose-700 border-rose-700 text-white hover:bg-rose-800"
                      : "bg-[#f8f9ff] border-[#be123c] text-[#881337] hover:bg-rose-50/60"
                  }`}
                >
                  {isPaused && !pauseSettled ? (
                    <>
                      <Loader2 size={14} className="animate-spin text-white" />
                      <span>ĐANG LƯU CHECKPOINT…</span>
                    </>
                  ) : isPaused ? (
                    <>
                      <Play size={14} className="fill-white text-white" />
                      <span>TIẾP TỤC CHẠY</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <rect x="9" y="9" width="6" height="6" fill="currentColor" stroke="none" />
                      </svg>
                      <span>TẠM DỪNG</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setShowEmergencyModal(true)}
                  className="py-3 px-7 rounded-2xl text-xs font-bold tracking-wider flex items-center justify-center gap-2 shadow-2xs cursor-pointer transition-all active:scale-[0.99] bg-[#fcdcdc] hover:bg-rose-200 text-[#881337]"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <rect x="9" y="9" width="6" height="6" fill="currentColor" stroke="none" />
                  </svg>
                  <span>DỪNG KHẨN CẤP</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleResetToConfig}
                className="flex-1 py-3 px-6 rounded-2xl text-xs font-bold tracking-wider flex items-center justify-center gap-2 shadow-sm cursor-pointer transition-all active:scale-[0.99] bg-blue-600 hover:bg-blue-700 text-white font-black"
              >
                <RotateCcw size={14} />
                <span>QUAY VỀ CẤU HÌNH BAN ĐẦU (SOẠN BÀI MỚI)</span>
              </button>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
              <Activity size={16} className="text-blue-600" />
              <span className="text-sm font-bold text-slate-900">Giám sát tiến trình {isReels ? "Reels" : "Story"}</span>
            </div>

            {/* Stat Badges — chỉ hiển thị tổng quan, không lọc (Ticket #68: bỏ thẻ Acc chết) */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-6">
              <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-3 text-left">
                <div className="flex w-full items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">ĐANG CHẠY</span>
                  <span className="h-2 w-2 rounded-full bg-blue-600" />
                </div>
                <span className="mt-1 text-2xl font-black text-blue-600">{metrics.running}</span>
              </div>

              <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-3 text-left">
                <div className="flex w-full items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">TẠM DỪNG</span>
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                </div>
                <span className="mt-1 text-2xl font-black text-amber-500">{metrics.paused}</span>
              </div>

              <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-3 text-left">
                <div className="flex w-full items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">CHỜ THỰC THI</span>
                  <span className="h-2 w-2 rounded-full bg-slate-400" />
                </div>
                <span className="mt-1 text-2xl font-black text-slate-600">{metrics.waiting}</span>
              </div>

              <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-3 text-left">
                <div className="flex w-full items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">HOÀN THÀNH</span>
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                </div>
                <span className="mt-1 text-2xl font-black text-emerald-500">{metrics.completed}</span>
              </div>

              <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-3 text-left">
                <div className="flex w-full items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">LỖI HỆ THỐNG</span>
                  <span className="h-2 w-2 rounded-full bg-rose-500" />
                </div>
                <span className="mt-1 text-2xl font-black text-rose-500">
                  {metrics.systemError + metrics.deadAccount}
                </span>
              </div>

              <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-3 text-left">
                <div className="flex w-full items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">ĐÃ DỪNG</span>
                  <span className="h-2 w-2 rounded-full bg-slate-800" />
                </div>
                <span className="mt-1 text-2xl font-black text-slate-800">{metrics.stopped}</span>
              </div>
            </div>

            <PostProgressPreview
              rows={threadRows}
              postType={mode}
              selectedId={previewPostId}
              onSelectId={setPreviewPostId}
            />

            {/* Progress Monitoring Table */}
            <div className="overflow-x-auto pt-2">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-[#edf2f7] text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                    <th className="py-2.5 px-4">LUỒNG</th>
                    <th className="py-2.5 px-4">TÀI KHOẢN</th>
                    <th className="py-2.5 px-4">TRẠNG THÁI</th>
                    {/* Ticket #66: Story không cột caption — Reels giữ NỘI DUNG */}
                    {isReels && <th className="py-2.5 px-4">NỘI DUNG</th>}
                    {!isReels && <th className="py-2.5 px-4">FILE MEDIA</th>}
                    <th className="py-2.5 px-4">HOẠT ĐỘNG HIỆN TẠI</th>
                    <th className="py-2.5 px-4">THỜI GIAN</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {threadRows.map((row) => (
                    <tr
                      key={row.id}
                      className={`hover:bg-slate-50/70 transition-colors cursor-pointer ${
                        String(previewPostId) === String(row.id) ? "bg-blue-50/50" : ""
                      }`}
                      onClick={() => setPreviewPostId(String(row.id))}
                    >
                      <td className="py-2.5 px-4 font-mono font-bold text-blue-600">{row.threadId}</td>
                      <td className="py-2.5 px-4">
                        <p className="font-bold text-slate-800 text-xs">{row.accountName}</p>
                        <p className="text-[10px] font-mono text-slate-400">{row.accountUid}</p>
                      </td>
                      <td className="py-2.5 px-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
                          row.status === "Đang chạy"
                            ? "bg-blue-50 text-blue-700 border border-blue-200"
                            : row.status === "Tạm dừng"
                              ? "bg-amber-50 text-amber-700 border border-amber-200"
                              : row.status === "Hoàn thành"
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : row.status === "Lỗi hệ thống"
                                  ? "bg-rose-50 text-rose-700 border border-rose-200"
                                  : row.status === "Acc chết"
                                    ? "bg-red-100 text-red-800 border border-red-300"
                                    : "bg-slate-100 text-slate-700 border border-slate-200"
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            row.status === "Đang chạy"
                              ? "bg-blue-600 animate-ping"
                              : row.status === "Tạm dừng"
                                ? "bg-amber-500"
                                : row.status === "Hoàn thành"
                                  ? "bg-emerald-500"
                                  : row.status === "Lỗi hệ thống"
                                    ? "bg-rose-600"
                                    : row.status === "Acc chết"
                                      ? "bg-red-700"
                                      : "bg-slate-600"
                          }`} />
                          {row.status}
                        </span>
                      </td>
                      {isReels ? (
                        <td className="py-2.5 px-4 max-w-[200px] truncate text-slate-700 font-mono text-[11px]" title={row.content || row.contentPreview}>
                          {row.contentPreview}
                        </td>
                      ) : (
                        <td className="py-2.5 px-4 max-w-[200px] truncate text-slate-700 font-mono text-[11px]" title={row.mediaPath || row.mediaName}>
                          {row.mediaName || row.mediaPath || "—"}
                        </td>
                      )}
                      <td className="py-2.5 px-4">
                        <ProgressActivityCell row={row} postType={isReels ? "reels" : "story"} />
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-600 text-xs">
                        {row.elapsedTime}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Live Automation Log Console */}
            <div className="mt-4 rounded-2xl bg-[#1e293b] border border-slate-800 overflow-hidden shadow-md">
              <div className="px-4 py-2.5 bg-[#0f172a] border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  </div>
                  <span className="text-xs font-mono font-semibold text-slate-300">
                    Live Automation Log Console [{isReels ? "Reels" : "Story"}]
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!logs.length) {
                        toast.warning("Chưa có log để sao chép.");
                        return;
                      }
                      const text = logs
                        .map((l) => `[${l.timestamp}] [${l.thread}] ${l.message}`)
                        .join("\n");
                      navigator.clipboard
                        ?.writeText(text)
                        .then(() => toast.success(`Đã sao chép ${logs.length} dòng log`))
                        .catch(() => toast.error("Không thể sao chép log"));
                    }}
                    disabled={!logs.length}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-600 bg-slate-800/80 px-2.5 py-1 font-mono text-[10px] font-semibold text-slate-300 transition hover:border-slate-500 hover:bg-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    title="Sao chép toàn bộ log"
                  >
                    <Copy className="size-3.5" />
                    Copy log
                  </button>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-mono font-semibold ${isPaused ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : isStopped ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    }`}>
                    {isPaused ? "PAUSED" : isStopped ? "STOPPED" : "IDLE"}
                  </span>
                </div>
              </div>

              <div className="p-4 font-mono text-[11px] leading-relaxed max-h-64 overflow-y-auto space-y-1.5 select-text">
                {logs.map((log, idx) => (
                  <div key={log.id ? `${log.id}-${idx}` : idx} className="flex items-start gap-2 text-slate-300">
                    <span className="text-slate-500 shrink-0">[{log.timestamp}]</span>
                    <span className="text-teal-400 shrink-0">[{log.thread}]</span>
                    <span
                      className={`break-all ${log.type === "success" ? "text-emerald-400" : log.type === "warn" ? "text-amber-400" : log.type === "error" ? "text-rose-400" : "text-slate-200"
                        }`}
                    >
                      {log.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal xác nhận DỪNG KHẨN CẤP */}
      <EmergencyStopModal
        isOpen={showEmergencyModal}
        onClose={() => setShowEmergencyModal(false)}
        onConfirm={handleConfirmEmergencyStop}
        isStopping={isStopping}
      />

      {/* Modal xác nhận khi giờ hẹn ở Quá khứ (BR-M03-PUB-01) */}
      <PastScheduleModal
        isOpen={showPastScheduleModal}
        onClose={handleCancelPastSchedule}
        onConfirm={handleConfirmPastScheduleImmediate}
        scheduleTime={scheduleTime}
        currentTime={new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      />
    </div>
  );
}
