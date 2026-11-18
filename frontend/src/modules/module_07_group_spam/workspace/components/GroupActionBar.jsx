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
  contentType = "post",
}) {
  const isComment = contentType === "comment";
  return (
    <Card className="sticky bottom-0 z-20 flex flex-col items-center justify-between gap-4 border-slate-200 bg-white/95 px-6 py-4 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur sm:flex-row">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <Check size={20} />
        </span>
        <div>
          <p className="text-base font-bold text-slate-700">Bắt đầu khi bạn đã nhập đủ thông tin</p>
          <p className="text-xs text-slate-400">Hệ thống sẽ thông báo các bước còn thiếu khi bạn nhấn Bắt đầu {isComment ? "bình luận" : "đăng bài"}</p>
        </div>
      </div>
      <div className="flex gap-3">
        <Button
          type="button"
          variant="destructive"
          disabled={runState === "idle"}
          onClick={onStop}
        >
          <Square className="mr-2  fill-current" size={16} /> {isComment ? "DỪNG BÌNH LUẬN" : "DỪNG ĐĂNG"}
        </Button>
        <Button
          type="button"
          variant="success"
          disabled={!canStart}
          onClick={onStart}
        >
          <Play className="mr-2 fill-current" size={16} /> {isComment ? "BẮT ĐẦU BÌNH LUẬN" : "BẮT ĐẦU ĐĂNG BÀI"}
        </Button>
      </div>
    </Card>
  );
}
