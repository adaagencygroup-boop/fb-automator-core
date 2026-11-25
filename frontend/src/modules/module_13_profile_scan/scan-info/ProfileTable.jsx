"use client";

import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Copy, ExternalLink, MapPin } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/lib/toast";
import { Pager } from "@/modules/module_11_page_scanner/_shared";
import ProfileAvatar from "../shared/ProfileAvatar";
import { jobText } from "../shared/exportProfiles";
import { fmtNum, shortFbUrl } from "../utils.mjs";

const PAGE_SIZE = 20;
const TINTS = ["bg-[#FEE2E2] text-[#DC2626]", "bg-[#FEF3C7] text-[#B45309]", "bg-[#E0E7FF] text-[#4338CA]", "bg-[#E0F2FE] text-[#0369A1]"];

export const rowId = (r) => `${r.sourceKey || ""}|${r.uid}`;

/** onSelect null → không có cột chọn */
export default function ProfileTable({ rows: input, selected, onSelect, emptyText = "Chưa có profile trong kết quả." }) {
  const [wanted, setPage] = useState(1);
  const [sort, setSort] = useState(null); // null | desc | asc theo số bạn bè
  const rows = useMemo(() => {
    if (!sort) return input;
    const dir = sort === "asc" ? 1 : -1;
    // Thiếu số bạn bè luôn xuống cuối
    return [...input].sort((a, b) => (a.friends == null) - (b.friends == null) || ((a.friends ?? 0) - (b.friends ?? 0)) * dir);
  }, [input, sort]);
  const SortIcon = sort === "asc" ? ArrowUp : sort === "desc" ? ArrowDown : ArrowUpDown;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(wanted, pages);
  const start = (page - 1) * PAGE_SIZE;
  const shown = rows.slice(start, start + PAGE_SIZE);
  const allOn = rows.length > 0 && rows.every((r) => selected.has(rowId(r)));

  const toggle = (list, on) => {
    const next = new Set(selected);
    list.forEach((r) => (on ? next.add(rowId(r)) : next.delete(rowId(r))));
    onSelect(next);
  };
  const copy = (url) =>
    navigator.clipboard
      ?.writeText(url)
      .then(() => toast.success("Đã sao chép link"))
      .catch(() => toast.error("Không thể sao chép"));

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1760px] text-left text-xs">
          <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] uppercase tracking-[0.5px] text-[#475569] [&_th]:whitespace-nowrap [&_th]:px-3 [&_th]:py-3 [&_th]:font-bold">
            <tr>
              {onSelect && <th className="w-10"><Checkbox aria-label="Chọn tất cả" checked={allOn} disabled={!rows.length} onCheckedChange={(c) => toggle(rows, c)} /></th>}
              <th>STT</th>
              <th>Hồ sơ & Tên profile</th>
              <th>Link Facebook</th>
              <th className="text-right"><button type="button" title="Sắp xếp theo số bạn bè" onClick={() => setSort(sort === "desc" ? "asc" : sort === "asc" ? null : "desc")} className="inline-flex items-center gap-1 font-bold uppercase hover:text-[#2563EB]">Bạn bè <SortIcon className="size-3" /></button></th>
              <th className="text-right">Followers</th>
              <th>Số điện thoại</th>
              <th>Tiểu sử (Bio)</th>
              <th>Ngày sinh</th>
              <th>Quê quán</th>
              <th>Nơi ở hiện tại</th>
              <th>Học vấn</th>
              <th>Lịch sử công việc</th>
            </tr>
          </thead>
          <tbody className="[&_td]:px-3 [&_td]:py-2.5">
            {shown.length === 0 && (
              <tr><td colSpan={13} className="!py-12 text-center text-[#94A3B8]">{emptyText}</td></tr>
            )}
            {shown.map((r, i) => (
              <tr key={rowId(r)} className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC]">
                {onSelect && <td><Checkbox aria-label={`Chọn ${r.name}`} checked={selected.has(rowId(r))} onCheckedChange={(c) => toggle([r], c)} /></td>}
                <td className="font-mono text-[#94A3B8]">{String(start + i + 1).padStart(2, "0")}</td>
                <td>
                  <div className="flex items-center gap-2.5">
                    <ProfileAvatar src={r.avatar} name={r.name} tint={TINTS[i % TINTS.length]} />
                    <span className="min-w-0">
                      <span className="block max-w-[170px] truncate font-bold text-[#0F172A]">{r.name}</span>
                      <span className="text-[11px] text-[#94A3B8]">UID: {r.uid}</span>
                    </span>
                  </div>
                </td>
                <td>
                  {r.url ? (
                    <span className="flex items-center gap-2 text-[#94A3B8]">
                      <span className="max-w-[140px] truncate font-mono text-[#475569]" title={r.url}>{shortFbUrl(r.url)}</span>
                      <button type="button" aria-label="Sao chép link" onClick={() => copy(r.url)} className="hover:text-[#2563EB]"><Copy className="size-3.5" /></button>
                      <a aria-label="Mở profile" href={r.url} target="_blank" rel="noreferrer" className="hover:text-[#2563EB]"><ExternalLink className="size-3.5" /></a>
                    </span>
                  ) : "—"}
                </td>
                <td className="text-right font-mono font-bold text-[#0F172A]">{fmtNum(r.friends)}</td>
                <td className="text-right font-mono font-bold text-[#0F172A]">{fmtNum(r.followers)}</td>
                <td className="whitespace-nowrap font-mono text-[#334155]" title={r.phone ? (r.phone_source === "about" ? "Lấy từ Giới thiệu" : "Lấy từ tiểu sử") : undefined}>{r.phone || "—"}</td>
                <td><span className="block max-w-[220px] truncate text-[#475569]" title={r.bio}>{r.bio || "—"}</span></td>
                <td className="whitespace-nowrap font-mono text-[#64748B]">{r.birthday || "—"}</td>
                <td className="whitespace-nowrap text-[#334155]">{r.hometown || "—"}</td>
                <td className="whitespace-nowrap text-[#334155]">{r.location ? <span className="inline-flex items-center gap-1"><MapPin className="size-3 text-[#94A3B8]" /> {r.location}</span> : "—"}</td>
                <td><span className="block max-w-[200px] truncate text-[#334155]" title={r.education}>{r.education || "—"}</span></td>
                <td>
                  {r.job_title || r.job_place ? (
                    <span className="block max-w-[220px] truncate text-[#334155]" title={jobText(r)}>
                      {r.job_title && <b className="text-[#2563EB]">{r.job_title}</b>}
                      {r.job_title && r.job_place ? " tại " : ""}
                      {r.job_place}
                    </span>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-xs text-[#64748B]">
        <span>Hiển thị <b className="text-[#0F172A]">{shown.length ? start + 1 : 0} - {start + shown.length}</b> trong tổng số <b className="text-[#0F172A]">{fmtNum(rows.length)}</b> profile</span>
        <Pager page={page} totalPages={pages} onChange={setPage} />
      </div>
    </div>
  );
}
