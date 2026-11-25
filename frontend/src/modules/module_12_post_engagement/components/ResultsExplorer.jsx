"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download, ExternalLink, Flag, List, Loader2, MessageCircle, Search, Share2, ThumbsUp, Trash2, User, Users,
} from "lucide-react";
import Pagination from "@/components/ui/pagination";
import CustomSelect from "@/components/ui/custom-select";
import { toast } from "@/lib/toast";
import { deletePosts, listEngagements, listPosts } from "../service";
import useRowMultiSelect from "./useRowMultiSelect";
import ExportModal from "./ExportModal";
import { ReactionIcon, TierBadge, TierLegend, tierReason } from "./TierBadge";

const SOURCE_OPTIONS = [
  { value: "all", label: "Lọc: Tất cả nguồn" },
  { value: "group", label: "Nhóm" },
  { value: "page", label: "Fanpage" },
  { value: "profile", label: "Trang cá nhân" },
];
const SORT_OPTIONS = [
  { value: "newest", label: "Xếp: Mới nhất" },
  { value: "most", label: "Xếp: Nhiều tương tác nhất" },
];
const TIER_OPTIONS = [
  { value: "all", label: "Mức: Tất cả" },
  { value: "1", label: "Mức 1 (Cao)" },
  { value: "2", label: "Mức 2 (Cơ bản)" },
];
const PAGE_SIZES = [
  { value: 20, label: "20 / trang" },
  { value: 50, label: "50 / trang" },
];
const TABS = [
  { id: "like", label: "Đã Like" },
  // Không có tab "Đã Share": Facebook chỉ cho xem tổng số lượt chia sẻ (thẻ "Lượt chia sẻ"), không cho xem ai đã chia sẻ
  { id: "comment", label: "Bình luận" },
];
const SOURCE_TEXT = { group: "Nhóm", page: "Page", profile: "Trang cá nhân" };

const nf = (n) => Number(n || 0).toLocaleString("vi-VN");

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function SourceIcon({ type, className = "size-3.5" }) {
  if (type === "page") return <Flag className={className} />;
  if (type === "profile") return <User className={className} />;
  return <Users className={className} />;
}

function Avatar({ url, name }) {
  const [broken, setBroken] = useState(false);
  const initials = String(name || "?").trim().split(/\s+/).slice(-2).map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  if (url && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-8 shrink-0 rounded-full object-cover" />;
  }
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF] text-[11px] font-bold text-[#2563EB]">
      {initials || "?"}
    </span>
  );
}

function PostCard({ post, active, onSelect, onDelete }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" ? onSelect() : null)}
      className={`group relative w-full cursor-pointer rounded-xl border bg-white p-4 text-left transition-all ${
        active ? "border-[#2563EB] shadow-[0_0_0_1px_#2563EB]" : "border-[#E2E8F0] hover:border-slate-300"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-[#94A3B8]">{post.posted_date || post.scanned_date || "—"}</span>
        {active && <span className="mt-1 size-2 shrink-0 rounded-full bg-[#2563EB]" />}
        {onDelete && !active && (
          <button
            type="button"
            title="Xoá bài khỏi kho"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="hidden rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 group-hover:block"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      <p className="mt-1.5 line-clamp-2 break-words text-sm font-semibold leading-5 text-[#0F172A]" title={post.content || post.post_url}>
        “{post.content || post.post_url}”
      </p>
      <p className="mt-1.5 flex items-center gap-1.5 truncate text-xs text-[#64748B]">
        <SourceIcon type={post.source_type} />
        {SOURCE_TEXT[post.source_type] || "Nguồn"}:
        <span className="truncate text-[#334155]">{post.source_name || "—"}</span>
      </p>
      {/* Tổng Facebook (cùng loại số với Share và cột "Tương tác hiện tại"); số đã quét xem ở thẻ số liệu bên phải */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-[#F1F5F9] pt-2.5 text-xs text-[#64748B]">
        <span
          className={`inline-flex items-center gap-1 ${active ? "font-semibold text-[#2563EB]" : ""}`}
          title={`Tổng trên Facebook · đã quét ${nf(post.like_count)}`}
        >
          <ThumbsUp className="size-3.5" /> {nf(post.fb_like_count)} Like
        </span>
        <span className="inline-flex items-center gap-1" title={`Tổng trên Facebook · đã quét ${nf(post.comment_count)}`}>
          <MessageCircle className="size-3.5" /> {nf(post.fb_comment_count)} Cmt
        </span>
        <span className="inline-flex items-center gap-1" title="Facebook chỉ cho xem tổng số chia sẻ">
          <Share2 className="size-3.5" /> {nf(post.fb_share_count)} Share
        </span>
      </div>
    </div>
  );
}

/**
 * Khối kết quả 2 cột: trái = danh mục bài viết đã quét; phải = chi tiết bài (3 thẻ số liệu, 3 tab, bảng, chú giải).
 * postKeys: chỉ hiện các bài này (trang Quét — bài của phiên); null = toàn bộ kho (trang Danh sách tài khoản).
 * live: đang quét → tự tải lại mỗi 4 giây (số liệu nhảy theo thời gian thực).
 */
export default function ResultsExplorer({ title, postKeys = null, live = false, refreshKey = 0, allowDelete = false, emptyText, headerSize = "sm" }) {
  const keysParam = postKeys ? postKeys.join(",") : null;
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("all");
  const [sort, setSort] = useState("newest");
  const [posts, setPosts] = useState([]);
  const [postTotal, setPostTotal] = useState(0);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [selectedKey, setSelectedKey] = useState("");

  const [tab, setTab] = useState("like");
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState({ rows: [], total: 0, counts: {} });
  const [loadingRows, setLoadingRows] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const rowCache = useRef(new Map());
  const [exportOpen, setExportOpen] = useState(false);

  const debSearch = useDebounced(search);
  const debQuery = useDebounced(query);

  const loadPosts = useCallback(async (silent = false) => {
    if (!silent) setLoadingPosts(true);
    try {
      const keys = keysParam === null ? null : keysParam ? keysParam.split(",") : [];
      if (keys && !keys.length) {
        setPosts([]);
        setPostTotal(0);
        return;
      }
      const res = await listPosts({ search: debSearch, source, sort, keys });
      const list = res?.posts || [];
      setPosts(list);
      setPostTotal(res?.total || 0);
      setSelectedKey((cur) => (list.some((p) => p.post_key === cur) ? cur : list[0]?.post_key || ""));
    } catch (err) {
      if (!silent) toast.error(err?.message || "Không tải được danh mục bài viết.");
    } finally {
      if (!silent) setLoadingPosts(false);
    }
  }, [keysParam, debSearch, source, sort]);

  const loadRows = useCallback(async (silent = false) => {
    if (!selectedKey) {
      setData({ rows: [], total: 0, counts: {} });
      return;
    }
    if (!silent) setLoadingRows(true);
    try {
      const res = await listEngagements(selectedKey, {
        tab, search: debQuery, tier: tier === "all" ? null : Number(tier), limit: pageSize, offset: (page - 1) * pageSize,
      });
      const rows = res?.rows || [];
      rows.forEach((r) => rowCache.current.set(r.id, { ...r, action: tab }));
      setData({ rows, total: res?.total || 0, counts: res?.counts || {} });
    } catch (err) {
      if (!silent) toast.error(err?.message || "Không tải được danh sách tương tác.");
    } finally {
      if (!silent) setLoadingRows(false);
    }
  }, [selectedKey, tab, debQuery, tier, page, pageSize]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts, refreshKey]);

  useEffect(() => {
    loadRows();
  }, [loadRows, refreshKey]);

  useEffect(() => {
    setPage(1);
  }, [selectedKey, tab, debQuery, tier, pageSize]);

  useEffect(() => {
    setSelected(new Set());
    rowCache.current = new Map();
  }, [selectedKey, tab]);

  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => {
      loadPosts(true);
      loadRows(true);
    }, 4000);
    return () => clearInterval(t);
  }, [live, loadPosts, loadRows]);

  const post = useMemo(() => posts.find((p) => p.post_key === selectedKey) || null, [posts, selectedKey]);
  const counts = {
    like: data.counts?.like_count ?? post?.like_count ?? 0,
    share: post?.fb_share_count ?? 0,
    comment: data.counts?.comment_count ?? post?.comment_count ?? 0,
  };

  const { setContainer, rowProps } = useRowMultiSelect({
    rows: data.rows,
    selected,
    onChange: setSelected,
  });
  const allOnPage = data.rows.length > 0 && data.rows.every((r) => selected.has(r.id));
  const someOnPage = !allOnPage && data.rows.some((r) => selected.has(r.id));
  const toggleAllOnPage = () => {
    const next = new Set(selected);
    if (allOnPage) data.rows.forEach((r) => next.delete(r.id));
    else data.rows.forEach((r) => next.add(r.id));
    setSelected(next);
  };
  const selectedRows = useMemo(() => [...selected].map((id) => rowCache.current.get(id)).filter(Boolean), [selected]);

  const removePost = async (p) => {
    if (!window.confirm(`Xoá bài viết này và toàn bộ ${nf(p.like_count + p.comment_count)} tương tác đã quét khỏi kho?`)) return;
    try {
      await deletePosts([p.post_key]);
      toast.success("Đã xoá bài khỏi kho.");
      loadPosts();
    } catch (err) {
      toast.error(err?.message || "Không xoá được bài viết.");
    }
  };

  const from = data.total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(data.total, page * pageSize);
  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const emptyRowsText = debQuery || tier !== "all"
    ? "Không tìm thấy tài khoản tương tác nào khớp với từ khóa / bộ lọc."
    : tab === "like"
      ? post?.source_type && post.source_type !== "group" && post.fb_like_count > 0
        ? "Chưa có người bày tỏ cảm xúc nào. Với bài ngoài nhóm, Facebook chỉ cho xem người là bạn bè của nick quét."
        : "Chưa có tài khoản bày tỏ cảm xúc nào được quét cho bài này."
      : "Chưa có bình luận nào được quét cho bài này.";

  return (
    <section className="rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F1F5F9] pb-4">
        <h2 className={`font-bold uppercase tracking-tight text-[#0F172A] ${headerSize === "lg" ? "text-xl" : "text-sm"}`}>{title}</h2>
        <button
          type="button"
          onClick={() => setExportOpen(true)}
          disabled={!posts.length}
          title={posts.length ? "Xuất Excel / CSV / danh sách UID" : "Chưa có dữ liệu tương tác để xuất file!"}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#CBD5E1] bg-white px-3.5 text-sm font-medium text-[#334155] shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="size-4 text-[#64748B]" /> Xuất toàn bộ file
        </button>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* ---------------- Cột trái: danh mục bài viết ---------------- */}
        <div className="min-w-0">
          <p className="mb-3 flex items-center gap-2 text-[13px] font-bold uppercase text-[#0F172A]">
            <List className="size-4 text-[#2563EB]" /> Danh mục bài viết đã quét
            <span className="text-[#2563EB]">({nf(postTotal)})</span>
          </p>
          <div className="space-y-2 rounded-xl border border-[#F1F5F9] bg-[#F8FAFC] p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#94A3B8]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm kiếm nội dung, ID bài viết, nhóm..."
                className="h-9 w-full rounded-lg border border-[#E2E8F0] bg-white pl-9 pr-3 text-[13px] outline-none focus:border-[#2563EB]"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <CustomSelect value={source} onChange={setSource} options={SOURCE_OPTIONS} size="sm" />
              <CustomSelect value={sort} onChange={setSort} options={SORT_OPTIONS} size="sm" />
            </div>
          </div>
          <div className="mt-3 max-h-[640px] space-y-3 overflow-y-auto pr-1">
            {loadingPosts && !posts.length ? (
              <p className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
                <Loader2 className="size-4 animate-spin" /> Đang tải…
              </p>
            ) : posts.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-[13px] leading-6 text-slate-400">
                {debSearch || source !== "all" ? "Không có bài viết nào khớp bộ lọc." : emptyText ||
                  "Chưa có dữ liệu bài viết tương tác nào được lưu trữ. Vui lòng sử dụng tính năng 'Quét tài khoản tương tác' để thu thập."}
              </p>
            ) : (
              posts.map((p) => (
                <PostCard key={p.post_key} post={p} active={p.post_key === selectedKey} onSelect={() => setSelectedKey(p.post_key)}
                  onDelete={allowDelete ? () => removePost(p) : null} />
              ))
            )}
          </div>
        </div>

        {/* ---------------- Cột phải: chi tiết bài đang chọn ---------------- */}
        <div className="min-w-0 space-y-4">
          {post ? (
            <div className="rounded-xl border border-[#E2E8F0] bg-white px-5 py-4">
              <p className="line-clamp-2 break-words text-[15px] font-bold text-[#0F172A]" title={post.content}>
                {post.content || "(Bài viết không có nội dung chữ)"}
              </p>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[#64748B]">
                <span>
                  Nguồn: {SOURCE_TEXT[post.source_type] || "—"} <span className="text-[#334155]">“{post.source_name || "—"}”</span>
                </span>
                {post.posted_at && <span>• Đăng: {post.posted_at}</span>}
                {post.scanned_at && <span>• Quét: {post.scanned_at}</span>}
              </p>
              <a href={post.post_url} target="_blank" rel="noreferrer"
                className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-[13px] text-[#2563EB] hover:underline">
                <span className="truncate">{post.post_url.replace(/^https?:\/\/(www\.)?facebook\.com/, "fb.com")}</span>
                <ExternalLink className="size-3.5 shrink-0" />
              </a>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 px-5 py-10 text-center text-[13px] text-slate-400">
              Chọn một bài viết ở cột trái để xem tài khoản đã tương tác.
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              // Like / Bình luận: số đã quét (khớp số dòng của bảng) kèm tổng Facebook của bài
              { id: "like", label: "Tài khoản Like", value: counts.like, hint: `/ ${nf(post?.fb_like_count)} trên Facebook` },
              { id: "share", label: "Lượt chia sẻ", value: counts.share, hint: "Facebook chỉ cho xem tổng số", info: true },
              { id: "comment", label: "Bình luận chi tiết", value: counts.comment, hint: `/ ${nf(post?.fb_comment_count)} trên Facebook` },
            ].map((k) =>
              // Thẻ chia sẻ chỉ hiện tổng số: không có tab danh sách để mở
              k.info ? (
                <div key={k.id} className="rounded-xl border border-[#E2E8F0] bg-white px-5 py-4 text-left">
                  <p className="text-[13px] font-semibold uppercase text-[#475569]">{k.label}</p>
                  <p className="mt-1 text-3xl font-bold tabular-nums text-[#0F172A]">{nf(k.value)}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">{k.hint}</p>
                </div>
              ) : (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setTab(k.id)}
                  className={`rounded-xl border bg-white px-5 py-4 text-left transition-all ${
                    tab === k.id ? "border-[#2563EB] shadow-[0_0_0_1px_#2563EB]" : "border-[#E2E8F0] hover:border-slate-300"
                  }`}
                >
                  <p className={`text-[13px] font-semibold uppercase ${tab === k.id ? "text-[#2563EB]" : "text-[#475569]"}`}>{k.label}</p>
                  <p className={`mt-1 text-3xl font-bold tabular-nums ${tab === k.id ? "text-[#2563EB]" : "text-[#0F172A]"}`}>{nf(k.value)}</p>
                  {post && <p className="mt-0.5 text-[11px] text-slate-400">{k.hint}</p>}
                </button>
              ),
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-xl bg-[#F1F5F9] p-1">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`rounded-lg px-4 py-1.5 text-[13px] font-semibold transition-colors ${
                    tab === t.id ? "bg-[#2563EB] text-white shadow-sm" : "text-[#475569] hover:text-[#0F172A]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
              <CustomSelect value={tier} onChange={setTier} options={TIER_OPTIONS} size="sm" className="w-[150px]" />
              <div className="relative w-full max-w-[280px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#94A3B8]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tab === "comment" ? "Tìm theo UID, tên, comment..." : "Tìm theo UID, tên..."}
                  className="h-9 w-full rounded-lg border border-[#E2E8F0] bg-white pl-9 pr-3 text-[13px] outline-none focus:border-[#2563EB]"
                />
              </div>
            </div>
          </div>

          {data.rows.length > 0 && (
            <p className="-mb-2 text-[11px] text-[#94A3B8]">
              Mẹo: giữ chuột trái và kéo để chọn nhiều tài khoản liên tiếp · Ctrl + click chọn riêng lẻ · Shift + click chọn cả khoảng.
            </p>
          )}
          <div ref={setContainer} className="overflow-x-auto rounded-xl border border-[#E2E8F0]">
            <table className={`w-full text-left text-[13px] ${tab === "comment" ? "min-w-[860px]" : "min-w-[680px]"}`}>
              <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-bold uppercase text-[#475569]">
                <tr>
                  <th className="w-10 px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={allOnPage}
                      ref={(el) => {
                        if (el) el.indeterminate = someOnPage;
                      }}
                      onChange={toggleAllOnPage}
                      className="size-4 cursor-pointer accent-[#2563EB]"
                    />
                  </th>
                  <th className="w-12 px-2 py-3">STT</th>
                  <th className="px-3 py-3">Tên tài khoản</th>
                  <th className="px-3 py-3">Link cá nhân</th>
                  <th className="whitespace-nowrap px-3 py-3">Thời gian</th>
                  {tab === "comment" && <th className="px-3 py-3">Nội dung</th>}
                  <th className="px-3 py-3 text-center">Quan tâm</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {loadingRows && !data.rows.length ? (
                  <tr>
                    <td colSpan={tab === "comment" ? 7 : 6} className="py-12 text-center text-slate-400">
                      <Loader2 className="mx-auto size-5 animate-spin" />
                    </td>
                  </tr>
                ) : data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={tab === "comment" ? 7 : 6} className="px-6 py-12 text-center text-[13px] leading-6 text-slate-400">
                      {post ? emptyRowsText : "—"}
                    </td>
                  </tr>
                ) : (
                  data.rows.map((r, i) => {
                    const checked = selected.has(r.id);
                    const [d, t] = String(r.time || "").split(" ");
                    return (
                      <tr key={r.id} {...rowProps(r, i)}
                        className={`cursor-pointer select-none transition-colors ${checked ? "bg-[#EFF6FF]" : "hover:bg-slate-50/70"}`}>
                        <td className="px-3 py-3 text-center" data-no-row-selection>
                          <input type="checkbox" checked={checked} onChange={() => {
                            const next = new Set(selected);
                            if (next.has(r.id)) next.delete(r.id);
                            else next.add(r.id);
                            setSelected(next);
                          }} className="size-4 cursor-pointer accent-[#2563EB]" />
                        </td>
                        <td className="px-2 py-3 font-mono text-xs text-[#94A3B8]">{String(from + i).padStart(2, "0")}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar url={r.avatar_url} name={r.name} />
                            <span className="min-w-0">
                              <span className="line-clamp-2 font-semibold text-[#0F172A]">{r.name}</span>
                              {tab === "comment" && r.is_reply && <span className="text-[11px] text-slate-400">↳ trả lời</span>}
                            </span>
                            {tab === "like" && <ReactionIcon type={r.reaction} />}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <a href={r.profile_url} target="_blank" rel="noreferrer" data-no-row-selection title={r.profile_url}
                            className="inline-flex items-center gap-1 font-mono text-xs text-[#2563EB] hover:underline">
                            fb.com/{r.uid.length > 12 ? `${r.uid.slice(0, 11)}…` : r.uid}
                            <ExternalLink className="size-3" />
                          </a>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 font-mono text-xs leading-5 text-[#64748B]">
                          {d ? (
                            <>
                              {d.slice(0, 5)}
                              <br />
                              <span className="text-[#94A3B8]">{t || ""}</span>
                            </>
                          ) : "—"}
                        </td>
                        {tab === "comment" && (
                          <td className="max-w-[360px] px-3 py-3 text-[13px] leading-5 text-[#475569]">
                            <span className="line-clamp-3 break-words" title={r.text}>{r.text || "—"}</span>
                          </td>
                        )}
                        <td className="px-3 py-3 text-center">
                          <TierBadge tier={r.tier} title={tierReason(r)} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#F1F5F9] px-4 py-3">
              <p className="text-[13px] text-[#64748B]">
                Hiển thị <b className="text-[#0F172A]">{nf(from)} - {nf(to)}</b> trong tổng số{" "}
                <b className="text-[#0F172A]">{nf(data.total)}</b> {tab === "comment" ? "bình luận" : "tài khoản tương tác"}
                {selected.size > 0 && <span className="ml-2 font-semibold text-[#2563EB]">· Đã chọn {nf(selected.size)}</span>}
              </p>
              <div className="flex items-center gap-3">
                <CustomSelect value={pageSize} onChange={(v) => setPageSize(Number(v))} options={PAGE_SIZES} size="sm" className="w-[120px]" direction="up" />
                <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
              </div>
            </div>
          </div>

          <TierLegend />
        </div>
      </div>

      <ExportModal
        open={exportOpen}
        onOpenChange={setExportOpen}
        post={post}
        postKeys={posts.map((p) => p.post_key)}
        tab={tab}
        search={debQuery}
        tier={tier === "all" ? null : Number(tier)}
        selectedRows={selectedRows}
      />
    </section>
  );
}
