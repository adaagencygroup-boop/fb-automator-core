"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function CampaignDeleteDialog({
  open,
  onOpenChange,
  campaign,
  loading,
  onConfirm,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-6">
        <DialogHeader>
          <DialogTitle className="flex text-xl font-bold text-rose-600 uppercase">
            <span>Xác nhận xóa chiến dịch</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2 text-base text-slate-600">
          <p>
            Bạn có chắc chắn muốn xóa chiến dịch <strong>&ldquo;{campaign?.name}&rdquo;</strong> không?
          </p>
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <p className="font-semibold">Lưu ý (Xóa vĩnh viễn):</p>
            <p className="mt-0.5">
              Chiến dịch cùng toàn bộ lịch sử lượt chạy và log liên quan sẽ bị xóa vĩnh viễn khỏi hệ thống và không thể khôi phục.
            </p>
          </div>
        </div>

        <DialogFooter className="mt-4 flex gap-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? "Đang xóa..." : "Xác nhận xóa"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => onOpenChange(false)}
          >
            Hủy bỏ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
