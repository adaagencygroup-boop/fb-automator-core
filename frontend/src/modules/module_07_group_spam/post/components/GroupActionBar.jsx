"use client";

import React from "react";
import { Check, Square, Play } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function GroupActionBar({
  runState = "idle",
  canStart = false,
  onStart,
  onStop,
}) {
  return (
    <Card className="sticky bottom-0 z-20 flex flex-col items-center justify-between gap-4 border-slate-200 bg-white/95 px-6 py-4 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur sm:flex-row">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <Check className="size-4" />
        </span>
        <div>
          <p className="text-xs font-bold text-slate-700">Sẵn sàng thực thi tiến trình đăng bài</p>
          <p className="text-[10px] text-slate-400">Hệ thống sẽ chạy tự động theo các thông số đã cấu hình ở trên</p>
        </div>
      </div>
      <div className="flex gap-3">
        <Button
          type="button"
          variant="destructive"
          disabled={runState === "idle"}
          onClick={onStop}
        >
          <Square className="mr-2 size-3 fill-current" /> DỪNG ĐĂNG
        </Button>
        <Button
          type="button"
          variant="success"
          disabled={!canStart}
          onClick={onStart}
        >
          <Play className="mr-2 size-3.5 fill-current" /> BẮT ĐẦU ĐĂNG BÀI
        </Button>
      </div>
    </Card>
  );
}
