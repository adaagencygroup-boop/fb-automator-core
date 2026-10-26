"use client";

import React from "react";
import {
  Info,
  FolderPlus,
  Hash,
  Users,
  ListFilter,
  Sparkles,
  Search,
  ImageIcon,
  RefreshCw,
  Clock3,
  CalendarDays,
} from "lucide-react";
import { SectionCard } from "../../shared/components";

export default function GroupSummarySection({
  campaignName,
  campaignId,
  selectedAccountsCount = 0,
  liveAccountsCount = 0,
  maxPosts = 0,
  totalPlanned = 0,
  hasApiKey = false,
  modelDisplayName = "",
  generatedCount = 0,
  postsCount = 0,
  groupSource = "search",
  groupSearch = "",
  groupFileName = "",
  activeGroupsCount = 0,
  mediaFilesCount = 0,
  minMedia = "0",
  maxMedia = "0",
  threads = "1",
  delayMin = "30",
  delayMax = "60",
  restMinutes = "10",
  scheduleEnabled = false,
  scheduleDate = "",
  scheduleTime = "",
  stepNumber = "8",
}) {
  const summaryItems = [
    [
      <FolderPlus key="camp" className="size-3.5" />,
      "Chiến dịch",
      campaignName ? campaignName : "Chưa đặt tên",
    ],
    [
      <Hash key="cid" className="size-3.5" />,
      "Mã chiến dịch",
      campaignId || "Tự động tạo mới",
    ],
    [
      <Users key="a" className="size-3.5" />,
      "Tài khoản",
      selectedAccountsCount
        ? `${selectedAccountsCount} tài khoản đã chọn${liveAccountsCount > 0 ? ` (${liveAccountsCount} Live)` : ""}`
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
      `${generatedCount} / ${postsCount} bài`,
    ],
    [
      <Search key="e" className="size-3.5" />,
      "Nguồn nhóm",
      groupSource === "search"
        ? (groupSearch ? `Từ khóa "${groupSearch}" (${activeGroupsCount} nhóm)` : `Tìm theo từ khóa (${activeGroupsCount} nhóm)`)
        : (groupFileName ? `${groupFileName} (${activeGroupsCount} nhóm)` : `Từ file link nhóm (${activeGroupsCount} nhóm)`),
    ],
    [
      <ImageIcon key="f" className="size-3.5" />,
      "Min / Max media",
      mediaFilesCount
        ? `${mediaFilesCount} tệp đã chọn (${minMedia} – ${maxMedia} ảnh/bài)`
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
  ];

  return (
    <SectionCard number={stepNumber} title="Thông tin cấu hình tổng hợp" aside={<Info className="size-4 text-primary" />}>
      <div className="grid gap-x-10 gap-y-3 text-[11px] md:grid-cols-2">
        {summaryItems.map(([icon, label, value]) => (
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
  );
}
