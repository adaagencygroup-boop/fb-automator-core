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
  RotateCw,
  FolderSync,
  Play,
  Pause,
  Square,
  Activity,
  Check,
  CheckCircle2,
  RotateCcw,
  Filter,
  Plus,
  Loader2,
  Database,
  Info,
  ShieldCheck
} from "lucide-react";
import { api } from "@/services/api";
import { openFolderPicker } from "@/lib/file-bridge";
import { toast } from "@/lib/toast";
import { Switch } from "@/components/ui/switch";
import { EmergencyStopModal } from "./EmergencyStopModal";
import { PastScheduleModal } from "./PastScheduleModal";

export function ReelsPostView({ mode, initialState = "config" }) {
  const router = useRouter();
  const isReels = mode === "reels";
  const mediaLabel = isReels ? "video" : "ảnh/video";
  const unitLabel = isReels ? "clips" : "files";

  const [viewState, setViewState] = useState(initialState);

  // ── Step 1: Master Folder & Account Mapping ──
  const [masterFolder, setMasterFolder] = useState(
    isReels
      ? "D:\\video_tiktok\\reels_export"
      : "D:\\video_tiktok\\story_export"
  );

  const handleSelectFolder = async () => {
    const selected = await openFolderPicker();
    if (selected) {
      setMasterFolder(selected);
    }
  };

  const [searchAccount, setSearchAccount] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);

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
  const [logs, setLogs] = useState([]);
  const [isPaused, setIsPaused] = useState(false);
  const [isStopped, setIsStopped] = useState(false);
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [showPastScheduleModal, setShowPastScheduleModal] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");

  const pollingRef = useRef(null);

  // Tải cấu hình
  const loadSettingsFromDb = async () => {
    try {
      const res = await api.get(`/api/post/settings?post_type=${mode}`);
      const s = res?.data ?? res;
      if (s && typeof s === "object") {
        if (s.master_folder_path) setMasterFolder(s.master_folder_path);
        if (s.check_duplicate !== undefined) setCheckDuplicate(s.check_duplicate);
        if (s.schedule_enabled !== undefined) setScheduleEnabled(s.schedule_enabled);
        if (s.schedule_time) setScheduleTime(s.schedule_time.slice(0, 5));
        if (s.min_delay) setMinDelay(s.min_delay);
        if (s.max_delay) setMaxDelay(s.max_delay);
        if (s.thread_count) setThreadCount(s.thread_count);
      }
    } catch (err) {
      console.error("Lỗi khi tải cấu hình:", err);
    }
  };

  const handleSaveSettingsToDb = async (overrideCheckDup = null) => {
    try {
      await api.post("/api/post/settings", {
        post_type: mode,
        master_folder_path: masterFolder,
        check_duplicate: overrideCheckDup !== null ? overrideCheckDup : checkDuplicate,
        schedule_enabled: scheduleEnabled,
        schedule_time: scheduleTime,
        min_delay: minDelay,
        max_delay: maxDelay,
        thread_count: threadCount,
      });
    } catch (err) {
      console.error("Lỗi khi lưu cấu hình:", err);
    }
  };

  // Tải danh sách tài khoản từ Module 02
  const loadAccountsFromDb = async () => {
    try {
      setIsLoadingAccounts(true);
      const res = await api.get("/api/accounts");
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
          selected: false,
          subfolder: "",
          mappingStatus: "Chưa gán",
          availableClips: 0,
        };
      });
      setAccounts(formatted);
      await checkActiveSessionOnMount(formatted);
    } catch (err) {
      console.error("Lỗi khi tải tài khoản:", err);
    } finally {
      setIsLoadingAccounts(false);
    }
  };

  const [isCheckingStatus, setIsCheckingStatus] = useState(false);

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

  const checkActiveSessionOnMount = async (currentAccounts = []) => {
    try {
      const res = await api.get("/api/post/status");
      const d = res?.data ?? res;
      if (d && (d.is_running || d.is_paused || (d.session_id && !d.session_finished))) {
        if (d.post_type === mode) {
          setViewState("running");
          setIsPaused(!!d.is_paused);
          setIsStopped(!!d.is_stopped);
          if (d.metrics) setMetrics(d.metrics);
          if (Array.isArray(d.recent_logs) && d.recent_logs.length > 0) {
            setLogs(d.recent_logs);
          }
          if (Array.isArray(d.threads) && d.threads.length > 0) {
            setThreadRows(
              d.threads.map((t) => ({
                id: t.id || t.threadId,
                threadId: t.threadId,
                accountName: t.accountName || "Tài khoản",
                accountUid: t.accountUid || "-",
                status: t.status || "Đang chạy",
                contentPreview: t.contentPreview || "Đang xử lý...",
                currentActivity: t.currentActivity || "",
                elapsedTime: t.elapsedTime || "0:00",
              }))
            );
          }
          if (Array.isArray(d.session_accounts) && d.session_accounts.length > 0) {
            const runningUidSet = new Set(d.session_accounts.map(String));
            setAccounts((prev) => {
              const baseList = prev.length > 0 ? prev : currentAccounts;
              return baseList.map((a) => ({
                ...a,
                selected: runningUidSet.has(String(a.uid || a.id)),
              }));
            });
          }
          startStatusPolling();
        }
      }
    } catch {
      // quiet error
    }
  };

  useEffect(() => {
    loadAccountsFromDb();
    loadSettingsFromDb();
  }, [mode]);

  const toggleSelectAccount = (id) => {
    setAccounts((prev) =>
      prev.map((acc) => (acc.id === id ? { ...acc, selected: !acc.selected } : acc))
    );
  };

  const selectOnlyLiveAccounts = () => {
    setAccounts((prev) =>
      prev.map((a) => ({
        ...a,
        selected: a.accountStatusCode === "live",
      }))
    );
  };

  const toggleSelectAll = () => {
    const allSelected = accounts.every((a) => a.selected);
    setAccounts((prev) => prev.map((a) => ({ ...a, selected: !allSelected })));
  };

  // Tự động quét và ánh xạ thư mục
  const handleAutoMap = async () => {
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
        const mappingsMap = new Map(data.map((m) => [m.account_uid, m]));
        let allPostedCount = 0;
        setAccounts((prev) =>
          prev.map((acc) => {
            const m = mappingsMap.get(acc.uid);
            if (m && m.subfolder_path) {
              if (m.all_posted) allPostedCount++;
              return {
                ...acc,
                subfolder: m.subfolder_path,
                mappingStatus: m.mapping_status === "MAPPED" ? "Đã gán" : "Chưa gán",
                availableClips: m.available_media_count ?? 0,
                totalClips: m.total_media_count ?? m.available_media_count ?? 0,
                allPosted: !!m.all_posted,
              };
            }
            return {
              ...acc,
              subfolder: `${masterFolder}\\${acc.uid}`,
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
        } else {
          toast.success(`Đã quét xong thư mục gốc! Đã map dữ liệu cho ${data.length} tài khoản.`, "QUÉT THƯ MỤC THÀNH CÔNG");
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

  // Quét lại media cho một tài khoản
  const handleRescanAccount = async (acc) => {
    if (!acc.subfolder) {
      toast.warning("Tài khoản chưa được gán thư mục!", "CHƯA GÁN THƯ MỤC");
      return;
    }

    try {
      const res = await api.post("/api/post/folders/scan-single", {
        subfolder: acc.subfolder,
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
          `Nick ${acc.name}: Tổng ${totalCount} ${unitLabel} đều đã từng đăng thành công. Cần thêm video mới hoặc tắt chống trùng.`,
          "ĐÃ ĐĂNG HẾT MEDIA"
        );
      } else {
        toast.info(
          `Quét lại thư mục cho ${acc.name}: ${count}/${totalCount} ${unitLabel} khả dụng.`,
          "CẬP NHẬT MEDIA"
        );
      }
    } catch (err) {
      console.error("Lỗi quét lại tài khoản:", err);
      toast.error(err.message || "Lỗi khi quét thư mục.", "LỖI");
    }
  };

  // Polling Runner Status
  const startStatusPolling = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const res = await api.get("/api/post/status");
        const d = res?.data ?? res;
        if (d) {
          if (d.metrics) setMetrics(d.metrics);
          if (Array.isArray(d.threads) && d.threads.length > 0) setThreadRows(d.threads);
          if (Array.isArray(d.recent_logs) && d.recent_logs.length > 0) setLogs(d.recent_logs);
          if (d.is_paused !== undefined) setIsPaused(d.is_paused);
          if (d.session_finished) {
            setIsStopped(false);
            setThreadRows((prev) =>
              prev.map((row) =>
                row.status === "Đang chạy" || row.status === "Chờ thực thi"
                  ? { ...row, status: "Hoàn thành", currentActivity: `Đăng ${isReels ? "Reels" : "Story"} hoàn tất.` }
                  : row
              )
            );
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
  }, [scheduleEnabled, scheduleTime, scheduleTimeInvalid, selectedAccs, checkDuplicate]);

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

    const initialRows = selectedAccs.slice(0, Math.max(1, threadCount)).map((acc, idx) => ({
      id: acc.id,
      threadId: `T-${String(idx + 1).padStart(2, "0")}`,
      accountName: acc.name,
      accountUid: acc.uid,
      status: isScheduled ? "Chờ thực thi" : "Đang chạy",
      contentPreview: isScheduled
        ? `Hẹn giờ đăng: ${scheduleTime}`
        : `Upload ${isReels ? "Reels" : "Story"}: ${acc.subfolder || "Mặc định"}`,
      currentActivity: isScheduled
        ? `Đang chờ đến khung giờ ${scheduleTime} để kích nổ...`
        : `Đang khởi chạy Chrome & tải lên ${isReels ? "Reels video" : "Story"}...`,
      elapsedTime: "0:01",
    }));

    setMetrics({
      running: isScheduled ? 0 : initialRows.length,
      paused: 0,
      waiting: isScheduled ? selectedAccs.length : Math.max(0, selectedAccs.length - initialRows.length),
      completed: 0,
      systemError: 0,
      deadAccount: 0,
      stopped: 0,
    });
    setThreadRows(initialRows);
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
    if (!isPaused) {
      setIsPaused(true);
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

    try {
      await api.post("/api/post/stop");
      await api.post("/api/post/reset");
    } catch { }
    finally {
      setIsStopping(false);
      setShowEmergencyModal(false);
      setViewState("config");
      setIsStopped(false);
      setIsPaused(false);
    }

    setMetrics({
      running: 0,
      paused: 0,
      waiting: 0,
      completed: 0,
      systemError: 0,
      deadAccount: 0,
      stopped: 1,
    });
    setThreadRows((prev) =>
      prev.map((r) => ({ ...r, status: "Đã dừng", currentActivity: "Đã dừng theo yêu cầu" }))
    );
    setLogs((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleTimeString(),
        thread: "Thread-01",
        type: "error",
        message: "Đã nhận lệnh Dừng khẩn cấp: đóng toàn bộ Chrome profiles.",
      },
    ]);
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

  return (
    <div className="space-y-6 max-w-6xl pb-20">
      {/* ── BƯỚC 1: THIẾT LẬP CẤU HÌNH THƯ MỤC NGUỒN (FIGMA 1338:7 / 1357:4440) ── */}
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
              onChange={(e) => setMasterFolder(e.target.value)}
              placeholder="Chọn hoặc nhập đường dẫn thư mục..."
              className="flex-1 min-w-[240px] h-11 px-4 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-xs sm:text-sm text-[#0F172A] font-mono focus:outline-none focus:bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-all"
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

      {/* ── BƯỚC 2: CHỌN DANH SÁCH THỰC THI ── */}
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
                  Đã chọn {selectedCount} / {accounts.length} tài khoản
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setSearchAccount("");
                loadAccountsFromDb();
              }}
              disabled={isLoadingAccounts}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Tải lại danh sách"
            >
              <RotateCw size={16} className={isLoadingAccounts ? "animate-spin text-[#2563EB]" : ""} />
            </button>
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
            <table className="w-full border-collapse min-w-[760px] table-fixed">
              <colgroup>
                {viewState === "config" && <col className="w-12" />}
                <col className="w-16" />
                <col className="w-60" />
                <col className="w-auto" />
                <col className="w-44" />
                <col className="w-36" />
                <col className="w-28" />
              </colgroup>

              <thead className="sticky top-0 z-10 bg-[#F0F5FF]">
                <tr className="h-11 border-b border-[#E2E8F0]">
                  {viewState === "config" && (
                    <th className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={accounts.length > 0 && accounts.every((a) => a.selected)}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded border-[#CBD5E1] accent-[#2563EB] cursor-pointer align-middle"
                        title="Chọn tất cả"
                      />
                    </th>
                  )}
                  <th className="px-2 py-2 font-bold text-xs uppercase tracking-wider text-[#334155] text-center">
                    STT
                  </th>
                  <th className="px-4 py-2 font-bold text-xs uppercase tracking-wider text-[#334155] text-left">
                    TÊN TÀI KHOẢN
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
                  <th className="px-3 py-2 font-bold text-xs uppercase tracking-wider text-[#334155] text-center">
                    THAO TÁC
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[#F1F5F9] text-xs">
                {isLoadingAccounts && accounts.length === 0 ? (
                  <tr>
                    <td colSpan={viewState === "config" ? 7 : 6} className="py-12 text-center text-slate-500">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 size={16} className="animate-spin text-[#2563EB]" />
                        <span className="text-sm font-medium">Đang đồng bộ dữ liệu tài khoản...</span>
                      </div>
                    </td>
                  </tr>
                ) : accounts.length === 0 ? (
                  <tr>
                    <td colSpan={viewState === "config" ? 7 : 6} className="py-12 text-center text-slate-400">
                      Chưa có tài khoản nào. Vui lòng thêm nick ở Module 02 Quản lý tài khoản.
                    </td>
                  </tr>
                ) : (
                  accounts
                    .filter((a) => (viewState === "running" ? a.selected : true))
                    .filter((a) => !searchAccount || a.name.toLowerCase().includes(searchAccount.toLowerCase()) || a.uid.includes(searchAccount))
                    .map((acc, index) => {
                      return (
                        <tr
                          key={acc.id}
                          onClick={() => toggleSelectAccount(acc.id)}
                          className={`h-13 transition-colors select-none border-b border-[#F1F5F9] cursor-pointer ${acc.selected ? "bg-[#EFF6FF]/60 hover:bg-[#EFF6FF]" : "bg-white hover:bg-slate-50/80"
                            }`}
                        >
                          {/* 1. Checkbox */}
                          {viewState === "config" && (
                            <td
                              className="px-2 py-3 text-center"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={acc.selected}
                                onChange={() => toggleSelectAccount(acc.id)}
                                className="w-4 h-4 rounded border-[#CBD5E1] accent-[#2563EB] cursor-pointer align-middle"
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

                          {/* 4. BỘ NỘI DUNG MAP (THƯ MỤC CON) */}
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

                          {/* 5. SỐ VIDEO SẴN SÀNG */}
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

                          {/* 6. TRẠNG THÁI GÁN */}
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

                          {/* 7. THAO TÁC */}
                          <td
                            className="px-3 py-3 text-center"
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
                              <button
                                type="button"
                                onClick={() => handleRescanAccount(acc)}
                                className="w-7 h-7 rounded-lg text-slate-500 hover:text-[#2563EB] hover:bg-blue-50 flex items-center justify-center transition-colors cursor-pointer"
                                title="Quét lại số media của nick này"
                              >
                                <RotateCw size={15} />
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
        </div>
      </div>

      {/* ── BƯỚC 3: KÍCH HOẠT ĐĂNG BÀI ── */}
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

            {/* Số lượng chạy (VR-M03-CFG-01, BR-M03-CFG-02) */}
            <div className="flex items-center justify-start sm:justify-center gap-3">
              <span className="text-xs font-bold text-slate-700 whitespace-nowrap">
                SỐ LUỒNG CHẠY
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={threadCount}
                onChange={(e) => {
                  // Chỉ cho phép nhập số (VR-M03-CFG-01)
                  const cleaned = e.target.value.replace(/\D/g, "");
                  setThreadCount(cleaned);
                }}
                onBlur={() => {
                  // Nếu để trống hoặc = 0 -> tự động set mặc định = 1 luồng (BR-M03-CFG-02)
                  const val = parseInt(threadCount, 10);
                  if (!val || val <= 0) {
                    setThreadCount(1);
                  } else {
                    setThreadCount(val);
                  }
                }}
                className="w-16 h-8 text-center bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold focus:bg-white focus:border-blue-500 focus:outline-none font-mono"
              />
              <span className="text-xs text-slate-500 font-medium">Luồng</span>
            </div>

            {/* Giãn cách (VR-M03-PUB-01: Auto-swap khi Min > Max) */}
            <div className="flex items-center justify-start sm:justify-end gap-2 text-xs">
              <span className="font-bold text-slate-700">GIÃN CÁCH TỪ</span>
              <input
                type="text"
                inputMode="numeric"
                value={minDelay}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/\D/g, "");
                  setMinDelay(cleaned);
                }}
                onBlur={() => {
                  let curMin = parseInt(minDelay, 10);
                  let curMax = parseInt(maxDelay, 10);
                  if (isNaN(curMin) || curMin <= 0) curMin = 1;
                  if (isNaN(curMax) || curMax <= 0) curMax = 1;

                  if (curMin > curMax) {
                    // Tự động hoán đổi Auto-swap (VR-M03-PUB-01)
                    setMinDelay(curMax);
                    setMaxDelay(curMin);
                  } else {
                    setMinDelay(curMin);
                    setMaxDelay(curMax);
                  }
                }}
                className="w-16 h-8 text-center bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold font-mono focus:bg-white focus:border-blue-500 focus:outline-none"
              />
              <span className="text-slate-400">giây</span>
              <span className="font-bold text-slate-700">ĐẾN</span>
              <input
                type="text"
                inputMode="numeric"
                value={maxDelay}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/\D/g, "");
                  setMaxDelay(cleaned);
                }}
                onBlur={() => {
                  let curMin = parseInt(minDelay, 10);
                  let curMax = parseInt(maxDelay, 10);
                  if (isNaN(curMin) || curMin <= 0) curMin = 1;
                  if (isNaN(curMax) || curMax <= 0) curMax = 1;

                  if (curMin > curMax) {
                    // Tự động hoán đổi Auto-swap (VR-M03-PUB-01)
                    setMinDelay(curMax);
                    setMaxDelay(curMin);
                  } else {
                    setMinDelay(curMin);
                    setMaxDelay(curMax);
                  }
                }}
                className="w-16 h-8 text-center bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold font-mono focus:bg-white focus:border-blue-500 focus:outline-none"
              />
              <span className="text-slate-400">giây</span>
            </div>
          </div>

          {viewState === "config" && (
            <div className="pt-2 space-y-2">
              <button
                type="button"
                onClick={handleStartPost}
                disabled={!validationStatus.ready}
                className={`w-full py-3 rounded-xl font-bold text-xs shadow-sm flex items-center justify-center gap-2 transition-all ${validationStatus.ready
                    ? "bg-blue-600 hover:bg-blue-700 text-white cursor-pointer active:scale-[0.99] shadow-blue-500/20"
                    : "bg-slate-100 border border-slate-200 text-slate-400 cursor-not-allowed opacity-80"
                  }`}
              >
                <Play size={14} className={validationStatus.ready ? "fill-white" : "fill-slate-400"} />
                <span>KÍCH HOẠT ĐĂNG {isReels ? "REELS" : "STORY"}</span>
              </button>
              {!validationStatus.ready && (
                <p className="text-[11px] text-amber-600 font-medium text-center flex items-center justify-center gap-1.5 pt-0.5">
                  <Info size={13} />
                  <span>{validationStatus.reason}</span>
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── RUNNING STATE ONLY (FIGMA NODE 1613:3170) ── */}
      {viewState === "running" && (
        <div className="space-y-5 animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            {!(metrics.running === 0 && metrics.waiting === 0 && (metrics.completed + metrics.systemError + metrics.deadAccount + metrics.stopped > 0)) ? (
              <>
                <button
                  type="button"
                  onClick={handleTogglePause}
                  className={`flex-1 py-3 px-6 rounded-2xl border text-xs font-bold tracking-wider flex items-center justify-center gap-2 shadow-2xs cursor-pointer transition-all active:scale-[0.99] ${
                    isPaused
                      ? "bg-rose-700 border-rose-700 text-white hover:bg-rose-800"
                      : "bg-[#f8f9ff] border-[#be123c] text-[#881337] hover:bg-rose-50/60"
                  }`}
                >
                  {isPaused ? (
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                <Activity size={16} className="text-blue-600" />
                <span className="text-sm font-bold text-slate-900">Giám sát tiến trình {isReels ? "Reels" : "Story"}</span>
              </div>
              {statusFilter !== "all" && (
                <button
                  type="button"
                  onClick={() => setStatusFilter("all")}
                  className="text-xs text-blue-600 hover:underline font-semibold cursor-pointer"
                >
                  Bỏ lọc (Xem tất cả)
                </button>
              )}
            </div>

            {/* 7 Stat Badges */}
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2.5">
              <button
                type="button"
                onClick={() => setStatusFilter(statusFilter === "running" ? "all" : "running")}
                className={`p-3 rounded-2xl bg-white border transition-all text-left flex flex-col justify-between cursor-pointer ${statusFilter === "running" ? "border-blue-500 ring-2 ring-blue-500/20 shadow-sm bg-blue-50/20" : "border-slate-200/80 hover:border-blue-300"
                  }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">ĐANG CHẠY</span>
                  <span className="w-2 h-2 rounded-full bg-blue-600" />
                </div>
                <span className="text-2xl font-black text-blue-600 mt-1">{metrics.running}</span>
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter(statusFilter === "paused" ? "all" : "paused")}
                className={`p-3 rounded-2xl bg-white border transition-all text-left flex flex-col justify-between cursor-pointer ${statusFilter === "paused" ? "border-amber-500 ring-2 ring-amber-500/20 shadow-sm bg-amber-50/20" : "border-slate-200/80 hover:border-amber-300"
                  }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">TẠM DỪNG</span>
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                </div>
                <span className="text-2xl font-black text-amber-500 mt-1">{metrics.paused}</span>
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter(statusFilter === "waiting" ? "all" : "waiting")}
                className={`p-3 rounded-2xl bg-white border transition-all text-left flex flex-col justify-between cursor-pointer ${statusFilter === "waiting" ? "border-slate-500 ring-2 ring-slate-500/20 shadow-sm bg-slate-50" : "border-slate-200/80 hover:border-slate-300"
                  }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">CHỜ THỰC THI</span>
                  <span className="w-2 h-2 rounded-full bg-slate-400" />
                </div>
                <span className="text-2xl font-black text-slate-600 mt-1">{metrics.waiting}</span>
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter(statusFilter === "completed" ? "all" : "completed")}
                className={`p-3 rounded-2xl bg-white border transition-all text-left flex flex-col justify-between cursor-pointer ${statusFilter === "completed" ? "border-emerald-500 ring-2 ring-emerald-500/20 shadow-sm bg-emerald-50/20" : "border-slate-200/80 hover:border-emerald-300"
                  }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">HOÀN THÀNH</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                </div>
                <span className="text-2xl font-black text-emerald-500 mt-1">{metrics.completed}</span>
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter(statusFilter === "system_error" ? "all" : "system_error")}
                className={`p-3 rounded-2xl bg-white border transition-all text-left flex flex-col justify-between cursor-pointer ${statusFilter === "system_error" ? "border-rose-500 ring-2 ring-rose-500/20 shadow-sm bg-rose-50/20" : "border-slate-200/80 hover:border-rose-300"
                  }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">LỖI HỆ THỐNG</span>
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                </div>
                <span className="text-2xl font-black text-rose-500 mt-1">{metrics.systemError}</span>
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter(statusFilter === "dead_acc" ? "all" : "dead_acc")}
                className={`p-3 rounded-2xl bg-white border transition-all text-left flex flex-col justify-between cursor-pointer ${statusFilter === "dead_acc" ? "border-red-700 ring-2 ring-red-700/20 shadow-sm bg-red-50/20" : "border-slate-200/80 hover:border-red-400"
                  }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">ACC CHẾT</span>
                  <span className="w-2 h-2 rounded-full bg-red-700" />
                </div>
                <span className="text-2xl font-black text-red-700 mt-1">{metrics.deadAccount}</span>
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter(statusFilter === "stopped" ? "all" : "stopped")}
                className={`p-3 rounded-2xl bg-white border transition-all text-left flex flex-col justify-between cursor-pointer ${statusFilter === "stopped" ? "border-slate-800 ring-2 ring-slate-800/20 shadow-sm bg-slate-100" : "border-slate-200/80 hover:border-slate-400"
                  }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">ĐÃ DỪNG</span>
                  <span className="w-2 h-2 rounded-full bg-slate-800" />
                </div>
                <span className="text-2xl font-black text-slate-800 mt-1">{metrics.stopped}</span>
              </button>
            </div>

            {/* Progress Monitoring Table */}
            <div className="overflow-x-auto pt-2">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-[#edf2f7] text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                    <th className="py-2.5 px-4">LUỒNG</th>
                    <th className="py-2.5 px-4">TÀI KHOẢN</th>
                    <th className="py-2.5 px-4">TRẠNG THÁI</th>
                    <th className="py-2.5 px-4">NỘI DUNG</th>
                    <th className="py-2.5 px-4">HOẠT ĐỘNG HIỆN TẠI</th>
                    <th className="py-2.5 px-4">THỜI GIAN</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {threadRows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-4 font-mono font-bold text-blue-600">{row.threadId}</td>
                      <td className="py-2.5 px-4">
                        <p className="font-bold text-slate-800 text-xs">{row.accountName}</p>
                        <p className="text-[10px] font-mono text-slate-400">{row.accountUid}</p>
                      </td>
                      <td className="py-2.5 px-4">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-ping" />
                          {row.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 max-w-[200px] truncate text-slate-700 font-mono text-[11px]">
                        {row.contentPreview}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700 text-xs font-medium">
                        {row.currentActivity}
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
