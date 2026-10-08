"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function OmnichannelChatModule() {
  const [autoReply, setAutoReply] = useState(false);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between p-5 pb-3">
          <CardTitle className="text-indigo-400">💬 Hộp Thư Tập Trung &amp; AI Bot</CardTitle>
          <Button
            onClick={() => setAutoReply(!autoReply)}
            variant={autoReply ? "destructive" : "secondary"}
            size="sm"
          >
            {autoReply ? "⏹ Tắt Auto-Reply AI" : "🤖 Bật Tự Động Trả Lời AI"}
          </Button>
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <p className="text-xs text-slate-400">
            Base module quản lý chat tập trung đa Fanpage. Kết nối qua Axios tới FastAPI engine.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
