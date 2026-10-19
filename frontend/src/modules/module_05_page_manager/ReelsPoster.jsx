"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  FolderOpen,
  Clock,
  Plus,
  X,
  Play,
  Square,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronUp,
  Terminal,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Info,
  FolderCheck,
  FolderX,
  RotateCcw,
  Check
} from "lucide-react";
import {
  getReelsAccountsPages,
  scanReelsFolders,
  startReelsJob,
  stopReelsJob,
  getReelsStatus,
  clearReelsLogs
} from "./service";
import { API_BASE } from "@/config/constants";
import { toast } from "@/lib/toast";

const STORAGE_KEY = "fb_reels_poster_config_v1";

const DEFAULT_REELS_CONFIG = {
  rootDir: "",
  scheduleEnabled: false,
  scheduleTimes: [],
  sleepMin: 600,
  sleepMax: 900,
  pageFolderOverrides: {},
};

function renderLogMessage(text) {
  if (!text) return "";
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, index) => {
    if (part.match(urlRegex)) {
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-cyan-400 underline hover:text-cyan-200 font-semibold"
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

export default function ReelsPoster() {
  // Form states
  const [rootDir, setRootDir] = useState(DEFAULT_REELS_CONFIG.rootDir);
  const [scheduleEnabled, setScheduleEnabled] = useState(DEFAULT_REELS_CONFIG.scheduleEnabled);
  const [scheduleTimes, setScheduleTimes] = useState(DEFAULT_REELS_CONFIG.scheduleTimes);
  const [newTimeInput, setNewTimeInput] = useState("");
  const [showAddTime, setShowAddTime] = useState(false);
  const [sleepMin, setSleepMin] = useState(DEFAULT_REELS_CONFIG.sleepMin);
  const [sleepMax, setSleepMax] = useState(DEFAULT_REELS_CONFIG.sleepMax);

  // Accounts & Pages states
  const [accounts, setAccounts] = useState([]);
  const [selectedPageIds, setSelectedPageIds] = useState(new Set());
  const [pageFolderOverrides, setPageFolderOverrides] = useState(DEFAULT_REELS_CONFIG.pageFolderOverrides);
  const [availableFolders, setAvailableFolders] = useState([]);
  const [expandedAccounts, setExpandedAccounts] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingData, setLoadingData] = useState(false);
  const [isScanningFolders, setIsScanningFolders] = useState(false);

  // Runner & Console logs states
  const [isRunning, setIsRunning] = useState(false);
  const [runnerStatus, setRunnerStatus] = useState("IDLE");
  const [runnerNextSlot, setRunnerNextSlot] = useState(null);
  const [currentTimeMinutes, setCurrentTimeMinutes] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  const [stats, setStats] = useState({ total_pages: 0, processed: 0, success: 0, failed: 0, current_page: "" });
  const [logs, setLogs] = useState([]);
  const logBoxRef = useRef(null);
  const eventSourceRef = useRef(null);
  const folderInputRef = useRef(null);
  const isInitializedRef = useRef(false);

  // Cập nhật phút hiện tại định kỳ để hiển thị đếm ngược chính xác
  useEffect(() => {
    const ticker = setInterval(() => {
      const d = new Date();
      setCurrentTimeMinutes(d.getHours() * 60 + d.getMinutes());
    }, 15000);
    return () => clearInterval(ticker);
  }, []);

  // 1. Khôi phục cấu hình đã lưu từ localStorage khi khởi chạy
  useEffect(() => {
    let targetScanDir = DEFAULT_REELS_CONFIG.rootDir;
    try {
      if (typeof window !== "undefined") {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.rootDir) {
            setRootDir(parsed.rootDir);
            targetScanDir = parsed.rootDir;
          }
          if (parsed.scheduleEnabled !== undefined) {
            setScheduleEnabled(Boolean(parsed.scheduleEnabled));
          }
          if (Array.isArray(parsed.scheduleTimes) && parsed.scheduleTimes.length > 0) {
            setScheduleTimes(parsed.scheduleTimes);
          }
          if (parsed.sleepMin !== undefined) {
            setSleepMin(Number(parsed.sleepMin));
          }
          if (parsed.sleepMax !== undefined) {
            setSleepMax(Number(parsed.sleepMax));
          }
          if (parsed.pageFolderOverrides && typeof parsed.pageFolderOverrides === "object") {
            setPageFolderOverrides(parsed.pageFolderOverrides);
          }
        }
      }
    } catch (e) {
      console.warn("Lỗi đọc cấu hình từ localStorage:", e);
    }

    // Quét thư mục tương ứng cấu hình đã lưu
    handleScanFolders(targetScanDir, false);

    // Kích hoạt cờ Auto-save sau khi các state đã nạp xong (tránh race condition ghi đè giá trị mặc định)
    const timer = setTimeout(() => {
      isInitializedRef.current = true;
    }, 250);

    return () => clearTimeout(timer);
  }, []);

  // 2. Tự động lưu ngầm vào localStorage (Auto-save) khi người dùng thay đổi cấu hình
  useEffect(() => {
    // Chỉ lưu khi đã qua bước nạp cấu hình ban đầu
    if (!isInitializedRef.current) return;

    try {
      if (typeof window !== "undefined") {
        const configToSave = {
          rootDir,
          scheduleEnabled,
          scheduleTimes,
          sleepMin,
          sleepMax,
          pageFolderOverrides,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(configToSave));
      }
    } catch (e) {
      console.warn("Lỗi lưu cấu hình vào localStorage:", e);
    }
  }, [rootDir, scheduleEnabled, scheduleTimes, sleepMin, sleepMax, pageFolderOverrides]);

  // 3. Khôi phục cấu hình về mặc định ban đầu
  const handleResetConfig = () => {
    try {
      if (typeof window !== "undefined") {
        localStorage.removeItem(STORAGE_KEY);
      }
      setRootDir(DEFAULT_REELS_CONFIG.rootDir);
      setScheduleEnabled(DEFAULT_REELS_CONFIG.scheduleEnabled);
      setScheduleTimes(DEFAULT_REELS_CONFIG.scheduleTimes);
      setSleepMin(DEFAULT_REELS_CONFIG.sleepMin);
      setSleepMax(DEFAULT_REELS_CONFIG.sleepMax);
      setPageFolderOverrides(DEFAULT_REELS_CONFIG.pageFolderOverrides);
      toast.success("Đã khôi phục cài đặt mặc định thành công!", "ĐẶT LẠI CẤU HÌNH");
      setLogs((prev) => [
        ...prev,
        {
          timestamp: new Date().toLocaleTimeString("vi-VN"),
          level: "INFO",
          message: "Đã khôi phục cấu hình về cài đặt mặc định ban đầu."
        }
      ]);
    } catch (e) {
      console.warn("Lỗi reset cấu hình:", e);
    }
  };

  // Mở hộp thoại chọn thư mục từ máy tính
  const handleOpenFolderPicker = async () => {
    if (typeof window !== "undefined" && window.__TAURI__) {
      try {
        const { open } = await import("@tauri-apps/api/dialog");
        const selected = await open({
          directory: true,
          multiple: false,
          title: "Chọn thư mục gốc chứa video Reels"
        });
        if (selected && typeof selected === "string") {
          setRootDir(selected);
          handleScanFolders(selected, true);
          return;
        }
      } catch (err) {
        console.warn("Tauri dialog fallback:", err);
      }
    }
    if (folderInputRef.current) {
      folderInputRef.current.click();
    }
  };

  // Xử lý sau khi người dùng chọn thư mục từ trình duyệt web
  const handlePickFolderFromDisk = (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const firstFile = files[0];
      const relPath = firstFile.webkitRelativePath || "";
      const rootFolderName = relPath.split("/")[0] || "";
      const fullPath = firstFile.path ? firstFile.path.substring(0, firstFile.path.lastIndexOf(firstFile.name)) : "";
      const determinedPath = fullPath || (rootFolderName ? `D:\\Projects\\Work\\tool_facebook\\${rootFolderName}` : rootDir);
      
      setRootDir(determinedPath);
      handleScanFolders(determinedPath, true);
    }
  };
  const loadAccountsAndPages = async () => {
    setLoadingData(true);
    try {
      const data = await getReelsAccountsPages();
      if (data?.success && Array.isArray(data.accounts)) {
        setAccounts(data.accounts);
        const allPageIds = new Set();
        data.accounts.forEach((acc) => {
          (acc.pages || []).forEach((p) => allPageIds.add(String(p.page_id)));
        });
        setSelectedPageIds(allPageIds);
        if (data.accounts.length > 0) {
          setExpandedAccounts(new Set([(data.accounts[0]?.group_key || data.accounts[0]?.account_uid)]));
        }
      }
    } catch (err) {
      console.warn("Lỗi tải danh sách tài khoản:", err);
    } finally {
      setLoadingData(false);
    }
  };

  // Quét thư mục gốc kèm phản hồi toàn diện (Nút xoay, Toast, Terminal logs)
  const handleScanFolders = async (dirToScan, isManual = false) => {
    const targetDir = (dirToScan || rootDir || "").trim();
    if (!targetDir) {
      if (isManual) {
        toast.warning("Vui lòng nhập đường dẫn thư mục gốc", "CẢNH BÁO");
        setLogs((prev) => [
          ...prev,
          {
            timestamp: new Date().toLocaleTimeString("vi-VN"),
            level: "WARN",
            message: "Đường dẫn thư mục video gốc đang để trống."
          }
        ]);
      }
      return;
    }

    setIsScanningFolders(true);
    if (isManual) {
      setLogs((prev) => [
        ...prev,
        {
          timestamp: new Date().toLocaleTimeString("vi-VN"),
          level: "INFO",
          message: `Đang quét thư mục: ${targetDir}...`
        }
      ]);
    }

    try {
      // Đợi tối thiểu 400ms để hiệu ứng loading mượt mà
      const [data] = await Promise.all([
        scanReelsFolders(targetDir),
        new Promise((resolve) => setTimeout(resolve, 400))
      ]);

      if (data?.success && Array.isArray(data.folders) && data.folders.length > 0) {
        setAvailableFolders(data.folders);
        let matchedCount = 0;
        if (data.matches) {
          const overrides = {};
          Object.entries(data.matches).forEach(([pid, match]) => {
            if (match.folder_name) {
              overrides[pid] = match.folder_name;
              matchedCount++;
            }
          });
          // Ưu tiên giữ lại các gán thư mục thủ công người dùng đã lưu trong prev
          setPageFolderOverrides((prev) => ({ ...overrides, ...prev }));
        }

        const totalVideos = data.folders.reduce((acc, f) => acc + (f.video_count || 0), 0);

        if (isManual) {
          toast.success(
            `Tìm thấy ${data.folders.length} thư mục con (${totalVideos} video), tự động khớp ${matchedCount} Fanpage!`,
            "QUÉT THÀNH CÔNG"
          );
          setLogs((prev) => [
            ...prev,
            {
              timestamp: new Date().toLocaleTimeString("vi-VN"),
              level: "SUCCESS",
              message: `Quét thành công: ${data.folders.length} thư mục (${totalVideos} video). Đã tự động khớp ${matchedCount} Fanpage.`
            }
          ]);
        }
      } else if (data?.success && Array.isArray(data.folders) && data.folders.length === 0) {
        if (isManual) {
          toast.warning("Không tìm thấy thư mục con hoặc video nào trong đường dẫn này.", "CẢNH BÁO");
          setLogs((prev) => [
            ...prev,
            {
              timestamp: new Date().toLocaleTimeString("vi-VN"),
              level: "WARN",
              message: `Không tìm thấy thư mục con hoặc video Reels nào tại: ${targetDir}`
            }
          ]);
        }
      } else {
        const errMsg = data?.error || "Thư mục không tồn tại hoặc không thể truy cập.";
        if (isManual) {
          toast.error(errMsg, "QUÉT THẤT BẠI");
          setLogs((prev) => [
            ...prev,
            {
              timestamp: new Date().toLocaleTimeString("vi-VN"),
              level: "ERROR",
              message: `Quét thư mục thất bại: ${errMsg}`
            }
          ]);
        }
      }
    } catch (err) {
      console.warn("Scan folders error:", err);
      if (isManual) {
        const errMsg = err?.response?.data?.detail || err?.message || "Không thể kết nối đến máy chủ để quét thư mục.";
        toast.error(errMsg, "QUÉT THẤT BẠI");
        setLogs((prev) => [
          ...prev,
          {
            timestamp: new Date().toLocaleTimeString("vi-VN"),
            level: "ERROR",
            message: `Quét thư mục thất bại: ${errMsg}`
          }
        ]);
      }
    } finally {
      setIsScanningFolders(false);
    }
  };

  useEffect(() => {
    loadAccountsAndPages();
    fetchStatus();
    setupSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // Fetch status định kỳ
  const fetchStatus = async () => {
    try {
      const st = await getReelsStatus();
      if (st) {
        setIsRunning(st.is_running);
        setRunnerStatus(st.status);
        if (st.stats) setStats(st.stats);
        if (st.next_slot !== undefined) setRunnerNextSlot(st.next_slot);
        if (Array.isArray(st.recent_logs) && st.recent_logs.length > 0) {
          setLogs((prev) => {
            const existingKeys = new Set(prev.map((l) => `${l.timestamp}_${l.message}`));
            const newLogs = st.recent_logs.filter((l) => !existingKeys.has(`${l.timestamp}_${l.message}`));
            return newLogs.length > 0 ? [...prev, ...newLogs] : prev;
          });
        }
      }
    } catch (e) {
      // ignore
    }
  };

  // Polling fallback: tự động thăm dò mỗi 2s khi tiến trình đang chạy (đảm bảo log & status luôn cập nhật)
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      fetchStatus();
    }, 2000);
    return () => clearInterval(interval);
  }, [isRunning]);

  // Setup SSE stream for console logs
  const setupSSE = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    const streamUrl = `${API_BASE}/api/pages/reels/logs/stream`;
    const es = new EventSource(streamUrl, { withCredentials: true });
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        if (!event.data || event.data.trim() === "ping") return;
        const entry = JSON.parse(event.data);
        if (entry && entry.message) {
          setLogs((prev) => {
            const key = `${entry.timestamp}_${entry.message}`;
            if (prev.some((l) => `${l.timestamp}_${l.message}` === key)) return prev;
            return [...prev, entry];
          });
        }
      } catch (err) {
        // ignore parse error
      }
    };

    es.onerror = () => {
      es.close();
      setTimeout(setupSSE, 5000);
    };
  };

  // Tự động cuộn console log xuống cuối
  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [logs]);

  // Thêm khung giờ hẹn (tự động chuẩn hóa 2 chữ số HH:MM)
  const handleAddTime = (customVal) => {
    const val = (customVal !== undefined ? customVal : newTimeInput || "09:00").trim();
    if (!val) return;
    const match = val.match(/^([01]?[0-9]|2[0-3]):([0-5][0-9])$/);
    if (match) {
      const h = match[1].padStart(2, "0");
      const m = match[2];
      const normalized = `${h}:${m}`;
      if (!scheduleTimes.includes(normalized)) {
        setScheduleTimes([...scheduleTimes, normalized].sort());
      }
      setNewTimeInput("");
      setShowAddTime(false);
    } else {
      alert("Định dạng giờ không hợp lệ. Vui lòng chọn dạng HH:MM (Ví dụ: 09:30 hoặc 18:00)");
    }
  };

  // Thêm nhanh khung giờ gợi ý
  const handleAddPreset = (timePreset) => {
    if (!scheduleTimes.includes(timePreset)) {
      setScheduleTimes([...scheduleTimes, timePreset].sort());
    }
  };

  // Tính toán khung giờ hẹn gần nhất tiếp theo
  const getNextScheduledInfo = () => {
    if (!scheduleEnabled || scheduleTimes.length === 0) return null;
    const now = new Date();
    const currentM = now.getHours() * 60 + now.getMinutes();

    let nextSlot = null;
    let minDiff = Infinity;

    for (const t of scheduleTimes) {
      if (!t || !t.includes(":")) continue;
      const [h, m] = t.split(":").map(Number);
      const slotMin = h * 60 + m;
      if (slotMin > currentM) {
        const diff = slotMin - currentM;
        if (diff < minDiff) {
          minDiff = diff;
          nextSlot = { time: t, diffMinutes: diff, isTomorrow: false };
        }
      }
    }

    if (!nextSlot && scheduleTimes.length > 0) {
      const sorted = [...scheduleTimes].sort();
      if (sorted[0] && sorted[0].includes(":")) {
        const [h, m] = sorted[0].split(":").map(Number);
        const slotMin = h * 60 + m;
        const diff = 1440 - currentM + slotMin;
        nextSlot = { time: sorted[0], diffMinutes: diff, isTomorrow: true };
      }
    }

    return nextSlot;
  };

  const formatTimeRemaining = (mins) => {
    if (!mins || mins <= 0) return "dưới 1 phút";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0) return `${h} giờ ${m} phút`;
    return `${m} phút`;
  };

  const nextSlotInfo = runnerNextSlot || getNextScheduledInfo();

  // Xóa khung giờ hẹn
  const handleRemoveTime = (timeToRemove) => {
    setScheduleTimes(scheduleTimes.filter((t) => t !== timeToRemove));
  };

  // Toggle chọn tài khoản (và toàn bộ Page của tài khoản đó)
  const handleToggleAccount = (acc) => {
    const accPages = acc.pages || [];
    const allSelected = accPages.every((p) => selectedPageIds.has(String(p.page_id)));
    const next = new Set(selectedPageIds);

    if (allSelected) {
      accPages.forEach((p) => next.delete(String(p.page_id)));
    } else {
      accPages.forEach((p) => next.add(String(p.page_id)));
    }
    setSelectedPageIds(next);
  };

  // Toggle chọn 1 page con
  const handleTogglePage = (pageId) => {
    const next = new Set(selectedPageIds);
    const pid = String(pageId);
    if (next.has(pid)) {
      next.delete(pid);
    } else {
      next.add(pid);
    }
    setSelectedPageIds(next);
  };

  // Toggle mở rộng tài khoản
  const handleToggleExpand = (accUid) => {
    const next = new Set(expandedAccounts);
    if (next.has(accUid)) {
      next.delete(accUid);
    } else {
      next.add(accUid);
    }
    setExpandedAccounts(next);
  };

  // Chọn tất cả / Bỏ chọn tất cả
  const handleSelectAll = (selectAll) => {
    if (selectAll) {
      const all = new Set();
      accounts.forEach((a) => (a.pages || []).forEach((p) => all.add(String(p.page_id))));
      setSelectedPageIds(all);
    } else {
      setSelectedPageIds(new Set());
    }
  };

  // Lấy tên thư mục video hiện tại của một Page
  const getPageFolder = (page) => {
    const pid = String(page.page_id);
    return pageFolderOverrides[pid] !== undefined ? pageFolderOverrides[pid] : (page.reels_folder || page.page_name || "");
  };

  // Kiểm tra một Page đã được gán thư mục video hợp lệ chưa
  const isPageAssigned = (page) => {
    const folder = getPageFolder(page);
    if (!folder) return false;
    if (availableFolders.length > 0) {
      return availableFolders.some((f) => f.folder_name === folder);
    }
    return Boolean(folder);
  };

  // Kích hoạt tiến trình đăng Reels thật qua Backend API
  const handleStart = async () => {
    const selectedPagesList = [];
    allPages.forEach((p) => {
      const pid = String(p.page_id);
      if (selectedPageIds.has(pid)) {
        selectedPagesList.push(p);
      }
    });

    if (selectedPagesList.length === 0) {
      toast.warning("Vui lòng tick chọn ít nhất 1 Fanpage để đăng Reels!", "CHƯA CHỌN FANPAGE");
      return;
    }
    if (!rootDir.trim()) {
      toast.warning("Vui lòng nhập Thư mục gốc chứa video!", "CHƯA NHẬP THƯ MỤC");
      return;
    }
    if (scheduleEnabled && scheduleTimes.length === 0) {
      toast.warning(
        "Bạn đang bật chế độ Hẹn giờ nhưng chưa thêm khung giờ nào. Vui lòng bấm '+ Thêm giờ' hoặc tắt công tắc Hẹn giờ để đăng ngay!",
        "CHƯA CÓ KHUNG GIỜ HẸN"
      );
      return;
    }

    const validPages = [];
    const unassignedPages = [];

    selectedPagesList.forEach((p) => {
      const folder = getPageFolder(p);
      const isAssigned = isPageAssigned(p);
      if (isAssigned && folder) {
        validPages.push({
          page_id: String(p.page_id),
          page_name: p.page_name,
          account_uid: p.account_uid !== "Chưa gán" ? p.account_uid : null,
          access_token: p.access_token || "",
          folder_name: folder
        });
      } else {
        unassignedPages.push(p);
      }
    });

    if (validPages.length === 0) {
      toast.warning(
        `Toàn bộ ${selectedPagesList.length} Fanpage đã chọn đều chưa được gán thư mục video hợp lệ. Vui lòng gán thư mục trước khi đăng!`,
        "CHƯA GÁN THƯ MỤC"
      );
      return;
    }

    // Nếu có Fanpage chưa gán, hiện hộp thoại xác nhận hỏi người dùng có muốn bỏ qua không
    if (unassignedPages.length > 0) {
      const pageNamesList = unassignedPages.slice(0, 5).map((p) => `• ${p.page_name || p.page_id}`).join("\n");
      const moreCount = unassignedPages.length > 5 ? `\n... và ${unassignedPages.length - 5} Fanpage khác` : "";
      const confirmRun = window.confirm(
        `Phát hiện ${unassignedPages.length} Fanpage chưa được gán thư mục video Reels hợp lệ:\n${pageNamesList}${moreCount}\n\nBạn có muốn BỎ QUA các Fanpage chưa gán này và tiếp tục chạy cho ${validPages.length} Fanpage hợp lệ không?`
      );

      if (!confirmRun) {
        return;
      }

      // Tự động bỏ tích các page chưa gán
      const next = new Set(selectedPageIds);
      unassignedPages.forEach((p) => next.delete(String(p.page_id)));
      setSelectedPageIds(next);
    }

    try {
      const payload = {
        root_dir: rootDir.trim(),
        pages_config: validPages,
        schedule_enabled: scheduleEnabled,
        schedule_times: scheduleTimes,
        sleep_min: Number(sleepMin),
        sleep_max: Number(sleepMax)
      };
      const res = await startReelsJob(payload);
      if (res?.success) {
        setIsRunning(true);
        setRunnerStatus("RUNNING");
        toast.success(`Đã kích hoạt tiến trình đăng Reels cho ${validPages.length} Fanpage!`, "BẮT ĐẦU THÀNH CÔNG");
        setLogs((prev) => [
          ...prev,
          {
            timestamp: new Date().toLocaleTimeString("vi-VN"),
            level: "INFO",
            message: `Bắt đầu phiên đăng Reels cho ${validPages.length} Fanpage đã chọn.`
          }
        ]);
        fetchStatus();
      } else {
        const errMsg = res?.error || res?.detail || "Không thể kích hoạt tiến trình đăng Reels.";
        toast.error(errMsg, "LỖI KÍCH HOẠT");
        setLogs((prev) => [
          ...prev,
          {
            timestamp: new Date().toLocaleTimeString("vi-VN"),
            level: "ERROR",
            message: `Lỗi kích hoạt tiến trình: ${errMsg}`
          }
        ]);
      }
    } catch (err) {
      const errMsg = err?.response?.data?.detail || err?.message || "Không thể kết nối đến máy chủ Local Engine.";
      toast.error(errMsg, "LỖI KẾT NỐI");
      setLogs((prev) => [
        ...prev,
        {
          timestamp: new Date().toLocaleTimeString("vi-VN"),
          level: "ERROR",
          message: `Lỗi kết nối khi bắt đầu: ${errMsg}`
        }
      ]);
    }
  };

  // Dừng luồng qua Backend API
  const handleStop = async () => {
    try {
      const res = await stopReelsJob();
      if (res?.success) {
        toast.info("Đã gửi yêu cầu dừng tiến trình đăng Reels.", "DỪNG LUỒNG");
      }
    } catch (e) {
      console.warn("Lỗi khi dừng luồng:", e);
    }
    setIsRunning(false);
    setRunnerStatus("STOPPED");
    setLogs((prev) => [
      ...prev,
      {
        timestamp: new Date().toLocaleTimeString("vi-VN"),
        level: "WARNING",
        message: "Đã gửi tín hiệu dừng tiến trình đăng theo yêu cầu của người dùng."
      }
    ]);
  };

  // Xóa console log
  const handleClearLogs = async () => {
    try {
      await clearReelsLogs();
    } catch (err) {
      // ignore
    }
    setLogs([]);
  };

  // Lọc tài khoản theo dropdown & trạng thái gán thư mục
  const [selectedAccountUid, setSelectedAccountUid] = useState("ALL");
  const [filterFolderStatus, setFilterFolderStatus] = useState("ALL"); // "ALL" | "ASSIGNED" | "UNASSIGNED"
  const lastClickedIndexRef = useRef(null);
  const isDraggingRef = useRef(false);
  const dragSelectModeRef = useRef(true);

  // Lắng nghe sự kiện thả chuột toàn window để ngắt trạng thái kéo chọn
  useEffect(() => {
    const handleMouseUp = () => {
      isDraggingRef.current = false;
    };
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  // Danh sách phẳng tất cả Fanpage
  const allPages = useMemo(() => {
    const list = [];
    accounts.forEach((acc) => {
      if (selectedAccountUid !== "ALL" && (acc.group_key || acc.account_uid) !== selectedAccountUid) {
        return;
      }
      (acc.pages || []).forEach((p) => {
        list.push({
          ...p,
          account_name: acc.account_name,
          account_uid: acc.account_uid,
          avatar_url: acc.avatar_url,
        });
      });
    });
    return list;
  }, [accounts, selectedAccountUid]);

  // Đếm số lượng Page đã gán và chưa gán
  const assignedPagesCount = useMemo(() => {
    return allPages.filter((p) => isPageAssigned(p)).length;
  }, [allPages, pageFolderOverrides, availableFolders]);

  const unassignedPagesCount = useMemo(() => {
    return allPages.length - assignedPagesCount;
  }, [allPages.length, assignedPagesCount]);

  // Lọc Fanpage theo từ khóa tìm kiếm (tên, ID, tài khoản) và trạng thái gán thư mục
  const filteredPages = useMemo(() => {
    let result = allPages;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((p) => {
        const nameMatch = (p.page_name || "").toLowerCase().includes(q);
        const idMatch = String(p.page_id || "").toLowerCase().includes(q);
        const accMatch = (p.account_name || "").toLowerCase().includes(q);
        return nameMatch || idMatch || accMatch;
      });
    }

    if (filterFolderStatus === "ASSIGNED") {
      result = result.filter((p) => isPageAssigned(p));
    } else if (filterFolderStatus === "UNASSIGNED") {
      result = result.filter((p) => !isPageAssigned(p));
    }

    return result;
  }, [allPages, searchQuery, filterFolderStatus, pageFolderOverrides, availableFolders]);

  // Kiểm tra chọn tất cả
  const isAllPagesSelected = filteredPages.length > 0 && filteredPages.every((p) => selectedPageIds.has(String(p.page_id)));
  const isSomePagesSelected = filteredPages.some((p) => selectedPageIds.has(String(p.page_id)));

  const handleToggleSelectAllPages = () => {
    const next = new Set(selectedPageIds);
    if (isAllPagesSelected) {
      filteredPages.forEach((p) => next.delete(String(p.page_id)));
    } else {
      filteredPages.forEach((p) => next.add(String(p.page_id)));
    }
    setSelectedPageIds(next);
  };

  // Kéo chọn nhiều dòng như văn bản (Mouse Drag & Shift Click)
  const handleRowMouseDown = (index, pageId, event) => {
    if (
      event.target.tagName === "SELECT" ||
      event.target.tagName === "OPTION" ||
      event.target.tagName === "INPUT" ||
      event.target.closest("select") ||
      event.target.closest("input")
    ) {
      return;
    }
    const pid = String(pageId);
    isDraggingRef.current = true;

    if (event.shiftKey && lastClickedIndexRef.current !== null) {
      const start = Math.min(lastClickedIndexRef.current, index);
      const end = Math.max(lastClickedIndexRef.current, index);
      const next = new Set(selectedPageIds);
      for (let i = start; i <= end; i++) {
        if (filteredPages[i]) next.add(String(filteredPages[i].page_id));
      }
      setSelectedPageIds(next);
      dragSelectModeRef.current = true;
    } else {
      lastClickedIndexRef.current = index;
      const willSelect = !selectedPageIds.has(pid);
      dragSelectModeRef.current = willSelect;
      const next = new Set(selectedPageIds);
      if (willSelect) next.add(pid);
      else next.delete(pid);
      setSelectedPageIds(next);
    }
  };

  const handleRowMouseEnter = (pageId) => {
    if (!isDraggingRef.current) return;
    const pid = String(pageId);
    const next = new Set(selectedPageIds);
    if (dragSelectModeRef.current) {
      next.add(pid);
    } else {
      next.delete(pid);
    }
    setSelectedPageIds(next);
  };

  return (
    <div className="w-full flex flex-col gap-4 text-[#1E293B]">
      {/* HÀNG 1: LƯỚI 12 CỘT (Cột 1: 4 cols Cấu hình | Cột 2: 8 cols Bảng tài khoản) */}
      <div className="grid grid-cols-12 gap-4 items-start">
        {/* CỘT 1: CẤU HÌNH ĐĂNG VIDEO REELS (4 COLS) */}
        <div className="col-span-12 lg:col-span-4 bg-white border border-[#E2E8F0]/80 rounded-xl shadow-sm p-4 flex flex-col gap-5">
          {/* Header Card */}
          <div className="flex items-center justify-between pb-3 border-b border-[#F1F5F9]">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[#EFF6FF] flex items-center justify-center text-[#2563EB]">
                <FolderOpen className="w-4 h-4" />
              </div>
              <h2 className="text-[14px] font-bold text-[#1E293B]">Cấu hình đăng Video Reels</h2>
            </div>
            <button
              type="button"
              onClick={handleResetConfig}
              title="Khôi phục toàn bộ cấu hình về mặc định ban đầu"
              className="text-[11px] text-slate-400 hover:text-[#1877F2] hover:bg-slate-50 px-2 py-1 rounded-md transition-colors flex items-center gap-1 font-medium"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Đặt lại</span>
            </button>
          </div>

          {/* Field 2: Thư mục gốc chứa video */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-[#334155] flex items-center gap-1">
              Thư mục gốc chứa video <Info className="w-3.5 h-3.5 text-[#94A3B8]" />
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <input
                  type="text"
                  value={rootDir}
                  onChange={(e) => setRootDir(e.target.value)}
                  onBlur={() => handleScanFolders(rootDir, false)}
                  placeholder="D:\Projects\Work\tool_facebook\sample_video_reels"
                  className="w-full pl-3 pr-9 py-2 text-[12px] text-[#334155] bg-white border border-[#CBD5E1] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#2563EB] truncate"
                />
                <input
                  type="file"
                  ref={folderInputRef}
                  webkitdirectory=""
                  directory=""
                  className="hidden"
                  onChange={handlePickFolderFromDisk}
                />
                <button
                  type="button"
                  onClick={handleOpenFolderPicker}
                  title="Chọn thư mục từ máy tính"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-[#1877F2] hover:bg-blue-50 rounded transition-colors"
                >
                  <FolderOpen className="w-4 h-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleScanFolders(rootDir, true)}
                disabled={isScanningFolders}
                title="Quét lại thư mục này"
                className={`px-3 py-2 rounded-lg text-[12px] font-semibold flex items-center gap-1.5 whitespace-nowrap transition-all ${
                  isScanningFolders
                    ? "bg-blue-50 border border-blue-200 text-[#2563EB] cursor-not-allowed opacity-80"
                    : "bg-[#EFF6FF] border border-[#BFDBFE] text-[#2563EB] hover:bg-blue-100 active:scale-[0.98]"
                }`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isScanningFolders ? "animate-spin text-[#2563EB]" : ""}`} />
                <span>{isScanningFolders ? "Đang quét..." : "Quét"}</span>
              </button>
            </div>
            {isScanningFolders ? (
              <p className="text-[11px] text-[#2563EB] flex items-center gap-1 mt-0.5 animate-pulse font-medium">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Đang quét thư mục và phân tích video...
              </p>
            ) : availableFolders.length > 0 ? (
              <p className="text-[11px] text-[#059669] flex items-center gap-1 mt-0.5">
                <FolderCheck className="w-3.5 h-3.5" /> Đã quét thấy {availableFolders.length} thư mục con ({availableFolders.reduce((acc, f) => acc + (f.video_count || 0), 0)} video Reels)
              </p>
            ) : (
              <p className="text-[11px] text-amber-600 flex items-center gap-1 mt-0.5">
                <FolderX className="w-3.5 h-3.5" /> Chưa tìm thấy thư mục video con nào
              </p>
            )}
          </div>

          {/* Field 3: Hẹn giờ đăng Reels */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <label className="text-[12px] font-medium text-[#334155] flex items-center gap-1">
                Hẹn giờ đăng Reels <Info className="w-3.5 h-3.5 text-[#94A3B8]" />
              </label>
              {/* Toggle switch */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setScheduleEnabled(!scheduleEnabled)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out ${
                    scheduleEnabled ? "bg-[#2563EB]" : "bg-[#CBD5E1]"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ease-in-out mt-0.5 ml-0.5 ${
                      scheduleEnabled ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Khung giờ vàng gợi ý */}
            {scheduleEnabled && (
              <div className="flex flex-col gap-1.5 pt-0.5">
                <div className="text-[11px] text-slate-500 flex items-center justify-between">
                  <span>Khung giờ vàng gợi ý:</span>
                  <span className="text-[10px] text-slate-400">Định dạng 24h</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { label: "08:00", time: "08:00" },
                    { label: "11:30", time: "11:30" },
                    { label: "18:00", time: "18:00" },
                    { label: "20:30", time: "20:30" },
                  ].map((preset) => {
                    const isAdded = scheduleTimes.includes(preset.time);
                    return (
                      <button
                        key={preset.time}
                        type="button"
                        onClick={() => {
                          if (isAdded) {
                            handleRemoveTime(preset.time);
                          } else {
                            handleAddPreset(preset.time);
                          }
                        }}
                        className={`px-2 py-0.5 text-[11px] rounded-md border transition-all flex items-center gap-1 ${
                          isAdded
                            ? "bg-blue-50 border-blue-300 text-[#1877F2] font-semibold shadow-2xs"
                            : "bg-white border-[#E2E8F0] text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                        }`}
                        title={isAdded ? "Nhấn để xóa giờ này" : "Nhấn để thêm vào lịch"}
                      >
                        {isAdded ? <Check className="w-3 h-3 text-[#1877F2]" /> : <span>+</span>}
                        <span>{preset.time}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Time Badges & Input */}
            <div className={`flex flex-wrap items-center gap-2 pt-1 ${!scheduleEnabled ? "opacity-50 pointer-events-none" : ""}`}>
              {scheduleTimes.map((t) => (
                <div
                  key={t}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#F1F5F9] border border-[#E2E8F0] rounded-md text-[12px] font-medium text-[#334155]"
                >
                  <span>{t}</span>
                  <Clock className="w-3 h-3 text-[#94A3B8]" />
                  <button
                    type="button"
                    onClick={() => handleRemoveTime(t)}
                    className="hover:text-red-500 text-[#94A3B8] ml-0.5"
                    title="Xóa giờ này"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}

              {showAddTime ? (
                <div className="inline-flex items-center gap-1 bg-white p-1 border border-blue-300 rounded-md shadow-xs">
                  <input
                    type="time"
                    value={newTimeInput || "09:00"}
                    onChange={(e) => setNewTimeInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddTime()}
                    className="px-1.5 py-0.5 text-[12px] border border-slate-200 rounded bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => handleAddTime()}
                    className="px-2 py-0.5 bg-[#2563EB] hover:bg-blue-700 text-white rounded text-[11px] font-bold transition-colors"
                  >
                    Thêm
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddTime(false)}
                    className="p-1 text-[#94A3B8] hover:text-red-500 rounded"
                    title="Hủy"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (!newTimeInput) setNewTimeInput("09:00");
                    setShowAddTime(true);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#EFF6FF] border border-[#BFDBFE] rounded-md text-[12px] font-medium text-[#2563EB] hover:bg-blue-100 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  Thêm giờ khác
                </button>
              )}
            </div>

            {scheduleEnabled && (
              <p className="text-[11px] text-slate-400 italic">
                *Hệ thống tự động quét và đăng bài khi máy tính chạy đến đúng các khung giờ trên.
              </p>
            )}
          </div>

          {/* Field 4: Giãn cách đăng ngẫu nhiên */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-[#334155] flex items-center gap-1">
              Giãn cách đăng ngẫu nhiên <Info className="w-3.5 h-3.5 text-[#94A3B8]" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-[11px] text-[#94A3B8] block mb-1">Từ (giây)</span>
                <input
                  type="number"
                  min="1"
                  value={sleepMin}
                  onChange={(e) => setSleepMin(e.target.value)}
                  className="w-full px-3 py-2 text-[12px] text-[#334155] bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                />
              </div>
              <div>
                <span className="text-[11px] text-[#94A3B8] block mb-1">Đến (giây)</span>
                <input
                  type="number"
                  min="1"
                  value={sleepMax}
                  onChange={(e) => setSleepMax(e.target.value)}
                  className="w-full px-3 py-2 text-[12px] text-[#334155] bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                />
              </div>
            </div>
          </div>

          {/* Execution Buttons */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              disabled={isRunning}
              onClick={handleStart}
              className={`py-2.5 px-4 rounded-lg font-bold text-[12px] tracking-wider uppercase flex items-center justify-center gap-2 shadow-sm transition-all ${
                isRunning
                  ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                  : "bg-[#2563EB] text-white hover:bg-blue-700 active:scale-[0.98]"
              }`}
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              KÍCH HOẠT
            </button>
            <button
              type="button"
              disabled={!isRunning}
              onClick={handleStop}
              className={`py-2.5 px-4 rounded-lg font-bold text-[12px] tracking-wider uppercase flex items-center justify-center gap-2 shadow-sm transition-all ${
                !isRunning
                  ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                  : "bg-[#F43F5E] text-white hover:bg-rose-600 active:scale-[0.98]"
              }`}
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              DỪNG LUỒNG
            </button>
          </div>
        </div>

        {/* CỘT 2: DANH SÁCH FANPAGE ĐANG QUẢN LÝ (8 COLS) - BẢNG CHUẨN FIGMA 1016:3199 */}
        <div className="col-span-12 lg:col-span-8 bg-white border border-[#E2E8F0]/80 rounded-xl shadow-sm p-4 flex flex-col gap-3.5">
          {/* Card Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#F1F5F9]">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-[#EFF6FF] flex items-center justify-center text-[#1877F2]">
                <FolderOpen className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-[14px] font-bold text-[#1E293B]">
                  Danh sách Fanpage đang quản lý ({filteredPages.length})
                </h2>
                <p className="text-[11px] text-[#94A3B8]">
                  Đã chọn: <span className="font-semibold text-[#1877F2]">{selectedPageIds.size}</span> Fanpage
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={loadAccountsAndPages}
              disabled={loadingData}
              className="px-3 py-1.5 border border-[#BFDBFE] text-[#1877F2] text-[12px] font-medium rounded-lg hover:bg-blue-50 flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingData ? "animate-spin" : ""}`} />
              Đồng bộ
            </button>
          </div>

          {/* Toolbar: 2 distinct rows for search/account and filter/hints */}
          <div className="flex flex-col gap-2.5">
            {/* Hàng 1: Ô tìm kiếm (flex-1) + Lọc tài khoản + Nút Chọn/Bỏ chọn tất cả */}
            <div className="flex items-center gap-2.5">
              {/* Ô tìm kiếm */}
              <div className="relative flex-1 min-w-0">
                <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm tên Fanpage hoặc Page ID..."
                  className="w-full pl-8 pr-3 py-1.5 text-[12px] bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#1877F2]"
                />
              </div>

              {/* Lọc theo tài khoản */}
              {accounts.length > 1 && (
                <select
                  value={selectedAccountUid}
                  onChange={(e) => setSelectedAccountUid(e.target.value)}
                  className="text-[12px] py-1.5 px-2 bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#1877F2] text-[#334155] shrink-0 max-w-[200px] truncate"
                >
                  <option value="ALL">Tất cả tài khoản ({accounts.length})</option>
                  {accounts.map((acc) => (
                    <option key={acc.group_key || acc.account_uid} value={acc.group_key || acc.account_uid}>
                      {acc.account_name} ({acc.pages?.length || 0} Page)
                    </option>
                  ))}
                </select>
              )}

              {/* Nút Chọn / Bỏ chọn tất cả */}
              <button
                type="button"
                onClick={handleToggleSelectAllPages}
                className="px-3 py-1.5 rounded-lg bg-blue-50 text-[#1877F2] hover:bg-blue-100 font-semibold text-[11px] whitespace-nowrap transition-colors shrink-0"
              >
                {isAllPagesSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
              </button>
            </div>

            {/* Hàng 2: Bộ lọc trạng thái gán (Trái) & Hướng dẫn thao tác dải (Phải) */}
            <div className="flex items-center justify-between gap-2 pt-0.5">
              {/* Bộ lọc 3 pills: Tất cả / Đã gán / Chưa gán */}
              <div className="inline-flex items-center bg-[#F1F5F9] rounded-lg p-0.5 text-[11px] font-medium text-slate-600 shrink-0 border border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setFilterFolderStatus("ALL")}
                  className={`px-2.5 py-1 rounded-md transition-all ${
                    filterFolderStatus === "ALL"
                      ? "bg-white text-[#1877F2] font-semibold shadow-xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Tất cả ({allPages.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterFolderStatus("ASSIGNED")}
                  className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1.5 ${
                    filterFolderStatus === "ASSIGNED"
                      ? "bg-white text-emerald-600 font-semibold shadow-xs"
                      : "text-slate-500 hover:text-emerald-700"
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                  <span>Đã gán ({assignedPagesCount})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFilterFolderStatus("UNASSIGNED")}
                  className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1.5 ${
                    filterFolderStatus === "UNASSIGNED"
                      ? "bg-white text-amber-600 font-semibold shadow-xs"
                      : "text-slate-500 hover:text-amber-700"
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                  <span>Chưa gán ({unassignedPagesCount})</span>
                </button>
              </div>

              {/* Dòng hướng dẫn kéo chọn */}
              <span className="text-[11px] text-slate-400 italic">
                *Kéo chuột hoặc giữ Shift để chọn dải
              </span>
            </div>
          </div>

          {/* Table Container - matching Figma node 1016:3199 */}
          <div className="border border-[#E2E8F0] rounded-lg max-h-[500px] overflow-y-auto overflow-x-hidden select-none">
            <table className="w-full table-fixed text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-[#F8FAFC] border-b border-[#E2E8F0] text-[12px] font-semibold text-[#64748B]">
                <tr>
                  <th className="py-2.5 px-2 w-10 text-center">STT</th>
                  <th className="py-2.5 px-2 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={isAllPagesSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = !isAllPagesSelected && isSomePagesSelected;
                      }}
                      onChange={handleToggleSelectAllPages}
                      className="w-4 h-4 rounded text-[#1877F2] border-slate-300 focus:ring-0 cursor-pointer"
                    />
                  </th>
                  <th className="py-2.5 px-3">Tên Fanpage</th>
                  <th className="py-2.5 px-3 w-[190px]">Thư mục video Reels</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9] text-[12px] bg-white">
                {filteredPages.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-[#94A3B8]">
                      {loadingData ? "Đang tải dữ liệu..." : "Không tìm thấy Fanpage nào phù hợp."}
                    </td>
                  </tr>
                ) : (
                  filteredPages.map((page, index) => {
                    const pid = String(page.page_id);
                    const isChecked = selectedPageIds.has(pid);
                    const currentFolder = pageFolderOverrides[pid] || page.reels_folder || page.page_name;
                    const hasFolder = availableFolders.some((f) => f.folder_name === currentFolder);

                    const avatarColors = [
                      "bg-emerald-100 text-emerald-700",
                      "bg-blue-100 text-blue-700",
                      "bg-amber-100 text-amber-700",
                      "bg-purple-100 text-purple-700",
                      "bg-rose-100 text-rose-700",
                      "bg-cyan-100 text-cyan-700",
                    ];
                    const colorClass = avatarColors[index % avatarColors.length];

                    return (
                      <tr
                        key={pid}
                        onMouseDown={(e) => handleRowMouseDown(index, pid, e)}
                        onMouseEnter={() => handleRowMouseEnter(pid)}
                        className={`transition-colors cursor-pointer select-none ${
                          isChecked
                            ? "bg-blue-50/70 hover:bg-blue-50"
                            : "hover:bg-slate-50/80"
                        }`}
                      >
                        <td className="py-2.5 px-2 w-10 text-center text-[#64748B] font-medium">
                          {index + 1}
                        </td>
                        <td className="py-2.5 px-2 w-10 text-center" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleTogglePage(pid)}
                            className="w-4 h-4 rounded text-[#1877F2] border-slate-300 focus:ring-0 cursor-pointer"
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className={`w-8 h-8 rounded-full ${colorClass} font-bold flex items-center justify-center text-xs shrink-0`}>
                              {(page.page_name || "P")[0]?.toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-bold text-[13px] text-[#1E293B] truncate" title={page.page_name}>
                                {page.page_name || `Page ${pid}`}
                              </p>
                              <p
                                className="text-[11px] text-[#94A3B8] truncate"
                                title={`ID: ${pid} ${page.account_name ? `• ${page.account_name}` : ""} ${page.category ? `• ${page.category}` : ""}`}
                              >
                                ID: {pid} {page.account_name ? `• ${page.account_name}` : ""} {page.category ? `• ${page.category}` : ""}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="py-2 px-3 w-[190px]" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                          <div className="relative inline-block w-full">
                            <select
                              value={currentFolder}
                              onChange={(e) => {
                                setPageFolderOverrides({
                                  ...pageFolderOverrides,
                                  [pid]: e.target.value
                                });
                              }}
                              title={hasFolder ? `Thư mục video: ${currentFolder}` : "Chưa gán thư mục video (Bấm để chọn)"}
                              className={`w-full appearance-none text-[11px] font-medium py-1.5 pl-7 pr-6 rounded-md border cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#1877F2] transition-colors truncate ${
                                hasFolder
                                  ? "bg-emerald-50 text-[#059669] border-emerald-300 hover:bg-emerald-100/70"
                                  : "bg-amber-50 text-[#D97706] border-amber-300 hover:bg-amber-100/70"
                              }`}
                            >
                              <option value="" className="text-slate-500 bg-white">
                                {hasFolder ? "-- Bỏ gán --" : "Chưa gán"}
                              </option>
                              {availableFolders.map((f) => (
                                <option key={f.folder_name} value={f.folder_name} className="text-slate-800 bg-white">
                                  {f.folder_name} ({f.video_count || 1} video)
                                </option>
                              ))}
                            </select>

                            {/* Icon thư mục bên trái */}
                            <div className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none">
                              {hasFolder ? (
                                <FolderCheck className="w-3.5 h-3.5 text-[#059669]" />
                              ) : (
                                <FolderX className="w-3.5 h-3.5 text-[#D97706]" />
                              )}
                            </div>

                            {/* Mũi tên ChevronDown bên phải */}
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                              <ChevronDown className="w-3.5 h-3.5" />
                            </div>
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

      {/* HÀNG 2: THEO DÕI TIẾN TRÌNH (FULL-WIDTH MONITOR CARD) */}
      <div className="bg-white border border-[#E2E8F0]/90 rounded-xl shadow-sm p-4 flex flex-col gap-3">
        {/* Header Console */}
        <div className="flex items-center justify-between pb-3 border-b border-[#F1F5F9]">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-[#EFF6FF] flex items-center justify-center text-[#2563EB]">
              <Terminal className="w-3.5 h-3.5" />
            </div>
            <h3 className="text-[14px] font-bold text-[#1E293B]">Theo dõi Tiến trình</h3>

            {/* Trạng thái hoạt động */}
            <span
              className={`ml-2 px-2 py-0.5 text-[10px] font-semibold rounded-full uppercase tracking-wider ${
                isRunning
                  ? "bg-blue-100 text-blue-700 animate-pulse"
                  : runnerStatus === "COMPLETED"
                  ? "bg-emerald-100 text-emerald-700"
                  : runnerStatus === "STOPPED"
                  ? "bg-rose-100 text-rose-700"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {isRunning ? "● Đang chạy" : runnerStatus}
            </span>
          </div>

          {/* Quick stats & Clear button */}
          <div className="flex items-center gap-4 text-[11px]">
            <div className="flex items-center gap-3 text-[#64748B]">
              <span>Đã chọn: <strong className="text-[#1E293B]">{selectedPageIds.size}</strong> Page</span>
              <span>•</span>
              <span className="text-[#059669] flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Thành công: <strong>{stats.success}</strong>
              </span>
              <span>•</span>
              <span className="text-[#E11D48] flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Thất bại: <strong>{stats.failed}</strong>
              </span>
            </div>
            <button
              type="button"
              onClick={handleClearLogs}
              className="text-[#94A3B8] hover:text-[#1E293B] p-1 rounded hover:bg-slate-100 transition-colors"
              title="Xóa log"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Live waiting countdown banner when scheduler is running */}
        {isRunning && scheduleEnabled && nextSlotInfo && (
          <div className="px-3.5 py-2.5 bg-blue-50/90 border border-blue-200 rounded-lg flex items-center justify-between text-[12px] text-blue-900 shadow-2xs">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#2563EB]"></span>
              </span>
              <div>
                <span className="font-semibold text-blue-950">Chế độ hẹn giờ: </span>
                <span className="text-blue-900">
                  Khung giờ đăng tiếp theo là <strong className="font-mono text-[13px] bg-blue-100/80 px-1.5 py-0.5 rounded text-blue-950">{nextSlotInfo.time}</strong>
                  {nextSlotInfo.isTomorrow ? " (ngày mai)" : ""} — còn <strong className="text-blue-950">{formatTimeRemaining(nextSlotInfo.diffMinutes)}</strong> nữa.
                </span>
              </div>
            </div>
            <div className="text-[11px] text-blue-700 font-medium bg-blue-100/70 px-2.5 py-1 rounded-md border border-blue-200/60 shrink-0 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#2563EB]" />
              <span>Đang ở trạng thái chờ tự động...</span>
            </div>
          </div>
        )}

        {/* Console Log Box */}
        <div
          ref={logBoxRef}
          className="h-52 bg-[#0F172A] border border-[#1E293B] rounded-lg p-3 font-mono text-[11px] leading-5 overflow-y-auto text-slate-300 select-text"
        >
          {logs.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500 italic">
              Chưa có thông điệp tiến trình nào. Nhấn KÍCH HOẠT để bắt đầu.
            </div>
          ) : (
            logs.map((log, i) => {
              const isError = log.level === "ERROR" || log.message.includes("[ERROR]") || log.message.includes("thất bại");
              const isSuccess = log.level === "SUCCESS" || log.message.includes("[SUCCESS]") || log.message.includes("thành công");
              const isWarning = log.level === "WARNING" || log.message.includes("[WARNING]");

              return (
                <div key={i} className="flex items-start gap-2 py-0.5">
                  <span className="text-slate-500 shrink-0 font-sans text-[10px]">[{log.timestamp}]</span>
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                      isError
                        ? "bg-rose-500"
                        : isSuccess
                        ? "bg-emerald-400"
                        : isWarning
                        ? "bg-amber-400"
                        : "bg-blue-400"
                    }`}
                  />
                  <span
                    className={`whitespace-pre-wrap break-all ${
                      isError
                        ? "text-rose-400 font-semibold"
                        : isSuccess
                        ? "text-emerald-300 font-semibold"
                        : isWarning
                        ? "text-amber-300"
                        : "text-slate-200"
                    }`}
                  >
                    {renderLogMessage(log.message)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
