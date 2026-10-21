"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Sparkles,
  RotateCcw,
  Plus,
  Play,
  Square,
  RefreshCw,
  Clock3,
  CalendarDays,
  ListFilter,
  Users,
  Search,
  Check,
  Info,
  ImageIcon,
  Bold,
  Italic,
  Underline,
  List,
  Link2,
  Undo2,
  Redo2,
  ListOrdered,
  Minus,
  X,
  Film,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { getAccounts } from "@/modules/module_02_account_manager/service";
import {
  generateGroupPosts,
  getGeminiModels,
  getGroupSettings,
  runGroupCampaign,
  saveGroupSettings,
  testGroupAiConnection,
  uploadGroupMedia,
} from "../service";
import {
  INITIAL_POST,
} from "../shared/constants";
import {
  SectionCard,
  Field,
  SelectField,
  CheckLabel,
  normalizeAccount,
} from "../shared/components";
import GroupAccountSection from "./components/GroupAccountSection";
import GroupSettingsSection from "./components/GroupSettingsSection";
import GroupSourceSection from "./components/GroupSourceSection";

const DEFAULT_GEMINI_MODELS = [
  { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
  { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash" },
  { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash" },
  { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
  { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite" },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (quyền truy cập cũ)" },
  { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash-Lite (quyền truy cập cũ)" },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro (quyền truy cập cũ)" },
];

const getProvider = (m) => {
  if (m === "gemini" || m?.startsWith("gemini-")) return "gemini";
  if (m?.startsWith("deepseek")) return "deepseek";
  return "openai";
};

// Nút toolbar dùng chung, giữ vùng chọn trong editor khi bấm.
function EditorButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="rounded p-1.5 hover:bg-white hover:text-primary"
    >
      {React.cloneElement(children, { className: "size-3.5" })}
    </button>
  );
}

// Chuyển văn bản thường thành HTML và chỉ giữ các thẻ editor hỗ trợ.
function editorHtml(value = "") {
  const content = String(value);
  if (!/<\/?(?:p|div|h[23]|blockquote|ul|ol|li|br|hr|b|strong|i|em|u|a|img)\b/i.test(content)) {
    return content.split("\n").map((line) => line.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")).join("<br>");
  }
  const parsed = new DOMParser().parseFromString(content, "text/html");
  const allowed = new Set(["P", "DIV", "H2", "H3", "BLOCKQUOTE", "UL", "OL", "LI", "BR", "HR", "B", "STRONG", "I", "EM", "U", "A", "IMG"]);
  const clean = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (!allowed.has(child.tagName)) {
          child.replaceWith(...Array.from(child.childNodes));
          continue;
        }
        const originalHref = child.getAttribute("href");
        const originalSrc = child.getAttribute("src");
        for (const attr of Array.from(child.attributes)) child.removeAttribute(attr.name);
        if (child.tagName === "A") {
          if (originalHref && /^https?:\/\//i.test(originalHref)) {
            child.setAttribute("href", originalHref);
            child.setAttribute("target", "_blank");
            child.setAttribute("rel", "noopener noreferrer");
          }
        }
        if (child.tagName === "IMG") {
          if (originalSrc && /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(originalSrc)) {
            child.setAttribute("src", originalSrc);
            child.setAttribute("alt", "Ảnh đính kèm");
          } else {
            child.remove();
            continue;
          }
        }
        clean(child);
      }
    }
  };
  clean(parsed.body);
  return parsed.body.innerHTML;
}

export default function GroupPostModule() {
  const mediaInputRef = useRef(null);
  const editorRef = useRef(null);
  const inlineImageRef = useRef(null);

  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [selectedAccountKeys, setSelectedAccountKeys] = useState([]);
  const [model, setModel] = useState("gpt-4o");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [providerStatus, setProviderStatus] = useState({});
  const [geminiModels, setGeminiModels] = useState(DEFAULT_GEMINI_MODELS);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsAction, setSettingsAction] = useState("");
  const [settingsFeedback, setSettingsFeedback] = useState(null);
  const [isAccountLocked, setIsAccountLocked] = useState(false);
  const [isSettingsLocked, setIsSettingsLocked] = useState(false);
  const [threads, setThreads] = useState("2");
  const [restMinutes, setRestMinutes] = useState("10");
  const [maxPosts, setMaxPosts] = useState("10");
  const [groupSource, setGroupSource] = useState("search");
  const [groupFile, setGroupFile] = useState(null);
  const [customGroups, setCustomGroups] = useState([]);
  const [groupSearch, setGroupSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [selectedGroupKeys, setSelectedGroupKeys] = useState([]);
  const [mediaFiles, setMediaFiles] = useState([]);
  const [minMedia, setMinMedia] = useState("1");
  const [maxMedia, setMaxMedia] = useState("4");
  const [prompt, setPrompt] = useState("");
  const [aiCount, setAiCount] = useState("5");
  const [posts, setPosts] = useState(Array.from({ length: 5 }, (_, index) => (index === 0 ? INITIAL_POST : "")));
  // Giữ bản mới nhất để nạp đúng nội dung khi chuyển tab mà không làm mất caret lúc gõ.
  const postsRef = useRef(posts);
  postsRef.current = posts;
  const linkRangeRef = useRef(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState("");
  const [activePost, setActivePost] = useState(0);
  const [avoidDuplicate, setAvoidDuplicate] = useState(false);
  const [shuffleContent, setShuffleContent] = useState(true);
  const [delayMin, setDelayMin] = useState("30");
  const [delayMax, setDelayMax] = useState("60");
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("08:00");
  const [runState, setRunState] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);

  const loadAccounts = async () => {
    setAccountsLoading(true);
    try {
      const data = await getAccounts();
      const rawList = Array.isArray(data) ? data : (data?.accounts || []);
      const rows = rawList.map(normalizeAccount);
      setAccounts(rows);
      setSelectedAccountKeys((current) => {
        const validKeys = new Set(rows.map((account) => account.key));
        const filteredCurrent = current.filter((key) => validKeys.has(key));
        if (filteredCurrent.length > 0) return filteredCurrent;
        // Ưu tiên chọn tối đa 4 tài khoản không bị DIE
        const preferredKeys = rows.filter((account) => account.status !== "DIE").slice(0, 4).map((account) => account.key);
        return preferredKeys.length > 0 ? preferredKeys : rows.slice(0, 4).map((account) => account.key);
      });
    } catch (err) {
      console.warn("Lỗi nạp tài khoản từ Module 2:", err);
      setAccounts([]);
      setSelectedAccountKeys([]);
    } finally {
      setAccountsLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(loadAccounts);
    Promise.resolve().then(getGroupSettings)
      .then((data) => {
        if (cancelled) return;
        setModel(data.model);
        if (data.model?.startsWith("gemini-")) {
          setGeminiModels((current) => current.some((item) => item.id === data.model)
            ? current
            : [{ id: data.model, name: data.model }, ...current]);
        }
        setThreads(String(data.threads));
        setRestMinutes(String(data.rest_minutes));
        setMaxPosts(String(data.max_posts));
        setProviderStatus(data.providers || {});
        const activeProv = getProvider(data.model);
        const initialKey = data.api_key || data.providers?.[activeProv]?.key || "";
        if (initialKey) {
          setApiKey(initialKey);
        }
        if (data.providers?.[activeProv]?.configured) {
          setIsSettingsLocked(true);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setSettingsFeedback({ type: "error", title: "Lỗi nạp cấu hình", message: error.message || "Không đọc được cấu hình local" });
      })
      .finally(() => {
        if (!cancelled) setSettingsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const currentGroupPool = useMemo(() => {
    if (groupSource === "file" && groupFile?.groups?.length) {
      return groupFile.groups;
    }
    return customGroups || [];
  }, [groupSource, groupFile, customGroups]);

  const selectedAccounts = accounts.filter((account) => selectedAccountKeys.includes(account.key));
  const selectedGroups = currentGroupPool.filter((group) => selectedGroupKeys.includes(group.key));
  const hasGroups = selectedGroups.length > 0 || (groupSource === "file" ? Boolean(groupFile) : false);
  const activeGroupsCount = groupSource === "file" ? (groupFile?.validGroupsCount || selectedGroups.length) : selectedGroups.length;
  const generatedCount = posts.filter((post) => post.trim()).length;
  const totalPlanned = Math.min(Number(maxPosts) || 0, activeGroupsCount * Math.max(selectedAccounts.length, 1));
  const activeProvider = getProvider(model);
  const savedKey = providerStatus[activeProvider];
  const hasApiKey = Boolean(apiKey.trim() || savedKey?.configured);

  const liveAccountsCount = useMemo(() => {
    return selectedAccounts.filter((acc) => acc.status === "LIVE").length;
  }, [selectedAccounts]);

  const modelDisplayName = useMemo(() => {
    if (model === "deepseek-v4-flash" || model === "deepseek-flash") return "DeepSeek V4 Flash";
    if (model === "gpt-4o") return "OpenAI GPT-4o";
    if (model === "gpt-4o-mini") return "OpenAI GPT-4o mini";
    const found = geminiModels?.find((item) => item.id === model);
    if (found) return found.name;
    if (model?.startsWith("gemini-")) {
      return model.split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
    }
    return model;
  }, [model, geminiModels]);

  const normalizedSettings = () => {
    const values = {
      model,
      api_key: apiKey.trim() || null,
      threads: Number(threads),
      rest_minutes: Number(restMinutes),
      max_posts: Number(maxPosts),
    };
    if (!Number.isInteger(values.threads) || values.threads < 1 || values.threads > 10) {
      throw new Error("Số luồng phải là số nguyên từ 1 đến 10");
    }
    if (!Number.isInteger(values.rest_minutes) || values.rest_minutes < 0 || values.rest_minutes > 1440) {
      throw new Error("Thời gian nghỉ phải là số nguyên từ 0 đến 1440 phút");
    }
    if (!Number.isInteger(values.max_posts) || values.max_posts < 1 || values.max_posts > 1000) {
      throw new Error("Max bài phải là số nguyên từ 1 đến 1000");
    }
    if (!values.api_key && !providerStatus[activeProvider]?.configured) {
      const provName = activeProvider === "deepseek" ? "DeepSeek" : activeProvider === "gemini" ? "Google Gemini" : "OpenAI";
      throw new Error(`Vui lòng nhập API Key cho ${provName} trước khi lưu cấu hình.`);
    }
    return values;
  };

  const handleModelChange = (event) => {
    const newModel = event?.target?.value || event;
    setModel(newModel);
    const newProvider = getProvider(newModel);
    const existingKey = providerStatus?.[newProvider]?.key || "";
    setApiKey(existingKey);
    setShowApiKey(false);
    setSettingsFeedback(null);
  };

  const handleSaveSettings = async (shouldScroll = true) => {
    setSettingsAction("saving");
    setSettingsFeedback(null);
    try {
      const result = await saveGroupSettings(normalizedSettings());
      setProviderStatus(result.providers || {});
      const activeProv = getProvider(model);
      const savedKeyVal = result.api_key || result.providers?.[activeProv]?.key || apiKey.trim();
      setApiKey(savedKeyVal);
      setShowApiKey(false);
      setSettingsFeedback({ type: "success", message: "Đã lưu cấu hình trên máy này" });
      toast.success("Đã lưu cấu hình trên máy này thành công.", "LƯU THÀNH CÔNG");
      setIsSettingsLocked(true);

      if (shouldScroll) {
        setTimeout(() => {
          const step3Element = document.getElementById("step-3-group-source");
          if (step3Element) {
            step3Element.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 120);
      }

      return true;
    } catch (error) {
      setSettingsFeedback({ type: "error", title: "Lỗi lưu cấu hình", message: error.message || "Không thể lưu cấu hình" });
      return false;
    } finally {
      setSettingsAction("");
    }
  };

  const handleTestApi = async () => {
    setSettingsAction("testing");
    setSettingsFeedback(null);
    try {
      if (!hasApiKey) throw new Error("Hãy nhập API Key trước khi kiểm tra");
      const result = await testGroupAiConnection({ model, api_key: apiKey.trim() || null });
      setSettingsFeedback({ type: "success", message: result.message || "Kết nối API thành công" });
      toast.success(result.message || "Kết nối API thành công!", "KIỂM TRA THÀNH CÔNG");
    } catch (error) {
      setSettingsFeedback({ type: "error", title: "Lỗi kiểm tra API", message: error.message || "API Key không hợp lệ" });
    } finally {
      setSettingsAction("");
    }
  };

  const handleLoadGeminiModels = async () => {
    setSettingsAction("loading-models");
    setSettingsFeedback(null);
    try {
      if (!apiKey.trim() && !providerStatus.gemini?.configured) {
        throw new Error("Hãy nhập Google AI Studio API Key trước khi tải model");
      }
      const result = await getGeminiModels({ api_key: apiKey.trim() || null });
      setGeminiModels(result.models);
      if (!result.models.some((item) => item.id === model)) {
        setModel(result.models[0].id);
      }
      setSettingsFeedback({
        type: "success",
        message: `Đã tải ${result.count} model khả dụng từ Google AI Studio`,
      });
      toast.success(`Đã tải ${result.count} model khả dụng từ Google AI Studio.`, "TẢI MODEL THÀNH CÔNG");
    } catch (error) {
      setSettingsFeedback({
        type: "error",
        title: "Lỗi tải model Google",
        message: error.message || "Không tải được danh sách model Google",
      });
    } finally {
      setSettingsAction("");
    }
  };

  const handleFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    setMediaFiles((prev) => {
      const merged = [...prev, ...incoming].slice(0, 10);
      return merged;
    });
  };

  const handleRemoveMedia = (indexToRemove) => {
    setMediaFiles((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleClearAllMedia = () => {
    setMediaFiles([]);
    if (mediaInputRef.current) {
      mediaInputRef.current.value = "";
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes && bytes !== 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const generatePosts = async () => {
    const amount = Math.max(1, Math.min(10, Number(aiCount) || 1));
    if (!prompt.trim()) {
      setSettingsFeedback({ type: "error", message: "Hãy nhập chủ đề/mô tả trước khi tạo nội dung" });
      return;
    }
    if (!hasApiKey) {
      setSettingsFeedback({ type: "error", message: "Chưa cấu hình API Key cho model đã chọn" });
      return;
    }
    setIsGenerating(true);
    setSettingsFeedback(null);
    try {
      const result = await generateGroupPosts({
        model,
        api_key: apiKey.trim() || null,
        prompt: prompt.trim(),
        count: amount,
      });
      setPosts(result.posts);
      setActivePost(0);
      if (editorRef.current) editorRef.current.innerHTML = editorHtml(result.posts[0] || "");
      setSettingsFeedback({ type: "success", message: `Đã tạo ${result.count} bài bằng ${model}` });
    } catch (error) {
      setSettingsFeedback({ type: "error", message: error.message || "Không thể tạo nội dung AI" });
    } finally {
      setIsGenerating(false);
    }
  };

  const updateActivePost = (value) => {
    setPosts((current) => current.map((post, index) => (index === activePost ? value : post)));
  };

  // Nạp lại nội dung tương ứng khi người dùng chuyển tab bài viết.
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = editorHtml(postsRef.current[activePost] || "");
  }, [activePost]);

  // Áp dụng định dạng tại vị trí con trỏ rồi lưu HTML vào bài hiện tại.
  const runEditorCommand = (command, value = null) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    if (editorRef.current) updateActivePost(editorRef.current.innerHTML);
  };

  // Lưu vùng chọn để gắn liên kết sau khi người dùng nhập URL trong modal.
  const openLinkDialog = () => {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    linkRangeRef.current = range && editorRef.current?.contains(range.commonAncestorContainer)
      ? range.cloneRange()
      : null;
    setLinkText(selection?.toString() || "");
    setLinkUrl("");
    setLinkError("");
    setLinkDialogOpen(true);
  };

  const applyLink = (event) => {
    event.preventDefault();
    let parsedUrl;
    try {
      parsedUrl = new URL(linkUrl.trim());
    } catch {
      setLinkError("Nhập địa chỉ URL hợp lệ.");
      return;
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      setLinkError("Liên kết phải bắt đầu bằng http:// hoặc https://.");
      return;
    }

    const editor = editorRef.current;
    const range = linkRangeRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    if (range && editor.contains(range.commonAncestorContainer)) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (range && !range.collapsed) {
      document.execCommand("createLink", false, parsedUrl.href);
    } else {
      const anchor = document.createElement("a");
      anchor.href = parsedUrl.href;
      anchor.textContent = linkText.trim() || parsedUrl.href;
      const insertionRange = range || document.createRange();
      if (!range) {
        insertionRange.selectNodeContents(editor);
        insertionRange.collapse(false);
      }
      insertionRange.deleteContents();
      insertionRange.insertNode(anchor);
      insertionRange.setStartAfter(anchor);
      insertionRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(insertionRange);
    }
    updateActivePost(editor.innerHTML);
    setLinkDialogOpen(false);
  };

  // Đọc ảnh người dùng chọn thành data URL để chèn trực tiếp vào bài.
  const insertInlineImage = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      editorRef.current?.focus();
      document.execCommand("insertImage", false, String(reader.result));
      if (editorRef.current) updateActivePost(editorRef.current.innerHTML);
    };
    reader.readAsDataURL(file);
  };

  const handleStart = async () => {
    if (!selectedAccounts.length || !hasGroups) return;
    setRunState("starting");
    setProgress(4);
    try {
      if (!isSettingsLocked) {
        const saved = await handleSaveSettings(false);
        if (!saved) throw new Error("Cấu hình chưa hợp lệ");
      }
      let savedMediaPaths = [];
      if (mediaFiles.length > 0) {
        setSettingsFeedback({ type: "info", message: `Đang tải lên ${mediaFiles.length} tệp media lên hệ thống...` });
        const formData = new FormData();
        mediaFiles.forEach((file) => {
          formData.append("files", file);
        });
        const uploadRes = await uploadGroupMedia(formData);
        if (uploadRes?.files?.length) {
          savedMediaPaths = uploadRes.files.map((f) => f.path || f.relative_path);
        }
      }

      const activeGroups = groupSource === "file" && groupFile?.groups?.length ? groupFile.groups : selectedGroups;
      await runGroupCampaign({
        action_type: "POST",
        account_ids: selectedAccounts.map((account) => account.id),
        account_uids: selectedAccounts.map((account) => account.uid),
        groups: activeGroups,
        posts,
        media: savedMediaPaths.length ? savedMediaPaths : mediaFiles.map((file) => file.name),
        settings: {
          model,
          threads: Number(threads),
          rest_minutes: Number(restMinutes),
          max_posts: Number(maxPosts),
          delay_min: Number(delayMin),
          delay_max: Number(delayMax),
          min_media: Number(minMedia) || 0,
          max_media: Number(maxMedia) || 0,
          avoid_duplicate: avoidDuplicate,
          shuffle_content: shuffleContent,
          schedule_at: scheduleEnabled && scheduleDate ? `${scheduleDate}T${scheduleTime}` : null,
        },
      });
      setRunState("running");
      setProgress(12);
      toast.success("Đã khởi động chiến dịch đăng bài nhóm thành công!", "BẮT ĐẦU CHIẾN DỊCH");
    } catch (error) {
      setSettingsFeedback({ type: "error", message: error.message || "Không thể bắt đầu chiến dịch" });
      setRunState("idle");
      setProgress(0);
    }
  };

  const handleStop = () => {
    setRunState("idle");
    setProgress(0);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-xl font-bold tracking-tight text-slate-800">
          Spam Group – Đăng bài
        </h1>
        <p className="mt-1 text-xs text-slate-400">
          Tự động tìm kiếm và đăng bài vào các hội nhóm Facebook theo từ khoá hoặc từ file link nhóm.
        </p>
      </div>

      {/* Bước 1: Chọn tài khoản / người dùng đi seeding */}
      <div id="step-1-accounts" className="scroll-mt-6">
        <GroupAccountSection
          accounts={accounts}
          accountsLoading={accountsLoading}
          selectedAccountKeys={selectedAccountKeys}
          setSelectedAccountKeys={setSelectedAccountKeys}
          onRefreshAccounts={loadAccounts}
          isLocked={isAccountLocked}
          setIsLocked={setIsAccountLocked}
        />
      </div>

      {/* Bước 2: Cấu hình API & thông số chung */}
      <div id="step-2-settings" className="scroll-mt-6">
        <GroupSettingsSection
          model={model}
          setModel={setModel}
          apiKey={apiKey}
          setApiKey={setApiKey}
          showApiKey={showApiKey}
          setShowApiKey={setShowApiKey}
          threads={threads}
          setThreads={setThreads}
          restMinutes={restMinutes}
          setRestMinutes={setRestMinutes}
          maxPosts={maxPosts}
          setMaxPosts={setMaxPosts}
          geminiModels={geminiModels}
          setGeminiModels={setGeminiModels}
          providerStatus={providerStatus}
          setProviderStatus={setProviderStatus}
          settingsLoading={settingsLoading}
          settingsAction={settingsAction}
          setSettingsAction={setSettingsAction}
          settingsFeedback={settingsFeedback}
          setSettingsFeedback={setSettingsFeedback}
          onSaveSettings={handleSaveSettings}
          onTestApi={handleTestApi}
          onLoadGeminiModels={handleLoadGeminiModels}
          onModelChange={handleModelChange}
          isLocked={isSettingsLocked}
          setIsLocked={setIsSettingsLocked}
        />
      </div>

      {/* Bước 3: Nguồn nhóm */}
      <div id="step-3-group-source" className="scroll-mt-6">
        <GroupSourceSection
          groupSource={groupSource}
          setGroupSource={setGroupSource}
          groupFile={groupFile}
          setGroupFile={setGroupFile}
          groupSearch={groupSearch}
          setGroupSearch={setGroupSearch}
          groupFilter={groupFilter}
          setGroupFilter={setGroupFilter}
          selectedGroupKeys={selectedGroupKeys}
          setSelectedGroupKeys={setSelectedGroupKeys}
          customGroups={customGroups}
          setCustomGroups={setCustomGroups}
          selectedAccountKeys={selectedAccountKeys}
          accounts={accounts}
        />
      </div>

      {/* Bước 4 */}
      <div id="step-4-media" className="scroll-mt-6">
        <SectionCard number="4" title="Chọn media (ảnh/video)">
          <div className="mb-4 flex h-9 items-center justify-center rounded-md bg-primary text-xs font-semibold text-white">
            <ImageIcon className="mr-2 size-4" /> Hình ảnh + Video
          </div>
          <input
            ref={mediaInputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            className="hidden"
            onChange={(event) => handleFiles(event.target.files)}
          />
          <button
            type="button"
            onClick={() => mediaInputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              handleFiles(event.dataTransfer.files);
            }}
            className="flex min-h-40 w-full flex-col items-center justify-center rounded-lg border border-dashed border-blue-200 bg-slate-50/60 text-center transition-colors hover:bg-blue-50/40"
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-blue-100 text-primary">
              <Plus className="size-5" />
            </span>
            <span className="mt-3 text-xs font-bold text-slate-700">
              {mediaFiles.length ? `Đã chọn ${mediaFiles.length} tệp media` : "Nhấp để tải ảnh lên hoặc kéo thả"}
            </span>
            <span className="mt-1 text-[10px] text-slate-400">Hỗ trợ JPG, PNG (tối đa 10 ảnh)</span>
          </button>
          {mediaFiles.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">
                  Tệp đã chọn ({mediaFiles.length}/10):
                </span>
                <button
                  type="button"
                  onClick={handleClearAllMedia}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-500 transition-colors hover:text-rose-700 hover:underline"
                >
                  <Trash2 className="size-3" />
                  Xoá tất cả
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
                {mediaFiles.map((file, idx) => {
                  const isVideo = file.type?.startsWith("video/") || /\.(mp4|mov|avi|mkv)$/i.test(file.name || "");
                  const previewUrl = file instanceof File ? URL.createObjectURL(file) : null;

                  return (
                    <div
                      key={`${file.name}-${idx}`}
                      className="group relative flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5 shadow-xs transition-all hover:border-blue-300 hover:shadow-sm"
                    >
                      <div className="relative aspect-square w-full overflow-hidden rounded-md bg-slate-100">
                        {isVideo && previewUrl ? (
                          <div className="relative h-full w-full bg-black">
                            <video
                              src={previewUrl}
                              muted
                              playsInline
                              controls
                              className="h-full w-full object-cover"
                              preload="metadata"
                            />
                          </div>
                        ) : previewUrl ? (
                          <img
                            src={previewUrl}
                            alt={file.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-slate-400">
                            <ImageIcon className="size-6" />
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveMedia(idx);
                          }}
                          className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-rose-500/90 text-white opacity-90 shadow-sm transition-transform hover:scale-110 hover:bg-rose-600 sm:opacity-0 sm:group-hover:opacity-100"
                          title="Xoá tệp này"
                        >
                          <X className="size-3" />
                        </button>

                        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[8px] font-medium text-white backdrop-blur-xs">
                          #{idx + 1}
                        </span>
                      </div>

                      <div className="mt-1.5 px-0.5">
                        <p className="truncate text-[10px] font-medium text-slate-700" title={file.name}>
                          {file.name}
                        </p>
                        <p className="text-[9px] text-slate-400">
                          {formatFileSize(file.size)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Tối thiểu media mỗi bài">
              <Input type="number" min="0" value={minMedia} onChange={(event) => setMinMedia(event.target.value)} />
            </Field>
            <Field label="Tối đa media mỗi bài">
              <Input type="number" min="0" value={maxMedia} onChange={(event) => setMaxMedia(event.target.value)} />
            </Field>
          </div>
        </SectionCard>
      </div>

      {/* Bước 5 */}
      <div id="step-5-content" className="scroll-mt-6">
        <SectionCard number="5" title="Tạo nội dung bằng AI">
          <div className="grid gap-4 md:grid-cols-[1fr_320px]">
            <Field label="Nội dung gốc chủ đề/mô tả">
              <div className="relative">
                <Textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  maxLength={2000}
                  placeholder="Nhập nội dung gốc để AI tạo ra các bài đăng..."
                  className="min-h-24 resize-none pb-6"
                />
                <span className="absolute bottom-2 right-3 text-[9px] text-slate-400">{prompt.length}/2000</span>
              </div>
            </Field>
            <div className="flex flex-col justify-between gap-3">
              <Field label="Số lượng bài AI tạo ra">
                <SelectField value={aiCount} onChange={(event) => setAiCount(event.target.value)}>
                  <option value="3">3</option>
                  <option value="5">5</option>
                  <option value="10">10</option>
                </SelectField>
              </Field>
              <Button type="button" onClick={generatePosts} disabled={isGenerating} className="w-full">
                <Sparkles className="mr-2 size-3.5" /> {isGenerating ? "Đang tạo nội dung..." : "Tạo nội dung AI"}
              </Button>
            </div>
          </div>

          <div className="mt-5 rounded-lg border border-slate-100 bg-slate-50/50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-slate-800">Kết quả nội dung AI ({generatedCount} bài)</p>
                <p className="text-[10px] text-slate-400">Bạn có thể chỉnh sửa nội dung trước khi đăng</p>
              </div>
              <Button type="button" size="sm" variant="outline" className="text-primary" disabled={isGenerating} onClick={generatePosts}>
                <RotateCcw className="mr-1.5 size-3.5" /> Tạo lại
              </Button>
            </div>
            <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              {posts.map((_, index) => (
                <button
                  type="button"
                  key={index}
                  onClick={() => setActivePost(index)}
                  className={`h-9 min-w-20 flex-1 text-[10px] font-semibold ${activePost === index ? "bg-primary text-white" : "text-slate-500 hover:bg-white"
                    }`}
                >
                  Bài {index + 1}
                </button>
              ))}
            </div>
            <p className="mb-2 mt-4 text-[11px] font-semibold text-slate-600">Nội dung bài {activePost + 1}</p>
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <input
                ref={inlineImageRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  insertInlineImage(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              {/* Toolbar định dạng nội dung và chèn các thành phần vào vị trí con trỏ. */}
              <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 bg-slate-50 px-3 py-2 text-slate-500">
                <EditorButton label="Hoàn tác" onClick={() => runEditorCommand("undo")}><Undo2 /></EditorButton>
                <EditorButton label="Làm lại" onClick={() => runEditorCommand("redo")}><Redo2 /></EditorButton>
                <span className="mx-1 h-5 border-l border-slate-200" />
                <select
                  aria-label="Kiểu đoạn văn"
                  defaultValue="p"
                  onChange={(event) => runEditorCommand("formatBlock", event.target.value)}
                  className="h-7 rounded border-0 bg-transparent px-1 text-[11px] text-slate-600 outline-none hover:bg-white"
                >
                  <option value="p">Đoạn văn</option>
                  <option value="h2">Tiêu đề 2</option>
                  <option value="h3">Tiêu đề 3</option>
                  <option value="blockquote">Trích dẫn</option>
                </select>
                <span className="mx-1 h-5 border-l border-slate-200" />
                <EditorButton label="Đậm" onClick={() => runEditorCommand("bold")}><Bold /></EditorButton>
                <EditorButton label="Nghiêng" onClick={() => runEditorCommand("italic")}><Italic /></EditorButton>
                <EditorButton label="Gạch chân" onClick={() => runEditorCommand("underline")}><Underline /></EditorButton>
                <span className="mx-1 h-5 border-l border-slate-200" />
                <EditorButton label="Danh sách dấu đầu dòng" onClick={() => runEditorCommand("insertUnorderedList")}><List /></EditorButton>
                <EditorButton label="Danh sách đánh số" onClick={() => runEditorCommand("insertOrderedList")}><ListOrdered /></EditorButton>
                <EditorButton label="Đường phân cách" onClick={() => runEditorCommand("insertHorizontalRule")}><Minus /></EditorButton>
                <span className="mx-1 h-5 border-l border-slate-200" />
                <EditorButton label="Chèn liên kết" onClick={openLinkDialog}><Link2 /></EditorButton>
                <EditorButton label="Chèn ảnh" onClick={() => inlineImageRef.current?.click()}><ImageIcon /></EditorButton>
              </div>
              {/* Vùng soạn thảo rich text; lưu HTML để giữ định dạng riêng từng bài. */}
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-label={`Nội dung bài ${activePost + 1}`}
                aria-multiline="true"
                onInput={(event) => updateActivePost(event.currentTarget.innerHTML)}
                onClick={(event) => {
                  const anchor = event.target.closest("a[href]");
                  if (!anchor || !event.currentTarget.contains(anchor)) return;
                  event.preventDefault();
                  window.open(anchor.href, "_blank", "noopener,noreferrer");
                }}
                onPaste={(event) => {
                  event.preventDefault();
                  const text = event.clipboardData.getData("text/plain");
                  document.execCommand("insertText", false, text);
                }}
                className="min-h-24 max-h-80 overflow-y-auto px-3 py-3 text-xs leading-5 text-slate-800 outline-none [&_a]:cursor-pointer [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:text-base [&_h3]:font-semibold [&_img]:my-2 [&_img]:max-h-40 [&_img]:max-w-full [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
              />
              <div className="px-3 pb-2 text-right text-[9px] text-slate-400">
                {editorRef.current?.innerText?.length || 0}/2000
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Bước 6 */}
      <div id="step-6-posting" className="scroll-mt-6">
        <SectionCard number="6" title="Cài đặt đăng bài">
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <CheckLabel checked={scheduleEnabled} onCheckedChange={setScheduleEnabled}>
              Bật hẹn giờ đăng bài
            </CheckLabel>
            <CheckLabel checked={avoidDuplicate} onCheckedChange={setAvoidDuplicate}>
              Không đăng trùng nội dung
            </CheckLabel>
            <CheckLabel checked={shuffleContent} onCheckedChange={setShuffleContent}>
              Đăng ngẫu nhiên nội dung (nếu có nhiều nội dung)
            </CheckLabel>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="Thời gian nghỉ giữa các lần đăng (giây)">
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min="0"
                  value={delayMin}
                  onChange={(event) => setDelayMin(event.target.value)}
                  className="text-center"
                />
                <span className="text-slate-400">–</span>
                <Input
                  type="number"
                  min="0"
                  value={delayMax}
                  onChange={(event) => setDelayMax(event.target.value)}
                  className="text-center"
                />
                <span className="text-[10px] text-slate-400">giây</span>
              </div>
            </Field>
            <Field label="Thời gian bắt đầu (tùy chọn)">
              <div className={`grid grid-cols-2 gap-3 transition-opacity ${scheduleEnabled ? "opacity-100" : "pointer-events-none opacity-40"}`}>
                <div className="relative">
                  <CalendarDays className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                  <Input
                    type="date"
                    disabled={!scheduleEnabled}
                    value={scheduleDate}
                    onChange={(event) => setScheduleDate(event.target.value)}
                    className="pl-9"
                  />
                </div>
                <div className="relative">
                  <Clock3 className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                  <Input
                    type="time"
                    disabled={!scheduleEnabled}
                    value={scheduleTime}
                    onChange={(event) => setScheduleTime(event.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
            </Field>
          </div>
        </SectionCard>
      </div>

      {/* Thông tin tác vụ cấu hình */}
      <SectionCard title="Thông tin tác vụ cấu hình" aside={<Info className="size-4 text-primary" />}>
        <div className="grid gap-x-10 gap-y-3 text-[11px] md:grid-cols-2">
          {[
            [
              <Users key="a" className="size-3.5" />,
              "Tài khoản",
              selectedAccounts.length
                ? `${selectedAccounts.length} tài khoản đã chọn${liveAccountsCount > 0 ? ` (${liveAccountsCount} Live)` : ""}`
                : "Chưa chọn tài khoản",
            ],
            [
              <ListFilter key="b" className="size-3.5" />,
              "Hạn bài",
              `${maxPosts} bài (kế hoạch ${totalPlanned} bài)`,
            ],
            [
              <Sparkles key="c" className="size-3.5" />,
              "API Key",
              hasApiKey ? `Đã cấu hình (${modelDisplayName})` : "Chưa cấu hình",
            ],
            [
              <Sparkles key="d" className="size-3.5" />,
              "Số bài AI",
              `${generatedCount} / ${posts.length} bài`,
            ],
            [
              <Search key="e" className="size-3.5" />,
              "Nguồn nhóm",
              groupSource === "search"
                ? (groupSearch ? `Từ khóa "${groupSearch}" (${activeGroupsCount} nhóm)` : `Tìm theo từ khóa (${activeGroupsCount} nhóm)`)
                : (groupFile?.name ? `${groupFile.name} (${activeGroupsCount} nhóm)` : `Từ file link nhóm (${activeGroupsCount} nhóm)`),
            ],
            [
              <ImageIcon key="f" className="size-3.5" />,
              "Min / Max media",
              mediaFiles.length
                ? `${mediaFiles.length} tệp đã chọn (${minMedia} – ${maxMedia} ảnh/bài)`
                : `${minMedia} – ${maxMedia} ảnh`,
            ],
            [<RefreshCw key="g" className="size-3.5" />, "Luồng chạy", `${threads} luồng`],
            [<Clock3 key="h" className="size-3.5" />, "Giãn cách đăng", `${delayMin} – ${delayMax} giây`],
            [<Clock3 key="i" className="size-3.5" />, "Nghỉ", `${restMinutes} phút`],
            [
              <CalendarDays key="j" className="size-3.5" />,
              "Hẹn giờ",
              scheduleEnabled ? (scheduleDate ? `${scheduleDate} ${scheduleTime}` : "Đã kích hoạt") : "Đã tắt",
            ],
          ].map(([icon, label, value]) => (
            <div key={label} className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <span className="flex items-center gap-2 text-slate-500">
                {icon}
                {label}
              </span>
              <strong
                className={
                  value?.startsWith?.("Đã cấu hình") || (label === "Hẹn giờ" && scheduleEnabled)
                    ? "text-emerald-600"
                    : value === "Chưa cấu hình" || value === "Chưa chọn tài khoản"
                    ? "text-amber-600"
                    : "text-slate-700"
                }
              >
                {value}
              </strong>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Tiến trình */}
      <Card className="min-h-64 border-slate-200 p-5 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
          <span className="flex size-5 items-center justify-center rounded bg-emerald-50 text-emerald-600">▥</span> Theo dõi tiến trình
        </div>
        {runState !== "idle" ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3">
            <Progress value={progress} className="max-w-xl" />
            <p className="text-xs font-semibold text-primary">
              {runState === "starting"
                ? "Đang khởi tạo tác vụ..."
                : `Đang thực hiện ${progress}/${Math.max(totalPlanned, 1)} tác vụ`}
            </p>
          </div>
        ) : (
          <div className="flex min-h-48 items-center justify-center text-xs text-slate-300">
            Tiến trình sẽ hiển thị sau khi bắt đầu đăng bài.
          </div>
        )}
      </Card>

      {/* Sticky Bottom Action Bar */}
      <Card className="sticky bottom-0 z-20 flex flex-col items-center justify-between gap-4 border-slate-200 bg-white/95 px-6 py-4 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur sm:flex-row">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <Check className="size-4" />
          </span>
          <div>
            <p className="text-xs font-bold text-slate-700">Sẵn sàng thực thi tiến trình đăng bài</p>
            <p className="text-[10px] text-slate-400">Hệ thống sẽ chạy tự động theo các thông số đã cấu hình ở trên</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button type="button" variant="destructive" disabled={runState === "idle"} onClick={handleStop}>
            <Square className="mr-2 size-3 fill-current" /> DỪNG ĐĂNG
          </Button>
          <Button
            type="button"
            variant="success"
            disabled={runState !== "idle" || !selectedAccounts.length || !hasGroups || !hasApiKey || settingsLoading}
            onClick={handleStart}
          >
            <Play className="mr-2 size-3.5 fill-current" /> BẮT ĐẦU ĐĂNG BÀI
          </Button>
        </div>
      </Card>
      {linkDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLinkDialogOpen(false);
          }}
        >
          <form onSubmit={applyLink} className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 className="text-sm font-bold text-slate-800">Chèn liên kết</h2>
            <p className="mt-1 text-xs text-slate-500">Liên kết sẽ gắn vào phần văn bản đang chọn.</p>
            <label className="mt-4 block text-xs font-medium text-slate-600">
              Địa chỉ liên kết
              <Input
                autoFocus
                type="text"
                inputMode="url"
                value={linkUrl}
                onChange={(event) => { setLinkUrl(event.target.value); setLinkError(""); }}
                placeholder="https://example.com"
                className="mt-1.5"
              />
            </label>
            <label className="mt-3 block text-xs font-medium text-slate-600">
              Nội dung hiển thị
              <Input
                value={linkText}
                onChange={(event) => setLinkText(event.target.value)}
                placeholder="Nhập nội dung liên kết"
                className="mt-1.5"
              />
            </label>
            {linkError && <p role="alert" className="mt-2 text-xs text-red-600">{linkError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setLinkDialogOpen(false)}>Hủy</Button>
              <Button type="submit">Chèn liên kết</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
