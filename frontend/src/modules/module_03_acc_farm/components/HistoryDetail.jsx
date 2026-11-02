"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Bell,
  Clock,
  Cookie,
  ExternalLink,
  Fingerprint,
  Globe,
  Images,
  Loader2,
  LogOut,
  Network,
  PlayCircle,
  Rss,
  Settings2,
  ShieldCheck,
  User,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { formatVietnamDateTime } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import {
  ACTION_FULL_LABELS,
  ACTION_STATUS,
  FINGERPRINT_HINTS,
  FINGERPRINT_LABELS,
  FRIEND_SOURCE_LABELS,
  GROUP_SOURCE_LABELS,
  LEAVE_CRITERIA_LABELS,
  LINK_SKIP_LABELS,
  PROXY_MODE_LABELS,
} from "../constants";
import { getFarmHistoryDetail } from "../service";
import { RunStatusBadge, UidCopy, formatDuration } from "./parts";
import { parseLinkList } from "./ScenarioConfig";

// Màu riêng từng kịch bản để nhìn là nhận ra
const SCENARIO_THEME = {
  NEWSFEED: { icon: Rss, card: "border-blue-200 bg-blue-50", iconBox: "bg-blue-500", title: "text-blue-700", value: "text-blue-900" },
  WATCH: { icon: PlayCircle, card: "border-violet-200 bg-violet-50", iconBox: "bg-violet-500", title: "text-violet-700", value: "text-violet-900" },
  STORY: { icon: Images, card: "border-pink-200 bg-pink-50", iconBox: "bg-pink-500", title: "text-pink-700", value: "text-pink-900" },
  ADD_FRIEND: { icon: UserPlus, card: "border-emerald-200 bg-emerald-50", iconBox: "bg-emerald-500", title: "text-emerald-700", value: "text-emerald-900" },
  JOIN_GROUP: { icon: Users, card: "border-amber-200 bg-amber-50", iconBox: "bg-amber-500", title: "text-amber-700", value: "text-amber-900" },
  LEAVE_GROUP: { icon: LogOut, card: "border-stone-200 bg-stone-50", iconBox: "bg-stone-500", title: "text-stone-700", value: "text-stone-900" },
  CHECK_NOTIF: { icon: Bell, card: "border-sky-200 bg-sky-50", iconBox: "bg-sky-500", title: "text-sky-700", value: "text-sky-900" },
};
const SCENARIO_ORDER = ["NEWSFEED", "WATCH", "STORY", "ADD_FRIEND", "LEAVE_GROUP", "JOIN_GROUP", "CHECK_NOTIF"];
// Tên tiêu chí ngắn cho thẻ kết quả (phần trong ngoặc của LEAVE_CRITERIA_LABELS bỏ đi)
const leaveCriteria = (value) => (LEAVE_CRITERIA_LABELS[value] || value || "").replace(/\s*\(.*\)$/, "");

const reactionNote = (n) => (n ? ` · ${n} cảm xúc` : "");
const reactionChip = (enabled, types) => (enabled && types?.length ? ` · thả cảm xúc ${types.join("/")}` : "");

// Viền / nền phần đầu theo kết quả cuối của lượt
const HEADER_TONE = {
  COMPLETED: "from-emerald-50 border-emerald-200",
  BLOCKED: "from-orange-50 border-orange-200",
  STOPPED: "from-slate-100 border-slate-200",
  FAILED: "from-rose-50 border-rose-200",
  DIE: "from-red-50 border-red-200",
};

const DOT = {
  SUCCESS: "bg-emerald-500 ring-emerald-100",
  FAILED: "bg-rose-500 ring-rose-100",
  BLOCKED: "bg-orange-500 ring-orange-100",
  SKIPPED: "bg-amber-400 ring-amber-100",
};

// Nhiều hơn số dòng này thì nhật ký chắc chắn cao hơn 240px: màn thấp vẫn giữ ô nhật ký tối thiểu 240px
const LOG_MIN_ROWS = 4;

const COUNT_BADGES = [
  ["actions_success", "thành công", "bg-emerald-100 text-emerald-700"],
  ["actions_failed", "lỗi", "bg-rose-100 text-rose-700"],
  ["actions_blocked", "bị chặn", "bg-orange-100 text-orange-700"],
  ["actions_skipped", "bỏ qua", "bg-amber-100 text-amber-700"],
];

function scenarioValue(action, h) {
  switch (action) {
    case "NEWSFEED":
      return [formatDuration(h.newsfeed_seconds), `${h.newsfeed_scrolls} lần cuộn${reactionNote(h.newsfeed_reactions)}`];
    case "WATCH":
      return [`${h.watch_videos} video`, `${formatDuration(h.watch_seconds)}${reactionNote(h.watch_reactions)}`];
    case "STORY":
      return [`${h.story_frames || 0} khung`, `${formatDuration(h.story_seconds)}${reactionNote(h.story_reactions)}`];
    case "ADD_FRIEND":
      return [`${h.friends_sent} lời mời`, h.friends_source ? `nguồn: ${FRIEND_SOURCE_LABELS[h.friends_source] || h.friends_source}` : ""];
    case "JOIN_GROUP":
      if (h.groups_source === "list") return [`${h.groups_joined} nhóm`, `nguồn: ${GROUP_SOURCE_LABELS.list}`];
      return [`${h.groups_joined} nhóm`, h.groups_keyword ? `từ khóa: ${h.groups_keyword}` : "nhóm đề xuất"];
    case "LEAVE_GROUP":
      return [`${h.groups_left || 0} nhóm`, leaveCriteria(h.config_snapshot?.leave_criteria)];
    case "CHECK_NOTIF":
      return [h.notif_checked ? "Đã xem" : "Chưa xem được", h.notif_opened ? "đã mở thông báo mới" : "không có thông báo mới"];
    default:
      return ["—", ""];
  }
}

function configChips(c) {
  if (!c) return [];
  const chips = [];
  if (c.enabled_newsfeed) chips.push(["NEWSFEED", `Newsfeed ${c.newsfeed_time_min}-${c.newsfeed_time_max} phút · delay ${c.newsfeed_delay_min}-${c.newsfeed_delay_max}s${reactionChip(c.newsfeed_react_enabled, c.newsfeed_react_types)}`]);
  if (c.enabled_watch) chips.push(["WATCH", `Watch ${c.watch_time_min}-${c.watch_time_max} phút · ${c.watch_delay_min}-${c.watch_delay_max}s/video${reactionChip(c.watch_react_enabled, c.watch_react_types)}`]);
  if (c.enabled_story) chips.push(["STORY", `Story ${c.story_min}-${c.story_max} khung · ${c.story_delay_min}-${c.story_delay_max}s/khung${reactionChip(c.story_react_enabled, c.story_react_types)}`]);
  if (c.enabled_add_friends && c.friend_source === "list") {
    chips.push(["ADD_FRIEND", `Kết bạn theo danh sách ${parseLinkList(c.friend_links, "friend").count} link · tối đa ${c.friend_list_limit} lời mời/nick · nghỉ ${c.friends_delay_min}-${c.friends_delay_max}s`]);
  } else if (c.enabled_add_friends) {
    chips.push(["ADD_FRIEND", `Kết bạn ${c.friends_min}-${c.friends_max} người · nghỉ ${c.friends_delay_min}-${c.friends_delay_max}s${c.friends_fallback_group_members ? " · hết gợi ý mời thành viên nhóm" : ""}`]);
  }
  if (c.enabled_join_groups && c.group_source === "list") {
    chips.push(["JOIN_GROUP", `Nhóm theo danh sách ${parseLinkList(c.group_links, "group").count} link · tối đa ${c.group_list_limit} nhóm/nick · nghỉ ${c.groups_delay_min}-${c.groups_delay_max}s`]);
  } else if (c.enabled_join_groups) {
    chips.push(["JOIN_GROUP", `Nhóm ${c.groups_min}-${c.groups_max} · nghỉ ${c.groups_delay_min}-${c.groups_delay_max}s · ${c.group_keyword ? `"${c.group_keyword}"` : "đề xuất"}`]);
  }
  if (c.enabled_leave_groups) {
    chips.push(["LEAVE_GROUP", `Rời ${c.leave_min}-${c.leave_max} nhóm · nghỉ ${c.leave_delay_min}-${c.leave_delay_max}s · ${leaveCriteria(c.leave_criteria)}${c.leave_keep_admin ? " · giữ nhóm Admin/Mod" : ""}`]);
  }
  if (c.enabled_check_notif) chips.push(["CHECK_NOTIF", "Check thông báo"]);
  return chips;
}

function SectionTitle({ icon: Icon, children }) {
  return (
    <h4 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
      <Icon className="h-3.5 w-3.5" />
      {children}
    </h4>
  );
}

// Người / nhóm đã tương tác trong 1 hành động (farm_interaction_logs.targets)
const TARGET_PREVIEW = 5;
const TARGET_STATUS = {
  joined: { label: "Đã vào", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  pending: { label: "Chờ duyệt", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  left: { label: "Đã rời", badge: "bg-stone-100 text-stone-700 border-stone-200" },
};

// Chỉ mở link https của facebook.com (dữ liệu đọc từ trang Facebook)
function facebookUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && /(^|\.)facebook\.com$/.test(parsed.hostname) ? parsed.href : null;
  } catch {
    return null;
  }
}

function TargetList({ action, targets }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = action === "JOIN_GROUP" || action === "LEAVE_GROUP" ? Users : User;
  const shown = expanded ? targets : targets.slice(0, TARGET_PREVIEW);
  return (
    <ul className="mt-1.5 space-y-1">
      {shown.map((t, i) => {
        const href = facebookUrl(t?.url);
        const status = TARGET_STATUS[t?.status];
        const name = t?.name || t?.source_url || "(không đọc được tên)";
        return (
          <li key={i} className="flex items-center gap-1.5 text-xs">
            <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 font-medium text-primary hover:underline">
                <span className="truncate">{name}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            ) : (
              <span className={cn("truncate", t?.name ? "text-slate-700" : "italic text-slate-400")}>{name}</span>
            )}
            {status && <span className={cn("shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold", status.badge)}>{status.label}</span>}
            {t?.reason && <span className="truncate text-slate-500">· {t.reason}</span>}
          </li>
        );
      })}
      {targets.length > TARGET_PREVIEW && (
        <li>
          <button type="button" onClick={() => setExpanded((v) => !v)} className="text-[11px] font-semibold text-primary hover:underline">
            {expanded ? "Thu gọn" : `Xem thêm ${targets.length - TARGET_PREVIEW}`}
          </button>
        </li>
      )}
    </ul>
  );
}

// Chế độ danh sách link: link bị bỏ qua (không tính vào số lượng), thu gọn mặc định
function SkippedList({ targets }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-[11px] font-semibold text-amber-700 hover:underline">
        {open ? "Ẩn" : "Xem"} bỏ qua ({targets.length})
      </button>
      {open && (
        <ul className="mt-1 space-y-1 rounded-lg border border-amber-100 bg-amber-50/50 px-2.5 py-1.5">
          {targets.map((t, i) => {
            const href = facebookUrl(t?.url);
            const label = t?.name || t?.source_url || t?.url || "(không rõ link)";
            return (
              <li key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="shrink-0 rounded-md border border-amber-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                  {LINK_SKIP_LABELS[t?.result] || "Bỏ qua"}
                </span>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 font-medium text-primary hover:underline">
                    <span className="truncate">{label}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ) : (
                  <span className="truncate text-slate-700">{label}</span>
                )}
                {t?.reason && <span className="text-slate-500">· {t.reason}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function LogTargets({ action, targets }) {
  const isSkip = (t) => String(t?.result || "").startsWith("skipped_");
  const done = targets.filter((t) => !isSkip(t));
  const skipped = targets.filter(isSkip);
  return (
    <>
      {done.length > 0 && <TargetList action={action} targets={done} />}
      {skipped.length > 0 && <SkippedList targets={skipped} />}
    </>
  );
}

function InfoRow({ icon: Icon, label, children, tone = "text-slate-800", title }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-dashed border-slate-100 py-2 last:border-0">
      <span className="flex items-center gap-2 text-xs text-slate-500">
        <Icon className="h-3.5 w-3.5 text-slate-400" />
        {label}
      </span>
      <span title={title} className={cn("text-right text-xs font-semibold", tone, title && "cursor-help")}>{children}</span>
    </div>
  );
}

export default function HistoryDetail({ id, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getFarmHistoryDetail(id)
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const h = data?.history;
  const ran = new Map((h?.actions_summary || []).map((a) => [a.action, a.status]));
  const start = formatVietnamDateTime(h?.started_at);
  const end = formatVietnamDateTime(h?.finished_at);
  const hasProxy = Boolean(h?.proxy_host);

  const content = (
    <div
      className="fixed inset-0 z-[100000] flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Hộp cao tối đa vừa màn hình; nhật ký chiếm phần còn lại và cuộn bên trong */}
      <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-lg p-1.5 text-slate-400 hover:bg-white/70 hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>

        {!data && !error && (
          <div className="flex items-center gap-2 px-6 py-16 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Đang tải chi tiết lượt #{id}...
          </div>
        )}
        {error && <div className="px-6 py-16 text-sm text-rose-600">{error}</div>}

        {h && (
          <>
            {/* Đầu: ai, kết quả gì, chạy lúc nào bao lâu */}
            <div className={cn("shrink-0 border-b bg-gradient-to-r to-white px-6 py-5", HEADER_TONE[h.final_status] || "from-slate-50 border-slate-200")}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Lượt tương tác #{id}</div>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
                  <User className="h-5 w-5" />
                </span>
                <div>
                  <div className="text-lg font-bold text-slate-900">{h.fb_name || "—"}</div>
                  <UidCopy uid={h.fb_uid} />
                </div>
                <RunStatusBadge status={h.final_status} className="text-xs" />
                {h.light_checkpoint && (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
                    Đã qua checkpoint nhẹ
                  </span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                  {start.timeWithSeconds} → {end.timeWithSeconds} · {end.date}
                </span>
                <span className="rounded-full bg-slate-900/5 px-2.5 py-0.5 font-semibold text-slate-700">
                  Thời lượng {formatDuration(h.duration_seconds)}
                </span>
                {h.session_id && <span className="text-slate-400">Phiên {h.session_id.slice(0, 8)}</span>}
              </div>
              {h.error && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="break-all">{h.error}</span>
                </div>
              )}
            </div>

            {/* Màn thấp không đủ chỗ cho nhật ký tối thiểu 240px thì cả phần thân cuộn */}
            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
              {/* Kết quả từng kịch bản */}
              <section>
                <SectionTitle icon={ShieldCheck}>Kết quả kịch bản</SectionTitle>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
                  {SCENARIO_ORDER.map((action) => {
                    const theme = SCENARIO_THEME[action];
                    const Icon = theme.icon;
                    const status = ran.get(action);
                    const [main, sub] = scenarioValue(action, h);
                    const meta = ACTION_STATUS[status];
                    return (
                      <div
                        key={action}
                        className={cn("rounded-xl border p-3", status ? theme.card : "border-dashed border-slate-200 bg-slate-50 opacity-60")}
                      >
                        <div className="flex items-center justify-between">
                          <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg text-white", status ? theme.iconBox : "bg-slate-300")}>
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          {meta && <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-semibold", meta.badge)}>{meta.label}</span>}
                        </div>
                        <div className={cn("mt-2 text-[11px] font-semibold", status ? theme.title : "text-slate-400")}>
                          {ACTION_FULL_LABELS[action]}
                        </div>
                        {status ? (
                          <>
                            <div className={cn("text-lg font-bold leading-tight", theme.value)}>{main}</div>
                            {sub && <div className="truncate text-[11px] text-slate-500" title={sub}>{sub}</div>}
                          </>
                        ) : (
                          <div className="mt-1 text-sm font-semibold text-slate-400">Không chạy</div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="text-slate-500">Hoạt động:</span>
                  {COUNT_BADGES.map(([key, label, cls]) => (
                    <span key={key} className={cn("rounded-full px-2.5 py-0.5 font-semibold", h[key] ? cls : "bg-slate-100 text-slate-400")}>
                      {h[key]} {label}
                    </span>
                  ))}
                </div>
              </section>

              {/* Kết nối + cấu hình */}
              <div className="grid gap-5 md:grid-cols-2">
                <section className="rounded-xl border border-slate-200 p-4">
                  <SectionTitle icon={Network}>Kết nối & thiết bị</SectionTitle>
                  <InfoRow icon={Globe} label="Proxy" tone={hasProxy ? "font-mono text-slate-800" : "text-amber-600"}>
                    {h.proxy_host || "Không có (IP máy)"}
                  </InfoRow>
                  <InfoRow icon={Network} label="IP ra ngoài" tone="font-mono text-slate-800">
                    {h.egress_ip || "—"}
                  </InfoRow>
                  <InfoRow icon={ShieldCheck} label="Chế độ" tone={hasProxy ? "text-emerald-600" : "text-amber-600"}>
                    {PROXY_MODE_LABELS[h.proxy_mode] || h.proxy_mode || "—"}
                  </InfoRow>
                  {/* Nick mới luôn có fingerprint giả lập riêng: chỉ hiện khi nick không được giả lập (bất thường) */}
                  {h.fingerprint_mode === "legacy" && (
                    <InfoRow icon={Fingerprint} label="Fingerprint" tone="text-amber-600" title={FINGERPRINT_HINTS.legacy}>
                      {FINGERPRINT_LABELS.legacy}
                    </InfoRow>
                  )}
                  <InfoRow icon={Cookie} label="Lưu cookie cuối phiên" tone={h.cookie_saved ? "text-emerald-600" : "text-slate-400"}>
                    {h.cookie_saved ? "Đã lưu" : "Không"}
                  </InfoRow>
                  <InfoRow icon={User} label="ID người chạy">
                    {h.owner_username || "Nick chung (local)"}
                  </InfoRow>
                </section>

                <section className="rounded-xl border border-slate-200 p-4">
                  <SectionTitle icon={Settings2}>Cấu hình đã dùng</SectionTitle>
                  {h.config_snapshot ? (
                    <div className="flex flex-col gap-2">
                      {configChips(h.config_snapshot).map(([action, text]) => {
                        const theme = SCENARIO_THEME[action];
                        const Icon = theme.icon;
                        return (
                          <span key={action} className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs", theme.card, theme.title)}>
                            <Icon className="h-3.5 w-3.5 shrink-0" />
                            {text}
                          </span>
                        );
                      })}
                      <span className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                        <Clock className="h-3.5 w-3.5 shrink-0" />
                        {h.config_snapshot.daily_limit_enabled
                          ? `Giới hạn mỗi ngày: ${h.config_snapshot.daily_friend_limit} lời mời · ${h.config_snapshot.daily_group_limit} nhóm`
                          : "Không giới hạn mỗi ngày"}
                      </span>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400">Không có cấu hình đã lưu</div>
                  )}
                </section>
              </div>

              {/* Nhật ký dạng timeline: phần duy nhất co lại khi thiếu chỗ, cuộn trong khung để hộp không dài quá màn hình */}
              <section className={cn("flex min-h-0 flex-col", data.logs.length > LOG_MIN_ROWS && "min-h-[240px]")}>
                <SectionTitle icon={Clock}>Nhật ký hành động ({data.logs.length})</SectionTitle>
                {data.logs.length ? (
                  <div className="min-h-0 overflow-y-auto rounded-xl border border-slate-200 py-3 pl-2 pr-3">
                    <ol className="relative ml-2 border-l-2 border-slate-100">
                      {data.logs.map((log, idx) => {
                        const meta = ACTION_STATUS[log.status] || ACTION_STATUS.PENDING;
                        const theme = SCENARIO_THEME[log.action_type];
                        return (
                          <li key={idx} className="relative pb-4 pl-5 last:pb-0">
                            <span className={cn("absolute -left-[7px] top-1.5 h-3 w-3 rounded-full ring-4", DOT[log.status] || "bg-slate-400 ring-slate-100")} />
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-[11px] text-slate-400">{formatVietnamDateTime(log.created_at).timeWithSeconds}</span>
                              <span className={cn("text-sm font-semibold", theme?.title || "text-slate-700")}>
                                {ACTION_FULL_LABELS[log.action_type] || log.action_type}
                              </span>
                              <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-semibold", meta.badge)}>{meta.label}</span>
                            </div>
                            {log.details && <div className="mt-0.5 text-xs text-slate-600">{log.details}</div>}
                            {log.targets?.length > 0 && <LogTargets action={log.action_type} targets={log.targets} />}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
                    Không có nhật ký hành động (nick dừng trước khi chạy kịch bản)
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : null;
}
