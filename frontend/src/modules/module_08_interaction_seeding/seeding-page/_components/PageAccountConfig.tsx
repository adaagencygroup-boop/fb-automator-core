import React from "react";
import { Users, Info, Clock } from "lucide-react";

interface PageAccountConfigProps {
  accountCount: number;
  onAccountCountChange: (val: number) => void;
  availableAccounts?: number;
  liveAccounts?: number;
  totalAccounts?: number;
  minDelay: number;
  maxDelay: number;
  onMinDelayChange: (val: number) => void;
  onMaxDelayChange: (val: number) => void;
}

export default function PageAccountConfig({
  accountCount,
  onAccountCountChange,
  availableAccounts = 0,
  liveAccounts = 0,
  totalAccounts = 0,
  minDelay,
  maxDelay,
  onMinDelayChange,
  onMaxDelayChange,
}: PageAccountConfigProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
      {/* Step 2: Số lượng tài khoản sử dụng */}
      <div className="bg-white rounded-2xl border border-gray-200/90 shadow-sm p-6 flex flex-col justify-between space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <span className="w-6 h-6 rounded-full bg-rose-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
            2
          </span>
          <h2 className="text-base font-bold text-gray-900">
            Số lượng tài khoản sử dụng
          </h2>
        </div>

        {/* Content */}
        <div className="space-y-3.5 flex-1 flex flex-col justify-center">
          <div className="flex items-center justify-between gap-3 bg-gray-50/70 p-3 rounded-xl border border-gray-100">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-700">
              <Users className="w-4 h-4 text-blue-600" />
              <span>Số lượng tài khoản</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={availableAccounts > 0 ? 1 : 0}
                max={Math.max(1, availableAccounts)}
                value={availableAccounts === 0 ? 0 : accountCount}
                onChange={(e) =>
                  onAccountCountChange(
                    Math.max(1, Math.min(Number(e.target.value) || 1, availableAccounts || 1))
                  )
                }
                disabled={availableAccounts === 0}
                className="w-20 text-center text-sm font-bold py-1.5 px-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-gray-800 bg-white disabled:bg-gray-100 disabled:text-gray-400"
              />
              <span className="text-xs text-gray-500 font-medium">
                / {availableAccounts} khả dụng
              </span>
            </div>
          </div>

          {/* Total Account Pills */}
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-medium border w-full justify-center ${
                liveAccounts > 0
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200/60"
                  : "bg-amber-50 text-amber-700 border-amber-200/60"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  liveAccounts > 0 ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
                }`}
              />
              Tổng tài khoản hiện có: <strong className="font-bold">{totalAccounts}</strong> ({" "}
              <strong className={liveAccounts > 0 ? "text-emerald-800" : "text-amber-800"}>
                {liveAccounts} Live & Đã đăng nhập
              </strong>{" "}
              )
            </span>
          </div>
        </div>

        {/* Info box */}
        <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-100 flex items-start gap-2.5 text-xs text-blue-900 leading-relaxed mt-auto">
          <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-blue-950">Tổng lượt Follow tối đa = Số tài khoản</p>
            <p className="text-blue-800/90 mt-0.5">
              Ví dụ: {accountCount} tài khoản → tối đa {accountCount} Follow Page (mỗi tài khoản chỉ thực hiện 1 lần Follow cho mỗi Page).
            </p>
          </div>
        </div>
      </div>

      {/* Step 3: Thiết lập thời gian */}
      <div className="bg-white rounded-2xl border border-gray-200/90 shadow-sm p-6 flex flex-col justify-between space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <span className="w-6 h-6 rounded-full bg-rose-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
            3
          </span>
          <h2 className="text-base font-bold text-gray-900">
            Thiết lập thời gian
          </h2>
        </div>

        {/* Content */}
        <div className="space-y-3.5 flex-1 flex flex-col justify-center">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-blue-600" />
              <span>Thời gian nghỉ giữa 2 lần tương tác (giây)</span>
            </label>
            <div className="flex items-center gap-3">
              <div className="flex-1 relative">
                <input
                  type="number"
                  min={1}
                  value={minDelay}
                  onChange={(e) => onMinDelayChange(Number(e.target.value) || 1)}
                  className="w-full text-center text-sm font-semibold py-2 px-3 rounded-xl border border-gray-200 bg-gray-50/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-gray-800"
                  placeholder="30"
                />
                <span className="absolute right-3 top-2.5 text-[11px] text-gray-400 font-medium">giây</span>
              </div>
              <span className="text-gray-400 font-bold">-</span>
              <div className="flex-1 relative">
                <input
                  type="number"
                  min={minDelay}
                  value={maxDelay}
                  onChange={(e) => onMaxDelayChange(Number(e.target.value) || minDelay)}
                  className="w-full text-center text-sm font-semibold py-2 px-3 rounded-xl border border-gray-200 bg-gray-50/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-gray-800"
                  placeholder="60"
                />
                <span className="absolute right-3 top-2.5 text-[11px] text-gray-400 font-medium">giây</span>
              </div>
            </div>
          </div>
        </div>

        {/* Info box */}
        <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-100 flex items-start gap-2.5 text-xs text-amber-900 leading-relaxed mt-auto">
          <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-amber-950">Giãn cách an toàn cho tài khoản</p>
            <p className="text-amber-800/90 mt-0.5">
              Thời gian nghỉ ngẫu nhiên ({minDelay}s – {maxDelay}s) giữa mỗi lần tương tác giúp mô phỏng thao tác người dùng thật, tránh bị hạn chế tính năng Facebook.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
