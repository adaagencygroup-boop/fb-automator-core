"use client";

import React from "react";
import { RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard, Field } from "../../shared/components";

export default function CampaignInfoSection({
  campaignName,
  setCampaignName,
  campaignDescription,
  setCampaignDescription,
  campaignId,
  isRerun = false,
  stepNumber = "1",
}) {
  return (
    <div id="step-1-campaign" className="scroll-mt-6">
      <SectionCard
        number={stepNumber}
        title="Tạo chiến dịch"
        description="Đặt tên và mô tả ngắn giúp dễ dàng tìm kiếm, quản lý và chạy lại chiến dịch sau này."
      >
        {isRerun && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/70 p-3 text-xs text-blue-800">
            <RefreshCw className="size-4 shrink-0 text-blue-600" />
            <div>
              <p className="font-semibold">Chế độ Chạy lại chiến dịch (Rerun)</p>
              <p className="text-[11px] text-blue-600">
                Đang nạp lại cấu hình từ lượt chạy trước của chiến dịch <strong>{campaignName}</strong>. Hệ thống sẽ tạo lượt chạy mới và giữ nguyên lịch sử cũ.
              </p>
            </div>
          </div>
        )}

        <div>
          <Field label="Tên chiến dịch *">
            <Input
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder="Ví dụ: Chiến dịch tuyển dụng Q1 / Seeding hội mua bán 2026..."
              className="text-xs"
            />
          </Field>
        </div>

        <div className="mt-3">
          <Field label="Mô tả ngắn (không bắt buộc)">
            <Textarea
              rows={2}
              value={campaignDescription}
              onChange={(e) => setCampaignDescription(e.target.value)}
              placeholder="Ghi chú mục tiêu chiến dịch, nhóm khách hàng hoặc thông điệp chính..."
              className="resize-none text-xs"
            />
          </Field>
        </div>

      </SectionCard>
    </div>
  );
}
