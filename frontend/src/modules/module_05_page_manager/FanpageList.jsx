"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { getSessionUserId } from "@/services/sessionIdentity.mjs";
import { useSession } from "@/components/SessionContext";
import { tokenExpiryLabel } from "./tokenExpiry.mjs";
import { cachedTokenStatuses, readTokenCache, tokenCacheKey, tokenStorage } from "./tokenStatusCache.mjs";
import useWebFacebookConnection from "./useWebFacebookConnection";
import useSyncAccounts from "./useSyncAccounts";
import { WebConnectionButton } from "./WebFacebookConnection";
import styles from "./FanpageList.module.css";
import PageAccountFilter from "./PageAccountFilter.jsx";
import { ALL_ACCOUNTS, matchesPageAccount, pageAccountOptions } from "./pageAccountFilter.mjs";
import {
  deleteManagedPage,
  getManagedPages,
  syncPagesByAccount,
  oauthByProfile,
  verifyTokens,
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
  const [failedSrc, setFailedSrc] = useState(null);
  if (src && failedSrc !== src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setFailedSrc(src)}
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
  const session = useSession();
  const owner = String(session?.user?.id || getSessionUserId() || "");
  return <OwnedFanpageList key={owner} owner={owner} />;
}

function OwnedFanpageList({ owner }) {
  const router = useRouter();
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [accountFilter, setAccountFilter] = useState(ALL_ACCOUNTS);
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // States cho modal Quét & Thêm Fanpage từ Nick Facebook
  const { accounts: accountList, loading: loadingAccounts, loaded: accountsLoaded, error: accountsError, load: loadAccounts } = useSyncAccounts();
  const alive = useRef(false);
  const pagesRevision = useRef(0);
  const verifyingUids = useRef(new Set());
  const tokenRevision = useRef({});
  const modalOpen = useRef(null);
  const [accountsReadyForOpen, setAccountsReadyForOpen] = useState(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const selectedAccUid = accountList[0]?.uid || "";
  const [customToken, setCustomToken] = useState("");
  const [showCustomToken, setShowCustomToken] = useState(false);
  const [accountJobs, setAccountJobs] = useState({});
  const activeAccounts = useRef(new Set());
  const [tokenStatusMap, setTokenStatusMap] = useState(() => {
    return cachedTokenStatuses(tokenStorage(), owner);
  });
  const [verifyingTokens, setVerifyingTokens] = useState(false);
  const [accQuery, setAccQuery] = useState("");
  const [accStatusFilter, setAccStatusFilter] = useState("all");
  const [accLoginFilter, setAccLoginFilter] = useState("all");

  const load = async () => {
    const request = ++pagesRevision.current;
    try {
      const data = await getManagedPages();
      if (alive.current && pagesRevision.current === request) setPages(Array.isArray(data?.pages) ? data.pages : []);
    } catch (error) {
      if (alive.current && pagesRevision.current === request) toast.error(error.message || "Không tải được danh sách fanpage.");
    } finally {
      if (alive.current && pagesRevision.current === request) setLoading(false);
    }
  };

  useEffect(() => {
    const request = ++pagesRevision.current;
    getManagedPages().then((data) => {
      if (alive.current && pagesRevision.current === request) setPages(Array.isArray(data?.pages) ? data.pages : []);
    }).catch((failure) => {
      if (alive.current && pagesRevision.current === request) toast.error(failure.message || "Không tải được danh sách fanpage.");
    }).finally(() => { if (alive.current && pagesRevision.current === request) setLoading(false); });
  }, []);

  // Kiểm tra trạng thái sống/chết thực tế của Token qua Meta Graph API (hỗ trợ Cache TTL 15 phút)
  const handleVerifyTokens = useCallback(async (targetUids = null, force = false, silent = false) => {
    const cacheKey = tokenCacheKey(owner);
    const allUids = targetUids && targetUids.length > 0
      ? targetUids
      : accountList.filter((a) => a.has_token).map((a) => a.uid);

    if (allUids.length === 0) {
      if (!silent && !targetUids) toast.info("Không có tài khoản nào có Token để kiểm tra.");
      return;
    }

    // Đọc cache từ localStorage
    let cache = readTokenCache(tokenStorage(), owner);

    const cachedStatuses = cachedTokenStatuses(tokenStorage(), owner);
    const uidsToCall = [];

    // Nếu không force: phục hồi các token còn hạn cache (TTL 15 phút)
    if (!force) {
      const cachedStatusUpdates = {};
      allUids.forEach((uid) => {
        if (verifyingUids.current.has(uid)) return;
        if (cachedStatuses[uid]) {
          cachedStatusUpdates[uid] = cachedStatuses[uid];
        } else {
          uidsToCall.push(uid);
        }
      });

      if (Object.keys(cachedStatusUpdates).length > 0) {
        setTokenStatusMap((prev) => ({ ...prev, ...cachedStatusUpdates }));
      }

      if (uidsToCall.length === 0) {
        if (!silent && targetUids && targetUids.length === 1) {
          toast.info("Đã khôi phục trạng thái token từ bộ nhớ đệm (15 phút). Bấm nút để check lại.");
        }
        return;
      }
    } else {
      uidsToCall.push(...allUids);
    }

    const requested = [...new Set(uidsToCall)].filter((uid) => !verifyingUids.current.has(uid));
    if (!requested.length) return;
    const versions = Object.fromEntries(requested.map((uid) => [uid, tokenRevision.current[uid]]));
    const currentUids = () => requested.filter((uid) => tokenRevision.current[uid] === versions[uid]);
    requested.forEach((uid) => verifyingUids.current.add(uid));
    setVerifyingTokens(true);
    setTokenStatusMap((prev) => {
      const next = { ...prev };
      requested.forEach((u) => {
        next[u] = "CHECKING";
      });
      return next;
    });

    try {
      const res = await verifyTokens({ account_uids: requested });
      if (!alive.current) return;
      if (!res?.success || !res?.results) throw new Error("Máy chủ không trả kết quả kiểm tra token.");
      if (res?.success && res?.results) {
        const fresh = currentUids();
        if (!fresh.length) return;
        const results = Object.fromEntries(Object.entries(res.results).filter(([uid]) => fresh.includes(uid)));
        const newStatus = Object.fromEntries(fresh.map((uid) => [uid, "ERROR"]));
        cache = readTokenCache(tokenStorage(), owner);
        Object.entries(results).forEach(([uid, info]) => {
          newStatus[uid] = info.status;
          cache[uid] = {
            status: info.status,
            timestamp: Date.now(),
            message: info.message || "",
          };
        });

        try {
          tokenStorage().setItem(cacheKey, JSON.stringify(cache));
        } catch {}

        setTokenStatusMap((prev) => ({ ...prev, ...newStatus }));

        if (silent) return;

        const liveCount = Object.values(results).filter((r) => r.status === "LIVE").length;
        const expiredCount = Object.values(results).filter((r) => r.status === "EXPIRED").length;
        const rateLimitCount = Object.values(results).filter((r) => r.status === "RATE_LIMITED").length;

        if (targetUids && targetUids.length === 1) {
          const singleStatus = results[targetUids[0]]?.status;
          if (singleStatus === "LIVE") {
            toast.success(`Token nick ${targetUids[0]} còn sống (LIVE)!`);
          } else if (singleStatus === "RATE_LIMITED") {
            toast.warning(`Meta đang tạm giới hạn tốc độ (Rate Limit) với nick ${targetUids[0]}!`);
          } else if (singleStatus === "EXPIRED") {
            toast.warning(`Token nick ${targetUids[0]} đã HẾT HẠN hoặc bị thu hồi!`);
          } else if (singleStatus === "ERROR") {
            toast.error(results[targetUids[0]]?.message || "Không thể xác thực token với Meta.");
          }
        } else {
          let summaryMsg = `Check xong: ${liveCount} LIVE`;
          if (expiredCount > 0) summaryMsg += `, ${expiredCount} HẾT HẠN`;
          if (rateLimitCount > 0) summaryMsg += `, ${rateLimitCount} RATE LIMIT`;

          if (expiredCount > 0 || rateLimitCount > 0) {
            toast.warning(summaryMsg);
          } else if (liveCount > 0) {
            toast.success(summaryMsg + " (Hoạt động tốt)!");
          }
        }
      }
    } catch (err) {
      if (alive.current) {
        setTokenStatusMap((prev) => ({ ...prev, ...Object.fromEntries(currentUids().map((uid) => [uid, "ERROR"])) }));
        if (!silent) toast.error("Lỗi kiểm tra Token Meta: " + (err.message || "Không gọi được API"));
      }
    } finally {
      requested.forEach((uid) => verifyingUids.current.delete(uid));
      if (alive.current) setVerifyingTokens(verifyingUids.current.size > 0);
    }
  }, [accountList, owner]);

  useEffect(() => {
    if (!adding) return;
    const opening = modalOpen.current;
    // Wait for this opening's refresh, even when older account rows are available.
    void loadAccounts().then(() => {
      if (alive.current && modalOpen.current === opening) setAccountsReadyForOpen(opening);
    });
  }, [adding, loadAccounts]);

  useEffect(() => {
    const opening = modalOpen.current;
    if (!adding || !opening || opening.checked || accountsReadyForOpen !== opening ||
        loadingAccounts || !accountsLoaded || accountsError) return;
    // Consume before starting: state updates and Strict Mode cannot repeat this pass.
    opening.checked = true;
    void handleVerifyTokens(null, false, true);
  }, [adding, accountsReadyForOpen, loadingAccounts, accountsLoaded, accountsError, handleVerifyTokens]);

  function changeAdding(open) {
    if (open && !adding) modalOpen.current = { checked: false };
    if (!open) modalOpen.current = null;
    setAdding(open);
    if (open) setTokenStatusMap((prev) => ({ ...cachedTokenStatuses(tokenStorage(), owner), ...Object.fromEntries(Object.entries(prev).filter(([uid]) => verifyingUids.current.has(uid))) }));
    if (!open) { setCustomToken(""); setShowCustomToken(false); }
  }

  function rememberLive(uid) {
    tokenRevision.current[uid] = (tokenRevision.current[uid] || 0) + 1;
    setTokenStatusMap((prev) => ({ ...prev, [uid]: "LIVE" }));
    try {
      const cache = readTokenCache(tokenStorage(), owner);
      cache[uid] = { status: "LIVE", timestamp: Date.now() };
      tokenStorage().setItem(tokenCacheKey(owner), JSON.stringify(cache));
    } catch { /* Optional status cache. */ }
  }

  // Bộ lọc tài khoản trong bảng (đồng bộ chuẩn live/die theo module 02 account)
  const filteredAccounts = useMemo(() => {
    const q = accQuery.trim().toLowerCase();
    return accountList.filter((acc) => {
      const st = (acc.status || "").toLowerCase();
      if (accStatusFilter === "live" && st !== "live") return false;
      if (accStatusFilter === "die" && st !== "die") return false;
      if (accStatusFilter === "uncheck" && (st === "live" || st === "die")) return false;

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
    if (activeAccounts.current.has(uid)) return;
    activeAccounts.current.add(uid);
    setAccountJobs((prev) => ({ ...prev, [uid]: { kind: "sync", message: "Đang tạo tác vụ…" } }));
    try {
      const res = await syncPagesByAccount({
        account_uid: uid,
        custom_token: customToken.trim() || undefined,
      }, (job) => { if (alive.current) setAccountJobs((prev) => ({ ...prev, [uid]: { kind: "sync", message: job.message || job.status } })); });
      if (!alive.current) return;
      if (res?.success) {
        rememberLive(uid);
        toast.success(res.message || `Đã nạp thành công ${res.count} Fanpage!`);
        loadAccounts(true);
        load(true);
      } else {
        toast.error(res?.detail || res?.message || "Quét Fanpage thất bại.");
      }
    } catch (error) {
      if (!alive.current) return;
      toast.error(error.message || "Không thể kết nối đến máy chủ để quét Fanpage.");
    } finally {
      activeAccounts.current.delete(uid);
      if (alive.current) {
        setAccountJobs((prev) => { const next = { ...prev }; delete next[uid]; return next; });
      }
    }
  };

  // Luồng 1: OAuth qua Chrome Profile của nick Clone (luôn mở Chrome trực tiếp có giao diện)
  const handleProfileOAuth = async (targetUid) => {
    const uid = targetUid || selectedAccUid;
    if (!uid) {
      toast.error("Vui lòng chọn tài khoản Facebook để cấp Token.");
      return;
    }
    if (activeAccounts.current.has(uid)) return;
    activeAccounts.current.add(uid);
    setAccountJobs((prev) => ({ ...prev, [uid]: { kind: "oauth", message: "Đang tạo tác vụ…" } }));
    try {
      toast.info(`Đang mở profile Chrome của nick ${uid} để cấp Token mới từ Meta...`);
      const res = await oauthByProfile({
        account_uid: uid,
        headless: false,
      }, (job) => { if (alive.current) setAccountJobs((prev) => ({ ...prev, [uid]: { kind: "oauth", message: job.message || job.status } })); });
      if (!alive.current) return;
      if (res?.success) {
        toast.success(res.message || `Đã cấp Token mới và nạp ${res.count} Fanpage!`);
        rememberLive(uid);
        loadAccounts(true);
        load(true);
      } else {
        toast.error(res?.detail || res?.message || "Cấp Token qua Chrome Profile thất bại.");
      }
    } catch (error) {
      if (!alive.current) return;
      toast.error(error.message || "Không thể kết nối máy chủ để thực hiện OAuth.");
    } finally {
      activeAccounts.current.delete(uid);
      if (alive.current) {
        setAccountJobs((prev) => { const next = { ...prev }; delete next[uid]; return next; });
      }
    }
  };

  const webConnection = useWebFacebookConnection(() => {
    load(true);
    loadAccounts(true);
  });

  const stats = useMemo(() => {
    const success = pages.filter((item) => item.status === "SUCCESS" || item.status === "ACTIVE").length;
    return { total: pages.length, success, failed: pages.length - success };
  }, [pages]);

  const managerOptions = useMemo(() => pageAccountOptions(pages), [pages]);
  if (accountFilter !== ALL_ACCOUNTS && !managerOptions.some((option) => option.value === accountFilter)) {
    setAccountFilter(ALL_ACCOUNTS);
    setPage(1);
  }

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return pages.filter((item) => {
      if (!matchesPageAccount(item, accountFilter)) return false;
      if (!matchesStatus(item, status)) return false;
      if (!keyword) return true;
      return [item.page_name, item.page_id, item.manager_name, item.manager_uid, item.page_category]
        .some((field) => String(field || "").toLowerCase().includes(keyword));
    });
  }, [pages, query, status, accountFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

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

  const hasLiveToken = Boolean(selectedAcc?.has_token);

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
            onChange={(event) => { setQuery(event.target.value); setPage(1); }}
            placeholder="Tìm kiếm Page theo tên..."
            className="h-[38px] w-full rounded-lg border border-[#CBD5E1] bg-white pl-[37px] pr-3 text-xs text-[#1E293B] outline-none placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15"
          />
        </label>
        <CustomSelect
          value={status}
          onChange={(value) => { setStatus(value); setPage(1); }}
          options={STATUS_OPTIONS}
          prefixIcon={<Filter className="h-3 w-3" />}
          className="w-[180px] shrink-0"
          buttonClassName="h-[34px] rounded-lg border-[#CBD5E1] text-xs font-medium text-[#334155] shadow-none"
        />
        <PageAccountFilter value={accountFilter} options={managerOptions}
          onChange={(value) => { setAccountFilter(value); setPage(1); }} />
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => changeAdding(true)}
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
                            <p className="text-[10.5px] leading-4 text-slate-500">{tokenExpiryLabel(item.token_metadata)}</p>
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
                              {item.manager_kind === "web" ? "OAuth trình duyệt" : `UID: ${item.manager_uid || "—"}`}
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

      <Dialog open={adding} onOpenChange={changeAdding}>
        <DialogContent className="max-w-6xl w-full min-w-0 p-4 sm:p-6 rounded-2xl bg-white shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
          <DialogHeader className="pb-3 border-b border-slate-100 shrink-0">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-blue-50 text-[#1877F2]">
                  <Layers className="w-5 h-5" />
                </span>
                Thêm & Nạp Fanpage vào hệ thống
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-slate-500 pt-0.5">
              Cấp Token và quét Fanpage tự động qua danh sách tài khoản (cột bên trái) hoặc Đăng nhập trực tiếp trên trình duyệt (cột bên phải).
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] gap-5 pt-2 flex-1 min-h-0 overflow-y-auto pr-1">
            {/* BẢNG DANH SÁCH TÀI KHOẢN */}
            <div className="min-w-0 flex flex-col rounded-xl border border-slate-200/90 bg-slate-50/50 p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                  <span className="flex size-4 items-center justify-center rounded-full bg-[#1877F2] text-[10px] text-white font-bold">1</span>
                  Danh sách tài khoản ({filteredAccounts.length}/{accountList.length})
                </span>
                <button
                  type="button"
                  onClick={() => handleVerifyTokens()}
                  disabled={verifyingTokens}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition-colors shadow-2xs"
                  title="Kiểm tra trạng thái sống/chết thực tế của toàn bộ Token qua Meta Graph API"
                >
                  <RefreshCw className={`w-3 h-3 ${verifyingTokens ? "animate-spin text-blue-600" : "text-blue-500"}`} />
                  {verifyingTokens ? "Đang check Token..." : "Check Live Token"}
                </button>
              </div>

              {loadingAccounts && accountsLoaded && <p role="status" className="text-xs text-slate-500">Đang làm mới danh sách…</p>}
              {accountsError && <div role="alert" className="text-xs text-red-600">{accountsError} <button type="button" disabled={loadingAccounts} onClick={() => loadAccounts(true)} className="underline disabled:opacity-50">Thử lại</button></div>}
              {/* BỘ LỌC VÀ TÌM KIẾM TÀI KHOẢN */}
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-12 sm:col-span-6 min-w-0 relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={accQuery}
                    onChange={(e) => setAccQuery(e.target.value)}
                    placeholder="Tìm tên hoặc UID nick..."
                    className="w-full h-8 pl-8 pr-2 text-xs rounded-lg border border-slate-200 bg-white placeholder:text-slate-400 outline-none focus:border-[#1877F2]"
                  />
                </div>
                <div className="col-span-6 sm:col-span-3 min-w-0">
                  <select
                    value={accStatusFilter}
                    onChange={(e) => setAccStatusFilter(e.target.value)}
                    className="w-full h-8 px-2 text-[11px] font-medium rounded-lg border border-slate-200 bg-white text-slate-700 outline-none focus:border-[#1877F2]"
                  >
                    <option value="all">Mọi trạng thái</option>
                    <option value="live">● Nick Live</option>
                    <option value="die">✕ Nick Die</option>
                    <option value="uncheck">○ Chưa check (--)</option>
                  </select>
                </div>
                <div className="col-span-6 sm:col-span-3 min-w-0">
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
              <div className="min-w-0 max-w-full rounded-lg border border-slate-200 bg-white overflow-hidden shadow-2xs">
                <div className="max-h-[350px] overflow-x-hidden overflow-y-auto">
                  <table aria-label="Tài khoản Facebook" className={`${styles.accountTable} text-left border-collapse text-xs`}>
                    <colgroup><col /><col className={styles.nickColumn} /><col className={styles.loginColumn} /><col className={styles.tokenColumn} /><col className={styles.actionsColumn} /></colgroup>
                    <thead className="sticky top-0 bg-slate-100/90 backdrop-blur-xs text-[10.5px] uppercase font-bold text-slate-500 border-b border-slate-200 z-10">
                      <tr>
                        <th className="py-2 px-3">Tài khoản</th>
                        <th className="py-2 px-2 text-center">TT Nick</th>
                        <th className="py-2 px-2 text-center">Đăng nhập</th>
                        <th className="py-2 px-2 text-center">
                          <div className="inline-flex items-center gap-1 justify-center">
                            <span>Token</span>
                            <button
                              type="button"
                              onClick={() => handleVerifyTokens(null, true)}
                              disabled={verifyingTokens}
                              title="Bỏ qua cache và kiểm tra lại toàn bộ Token (Force Refresh)"
                              className="p-0.5 rounded text-slate-400 hover:text-blue-600 hover:bg-slate-200 transition-colors disabled:opacity-40"
                            >
                              <RefreshCw className={`w-2.5 h-2.5 ${verifyingTokens ? "animate-spin text-blue-500" : ""}`} />
                            </button>
                          </div>
                        </th>
                        <th className="py-2 px-2.5 text-right">Hành động</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {loadingAccounts && !accountsLoaded ? (
                        [0, 1, 2].map((row) => <tr key={row} aria-label="Đang tải tài khoản"><td colSpan={5} className="p-3"><div className="h-8 animate-pulse rounded bg-slate-100" /></td></tr>)
                      ) : filteredAccounts.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-slate-400">
                            {accountsError ? "Danh sách tài khoản chưa tải được." : "Không tìm thấy tài khoản nào phù hợp bộ lọc."}
                          </td>
                        </tr>
                      ) : (
                        filteredAccounts.map((acc) => {
                          const rawHasToken = Boolean(acc.has_token);
                          const tokenStatus = rawHasToken ? tokenStatusMap[acc.uid] : undefined;
                          const isCheckingToken = tokenStatus === "CHECKING";
                          const isLiveToken = tokenStatus === "LIVE";
                          const isExpiredToken = tokenStatus === "EXPIRED";
                          const isRateLimitedToken = tokenStatus === "RATE_LIMITED";

                          const isLoggedIn = acc.login_status === "logged_in";
                          const isProcessing = Boolean(accountJobs[acc.uid]);
                          const isActionDisabled = isProcessing || verifyingTokens || isCheckingToken;

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
                                    <p className="text-[10px] text-slate-400 font-mono truncate" title={String(acc.uid)}>{acc.uid}</p>
                                  </div>
                                </div>
                              </td>
                              <td data-label="TT Nick" title={acc.status === "live" ? "Nick Live" : acc.status === "die" ? "Nick Die" : "Nick chưa kiểm tra"} className="py-2 px-2 text-center">
                                {acc.status === "live" ? (
                                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-[#ECFDF5] border border-[#A7F3D0] text-[#047857]">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                                    Live
                                  </span>
                                ) : acc.status === "die" ? (
                                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-[#FFF1F2] border border-[#FECDD3] text-[#BE123C]">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#F43F5E]" />
                                    Die
                                  </span>
                                ) : (
                                  <span className="text-[#94A3B8] text-[11px] font-medium">--</span>
                                )}
                              </td>
                              <td data-label="Đăng nhập" title={acc.login_status === "logged_in" ? "Đã đăng nhập" : acc.login_status === "failed" ? "Lỗi đăng nhập" : "Chưa đăng nhập"} className="py-2 px-2 text-center">
                                {acc.login_status === "logged_in" ? (
                                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-[#ECFDF5] border border-[#A7F3D0] text-[#047857]">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                                    Đã login
                                  </span>
                                ) : acc.login_status === "failed" ? (
                                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-[#FFF1F2] border border-[#FECDD3] text-[#BE123C]">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#F43F5E]" />
                                    Lỗi login
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-[#F1F5F9] border border-[#E2E8F0] text-[#64748B]">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#94A3B8]" />
                                    Chưa
                                  </span>
                                )}
                              </td>
                              <td data-label="Token" className="py-2 px-2 text-center">
                                {isCheckingToken ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                                    <Loader2 className="w-2.5 h-2.5 animate-spin text-blue-500" /> Check...
                                  </span>
                                ) : isRateLimitedToken ? (
                                  <button
                                    type="button"
                                    onClick={() => handleVerifyTokens([acc.uid], true)}
                                    className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full shadow-2xs hover:bg-amber-100 transition-colors cursor-pointer"
                                    title="Meta đang tạm giới hạn tốc độ (Rate Limit). Bấm để kiểm tra lại ngay."
                                  >
                                    <AlertCircle className="w-2.5 h-2.5 text-amber-600" /> Rate Limit
                                  </button>
                                ) : isLiveToken ? (
                                  <button
                                    type="button"
                                    onClick={() => handleVerifyTokens([acc.uid], true)}
                                    className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full shadow-2xs hover:bg-emerald-100 transition-colors cursor-pointer"
                                    title="Token Meta đang hoạt động tốt (LIVE). Bấm để check lại."
                                  >
                                    <ShieldCheck className="w-2.5 h-2.5 text-emerald-600" /> LIVE
                                  </button>
                                ) : isExpiredToken ? (
                                  <button
                                    type="button"
                                    onClick={() => handleVerifyTokens([acc.uid], true)}
                                    className="inline-flex items-center gap-0.5 text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full shadow-2xs hover:bg-rose-100 transition-colors cursor-pointer"
                                    title="Token đã hết hạn hoặc bị Meta thu hồi. Bấm để check lại."
                                  >
                                    <ShieldAlert className="w-2.5 h-2.5 text-rose-600" /> HẾT HẠN
                                  </button>
                                ) : rawHasToken ? (
                                  <button
                                    type="button"
                                    onClick={() => handleVerifyTokens([acc.uid], true)}
                                    className="inline-flex items-center gap-0.5 text-[10px] font-medium text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full hover:bg-blue-100 transition-colors cursor-pointer"
                                    title="Bấm để kiểm tra token này"
                                  >
                                    <RefreshCw className="w-2.5 h-2.5 text-blue-500" /> {tokenStatus === "ERROR" ? "Lỗi kiểm tra" : "Chưa kiểm tra"}
                                  </button>
                                ) : (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-slate-400 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded-full">
                                    Chưa có
                                  </span>
                                )}
                              </td>
                              <td data-label="Hành động" className="py-2 px-2.5 text-right">
                                <div className="flex min-w-0 flex-nowrap items-center justify-end gap-1">
                                  {/* Nếu token LIVE thì không cần nút cấp lại. Chỉ hiện khi hết hạn hoặc chưa có token */}
                                  {!isLiveToken && (
                                    isExpiredToken ? (
                                      <button
                                        type="button"
                                        onClick={() => handleProfileOAuth(acc.uid)}
                                        disabled={isActionDisabled}
                                        className="h-7 px-2.5 rounded-md bg-amber-600 hover:bg-amber-700 font-bold text-[10.5px] text-white flex items-center gap-1 shadow-2xs transition-all disabled:opacity-50"
                                        title="Token đã hết hạn. Mở Chrome Profile để cấp lại Token mới!"
                                      >
                                        {accountJobs[acc.uid]?.kind === "oauth" ? (
                                          <Loader2 className="w-3 h-3 animate-spin" />
                                        ) : (
                                          <Zap className="w-3 h-3 text-amber-200 fill-amber-200" />
                                        )}
                                        Cấp lại
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => handleProfileOAuth(acc.uid)}
                                        disabled={isActionDisabled}
                                        className="h-7 px-2 rounded-md bg-blue-600 hover:bg-blue-700 font-bold text-[10.5px] text-white flex items-center gap-1 shadow-2xs transition-all disabled:opacity-50"
                                        title="Mở Chrome Profile của nick này để tự động cấp Token và nạp Fanpage"
                                      >
                                        {accountJobs[acc.uid]?.kind === "oauth" ? (
                                          <Loader2 className="w-3 h-3 animate-spin" />
                                        ) : (
                                          <Zap className="w-3 h-3 text-amber-300 fill-amber-300" />
                                        )}
                                        {rawHasToken ? "Cấp lại" : "Cấp Token"}
                                      </button>
                                    )
                                  )}

                                  {/* Token chết/hết hạn thì không quét. Chỉ quét khi token LIVE hoặc có token chưa check */}
                                  {rawHasToken && !isExpiredToken ? (
                                    <button
                                      type="button"
                                      onClick={() => handleSyncPages(acc.uid)}
                                      disabled={isActionDisabled}
                                      className="h-7 px-2.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 font-medium text-[10.5px] text-slate-700 flex items-center gap-1 transition-all disabled:opacity-50"
                                      title="Quét bằng token đã lưu; hệ thống xác thực trước khi đồng bộ"
                                    >
                                      {accountJobs[acc.uid]?.kind === "sync" ? (
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

            {/* ĐĂNG NHẬP TRÌNH DUYỆT + HƯỚNG DẪN + THÊM NICK */}
            <div className="min-w-0 flex flex-col gap-3 [overflow-wrap:anywhere]">
              {/* KHỐI ĐĂNG NHẬP OAUTH TRÊN TRÌNH DUYỆT NÀY */}
              <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3.5 space-y-3">
                <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                  <Globe className="w-4 h-4 shrink-0 text-slate-500" />
                  Kết nối Facebook
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Kết nối tài khoản Facebook để thêm các Page bạn quản lý.
                </p>
                <WebConnectionButton controller={webConnection} />
              </div>

              {/* Thời hạn token được xác thực bởi Meta */}
              <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3.5 space-y-3 text-xs">
                <h3 className="flex items-center gap-1.5 font-bold text-slate-800">
                  <Info className="w-4 h-4 text-slate-500 shrink-0" />
                  Thời hạn và quyền truy cập
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Thời hạn và quyền truy cập token được cập nhật từ Meta.
                </p>
                {Object.keys(accountJobs).length > 0 && (
                  <div className="space-y-1.5 border-t border-slate-100 pt-2.5 text-xs text-slate-600 max-h-24 overflow-y-auto pr-1">
                    {Object.entries(accountJobs).map(([uid, job]) => (
                      <div key={uid} role="status" className="flex items-center gap-1.5 bg-blue-50/70 px-2 py-1.5 rounded-lg border border-blue-100">
                        <Loader2 className="w-3 h-3 animate-spin text-blue-600 shrink-0" />
                        <span className="font-mono font-semibold text-[11px] text-blue-900 shrink-0">{uid}:</span>
                        <span className="text-[11px] text-slate-700 truncate">{job.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* KHỐI THÊM NICK MỚI */}
              <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3.5 space-y-3">
                <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                  <UserPlus className="w-4 h-4 shrink-0 text-slate-500" />
                  Quản lý tài khoản
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">Thêm và quản lý tài khoản Facebook.</p>
                <button
                  type="button"
                  onClick={() => {
                    changeAdding(false);
                    router.push("/accounts");
                  }}
                  className="w-full min-h-11 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center justify-center gap-2 transition-colors"
                >
                  Quản lý tài khoản
                  <ExternalLink className="w-3 h-3 shrink-0 text-slate-400" />
                </button>
              </div>
            </div>
          </div>

          <DialogFooter className="pt-3 border-t border-slate-100 mt-2 shrink-0">
            <button
              type="button"
              onClick={() => changeAdding(false)}
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
