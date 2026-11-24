"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FolderPlus, Loader2, Palette, PlusCircle, Save, Search, X } from "lucide-react";
import { toast } from "@/lib/toast";
import { getProfileLists, saveProfilesToList } from "../service";

/** Figma 4058:2351 — "Lưu vào danh sách Profile" */
export default function SaveProfileListModal({ open, ...props }) {
  if (!open) return null;
  return createPortal(<Body {...props} />, document.body);
}

function Body({ profiles, onClose }) {
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#2563EB");
  const [saving, setSaving] = useState(false);
  const colorRef = useRef(null);

  useEffect(() => {
    let ignore = false;
    getProfileLists()
      .then((rows) => {
        if (ignore) return;
        setLists(rows);
        setSelectedId(rows[0]?.id ?? null);
      })
      .catch((err) => toast.error(`Lỗi tải danh mục: ${err.message}`))
      .finally(() => !ignore && setLoading(false));
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  const q = search.trim().toLowerCase();
  const shown = lists.filter((l) => l.name.toLowerCase().includes(q));
  const typed = name.trim();
  const canSave = !saving && profiles.length > 0 && (typed || selectedId != null);

  const save = async () => {
    setSaving(true);
    try {
      await saveProfilesToList(typed ? { name: typed, color, profiles } : { id: selectedId, profiles });
      toast.success("Đã lưu profile vào danh sách.");
      onClose();
    } catch (err) {
      toast.error(err.message);
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Lưu vào danh sách Profile"
        className="flex max-h-[calc(100vh-32px)] w-full max-w-[680px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between bg-[#F8FAFC] px-6 py-4">
          <div className="flex items-center gap-3.5">
            <span className="flex size-10 items-center justify-center rounded-lg border border-[#E2E8F0] bg-white text-[#334155]">
              <FolderPlus className="size-5" />
            </span>
            <div>
              <h3 className="text-base font-bold text-[#1E293B]">Lưu vào danh sách Profile</h3>
              <p className="text-[11px] text-[#64748B]">Sẽ lưu {profiles.length.toLocaleString("vi-VN")} profile</p>
            </div>
          </div>
          <button type="button" aria-label="Đóng" disabled={saving} onClick={onClose} className="rounded-lg p-1.5 text-[#334155] hover:bg-slate-100">
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#334155]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm kiếm danh mục Profile..."
              className="h-10 w-full rounded-lg border border-[#737686] pl-9 pr-3 text-sm outline-none focus:border-[#2563EB]"
            />
          </div>
          <div className="flex items-center justify-between text-[13px] text-[#334155]">
            <span className="font-semibold uppercase tracking-wide">Danh mục có sẵn ({lists.length})</span>
            <span>Click vào danh mục để gán</span>
          </div>
          <div className="max-h-[216px] overflow-y-auto rounded-lg bg-[#F8FAFF]">
            {loading ? (
              <Loader2 className="mx-auto my-8 size-5 animate-spin text-[#2563EB]" />
            ) : shown.length === 0 ? (
              <p className="py-8 text-center text-xs text-[#94A3B8]">
                {lists.length ? "Không tìm thấy danh mục phù hợp" : "Chưa có danh mục — tạo danh mục mới bên dưới"}
              </p>
            ) : (
              <div className="grid sm:grid-cols-2">
                {shown.map((l) => {
                  const on = l.id === selectedId && !typed;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => {
                        setSelectedId(l.id);
                        setName("");
                      }}
                      className="flex items-start gap-3 px-3 py-3 text-left hover:bg-[#EFF6FF]"
                    >
                      <span className={`mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border ${on ? "border-[#2563EB] bg-[#2563EB]" : "border-[#737686] bg-white"}`}>
                        {on && <span className="size-1.5 rounded-full bg-white" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-[#334155]">{l.name}</span>
                        <span className="text-[13px] text-[#334155]">Hiện có: {l.profile_count ?? 0} profile</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="space-y-2.5 px-3.5">
            <p className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-[#334155]">
              <PlusCircle className="size-4" /> Hoặc tạo danh mục mới
            </p>
            <div className="flex items-center gap-2">
              <input
                value={name}
                maxLength={255}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && canSave && save()}
                placeholder="Nhập tên danh mục mới... (VD: Danh mục KOL KOC)"
                className="h-10 min-w-0 flex-1 rounded-lg border border-[#737686] px-3 text-sm outline-none focus:border-[#2563EB]"
              />
              <button
                type="button"
                aria-label="Chọn màu danh mục"
                onClick={() => colorRef.current?.click()}
                className="relative flex size-10 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100"
                style={{ color }}
              >
                <Palette className="size-4" />
                <input ref={colorRef} type="color" tabIndex={-1} value={color} onChange={(e) => setColor(e.target.value)} className="pointer-events-none absolute inset-0 opacity-0" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2.5 px-6 py-4">
          <button type="button" disabled={saving} onClick={onClose} className="h-9 rounded-lg border border-[#E2E8F0] px-5 text-[13px] text-[#334155] hover:bg-slate-50">
            Hủy bỏ
          </button>
          <button type="button" disabled={!canSave} onClick={save} className="inline-flex h-9 items-center gap-3 rounded-lg bg-[#2563EB] px-5 text-[13px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Xác nhận lưu
          </button>
        </div>
      </div>
    </div>
  );
}
