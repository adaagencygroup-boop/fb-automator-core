"use client";
import { useCallback, useRef, useState } from "react";
import { Folder, FolderOpen, Loader2, MoreVertical, Plus, Search } from "lucide-react";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { saveCategory, deleteCategory } from "../service";
import { CategoryEditor } from "./CategoryDialogs";
import CategoryActionPopup from "./CategoryActionPopup";
import styles from "./AccountTable.module.css";

export default function CategorySidebar({ categories, total, loading, isInitialLoading = false, isRefreshing = false, error, onRetry, value, onChange, onChanged, disabled = false }) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState(null);
  const [target, setTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [menuId, setMenuId] = useState(null);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const closeMenu = useCallback(() => setMenuId(null), []);
  const deleteLock = useRef(false);
  const unassigned = Math.max(0, total - categories.reduce((sum, category) => sum + category.account_count, 0));
  const filtered = categories.filter(category => category.name.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi")));
  const menuCategory = filtered.find(category => category.id === menuId);
  const rowClass = active => `group flex min-h-10 items-center gap-1 rounded-lg border px-1 text-xs font-medium transition-colors ${active ? "border-blue-200 bg-blue-50 text-blue-700" : "border-transparent text-slate-600 hover:bg-slate-50"}`;
  const fixedRow = (id, name, count) => <button type="button" disabled={disabled} key={id} onClick={() => onChange(id)} aria-pressed={value === id} className={`${rowClass(value === id)} w-full text-left disabled:opacity-50`}>
    <span className="h-2 w-2 shrink-0 rounded-full bg-slate-400" /><span className="flex-1">{name}</span>
    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px]">{count}</span>
  </button>;
  return <aside aria-label="Danh mục tài khoản" aria-busy={loading} className={`${styles.categorySidebar} relative flex min-h-0 min-w-0 flex-col rounded-2xl border border-slate-200 bg-white px-2 py-3 font-sans text-xs font-normal shadow-sm lg:w-[228px] lg:shrink-0 lg:self-start`}>
    <div inert={isRefreshing} className="flex min-h-0 flex-1 flex-col">
    <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><FolderOpen className="h-4 w-4 text-blue-600" />Danh mục tài khoản</h2>
    <p role="status" className="mt-1 flex h-4 items-center gap-1 text-xs font-normal text-slate-400">
      {isInitialLoading ? "Đang tải danh mục…" : `${categories.length} danh mục • ${total} tài khoản`}
    </p>
    <div className="relative my-4">
      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
      <input aria-label="Tìm kiếm danh mục" placeholder="Tìm kiếm danh mục..." value={search} onChange={e => setSearch(e.target.value)} className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-2 text-xs outline-none focus:border-blue-500" />
    </div>
    {error && <div role="alert" className="mb-2 text-xs text-red-600">{error} <button type="button" onClick={onRetry} className="underline">Thử lại</button></div>}
    <nav className={`${styles.categoryScroll} flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto`}>
      {isInitialLoading ? <div aria-hidden="true" className="space-y-1 motion-safe:animate-pulse">
        {Array.from({ length: 5 }, (_, index) => <div key={index} className="flex h-10 items-center gap-2 rounded-lg px-2">
          <span className="h-4 w-4 shrink-0 rounded bg-slate-200/70" />
          <span className="h-3 flex-1 rounded bg-slate-200/70" />
          <span className="h-4 w-6 rounded-full bg-slate-100" />
        </div>)}
      </div> : <>
      {fixedRow("all", "Tất cả tài khoản", total)}
      {fixedRow("uncategorized", "Chưa gán danh mục", unassigned)}
      <div className={`${styles.categoryScroll} max-h-64 shrink-0 space-y-1 overflow-y-auto lg:max-h-none lg:overflow-visible`}>
        {filtered.map(category => <div key={category.id} className={`${rowClass(value === String(category.id))} flex-wrap`}>
          <button type="button" disabled={disabled} onClick={() => onChange(String(category.id))} aria-pressed={value === String(category.id)} className="flex min-w-0 flex-1 items-center gap-1.5 py-2 text-left disabled:opacity-50">
            <Folder className="h-4 w-4 shrink-0" style={{ color: category.color || "#2563EB" }} />
            <span className="truncate" title={category.name}>{category.name}</span>
            <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] ${value === String(category.id) ? "bg-blue-600 text-white" : "bg-slate-100"}`}>{category.account_count}</span>
          </button>
          <button type="button" disabled={disabled} aria-label={`Thao tác danh mục ${category.name}`} aria-haspopup="dialog" aria-expanded={menuId === category.id}
            onClick={event => { setMenuAnchor(event.currentTarget); setMenuId(menuId === category.id ? null : category.id); }} className={`flex h-[22px] shrink-0 items-center justify-center overflow-hidden rounded transition-[width,opacity,margin] hover:bg-blue-100 group-hover:ml-0 group-hover:w-[22px] group-hover:opacity-100 group-has-[:focus-visible]:ml-0 group-has-[:focus-visible]:w-[22px] group-has-[:focus-visible]:opacity-100 [@media(hover:none)]:ml-0 [@media(hover:none)]:w-[22px] [@media(hover:none)]:opacity-100 ${menuId === category.id ? "ml-0 w-[22px] opacity-100" : "-ml-1 w-0 opacity-0"}`}><MoreVertical className="h-3.5 w-3.5 shrink-0" /></button>
        </div>)}
        {!filtered.length && !loading && <p className="px-2 py-4 text-xs text-slate-400">{search ? "Không tìm thấy danh mục." : "Chưa có danh mục."}</p>}
      </div>
      </>}
    </nav>
    <div className="mt-5 shrink-0 border-t border-slate-100 pt-3">
      <button type="button" disabled={disabled} onClick={event => setEditor({ category: null, anchor: event.currentTarget })} className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-slate-200 py-2 text-xs font-semibold text-slate-500 hover:border-blue-300 hover:text-blue-600 disabled:opacity-50"><Plus className="h-3.5 w-3.5" />Thêm danh mục</button>
    </div>
    </div>
    {menuCategory && !disabled && !isRefreshing && <CategoryActionPopup key={menuCategory.id} anchor={menuAnchor} category={menuCategory} onClose={closeMenu}
      onEdit={() => { closeMenu(); setEditor({ category: menuCategory, anchor: menuAnchor }); }}
      onDelete={() => { closeMenu(); setDeleteError(null); setTarget(menuCategory); }} />}
    {isRefreshing && <div className="absolute inset-0 z-30 flex items-center justify-center rounded-2xl bg-white/65 backdrop-blur-[1px]">
      <span role="status" className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs font-medium text-slate-600 shadow-sm">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-blue-600" />Đang cập nhật…
      </span>
    </div>}
    {editor && <CategoryEditor anchor={editor.anchor} category={editor.category} onClose={() => setEditor(null)} onSave={async (data, id) => {
      await saveCategory(data, id);
      setEditor(null);
      toast.success(id === null ? `Đã tạo danh mục “${data.name}”.` : `Đã cập nhật danh mục “${data.name}”.`, "DANH MỤC");
      await onChanged();
    }} />}
    <ConfirmDialog isOpen={Boolean(target)} title="Xóa danh mục" description={<span>Xóa danh mục “{target?.name}”? Tài khoản trong danh mục sẽ được đưa về “Chưa gán danh mục”.{deleteError && <span role="alert" className="mt-2 block text-red-600">{deleteError}</span>}</span>}
      confirmText="Xóa danh mục" loading={deleting} onClose={() => { if (!deleteLock.current) setTarget(null); }} onConfirm={async () => {
        if (deleteLock.current) return;
        deleteLock.current = true;
        setDeleting(true);
        try {
          await deleteCategory(target.id);
          toast.success(`Đã xóa danh mục “${target.name}”. Tài khoản trong danh mục được đưa về “Chưa gán danh mục”.`, "DANH MỤC");
          if (value === String(target.id)) onChange("all");
          setTarget(null);
          await onChanged();
        } catch (err) { setDeleteError(err.message); }
        finally { deleteLock.current = false; setDeleting(false); }
      }} />
  </aside>;
}
