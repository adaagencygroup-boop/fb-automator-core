"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Loader2, Pencil, Play, RotateCcw, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/lib/toast";
import { getPostCampaign, rerunPostCampaignSlot } from "../../service";
import {
  CONTENT_MODE_LABEL,
  IMAGE_MODE_LABEL,
  StatusPill,
  campaignStatus,
  formatDateTime,
  formatTime,
  slotStatus,
} from "./campaignUi";

const POLL_MS = 5000;

function InfoItem({ label, children }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <div className="text-sm font-semibold text-slate-800">{children}</div>
    </div>
  );
}

function RerunControls({ onRun, busy, onCancel }) {
  const [time, setTime] = useState("");
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Button type="button" size="sm" disabled={busy} onClick={() => onRun("")} className="h-7 bg-blue-600 px-2.5 text-xs hover:bg-blue-700">
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
      <Button type="button" size="sm" variant="outline" disabled={busy || !time} onClick={() => onRun(time)} className="h-7 px-2.5 text-xs">
        Hẹn giờ
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel} className="h-7 px-2 text-xs text-slate-500">
        Huỷ
      </Button>
    </div>
  );
}

/**
 * Chi tiết 1 chiến dịch: thông tin, các khung giờ (trạng thái, kết quả, ghi chú) và Chạy lại khung bị lỡ / lỗi.
 */
export function PostCampaignDetailDialog({ campaignId, open, onOpenChange, onStop, onResume, onDelete, onChanged }) {
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
          toast.error(err?.message || "Không tải được chiến dịch.", "CHI TIẾT CHIẾN DỊCH");
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
        runTime ? `Đã hẹn chạy lại khung ${formatTime(slot.run_at)} lúc ${runTime}.` : `Khung ${formatTime(slot.run_at)} sẽ chạy lại trong giây lát.`,
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

  const status = data ? campaignStatus({ ...data, slot_running: data.slots?.filter((s) => s.status === "RUNNING").length, slot_problem: data.slots?.filter((s) => ["MISSED", "FAILED"].includes(s.status)).length }) : null;
  const settings = data?.settings || {};
  const slots = data?.slots || [];
  const done = slots.filter((s) => s.status === "DONE").length;
  const successTotal = slots.reduce((n, s) => n + (Number(s.success_count) || 0), 0);
  const failedTotal = slots.reduce((n, s) => n + (Number(s.failed_count) || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto p-6 sm:max-w-5xl">
        <DialogHeader className="border-b border-slate-100 pb-4 pr-8">
          <div className="flex flex-wrap items-center gap-3">
            <DialogTitle className="text-lg font-bold text-slate-900">{data?.name || "Chi tiết chiến dịch"}</DialogTitle>
            {status && <StatusPill {...status} />}
            {data && !data.on_this_machine && <StatusPill tone="amber" label="Chạy trên máy khác" />}
          </div>
          <DialogDescription className="text-xs text-slate-500">
            {data ? `Tạo lúc ${formatDateTime(data.created_at)}. Mỗi khung, mỗi nick đăng 1 bài; nick không đăng lại bài / ảnh đã đăng trong chiến dịch.` : "Đang tải..."}
          </DialogDescription>
        </DialogHeader>

        {loading && !data ? (
          <div className="flex justify-center py-12">
            <Loader2 className="size-6 animate-spin text-blue-600" />
          </div>
        ) : data ? (
          <div className="space-y-5 pt-2">
            <div className="grid grid-cols-2 gap-4 rounded-xl border border-slate-100 bg-slate-50/60 p-4 sm:grid-cols-4">
              <InfoItem label="Số nick">{(data.accounts || []).length}</InfoItem>
              <InfoItem label="Nội dung">
                {data.post_count} bài · {CONTENT_MODE_LABEL[data.content_mode] || data.content_mode}
              </InfoItem>
              <InfoItem label="Ảnh">
                {IMAGE_MODE_LABEL[data.image_mode] || data.image_mode}
                {data.image_mode !== "NONE" && ` · ${(data.image_paths || []).length} ảnh`}
                {data.image_mode === "MULTI" && ` · ${data.min_images}–${data.max_images}/bài`}
              </InfoItem>
              <InfoItem label="Luồng · giãn cách">
                {settings.thread_count || 1} luồng · {settings.min_delay ?? 0}–{settings.max_delay ?? 0}s
              </InfoItem>
              <InfoItem label="Khung giờ">
                {done}/{slots.length} đã xong
              </InfoItem>
              <InfoItem label="Bài thành công">
                <span className="text-emerald-600">{successTotal}</span>
              </InfoItem>
              <InfoItem label="Bài lỗi / dừng">
                <span className={failedTotal ? "text-rose-600" : ""}>{failedTotal}</span>
              </InfoItem>
              <InfoItem label="Cập nhật">{formatDateTime(data.updated_at)}</InfoItem>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-bold text-slate-800">Các khung giờ</h3>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[80px]">Giờ</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead>Bắt đầu</TableHead>
                    <TableHead>Kết quả</TableHead>
                    <TableHead className="min-w-[220px]">Ghi chú</TableHead>
                    <TableHead className="text-right">Thao tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slots.map((slot) => {
                    const st = slotStatus(slot);
                    return (
                      <TableRow key={slot.id}>
                        <TableCell className="font-mono font-bold text-blue-600">{formatTime(slot.run_at)}</TableCell>
                        <TableCell>
                          <StatusPill {...st} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-slate-600">
                          {slot.started_at ? formatTime(slot.started_at) : "--"}
                          {slot.status === "RUNNING" && slot.estimated_finish_at && (
                            <span className="block text-[11px] text-slate-400">dự kiến xong {formatTime(slot.estimated_finish_at)}</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {slot.status === "WAITING" ? (
                            "--"
                          ) : (
                            <>
                              <span className="font-semibold text-emerald-600">{slot.success_count || 0}</span>
                              <span className="text-slate-400"> / {slot.total_count || 0}</span>
                              {Number(slot.failed_count) > 0 && <span className="ml-1 text-rose-600">({slot.failed_count} lỗi)</span>}
                            </>
                          )}
                        </TableCell>
                        <TableCell className="text-xs leading-relaxed text-slate-500">{slot.message || ""}</TableCell>
                        <TableCell className="text-right">
                          {rerunSlotId === slot.id ? (
                            <RerunControls busy={busy} onRun={(t) => handleRerun(slot, t)} onCancel={() => setRerunSlotId(null)} />
                          ) : slot.can_rerun ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setRerunSlotId(slot.id)}
                              className="h-7 gap-1 border-blue-200 px-2.5 text-xs text-blue-600 hover:bg-blue-50"
                            >
                              <RotateCcw className="size-3.5" />
                              Chạy lại
                            </Button>
                          ) : slot.status === "RUNNING" && data.on_this_machine ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => router.push("/interact/post?tab=status&progress=1")}
                              className="h-7 gap-1 px-2.5 text-xs"
                            >
                              <Activity className="size-3.5" />
                              Xem tiến trình
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {slots.some((s) => s.can_rerun) && (
                <p className="mt-2 text-[11px] text-slate-400">
                  Chạy lại chỉ đăng cho các nick chưa đăng thành công ở khung đó, với bài / ảnh mới mà nick chưa từng đăng.
                </p>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!data.can_edit}
                title={data.can_edit ? "" : "Đang chạy 1 khung giờ, đợi xong rồi sửa"}
                onClick={() => router.push(`/interact/post?tab=status&campaign=${data.id}`)}
                className="gap-1.5"
              >
                <Pencil className="size-3.5" />
                Sửa
              </Button>
              {data.status === "STOPPED" ? (
                <Button type="button" size="sm" onClick={() => onResume?.(data)} className="gap-1.5 bg-blue-600 hover:bg-blue-700">
                  <Play className="size-3.5" />
                  Chạy tiếp
                </Button>
              ) : data.status === "ACTIVE" ? (
                <Button type="button" variant="outline" size="sm" onClick={() => onStop?.(data)} className="gap-1.5 border-amber-200 text-amber-700 hover:bg-amber-50">
                  <Square className="size-3.5" />
                  Dừng
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={() => onDelete?.(data)} className="gap-1.5 border-rose-200 text-rose-600 hover:bg-rose-50">
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
