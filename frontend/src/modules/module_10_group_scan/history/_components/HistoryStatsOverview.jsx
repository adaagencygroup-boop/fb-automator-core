"use client";

import React from "react";
import { Layers, CheckCircle2, Activity, Database } from "lucide-react";

export default function HistoryStatsOverview({ stats = {} }) {
  const total = stats.total || 0;
  const success = stats.success || 0;
  const running = stats.running || 0;
  const successRate = stats.successRate || "0.0";
  const totalItemsCollected = stats.totalItemsCollected || 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Card 1: Tổng phiên quét */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4.5 shadow-xs flex items-center justify-between transition-all hover:border-slate-300">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-500">Tổng phiên quét</p>
          <p className="text-2xl font-bold text-slate-900 tracking-tight">{total}</p>
          <p className="text-[11px] text-blue-600 font-medium flex items-center gap-1">
            <span>Đã lưu trong CSDL</span>
          </p>
        </div>
        <div className="size-11 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
          <Layers className="size-5.5" />
        </div>
      </div>

      {/* Card 2: Thành công */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4.5 shadow-xs flex items-center justify-between transition-all hover:border-slate-300">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-500">Phiên hoàn thành</p>
          <p className="text-2xl font-bold text-emerald-600 tracking-tight">{success}</p>
          <p className="text-[11px] text-emerald-600 font-medium flex items-center gap-1">
            <span>Tỷ lệ thành công:</span>
            <span className="font-bold">{successRate}%</span>
          </p>
        </div>
        <div className="size-11 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
          <CheckCircle2 className="size-5.5" />
        </div>
      </div>

      {/* Card 3: Đang thực thi */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4.5 shadow-xs flex items-center justify-between transition-all hover:border-slate-300">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-500">Đang thực thi</p>
          <p className="text-2xl font-bold text-sky-600 tracking-tight">{running}</p>
          <p className="text-[11px] text-slate-500 font-medium flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-sky-500 animate-ping inline-block" />
            <span>Tiến trình nền</span>
          </p>
        </div>
        <div className="size-11 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-center text-sky-600 shrink-0">
          <Activity className="size-5.5" />
        </div>
      </div>

      {/* Card 4: Tổng dữ liệu bóc tách */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4.5 shadow-xs flex items-center justify-between transition-all hover:border-slate-300">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-500">Dữ liệu thu thập</p>
          <p className="text-2xl font-bold text-indigo-600 tracking-tight">
            {totalItemsCollected.toLocaleString("vi-VN")}
          </p>
          <p className="text-[11px] text-slate-500 font-medium">
            Nhóm & dữ liệu đã lưu
          </p>
        </div>
        <div className="size-11 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
          <Database className="size-5.5" />
        </div>
      </div>
    </div>
  );
}
