import React from "react";
import { Users, Info, Clock, UserCheck } from "lucide-react";

export default function PostAccountConfig({
  accountCount,
  onAccountCountChange,
  availableAccounts = 0,
  liveAccounts = 0,
  totalAccounts = 0,
  minDelay,
  maxDelay,
  onMinDelayChange,
  onMaxDelayChange,
  selectedReactionsCount,
  doLike,
  doComment,
  doShare,
  onOpenAccountModal,
  selectedUids = [],
  isRunning = false,
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
      {/* Step 4: Số lượng tài khoản sử dụng */}
      <div className="bg-white rounded-2xl border border-gray-200/90 shadow-sm p-6 flex flex-col justify-between space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <span className="w-6 h-6 rounded-full bg-rose-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
            {doComment ? "4" : "3"}
          </span>
          <h2 className="text-base font-bold text-gray-900">
            Số lượng tài khoản sử dụng
          </h2>
        </div>

        {/* Content */}
        <div className="space-y-3.5 flex-1 flex flex-col justify-center">
          <div className="flex items-center justify-between gap-3 bg-gray-50/70 p-3.5 rounded-xl border border-gray-100">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-700">
              <Users className="w-4 h-4 text-blue-600" />
              <span>Số tài khoản chạy:</span>
              <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 font-bold text-xs">
                {accountCount} tài khoản
              </span>
            </div>

            <button
              type="button"
              onClick={onOpenAccountModal}
              disabled={isRunning || availableAccounts === 0}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm shadow-blue-500/20 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <UserCheck className="w-4 h-4" />
              Chọn tài khoản ({accountCount})
            </button>
          </div>

          {availableAccounts > 0 && accountCount > 0 && (
            <p className="text-[11px] text-gray-500 px-1 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
              <span>
                {selectedUids && selectedUids.length > 0
                  ? `Đã tích chọn chính xác ${selectedUids.length} tài khoản để tham gia chiến dịch seeding.`
                  : `Chạy ${accountCount} tài khoản khả dụng đã chọn.`}
              </span>
            </p>
          )}
        </div>

        {/* Info box */}
        <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-100 flex items-start gap-2.5 text-xs text-blue-900 leading-relaxed mt-auto">
          <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-blue-950">Mỗi tài khoản:</p>
            <ul className="text-blue-800/90 mt-1 space-y-0.5 list-disc list-inside">
              {doLike && (
                <li>1 Cảm xúc (ngẫu nhiên 1 trong {selectedReactionsCount} loại đã chọn)</li>
              )}
              {doComment && <li>1 Bình luận (ngẫu nhiên từ danh sách)</li>}
              {doShare && <li>1 Chia sẻ</li>}
              {!doLike && !doComment && !doShare && (
                <li className="italic text-gray-500">Chưa chọn hành động tương tác nào</li>
              )}
            </ul>
          </div>
        </div>
      </div>

      {/* Step 5: Thiết lập thời gian */}
      <div className="bg-white rounded-2xl border border-gray-200/90 shadow-sm p-6 flex flex-col justify-between space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <span className="w-6 h-6 rounded-full bg-rose-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
            {doComment ? "5" : "4"}
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
              <div className="flex-1 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={minDelay}
                  onChange={(e) => {
                    const val = e.target.value;
                    onMinDelayChange(val === "" ? "" : Math.max(1, Number(val)));
                  }}
                  className="w-full text-center text-sm font-bold py-1.5 px-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-gray-800 bg-white"
                  placeholder="30"
                />
              </div>

              <span className="text-gray-400 font-bold">-</span>

              <div className="flex-1 flex items-center gap-2">
                <input
                  type="number"
                  min={minDelay || 1}
                  value={maxDelay}
                  onChange={(e) => {
                    const val = e.target.value;
                    onMaxDelayChange(val === "" ? "" : Math.max(Number(minDelay || 1), Number(val)));
                  }}
                  className="w-full text-center text-sm font-bold py-1.5 px-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-gray-800 bg-white"
                  placeholder="60"
                />
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
