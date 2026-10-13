"use client";

import React from "react";
import { ClipboardList, BarChart2, Lightbulb, Check, Shield } from "lucide-react";
import { SeedingTargetItem } from "@/types/seeding";

interface PostSummaryCardsProps {
  targets: SeedingTargetItem[];
  accountCount: number;
  doLike: boolean;
  doComment: boolean;
  doShare: boolean;
  selectedReactions: string[];
  minDelay: number;
  maxDelay: number;
}

export default function PostSummaryCards({
  targets,
  accountCount,
  doLike,
  doComment,
  doShare,
  selectedReactions,
  minDelay,
  maxDelay,
}: PostSummaryCardsProps) {
  const targetCount = targets.length;
  const totalInteractions = targetCount * accountCount;

  // Estimation counts
  const reactPerPost = doLike ? accountCount : 0;
  const commentPerPost = doComment ? accountCount : 0;
  const sharePerPost = doShare ? accountCount : 0;

  const totalReacts = targetCount * reactPerPost;
  const totalComments = targetCount * commentPerPost;
  const totalShares = targetCount * sharePerPost;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      {/* Card 1: Tóm tắt cấu hình */}
      <div className="bg-white rounded-2xl border border-gray-200/90 shadow-sm overflow-hidden flex flex-col">
        <div className="bg-[#2563EB] text-white px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4" />
            <h3 className="text-xs font-bold tracking-wide">Tóm tắt cấu hình</h3>
          </div>
          <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full font-medium">
            Bài viết
          </span>
        </div>

        <div className="p-5 space-y-3 text-xs text-gray-700 font-medium flex-1">
          <div className="flex justify-between items-center py-1 border-b border-gray-100">
            <span className="text-gray-500">Số bài viết</span>
            <strong className="text-gray-900 font-bold">{targetCount} bài</strong>
          </div>

          <div className="flex justify-between items-center py-1 border-b border-gray-100">
            <span className="text-gray-500">Số tài khoản</span>
            <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-bold">
              {accountCount} tài khoản
            </span>
          </div>

          <div className="flex justify-between items-center py-1 border-b border-gray-100">
            <span className="text-gray-500">Loại tương tác</span>
            <div className="flex flex-wrap gap-1 justify-end">
              {doLike && (
                <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200">
                  Cảm xúc
                </span>
              )}
              {doComment && (
                <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-200">
                  Bình luận
                </span>
              )}
              {doShare && (
                <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 text-[10px] font-bold border border-purple-200">
                  Chia sẻ
                </span>
              )}
            </div>
          </div>

          {doLike && (
            <div className="flex justify-between items-center py-1 border-b border-gray-100">
              <span className="text-gray-500">Cảm xúc Facebook</span>
              <span className="font-bold text-gray-800">
                {selectedReactions.length} cảm xúc
              </span>
            </div>
          )}

          <div className="flex justify-between items-center py-1 border-b border-gray-100">
            <span className="text-gray-500">Thời gian nghỉ</span>
            <strong className="text-gray-900 font-bold">{minDelay} – {maxDelay} giây</strong>
          </div>

          <div className="flex justify-between items-center py-1">
            <span className="text-gray-500">Số lượng mỗi bài</span>
            <span className="text-emerald-600 font-bold">
              {accountCount} tài khoản chạy
            </span>
          </div>
        </div>
      </div>

      {/* Card 2: Phân bổ lượt (dự kiến) */}
      <div className="bg-white rounded-2xl border border-gray-200/90 shadow-sm p-5 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-3">
            <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs">
              <span className="p-1 rounded-md bg-emerald-100 text-emerald-600">
                <BarChart2 className="w-3.5 h-3.5" />
              </span>
              <span>Phân bổ lượt (dự kiến)</span>
            </div>
            <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-semibold">
              Đã cân bằng
            </span>
          </div>

          {/* Container hiển thị 5 mục, nếu > 5 mục thì có scrollbar cuộn xuống */}
          <div className="overflow-y-auto max-h-[195px] pr-1">
            <table className="w-full text-center text-xs border-collapse">
              <thead className="sticky top-0 bg-white z-10">
                <tr className="text-gray-500 text-[11px] border-b border-gray-100 bg-gray-50/90 font-semibold">
                  <th className="py-2 px-2 text-left bg-white">Tên hiển thị</th>
                  <th className="py-2 px-2 text-blue-600 bg-white">Cảm xúc</th>
                  <th className="py-2 px-2 text-emerald-600 bg-white">Bình luận</th>
                  <th className="py-2 px-2 text-purple-600 bg-white">Chia sẻ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700 font-medium">
                {targets.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-gray-400 text-xs">
                      Chưa có bài viết nào
                    </td>
                  </tr>
                ) : (
                  targets.map((t, idx) => (
                    <tr key={idx} className="hover:bg-gray-50/50">
                      <td
                        className="py-2 px-2 text-left font-bold text-gray-900 truncate max-w-[140px]"
                        title={t.display_name || (t.fb_id ? `Bài viết ${t.fb_id}` : `Bài viết ${idx + 1}`)}
                      >
                        {t.display_name || (t.fb_id ? `Bài viết ${t.fb_id}` : `Bài viết ${idx + 1}`)}
                      </td>
                      <td className="py-2 px-2 font-semibold">{doLike ? reactPerPost : 0}</td>
                      <td className="py-2 px-2 font-semibold">{commentPerPost}</td>
                      <td className="py-2 px-2 font-semibold">{sharePerPost}</td>
                    </tr>
                  ))
                )}
                {targets.length > 0 && (
                  <tr className="bg-gray-50/80 font-bold text-gray-900 border-t border-gray-200">
                    <td className="py-2 px-2 text-left">Tổng</td>
                    <td className="py-2 px-2 text-blue-700">{totalReacts}</td>
                    <td className="py-2 px-2 text-emerald-700">{totalComments}</td>
                    <td className="py-2 px-2 text-purple-700">{totalShares}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Card 3: Lưu ý quan trọng */}
      <div className="bg-[#FFFDF9] rounded-2xl border border-amber-200/90 shadow-sm p-5 flex flex-col justify-between">
        <div>
          {/* Header */}
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-xs">
              <Lightbulb className="w-4 h-4 fill-white/20 stroke-[2.2]" />
            </div>
            <h3 className="text-sm font-bold text-amber-950">Lưu ý quan trọng</h3>
          </div>

          {/* List */}
          <div className="space-y-3.5 text-xs text-gray-700 leading-relaxed font-normal">
            <div className="flex items-start gap-2.5">
              <div className="w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center shrink-0 mt-0.5">
                <Check className="w-2.5 h-2.5 text-white stroke-[3]" />
              </div>
              <p>
                Tổng số lượt tương tác bằng tổng số tài khoản khả dụng ({accountCount || 50}).
              </p>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center shrink-0 mt-0.5">
                <Check className="w-2.5 h-2.5 text-white stroke-[3]" />
              </div>
              <p>
                Mỗi tài khoản chỉ thực hiện <strong className="font-semibold text-gray-900">1 lần</strong> cho mỗi loại tương tác trên mỗi bài viết.
              </p>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center shrink-0 mt-0.5">
                <Check className="w-2.5 h-2.5 text-white stroke-[3]" />
              </div>
              <p>
                Hệ thống{" "}
                <span className="text-blue-600 font-medium">
                  tự động random phân bổ
                </span>{" "}
                50 cảm xúc thì 25 bình luận, và 50 chia cho số bài viết cần chia sẻ ví dụ 50:4
              </p>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center shrink-0 mt-0.5">
                <Check className="w-2.5 h-2.5 text-white stroke-[3]" />
              </div>
              <p>
                Nên thiết lập thời gian nghỉ từ{" "}
                <span className="text-blue-600 font-medium">
                  30 – 60
                </span>{" "}
                giây để hạn chế checkpoint và an toàn nhất.
              </p>
            </div>
          </div>
        </div>

        {/* Bottom Banner */}
        <div className="mt-5 p-3.5 bg-white rounded-xl border border-amber-200/90 flex items-center gap-3">
          <Shield className="w-4 h-4 text-amber-700 shrink-0 fill-amber-500/20" />
          <p className="text-xs font-semibold text-amber-900 leading-snug">
            Đã bật cơ chế tự giãn cách thời gian ngẫu nhiên.
          </p>
        </div>
      </div>
    </div>
  );
}
