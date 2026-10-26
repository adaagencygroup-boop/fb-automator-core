"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bold,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  FileUp,
  Heart,
  ImageIcon,
  Info,
  Italic,
  Link2,
  List,
  ListFilter,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Search,
  Sparkles,
  Square,
  Trash2,
  Underline,
  Users,
  Eye,
  EyeOff,
  AlertTriangle,
  FolderPlus,
  Hash,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { getAccounts } from "@/modules/module_02_account_manager/service";
import { generateGroupComments, getGroupSettings, uploadGroupMedia, runGroupCampaign, getGroupCampaign, getCurrentGroupCampaign, stopGroupCampaign } from "../service";
import Link from "next/link";
import useSavedApis from "../shared/useSavedApis";
import SavedApiSelector from "../shared/SavedApiSelector";
import CampaignInfoSection from "../shared/CampaignInfoSection";
import {
  GROUPS,
  AVATAR_COLORS,
  INITIAL_COMMENTS,
} from "../shared/constants";
import {
  SectionCard,
  Field,
  SelectField,
  CheckLabel,
  initialsOf,
  normalizeAccount,
} from "../shared/components";

export default function GroupCommentModule() {
  const mediaInputRef = useRef(null);
  const groupFileInputRef = useRef(null);

  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountSearch, setAccountSearch] = useState("");
  const [selectedAccountKeys, setSelectedAccountKeys] = useState([]);
  const apiSource = useSavedApis();
  const model = apiSource.selected?.model || "gpt-4o";
  const hasApiKey = Boolean(apiSource.selected) && !apiSource.loading;
  const [aiError, setAiError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [threads, setThreads] = useState("2");
  const [restMinutes, setRestMinutes] = useState("10");
  const [maxComments, setMaxComments] = useState("20");
  const [groupSource, setGroupSource] = useState("search");
  const [groupFile, setGroupFile] = useState(null);
  const [groupSearch, setGroupSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [selectedGroupKeys, setSelectedGroupKeys] = useState(GROUPS.map((group) => group.key));
  const [mediaFiles, setMediaFiles] = useState([]);
  const [minMedia, setMinMedia] = useState("0");
  const [maxMedia, setMaxMedia] = useState("1");
  const [prompt, setPrompt] = useState("");
  const [aiCount, setAiCount] = useState("5");
  const [comments, setComments] = useState(INITIAL_COMMENTS);
  const [activeComment, setActiveComment] = useState(0);
  const [avoidDuplicate, setAvoidDuplicate] = useState(true);
  const [shuffleContent, setShuffleContent] = useState(true);
  const [autoLikeBeforeComment, setAutoLikeBeforeComment] = useState(true);
  const [onlyRecentPosts, setOnlyRecentPosts] = useState(true);
  const [delayMin, setDelayMin] = useState("30");
  const [delayMax, setDelayMax] = useState("60");
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("08:00");
  const [runState, setRunState] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [accountPage, setAccountPage] = useState(1);
  const [accountPageSize, setAccountPageSize] = useState(10);
  const [campaignName, setCampaignName] = useState("");
  const [campaignDescription, setCampaignDescription] = useState("");
  const [campaignLocked, setCampaignLocked] = useState(false);
  const [savedMedia, setSavedMedia] = useState([]);
  const [campaignId, setCampaignId] = useState("");
  const [jobId, setJobId] = useState(null);
  const [isRerun, setIsRerun] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCurrentGroupCampaign().then((job) => {
      if (cancelled || !job?.job_id || job.action_type !== "COMMENT") return;
      if (["COMPLETED", "PARTIAL", "STOPPED", "CANCELLED", "FAILED"].includes(job.status)) return;
      setCampaignId(job.campaign_id);
      setJobId(job.job_id);
      setRunState("running");
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer;
    const poll = async () => {
      try {
        const job = await getGroupCampaign(jobId);
        if (cancelled) return;
        setProgress(job.progress || 0);
        if (["COMPLETED", "PARTIAL", "STOPPED", "CANCELLED", "FAILED"].includes(job.status)) {
          setJobId(null);
          setRunState("idle");
          toast.info(job.message || "Chiến dịch đã kết thúc");
          return;
        }
        setRunState(job.status === "STOPPING" ? "stopping" : "running");
      } catch (error) {
        if (cancelled) return;
        toast.error(error.message || "Không thể tải tiến trình");
      }
      timer = window.setTimeout(poll, 1500);
    };
    poll();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [jobId]);

  const loadAccounts = async () => {
    setAccountsLoading(true);
    try {
      const data = await getAccounts();
      const rawList = Array.isArray(data) ? data : (data?.accounts || []);
      const rows = rawList.map(normalizeAccount);
      setAccounts(rows);
      const rerun = JSON.parse(sessionStorage.getItem("fb_rerun_campaign") || "null");
      if (rerun?.action_type === "COMMENT" && rerun.config?.account_uids) {
        setSelectedAccountKeys(rows.filter((account) => rerun.config.account_uids.includes(account.uid)).map((account) => account.key));
        return;
      }
      setSelectedAccountKeys((current) => current.length ? current :
        rows.filter((account) => account.status === "LIVE").slice(0, 4).map((account) => account.key)
      );
    } catch (err) {
      console.error("Lỗi nạp tài khoản từ Module 2:", err);
      setAccounts([]);
      setSelectedAccountKeys([]);
    } finally {
      setAccountsLoading(false);
    }
  };

  useEffect(() => {
    Promise.resolve().then(loadAccounts);
    getGroupSettings().then((data) => {
      if (!data) return;
      const rerun = JSON.parse(sessionStorage.getItem("fb_rerun_campaign") || "null");
      if (rerun?.action_type === "COMMENT") return;
      if (data.threads) setThreads(String(data.threads));
      if (data.rest_minutes !== undefined) setRestMinutes(String(data.rest_minutes));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    try {
      const rerunRaw = sessionStorage.getItem("fb_rerun_campaign");
      if (!rerunRaw) return;
      const data = JSON.parse(rerunRaw);
      if (data.action_type === "COMMENT") {
        queueMicrotask(() => {
        if (data.name) setCampaignName(data.name);
        if (data.description) setCampaignDescription(data.description);
        if (data.campaign_id) setCampaignId(data.campaign_id);
        if (data.config?.groups?.length) {
          setGroupSource("file");
          setGroupFile({ name: "Cấu hình chạy lại", groups: data.config.groups, validGroupsCount: data.config.groups.length });
        }
        if (data.config?.posts?.length) setComments(data.config.posts);
        setSavedMedia(data.config?.media || []);
        if (data.config?.account_uids?.length) setSelectedAccountKeys(data.config.account_uids);
        setIsRerun(true);
        setCampaignLocked(true);
        if (data.config?.settings) {
          const s = data.config.settings;
          if (s.threads) setThreads(String(s.threads));
          if (s.rest_minutes !== undefined) setRestMinutes(String(s.rest_minutes));
          if (s.max_posts) setMaxComments(String(s.max_posts));
          if (s.delay_min !== undefined) setDelayMin(String(s.delay_min));
          if (s.delay_max !== undefined) setDelayMax(String(s.delay_max));
          if (s.avoid_duplicate !== undefined) setAvoidDuplicate(Boolean(s.avoid_duplicate));
          if (s.shuffle_content !== undefined) setShuffleContent(Boolean(s.shuffle_content));
          if (s.auto_like !== undefined) setAutoLikeBeforeComment(Boolean(s.auto_like));
          if (s.only_recent_posts !== undefined) setOnlyRecentPosts(Boolean(s.only_recent_posts));
        }
        setScheduleEnabled(false);
        setScheduleDate("");
        setScheduleTime("08:00");
        toast.info(`Đã nạp cấu hình từ chiến dịch "${data.name || data.campaign_id}" để chạy lại lượt mới.`);
        });
      }
    } catch (err) {
      console.error("Lỗi đọc cấu hình rerun:", err);
    }
  }, []);

  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();
    if (!query) return accounts;
    return accounts.filter((account) => `${account.name} ${account.uid}`.toLowerCase().includes(query));
  }, [accountSearch, accounts]);

  const paginatedAccounts = useMemo(() => {
    const start = (accountPage - 1) * accountPageSize;
    return filteredAccounts.slice(start, start + accountPageSize);
  }, [filteredAccounts, accountPage, accountPageSize]);

  const filteredGroups = useMemo(() => {
    const query = groupFilter.trim().toLowerCase();
    if (!query) return GROUPS;
    return GROUPS.filter((group) => `${group.name} ${group.url}`.toLowerCase().includes(query));
  }, [groupFilter]);

  const selectedAccounts = accounts.filter((account) => selectedAccountKeys.includes(account.key));
  const selectedGroups = GROUPS.filter((group) => selectedGroupKeys.includes(group.key));
  const hasGroups = groupSource === "search" ? selectedGroups.length > 0 : Boolean(groupFile);
  const activeTargetsCount = groupSource === "file" ? (groupFile?.validGroupsCount || 50) : selectedGroups.length;
  const generatedCount = comments.filter((comment) => comment.trim()).length;
  const totalPlanned = Math.min(Number(maxComments) || 0, activeTargetsCount * Math.max(selectedAccounts.length, 1));

  const toggleAccount = (key, checked) => {
    setSelectedAccountKeys((current) =>
      checked ? [...new Set([...current, key])] : current.filter((item) => item !== key),
    );
  };

  const toggleGroup = (key, checked) => {
    setSelectedGroupKeys((current) =>
      checked ? [...new Set([...current, key])] : current.filter((item) => item !== key),
    );
  };

  const handleFiles = (files) => {
    const nextFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"));
    setMediaFiles(nextFiles);
  };

  const processGroupFile = (file) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = String(event.target?.result || "");
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
      const unique = Array.from(new Set(lines));
      const validLinks = unique.filter(
        (line) => line.includes("facebook.com") || line.includes("fb.com") || /^\d+$/.test(line)
      );
      const invalidCount = unique.length - validLinks.length;
      const dedupCount = lines.length - unique.length;

      setGroupFile({
        name: file.name,
        size: file.size,
        status: "valid",
        dedupCount,
        invalidCount,
        validGroupsCount: validLinks.length || lines.length || 1,
      });

      if (validLinks.length > 0) {
        const fileGroups = validLinks.map((url, idx) => ({
          id: String(idx + 1).padStart(2, "0"),
          key: `file_target_${idx}`,
          name: `Mục tiêu bình luận #${idx + 1}`,
          url: url.replace(/^https?:\/\//, ""),
          frequency: "20 bình luận",
          members: "—",
        }));
        setSelectedGroupKeys(fileGroups.map((g) => g.key));
      }
    };
    reader.readAsText(file);
  };

  const handleGroupFileChange = (event) => {
    const file = event.target.files?.[0];
    if (file) {
      processGroupFile(file);
    }
  };

  const handleGroupFileDrop = (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      processGroupFile(file);
    }
  };

  const handleDownloadTemplate = () => {
    const templateContent = [
      "# Danh sách link bài viết hoặc nhóm Facebook cần bình luận (Mỗi dòng 1 link)",
      "https://www.facebook.com/groups/vieclamonline2024/posts/1015948374829104",
      "https://www.facebook.com/groups/muabanonline2024/posts/2048593847291834",
      "https://www.facebook.com/groups/sinhvientimvieclam",
      "https://www.facebook.com/groups/chodocu/posts/3018472918239485",
      "https://www.facebook.com/groups/freelancermarketing",
    ].join("\n");
    const blob = new Blob([templateContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mau_danh_sach_link_binh_luan.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleRemoveGroupFile = () => {
    setGroupFile(null);
    if (groupFileInputRef.current) {
      groupFileInputRef.current.value = "";
    }
  };

  const generateComments = async () => {
    if (!hasApiKey || generating) return;
    const amount = Math.max(1, Math.min(10, Number(aiCount) || 1));
    if (prompt.trim().length < 3) { setAiError("Nhập nội dung gốc ít nhất 3 ký tự."); return; }
    setGenerating(true); setAiError("");
    try {
      const result = await generateGroupComments({ model, credential_id: apiSource.selectedId, prompt: prompt.trim(), count: amount });
      setComments(result.comments); setActiveComment(0);
    } catch (error) { setAiError(error.message); }
    finally { setGenerating(false); }
  };

  const updateActiveComment = (value) => {
    setComments((current) => current.map((comment, index) => (index === activeComment ? value : comment)));
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

    const activeTargets = groupSource === "file" && groupFile?.groups?.length ? groupFile.groups : selectedGroups;
    if (selectedAccounts.length > activeTargets.length) {
      toast.error(
        `Chưa đủ số lượng nhóm. Bạn đã chọn ${selectedAccounts.length} tài khoản nhưng chỉ có ${activeTargets.length} nhóm/mục tiêu. Vui lòng chọn thêm nhóm hoặc giảm số tài khoản để số tài khoản không lớn hơn số nhóm.`,
        "QUY TẮC PHÂN BỔ (A ≤ G)"
      );
      const el = document.getElementById("step-4-group-source");
      if (el) el.scrollIntoView({ behavior: "smooth" });
      return;
    }

    setRunState("starting");
    setProgress(4);
    try {
      let uploadedMedia = [];
      if (mediaFiles.length) {
        const formData = new FormData();
        mediaFiles.forEach((file) => formData.append("files", file));
        const upload = await uploadGroupMedia(formData);
        uploadedMedia = (upload.files || []).map((file) => file.path || file.relative_path);
      }
      const campaign = await runGroupCampaign({
        campaign_id: campaignId || undefined,
        name: trimmedCampaignName,
        description: (campaignDescription || "").trim(),
        action_type: "COMMENT",
        account_ids: selectedAccounts.map((account) => account.id),
        account_uids: selectedAccounts.map((account) => account.uid),
        groups: activeTargets,
        posts: comments,
        media: [...savedMedia, ...uploadedMedia],
        settings: {
          model,
          credential_id: apiSource.selectedId,
          threads: Number(threads),
          rest_minutes: Number(restMinutes),
          max_posts: Number(maxComments),
          delay_min: Number(delayMin),
          delay_max: Number(delayMax),
          avoid_duplicate: avoidDuplicate,
          shuffle_content: shuffleContent,
          auto_like: autoLikeBeforeComment,
          only_recent_posts: onlyRecentPosts,
          schedule_at: scheduleEnabled && scheduleDate ? `${scheduleDate}T${scheduleTime}` : null,
        },
      });
      setCampaignId(campaign.campaign_id);
      setJobId(campaign.job_id);
      setRunState("running");
      setProgress(15);
      sessionStorage.removeItem("fb_rerun_campaign");
      setIsRerun(false);
      toast.success("Đã khởi động chiến dịch bình luận nhóm thành công!", "BẮT ĐẦU CHIẾN DỊCH");
    } catch (error) {
      setRunState("idle");
      setProgress(0);
      toast.error(error.message || "Không thể bắt đầu chiến dịch bình luận", "LỖI KHỞI ĐỘNG");
    }
  };

  const handleStop = async () => {
    if (!jobId) return;
    try {
      await stopGroupCampaign(jobId);
      setRunState("stopping");
    } catch (error) {
      toast.error(error.message || "Không thể dừng chiến dịch");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-xl font-bold tracking-tight text-slate-800">
          Spam Group – Bình luận
        </h1>
        <p className="mt-1 text-xs text-slate-400">
          Tự động tìm kiếm và bình luận vào các bài viết trong hội nhóm Facebook theo từ khoá hoặc từ file link nhóm/bài viết.
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
        onContinue={() => {
          const el = document.getElementById("step-2-accounts");
          if (el) el.scrollIntoView({ behavior: "smooth" });
        }}
      />

      {/* Bước 2 */}
      <div id="step-2-accounts" className="scroll-mt-6">
        <SectionCard
          number="2"
          title="Chọn tài khoản / người dùng đi seeding bình luận"
          description="Chọn danh sách tài khoản Facebook sẽ thực hiện bình luận và tương tác bài viết"
        aside={
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-600">
            + Đã chọn {selectedAccounts.length}/{accounts.length} tài khoản
          </span>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={accountSearch}
              onChange={(event) => setAccountSearch(event.target.value)}
              placeholder="Tìm kiếm UID, tên tài khoản Facebook..."
              className="pl-9"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSelectedAccountKeys(filteredAccounts.map((account) => account.key))}
          >
            <Check className="mr-1.5 size-3.5" /> Chọn tất cả
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            title="Đồng bộ danh sách từ Module 2"
            onClick={() => {
              setAccountSearch("");
              loadAccounts();
            }}
          >
            <RefreshCw className={`size-3.5 ${accountsLoading ? "animate-spin text-primary" : ""}`} />
          </Button>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200">
          <div className="max-h-[330px] overflow-auto">
            <table className="w-full min-w-[650px] text-left text-[11px]">
              <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="w-12 px-4 py-3">
                    <Checkbox
                      checked={filteredAccounts.length > 0 && filteredAccounts.every((account) => selectedAccountKeys.includes(account.key))}
                      onCheckedChange={(checked) => setSelectedAccountKeys(checked ? filteredAccounts.map((account) => account.key) : [])}
                    />
                  </th>
                  <th className="px-3 py-3 font-semibold">Tài khoản Facebook</th>
                  <th className="px-3 py-3 font-semibold">UID Facebook</th>
                  <th className="px-3 py-3 font-semibold">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedAccounts.map((account, index) => {
                  const selected = selectedAccountKeys.includes(account.key);
                  return (
                    <tr key={account.key} className={selected ? "bg-blue-50/30" : "bg-white"}>
                      <td className="px-4 py-2.5">
                        <Checkbox checked={selected} onCheckedChange={(checked) => toggleAccount(account.key, checked)} />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar className="size-8 border-0">
                            <AvatarFallback className={AVATAR_COLORS[index % AVATAR_COLORS.length]}>
                              {initialsOf(account.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-semibold text-slate-700">{account.name}</p>
                            <p className="text-[10px] text-slate-400">{account.friends || "Tài khoản Module 2"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-slate-500">{account.uid}</td>
                      <td className="px-3 py-2.5">
                        <span className={account.status === "LIVE" ? "font-semibold text-emerald-600" : "font-semibold text-red-500"}>
                          ● {account.status === "LIVE" ? "Live" : account.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {!accountsLoading && !filteredAccounts.length && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <Users className="size-8 text-slate-300" />
                        <p className="text-xs font-semibold text-slate-600">
                          {accounts.length === 0
                            ? "Chưa có tài khoản Facebook nào trong Module 2 (Quản lý tài khoản)"
                            : "Không tìm thấy tài khoản Facebook phù hợp"}
                        </p>
                        <p className="max-w-md text-[11px] text-slate-400">
                          {accounts.length === 0
                            ? "Vui lòng vào Module 2 để thêm hoặc import tài khoản Facebook, sau đó quay lại để chọn tài khoản đi seeding bình luận."
                            : "Thử tìm kiếm với từ khóa khác hoặc bấm nút làm mới."}
                        </p>
                        {accounts.length === 0 ? (
                          <div className="pt-2">
                            <Link
                              href="/accounts"
                              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-primary/90"
                            >
                              <Plus className="size-3.5" /> Thêm tài khoản tại Module 2
                            </Link>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )}
                {accountsLoading && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                      Đang tải tài khoản từ Module 2...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[10px] text-slate-400">
          <div className="flex items-center gap-4">
            <span>
              Hiển thị <strong className="text-slate-600">{Math.min(filteredAccounts.length, accountPageSize)}/{accounts.length}</strong> tài khoản
            </span>
            <span>
              Dòng / trang:{" "}
              <select
                value={accountPageSize}
                onChange={(e) => {
                  setAccountPageSize(Number(e.target.value));
                  setAccountPage(1);
                }}
                className="ml-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 outline-none"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </span>
            <button
              type="button"
              onClick={() => {
                setAccountPageSize(accounts.length || 10);
                setAccountPage(1);
              }}
              className="font-semibold text-primary hover:underline"
            >
              Xem tất cả →
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={accountPage <= 1}
              onClick={() => setAccountPage((p) => Math.max(1, p - 1))}
              className="rounded border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="size-3" />
            </button>
            <button
              type="button"
              onClick={() => setAccountPage(1)}
              className={`size-7 rounded font-semibold transition-colors ${
                accountPage === 1 ? "bg-primary text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              1
            </button>
            {Math.ceil(filteredAccounts.length / accountPageSize) > 1 && (
              <button
                type="button"
                onClick={() => setAccountPage(2)}
                className={`size-7 rounded font-semibold transition-colors ${
                  accountPage === 2 ? "bg-primary text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                2
              </button>
            )}
            {Math.ceil(filteredAccounts.length / accountPageSize) > 2 && (
              <button
                type="button"
                onClick={() => setAccountPage(3)}
                className={`size-7 rounded font-semibold transition-colors ${
                  accountPage === 3 ? "bg-primary text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                3
              </button>
            )}
            <button
              type="button"
              disabled={accountPage >= Math.ceil(filteredAccounts.length / accountPageSize)}
              onClick={() => setAccountPage((p) => p + 1)}
              className="rounded border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronRight className="size-3" />
            </button>
          </div>
        </div>
      </SectionCard>
      </div>

      {/* Bước 3 */}
      <div id="step-3-settings" className="scroll-mt-6">
        <SectionCard number="3" title="Chọn API & thông số chung">
          <SavedApiSelector source={apiSource} disabled={runState !== "idle" || generating} />
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Luồng">
              <Input type="number" min="1" value={threads} onChange={(event) => setThreads(event.target.value)} />
            </Field>
            <Field label="Nghỉ (phút)">
              <Input type="number" min="0" value={restMinutes} onChange={(event) => setRestMinutes(event.target.value)} />
            </Field>
            <Field label="Max bình luận">
              <Input type="number" min="1" value={maxComments} onChange={(event) => setMaxComments(event.target.value)} />
            </Field>
          </div>
        </SectionCard>
      </div>

      {/* Bước 4 */}
      <div id="step-4-group-source" className="scroll-mt-6">
        <SectionCard number="4" title="Nguồn nhóm & bài viết cần bình luận">
          {selectedAccounts.length > activeTargetsCount && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <div className="flex items-start gap-2">
                <AlertTriangle className="size-4 shrink-0 text-amber-600 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-amber-900">
                    Chưa đủ số lượng nhóm / bài viết (Quy tắc A ≤ G)
                  </p>
                  <p className="text-[11px] text-amber-700 leading-relaxed">
                    Chưa đủ số lượng nhóm. Bạn đã chọn <strong>{selectedAccounts.length}</strong> tài khoản nhưng chỉ có <strong>{activeTargetsCount}</strong> nhóm. Vui lòng chọn thêm nhóm hoặc giảm số tài khoản để số tài khoản không lớn hơn số nhóm.
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        const el = document.getElementById("step-2-accounts");
                        if (el) el.scrollIntoView({ behavior: "smooth" });
                      }}
                      className="rounded bg-white px-2 py-1 text-[10px] font-semibold text-amber-800 shadow-xs border border-amber-200 hover:bg-amber-100"
                    >
                      Giảm số tài khoản (Bước 2)
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
          <button
            type="button"
            onClick={() => setGroupSource("search")}
            className={`rounded-xl border p-3.5 text-left transition-colors ${
              groupSource === "search"
                ? "border-2 border-primary bg-white shadow-xs"
                : "border-slate-200 bg-white hover:border-slate-300"
            }`}
          >
            <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
              <span
                className={`flex size-3.5 items-center justify-center rounded-full border ${
                  groupSource === "search" ? "border-2 border-primary bg-white" : "border-slate-300 bg-white"
                }`}
              >
                {groupSource === "search" && <span className="size-1.5 rounded-full bg-primary" />}
              </span>
              <Search className="size-4 text-slate-500" />
              <span>Tìm kiếm nhóm theo từ khóa</span>
            </div>
            <p className="mt-1 pl-5.5 text-[10px] text-slate-400">
              Hệ thống tự động tìm các bài viết mới nhất trong nhóm để thực hiện bình luận.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setGroupSource("file")}
            className={`rounded-xl border p-3.5 text-left transition-colors ${
              groupSource === "file"
                ? "border-2 border-primary bg-white shadow-xs"
                : "border-slate-200 bg-white hover:border-slate-300"
            }`}
          >
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
              <span
                className={`flex size-3.5 items-center justify-center rounded-full border ${
                  groupSource === "file" ? "border-2 border-primary bg-white" : "border-slate-300 bg-white"
                }`}
              >
                {groupSource === "file" && <span className="size-1.5 rounded-full bg-primary" />}
              </span>
              <span className="flex size-5 items-center justify-center rounded bg-primary text-white">
                <Link2 className="size-3" />
              </span>
              <span>Từ file link nhóm hoặc bài viết</span>
            </div>
            <p className="mt-1 pl-5.5 text-[10px] text-slate-400">
              Bình luận vào các bài viết hoặc nhóm trong file link. Hỗ trợ file .txt, .csv, .xlsx (mỗi dòng 1 link).
            </p>
          </button>
        </div>

        {groupSource === "file" ? (
          <div className="mt-4 space-y-3">
            <input
              ref={groupFileInputRef}
              type="file"
              accept=".txt,.csv,.xlsx"
              className="hidden"
              onChange={handleGroupFileChange}
            />

            <div
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleGroupFileDrop}
              className="flex flex-col items-center justify-center rounded-xl border border-dashed border-blue-200 bg-blue-50/20 px-4 py-8 text-center transition-colors hover:bg-blue-50/30"
            >
              <div className="mb-2.5 flex size-9 items-center justify-center rounded-full bg-blue-100 text-primary">
                <FileUp className="size-4.5" />
              </div>
              <p className="text-xs font-medium text-slate-600">
                Kéo thả file vào đây hoặc{" "}
                <button
                  type="button"
                  onClick={() => groupFileInputRef.current?.click()}
                  className="font-semibold text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary cursor-pointer"
                >
                  📂 chọn file từ máy tính
                </button>
              </p>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="mt-2 inline-flex items-center gap-1.5 text-xs text-primary hover:underline cursor-pointer"
              >
                <Download className="size-3.5" /> Tải file mẫu (.txt / .csv)
              </button>
            </div>

            {groupFile && (
              <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-emerald-50 text-emerald-600">
                    <FileText className="size-5" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-slate-800">{groupFile.name}</span>
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                        <Check className="size-3 stroke-[2.5]" /> Đã kiểm tra hợp lệ
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {groupFile.size ? `${(groupFile.size / 1024).toFixed(1)} KB` : "18.5 KB"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      Đã tự động lọc bỏ {groupFile.dedupCount ?? 4} link trùng lặp &{" "}
                      {groupFile.invalidCount ?? 2} link hỏng/lỗi
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => groupFileInputRef.current?.click()}
                    className="h-8 gap-1.5 border-slate-200 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    <RotateCw className="size-3.5 text-slate-500" /> Tải lại
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleRemoveGroupFile}
                    className="h-8 gap-1.5 border-slate-200 text-xs text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="size-3.5 text-slate-400" /> Xóa file
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="mt-5 flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  value={groupSearch}
                  onChange={(event) => setGroupSearch(event.target.value)}
                  className="pl-9"
                />
              </div>
              <Button type="button" size="sm">
                <Search className="mr-1.5 size-3.5" /> Tìm kiếm nhóm
              </Button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px]">
              <span className="flex items-center gap-1 font-semibold text-slate-600">
                <ListFilter className="size-3.5 text-primary" /> Bộ lọc nhóm:
              </span>
              <span className="rounded border border-slate-200 bg-white px-3 py-2 text-slate-500">
                Thành viên từ: <strong className="ml-3 text-slate-700">50000</strong> TV
              </span>
              {["> 10K", "> 50K TV", "> 100K TV"].map((item) => (
                <button
                  type="button"
                  key={item}
                  className={`rounded border px-3 py-2 font-semibold ${
                    item === "> 50K TV"
                      ? "border-primary bg-primary text-white"
                      : "border-slate-200 bg-white text-slate-500"
                  }`}
                >
                  {item}
                </button>
              ))}
              <SelectField className="h-8 w-auto">
                <option>Tất cả loại nhóm</option>
                <option>Nhóm công khai</option>
              </SelectField>
              <span className="rounded bg-blue-50 px-3 py-2 font-semibold text-primary">
                <Check className="mr-1 inline size-3" />
                Áp dụng bộ lọc
              </span>
              <button type="button" className="px-2 py-2 text-slate-500">
                Đặt lại
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  value={groupFilter}
                  onChange={(event) => setGroupFilter(event.target.value)}
                  placeholder="Lọc nhóm trong kết quả..."
                  className="h-8 pl-9"
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSelectedGroupKeys(filteredGroups.map((group) => group.key))}
              >
                <Check className="mr-1 size-3.5" /> Chọn tất cả
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600"
                onClick={() => setSelectedGroupKeys([])}
              >
                <Trash2 className="mr-1 size-3.5" /> Xóa nhóm đã chọn
              </Button>
              <Button type="button" size="sm" variant="outline" className="text-primary">
                <Plus className="mr-1 size-3.5" /> Thêm nhóm thủ công
              </Button>
            </div>

            <div className="my-4 flex items-center justify-between text-[10px]">
              <span className="font-semibold text-emerald-600">● Tìm thấy 68 nhóm phù hợp</span>
              <span className="text-slate-400">Đang hiển thị {filteredGroups.length} nhóm / trang</span>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200">
              <div className="overflow-auto">
                <table className="w-full min-w-[760px] text-left text-[10px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr className="border-b border-slate-200">
                      <th className="w-10 px-3 py-3">
                        <Checkbox
                          checked={filteredGroups.every((group) => selectedGroupKeys.includes(group.key))}
                          onCheckedChange={(checked) =>
                            setSelectedGroupKeys(checked ? filteredGroups.map((group) => group.key) : [])
                          }
                        />
                      </th>
                      <th className="w-10 px-2 py-3 font-semibold">STT</th>
                      <th className="px-3 py-3 font-semibold">Tên nhóm & Link UID</th>
                      <th className="px-3 py-3 font-semibold">Tần suất/ngày</th>
                      <th className="px-3 py-3 font-semibold">Thành viên</th>
                      <th className="w-16 px-3 py-3 text-center font-semibold">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredGroups.map((group) => (
                      <tr
                        key={group.key}
                        className={selectedGroupKeys.includes(group.key) ? "bg-blue-50/20" : "bg-white"}
                      >
                        <td className="px-3 py-2.5">
                          <Checkbox
                            checked={selectedGroupKeys.includes(group.key)}
                            onCheckedChange={(checked) => toggleGroup(group.key, checked)}
                          />
                        </td>
                        <td className="px-2 py-2.5 text-slate-400">{group.id}</td>
                        <td className="px-3 py-2.5">
                          <p className="font-semibold text-slate-700">{group.name}</p>
                          <a
                            href={`https://${group.url}`}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-0.5 inline-flex items-center gap-1 text-primary"
                          >
                            {group.url}
                            <ExternalLink className="size-2.5" />
                          </a>
                        </td>
                        <td className="px-3 py-2.5 text-slate-500">{group.frequency}</td>
                        <td className="px-3 py-2.5 font-semibold text-slate-600">
                          {group.members} TV
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => toggleGroup(group.key, false)}
                            className="text-slate-400 hover:text-red-500"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </SectionCard>
      </div>

      {/* Bước 5 */}
      <div id="step-5-media" className="scroll-mt-6">
        <SectionCard number="5" title="Chọn media đính kèm bình luận (ảnh/video)">
        <div className="mb-4 flex h-9 items-center justify-center rounded-md bg-primary text-xs font-semibold text-white">
          <ImageIcon className="mr-2 size-4" /> Hình ảnh + Video đính kèm
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
            {mediaFiles.length ? `Đã chọn ${mediaFiles.length} tệp media` : "Nhấp để tải ảnh lên hoặc kéo thả (tùy chọn)"}
          </span>
          <span className="mt-1 text-[10px] text-slate-400">Hỗ trợ JPG, PNG (tối đa 5 ảnh cho bình luận)</span>
        </button>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Tối thiểu media mỗi bình luận">
            <Input type="number" min="0" value={minMedia} onChange={(event) => setMinMedia(event.target.value)} />
          </Field>
          <Field label="Tối đa media mỗi bình luận">
            <Input type="number" min="0" value={maxMedia} onChange={(event) => setMaxMedia(event.target.value)} />
          </Field>
        </div>
      </SectionCard>
      </div>

      {/* Bước 6 */}
      <div id="step-6-content" className="scroll-mt-6">
        <SectionCard number="6" title="Tạo nội dung bình luận bằng AI">
        <div className="grid gap-4 md:grid-cols-[1fr_320px]">
          <Field label="Nội dung gốc định hướng / kịch bản bình luận">
            <div className="relative">
              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                maxLength={2000}
                placeholder="Nhập định hướng seeding hoặc kịch bản để AI sinh ra các câu bình luận tự nhiên (ví dụ: xin tư vấn, hỏi giá, quan tâm công việc, review tích cực)..."
                className="min-h-24 resize-none pb-6"
              />
              <span className="absolute bottom-2 right-3 text-[9px] text-slate-400">{prompt.length}/2000</span>
            </div>
          </Field>
          <div className="flex flex-col justify-between gap-3">
            <Field label="Số lượng bình luận AI tạo ra">
              <SelectField value={aiCount} onChange={(event) => setAiCount(event.target.value)}>
                <option value="3">3</option>
                <option value="5">5</option>
                <option value="10">10</option>
              </SelectField>
            </Field>
            {aiError && <p role="alert" className="text-xs text-red-600">{aiError}</p>}
            <Button type="button" onClick={generateComments} disabled={!hasApiKey || generating} className="w-full">
              <Sparkles className="mr-2 size-3.5" /> {generating ? "Đang tạo..." : "Tạo nội dung AI"}
            </Button>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-slate-100 bg-slate-50/50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-800">Kết quả nội dung bình luận AI ({generatedCount} mẫu)</p>
              <p className="text-[10px] text-slate-400">Bạn có thể chỉnh sửa nội dung từng bình luận trước khi thực thi</p>
            </div>
            <Button type="button" size="sm" variant="outline" className="text-primary" onClick={generateComments} disabled={!hasApiKey || generating}>
              <RotateCcw className="mr-1.5 size-3.5" /> Tạo lại
            </Button>
          </div>
          <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            {comments.map((_, index) => (
              <button
                type="button"
                key={index}
                onClick={() => setActiveComment(index)}
                className={`h-9 min-w-20 flex-1 text-[10px] font-semibold ${
                  activeComment === index ? "bg-primary text-white" : "text-slate-500 hover:bg-white"
                }`}
              >
                Bình luận {index + 1}
              </button>
            ))}
          </div>
          <p className="mb-2 mt-4 text-[11px] font-semibold text-slate-600">Nội dung bình luận {activeComment + 1}</p>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center gap-1 border-b border-slate-100 bg-slate-50 px-3 py-2 text-slate-500">
              {[Bold, Italic, Underline, List, Link2, ImageIcon].map((Icon, index) => (
                <button type="button" key={index} className="rounded p-1.5 hover:bg-white hover:text-primary">
                  <Icon className="size-3.5" />
                </button>
              ))}
            </div>
            <Textarea
              value={comments[activeComment] || ""}
              onChange={(event) => updateActiveComment(event.target.value)}
              maxLength={1000}
              className="min-h-36 resize-none rounded-none border-0 shadow-none focus-visible:ring-0"
            />
            <div className="px-3 pb-2 text-right text-[9px] text-slate-400">{(comments[activeComment] || "").length}/1000</div>
          </div>
        </div>
      </SectionCard>
      </div>

      {/* Bước 7 */}
      <div id="step-7-settings" className="scroll-mt-6">
        <SectionCard number="7" title="Cài đặt bình luận">
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <CheckLabel checked={scheduleEnabled} onCheckedChange={setScheduleEnabled}>
            Bật hẹn giờ bình luận
          </CheckLabel>
          <CheckLabel checked={avoidDuplicate} onCheckedChange={setAvoidDuplicate}>
            Không bình luận trùng nội dung
          </CheckLabel>
          <CheckLabel checked={shuffleContent} onCheckedChange={setShuffleContent}>
            Đăng ngẫu nhiên nội dung (nếu có nhiều bình luận)
          </CheckLabel>
          <CheckLabel checked={autoLikeBeforeComment} onCheckedChange={setAutoLikeBeforeComment}>
            <Heart className="size-3 text-red-500 inline fill-red-100" /> Tự động like bài viết trước khi bình luận
          </CheckLabel>
          <CheckLabel checked={onlyRecentPosts} onCheckedChange={setOnlyRecentPosts}>
            Chỉ bình luận vào bài viết mới đăng (trong 24h)
          </CheckLabel>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label="Thời gian nghỉ giữa các lần bình luận (giây)">
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
            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <CalendarDays className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  type="date"
                  value={scheduleDate}
                  onChange={(event) => setScheduleDate(event.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="relative">
                <Clock3 className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  type="time"
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

      {/* Bước 8: Thông tin cấu hình tổng hợp */}
      <div id="step-8-summary" className="scroll-mt-6">
        <SectionCard number="8" title="Thông tin cấu hình tổng hợp" aside={<Info className="size-4 text-primary" />}>
          <div className="grid gap-x-10 gap-y-3 text-[11px] md:grid-cols-2">
            {[
              [<FolderPlus key="camp" className="size-3.5" />, "Chiến dịch", campaignName ? campaignName : "Chưa đặt tên"],
              [<Hash key="cid" className="size-3.5" />, "Mã chiến dịch", campaignId || "Tự động tạo mới"],
              [<Users key="a" className="size-3.5" />, "Tài khoản", `${selectedAccounts.length} tài khoản đã chọn`],
              [<MessageSquare key="b" className="size-3.5" />, "Hạn bình luận", `${maxComments} bình luận`],
              [<Sparkles key="c" className="size-3.5" />, "API sử dụng", apiSource.selected ? `${apiSource.selected.model} (${apiSource.selected.hint})` : "Chưa chọn"],
              [<Sparkles key="d" className="size-3.5" />, "Số bình luận AI", `${generatedCount} mẫu`],
              [<Search key="e" className="size-3.5" />, "Nguồn mục tiêu", groupSource === "search" ? "Tìm theo từ khóa" : "Từ file link nhóm / bài viết"],
              [<ImageIcon key="f" className="size-3.5" />, "Min / Max media", `${minMedia} – ${maxMedia} ảnh`],
              [<RefreshCw key="g" className="size-3.5" />, "Luồng chạy", `${threads} luồng`],
              [<Clock3 key="h" className="size-3.5" />, "Giãn cách bình luận", `${delayMin} – ${delayMax} giây`],
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
                    value === "Đã nhập" || (label === "Hẹn giờ" && scheduleEnabled)
                      ? "text-emerald-600"
                      : "text-slate-700"
                  }
                >
                  {value}
                </strong>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* Bước 9: Tiến trình */}
      <div id="step-9-progress" className="scroll-mt-6">
        <Card className="min-h-64 border-slate-200 p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
            <span className="flex size-5 items-center justify-center rounded bg-primary/10 font-bold text-[11px] text-primary">9</span> Theo dõi tiến trình
          </div>
          {runState !== "idle" ? (
            <div className="flex min-h-48 flex-col items-center justify-center gap-3">
              <Progress value={progress} className="max-w-xl" />
              <p className="text-xs font-semibold text-primary">
                {runState === "starting"
                  ? "Đang khởi tạo tác vụ bình luận..."
                  : `Đang thực hiện ${progress}/${Math.max(totalPlanned, 1)} lượt bình luận`}
              </p>
            </div>
          ) : (
            <div className="flex min-h-48 items-center justify-center text-xs text-slate-300">
              Tiến trình sẽ hiển thị sau khi bắt đầu bình luận.
            </div>
          )}
        </Card>
      </div>

      {/* Sticky Bottom Action Bar */}
      <Card className="sticky bottom-0 z-20 flex flex-col items-center justify-between gap-4 border-slate-200 bg-white/95 px-6 py-4 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur sm:flex-row">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <Check className="size-4" />
          </span>
          <div>
            <p className="text-xs font-bold text-slate-700">Sẵn sàng thực thi tiến trình bình luận</p>
            <p className="text-[10px] text-slate-400">Hệ thống sẽ chạy tự động theo các thông số đã cấu hình ở trên</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button type="button" variant="destructive" disabled={runState === "idle"} onClick={handleStop}>
            <Square className="mr-2 size-3 fill-current" /> DỪNG BÌNH LUẬN
          </Button>
          <Button
            type="button"
            variant="success"
            disabled={runState !== "idle" || !selectedAccounts.length || !hasGroups || !hasApiKey}
            onClick={handleStart}
          >
            <Play className="mr-2 size-3.5 fill-current" /> BẮT ĐẦU BÌNH LUẬN
          </Button>
        </div>
      </Card>
    </div>
  );
}
