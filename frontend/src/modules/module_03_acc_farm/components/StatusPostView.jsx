"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Settings,
  Upload,
  Eye,
  EyeOff,
  Search,
  RotateCw,
  Copy,
  Check,
  Play,
  Pause,
  Square,
  Activity,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  Info,
  RefreshCw,
  Plus,
  Loader2,
  Database,
  BookOpen,
  RotateCcw,
  Sparkles,
  Save,
  Smile,
  Bold,
  Code,
  Trash2,
  CheckCheck,
  ShieldCheck,
  FileText,
  X,
} from "lucide-react";
import { api } from "@/services/api";
import { openFilePicker } from "@/lib/file-bridge";
import { toast } from "@/lib/toast";
import { PostImageModal, normalizeImagePaths } from "./PostImageModal";
import { FacebookEmojiMenu } from "./FacebookEmojiModal";
import CustomSelect from "@/components/ui/custom-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import Image from "next/image";
import { EmergencyStopModal } from "./EmergencyStopModal";
import { PastScheduleModal } from "./PastScheduleModal";
import { PostProgressPreview } from "./PostProgressPreview";
import { useUnsavedChanges } from "@/components/UnsavedChangesContext";

const STATUS_LEAVE_MESSAGE =
  "Bạn đang có Prompt AI hoặc bài viết trên màn Đăng Status. Nếu rời đi, bài đã lưu sẽ chuyển về chưa lưu và cần Lưu lại lần sau.";

const DEFAULT_GEMINI_MODELS = [
  { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash (Khuyên dùng - Nhanh & Mới nhất)" },
  { value: "gemini-3.7-flash", label: "Gemini 3.7 Flash (Tốc độ cao & Thông minh)" },
  { value: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
  { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (Siêu nhanh)" },
  { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview (Sáng tạo & Chi tiết)" },
  { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
  { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
  { value: "gemini-4-argon", label: "Gemini 4 Argon (Suy luận cao cấp)" },
  { value: "gemini-flash-latest", label: "Gemini Flash Latest" },
  { value: "gemini-pro-latest", label: "Gemini Pro Latest" },
];

const avatarColors = ["#1877F2", "#0084FF", "#087A62", "#4F46E5", "#0284C7"];

function AccountAvatar({ url, initial, color }) {
  const [failedUrl, setFailedUrl] = useState(null);
  return (
    <span
      className="w-7 h-7 rounded-full overflow-hidden flex items-center justify-center shrink-0 font-bold text-[11px] text-white shadow-2xs"
      style={{ backgroundColor: color }}
    >
      {url && failedUrl !== url ? (
        <img
          key={url}
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        initial
      )}
    </span>
  );
}

const accountFilterOptions = [
  { value: "all", label: "Tất cả trạng thái TK" },
  { value: "live", label: "Live" },
  { value: "die", label: "Die" },
];

const loginFilterOptions = [
  { value: "all", label: "Tất cả đăng nhập" },
  { value: "logged_in", label: "Đã đăng nhập" },
  { value: "not_logged_in", label: "Chưa đăng nhập" },
  { value: "failed", label: "Đăng nhập lỗi" },
];

export function StatusPostView({ initialState = "config", onHasPostsChange }) {
  const router = useRouter();
  const [viewState, setViewState] = useState(initialState);
  const [viewingImageCard, setViewingImageCard] = useState(null);
  const [emojiPickerCard, setEmojiPickerCard] = useState(null);
  const textareaRefs = useRef({});

  // ── Step 1: API Configuration State ──
  const [keyFileName, setKeyFileName] = useState("");
  const [apiKeyContent, setApiKeyContent] = useState("");
  /** true = đã chọn file (hiện chip + nút X); false = nhập đường dẫn/text tay */
  const [keyFromFile, setKeyFromFile] = useState(false);
  const [pixabayKey, setPixabayKey] = useState("");
  const [showPixabayKey, setShowPixabayKey] = useState(false);
  const [selectedModel, setSelectedModel] = useState("gemini-3.8-flash");
  const [modelOptions, setModelOptions] = useState(DEFAULT_GEMINI_MODELS);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [prompt, setPrompt] = useState("");

  const fileInputRef = useRef(null);
  const previewSectionRef = useRef(null);

  const fetchGeminiModels = async (sourceOverride) => {
    try {
      setIsLoadingModels(true);
      const res = await api.post("/api/post/gemini-models", {
        api_key_source: sourceOverride || apiKeyContent || keyFileName || "keys.txt",
      });
      const data = res?.data ?? res;
      const list = Array.isArray(data) ? data : (data?.models || []);
      if (Array.isArray(list) && list.length > 0) {
        const formatted = list.map((m) => {
          const id = m.id || m.value;
          let label = m.name || m.label || id;
          if (id === "gemini-3.8-flash" && !label.includes("Khuyên dùng")) {
            label = `${label} (Khuyên dùng - Nhanh & Mới nhất)`;
          }
          return { value: id, label };
        });
        setModelOptions(formatted);
      }
    } catch (e) {
      console.warn("Không thể tải model động từ Google API, giữ danh sách chuẩn:", e);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleSelectKeyFile = () => {
    // Kích hoạt duy nhất 1 cửa sổ chọn file chuẩn của hệ điều hành
    fileInputRef.current?.click();
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result;
        if (text) {
          setKeyFileName(file.name || "keys.txt");
          setApiKeyContent(text.trim());
          setKeyFromFile(true);
          fetchGeminiModels(text.trim());
        }
      };
      reader.readAsText(file);
    }
    // Cho phép chọn lại cùng file
    e.target.value = "";
  };

  const handleClearKeyFile = () => {
    setKeyFileName("");
    setApiKeyContent("");
    setKeyFromFile(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Step 2: Account List State (Real DB from Module 02 /api/accounts) ──
  const [searchAccount, setSearchAccount] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const [loginFilter, setLoginFilter] = useState("all");
  const [copiedUid, setCopiedUid] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);

  // ── Drafts State ──
  const [drafts, setDrafts] = useState([]);
  const [isGeneratingDrafts, setIsGeneratingDrafts] = useState(false);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [generatingCardUid, setGeneratingCardUid] = useState(null);
  const [activeDraftPage, setActiveDraftPage] = useState(1);

  // ── Step 3: Trigger & Timing Settings ──
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
  const [isStopped, setIsStopped] = useState(false);
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);

  /** Gộp danh sách tiến trình theo bài — không để response ngắn (theo số luồng) cắt mất bài đã có. */
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
  const [showPastScheduleModal, setShowPastScheduleModal] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [showConfigErrors, setShowConfigErrors] = useState(false);

  const pollingRef = useRef(null);
  const settingsBaselineRef = useRef(null);

  const snapshotSettings = ({
    keyFileName: k,
    selectedModel: m,
    prompt: p,
    pixabayKey: pk,
    scheduleEnabled: se,
    scheduleTime: st,
    minDelay: mind,
    maxDelay: maxd,
    threadCount: tc,
  }) =>
    JSON.stringify({
      keyFileName: k || "",
      selectedModel: m || "",
      prompt: p || "",
      pixabayKey: pk || "",
      scheduleEnabled: !!se,
      scheduleTime: st || "",
      minDelay: Number(mind) || 0,
      maxDelay: Number(maxd) || 0,
      threadCount: Number(tc) || 0,
    });

  // Có bài viết (nội dung/ảnh) — kể cả đã lưu
  const hasDisplayedPosts = useMemo(
    () =>
      drafts.some(
        (d) =>
          ((d.content || "").trim().length > 0) ||
          (d.imageCount || 0) > 0 ||
          (d.imagePaths || []).length > 0,
      ),
    [drafts],
  );

  // Có nhập Khung Prompt AI
  const hasPromptContent = Boolean(String(prompt || "").trim());

  // Modal khi: có Prompt AI HOẶC có ≥ 1 bài viết đang hiển thị
  const needsLeaveConfirm = hasDisplayedPosts || hasPromptContent;

  useEffect(() => {
    onHasPostsChange?.(needsLeaveConfirm);
    return () => onHasPostsChange?.(false);
  }, [needsLeaveConfirm, onHasPostsChange]);

  const { setUnsavedChanges } = useUnsavedChanges();

  // Option A: bấm "Rời đi" → bỏ trạng thái Đã lưu, lần sau phải Lưu lại
  useEffect(() => {
    if (!needsLeaveConfirm) {
      setUnsavedChanges(false);
      return;
    }
    setUnsavedChanges(
      true,
      async () => {
        const savedDrafts = drafts.filter(
          (d) =>
            d.isSaved &&
            (((d.content || "").trim().length > 0) ||
              (d.imageCount || 0) > 0 ||
              (d.imagePaths || []).length > 0),
        );

        if (savedDrafts.length > 0) {
          setDrafts((prev) =>
            prev.map((d) => (d.isSaved ? { ...d, isSaved: false } : d)),
          );
        }

        await Promise.all(
          savedDrafts.map(async (d) => {
            try {
              const imgs = normalizeImagePaths(d);
              await api.post("/api/post/drafts", {
                id: d.id,
                account_uid: String(d.accountUid),
                account_name: d.authorName || "",
                post_type: "status",
                content: d.content || "",
                image_path: imgs[0] || null,
                image_paths: imgs,
                status: "DRAFT",
              });
            } catch (err) {
              console.warn("Không thể chuyển draft về DRAFT khi rời trang:", err);
            }
          }),
        );
      },
      STATUS_LEAVE_MESSAGE,
    );
  }, [needsLeaveConfirm, drafts, setUnsavedChanges]);

  useEffect(() => () => setUnsavedChanges(false), [setUnsavedChanges]);

  // Load Settings from /api/post/settings
  const loadSettingsFromDb = async () => {
    try {
      const res = await api.get("/api/post/settings?post_type=status");
      const s = res?.data ?? res;
      if (s && typeof s === "object") {
        const nextKey = s.api_key_file_path || "";
        const nextModel = s.gemini_model
          ? String(s.gemini_model).trim().toLowerCase().replace(/\s+/g, "-")
          : selectedModel;
        const nextScheduleEnabled =
          s.schedule_enabled !== undefined ? s.schedule_enabled : scheduleEnabled;
        const nextScheduleTime = s.schedule_time
          ? s.schedule_time.slice(0, 5)
          : scheduleTime;
        const nextMin = s.min_delay || minDelay;
        const nextMax = s.max_delay || maxDelay;
        const nextThreads = s.thread_count || threadCount;

        if (s.api_key_file_path) {
          setKeyFileName(s.api_key_file_path);
          // Đường dẫn đã lưu từ lần chọn file trước → hiện dạng file chip
          setKeyFromFile(true);
        }
        if (s.gemini_model) setSelectedModel(nextModel);
        // Mỗi lần vào/quay lại trang: luôn xóa prompt cũ, hiện placeholder
        setPrompt("");
        const nextPixabay =
          s.pixabay_api_key != null
            ? String(s.pixabay_api_key)
            : s.pixabay_key != null
              ? String(s.pixabay_key)
              : "";
        if (nextPixabay) setPixabayKey(nextPixabay);
        if (s.schedule_enabled !== undefined) setScheduleEnabled(s.schedule_enabled);
        if (s.schedule_time) setScheduleTime(s.schedule_time.slice(0, 5));
        if (s.min_delay) setMinDelay(s.min_delay);
        if (s.max_delay) setMaxDelay(s.max_delay);
        if (s.thread_count) setThreadCount(s.thread_count);

        settingsBaselineRef.current = snapshotSettings({
          keyFileName: nextKey || keyFileName,
          selectedModel: nextModel,
          prompt: "",
          pixabayKey: nextPixabay || pixabayKey,
          scheduleEnabled: nextScheduleEnabled,
          scheduleTime: nextScheduleTime,
          minDelay: nextMin,
          maxDelay: nextMax,
          threadCount: nextThreads,
        });
      } else {
        settingsBaselineRef.current = snapshotSettings({
          keyFileName,
          selectedModel,
          prompt,
          pixabayKey,
          scheduleEnabled,
          scheduleTime,
          minDelay,
          maxDelay,
          threadCount,
        });
      }
    } catch (err) {
      console.error("Lỗi khi tải cấu hình status:", err);
      settingsBaselineRef.current = snapshotSettings({
        keyFileName,
        selectedModel,
        prompt,
        pixabayKey,
        scheduleEnabled,
        scheduleTime,
        minDelay,
        maxDelay,
        threadCount,
      });
    }
  };

  const handleSaveSettingsToDb = async () => {
    try {
      await api.post("/api/post/settings", {
        post_type: "status",
        api_key_file_path: keyFileName,
        gemini_model: selectedModel,
        prompt_template: prompt,
        pixabay_api_key: pixabayKey || "",
        schedule_enabled: scheduleEnabled,
        schedule_time: scheduleTime,
        min_delay: minDelay,
        max_delay: maxDelay,
        thread_count: threadCount,
      });
      settingsBaselineRef.current = snapshotSettings({
        keyFileName,
        selectedModel,
        prompt,
        pixabayKey,
        scheduleEnabled,
        scheduleTime,
        minDelay,
        maxDelay,
        threadCount,
      });
    } catch (err) {
      console.error("Lỗi khi lưu cấu hình status:", err);
    }
  };

  const loadDraftsFromDb = async () => {
    try {
      const res = await api.get("/api/post/drafts?post_type=status");
      const data = Array.isArray(res) ? res : (res?.data || []);
      if (Array.isArray(data)) {
        setDrafts(
          data.map((d) => {
            const imgs = normalizeImagePaths(d);
            return {
              id: d.id,
              authorName: d.account_name || (d.account_uid ? `Tài khoản ${d.account_uid}` : "Tài khoản"),
              content: d.content || "",
              charCount: (d.content || "").length,
              imagePaths: imgs,
              imageCount: imgs.length,
              imagePath: imgs[0] || null,
              accountUid: String(d.account_uid),
              selected: true,
              mediaType: "status",
              isSaved: d.status === "READY",
            };
          })
        );
      }
    } catch (err) {
      console.error("Lỗi khi tải bài nháp từ DB:", err);
    }
  };

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
          avatarUrl: a.avatar_url || a.avatar || null,
          name: a.profile_name || a.name || `Nick ${uidStr}`,
          initials: (a.profile_name || a.name || uidStr || "FB").slice(0, 2).toUpperCase(),
          proxy: a.proxy || "",
          proxyStatus: a.proxy ? "Live" : "Chưa kiểm tra",
          connectionStatus: connectionStatusLabel,
          connectionStatusCode: rawLoginStatus,
          accountStatus: accountStatusLabel,
          accountStatusCode: rawStatus,
          selected: false,
        };
      });
      // Bỏ chọn sẵn các nick không đủ Live + Đã đăng nhập
      setAccounts(
        formatted.map((a) => ({
          ...a,
          selected:
            a.selected &&
            a.accountStatusCode === "live" &&
            a.connectionStatusCode === "logged_in",
        }))
      );
      await checkActiveSessionOnMount(formatted);
    } catch (err) {
      console.error("Lỗi khi tải tài khoản:", err);
    } finally {
      setIsLoadingAccounts(false);
    }
  };

  const [isCheckingStatus, setIsCheckingStatus] = useState(false);

  const checkActiveSessionOnMount = async (currentAccounts = []) => {
    try {
      const res = await api.get("/api/post/status");
      const d = res?.data ?? res;
      if (d && (d.is_running || d.is_paused || (d.session_id && !d.session_finished))) {
        if (!d.post_type || d.post_type === "status") {
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
                content: t.content || "",
                imagePaths: Array.isArray(t.imagePaths) ? t.imagePaths : [],
                mediaPath: t.mediaPath || "",
                mediaName: t.mediaName || "",
                postType: t.postType || "status",
                checkpoint: t.checkpoint || "",
              }))
            );
          } // mount: lấy full list từ API (đã theo bài, không theo luồng)
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

  const startStatusPolling = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const res = await api.get("/api/post/status");
        const d = res?.data ?? res;
        if (d) {
          if (d.metrics) setMetrics(d.metrics);
          if (Array.isArray(d.threads) && d.threads.length > 0) {
            setThreadRows((prev) => mergeProgressRows(prev, d.threads));
          }
          if (Array.isArray(d.recent_logs) && d.recent_logs.length > 0) setLogs(d.recent_logs);
          if (d.is_paused !== undefined) setIsPaused(d.is_paused);
          if (d.session_finished) {
            setIsStopped(false);
            // Giữ đủ dòng bài từ API; chỉ đổi nhãn đang chạy → hoàn thành nếu còn sót
            setThreadRows((prev) => {
              const base =
                Array.isArray(d.threads) && d.threads.length > 0
                  ? mergeProgressRows(prev, d.threads)
                  : prev;
              return base.map((row) =>
                row.status === "Đang chạy" || row.status === "Chờ thực thi" || row.status === "Đang chờ"
                  ? { ...row, status: "Hoàn thành", currentActivity: row.currentActivity || "Đăng status hoàn tất." }
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
      } catch {
        // quiet error
      }
    }, 1500);
  };

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  useEffect(() => {
    loadAccountsFromDb();
    loadSettingsFromDb();
    loadDraftsFromDb();
    fetchGeminiModels();
  }, []);

  useEffect(() => {
    if (selectedModel && !modelOptions.some((opt) => opt.value === selectedModel)) {
      setModelOptions((prev) => [
        { value: selectedModel, label: selectedModel },
        ...prev,
      ]);
    }
  }, [selectedModel, modelOptions]);

  const handleCopyUid = (uid) => {
    navigator.clipboard?.writeText(uid);
    setCopiedUid(uid);
    setTimeout(() => setCopiedUid(null), 1500);
  };

  // Chỉ tài khoản có trạng thái Live VÀ Đã đăng nhập mới hợp lệ để chọn đăng status
  const isAccountEligible = (acc) =>
    acc.accountStatusCode === "live" && acc.connectionStatusCode === "logged_in";

  const isDraggingRef = useRef(false);
  const dragModeRef = useRef(true);
  const dragVisitedIdsRef = useRef(new Set());
  const lastClickedIndexRef = useRef(null);

  // Lắng nghe chuột nhả toàn cục để dừng thao tác kéo chọn
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      isDraggingRef.current = false;
      dragVisitedIdsRef.current.clear();
    };
    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
  }, []);

  const filteredAccounts = useMemo(() => {
    return accounts
      // Bug 1: danh sách chọn chỉ hiện Live + Đã đăng nhập (khi đang chạy: hiện các nick đã chọn)
      .filter((a) => (viewState === "running" ? a.selected : isAccountEligible(a)))
      .filter((a) => {
        if (accountFilter !== "all" && a.accountStatusCode !== accountFilter) return false;
        if (loginFilter !== "all") {
          if (loginFilter === "logged_in" && a.connectionStatusCode !== "logged_in") return false;
          if (loginFilter === "failed" && a.connectionStatusCode !== "failed" && a.connectionStatusCode !== "error") return false;
          if (loginFilter === "not_logged_in" && (a.connectionStatusCode === "logged_in" || a.connectionStatusCode === "failed")) return false;
        }
        if (!searchAccount) return true;
        const q = searchAccount.toLowerCase();
        return (
          (a.name && a.name.toLowerCase().includes(q)) ||
          (a.uid && a.uid.includes(q)) ||
          (a.proxy && a.proxy.toLowerCase().includes(q))
        );
      });
  }, [accounts, viewState, searchAccount, accountFilter, loginFilter]);

  const visibleEligibleAccounts = useMemo(
    () => filteredAccounts.filter(isAccountEligible),
    [filteredAccounts]
  );

  const totalEligibleCount = useMemo(
    () => accounts.filter(isAccountEligible).length,
    [accounts]
  );

  const allEligibleSelected =
    visibleEligibleAccounts.length > 0 &&
    visibleEligibleAccounts.every((a) => a.selected);

  const toggleSelectAll = (val) => {
    const nextCheck = typeof val === "boolean" ? val : !allEligibleSelected;
    const eligibleIdSet = new Set(visibleEligibleAccounts.map((a) => a.id));
    setAccounts((prev) =>
      prev.map((a) => {
        if (eligibleIdSet.has(a.id)) {
          return { ...a, selected: nextCheck };
        }
        return isAccountEligible(a) ? a : { ...a, selected: false };
      })
    );
  };
  // Kéo chọn nhiều hoặc click 1 dòng để chọn
  const handleRowMouseDown = (acc, index, e) => {
    if (viewState !== "config") return;
    if (e.button !== 0) return; // Chỉ chuột trái
    if (e.target.closest("button") || e.target.closest("a") || e.target.closest("input")) return;
    if (!isAccountEligible(acc)) return;

    // Shift + Click chọn cả dải liên tiếp
    if (e.shiftKey && lastClickedIndexRef.current !== null) {
      e.preventDefault();
      const start = Math.min(lastClickedIndexRef.current, index);
      const end = Math.max(lastClickedIndexRef.current, index);
      const inRangeEligibleIds = new Set(
        filteredAccounts.slice(start, end + 1).filter(isAccountEligible).map((a) => a.id)
      );
      setAccounts((prev) =>
        prev.map((a) => (inRangeEligibleIds.has(a.id) ? { ...a, selected: true } : a))
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
    if (!isAccountEligible(acc)) return;
    if (dragVisitedIdsRef.current.has(acc.id)) return;

    dragVisitedIdsRef.current.add(acc.id);
    setAccounts((prev) =>
      prev.map((a) => (a.id === acc.id ? { ...a, selected: dragModeRef.current } : a))
    );
  };

  const hasApiKeySource = Boolean(
    String(keyFileName || "").trim() || String(apiKeyContent || "").trim(),
  );
  const hasModel = Boolean(String(selectedModel || "").trim());
  const hasPrompt = Boolean(String(prompt || "").trim());
  const hasRequiredConfig = hasApiKeySource && hasModel && hasPrompt;

  const validateRequiredConfig = () => {
    setShowConfigErrors(true);
    if (!hasApiKeySource) {
      toast.warning(
        "Vui lòng chọn hoặc nhập File Gemini API Keys trước khi thực thi!",
        "THIẾU FILE API KEY",
      );
      return false;
    }
    if (!hasModel) {
      toast.warning("Vui lòng chọn Model Gemini trước khi thực thi!", "THIẾU MODEL");
      return false;
    }
    if (!hasPrompt) {
      toast.warning("Vui lòng nhập Khung Prompt AI trước khi thực thi!", "CHƯA CÓ PROMPT");
      return false;
    }
    return true;
  };

  // Sinh bài viết AI — trả về true nếu đã gọi API sinh bài
  const handleGenerateDrafts = async () => {
    if (!validateRequiredConfig()) {
      document.getElementById("status-step1-config")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      return false;
    }
    const selectedAccs = accounts.filter((a) => a.selected);
    if (selectedAccs.length === 0) {
      toast.warning("Vui lòng tick chọn ít nhất một tài khoản ở Bước 2 để tạo bài viết!", "CHƯA CHỌN TÀI KHOẢN");
      return false;
    }

    try {
      setIsGeneratingDrafts(true);
      const res = await api.post("/api/post/drafts/generate", {
        post_type: "status",
        prompt: prompt,
        model: selectedModel,
        accounts: selectedAccs.map((a) => ({ uid: String(a.uid), name: a.name })),
        api_key_source: apiKeyContent || keyFileName,
        pixabay_key: pixabayKey || undefined,
      });

      const rawDrafts = res?.data ?? res;
      const newDrafts = Array.isArray(rawDrafts) ? rawDrafts : (rawDrafts?.data || []);
      if (Array.isArray(newDrafts) && newDrafts.length > 0) {
        const formattedNew = newDrafts.map((d) => {
          const imgs = normalizeImagePaths(d);
          return {
            id: d.id,
            authorName: d.account_name || `Tài khoản ${d.account_uid}`,
            accountUid: String(d.account_uid),
            content: d.content || "",
            charCount: (d.content || "").length,
            imagePaths: imgs,
            imageCount: imgs.length,
            imagePath: imgs[0] || null,
            selected: true,
            mediaType: "status",
            isSaved: false, // Mặc định bài AI mới sinh ở trạng thái Chưa lưu
          };
        });
        setDrafts((prev) => {
          const newUids = new Set(formattedNew.map((d) => d.accountUid));
          return [...prev.filter((d) => !newUids.has(d.accountUid)), ...formattedNew];
        });
        setActiveDraftPage(1);
        toast.success(`Đã thực thi tạo thành công ${newDrafts.length} bài viết AI! Vui lòng xem trước và nhấn Lưu bài viết.`, "TẠO BÀI THÀNH CÔNG");
      } else {
        toast.error("Không tạo được bài viết. Vui lòng kiểm tra lại API Key hoặc cấu hình.", "LỖI TẠO BÀI");
      }
    } catch (err) {
      console.error("Lỗi sinh bài viết:", err);
      toast.error("Lỗi khi gọi AI sinh bài: " + (err.message || "Kiểm tra lại kết nối hoặc API Key."), "LỖI AI");
      return false;
    } finally {
      setIsGeneratingDrafts(false);
    }
    return true;
  };

  // Nút THỰC THI ở Bước 2: gọi AI sinh bài và cuộn tới Khu vực xem trước
  const handleExecuteGenerate = async () => {
    const selected = accounts.filter((a) => a.selected);
    if (selected.length === 0) {
      toast.warning("Vui lòng tick chọn ít nhất một tài khoản ở Bước 2 trước khi thực thi!", "CHƯA CHỌN TÀI KHOẢN");
      return;
    }
    const ok = await handleGenerateDrafts();
    if (!ok) return;
    setTimeout(() => {
      previewSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 400);
  };

  const handleGenerateForSingleAccount = async (acc) => {
    if (!validateRequiredConfig()) return;
    try {
      setGeneratingCardUid(acc.uid);
      const res = await api.post("/api/post/drafts/generate", {
        post_type: "status",
        prompt: prompt,
        model: selectedModel,
        accounts: [{ uid: String(acc.uid), name: acc.name }],
        api_key_source: apiKeyContent || keyFileName,
        pixabay_key: pixabayKey || undefined,
      });

      const raw = res?.data ?? res;
      const list = Array.isArray(raw) ? raw : (raw?.data || []);
      if (Array.isArray(list) && list.length > 0) {
        const d = list[0];
        const imgs = normalizeImagePaths(d);
        setDrafts((prev) => {
          const filtered = prev.filter((item) => String(item.accountUid) !== String(acc.uid));
          return [
            ...filtered,
            {
              id: d.id,
              authorName: acc.name,
              accountUid: String(acc.uid),
              content: d.content || "",
              charCount: (d.content || "").length,
              imagePaths: imgs,
              imageCount: imgs.length,
              imagePath: imgs[0] || null,
              selected: true,
              mediaType: "status",
              isSaved: false, // Khi tạo lại, chuyển về Chưa lưu
            },
          ];
        });
      }
    } catch (err) {
      toast.error("Lỗi khi tạo bài: " + (err.message || err), "LỖI TẠO BÀI");
    } finally {
      setGeneratingCardUid(null);
    }
  };

  const handleUpdateDraftContent = (accountUid, draftId, newContent) => {
    const uidStr = String(accountUid);
    setDrafts((prev) => {
      const idx = prev.findIndex((d) => String(d.accountUid) === uidStr || (draftId && String(d.id) === String(draftId)));
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          accountUid: uidStr,
          content: newContent,
          charCount: newContent.length,
          isSaved: false, // Khi sửa nội dung, tự động đánh dấu Chưa lưu
        };
        return updated;
      }
      return [
        ...prev,
        {
          id: draftId || `local-${Date.now()}`,
          authorName: `Tài khoản ${uidStr}`,
          accountUid: uidStr,
          content: newContent,
          charCount: newContent.length,
          imageCount: 0,
          selected: true,
          imagePaths: [],
          imagePath: null,
          mediaType: "status",
          isSaved: false,
        },
      ];
    });
  };

  // Chèn emoji chuẩn Facebook tại vị trí con trỏ (caret position)
  const handleInsertEmoji = (emoji) => {
    if (!emojiPickerCard) return;
    const { uid, draftId } = emojiPickerCard;
    const uidStr = uid ? String(uid) : null;
    const key = `${uidStr}-${draftId}`;
    const textareaEl = textareaRefs.current[key];

    setDrafts((prev) => {
      const idx = prev.findIndex(
        (d) => d.id === draftId || (uidStr && String(d.accountUid) === uidStr)
      );
      if (idx >= 0) {
        const currentContent = prev[idx].content || "";
        let newContent = "";
        let insertPos = currentContent.length;

        if (textareaEl) {
          const start = textareaEl.selectionStart ?? currentContent.length;
          const end = textareaEl.selectionEnd ?? currentContent.length;
          newContent = currentContent.slice(0, start) + emoji + currentContent.slice(end);
          insertPos = start + emoji.length;
        } else {
          newContent = currentContent ? `${currentContent} ${emoji}` : emoji;
          insertPos = newContent.length;
        }

        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          content: newContent,
          charCount: newContent.length,
          isSaved: false,
        };

        setTimeout(() => {
          if (textareaEl) {
            textareaEl.focus();
            try {
              textareaEl.setSelectionRange(insertPos, insertPos);
            } catch (e) {
              // ignore
            }
          }
        }, 10);

        return updated;
      }
      return prev;
    });
  };

  const handleAddNewManualDraft = () => {
    const newDraft = {
      id: `manual-${Date.now()}`,
      authorName: `Bài nháp tự soạn #${drafts.length + 1}`,
      content: "",
      charCount: 0,
      imageCount: 0,
      selected: true,
      imagePaths: [],
      imagePath: null,
      mediaType: "status",
      isSaved: false,
    };
    setDrafts((prev) => [newDraft, ...prev]);
  };

  // Xóa bài viết xem trước: Xóa khỏi drafts và bỏ tick chọn tài khoản ở Bước 2
  const handleDeleteDraftItem = async (draftId, accountUid) => {
    const uidStr = accountUid ? String(accountUid) : null;
    if (draftId) {
      try {
        await api.delete(`/api/post/drafts?id=${encodeURIComponent(draftId)}`);
      } catch { }
    } else if (uidStr) {
      try {
        await api.delete(`/api/post/drafts?account_uid=${encodeURIComponent(uidStr)}`);
      } catch { }
    }
    setDrafts((prev) =>
      prev.filter(
        (d) => (draftId ? String(d.id) !== String(draftId) : true) && (uidStr ? String(d.accountUid) !== uidStr : true)
      )
    );
    // Bỏ chọn tài khoản tương ứng ở bảng Bước 2
    if (uidStr) {
      setAccounts((prev) =>
        prev.map((a) => (String(a.uid || a.id) === uidStr ? { ...a, selected: false } : a))
      );
    }
  };

  // Lưu 1 bài viết
  const handleSaveDraftItem = async (accountUid, draftId, content, showAlert = true) => {
    const uidStr = String(accountUid);
    const currentDraft = drafts.find(
      (d) => String(d.accountUid) === uidStr || (draftId && String(d.id) === String(draftId))
    );
    // Đã lưu rồi thì bỏ qua — tránh spam toast / gọi API lại
    if (currentDraft?.isSaved) return;
    if (!(content || "").trim()) {
      if (showAlert) toast.warning("Vui lòng nhập nội dung bài đăng trước khi lưu!", "THIẾU NỘI DUNG");
      return;
    }

    try {
      const targetAcc = accounts.find((a) => String(a.uid) === uidStr);
      const accName = targetAcc?.name || (uidStr ? `UID: ${uidStr}` : "Tài khoản");
      const imgs = normalizeImagePaths(currentDraft);
      const res = await api.post("/api/post/drafts", {
        id: draftId,
        account_uid: uidStr,
        account_name: accName,
        post_type: "status",
        content: content || "",
        image_path: imgs[0] || null,
        image_paths: imgs,
        status: "READY",
      });
      const savedObj = res?.data?.id ? res.data : (res?.id ? res : (res?.data || {}));
      const finalId = savedObj.id || draftId || `draft-${Date.now()}`;
      setDrafts((prev) => {
        const filtered = prev.filter(
          (d) => String(d.accountUid) !== uidStr && (!draftId || String(d.id) !== String(draftId))
        );
        return [
          ...filtered,
          {
            id: finalId,
            authorName: accName,
            accountUid: uidStr,
            content: content || "",
            charCount: (content || "").length,
            imagePaths: imgs,
            imageCount: imgs.length,
            imagePath: imgs[0] || null,
            selected: true,
            mediaType: "status",
            isSaved: true,
          },
        ];
      });
      if (showAlert) toast.success("Đã lưu bài viết thành công!", "LƯU BÀI VIẾT");
    } catch (err) {
      console.error("Lỗi khi lưu bài nháp:", err);
      if (showAlert) toast.error("Lỗi khi lưu bài viết: " + (err.message || "Vui lòng thử lại!"), "LỖI LƯU BÀI");
    }
  };

  // Lưu tất cả bài viết trong khu vực xem trước
  const handleSaveAllDrafts = async () => {
    const targetCards = previewCards.filter((c) => c.hasContent);
    if (targetCards.length === 0) {
      toast.warning("Chưa có bài viết nào để lưu. Vui lòng nhấn nút '▷ THỰC THI' trước!", "CHƯA CÓ BÀI VIẾT");
      return;
    }
    const unsaved = targetCards.filter((c) => !c.isSaved);
    if (unsaved.length === 0) {
      toast.info("Tất cả bài viết trong Khu vực xem trước đều đã được lưu!", "THÔNG BÁO");
      return;
    }
    try {
      setIsSavingAll(true);
      for (const card of unsaved) {
        await handleSaveDraftItem(card.account.uid, card.draftId, card.content, false);
      }
      toast.success(`Đã lưu thành công toàn bộ ${unsaved.length} bài viết! Nút 'ĐĂNG BÀI' đã sẵn sàng.`, "LƯU TẤT CẢ THÀNH CÔNG");
    } catch (err) {
      toast.error("Lỗi khi lưu toàn bộ bài viết: " + (err.message || err), "LỖI LƯU BÀI");
    } finally {
      setIsSavingAll(false);
    }
  };

  const targetExecutionAccounts = useMemo(() => {
    return accounts.filter((a) => a.selected);
  }, [accounts]);

  const previewCards = useMemo(() => {
    return targetExecutionAccounts.map((acc) => {
      const accUidStr = String(acc.uid || acc.id);
      const draft = drafts.find((d) => String(d.accountUid) === accUidStr);
      const contentStr = draft?.content || "";
      const currentImg = draft?.imagePath || null;
      const imgs = normalizeImagePaths(draft);
      return {
        key: `acc-${accUidStr}`,
        draftId: draft?.id,
        account: acc,
        authorName: acc.name && acc.name.trim() !== "" ? acc.name : (acc.uid ? `UID: ${acc.uid}` : "Tài khoản"),
        content: contentStr,
        charCount: contentStr.length,
        imagePaths: imgs,
        imageCount: imgs.length,
        imagePath: imgs[0] || null,
        isSaved: !!draft?.isSaved,
      };
    });
  }, [targetExecutionAccounts, drafts]);

  const CARDS_PER_PAGE = 3;
  const totalDraftPages = Math.ceil(previewCards.length / CARDS_PER_PAGE) || 1;
  const paginatedCards = useMemo(() => {
    const start = (activeDraftPage - 1) * CARDS_PER_PAGE;
    return previewCards.slice(start, start + CARDS_PER_PAGE);
  }, [previewCards, activeDraftPage]);

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
    if (threads > selectedAccs.length) {
      return {
        ready: false,
        reason: `Số luồng chạy (${threads}) không được vượt quá số tài khoản đã chọn (${selectedAccs.length}).`,
      };
    }
    const missingAccounts = selectedAccs.filter((acc) => {
      const accUidStr = String(acc.uid || acc.id);
      const draft = drafts.find((d) => String(d.accountUid) === accUidStr);
      return !draft || !draft.content || draft.content.trim().length === 0;
    });
    if (missingAccounts.length > 0) {
      return {
        ready: false,
        reason: `Vui lòng nhấn nút '▷ THỰC THI' ở Bước 2 để tạo bài viết trước (còn ${missingAccounts.length} nick chưa có bài).`,
      };
    }
    const unsavedAccounts = selectedAccs.filter((acc) => {
      const accUidStr = String(acc.uid || acc.id);
      const draft = drafts.find((d) => String(d.accountUid) === accUidStr);
      return !draft || !draft.isSaved;
    });
    if (unsavedAccounts.length > 0) {
      return {
        ready: false,
        reason: `Vui lòng nhấn 'Lưu' cho tất cả bài viết ở Khu vực xem trước trước khi Đăng bài (còn ${unsavedAccounts.length} bài chưa lưu).`,
      };
    }
    return {
      ready: true,
      reason: `Đã lưu đầy đủ ${selectedAccs.length} bài viết. Sẵn sàng khởi chạy đăng bài!`,
    };
  }, [scheduleEnabled, scheduleTime, scheduleTimeInvalid, selectedAccs, drafts, threadCount]);

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

    // Bug 14: 1 dòng / 1 bài (tài khoản), KHÔNG cắt theo số luồng
    const tc = Math.max(1, parseInt(threadCount, 10) || 1);
    const initialRows = selectedAccs.map((acc, idx) => {
      const accUid = String(acc.uid || acc.id);
      const matchedDraft = drafts.find((d) => String(d.accountUid) === accUid);
      const draftContent = (matchedDraft?.content || "").trim();
      const draftImages = normalizeImagePaths(matchedDraft);
      const isActiveSlot = idx < tc;
      return {
        id: acc.id,
        threadId: isActiveSlot ? `T-${String(idx + 1).padStart(2, "0")}` : "—",
        accountName: acc.name,
        accountUid: acc.uid,
        status: isScheduled || !isActiveSlot ? "Chờ thực thi" : "Đang chạy",
        contentPreview: isScheduled
          ? `Hẹn giờ đăng: ${scheduleTime}`
          : draftContent
          ? draftContent.slice(0, 30) + "..."
          : "Đang chuẩn bị nội dung...",
        currentActivity: isScheduled
          ? `Đang chờ đến khung giờ ${scheduleTime} để kích nổ...`
          : isActiveSlot
          ? "Đang khởi tạo Chrome Profile & kết nối Facebook..."
          : "Đang chờ trong hàng đợi...",
        elapsedTime: "0:00",
        content: draftContent,
        imagePaths: draftImages,
        mediaPath: "",
        mediaName: "",
        postType: "status",
      };
    });
    setPreviewPostId(initialRows[0] ? String(initialRows[0].id) : null);

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
    setLogs([
      {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleTimeString(),
        thread: "System",
        type: "info",
        message: isScheduled
          ? `Đang chờ đến khung giờ ${scheduleTime} để kích nổ...`
          : `Khởi chạy tiến trình đăng Status với ${selectedAccs.length} tài khoản...`,
      },
    ]);

    try {
      const accountsWithContent = selectedAccs.map((acc) => {
        const accUidStr = String(acc.uid || acc.id);
        const matched = drafts.find((d) => String(d.accountUid) === accUidStr);
        const imgs = normalizeImagePaths(matched);
        return {
          ...acc,
          uid: accUidStr,
          content: matched?.content || "",
          image_path: imgs[0] || null,
          imagePath: imgs[0] || null,
          image_paths: imgs,
          imagePaths: imgs,
        };
      });

      const res = await api.post("/api/post/start", {
        post_type: "status",
        accounts: accountsWithContent,
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
      toast.success("Đã kích hoạt phiên đăng Status thành công!", "BẮT ĐẦU ĐĂNG");
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
        prev.map((r) => ({ ...r, status: "Đang chạy", currentActivity: "Tiếp tục đăng bài..." }))
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
    // Bỏ tick chọn tài khoản để trở về mặc định không chọn nick nào ở màn hình config
    setAccounts((prev) => prev.map((a) => ({ ...a, selected: false })));
    // Xóa nội dung prompt cũ khi quay lại màn cấu hình
    setPrompt("");
    // UC-M03-07: Tải lại nháp sạch từ CSDL (những bài đã PUBLISHED thành công đã được xóa)
    loadDraftsFromDb();
  };

  const selectedCount = accounts.filter((a) => a.selected).length;
  const threadCountNum = parseInt(threadCount, 10) || 0;
  const threadExceedsAccounts =
    selectedCount > 0 && threadCountNum > selectedCount;

  // Tự hạ số luồng khi bỏ chọn acc khiến số luồng > số acc đã chọn
  useEffect(() => {
    if (selectedCount <= 0) return;
    const val = parseInt(threadCount, 10);
    if (val > selectedCount) setThreadCount(selectedCount);
  }, [selectedCount, threadCount]);

  return (
    <div className="space-y-6  pb-20">
      {/* ── BƯỚC 1: THIẾT LẬP CẤU HÌNH HỆ THỐNG ── */}
      <div id="status-step1-config" className="space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
            1
          </div>
          <h2 className="text-sm font-bold text-slate-800 tracking-tight">
            Bước 1: Thiết lập cấu hình hệ thống
          </h2>
        </div>

        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 shadow-xs space-y-5">
          {/* Header với icon_post_setting */}
          <div className="flex items-center gap-2.5 text-[#0F172A] font-bold text-base tracking-tight">
            <Image src="/icons/icon_post_setting.svg" alt="Setting Icon" width={16} height={16} className="block shrink-0" />
            <span>Cấu hình hệ thống API Keys</span>
          </div>

          <div className="space-y-4 pt-1">
            {/* File chứa danh sách Gemini API Keys */}
            <div className="space-y-2">
              <label className="text-xs sm:text-sm font-bold text-[#0F172A] flex items-center">
                <span>
                  File chứa danh sách Gemini API Keys{" "}
                  <span className="text-red-500" aria-hidden="true">*</span>
                </span>
                <span className="w-3.5 h-3.5 rounded-full border border-[#94A3B8] text-[#94A3B8] inline-flex items-center justify-center text-[10px] font-normal leading-none shrink-0 ml-1 cursor-help select-none" title="Chọn file text (.txt) chứa danh sách API Key của Gemini, hoặc nhập đường dẫn file">
                  ?
                </span>
              </label>
              <div className="flex items-center gap-3">
                {keyFromFile && keyFileName ? (
                  <div
                    className={`flex-1 min-w-0 h-11 px-3 bg-[#F8FAFC] border rounded-xl flex items-center gap-2 ${
                      showConfigErrors && !hasApiKeySource
                        ? "border-red-400"
                        : "border-[#BFDBFE]"
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5 max-w-full min-w-0 rounded-lg bg-[#EFF6FF] border border-[#BFDBFE] pl-2.5 pr-1.5 py-1">
                      <FileText size={14} className="text-[#2563EB] shrink-0" />
                      <span
                        className="text-xs sm:text-sm font-medium text-[#1E40AF] truncate"
                        title={keyFileName}
                      >
                        {keyFileName}
                      </span>
                      <button
                        type="button"
                        onClick={handleClearKeyFile}
                        className="ml-0.5 p-0.5 rounded-md text-[#64748B] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer shrink-0"
                        title="Xóa file đã chọn"
                        aria-label="Xóa file đã chọn"
                      >
                        <X size={14} />
                      </button>
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[#64748B] shrink-0 hidden sm:inline">
                      File
                    </span>
                  </div>
                ) : (
                  <input
                    type="text"
                    name="gemini_api_key_source"
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    value={keyFileName}
                    onChange={(e) => {
                      setKeyFromFile(false);
                      setApiKeyContent("");
                      setKeyFileName(e.target.value);
                    }}
                    placeholder="Nhập đường dẫn file key hoặc chọn file..."
                    aria-required="true"
                    aria-invalid={showConfigErrors && !hasApiKeySource}
                    className={`flex-1 h-11 px-4 bg-white border rounded-xl text-xs sm:text-sm text-[#0F172A] placeholder:text-[#94A3B8] outline-none focus:ring-1 transition-all ${
                      showConfigErrors && !hasApiKeySource
                        ? "border-red-400 focus:border-red-500 focus:ring-red-500"
                        : "border-[#E2E8F0] focus:border-[#2563EB] focus:ring-[#2563EB]"
                    }`}
                  />
                )}
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  className="hidden"
                  accept=".txt"
                />
                <button
                  type="button"
                  onClick={handleSelectKeyFile}
                  className="h-11 px-6 bg-[#EFF6FF] hover:bg-[#DBEAFE] text-[#2563EB] text-xs sm:text-sm font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer shrink-0"
                >
                  <Upload size={14} />
                  <span>{keyFromFile && keyFileName ? "Đổi File" : "Chọn File Key"}</span>
                </button>
              </div>
              {keyFromFile && keyFileName ? (
                <p className="text-[11px] text-[#64748B]">
                  Đã chọn file key. Bấm <span className="font-semibold">×</span> để xóa hoặc <span className="font-semibold">Đổi File</span> để chọn lại.
                </p>
              ) : (
                <p className="text-[11px] text-[#64748B]">
                  Có thể chọn file .txt hoặc nhập đường dẫn file key thủ công.
                </p>
              )}
              {showConfigErrors && !hasApiKeySource && (
                <p className="text-[11px] font-medium text-red-500">
                  Vui lòng chọn hoặc nhập File Gemini API Keys.
                </p>
              )}
            </div>

            {/* Pixabay API Key (tùy chọn) */}
            <div className="space-y-2">
              <label className="text-xs sm:text-sm font-bold text-[#0F172A] flex items-center">
                <span>Pixabay API Key <span className="font-normal text-[#64748B]">(tùy chọn)</span></span>
                <span className="w-3.5 h-3.5 rounded-full border border-[#94A3B8] text-[#94A3B8] inline-flex items-center justify-center text-[10px] font-normal leading-none shrink-0 ml-1 cursor-help select-none" title="Nhập API Key Pixabay để tự động tìm kiếm hình ảnh minh họa cho bài viết (tùy chọn)">
                  ?
                </span>
              </label>
              <div className="relative">
                <input
                  type={showPixabayKey ? "text" : "password"}
                  name="pixabay_secret_token_no_fill"
                  id="pixabay_secret_token_no_fill"
                  autoComplete="new-password"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  value={pixabayKey}
                  onChange={(e) => setPixabayKey(e.target.value)}
                  onBlur={() => handleSaveSettingsToDb()}
                  placeholder="Nhập Pixabay API Key..."
                  className="w-full h-11 pl-4 pr-11 bg-white border border-[#E2E8F0] rounded-xl text-xs sm:text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-all font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPixabayKey(!showPixabayKey)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#475569] transition-colors cursor-pointer flex items-center justify-center p-1"
                >
                  {showPixabayKey ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Model Gemini */}
            <div className="space-y-2">
              <label className="text-xs sm:text-sm font-bold text-[#0F172A] flex items-center">
                <span>
                  Model Gemini{" "}
                  <span className="text-red-500" aria-hidden="true">*</span>
                </span>
                <span className="w-3.5 h-3.5 rounded-full border border-[#94A3B8] text-[#94A3B8] inline-flex items-center justify-center text-[10px] font-normal leading-none shrink-0 ml-1 cursor-help select-none" title="Chọn phiên bản mô hình Gemini để sinh nội dung bài viết">
                  ?
                </span>
              </label>
              <CustomSelect
                value={selectedModel}
                onChange={setSelectedModel}
                options={modelOptions}
                placeholder="Chọn Model Gemini..."
                className="w-full"
                buttonClassName={`h-11 px-4 bg-white border rounded-xl text-xs sm:text-sm text-[#0F172A] font-normal hover:border-slate-300 ${
                  showConfigErrors && !hasModel
                    ? "border-red-400"
                    : "border-[#E2E8F0]"
                }`}
                dropdownClassName="rounded-xl border-[#E2E8F0] shadow-lg text-xs sm:text-sm max-h-64 overflow-y-auto"
              />
              {showConfigErrors && !hasModel && (
                <p className="text-[11px] font-medium text-red-500">
                  Vui lòng chọn Model Gemini.
                </p>
              )}
            </div>

            {/* Khung Prompt AI cấu trúc bài đăng */}
            <div className="space-y-2">
              <label className="text-xs sm:text-sm font-bold text-[#0F172A] flex items-center">
                <span>
                  Khung Prompt AI cấu trúc bài đăng{" "}
                  <span className="text-red-500" aria-hidden="true">*</span>
                </span>
                <span className="w-3.5 h-3.5 rounded-full border border-[#94A3B8] text-[#94A3B8] inline-flex items-center justify-center text-[10px] font-normal leading-none shrink-0 ml-1 cursor-help select-none" title="Nhập yêu cầu câu lệnh hướng dẫn AI tạo bài viết">
                  ?
                </span>
              </label>
              <textarea
                rows={5}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={"Ví dụ:\nHãy tạo 1 bài viết về chủ đề du lịch Việt Nam, ngắn gọn, hấp dẫn, có icon, phù hợp đăng Facebook. Nội dung cần thu hút người xem, khuyến khích tương tác."}
                aria-required="true"
                aria-invalid={showConfigErrors && !hasPrompt}
                className={`w-full min-h-[140px] p-4 bg-white border rounded-xl text-xs sm:text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:ring-1 transition-all resize-y leading-relaxed ${
                  showConfigErrors && !hasPrompt
                    ? "border-red-400 focus:border-red-500 focus:ring-red-500"
                    : "border-[#E2E8F0] focus:border-[#2563EB] focus:ring-[#2563EB]"
                }`}
              />
              {showConfigErrors && !hasPrompt && (
                <p className="text-[11px] font-medium text-red-500">
                  Vui lòng nhập Khung Prompt AI.
                </p>
              )}
            </div>
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
            Bước 2: Chọn danh sách thực thi
          </h2>
        </div>

        <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-[0_1px_2px_0_rgba(0,0,0,0.05)] overflow-hidden select-none">
          {/* Header & Badges chuẩn Figma 1558-1631 */}
          <div className="p-5 flex items-center justify-between bg-white">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-subtle flex items-center justify-center shrink-0">
                <Image src="/icons/icon_user.svg" alt="User Icon" width={15} height={17} className="block" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm sm:text-base font-bold text-[#0F172A] leading-tight">
                  {viewState === "config" ? "Danh Sách Thực Thi" : "Danh Sách Thực Thi Đã chọn"}
                </span>
                <span className="text-xs font-semibold text-[#2563EB] mt-0.5">
                  {viewState === "config"
                    ? `Đã chọn ${selectedCount} / ${totalEligibleCount} tài khoản (Live & Đã đăng nhập)`
                    : `Đã chọn ${selectedCount} tài khoản`}
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
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Tải lại danh sách tài khoản"
            >
              <RotateCw size={17} className={isLoadingAccounts ? "animate-spin text-[#2563EB]" : ""} />
            </button>
          </div>

          {/* Toolbar Tìm kiếm chuẩn Figma (Full width, placeholder, icon xám) */}
          {viewState === "config" && (
            <div className="px-5 pb-4">
              <div className="relative w-full">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748B]" />
                <input
                  type="text"
                  value={searchAccount}
                  onChange={(e) => setSearchAccount(e.target.value)}
                  placeholder="Tìm UID, tên nick, proxy..."
                  className="w-full h-11 pl-10 pr-4 rounded-xl bg-[#F0F4FA] border border-[#E2E8F0] text-xs sm:text-sm text-[#0F172A] placeholder-[#64748B] focus:outline-none focus:bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-all"
                />
              </div>
            </div>
          )}

          {/* Khung Table cuộn mượt chuẩn Figma 1558-1631 */}
          <div className="w-full overflow-x-auto max-h-[480px] overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#3B82F6] [&::-webkit-scrollbar-thumb]:rounded-full">
            <table className="w-full border-collapse min-w-[760px] table-fixed">
              <colgroup>
                {viewState === "config" && <col className="w-14" />}
                <col className="w-16" />
                <col className="w-44" />
                <col className="w-auto" />
                <col className="w-40" />
                <col className="w-32" />
              </colgroup>

              <thead className="sticky top-0 z-10 bg-[#F0F5FF]">
                <tr className="h-11 border-b border-[#E2E8F0]">
                  {viewState === "config" && (
                    <th className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={allEligibleSelected}
                        onChange={toggleSelectAll}
                        disabled={visibleEligibleAccounts.length === 0}
                        aria-label="Chọn tất cả tài khoản hợp lệ"
                        className="w-4 h-4 rounded border-[#CBD5E1] accent-[#2563EB] cursor-pointer align-middle"
                        title={visibleEligibleAccounts.length === 0 ? "Không có tài khoản Live & Đã đăng nhập để chọn" : "Chọn tất cả tài khoản Live & Đã đăng nhập"}
                      />
                    </th>
                  )}
                  <th className="px-2 py-2 font-bold text-xs uppercase tracking-wider text-[#334155] text-center">
                    STT
                  </th>
                  <th className="px-3 py-2 font-bold text-xs uppercase tracking-wider text-[#334155] text-left">
                    UID FACEBOOK
                  </th>
                  <th className="px-3 py-2 font-bold text-xs uppercase tracking-wider text-[#334155] text-left">
                    HỌ & TÊN TÀI KHOẢN
                  </th>
                  <th className="px-3 py-2 font-bold text-xs uppercase tracking-wider text-[#334155] text-left">
                    TRẠNG THÁI ĐN
                  </th>
                  <th className="px-3 py-2 font-bold text-xs uppercase tracking-wider text-[#334155] text-left">
                    TRẠNG THÁI TK
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[#F1F5F9] text-xs">
                {isLoadingAccounts && accounts.length === 0 ? (
                  <tr>
                    <td colSpan={viewState === "config" ? 6 : 5} className="py-12 text-center text-slate-500">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 size={16} className="animate-spin text-[#2563EB]" />
                        <span className="text-sm font-medium">Đang đồng bộ dữ liệu tài khoản từ Module 02...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredAccounts.length === 0 ? (
                  <tr>
                    <td colSpan={viewState === "config" ? 6 : 5} className="px-4 py-12 text-center text-slate-500">
                      <div className="flex flex-col items-center justify-center gap-2 max-w-sm mx-auto">
                        <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
                          <Search className="w-4 h-4" />
                        </div>
                        <p className="text-[#0F172A] font-semibold text-xs sm:text-sm">
                          {accounts.length === 0
                            ? "Chưa có tài khoản Facebook nào"
                            : totalEligibleCount === 0
                            ? "Không có tài khoản Live & Đã đăng nhập"
                            : "Không tìm thấy tài khoản phù hợp"}
                        </p>
                        <p className="text-[11px] text-[#64748B] leading-relaxed">
                          {accounts.length === 0
                            ? "Vui lòng thêm nick ở Module 02 Quản lý tài khoản."
                            : totalEligibleCount === 0
                            ? "Chỉ hiển thị nick có trạng thái Live và Đã đăng nhập. Kiểm tra lại Module 02."
                            : "Vui lòng thử tìm kiếm bằng từ khóa khác."}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredAccounts.map((acc, index) => {
                    const eligible = isAccountEligible(acc);
                    return (
                      <tr
                        key={acc.id}
                        onMouseDown={(e) => handleRowMouseDown(acc, index, e)}
                        onMouseEnter={() => handleRowMouseEnter(acc)}
                        className={`h-14 transition-colors select-none border-b border-[#F1F5F9] ${!eligible
                            ? "bg-[#F8FAFC]/90 text-[#94A3B8] opacity-50 cursor-not-allowed"
                            : acc.selected && viewState === "config"
                              ? "bg-[#EFF6FF] hover:bg-[#EFF6FF] cursor-pointer"
                              : "bg-white hover:bg-slate-50/80 cursor-pointer"
                          } ${viewState === "running" && acc.selected ? "bg-[#EFF6FF]" : ""}`}
                        title={
                          !eligible
                            ? "Tài khoản không đủ điều kiện (Chỉ chọn được tài khoản có trạng thái Live và Đã đăng nhập)"
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
                              onChange={(e) => {
                                e.stopPropagation();
                                if (eligible) {
                                  setAccounts((prev) =>
                                    prev.map((a) => (a.id === acc.id ? { ...a, selected: !a.selected } : a))
                                  );
                                }
                              }}
                              disabled={!eligible}
                              className="w-4 h-4 rounded border-[#CBD5E1] accent-[#2563EB] cursor-pointer align-middle"
                            />
                          </td>
                        )}

                        {/* 2. STT (01, 02, 03...) */}
                        <td className="px-2 py-3 font-medium text-[#475569] text-center text-xs sm:text-sm">
                          {String(index + 1).padStart(2, "0")}
                        </td>

                        {/* 3. UID Facebook (Blue bold text + copy icon) */}
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className="font-bold text-[#2563EB] truncate text-xs sm:text-sm tracking-tight"
                              title={acc.uid}
                            >
                              {acc.uid}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyUid(acc.uid);
                              }}
                              className="p-1 rounded hover:bg-blue-50 text-[#64748B] hover:text-[#2563EB] transition-colors cursor-pointer shrink-0"
                              title="Sao chép UID"
                            >
                              {copiedUid === acc.uid ? (
                                <Check className="w-3.5 h-3.5 text-[#059669]" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </td>

                        {/* 4. Họ & Tên Tài Khoản */}
                        <td className="px-3 py-3">
                          <span
                            className="font-bold text-[#0F172A] text-xs sm:text-sm truncate block"
                            title={acc.name || `Tài khoản ${acc.uid}`}
                          >
                            {acc.name || `Tài khoản ${acc.uid}`}
                          </span>
                        </td>

                        {/* 5. Trạng Thái Đăng Nhập */}
                        <td className="px-3 py-3 text-left whitespace-nowrap">
                          {acc.connectionStatusCode === "logged_in" ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#E8FAF0] text-[#059669]">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                              Đã đăng nhập
                            </span>
                          ) : acc.connectionStatusCode === "failed" || acc.connectionStatusCode === "error" ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#FFF1F2] text-[#E11D48]">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#F43F5E]" />
                              Đăng nhập lỗi
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#F1F5F9] text-[#64748B]">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#94A3B8]" />
                              Chưa đăng nhập
                            </span>
                          )}
                        </td>

                        {/* 6. Trạng Thái Tài Khoản */}
                        <td className="px-3 py-3 text-left whitespace-nowrap">
                          {acc.accountStatusCode === "live" ? (
                            <span className="inline-flex items-center px-3 py-0.5 rounded-full text-xs font-medium bg-[#E8FAF0] text-[#059669]">
                              Live
                            </span>
                          ) : acc.accountStatusCode === "die" ? (
                            <span className="inline-flex items-center px-3 py-0.5 rounded-full text-xs font-medium bg-[#FEE2E2] text-[#B91C1C]">
                              Die
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-3 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
                              --
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* ── Nút THỰC THI ở Bước 2 (Chuẩn Figma) ── */}
          {viewState === "config" && (
            <div className="space-y-2 border-t border-slate-100 bg-white p-4">
              <button
                type="button"
                onClick={handleExecuteGenerate}
                disabled={isGeneratingDrafts || selectedCount === 0}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 text-xs font-bold tracking-wider text-white shadow-sm shadow-blue-500/10 transition-all hover:bg-blue-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isGeneratingDrafts ? (
                  <>
                    <Loader2 size={15} className="animate-spin text-white" />
                    <span>ĐANG THỰC THI AI TẠO BÀI VIẾT ({selectedCount} TÀI KHOẢN)...</span>
                  </>
                ) : (
                  <>
                    <Play size={14} className="fill-white" />
                    <span>THỰC THI</span>
                  </>
                )}
              </button>
              {!hasRequiredConfig && (
                <p className="pt-0.5 text-center text-[11px] font-medium text-amber-600">
                  {!hasApiKeySource
                    ? "Chọn File Gemini API Keys ở Bước 1 trước khi thực thi."
                    : !hasModel
                      ? "Chọn Model Gemini ở Bước 1 trước khi thực thi."
                      : "Nhập Khung Prompt AI ở Bước 1 trước khi thực thi."}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── KHU VỰC XEM TRƯỚC (CHUẨN 1:1 THEO FIGMA DESIGN) ── */}
      {viewState === "config" && (
        <div ref={previewSectionRef} className="space-y-3 pt-1">
          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-[0_1px_2px_0_rgba(0,0,0,0.05)] overflow-hidden">
            {/* Header Khu vực Xem trước chuẩn Figma */}
            <div className="p-6 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-3.5">
                <div className="w-9 h-9 rounded-xl bg-[#1D49BF] flex items-center justify-center shrink-0">
                  <Image src="/icons/icon_post_eye.svg" width={18} height={18} alt="eye" className="block" />
                </div>
                <h3 className="text-base sm:text-lg font-bold text-[#0F1C2E] tracking-tight">
                  Khu vực Xem trước
                </h3>
              </div>
              <p className="text-sm text-[#525866] leading-relaxed mt-3">
                Nơi hiển thị danh sách các bài viết do AI vừa sinh ra. Cho phép người dùng đọc lại, chỉnh sửa văn bản trực tiếp trước khi chốt lịch đăng tự động.
              </p>
            </div>

            {/* Danh sách Cards bài viết */}
            <div className="p-6 space-y-6">
              {previewCards.length === 0 ? (
                <div className="py-12 px-4 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/40">
                  <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-500 flex items-center justify-center mx-auto mb-3 shadow-2xs">
                    <BookOpen size={22} />
                  </div>
                  <h4 className="text-xs font-bold text-slate-700">Chưa có bài viết nào được tạo</h4>
                  <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                    Vui lòng chọn tài khoản ở bảng <strong>Bước 2</strong> và nhấn nút <strong>&quot;THỰC THI&quot;</strong> để AI sinh nội dung hiển thị tại đây.
                  </p>
                </div>
              ) : (
                <>
                  {/* Grid 3 cột chuẩn Figma — min-w-0 để card không đẩy tràn cột */}
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
                    {paginatedCards.map((card) => {
                      const isEmojiMenuOpen = emojiPickerCard?.cardKey === card.key;
                      return (
                        <div
                          key={card.key}
                          className={`relative flex min-w-0 flex-col justify-between overflow-hidden rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 transition-all hover:shadow-xs sm:p-5 ${
                            isEmojiMenuOpen ? "z-30 shadow-md ring-1 ring-blue-300" : "z-10"
                          }`}
                        >
                          <div>
                            {/* Line 1: Green dot + Author Name (Trái) & Nút Emoji (Phải) */}
                            <div className="flex items-center justify-between gap-2 min-w-0">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span className="w-2.5 h-2.5 rounded-full bg-[#10B981] shrink-0" />
                                <span className="text-sm sm:text-base font-bold text-[#0F172A] truncate" title={card.authorName}>
                                  {card.authorName}
                                </span>
                              </div>

                              {/* Nút Emoji đưa sang góc phải */}
                              <div className="relative shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEmojiPickerCard((prev) =>
                                      prev?.cardKey === card.key
                                        ? null
                                        : {
                                            cardKey: card.key,
                                            uid: card.account?.uid,
                                            draftId: card.draftId,
                                            authorName: card.authorName,
                                          }
                                    );
                                  }}
                                  className={`p-1.5 rounded-lg transition-colors cursor-pointer flex items-center justify-center ${
                                    isEmojiMenuOpen
                                      ? "bg-amber-100 text-amber-600 ring-1 ring-amber-300"
                                      : "text-[#64748B] hover:text-amber-500 hover:bg-slate-200/60"
                                  }`}
                                  title="Mở menu chọn biểu tượng cảm xúc (Emoji)"
                                >
                                  <Smile size={18} />
                                </button>

                                {/* Menu chọn Emoji (Dropdown popover căn lề phải không đè nội dung) */}
                                {isEmojiMenuOpen && (
                                  <FacebookEmojiMenu
                                    isOpen={true}
                                    onClose={() => setEmojiPickerCard(null)}
                                    onSelectEmoji={handleInsertEmoji}
                                    targetTitle={card.authorName}
                                    align="right"
                                  />
                                )}
                              </div>
                            </div>

                          {/* Textarea nội dung (Nền trắng, viền xám nhạt, thanh cuộn mượt đẹp) */}
                          <div className="mt-3">
                            <textarea
                              ref={(el) => {
                                const uidStr = card.account?.uid ? String(card.account.uid) : null;
                                const key = `${uidStr}-${card.draftId}`;
                                if (el) {
                                  textareaRefs.current[key] = el;
                                }
                              }}
                              rows={6}
                              value={card.content}
                              onChange={(e) => handleUpdateDraftContent(card.account.uid, card.draftId, e.target.value)}
                              placeholder={`Nhập nội dung bài đăng cho ${card.authorName}...`}
                              className="w-full text-xs sm:text-[13px] text-[#0F172A] bg-white p-3.5 rounded-xl border border-[#E2E8F0] resize-none leading-relaxed focus:bg-white focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-all font-sans min-h-[145px] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#CBD5E1] hover:[&::-webkit-scrollbar-thumb]:bg-[#94A3B8] [&::-webkit-scrollbar-thumb]:rounded-full"
                            />
                          </div>

                          {/* Ký tự */}
                          <div className="mt-2 text-xs text-[#64748B]">
                            <span>{card.charCount} ký tự</span>
                          </div>
                        </div>

                        {/* Footer: 2x2 trên card hẹp, 1 hàng khi đủ rộng — không tràn viền */}
                        <div className="mt-4 grid w-full min-w-0 grid-cols-2 gap-1.5 border-t border-[#E2E8F0] pt-3 xl:grid-cols-4">
                          {/* [Ảnh (X)] */}
                          <button
                            type="button"
                            onClick={() => setViewingImageCard(card)}
                            className="flex h-[30px] min-w-0 cursor-pointer items-center justify-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-1.5 text-[11px] font-semibold text-[#565E74] transition-colors hover:bg-slate-50"
                            title="Xem và quản lý ảnh đính kèm"
                          >
                            <Image src="/icons/icon_post_image.svg" width={12} height={12} alt="image" className="block shrink-0" />
                            <span className="truncate">Ảnh ({card.imageCount})</span>
                          </button>

                          {/* [Tạo lại] */}
                          <button
                            type="button"
                            onClick={() => handleGenerateForSingleAccount(card.account)}
                            disabled={isGeneratingDrafts || generatingCardUid === card.account.uid || !hasPrompt}
                            className="flex h-[30px] min-w-0 cursor-pointer items-center justify-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-1.5 text-[11px] font-semibold text-[#565E74] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Tạo lại nội dung bài này bằng AI"
                          >
                            <Image
                              src="/icons/icon_post_reload.svg"
                              width={10}
                              height={14}
                              alt="reload"
                              className={`block shrink-0 ${generatingCardUid === card.account.uid ? "animate-spin" : ""}`}
                            />
                            <span className="truncate">Tạo lại</span>
                          </button>

                          {/* [Xóa] */}
                          <button
                            type="button"
                            onClick={() => handleDeleteDraftItem(card.draftId, card.account.uid)}
                            className="flex h-[30px] min-w-0 cursor-pointer items-center justify-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-1.5 text-[11px] font-semibold text-[#565E74] transition-colors hover:bg-rose-50 hover:text-rose-600"
                            title="Xóa bài viết và bỏ chọn nick này"
                          >
                            <Image src="/icons/icon_post_delete.svg" width={12} height={14} alt="delete" className="block shrink-0" />
                            <span className="truncate">Xóa</span>
                          </button>

                          {/* [Lưu] / [Đã lưu] — trống nội dung / đã lưu thì khóa; sửa nội dung/ảnh mới mở lại */}
                          <button
                            type="button"
                            onClick={() => {
                              if (card.isSaved || !(card.content || "").trim()) return;
                              handleSaveDraftItem(card.account.uid, card.draftId, card.content);
                            }}
                            disabled={card.isSaved || !(card.content || "").trim()}
                            title={
                              card.isSaved
                                ? "Đã lưu — sửa nội dung hoặc ảnh để lưu lại"
                                : !(card.content || "").trim()
                                  ? "Nhập nội dung bài đăng trước khi lưu"
                                  : "Lưu bài viết"
                            }
                            className={`flex h-[30px] min-w-0 items-center justify-center gap-1 rounded-lg px-1.5 text-[11px] font-bold shadow-xs transition-all ${
                              card.isSaved
                                ? "cursor-default bg-[#059669] text-white opacity-90"
                                : !(card.content || "").trim()
                                  ? "cursor-not-allowed bg-[#2563EB] text-white opacity-50"
                                  : "cursor-pointer bg-[#2563EB] text-white hover:bg-blue-700 active:scale-[0.98]"
                            }`}
                          >
                            {card.isSaved ? (
                              <>
                                <Check size={12} className="shrink-0 stroke-[3]" />
                                <span className="truncate">Đã lưu</span>
                              </>
                            ) : (
                              <>
                                <Image src="/icons/icon_post_save.svg" width={12} height={12} alt="save" className="block shrink-0" />
                                <span className="truncate">Lưu</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  </div>

                  {/* Thanh Phân trang chuẩn Figma: Hiển thị 3/10 bài, < 1 2 3 > */}
                  <div className="flex items-center justify-between text-xs sm:text-sm text-[#475569] pt-5 mt-2">
                    <span className="font-medium text-[#334155]">
                      Hiển thị {paginatedCards.length}/{previewCards.length} bài
                    </span>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setActiveDraftPage((p) => Math.max(1, p - 1))}
                        disabled={activeDraftPage <= 1}
                        className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#EFF6FF] text-[#2563EB] hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                      >
                        <ChevronLeft size={16} />
                      </button>

                      {Array.from({ length: totalDraftPages }).map((_, idx) => {
                        const pageNum = idx + 1;
                        const isCurrent = pageNum === activeDraftPage;
                        return (
                          <button
                            key={pageNum}
                            type="button"
                            onClick={() => setActiveDraftPage(pageNum)}
                            className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold cursor-pointer transition-all ${
                              isCurrent
                                ? "bg-[#2563EB] text-white shadow-xs"
                                : "text-[#334155] hover:bg-slate-100 font-medium"
                            }`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}

                      <button
                        type="button"
                        onClick={() => setActiveDraftPage((p) => Math.min(totalDraftPages, p + 1))}
                        disabled={activeDraftPage >= totalDraftPages}
                        className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#EFF6FF] text-[#2563EB] hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* ── Thiết lập lịch đăng & luồng (Nằm trong Khu vực Xem trước theo Figma) ── */}
              <div className="pt-4 border-t border-slate-100 space-y-4">
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
                      className={`w-20 h-8 text-center border rounded-lg text-xs font-mono font-semibold transition-all ${
                        !scheduleEnabled
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

                  {/* Số lượng chạy (VR-M03-CFG-01, BR-M03-CFG-02): ≤ số acc đã chọn */}
                  <div className="flex flex-col items-start sm:items-center gap-1">
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
                          // Nếu để trống hoặc = 0 -> mặc định = 1 (BR-M03-CFG-02)
                          // Không vượt quá số tài khoản đã chọn
                          let val = parseInt(threadCount, 10);
                          if (!val || val <= 0) val = 1;
                          if (selectedCount > 0 && val > selectedCount) {
                            toast.warning(
                              `Số luồng tối đa bằng số tài khoản đã chọn (${selectedCount}).`,
                              "GIỚI HẠN LUỒNG",
                            );
                            val = selectedCount;
                          }
                          setThreadCount(val);
                        }}
                        className={`w-16 h-8 text-center bg-slate-50 border rounded-lg text-xs font-semibold focus:bg-white focus:outline-none font-mono ${
                          threadExceedsAccounts
                            ? "border-red-400 focus:border-red-500"
                            : "border-slate-200 focus:border-blue-500"
                        }`}
                      />
                      <span className="text-xs text-slate-500 font-medium">Luồng</span>
                    </div>
                    {threadExceedsAccounts && (
                      <span className="text-[10px] font-medium text-red-500">
                        Tối đa {selectedCount} (theo số acc đã chọn)
                      </span>
                    )}
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

                {/* ── Nút ĐĂNG BÀI (Chỉ bấm được khi đã Lưu hết toàn bộ bài viết) ── */}
                <div className="pt-2 space-y-2">
                  <button
                    type="button"
                    onClick={handleStartPost}
                    disabled={!validationStatus.ready}
                    className={`w-full py-3.5 rounded-xl font-bold text-xs tracking-wider shadow-sm flex items-center justify-center gap-2 transition-all ${validationStatus.ready
                      ? "bg-blue-600 hover:bg-blue-700 text-white cursor-pointer active:scale-[0.99] shadow-blue-500/20"
                      : "bg-slate-100 border border-slate-200 text-slate-400 cursor-not-allowed opacity-80"
                      }`}
                  >
                    <Play size={14} className={validationStatus.ready ? "fill-white" : "fill-slate-400"} />
                    <span>ĐĂNG BÀI</span>
                  </button>

                  {!validationStatus.ready && (
                    <p className="text-[11px] text-amber-600 font-medium text-center flex items-center justify-center gap-1.5 pt-0.5">
                      <Info size={13} />
                      <span>{validationStatus.reason}</span>
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── RUNNING STATE ONLY (FIGMA NODE 1613:2258) ── */}
      {viewState === "running" && (
        <div className="space-y-5 animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            {!(
              isStopped ||
              (metrics.running === 0 &&
                metrics.waiting === 0 &&
                metrics.completed + metrics.systemError + metrics.deadAccount + metrics.stopped > 0)
            ) ? (
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
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
              <Activity size={16} className="text-blue-600" />
              <span className="text-sm font-bold text-slate-900">Giám sát tiến trình đăng bài</span>
            </div>

            {/* 7 Stat Badges — chỉ hiển thị tổng quan, không lọc */}
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2.5">
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
                <span className="mt-1 text-2xl font-black text-rose-500">{metrics.systemError}</span>
              </div>

              <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-3 text-left">
                <div className="flex w-full items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">ACC CHẾT</span>
                  <span className="h-2 w-2 rounded-full bg-red-700" />
                </div>
                <span className="mt-1 text-2xl font-black text-red-700">{metrics.deadAccount}</span>
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
              postType="status"
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
                    <th className="py-2.5 px-4">NỘI DUNG BÀI ĐĂNG</th>
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
                      <td className="py-2.5 px-4 font-mono font-bold text-blue-600">
                        {row.threadId}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="space-y-0.5">
                          <p className="font-bold text-slate-800 text-xs">{row.accountName}</p>
                          <p className="text-[10px] font-mono text-slate-400">{row.accountUid}</p>
                        </div>
                      </td>
                      <td className="py-2.5 px-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium ${row.status === "Đang chạy"
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
                          <span className={`w-1.5 h-1.5 rounded-full ${row.status === "Đang chạy"
                            ? "bg-blue-600 animate-ping"
                            : row.status === "Tạm dừng"
                              ? "bg-amber-500"
                              : row.status === "Hoàn thành"
                                ? "bg-emerald-500"
                                : "bg-slate-600"
                            }`} />
                          {row.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 max-w-[200px] truncate text-slate-700 font-mono text-[11px]" title={row.content || row.contentPreview}>
                        {row.contentPreview}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className="flex items-center gap-1.5 text-slate-700 text-xs font-medium">
                          <span className={`w-1.5 h-1.5 rounded-full ${row.status === "Đang chạy" ? "bg-blue-500" : "bg-amber-500"
                            }`} />
                          {row.currentActivity}
                        </span>
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
                    Live Automation Log Console [Thread-01]
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
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-mono font-semibold ${isPaused
                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                    : isStopped
                      ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                      : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${isPaused ? "bg-amber-400" : isStopped ? "bg-rose-400" : "bg-emerald-400"
                      }`} />
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
                      className={`break-all ${log.type === "success"
                        ? "text-emerald-400"
                        : log.type === "warn"
                          ? "text-amber-400"
                          : log.type === "error"
                            ? "text-rose-400"
                            : "text-slate-200"
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


      {/* Modal Xem & Quản lý Ảnh Bài Viết */}
      <PostImageModal
        key={viewingImageCard ? String(viewingImageCard.account?.uid || viewingImageCard.draftId) : "none"}
        isOpen={!!viewingImageCard}
        card={viewingImageCard}
        onClose={() => setViewingImageCard(null)}
        pixabayKey={pixabayKey}
        apiKeySource={apiKeyContent || keyFileName || undefined}
        onUpdateImages={(nextPaths) => {
          if (!viewingImageCard) return;
          const imgs = normalizeImagePaths(nextPaths);
          const uidStr = String(viewingImageCard.account?.uid || "");
          setDrafts((prev) => {
            const idx = prev.findIndex((d) => String(d.accountUid) === uidStr);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = {
                ...updated[idx],
                imagePaths: imgs,
                imagePath: imgs[0] || null,
                imageCount: imgs.length,
                // Modal đã persist DB — giữ trạng thái đã lưu
                isSaved: true,
              };
              return updated;
            }
            return [
              ...prev,
              {
                id: viewingImageCard.draftId || `draft-${Date.now()}`,
                authorName: viewingImageCard.authorName,
                accountUid: uidStr,
                content: viewingImageCard.content,
                charCount: viewingImageCard.charCount,
                imagePaths: imgs,
                imagePath: imgs[0] || null,
                imageCount: imgs.length,
                selected: true,
                mediaType: "status",
                isSaved: true,
              },
            ];
          });
          setViewingImageCard((prev) =>
            prev
              ? {
                  ...prev,
                  imagePaths: imgs,
                  imagePath: imgs[0] || null,
                  imageCount: imgs.length,
                }
              : null
          );
        }}
      />

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
