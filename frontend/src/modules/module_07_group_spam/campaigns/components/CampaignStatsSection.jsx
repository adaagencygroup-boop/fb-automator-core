"use client";

import React from "react";
import { CheckCircle2, Megaphone, TrendingUp } from "lucide-react";
import { StatCard } from "../../shared/components";

export default function CampaignStatsSection({ stats }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard
        title="Tổng chiến dịch"
        value={stats.total}
        description="Khớp với bộ lọc hiện tại"
        tone="primary"
        icon={<Megaphone className="size-4" />}
      />
      <StatCard
        title="Chiến dịch hoàn thành"
        value={stats.completed}
        description="Chiến dịch đã chạy xong toàn bộ"
        tone="emerald"
        icon={<CheckCircle2 className="size-4" />}
      />
      <StatCard
        title="Tương tác đã tạo"
        value={stats.interactions}
        description="Tổng lượt đăng bài & bình luận thành công"
        tone="primary"
        icon={<TrendingUp className="size-4" />}
      />
    </div>
  );
}
