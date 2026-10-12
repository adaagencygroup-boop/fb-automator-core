"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bold,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileSpreadsheet,
  ImageIcon,
  Info,
  Italic,
  Link2,
  List,
  ListFilter,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Square,
  Trash2,
  Underline,
  Users,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { getAccounts } from "@/modules/module_02_account_manager/service";
import { runGroupCampaign } from "./service";

const GROUPS = [
  {
    id: "01",
    key: "vieclamonline2024",
    name: "Cộng Đồng Tuyển Dụng CTV & Việc Làm Online Toàn Quốc 2024",
    url: "facebook.com/groups/vieclamonline2024",
    frequency: "15 bài",
    members: "125.4K",
  },
  {
    id: "02",
    key: "muabanonline2024",
    name: "Hội Mua Bán Online & Tuyển Dụng Hà Nội - Sài Gòn",
    url: "facebook.com/groups/muabanonline2024",
    frequency: "15 bài",
    members: "89.2K",
  },
  {
    id: "03",
    key: "sinhvientimvieclam",
    name: "Góc Sinh Viên Tìm Việc Làm Thêm - Thực Tập 2024",
    url: "facebook.com/groups/sinhvientimvieclam",
    frequency: "15 bài",
    members: "64.8K",
  },
  {
    id: "04",
    key: "chodocu",
    name: "Chợ Đồ Cũ & Kinh Doanh Khởi Nghiệp Việt Nam",
    url: "facebook.com/groups/chodocu",
    frequency: "15 bài",
    members: "98.1K",
  },
  {
    id: "05",
    key: "freelancermarketing",
    name: "Cộng Đồng Freelancer & Digital Marketing Việt Nam",
    url: "facebook.com/groups/freelancermarketing",
    frequency: "15 bài",
    members: "142.5K",
  },
  {
    id: "06",
    key: "vieclamtainha",
    name: "Mẹ Bỉm Sữa Kinh Doanh Online & Chia Sẻ Kinh Nghiệm",
    url: "facebook.com/groups/vieclamtainha",
    frequency: "15 bài",
    members: "75.3K",
  },
];

const INITIAL_POST = `Tuyển CTV làm online tại nhà 💻
Công việc đơn giản, thời gian linh hoạt, phù hợp cho sinh viên, mẹ bỉm, nhân viên văn phòng muốn tăng thêm thu nhập.
Ai quan tâm ib mình nhé! 💙`;

const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700",
  "bg-violet-100 text-violet-700",
  "bg-emerald-100 text-emerald-700",
  "bg-indigo-100 text-indigo-700",
  "bg-slate-100 text-slate-600",
];

function SectionCard({ number, title, description, aside, children, className = "" }) {
  return (
    <Card className={`overflow-hidden border-slate-200 shadow-sm ${className}`}>
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
        <div className="flex min-w-0 items-start gap-3">
          {number && (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
              {number}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="font-heading text-sm font-bold leading-5 text-slate-800">{title}</h3>
            {description && <p className="mt-0.5 text-[11px] leading-4 text-slate-400">{description}</p>}
          </div>
        </div>
        {aside}
      </div>
      <div className="px-6 py-5">{children}</div>
    </Card>
  );
}

function Field({ label, required = false, children, className = "" }) {
  return (
    <label className={`block space-y-1.5 ${className}`}>
      <span className="text-[11px] font-semibold text-slate-600">
        {label} {required && <span className="text-slate-400">(bắt buộc)</span>}
      </span>
      {children}
    </label>
  );
}

function SelectField({ value, onChange, children, className = "" }) {
  return (
    <select
      value={value}
      onChange={onChange}
      className={`h-9 w-full rounded-md border border-input bg-white px-3 text-xs text-slate-700 shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${className}`}
    >
      {children}
    </select>
  );
}

function CheckLabel({ checked, onCheckedChange, children }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[11px] font-medium text-slate-700">
      <Checkbox checked={checked} onCheckedChange={onCheckedChange} />
      {children}
    </label>
  );
}

function initialsOf(name = "") {
  return String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "FB";
}

function normalizeAccount(account, index) {
  return {
    ...account,
    key: String(account.id ?? account.uid ?? index),
    name: account.profile_name || account.name || `Tài khoản Facebook ${index + 1}`,
    uid: String(account.uid || "—"),
    status: String(account.status || "NEW").toUpperCase(),
  };
}

export default function GroupSpamModule({ subPage = "groups.post" }) {
  const isComment = subPage === "groups.comment";
  const mediaInputRef = useRef(null);
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountSearch, setAccountSearch] = useState("");
  const [selectedAccountKeys, setSelectedAccountKeys] = useState([]);
  const [model, setModel] = useState("gpt-4o");
  const [apiKey, setApiKey] = useState("");
  const [threads, setThreads] = useState("2");
  const [restMinutes, setRestMinutes] = useState("10");
  const [maxPosts, setMaxPosts] = useState("10");
  const [groupSource, setGroupSource] = useState("search");
  const [groupSearch, setGroupSearch] = useState("việc làm online, tuyển dụng ctv, kinh doanh online");
  const [groupFilter, setGroupFilter] = useState("");
  const [selectedGroupKeys, setSelectedGroupKeys] = useState(GROUPS.map((group) => group.key));
  const [mediaFiles, setMediaFiles] = useState([]);
  const [minMedia, setMinMedia] = useState("1");
  const [maxMedia, setMaxMedia] = useState("4");
  const [prompt, setPrompt] = useState("");
  const [aiCount, setAiCount] = useState("5");
  const [posts, setPosts] = useState(Array.from({ length: 5 }, (_, index) => (index === 0 ? INITIAL_POST : "")));
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

  useEffect(() => {
    let active = true;
    getAccounts()
      .then((data) => {
        if (!active) return;
        const rows = (data.accounts || []).map(normalizeAccount);
        setAccounts(rows);
        setSelectedAccountKeys(rows.filter((account) => account.status === "LIVE").slice(0, 4).map((account) => account.key));
      })
      .catch(() => {
        if (active) setAccounts([]);
      })
      .finally(() => {
        if (active) setAccountsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();
    if (!query) return accounts;
    return accounts.filter((account) => `${account.name} ${account.uid}`.toLowerCase().includes(query));
  }, [accountSearch, accounts]);

  const filteredGroups = useMemo(() => {
    const query = groupFilter.trim().toLowerCase();
    if (!query) return GROUPS;
    return GROUPS.filter((group) => `${group.name} ${group.url}`.toLowerCase().includes(query));
  }, [groupFilter]);

  const selectedAccounts = accounts.filter((account) => selectedAccountKeys.includes(account.key));
  const selectedGroups = GROUPS.filter((group) => selectedGroupKeys.includes(group.key));
  const generatedCount = posts.filter((post) => post.trim()).length;
  const totalPlanned = Math.min(Number(maxPosts) || 0, selectedGroups.length * Math.max(selectedAccounts.length, 1));

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

  const generatePosts = () => {
    const amount = Math.max(1, Math.min(10, Number(aiCount) || 1));
    const source = prompt.trim() || "Viết bài tuyển cộng tác viên làm online tại nhà, giọng văn thân thiện và rõ ràng.";
    setPosts(
      Array.from({ length: amount }, (_, index) =>
        index === 0
          ? `${source}\n\nCông việc linh hoạt, phù hợp cho người muốn tăng thêm thu nhập. Ai quan tâm hãy nhắn tin để nhận thông tin chi tiết nhé! 💙`
          : `${source}\n\nPhiên bản ${index + 1}: Nội dung được điều chỉnh để hạn chế trùng lặp khi đăng vào nhiều nhóm.`,
      ),
    );
    setActivePost(0);
  };

  const updateActivePost = (value) => {
    setPosts((current) => current.map((post, index) => (index === activePost ? value : post)));
  };

  const handleStart = async () => {
    if (!selectedAccounts.length || !selectedGroups.length) return;
    setRunState("starting");
    setProgress(4);
    try {
      await runGroupCampaign({
        action_type: isComment ? "COMMENT" : "POST",
        account_ids: selectedAccounts.map((account) => account.id),
        account_uids: selectedAccounts.map((account) => account.uid),
        groups: selectedGroups,
        posts,
        media: mediaFiles.map((file) => file.name),
        settings: {
          model,
          threads: Number(threads),
          rest_minutes: Number(restMinutes),
          max_posts: Number(maxPosts),
          delay_min: Number(delayMin),
          delay_max: Number(delayMax),
          avoid_duplicate: avoidDuplicate,
          shuffle_content: shuffleContent,
          schedule_at: scheduleEnabled && scheduleDate ? `${scheduleDate}T${scheduleTime}` : null,
        },
      });
      setRunState("running");
      setProgress(12);
    } catch {
      setRunState("idle");
      setProgress(0);
    }
  };

  const handleStop = () => {
    setRunState("idle");
    setProgress(0);
  };

  return (
    <div className="mx-auto max-w-[1180px] space-y-5 pb-3">
      <div className="flex items-center gap-3 px-1 py-1">
        <span className="flex size-10 items-center justify-center rounded-lg border border-blue-100 bg-white text-primary shadow-sm">
          <Play className="size-5 fill-primary" />
        </span>
        <div>
          <h1 className="font-heading text-xl font-extrabold tracking-[-0.03em] text-slate-900">
            Spam Group – {isComment ? "Bình luận" : "Đăng bài"}
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Tự động {isComment ? "bình luận vào bài viết" : "tìm kiếm và đăng bài vào"} các hội nhóm Facebook theo từ khóa hoặc từ file link nhóm.
          </p>
        </div>
      </div>

      <SectionCard
        number="1"
        title="Chọn tài khoản / người dùng đi seeding"
        description={`Chọn danh sách tài khoản Facebook sẽ thực hiện ${isComment ? "bình luận" : "đăng bài"} và tương tác`}
        aside={
          <Badge variant="success" className="shrink-0 border-0 px-3 py-1">
            ● Đã chọn {selectedAccounts.length}/{accounts.length} tài khoản
          </Badge>
        }
      >
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
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
          <Button type="button" variant="outline" size="icon" className="size-8" onClick={() => setAccountSearch("")}>
            <RefreshCw className="size-3.5" />
          </Button>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200">
          <div className="max-h-[330px] overflow-auto">
            <table className="w-full min-w-[650px] text-left text-[11px]">
              <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="w-12 px-4 py-3"><Checkbox checked={filteredAccounts.length > 0 && filteredAccounts.every((account) => selectedAccountKeys.includes(account.key))} onCheckedChange={(checked) => setSelectedAccountKeys(checked ? filteredAccounts.map((account) => account.key) : [])} /></th>
                  <th className="px-3 py-3 font-semibold">Tài khoản Facebook</th>
                  <th className="px-3 py-3 font-semibold">UID Facebook</th>
                  <th className="px-3 py-3 font-semibold">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAccounts.map((account, index) => {
                  const selected = selectedAccountKeys.includes(account.key);
                  return (
                    <tr key={account.key} className={selected ? "bg-blue-50/30" : "bg-white"}>
                      <td className="px-4 py-2.5"><Checkbox checked={selected} onCheckedChange={(checked) => toggleAccount(account.key, checked)} /></td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar className="size-8 border-0">
                            <AvatarFallback className={AVATAR_COLORS[index % AVATAR_COLORS.length]}>{initialsOf(account.name)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-semibold text-slate-700">{account.name}</p>
                            <p className="text-[10px] text-slate-400">Tài khoản Module 2</p>
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
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400">Chưa có tài khoản phù hợp trong Module 2.</td></tr>
                )}
                {accountsLoading && (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400">Đang tải tài khoản...</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[10px] text-slate-400">
          <div className="flex items-center gap-4">
            <span>Hiển thị <strong className="text-slate-600">{Math.min(filteredAccounts.length, 10)}/{accounts.length}</strong> tài khoản</span>
            <span>Dòng / trang: <select className="ml-1 rounded border border-slate-200 bg-white px-2 py-1"><option>10</option></select></span>
            <button type="button" className="font-semibold text-primary">Xem tất cả →</button>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" className="rounded border border-slate-200 p-1.5 text-slate-400"><ChevronLeft className="size-3" /></button>
            <button type="button" className="size-7 rounded bg-primary font-semibold text-white">1</button>
            <button type="button" className="size-7 rounded border border-slate-200 bg-white">2</button>
            <button type="button" className="size-7 rounded border border-slate-200 bg-white">3</button>
            <button type="button" className="rounded border border-slate-200 p-1.5 text-slate-500"><ChevronRight className="size-3" /></button>
          </div>
        </div>
      </SectionCard>

      <SectionCard number="2" title="Cấu hình API & thông số chung">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Model AI" required>
            <SelectField value={model} onChange={(event) => setModel(event.target.value)}>
              <option value="gpt-4o">GPT-4o (OpenAI)</option>
              <option value="gpt-4o-mini">GPT-4o mini (OpenAI)</option>
              <option value="gemini">Gemini</option>
            </SelectField>
            <span className="block text-[10px] font-normal text-slate-400">Chọn mô hình AI tạo nội dung theo phong cách mong muốn.</span>
          </Field>
          <Field label="API Key" required>
            <Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-ant-api03-••••••••••••••••" className="font-mono" />
            <span className="block text-[10px] font-normal text-slate-400">Nhập API Key hợp lệ của nhà cung cấp AI đã chọn.</span>
          </Field>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Luồng"><Input type="number" min="1" value={threads} onChange={(event) => setThreads(event.target.value)} /></Field>
          <Field label="Nghỉ (phút)"><Input type="number" min="0" value={restMinutes} onChange={(event) => setRestMinutes(event.target.value)} /></Field>
          <Field label={`Max ${isComment ? "bình luận" : "bài"}`}><Input type="number" min="1" value={maxPosts} onChange={(event) => setMaxPosts(event.target.value)} /></Field>
        </div>
      </SectionCard>

      <SectionCard number="3" title="Nguồn nhóm">
        <div className="grid gap-3 md:grid-cols-2">
          <button type="button" onClick={() => setGroupSource("search")} className={`rounded-lg border p-4 text-left transition-colors ${groupSource === "search" ? "border-primary bg-blue-50/50 ring-1 ring-primary" : "border-slate-200 bg-white"}`}>
            <div className="flex items-center gap-2 text-xs font-bold text-slate-700"><span className={`size-3 rounded-full border-[3px] ${groupSource === "search" ? "border-primary" : "border-slate-300"}`} /><Search className="size-4 text-primary" /> Tìm kiếm nhóm theo từ khóa</div>
            <p className="mt-1 pl-5 text-[10px] text-slate-400">Hệ thống tự động tìm các nhóm liên quan đến từ khóa và đăng bài.</p>
          </button>
          <button type="button" onClick={() => setGroupSource("file")} className={`rounded-lg border p-4 text-left transition-colors ${groupSource === "file" ? "border-primary bg-blue-50/50 ring-1 ring-primary" : "border-slate-200 bg-white"}`}>
            <div className="flex items-center gap-2 text-xs font-bold text-slate-700"><span className={`size-3 rounded-full border-[3px] ${groupSource === "file" ? "border-primary" : "border-slate-300"}`} /><Link2 className="size-4 text-slate-500" /> Từ file link nhóm</div>
            <p className="mt-1 pl-5 text-[10px] text-slate-400">Đăng bài vào các nhóm trong file link. Hỗ trợ file .txt, .csv, .xlsx.</p>
          </button>
        </div>

        {groupSource === "search" ? (
          <>
            <div className="mt-5 flex gap-2">
              <div className="relative flex-1"><Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" /><Input value={groupSearch} onChange={(event) => setGroupSearch(event.target.value)} className="pl-9" /></div>
              <Button type="button" size="sm"><Search className="mr-1.5 size-3.5" /> Tìm kiếm nhóm</Button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px]">
              <span className="flex items-center gap-1 font-semibold text-slate-600"><ListFilter className="size-3.5 text-primary" /> Bộ lọc nhóm:</span>
              <span className="rounded border border-slate-200 bg-white px-3 py-2 text-slate-500">Thành viên từ: <strong className="ml-3 text-slate-700">50000</strong> TV</span>
              {["> 10K", "> 50K TV", "> 100K TV"].map((item) => <button type="button" key={item} className={`rounded border px-3 py-2 font-semibold ${item === "> 50K TV" ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-500"}`}>{item}</button>)}
              <SelectField className="h-8 w-auto"><option>Tất cả loại nhóm</option><option>Nhóm công khai</option></SelectField>
              <span className="rounded bg-blue-50 px-3 py-2 font-semibold text-primary"><Check className="mr-1 inline size-3" />Áp dụng bộ lọc</span>
              <button type="button" className="px-2 py-2 text-slate-500">Đặt lại</button>
            </div>
          </>
        ) : (
          <button type="button" className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-primary/40 bg-blue-50/30 p-6 text-xs font-semibold text-primary">
            <FileSpreadsheet className="size-5" /> Chọn file chứa danh sách link nhóm
          </button>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" /><Input value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)} placeholder="Lọc nhóm trong kết quả..." className="h-8 pl-9" /></div>
          <Button type="button" size="sm" variant="outline" onClick={() => setSelectedGroupKeys(filteredGroups.map((group) => group.key))}><Check className="mr-1 size-3.5" /> Chọn tất cả</Button>
          <Button type="button" size="sm" variant="outline" className="border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600" onClick={() => setSelectedGroupKeys([])}><Trash2 className="mr-1 size-3.5" /> Xóa nhóm đã chọn</Button>
          <Button type="button" size="sm" variant="outline" className="text-primary"><Plus className="mr-1 size-3.5" /> Thêm nhóm thủ công</Button>
        </div>

        <div className="my-4 flex items-center justify-between text-[10px]">
          <span className="font-semibold text-emerald-600">● Tìm thấy 68 nhóm phù hợp</span>
          <span className="text-slate-400">Đang hiển thị {filteredGroups.length} nhóm / trang</span>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200">
          <div className="overflow-auto">
            <table className="w-full min-w-[760px] text-left text-[10px]">
              <thead className="bg-slate-50 text-slate-500"><tr className="border-b border-slate-200"><th className="w-10 px-3 py-3"><Checkbox checked={filteredGroups.every((group) => selectedGroupKeys.includes(group.key))} onCheckedChange={(checked) => setSelectedGroupKeys(checked ? filteredGroups.map((group) => group.key) : [])} /></th><th className="w-10 px-2 py-3 font-semibold">STT</th><th className="px-3 py-3 font-semibold">Tên nhóm & Link UID</th><th className="px-3 py-3 font-semibold">Tần suất/ngày</th><th className="px-3 py-3 font-semibold">Thành viên</th><th className="w-16 px-3 py-3 text-center font-semibold">Thao tác</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {filteredGroups.map((group) => (
                  <tr key={group.key} className={selectedGroupKeys.includes(group.key) ? "bg-blue-50/20" : "bg-white"}>
                    <td className="px-3 py-2.5"><Checkbox checked={selectedGroupKeys.includes(group.key)} onCheckedChange={(checked) => toggleGroup(group.key, checked)} /></td>
                    <td className="px-2 py-2.5 text-slate-400">{group.id}</td>
                    <td className="px-3 py-2.5"><p className="font-semibold text-slate-700">{group.name}</p><a href={`https://${group.url}`} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-primary">{group.url}<ExternalLink className="size-2.5" /></a></td>
                    <td className="px-3 py-2.5 text-slate-500">{group.frequency}</td>
                    <td className="px-3 py-2.5 font-semibold text-slate-600">{group.members} TV</td>
                    <td className="px-3 py-2.5 text-center"><button type="button" onClick={() => toggleGroup(group.key, false)} className="text-slate-400 hover:text-red-500"><Trash2 className="size-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </SectionCard>

      <SectionCard number="4" title="Chọn media (ảnh/video)">
        <div className="mb-4 flex h-9 items-center justify-center rounded-md bg-primary text-xs font-semibold text-white"><ImageIcon className="mr-2 size-4" /> Hình ảnh + Video</div>
        <input ref={mediaInputRef} type="file" multiple accept="image/*,video/*" className="hidden" onChange={(event) => handleFiles(event.target.files)} />
        <button type="button" onClick={() => mediaInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); handleFiles(event.dataTransfer.files); }} className="flex min-h-40 w-full flex-col items-center justify-center rounded-lg border border-dashed border-blue-200 bg-slate-50/60 text-center transition-colors hover:bg-blue-50/40">
          <span className="flex size-12 items-center justify-center rounded-full bg-blue-100 text-primary"><Plus className="size-5" /></span>
          <span className="mt-3 text-xs font-bold text-slate-700">{mediaFiles.length ? `Đã chọn ${mediaFiles.length} tệp media` : "Nhấp để tải ảnh lên hoặc kéo thả"}</span>
          <span className="mt-1 text-[10px] text-slate-400">Hỗ trợ JPG, PNG (tối đa 10 ảnh)</span>
        </button>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Tối thiểu media mỗi bài"><Input type="number" min="0" value={minMedia} onChange={(event) => setMinMedia(event.target.value)} /></Field>
          <Field label="Tối đa media mỗi bài"><Input type="number" min="0" value={maxMedia} onChange={(event) => setMaxMedia(event.target.value)} /></Field>
        </div>
      </SectionCard>

      <SectionCard number="5" title="Tạo nội dung bằng AI">
        <div className="grid gap-4 md:grid-cols-[1fr_320px]">
          <Field label="Nội dung gốc chủ đề/mô tả">
            <div className="relative"><Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={2000} placeholder="Nhập nội dung gốc để AI tạo ra các bài đăng..." className="min-h-24 resize-none pb-6" /><span className="absolute bottom-2 right-3 text-[9px] text-slate-400">{prompt.length}/2000</span></div>
          </Field>
          <div className="space-y-3">
            <Field label="Số lượng bài AI tạo ra"><SelectField value={aiCount} onChange={(event) => setAiCount(event.target.value)}>{[1, 3, 5, 10].map((count) => <option key={count} value={count}>{count}</option>)}</SelectField></Field>
            <Button type="button" className="w-full" onClick={generatePosts}><Sparkles className="mr-2 size-4" /> Tạo nội dung AI</Button>
          </div>
        </div>

        <div className="mt-6 border-t border-slate-100 pt-5">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div><h4 className="text-sm font-bold text-slate-800">Kết quả nội dung AI ({posts.length} bài)</h4><p className="text-[10px] text-slate-400">Bạn có thể chỉnh sửa nội dung trước khi đăng</p></div>
            <Button type="button" size="sm" variant="outline" className="text-primary" onClick={generatePosts}><RotateCcw className="mr-1.5 size-3.5" /> Tạo lại</Button>
          </div>
          <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            {posts.map((_, index) => <button type="button" key={index} onClick={() => setActivePost(index)} className={`h-9 min-w-20 flex-1 text-[10px] font-semibold ${activePost === index ? "bg-primary text-white" : "text-slate-500 hover:bg-white"}`}>Bài {index + 1}</button>)}
          </div>
          <p className="mb-2 mt-4 text-[11px] font-semibold text-slate-600">Nội dung bài {activePost + 1}</p>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center gap-1 border-b border-slate-100 bg-slate-50 px-3 py-2 text-slate-500">
              {[Bold, Italic, Underline, List, Link2, ImageIcon].map((Icon, index) => <button type="button" key={index} className="rounded p-1.5 hover:bg-white hover:text-primary"><Icon className="size-3.5" /></button>)}
            </div>
            <Textarea value={posts[activePost] || ""} onChange={(event) => updateActivePost(event.target.value)} maxLength={2000} className="min-h-36 resize-none rounded-none border-0 shadow-none focus-visible:ring-0" />
            <div className="px-3 pb-2 text-right text-[9px] text-slate-400">{(posts[activePost] || "").length}/2000</div>
          </div>
        </div>
      </SectionCard>

      <SectionCard number="6" title={`Cài đặt ${isComment ? "bình luận" : "đăng bài"}`}>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <CheckLabel checked={scheduleEnabled} onCheckedChange={setScheduleEnabled}>Bật hẹn giờ đăng bài</CheckLabel>
          <CheckLabel checked={avoidDuplicate} onCheckedChange={setAvoidDuplicate}>Không đăng trùng nội dung</CheckLabel>
          <CheckLabel checked={shuffleContent} onCheckedChange={setShuffleContent}>Đăng ngẫu nhiên nội dung (nếu có nhiều nội dung)</CheckLabel>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label="Thời gian nghỉ giữa các lần đăng (giây)">
            <div className="flex items-center gap-3"><Input type="number" min="0" value={delayMin} onChange={(event) => setDelayMin(event.target.value)} className="text-center" /><span className="text-slate-400">–</span><Input type="number" min="0" value={delayMax} onChange={(event) => setDelayMax(event.target.value)} className="text-center" /><span className="text-[10px] text-slate-400">giây</span></div>
          </Field>
          <Field label="Thời gian bắt đầu (tùy chọn)">
            <div className="grid grid-cols-2 gap-3">
              <div className="relative"><CalendarDays className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" /><Input type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} className="pl-9" /></div>
              <div className="relative"><Clock3 className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" /><Input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} className="pl-9" /></div>
            </div>
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Thông tin tác vụ cấu hình" aside={<Info className="size-4 text-primary" />}>
        <div className="grid gap-x-10 gap-y-3 text-[11px] md:grid-cols-2">
          {[
            [<Users key="a" className="size-3.5" />, "Tài khoản", `${selectedAccounts.length} tài khoản đã chọn`],
            [<ListFilter key="b" className="size-3.5" />, `Max ${isComment ? "bình luận" : "bài"}`, `${maxPosts} bài`],
            [<Sparkles key="c" className="size-3.5" />, "API Key", apiKey ? "Đã nhập" : "Chưa nhập"],
            [<Sparkles key="d" className="size-3.5" />, "Số bài AI", `${generatedCount} bài`],
            [<Search key="e" className="size-3.5" />, "Nguồn nhóm", groupSource === "search" ? "Tìm theo từ khóa" : "Từ file link nhóm"],
            [<ImageIcon key="f" className="size-3.5" />, "Min / Max media", `${minMedia} – ${maxMedia} ảnh`],
            [<RefreshCw key="g" className="size-3.5" />, "Luồng chạy", `${threads} luồng`],
            [<Clock3 key="h" className="size-3.5" />, "Giãn cách đăng", `${delayMin} – ${delayMax} giây`],
            [<Clock3 key="i" className="size-3.5" />, "Nghỉ", `${restMinutes} phút`],
            [<CalendarDays key="j" className="size-3.5" />, "Hẹn giờ", scheduleEnabled ? (scheduleDate ? `${scheduleDate} ${scheduleTime}` : "Đã kích hoạt") : "Đã tắt"],
          ].map(([icon, label, value]) => (
            <div key={label} className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <span className="flex items-center gap-2 text-slate-500">{icon}{label}</span>
              <strong className={value === "Đã nhập" || (label === "Hẹn giờ" && scheduleEnabled) ? "text-emerald-600" : "text-slate-700"}>{value}</strong>
            </div>
          ))}
        </div>
      </SectionCard>

      <Card className="min-h-64 border-slate-200 p-5 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700"><span className="flex size-5 items-center justify-center rounded bg-emerald-50 text-emerald-600">▥</span> Theo dõi tiến trình</div>
        {runState !== "idle" ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3"><Progress value={progress} className="max-w-xl" /><p className="text-xs font-semibold text-primary">{runState === "starting" ? "Đang khởi tạo tác vụ..." : `Đang thực hiện ${progress}/${Math.max(totalPlanned, 1)} tác vụ`}</p></div>
        ) : (
          <div className="flex min-h-48 items-center justify-center text-xs text-slate-300">Tiến trình sẽ hiển thị sau khi bắt đầu đăng bài.</div>
        )}
      </Card>

      <Card className="sticky bottom-0 z-20 flex flex-col items-center justify-between gap-4 border-slate-200 bg-white/95 px-6 py-4 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur sm:flex-row">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><Check className="size-4" /></span>
          <div><p className="text-xs font-bold text-slate-700">Sẵn sàng thực thi tiến trình {isComment ? "bình luận" : "đăng bài"}</p><p className="text-[10px] text-slate-400">Hệ thống sẽ chạy tự động theo các thông số đã cấu hình ở trên</p></div>
        </div>
        <div className="flex gap-3">
          <Button type="button" variant="destructive" disabled={runState === "idle"} onClick={handleStop}><Square className="mr-2 size-3 fill-current" /> DỪNG ĐĂNG</Button>
          <Button type="button" variant="success" disabled={runState !== "idle" || !selectedAccounts.length || !selectedGroups.length} onClick={handleStart}><Play className="mr-2 size-3.5 fill-current" /> BẮT ĐẦU {isComment ? "BÌNH LUẬN" : "ĐĂNG BÀI"}</Button>
        </div>
      </Card>
    </div>
  );
}
