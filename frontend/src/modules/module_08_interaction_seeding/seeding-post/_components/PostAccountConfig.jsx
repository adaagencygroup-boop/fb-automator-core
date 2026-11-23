"use client";

import React, { useMemo } from "react";
import { AlertCircle, Info, Network, Repeat, Users } from "lucide-react";
import {
  DISTRIBUTION_ALL,
  DISTRIBUTION_ROTATION,
  MAX_POSTS_PER_ACCOUNT,
  planTotals,
  rotationPlan,
} from "../runPlan.mjs";
import StepCard from "./StepCard";

const fmt = (n) => Number(n || 0).toLocaleString("vi-VN");
const NUM_INPUT =
  "h-10 rounded-xl border border-slate-200 bg-white px-3 text-center text-sm font-semibold text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";

function rangeText(ranges) {
  const shown = ranges.slice(0, 2).map(([a, b]) => (a === b ? `${fmt(a)}` : `${fmt(a)}–${fmt(b)}`));
  return shown.join(", ") + (ranges.length > 2 ? ", …" : "");
}

export default function PostAccountConfig({
  accountStep = 4,
  timeStep = 5,
  accountCount,
  availableAccounts = 0,
  liveOnlyAccounts = 0,
  totalAccounts = 0,
  targetCount = 0,
  minDelay,
  maxDelay,
  onMinDelayChange,
  onMaxDelayChange,
  doLike,
  doComment,
  doShare,
  onOpenAccountModal,
  isRunning = false,
  distributionMode = DISTRIBUTION_ROTATION,
  onDistributionModeChange = () => {},
  postsPerAccount = 50,
  onPostsPerAccountChange = () => {},
  threads = 2,
  onThreadsChange = () => {},
  startMode = "now",
  onStartModeChange = () => {},
  startAt = "",
  onStartAtChange = () => {},
  spreadEnabled = false,
  onSpreadEnabledChange = () => {},
  spreadHours = 3,
  onSpreadHoursChange = () => {},
}) {
  const rotation = distributionMode === DISTRIBUTION_ROTATION;
  const canPick = !isRunning && availableAccounts > 0;

  const delayErrorMessage = useMemo(() => {
    if (minDelay === "" || minDelay == null || maxDelay === "" || maxDelay == null) {
      return "Vui lòng nhập đầy đủ khoảng thời gian nghỉ tối thiểu và tối đa.";
    }
    const minVal = Number(minDelay);
    const maxVal = Number(maxDelay);
    if (minVal < 1) return "Thời gian tối thiểu phải từ 1 giây trở lên.";
    if (maxVal > 3600) return "Thời gian tối đa chỉ được nhập tối đa đến 3600 giây (1 giờ).";
    if (maxVal <= minVal) return `Thời gian tối đa (${maxVal}s) luôn phải lớn hơn thời gian tối thiểu (${minVal}s).`;
    return "";
  }, [minDelay, maxDelay]);

  const totals = planTotals({ accountCount, targetCount, doLike, doComment, doShare, mode: distributionMode });
  const plan = rotation ? rotationPlan({ accountCount, targetCount, perAccount: postsPerAccount }) : null;
  const perAccountInvalid =
    rotation && (!Number.isInteger(Number(postsPerAccount)) || postsPerAccount < 1 || postsPerAccount > MAX_POSTS_PER_ACCOUNT);
  const noAction = !doLike && !doComment && !doShare;

  return (
    <>
      {/* Bước: Số lượng tài khoản sử dụng */}
      <StepCard step={accountStep} title="Số lượng tài khoản sử dụng">
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
              <span className="flex items-center gap-2 font-medium">
                <Network className="size-4 text-blue-600" aria-hidden="true" />
                Số lượng tài khoản
              </span>
              <button
                type="button"
                onClick={() => canPick && onOpenAccountModal?.()}
                disabled={!canPick}
                title={
                  isRunning
                    ? "Đang chạy seeding, không thể thay đổi tài khoản"
                    : availableAccounts === 0
                      ? "Không có tài khoản khả dụng"
                      : "Bấm để chọn tài khoản tham gia seeding"
                }
                className="h-10 w-20 rounded-xl border border-slate-200 bg-white text-center text-sm font-semibold text-slate-800 hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              >
                {fmt(accountCount)}
              </button>
              <span className="text-slate-500">/ {fmt(availableAccounts)} khả dụng</span>
              <button
                type="button"
                onClick={() => canPick && onOpenAccountModal?.()}
                disabled={!canPick}
                className="text-xs font-semibold text-blue-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
              >
                Chọn tài khoản
              </button>
            </div>

            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
              <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
              Tổng tài khoản hiện có: <b className="text-slate-900">{fmt(totalAccounts)}</b>
              <span>
                (<span className="font-semibold text-emerald-600">{fmt(liveOnlyAccounts)} Live</span>)
              </span>
            </span>

            <div className="space-y-2">
              <span className="block text-xs font-semibold text-slate-700">Cách chia lượt</span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="Cách chia lượt">
                {[
                  { id: DISTRIBUTION_ROTATION, Icon: Repeat, title: "Xoay vòng", desc: "Mỗi tài khoản 1 khối bài, mỗi bài 1 tài khoản" },
                  { id: DISTRIBUTION_ALL, Icon: Users, title: "Mọi tài khoản trên mọi bài", desc: "Dồn nhiều lượt vào ít bài" },
                ].map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={distributionMode === o.id}
                    disabled={isRunning}
                    onClick={() => onDistributionModeChange(o.id)}
                    className={`flex items-start gap-2.5 rounded-xl border-2 p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      distributionMode === o.id ? "border-blue-500 bg-blue-50/40" : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <o.Icon className={`mt-0.5 size-4 shrink-0 ${distributionMode === o.id ? "text-blue-600" : "text-slate-400"}`} aria-hidden="true" />
                    <span>
                      <span className="block text-xs font-bold text-slate-900">{o.title}</span>
                      <span className="block text-[11px] text-slate-500">{o.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {rotation && (
              <div className="space-y-1.5">
                <label className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
                  <span className="font-medium">Số bài mỗi tài khoản</span>
                  <input
                    type="number"
                    min={1}
                    max={MAX_POSTS_PER_ACCOUNT}
                    step={1}
                    value={postsPerAccount}
                    disabled={isRunning}
                    onChange={(e) => {
                      const v = e.target.value;
                      onPostsPerAccountChange(v === "" ? "" : Math.floor(Number(v)));
                    }}
                    className={`${NUM_INPUT} w-24 ${perAccountInvalid ? "border-rose-400 bg-rose-50/30" : ""}`}
                  />
                  <span className="text-slate-500">bài</span>
                </label>
                <p className="text-[11px] text-slate-500">
                  Tài khoản 1 làm {fmt(postsPerAccount || 0)} bài đầu, tài khoản 2 làm {fmt(postsPerAccount || 0)} bài tiếp theo…
                  hết tài khoản thì quay lại tài khoản 1.
                </p>
                {perAccountInvalid && (
                  <p className="flex items-center gap-1.5 text-xs font-medium text-rose-600">
                    <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                    Số bài mỗi tài khoản phải từ 1 đến {fmt(MAX_POSTS_PER_ACCOUNT)}.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Khung thông tin bên phải */}
          <div className="flex items-start gap-2.5 rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-xs leading-relaxed text-slate-700">
            <Info className="mt-0.5 size-4 shrink-0 text-blue-600" aria-hidden="true" />
            <div className="min-w-0 space-y-1">
              <p className="font-bold text-slate-900">Với {fmt(accountCount)} tài khoản:</p>
              {noAction ? (
                <p className="italic text-slate-500">Chưa chọn loại tương tác nào.</p>
              ) : rotation ? (
                <ul className="space-y-0.5">
                  <li>
                    - Mỗi bài 1 tài khoản làm{" "}
                    {[doLike && "1 cảm xúc", doComment && "1 bình luận", doShare && "1 chia sẻ"].filter(Boolean).join(", ")}
                  </li>
                  <li>
                    - Mỗi tài khoản nhận <b className="text-blue-600">{fmt(plan?.perAccount)}</b> bài liên tiếp, xoay vòng
                    {targetCount ? ` hết ${fmt(targetCount)} bài (${fmt(plan?.blocks)} khối)` : ""}
                  </li>
                  {plan?.accounts
                    .filter((a) => a.posts > 0)
                    .slice(0, 3)
                    .map((a) => (
                      <li key={a.index}>
                        - Tài khoản {a.index + 1}: {fmt(a.posts)} bài (bài {rangeText(a.ranges)})
                      </li>
                    ))}
                  {plan && plan.activeAccounts > 3 && <li>- … và {fmt(plan.activeAccounts - 3)} tài khoản khác</li>}
                  {plan && targetCount > 0 && plan.activeAccounts < accountCount && (
                    <li className="text-amber-700">
                      - Chỉ {fmt(plan.activeAccounts)} / {fmt(accountCount)} tài khoản có việc (ít bài hơn số khối).
                    </li>
                  )}
                </ul>
              ) : (
                <ul className="space-y-0.5">
                  {doLike && (
                    <li>
                      - Tối đa <b className="text-blue-600">{fmt(totals.react)}</b> Cảm xúc mỗi bài (mỗi tài khoản 1 lần cho 1 bài viết)
                    </li>
                  )}
                  {doComment && (
                    <li>
                      - Tối đa <b className="text-blue-600">{fmt(totals.comment)}</b> Bình luận mỗi bài
                    </li>
                  )}
                  {doShare && (
                    <li>
                      - Tổng <b className="text-blue-600">{fmt(totals.totalShares || accountCount)}</b> Chia sẻ, chia cho các bài
                    </li>
                  )}
                </ul>
              )}
            </div>
          </div>
        </div>
      </StepCard>

      {/* Bước: Thiết lập thời gian */}
      <StepCard step={timeStep} title="Thiết lập thời gian">
        <div className="space-y-2">
          <label className="block text-sm text-slate-700" htmlFor="seeding-delay-min">
            Thời gian nghỉ giữa 2 lần tương tác (giây)
          </label>
          <div className="flex items-center gap-3">
            <input
              id="seeding-delay-min"
              type="number"
              min={1}
              max={3599}
              value={minDelay}
              disabled={isRunning}
              aria-label="Thời gian nghỉ tối thiểu (giây)"
              onChange={(e) => {
                const val = e.target.value;
                if (val === "") onMinDelayChange("");
                else onMinDelayChange(Math.min(3599, Math.max(1, Number(val))));
              }}
              className={`${NUM_INPUT} w-full flex-1 ${delayErrorMessage ? "border-rose-400 bg-rose-50/30" : ""}`}
              placeholder="30"
            />
            <span className="font-bold text-slate-400">-</span>
            <input
              type="number"
              min={1}
              max={3600}
              value={maxDelay}
              disabled={isRunning}
              aria-label="Thời gian nghỉ tối đa (giây)"
              onChange={(e) => {
                const val = e.target.value;
                if (val === "") onMaxDelayChange("");
                else onMaxDelayChange(Math.min(3600, Math.max(1, Number(val))));
              }}
              className={`${NUM_INPUT} w-full flex-1 ${delayErrorMessage ? "border-rose-400 bg-rose-50/30" : ""}`}
              placeholder="60"
            />
          </div>
          {delayErrorMessage && (
            <p className="flex items-center gap-1.5 text-xs font-medium text-rose-600">
              <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{delayErrorMessage}</span>
            </p>
          )}
        </div>

        {/* Tốc độ & thời điểm chạy */}
        <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 text-xs sm:grid-cols-3">
          <label className="flex flex-col gap-1.5 font-semibold text-slate-700">
            Số luồng Chrome song song
            <input
              type="number"
              min={1}
              max={5}
              value={threads}
              disabled={isRunning}
              onChange={(e) => onThreadsChange(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
              className={`${NUM_INPUT} h-9`}
            />
            <span className="font-normal text-[11px] text-slate-500">
              {rotation ? "Số tài khoản chạy khối bài cùng lúc (1 = lần lượt từng tài khoản)." : "Nhiều luồng nhanh hơn nhưng tốn máy hơn (tối đa 5)."}
            </span>
          </label>
          <div className="flex flex-col gap-1.5 font-semibold text-slate-700">
            <span>Bắt đầu</span>
            <div className="flex gap-1.5" role="group" aria-label="Thời điểm bắt đầu">
              {[
                { id: "now", label: "Chạy ngay" },
                { id: "schedule", label: "Hẹn giờ" },
              ].map((o) => (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={startMode === o.id}
                  disabled={isRunning}
                  onClick={() => onStartModeChange(o.id)}
                  className={`h-9 flex-1 rounded-xl border text-xs font-semibold transition-colors disabled:opacity-50 ${
                    startMode === o.id ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {startMode === "schedule" && (
              <input
                type="datetime-local"
                aria-label="Giờ bắt đầu"
                value={startAt}
                disabled={isRunning}
                onChange={(e) => onStartAtChange(e.target.value)}
                className="h-9 rounded-xl border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            )}
          </div>
          <div className="flex flex-col gap-1.5 font-semibold text-slate-700">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={spreadEnabled}
                disabled={isRunning}
                onChange={(e) => onSpreadEnabledChange(e.target.checked)}
                className="size-4 accent-[#2563EB]"
              />
              Rải đều trong
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={spreadHours}
                disabled={isRunning || !spreadEnabled}
                aria-label="Số giờ rải đều"
                onChange={(e) => onSpreadHoursChange(Math.max(0.5, Number(e.target.value) || 0.5))}
                className={`${NUM_INPUT} h-9 w-20`}
              />
              <span className="font-normal">giờ</span>
            </div>
            <span className="font-normal text-[11px] text-slate-500">Tự kéo dài thời gian nghỉ để lượt tăng dần tự nhiên.</span>
          </div>
        </div>
      </StepCard>
    </>
  );
}
