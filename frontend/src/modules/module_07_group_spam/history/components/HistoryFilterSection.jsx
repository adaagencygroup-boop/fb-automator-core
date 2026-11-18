"use client";

import React from "react";
import { AlertCircle, CalendarDays, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function HistoryFilterSection({
  searchTerm,
  onSearchChange,
  campaignFilter,
  onCampaignChange,
  campaignsList,
  seedingType,
  onSeedingTypeChange,
  statusFilter,
  onStatusChange,
  timeRange,
  onTimeRangeChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  dateError,
  onSubmit,
  onReset,
}) {
  return (
    <Card className="border-slate-200 bg-white p-4 shadow-xs">
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {/* 1. Tìm kiếm (tên chiến dịch, UID, link bài) */}
          <div className="relative lg:col-span-2">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Tìm chiến dịch, UID, link bài, nhóm..."
              className="pl-9 text-xs"
            />
          </div>

          {/* 2. Chiến dịch */}
          <div>
            <select
              value={campaignFilter}
              onChange={(e) => onCampaignChange(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              <option value="ALL">Chiến dịch: Tất cả</option>
              {campaignsList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* 3. Loại seeding */}
          <div>
            <select
              value={seedingType}
              onChange={(e) => onSeedingTypeChange(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              <option value="ALL">Loại: Tất cả</option>
              <option value="POST">Đăng bài</option>
              <option value="COMMENT">Bình luận</option>
            </select>
          </div>

          {/* 4. Trạng thái */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => onStatusChange(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              <option value="ALL">Trạng thái: Tất cả</option>
              <option value="SUCCESS">Thành công</option>
              <option value="FAILED">Thất bại</option>
            </select>
          </div>

          {/* 5. Nút Đặt lại */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onReset}
              className="w-full text-xs"
            >
              <RotateCcw className="mr-1.5 size-3" /> Đặt lại
            </Button>
          </div>
        </div>

        {/* Chọn thời gian */}
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-3.5 text-slate-400" />
            <span className="text-xs font-semibold text-slate-600">Thời gian:</span>
            <select
              value={timeRange}
              onChange={(e) => onTimeRangeChange(e.target.value)}
              className="h-8 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none"
            >
              <option value="all">Tất cả thời gian</option>
              <option value="today">Hôm nay</option>
              <option value="7days">7 ngày qua</option>
              <option value="30days">30 ngày qua</option>
              <option value="custom">Khoảng ngày tùy chọn</option>
            </select>
          </div>

          {timeRange === "custom" && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Từ:</span>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => onStartDateChange(e.target.value)}
                className="h-8 w-36 text-xs"
              />
              <span className="text-xs text-slate-500">Đến:</span>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => onEndDateChange(e.target.value)}
                className="h-8 w-36 text-xs"
              />
            </div>
          )}

          {dateError && (
            <p className="flex items-center gap-1 text-[11px] font-medium text-rose-500">
              <AlertCircle className="size-3" /> {dateError}
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}
