"use client";

import React from "react";
import {
  Info,
  FolderPlus,
  Users,
  ListFilter,
  Sparkles,
  Search,
  ImageIcon,
  RefreshCw,
  Clock3,
  CalendarDays,
} from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { SectionCard } from "../../shared/components";

export default function GroupSummarySection({
  campaignName,
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
  delayUnit = "seconds",
  restMinutes = "10",
  scheduleEnabled = false,
  scheduleDate = "",
  scheduleTime = "",
  stepNumber = "8",
  contentType = "post",
}) {
  const isComment = contentType === "comment";
  const itemLabel = isComment ? "bình luận" : "bài";
  const summaryItems = [
    [
      <FolderPlus key="camp" className="size-3.5" />,
      "Chiến dịch",
      campaignName ? campaignName : "Chưa đặt tên",
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
      `Hạn ${itemLabel}`,
      `${maxPosts} ${itemLabel} (kế hoạch ${totalPlanned} ${itemLabel})`,
    ],
    [
      <Sparkles key="c" className="size-3.5" />,
      "API Key",
      hasApiKey ? `Đã cấu hình (${modelDisplayName})` : "Chưa cấu hình",
    ],
    [
      <Sparkles key="d" className="size-3.5" />,
      `Số ${itemLabel} AI`,
      `${generatedCount} / ${postsCount} ${itemLabel}`,
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
      "Media đính kèm",
      mediaFilesCount
        ? `${mediaFilesCount} tệp đã chọn (${minMedia} – ${maxMedia} ảnh/${itemLabel})`
        : "Không kèm media (Văn bản thuần)",
    ],
    [<RefreshCw key="g" className="size-3.5" />, "Luồng chạy", `${threads} luồng`],
    [
      <Clock3 key="h" className="size-3.5" />,
      `Giãn cách ${isComment ? "bình luận" : "đăng"}`,
      `${delayMin} – ${delayMax} ${delayUnit === "minutes" ? "phút" : "giây"}`,
    ],
    [
      <CalendarDays key="j" className="size-3.5" />,
      "Hẹn giờ",
      scheduleEnabled ? (scheduleDate ? `${scheduleDate} ${scheduleTime}` : "Đã kích hoạt") : "Đã tắt",
    ],
  ];

  const safetyTooltip = (
    <div className="space-y-2.5 text-left">
      <p className="flex items-center gap-1.5 border-b border-slate-200 pb-2 text-base font-semibold text-slate-800">
        <Info className="size-3.5 text-primary" />
        Lưu ý vận hành an toàn
      </p>
      <p className="text-sm text-slate-600">Cần nhập API Key hợp lệ khi muốn tạo tự động nội dung {itemLabel} bằng AI.</p>
      <p className="text-sm text-slate-600">Thiết lập luồng (1 - 3) và thời gian nghỉ tối thiểu 10 phút để tránh checkpoint.</p>
      <p className="text-sm text-slate-600">Bật chế độ xáo trộn ngẫu nhiên để nội dung mỗi nhóm là duy nhất.</p>
      <p className="text-sm text-slate-600">Kiểm tra trạng thái tài khoản Live trước khi nhấn bắt đầu tác vụ.</p>
    </div>
  );

  return (
    <SectionCard
      number={stepNumber}
      title="Thông tin cấu hình tổng hợp"
      className="relative z-20 !overflow-visible"
      aside={(
        <Tooltip
          content={safetyTooltip}
          position="bottom"
          align="right"
          variant="light"
          containerClassName="inline-flex items-center"
          className="max-w-[270px] bg-slate-50 p-4 text-[11px] text-slate-600 shadow-xl"
        >
          <button
            type="button"
            aria-label="Xem lưu ý vận hành an toàn"
            className="inline-flex rounded-full text-primary transition-colors hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Info size={20} />
          </button>
        </Tooltip>
      )}
    >
      <div className="grid gap-x-10 gap-y-3 text-sm md:grid-cols-2">
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
