"use client";

import { Layers, CheckCircle2, Activity, Database } from "lucide-react";

export default function HistoryStatsOverview({ stats }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Card 1: Tổng phiên quét */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-xs flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-[#64748B]">Tổng phiên quét</p>
          <p className="text-2xl font-bold text-[#0F172A]">{stats.total}</p>
          <p className="text-[11px] text-[#2563EB] font-medium flex items-center gap-1">
            <span>Đã lưu trong CSDL</span>
          </p>
        </div>
        <div className="size-11 rounded-xl bg-blue-50 flex items-center justify-center text-[#2563EB]">
          <Layers className="size-5.5" />
        </div>
      </div>

      {/* Card 2: Thành công */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-xs flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-[#64748B]">Phiên thành công</p>
          <p className="text-2xl font-bold text-emerald-600">{stats.success}</p>
          <p className="text-[11px] text-[#059669] font-medium flex items-center gap-1">
            <span>Tỷ lệ hoàn thành</span>
            <span className="font-bold">{stats.successRate}%</span>
          </p>
        </div>
        <div className="size-11 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
          <CheckCircle2 className="size-5.5" />
        </div>
      </div>

      {/* Card 3: Đang thực thi */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-xs flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-[#64748B]">Đang thực thi</p>
          <p className="text-2xl font-bold text-[#0284C7]">{stats.running}</p>
          <p className="text-[11px] text-[#64748B] font-medium flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-blue-500 animate-ping inline-block" />
            <span>Tiến trình nền ổn định</span>
          </p>
        </div>
        <div className="size-11 rounded-xl bg-sky-50 flex items-center justify-center text-[#0284C7]">
          <Activity className="size-5.5" />
        </div>
      </div>

      {/* Card 4: Tổng dữ liệu bóc tách */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-xs flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-[#64748B]">Dữ liệu đã thu thập</p>
          <p className="text-2xl font-bold text-violet-700">
            {stats.totalItemsCollected.toLocaleString("vi-VN")}
          </p>
          <p className="text-[11px] text-[#64748B] font-medium">
            Nhóm Facebook đã lưu
          </p>
        </div>
        <div className="size-11 rounded-xl bg-violet-50 flex items-center justify-center text-violet-600">
          <Database className="size-5.5" />
        </div>
      </div>
    </div>
  );
}

