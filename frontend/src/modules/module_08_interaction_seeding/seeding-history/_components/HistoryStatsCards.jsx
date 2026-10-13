"use client";

import React from "react";

export default function HistoryStatsCards({ stats = {} }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. Tổng chiến dịch */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 flex items-center gap-4 transition-all hover:shadow-md">
        <div className="shrink-0">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="48" height="48" rx="12" fill="#2563EB"/>
            <path d="M21 24H27M21 28H27M29 33H19C17.8962 33 17 32.1038 17 31V17C17 15.8962 17.8962 15 19 15H24.586C24.8512 15.0001 25.1055 15.1055 25.293 15.293L30.707 20.707C30.8945 20.8945 30.9999 21.1488 31 21.414V31C31 32.1038 30.1038 33 29 33L21 24" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div>
          <p className="text-xs text-slate-500 font-medium">Tổng chiến dịch</p>
          <p className="text-[26px] font-bold text-blue-600 tracking-tight mt-0.5">
            {(stats?.total_campaigns ?? 0).toLocaleString("vi-VN")}
          </p>
        </div>
      </div>

      {/* 2. Tổng lượt tương tác */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 flex items-center gap-4 transition-all hover:shadow-md">
        <div className="shrink-0">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="48" height="48" rx="12" fill="#059669"/>
            <path d="M30 32V22" stroke="white" strokeWidth="2"/>
            <path d="M24 32V16" stroke="white" strokeWidth="2"/>
            <path d="M18 32V26" stroke="white" strokeWidth="2"/>
          </svg>
        </div>
        <div>
          <p className="text-xs text-slate-500 font-medium">Tổng lượt tương tác</p>
          <p className="text-[26px] font-bold text-slate-900 tracking-tight mt-0.5">
            {(stats?.total_interactions ?? 0).toLocaleString("vi-VN")}
          </p>
        </div>
      </div>

      {/* 3. Thành công */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 flex items-center gap-4 transition-all hover:shadow-md">
        <div className="shrink-0">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="48" height="48" rx="12" fill="#059669"/>
            <path d="M32 18L21 29L16 24" stroke="white" strokeWidth="2.5"/>
          </svg>
        </div>
        <div>
          <p className="text-xs text-slate-500 font-medium">Thành công</p>
          <p className="text-[26px] font-bold text-emerald-600 tracking-tight mt-0.5">
            {(stats?.total_success ?? 0).toLocaleString("vi-VN")}
          </p>
        </div>
      </div>

      {/* 4. Thất bại */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 flex items-center gap-4 transition-all hover:shadow-md">
        <div className="shrink-0">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="48" height="48" rx="12" fill="#DC2626"/>
            <path d="M30 18L18 30" stroke="white" strokeWidth="2.5"/>
            <path d="M18 18L30 30" stroke="white" strokeWidth="2.5"/>
          </svg>
        </div>
        <div>
          <p className="text-xs text-slate-500 font-medium">Thất bại</p>
          <p className="text-[26px] font-bold text-red-600 tracking-tight mt-0.5">
            {(stats?.total_failed ?? 0).toLocaleString("vi-VN")}
          </p>
        </div>
      </div>
    </div>
  );
}
