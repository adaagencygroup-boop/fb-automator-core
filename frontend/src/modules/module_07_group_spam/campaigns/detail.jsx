"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  RotateCcw,
  Layers,
  FileText,
  Users,
  CheckCircle2,
  CalendarDays,
  ExternalLink as LinkIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/lib/toast";
import {
  getGroupCampaignDetails,
  getGroupCampaignRerunConfig,
} from "../service";

export default function CampaignDetailModule({ campaignId, onBack }) {
  const router = useRouter();
  const routeParams = useParams();
  const activeCampaignId = campaignId || routeParams?.id;

  const [loading, setLoading] = useState(true);
  const [campaign, setCampaign] = useState(null);
  const [details, setDetails] = useState([]);
  const [rerunLoading, setRerunLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (cancelled) return;
      setLoading(true);
      try {
        const res = await getGroupCampaignDetails(activeCampaignId);
        if (cancelled) return;
        setCampaign(res?.campaign || null);
        setDetails(res?.details || []);
      } catch (err) {
        if (cancelled) return;
        setCampaign(null);
        setDetails([]);
        toast.error(err.message || "Không thể tải chi tiết chiến dịch");
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [activeCampaignId]);

  // Copy UID vào clipboard
  const handleCopyUid = (uid) => {
    if (!uid) return;
    navigator.clipboard.writeText(uid);
    toast.success(`Đã sao chép UID ${uid} vào bộ nhớ tạm!`, "ĐÃ SAO CHÉP");
  };

  // Chạy lại chiến dịch
  const handleRerun = async () => {
    if (!campaign) return;
    setRerunLoading(true);
    try {
      toast.info(`Đang nạp cấu hình chạy lại cho "${campaign.name}"...`, "CHẠY LẠI");
      let rerunData = null;
      try {
        rerunData = await getGroupCampaignRerunConfig(campaign.id);
      } catch (errApi) {
        console.warn("API rerun config error, using fallback rerun state:", errApi);
        rerunData = {
          campaign_id: campaign.id,
          name: campaign.name,
          description: campaign.description || "",
          action_type: campaign.action_type || "POST",
          config: {
            account_uids: [...new Set(details.map((d) => d.account_uid).filter(Boolean))],
            groups: [...new Map(details.filter((d) => d.group_url || d.group_name).map((d) => [d.group_url || d.group_name, { name: d.group_name, url: d.group_url }])).values()],
            media: [],
          },
        };
      }
      sessionStorage.setItem("fb_rerun_campaign", JSON.stringify(rerunData));

      if (campaign.action_type === "COMMENT") {
        router.push("/groups/comment");
      } else {
        router.push("/groups/post");
      }
      if (onBack) {
        onBack();
      }
    } catch (err) {
      toast.error(err.message || "Không thể nạp cấu hình chạy lại", "LỖI CHẠY LẠI");
    } finally {
      setRerunLoading(false);
    }
  };

  // Format ngày tháng hiển thị dạng DD/MM/YYYY
  const formatDateOnly = (timeStr) => {
    if (!timeStr) return "--/--/----";
    try {
      const dt = new Date(timeStr);
      return dt.toLocaleDateString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return timeStr;
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* 1. Header & Nút Quay lại */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-blue-50 shadow-xs">
            <svg width="20" height="16" viewBox="0 0 20 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
              <path d="M1 3V13C1 14.1038 1.89617 15 3 15H17C18.1038 15 19 14.1038 19 13V5C19 3.89617 18.1038 3 17 3H11L9 1H3C1.89617 1 1 1.89617 1 3V3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="#2563EB" />
            </svg>
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight text-slate-900">
              Quản lý chiến dịch
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Tra cứu, xem chi tiết và chạy lại các chiến dịch đã thực hiện.
            </p>
          </div>
        </div>

        {/* Thanh Điều hướng phụ: Nút Quay lại & Badge Loại tác vụ */}
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => {
              if (onBack) {
                onBack();
              } else {
                router.push("/groups/campaigns");
              }
            }}
            className="group inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 transition-colors hover:text-blue-600 cursor-pointer"
          >
            <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-0.5" />
            <span>Quay lại</span>
          </button>

          {campaign && (
            <span className="rounded-lg border border-slate-200/80 bg-slate-50/80 px-3.5 py-1 text-xs font-medium text-slate-600">
              {campaign.action_type === "COMMENT" ? "Comment" : "Đăng bài"}
            </span>
          )}
        </div>
      </div>

      {/* 2. Khung Card chính chi tiết chiến dịch */}
      <Card className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs sm:p-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <RotateCcw className="size-6 animate-spin text-blue-600" />
            <p className="mt-3 text-xs font-medium">Đang tải thông tin chiến dịch...</p>
          </div>
        ) : !campaign ? (
          <div className="py-14 text-center text-slate-400">
            <FileText className="mx-auto size-10 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">Không tìm thấy thông tin chiến dịch</p>
            <p className="mt-1 text-xs">Chiến dịch này có thể đã bị xóa hoặc không tồn tại.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (onBack) onBack();
                else router.push("/groups/campaigns");
              }}
              className="mt-4 text-xs"
            >
              Trở về danh sách
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Header trong Card: Tên chiến dịch, Ngày chạy & Badge số lượng nick đã chọn */}
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div>
                <h2 className="font-heading text-xl font-bold tracking-tight text-slate-900">
                  {campaign.name}
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  Ngày chạy: <span className="font-medium text-slate-600">{formatDateOnly(campaign.last_run_at || campaign.created_at || details[0]?.created_at)}</span>
                </p>
              </div>

              <div>
                <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-600 border border-emerald-100/80">
                  {new Set(details.map((item) => item.account_uid)).size || details.length || 0} nick đã chọn
                </span>
              </div>
            </div>

            {/* Tiêu đề danh sách tài khoản */}
            <div className="flex items-center justify-between border-t border-slate-100 pt-5">
              <h3 className="text-sm font-bold text-slate-900">Danh sách tài khoản</h3>
              <span className="text-xs text-slate-400 font-normal">Cuộn để xem thêm</span>
            </div>

            {/* Danh sách thẻ tác vụ của từng tài khoản */}
            <div className="max-h-[500px] space-y-3 overflow-y-auto pr-1">
              {details.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-400">
                  Chưa có dữ liệu tác vụ nào được lưu lại cho chiến dịch này.
                </div>
              ) : (
                details.map((item, idx) => {
                  const itemUrl = item.result_url || item.group_url;

                  return (
                    <div
                      key={item.id || idx}
                      className="rounded-xl border border-slate-200/90 bg-white p-4 transition-all hover:border-slate-300 hover:shadow-2xs"
                    >
                      {/* Dòng 1: STT & Nút Copy UID */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-900">
                          STT {item.stt || idx + 1}
                        </span>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopyUid(item.account_uid)}
                          className="h-7 gap-1.5 rounded-lg border-slate-200 bg-white px-2.5 text-[11px] font-medium text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-blue-600 cursor-pointer"
                        >
                          <Copy className="size-3 text-slate-400" />
                          Copy UID
                        </Button>
                      </div>

                      {/* Dòng 2 & 3: Tài khoản (UID) & Tên nhóm */}
                      <div className="mt-2 space-y-1 text-xs text-slate-600">
                        <p>
                          <span className="text-slate-500 font-normal">Tài khoản (UID):</span>{" "}
                          <span className="font-mono font-medium text-slate-800">{item.account_uid}</span>
                          {item.account_name ? ` (${item.account_name})` : ""}
                        </p>
                        <p>
                          <span className="text-slate-500 font-normal">Tên nhóm:</span>{" "}
                          <span className="font-medium text-slate-800">{item.group_name || "Nhóm Facebook"}</span>
                        </p>
                      </div>

                      {/* Dòng 4: Link bài viết kèm nút Mở bài viết */}
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
                        <span className="truncate font-mono text-[11px] text-blue-600 hover:underline max-w-[75%]">
                          {itemUrl || "https://facebook.com/groups/..."}
                        </span>

                        {itemUrl ? (
                          <a
                            href={itemUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                          >
                            <span>Mở bài viết</span>
                            <ExternalLink className="size-3.5" />
                          </a>
                        ) : (
                          <span className="text-[11px] italic text-slate-400">Chưa có liên kết</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Dòng chú thích bên dưới */}
            <p className="text-xs text-slate-400 font-normal">
              Trong sản phẩm thật, mỗi UID phải hiển thị tất cả các nhóm và link bài viết được lưu của tài khoản đó. Link hợp lệ sẽ mở trong trình duyệt.
            </p>

            {/* Nút to dưới cùng: Chạy lại chiến dịch này */}
            <div className="pt-2">
              <Button
                type="button"
                onClick={handleRerun}
                disabled={rerunLoading}
                className="h-11 w-full gap-2 rounded-xl bg-blue-600 text-sm font-semibold text-white shadow-xs hover:bg-blue-700 active:scale-[0.99] transition-all cursor-pointer"
              >
                <RotateCcw className={`size-4 ${rerunLoading ? "animate-spin" : ""}`} />
                {rerunLoading ? "Đang nạp cấu hình..." : "Chạy lại chiến dịch này"}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
