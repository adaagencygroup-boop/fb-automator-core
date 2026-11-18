"use client";

import React from "react";
import { ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function HistoryDetailDialog({ item, onClose }) {
  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <FileText className="size-4 text-primary" />
            <span>Nội dung chi tiết tác vụ</span>
          </DialogTitle>
        </DialogHeader>

        {item && (
          <div className="space-y-3 py-2 text-xs">
            <div className="grid grid-cols-2 gap-2 rounded-md bg-slate-50 p-2.5 text-[11px] text-slate-600">
              <div>
                <span className="font-semibold text-slate-500">Tác vụ:</span>{" "}
                {item.action_type === "POST" ? "Đăng bài" : "Bình luận"}
              </div>
              <div>
                <span className="font-semibold text-slate-500">Chiến dịch:</span>{" "}
                {item.campaign_name || "--"}
              </div>
              <div>
                <span className="font-semibold text-slate-500">Tài khoản:</span>{" "}
                {item.account_uid}
              </div>
              <div>
                <span className="font-semibold text-slate-500">Nhóm:</span>{" "}
                {item.group_name}
              </div>
            </div>

            <div>
              <p className="mb-1 text-[11px] font-semibold text-slate-700">Nội dung đã gửi:</p>
              <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-800">
                {item.content}
              </div>
            </div>

            {item.result_url && (
              <div className="pt-1">
                <a
                  href={item.result_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
                >
                  <span>Mở liên kết trên Facebook</span>
                  <ExternalLink className="size-3" />
                </a>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="mt-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Đóng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
