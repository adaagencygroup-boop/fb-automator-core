"use client";

/**
 * Hàng 3 thẻ dưới các bước cấu hình (theo Figma): Tóm tắt cấu hình · Phân bổ lượt (dự kiến) · Lưu ý quan trọng.
 * Số liệu tính cùng công thức với backend (runPlan.mjs), theo cách chia lượt đang chọn.
 */
import React from "react";
import { AlertTriangle, BarChart3, Check, Info, Lightbulb, ListChecks, ShieldCheck } from "lucide-react";
import { CARD } from "./StepCard";
import { DISTRIBUTION_ROTATION, formatDuration, rotationPlan } from "../runPlan.mjs";

const fmt = (n) => Number(n || 0).toLocaleString("vi-VN");
const DIST_ROWS = 8;

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2.5 text-xs last:border-0">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="flex flex-wrap items-center justify-end gap-1.5 text-right font-semibold text-slate-900">{children}</span>
    </div>
  );
}

function fmtStart(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

function SummaryCard({ targetCount, accountCount, doLike, doComment, doShare, reactionCount, rotation, perAccount, delayMin, delayMax, spreadEnabled, spreadHours, threads, startMode, startAt, seconds, blocking }) {
  const actions = [doLike && "Cảm xúc", doComment && "Bình luận", doShare && "Chia sẻ"].filter(Boolean);
  return (
    <div className={`${CARD} overflow-hidden`}>
      <div className="flex items-center justify-between gap-2 bg-blue-600 px-5 py-3.5 text-white">
        <span className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-lg bg-white/20">
            <ListChecks className="size-4" aria-hidden="true" />
          </span>
          <h3 className="text-sm font-bold">Tóm tắt cấu hình</h3>
        </span>
        <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-semibold">{fmt(targetCount)} Bài viết</span>
      </div>
      <div className="px-5 py-2">
        <Row label="Số bài viết">{fmt(targetCount)} bài</Row>
        <Row label="Số tài khoản">
          <span className="rounded-md bg-blue-50 px-2 py-0.5 text-blue-700">{fmt(accountCount)} tài khoản</span>
        </Row>
        <Row label="Loại tương tác">
          {actions.length ? (
            actions.map((a) => (
              <span key={a} className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                <Check className="size-3" aria-hidden="true" /> {a}
              </span>
            ))
          ) : (
            <span className="font-normal text-slate-400">Chưa chọn</span>
          )}
        </Row>
        {doLike && (
          <Row label="Cảm xúc Facebook">
            <span className="flex flex-col items-end">
              <span>{fmt(reactionCount)} cảm xúc</span>
              <span className="text-[10px] font-normal text-slate-400">(Ngẫu nhiên đều)</span>
            </span>
          </Row>
        )}
        <Row label="Cách chia lượt">{rotation ? `Xoay vòng · ${fmt(perAccount)} bài / tài khoản` : "Mọi tài khoản trên mọi bài"}</Row>
        <Row label="Thời gian nghỉ">
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-700">
            {spreadEnabled ? `Rải đều ${spreadHours} giờ` : `${delayMin || 0} – ${delayMax || 0} giây`}
          </span>
          <span className="font-normal text-slate-500">· {threads} luồng</span>
        </Row>
        {startMode === "schedule" && <Row label="Bắt đầu">{startAt ? `Hẹn giờ ${fmtStart(startAt)}` : "Hẹn giờ (chưa chọn)"}</Row>}
        <Row label="Ước tính">{seconds ? formatDuration(seconds) : "—"}</Row>
        <Row label="Trạng thái sẵn sàng">
          {blocking.length ? (
            <span className="inline-flex items-center gap-1.5 text-amber-700">
              <AlertTriangle className="size-3.5" aria-hidden="true" /> Còn {blocking.length} mục cần xử lý
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-emerald-600">
              <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" /> Chuẩn bị thực thi
            </span>
          )}
        </Row>
        {blocking.length > 0 && (
          <ul className="space-y-1 pb-2 pt-1 text-[11px] text-amber-800">
            {blocking.map((c) => (
              <li key={c.key} className="flex items-start gap-1.5">
                <span aria-hidden="true">•</span>
                {c.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DistributionCard({ targetCount, accountCount, doLike, doComment, doShare, totals, rotation, perAccount, accountNames }) {
  const plan = rotation ? rotationPlan({ accountCount, targetCount, perAccount }) : null;
  const cell = (on, v) => (on ? fmt(v) : "—");
  const shareText = !doShare ? "—" : totals.shareMin === totals.shareMax ? fmt(totals.shareMin) : `${totals.shareMin}–${totals.shareMax}`;
  const rows = rotation
    ? (plan?.accounts || []).filter((a) => a.posts > 0)
    : Array.from({ length: Math.min(targetCount, DIST_ROWS) }, (_, i) => i);
  const hidden = rotation ? Math.max(0, rows.length - DIST_ROWS) : Math.max(0, targetCount - DIST_ROWS);

  return (
    <div className={`${CARD} flex flex-col p-5`}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <BarChart3 className="size-4" aria-hidden="true" />
          </span>
          <h3 className="text-sm font-bold text-slate-900">Phân bổ lượt (dự kiến)</h3>
        </span>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">Đã cân bằng</span>
      </div>

      {!targetCount || !accountCount ? (
        <p className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
          Thêm bài viết và chọn tài khoản để xem phân bổ.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 text-[11px]">
          <table className="w-full border-collapse text-left">
            <thead className="bg-slate-50 font-bold">
              <tr>
                <th className="px-3 py-2 text-slate-700">{rotation ? "Tài khoản" : "Bài"}</th>
                {rotation && <th className="px-2 py-2 text-right text-slate-700">Số bài</th>}
                <th className="px-2 py-2 text-right text-rose-500">Cảm xúc</th>
                <th className="px-2 py-2 text-right text-blue-600">Bình luận</th>
                <th className="px-3 py-2 text-right text-sky-600">Chia sẻ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {rotation
                ? rows.slice(0, DIST_ROWS).map((a) => (
                    <tr key={a.index}>
                      <td className="max-w-[120px] truncate px-3 py-2 font-semibold" title={accountNames[a.index] || ""}>
                        {accountNames[a.index] || `Tài khoản ${a.index + 1}`}
                      </td>
                      <td className="px-2 py-2 text-right">{fmt(a.posts)}</td>
                      <td className="px-2 py-2 text-right">{cell(doLike, a.posts)}</td>
                      <td className="px-2 py-2 text-right">{cell(doComment, a.posts)}</td>
                      <td className="px-3 py-2 text-right">{cell(doShare, a.posts)}</td>
                    </tr>
                  ))
                : rows.map((i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 font-semibold">Bài {i + 1}</td>
                      <td className="px-2 py-2 text-right">{cell(doLike, totals.react)}</td>
                      <td className="px-2 py-2 text-right">{cell(doComment, totals.comment)}</td>
                      <td className="px-3 py-2 text-right">{shareText}</td>
                    </tr>
                  ))}
              {hidden > 0 && (
                <tr>
                  <td colSpan={rotation ? 5 : 4} className="px-3 py-2 text-slate-400">
                    … và {fmt(hidden)} {rotation ? "tài khoản" : "bài"} khác
                  </td>
                </tr>
              )}
              <tr className="bg-blue-50/50 font-bold">
                <td className="px-3 py-2 text-blue-700">Tổng</td>
                {rotation && <td className="px-2 py-2 text-right text-slate-800">{fmt(targetCount)}</td>}
                <td className="px-2 py-2 text-right text-rose-500">{fmt(totals.totalReacts)}</td>
                <td className="px-2 py-2 text-right text-blue-600">{fmt(totals.totalComments)}</td>
                <td className="px-3 py-2 text-right text-sky-600">{fmt(totals.totalShares)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-auto flex items-start gap-1.5 pt-4 text-[11px] text-slate-500">
        <Info className="mt-px size-3.5 shrink-0 text-blue-500" aria-hidden="true" />
        {rotation
          ? "Mỗi tài khoản làm lần lượt khối bài của mình trên 1 lần mở Chrome, hết tài khoản thì quay lại tài khoản đầu."
          : "Tự động phân bổ đều hoặc ngẫu nhiên giữa các bài viết."}
      </p>
    </div>
  );
}

function NotesCard({ rotation, accountCount, targetCount, perAccount, totals, threads, doShare }) {
  const plan = rotation ? rotationPlan({ accountCount, targetCount, perAccount }) : null;
  const notes = rotation
    ? [
        "Mỗi bài chỉ 1 tài khoản tương tác, làm đủ các loại đã chọn (cảm xúc, bình luận, chia sẻ).",
        `Mỗi tài khoản làm ${fmt(perAccount)} bài liên tiếp trên 1 lần mở Chrome, hết tài khoản thì quay lại tài khoản đầu.`,
        `${fmt(threads)} luồng Chrome: tối đa ${fmt(Math.max(1, Math.min(threads, plan?.activeAccounts || accountCount || 1)))} tài khoản chạy cùng lúc.`,
        "Nên thiết lập thời gian nghỉ từ 30 – 60 giây để hạn chế checkpoint và an toàn nhất.",
      ]
    : [
        `Mỗi bài: ${fmt(totals.react)} cảm xúc (bằng số tài khoản), ${fmt(totals.comment)} bình luận (một nửa số tài khoản).`,
        "Mỗi tài khoản chỉ thực hiện 1 lần cho mỗi loại tương tác trên mỗi bài viết.",
        doShare
          ? `Chia sẻ: tổng ${fmt(totals.totalShares)} lượt, chia ngẫu nhiên cho ${fmt(targetCount)} bài.`
          : "Hệ thống tự động random phân bổ cảm xúc và câu bình luận cho từng tài khoản.",
        "Nên thiết lập thời gian nghỉ từ 30 – 60 giây để hạn chế checkpoint và an toàn nhất.",
      ];
  return (
    <div className="flex flex-col rounded-2xl border border-amber-200 bg-amber-50/50 p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex size-7 items-center justify-center rounded-full bg-amber-100 text-amber-600">
          <Lightbulb className="size-4" aria-hidden="true" />
        </span>
        <h3 className="text-sm font-bold text-slate-900">Lưu ý quan trọng</h3>
      </div>
      <ul className="mb-4 space-y-2.5 text-xs leading-relaxed text-slate-700">
        {notes.map((n) => (
          <li key={n} className="flex items-start gap-2">
            <span className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
              <Check className="size-2.5 stroke-[3]" aria-hidden="true" />
            </span>
            <span>{n}</span>
          </li>
        ))}
      </ul>
      <p className="mt-auto flex items-center gap-2 rounded-xl border border-amber-100 bg-white px-3 py-2.5 text-[11px] font-medium text-amber-700">
        <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
        Đã bật cơ chế tự giãn cách thời gian ngẫu nhiên.
      </p>
    </div>
  );
}

export default function PostSummaryRow(props) {
  const rotation = props.distributionMode === DISTRIBUTION_ROTATION;
  const shared = { ...props, rotation };
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <SummaryCard {...shared} />
      <DistributionCard {...shared} />
      <NotesCard {...shared} />
    </div>
  );
}
