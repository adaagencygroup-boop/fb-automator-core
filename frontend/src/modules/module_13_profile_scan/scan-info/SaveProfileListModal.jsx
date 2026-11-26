"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, FolderPlus, Loader2, Palette, PlusCircle, Save, Search, X } from "lucide-react";
import { toast } from "@/lib/toast";
import { getProfileLists, getProfileMemberships, saveProfilesToList } from "../service";

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
  const [conflict, setConflict] = useState(null); // { inTarget, others: [{ id, name, color, count }], names, total }
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
    const onKey = (e) => {
      if (e.key !== "Escape" || saving) return;
      if (conflict) setConflict(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, conflict, onClose]);

  const q = search.trim().toLowerCase();
  const shown = lists.filter((l) => l.name.toLowerCase().includes(q));
  const typed = name.trim();
  const canSave = !saving && profiles.length > 0 && (typed || selectedId != null);

  const target = typed || lists.find((l) => l.id === selectedId)?.name || "";

  const doSave = async () => {
    setSaving(true);
    try {
      const res = await saveProfilesToList(typed ? { name: typed, color, profiles } : { id: selectedId, profiles });
      const added = res?.added ?? profiles.length;
      const skipped = profiles.length - added;
      toast.success(`Đã lưu ${fmt(added)} profile vào "${target}"${skipped > 0 ? ` (${fmt(skipped)} profile đã có sẵn)` : ""}.`);
      onClose();
    } catch (err) {
      toast.error(err.message);
      setSaving(false);
    }
  };

  /** Có profile đã nằm trong danh mục sẵn có → hỏi lại trước khi lưu */
  const save = async () => {
    setSaving(true);
    let rows = [];
    try {
      rows = await getProfileMemberships(profiles.map((p) => String(p.uid)));
    } catch (err) {
      toast.error(`Không kiểm tra được danh mục hiện có: ${err.message}`);
      setSaving(false);
      return;
    }
    const targetId = typed ? null : selectedId;
    const inTarget = new Set(rows.find((r) => r.id === targetId)?.uids || []);
    const others = rows
      .filter((r) => r.id !== targetId)
      .map((r) => ({ ...r, uids: r.uids.filter((u) => !inTarget.has(u)) }))
      .filter((r) => r.uids.length);
    const taken = new Set([...inTarget, ...others.flatMap((r) => r.uids)]);
    if (!taken.size) return doSave();
    setSaving(false);
    setConflict({
      inTarget: inTarget.size,
      others: others.map((r) => ({ id: r.id, name: r.name, color: r.color, count: r.uids.length })),
      names: profiles.filter((p) => taken.has(String(p.uid))).map((p) => p.name || p.uid),
      total: taken.size,
    });
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
      {conflict && (
        <ConfirmExisting
          conflict={conflict}
          target={target}
          count={profiles.length}
          saving={saving}
          onCancel={() => setConflict(null)}
          onConfirm={doSave}
        />
      )}
    </div>
  );
}

const fmt = (n) => Number(n || 0).toLocaleString("vi-VN");

/** Cảnh báo profile đã có danh mục: lưu vẫn giữ profile ở danh mục cũ, chỉ thêm vào danh mục đích */
function ConfirmExisting({ conflict, target, count, saving, onCancel, onConfirm }) {
  const { inTarget, others, names, total } = conflict;
  const fresh = count - inTarget;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && !saving && onCancel()}>
      <div role="alertdialog" aria-modal="true" aria-label="Profile đã có danh mục" className="w-full max-w-[460px] rounded-xl bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#FEF3C7] text-[#D97706]">
            <AlertTriangle className="size-5" />
          </span>
          <div className="min-w-0">
            <h4 className="text-base font-bold text-[#0F172A]">{fmt(total)} profile đã có danh mục</h4>
            <p className="mt-1 text-[13px] leading-5 text-[#475569]">
              Trong {fmt(count)} profile đang lưu vào <b className="text-[#0F172A]">"{target}"</b>, có profile đã nằm trong danh mục sẵn có:
            </p>
          </div>
        </div>
        <ul className="mt-4 max-h-40 space-y-1.5 overflow-y-auto rounded-lg bg-[#F8FAFC] p-3 text-[13px] text-[#334155]">
          {inTarget > 0 && (
            <li className="flex items-center justify-between gap-2">
              <span className="truncate">Đã có sẵn trong <b>"{target}"</b> (sẽ bỏ qua)</span>
              <b className="shrink-0">{fmt(inTarget)}</b>
            </li>
          )}
          {others.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.color || "#94A3B8" }} />
                <span className="truncate">{c.name}</span>
              </span>
              <b className="shrink-0">{fmt(c.count)}</b>
            </li>
          ))}
        </ul>
        <p className="mt-2 truncate text-[11px] text-[#94A3B8]" title={names.join(", ")}>
          {names.slice(0, 4).join(", ")}{names.length > 4 ? ` và ${fmt(names.length - 4)} profile khác` : ""}
        </p>
        {others.length > 0 && (
          <p className="mt-3 text-[13px] leading-5 text-[#475569]">Lưu tiếp thì các profile này vẫn ở danh mục cũ và được thêm vào "{target}".</p>
        )}
        <div className="mt-5 flex justify-end gap-2.5">
          <button type="button" disabled={saving} onClick={onCancel} className="h-9 rounded-lg border border-[#E2E8F0] px-5 text-[13px] text-[#334155] hover:bg-slate-50">
            Quay lại
          </button>
          <button
            type="button"
            disabled={saving || fresh <= 0}
            onClick={onConfirm}
            title={fresh <= 0 ? "Tất cả profile đã có trong danh mục này" : undefined}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#2563EB] px-5 text-[13px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {fresh > 0 ? `Vẫn lưu ${fmt(fresh)} profile` : "Không có profile mới"}
          </button>
        </div>
      </div>
    </div>
  );
}
