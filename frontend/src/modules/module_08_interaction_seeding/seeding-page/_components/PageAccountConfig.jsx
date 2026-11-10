import React, { useMemo } from "react";
import { Users, Info, Clock, UserCheck, AlertCircle } from "lucide-react";

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
  onOpenAccountModal,
  selectedUids = [],
  isRunning = false,
}) {
  const delayErrorMessage = useMemo(() => {
    if (
      minDelay === "" ||
      minDelay === null ||
      minDelay === undefined ||
      maxDelay === "" ||
      maxDelay === null ||
      maxDelay === undefined
    ) {
      return "Vui lòng nhập đầy đủ khoảng thời gian nghỉ tối thiểu và tối đa.";
    }
    const minVal = Number(minDelay);
    const maxVal = Number(maxDelay);
    if (minVal < 1) {
      return "Thời gian tối thiểu phải từ 1 giây trở lên.";
    }
    if (maxVal > 3600) {
      return "Thời gian tối đa chỉ được nhập tối đa đến 3600 giây (1 giờ).";
    }
    if (maxVal <= minVal) {
      return `Thời gian tối đa (${maxVal}s) luôn phải lớn hơn thời gian tối thiểu (${minVal}s).`;
    }
    return "";
  }, [minDelay, maxDelay]);

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
              onClick={() => {
                if (isRunning || availableAccounts === 0) return;
                onOpenAccountModal?.();
              }}
              disabled={isRunning || availableAccounts === 0}
              title={
                isRunning
                  ? "Đang chạy seeding, không thể thay đổi tài khoản"
                  : availableAccounts === 0
                  ? "Không có tài khoản khả dụng"
                  : "Bấm để chọn danh sách tài khoản tham gia seeding"
              }
              className={`inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm ${
                isRunning || availableAccounts === 0
                  ? "bg-slate-200 text-slate-400 border border-slate-300/80 cursor-not-allowed shadow-none select-none"
                  : "bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20 active:scale-[0.98] cursor-pointer"
              }`}
            >
              <UserCheck className={`w-4 h-4 ${isRunning || availableAccounts === 0 ? "text-slate-400" : "text-white"}`} />
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
            <label className="text-xs font-semibold text-gray-700 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-blue-600" />
                <span>Thời gian nghỉ giữa 2 lần tương tác (giây)</span>
              </span>
              <span className="text-[11px] text-gray-400 font-normal">Tối đa: 3600s</span>
            </label>
            <div className="flex items-center gap-3">
              <div className="flex-1 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={3599}
                  value={minDelay}
                  disabled={isRunning}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "") {
                      onMinDelayChange("");
                    } else {
                      let num = Number(val);
                      if (num > 3599) num = 3599;
                      if (num < 1) num = 1;
                      onMinDelayChange(num);
                    }
                  }}
                  className={`w-full text-center text-sm font-bold py-1.5 px-2 rounded-lg border transition-all ${
                    isRunning
                      ? "border-gray-200 bg-gray-100/70 text-gray-400 cursor-not-allowed select-none"
                      : delayErrorMessage
                      ? "border-rose-400 bg-rose-50/20 text-rose-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                      : "border-gray-200 bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  }`}
                  placeholder="30"
                />
              </div>

              <span className="text-gray-400 font-bold">-</span>

              <div className="flex-1 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={3600}
                  value={maxDelay}
                  disabled={isRunning}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "") {
                      onMaxDelayChange("");
                    } else {
                      let num = Number(val);
                      if (num > 3600) num = 3600;
                      if (num < 1) num = 1;
                      onMaxDelayChange(num);
                    }
                  }}
                  className={`w-full text-center text-sm font-bold py-1.5 px-2 rounded-lg border transition-all ${
                    isRunning
                      ? "border-gray-200 bg-gray-100/70 text-gray-400 cursor-not-allowed select-none"
                      : delayErrorMessage
                      ? "border-rose-400 bg-rose-50/20 text-rose-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                      : "border-gray-200 bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  }`}
                  placeholder="60"
                />
              </div>
            </div>

            {/* Message cảnh báo lỗi thiết lập thời gian */}
            {delayErrorMessage && (
              <p className="flex items-center gap-1.5 text-rose-600 text-xs font-medium mt-1.5 animate-in fade-in slide-in-from-top-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-500" />
                <span>{delayErrorMessage}</span>
              </p>
            )}
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
