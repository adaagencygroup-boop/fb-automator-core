"use client";

import React from "react";
import { SearchFilterCard } from "../../shared/components";

export default function CampaignFilterSection({
  searchQuery,
  setSearchQuery,
  timeFilter,
  setTimeFilter,
  actionTypeFilter,
  setActionTypeFilter,
  statusFilter,
  setStatusFilter,
  customFromDate,
  setCustomFromDate,
  customToDate,
  setCustomToDate,
  onReset,
  onSubmit,
}) {
  return (
    <SearchFilterCard
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Tìm kiếm theo tên chiến dịch..."
      fields={[
        {
          key: "time",
          label: "Thời gian chạy",
          value: timeFilter,
          onChange: setTimeFilter,
          options: [
            { value: "all", label: "Tất cả" },
            { value: "today", label: "Hôm nay" },
            { value: "7days", label: "7 ngày qua" },
            { value: "30days", label: "30 ngày qua" },
            { value: "custom", label: "Khoảng ngày tùy chọn" },
          ],
        },
        {
          key: "action_type",
          label: "Loại chiến dịch",
          value: actionTypeFilter,
          onChange: setActionTypeFilter,
          options: [
            { value: "ALL", label: "Tất cả" },
            { value: "POST", label: "Đăng bài" },
            { value: "COMMENT", label: "Bình luận" },
          ],
        },
        {
          key: "status",
          label: "Trạng thái",
          value: statusFilter,
          onChange: setStatusFilter,
          options: [
            { value: "ALL", label: "Tất cả" },
            { value: "COMPLETED", label: "Thành công" },
            { value: "FAILED", label: "Thất bại" },
          ],
        },
      ]}
      showCustomDate={timeFilter === "custom"}
      fromDate={customFromDate}
      onFromDateChange={setCustomFromDate}
      toDate={customToDate}
      onToDateChange={setCustomToDate}
      onReset={onReset}
      onSubmit={onSubmit}
      submitLabel="Lọc kết quả"
    />
  );
}
