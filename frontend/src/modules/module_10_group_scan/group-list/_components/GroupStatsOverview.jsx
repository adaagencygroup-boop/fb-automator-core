"use client";

export default function GroupStatsOverview({ stats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {/* Card 1: Tổng số nhóm */}
      <div className="bg-[#F8FAFC]/70 border border-[#E2E8F0]/80 rounded-xl p-3.5 text-center flex flex-col items-center justify-center gap-1.5 h-[90px]">
        <span className="text-xs font-medium text-[#64748B]">
          Tổng số nhóm
        </span>
        <span className="text-2xl font-bold text-[#0F172A] leading-8">
          {stats.totalGroups}
        </span>
      </div>

      {/* Card 2: Tổng thành viên (Highlighted Blue) */}
      <div className="bg-[#EFF6FF]/60 border border-[#DBEAFE] rounded-xl p-3.5 text-center flex flex-col items-center justify-center gap-1.5 h-[90px]">
        <span className="text-xs font-medium text-[#64748B]">
          Tổng thành viên
        </span>
        <span className="text-2xl font-bold text-[#2563EB] leading-8">
          {stats.totalMembersFormatted}
        </span>
      </div>

      {/* Card 3: Trung bình thành viên / nhóm */}
      <div className="bg-[#F8FAFC]/70 border border-[#E2E8F0]/80 rounded-xl p-3.5 text-center flex flex-col items-center justify-center gap-1.5 h-[90px]">
        <span className="text-xs font-medium text-[#64748B]">
          TB thành viên / nhóm
        </span>
        <span className="text-2xl font-bold text-[#0F172A] leading-8">
          {stats.averageMembersFormatted}
        </span>
      </div>

      {/* Card 4: Nhóm lớn nhất */}
      <div className="bg-[#F8FAFC]/70 border border-[#E2E8F0]/80 rounded-xl p-3.5 text-center flex flex-col items-center justify-center gap-1.5 h-[90px]">
        <span className="text-xs font-medium text-[#64748B]">
          Nhóm lớn nhất (TV)
        </span>
        <span className="text-2xl font-bold text-[#0F172A] leading-8">
          {stats.largestGroupFormatted}
        </span>
      </div>
    </div>
  );
}

