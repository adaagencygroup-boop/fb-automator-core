"use client";

import React from "react";
import { CheckCircle2, Layers, XCircle } from "lucide-react";
import { StatCard } from "../../shared/components";

export default function HistoryStatsSection({ stats }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard
        title="Tổng tác vụ"
        value={stats.total}
        description="Khớp với bộ lọc hiện tại"
        icon={<Layers className="size-4" />}
        tone="primary"
      />
      <StatCard
        title="Thành công"
        value={stats.success}
        badge={`(${stats.success_rate})`}
        description="Tác vụ đã hoàn tất và xác nhận"
        icon={<CheckCircle2 className="size-4" />}
        tone="emerald"
      />
      <StatCard
        title="Thất bại"
        value={stats.failed}
        badge={`(${stats.failed_rate})`}
        description="Bị giới hạn hoặc phát sinh lỗi"
        icon={<XCircle className="size-4" />}
        tone="rose"
      />
    </div>
  );
}
