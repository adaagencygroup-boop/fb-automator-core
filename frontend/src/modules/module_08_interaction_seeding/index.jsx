"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function InteractionSeedingModule() {
  const [postUrl, setPostUrl] = useState("");
  const [actionType, setActionType] = useState("BUFF_LIKE");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between p-5 pb-3">
          <CardTitle className="text-pink-400">❤️ Seeding Bài &amp; Page (Buff Tương Tác)</CardTitle>
          <Button size="sm" variant="default">🚀 Bắt Đầu Seeding</Button>
        </CardHeader>
        <CardContent className="p-5 pt-0 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400">Link bài viết / Video:</label>
            <input
              type="text"
              value={postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
              placeholder="https://facebook.com/watch/?v=123456..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-pink-400 font-mono"
            />
          </div>

          <div className="flex items-center gap-3">
            <label className="text-xs text-slate-400">Hành động buff:</label>
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded p-2 text-xs text-slate-200"
            >
              <option value="BUFF_LIKE">Thả Cảm Xúc (Like/Love/Haha)</option>
              <option value="BUFF_COMMENT">Bình Luận Mồi Theo Kịch Bản</option>
              <option value="BUFF_SHARE">Chia Sẻ Bài Viết</option>
            </select>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
