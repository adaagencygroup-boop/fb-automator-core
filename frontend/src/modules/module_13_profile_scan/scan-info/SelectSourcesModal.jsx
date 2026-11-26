"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Flag, Loader2, MessageSquareText, Network, Search, Signpost, ThumbsUp, Users, X, Zap } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/lib/toast";
import useDragRowSelect from "@/modules/module_11_page_scanner/shared/useDragRowSelect";
import ProfileAvatar from "../shared/ProfileAvatar";
import { loadGroupSource, loadPageListKeys, loadPageSource, loadPostSource, loadSourceProfiles, loadSourceStats, loadTopProfiles } from "../service";
import { fmtNum, sourceKey, summarizeSources } from "../utils.mjs";

const PAGE_SIZE = 50; // mỗi lần cuộn tới cuối danh sách thì tải thêm
const MAX_QUICK = 5000;
const ALL = "__ALL__";
const AVATARS = ["bg-[#2563EB]", "bg-[#4F46E5]", "bg-[#DB2777]", "bg-[#0D9488]", "bg-[#D97706]"];

const TYPES = {
  group: {
    tab: "Từ Nhóm Facebook", icon: Users, noun: "nhóm", Noun: "Nhóm", unit: "tv", person: "thành viên",
    active: "bg-[#2563EB] text-white", badge: "bg-[#DBEAFE] text-[#1E40AF]", load: loadGroupSource,
  },
  page: {
    tab: "Từ Fanpage", icon: Flag, noun: "Page", Noun: "Page", unit: "theo dõi", person: "follower",
    active: "bg-[#F59E0B] text-white", badge: "bg-[#FEF3C7] text-[#92400E]", load: loadPageSource,
  },
  post: {
    tab: "Từ Bài viết tương tác", icon: Signpost, noun: "bài viết", Noun: "Bài viết", unit: "tương tác", person: "người tương tác",
    active: "bg-[#7C3AED] text-white", badge: "bg-[#F3E8FF] text-[#6B21A8]",
  },
};

/** Figma 3388:2971 / 3388:4291 / 3388:3610 — chọn profile từ Nhóm, Page, Bài viết */
export default function SelectSourcesModal({ open, ...props }) {
  if (!open) return null;
  return createPortal(<Body {...props} />, document.body);
}

function SearchBox({ value, onChange, placeholder, soft }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#94A3B8]" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`h-[30px] w-full rounded-lg border pl-8 pr-3 text-xs outline-none placeholder:text-[#94A3B8] focus:border-[#2563EB] ${soft ? "border-[#E2E8F0] bg-[#F8FAFC]" : "border-[#737686] bg-white"}`}
      />
    </div>
  );
}

const Empty = ({ children }) => <p className="px-3 py-10 text-center text-xs leading-5 text-[#94A3B8]">{children}</p>;

function Body({ value, onConfirm, onClose }) {
  const [tab, setTab] = useState("group");
  const [draft, setDraft] = useState(value || {});
  const sum = useMemo(() => summarizeSources(draft), [draft]);

  // Mỗi nguồn tải 1 lần khi mở modal: dùng cho badge tổng trên tab và nội dung tab
  const loaders = useMemo(() => {
    const once = (fn) => {
      let p = null;
      return () => {
        if (!p) p = fn().catch((err) => { p = null; throw err; });
        return p;
      };
    };
    return { group: once(loadGroupSource), page: once(loadPageSource), post: once(() => loadPostSource()) };
  }, []);
  const [totals, setTotals] = useState({});
  useEffect(() => {
    let ignore = false;
    Object.entries(loaders).forEach(([id, load]) =>
      load()
        .then((r) => !ignore && setTotals((p) => ({ ...p, [id]: (Array.isArray(r) ? r : r.items).length })))
        .catch(() => {}),
    );
    return () => {
      ignore = true;
    };
  }, [loaders]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const updateSource = (type, item, change) =>
    setDraft((prev) => {
      const key = sourceKey(type, item.id);
      const profiles = change(prev[key]?.profiles || {});
      const next = { ...prev };
      if (Object.keys(profiles).length) {
        next[key] = { type, id: item.id, name: item.name, url: item.url, scale: item.scale, scaleLabel: item.scaleLabel, profiles };
      } else {
        delete next[key];
      }
      return next;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Chọn Profile từ Nhóm, Page hoặc Bài viết" className="flex h-[825px] max-h-[calc(100vh-32px)] w-full max-w-[1152px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-[#F1F5F9] px-6 py-2.5">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-[#2563EB] text-white"><Network className="size-4" /></span>
              <h3 className="text-lg font-bold tracking-tight text-[#0F172A]">Chọn Profile từ Nhóm, Page hoặc Bài viết</h3>
            </div>
            <p className="mt-1 text-xs text-[#64748B]">Lựa chọn các đối tượng từ hệ thống dữ liệu đã quét, tích chọn từng profile cá nhân hoặc nhập nhanh số lượng mục tiêu lấy từ trên xuống.</p>
          </div>
          <button type="button" aria-label="Đóng" onClick={onClose} className="rounded-lg p-1.5 text-[#94A3B8] hover:bg-slate-100"><X className="size-5" /></button>
        </div>

        <div role="tablist" className="flex shrink-0 gap-4 overflow-x-auto bg-[#F8FAFC] px-5 pt-3">
          {Object.entries(TYPES).map(([id, t]) => {
            const on = id === tab;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(id)}
                className={`flex shrink-0 items-center gap-2 rounded-t-xl border-b-2 px-4 py-2.5 text-xs font-medium ${on ? "border-[#2563EB] bg-white text-[#2563EB]" : "border-transparent text-[#475569] hover:text-[#2563EB]"}`}
              >
                <t.icon className={`size-4 ${on ? "" : "text-[#94A3B8]"}`} />
                <span title={totals[id] != null ? `Tổng ${fmtNum(totals[id])} ${t.noun.toLowerCase()} đã quét` : undefined}>
                  {t.tab}
                  {totals[id] != null && ` (${fmtNum(totals[id])})`}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${on ? "bg-[#EFF6FF] text-[#1D4ED8]" : "bg-[#E2E8F0] text-[#334155]"}`}>Đã chọn: {sum[id]} profile</span>
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1">
          {tab === "post" ? <PostTab loadAll={loaders.post} draft={draft} updateSource={updateSource} /> : <SourceTab key={tab} type={tab} load={loaders[tab]} draft={draft} updateSource={updateSource} />}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#F1F5F9] px-6 py-4">
          <div>
            <p className="flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-[#64748B]">
              Tổng cộng đã chọn: <b className="text-2xl text-[#2563EB]">{fmtNum(sum.total)}</b> <span className="font-bold text-[#2563EB]">Profile</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-semibold">
              <span className="inline-flex items-center gap-1 rounded-md bg-[#EFF6FF] px-2.5 py-1 text-[#1E40AF]"><Users className="size-3.5" /> Nhóm: {sum.group} profile ({sum.groupCount} nhóm)</span>
              <span className="inline-flex items-center gap-1 rounded-md bg-[#FFFBEB] px-2.5 py-1 text-[#92400E]"><Flag className="size-3.5" /> Page: {sum.page} profile ({sum.pageCount} page)</span>
              <span className="inline-flex items-center gap-1 rounded-md bg-[#FAF5FF] px-2.5 py-1 text-[#6B21A8]"><Signpost className="size-3.5" /> Bài viết: {sum.post} profile</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button type="button" onClick={onClose} className="px-3 py-2 text-xs font-semibold text-[#475569] hover:text-[#0F172A]">Hủy bỏ</button>
            <button
              type="button"
              disabled={!sum.total && !Object.keys(value || {}).length}
              onClick={() => onConfirm(draft)}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[#2563EB] px-6 text-xs font-bold text-white shadow-lg shadow-blue-500/25 hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              <Check className="size-4" /> Xác nhận & Thêm {fmtNum(sum.total)} Profile vào danh sách quét
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Mỗi nguồn → { total, scanned }: số profile đã quét thông tin ở Module 13 / tổng số người đã thu thập */
function useSourceStats(type) {
  const [stats, setStats] = useState({});
  useEffect(() => {
    let ignore = false;
    loadSourceStats(type)
      .then((s) => !ignore && setStats(s))
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, [type]);
  return stats;
}

/** "Đã quét X/Y profile"; chưa có thống kê (API lỗi / backend cũ) thì hiện số người đã thu thập của nguồn */
const ScannedOf = ({ stat, fallback, on }) => {
  const cls = `inline-flex items-center gap-1 ${on ? "text-[#059669]" : ""}`;
  if (stat) {
    return (
      <span title="Số profile đã quét thông tin / tổng số profile đã thu thập từ nguồn" className={cls}>
        <Zap className="size-3 fill-current" /> Đã quét {fmtNum(stat.scanned)}/{fmtNum(stat.total)} profile
      </span>
    );
  }
  if (fallback == null) return null;
  return (
    <span title="Số profile đã thu thập từ nguồn" className={cls}>
      <Zap className="size-3 fill-current" /> Đã quét {fmtNum(fallback)}
    </span>
  );
};

function SourceTab({ type, load, draft, updateSource }) {
  const t = TYPES[type];
  const stats = useSourceStats(type);
  const [data, setData] = useState({ items: [], categories: [] });
  const [loading, setLoading] = useState(true);
  const [catSearch, setCatSearch] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [cat, setCat] = useState(ALL);
  const [listKeys, setListKeys] = useState({}); // danh mục page → Set(page_key)
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    let ignore = false;
    load()
      .then((res) => !ignore && setData(res))
      .catch((err) => !ignore && toast.error(`Lỗi tải danh sách ${t.noun}: ${err.message}`))
      .finally(() => !ignore && setLoading(false));
    return () => {
      ignore = true;
    };
  }, [t, load]);

  useEffect(() => {
    if (type !== "page" || cat === ALL || listKeys[cat]) return undefined;
    let ignore = false;
    loadPageListKeys(cat)
      .then((keys) => !ignore && setListKeys((p) => ({ ...p, [cat]: keys })))
      .catch((err) => {
        if (ignore) return;
        toast.error(`Lỗi tải danh mục: ${err.message}`);
        setListKeys((p) => ({ ...p, [cat]: new Set() }));
      });
    return () => {
      ignore = true;
    };
  }, [type, cat, listKeys]);

  const catLoading = type === "page" && cat !== ALL && !listKeys[cat];
  const items = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    return data.items.filter((i) => {
      if (cat !== ALL && (type === "group" ? i.categoryId !== cat : !listKeys[cat]?.has(i.id))) return false;
      return !q || `${i.name} ${i.id}`.toLowerCase().includes(q);
    });
  }, [data.items, cat, type, listKeys, itemSearch]);

  const active = data.items.find((i) => i.id === activeId) || null;
  const categories = [{ id: ALL, name: `Tất cả ${t.noun}` }, ...data.categories].filter(
    (c) => c.id === ALL || c.name.toLowerCase().includes(catSearch.trim().toLowerCase()),
  );
  const catCount = (id) => {
    if (id === ALL) return data.items.length;
    if (type === "group") return data.items.filter((i) => i.categoryId === id).length;
    return listKeys[id] ? data.items.filter((i) => listKeys[id].has(i.id)).length : null;
  };

  return (
    <div className="grid h-full grid-cols-1 overflow-y-auto md:grid-cols-[260px_minmax(0,1fr)] lg:grid-cols-[288px_384px_minmax(0,1fr)] lg:overflow-hidden">
      <div className="flex min-h-0 flex-col gap-2.5 p-3.5">
        <SearchBox value={catSearch} onChange={setCatSearch} placeholder={`Tìm danh mục ${t.noun}...`} />
        <p className="px-1 text-[11px] font-bold uppercase tracking-wide text-[#94A3B8]">Danh mục {t.noun} đã quét ({data.categories.length})</p>
        <div className="max-h-52 min-h-0 flex-1 overflow-y-auto lg:max-h-none">
          {categories.map((c) => {
            const on = c.id === cat;
            const n = catCount(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCat(c.id)}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left ${on ? "bg-[#EFF6FF] text-[#1E40AF]" : "text-[#334155] hover:bg-slate-50"}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold">{c.name}</span>
                  {n != null && <span className={`mt-0.5 block text-[11px] ${on ? "text-[#2563EB]" : "text-[#94A3B8]"}`}>{n} {t.noun}</span>}
                </span>
                <ChevronRight className={`size-4 shrink-0 ${on ? "text-[#2563EB]" : "text-[#CBD5E1]"}`} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-2.5 border-x border-[#F1F5F9] bg-[#F8FAFC] p-3.5">
        <p className="truncate text-xs font-bold text-[#0F172A]">
          {t.Noun} trong: {data.categories.find((c) => c.id === cat)?.name || `Tất cả ${t.noun}`} ({items.length})
        </p>
        <SearchBox value={itemSearch} onChange={setItemSearch} placeholder={`Tìm tên ${t.noun}, UID ${t.noun}...`} />
        <div className="max-h-72 min-h-0 flex-1 space-y-2 overflow-y-auto lg:max-h-none">
          {loading || catLoading ? (
            <Loader2 className="mx-auto mt-10 size-5 animate-spin text-[#2563EB]" />
          ) : items.length === 0 ? (
            <Empty>{data.items.length ? `Không có ${t.noun} phù hợp.` : `Chưa có ${t.noun} nào đã quét.`}</Empty>
          ) : (
            items.map((i) => {
              const on = i.id === activeId;
              const n = Object.keys(draft[sourceKey(type, i.id)]?.profiles || {}).length;
              const stat = stats[i.id];
              return (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => setActiveId(i.id)}
                  className={`w-full rounded-xl border bg-white p-3 text-left ${on ? "border-[#BFDBFE] shadow-sm" : "border-transparent hover:border-[#E2E8F0]"}`}
                >
                  <span className="flex items-start gap-2">
                    <ProfileAvatar src={i.avatar} name={i.name} className="size-8 rounded-lg" tint={n ? t.active : "bg-[#F1F5F9] text-[#475569]"}><t.icon className="size-4" /></ProfileAvatar>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-xs text-[#0F172A] ${on ? "font-bold" : "font-semibold"}`}>{i.name}</span>
                      <span className="block truncate text-[11px] text-[#94A3B8]">UID: {i.id}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${n ? t.badge : "bg-[#F1F5F9] text-[#64748B]"}`}>{n ? `Đã chọn ${fmtNum(n)}${stat ? `/${fmtNum(stat.total)}` : ""}` : "Chưa chọn"}</span>
                  </span>
                  <span className="mt-2.5 flex justify-between border-t border-[#F1F5F9] pt-2 text-[11px] text-[#64748B]">
                    <span>Quy mô: <b className="text-[#334155]">{i.scale != null ? `${fmtNum(i.scale)} ${t.unit}` : i.scaleLabel || "—"}</b></span>
                    <ScannedOf stat={stat} fallback={i.scanned} on={n > 0} />
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="min-h-0 md:col-span-2 lg:col-span-1">
        {active ? (
          <ProfilePicker
            key={active.id}
            type={type}
            item={active}
            selected={draft[sourceKey(type, active.id)]?.profiles || {}}
            onChange={(fn) => updateSource(type, active, fn)}
            stat={stats[active.id]}
          />
        ) : (
          <Empty>Chọn một {t.noun} để xem profile đã quét.</Empty>
        )}
      </div>
    </div>
  );
}

function ProfilePicker({ type, item, selected, onChange, stat, tab }) {
  const t = TYPES[type];
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [full, setFull] = useState(null); // tổng khi không tìm kiếm
  const [loading, setLoading] = useState(true);
  const [quick, setQuick] = useState(50);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const next = input.trim();
    if (next === search) return undefined;
    const id = setTimeout(() => {
      setSearch(next);
      setRows([]);
      setPage(1);
    }, 350);
    return () => clearTimeout(id);
  }, [input, search]);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    loadSourceProfiles(type, item.id, { page, pageSize: PAGE_SIZE, search, tab })
      .then((r) => {
        if (ignore) return;
        setRows((prev) => {
          if (page === 1) return r.items;
          const have = new Set(prev.map((p) => p.uid));
          return [...prev, ...r.items.filter((p) => !have.has(p.uid))];
        });
        setTotal(r.total);
        if (!search) setFull(r.total);
      })
      .catch((err) => !ignore && toast.error(`Lỗi tải profile: ${err.message}`))
      .finally(() => !ignore && setLoading(false));
    return () => {
      ignore = true;
    };
  }, [type, item.id, tab, search, page]);

  const hasMore = rows.length < total;
  const [list, setList] = useState(null);
  const listRef = useCallback((el) => setList(el), []);
  const more = useCallback(() => {
    if (!list || loading || !hasMore) return;
    // Gần cuối danh sách (hoặc danh sách chưa đủ dài để cuộn) → tải thêm
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - 120) setPage((p) => p + 1);
  }, [list, loading, hasMore]);
  useEffect(() => {
    more();
  }, [more, rows]);

  const fresh = rows.filter((p) => !p.scanned); // chọn hàng loạt chỉ lấy người chưa quét
  const allShown = fresh.length > 0 && fresh.every((p) => selected[p.uid]);
  const toggle = (list, on) =>
    onChange((cur) => {
      const next = { ...cur };
      list.forEach((p) => {
        if (on) next[p.uid] = p;
        else delete next[p.uid];
      });
      return next;
    });

  const drag = useDragRowSelect({
    ids: rows.map((p) => p.uid),
    isSelected: (uid) => Boolean(selected[uid]),
    onSet: (uids) => {
      const on = new Set(uids);
      onChange((cur) => {
        const next = { ...cur };
        rows.forEach((p) => {
          if (on.has(String(p.uid))) next[p.uid] = p;
          else delete next[p.uid];
        });
        return next;
      });
    },
    onToggle: (uid) => toggle(rows.filter((p) => String(p.uid) === uid), !selected[uid]),
  });

  const applyQuick = async () => {
    setApplying(true);
    try {
      const top = await loadTopProfiles(type, item.id, quick, search, tab);
      // Bài viết: tab Like và Bình luận chung 1 nguồn → lấy nhanh ở tab này không bỏ người đã chọn ở tab kia
      onChange((cur) => ({ ...(tab ? cur : {}), ...Object.fromEntries(top.map((p) => [p.uid, p])) }));
      if (top.length < quick) toast.warning(`Chỉ còn ${fmtNum(top.length)} profile chưa quét thông tin.`);
    } catch (err) {
      toast.error(`Không lấy được profile: ${err.message}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-2.5 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-bold text-[#0F172A]">{item.name}</p>
          <p className="mt-1 truncate text-[11px] text-[#94A3B8]">
            {type === "post" ? "Post" : "UID"}: {item.fb_post_id || item.id}
            {full != null &&
              ` • ${fmtNum(full)}${type !== "post" && item.scale ? `/${fmtNum(item.scale)}` : ""} ${type === "page" ? "followers" : type === "post" ? (tab === "comment" ? "người bình luận" : "người like") : "thành viên"}`}
            {stat && ` • Đã quét ${fmtNum(stat.scanned)}/${fmtNum(stat.total)} profile`}
          </p>
        </div>
        <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-bold ${type === "page" ? "bg-[#FFFBEB] text-[#B45309]" : "bg-[#EFF6FF] text-[#2563EB]"}`}>Đang tick: {fmtNum(Object.keys(selected).length)} profile</span>
      </div>
      <div className="rounded-lg bg-[#F8FAFC] p-2">
        <div className="flex items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-[#334155]">
            <Checkbox checked={allShown} disabled={!fresh.length} onCheckedChange={(c) => toggle(c ? fresh : rows, c)} />
            Chọn tất cả đang hiển thị
          </label>
          <span className="text-[11px] italic text-[#94A3B8]">hoặc nhập số lượng lấy nhanh</span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-white px-2 py-1 text-xs text-[#64748B]">
            Lấy nhanh
            <input
              inputMode="numeric"
              value={quick}
              onChange={(e) => setQuick(Math.min(MAX_QUICK, Number(e.target.value.replace(/\D/g, "")) || 0))}
              className="w-14 rounded bg-[#EFF6FF] px-2 py-0.5 text-center font-bold text-[#2563EB] outline-none focus:ring-1 focus:ring-[#2563EB]"
            />
            <span className="truncate">{t.person} chưa quét, từ trên xuống</span>
          </label>
          <button type="button" disabled={applying || !quick || !total} onClick={applyQuick} className="inline-flex h-6 items-center gap-1 rounded-md bg-[#2563EB] px-3 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50">
            {applying && <Loader2 className="size-3 animate-spin" />} Áp dụng
          </button>
        </div>
      </div>
      <SearchBox soft value={input} onChange={setInput} placeholder={`Tìm tên, UID ${t.person}...`} />
      <div
        ref={(el) => {
          drag.setContainer(el);
          listRef(el);
        }}
        onScroll={more}
        className="min-h-[160px] flex-1 select-none space-y-1.5 overflow-y-auto border-t border-[#F1F5F9] pt-2"
      >
        {loading && rows.length === 0 ? (
          <Loader2 className="mx-auto mt-10 size-5 animate-spin text-[#2563EB]" />
        ) : rows.length === 0 ? (
          <Empty>{search ? "Không tìm thấy profile phù hợp." : `${t.Noun} này chưa quét ${t.person} nào.`}</Empty>
        ) : (
          rows.map((p, i) => (
            <div key={p.uid} {...drag.rowProps(p.uid)} className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-[#EFF6FF] ${selected[p.uid] ? "bg-[#EFF6FF]" : "bg-[#F8FAFF]"}`}>
              <Checkbox checked={Boolean(selected[p.uid])} onCheckedChange={(c) => toggle([p], c)} />
              <span className="w-7 shrink-0 text-right font-mono text-[11px] text-[#94A3B8]">{String(i + 1).padStart(2, "0")}</span>
              <ProfileAvatar src={p.avatar} name={p.name} tint={`text-white ${AVATARS[i % AVATARS.length]}`} />
              <span className="min-w-0">
                <span className="block truncate text-xs font-bold text-[#0F172A]">{p.name}</span>
                <span className="block truncate font-mono text-[11px] text-[#94A3B8]">UID: {p.uid}</span>
              </span>
              {p.scanned && (
                <span title="Profile này đã được quét thông tin trước đó" className="ml-auto shrink-0 rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-2 py-0.5 text-[10px] font-semibold text-[#047857]">Đã quét</span>
              )}
            </div>
          ))
        )}
        {loading && rows.length > 0 && <Loader2 className="mx-auto my-2 size-4 animate-spin text-[#2563EB]" />}
      </div>
      <div className="border-t border-[#F1F5F9] pt-2 text-[11px] text-[#64748B]">
        Đã hiển thị {fmtNum(rows.length)} / {fmtNum(total)} profile{hasMore ? " — cuộn xuống để xem thêm" : ""}
      </div>
    </div>
  );
}

/** Bài viết đã quét người tương tác ở Module 12: chọn bài → chọn người like / bình luận */
function PostTab({ loadAll, draft, updateSource }) {
  const t = TYPES.post;
  const stats = useSourceStats("post");
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [res, setRes] = useState({ items: [], query: null });
  const [activeId, setActiveId] = useState(null);
  const [tab, setTab] = useState("like");

  useEffect(() => {
    const id = setTimeout(() => setSearch(input.trim()), 350);
    return () => clearTimeout(id);
  }, [input]);

  useEffect(() => {
    let ignore = false;
    (search ? loadPostSource(search) : loadAll())
      .then((items) => !ignore && setRes({ items, query: search }))
      .catch((err) => {
        if (ignore) return;
        toast.error(`Lỗi tải danh sách bài viết: ${err.message}`);
        setRes({ items: [], query: search });
      });
    return () => {
      ignore = true;
    };
  }, [search, loadAll]);

  const loading = res.query !== search;
  const posts = loading ? [] : res.items;
  const active = res.items.find((p) => p.id === activeId) || null;
  const tabs = [
    { id: "like", label: "Like", icon: ThumbsUp, iconClass: "fill-current", count: active?.likes },
    { id: "comment", label: "Bình luận", icon: MessageSquareText, iconClass: "text-[#059669]", count: active?.comments },
  ];

  return (
    <div className="grid h-full grid-cols-1 overflow-y-auto md:grid-cols-[384px_minmax(0,1fr)] md:overflow-hidden">
      <div className="flex min-h-0 flex-col gap-2.5 border-r border-[#F1F5F9] bg-[#F8FAFC] p-3.5">
        <SearchBox value={input} onChange={setInput} placeholder="Tìm nội dung bài viết, Post ID, nhóm / page..." />
        <p className="px-1 text-[11px] font-bold uppercase tracking-wide text-[#94A3B8]">Bài viết đã quét tương tác ({fmtNum(posts.length)})</p>
        <div className="max-h-72 min-h-0 flex-1 space-y-2 overflow-y-auto md:max-h-none">
          {loading ? (
            <Loader2 className="mx-auto mt-10 size-5 animate-spin text-[#2563EB]" />
          ) : posts.length === 0 ? (
            <Empty>{search ? "Không có bài viết phù hợp." : "Chưa có bài viết nào đã quét tương tác. Hãy quét người tương tác ở chức năng “Quét tài khoản từ bài viết” trước."}</Empty>
          ) : (
            posts.map((p) => {
              const on = p.id === activeId;
              const n = Object.keys(draft[sourceKey("post", p.id)]?.profiles || {}).length;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActiveId(p.id)}
                  className={`w-full rounded-xl border bg-white p-3 text-left ${on ? "border-[#BFDBFE] shadow-sm" : "border-transparent hover:border-[#E2E8F0]"}`}
                >
                  <span className="flex items-start gap-2">
                    <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${n ? t.active : "bg-[#F1F5F9] text-[#475569]"}`}><Signpost className="size-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className={`line-clamp-2 text-xs text-[#0F172A] ${on ? "font-bold" : "font-semibold"}`}>{p.name}</span>
                      <span className="block truncate text-[11px] text-[#94A3B8]">{p.source_name || p.author_name || p.fb_post_id || p.id}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${n ? t.badge : "bg-[#F1F5F9] text-[#64748B]"}`}>{n ? `Đã chọn ${fmtNum(n)}` : "Chưa chọn"}</span>
                  </span>
                  <span className="mt-2.5 flex gap-3 border-t border-[#F1F5F9] pt-2 text-[11px] text-[#64748B]">
                    <span className="inline-flex items-center gap-1"><ThumbsUp className="size-3" /> {fmtNum(p.likes || 0)} like</span>
                    <span className="inline-flex items-center gap-1"><MessageSquareText className="size-3" /> {fmtNum(p.comments || 0)} bình luận</span>
                    <span className="ml-auto"><ScannedOf stat={stats[p.id]} on={n > 0} /></span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-col p-3.5">
        <div role="tablist" className="flex gap-1 rounded-lg bg-[#F1F5F9] p-1 text-xs font-semibold">
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={tab === x.id}
              onClick={() => setTab(x.id)}
              className={`inline-flex w-36 items-center gap-1.5 rounded-md px-2.5 py-2.5 ${tab === x.id ? "bg-white text-[#2563EB] shadow-sm" : "text-[#475569] hover:text-[#0F172A]"}`}
            >
              <x.icon className={`size-3.5 ${x.iconClass}`} /> {x.label} ({fmtNum(x.count || 0)})
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">
          {active ? (
            <ProfilePicker
              key={`${active.id}|${tab}`}
              type="post"
              tab={tab}
              item={active}
              selected={draft[sourceKey("post", active.id)]?.profiles || {}}
              onChange={(fn) => updateSource("post", active, fn)}
              stat={stats[active.id]}
            />
          ) : (
            <Empty>Chọn một bài viết bên trái để xem người đã like / bình luận.</Empty>
          )}
        </div>
      </div>
    </div>
  );
}
