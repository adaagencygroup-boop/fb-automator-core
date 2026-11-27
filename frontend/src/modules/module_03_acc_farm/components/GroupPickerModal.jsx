"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ExternalLink, Folder, LayoutList, Loader2, Search, X } from "lucide-react";
import CustomSelect from "@/components/ui/custom-select";
import Pagination from "@/components/ui/pagination";
import { cn } from "@/lib/utils";
import { getPickerGroupCategories, getPickerGroups, pickerErrorMessage } from "../service";
import { parseFbLink } from "./ScenarioConfig";
import usePickerMultiSelect from "./usePickerMultiSelect";

const ALL_ID = "cat-all";
const PAGE_SIZE = 10;
// Giống bộ lọc Thành viên của Module 10
const MEMBER_OPTIONS = [
  { value: "all", label: "Thành viên: Tất cả" },
  { value: "under50k", label: "Dưới 50K" },
  { value: "50k_200k", label: "50K - 200K" },
  { value: "over200k", label: "Trên 200K" },
];
const groupKey = (g) => g.key;
const groupUrl = (g) => g.url;

const inCategory = (g, cat) =>
  cat.id === ALL_ID || g.categoryId === cat.id || (g.category_name || "").toLowerCase() === (cat.name || "").toLowerCase();

function matchMembers(count, filter) {
  const n = Number(count || 0);
  if (filter === "under50k") return n < 50000;
  if (filter === "50k_200k") return n >= 50000 && n <= 200000;
  if (filter === "over200k") return n > 200000;
  return true;
}

const formatMembers = (n) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K` : String(n);

/**
 * Chọn nhóm đã quét (Module 10 – Quét nhóm) cho ô Tham gia nhóm theo link. Bố cục giống hộp chọn nhóm của Module 10 nhưng
 * CHỈ ĐỌC: liệt kê + lọc + tìm kiếm, không thêm / sửa / xóa danh mục hay nhóm.
 * initial: Map key nhóm -> link đang có trong ô danh sách (tick sẵn); onConfirm(Map): toàn bộ lựa chọn sau khi xác nhận.
 */
export default function GroupPickerModal({ initial, onClose, onConfirm }) {
  const [groups, setGroups] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeId, setActiveId] = useState(ALL_ID);
  const [catSearch, setCatSearch] = useState("");
  const [search, setSearch] = useState("");
  const [members, setMembers] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Map(initial)); // key nhóm -> url

  useEffect(() => {
    let cancelled = false;
    Promise.all([getPickerGroups(), getPickerGroupCategories()])
      .then(([res, cats]) => {
        if (cancelled) return;
        setGroups(
          (res?.groups || []).flatMap((g) => {
            const link = parseFbLink(g.url);
            return link?.kind === "group" ? [{ ...g, key: link.key }] : [];
          }),
        );
        setCategories(cats || []);
      })
      .catch((err) => !cancelled && setError(pickerErrorMessage(err, "Quét nhóm")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const allCats = useMemo(() => [{ id: ALL_ID, name: "Tất cả nhóm đã quét" }, ...categories], [categories]);
  const stats = useMemo(() => {
    const out = {};
    allCats.forEach((cat) => {
      const list = groups.filter((g) => inCategory(g, cat));
      out[cat.id] = { count: list.length, members: list.reduce((sum, g) => sum + Number(g.membersCount || 0), 0) };
    });
    return out;
  }, [allCats, groups]);
  const shownCats = useMemo(() => {
    const q = catSearch.trim().toLowerCase();
    return q ? allCats.filter((c) => c.id === ALL_ID || c.name.toLowerCase().includes(q)) : allCats;
  }, [allCats, catSearch]);
  const activeCat = allCats.find((c) => c.id === activeId) || allCats[0];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((g) => {
      if (!inCategory(g, activeCat)) return false;
      if (!matchMembers(g.membersCount, members)) return false;
      if (!q) return true;
      return [g.name, g.keyword, g.url, g.group_id].some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [groups, activeCat, members, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const rows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const allChecked = filtered.length > 0 && filtered.every((g) => selected.has(g.key));
  const changed = selected.size !== initial.size || [...selected.keys()].some((key) => !initial.has(key));

  const { setContainer, rowProps } = usePickerMultiSelect({ rows, getKey: groupKey, getUrl: groupUrl, selected, setSelected });

  const toggle = (g) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(g.key)) next.delete(g.key);
      else next.set(g.key, g.url);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Map(prev);
      filtered.forEach((g) => (allChecked ? next.delete(g.key) : next.set(g.key, g.url)));
      return next;
    });
  const filterBy = (setter) => (value) => {
    setter(value);
    setPage(1);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Chiều cao cố định: lọc / đổi danh mục / chọn nhóm không làm hộp co giãn, không nhảy */}
      <div role="dialog" aria-modal="true" aria-label="Chọn nhóm từ danh sách quét" className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
              <LayoutList className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-900">Chọn nhóm từ danh mục đã quét</h2>
              <p className="mt-0.5 text-xs text-slate-500">Chọn nhóm Facebook đã quét (Quét nhóm) để thêm vào danh sách tham gia nhóm theo link.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-5">
          <aside className="flex w-72 shrink-0 flex-col rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3 text-xs font-bold uppercase tracking-wide text-slate-700">
              <Folder className="h-4 w-4 text-primary" /> Danh sách danh mục
            </div>
            <p className="mt-3 text-xs text-slate-500">
              {categories.length} danh mục <span className="font-semibold text-primary">({groups.length} nhóm FB)</span>
            </p>
            <div className="relative mt-2">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={catSearch}
                onChange={(e) => setCatSearch(e.target.value)}
                placeholder="Lọc danh mục..."
                className="h-9 w-full rounded-lg border border-slate-200 pl-8 pr-2 text-xs focus:border-primary focus:outline-none"
              />
            </div>
            <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
              {shownCats.map((cat) => {
                const s = stats[cat.id] || { count: 0, members: 0 };
                const active = cat.id === activeCat?.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      setActiveId(cat.id);
                      setPage(1);
                    }}
                    className={cn(
                      "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
                      active ? "border-primary bg-primary/5" : "border-slate-200 hover:bg-slate-50",
                    )}
                  >
                    <div className={cn("truncate text-sm font-semibold", active ? "text-primary" : "text-slate-800")}>{cat.name}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {s.count} nhóm FB • {formatMembers(s.members)} TV
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="flex min-w-0 flex-1 flex-col rounded-2xl border border-slate-200 p-4">
            <h3 className="text-base font-bold text-slate-900">{activeCat?.name}</h3>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => filterBy(setSearch)(e.target.value)}
                  placeholder="Tìm theo tên nhóm, từ khóa hoặc UID..."
                  className="h-9 w-full rounded-lg border border-slate-200 pl-8 pr-2 text-xs focus:border-primary focus:outline-none"
                />
              </div>
              <CustomSelect className="w-44" value={members} onChange={filterBy(setMembers)} options={MEMBER_OPTIONS} />
            </div>

            <div ref={setContainer} className="mt-3 min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="w-10 px-3 py-2.5 text-center">
                      <input type="checkbox" checked={allChecked} disabled={!filtered.length} onChange={toggleAll} className="size-3.5 cursor-pointer rounded" />
                    </th>
                    <th className="w-12 px-3 py-2.5 text-center">STT</th>
                    <th className="w-28 px-3 py-2.5">Từ khóa</th>
                    <th className="px-3 py-2.5">Tên nhóm</th>
                    <th className="w-24 px-3 py-2.5 text-right">Thành viên</th>
                    <th className="w-60 px-3 py-2.5">Liên kết / URL nhóm</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="py-16 text-center text-slate-400">
                        <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin text-primary" /> Đang tải danh sách nhóm...
                      </td>
                    </tr>
                  ) : error ? (
                    <tr>
                      <td colSpan={6} className="py-16 text-center text-rose-500">{error}</td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-16 text-center text-slate-400">
                        {groups.length ? "Không có nhóm nào khớp bộ lọc." : "Chưa có nhóm đã quét — chạy Quét nhóm trước."}
                      </td>
                    </tr>
                  ) : (
                    rows.map((g, idx) => {
                      const on = selected.has(g.key);
                      return (
                        <tr
                          key={g.id}
                          {...rowProps(g, idx)}
                          className={cn("cursor-pointer select-none transition-colors", on ? "bg-blue-50/60" : "hover:bg-slate-50")}
                        >
                          {/* Ô tick chỉ bật / tắt đúng dòng này; bấm phần còn lại của dòng = chọn kiểu bảng (Ctrl / Shift / kéo) */}
                          <td className="px-3 py-2.5 text-center" data-no-row-selection>
                            <input type="checkbox" checked={on} onChange={() => toggle(g)} className="size-3.5 cursor-pointer rounded" />
                          </td>
                          <td className="px-3 py-2.5 text-center font-semibold text-slate-500">{(currentPage - 1) * PAGE_SIZE + idx + 1}</td>
                          <td className="max-w-[120px] truncate px-3 py-2.5 font-medium text-slate-700">{g.keyword || "—"}</td>
                          <td className="max-w-[280px] truncate px-3 py-2.5 font-semibold text-slate-900" title={g.name}>
                            {g.name}
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold text-slate-800">{g.members || "—"}</td>
                          <td className="max-w-[240px] px-3 py-2.5">
                            <a href={g.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-primary hover:underline">
                              <span className="truncate">{g.url.replace(/^https?:\/\/(www\.|web\.|m\.)?facebook\.com\//, "fb.com/")}</span>
                              <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500">
                Hiển thị {filtered.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0} - {Math.min(currentPage * PAGE_SIZE, filtered.length)} trong tổng số{" "}
                <strong className="text-slate-800">{filtered.length}</strong> nhóm
              </span>
              <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setPage} />
            </div>
          </section>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 px-6 py-3">
          <span className="text-xs text-slate-500">
            Đã chọn <strong className="text-slate-800">{selected.size}</strong> nhóm
            {selected.size > 0 && (
              <button type="button" onClick={() => setSelected(new Map())} className="ml-2 font-semibold text-primary hover:underline">
                Bỏ chọn
              </button>
            )}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Hủy bỏ
            </button>
            <button
              type="button"
              disabled={!changed}
              onClick={() => onConfirm(selected)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="h-4 w-4" /> Xác nhận chọn ({selected.size} nhóm)
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
