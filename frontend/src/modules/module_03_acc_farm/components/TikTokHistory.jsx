"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, FolderOpen, Loader2, Search } from "lucide-react";
import CustomSelect from "@/components/ui/custom-select";
import Pagination from "@/components/ui/pagination";
import { formatVietnamDateTime } from "@/lib/date-utils";
import { toast } from "@/lib/toast";
import { getTikTokHistory, openTikTokHistoryFolder } from "../service";
import { UidCopy } from "./parts";

const PAGE_SIZE = 10;
const EMPTY = { total: 0, rows: [], accounts: [] };

/** Lịch sử video TikTok đã tải của từng tài khoản Facebook */
export default function TikTokHistory({ accountFilterOptions }) {
  const [filters, setFilters] = useState({ account_uid: "", search: "", date: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [opening, setOpening] = useState(null);
  const request = useRef(0);

  useEffect(() => {
    const id = ++request.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await getTikTokHistory({ ...filters, page, size: PAGE_SIZE });
        if (id !== request.current) return;
        setData({ ...EMPTY, ...result });
        setError("");
      } catch (err) {
        if (id === request.current) setError(err?.message || "Không tải được lịch sử tải video.");
      } finally {
        if (id === request.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [filters, page, reload]);

  const change = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const openFolder = async (row) => {
    setOpening(row.id);
    try {
      await openTikTokHistoryFolder(row.id);
    } catch (err) {
      toast.error(err?.message || "Không mở được thư mục.");
      setReload((n) => n + 1);
    } finally {
      setOpening(null);
    }
  };

  const message = loading ? "Đang tải lịch sử…" : error || (!data.rows.length ? "Chưa có video nào phù hợp." : "");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <CustomSelect
          value={filters.account_uid}
          onChange={(value) => change("account_uid", value)}
          options={accountFilterOptions(data.accounts)}
          className="min-w-[220px] max-w-[320px]"
          buttonClassName="h-10 rounded-lg border-border text-xs text-slate-700 font-medium"
        />
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-blue-500" />
          <input
            type="search"
            value={filters.search}
            onChange={(e) => change("search", e.target.value)}
            placeholder="Tìm theo caption, từ khóa hoặc ID video..."
            className="h-10 w-full rounded-lg border border-blue-200 bg-white pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <input
          type="date"
          aria-label="Ngày tải"
          value={filters.date}
          onChange={(e) => change("date", e.target.value)}
          className="h-10 cursor-pointer rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-2xs focus:border-blue-500 focus:outline-none"
        />
      </div>

      <div className="pt-0.5 text-xs font-medium text-slate-500">
        Hiển thị <span className="font-bold text-slate-800">{data.rows.length}</span> / {data.total.toLocaleString("vi-VN")} video
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200/90 bg-white shadow-xs">
        <table className="w-full min-w-[900px] border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/50 text-[11px] font-bold tracking-wider text-slate-600">
              <th className="w-14 px-3.5 py-3 text-center">STT</th>
              <th className="w-40 px-4 py-3">THỜI GIAN TẢI</th>
              <th className="w-52 px-4 py-3">TÀI KHOẢN / UID</th>
              <th className="px-4 py-3">TỪ KHÓA & CAPTION</th>
              <th className="w-64 px-4 py-3">FILE VIDEO</th>
              <th className="w-24 px-4 py-3 text-center">THAO TÁC</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {message ? (
              <tr>
                <td colSpan={6} className={`py-12 text-center ${error && !loading ? "text-rose-600" : "text-slate-400"}`}>
                  {message}
                </td>
              </tr>
            ) : (
              data.rows.map((row, index) => (
                <tr key={row.id} className="transition-colors hover:bg-slate-50/70">
                  <td className="px-3.5 py-4 text-center font-mono font-bold text-slate-800">
                    {String((page - 1) * PAGE_SIZE + index + 1).padStart(2, "0")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4">
                    <div className="font-bold text-slate-900">{formatVietnamDateTime(row.created_at).timeWithSeconds}</div>
                    <div className="mt-0.5 text-slate-600">{formatVietnamDateTime(row.created_at).date}</div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="font-bold text-slate-900">{row.account_name || row.account_uid}</div>
                    <UidCopy uid={row.account_uid} className="mt-0.5" />
                  </td>
                  <td className="px-4 py-4">
                    <span className="inline-block rounded-md border border-blue-200/90 bg-blue-50 px-2 py-0.5 font-semibold text-blue-600">{row.keyword}</span>
                    <p className="line-clamp-2 max-w-md pt-1 leading-relaxed text-slate-600" title={row.caption}>{row.caption}</p>
                  </td>
                  <td className="px-4 py-4">
                    <div className="max-w-[240px] truncate font-mono text-[11px] text-slate-600" title={row.file_path}>{row.file_path}</div>
                    {!row.exists && <div className="mt-0.5 text-[11px] font-medium text-amber-600">Không còn trên máy này</div>}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => openFolder(row)}
                        disabled={!row.exists || opening != null}
                        title={row.exists ? "Xem video trong thư mục" : "Video không còn trên máy này"}
                        aria-label="Xem video trong thư mục"
                        className="cursor-pointer p-1 text-slate-400 transition-colors hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        {opening === row.id ? <Loader2 size={15} className="animate-spin" /> : <FolderOpen size={15} />}
                      </button>
                      <a
                        href={row.video_url}
                        target="_blank"
                        rel="noreferrer"
                        title="Mở video gốc trên TikTok"
                        aria-label="Mở video gốc trên TikTok"
                        className="p-1 text-slate-400 transition-colors hover:text-blue-600"
                      >
                        <ExternalLink size={15} />
                      </a>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Pagination currentPage={page} totalPages={Math.max(1, Math.ceil(data.total / PAGE_SIZE))} onPageChange={setPage} />
      </div>
    </div>
  );
}
