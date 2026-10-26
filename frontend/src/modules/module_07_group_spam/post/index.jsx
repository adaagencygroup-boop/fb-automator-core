"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

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

function StepGuard({ enabled, children }) {
  if (enabled) return children;

  return (
    <div className="pointer-events-none select-none opacity-50" aria-disabled="true">
      {children}
    </div>
  );
}

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
  const [isGroupSourceLocked, setIsGroupSourceLocked] = useState(false);

  // Bước 5: Media
  const [mediaFiles, setMediaFiles] = useState([]);
  const [savedMedia, setSavedMedia] = useState([]);
  const [minMedia, setMinMedia] = useState("1");
  const [maxMedia, setMaxMedia] = useState("4");
  const [isMediaLocked, setIsMediaLocked] = useState(false);

  // Bước 6: Nội dung bài viết (Hỗ trợ AI)
  const [prompt, setPrompt] = useState("");
  const [aiCount, setAiCount] = useState("1");
  const [posts, setPosts] = useState([INITIAL_POST]);
  const [activePost, setActivePost] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasGeneratedContent, setHasGeneratedContent] = useState(false);
  const [isContentLocked, setIsContentLocked] = useState(false);

  // Bước 7: Cài đặt đăng bài
  const [delayMin, setDelayMin] = useState("30");
  const [delayMax, setDelayMax] = useState("60");
  const [delayUnit, setDelayUnit] = useState("seconds");
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("08:00");
  const [isPostingSettingsLocked, setIsPostingSettingsLocked] = useState(false);

  // Bước 9: Tiến trình thực thi
  const [runState, setRunState] = useState("idle");
  const [campaignProgress, setCampaignProgress] = useState(null);
  const [isCompletionModalOpen, setIsCompletionModalOpen] = useState(false);
  const [completionData, setCompletionData] = useState(null);

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
            setAiCount(String(cfg.posts.length));
            setHasGeneratedContent(true);
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
<<<<<<< HEAD
          setCampaignId(null);
=======
          setJobId(null);
>>>>>>> f54b1289b8ca16cdf658e016b786d10af8cb6b72
          if (job.status === "COMPLETED" || (job.status === "PARTIAL" && job.success > 0)) {
            setCompletionData(job);
            setIsCompletionModalOpen(true);
            toast.success(job.message || "Chiến dịch đã hoàn thành thành công!", "HOÀN TẤT CHIẾN DỊCH");
          } else if (job.status === "STOPPED") {
            toast.info(job.message, "ĐÃ DỪNG CHIẾN DỊCH");
          } else {
            toast.error(job.message, "CHIẾN DỊCH KẾT THÚC");
          }
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
<<<<<<< HEAD
    const isDup = aiCount === "duplicate" || aiCount === "1" || Number(aiCount) === 1;
    const amount = isDup
=======
    const amount = aiCount === "duplicate"
>>>>>>> f54b1289b8ca16cdf658e016b786d10af8cb6b72
      ? 1
      : Math.max(1, Math.min(10, Number(aiCount) || 1));
    if (!prompt.trim()) {
      setSettingsFeedback({ type: "error", message: "Hãy nhập nội dung gốc / mô tả trước khi tạo nội dung AI" });
      toast.warning("Hãy nhập nội dung gốc trước khi tạo nội dung AI!", "THIẾU NỘI DUNG");
      return;
    }
    if (!hasApiKey) {
      setSettingsFeedback({
        type: "error",
        message: "Chưa cấu hình API Key cho model đã chọn. Bạn có thể nhấn 'Xác nhận nội dung gốc' để sử dụng trực tiếp mà không cần AI.",
      });
      toast.error("Chưa cấu hình API Key. Bạn có thể bấm 'Xác nhận nội dung gốc' để sử dụng trực tiếp!", "CHƯA CÓ API KEY");
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
      const generatedPosts = isDup ? result.posts.slice(0, 1) : result.posts;
      setPosts(generatedPosts);
      setActivePost(0);
      setHasGeneratedContent(true);
<<<<<<< HEAD
      toast.success(
        isDup
          ? "Đã tạo thành công 1 bài viết bằng AI (Trùng lặp nội dung)!"
          : `Đã tạo thành công ${generatedPosts.length} bài viết bằng AI!`,
        "TẠO NỘI DUNG THÀNH CÔNG"
      );
      setSettingsFeedback({ type: "success", message: `Đã tạo ${generatedPosts.length} bài bằng ${model}` });
=======
      toast.success(`Đã tạo thành công ${result.count} bài viết bằng AI!`, "TẠO NỘI DUNG THÀNH CÔNG");
      setSettingsFeedback({ type: "success", message: `Đã tạo ${result.count} bài bằng ${model}` });
>>>>>>> f54b1289b8ca16cdf658e016b786d10af8cb6b72
    } catch (error) {
      toast.error(error.message || "Không thể tạo nội dung AI", "LỖI TẠO NỘI DUNG");
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

    if (mediaFiles.length > 0 && Number(maxMedia) > mediaFiles.length) {
      toast.error(
        `Số lượng media tối đa mỗi bài (${maxMedia}) không được lớn hơn tổng số tệp media đã chọn (${mediaFiles.length}). Vui lòng điều chỉnh lại ở Bước 5!`,
        "LỖI CẤU HÌNH MEDIA"
      );
      const el = document.getElementById("step-5-media");
      if (el) el.scrollIntoView({ behavior: "smooth" });
      return;
    }

    setIsCompletionModalOpen(false);
    setCompletionData(null);
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

      const isDup = aiCount === "duplicate" || aiCount === "1" || Number(aiCount) === 1;
      const targetCount = isDup ? 1 : Math.max(1, Math.min(10, Number(aiCount) || 1));
      const validPosts = isDup
        ? [posts[0] || prompt.trim()]
        : posts.slice(0, targetCount).map((p) => p?.trim()).filter(Boolean);
      const finalPosts = validPosts.length > 0 ? validPosts : [posts[0] || prompt.trim()];

      appendCampaignLog("INFO", `Đang gửi chiến dịch ${selectedAccounts.length} tài khoản × ${activeGroups.length} nhóm tới worker...`);
      const campaign = await runGroupCampaign({
        campaign_id: campaignId || undefined,
        name: trimmedCampaignName,
        description: campaignDescription || undefined,
        action_type: "POST",
        account_ids: selectedAccounts.map((account) => account.id),
        account_uids: selectedAccounts.map((account) => account.uid),
        groups: activeGroups,
<<<<<<< HEAD
        posts: finalPosts,
        media: savedMediaPaths.length ? savedMediaPaths : mediaFiles.map((file) => file.name),
=======
        posts,
        media: [...savedMedia, ...savedMediaPaths],
>>>>>>> f54b1289b8ca16cdf658e016b786d10af8cb6b72
        settings: {
          model,
          credential_id: apiSource.selectedId,
          threads: Number(threads),
          rest_minutes: Number(restMinutes),
          max_posts: Number(maxPosts),
          delay_min: Math.round(Number(delayMin) * (delayUnit === "minutes" ? 60 : 1)),
          delay_max: Math.round(Number(delayMax) * (delayUnit === "minutes" ? 60 : 1)),
          min_media: Number(minMedia) || 0,
          max_media: Number(maxMedia) || 0,
          avoid_duplicate: false,
          shuffle_content: true,
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

  const resetAfterCampaign = () => {
    setIsAccountLocked(false);
    setIsSettingsLocked(false);
    setIsGroupSourceLocked(false);
    setIsMediaLocked(false);
    setIsContentLocked(false);
    setIsPostingSettingsLocked(false);
  };

  const resetAfterAccounts = () => {
    setIsSettingsLocked(false);
    setIsGroupSourceLocked(false);
    setIsMediaLocked(false);
    setIsContentLocked(false);
    setIsPostingSettingsLocked(false);
  };

  const resetAfterSettings = () => {
    setIsGroupSourceLocked(false);
    setIsMediaLocked(false);
    setIsContentLocked(false);
    setIsPostingSettingsLocked(false);
  };

  const resetAfterGroupSource = () => {
    setIsMediaLocked(false);
    setIsContentLocked(false);
    setIsPostingSettingsLocked(false);
  };

  const resetAfterMedia = () => {
    setIsContentLocked(false);
    setIsPostingSettingsLocked(false);
  };

  const resetAfterContent = () => {
    setIsPostingSettingsLocked(false);
  };

  const allStepsCompleted = Boolean(
    campaignLocked
    && isAccountLocked
    && settingsConfirmed
    && isGroupSourceLocked
    && isMediaLocked
    && isContentLocked
    && isPostingSettingsLocked
  );

  const canStart = runState === "idle"
    && allStepsCompleted
    && selectedAccounts.length > 0
    && hasGroups
    && hasApiKey
    && !settingsLoading;

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
        setIsLocked={(locked) => {
          setCampaignLocked(locked);
          if (!locked) resetAfterCampaign();
        }}
        isRerun={isRerun}
        stepNumber="1"
        onContinue={() => {
          const el = document.getElementById("step-2-accounts");
          if (el) el.scrollIntoView({ behavior: "smooth" });
        }}
      />

      {/* Bước 2: Chọn tài khoản / người dùng đi seeding */}
      <div id="step-2-accounts" className="scroll-mt-6">
        <StepGuard enabled={Boolean(campaignLocked && campaignName?.trim())} requiredStep="1">
        <GroupAccountSection
          stepNumber="2"
          accounts={accounts}
          accountsLoading={accountsLoading}
          selectedAccountKeys={selectedAccountKeys}
          setSelectedAccountKeys={setSelectedAccountKeys}
          onRefreshAccounts={loadAccounts}
          isLocked={isAccountLocked}
          setIsLocked={(locked) => {
            setIsAccountLocked(locked);
            if (!locked) resetAfterAccounts();
          }}
          isStep1Completed={Boolean(campaignLocked && campaignName?.trim())}
          onContinue={() => {
            const el = document.getElementById("step-3-settings");
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
        </StepGuard>
      </div>

      {/* Bước 3: Cấu hình API & thông số chung */}
      <div id="step-3-settings" className="scroll-mt-6">
        <StepGuard enabled={isAccountLocked} requiredStep="2">
        <GroupSettingsSection
          stepNumber="3"
          apiSource={apiSource}
          threads={threads}
          setThreads={setThreads}
          settingsLoading={settingsLoading}
          settingsAction={settingsAction}
          settingsFeedback={settingsFeedback}
          onSaveSettings={handleSaveSettings}
          isLocked={settingsConfirmed}
          setIsLocked={(locked) => {
            setIsSettingsLocked(locked);
            if (!locked) resetAfterSettings();
          }}
        />
        </StepGuard>
      </div>

      {/* Bước 4: Nguồn nhóm */}
      <div id="step-4-group-source" className="scroll-mt-6">
        <StepGuard enabled={settingsConfirmed} requiredStep="3">
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
          setSelectedAccountKeys={setSelectedAccountKeys}
          accounts={accounts}
          isLocked={isGroupSourceLocked}
          setIsLocked={(locked) => {
            setIsGroupSourceLocked(locked);
            if (!locked) resetAfterGroupSource();
          }}
          onContinue={() => {
            const el = document.getElementById("step-5-media");
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
        </StepGuard>
      </div>

      {/* Bước 5: Chọn media */}
      <div id="step-5-media" className="scroll-mt-6">
        <StepGuard enabled={isGroupSourceLocked} requiredStep="4">
        <GroupMediaSection
          stepNumber="5"
          mediaFiles={mediaFiles}
          setMediaFiles={setMediaFiles}
          minMedia={minMedia}
          setMinMedia={setMinMedia}
          maxMedia={maxMedia}
          setMaxMedia={setMaxMedia}
          isLocked={isMediaLocked}
          setIsLocked={(locked) => {
            setIsMediaLocked(locked);
            if (!locked) resetAfterMedia();
          }}
          onContinue={() => {
            const el = document.getElementById("step-6-content");
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
        </StepGuard>
      </div>

      {/* Bước 6: Tạo nội dung bằng AI */}
      <div id="step-6-content" className="scroll-mt-6">
        <StepGuard enabled={isMediaLocked} requiredStep="5">
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
          hasGeneratedContent={hasGeneratedContent}
          setHasGeneratedContent={setHasGeneratedContent}
          onGeneratePosts={generatePosts}
          isLocked={isContentLocked}
          setIsLocked={(locked) => {
            setIsContentLocked(locked);
            if (!locked) resetAfterContent();
          }}
          onContinue={() => {
            const el = document.getElementById("step-7-posting");
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          editorRef={editorRef}
        />
        </StepGuard>
      </div>

      {/* Bước 7: Cài đặt đăng bài */}
      <div id="step-7-posting" className="scroll-mt-6">
        <StepGuard enabled={isContentLocked} requiredStep="6">
        <GroupPostingSettingsSection
          stepNumber="7"
          scheduleEnabled={scheduleEnabled}
          setScheduleEnabled={setScheduleEnabled}
          delayMin={delayMin}
          setDelayMin={setDelayMin}
          delayMax={delayMax}
          setDelayMax={setDelayMax}
          delayUnit={delayUnit}
          setDelayUnit={setDelayUnit}
          scheduleDate={scheduleDate}
          setScheduleDate={setScheduleDate}
          scheduleTime={scheduleTime}
          setScheduleTime={setScheduleTime}
          isLocked={isPostingSettingsLocked}
          setIsLocked={setIsPostingSettingsLocked}
          onContinue={() => {
            const el = document.getElementById("step-8-summary");
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
        </StepGuard>
      </div>

      {/* Bước 8: Thông tin cấu hình tổng hợp */}
      <div id="step-8-summary" className="scroll-mt-6">
        <StepGuard enabled={isPostingSettingsLocked} requiredStep="7">
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
          delayUnit={delayUnit}
          scheduleEnabled={scheduleEnabled}
          scheduleDate={scheduleDate}
          scheduleTime={scheduleTime}
        />
        </StepGuard>
      </div>

      {/* Bước 9: Tiến trình */}
      <div id="step-9-progress" className="scroll-mt-6">
        <GroupProgressSection
          stepNumber="9"
          runState={runState}
          campaignProgress={campaignProgress}
        />
      </div>

      {/* Popup Modal thông báo hoàn thành chiến dịch */}
      <Dialog open={isCompletionModalOpen} onOpenChange={setIsCompletionModalOpen}>
        <DialogContent className="max-w-md p-6">
          <div className="flex flex-col items-center text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 ring-8 ring-emerald-50 mb-3 shadow-xs">
              <CheckCircle2 className="size-8 text-emerald-600 animate-in zoom-in-75 duration-300" />
            </div>

            <DialogHeader className="text-center sm:text-center mb-2">
              <DialogTitle className="text-lg sm:text-xl font-bold text-slate-900 text-center">
                Chiến dịch hoàn thành thành công!
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-sm text-slate-500 text-center mt-1">
                Tất cả các tài khoản đã hoàn tất lượt đăng bài vào nhóm mục tiêu.
              </DialogDescription>
            </DialogHeader>

            {/* Chi tiết thống kê kết quả */}
            <div className="w-full my-4 rounded-xl border border-emerald-100 bg-emerald-50/70 p-4 text-left space-y-2.5">
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-slate-600 font-medium">Tên chiến dịch:</span>
                <span className="font-bold text-slate-800 truncate max-w-[210px]" title={campaignName}>
                  {campaignName || "Chiến dịch đăng bài nhóm"}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-slate-600 font-medium">Số lượt đăng thành công:</span>
                <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                  <span className="text-base font-extrabold">{completionData?.success || 0}</span>
                  <span className="text-xs font-normal text-slate-500">/ {completionData?.total || 0} nhóm</span>
                </span>
              </div>
              {Number(completionData?.failed || 0) > 0 && (
                <div className="flex items-center justify-between text-xs sm:text-sm">
                  <span className="text-slate-600 font-medium">Thất bại / Bỏ qua:</span>
                  <span className="font-semibold text-rose-600">
                    {completionData.failed} nhóm
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-slate-600 font-medium">Trạng thái:</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                  <CheckCircle2 className="size-3" />
                  {completionData?.status === "COMPLETED" ? "Hoàn tất 100%" : "Hoàn tất một phần"}
                </span>
              </div>
            </div>

            <DialogFooter className="w-full flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setIsCompletionModalOpen(false);
                  const el = document.getElementById("step-9-progress");
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="w-full sm:w-auto text-xs"
              >
                Xem nhật ký hoạt động
              </Button>
              <Button
                onClick={() => setIsCompletionModalOpen(false)}
                className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-sm"
              >
                Đã hiểu & Đóng
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

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
