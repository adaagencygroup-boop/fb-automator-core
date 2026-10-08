"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function GroupSpamModule() {
  const [content, setContent] = useState("");
  const [groupIds, setGroupIds] = useState("");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between p-5 pb-3">
          <CardTitle className="text-rose-400">🚀 Spam &amp; Tương Tác Hội Nhóm</CardTitle>
          <Button size="sm" variant="default">▶ Bắt Đầu Đăng Nhóm</Button>
        </CardHeader>
        <CardContent className="p-5 pt-0 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400">Nội dung bài đăng / bình luận nhóm:</label>
            <textarea
              rows={3}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Chào mọi người {nhé|ạ}! Hôm nay em xin phép chia sẻ bí quyết..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-200 focus:outline-none focus:border-rose-400 font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-slate-400">Danh sách ID Nhóm mục tiêu (Mỗi dòng 1 ID):</label>
            <textarea
              rows={3}
              value={groupIds}
              onChange={(e) => setGroupIds(e.target.value)}
              placeholder="1049284729182&#10;9283749281742"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-200 focus:outline-none focus:border-rose-400 font-mono"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
