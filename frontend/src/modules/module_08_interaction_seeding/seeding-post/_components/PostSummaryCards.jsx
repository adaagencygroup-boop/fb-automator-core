"use client";

import React from "react";
import { ClipboardList, BarChart2, Info, Lightbulb, CheckCircle2, Check, Shield } from "lucide-react";
import { DEFAULT_POSTS_PER_ACCOUNT } from "../runPlan.mjs";

// Danh sách bài có thể rất dài (lấy từ page): chỉ vẽ N dòng đầu trong bảng phân bổ
const MAX_ROWS = 300;

/**
 * 3 thẻ tóm tắt dưới bước Thời gian — giao diện giống hệt Seeding Page / Seeding Trang cá nhân (PageSummaryCards).
 * Chia xoay vòng: bài thứ i do tài khoản số floor(i / N) mod (số tài khoản) làm.
 */
export default function PostSummaryCards({
  targets,
  accountCount,
  accountNames = [],
  doLike,
  doComment,
  doShare,
  minDelay,
  maxDelay,
  postsPerAccount = DEFAULT_POSTS_PER_ACCOUNT,
}) {
  const targetCount = targets.length;
  const actions = [doLike && "Cảm xúc", doComment && "Bình luận", doShare && "Chia sẻ"].filter(Boolean);
  const estimatedTotal = accountCount > 0 ? targetCount * actions.length : 0;
  const ownerOf = (idx) => {
    if (!accountCount) return "—";
    const k = Math.floor(idx / postsPerAccount) % accountCount;
    return accountNames[k] || `Tài khoản ${k + 1}`;
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      {/* Card 1: Tóm tắt cấu hình */}
      <div className="bg-white rounded-2xl border border-gray-200/90 shadow-sm overflow-hidden flex flex-col">
        <div className="bg-[#2563EB] text-white px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4" />
            <h3 className="text-xs font-bold tracking-wide">Tóm tắt cấu hình</h3>
          </div>
        </div>

        <div className="p-5 space-y-3.5 text-xs text-gray-700 font-medium flex-1">
          <div className="flex justify-between items-center py-1 border-b border-gray-100">
            <span className="text-gray-500">Số bài viết</span>
            <strong className="text-gray-900 font-bold">{targetCount}</strong>
          </div>

          <div className="flex justify-between items-center py-1 border-b border-gray-100">
            <span className="text-gray-500">Số tài khoản sử dụng</span>
            <strong className="text-gray-900 font-bold">{accountCount}</strong>
          </div>

          <div className="flex justify-between items-center gap-2 py-1 border-b border-gray-100">
            <span className="text-gray-500 shrink-0">Loại tương tác</span>
            <span className="flex flex-wrap justify-end gap-1">
              {actions.length ? (
                actions.map((a) => (
                  <span
                    key={a}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-bold text-[11px] border border-emerald-200/60"
                  >
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    {a}
                  </span>
                ))
              ) : (
                <span className="text-gray-400 font-normal">Chưa chọn</span>
              )}
            </span>
          </div>

          <div className="flex justify-between items-center py-1 border-b border-gray-100">
            <span className="text-gray-500">Tổng lượt tối đa</span>
            <div className="text-right">
              <strong className="text-gray-900 font-bold">{estimatedTotal} lượt</strong>
              <div className="text-[10px] text-gray-400 font-normal">
                (mỗi bài 1 tài khoản, mỗi loại 1 lần)
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center py-1">
            <span className="text-gray-500">Nghỉ giữa 2 lần</span>
            <strong className="text-gray-900 font-bold">{minDelay} – {maxDelay} giây</strong>
          </div>
        </div>
      </div>

      {/* Card 2: Phân bổ lượt tương tác (dự kiến) */}
      <div className="bg-white rounded-2xl border border-gray-200/90 shadow-sm p-5 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-3">
            <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs">
              <span className="p-1 rounded-md bg-emerald-100 text-emerald-600">
                <BarChart2 className="w-3.5 h-3.5" />
              </span>
              <span>Phân bổ lượt tương tác (dự kiến)</span>
            </div>
            <Info className="w-3.5 h-3.5 text-gray-400" />
          </div>

          <div className="overflow-y-auto max-h-[195px] pr-1">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-white z-10">
                <tr className="text-gray-400 text-[11px] border-b border-gray-100 bg-white">
                  <th className="py-2 font-normal bg-white">Bài viết</th>
                  <th className="py-2 text-right font-normal bg-white">Tài khoản thực hiện</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 text-gray-800 font-medium">
                {targets.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="py-8 text-center text-gray-400 text-xs">
                      Chưa có bài viết nào được thêm
                    </td>
                  </tr>
                ) : (
                  <>
                    {targets.slice(0, MAX_ROWS).map((t, idx) => (
                      <tr key={t.id ?? idx} className="hover:bg-gray-50/50">
                        <td className="py-2.5 truncate max-w-[140px] font-semibold text-gray-900" title={t.display_name || t.url}>
                          {t.display_name || `Bài viết ${idx + 1}`}
                        </td>
                        <td className="py-2.5 text-right font-bold text-gray-900 truncate max-w-[120px]" title={ownerOf(idx)}>
                          {ownerOf(idx)}
                        </td>
                      </tr>
                    ))}
                    {targets.length > MAX_ROWS && (
                      <tr>
                        <td colSpan={2} className="py-2.5 text-center text-gray-400 text-[11px]">
                          … và {targets.length - MAX_ROWS} bài viết khác
                        </td>
                      </tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Card 3: Lưu ý */}
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
            {[
              "Mỗi bài viết chỉ 1 tài khoản tương tác (theo các loại tương tác đã chọn).",
              `Mỗi tài khoản làm ${postsPerAccount} bài liên tiếp, hết tài khoản thì quay lại tài khoản đầu.`,
              "Nên để thời gian nghỉ từ 30 – 60 giây để an toàn.",
              "Không nên chạy quá nhiều trong thời gian ngắn.",
            ].map((text) => (
              <div key={text} className="flex items-start gap-2.5">
                <div className="w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center shrink-0 mt-0.5">
                  <Check className="w-2.5 h-2.5 text-white stroke-[3]" />
                </div>
                <p>{text}</p>
              </div>
            ))}
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
