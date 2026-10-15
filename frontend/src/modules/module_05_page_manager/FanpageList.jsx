"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, Copy, Eye, Filter, MoreVertical, RefreshCw, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import CustomSelect from "@/components/ui/custom-select";
import Pagination from "@/components/ui/pagination";
import { MaskIcon } from "@/components/icons";
import { toast } from "@/lib/toast";
import { addManualPage, deleteManagedPage, getManagedPages } from "./service";

const PAGE_SIZE = 10;
const STATUS_OPTIONS = [
  { value: "ALL", label: "Tất cả trạng thái" },
  { value: "SUCCESS", label: "Đang hoạt động" },
  { value: "ERROR", label: "Lỗi / Mất kết nối" },
];

const AVATAR_COLORS = ["#1877F2", "#0084FF", "#087A62", "#4F46E5", "#0284C7"];

function avatarColor(seed) {
  const text = String(seed || "?");
  return AVATAR_COLORS[text.charCodeAt(0) % AVATAR_COLORS.length];
}

function initial(value) {
  const text = String(value || "").trim();
  return (text[0] || "?").toUpperCase();
}

function facebookPictureUrl(urlOrUid) {
  const raw = String(urlOrUid || "").trim();
  if (!raw) return "";
  const graph = (id) =>
    `https://graph.facebook.com/${encodeURIComponent(id)}/picture?type=square&width=80&height=80`;
  if (/^\d{4,20}$/.test(raw)) return graph(raw);
  try {
    const parsed = new URL(raw);
    if (!parsed.hostname.includes("facebook.com")) return "";
    const queryId = parsed.searchParams.get("id") || "";
    if (/^\d{4,20}$/.test(queryId)) return graph(queryId);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (!parts.length) return "";
    const first = parts[0];
    const last = parts[parts.length - 1];
    if (["people", "pages"].includes(first.toLowerCase()) && /^\d{4,20}$/.test(last)) return graph(last);
    if (["login", "messages", "settings", "profile.php"].includes(first.toLowerCase())) return "";
    return graph(first);
  } catch {
    return "";
  }
}

function pageSubtitle(item) {
  const category = String(item.page_category || "").trim();
  if (category) return category;
  if (item.page_url) return "Fanpage Facebook";
  return "Chưa có chuyên mục";
}

function matchesStatus(item, status) {
  if (status === "ALL") return true;
  if (status === "SUCCESS") return item.status === "SUCCESS";
  return item.status !== "SUCCESS";
}

function StatCard({ label, value, loading, icon, iconClass, cardClass, labelClass, valueClass = "text-[#0F172A]" }) {
  return (
    <article className={`flex flex-1 items-center rounded-xl border p-[17px] ${cardClass}`}>
      <span
        className={`flex size-12 shrink-0 items-center justify-center rounded-xl text-white shadow-[0px_1px_1px_rgba(0,0,0,0.05)] ${iconClass}`}
      >
        {icon}
      </span>
      <div className="pl-4">
        <p className={`text-2xl font-bold leading-6 ${valueClass}`}>
          {loading ? <span className="block h-6 w-12 rounded bg-slate-200/70" /> : value.toLocaleString("vi-VN")}
        </p>
        <p className={`mt-1 text-xs font-medium leading-4 ${labelClass}`}>{label}</p>
      </div>
    </article>
  );
}

function InitialsAvatar({ seed, name, size = 36 }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full border border-[#E2E8F0] font-bold text-white"
      style={{
        width: size,
        height: size,
        backgroundColor: avatarColor(seed || name),
        fontSize: size >= 36 ? 13 : 11,
      }}
    >
      {initial(name || seed)}
    </span>
  );
}

function PhotoAvatar({ src, seed, name, size = 36 }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full border border-[#E2E8F0] object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return <InitialsAvatar seed={seed} name={name} size={size} />;
}

function RowMenu({ item, onCopy, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex size-[15px] items-center justify-center text-[#94A3B8] hover:text-[#334155]"
        title="Thêm thao tác"
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div className="absolute right-0 top-[22px] z-20 min-w-[168px] rounded-lg border border-[#E2E8F0] bg-white py-1 shadow-[0_8px_24px_rgba(15,23,42,0.12)]">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-[#334155] hover:bg-slate-50"
            onClick={() => {
              onCopy(item.manager_uid, "UID");
              setOpen(false);
            }}
          >
            <Copy className="h-3.5 w-3.5 text-[#94A3B8]" />
            Sao chép UID
          </button>
          {item.page_url ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-[#334155] hover:bg-slate-50"
              onClick={() => {
                onCopy(item.page_url, "link");
                setOpen(false);
              }}
            >
              <Copy className="h-3.5 w-3.5 text-[#94A3B8]" />
              Sao chép link
            </button>
          ) : null}
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-[#DC2626] hover:bg-red-50"
            onClick={() => {
              onDelete(item);
              setOpen(false);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Xóa page
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function FanpageList() {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ page_name: "", page_url: "", manager_uid: "" });
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getManagedPages();
      setPages(Array.isArray(data?.pages) ? data.pages : []);
    } catch (error) {
      toast.error(error.message || "Không tải được danh sách fanpage.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    const success = pages.filter((item) => item.status === "SUCCESS").length;
    return { total: pages.length, success, failed: pages.length - success };
  }, [pages]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return pages.filter((item) => {
      if (!matchesStatus(item, status)) return false;
      if (!keyword) return true;
      return [item.page_name, item.manager_name, item.manager_uid, item.page_category]
        .some((field) => String(field || "").toLowerCase().includes(keyword));
    });
  }, [pages, query, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [query, status]);

  const copyText = async (value, label) => {
    if (!value) {
      toast.error(`Không có ${label} để sao chép.`);
      return;
    }
    try {
      await navigator.clipboard.writeText(String(value));
      toast.success(`Đã sao chép ${label}.`);
    } catch {
      toast.error(`Không sao chép được ${label}.`);
    }
  };

  const submitManual = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await addManualPage(form);
      toast.success("Đã thêm fanpage vào danh sách.");
      setAdding(false);
      setForm({ page_name: "", page_url: "", manager_uid: "" });
      await load();
    } catch (error) {
      toast.error(error.message || "Không thêm được fanpage.");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteManagedPage(pendingDelete.id);
      toast.success("Đã xóa bản ghi fanpage.");
      setPendingDelete(null);
      await load();
    } catch (error) {
      toast.error(error.message || "Không xóa được fanpage.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="-m-6 min-h-full space-y-6 bg-background p-8">
      <div className="flex flex-col gap-4 md:flex-row">
        <StatCard
          label="Tổng số Page"
          value={stats.total}
          loading={loading}
          icon={<MaskIcon src="/icons/icon_header_flag.svg" width={18} height={20} className="text-white" />}
          iconClass="bg-[#0284C7]"
          cardClass="bg-white border-[#E2E8F0]"
          labelClass="text-[#0284C7]"
        />
        <StatCard
          label="Đang hoạt động"
          value={stats.success}
          loading={loading}
          icon={<Check className="h-5 w-5" strokeWidth={3} />}
          iconClass="bg-[#10B981]"
          cardClass="bg-[#F0FDF4] border-[#BBF7D0]"
          labelClass="text-[#059669]"
          valueClass="text-[#059669]"
        />
        <StatCard
          label="Lỗi / Mất kết nối"
          value={stats.failed}
          loading={loading}
          icon={<AlertCircle className="h-5 w-5" strokeWidth={2.4} />}
          iconClass="bg-[#EF4444]"
          cardClass="bg-[#FEF2F2] border-[#FECACA]"
          labelClass="text-[#DC2626]"
          valueClass="text-[#DC2626]"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[220px] max-w-[320px] flex-1">
          <img
            src="/icons/icon_search.svg"
            alt=""
            width={12}
            height={12}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm kiếm Page theo tên..."
            className="h-[38px] w-full rounded-lg border border-[#CBD5E1] bg-white pl-[37px] pr-3 text-xs text-[#1E293B] outline-none placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15"
          />
        </label>
        <CustomSelect
          value={status}
          onChange={setStatus}
          options={STATUS_OPTIONS}
          prefixIcon={<Filter className="h-3 w-3" />}
          className="w-[180px] shrink-0"
          buttonClassName="h-[34px] rounded-lg border-[#CBD5E1] text-xs font-medium text-[#334155] shadow-none"
        />
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-[34px] w-[134px] items-center justify-center rounded-lg bg-[#2563EB] text-[12px] font-bold uppercase tracking-[0.3px] text-white shadow-[0px_1px_1px_rgba(0,0,0,0.05)] hover:bg-blue-700"
          >
            + Thêm page
          </button>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex h-[34px] items-center justify-center rounded-lg border border-[#0284C7] bg-white px-[15px] text-[#0284C7] hover:bg-sky-50 disabled:opacity-60"
            title="Làm mới"
          >
            <RefreshCw className={`h-[11px] w-[11px] ${loading ? "animate-spin" : ""}`} strokeWidth={2.6} />
          </button>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[#E2E8F0]">
                <th className="w-14 px-3 py-3 text-xs font-semibold text-[#334155]">STT</th>
                <th className="px-5 py-3 text-xs font-semibold text-[#334155]">Tên Page</th>
                <th className="px-5 py-3 text-xs font-semibold text-[#334155]">Acc quản lý</th>
                <th className="w-40 px-4 py-3 text-center text-xs font-semibold text-[#334155]">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-16 text-center text-sm text-[#94A3B8]">
                    {loading ? "Đang tải danh sách..." : "Chưa có fanpage nào khớp bộ lọc."}
                  </td>
                </tr>
              ) : (
                rows.map((item, index) => {
                  const manager = item.manager_name || item.manager_uid || "—";
                  return (
                    <tr key={item.id} className="border-t border-[#E2E8F0] hover:bg-slate-50/70">
                      <td className="px-3 py-[22px] text-xs font-medium text-[#475569]">
                        {(safePage - 1) * PAGE_SIZE + index + 1}
                      </td>
                      <td className="px-4 py-[14px]">
                        <div className="flex items-center">
                          <PhotoAvatar
                            src={item.page_avatar_url || facebookPictureUrl(item.page_url)}
                            seed={item.page_name}
                            name={item.page_name}
                            size={36}
                          />
                          <div className="min-w-0 pl-3">
                            {item.page_url ? (
                              <a
                                href={item.page_url}
                                target="_blank"
                                rel="noreferrer"
                                className="block truncate text-[13px] font-bold leading-4 text-[#1E293B] hover:text-[#0284C7]"
                              >
                                {item.page_name || "—"}
                              </a>
                            ) : (
                              <p className="truncate text-[13px] font-bold leading-4 text-[#1E293B]">{item.page_name || "—"}</p>
                            )}
                            <p className="text-[11px] leading-4 text-[#94A3B8]">{pageSubtitle(item)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-[14px]">
                        <div className="flex items-center">
                          <PhotoAvatar
                            src={item.manager_avatar_url || facebookPictureUrl(item.manager_uid)}
                            seed={manager}
                            name={item.manager_name || item.manager_uid}
                            size={32}
                          />
                          <div className="min-w-0 pl-2.5">
                            <p className="truncate text-xs font-semibold leading-4 text-[#1E293B]">
                              {item.manager_name || "Chưa có tên"}
                            </p>
                            <p className="text-[10.5px] leading-4 text-[#94A3B8]">
                              UID: {item.manager_uid || "—"}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-[14px]">
                        <div className="flex items-center justify-center gap-3">
                          {item.page_url ? (
                            <a
                              href={item.page_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[#94A3B8] hover:text-[#0284C7]"
                              title="Xem fanpage"
                            >
                              <Eye className="h-[15px] w-[15px]" />
                            </a>
                          ) : (
                            <span className="inline-flex size-[15px] text-[#E2E8F0]">
                              <Eye className="h-[15px] w-[15px]" />
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => setPendingDelete(item)}
                            className="text-[#F43F5E] hover:text-[#E11D48]"
                            title="Xóa bản ghi"
                          >
                            <Trash2 className="h-[14px] w-[14px]" />
                          </button>
                          <RowMenu
                            item={item}
                            onCopy={copyText}
                            onDelete={setPendingDelete}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > PAGE_SIZE ? (
          <div className="flex justify-end border-t border-[#E2E8F0] px-4 py-3">
            <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
          </div>
        ) : null}
      </section>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Thêm fanpage</DialogTitle>
            <DialogDescription>Ghi page đã có vào danh sách. Không tạo page mới trên Facebook.</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={submitManual}>
            <label className="block text-sm font-semibold text-slate-700">
              Tên fanpage
              <input
                required
                value={form.page_name}
                onChange={(event) => setForm((current) => ({ ...current, page_name: event.target.value }))}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-normal outline-none focus:border-[#2563EB]"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              Link fanpage
              <input
                value={form.page_url}
                onChange={(event) => setForm((current) => ({ ...current, page_url: event.target.value }))}
                placeholder="https://www.facebook.com/..."
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-normal outline-none focus:border-[#2563EB]"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              UID tài khoản quản lý
              <input
                required
                inputMode="numeric"
                value={form.manager_uid}
                onChange={(event) => setForm((current) => ({ ...current, manager_uid: event.target.value }))}
                placeholder="1000..."
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 font-mono text-sm font-normal outline-none focus:border-[#2563EB]"
              />
            </label>
            <DialogFooter>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={saving}
                className="h-10 rounded-xl bg-[#2563EB] px-4 text-sm font-bold text-white disabled:opacity-60"
              >
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Xóa bản ghi fanpage</DialogTitle>
            <DialogDescription>
              Xóa “{pendingDelete?.page_name || ""}” khỏi danh sách trên hệ thống. Page trên Facebook vẫn giữ nguyên.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deleting}
              className="h-10 rounded-xl bg-rose-600 px-4 text-sm font-bold text-white disabled:opacity-60"
            >
              {deleting ? "Đang xóa..." : "Xóa"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
