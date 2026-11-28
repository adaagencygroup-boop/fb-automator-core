"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  FileText,
  History,
  Image as ImageIcon,
  Loader2,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Timer,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import { getPostCampaign, rerunPostCampaignSlot } from "../../service";
import {
  CONTENT_MODE_LABEL,
  IMAGE_MODE_LABEL,
  PAUSED_MID_RUN_PREFIX,
  QUEUED_PREFIX,
  StatusPill,
  campaignStatus,
  formatDateTime,
  formatTime,
  slotStatus,
} from "./campaignUi";

const POLL_MS = 5000;

function RerunControls({ onRun, busy, onCancel }) {
  const [time, setTime] = useState("");
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Button
        type="button"
        size="sm"
        disabled={busy}
        onClick={() => onRun("")}
        className="h-7 bg-blue-600 px-2.5 text-xs hover:bg-blue-700"
      >
        Chạy ngay
      </Button>
      <span className="text-[11px] text-slate-400">hoặc lúc</span>
      <input
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        className="h-7 rounded-md border border-slate-200 px-1.5 font-mono text-xs focus:border-blue-500 focus:outline-none"
        aria-label="Giờ chạy lại"
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy || !time}
        onClick={() => onRun(time)}
        className="h-7 px-2.5 text-xs"
      >
        Hẹn giờ
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={onCancel}
        className="h-7 px-2 text-xs text-slate-500"
      >
        Huỷ
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- hiển thị trực quan

/** Màu của từng loại kết quả bài (dùng chung cho thanh tiến độ + chú thích). */
const SEGMENTS = [
  {
    key: "published",
    label: "Đã đăng",
    bar: "bg-emerald-500",
    dot: "bg-emerald-500",
    text: "text-emerald-700",
  },
  {
    key: "failed",
    label: "Lỗi",
    bar: "bg-rose-500",
    dot: "bg-rose-500",
    text: "text-rose-600",
  },
  {
    key: "stopped",
    label: "Bị dừng",
    bar: "bg-slate-400",
    dot: "bg-slate-400",
    text: "text-slate-600",
  },
  {
    key: "pending",
    label: "Đang đăng / chờ",
    bar: "bg-blue-400",
    dot: "bg-blue-400",
    text: "text-blue-600",
  },
  {
    key: "notRun",
    label: "Chưa chạy",
    bar: "bg-slate-200",
    dot: "bg-slate-200",
    text: "text-slate-400",
  },
];

const DOT_TONE = {
  blue: "bg-blue-500 ring-blue-100",
  sky: "bg-sky-500 ring-sky-100",
  emerald: "bg-emerald-500 ring-emerald-100",
  amber: "bg-amber-500 ring-amber-100",
  rose: "bg-rose-500 ring-rose-100",
  slate: "bg-slate-400 ring-slate-100",
  violet: "bg-violet-500 ring-violet-100",
};

function SegmentBar({ counts, total, className = "h-2" }) {
  const sum = Math.max(1, total);
  return (
    <div
      className={`flex w-full overflow-hidden rounded-full bg-slate-100 ${className}`}
    >
      {SEGMENTS.map((s) =>
        counts[s.key] > 0 ? (
          <div
            key={s.key}
            className={`${s.bar} h-full transition-all`}
            style={{ width: `${(100 * counts[s.key]) / sum}%` }}
            title={`${s.label}: ${counts[s.key]}`}
          />
        ) : null,
      )}
    </div>
  );
}

function SegmentLegend({ counts, keepZero = [] }) {
  const items = SEGMENTS.filter(
    (s) => counts[s.key] > 0 || keepZero.includes(s.key),
  );
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
      {items.map((s) => (
        <span
          key={s.key}
          className="inline-flex items-center gap-1.5 text-slate-500"
        >
          <span className={`size-2 rounded-full ${s.dot}`} />
          {s.label}
          <strong className={`tabular-nums ${s.text}`}>
            {counts[s.key] || 0}
          </strong>
        </span>
      ))}
    </div>
  );
}

function Fact({ icon: Icon, children }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-100">
      <Icon className="size-3.5 text-slate-400" />
      {children}
    </span>
  );
}

function formatDelay(lo, hi) {
  const a = Number(lo) || 0;
  const b = Number(hi) || 0;
  if (a >= 60 && b >= 60 && a % 60 === 0 && b % 60 === 0)
    return `${a / 60}–${b / 60} phút`;
  return `${a}–${b} giây`;
}

function untilLabel(value, now) {
  const mins = Math.round((new Date(value).getTime() - now) / 60000);
  if (!Number.isFinite(mins)) return "";
  if (mins <= 0) return "đến giờ";
  if (mins < 60) return `còn ${mins} phút`;
  const h = Math.floor(mins / 60);
  return `còn ${h} giờ${mins % 60 ? ` ${mins % 60} phút` : ""}`;
}

const NOISY_MESSAGE_PREFIXES = [
  "Đăng thành công",
  "Tạm dừng",
  "Bị lỡ",
  "Đang xếp hàng",
  "Chiến dịch đã dừng",
  "Đã chạy tiếp",
];

/** Câu tóm tắt dễ hiểu cho 1 khung + ghi chú phụ (nếu message backend có thêm thông tin). */
function describeSlot(slot, accounts, now) {
  const total = Number(slot.total_count) || accounts;
  const c = slot.post_counts || {};
  const published = Number(c.published ?? slot.success_count) || 0;
  const msg = String(slot.message || "");
  let headline;
  switch (slot.status) {
    case "WAITING":
      headline = msg.startsWith(QUEUED_PREFIX)
        ? "Đến giờ nhưng đang có phiên đăng khác chạy, khung này xếp hàng chờ"
        : `Sẽ đăng cho ${accounts} nick · ${untilLabel(slot.run_at, now)}`;
      break;
    case "RUNNING":
      headline = msg.startsWith(PAUSED_MID_RUN_PREFIX)
        ? `Đã đăng ${published}/${total} nick · đang tạm dừng, bấm Chạy tiếp để đăng tiếp`
        : `Đang đăng: ${published}/${total} nick${slot.estimated_finish_at ? ` · dự kiến xong ${formatTime(slot.estimated_finish_at)}` : ""}`;
      break;
    case "DONE":
      headline =
        Number(slot.failed_count) > 0
          ? `Đã đăng ${published}/${total} nick · ${slot.failed_count} nick chưa đăng được`
          : `Đã đăng đủ ${published}/${total} nick`;
      break;
    case "STOPPED":
      headline = slot.session_id
        ? `Bị dừng khi đang đăng: ${published}/${total} nick đã đăng, ${Math.max(0, total - published)} nick chưa đăng`
        : `Tạm dừng · chạy đúng ${formatTime(slot.run_at)} nếu bấm Chạy tiếp trước giờ hẹn`;
      break;
    case "MISSED":
      headline = msg.includes("tạm dừng")
        ? "Không chạy vì chiến dịch đang tạm dừng lúc đến giờ"
        : "Không chạy vì backend không bật lúc đến giờ";
      break;
    case "FAILED":
      headline = msg || "Khung bị lỗi";
      break;
    default:
      headline = msg;
  }
  const note =
    msg &&
    slot.status !== "FAILED" &&
    !NOISY_MESSAGE_PREFIXES.some((p) => msg.startsWith(p))
      ? msg
      : "";
  return { headline, note, total };
}

/**
 * Chi tiết 1 chiến dịch: thông tin, các khung giờ (trạng thái, kết quả, ghi chú) và Chạy lại khung bị lỡ / lỗi.
 */
export function PostCampaignDetailDialog({
  campaignId,
  open,
  onOpenChange,
  onStop,
  onResume,
  onDelete,
  onChanged,
}) {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [rerunSlotId, setRerunSlotId] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (quiet = false) => {
      if (!campaignId) return;
      if (!quiet) setLoading(true);
      try {
        setData(await getPostCampaign(campaignId));
      } catch (err) {
        if (!quiet) {
          toast.error(
            err?.message || "Không tải được chiến dịch.",
            "CHI TIẾT CHIẾN DỊCH",
          );
          onOpenChange(false);
        }
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [campaignId, onOpenChange],
  );

  useEffect(() => {
    if (!open || !campaignId) {
      setData(null);
      setRerunSlotId(null);
      return undefined;
    }
    load();
    const id = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(id);
  }, [open, campaignId, load]);

  const handleRerun = async (slot, runTime) => {
    setBusy(true);
    try {
      await rerunPostCampaignSlot(data.id, slot.id, runTime);
      toast.success(
        runTime
          ? `Đã hẹn chạy lại khung ${formatTime(slot.run_at)} lúc ${runTime}.`
          : `Khung ${formatTime(slot.run_at)} sẽ chạy lại trong giây lát.`,
        "CHẠY LẠI",
      );
      setRerunSlotId(null);
      await load(true);
      onChanged?.();
    } catch (err) {
      toast.error(err?.message || "Không chạy lại được.", "CHẠY LẠI");
    } finally {
      setBusy(false);
    }
  };

  const slots = data?.slots || [];
  const count = (pred) => slots.filter(pred).length;
  const status = data
    ? campaignStatus({
        ...data,
        slot_running: count((s) => s.status === "RUNNING"),
        slot_missed: count((s) => s.status === "MISSED"),
        slot_failed: count((s) => s.status === "FAILED"),
        slot_stopped: count((s) => s.status === "STOPPED" && s.session_id),
      })
    : null;
  const settings = data?.settings || {};
  const accounts = (data?.accounts || []).length;
  const now = Date.now();

  // Tổng hợp bài của cả chiến dịch: mỗi khung × mỗi nick = 1 bài
  const expected = accounts * slots.length;
  const agg = { published: 0, failed: 0, stopped: 0, pending: 0 };
  for (const s of slots) {
    const c = s.post_counts;
    if (!c) continue;
    agg.published += c.published;
    agg.failed += c.failed;
    agg.stopped += c.stopped;
    agg.pending += c.pending;
  }
  agg.notRun = Math.max(
    0,
    expected - agg.published - agg.failed - agg.stopped - agg.pending,
  );
  const rerunSlots = slots.filter((s) => s.can_rerun);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto p-6 sm:max-w-4xl">
        <DialogHeader className="border-b border-slate-100 pb-4 pr-8">
          <div className="flex flex-wrap items-center gap-3">
            <DialogTitle className="text-lg font-bold text-slate-900">
              {data?.name || "Chi tiết chiến dịch"}
            </DialogTitle>
            {status && <StatusPill {...status} />}
            {data && !data.on_this_machine && (
              <StatusPill tone="amber" label="Chạy trên máy khác" />
            )}
          </div>
          <DialogDescription className="text-xs text-slate-500">
            {data
              ? `Tạo lúc ${formatDateTime(data.created_at)} · cập nhật ${formatDateTime(data.updated_at)}`
              : "Đang tải..."}
          </DialogDescription>
        </DialogHeader>

        {loading && !data ? (
          <div className="flex justify-center py-12">
            <Loader2 className="size-6 animate-spin text-blue-600" />
          </div>
        ) : data ? (
          <div className="space-y-4 pt-2">
            {/* Tổng quan: thanh tiến độ toàn chiến dịch */}
            <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Tiến độ bài đăng
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {accounts} nick × {slots.length} khung giờ = {expected} bài
                  </p>
                </div>
                <p className="tabular-nums">
                  <span className="text-2xl font-bold text-emerald-600">
                    {agg.published}
                  </span>
                  <span className="text-sm font-semibold text-slate-400">
                    {" "}
                    / {expected} đã đăng
                  </span>
                </p>
              </div>
              <SegmentBar counts={agg} total={expected} className="h-2.5" />
              <SegmentLegend counts={agg} keepZero={["published"]} />
              <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
                <Fact icon={Users}>{accounts} nick</Fact>
                <Fact icon={FileText}>
                  {data.post_count} bài ·{" "}
                  {CONTENT_MODE_LABEL[data.content_mode] || data.content_mode}
                </Fact>
                <Fact icon={ImageIcon}>
                  {IMAGE_MODE_LABEL[data.image_mode] || data.image_mode}
                  {data.image_mode !== "NONE" &&
                    ` · ${(data.image_paths || []).length} ảnh`}
                </Fact>
                <Fact icon={Timer}>
                  {settings.thread_count || 1} luồng · nghỉ{" "}
                  {formatDelay(settings.min_delay, settings.max_delay)} giữa 2
                  bài
                </Fact>
              </div>
            </div>

            {/* Việc cần làm */}
            {rerunSlots.length > 0 && (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                <p>
                  <strong>{rerunSlots.length} khung chưa đăng đủ</strong> (
                  {rerunSlots.map((s) => formatTime(s.run_at)).join(", ")}). Bấm{" "}
                  <strong>Chạy lại</strong> ở khung đó: chỉ đăng cho các nick
                  còn thiếu, dùng bài / ảnh nick chưa từng đăng.
                </p>
              </div>
            )}
            {slots.some((s) => s.paused) && (
              <div className="flex items-start gap-2.5 rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-2.5 text-xs text-violet-700">
                <Pause className="mt-0.5 size-4 shrink-0" />
                <p>
                  Khung <strong>Tạm dừng</strong> sẽ chạy đúng giờ nếu bấm{" "}
                  <strong>Chạy tiếp</strong> trước giờ hẹn; qua giờ hẹn mà chiến
                  dịch vẫn tạm dừng thì khung thành <strong>Bị lỡ</strong>.
                </p>
              </div>
            )}

            {/* Dòng thời gian các khung giờ */}
            <div>
              <h3 className="mb-2 text-sm font-bold text-slate-800">
                Các khung giờ
              </h3>
              <ol className="relative space-y-2 before:absolute before:bottom-4 before:left-[27px] before:top-4 before:w-px before:bg-slate-200">
                {slots.map((slot) => {
                  const st = slotStatus(slot);
                  const { headline, note, total } = describeSlot(
                    slot,
                    accounts,
                    now,
                  );
                  const counts = slot.post_counts
                    ? {
                        ...slot.post_counts,
                        notRun: Math.max(
                          0,
                          total -
                            slot.post_counts.published -
                            slot.post_counts.failed -
                            slot.post_counts.stopped -
                            slot.post_counts.pending,
                        ),
                      }
                    : null;
                  return (
                    <li key={slot.id} className="relative flex gap-3">
                      <div className="relative z-10 flex w-14 shrink-0 flex-col items-center pt-3">
                        <span
                          className={`size-3 rounded-full ring-4 ${DOT_TONE[st.tone] || DOT_TONE.slate} ${st.pulse ? "animate-pulse" : ""}`}
                        />
                        <span className="mt-1.5 font-mono text-xs font-bold text-slate-800">
                          {formatTime(slot.run_at)}
                        </span>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-3 rounded-xl border border-slate-100 bg-white px-3.5 py-3 shadow-2xs">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusPill {...st} />
                            {slot.started_at && (
                              <span className="text-[11px] text-slate-400">
                                bắt đầu {formatTime(slot.started_at)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-semibold leading-relaxed text-slate-700">
                            {headline}
                          </p>
                          {counts && (
                            <div className="space-y-1">
                              <SegmentBar
                                counts={counts}
                                total={total}
                                className="h-1.5 max-w-sm"
                              />
                              <SegmentLegend counts={counts} />
                            </div>
                          )}
                          {note && (
                            <p className="text-[11px] leading-relaxed text-slate-400">
                              {note}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          {rerunSlotId === slot.id ? (
                            <RerunControls
                              busy={busy}
                              onRun={(t) => handleRerun(slot, t)}
                              onCancel={() => setRerunSlotId(null)}
                            />
                          ) : slot.can_rerun ? (
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => setRerunSlotId(slot.id)}
                              className="h-7 gap-1 bg-blue-600 px-2.5 text-xs hover:bg-blue-700"
                            >
                              <RotateCcw className="size-3.5" />
                              Chạy lại
                            </Button>
                          ) : slot.status === "RUNNING" &&
                            data.on_this_machine ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                router.push(
                                  "/interact/post?tab=status&progress=1",
                                )
                              }
                              className="h-7 gap-1 px-2.5 text-xs"
                            >
                              <Activity className="size-3.5" />
                              Xem tiến trình
                            </Button>
                          ) : null}
                          {slot.session_id &&
                            slot.status !== "RUNNING" &&
                            rerunSlotId !== slot.id && (
                              <button
                                type="button"
                                onClick={() =>
                                  router.push(
                                    `/interact/history?campaign=${data.id}&slot=${slot.id}`,
                                  )
                                }
                                className="text-[11px] font-semibold text-slate-500 hover:text-blue-600 hover:underline"
                              >
                                Xem bài của khung →
                              </button>
                            )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  router.push(`/interact/history?campaign=${data.id}`)
                }
                className="mr-auto gap-1.5"
              >
                <History className="size-3.5" />
                Xem bài đã đăng
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!data.can_edit}
                title={
                  data.can_edit ? "" : "Đang chạy 1 khung giờ, đợi xong rồi sửa"
                }
                onClick={() =>
                  router.push(`/interact/post?tab=status&campaign=${data.id}`)
                }
                className="gap-1.5"
              >
                <Pencil className="size-3.5" />
                Sửa
              </Button>
              {data.status === "STOPPED" ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onResume?.(data)}
                  className="gap-1.5 bg-blue-600 hover:bg-blue-700"
                >
                  <Play className="size-3.5" />
                  Chạy tiếp
                </Button>
              ) : data.status === "ACTIVE" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onStop?.(data)}
                  className="gap-1.5 border-amber-200 text-amber-700 hover:bg-amber-50"
                >
                  <Pause className="size-3.5" />
                  Tạm dừng
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onDelete?.(data)}
                className="gap-1.5 border-rose-200 text-rose-600 hover:bg-rose-50"
              >
                <Trash2 className="size-3.5" />
                Xoá
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
