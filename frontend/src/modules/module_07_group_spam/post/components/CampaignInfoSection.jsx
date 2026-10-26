"use client";

import React, { useState } from "react";
import { Check, Edit3, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard, Field } from "../../shared/components";
import { toast } from "@/lib/toast";

export default function CampaignInfoSection({
  campaignName,
  setCampaignName,
  campaignDescription,
  setCampaignDescription,
  campaignId,
  isLocked,
  setIsLocked,
  isRerun = false,
  onContinue,
  stepNumber = "1",
}) {
  const [error, setError] = useState("");

  const handleConfirm = () => {
    const trimmed = (campaignName || "").trim();
    if (!trimmed) {
      setError("Tên chiến dịch là bắt buộc, không được để trống hoặc chỉ chứa khoảng trắng.");
      toast.warning("Vui lòng nhập tên chiến dịch trước khi tiếp tục!", "THIẾU THÔNG TIN");
      return;
    }
    setError("");
    setIsLocked(true);
    toast.success(`Đã lưu thông tin chiến dịch "${trimmed}". Đang chuyển sang Bước 2...`, "BƯỚC 1 HOÀN TẤT");
    if (onContinue) {
      onContinue();
    }
  };

  const handleUnlock = () => {
    setIsLocked(false);
  };

  return (
    <div id="step-1-campaign" className="scroll-mt-6">
      <SectionCard
        number={stepNumber}
        title="Tạo chiến dịch"
        description="Đặt tên và mô tả ngắn giúp dễ dàng tìm kiếm, quản lý và chạy lại chiến dịch sau này."
        aside={
          isLocked ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 border border-emerald-200/60">
              <Check className="size-3 text-emerald-600" />
              Đã xác nhận 
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 border border-amber-200/60">
              <Edit3 className="size-3 text-amber-600" />
              Đang thiết lập
            </span>
          )
        }
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
              onChange={(e) => {
                setCampaignName(e.target.value);
                if (error) setError("");
              }}
              disabled={isLocked}
              placeholder="Ví dụ: Chiến dịch tuyển dụng Q1 / Seeding hội mua bán 2026..."
              className={`text-xs ${error ? "border-red-400 focus-visible:ring-red-400" : ""}`}
            />
            {error && (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-red-500">
                <AlertCircle className="size-3" />
                {error}
              </p>
            )}
          </Field>
        </div>

        <div className="mt-3">
          <Field label="Mô tả ngắn (không bắt buộc)">
            <Textarea
              rows={2}
              value={campaignDescription}
              onChange={(e) => setCampaignDescription(e.target.value)}
              disabled={isLocked}
              placeholder="Ghi chú mục tiêu chiến dịch, nhóm khách hàng hoặc thông điệp chính..."
              className="resize-none text-xs"
            />
          </Field>
        </div>

        <div className="mt-4 flex items-center justify-end border-t border-slate-100 pt-3">
          {isLocked ? (
            <Button type="button" variant="outline" size="sm" onClick={handleUnlock}>
              <Edit3 className="mr-1.5 size-3.5" /> Chỉnh sửa
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={handleConfirm} className="bg-primary text-white hover:bg-primary/90">
              <Check className="mr-1.5 size-3.5" /> Xác nhận
            </Button>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
