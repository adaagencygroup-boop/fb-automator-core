"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  Copy,
  Eye,
  Filter,
  MoreVertical,
  RefreshCw,
  Trash2,
  UserPlus,
  Key,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Layers,
} from "lucide-react";
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
import { getAccounts } from "@/modules/module_02_account_manager/service";
import { deleteManagedPage, getManagedPages, syncPagesByAccount } from "./service";

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
  if (status === "SUCCESS") return item.status === "SUCCESS" || item.status === "ACTIVE";
  return item.status !== "SUCCESS" && item.status !== "ACTIVE";
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
          {item.page_id ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-[#334155] hover:bg-slate-50"
              onClick={() => {
                onCopy(item.page_id, "Page ID");
                setOpen(false);
              }}
            >
              <Copy className="h-3.5 w-3.5 text-[#94A3B8]" />
              Sao chép Page ID
            </button>
          ) : null}
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
  const router = useRouter();
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // States cho modal Quét & Thêm Fanpage từ Nick Facebook
  const [accountList, setAccountList] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [selectedAccUid, setSelectedAccUid] = useState("");
  const [customToken, setCustomToken] = useState("");
  const [showCustomToken, setShowCustomToken] = useState(false);
  const [syncing, setSyncing] = useState(false);

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

  // Tải danh sách tài khoản Facebook thuộc sở hữu của User hiện tại khi mở modal Thêm Page
  const loadAccounts = async () => {
    setLoadingAccounts(true);
    try {
      const data = await getAccounts();
      const list = Array.isArray(data) ? data : (data?.accounts || []);
      setAccountList(list);
      if (list.length > 0) {
        setSelectedAccUid((prev) => prev || list[0].uid);
      }
    } catch (e) {
      console.warn("Lỗi tải danh sách tài khoản:", e);
    } finally {
      setLoadingAccounts(false);
    }
  };

  useEffect(() => {
    if (adding) {
      loadAccounts();
      setCustomToken("");
      setShowCustomToken(false);
    }
  }, [adding]);

  const handleSyncPages = async (e) => {
    if (e) e.preventDefault();
    if (!selectedAccUid) {
      toast.error("Vui lòng chọn tài khoản Facebook để quét Fanpage.");
      return;
    }
    setSyncing(true);
    try {
      const res = await syncPagesByAccount({
        account_uid: selectedAccUid,
        custom_token: customToken.trim() || undefined,
      });
      if (res?.success) {
        toast.success(res.message || `Đã nạp thành công ${res.count} Fanpage!`);
        setAdding(false);
        await load();
      } else {
        toast.error(res?.detail || res?.message || "Quét Fanpage thất bại.");
      }
    } catch (error) {
      toast.error(error.message || "Không thể kết nối đến máy chủ để quét Fanpage.");
    } finally {
      setSyncing(false);
    }
  };

  const stats = useMemo(() => {
    const success = pages.filter((item) => item.status === "SUCCESS" || item.status === "ACTIVE").length;
    return { total: pages.length, success, failed: pages.length - success };
  }, [pages]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return pages.filter((item) => {
      if (!matchesStatus(item, status)) return false;
      if (!keyword) return true;
      return [item.page_name, item.page_id, item.manager_name, item.manager_uid, item.page_category]
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

  const selectedAcc = useMemo(() => {
    return accountList.find((a) => String(a.uid) === String(selectedAccUid)) || null;
  }, [accountList, selectedAccUid]);

  const hasLiveToken = Boolean(selectedAcc?.token && selectedAcc.token.trim().length > 10);

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
                            <p className="text-[11px] leading-4 text-[#94A3B8] flex items-center">
                              {item.page_id ? <span className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded mr-1.5 font-medium">{item.page_id}</span> : null}
                              <span>{pageSubtitle(item)}</span>
                            </p>
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
        <DialogContent className="max-w-[540px] p-6 rounded-2xl bg-white shadow-2xl">
          <DialogHeader className="pb-3 border-b border-slate-100">
            <DialogTitle className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-blue-50 text-[#1877F2]">
                <Layers className="w-5 h-5" />
              </span>
              Thêm & Nạp Fanpage vào hệ thống
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 pt-1">
              Chọn tài khoản Facebook quản lý để quét và tự động nạp toàn bộ Fanpage kèm Token vĩnh viễn (Never Expire).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-3">
            {/* LỰA CHỌN 1: QUÉT TỪ TÀI KHOẢN CÓ SẴN */}
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                  <span className="flex size-4 items-center justify-center rounded-full bg-[#1877F2] text-[10px] text-white font-bold">1</span>
                  Quét Fanpage từ tài khoản có sẵn
                </span>
                {loadingAccounts ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />
                ) : null}
              </div>

              {accountList.length === 0 && !loadingAccounts ? (
                <div className="rounded-lg bg-amber-50/80 border border-amber-200/60 p-3 text-xs text-amber-800">
                  Bạn chưa có tài khoản Facebook nào trong hệ thống. Hãy thêm tài khoản ở Lựa chọn 2 bên dưới.
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Chọn tài khoản Facebook quản lý
                    </label>
                    <select
                      value={selectedAccUid}
                      onChange={(e) => setSelectedAccUid(e.target.value)}
                      className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-800 outline-none focus:border-[#1877F2] focus:ring-1 focus:ring-[#1877F2]"
                    >
                      {accountList.map((acc) => (
                        <option key={acc.uid} value={acc.uid}>
                          {acc.profile_name || "Tài khoản FB"} (UID: {acc.uid}) {acc.token ? "• [Token LIVE]" : "• [Chưa có Token]"}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedAcc ? (
                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-slate-200 text-xs">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <PhotoAvatar
                          src={selectedAcc.avatar_url || facebookPictureUrl(selectedAcc.uid)}
                          seed={selectedAcc.profile_name || selectedAcc.uid}
                          name={selectedAcc.profile_name || selectedAcc.uid}
                          size={32}
                        />
                        <div className="min-w-0">
                          <p className="font-bold text-slate-800 truncate">{selectedAcc.profile_name || "Tài khoản Facebook"}</p>
                          <p className="text-[11px] text-slate-500 font-mono">UID: {selectedAcc.uid}</p>
                        </div>
                      </div>
                      <div>
                        {hasLiveToken ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <ShieldCheck className="w-3 h-3" /> Token LIVE
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            <ShieldAlert className="w-3 h-3" /> Chưa có Token
                          </span>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {/* Toggle ô nhập token thủ công */}
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowCustomToken(!showCustomToken)}
                      className="text-[11px] text-[#1877F2] hover:underline flex items-center gap-1 font-medium"
                    >
                      <Key className="w-3 h-3" />
                      {showCustomToken ? "Ẩn ô nhập Access Token" : "Cập nhật / Dán Access Token mới cho nick này"}
                    </button>
                    {showCustomToken ? (
                      <div className="mt-2">
                        <input
                          type="text"
                          value={customToken}
                          onChange={(e) => setCustomToken(e.target.value)}
                          placeholder="Dán User Access Token (EAA...) vào đây..."
                          className="w-full h-9 px-3 rounded-lg border border-slate-200 bg-white text-xs font-mono text-slate-700 outline-none focus:border-[#1877F2]"
                        />
                        <p className="text-[10.5px] text-slate-400 mt-1">
                          Hệ thống sẽ tự động dùng token này để quét Fanpage và lưu lại cho tài khoản.
                        </p>
                      </div>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={handleSyncPages}
                    disabled={syncing || !selectedAccUid}
                    className="w-full h-10 rounded-xl bg-[#1877F2] hover:bg-blue-600 font-bold text-white text-xs flex items-center justify-center gap-2 shadow-sm transition-all disabled:opacity-60"
                  >
                    {syncing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Đang quét & nạp Fanpage...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Quét & Nạp tất cả Fanpage
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* LỰA CHỌN 2: THÊM TÀI KHOẢN MỚI */}
            <div className="rounded-xl border border-dashed border-slate-300 p-4 bg-white hover:bg-slate-50/60 transition-colors flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#1877F2]">
                  <UserPlus className="w-4 h-4" />
                </span>
                <div>
                  <p className="text-xs font-bold text-slate-800">Thêm tài khoản Facebook mới</p>
                  <p className="text-[11px] text-slate-500">Chuyển sang Module 02 để đăng nhập thêm nick vào hệ thống</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  router.push("/accounts");
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 flex items-center gap-1.5 shrink-0 transition-colors"
              >
                Mở Quản lý Acc
                <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>
          </div>

          <DialogFooter className="pt-4 border-t border-slate-100 mt-2">
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="h-9 rounded-lg border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Đóng
            </button>
          </DialogFooter>
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
