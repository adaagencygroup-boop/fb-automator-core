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
  Zap,
  Globe,
  Monitor,
  Loader2,
  Search,
  Info,
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
import {
  deleteManagedPage,
  getManagedPages,
  syncPagesByAccount,
  getOAuthConfig,
  syncPagesByToken,
  oauthByProfile,
} from "./service";

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
  const [syncing, setSyncing] = useState(null); // UID đang quét hoặc null
  const [oauthLoading, setOauthLoading] = useState(false);
  const [profileOauthLoading, setProfileOauthLoading] = useState(null); // UID đang cấp token hoặc null
  const [showLiveBrowser, setShowLiveBrowser] = useState(false);
  const [accQuery, setAccQuery] = useState("");
  const [accStatusFilter, setAccStatusFilter] = useState("all");
  const [accLoginFilter, setAccLoginFilter] = useState("all");

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

    // Bắt token tự động khi Facebook OAuth redirect quay lại URL kèm #access_token=...
    if (typeof window !== "undefined" && window.location.hash.includes("access_token=")) {
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const token = hashParams.get("access_token");
      if (token) {
        window.history.replaceState(null, "", window.location.pathname);
        toast.info("Đang đồng bộ Fanpage từ tài khoản Facebook vừa đăng nhập...");
        syncPagesByToken({ access_token: token })
          .then((res) => {
            if (res?.success) {
              toast.success(res.message || `Đã đồng bộ thành công ${res.count} Fanpage!`);
              load();
            } else {
              toast.error(res?.detail || res?.message || "Không thể đồng bộ Fanpage từ Facebook.");
            }
          })
          .catch((err) => {
            toast.error(err.message || "Lỗi kết nối khi đồng bộ Fanpage.");
          });
      }
    }
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
      setAccQuery("");
      setAccStatusFilter("all");
      setAccLoginFilter("all");
    }
  }, [adding]);

  // Bộ lọc tài khoản trong bảng
  const filteredAccounts = useMemo(() => {
    const q = accQuery.trim().toLowerCase();
    return accountList.filter((acc) => {
      const isLive = acc.status === "active";
      if (accStatusFilter === "live" && !isLive) return false;
      if (accStatusFilter === "die" && isLive) return false;

      const isLoggedIn = acc.login_status === "logged_in";
      if (accLoginFilter === "logged_in" && !isLoggedIn) return false;
      if (accLoginFilter === "not_logged_in" && isLoggedIn) return false;

      if (!q) return true;
      return (
        (acc.profile_name && acc.profile_name.toLowerCase().includes(q)) ||
        (acc.uid && String(acc.uid).includes(q))
      );
    });
  }, [accountList, accQuery, accStatusFilter, accLoginFilter]);

  const handleSyncPages = async (targetUid) => {
    const uid = targetUid || selectedAccUid;
    if (!uid) {
      toast.error("Vui lòng chọn tài khoản Facebook để quét Fanpage.");
      return;
    }
    setSyncing(uid);
    try {
      const res = await syncPagesByAccount({
        account_uid: uid,
        custom_token: customToken.trim() || undefined,
      });
      if (res?.success) {
        toast.success(res.message || `Đã nạp thành công ${res.count} Fanpage!`);
        await loadAccounts();
        await load();
      } else {
        toast.error(res?.detail || res?.message || "Quét Fanpage thất bại.");
      }
    } catch (error) {
      toast.error(error.message || "Không thể kết nối đến máy chủ để quét Fanpage.");
    } finally {
      setSyncing(null);
    }
  };

  // Luồng 1: OAuth qua Chrome Profile của nick Clone
  const handleProfileOAuth = async (targetUid) => {
    const uid = targetUid || selectedAccUid;
    if (!uid) {
      toast.error("Vui lòng chọn tài khoản Facebook để cấp Token.");
      return;
    }
    setProfileOauthLoading(uid);
    try {
      toast.info(`Đang mở profile Chrome của nick ${uid} để cấp Token mới từ Meta...`);
      const res = await oauthByProfile({
        account_uid: uid,
        headless: !showLiveBrowser,
      });
      if (res?.success) {
        toast.success(res.message || `Đã cấp Token mới và nạp ${res.count} Fanpage!`);
        await loadAccounts();
        await load();
      } else {
        toast.error(res?.detail || res?.message || "Cấp Token qua Chrome Profile thất bại.");
      }
    } catch (error) {
      toast.error(error.message || "Không thể kết nối máy chủ để thực hiện OAuth.");
    } finally {
      setProfileOauthLoading(null);
    }
  };

  // Luồng 2: OAuth trực tiếp trên Web Dashboard
  const handleWebOAuthLogin = async () => {
    try {
      setOauthLoading(true);
      const conf = await getOAuthConfig();
      if (!conf?.configured || !conf?.app_id) {
        toast.error("Chưa cấu hình FACEBOOK_APP_ID trong file .env. Vui lòng cấu hình App ID của Meta trước.");
        return;
      }
      const redirectUri = window.location.origin + window.location.pathname;
      const scope = "pages_show_list,pages_manage_posts,pages_read_engagement";
      const authUrl = `https://www.facebook.com/${conf.api_version || "v19.0"}/dialog/oauth?client_id=${conf.app_id}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&response_type=token`;
      window.location.href = authUrl;
    } catch (err) {
      toast.error("Không thể lấy cấu hình OAuth: " + err.message);
    } finally {
      setOauthLoading(false);
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
        <DialogContent className="max-w-5xl w-full p-6 rounded-2xl bg-white shadow-2xl overflow-hidden">
          <DialogHeader className="pb-3 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-blue-50 text-[#1877F2]">
                  <Layers className="w-5 h-5" />
                </span>
                Thêm & Nạp Fanpage vào hệ thống
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-slate-500 pt-0.5">
              Cấp Token và quét Fanpage tự động qua dàn nick Clone (cột bên trái) hoặc Đăng nhập trực tiếp trên trình duyệt (cột bên phải).
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-2">
            {/* CỘT TRÁI (7 COLS): BẢNG DANH SÁCH TÀI KHOẢN CLONE */}
            <div className="lg:col-span-7 flex flex-col rounded-xl border border-slate-200/90 bg-slate-50/50 p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                  <span className="flex size-4 items-center justify-center rounded-full bg-[#1877F2] text-[10px] text-white font-bold">1</span>
                  Dàn nick Clone ({filteredAccounts.length}/{accountList.length})
                </span>
                <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-slate-600 font-medium hover:text-slate-800">
                  <input
                    type="checkbox"
                    checked={showLiveBrowser}
                    onChange={(e) => setShowLiveBrowser(e.target.checked)}
                    className="rounded border-slate-300 text-[#1877F2] focus:ring-[#1877F2] w-3.5 h-3.5"
                  />
                  <Monitor className="w-3.5 h-3.5 text-slate-400" />
                  Mở Chrome Live
                </label>
              </div>

              {/* BỘ LỌC VÀ TÌM KIẾM TÀI KHOẢN */}
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-6 relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={accQuery}
                    onChange={(e) => setAccQuery(e.target.value)}
                    placeholder="Tìm tên hoặc UID nick..."
                    className="w-full h-8 pl-8 pr-2 text-xs rounded-lg border border-slate-200 bg-white placeholder:text-slate-400 outline-none focus:border-[#1877F2]"
                  />
                </div>
                <div className="col-span-3">
                  <select
                    value={accStatusFilter}
                    onChange={(e) => setAccStatusFilter(e.target.value)}
                    className="w-full h-8 px-2 text-[11px] font-medium rounded-lg border border-slate-200 bg-white text-slate-700 outline-none focus:border-[#1877F2]"
                  >
                    <option value="all">Mọi trạng thái</option>
                    <option value="live">● Nick Sống (Live)</option>
                    <option value="die">✕ Bị Checkpoint</option>
                  </select>
                </div>
                <div className="col-span-3">
                  <select
                    value={accLoginFilter}
                    onChange={(e) => setAccLoginFilter(e.target.value)}
                    className="w-full h-8 px-2 text-[11px] font-medium rounded-lg border border-slate-200 bg-white text-slate-700 outline-none focus:border-[#1877F2]"
                  >
                    <option value="all">Mọi đăng nhập</option>
                    <option value="logged_in">● Đã login</option>
                    <option value="not_logged_in">○ Chưa login</option>
                  </select>
                </div>
              </div>

              {/* BẢNG TÀI KHOẢN GỌN GÀNG, CUỘN MƯỢT TỐI ĐA 370PX */}
              <div className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-2xs">
                <div className="max-h-[350px] overflow-y-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="sticky top-0 bg-slate-100/90 backdrop-blur-xs text-[10.5px] uppercase font-bold text-slate-500 border-b border-slate-200 z-10">
                      <tr>
                        <th className="py-2 px-3">Tài khoản</th>
                        <th className="py-2 px-2 text-center">TT Nick</th>
                        <th className="py-2 px-2 text-center">Đăng nhập</th>
                        <th className="py-2 px-2 text-center">Token</th>
                        <th className="py-2 px-2.5 text-right">Hành động</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {loadingAccounts ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-slate-400">
                            <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1 text-slate-400" />
                            Đang tải danh sách tài khoản...
                          </td>
                        </tr>
                      ) : filteredAccounts.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-slate-400">
                            Không tìm thấy tài khoản nào phù hợp bộ lọc.
                          </td>
                        </tr>
                      ) : (
                        filteredAccounts.map((acc) => {
                          const hasToken = Boolean(acc.token && acc.token.trim().length > 10);
                          const isLive = acc.status === "active";
                          const isLoggedIn = acc.login_status === "logged_in";
                          const isProcessing = profileOauthLoading === acc.uid || syncing === acc.uid;

                          return (
                            <tr key={acc.uid} className="hover:bg-slate-50/80 transition-colors">
                              <td className="py-2 px-3">
                                <div className="flex items-center gap-2 min-w-0">
                                  <PhotoAvatar
                                    src={acc.avatar_url || facebookPictureUrl(acc.uid)}
                                    seed={acc.profile_name || acc.uid}
                                    name={acc.profile_name || acc.uid}
                                    size={26}
                                  />
                                  <div className="min-w-0">
                                    <p className="font-semibold text-slate-800 truncate max-w-[130px]" title={acc.profile_name || acc.uid}>
                                      {acc.profile_name || "Tài khoản FB"}
                                    </p>
                                    <p className="text-[10px] text-slate-400 font-mono truncate">{acc.uid}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="py-2 px-2 text-center whitespace-nowrap">
                                {isLive ? (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    Live
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                                    Check
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-2 text-center whitespace-nowrap">
                                {isLoggedIn ? (
                                  <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50/70 px-1.5 py-0.5 rounded">
                                    Đã login
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                                    Chưa
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-2 text-center whitespace-nowrap">
                                {hasToken ? (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">
                                    <ShieldCheck className="w-2.5 h-2.5 text-blue-600" /> LIVE
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                                    Chưa có
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-2.5 text-right whitespace-nowrap">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleProfileOAuth(acc.uid)}
                                    disabled={isProcessing}
                                    className="h-7 px-2 rounded-md bg-blue-600 hover:bg-blue-700 font-bold text-[10.5px] text-white flex items-center gap-1 shadow-2xs transition-all disabled:opacity-50"
                                    title="Mở Chrome Profile của nick này để tự động cấp Token và nạp Fanpage"
                                  >
                                    {profileOauthLoading === acc.uid ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <Zap className="w-3 h-3 text-amber-300 fill-amber-300" />
                                    )}
                                    {hasToken ? "Cấp lại" : "Cấp Token"}
                                  </button>

                                  {hasToken ? (
                                    <button
                                      type="button"
                                      onClick={() => handleSyncPages(acc.uid)}
                                      disabled={isProcessing}
                                      className="h-7 px-2 rounded-md border border-slate-200 bg-white hover:bg-slate-50 font-medium text-[10.5px] text-slate-700 flex items-center gap-1 transition-all disabled:opacity-50"
                                      title="Quét Fanpage bằng Token hiện có"
                                    >
                                      {syncing === acc.uid ? (
                                        <RefreshCw className="w-3 h-3 animate-spin text-slate-400" />
                                      ) : (
                                        <Sparkles className="w-3 h-3 text-blue-500" />
                                      )}
                                      Quét
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* CỘT PHẢI (5 COLS): ĐĂNG NHẬP TRÌNH DUYỆT CHÍNH + HƯỚNG DẪN + THÊM NICK */}
            <div className="lg:col-span-5 flex flex-col space-y-3 justify-between">
              {/* KHỐI ĐĂNG NHẬP OAUTH TRÊN TRÌNH DUYỆT NÀY */}
              <div className="rounded-xl border border-blue-200/80 bg-gradient-to-b from-blue-50/70 to-white p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-blue-900 uppercase tracking-wide flex items-center gap-1.5">
                    <span className="flex size-4 items-center justify-center rounded-full bg-[#1877F2] text-[10px] text-white font-bold">2</span>
                    Đăng nhập trên trình duyệt này
                  </span>
                  <span className="text-[10px] font-semibold text-blue-600 bg-blue-100/70 px-2 py-0.5 rounded-full">
                    OAuth Meta
                  </span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Dành cho tài khoản Facebook cá nhân hoặc nick quản trị viên đang mở trên trình duyệt hiện tại. Meta sẽ tự động cấp Token dài hạn và nạp Fanpage.
                </p>
                <button
                  type="button"
                  onClick={handleWebOAuthLogin}
                  disabled={oauthLoading}
                  className="w-full h-11 rounded-xl bg-[#1877F2] hover:bg-blue-600 font-bold text-white text-xs flex items-center justify-center gap-2 shadow-sm transition-all disabled:opacity-60"
                >
                  {oauthLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Đang kết nối Facebook OAuth...
                    </>
                  ) : (
                    <>
                      <Globe className="w-4 h-4" />
                      🔗 Đăng nhập Facebook (OAuth)
                    </>
                  )}
                </button>
              </div>

              {/* KHỐI THÔNG TIN CƠ CHẾ TOKEN VĨNH VIỄN */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-1.5 text-xs">
                <div className="flex items-center gap-1.5 font-bold text-slate-700">
                  <Info className="w-4 h-4 text-blue-600 shrink-0" />
                  Cơ chế Token vĩnh viễn (Never Expire)
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Hệ thống tự động chuyển đổi User Token sang Long-lived token và gọi Meta API lấy Page Token vĩnh viễn không hết hạn (trừ phi đổi mật khẩu Facebook hoặc hủy quyền App).
                </p>
              </div>

              {/* KHỐI THÊM NICK MỚI */}
              <div className="rounded-xl border border-dashed border-slate-300 p-3 bg-white hover:bg-slate-50/80 transition-colors flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                    <UserPlus className="w-4 h-4" />
                  </span>
                  <div>
                    <p className="text-xs font-bold text-slate-800">Thêm tài khoản Facebook mới</p>
                    <p className="text-[10.5px] text-slate-500">Nạp thêm nick via/clone vào hệ thống</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    router.push("/accounts");
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 flex items-center gap-1 shrink-0 transition-colors"
                >
                  Mở Quản lý Acc
                  <ExternalLink className="w-3 h-3 text-slate-400" />
                </button>
              </div>
            </div>
          </div>

          <DialogFooter className="pt-3 border-t border-slate-100 mt-2">
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
