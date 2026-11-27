"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, FileSpreadsheet, ListChecks, Loader2, MessageCircle, MoreVertical, Pencil, Plus, Search, Share2, ThumbsUp, Trash2, Users } from "lucide-react";

import CustomSelect from "@/components/ui/custom-select";
import { toast } from "@/lib/toast";
import { askConfirm } from "@/modules/module_11_page_scanner/shared/askConfirm";
import * as service from "../service";
import { SCALE_UNITS, SOURCE_TYPES, UNCATEGORIZED, fmtNum, shortFbUrl } from "../utils.mjs";
import { exportMessage, exportProfiles, jobText } from "../shared/exportProfiles";
import ProfileTable, { rowId } from "../scan-info/ProfileTable";
import { CategoryFormModal, MoveConflictModal, MoveProfilesModal } from "./CategoryModals";
import { SelectionBar } from "@/modules/module_11_page_scanner/_listLayout";
import { createDemoStore } from "./demoStore";

const CARD = "rounded-xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)]";
const TYPE_OPTIONS = [
  { value: "ALL", label: "Tất cả loại" },
  ...Object.entries(SOURCE_TYPES).map(([value, label]) => ({ value, label })),
  { value: "category", label: "Danh mục" },
];
const PHONE_OPTIONS = [
  { value: "ALL", label: "Tất cả SĐT" },
  { value: "yes", label: "Có SĐT" },
  { value: "no", label: "Không SĐT" },
];
const FRIEND_RANGES = {
  ALL: null,
  lt500: [0, 500],
  "500": [500, 1000],
  "1000": [1000, 3000],
  "3000": [3000, Infinity],
};
const FRIEND_OPTIONS = [
  { value: "ALL", label: "Số bạn bè" },
  { value: "lt500", label: "Dưới 500" },
  { value: "500", label: "500 – 999" },
  { value: "1000", label: "1.000 – 2.999" },
  { value: "3000", label: "Từ 3.000" },
];
const FOLLOWER_RANGES = {
  ALL: null,
  lt100: [0, 100],
  "100": [100, 1000],
  "1000": [1000, 10000],
  "10000": [10000, Infinity],
};
const FOLLOWER_OPTIONS = [
  { value: "ALL", label: "Số follower" },
  { value: "lt100", label: "Dưới 100" },
  { value: "100", label: "100 – 999" },
  { value: "1000", label: "1.000 – 9.999" },
  { value: "10000", label: "Từ 10.000" },
];
// Thanh tìm kiếm + bộ lọc danh sách profile: cùng chiều cao, bo góc, cỡ chữ; các ô lọc rộng bằng nhau
const FILTER_SELECT = "!h-[34px] !w-full !rounded-lg !border-[#E2E8F0] !bg-white !px-3 !text-xs !shadow-none";

function CollectionCard({ item, active, menuOpen, onSelect, onMenu, onEdit, onDelete }) {
  const isCategory = item.type === "category";
  return (
    <div className={`relative rounded-xl border text-xs ${active ? "border-2 border-[#1877F2] bg-[#F8FAFF]" : "border-[#E2E8F0] hover:border-[#93C5FD]"}`}>
      <button type="button" aria-pressed={active} onClick={onSelect} className={`w-full p-3 text-left ${isCategory ? "pr-14" : ""}`}>
        {!isCategory && <span className="mb-1.5 inline-block rounded bg-[#F1F5F9] px-1.5 py-0.5 text-[10px] text-[#475569]">{SOURCE_TYPES[item.type]}</span>}
        <span className={`block truncate text-[#0F172A] ${active ? "font-bold" : ""}`} title={item.name}>{item.name}</span>
        {item.type === "post" && (
          <span className="mt-1 flex gap-3 text-[#64748B]">
            <span className="inline-flex items-center gap-1"><ThumbsUp className="size-3" /> {fmtNum(item.likes)}</span>
            <span className="inline-flex items-center gap-1"><MessageCircle className="size-3" /> {fmtNum(item.comments)}</span>
            <span className="inline-flex items-center gap-1"><Share2 className="size-3" /> {fmtNum(item.shares)}</span>
          </span>
        )}
        <span className="mt-1 block text-[11px] text-[#64748B]">
          Đã quét <b className="text-[#1D4ED8]">{fmtNum(item.profile_count)} profile</b>
          {!isCategory && item.target_count != null && ` / ${fmtNum(item.target_count)} đã chọn`}
        </span>
      </button>
      {isCategory && (
        <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          <span className="size-2 rounded-full" style={{ backgroundColor: item.color || "#94A3B8" }} />
          {item.key !== UNCATEGORIZED && (
            <button
              type="button"
              aria-label={`Tùy chọn ${item.name}`}
              aria-expanded={menuOpen}
              onClick={(e) => {
                e.stopPropagation();
                onMenu();
              }}
              className="rounded p-1 text-[#94A3B8] hover:bg-slate-100 hover:text-[#334155]"
            >
              <MoreVertical className="size-4" />
            </button>
          )}
        </span>
      )}
      {menuOpen && (
        <div className="border-t border-[#E2E8F0] p-1">
          <button type="button" onClick={onEdit} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[#334155] hover:bg-slate-100"><Pencil className="size-3.5" /> Sửa danh mục</button>
          <button type="button" onClick={onDelete} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[#DC2626] hover:bg-red-50"><Trash2 className="size-3.5" /> Xóa danh mục</button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, unit }) {
  return (
    <div className="rounded-lg border border-[#F1F5F9] bg-[#F8FAFC] px-4 py-2.5">
      <p className="text-[11px] text-[#64748B]">{label}</p>
      <p className="mt-0.5 font-mono text-lg font-semibold text-[#0F172A]">{value} {unit && <span className="font-sans text-[11px] font-normal text-[#94A3B8]">{unit}</span>}</p>
    </div>
  );
}

function CollectionHeader({ item, onExport }) {
  return (
    <div className={`${CARD} p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {item.type === "post" && item.source_name && <p className="mb-1 flex items-center gap-1.5 text-[11px] text-[#64748B]"><Users className="size-3.5" /> Nguồn: <b className="text-[#334155]">{item.source_name}</b></p>}
          <p className="text-sm font-bold text-[#0F172A]">{item.type === "group" ? "Nhóm: " : item.type === "page" ? "Page: " : ""}{item.name}</p>
          {item.type === "category" ? (
            <p className="mt-0.5 text-xs text-[#64748B]">Đã quét: {fmtNum(item.profile_count)} profile</p>
          ) : (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-[#64748B]">
              {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all font-mono text-[#2563EB] hover:underline">{shortFbUrl(item.url)} <ExternalLink className="size-3 shrink-0" /></a>}
              {item.type !== "post" && item.scale != null && <span>• {item.type === "group" ? "Quy mô nhóm: " : ""}<b>{fmtNum(item.scale)}</b> {SCALE_UNITS[item.type]}</span>}
            </p>
          )}
        </div>
        <button type="button" onClick={onExport} className="inline-flex h-[26px] items-center gap-2 rounded-md bg-[#F1F5F9] px-3 text-xs font-semibold text-[#1E293B] hover:bg-slate-200"><FileSpreadsheet className="size-3.5 text-[#059669]" /> Xuất Excel</button>
      </div>
      {item.type === "group" && <div className="mt-3 text-center"><Stat label="Số thành viên đã quét" value={fmtNum(item.profile_count)} /></div>}
      {item.type === "page" && <div className="mt-3"><Stat label="Tổng người theo dõi quét" value={fmtNum(item.profile_count)} unit="lượt" /></div>}
      {item.type === "post" && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          {/* Đã quét thông tin / số người (không tính fanpage) đã like, bình luận */}
          <Stat label="ĐÃ QUÉT LIKE" value={`${fmtNum(item.scanned_likes ?? 0)}/${fmtNum(item.like_people ?? item.likes ?? 0)}`} />
          <Stat label="ĐÃ QUÉT BÌNH LUẬN" value={`${fmtNum(item.scanned_comments ?? 0)}/${fmtNum(item.comment_people ?? item.comments ?? 0)}`} />
        </div>
      )}
    </div>
  );
}

export default function ProfileList() {
  const [api, setApi] = useState(null);
  const [demo, setDemo] = useState(false);
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeKey, setActiveKey] = useState(null);
  const [loaded, setLoaded] = useState({ key: null, rows: [] });
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState(() => new Set());

  const [sideSearch, setSideSearch] = useState("");
  const [type, setType] = useState("ALL");
  const [search, setSearch] = useState("");
  const [phone, setPhone] = useState("ALL");
  const [friends, setFriends] = useState("ALL");
  const [followers, setFollowers] = useState("ALL");
  const [menuKey, setMenuKey] = useState(null);
  const [form, setForm] = useState(null); // { category } — null khi đóng
  const [moving, setMoving] = useState(false);
  const [moveConflict, setMoveConflict] = useState(null); // { toKey, uids, conflict } — chờ người dùng xác nhận
  const [exporting, setExporting] = useState(false);

  /* Phần đầu cột phải đang dính? — chỉ khi đó mới phủ khe p-6 phía trên (lúc chưa cuộn sẽ che tiêu đề trang) */
  const stickyHeadRef = useRef(null);
  const [headStuck, setHeadStuck] = useState(false);
  useEffect(() => {
    const scroller = document.querySelector("main");
    if (!scroller) return undefined;
    const check = () => {
      const el = stickyHeadRef.current;
      if (!el || getComputedStyle(el).position !== "sticky") {
        setHeadStuck(false);
        return;
      }
      const padTop = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
      const offset = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      setHeadStuck(scroller.scrollTop > 0 && offset <= padTop + 1);
    };
    check();
    scroller.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      scroller.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      const isDemo = new URLSearchParams(window.location.search).get("demo") === "1";
      setDemo(isDemo);
      setApi(isDemo ? createDemoStore() : service);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!api) return undefined;
    let ignore = false;
    api
      .getProfileCollections()
      .then((list) => !ignore && setCollections(list))
      .catch((err) => !ignore && toast.error(`Lỗi tải danh mục: ${err.message}`))
      .finally(() => !ignore && setLoading(false));
    return () => {
      ignore = true;
    };
  }, [api, reload]);

  const shown = collections.filter((c) => (type === "ALL" || c.type === type) && c.name.toLowerCase().includes(sideSearch.trim().toLowerCase()));
  const current = shown.find((c) => c.key === activeKey) || shown[0] || null;
  const currentKey = current?.key ?? null;
  const isCategory = current?.type === "category";

  useEffect(() => {
    if (!api || !currentKey) return undefined;
    let ignore = false;
    api
      .getCollectionProfiles(currentKey)
      .then((rows) => !ignore && setLoaded({ key: currentKey, rows }))
      .catch((err) => {
        if (ignore) return;
        toast.error(`Lỗi tải profile: ${err.message}`);
        setLoaded({ key: currentKey, rows: [] });
      });
    return () => {
      ignore = true;
    };
  }, [api, currentKey, reload]);

  const rowsLoading = currentKey !== null && loaded.key !== currentKey;
  const rows = useMemo(() => (loaded.key === currentKey ? loaded.rows : []), [loaded, currentKey]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const range = FRIEND_RANGES[friends];
    const fRange = FOLLOWER_RANGES[followers];
    return rows.filter((r) => {
      if (phone !== "ALL" && Boolean(r.phone) !== (phone === "yes")) return false;
      if (range && !(r.friends != null && r.friends >= range[0] && r.friends < range[1])) return false;
      if (fRange && !(r.followers != null && r.followers >= fRange[0] && r.followers < fRange[1])) return false;
      return !q || [r.name, r.uid, r.url, r.bio, r.hometown, r.location, r.education, jobText(r)].some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [rows, search, phone, friends, followers]);

  // Chỉ thao tác trên dòng đang hiện sau bộ lọc, tránh xóa nhầm dòng bị ẩn
  const picked = filtered.filter((r) => selected.has(rowId(r)));
  const categories = collections.filter((c) => c.type === "category");
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  const choose = (key) => {
    setActiveKey(key);
    setSelected(new Set());
    setMenuKey(null);
  };

  const saveCategory = async (data) => {
    if (form.category) {
      await api.updateProfileCategory(form.category.key, data);
      toast.success("Đã cập nhật danh mục.");
    } else {
      const created = await api.createProfileCategory(data);
      setType("ALL");
      setSideSearch("");
      choose(created.key);
      toast.success("Đã tạo danh mục.");
    }
    refresh();
  };

  const removeCategory = async (item) => {
    setMenuKey(null);
    const ok = await askConfirm({
      title: "Xóa danh mục",
      description: `Xóa danh mục "${item.name}"? ${fmtNum(item.profile_count)} profile bên trong sẽ chuyển về "Chưa có danh mục".`,
      confirmText: "Xóa",
      cancelText: "Hủy",
    });
    if (!ok) return;
    try {
      await api.deleteProfileCategory(item.key);
      if (item.key === currentKey) choose(UNCATEGORIZED);
      toast.success("Đã xóa danh mục.");
      refresh();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const doMove = async (toKey, uids, exclusive) => {
    await api.moveProfiles(currentKey, toKey, uids, { exclusive });
    // Nguồn quét giữ nguyên profile, chỉ thêm vào danh mục đích
    toast.success(isCategory || exclusive ? `Đã chuyển ${fmtNum(uids.length)} profile.` : `Đã thêm ${fmtNum(uids.length)} profile vào danh mục.`);
    setSelected(new Set());
    refresh();
  };

  // Profile đã nằm trong danh mục khác (ngoài mục đang xem và mục đích) → hiện cảnh báo trước khi chuyển
  const move = async (toKey) => {
    const uids = [...new Set(picked.map((r) => String(r.uid)))];
    const rows = (await api.getProfileMemberships?.(uids)) || [];
    const keyOf = (r) => `category:${r.id}`;
    const inTarget = new Set(rows.find((r) => keyOf(r) === toKey)?.uids || []);
    const others = rows
      .filter((r) => keyOf(r) !== toKey && keyOf(r) !== currentKey)
      .map((r) => ({ id: r.id, name: r.name, color: r.color, count: r.uids.length, uids: r.uids }));
    if (!others.length) return doMove(toKey, uids, false); // trùng với chính mục đích thì DB tự bỏ qua
    const taken = new Set([...inTarget, ...others.flatMap((r) => r.uids)]);
    const names = [...new Map(picked.filter((r) => taken.has(String(r.uid))).map((r) => [String(r.uid), r.name || r.uid])).values()];
    setMoveConflict({ toKey, uids, conflict: { others, inTarget: inTarget.size, names, total: taken.size } });
    return undefined;
  };

  const removeProfiles = async () => {
    const ok = await askConfirm({
      title: "Xóa profile",
      description: `Xóa ${fmtNum(picked.length)} profile khỏi "${current.name}"? Profile không còn thuộc nguồn/danh mục nào sẽ bị xóa hẳn dữ liệu. Thao tác này không thể hoàn tác.`,
      confirmText: "Xóa",
      cancelText: "Hủy",
    });
    if (!ok) return;
    try {
      await api.deleteProfiles(currentKey, picked.map((r) => r.uid));
      toast.success(`Đã xóa ${fmtNum(picked.length)} profile.`);
      setSelected(new Set());
      refresh();
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Hộp thoại chọn nơi lưu mở ngay khi bấm; dữ liệu (getRows) tải sau khi đã chọn
  const runExport = async (getRows, fileName) => {
    setExporting(true);
    try {
      const names = new Map(collections.map((c) => [c.key, c.name]));
      const msg = exportMessage(await exportProfiles(getRows, fileName, (r) => names.get(r.sourceKey) || ""));
      toast[msg.type](msg.text);
    } catch (err) {
      toast.error(`Không xuất được: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };
  const exportAll = () => runExport(async () => (await Promise.all(collections.map((c) => api.getCollectionProfiles(c.key)))).flat(), "danh_sach_profile");
  const exportCurrent = () => {
    if (!picked.length && !filtered.length) return toast.warning("Chưa có profile để xuất.");
    return runExport(async () => (picked.length ? picked : filtered), "profile_theo_danh_muc");
  };
  const exportPicked = () => runExport(async () => picked, "profile_da_chon");

  return (
    <div className="-m-6 min-h-full space-y-5 bg-[#F8FAFC] p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-xl font-bold text-[#0F172A]">Danh sách thông tin profile đã quét</h1>
          <p className="mt-1 text-xs text-[#64748B]">Quản lý các thông tin về tên, hồ sơ, UID, link facebook, số bạn bè của những profile nhập từ page, nhóm, bài viết hoặc nhập thủ công</p>
          {demo && <p className="mt-2 inline-block rounded-md bg-[#FEF3C7] px-2.5 py-1 text-xs font-semibold text-[#92400E]">Đang xem dữ liệu mẫu — thay đổi sẽ mất khi tải lại trang</p>}
        </div>
        <button type="button" disabled={exporting || !collections.length} onClick={exportAll} className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-[#CBD5E1] bg-white px-4 text-xs font-semibold text-[#1E293B] hover:bg-slate-50 disabled:opacity-50"><Download className="size-3.5" /> Xuất toàn bộ file</button>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          {/* Dính khi cuộn trang (main của AppShell là vùng cuộn) */}
          <aside className={`${CARD} flex h-[520px] max-h-[calc(100vh-120px)] min-h-[360px] flex-col p-4 lg:sticky lg:top-0`}>
            <div className="flex items-center justify-between gap-2 border-b border-[#F1F5F9] pb-3">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.4px] text-[#334155]"><ListChecks className="size-4 text-[#1877F2]" /> Danh mục nguồn quét ({collections.length})</p>
              <button type="button" aria-label="Thêm danh mục" title="Thêm danh mục" onClick={() => setForm({ category: null })} className="rounded-md bg-[#EFF6FF] p-1 text-[#1877F2] hover:bg-[#DBEAFE]"><Plus className="size-4" /></button>
            </div>
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_120px] gap-2">
              <div className="relative min-w-0">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#94A3B8]" />
                <input aria-label="Tìm nguồn hoặc danh mục" value={sideSearch} onChange={(e) => { setSideSearch(e.target.value); setSelected(new Set()); }} placeholder="Tìm kiếm" className="h-[34px] w-full rounded-lg border border-[#E2E8F0] bg-white pl-8 pr-2 text-xs outline-none placeholder:text-[#94A3B8] focus:border-[#1877F2]" />
              </div>
              <CustomSelect className="w-full" buttonClassName={FILTER_SELECT} value={type} onChange={(v) => { setType(v); setSelected(new Set()); }} options={TYPE_OPTIONS} />
            </div>
            <div className="mt-3 min-h-0 flex-1 space-y-2.5 overflow-y-auto">
              {loading ? (
                <Loader2 className="mx-auto mt-10 size-5 animate-spin text-[#1877F2]" />
              ) : shown.length === 0 ? (
                <p className="py-10 text-center text-xs text-[#94A3B8]">{collections.length ? "Không tìm thấy mục phù hợp." : "Chưa có nguồn hoặc danh mục nào."}</p>
              ) : (
                shown.map((c) => (
                  <CollectionCard
                    key={c.key}
                    item={c}
                    active={c.key === currentKey}
                    menuOpen={menuKey === c.key}
                    onSelect={() => choose(c.key)}
                    onMenu={() => setMenuKey((k) => (k === c.key ? null : c.key))}
                    onEdit={() => {
                      setMenuKey(null);
                      setForm({ category: c });
                    }}
                    onDelete={() => removeCategory(c)}
                  />
                ))
              )}
            </div>
          </aside>

          <div className="min-w-0 space-y-4">
            {current && (
              <>
                {/* Phần đầu cột phải (thông tin nguồn, bộ lọc, thanh chọn) dính cùng hàng với cột trái.
                    main có p-6 → khe 24px phía trên; khi đang dính thì dải ::before màu nền phủ khe đó */}
                <div
                  ref={stickyHeadRef}
                  className={`space-y-4 bg-[#F8FAFC] pb-1 lg:sticky lg:top-0 lg:z-30 ${
                    headStuck
                      ? "before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-[#F8FAFC] before:content-['']"
                      : ""
                  }`}
                >
                <CollectionHeader item={current} onExport={exportCurrent} />
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 xl:grid-cols-[minmax(240px,1fr)_repeat(3,152px)]">
                  <div className="relative sm:col-span-3 xl:col-span-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#94A3B8]" />
                    <input aria-label="Tìm profile" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm tên, UID, nơi ở, học vấn, công việc..." className="h-[34px] w-full rounded-lg border border-[#E2E8F0] bg-white pl-9 pr-3 text-xs outline-none placeholder:text-[#94A3B8] focus:border-[#1877F2]" />
                  </div>
                  <CustomSelect className="w-full" buttonClassName={FILTER_SELECT} value={phone} onChange={setPhone} options={PHONE_OPTIONS} />
                  <CustomSelect className="w-full" buttonClassName={FILTER_SELECT} value={friends} onChange={setFriends} options={FRIEND_OPTIONS} />
                  <CustomSelect className="w-full" buttonClassName={FILTER_SELECT} value={followers} onChange={setFollowers} options={FOLLOWER_OPTIONS} />
                </div>
                <SelectionBar count={picked.length} onMoveCategory={() => setMoving(true)} onExport={exportPicked} onDelete={removeProfiles} exportDisabled={exporting} />
                </div>
                {rowsLoading ? (
                  <div className={`${CARD} py-16`}><Loader2 className="mx-auto size-5 animate-spin text-[#1877F2]" /></div>
                ) : (
                  <ProfileTable key={`${currentKey}|${search}|${phone}|${friends}|${followers}`} rows={filtered} selected={selected} onSelect={setSelected} emptyText={rows.length ? "Không có profile phù hợp bộ lọc." : "Chưa có profile trong mục này."} />
                )}
              </>
            )}
            {!current && !loading && (
              <div className={`${CARD} px-4 py-16 text-center text-xs text-[#94A3B8]`}>Chưa có dữ liệu profile nào được lưu trữ. Vui lòng sử dụng tính năng &quot;Quét thông tin profile&quot; để thu thập.</div>
            )}
          </div>
      </div>

      {form && <CategoryFormModal category={form.category} takenNames={categories.map((c) => c.name)} onSave={saveCategory} onClose={() => setForm(null)} />}
      {moveConflict && (
        <MoveConflictModal
          conflict={moveConflict.conflict}
          count={moveConflict.uids.length}
          target={collections.find((c) => c.key === moveConflict.toKey)?.name || ""}
          onConfirm={(exclusive) => doMove(moveConflict.toKey, moveConflict.uids, exclusive)}
          onClose={() => setMoveConflict(null)}
        />
      )}
      {moving && <MoveProfilesModal count={picked.length} categories={categories.filter((c) => c.key !== currentKey)} onMove={move} onClose={() => setMoving(false)} />}
    </div>
  );
}
