"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Download,
  ExternalLink,
  Copy,
  Clock,
  Search,
  Eye,
  ThumbsUp,
  MessageCircle,
  Share2,
  Monitor,
  FolderInput,
  Trash2,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/lib/toast";
import { initialsOf } from "@/modules/module_07_group_spam/shared/components";
import { getPagesWithPosts, getScannedPosts } from "../service";

const PAGE_SIZE = 5;

const DATE_OPTS = [
  { value: "", label: "Tất cả thời gian" },
  { value: "7", label: "7 ngày qua" },
  { value: "30", label: "30 ngày qua" },
  { value: "90", label: "90 ngày qua" },
];

const LIKE_OPTS = [
  { value: "", label: "Tất cả like" },
  { value: "100", label: "> 100 Like" },
  { value: "500", label: "> 500 Like" },
  { value: "1000", label: "> 1.000 Like" },
  { value: "5000", label: "> 5.000 Like" },
];

const CMT_OPTS = [
  { value: "", label: "Tất cả cmt" },
  { value: "10", label: "> 10 cmt" },
  { value: "50", label: "> 50 cmt" },
  { value: "100", label: "> 100 cmt" },
];

const SHARE_OPTS = [
  { value: "", label: "Tất cả share" },
  { value: "10", label: "> 10 share" },
  { value: "50", label: "> 50 share" },
  { value: "100", label: "> 100 share" },
];

const ICON_COLORS = [
  "bg-sky-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-cyan-500",
];

function fmtCompact(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return v.toLocaleString("vi-VN");
}

function fmtPostTime(r) {
  if (r.published_text) return r.published_text;
  const raw = r.published_at || r.created_at;
  if (!raw) return "—";
  try {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return String(raw).slice(0, 19);
    const pad = (x) => String(x).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  } catch {
    return String(raw).slice(0, 19);
  }
}

function relativeUpdate(iso) {
  if (!iso) return "Chưa có cập nhật";
  try {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return "Chưa có cập nhật";
    const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (mins < 1) return "Cập nhật mới nhất: vừa xong";
    if (mins < 60) return `Cập nhật mới nhất: ${mins} phút trước`;
    const h = Math.round(mins / 60);
    if (h < 48) return `Cập nhật mới nhất: ${h} giờ trước`;
    return `Cập nhật mới nhất: ${Math.round(h / 24)} ngày trước`;
  } catch {
    return "Chưa có cập nhật";
  }
}

function shortFbUrl(url) {
  if (!url) return "";
  return String(url)
    .replace(/^https?:\/\/(m\.|www\.)?facebook\.com\//, "fb.com/")
    .replace(/\?.*$/, "");
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <div className="min-w-[140px] flex-1">
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-[11px] text-slate-700 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
      >
        {options.map((o) => (
          <option key={o.value || "all"} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function PageScannerListPosts() {
  const [pages, setPages] = useState([]);
  const [sideSearch, setSideSearch] = useState("");
  const [activePageKey, setActivePageKey] = useState(null);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [days, setDays] = useState("");
  const [minLikes, setMinLikes] = useState("");
  const [minComments, setMinComments] = useState("");
  const [minShares, setMinShares] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  const loadPages = useCallback(async () => {
    try {
      const data = await getPagesWithPosts();
      const list = data.items || [];
      setPages(list);
      setActivePageKey((prev) => {
        if (prev && list.some((p) => p.page_key === prev)) return prev;
        return list[0]?.page_key || null;
      });
    } catch {
      setPages([]);
    }
  }, []);

  useEffect(() => {
    loadPages();
  }, [loadPages]);

  const filteredPages = useMemo(() => {
    const q = sideSearch.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter(
      (p) =>
        `${p.page_name || ""}`.toLowerCase().includes(q) ||
        `${p.page_key || ""}`.toLowerCase().includes(q),
    );
  }, [pages, sideSearch]);

  const activePage = useMemo(
    () => pages.find((p) => p.page_key === activePageKey) || null,
    [pages, activePageKey],
  );

  const load = useCallback(
    async (p = 1) => {
      if (!activePageKey) {
        setItems([]);
        setTotal(0);
        return;
      }
      setLoading(true);
      try {
        const data = await getScannedPosts({
          page: p,
          page_size: PAGE_SIZE,
          page_key: activePageKey,
          keyword: keyword.trim() || undefined,
          days: days || undefined,
          min_reactions: minLikes || undefined,
          min_comments: minComments || undefined,
          min_shares: minShares || undefined,
        });
        setItems(data.items || []);
        setTotal(data.total || 0);
        setPage(p);
        setSelectedIds([]);
      } catch (err) {
        toast.error(`Lỗi tải DS bài viết: ${err.message}`);
      } finally {
        setLoading(false);
      }
    },
    [activePageKey, keyword, days, minLikes, minComments, minShares],
  );

  useEffect(() => {
    if (activePageKey) load(1);
  }, [activePageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetFilters = () => {
    setKeyword("");
    setDays("");
    setMinLikes("");
    setMinComments("");
    setMinShares("");
    setTimeout(() => load(1), 0);
  };

  const applyFilters = () => load(1);

  const selectedRows = useMemo(
    () => items.filter((r) => selectedIds.includes(r.id || r.post_key)),
    [items, selectedIds],
  );

  const handleExport = (rowsSrc) => {
    const rows = rowsSrc?.length ? rowsSrc : items;
    if (!rows.length) {
      toast.warning("Không có dữ liệu để xuất.");
      return;
    }
    const headers = ["STT", "Page", "Nội dung", "Link", "Reactions", "Comments", "Shares", "Thời gian"];
    const body = rows.map((r, i) => [
      i + 1,
      r.page_name || r.page_key || "",
      (r.content || "").slice(0, 500),
      r.post_url || "",
      r.reaction_count ?? "",
      r.comment_count ?? "",
      r.share_count ?? "",
      r.published_text || r.published_at || "",
    ]);
    const csv = [headers, ...body]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `posts_${activePageKey || "all"}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Đã xuất CSV.");
  };

  const handleCopyContent = async () => {
    const rows = selectedRows.length ? selectedRows : items;
    const text = rows
      .map((r) => (r.content || "").trim())
      .filter(Boolean)
      .join("\n\n---\n\n");
    if (!text) {
      toast.warning("Không có nội dung để sao chép.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Đã sao chép ${rows.filter((r) => r.content).length} bài.`);
    } catch {
      toast.error("Không sao chép được — kiểm tra quyền clipboard.");
    }
  };

  const rowId = (r) => r.id || r.post_key;
  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageNums = useMemo(() => {
    const max = totalPages;
    if (max <= 7) return Array.from({ length: max }, (_, i) => i + 1);
    const set = new Set([1, 2, 3, max, page, page - 1, page + 1].filter((n) => n >= 1 && n <= max));
    return [...set].sort((a, b) => a - b);
  }, [totalPages, page]);

  return (
    <div className="pb-8">
      {/* Header — Figma */}
      <div className="mb-4">
        <h1 className="font-heading text-xl font-bold text-slate-900">Danh sách bài viết quét</h1>
        <p className="mt-1 max-w-3xl text-xs text-slate-500">
          Lưu trữ dữ liệu bài viết, nội dung bài đăng, chỉ số tương tác (Like, Comment, Share) theo từng Fanpage.{" "}
          <Link href="/scanner/posts" className="font-medium text-primary hover:underline">
            Quét bài viết
          </Link>
        </p>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        {/* Left: Danh mục Page */}
        <Card className="flex w-full flex-col overflow-hidden border-slate-200 shadow-sm lg:w-[260px] lg:shrink-0">
          <div className="border-b border-slate-100 px-4 py-3">
            <h3 className="text-[12px] font-bold text-slate-800">Danh mục Page</h3>
            <div className="relative mt-2.5">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={sideSearch}
                onChange={(e) => setSideSearch(e.target.value)}
                placeholder="Tìm tên hoặc ID page…"
                className="h-8 border-slate-200 pl-8 text-[11px]"
              />
            </div>
          </div>
          <div className="max-h-[640px] flex-1 space-y-1 overflow-y-auto p-2">
            {!filteredPages.length ? (
              <p className="px-2 py-8 text-center text-[11px] text-slate-400">
                Chưa có page có bài viết — chạy Quét bài viết trước.
              </p>
            ) : (
              filteredPages.map((p, i) => {
                const active = activePageKey === p.page_key;
                return (
                  <button
                    key={p.page_key}
                    type="button"
                    onClick={() => setActivePageKey(p.page_key)}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition ${
                      active
                        ? "bg-primary/8 ring-1 ring-primary/40"
                        : "hover:bg-slate-50"
                    }`}
                  >
                    <div
                      className={`flex size-9 shrink-0 items-center justify-center rounded-lg text-white ${ICON_COLORS[i % ICON_COLORS.length]}`}
                    >
                      {p.avatar_url ? (
                        <Avatar className="size-9 rounded-lg">
                          <AvatarImage src={p.avatar_url} />
                          <AvatarFallback className="rounded-lg bg-transparent text-[10px]">
                            {initialsOf(p.page_name || "FB")}
                          </AvatarFallback>
                        </Avatar>
                      ) : (
                        <Monitor className="size-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-semibold text-slate-800">
                        {p.page_name || p.page_key}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-slate-400">{p.page_key}</div>
                      <div className="mt-0.5 text-[10px] font-medium text-slate-500">
                        {(p.post_count || 0).toLocaleString("vi-VN")} bài viết
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </Card>

        {/* Right panel */}
        <Card className="min-w-0 flex-1 overflow-hidden border-slate-200 shadow-sm">
          {/* Page profile + actions */}
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-sm">
                <Monitor className="size-6" />
              </div>
              <div>
                <h2 className="font-heading text-[15px] font-bold text-slate-900">
                  {activePage?.page_name || "Chọn page bên trái"}
                </h2>
                {activePage?.page_url ? (
                  <a
                    href={activePage.page_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    {shortFbUrl(activePage.page_url)}
                    <ExternalLink className="size-3" />
                  </a>
                ) : activePage ? (
                  <p className="mt-0.5 text-[11px] text-slate-400">{activePage.page_key}</p>
                ) : null}
                <p className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-slate-400">
                  <Clock className="size-3" />
                  {relativeUpdate(activePage?.last_post_at)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9 gap-1.5 border-slate-200 text-[11px]"
                onClick={() => handleExport(items)}
              >
                <Download className="size-3.5" /> Xuất Excel/CSV
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9 gap-1.5 border-slate-200 text-[11px]"
                onClick={handleCopyContent}
              >
                <Copy className="size-3.5" /> Sao chép nội dung
              </Button>
              <Link
                href="/scanner/posts"
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                Quét cập nhật
              </Link>
            </div>
          </div>

          {/* Search + filters */}
          <div className="space-y-3 border-b border-slate-100 px-5 py-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                placeholder="Tìm theo nội dung từ khóa, hashtag, SĐT, khuyến mãi…"
                className="h-10 border-slate-200 pl-10 text-[12px]"
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <FilterSelect label="Thời gian đăng" value={days} onChange={setDays} options={DATE_OPTS} />
              <FilterSelect label="Lượt Thích (Like)" value={minLikes} onChange={setMinLikes} options={LIKE_OPTS} />
              <FilterSelect label="Bình luận (Comment)" value={minComments} onChange={setMinComments} options={CMT_OPTS} />
              <FilterSelect label="Chia sẻ (Share)" value={minShares} onChange={setMinShares} options={SHARE_OPTS} />
              <div className="flex items-center gap-2 pb-0.5">
                <Button type="button" size="sm" variant="outline" className="h-9 text-[11px]" onClick={applyFilters}>
                  Áp dụng
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-9 gap-1 text-[11px] text-slate-500"
                  onClick={resetFilters}
                >
                  <RotateCcw className="size-3.5" /> Đặt lại lọc
                </Button>
              </div>
            </div>
          </div>

          {/* Selection bar */}
          {selectedIds.length > 0 ? (
            <div className="mx-5 mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5">
              <span className="text-[12px] font-semibold text-blue-700">
                {selectedIds.length} bài viết đang được chọn
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <Button type="button" size="sm" variant="outline" className="h-7 gap-1 border-blue-200 bg-white text-[11px]" disabled>
                  <FolderInput className="size-3.5" /> Chuyển danh mục
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 border-emerald-200 bg-emerald-50 text-[11px] text-emerald-700"
                  onClick={() => handleExport(selectedRows)}
                >
                  <Download className="size-3.5" /> Xuất dữ liệu chọn
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7 gap-1 border-rose-200 bg-white text-[11px] text-rose-600" disabled>
                  <Trash2 className="size-3.5" /> Xóa
                </Button>
              </div>
            </div>
          ) : null}

          {/* Table */}
          <div className="overflow-auto px-2 pt-2">
            <table className="w-full min-w-[980px] text-left text-[11px]">
              <thead className="bg-slate-50/80 text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="w-10 px-3 py-3">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(c) => setSelectedIds(c ? items.map(rowId) : [])}
                    />
                  </th>
                  <th className="w-12 px-2 py-3 font-semibold">STT</th>
                  <th className="px-3 py-3 font-semibold">NỘI DUNG BÀI VIẾT</th>
                  <th className="px-3 py-3 font-semibold">LINK BÀI VIẾT</th>
                  <th className="px-3 py-3 font-semibold">THỜI GIAN ĐĂNG</th>
                  <th className="px-3 py-3 font-semibold">TƯƠNG TÁC</th>
                  <th className="w-16 px-3 py-3 text-center font-semibold">HÀNH ĐỘNG</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-slate-400">
                      <Loader2 className="mx-auto mb-2 size-6 animate-spin text-primary" />
                      Đang tải…
                    </td>
                  </tr>
                ) : !activePageKey ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-slate-400">
                      Chọn một page ở cột trái để xem bài viết.
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-slate-400">
                      Không có bài viết khớp bộ lọc — thử Đặt lại lọc hoặc Quét cập nhật.
                    </td>
                  </tr>
                ) : (
                  items.map((r, idx) => {
                    const id = rowId(r);
                    const selected = selectedIds.includes(id);
                    return (
                      <tr key={id} className={selected ? "bg-blue-50/40" : "hover:bg-slate-50/80"}>
                        <td className="px-3 py-3">
                          <Checkbox
                            checked={selected}
                            onCheckedChange={(c) =>
                              setSelectedIds((prev) => (c ? [...prev, id] : prev.filter((x) => x !== id)))
                            }
                          />
                        </td>
                        <td className="px-2 py-3 font-mono text-slate-400">
                          {String((page - 1) * PAGE_SIZE + idx + 1).padStart(2, "0")}
                        </td>
                        <td className="max-w-[320px] px-3 py-3">
                          <p className="line-clamp-3 text-[12px] leading-relaxed text-slate-800" title={r.content || ""}>
                            {r.content || <span className="italic text-slate-300">Không có nội dung</span>}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          {r.post_url ? (
                            <a
                              href={r.post_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex max-w-[160px] items-center gap-1 truncate font-medium text-primary hover:underline"
                            >
                              {shortFbUrl(r.post_url) || "Mở bài"}
                              <ExternalLink className="size-3 shrink-0" />
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-slate-600">{fmtPostTime(r)}</td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200/80">
                              <ThumbsUp className="size-3" /> {fmtCompact(r.reaction_count)}
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-violet-200/80">
                              <MessageCircle className="size-3" /> {fmtCompact(r.comment_count)}
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200/80">
                              <Share2 className="size-3" /> {fmtCompact(r.share_count)}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center">
                          {r.post_url ? (
                            <a
                              href={r.post_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex size-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-primary"
                              title="Xem bài viết"
                            >
                              <Eye className="size-4" />
                            </a>
                          ) : (
                            <span className="inline-flex size-8 items-center justify-center text-slate-300">
                              <Eye className="size-4" />
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Footer pagination — Figma */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
            <span className="text-[11px] text-slate-400">
              Đang hiển thị {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} - {Math.min(page * PAGE_SIZE, total)}{" "}
              trên tổng số {total.toLocaleString("vi-VN")} bài viết
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-7"
                disabled={page <= 1}
                onClick={() => load(page - 1)}
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              {pageNums.map((n, i) => {
                const prev = pageNums[i - 1];
                const gap = prev != null && n - prev > 1;
                return (
                  <React.Fragment key={n}>
                    {gap ? <span className="px-1 text-[11px] text-slate-400">…</span> : null}
                    <Button
                      type="button"
                      variant={n === page ? "default" : "outline"}
                      size="icon"
                      className="size-7 text-[11px]"
                      onClick={() => load(n)}
                    >
                      {n}
                    </Button>
                  </React.Fragment>
                );
              })}
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-7"
                disabled={page >= totalPages}
                onClick={() => load(page + 1)}
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
