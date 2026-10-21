"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Loader2,
  LogIn,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";
import { getAiAccounts, getAiPostStatus, getAiSettings, loginAiAccount, openAiPage, saveAiSettings, startAiPost, stopAiPost, testAiKeys, testPixabayKey } from "./service";

const MODELS = [
  { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
  { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
  { value: "gemini-flash-latest", label: "Gemini Flash Latest" },
  { value: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite" },
  { value: "gemini-flash-lite-latest", label: "Gemini Flash Lite Latest" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (cũ)" },
  { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash (cũ)" },
];
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
      pixabayKey: typeof raw.pixabayKey === "string" ? raw.pixabayKey : "",
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

function Photo({ src, name, tone = "#0284C7", size = 28 }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="rounded-full border border-[#E2E8F0] object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="flex items-center justify-center rounded-full font-bold text-white"
      style={{ backgroundColor: tone, width: size, height: size, fontSize: size > 30 ? 13 : 11 }}
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
  const [testingPixabay, setTestingPixabay] = useState(false);
  const [modelName, setModelName] = useState("gemini-3-flash-preview");
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
  const [settingsReady, setSettingsReady] = useState(false);
  const savedConfig = useRef("");

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

  const configPayload = () => ({
    gemini_key: geminiKey,
    pixabay_key: pixabayKey,
    model_name: modelName,
    prompt,
    schedule_enabled: scheduleEnabled,
    schedule_times: times,
    sleep_min: Number(sleepMin) || 0,
    sleep_max: Number(sleepMax) || 0,
    keywords,
  });

  const applyConfig = (config) => {
    setGeminiKey(typeof config.gemini_key === "string" ? config.gemini_key : config.geminiKey || "");
    setPixabayKey(typeof config.pixabay_key === "string" ? config.pixabay_key : config.pixabayKey || "");
    setModelName(config.model_name || config.modelName || "gemini-3-flash-preview");
    setPrompt(typeof config.prompt === "string" ? config.prompt : "");
    setScheduleEnabled(Boolean(config.schedule_enabled ?? config.scheduleEnabled));
    const nextTimes = config.schedule_times || config.scheduleTimes;
    setTimes(Array.isArray(nextTimes) && nextTimes.length ? nextTimes : ["09:00", "15:00", "21:00"]);
    setSleepMin(config.sleep_min ?? config.sleepMin ?? 600);
    setSleepMax(config.sleep_max ?? config.sleepMax ?? 900);
    setKeywords(config.keywords && typeof config.keywords === "object" ? config.keywords : {});
  };

  useEffect(() => {
    let cancelled = false;
    const applyLocal = () => {
      const draft = readDraft();
      if (!draft) return null;
      return {
        gemini_key: draft.geminiKey,
        pixabay_key: draft.pixabayKey,
        model_name: "gemini-3-flash-preview",
        prompt: draft.prompt,
        schedule_enabled: false,
        schedule_times: ["09:00", "15:00", "21:00"],
        sleep_min: 600,
        sleep_max: 900,
        keywords: draft.keywords,
      };
    };
    (async () => {
      try {
        const remote = await getAiSettings();
        if (cancelled) return;
        if (remote?.saved) {
          applyConfig(remote);
          savedConfig.current = JSON.stringify({
            gemini_key: remote.gemini_key || "",
            pixabay_key: remote.pixabay_key || "",
            model_name: remote.model_name || "gemini-3-flash-preview",
            prompt: remote.prompt || "",
            schedule_enabled: Boolean(remote.schedule_enabled),
            schedule_times: Array.isArray(remote.schedule_times) && remote.schedule_times.length ? remote.schedule_times : ["09:00", "15:00", "21:00"],
            sleep_min: Number(remote.sleep_min ?? 600) || 0,
            sleep_max: Number(remote.sleep_max ?? 900) || 0,
            keywords: remote.keywords && typeof remote.keywords === "object" ? remote.keywords : {},
          });
        } else {
          const local = applyLocal();
          if (local) applyConfig(local);
        }
      } catch {
        if (cancelled) return;
        const local = applyLocal();
        if (local) {
          applyConfig(local);
          savedConfig.current = JSON.stringify(local);
        }
      } finally {
        if (!cancelled) setSettingsReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!settingsReady) return undefined;
    const payload = configPayload();
    const serialized = JSON.stringify(payload);
    if (serialized === savedConfig.current) return undefined;
    const handle = setTimeout(() => {
      savedConfig.current = serialized;
      writeDraft({
        geminiKey: payload.gemini_key,
        pixabayKey: payload.pixabay_key,
        prompt: payload.prompt,
        keywords: payload.keywords,
      });
      saveAiSettings(payload).catch(() => {
        savedConfig.current = "";
      });
    }, 400);
    return () => clearTimeout(handle);
  }, [settingsReady, geminiKey, pixabayKey, modelName, prompt, scheduleEnabled, times, sleepMin, sleepMax, keywords]);

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
        if (next[page.key] == null || String(next[page.key]).trim() === "") {
          next[page.key] = page.name || "";
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
      // Chỉ kiểm tra Gemini — không gửi Pixabay (có nút riêng).
      const result = await testAiKeys({
        api_key: key,
        model_name: modelName,
        pixabay_key: "",
      });
      if (result.model_name && result.model_name !== modelName) {
        setModelName(result.model_name);
      }
      toast.success(result.message || "Gemini key dùng được.");
    } catch (error) {
      toast.error(error.message || "Key không dùng được.");
    } finally {
      setTestingKey(false);
    }
  };

  const testPixabay = async () => {
    const key = pixabayKey.trim();
    if (key.length < 10) {
      toast.warning("Pixabay API key quá ngắn hoặc đang để trống.");
      return;
    }
    setTestingPixabay(true);
    try {
      const result = await testPixabayKey({ pixabay_key: key });
      toast.success(result.message || "Pixabay key dùng được.");
    } catch (error) {
      toast.error(error.message || "Pixabay key không dùng được.");
    } finally {
      setTestingPixabay(false);
    }
  };

  const addTime = () => setTimes((current) => [...current, "12:00"]);
  const updateTime = (index, value) => setTimes((current) => current.map((item, i) => (i === index ? value : item)));
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
            <span className="flex size-7 items-center justify-center rounded-lg bg-[#EFF6FF]">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M13.1562 4.56641C13.2292 4.82161 13.1745 5.04036 12.9922 5.22266L11.7891 6.31641C11.8255 6.53516 11.8438 6.76302 11.8438 7C11.8438 7.23698 11.8255 7.46484 11.7891 7.68359L12.9922 8.77734C13.1745 8.95964 13.2292 9.17839 13.1562 9.43359C13.0286 9.76172 12.8828 10.0807 12.7188 10.3906L12.582 10.6094C12.3997 10.901 12.1992 11.1836 11.9805 11.457C11.7982 11.6576 11.5794 11.7214 11.3242 11.6484L9.79297 11.1562C9.42839 11.4479 9.02734 11.6758 8.58984 11.8398L8.26172 13.4258C8.1888 13.681 8.01562 13.8359 7.74219 13.8906C7.3776 13.9635 6.99479 14 6.59375 14C6.19271 14 5.80078 13.9635 5.41797 13.8906C5.16276 13.8359 4.9987 13.681 4.92578 13.4258L4.59766 11.8398C4.16016 11.6758 3.75911 11.4479 3.39453 11.1562L1.86328 11.6484C1.60807 11.7214 1.38932 11.6576 1.20703 11.457C0.970052 11.1836 0.769531 10.901 0.605469 10.6094L0.46875 10.3906C0.304688 10.0807 0.158854 9.77083 0.03125 9.46094C-0.0416667 9.1875 0.0130208 8.95964 0.195312 8.77734L1.39844 7.71094C1.36198 7.47396 1.34375 7.23698 1.34375 7C1.34375 6.76302 1.36198 6.53516 1.39844 6.31641L0.195312 5.22266C0.0130208 5.04036 -0.0416667 4.82161 0.03125 4.56641C0.158854 4.23828 0.304688 3.91927 0.46875 3.60938L0.605469 3.39062C0.769531 3.09896 0.970052 2.81641 1.20703 2.54297C1.38932 2.34245 1.60807 2.27865 1.86328 2.35156L3.39453 2.84375C3.75911 2.55208 4.16016 2.3151 4.59766 2.13281L4.92578 0.574219C4.9987 0.31901 5.17188 0.164062 5.44531 0.109375C5.8099 0.0364583 6.19271 0 6.59375 0C6.99479 0 7.38672 0.0364583 7.76953 0.109375C8.02474 0.164062 8.1888 0.31901 8.26172 0.574219L8.58984 2.13281C9.02734 2.3151 9.42839 2.55208 9.79297 2.84375L11.3242 2.35156C11.5794 2.27865 11.7982 2.34245 11.9805 2.54297C12.2174 2.81641 12.4271 3.09896 12.6094 3.39062L12.7188 3.60938C12.8828 3.91927 13.0286 4.23828 13.1562 4.56641V4.56641V4.56641M6.59375 9.1875C7.41406 9.16927 8.04297 8.80469 8.48047 8.09375C8.88151 7.36458 8.88151 6.63542 8.48047 5.90625C8.04297 5.19531 7.41406 4.83073 6.59375 4.8125C5.77344 4.83073 5.14453 5.19531 4.70703 5.90625C4.30599 6.63542 4.30599 7.36458 4.70703 8.09375C5.14453 8.80469 5.77344 9.16927 6.59375 9.1875V9.1875V9.1875" fill="#1877F2" />
              </svg>
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
            <Field label="Pixabay API key" hint="Không có ảnh Pixabay thì dùng ảnh tạm. Ảnh tạm cũng lỗi thì đăng chữ.">
              <div className="flex items-center gap-2">
                <span className="relative min-w-0 flex-1">
                  <input
                    type={showPixabay ? "text" : "password"}
                    value={pixabayKey}
                    onChange={(event) => setPixabayKey(event.target.value)}
                    placeholder="Nhập Pixabay API Key..."
                    className={`${inputClass} pr-9 font-mono`}
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
                <button
                  type="button"
                  onClick={testPixabay}
                  disabled={testingPixabay}
                  className="inline-flex h-[29px] shrink-0 items-center rounded-lg bg-[#EFF6FF] px-3 text-xs font-semibold text-[#2563EB] disabled:opacity-60"
                >
                  {testingPixabay ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Kiểm tra Key"}
                </button>
              </div>
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
                      type="time"
                      step="60"
                      value={/^\d{2}:\d{2}$/.test(time) ? time : ""}
                      onChange={(event) => updateTime(index, event.target.value.slice(0, 5))}
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
              <span className="mt-0.5 flex size-7 items-center justify-center rounded-lg bg-[#EFF6FF]">
                <svg width="18" height="14" viewBox="0 0 18 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M3.9375 0C4.75781 0.0182292 5.38672 0.382812 5.82422 1.09375C6.22526 1.82292 6.22526 2.55208 5.82422 3.28125C5.38672 3.99219 4.75781 4.35677 3.9375 4.375C3.11719 4.35677 2.48828 3.99219 2.05078 3.28125C1.64974 2.55208 1.64974 1.82292 2.05078 1.09375C2.48828 0.382812 3.11719 0.0182292 3.9375 0V0V0M14 0C14.8203 0.0182292 15.4492 0.382812 15.8867 1.09375C16.2878 1.82292 16.2878 2.55208 15.8867 3.28125C15.4492 3.99219 14.8203 4.35677 14 4.375C13.1797 4.35677 12.5508 3.99219 12.1133 3.28125C11.7122 2.55208 11.7122 1.82292 12.1133 1.09375C12.5508 0.382812 13.1797 0.0182292 14 0V0V0M0 8.17578C0.0182292 7.33724 0.300781 6.64453 0.847656 6.09766V6.09766C1.39453 5.55078 2.08724 5.26823 2.92578 5.25H4.07422C4.51172 5.25 4.92188 5.34115 5.30469 5.52344C5.26823 5.72396 5.25 5.92448 5.25 6.125C5.28646 7.20052 5.67839 8.07552 6.42578 8.75V8.75V8.75H0.574219C0.227865 8.71354 0.0364583 8.52214 0 8.17578V8.17578V8.17578M11.0742 8.75V8.75V8.75V8.75C11.8216 8.07552 12.2135 7.20052 12.25 6.125C12.25 5.92448 12.2318 5.72396 12.1953 5.52344C12.5781 5.34115 12.9883 5.25 13.4258 5.25H14.5742C15.4128 5.26823 16.1055 5.55078 16.6523 6.09766C17.1992 6.64453 17.4818 7.33724 17.5 8.17578C17.4635 8.52214 17.2721 8.71354 16.9258 8.75H11.0742V8.75V8.75M6.125 6.125C6.125 5.65104 6.24349 5.21354 6.48047 4.8125V4.8125C6.71745 4.41146 7.03646 4.09245 7.4375 3.85547C7.85677 3.61849 8.29427 3.5 8.75 3.5C9.20573 3.5 9.64323 3.61849 10.0625 3.85547C10.4635 4.09245 10.7826 4.41146 11.0195 4.8125C11.2565 5.21354 11.375 5.65104 11.375 6.125C11.375 6.59896 11.2565 7.03646 11.0195 7.4375C10.7826 7.83854 10.4635 8.15755 10.0625 8.39453C9.64323 8.63151 9.20573 8.75 8.75 8.75C8.29427 8.75 7.85677 8.63151 7.4375 8.39453C7.03646 8.15755 6.71745 7.83854 6.48047 7.4375C6.24349 7.03646 6.125 6.59896 6.125 6.125V6.125V6.125M3.5 13.2617C3.51823 12.2409 3.8737 11.3841 4.56641 10.6914V10.6914C5.25911 9.9987 6.11589 9.64323 7.13672 9.625H10.3633C11.3841 9.64323 12.2409 9.9987 12.9336 10.6914C13.6263 11.3841 13.9818 12.2409 14 13.2617C13.9635 13.7174 13.7174 13.9635 13.2617 14H4.23828C3.78255 13.9635 3.53646 13.7174 3.5 13.2617V13.2617V13.2617" fill="#1877F2" />
                </svg>
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
          <div className="px-5 py-4">
            <div className="flex items-center gap-2">
              <svg width="14" height="13" viewBox="0 0 14 13" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M0 1.75C0.0182292 1.25781 0.191406 0.847656 0.519531 0.519531V0.519531V0.519531C0.847656 0.191406 1.25781 0.0182292 1.75 0H12.25V0C12.7422 0.0182292 13.1523 0.191406 13.4805 0.519531C13.8086 0.847656 13.9818 1.25781 14 1.75V10.5V10.5C13.9818 10.9922 13.8086 11.4023 13.4805 11.7305C13.1523 12.0586 12.7422 12.2318 12.25 12.25H1.75V12.25C1.25781 12.2318 0.847656 12.0586 0.519531 11.7305C0.191406 11.4023 0.0182292 10.9922 0 10.5V1.75V1.75V1.75M1.75 1.75V3.5V1.75V3.5H3.5V3.5V1.75V1.75H1.75V1.75V1.75M12.25 1.75H5.25H12.25H5.25V3.5V3.5H12.25V3.5V1.75V1.75V1.75M1.75 5.25V7V5.25V7H3.5V7V5.25V5.25H1.75V5.25V5.25M12.25 5.25H5.25H12.25H5.25V7V7H12.25V7V5.25V5.25V5.25M1.75 8.75V10.5V8.75V10.5H3.5V10.5V8.75V8.75H1.75V8.75V8.75M12.25 8.75H5.25H12.25H5.25V10.5V10.5H12.25V10.5V8.75V8.75V8.75" fill="#2563EB" />
              </svg>
              <h2 className="text-sm font-bold text-[#0F172A]">Danh sách Fanpage</h2>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
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
                  <th className="w-24 px-2 py-2.5 text-center">Chạy AI</th>
                  <th className="px-3 py-2.5">Tên Fanpage</th>
                  <th className="w-[240px] px-5 py-2.5 leading-4">Từ khóa tìm kiếm ảnh /<br />Chủ đề viết bài</th>
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
                            className={`mx-auto flex size-5 items-center justify-center rounded-[5px] ${
                              checked ? "bg-[#22C55E] text-white" : "border border-[#CBD5E1] bg-white"
                            }`}
                          >
                            {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                          </button>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-3">
                            <Photo
                              src={page.avatarUrl}
                              name={page.name}
                              tone={PAGE_TONES[index % PAGE_TONES.length]}
                              size={36}
                            />
                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={() => openPage(page)}
                                disabled={openingKey === page.key}
                                className="block max-w-full truncate text-left text-sm font-bold text-[#0F172A] hover:underline disabled:opacity-60"
                              >
                                {openingKey === page.key ? "Đang mở..." : page.name}
                              </button>
                              <p className="truncate text-[11px] text-[#94A3B8]">Nick: {page.ownerName}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <input
                            value={keywords[page.key] ?? page.name}
                            onChange={(event) =>
                              setKeywords((current) => ({ ...current, [page.key]: event.target.value }))
                            }
                            placeholder={page.name}
                            className="h-9 w-full rounded-lg border border-[#E2E8F0] px-3 text-xs text-[#334155] outline-none placeholder:text-[#94A3B8] focus:border-[#2563EB]"
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
          <span className="flex size-7 items-center justify-center rounded-lg bg-[#EFF6FF]">
            <svg width="14" height="12" viewBox="0 0 14 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M4.15625 0.165039C4.42969 0.456706 4.44792 0.766602 4.21094 1.09473L2.24219 3.28223V3.28223C2.11458 3.42806 1.95964 3.50098 1.77734 3.50098C1.57682 3.50098 1.41276 3.43717 1.28516 3.30957L0.191406 2.21582V2.21582C-0.0638021 1.90592 -0.0638021 1.59603 0.191406 1.28613C0.501302 1.03092 0.811198 1.03092 1.12109 1.28613L1.72266 1.8877V1.8877L3.22656 0.219727V0.219727C3.51823 -0.0537109 3.82812 -0.0719401 4.15625 0.165039V0.165039V0.165039M4.15625 4.54004C4.42969 4.83171 4.44792 5.1416 4.21094 5.46973L2.24219 7.65723V7.65723C2.11458 7.80306 1.95964 7.87598 1.77734 7.87598C1.57682 7.87598 1.41276 7.81217 1.28516 7.68457L0.191406 6.59082V6.59082C-0.0638021 6.28092 -0.0638021 5.97103 0.191406 5.66113C0.501302 5.40592 0.811198 5.40592 1.12109 5.66113L1.72266 6.2627V6.2627L3.22656 4.59473V4.59473C3.51823 4.32129 3.82812 4.30306 4.15625 4.54004V4.54004V4.54004M6.125 1.75098C6.125 1.49577 6.20703 1.28613 6.37109 1.12207V1.12207V1.12207C6.53516 0.958008 6.74479 0.875977 7 0.875977H13.125V0.875977C13.3802 0.875977 13.5898 0.958008 13.7539 1.12207C13.918 1.28613 14 1.49577 14 1.75098C14 2.00618 13.918 2.21582 13.7539 2.37988C13.5898 2.54395 13.3802 2.62598 13.125 2.62598H7V2.62598C6.74479 2.62598 6.53516 2.54395 6.37109 2.37988C6.20703 2.21582 6.125 2.00618 6.125 1.75098V1.75098V1.75098M6.125 6.12598C6.125 5.87077 6.20703 5.66113 6.37109 5.49707V5.49707V5.49707C6.53516 5.33301 6.74479 5.25098 7 5.25098H13.125V5.25098C13.3802 5.25098 13.5898 5.33301 13.7539 5.49707C13.918 5.66113 14 5.87077 14 6.12598C14 6.38119 13.918 6.59082 13.7539 6.75488C13.5898 6.91895 13.3802 7.00098 13.125 7.00098H7V7.00098C6.74479 7.00098 6.53516 6.91895 6.37109 6.75488C6.20703 6.59082 6.125 6.38119 6.125 6.12598V6.12598V6.12598M4.375 10.501C4.375 10.2458 4.45703 10.0361 4.62109 9.87207V9.87207V9.87207C4.78516 9.70801 4.99479 9.62598 5.25 9.62598H13.125V9.62598C13.3802 9.62598 13.5898 9.70801 13.7539 9.87207C13.918 10.0361 14 10.2458 14 10.501C14 10.7562 13.918 10.9658 13.7539 11.1299C13.5898 11.2939 13.3802 11.376 13.125 11.376H5.25V11.376C4.99479 11.376 4.78516 11.2939 4.62109 11.1299C4.45703 10.9658 4.375 10.7562 4.375 10.501V10.501V10.501M1.3125 9.18848C1.80469 9.20671 2.1875 9.42546 2.46094 9.84473C2.67969 10.2822 2.67969 10.7197 2.46094 11.1572C2.1875 11.5765 1.80469 11.7952 1.3125 11.8135C0.820312 11.7952 0.4375 11.5765 0.164062 11.1572C-0.0546875 10.7197 -0.0546875 10.2822 0.164062 9.84473C0.4375 9.42546 0.820312 9.20671 1.3125 9.18848V9.18848V9.18848" fill="#2563EB" />
            </svg>
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
                <p key={`${line}-${index}`} className="flex items-start gap-x-2 whitespace-pre-wrap break-words">
                  <span className="inline-flex h-6 shrink-0 items-center gap-2">
                    {item.time ? <span className="text-[#94A3B8]">[{item.time}]</span> : null}
                    <span className={`size-1.5 rounded-full ${tone.dot}`} />
                  </span>
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
