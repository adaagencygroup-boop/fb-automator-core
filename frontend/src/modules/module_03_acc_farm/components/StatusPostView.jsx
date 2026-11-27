"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Settings,
  Upload,
  Search,
  Copy,
  Check,
  Play,
  Pause,
  Square,
  Activity,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
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
import { ComposeEditor, PlanCheckNotice } from "./ComposeEditor";
import { TimeSlotList, slotProblems } from "./TimeSlotList";
import { useComposeDraft } from "../hooks/useComposeDraft";
import { parseComposeText, sortSlots } from "../composeText";
import CustomSelect from "@/components/ui/custom-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import Image from "next/image";
import { EmergencyStopModal } from "./EmergencyStopModal";
import { PostProgressPreview } from "./PostProgressPreview";
import { ProgressActivityCell } from "./ProgressPostLink";
import {
  mapProgressThreads,
  shouldRestoreProgressView,
} from "@/modules/module_03_acc_farm/postSessionUi";
import { useAccountCategories } from "@/modules/module_02_account_manager/hooks/useAccountCategories";
import { categoryLabelStyle } from "@/modules/module_02_account_manager/components/CategorySelect";

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

const KEY_STATUS_STYLES = {
  LIVE: { label: "Sống", className: "bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]" },
  LIMITED: { label: "Sống (giới hạn)", className: "bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]" },
  DEAD: { label: "Chết", className: "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]" },
  UNKNOWN: { label: "Không rõ", className: "bg-[#F8FAFC] text-[#475569] border-[#E2E8F0]" },
};

/** Kết quả kiểm tra key tự động (Sống / Chết / Giới hạn) — ẩn khi chưa kiểm tra. */
function KeyCheckPanel({ check }) {
  const { loading, data, error } = check || {};
  const results = Array.isArray(data?.results) ? data.results : [];
  const total = data?.total ?? results.length;
  const live = data?.live ?? 0;
  const allLive = total > 0 && live === total;
  const noneLive = total > 0 && live === 0;

  if (!loading && !error && total === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {loading && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#2563EB]">
            <Loader2 size={12} className="animate-spin" />
            Đang kiểm tra key...
          </span>
        )}
        {total > 0 && !loading && (
          <ShieldCheck
            size={12}
            className={allLive ? "text-[#047857]" : noneLive ? "text-[#B91C1C]" : "text-[#B45309]"}
          />
        )}
        {total > 0 && !loading && (
          <span
            className={`text-[11px] font-semibold ${
              allLive ? "text-[#047857]" : noneLive ? "text-[#B91C1C]" : "text-[#B45309]"
            }`}
          >
            {total === 1
              ? results[0]?.message
              : `${live}/${total} key còn sống`}
          </span>
        )}
        {error && !loading && (
          <span className="text-[11px] font-medium text-red-500">{error}</span>
        )}
      </div>
      {results.length > 1 && !loading && (
        <ul className="space-y-1 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-2">
          {results.map((r, idx) => {
            const style = KEY_STATUS_STYLES[r.status] || KEY_STATUS_STYLES.UNKNOWN;
            return (
              <li key={`${r.key}-${idx}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                <span className="font-mono text-[#334155] break-all select-all">{r.key}</span>
                <span className={`px-1.5 py-0.5 rounded border font-semibold shrink-0 ${style.className}`}>
                  {style.label}
                </span>
                {r.status !== "LIVE" && (
                  <span className="text-[#64748B]">{r.message}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
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

export function StatusPostView({ initialState = "config", onHasPostsChange, isActive = true }) {
  const router = useRouter();
  const [viewState, setViewState] = useState(initialState);

  // ── Step 1: API Configuration State ──
  const [keyFileName, setKeyFileName] = useState("");
  const [apiKeyContent, setApiKeyContent] = useState("");
  /** true = đã chọn file (hiện chip + nút X); false = nhập đường dẫn/text tay */
  const [keyFromFile, setKeyFromFile] = useState(false);
  const [pixabayKey, setPixabayKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("gemini-3.8-flash");
  const [modelOptions, setModelOptions] = useState(DEFAULT_GEMINI_MODELS);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [prompt, setPrompt] = useState("");

  const fileInputRef = useRef(null);

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

  // ── Kiểm tra API key còn sống / đã chết ──
  const EMPTY_KEY_CHECK = { loading: false, data: null, error: "" };
  const [geminiKeyCheck, setGeminiKeyCheck] = useState(EMPTY_KEY_CHECK);
  const [pixabayKeyCheck, setPixabayKeyCheck] = useState(EMPTY_KEY_CHECK);
  const keyCheckSeqRef = useRef({});

  // Tự động gọi khi chọn file key / rời ô nhập key. `override` = giá trị mới nhất (state chưa kịp cập nhật).
  const handleCheckKeys = async (service, override) => {
    const setCheck = service === "pixabay" ? setPixabayKeyCheck : setGeminiKeyCheck;
    const body =
      service === "pixabay"
        ? { service, pixabay_key: String(override ?? pixabayKey ?? "").trim() }
        : { service, api_key_source: String(override ?? (apiKeyContent || keyFileName) ?? "").trim() };
    if (!(body.pixabay_key || body.api_key_source)) {
      setCheck(EMPTY_KEY_CHECK);
      return;
    }
    // Đổi key/file khi lần kiểm tra trước chưa xong → bỏ kết quả cũ
    const seq = (keyCheckSeqRef.current[service] || 0) + 1;
    keyCheckSeqRef.current[service] = seq;
    const isLatest = () => keyCheckSeqRef.current[service] === seq;
    setCheck({ loading: true, data: null, error: "" });
    try {
      const res = await api.post("/api/post/keys/check", body);
      const data = res?.data?.results ? res.data : res;
      if (isLatest()) setCheck({ loading: false, data, error: "" });
    } catch (err) {
      if (isLatest()) setCheck({ loading: false, data: null, error: err?.message || "Không kiểm tra được key." });
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
          handleCheckKeys("gemini", text.trim());
          handleSaveSettingsToDb({ fromFile: true, name: file.name || "keys.txt", content: text.trim() });
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
    setGeminiKeyCheck(EMPTY_KEY_CHECK);
    if (fileInputRef.current) fileInputRef.current.value = "";
    handleSaveSettingsToDb({ fromFile: false, name: "", content: "" });
  };

  // ── Step 2: Account List State (Real DB from Module 02 /api/accounts) ──
  const [searchAccount, setSearchAccount] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const [loginFilter, setLoginFilter] = useState("all");
  const [copiedUid, setCopiedUid] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const categoryList = useAccountCategories(true);
  const categoriesById = useMemo(
    () => new Map((categoryList.categories || []).map((item) => [item.id, item])),
    [categoryList.categories]
  );

  // ── Drafts State ──
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

  // Nháp ô soạn tự lưu vào DB → không cần hỏi "Rời đi" khi đổi tab / rời trang
  useEffect(() => {
    onHasPostsChange?.(false);
  }, [onHasPostsChange]);

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

        const savedKeys = String(s.gemini_api_keys || "").trim();
        if (savedKeys) {
          // Đã lưu nội dung key (mã hóa) → dùng lại đúng key đó
          setApiKeyContent(savedKeys);
          if (s.api_key_file_path) {
            setKeyFileName(s.api_key_file_path);
            setKeyFromFile(true);
          } else {
            setKeyFileName(savedKeys);
            setKeyFromFile(false);
          }
        } else if (s.api_key_file_path) {
          // Dữ liệu cũ: chỉ có tên file / key thô trong api_key_file_path
          setKeyFileName(s.api_key_file_path);
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
        // Tải lại trang → kiểm tra lại key đã lưu
        if (savedKeys) handleCheckKeys("gemini", savedKeys);
        else if (s.api_key_file_path) {
          // Cấu hình cũ chỉ có tên file, không có nội dung → không đoán key khác, yêu cầu chọn lại
          setGeminiKeyCheck({
            loading: false,
            data: null,
            error: `Chưa lưu nội dung của file "${s.api_key_file_path}". Bấm Đổi File và chọn lại file key để kiểm tra và lưu.`,
          });
        }
        if (nextPixabay) handleCheckKeys("pixabay", nextPixabay);
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

  // `keyOverride` = giá trị key mới nhất khi state chưa kịp cập nhật (vừa chọn file / vừa xóa).
  const handleSaveSettingsToDb = async (keyOverride) => {
    const fromFile = keyOverride?.fromFile ?? keyFromFile;
    const name = keyOverride?.name ?? keyFileName;
    // Chip file mà không có nội dung (dữ liệu cũ chỉ lưu tên file) → không lấy tên file làm key
    const content = keyOverride?.content ?? (apiKeyContent || (fromFile ? "" : keyFileName));
    try {
      await api.post("/api/post/settings", {
        post_type: "status",
        // Chỉ lưu tên file khi chọn file; key dán tay lưu mã hóa ở gemini_api_keys (không lưu thô)
        api_key_file_path: fromFile ? name : "",
        gemini_api_keys: String(content || "").trim(),
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
          category_id: a.category_id ?? null,
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
      // Gắn lại nick đã chọn trong phiên (nếu đang restore progress)
      await applySessionAccountSelection(formatted);
      setAccountsLoaded(true);
    } catch (err) {
      console.error("Lỗi khi tải tài khoản:", err);
    } finally {
      setIsLoadingAccounts(false);
    }
  };

  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const sessionAccountsRef = useRef([]);

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

  const checkActiveSessionOnMount = async (openCampaignRun = false) => {
    try {
      const res = await api.get("/api/post/status");
      const d = res?.data ?? res;
      if (!shouldRestoreProgressView(d)) return;
      if (d.post_type && d.post_type !== "status") return;
      if (d.campaign && !openCampaignRun) return;

      setViewingCampaignRun(Boolean(d.campaign));
      setViewState("running");
      onHasPostsChange?.(false);
      setIsPaused(!!d.is_paused);
      setIsStopped(!!d.is_stopped);
      if (d.metrics) setMetrics(d.metrics);
      if (Array.isArray(d.recent_logs) && d.recent_logs.length > 0) {
        setLogs(d.recent_logs);
      }
      if (Array.isArray(d.threads) && d.threads.length > 0) {
        setThreadRows(mapProgressThreads(d.threads, "status"));
      }
      if (Array.isArray(d.session_accounts) && d.session_accounts.length > 0) {
        sessionAccountsRef.current = d.session_accounts;
        await applySessionAccountSelection();
      }
      // Phiên còn chạy/pause thì poll; finished/stopped thì một vòng poll sẽ tự dừng
      if (d.is_running || d.is_paused || !d.session_finished) {
        startStatusPolling();
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

  // Restore màn tiến trình ngay khi mount (không chờ load accounts)
  useEffect(() => {
    checkActiveSessionOnMount();
  }, []);

  useEffect(() => {
    loadAccountsFromDb();
    loadSettingsFromDb();
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
        const cat =
          a.category_id == null ? null : categoriesById.get(a.category_id);
        const catName = cat?.name || (a.category_id != null ? `Danh mục #${a.category_id}` : "");
        return (
          (a.name && a.name.toLowerCase().includes(q)) ||
          (a.uid && a.uid.includes(q)) ||
          (a.proxy && a.proxy.toLowerCase().includes(q)) ||
          (catName && catName.toLowerCase().includes(q))
        );
      });
  }, [accounts, viewState, searchAccount, accountFilter, loginFilter, categoriesById]);

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
  const selectedAccs = useMemo(() => accounts.filter((a) => a.selected), [accounts]);

  // ── Bước 3-4: ô soạn bài chung + lịch đăng (Đăng ngay / Tạo chiến dịch / Sửa chiến dịch) ──
  const searchParams = useSearchParams();
  const editCampaignId = searchParams?.get("campaign") || null;
  const [editingCampaign, setEditingCampaign] = useState(null);
  const composeDraft = useComposeDraft({ postType: "status", autosave: !editCampaignId });
  const { compose } = composeDraft;
  const parsedCompose = useMemo(
    () => parseComposeText(compose.content_text, compose.content_mode),
    [compose.content_text, compose.content_mode],
  );
  const [slots, setSlots] = useState([]);
  const [campaignName, setCampaignName] = useState("");
  const [planCheck, setPlanCheck] = useState(null);
  const [planChecking, setPlanChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeCampaignRun, setActiveCampaignRun] = useState(null);
  const [viewingCampaignRun, setViewingCampaignRun] = useState(false);
  const [lastCreatedCampaign, setLastCreatedCampaign] = useState(null);
  const campaignUidsRef = useRef(null);
  const useSchedule = Boolean(editCampaignId) || Boolean(scheduleEnabled);
  const keptSlots = useMemo(() => editingCampaign?.waitingSlots || [], [editingCampaign]);

  const toHHmm = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? ""
      : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const runSettings = () => ({
    thread_count: Math.max(1, parseInt(threadCount, 10) || 1),
    min_delay: parseInt(minDelay, 10) || 0,
    max_delay: parseInt(maxDelay, 10) || 0,
  });

  // Nạp chiến dịch cần sửa: /interact/post?tab=status&campaign=<id>
  useEffect(() => {
    if (!editCampaignId) {
      setEditingCampaign(null);
      campaignUidsRef.current = null;
      return undefined;
    }
    let cancelled = false;
    api
      .get(`/api/post/campaigns/${editCampaignId}`)
      .then((res) => {
        const c = res?.data;
        if (cancelled || !c) return;
        const waiting = sortSlots((c.slots || []).filter((sl) => sl.status === "WAITING").map((sl) => toHHmm(sl.run_at)));
        setEditingCampaign({ ...c, waitingSlots: waiting });
        composeDraft.replace(c);
        setSlots(waiting);
        setCampaignName(c.name || "");
        const st = c.settings || {};
        if (st.thread_count) setThreadCount(st.thread_count);
        if (st.min_delay != null) setMinDelay(st.min_delay);
        if (st.max_delay != null) setMaxDelay(st.max_delay);
        campaignUidsRef.current = new Set((c.accounts || []).map((a) => String(a.uid)));
        if (!c.can_edit) {
          toast.warning("Chiến dịch đang chạy 1 khung giờ, đợi khung đó xong rồi mới lưu được.", "SỬA CHIẾN DỊCH");
        }
      })
      .catch((err) => {
        toast.error(err?.message || "Không tải được chiến dịch.", "SỬA CHIẾN DỊCH");
        router.replace("/interact/post?tab=status");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editCampaignId]);

  // Tick các nick của chiến dịch đang sửa (chờ danh sách nick tải xong)
  useEffect(() => {
    const uids = campaignUidsRef.current;
    if (!uids || !accountsLoaded || !editingCampaign) return;
    campaignUidsRef.current = null;
    let missing = 0;
    setAccounts((prev) => {
      const next = prev.map((a) => {
        const inCampaign = uids.has(String(a.uid || a.id));
        return { ...a, selected: inCampaign && isAccountEligible(a) };
      });
      missing = uids.size - next.filter((a) => a.selected).length;
      return next;
    });
    if (missing > 0) {
      toast.warning(
        `${missing} nick của chiến dịch hiện không Live / chưa đăng nhập nên chưa được chọn. Lưu lại sẽ bỏ các nick này khỏi chiến dịch.`,
        "SỬA CHIẾN DỊCH",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountsLoaded, editingCampaign]);

  // Kiểm tra kho bài / ảnh / khung giờ trên máy chủ (không ghi gì) mỗi khi soạn thay đổi
  useEffect(() => {
    if (viewState !== "config") return undefined;
    if (selectedAccs.length === 0 && parsedCompose.count === 0) {
      setPlanCheck(null);
      return undefined;
    }
    const timer = setTimeout(async () => {
      setPlanChecking(true);
      try {
        const res = await api.post("/api/post/compose/check", {
          account_count: selectedAccs.length,
          compose,
          slots: useSchedule ? slots : [],
          keep_slots: keptSlots,
          settings: runSettings(),
        });
        setPlanCheck(res);
      } catch {
        setPlanCheck(null);
      } finally {
        setPlanChecking(false);
      }
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compose, selectedAccs.length, slots, useSchedule, keptSlots, threadCount, minDelay, maxDelay, viewState]);

  // Khung chiến dịch đang chạy → banner "Xem tiến trình" trên màn soạn
  useEffect(() => {
    if (viewState !== "config") return undefined;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await api.get("/api/post/status");
        const d = res?.data ?? res;
        if (!stopped) setActiveCampaignRun(d?.campaign && d?.is_running ? d.campaign : null);
      } catch {
        // quiet error
      }
    };
    tick();
    const id = setInterval(tick, 10000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [viewState]);

  const handleBackFromCampaignRun = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    setViewingCampaignRun(false);
    setViewState("config");
  };

  const handleAiGenerate = async (count, withImages) => {
    setShowConfigErrors(true);
    if (!hasApiKeySource) {
      toast.warning("Nhập Gemini API Key hoặc chọn file ở Bước 1 trước khi dùng AI.", "THIẾU GEMINI API KEY");
      return;
    }
    if (!hasPrompt) {
      toast.warning("Nhập Khung Prompt AI ở Bước 1 trước khi dùng AI.", "CHƯA CÓ PROMPT");
      return;
    }
    try {
      handleSaveSettingsToDb();
      await composeDraft.startGenerate({
        prompt,
        count,
        withImages,
        apiKeySource: apiKeyContent || keyFileName,
        pixabayKey,
        model: selectedModel,
      });
    } catch (err) {
      toast.error(err?.message || "Không bắt đầu được AI tạo bài.", "AI TẠO BÀI");
    }
  };

  const handleClearCompose = async () => {
    try {
      await composeDraft.clearAll();
    } catch (err) {
      toast.error(err?.message || "Không xoá được.", "XOÁ TẤT CẢ");
    }
  };

  const enterProgressView = (message) => {
    setViewingCampaignRun(false);
    setViewState("running");
    setIsPaused(false);
    setIsStopped(false);
    setThreadRows([]);
    setPreviewPostId(null);
    setMetrics({ running: 0, paused: 0, waiting: 0, completed: 0, systemError: 0, deadAccount: 0, stopped: 0 });
    setLogs(
      message
        ? [{ id: Date.now().toString(), timestamp: new Date().toLocaleTimeString(), thread: "System", type: "info", message }]
        : [],
    );
    startStatusPolling();
  };

  const showWarnings = (warnings) => (warnings || []).forEach((w) => toast.warning(w, "LƯU Ý"));

  // Không hẹn giờ = Đăng ngay: không lưu chiến dịch, không xoá nháp, xem kết quả ở Lịch sử
  const handlePostNow = async () => {
    if (submitBlockReason) {
      toast.warning(submitBlockReason, "CHƯA ĐỦ ĐIỀU KIỆN");
      return;
    }
    setSubmitting(true);
    try {
      await composeDraft.flush();
      handleSaveSettingsToDb();
      const settings = runSettings();
      const res = await api.post("/api/post/start", {
        post_type: "status",
        accounts: selectedAccs.map((a) => ({ ...a, uid: String(a.uid || a.id) })),
        ...settings,
        schedule_enabled: false,
        compose,
      });
      if (res?.success === false) throw new Error(res?.message || "Không thể khởi động phiên đăng bài.");
      const skipped = res?.skipped || [];
      toast.success(
        `Đã bắt đầu đăng ${res?.inserted_count || 0} bài.${skipped.length ? ` ${skipped.length} nick bị bỏ qua: ${skipped[0].reason}` : ""}`,
        "ĐĂNG NGAY",
      );
      showWarnings(res?.warnings);
      enterProgressView(`Khởi chạy đăng Status ${res?.inserted_count || 0} bài (${res?.parsed || ""}).`);
    } catch (err) {
      toast.error(err?.message || String(err), "KHÔNG THỂ ĐĂNG NGAY");
    } finally {
      setSubmitting(false);
    }
  };

  const campaignPayload = () => ({
    name: campaignName.trim(),
    accounts: selectedAccs.map((a) => ({ uid: String(a.uid || a.id), name: a.name || "" })),
    settings: runSettings(),
    compose,
    slots,
  });

  // Hẹn giờ = Tạo chiến dịch: bộ lập lịch trên máy này tự đăng vào từng khung giờ
  const handleCreateCampaign = async () => {
    if (submitBlockReason) {
      toast.warning(submitBlockReason, "CHƯA ĐỦ ĐIỀU KIỆN");
      return;
    }
    setSubmitting(true);
    try {
      await composeDraft.flush();
      handleSaveSettingsToDb();
      const res = await api.post("/api/post/campaigns", campaignPayload());
      const created = res?.data;
      toast.success(`Đã tạo chiến dịch "${created?.name}" với ${slots.length} khung giờ.`, "TẠO CHIẾN DỊCH");
      showWarnings(res?.warnings);
      setLastCreatedCampaign(created || null);
      setSlots([]);
      setCampaignName("");
      await composeDraft.reload(); // máy chủ đã xoá nháp sau khi tạo chiến dịch
    } catch (err) {
      toast.error(err?.message || String(err), "KHÔNG TẠO ĐƯỢC CHIẾN DỊCH");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveCampaign = async () => {
    if (submitBlockReason) {
      toast.warning(submitBlockReason, "CHƯA ĐỦ ĐIỀU KIỆN");
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.put(`/api/post/campaigns/${editCampaignId}`, campaignPayload());
      toast.success(`Đã lưu chiến dịch "${res?.data?.name}". Thay đổi áp dụng cho các khung chưa chạy.`, "SỬA CHIẾN DỊCH");
      showWarnings(res?.warnings);
      router.push(`/interact/campaigns?id=${editCampaignId}`);
    } catch (err) {
      toast.error(err?.message || String(err), "KHÔNG LƯU ĐƯỢC CHIẾN DỊCH");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelEdit = () => {
    router.replace("/interact/post?tab=status");
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
    sessionAccountsRef.current = [];
    setViewingCampaignRun(false);
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
  const step1Locked = composeDraft.generating;

  // Tự hạ số luồng khi bỏ chọn acc / vượt trần 10
  useEffect(() => {
    const val = parseInt(threadCount, 10);
    if (!val || val <= 0) {
      setThreadCount(1);
      return;
    }
    if (val > maxThreadCount) setThreadCount(maxThreadCount);
  }, [selectedCount, maxThreadCount, threadCount]);

  // Gợi ý số bài AI tạo = số nick × số khung giờ
  const suggestedAiCount = Math.max(1, selectedCount) * Math.max(1, useSchedule ? slots.length : 1);

  // Lý do chưa bấm được Đăng ngay / Tạo chiến dịch (máy chủ vẫn kiểm tra lại khi bấm)
  const submitBlockReason = (() => {
    if (composeDraft.generating) return "AI đang tạo bài, đợi xong hoặc bấm Huỷ.";
    if (selectedAccs.length === 0) return "Chưa chọn nick nào ở Bước 2.";
    if (parsedCompose.count === 0) return "Ô soạn ở Bước 3 chưa có bài nào.";
    if (threadExceedsAccounts) return `Số luồng tối đa ${maxThreadCount} (≤ số nick đã chọn, tối đa 10).`;
    if (useSchedule && slots.length === 0) return "Thêm ít nhất 1 khung giờ để tạo chiến dịch.";
    if (useSchedule && slotProblems(slots, keptSlots).length > 0)
      return "Có khung giờ đã qua hoặc còn chưa tới 5 phút, hãy bỏ hoặc đổi giờ.";
    if (editingCampaign && editingCampaign.can_edit === false)
      return "Chiến dịch đang chạy 1 khung giờ, đợi khung đó xong rồi mới lưu được.";
    if (!useSchedule && activeCampaignRun)
      return `Chiến dịch "${activeCampaignRun.campaign_name}" đang chạy khung ${activeCampaignRun.run_at}. Đợi khung này xong rồi đăng ngay.`;
    if (planCheck && planCheck.ok === false) return planCheck.errors?.[0] || "Kho bài / ảnh chưa đủ.";
    return "";
  })();

  return (
    <div className="space-y-6  pb-20">
      {viewState === "config" && activeCampaignRun && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] px-5 py-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#1E3A8A] sm:text-sm">
            <Loader2 size={15} className="animate-spin text-[#2563EB]" />
            <span>
              Chiến dịch &quot;{activeCampaignRun.campaign_name}&quot; đang chạy khung {activeCampaignRun.run_at}.
              Đăng ngay sẽ được mở lại khi khung này xong.
            </span>
          </div>
          <button
            type="button"
            onClick={() => checkActiveSessionOnMount(true).then(() => startStatusPolling())}
            className="rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700"
          >
            Xem tiến trình
          </button>
        </div>
      )}
      {/* ── BƯỚC 1: THIẾT LẬP CẤU HÌNH HỆ THỐNG (ẩn khi đang giám sát; hiện lại khi quay về cấu hình) ── */}
      {viewState === "config" && (
      <div id="status-step1-config" className="space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
            1
          </div>
          <h2 className="text-sm font-bold text-slate-800 tracking-tight">
            Bước 1: Thiết lập cấu hình hệ thống
          </h2>
          {step1Locked && (
            <span className="text-[11px] font-semibold text-[#64748B]">Đang thực thi, tạm khóa</span>
          )}
        </div>

        <fieldset
          disabled={step1Locked}
          className={`m-0 min-w-0 rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-xs space-y-5 ${step1Locked ? "cursor-not-allowed opacity-60" : ""}`}
        >
          {/* Header với icon_post_setting */}
          <div className="flex items-center gap-2.5 text-[#0F172A] font-bold text-base tracking-tight">
            <Image src="/icons/icon_post_setting.svg" alt="Setting Icon" width={16} height={16} className="block shrink-0" />
            <span>Cấu hình hệ thống API Keys</span>
          </div>

          <div className="space-y-4 pt-1">
            {/* Gemini API Key — dán text hoặc chọn file */}
            <div className="space-y-2">
              <label className="text-xs sm:text-sm font-bold text-[#0F172A] flex items-center">
                <span>
                  Gemini API Key{" "}
                  <span className="text-red-500" aria-hidden="true">*</span>
                </span>
                <span
                  className="w-3.5 h-3.5 rounded-full border border-[#94A3B8] text-[#94A3B8] inline-flex items-center justify-center text-[10px] font-normal leading-none shrink-0 ml-1 cursor-help select-none"
                  title="Dán API Key Gemini trực tiếp (mỗi dòng 1 key), hoặc chọn file .txt chứa danh sách key"
                >
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
                      const v = e.target.value;
                      setKeyFromFile(false);
                      setKeyFileName(v);
                      // Cho phép dán key / nhiều dòng key hoặc đường dẫn file
                      setApiKeyContent(v.trim());
                      setGeminiKeyCheck(EMPTY_KEY_CHECK);
                    }}
                    onBlur={() => {
                      if (String(apiKeyContent || keyFileName || "").trim()) {
                        fetchGeminiModels(apiKeyContent || keyFileName);
                        // Chỉ kiểm tra + lưu lại khi key đổi (onChange đã xóa kết quả cũ)
                        if (!geminiKeyCheck.data && !geminiKeyCheck.loading) {
                          handleCheckKeys("gemini");
                          handleSaveSettingsToDb();
                        }
                      }
                    }}
                    placeholder="Dán Gemini API Key hoặc chọn file .txt..."
                    aria-required="true"
                    aria-invalid={showConfigErrors && !hasApiKeySource}
                    className={`flex-1 h-11 px-4 bg-white border rounded-xl text-xs sm:text-sm text-[#0F172A] placeholder:text-[#94A3B8] outline-none focus:ring-1 transition-all font-mono ${
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
                  <span>{keyFromFile && keyFileName ? "Đổi File" : "Chọn File"}</span>
                </button>
              </div>
              {keyFromFile && keyFileName ? (
                <p className="text-[11px] text-[#64748B]">
                  Đã chọn file key. Bấm <span className="font-semibold">×</span> để xóa hoặc <span className="font-semibold">Đổi File</span> để chọn lại.
                </p>
              ) : (
                <p className="text-[11px] text-[#64748B]">
                  Có thể dán API Key trực tiếp (mỗi dòng 1 key) hoặc chọn file .txt.
                </p>
              )}
              {showConfigErrors && !hasApiKeySource && (
                <p className="text-[11px] font-medium text-red-500">
                  Vui lòng nhập Gemini API Key hoặc chọn file.
                </p>
              )}
              <KeyCheckPanel check={geminiKeyCheck} />
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
                  type="text"
                  name="pixabay_secret_token_no_fill"
                  id="pixabay_secret_token_no_fill"
                  autoComplete="off"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  value={pixabayKey}
                  onChange={(e) => {
                    setPixabayKey(e.target.value);
                    setPixabayKeyCheck(EMPTY_KEY_CHECK);
                  }}
                  onBlur={() => {
                    handleSaveSettingsToDb();
                    if (!pixabayKeyCheck.data && !pixabayKeyCheck.loading) handleCheckKeys("pixabay");
                  }}
                  placeholder="Nhập Pixabay API Key..."
                  className="w-full h-11 px-4 bg-white border border-[#E2E8F0] rounded-xl text-xs sm:text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-all font-mono"
                />
              </div>
              <KeyCheckPanel check={pixabayKeyCheck} />
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
                  <span className="text-[11px] font-medium text-slate-400">(cần khi dùng AI tạo bài ở Bước 3)</span>
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
        </fieldset>
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
            Bước 2: Chọn danh sách thực thi
          </h2>
          {step1Locked && (
            <span className="text-[11px] font-semibold text-[#64748B]">Đang thực thi, tạm khóa</span>
          )}
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

          </div>

          <div className={step1Locked ? "pointer-events-none select-none opacity-60" : ""}>
          {/* Toolbar Tìm kiếm chuẩn Figma (Full width, placeholder, icon xám) */}
          {viewState === "config" && (
            <div className="px-5 pb-4">
              <div className="relative w-full">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748B]" />
                <input
                  type="text"
                  value={searchAccount}
                  onChange={(e) => setSearchAccount(e.target.value)}
                  disabled={step1Locked}
                  placeholder="Tìm UID, tên nick, proxy..."
                  className="w-full h-11 pl-10 pr-4 rounded-xl bg-[#F0F4FA] border border-[#E2E8F0] text-xs sm:text-sm text-[#0F172A] placeholder-[#64748B] focus:outline-none focus:bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-all"
                />
              </div>
            </div>
          )}

          {/* Khung Table cuộn mượt chuẩn Figma 1558-1631 */}
          <div className="w-full overflow-x-auto max-h-[480px] overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#3B82F6] [&::-webkit-scrollbar-thumb]:rounded-full">
            <table className="w-full border-collapse min-w-[860px] table-fixed">
              <colgroup>
                {viewState === "config" && <col className="w-14" />}
                <col className="w-16" />
                <col className="w-44" />
                <col className="w-auto" />
                <col className="w-40" />
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
                        disabled={step1Locked || visibleEligibleAccounts.length === 0}
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
                    DANH MỤC
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
                    <td colSpan={viewState === "config" ? 7 : 6} className="py-12 text-center text-slate-500">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 size={16} className="animate-spin text-[#2563EB]" />
                        <span className="text-sm font-medium">Đang đồng bộ dữ liệu tài khoản từ Module 02...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredAccounts.length === 0 ? (
                  <tr>
                    <td colSpan={viewState === "config" ? 7 : 6} className="px-4 py-12 text-center text-slate-500">
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
                    const accCategory =
                      acc.category_id == null ? null : categoriesById.get(acc.category_id);
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
                              disabled={step1Locked}
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

                        {/* 5. Danh mục (khớp Module 02) */}
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

                        {/* 6. Trạng Thái Đăng Nhập */}
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
          </div>

        </div>
      </div>
      )}

      {/* ── BƯỚC 3: NỘI DUNG ĐĂNG (ô soạn chung + kho ảnh + AI tạo bài) ── */}
      {viewState === "config" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
              3
            </div>
            <h2 className="text-sm font-bold text-slate-800 tracking-tight">Bước 3: Nội dung đăng</h2>
          </div>

          {editingCampaign && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-900">
              <span>
                Đang sửa chiến dịch <strong>&quot;{editingCampaign.name}&quot;</strong>. Thay đổi chỉ áp dụng cho các khung giờ
                chưa chạy; nháp soạn bài của bạn được giữ nguyên.
              </span>
              <button type="button" onClick={handleCancelEdit} className="font-bold text-amber-900 underline">
                Huỷ sửa
              </button>
            </div>
          )}

          <div className="rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-xs">
            <ComposeEditor
              compose={compose}
              parsed={parsedCompose}
              onChange={composeDraft.update}
              onClearAll={handleClearCompose}
              saveState={editCampaignId ? "idle" : composeDraft.saveState}
              lockedReason="AI đang thêm bài vào cuối ô. Bấm Huỷ nếu muốn sửa ngay."
              ai={{
                generating: composeDraft.generating,
                job: composeDraft.job,
                suggestedCount: suggestedAiCount,
                onGenerate: handleAiGenerate,
                onCancel: composeDraft.cancelGenerate,
                disabledReason: editCampaignId
                  ? "Khi sửa chiến dịch, dán hoặc sửa bài trực tiếp trong ô (AI chỉ thêm bài vào nháp soạn bài)."
                  : "",
              }}
            />
          </div>
        </div>
      )}

      {/* ── BƯỚC 4: LỊCH ĐĂNG & THỰC THI ── */}
      {viewState === "config" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
              4
            </div>
            <h2 className="text-sm font-bold text-slate-800 tracking-tight">Bước 4: Lịch đăng &amp; thực thi</h2>
          </div>

          <div className="rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-xs space-y-5">
            <div className="flex items-start gap-3">
              <Switch
                checked={useSchedule}
                disabled={Boolean(editCampaignId)}
                onCheckedChange={setScheduleEnabled}
              />
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-slate-700">HẸN GIỜ (TẠO CHIẾN DỊCH)</span>
                <p className="text-[11px] text-slate-500">
                  {useSchedule
                    ? "Tự động đăng vào các khung giờ trong hôm nay. Mỗi khung, mỗi nick đăng 1 bài; một nick không đăng lại bài / ảnh đã đăng trong chiến dịch."
                    : "Đang tắt: bấm Đăng ngay, mỗi nick đăng 1 bài khác nhau ngay bây giờ. Kết quả xem ở Lịch sử."}
                </p>
              </div>
            </div>

            {useSchedule && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <label className="block space-y-1.5">
                  <span className="text-xs font-bold text-[#0F172A]">Tên chiến dịch</span>
                  <input
                    type="text"
                    value={campaignName}
                    maxLength={200}
                    onChange={(e) => setCampaignName(e.target.value)}
                    placeholder="Để trống sẽ tự đặt theo giờ tạo"
                    className="h-9 w-full rounded-lg border border-[#E2E8F0] bg-white px-3 text-xs text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:outline-none"
                  />
                </label>
                <div className="space-y-1.5">
                  <span className="text-xs font-bold text-[#0F172A]">Khung giờ trong hôm nay</span>
                  <TimeSlotList slots={slots} onChange={setSlots} keep={keptSlots} />
                </div>
              </div>
            )}

            <div className="pt-4 border-t border-slate-100">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
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
            </div>

            <PlanCheckNotice check={planCheck} loading={planChecking} />

            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                {editCampaignId ? (
                  <>
                    <button
                      type="button"
                      onClick={handleSaveCampaign}
                      disabled={submitting || Boolean(submitBlockReason)}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 text-xs font-bold tracking-wider text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {submitting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      LƯU CHIẾN DỊCH
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      className="rounded-xl border border-slate-200 px-6 py-3.5 text-xs font-bold tracking-wider text-slate-600 hover:bg-slate-50"
                    >
                      HUỶ SỬA
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={useSchedule ? handleCreateCampaign : handlePostNow}
                    disabled={submitting || Boolean(submitBlockReason)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 text-xs font-bold tracking-wider text-white shadow-sm shadow-blue-500/20 hover:bg-blue-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} className="fill-white" />}
                    {useSchedule ? `TẠO CHIẾN DỊCH (${slots.length} KHUNG GIỜ)` : "ĐĂNG NGAY"}
                  </button>
                )}
              </div>
              {submitBlockReason && (
                <p className="flex items-center justify-center gap-1.5 pt-0.5 text-center text-[11px] font-medium text-amber-600">
                  <Info size={13} />
                  <span>{submitBlockReason}</span>
                </p>
              )}
              {lastCreatedCampaign && !editCampaignId && (
                <p className="text-center text-[11px] font-medium text-emerald-700">
                  Đã tạo chiến dịch &quot;{lastCreatedCampaign.name}&quot;.{" "}
                  <button
                    type="button"
                    onClick={() => router.push(`/interact/campaigns?id=${lastCreatedCampaign.id}`)}
                    className="font-bold underline"
                  >
                    Xem chiến dịch
                  </button>
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── RUNNING STATE ONLY (FIGMA NODE 1613:2258) ── */}
      {viewState === "running" && (
        <div className="space-y-5 animate-in fade-in duration-200">
          {viewingCampaignRun && (
            <button
              type="button"
              onClick={handleBackFromCampaignRun}
              className="flex items-center gap-1.5 text-xs font-semibold text-[#2563EB] hover:underline"
            >
              <ChevronLeft size={14} />
              Quay lại soạn bài (khung chiến dịch vẫn chạy tiếp)
            </button>
          )}
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

            {/* Stat Badges — chỉ hiển thị tổng quan, không lọc (Ticket #68: bỏ thẻ Acc chết) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
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
                                : row.status === "Lỗi hệ thống"
                                  ? "bg-rose-600"
                                  : row.status === "Acc chết"
                                    ? "bg-red-700"
                                    : "bg-slate-600"
                            }`} />
                          {row.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 max-w-[200px] truncate text-slate-700 font-mono text-[11px]" title={row.content || row.contentPreview}>
                        {row.contentPreview}
                      </td>
                      <td className="py-2.5 px-4">
                        <ProgressActivityCell row={row} />
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
                    Live Automation Log Console
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


      {/* Modal xác nhận DỪNG KHẨN CẤP */}
      <EmergencyStopModal
        isOpen={showEmergencyModal}
        onClose={() => setShowEmergencyModal(false)}
        onConfirm={handleConfirmEmergencyStop}
        isStopping={isStopping}
      />

    </div>
  );
}
