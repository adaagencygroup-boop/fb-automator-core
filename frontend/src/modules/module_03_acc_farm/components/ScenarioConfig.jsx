"use client";

import { Bot } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { MAX_TIME_VALUE } from "../constants";
import { NumberInput, RangeInput, SectionCard } from "./parts";

// Giá trị mặc định khớp FarmScenarioConfig phía BE (routes.py)
export const DEFAULT_CONFIG = {
  enabled_newsfeed: true,
  newsfeed_time_min: "3",
  newsfeed_time_max: "7",
  newsfeed_delay_min: "5",
  newsfeed_delay_max: "15",
  enabled_watch: true,
  watch_time_min: "3",
  watch_time_max: "7",
  watch_delay_min: "5",
  watch_delay_max: "15",
  enabled_join_groups: false,
  group_keyword: "",
  groups_min: "1",
  groups_max: "3",
  groups_delay_min: "10",
  groups_delay_max: "20",
  enabled_add_friends: false,
  friends_min: "3",
  friends_max: "7",
  friends_delay_min: "5",
  friends_delay_max: "15",
  friends_fallback_group_members: false,
  enabled_check_notif: false,
  daily_limit_enabled: true,
  daily_friend_limit: "20",
  daily_group_limit: "5",
};

const BOOL_KEYS = Object.keys(DEFAULT_CONFIG).filter((k) => typeof DEFAULT_CONFIG[k] === "boolean");

/** Chuyển state (chuỗi khi gõ) sang body gửi BE */
export function toPayload(config) {
  const out = {};
  for (const [key, value] of Object.entries(config)) {
    if (BOOL_KEYS.includes(key)) out[key] = Boolean(value);
    else if (key === "group_keyword") out[key] = String(value || "").trim();
    else out[key] = Math.max(0, parseInt(value, 10) || 0);
  }
  return out;
}

export const GROUP_KEYWORD_MAX_LEN = 50;

function Block({ checked, onCheck, title, hint, disabled, children }) {
  return (
    <div className={`rounded-xl border px-4 py-3 transition-colors ${checked ? "border-blue-100 bg-[#F0F5FF]" : "border-border bg-slate-50/60"}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <label className="flex min-w-[220px] cursor-pointer items-center gap-2.5">
          <Checkbox checked={checked} onCheckedChange={onCheck} disabled={disabled} />
          <span>
            <span className="block text-[13px] font-bold text-slate-800">{title}</span>
            {hint && <span className="block text-[11px] text-slate-400">{hint}</span>}
          </span>
        </label>
        {children && <div className={`flex flex-wrap items-center gap-x-6 gap-y-2 ${checked ? "" : "opacity-50"}`}>{children}</div>}
      </div>
    </div>
  );
}

export default function ScenarioConfig({ config, onChange, disabled }) {
  const set = (key) => (value) => onChange({ ...config, [key]: value });
  const range = (prefix, max) => ({
    low: config[`${prefix}_min`],
    high: config[`${prefix}_max`],
    onLow: set(`${prefix}_min`),
    onHigh: set(`${prefix}_max`),
    max,
    disabled,
  });

  return (
    <SectionCard icon={Bot} title="Cấu Hình Tương Tác" subtitle="Mỗi nick lấy ngẫu nhiên trong khoảng Min - Max; thứ tự kịch bản xáo ngẫu nhiên">
      <div className="space-y-3">
        <Block
          checked={config.enabled_newsfeed}
          onCheck={set("enabled_newsfeed")}
          disabled={disabled}
          title="Lướt Newsfeed tự nhiên"
        >
          <RangeInput label="Thời gian:" unit="phút" {...range("newsfeed_time", MAX_TIME_VALUE)} />
          <RangeInput label="Delay" unit="giây" {...range("newsfeed_delay", MAX_TIME_VALUE)} />
        </Block>

        <Block checked={config.enabled_watch} onCheck={set("enabled_watch")} disabled={disabled} title="Xem Video Watch Facebook">
          <RangeInput label="Thời gian:" unit="phút" {...range("watch_time", MAX_TIME_VALUE)} />
          <RangeInput label="Xem mỗi video" unit="giây" {...range("watch_delay", MAX_TIME_VALUE)} />
        </Block>

        <Block
          checked={config.enabled_join_groups}
          onCheck={set("enabled_join_groups")}
          disabled={disabled}
          title="Tham gia nhóm theo từ khóa"
          hint="Để trống từ khóa: tham gia nhóm đề xuất"
        >
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Từ khóa</span>
            <input
              value={config.group_keyword}
              maxLength={GROUP_KEYWORD_MAX_LEN}
              disabled={disabled}
              onChange={(e) => set("group_keyword")(e.target.value)}
              placeholder="vd: Trọ Cầu Giấy, Review đồ gia dụng"
              className="h-8 w-56 rounded-md border border-border bg-white px-2.5 text-xs font-semibold text-slate-800 shadow-sm placeholder:font-normal placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50"
            />
          </div>
          <RangeInput label="Số lượng nhóm" unit="nhóm" {...range("groups")} />
          <RangeInput label="Nghỉ giữa 2 nhóm" unit="giây" min={5} {...range("groups_delay", MAX_TIME_VALUE)} />
        </Block>

        <Block checked={config.enabled_add_friends} onCheck={set("enabled_add_friends")} disabled={disabled} title="Kết bạn theo gợi ý">
          <RangeInput label="Số lượng mời" unit="người" {...range("friends")} />
          <RangeInput label="Nghỉ giữa 2 lời mời" unit="giây" min={3} {...range("friends_delay", MAX_TIME_VALUE)} />
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
            <Checkbox
              checked={config.friends_fallback_group_members}
              onCheckedChange={set("friends_fallback_group_members")}
              disabled={disabled}
            />
            Hết gợi ý thì mời thành viên nhóm đã tham gia
          </label>
        </Block>

        <Block
          checked={config.enabled_check_notif}
          onCheck={set("enabled_check_notif")}
          disabled={disabled}
          title="Check & click thông báo mới"
          hint="Luôn chạy đầu tiên nếu được chọn"
        />

        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2.5">
              <Switch checked={config.daily_limit_enabled} onCheckedChange={set("daily_limit_enabled")} disabled={disabled} />
              <span>
                <span className="block text-[13px] font-bold text-slate-800">Giới hạn mỗi ngày cho mỗi nick</span>
                <span className="block text-[11px] text-slate-400">Lưu theo máy; tính theo ngày giờ Việt Nam</span>
              </span>
            </div>
            <div className={`flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500 ${config.daily_limit_enabled ? "" : "opacity-50"}`}>
              <span className="flex items-center gap-2">
                Tối đa kết bạn
                <NumberInput value={config.daily_friend_limit} onChange={set("daily_friend_limit")} min={1} max={100} disabled={disabled} />
                lời mời
              </span>
              <span className="flex items-center gap-2">
                Tối đa tham gia
                <NumberInput value={config.daily_group_limit} onChange={set("daily_group_limit")} min={1} max={100} disabled={disabled} />
                nhóm
              </span>
            </div>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
