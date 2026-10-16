"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  LayoutGrid,
  ListTodo,
  Loader2,
  LogIn,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";
import { getAiAccounts, getAiPostStatus, loginAiAccount, openAiPage, startAiPost, stopAiPost, testAiKeys } from "./service";

const MODELS = [
  { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
];
const GRAPH_VERSIONS = ["v18.0", "v19.0", "v20.0", "v21.0", "v22.0"];
const PROMPT_LIMIT = 2000;
const DRAFT_KEY = "m05.ai-post.draft";

function readDraft() {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (!raw || typeof raw !== "object") return null;
    const keywords = {};
    if (raw.keywords && typeof raw.keywords === "object") {
      Object.entries(raw.keywords).forEach(([key, value]) => {
        if (typeof value === "string") keywords[String(key)] = value.slice(0, 200);
      });
    }
    return {
      geminiKey: typeof raw.geminiKey === "string" ? raw.geminiKey : "",
      prompt: typeof raw.prompt === "string" ? raw.prompt.slice(0, PROMPT_LIMIT) : "",
      keywords,
    };
  } catch {
    return null;
  }
}

function writeDraft(draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* bộ nhớ trình duyệt đầy thì bỏ qua */
  }
}

const inputClass =
  "h-[33px] w-full rounded-lg border border-[#E2E8F0] bg-white px-3 text-sm text-[#1E293B] outline-none transition-colors placeholder:text-[#94A3B8] focus:border-[#2563EB]";
const PAGE_TONES = ["#10B981", "#F59E0B", "#14B8A6", "#3B82F6", "#F43F5E", "#6366F1"];

function pictureUrl(uid) {
  if (!/^\d{4,20}$/.test(String(uid || ""))) return "";
  return `https://graph.facebook.com/${uid}/picture?type=square&width=80&height=80`;
}

function Photo({ src, name, tone = "#0284C7" }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        width={28}
        height={28}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="size-7 rounded-full border border-[#E2E8F0] object-cover"
      />
    );
  }
  return (
    <span
      className="flex size-7 items-center justify-center rounded-full text-[11px] font-bold text-white"
      style={{ backgroundColor: tone }}
    >
      {(name || "?").trim().charAt(0).toUpperCase()}
    </span>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-[#334155]">{label}</span>
      {hint ? <span className="mt-0.5 block text-[11px] font-normal leading-4 text-[#64748B]">{hint}</span> : null}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function parseProgress(line) {
  const raw = String(line || "");
  const match = raw.match(/^(\d{2}:\d{2}:\d{2})\s+(.+?)\s+-\s+([\s\S]+)$/);
  if (!match) {
    const plain = raw.match(/^(\d{2}:\d{2}:\d{2})\s+([\s\S]+)$/);
    return {
      time: plain?.[1] || "",
      subject: "",
      message: plain?.[2] || raw,
      tone: "run",
    };
  }
  const message = match[3].trim();
  let tone = "run";
  if (/Đăng thành công|Đã tạo nội dung|✓|Đã kết thúc|Xong \d/.test(message)) tone = "ok";
  else if (/Chờ|Nghỉ|bài tạm|Bỏ qua ảnh|Chưa có Gemini/.test(message)) tone = "wait";
  else if (/thất bại|Lỗi|NGHIÊM TRỌNG/.test(message)) tone = "err";
  return { time: match[1], subject: match[2].trim(), message, tone };
}

function progressTone(tone) {
  if (tone === "ok") return { dot: "bg-[#10B981]", text: "text-[#059669]" };
  if (tone === "wait") return { dot: "bg-[#F59E0B]", text: "text-[#D97706]" };
  if (tone === "err") return { dot: "bg-[#F43F5E]", text: "text-[#E11D48]" };
  return { dot: "bg-[#3B82F6]", text: "text-[#334155]" };
}

export default function AiPost() {
  const [accounts, setAccounts] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loggingUid, setLoggingUid] = useState("");
  const [openingKey, setOpeningKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [showGemini, setShowGemini] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [pixabayKey, setPixabayKey] = useState("");
  const [showPixabay, setShowPixabay] = useState(false);
  const [modelName, setModelName] = useState("gemini-3.8-flash");
  const [fbVersion, setFbVersion] = useState("v22.0");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [times, setTimes] = useState(["09:00", "15:00", "21:00"]);
  const [sleepMin, setSleepMin] = useState(600);
  const [sleepMax, setSleepMax] = useState(900);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState([]);
  const [jobAccounts, setJobAccounts] = useState({});
  const [selectedPages, setSelectedPages] = useState(() => new Set());
  const [keywords, setKeywords] = useState({});
  const logRef = useRef(null);
  const runningRef = useRef(false);
  const seenPages = useRef(new Set());
  const [draftReady, setDraftReady] = useState(false);

  const applyJob = (job) => {
    const nextRunning = Boolean(job?.running);
    setRunning(nextRunning);
    setLogs(Array.isArray(job?.logs) ? job.logs : []);
    setJobAccounts(job?.accounts && typeof job.accounts === "object" ? job.accounts : {});
    return nextRunning;
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await getAiAccounts();
      setAccounts(Array.isArray(data?.accounts) ? data.accounts : []);
      applyJob(data?.job);
      runningRef.current = Boolean(data?.job?.running);
    } catch (error) {
      toast.error(error.message || "Không tải được danh sách tài khoản.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const job = await getAiPostStatus();
        if (cancelled) return;
        const nextRunning = applyJob(job);
        if (runningRef.current && !nextRunning) load();
        runningRef.current = nextRunning;
      } catch {
        /* lần poll sau sẽ thử lại */
      }
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [logs]);

  useEffect(() => {
    const draft = readDraft();
    if (draft) {
      setGeminiKey(draft.geminiKey);
      setPrompt(draft.prompt);
      setKeywords(draft.keywords);
    }
    setDraftReady(true);
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    writeDraft({ geminiKey, prompt, keywords });
  }, [draftReady, geminiKey, prompt, keywords]);

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return accounts;
    return accounts.filter((item) =>
      [item.profile_name, item.uid].some((field) => String(field || "").toLowerCase().includes(keyword))
    );
  }, [accounts, query]);

  const fanpages = useMemo(() => {
    const rows = [];
    accounts.forEach((account) => {
      (account.pages || []).forEach((page) => {
        if (page?.id == null) return;
        rows.push({
          key: String(page.id),
          name: page.name || "Fanpage",
          url: page.url || "",
          category: page.category || "",
          avatarUrl: page.avatar_url || "",
          ownerUid: page.owner_uid || account.uid,
          ownerName: page.owner_name || account.profile_name || account.uid,
        });
      });
    });
    return rows;
  }, [accounts]);

  useEffect(() => {
    setKeywords((current) => {
      const next = { ...current };
      let changed = false;
      fanpages.forEach((page) => {
        if (next[page.key] == null) {
          next[page.key] = page.category || "";
          changed = true;
        }
      });
      return changed ? next : current;
    });
    setSelectedPages((current) => {
      const alive = new Set(fanpages.map((page) => page.key));
      const next = new Set();
      let changed = false;
      current.forEach((key) => {
        if (alive.has(key)) next.add(key);
        else changed = true;
      });
      fanpages.forEach((page) => {
        if (!seenPages.current.has(page.key)) {
          seenPages.current.add(page.key);
          next.add(page.key);
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [fanpages]);


  const testKey = async () => {
    const key = geminiKey.trim();
    if (key.length < 20) {
      toast.warning("Gemini API key quá ngắn hoặc đang để trống.");
      return;
    }
    setTestingKey(true);
    try {
      const result = await testAiKeys({
        api_key: key,
        model_name: modelName,
        pixabay_key: pixabayKey.trim(),
      });
      toast.success(result.message || "Gemini key dùng được.");
    } catch (error) {
      toast.error(error.message || "Key không dùng được.");
    } finally {
      setTestingKey(false);
    }
  };

  const addTime = () => setTimes((current) => [...current, "12:00"]);
  const updateTime = (index, value) => setTimes((current) => current.map((item, i) => (i === index ? value : item)));
  const normalizeTime = (value) => {
    const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return value;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return value;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  };
  const removeTime = (index) => setTimes((current) => current.filter((_, i) => i !== index));

  const openPage = async (page) => {
    if (!page.ownerUid) {
      toast.warning("Page này chưa gắn với nick nào.");
      return;
    }
    setOpeningKey(page.key);
    try {
      await openAiPage(page.ownerUid, page.key);
      toast.info(`Đang mở ${page.name} bằng nick ${page.ownerName}.`);
    } catch (error) {
      toast.error(error.message || "Không mở được page.");
    } finally {
      setOpeningKey("");
    }
  };

  const login = async (uid) => {
    setLoggingUid(uid);
    try {
      await loginAiAccount(uid);
      toast.info("Đang đăng nhập và mở danh sách page trên Facebook.");
      const started = Date.now();
      while (Date.now() - started < 150000) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const data = await getAiAccounts();
        const rows = Array.isArray(data?.accounts) ? data.accounts : [];
        setAccounts(rows);
        const row = rows.find((item) => item.uid === uid);
        if (row?.count_status === "done") {
          toast.success(`Nick này đang quản lý ${row.page_count || 0} page.`);
          return;
        }
        if (row?.count_status === "error") {
          toast.error(row.count_message || "Không đếm được page.");
          return;
        }
      }
      toast.error("Hết thời gian chờ đếm page.");
    } catch (error) {
      toast.error(error.message || "Không đăng nhập được tài khoản.");
    } finally {
      setLoggingUid("");
    }
  };

  const activate = async () => {
    const chosen = fanpages.filter((page) => selectedPages.has(page.key));
    if (!chosen.length) {
      toast.warning("Chọn ít nhất một fanpage để chạy AI.");
      return;
    }
    if (chosen.every((page) => !page.url)) {
      toast.warning("Fanpage đã chọn chưa có link Facebook để đăng.");
      return;
    }
    setBusy(true);
    try {
      const result = await startAiPost({
        api_keys: geminiKey.trim() ? [geminiKey.trim()] : [],
        pixabay_key: pixabayKey,
        model_name: modelName,
        fb_version: fbVersion,
        prompt,
        schedule_enabled: scheduleEnabled,
        schedule_times: times,
        sleep_min: Number(sleepMin) || 0,
        sleep_max: Number(sleepMax) || 0,
        page_ids: chosen.map((page) => page.key),
        page_keywords: Object.fromEntries(chosen.map((page) => [page.key, (keywords[page.key] || "").trim()])),
      });
      setRunning(true);
      runningRef.current = true;
      toast.success(`Đã kích hoạt ${result.accounts} nick, ${result.pages} page.`);
    } catch (error) {
      toast.error(error.message || "Không kích hoạt được.");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await stopAiPost();
      toast.success("Đã gửi lệnh dừng luồng.");
    } catch (error) {
      toast.error(error.message || "Không dừng được luồng.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="-m-6 min-h-full bg-[#F4F7FB] p-6">
      <div className="grid items-start gap-6 xl:grid-cols-[393px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
        <section className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-lg bg-[#EFF6FF] text-[#2563EB]">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <h2 className="text-sm font-bold text-[#0F172A]">Cấu hình hệ thống API Keys</h2>
          </div>

          <Field label="Gemini API key" hint="Dùng để tạo nội dung bài đăng.">
            <div className="flex items-center gap-2">
              <span className="relative min-w-0 flex-1">
                <input
                  type={showGemini ? "text" : "password"}
                  value={geminiKey}
                  onChange={(event) => setGeminiKey(event.target.value)}
                  placeholder="Dán Gemini API key"
                  className={`${inputClass} pr-9 font-mono`}
                />
                <button
                  type="button"
                  onClick={() => setShowGemini((value) => !value)}
                  aria-label={showGemini ? "Ẩn key" : "Hiện key"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8]"
                >
                  {showGemini ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </span>
              <button
                type="button"
                onClick={testKey}
                disabled={testingKey}
                className="inline-flex h-[29px] shrink-0 items-center rounded-lg bg-[#EFF6FF] px-3 text-xs font-semibold text-[#2563EB] disabled:opacity-60"
              >
                {testingKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Kiểm tra Key"}
              </button>
            </div>
          </Field>

          <div className="mt-4">
            <Field label="Pixabay API key" hint="Dùng để tải ảnh cho bài. Không có thì bỏ qua.">
              <span className="relative block">
                <input
                  type={showPixabay ? "text" : "password"}
                  value={pixabayKey}
                  onChange={(event) => setPixabayKey(event.target.value)}
                  placeholder="Nhập Pixabay API Key..."
                  className={`${inputClass} pr-9`}
                />
                <button
                  type="button"
                  onClick={() => setShowPixabay((value) => !value)}
                  aria-label={showPixabay ? "Ẩn Pixabay key" : "Hiện Pixabay key"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8]"
                >
                  {showPixabay ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </span>
            </Field>
          </div>

          <div className="mt-4">
            <Field label="Model Gemini">
              <span className="relative block">
                <select value={modelName} onChange={(event) => setModelName(event.target.value)} className={`${inputClass} appearance-none pr-8`}>
                  {MODELS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94A3B8]" />
              </span>
            </Field>
          </div>

          <div className="mt-4">
            <Field label="Phiên bản Facebook API">
              <span className="relative block">
                <select value={fbVersion} onChange={(event) => setFbVersion(event.target.value)} className={`${inputClass} appearance-none pr-8`}>
                  {GRAPH_VERSIONS.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94A3B8]" />
              </span>
            </Field>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-[#334155]">Hẹn giờ đăng bài</span>
              <span className="flex items-center gap-2 text-xs font-semibold text-[#2563EB]">
                Kích hoạt
                <Switch checked={scheduleEnabled} onCheckedChange={setScheduleEnabled} className={scheduleEnabled ? "bg-[#1877F2]" : ""} />
              </span>
            </div>
            {scheduleEnabled ? (
              <div className="mt-2 space-y-2">
                {times.map((time, index) => (
                  <div key={`schedule-${index}`} className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="HH:MM"
                      value={time}
                      onChange={(event) => updateTime(index, event.target.value)}
                      onBlur={(event) => updateTime(index, normalizeTime(event.target.value))}
                      className={`${inputClass} min-w-0 flex-1 font-semibold tabular-nums`}
                    />
                    <button
                      type="button"
                      onClick={() => removeTime(index)}
                      aria-label={`Xóa khung ${time || index + 1}`}
                      className="inline-flex size-[33px] shrink-0 items-center justify-center rounded-lg border border-[#E2E8F0] text-[#94A3B8] hover:border-[#FCA5A5] hover:text-[#E11D48]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addTime}
                  className="inline-flex h-[33px] items-center gap-1 rounded-lg bg-[#EFF6FF] px-3 text-xs font-semibold text-[#2563EB]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Thêm giờ
                </button>
              </div>
            ) : null}
          </div>

          <div className="mt-4">
            <p className="text-xs font-semibold text-[#334155]">Giãn cách đăng ngẫu nhiên</p>
            <div className="mt-1.5 grid grid-cols-2 gap-3">
              <label className="text-[11px] text-[#64748B]">
                Từ (giây)
                <input
                  type="number"
                  min={0}
                  value={sleepMin}
                  onChange={(event) => setSleepMin(event.target.value)}
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="text-[11px] text-[#64748B]">
                Đến (giây)
                <input
                  type="number"
                  min={0}
                  value={sleepMax}
                  onChange={(event) => setSleepMax(event.target.value)}
                  className={`${inputClass} mt-1`}
                />
              </label>
            </div>
          </div>

          <div className="mt-4">
            <Field label="Khung Prompt AI cấu trúc bài đăng">
              <span className="relative block">
                <textarea
                  value={prompt}
                  maxLength={PROMPT_LIMIT}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={6}
                  placeholder="Nhập cấu trúc bài đăng. Chủ đề từng page lấy từ cột từ khóa bên phải."
                  className="h-[165px] w-full resize-none rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm leading-5 text-[#1E293B] outline-none placeholder:text-[#94A3B8] focus:border-[#2563EB]"
                />
                <span className="pointer-events-none absolute bottom-2 right-3 text-[11px] text-[#94A3B8]">
                  {prompt.length}/{PROMPT_LIMIT}
                </span>
              </span>
            </Field>
          </div>
        </section>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={activate}
            disabled={busy || running}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-[#2563EB] text-sm font-bold tracking-wide text-white disabled:opacity-60"
          >
            KÍCH HOẠT ▶
          </button>
          <button
            type="button"
            onClick={stop}
            disabled={busy || !running}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-[#F43F5E] text-sm font-bold tracking-wide text-white disabled:opacity-60"
          >
            DỪNG LUỒNG ⏹
          </button>
        </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
        <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex size-7 items-center justify-center rounded-lg bg-[#EFF6FF] text-[#2563EB]">
                <Users className="h-3.5 w-3.5" />
              </span>
              <div>
                <h2 className="text-sm font-bold text-[#0F172A]">Danh sách tài khoản đang quản lý Page</h2>
                <p className="text-[11px] text-[#64748B]">Đăng nhập nick admin để đếm page, rồi kích hoạt đăng bài.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex h-[29px] shrink-0 items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 text-xs font-semibold text-[#2563EB] disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Đồng bộ
            </button>
          </div>
          <div className="px-5 pb-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94A3B8]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tìm tài khoản"
                className={`${inputClass} pl-8`}
              />
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left">
              <thead>
                <tr className="border-y border-[#E2E8F0] text-[11px] font-bold uppercase tracking-wide text-[#64748B]">
                  <th className="w-14 px-5 py-2.5">STT</th>
                  <th className="px-3 py-2.5">Tài khoản</th>
                  <th className="w-24 px-3 py-2.5 text-center">Số Page</th>
                  <th className="w-36 px-5 py-2.5 text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-12 text-center text-sm text-[#94A3B8]">
                      {loading ? "Đang tải tài khoản..." : "Chưa có tài khoản khớp bộ lọc."}
                    </td>
                  </tr>
                ) : (
                  visible.map((item, index) => (
                    <tr key={item.uid} className="border-b border-[#F1F5F9] last:border-b-0">
                      <td className="px-5 py-3 text-sm text-[#64748B]">{index + 1}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <Photo src={item.avatar_url || pictureUrl(item.uid)} name={item.profile_name || item.uid} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-[#0F172A]">{item.profile_name || "Chưa có tên"}</p>
                            <p className="text-[11px] text-[#94A3B8]">UID: {item.uid}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center text-sm font-semibold text-[#0F172A]">
                        {item.count_status === "running" || loggingUid === item.uid ? (
                          <Loader2 className="mx-auto h-4 w-4 animate-spin text-[#2563EB]" />
                        ) : (
                          item.page_count || 0
                        )}
                      </td>
                      <td className="px-5 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => login(item.uid)}
                          disabled={loggingUid === item.uid}
                          className="inline-flex h-[25px] items-center gap-1 rounded-lg border border-[#BFDBFE] bg-white px-2.5 text-[11px] font-semibold text-[#2563EB] disabled:opacity-60"
                        >
                          <LogIn className="h-3 w-3" />
                          {loggingUid === item.uid ? "Đang nhập..." : "Đăng nhập"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="flex items-center gap-2">
              <LayoutGrid className="h-4 w-4 text-[#2563EB]" />
              <h2 className="text-sm font-bold text-[#0F172A]">Danh sách Fanpage</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedPages(new Set(fanpages.map((page) => page.key)))}
                disabled={!fanpages.length}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 text-xs font-semibold text-white disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                Chọn Tất Cả AI
              </button>
              <button
                type="button"
                onClick={() => setSelectedPages(new Set())}
                disabled={!selectedPages.size}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 text-xs font-semibold text-[#334155] disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
                Bỏ Chọn Tất Cả
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left">
              <thead>
                <tr className="border-y border-[#E2E8F0] text-[11px] font-semibold text-[#94A3B8]">
                  <th className="w-12 px-4 py-2.5" />
                  <th className="w-24 px-2 py-2.5">Chạy AI</th>
                  <th className="px-3 py-2.5">Tên Fanpage</th>
                  <th className="w-[240px] px-5 py-2.5">Từ khóa tìm kiếm ảnh / Chủ đề viết bài</th>
                </tr>
              </thead>
              <tbody>
                {fanpages.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-10 text-center text-sm text-[#94A3B8]">
                      {loading ? "Đang tải fanpage..." : "Chưa có fanpage. Page tạo thành công của các nick sẽ hiện ở đây."}
                    </td>
                  </tr>
                ) : (
                  fanpages.map((page, index) => {
                    const checked = selectedPages.has(page.key);
                    return (
                      <tr key={page.key} className="border-b border-[#F1F5F9] last:border-b-0">
                        <td className="px-4 py-3 text-sm text-[#94A3B8]">{index + 1}</td>
                        <td className="px-2 py-3">
                          <button
                            type="button"
                            aria-pressed={checked}
                            aria-label={checked ? `Bỏ chọn ${page.name}` : `Chọn ${page.name}`}
                            onClick={() =>
                              setSelectedPages((current) => {
                                const next = new Set(current);
                                if (next.has(page.key)) next.delete(page.key);
                                else next.add(page.key);
                                return next;
                              })
                            }
                            className={`flex size-5 items-center justify-center rounded-md ${
                              checked ? "bg-[#22C55E] text-white" : "border border-[#CBD5E1] bg-white"
                            }`}
                          >
                            {checked ? <Check className="h-3 w-3" /> : null}
                          </button>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2.5">
                            <Photo
                              src={page.avatarUrl}
                              name={page.name}
                              tone={PAGE_TONES[index % PAGE_TONES.length]}
                            />
                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={() => openPage(page)}
                                disabled={openingKey === page.key}
                                className="block max-w-full truncate text-left text-sm font-bold text-[#2563EB] hover:underline disabled:opacity-60"
                              >
                                {openingKey === page.key ? "Đang mở..." : page.name}
                              </button>
                              <p className="truncate text-[11px] text-[#94A3B8]">
                                {page.category ? page.category : `Nick: ${page.ownerName}`}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <input
                            value={keywords[page.key] ?? ""}
                            onChange={(event) =>
                              setKeywords((current) => ({ ...current, [page.key]: event.target.value }))
                            }
                            placeholder="Nhập từ khóa, chủ đề"
                            className="h-8 w-full rounded-lg border border-[#E2E8F0] px-3 text-xs text-[#334155] outline-none placeholder:text-[#CBD5E1] focus:border-[#2563EB]"
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
        </div>
      </div>

      <section className="mt-6 rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-lg bg-[#EFF6FF] text-[#2563EB]">
            <ListTodo className="h-3.5 w-3.5" />
          </span>
          <h2 className="text-sm font-bold text-[#0F172A]">Theo dõi Tiến trình</h2>
        </div>

        <div
          ref={logRef}
          className="mt-4 h-[260px] overflow-y-auto rounded-lg border border-[#E2E8F0] bg-white px-3 py-3 font-mono text-xs leading-6"
        >
          {logs.length === 0 ? (
            <p className="text-[#94A3B8]">Chưa có tiến trình. Kích hoạt luồng để bắt đầu.</p>
          ) : (
            logs.map((line, index) => {
              const item = parseProgress(line);
              const tone = progressTone(item.tone);
              return (
                <p key={`${line}-${index}`} className="flex flex-wrap items-start gap-x-2 whitespace-pre-wrap break-words">
                  {item.time ? <span className="shrink-0 text-[#94A3B8]">[{item.time}]</span> : null}
                  <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${tone.dot}`} />
                  <span className={tone.text}>
                    {item.subject ? (
                      <>
                        <span className="font-semibold text-[#0F172A]">{item.subject}</span>
                        {" - "}
                      </>
                    ) : null}
                    {item.message}
                  </span>
                </p>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
