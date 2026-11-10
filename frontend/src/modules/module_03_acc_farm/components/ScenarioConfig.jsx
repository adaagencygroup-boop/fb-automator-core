"use client";

import { useMemo } from "react";
import { Bot, ListChecks, ScanSearch } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import CustomSelect from "@/components/ui/custom-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  LEAVE_CRITERIA_LABELS, LIST_LIMIT_MAX, LIST_LIMIT_MIN, MAX_TIME_VALUE, REACTION_EMOJI, REACTION_TYPES,
} from "../constants";
import { NumberInput, RangeInput, SectionCard } from "./parts";

// ─── Danh sách link dán vào: khớp parse_fb_link / parse_link_list phía BE (routes.py) ───
const FB_LINK_HOSTS = new Set([
  "facebook.com", "www.facebook.com", "web.facebook.com", "m.facebook.com", "mbasic.facebook.com", "fb.com", "www.fb.com",
]);
const LINK_MAX_LEN = 500;
const RESERVED_GROUP_PATHS = new Set(["joins", "discover", "feed", "create", "search", "notifications"]);
const NOT_PROFILE_PATHS = new Set([
  "friends", "groups", "watch", "marketplace", "gaming", "reel", "reels", "photo", "photos", "events", "pages", "search",
  "notifications", "messages", "bookmarks", "stories", "hashtag", "profile.php", "home.php", "login", "share", "people",
  "permalink.php", "story.php",
]);
const NUMERIC = /^\d+$/;
const person = (id) => ({ kind: "friend", key: `id:${id}` });

/** Nhận diện 1 link Facebook: { kind: "group" | "friend", key } hoặc null */
export function parseFbLink(raw) {
  let text = String(raw || "").trim();
  if (!text || text.length > LINK_MAX_LEN || /\s/.test(text)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol) || !FB_LINK_HOSTS.has(url.hostname.toLowerCase())) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const first = (parts[0] || "").toLowerCase();

  if (first === "share" && parts.length >= 2) {
    const kind = parts.length >= 3 && parts[1] === "g" ? "group" : parts.length === 2 ? "friend" : null;
    return kind ? { kind, key: `share:/${parts.join("/")}/` } : null;
  }
  if (first === "groups" && parts.length >= 2) {
    if (parts.length >= 4 && parts[2] === "user" && NUMERIC.test(parts[3])) return person(parts[3]);
    if (RESERVED_GROUP_PATHS.has(parts[1].toLowerCase())) return null;
    return { kind: "group", key: `group:${parts[1].toLowerCase()}` };
  }
  const profileId = url.searchParams.get("profile_id") || "";
  if (NUMERIC.test(profileId)) return person(profileId);
  if (first === "profile.php") {
    const id = url.searchParams.get("id") || "";
    return NUMERIC.test(id) ? person(id) : null;
  }
  if (first === "people" && parts.length >= 3 && NUMERIC.test(parts[2])) return person(parts[2]);
  if (parts.length === 1 && /^[A-Za-z0-9.]{5,}$/.test(parts[0]) && !NOT_PROFILE_PATHS.has(first)) {
    return NUMERIC.test(parts[0]) ? person(parts[0]) : { kind: "friend", key: `user:${first}` };
  }
  return null;
}

/** Tách ô dán link: { count: số link hợp lệ không trùng, duplicates, errors: [{ line, reason }] } */
export function parseLinkList(raw, kind) {
  const label = kind === "group" ? "nhóm" : "trang cá nhân";
  const seen = new Set();
  const errors = [];
  let duplicates = 0;
  String(raw || "").split(/\r?\n/).forEach((value, index) => {
    const line = value.trim();
    if (!line) return;
    const link = parseFbLink(line);
    if (!link) errors.push({ line: index + 1, reason: `không phải link ${label} Facebook hợp lệ` });
    else if (link.kind !== kind) {
      errors.push({ line: index + 1, reason: `là link ${link.kind === "friend" ? "trang cá nhân" : "nhóm"}, ô này chỉ nhận link ${label}` });
    } else if (seen.has(link.key)) duplicates += 1;
    else seen.add(link.key);
  });
  return { count: seen.size, duplicates, errors };
}

/** Lỗi chặn Kích hoạt của ô danh sách link (null = hợp lệ) */
export function linkListError(raw, kind) {
  const title = kind === "group" ? "Danh sách nhóm" : "Danh sách kết bạn";
  const { count, errors } = parseLinkList(raw, kind);
  if (errors.length) return `${title} có ${errors.length} dòng sai (dòng ${errors.slice(0, 5).map((e) => e.line).join(", ")}${errors.length > 5 ? ", ..." : ""}).`;
  if (!count) return `${title} đang trống. Vui lòng dán ít nhất 1 link.`;
  return null;
}

// Giá trị mặc định khớp FarmScenarioConfig phía BE (routes.py)
export const DEFAULT_CONFIG = {
  enabled_newsfeed: true,
  newsfeed_time_min: "3",
  newsfeed_time_max: "7",
  newsfeed_delay_min: "5",
  newsfeed_delay_max: "15",
  newsfeed_react_enabled: false,
  newsfeed_react_types: [],
  enabled_watch: true,
  watch_time_min: "3",
  watch_time_max: "7",
  watch_delay_min: "5",
  watch_delay_max: "15",
  watch_react_enabled: false,
  watch_react_types: [],
  enabled_story: false,
  story_min: "5",
  story_max: "10",
  story_delay_min: "3",
  story_delay_max: "8",
  story_react_enabled: false,
  story_react_types: [],
  enabled_join_groups: false,
  group_source: "keyword",
  group_keyword: "",
  groups_min: "1",
  groups_max: "3",
  groups_delay_min: "10",
  groups_delay_max: "20",
  group_links: "",
  group_list_limit: "10",
  groups_split_enabled: true,
  enabled_add_friends: false,
  friend_source: "suggestions",
  friends_min: "3",
  friends_max: "7",
  friends_delay_min: "5",
  friends_delay_max: "15",
  friends_fallback_group_members: false,
  friend_links: "",
  friend_list_limit: "10",
  friends_split_enabled: true,
  enabled_leave_groups: false,
  leave_min: "3",
  leave_max: "5",
  leave_delay_min: "10",
  leave_delay_max: "30",
  leave_criteria: "not_visited",
  leave_keep_admin: true,
  enabled_check_notif: false,
  daily_limit_enabled: false,
  daily_friend_limit: "20",
  daily_group_limit: "5",
};

const BOOL_KEYS = Object.keys(DEFAULT_CONFIG).filter((k) => typeof DEFAULT_CONFIG[k] === "boolean");
const SOURCE_VALUES = {
  group_source: ["keyword", "list"],
  friend_source: ["suggestions", "list"],
  leave_criteria: Object.keys(LEAVE_CRITERIA_LABELS),
};
const TEXT_KEYS = ["group_links", "friend_links"];

/** Chuyển state (chuỗi khi gõ) sang body gửi BE */
export function toPayload(config) {
  const out = {};
  for (const [key, value] of Object.entries(config)) {
    if (BOOL_KEYS.includes(key)) out[key] = Boolean(value);
    else if (key === "group_keyword") out[key] = String(value || "").trim();
    else if (TEXT_KEYS.includes(key)) out[key] = String(value || "");
    else if (key in SOURCE_VALUES) out[key] = SOURCE_VALUES[key].includes(value) ? value : SOURCE_VALUES[key][0];
    else if (Array.isArray(DEFAULT_CONFIG[key])) out[key] = (Array.isArray(value) ? value : []).filter((t) => REACTION_TYPES.includes(t));
    else out[key] = Math.max(0, parseInt(value, 10) || 0);
  }
  return out;
}

export const GROUP_KEYWORD_MAX_LEN = 50;

// Khoảng phải lớn hơn 0 khi kịch bản đang bật (when: chỉ xét ở chế độ đó)
const POSITIVE_RANGES = [
  ["enabled_newsfeed", "newsfeed_time", "Thời gian lướt Newsfeed"],
  ["enabled_watch", "watch_time", "Thời gian xem Watch"],
  ["enabled_story", "story_delay", "Thời gian xem mỗi Story"],
  ["enabled_leave_groups", "leave", "Số nhóm rời"],
  ["enabled_join_groups", "groups", "Số lượng nhóm tham gia", (c) => c.group_source !== "list"],
  ["enabled_add_friends", "friends", "Số lượng lời mời kết bạn", (c) => c.friend_source !== "list"],
];

/** Khoảng Min - Max bằng 0 ở kịch bản đang bật (cấu hình cũ đã lưu, hoặc chưa rời ô nhập); null = hợp lệ */
export function rangeError(config) {
  for (const [enabled, prefix, label, when] of POSITIVE_RANGES) {
    if (!config[enabled] || (when && !when(config))) continue;
    const low = parseInt(config[`${prefix}_min`], 10);
    const high = parseInt(config[`${prefix}_max`], 10);
    if (!(low > 0) || !(high > 0)) return `${label} phải lớn hơn 0.`;
  }
  return null;
}
const LEAVE_CRITERIA_OPTIONS = Object.entries(LEAVE_CRITERIA_LABELS).map(([value, label]) => ({ value, label }));
const LINK_ERRORS_SHOWN = 5;

// Phần tử tự xử lý click (ô nhập, nút, ô tick, radio, nhãn, dropdown): bấm vào đó không bật / tắt cả khối
const OWN_CLICK = 'input, textarea, select, button, a, label, [role="checkbox"], [role="radio"], [role="switch"], [data-own-click]';

/** Bấm vào chỗ trống bất kỳ trong khối thì bật / tắt khối đó */
function toggleOnBoxClick(checked, onCheck, disabled) {
  return (e) => {
    if (disabled || e.target.closest(OWN_CLICK)) return;
    onCheck(!checked);
  };
}

/**
 * Phần giá trị của 1 khối: khối chưa chọn thì khóa hết (fieldset disabled), click xuyên qua xuống khối
 * (pointer-events-none) để bấm vào đâu cũng là chọn khối.
 */
function Locked({ locked, className = "", children }) {
  return (
    <fieldset disabled={locked} className={`m-0 min-w-0 border-0 p-0 ${locked ? "pointer-events-none opacity-50" : ""} ${className}`}>
      {children}
    </fieldset>
  );
}

// Màu khối khi được chọn: mặc định xanh; "danger" đỏ cho thao tác khó hoàn tác (Rời nhóm, theo Figma)
const BLOCK_TONES = {
  default: { box: "border-blue-100 bg-[#F0F5FF]", divider: "border-blue-100", check: "" },
  danger: { box: "border-red-200 bg-red-50/70", divider: "border-red-100", check: "border-red-500 bg-red-500" },
};

function Block({ checked, onCheck, title, hint, disabled, children, below, tone = "default" }) {
  const colors = BLOCK_TONES[tone] || BLOCK_TONES.default;
  return (
    <div
      onClick={toggleOnBoxClick(checked, onCheck, disabled)}
      className={`rounded-xl border px-4 py-3 transition-colors ${disabled ? "" : "cursor-pointer"} ${checked ? colors.box : "border-border bg-slate-50/60"}`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <label className="flex min-w-[220px] cursor-pointer items-center gap-2.5">
          <Checkbox checked={checked} onCheckedChange={onCheck} disabled={disabled} className={checked ? colors.check : ""} />
          <span>
            <span className="block text-[13px] font-bold text-slate-800">{title}</span>
            {hint && <span className="block text-[11px] text-slate-400">{hint}</span>}
          </span>
        </label>
        {children && <Locked locked={!checked} className="flex flex-wrap items-center gap-x-6 gap-y-2">{children}</Locked>}
      </div>
      {below && <Locked locked={!checked} className={`mt-3 border-t border-dashed pt-3 ${colors.divider}`}>{below}</Locked>}
    </div>
  );
}

function SourceRadio({ name, value, options, onChange, disabled }) {
  return (
    <div role="radiogroup" className="flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-600">
      {options.map(([option, label]) => (
        <label key={option} className="flex cursor-pointer items-center gap-1.5">
          <input
            type="radio"
            name={name}
            value={option}
            checked={value === option}
            onChange={() => onChange(option)}
            disabled={disabled}
            className="h-3.5 w-3.5 accent-blue-600"
          />
          {label}
        </label>
      ))}
    </div>
  );
}

/**
 * Thả cảm xúc của 1 kịch bản (prefix: newsfeed / watch / story). Bật mà chưa chọn loại nào thì tự chọn Like;
 * bỏ chọn hết loại thì tự tắt. Tick 1 loại khi đang tắt thì bật với đúng loại đó.
 */
function ReactionPicker({ prefix, unit, config, onChange, disabled }) {
  const enabledKey = `${prefix}_react_enabled`;
  const typesKey = `${prefix}_react_types`;
  const enabled = Boolean(config[enabledKey]);
  const types = Array.isArray(config[typesKey]) ? config[typesKey] : [];
  const toggle = (on) => onChange({ ...config, [enabledKey]: on, [typesKey]: on && !types.length ? ["Like"] : types });
  const toggleType = (type, on) => {
    const current = enabled ? types : [];
    const next = on ? REACTION_TYPES.filter((t) => t === type || current.includes(t)) : current.filter((t) => t !== type);
    onChange({ ...config, [typesKey]: next, [enabledKey]: next.length > 0 });
  };
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
      <label className="flex cursor-pointer items-center gap-2 font-semibold text-slate-700">
        <Checkbox checked={enabled} onCheckedChange={toggle} disabled={disabled} />
        Thả cảm xúc
      </label>
      <span className="text-[11px] text-slate-400">Ngẫu nhiên trong mỗi {unit} và trong các cảm xúc:</span>
      {REACTION_TYPES.map((type) => (
        <label key={type} className={`flex cursor-pointer items-center gap-1.5 ${enabled ? "" : "text-slate-400"}`}>
          <Checkbox checked={enabled && types.includes(type)} onCheckedChange={(on) => toggleType(type, on)} disabled={disabled} />
          <span aria-hidden="true" className={`text-sm leading-none ${enabled ? "" : "grayscale"}`}>{REACTION_EMOJI[type]}</span>
          {type}
        </label>
      ))}
    </div>
  );
}

/** Ô "chia cho các nick": mỗi nhóm / người chỉ thuộc 1 nick trong dàn */
function SplitToggle({ checked, onChange, disabled, label, hint }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-600">
      <Checkbox checked={checked} onCheckedChange={onChange} disabled={disabled} className="mt-0.5" />
      <span>
        <span className="block font-semibold text-slate-700">{label}</span>
        <span className="block text-[11px] text-slate-400">{hint}</span>
      </span>
    </label>
  );
}

/** Khung dán link: mỗi dòng 1 link, đếm link hợp lệ, báo dòng sai; bên phải là giới hạn mỗi phiên + delay */
function LinkListPanel({ kind, value, onChange, limit, onLimit, delay, disabled, split }) {
  const parsed = useMemo(() => parseLinkList(value, kind), [value, kind]);
  const isGroup = kind === "group";
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="space-y-1.5">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={5}
          spellCheck={false}
          aria-label={isGroup ? "Danh sách link nhóm" : "Danh sách link trang cá nhân"}
          placeholder={isGroup
            ? "Mỗi dòng 1 link nhóm, vd:\nhttps://www.facebook.com/groups/123456789\nhttps://www.facebook.com/groups/ten.nhom"
            : "Mỗi dòng 1 link trang cá nhân, vd:\nhttps://www.facebook.com/profile.php?id=1000123456\nhttps://www.facebook.com/ten.nguoi"}
          className="font-mono text-[11px] leading-5"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <span className={parsed.count ? "font-semibold text-emerald-600" : "text-slate-400"}>
            Đã nạp {parsed.count} link{parsed.duplicates ? ` · bỏ ${parsed.duplicates} dòng trùng` : ""}
          </span>
          <button
            type="button"
            disabled
            title="Sắp có: lấy danh sách từ chức năng quét"
            className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-1 font-semibold text-slate-400"
          >
            <ScanSearch className="h-3.5 w-3.5" />
            Lấy từ danh sách quét (Sắp có)
          </button>
        </div>
        {parsed.errors.length > 0 && (
          <ul role="alert" className="space-y-0.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700">
            {parsed.errors.slice(0, LINK_ERRORS_SHOWN).map((e) => (
              <li key={e.line}>Dòng {e.line}: {e.reason}</li>
            ))}
            {parsed.errors.length > LINK_ERRORS_SHOWN && <li>và {parsed.errors.length - LINK_ERRORS_SHOWN} dòng sai khác</li>}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-3 text-xs text-slate-500">
        <span className="flex items-center gap-2">
          Tối đa
          <NumberInput value={limit} onChange={onLimit} min={LIST_LIMIT_MIN} max={LIST_LIMIT_MAX} disabled={disabled} />
          {isGroup ? "nhóm/nick mỗi phiên" : "lời mời/nick mỗi phiên"}
        </span>
        <RangeInput label={isGroup ? "Nghỉ giữa 2 nhóm" : "Nghỉ giữa 2 lời mời"} unit="giây" {...delay} />
        <span className="max-w-[260px] text-[11px] text-slate-400">
          {split ? "Danh sách được chia cho các nick, mỗi link 1 nick; " : "Mỗi nick lấy link theo thứ tự ngẫu nhiên; "}
          {isGroup
            ? "nhóm đã vào / đang chờ duyệt thì bỏ qua, không tính vào giới hạn."
            : "người đã là bạn / đang chờ chấp nhận thì bỏ qua, không tính vào giới hạn."}
        </span>
      </div>
    </div>
  );
}

// Nút "Chọn tất cả": 7 kịch bản chính + Giới hạn mỗi ngày (không đụng tùy chọn con như Thả cảm xúc, Giữ nhóm Admin)
export const SCENARIO_KEYS = [
  "enabled_newsfeed",
  "enabled_watch",
  "enabled_story",
  "enabled_leave_groups",
  "enabled_join_groups",
  "enabled_add_friends",
  "enabled_check_notif",
  "daily_limit_enabled",
];

export default function ScenarioConfig({ config, onChange, disabled }) {
  const set = (key) => (value) => onChange({ ...config, [key]: value });
  const range = (prefix, max, min) => ({
    low: config[`${prefix}_min`],
    high: config[`${prefix}_max`],
    onLow: set(`${prefix}_min`),
    onHigh: set(`${prefix}_max`),
    onRange: (low, high) => onChange({ ...config, [`${prefix}_min`]: low, [`${prefix}_max`]: high }),
    max,
    min,
    disabled,
  });
  const groupList = config.group_source === "list";
  const friendList = config.friend_source === "list";
  // Giới hạn mỗi ngày chỉ áp dụng cho Tham gia nhóm / Kết bạn: cả 2 đều tắt thì khóa (giữ lựa chọn đã lưu)
  const limitable = config.enabled_join_groups || config.enabled_add_friends;
  const dailyOn = Boolean(config.daily_limit_enabled && limitable);
  const dailyDisabled = disabled || !limitable;
  const allChecked = SCENARIO_KEYS.every((key) => config[key]);
  const toggleAll = () => onChange({ ...config, ...Object.fromEntries(SCENARIO_KEYS.map((key) => [key, !allChecked])) });

  return (
    <SectionCard
      icon={Bot}
      title="Cấu Hình Tương Tác"
      subtitle="Mỗi nick lấy ngẫu nhiên trong khoảng Min - Max; thứ tự kịch bản xáo ngẫu nhiên"
      action={
        <button
          type="button"
          onClick={toggleAll}
          disabled={disabled}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ListChecks className="h-3.5 w-3.5 text-primary" />
          {allChecked ? "Bỏ chọn tất cả" : "Chọn tất cả"}
        </button>
      }
    >
      <div className="space-y-3">
        <Block
          checked={config.enabled_newsfeed}
          onCheck={set("enabled_newsfeed")}
          disabled={disabled}
          title="Lướt Newsfeed tự nhiên"
          below={<ReactionPicker prefix="newsfeed" unit="bài" config={config} onChange={onChange} disabled={disabled} />}
        >
          <RangeInput label="Thời gian:" unit="phút" {...range("newsfeed_time", MAX_TIME_VALUE, 1)} />
          <RangeInput label="Delay" unit="giây" {...range("newsfeed_delay", MAX_TIME_VALUE)} />
        </Block>

        <Block
          checked={config.enabled_watch}
          onCheck={set("enabled_watch")}
          disabled={disabled}
          title="Xem Video Watch Facebook"
          below={<ReactionPicker prefix="watch" unit="video" config={config} onChange={onChange} disabled={disabled} />}
        >
          <RangeInput label="Thời gian:" unit="phút" {...range("watch_time", MAX_TIME_VALUE, 1)} />
          <RangeInput label="Xem mỗi video" unit="giây" {...range("watch_delay", MAX_TIME_VALUE)} />
        </Block>

        <Block
          checked={config.enabled_story}
          onCheck={set("enabled_story")}
          disabled={disabled}
          title="Lướt & Xem Story Facebook"
          hint="Xem từ người đầu khay story, hết story của 1 người thì sang người kế"
          below={<ReactionPicker prefix="story" unit="story" config={config} onChange={onChange} disabled={disabled} />}
        >
          <RangeInput label="Số lượng Story" unit="story" {...range("story", undefined, 1)} />
          <RangeInput label="Xem mỗi story" unit="giây" {...range("story_delay", MAX_TIME_VALUE, 1)} />
        </Block>

        <Block
          checked={config.enabled_leave_groups}
          onCheck={set("enabled_leave_groups")}
          disabled={disabled}
          title="Tự động rời nhóm"
          tone="danger"
          hint="Chạy trước Tham gia nhóm; nhóm không đọc được thời gian thì giữ lại"
          below={(
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
              <span className="flex items-center gap-2">
                Tiêu chí
                <span data-own-click className="inline-block w-[360px] max-w-full cursor-default">
                  <CustomSelect
                    size="sm"
                    dropdownClassName="rounded-xl"
                    value={config.leave_criteria}
                    onChange={set("leave_criteria")}
                    disabled={disabled}
                    options={LEAVE_CRITERIA_OPTIONS}
                  />
                </span>
              </span>
              <label className="flex cursor-pointer items-center gap-2 text-slate-600">
                <Checkbox
                  checked={config.leave_keep_admin}
                  onCheckedChange={set("leave_keep_admin")}
                  disabled={disabled}
                  className={config.leave_keep_admin ? BLOCK_TONES.danger.check : ""}
                />
                Giữ lại nhóm mình là Admin/Mod
              </label>
            </div>
          )}
        >
          <RangeInput label="Số nhóm rời" unit="nhóm" {...range("leave", undefined, 1)} />
          <RangeInput label="Nghỉ giữa 2 nhóm" unit="giây" {...range("leave_delay", MAX_TIME_VALUE, 5)} />
        </Block>

        <Block
          checked={config.enabled_join_groups}
          onCheck={set("enabled_join_groups")}
          disabled={disabled}
          title="Tham gia nhóm Facebook"
          hint={groupList ? "Theo danh sách link nhóm dán vào" : "Để trống từ khóa: tham gia nhóm đề xuất"}
          below={(
            <div className="space-y-3">
              {groupList ? (
                <LinkListPanel
                  kind="group"
                  value={config.group_links}
                  onChange={set("group_links")}
                  limit={config.group_list_limit}
                  onLimit={set("group_list_limit")}
                  delay={range("groups_delay", MAX_TIME_VALUE, 5)}
                  disabled={disabled}
                  split={config.groups_split_enabled}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
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
                  <RangeInput label="Số lượng nhóm" unit="nhóm" {...range("groups", undefined, 1)} />
                  <RangeInput label="Nghỉ giữa 2 nhóm" unit="giây" {...range("groups_delay", MAX_TIME_VALUE, 5)} />
                </div>
              )}
              <SplitToggle
                checked={config.groups_split_enabled}
                onChange={set("groups_split_enabled")}
                disabled={disabled}
                label="Bỏ qua nhóm đã tham gia"
                hint="Hệ thống không tham gia lại các nhóm mà tài khoản này hoặc tài khoản khác đã tham gia trước đó."
              />
            </div>
          )}
        >
          <SourceRadio
            name="group_source"
            value={config.group_source}
            onChange={set("group_source")}
            disabled={disabled}
            options={[["keyword", "Theo từ khóa"], ["list", "Theo danh sách link"]]}
          />
        </Block>

        <Block
          checked={config.enabled_add_friends}
          onCheck={set("enabled_add_friends")}
          disabled={disabled}
          title="Kết bạn Facebook"
          hint={friendList ? "Theo danh sách link trang cá nhân dán vào" : "Theo gợi ý kết bạn của Facebook"}
          below={friendList ? (
            <div className="space-y-3">
              <LinkListPanel
                kind="friend"
                value={config.friend_links}
                onChange={set("friend_links")}
                limit={config.friend_list_limit}
                onLimit={set("friend_list_limit")}
                delay={range("friends_delay", MAX_TIME_VALUE, 3)}
                disabled={disabled}
                split={config.friends_split_enabled}
              />
              <SplitToggle
                checked={config.friends_split_enabled}
                onChange={set("friends_split_enabled")}
                disabled={disabled}
                label="Bỏ qua người đã gửi lời mời"
                hint="Hệ thống không gửi lại lời mời cho những người mà tài khoản này hoặc tài khoản khác đã gửi trước đó."
              />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <RangeInput label="Số lượng mời" unit="người" {...range("friends", undefined, 1)} />
              <RangeInput label="Nghỉ giữa 2 lời mời" unit="giây" {...range("friends_delay", MAX_TIME_VALUE, 3)} />
              <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                <Checkbox
                  checked={config.friends_fallback_group_members}
                  onCheckedChange={set("friends_fallback_group_members")}
                  disabled={disabled}
                />
                Hết gợi ý thì mời thành viên nhóm đã tham gia
              </label>
            </div>
          )}
        >
          <SourceRadio
            name="friend_source"
            value={config.friend_source}
            onChange={set("friend_source")}
            disabled={disabled}
            options={[["suggestions", "Theo gợi ý"], ["list", "Theo danh sách link"]]}
          />
        </Block>

        <Block
          checked={config.enabled_check_notif}
          onCheck={set("enabled_check_notif")}
          disabled={disabled}
          title="Check & click thông báo mới"
          hint="Luôn chạy đầu tiên nếu được chọn"
        />

        <div
          onClick={toggleOnBoxClick(dailyOn, set("daily_limit_enabled"), dailyDisabled)}
          className={`rounded-xl border border-dashed border-slate-200 px-4 py-3 ${dailyDisabled ? "" : "cursor-pointer"}`}
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className={`flex items-center gap-2.5 ${limitable ? "" : "opacity-60"}`}>
              <Switch checked={dailyOn} onCheckedChange={set("daily_limit_enabled")} disabled={dailyDisabled} />
              <span>
                <span className="block text-[13px] font-bold text-slate-800">Giới hạn mỗi ngày cho mỗi nick</span>
                <span className="block text-[11px] text-slate-400">
                  {limitable
                    ? "Lưu theo máy; tính theo ngày giờ Việt Nam; áp dụng cả chế độ danh sách link"
                    : "Bật Tham gia nhóm hoặc Kết bạn để dùng giới hạn mỗi ngày"}
                </span>
              </span>
            </div>
            <Locked locked={!dailyOn} className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
              <span className={`flex items-center gap-2 ${config.enabled_add_friends ? "" : "opacity-50"}`}>
                Tối đa kết bạn
                <NumberInput value={config.daily_friend_limit} onChange={set("daily_friend_limit")} min={1} max={100} disabled={disabled || !config.enabled_add_friends} />
                lời mời
              </span>
              <span className={`flex items-center gap-2 ${config.enabled_join_groups ? "" : "opacity-50"}`}>
                Tối đa tham gia
                <NumberInput value={config.daily_group_limit} onChange={set("daily_group_limit")} min={1} max={100} disabled={disabled || !config.enabled_join_groups} />
                nhóm
              </span>
            </Locked>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
