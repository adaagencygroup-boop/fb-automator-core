"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { getAccounts } from "@/modules/module_02_account_manager/service";
import {
  generateGroupPosts,
  getCurrentGroupCampaign,
  getGroupCampaign,
  getGroupSettings,
  runGroupCampaign,
  saveGroupSettings,
  stopGroupCampaign,
  uploadGroupMedia,
} from "../service";
import { INITIAL_POST } from "../shared/constants";
import { normalizeAccount } from "../shared/components";
import useSavedApis from "../shared/useSavedApis";
import CampaignInfoSection from "./components/CampaignInfoSection";
import GroupAccountSection from "./components/GroupAccountSection";
import GroupSettingsSection from "./components/GroupSettingsSection";
import GroupSourceSection from "./components/GroupSourceSection";
import GroupMediaSection from "./components/GroupMediaSection";
import GroupContentSection, { editorHtml } from "./components/GroupContentSection";
import GroupPostingSettingsSection from "./components/GroupPostingSettingsSection";
import GroupSummarySection from "./components/GroupSummarySection";
import GroupProgressSection from "./components/GroupProgressSection";
import GroupActionBar from "./components/GroupActionBar";

export default function GroupPostModule() {
  const editorRef = useRef(null);

  // Bước 1: Chiến dịch
  const [campaignId, setCampaignId] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [campaignName, setCampaignName] = useState("");
  const [campaignDescription, setCampaignDescription] = useState("");
  const [campaignLocked, setCampaignLocked] = useState(false);
  const [isRerun, setIsRerun] = useState(false);

  // Bước 2: Tài khoản
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [selectedAccountKeys, setSelectedAccountKeys] = useState([]);
  const [isAccountLocked, setIsAccountLocked] = useState(false);

  // Khi Bước 1 chưa xác nhận hoặc bị mở khóa, tự động mở khóa Bước 2 để đảm bảo tính tuần tự
  useEffect(() => {
    if ((!campaignLocked || !campaignName?.trim()) && isAccountLocked) {
      queueMicrotask(() => setIsAccountLocked(false));
    }
  }, [campaignLocked, campaignName, isAccountLocked]);

  // Bước 3: Cấu hình API & thông số chung
  const apiSource = useSavedApis();
  const model = apiSource.selected?.model || "gpt-4o";
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsAction, setSettingsAction] = useState("");
  const [settingsFeedback, setSettingsFeedback] = useState(null);
  const [isSettingsLocked, setIsSettingsLocked] = useState(false);
  const [confirmedApi, setConfirmedApi] = useState("");
  const apiSignature = JSON.stringify(apiSource.selected);
  const settingsConfirmed = isSettingsLocked && confirmedApi === apiSignature;
  const [threads, setThreads] = useState("2");
  const [restMinutes, setRestMinutes] = useState("10");
  const [maxPosts, setMaxPosts] = useState("10");

  // Bước 4: Nguồn nhóm
  const [groupSource, setGroupSource] = useState("search");
  const [groupFile, setGroupFile] = useState(null);
  const [customGroups, setCustomGroups] = useState([]);
  const [groupSearch, setGroupSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [selectedGroupKeys, setSelectedGroupKeys] = useState([]);

  // Bước 5: Media
  const [mediaFiles, setMediaFiles] = useState([]);
  const [savedMedia, setSavedMedia] = useState([]);
  const [minMedia, setMinMedia] = useState("1");
  const [maxMedia, setMaxMedia] = useState("4");

  // Bước 6: Nội dung AI
  const [prompt, setPrompt] = useState("");
  const [aiCount, setAiCount] = useState("5");
  const [posts, setPosts] = useState(Array.from({ length: 5 }, (_, index) => (index === 0 ? INITIAL_POST : "")));
  const [activePost, setActivePost] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);

  // Bước 7: Cài đặt đăng bài
  const [avoidDuplicate, setAvoidDuplicate] = useState(false);
  const [shuffleContent, setShuffleContent] = useState(true);
  const [delayMin, setDelayMin] = useState("30");
  const [delayMax, setDelayMax] = useState("60");
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("08:00");

  // Bước 9: Tiến trình thực thi
  const [runState, setRunState] = useState("idle");
  const [campaignProgress, setCampaignProgress] = useState(null);

  // Đọc cấu hình chạy lại từ sessionStorage
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("fb_rerun_campaign");
      if (stored) {
        const data = JSON.parse(stored);
        queueMicrotask(() => {
          if (data.action_type !== "POST") return;
          if (data.campaign_id) setCampaignId(data.campaign_id);
          if (data.name) setCampaignName(data.name);
          if (data.description) setCampaignDescription(data.description);
          setIsRerun(true);

          const cfg = data.config || {};
          if (cfg.account_uids?.length) {
            setSelectedAccountKeys(cfg.account_uids);
          }
          if (cfg.groups?.length) {
            setCustomGroups(cfg.groups);
            setSelectedGroupKeys(cfg.groups.map((g) => g.key || g.url));
          }
          if (cfg.posts?.length) {
            setPosts(cfg.posts);
          }
          setSavedMedia(cfg.media || []);
          if (cfg.settings) {
            if (cfg.settings.max_posts !== undefined) setMaxPosts(String(cfg.settings.max_posts));
            if (cfg.settings.avoid_duplicate !== undefined) setAvoidDuplicate(Boolean(cfg.settings.avoid_duplicate));
            if (cfg.settings.shuffle_content !== undefined) setShuffleContent(Boolean(cfg.settings.shuffle_content));
            if (cfg.settings.threads) setThreads(String(cfg.settings.threads));
            if (cfg.settings.rest_minutes !== undefined) setRestMinutes(String(cfg.settings.rest_minutes));
            if (cfg.settings.delay_min !== undefined) setDelayMin(String(cfg.settings.delay_min));
            if (cfg.settings.delay_max !== undefined) setDelayMax(String(cfg.settings.delay_max));
          }
          // Theo SRS: "Hẹn giờ cũ đã qua phải chọn lại"
          setScheduleEnabled(false);
          setScheduleDate("");

          toast.info(
            `Đã nạp lại cấu hình từ chiến dịch "${data.name}". Vui lòng rà soát lại các bước trước khi bắt đầu.`,
            "CHẾ ĐỘ CHẠY LẠI"
          );
        });
      }
    } catch (e) {
      console.warn("Lỗi đọc cấu hình chạy lại:", e);
    }
  }, []);

  const loadAccounts = async () => {
    setAccountsLoading(true);
    try {
      const data = await getAccounts();
      const rawList = Array.isArray(data) ? data : (data?.accounts || []);
      const rows = rawList.map(normalizeAccount);
      setAccounts(rows);
      const rerun = JSON.parse(sessionStorage.getItem("fb_rerun_campaign") || "null");
      if (rerun?.action_type === "POST" && rerun.config?.account_uids) {
        setSelectedAccountKeys(rows.filter((account) => rerun.config.account_uids.includes(account.uid)).map((account) => account.key));
        return;
      }
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
        const rerun = JSON.parse(sessionStorage.getItem("fb_rerun_campaign") || "null");
        if (rerun?.action_type === "POST") return;
        setThreads(String(data.threads));
        setRestMinutes(String(data.rest_minutes));
        setMaxPosts(String(data.max_posts));
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

  // Khôi phục chiến dịch đang chạy khi người dùng đổi tab hoặc tải lại giao diện.
  useEffect(() => {
    let cancelled = false;
    getCurrentGroupCampaign()
      .then((job) => {
        if (cancelled || !job?.job_id || job.action_type !== "POST") return;
        const terminal = ["COMPLETED", "PARTIAL", "STOPPED", "CANCELLED", "FAILED"].includes(job.status);
        setCampaignProgress(job);
        if (!terminal) {
          setJobId(job.job_id);
          setCampaignId(job.campaign_id);
          setRunState(job.status === "QUEUED" ? "starting" : "running");
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Polling tiến trình khi có chiến dịch đang chạy
  useEffect(() => {
    if (!jobId) return undefined;
    let cancelled = false;
    let timer;
    const poll = async () => {
      try {
        const job = await getGroupCampaign(jobId);
        if (cancelled) return;
        setCampaignProgress(job);
        const terminal = ["COMPLETED", "PARTIAL", "STOPPED", "CANCELLED", "FAILED"].includes(job.status);
        if (terminal) {
          setRunState("idle");
          setJobId(null);
          if (job.status === "COMPLETED") toast.success(job.message, "HOÀN TẤT CHIẾN DỊCH");
          else if (job.status === "STOPPED") toast.info(job.message, "ĐÃ DỪNG CHIẾN DỊCH");
          else toast.error(job.message, "CHIẾN DỊCH KẾT THÚC");
          return;
        }
        setRunState(job.status === "QUEUED" ? "starting" : "running");
        timer = window.setTimeout(poll, 1000);
      } catch (error) {
        if (!cancelled) {
          setSettingsFeedback({ type: "error", message: error.message || "Mất kết nối khi theo dõi chiến dịch" });
          timer = window.setTimeout(poll, 3000);
        }
      }
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [jobId]);

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
  const hasApiKey = Boolean(apiSource.selected) && !apiSource.loading;

  const liveAccountsCount = useMemo(() => {
    return selectedAccounts.filter((acc) => acc.status === "LIVE").length;
  }, [selectedAccounts]);

  const modelDisplayName = useMemo(() => {
    if (model === "deepseek-v4-flash" || model === "deepseek-flash") return "DeepSeek V4 Flash";
    if (model === "gpt-4o") return "OpenAI GPT-4o";
    if (model === "gpt-4o-mini") return "OpenAI GPT-4o mini";
    if (model?.startsWith("gemini-")) {
      return model.split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
    }
    return apiSource.selected?.hint ? `${model} (${apiSource.selected.hint})` : model;
  }, [model, apiSource.selected]);

  const normalizedSettings = () => {
    const values = {
      model,
      credential_id: apiSource.selectedId,
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
    if (!hasApiKey) throw new Error("Hãy chọn API đã cấu hình trong Hồ sơ cá nhân.");
    return values;
  };

  const handleSaveSettings = async (shouldScroll = true) => {
    setSettingsAction("saving");
    setSettingsFeedback(null);
    try {
      await saveGroupSettings(normalizedSettings());
      setSettingsFeedback({ type: "success", message: "Đã lưu cấu hình trên máy này" });
      toast.success("Đã lưu cấu hình trên máy này thành công.", "LƯU THÀNH CÔNG");
      setIsSettingsLocked(true);
      setConfirmedApi(apiSignature);

      if (shouldScroll) {
        setTimeout(() => {
          const step3Element = document.getElementById("step-4-group-source");
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
        credential_id: apiSource.selectedId,
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

  const appendCampaignLog = (level, message) => {
    setCampaignProgress((current) => ({
      ...(current || {}),
      logs: [
        ...(current?.logs || []),
        { time: new Date().toISOString().slice(0, 19), level, message },
      ],
    }));
  };

  const handleStart = async () => {
    const trimmedCampaignName = (campaignName || "").trim();
    if (!trimmedCampaignName) {
      toast.warning("Vui lòng nhập Tên chiến dịch ở Bước 1 trước khi bắt đầu!", "THIẾU TÊN CHIẾN DỊCH");
      const el = document.getElementById("step-1-campaign");
      if (el) el.scrollIntoView({ behavior: "smooth" });
      return;
    }

    if (!selectedAccounts.length || !hasGroups || !hasApiKey) {
      toast.warning("Vui lòng chọn tài khoản, nguồn nhóm và cấu hình API trước khi bắt đầu!", "THIẾU CẤU HÌNH");
      return;
    }

    const activeGroups = groupSource === "file" && groupFile?.groups?.length ? groupFile.groups : selectedGroups;
    if (selectedAccounts.length > activeGroups.length) {
      toast.error(
        `Chưa đủ số lượng nhóm. Bạn đã chọn ${selectedAccounts.length} tài khoản nhưng chỉ có ${activeGroups.length} nhóm. Vui lòng chọn thêm nhóm hoặc giảm số tài khoản để số tài khoản không lớn hơn số nhóm.`,
        "QUY TẮC PHÂN BỔ (A ≤ G)"
      );
      const el = document.getElementById("step-4-group-source");
      if (el) el.scrollIntoView({ behavior: "smooth" });
      return;
    }

    setRunState("starting");
    setCampaignProgress({
      status: "QUEUED",
      logs: [{
        time: new Date().toISOString().slice(0, 19),
        level: "INFO",
        message: `Đã nhận lệnh bắt đầu chiến dịch "${trimmedCampaignName}", đang chuẩn bị cấu hình...`,
      }],
    });
    try {
      if (!settingsConfirmed) {
        appendCampaignLog("INFO", "Đang kiểm tra và lưu cấu hình Module 7...");
        const saved = await handleSaveSettings(false);
        if (!saved) throw new Error("Cấu hình chưa hợp lệ");
      }
      appendCampaignLog("SUCCESS", `Đã chuẩn bị ${selectedAccounts.length} tài khoản và nguồn nhóm.`);
      let savedMediaPaths = [];
      if (mediaFiles.length > 0) {
        appendCampaignLog("INFO", `Đang tải lên ${mediaFiles.length} tệp media...`);
        setSettingsFeedback({ type: "info", message: `Đang tải lên ${mediaFiles.length} tệp media lên hệ thống...` });
        const formData = new FormData();
        mediaFiles.forEach((file) => {
          formData.append("files", file);
        });
        const uploadRes = await uploadGroupMedia(formData);
        if (uploadRes?.files?.length) {
          savedMediaPaths = uploadRes.files.map((f) => f.path || f.relative_path);
          appendCampaignLog("SUCCESS", `Đã tải lên ${savedMediaPaths.length} tệp media.`);
        }
      }

      appendCampaignLog("INFO", `Đang gửi chiến dịch ${selectedAccounts.length} tài khoản × ${activeGroups.length} nhóm tới worker...`);
      const campaign = await runGroupCampaign({
        campaign_id: campaignId || undefined,
        name: trimmedCampaignName,
        description: campaignDescription || undefined,
        action_type: "POST",
        account_ids: selectedAccounts.map((account) => account.id),
        account_uids: selectedAccounts.map((account) => account.uid),
        groups: activeGroups,
        posts,
        media: [...savedMedia, ...savedMediaPaths],
        settings: {
          model,
          credential_id: apiSource.selectedId,
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
      setJobId(campaign.job_id);
      setCampaignId(campaign.campaign_id);
      setCampaignProgress(campaign);
      setRunState(campaign.status === "QUEUED" ? "starting" : "running");
      sessionStorage.removeItem("fb_rerun_campaign");
      setIsRerun(false);
      toast.success("Đã khởi động chiến dịch đăng bài nhóm thành công!", "BẮT ĐẦU CHIẾN DỊCH");
    } catch (error) {
      appendCampaignLog("ERROR", error.message || "Không thể bắt đầu chiến dịch");
      setSettingsFeedback({ type: "error", message: error.message || "Không thể bắt đầu chiến dịch" });
      setRunState("idle");
    }
  };

  const handleStop = async () => {
    if (!jobId) return;
    try {
      setRunState("stopping");
      const job = await stopGroupCampaign(jobId);
      setCampaignProgress(job);
      toast.info("Hệ thống sẽ dừng sau thao tác Facebook hiện tại.", "ĐANG DỪNG");
    } catch (error) {
      setSettingsFeedback({ type: "error", message: error.message || "Không thể dừng chiến dịch" });
      setRunState("running");
    }
  };

  const canStart = runState === "idle" && selectedAccounts.length > 0 && hasGroups && hasApiKey && !settingsLoading;

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

      {/* Bước 1: Tạo chiến dịch */}
      <CampaignInfoSection
        campaignName={campaignName}
        setCampaignName={setCampaignName}
        campaignDescription={campaignDescription}
        setCampaignDescription={setCampaignDescription}
        campaignId={campaignId}
        isLocked={campaignLocked}
        setIsLocked={setCampaignLocked}
        isRerun={isRerun}
        stepNumber="1"
        onContinue={() => {
          const el = document.getElementById("step-2-accounts");
          if (el) el.scrollIntoView({ behavior: "smooth" });
        }}
      />

      {/* Bước 2: Chọn tài khoản / người dùng đi seeding */}
      <div id="step-2-accounts" className="scroll-mt-6">
        <GroupAccountSection
          stepNumber="2"
          accounts={accounts}
          accountsLoading={accountsLoading}
          selectedAccountKeys={selectedAccountKeys}
          setSelectedAccountKeys={setSelectedAccountKeys}
          onRefreshAccounts={loadAccounts}
          isLocked={isAccountLocked}
          setIsLocked={setIsAccountLocked}
          isStep1Completed={Boolean(campaignLocked && campaignName?.trim())}
          onContinue={() => {
            const el = document.getElementById("step-3-settings");
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
      </div>

      {/* Bước 3: Cấu hình API & thông số chung */}
      <div id="step-3-settings" className="scroll-mt-6">
        <GroupSettingsSection
          stepNumber="3"
          apiSource={apiSource}
          threads={threads}
          setThreads={setThreads}
          restMinutes={restMinutes}
          setRestMinutes={setRestMinutes}
          settingsLoading={settingsLoading}
          settingsAction={settingsAction}
          settingsFeedback={settingsFeedback}
          onSaveSettings={handleSaveSettings}
          isLocked={settingsConfirmed}
          setIsLocked={setIsSettingsLocked}
        />
      </div>

      {/* Bước 4: Nguồn nhóm */}
      <div id="step-4-group-source" className="scroll-mt-6">
        <GroupSourceSection
          stepNumber="4"
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

        {/* Cảnh báo A > G theo quy tắc nghiệp vụ 1.4.4 & SG-BR-05 */}
        {selectedAccounts.length > activeGroupsCount && (
          <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50/90 p-4 shadow-xs">
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-5 shrink-0 text-amber-600 mt-0.5" />
              <div className="flex-1 text-xs">
                <p className="font-bold text-amber-900">
                  Chưa đủ số lượng nhóm. Bạn đã chọn {selectedAccounts.length} tài khoản nhưng chỉ có {activeGroupsCount} nhóm.
                </p>
                <p className="mt-1 text-amber-800 leading-relaxed">
                  Vui lòng chọn thêm nhóm hoặc giảm số tài khoản để số tài khoản không lớn hơn số nhóm (A ≤ G).
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const el = document.getElementById("step-4-group-source");
                      if (el) el.scrollIntoView({ behavior: "smooth" });
                    }}
                    className="border-amber-300 bg-white text-xs font-semibold text-amber-800 hover:bg-amber-100"
                  >
                    + Chọn thêm nhóm
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      const trimmed = selectedAccountKeys.slice(0, activeGroupsCount);
                      setSelectedAccountKeys(trimmed);
                      toast.info(`Đã tự động giảm số tài khoản xuống ${trimmed.length} tài khoản để bằng số nhóm.`, "ĐIỀU CHỈNH SỐ LƯỢNG");
                    }}
                    className="bg-amber-600 text-xs font-semibold text-white hover:bg-amber-700"
                  >
                    - Giảm số tài khoản
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bước 5: Chọn media */}
      <div id="step-5-media" className="scroll-mt-6">
        <GroupMediaSection
          stepNumber="5"
          mediaFiles={mediaFiles}
          setMediaFiles={setMediaFiles}
          minMedia={minMedia}
          setMinMedia={setMinMedia}
          maxMedia={maxMedia}
          setMaxMedia={setMaxMedia}
        />
      </div>

      {/* Bước 6: Tạo nội dung bằng AI */}
      <div id="step-6-content" className="scroll-mt-6">
        <GroupContentSection
          stepNumber="6"
          prompt={prompt}
          setPrompt={setPrompt}
          aiCount={aiCount}
          setAiCount={setAiCount}
          posts={posts}
          setPosts={setPosts}
          activePost={activePost}
          setActivePost={setActivePost}
          isGenerating={isGenerating}
          onGeneratePosts={generatePosts}
          editorRef={editorRef}
        />
      </div>

      {/* Bước 7: Cài đặt đăng bài */}
      <div id="step-7-posting" className="scroll-mt-6">
        <GroupPostingSettingsSection
          stepNumber="7"
          scheduleEnabled={scheduleEnabled}
          setScheduleEnabled={setScheduleEnabled}
          avoidDuplicate={avoidDuplicate}
          setAvoidDuplicate={setAvoidDuplicate}
          shuffleContent={shuffleContent}
          setShuffleContent={setShuffleContent}
          delayMin={delayMin}
          setDelayMin={setDelayMin}
          delayMax={delayMax}
          setDelayMax={setDelayMax}
          scheduleDate={scheduleDate}
          setScheduleDate={setScheduleDate}
          scheduleTime={scheduleTime}
          setScheduleTime={setScheduleTime}
        />
      </div>

      {/* Bước 8: Thông tin cấu hình tổng hợp */}
      <div id="step-8-summary" className="scroll-mt-6">
        <GroupSummarySection
          stepNumber="8"
          campaignName={campaignName}
          campaignId={campaignId}
          selectedAccountsCount={selectedAccounts.length}
          liveAccountsCount={liveAccountsCount}
          maxPosts={maxPosts}
          totalPlanned={totalPlanned}
          hasApiKey={hasApiKey}
          modelDisplayName={modelDisplayName}
          generatedCount={generatedCount}
          postsCount={posts.length}
          groupSource={groupSource}
          groupSearch={groupSearch}
          groupFileName={groupFile?.name}
          activeGroupsCount={activeGroupsCount}
          mediaFilesCount={mediaFiles.length}
          minMedia={minMedia}
          maxMedia={maxMedia}
          threads={threads}
          delayMin={delayMin}
          delayMax={delayMax}
          restMinutes={restMinutes}
          scheduleEnabled={scheduleEnabled}
          scheduleDate={scheduleDate}
          scheduleTime={scheduleTime}
        />
      </div>

      {/* Bước 9: Tiến trình */}
      <div id="step-9-progress" className="scroll-mt-6">
        <GroupProgressSection
          stepNumber="9"
          runState={runState}
          campaignProgress={campaignProgress}
        />
      </div>

      {/* Sticky Bottom Action Bar */}
      <GroupActionBar
        runState={runState}
        canStart={canStart}
        onStart={handleStart}
        onStop={handleStop}
      />
    </div>
  );
}
