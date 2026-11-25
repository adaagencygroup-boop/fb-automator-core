"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Flag, Loader2, MessageSquareText, Network, Search, Signpost, ThumbsUp, Users, X, Zap } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/lib/toast";
import { Pager } from "@/modules/module_11_page_scanner/_shared";
import useDragRowSelect from "@/modules/module_11_page_scanner/shared/useDragRowSelect";
import ProfileAvatar from "../shared/ProfileAvatar";
import { loadGroupSource, loadPageListKeys, loadPageSource, loadSourceProfiles, loadTopProfiles } from "../service";
import { fmtNum, sourceKey, summarizeSources } from "../utils.mjs";

const PAGE_SIZE = 20;
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
  post: { tab: "Từ Bài viết tương tác", icon: Signpost, noun: "bài viết" },
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

        <div role="tablist" className="flex shrink-0 gap-2 overflow-x-auto bg-[#F8FAFC] px-5 pt-3">
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
                {t.tab}
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${on ? "bg-[#EFF6FF] text-[#1D4ED8]" : "bg-[#E2E8F0] text-[#334155]"}`}>Đã chọn: {sum[id]} profile</span>
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1">
          {tab === "post" ? <PostTab /> : <SourceTab key={tab} type={tab} draft={draft} updateSource={updateSource} />}
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

function SourceTab({ type, draft, updateSource }) {
  const t = TYPES[type];
  const [data, setData] = useState({ items: [], categories: [] });
  const [loading, setLoading] = useState(true);
  const [catSearch, setCatSearch] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [cat, setCat] = useState(ALL);
  const [listKeys, setListKeys] = useState({}); // danh mục page → Set(page_key)
  const [activeId, setActiveId] = useState(null);
  const [counts, setCounts] = useState({}); // nhóm → số thành viên đã quét

  useEffect(() => {
    let ignore = false;
    t.load()
      .then((res) => !ignore && setData(res))
      .catch((err) => !ignore && toast.error(`Lỗi tải danh sách ${t.noun}: ${err.message}`))
      .finally(() => !ignore && setLoading(false));
    return () => {
      ignore = true;
    };
  }, [t]);

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
              const scanned = i.scanned ?? counts[i.id];
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
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${n ? t.badge : "bg-[#F1F5F9] text-[#64748B]"}`}>{n ? `Đã chọn ${fmtNum(n)}${scanned != null ? `/${fmtNum(scanned)}` : ""}` : "Chưa chọn"}</span>
                  </span>
                  <span className="mt-2.5 flex justify-between border-t border-[#F1F5F9] pt-2 text-[11px] text-[#64748B]">
                    <span>Quy mô: <b className="text-[#334155]">{i.scale != null ? `${fmtNum(i.scale)} ${t.unit}` : i.scaleLabel || "—"}</b></span>
                    {scanned != null && <span className={`inline-flex items-center gap-1 ${n ? "text-[#059669]" : ""}`}><Zap className="size-3 fill-current" /> Đã quét {fmtNum(scanned)}</span>}
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
            onTotal={(n) => setCounts((p) => (p[active.id] === n ? p : { ...p, [active.id]: n }))}
          />
        ) : (
          <Empty>Chọn một {t.noun} để xem profile đã quét.</Empty>
        )}
      </div>
    </div>
  );
}

function ProfilePicker({ type, item, selected, onChange, onTotal }) {
  const t = TYPES[type];
  const [page, setPage] = useState(1);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [res, setRes] = useState({ items: [], total: 0, full: null, query: null });
  const [quick, setQuick] = useState(50);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(input.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(id);
  }, [input]);

  const query = `${page}|${search}`;
  useEffect(() => {
    let ignore = false;
    loadSourceProfiles(type, item.id, { page, pageSize: PAGE_SIZE, search })
      .then((r) => {
        if (ignore) return;
        setRes((prev) => ({ ...r, full: search ? prev.full : r.total, query }));
        if (!search) onTotal(r.total);
      })
      .catch((err) => {
        if (ignore) return;
        toast.error(`Lỗi tải profile: ${err.message}`);
        setRes((prev) => ({ ...prev, items: [], total: 0, query }));
      });
    return () => {
      ignore = true;
    };
    // onTotal đổi mỗi lần render — không đưa vào deps để tránh tải lại
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, item.id, query]);

  const loading = res.query !== query;
  const rows = loading ? [] : res.items;
  const fresh = rows.filter((p) => !p.scanned); // chọn hàng loạt chỉ lấy người chưa quét
  const allOnPage = fresh.length > 0 && fresh.every((p) => selected[p.uid]);
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
      const top = await loadTopProfiles(type, item.id, quick, search);
      onChange(() => Object.fromEntries(top.map((p) => [p.uid, p])));
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
          <p className="mt-1 truncate text-[11px] text-[#94A3B8]">UID: {item.id}{res.full != null && ` • ${fmtNum(res.full)} ${type === "page" ? "followers" : "profile"} đã quét`}</p>
        </div>
        <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-bold ${type === "page" ? "bg-[#FFFBEB] text-[#B45309]" : "bg-[#EFF6FF] text-[#2563EB]"}`}>Đang tick: {fmtNum(Object.keys(selected).length)} profile</span>
      </div>
      <div className="rounded-lg bg-[#F8FAFC] p-2">
        <div className="flex items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-[#334155]">
            <Checkbox checked={allOnPage} disabled={!fresh.length} onCheckedChange={(c) => toggle(c ? fresh : rows, c)} />
            Chọn tất cả trang này
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
          <button type="button" disabled={applying || !quick || !res.total} onClick={applyQuick} className="inline-flex h-6 items-center gap-1 rounded-md bg-[#2563EB] px-3 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50">
            {applying && <Loader2 className="size-3 animate-spin" />} Áp dụng
          </button>
        </div>
      </div>
      <SearchBox soft value={input} onChange={setInput} placeholder={`Tìm tên, UID ${t.person}...`} />
      <div ref={drag.setContainer} className="min-h-[160px] flex-1 select-none space-y-1.5 overflow-y-auto border-t border-[#F1F5F9] pt-2">
        {loading ? (
          <Loader2 className="mx-auto mt-10 size-5 animate-spin text-[#2563EB]" />
        ) : rows.length === 0 ? (
          <Empty>{search ? "Không tìm thấy profile phù hợp." : `${t.Noun} này chưa quét ${t.person} nào.`}</Empty>
        ) : (
          rows.map((p, i) => (
            <div key={p.uid} {...drag.rowProps(p.uid)} className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-[#EFF6FF] ${selected[p.uid] ? "bg-[#EFF6FF]" : "bg-[#F8FAFF]"}`}>
              <Checkbox checked={Boolean(selected[p.uid])} onCheckedChange={(c) => toggle([p], c)} />
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
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#F1F5F9] pt-2 text-[11px] text-[#64748B]">
        <span>Hiển thị {rows.length ? (page - 1) * PAGE_SIZE + 1 : 0} - {(page - 1) * PAGE_SIZE + rows.length} trong {fmtNum(res.total)} profile</span>
        {res.total > PAGE_SIZE && <Pager page={page} totalPages={Math.ceil(res.total / PAGE_SIZE)} onChange={setPage} />}
      </div>
    </div>
  );
}

/** Chưa có kho người tương tác bài viết → giữ khung theo Figma, không có dữ liệu để chọn */
function PostTab() {
  return (
    <div className="grid h-full grid-cols-1 overflow-y-auto md:grid-cols-[384px_minmax(0,1fr)]">
      <div className="border-r border-[#F1F5F9] bg-[#F8FAFC] p-3.5">
        <SearchBox value="" onChange={() => {}} placeholder="Tìm tên bài viết, Post ID..." />
        <Empty>Chưa có bài viết nào đã quét tương tác.</Empty>
      </div>
      <div className="p-3.5">
        <div className="flex gap-1 rounded-lg bg-[#F1F5F9] p-1 text-xs font-semibold">
          <span className="inline-flex w-36 items-center gap-1.5 rounded-md bg-white px-2.5 py-2.5 text-[#2563EB] shadow-sm"><ThumbsUp className="size-3.5 fill-current" /> Like (0)</span>
          <span className="inline-flex w-36 items-center gap-1.5 px-2.5 py-2.5 text-[#475569]"><MessageSquareText className="size-3.5 text-[#059669]" /> Bình luận (0)</span>
        </div>
        <Empty>Nguồn này cần dữ liệu từ chức năng “Quét tài khoản từ bài viết”, hiện chưa có trong hệ thống.</Empty>
      </div>
    </div>
  );
}
