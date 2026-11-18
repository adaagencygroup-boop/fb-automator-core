"use client";

import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GroupsError({ error, reset }) {
  return (
    <div className="flex min-h-[360px] items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-rose-200 bg-white p-6 text-center shadow-xs">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-rose-50 text-rose-600">
          <AlertTriangle className="size-5" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-bold text-slate-900">Đã xảy ra lỗi hiển thị</h2>
          <p className="text-xs text-slate-600">
            {error?.message || "Không thể tải trang quản lý nhóm. Vui lòng thử lại."}
          </p>
        </div>
        <div className="flex items-center justify-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            onClick={() => (reset ? reset() : window.location.reload())}
          >
            <RotateCcw className="mr-1.5 size-3.5" /> Thử lại
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => window.location.assign("/groups/campaigns/")}
          >
            Về danh sách chiến dịch
          </Button>
        </div>
      </div>
    </div>
  );
}
