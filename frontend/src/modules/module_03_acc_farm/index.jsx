"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function AccFarmModule() {
  const [surfNewsfeed, setSurfNewsfeed] = useState(true);
  const [likeRandom, setLikeRandom] = useState(true);
  const [watchReels, setWatchReels] = useState(true);
  const [isRunning, setIsRunning] = useState(false);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between p-5 pb-3">
          <CardTitle className="text-emerald-400">🚜 Kịch Bản Nuôi Tài Khoản Tự Động</CardTitle>
          <Button
            onClick={() => setIsRunning(!isRunning)}
            variant={isRunning ? "destructive" : "default"}
            size="sm"
          >
            {isRunning ? "⏹ Dừng Nuôi" : "▶ Bắt Đầu Nuôi"}
          </Button>
        </CardHeader>
        <CardContent className="p-5 pt-0 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={surfNewsfeed}
                onChange={(e) => setSurfNewsfeed(e.target.checked)}
                className="rounded bg-slate-950 border-slate-700"
              />
              Lướt Newsfeed (5-15s)
            </label>

            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={likeRandom}
                onChange={(e) => setLikeRandom(e.target.checked)}
                className="rounded bg-slate-950 border-slate-700"
              />
              Thả tim / Like dạo
            </label>

            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={watchReels}
                onChange={(e) => setWatchReels(e.target.checked)}
                className="rounded bg-slate-950 border-slate-700"
              />
              Xem Reels đề xuất
            </label>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
