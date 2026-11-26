"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, FileText, Folder, Info, Loader2, LogOut, Play, Square } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { LiveLogConsole, Pager } from "@/modules/module_11_page_scanner/_shared";
import { useFarmAccounts } from "../hooks/useFarmAccounts";
import {
  getTikTokAuth,
  getTikTokConfig,
  getTikTokDownloadStatus,
  logoutTikTok,
  openTikTokLogin,
  pickVideoFolder,
  saveTikTokConfig,
  startTikTokDownload,
  stopTikTokDownload,
} from "../service";
import { isEligible } from "./AccountPicker";
import { NumberInput, PageTitle, UidCopy, clampNumber, initials } from "./parts";

const ROWS_PER_PAGE = 10;
const POLL_MS = 2000;
const SAVE_DELAY_MS = 600;
const IDLE_JOB = { phase: "idle", total: 0, done: 0, failed: 0, videos: [], logs: [] };
const CARD = "rounded-xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)]";
const TH = "bg-[#F0F7FF] px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.3px] text-[#475569]";
const LABEL = "mb-1.5 block text-xs font-medium text-[#334155]";
const INPUT =
  "h-[34px] w-full rounded-lg border border-[#CBD5E1] bg-white px-3 text-xs text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:outline-none";
const AVATARS = [
  "from-[#F472B6] to-[#E11D48]",
  "from-[#0EA5E9] to-[#0891B2]",
  "from-[#FBBF24] to-[#EA580C]",
  "from-[#A855F7] to-[#6366F1]",
];

// Trạng thái một video trong bảng kết quả
const VIDEO_STATUS = {
  done: { label: "Hoàn thành", pill: "bg-[#D1FAE5] text-[#047857]", folder: "fill-[#F59E0B] text-[#F59E0B]" },
  downloading: { label: "Đang tải", pill: "bg-[#DBEAFE] text-[#1D4ED8]", folder: "fill-[#3B82F6] text-[#3B82F6]" },
  waiting: { label: "Chờ tải", pill: "bg-[#F1F5F9] text-[#64748B]", folder: "fill-[#94A3B8] text-[#94A3B8]" },
  failed: { label: "Lỗi", pill: "bg-rose-50 text-rose-700", folder: "fill-[#94A3B8] text-[#94A3B8]" },
};

function StepHeading({ step, title, children }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#2563EB] text-xs font-bold text-white">{step}</span>
      <h2 className="font-heading text-base font-semibold text-[#0F172A]">{title}</h2>
      {children}
    </div>
  );
}

function CountBadge({ children }) {
  return <span className="rounded-full bg-[#DBEAFE] px-2.5 py-0.5 text-xs font-semibold text-[#1E40AF]">{children}</span>;
}

function StatusPill({ on, children }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        on ? "border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]" : "border-slate-200 bg-slate-100 text-slate-600"
      )}
    >
      <span className={cn("size-1.5 rounded-full", on ? "bg-[#10B981]" : "bg-slate-400")} />
      {children}
    </span>
  );
}

function CaptionCell({ video }) {
  if (video.captionFile) {
    return (
      <span title={video.caption} className="inline-flex items-center gap-1.5 font-mono text-xs text-[#059669]">
        <FileText className="size-3.5" />
        {video.captionFile}
      </span>
    );
  }
  return video.status === "downloading" ? (
    <span className="font-mono text-xs text-[#3B82F6]">Đang tạo file .txt</span>
  ) : (
    <span className="font-mono text-xs text-[#94A3B8]">Chờ trích xuất</span>
  );
}

function VideoRow({ video, index }) {
  const status = VIDEO_STATUS[video.status] || VIDEO_STATUS.waiting;
  return (
    <tr className="border-t border-[#E2E8F0] text-xs">
      <td className="px-4 py-3 font-mono text-[#94A3B8]">{String(index + 1).padStart(2, "0")}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[10px] font-bold text-white", AVATARS[index % AVATARS.length])}>
            {initials(video.accountName)}
          </span>
          <span className="font-semibold text-[#0F172A]">{video.accountName}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span title={video.folder} className="inline-flex max-w-[220px] items-center gap-2 font-mono text-[#475569]">
          <Folder className={cn("size-4 shrink-0", status.folder)} />
          <span className="truncate">{video.folder}</span>
        </span>
      </td>
      <td className="px-4 py-3">
        <a href={video.url} target="_blank" rel="noreferrer" title={video.url} className="inline-flex max-w-[220px] items-center gap-1.5 text-[#2563EB] hover:underline">
          <span className="truncate">{String(video.url || "").replace(/^https?:\/\/(www\.)?/, "")}</span>
          <ExternalLink className="size-3 shrink-0" />
        </a>
      </td>
      <td className="px-4 py-3"><CaptionCell video={video} /></td>
      <td className="px-4 py-3">
        <span title={video.error || undefined} className={cn("inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 font-semibold", status.pill)}>
          {status.label}{video.status === "downloading" && video.percent != null ? ` ${video.percent}%` : ""}
        </span>
        {video.status === "downloading" && (
          <div className="mt-1 h-1 w-24 overflow-hidden rounded-full bg-[#E2E8F0]">
            <div className="h-full rounded-full bg-[#2563EB]" style={{ width: `${video.percent || 0}%` }} />
          </div>
        )}
      </td>
    </tr>
  );
}

/** Tải video từ TikTok theo từ khóa cho từng tài khoản Facebook (/interact/tiktok) */
export default function TikTokDownloadView() {
  const [auth, setAuth] = useState({ loading: true, connected: false });
  const [opening, setOpening] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [keywordText, setKeywordText] = useState("");
  const [folder, setFolder] = useState("");
  const [picking, setPicking] = useState(false);
  const [perKeyword, setPerKeyword] = useState("5");
  const [selected, setSelected] = useState(() => new Set());
  const [page, setPage] = useState(1);
  const [job, setJob] = useState(IDLE_JOB);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const restored = useRef(false);
  const configLoaded = useRef(false);
  const running = job.phase === "running" || job.phase === "stopping";

  const { accounts, total, loading, loadingMore, loadError, moreError, hasMore, reload, loadMore } = useFarmAccounts();
  const usable = useMemo(() => accounts.filter(isEligible), [accounts]);
  const allSelected = usable.length > 0 && usable.every((account) => selected.has(account.uid));
  const keywords = useMemo(
    () => [...new Set(keywordText.split(",").map((keyword) => keyword.trim()).filter(Boolean))],
    [keywordText]
  );

  const refreshAuth = useCallback(async () => {
    try {
      const result = await getTikTokAuth();
      setAuth({ loading: false, connected: Boolean(result?.connected), username: result?.username, error: "" });
    } catch (error) {
      setAuth({ loading: false, connected: false, error: error?.message || "Không kiểm tra được đăng nhập TikTok." });
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);
  // Đăng nhập diễn ra ở cửa sổ Chrome riêng: hỏi lại định kỳ tới khi đã đăng nhập
  useEffect(() => {
    if (auth.connected || auth.error) return undefined;
    const timer = setInterval(refreshAuth, 4000);
    return () => clearInterval(timer);
  }, [auth.connected, auth.error, refreshAuth]);

  // Thư mục lưu + số video / từ khóa đã lưu lần trước
  useEffect(() => {
    let ignore = false;
    getTikTokConfig()
      .then((saved) => {
        if (ignore || !saved) return;
        if (saved.folder) setFolder((current) => current || saved.folder);
        if (saved.per_keyword) setPerKeyword(String(saved.per_keyword));
      })
      .catch(() => {})
      .finally(() => {
        if (!ignore) configLoaded.current = true;
      });
    return () => {
      ignore = true;
    };
  }, []);

  // Sửa số video → lưu sau khi ngừng gõ
  useEffect(() => {
    if (!configLoaded.current) return undefined;
    const timer = setTimeout(() => {
      saveTikTokConfig({ per_keyword: clampNumber(perKeyword, 1, 500) }).catch(() => {});
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [perKeyword]);

  const openLogin = async () => {
    setOpening(true);
    try {
      const result = await openTikTokLogin();
      if (result?.status === "ERROR") throw new Error(result.message);
      toast.success(result?.message || "Đã mở trình duyệt đăng nhập TikTok.");
      refreshAuth();
    } catch (error) {
      toast.error(error?.message || "Không mở được trình duyệt đăng nhập TikTok.");
    } finally {
      setOpening(false);
    }
  };

  const logout = async () => {
    setLoggingOut(true);
    try {
      await logoutTikTok();
      toast.success("Đã đăng xuất TikTok.");
      setAuth({ loading: false, connected: false, username: "", error: "" });
    } catch (error) {
      toast.error(error?.message || "Không đăng xuất được TikTok.");
    } finally {
      setLoggingOut(false);
    }
  };

  const chooseFolder = async () => {
    setPicking(true);
    try {
      const path = await pickVideoFolder();
      if (path) {
        setFolder(path);
        saveTikTokConfig({ folder: path }).catch((error) => toast.error(error?.message || "Không lưu được thư mục."));
      }
    } catch (error) {
      toast.error(error?.message || "Không mở được hộp chọn thư mục.");
    } finally {
      setPicking(false);
    }
  };

  const toggle = (uid) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(uid)) next.add(uid);
      return next;
    });

  const toggleAll = () =>
    setSelected((current) => {
      const next = new Set(current);
      usable.forEach(({ uid }) => (allSelected ? next.delete(uid) : next.add(uid)));
      return next;
    });

  const refreshJob = useCallback(async () => {
    const id = ++request.current;
    try {
      const result = await getTikTokDownloadStatus(page, ROWS_PER_PAGE);
      if (id !== request.current) return;
      setJob({ ...IDLE_JOB, ...result });
      // Mở lại trang: điền lại cấu hình của phiên gần nhất
      if (!restored.current && result?.config) {
        const { keywords: saved, folder: savedFolder, per_keyword: count, uids } = result.config;
        setKeywordText((current) => current || saved.join(", "));
        setFolder((current) => current || savedFolder);
        setPerKeyword(String(count));
        setSelected((current) => (current.size ? current : new Set(uids)));
      }
      restored.current = true;
    } catch {
      // Lỗi mạng tạm thời: giữ số liệu cũ, lần hỏi sau cập nhật lại
    }
  }, [page]);

  useEffect(() => {
    refreshJob();
    if (!running) return undefined;
    const timer = setInterval(refreshJob, POLL_MS);
    return () => clearInterval(timer);
  }, [refreshJob, running]);

  const stop = async () => {
    setBusy(true);
    try {
      await stopTikTokDownload();
      await refreshJob();
    } catch (error) {
      toast.error(error?.message || "Không dừng được phiên tải.");
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!auth.connected) return toast.error("Vui lòng đăng nhập TikTok trước.");
    if (!keywords.length) return toast.error("Vui lòng nhập ít nhất một từ khóa.");
    if (!folder) return toast.error("Vui lòng chọn thư mục lưu trữ video.");
    if (!selected.size) return toast.error("Vui lòng chọn ít nhất một tài khoản Facebook.");
    setBusy(true);
    restored.current = true;
    try {
      await startTikTokDownload({
        uids: [...selected],
        keywords,
        folder,
        per_keyword: clampNumber(perKeyword, 1, 500),
      });
      setPage(1);
      setJob({ ...IDLE_JOB, phase: "running" });
      return toast.success("Đã bắt đầu quét và tải video TikTok.");
    } catch (error) {
      return toast.error(error?.message || "Không bắt đầu được phiên tải.");
    } finally {
      setBusy(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(job.total / ROWS_PER_PAGE));
  const first = (page - 1) * ROWS_PER_PAGE;
  const rows = job.videos;

  return (
    <div className="-m-6 min-h-full space-y-6 bg-[#F4F7FC] p-6">
      <PageTitle
        title="Tải video từ TikTok"
        description="Tự động tìm kiếm, quét danh sách video theo từ khóa, tải video không logo và bóc tách tiêu đề/caption tự động."
      />

      <div className="grid items-stretch gap-6 xl:grid-cols-2">
        <section className={cn(CARD, "p-6")}>
          <div className="mb-4 border-b border-[#F1F5F9] pb-3">
            <StepHeading step={1} title="Đăng nhập TikTok & Chọn tài khoản thực thi" />
          </div>
          <div className="rounded-lg border border-[#DBEAFE] bg-[#F0F7FF] p-4">
            <div className="flex gap-2.5 text-xs leading-5 text-[#334155]">
              <Info className="mt-0.5 size-4 shrink-0 text-[#2563EB]" />
              <p>
                <strong className="font-semibold text-[#2563EB]">Khu vực đăng nhập TikTok:</strong> Đăng nhập ở bên ngoài trình duyệt để thực hiện quét và tải video và tiêu đề.
              </p>
            </div>
            {auth.connected ? (
              <button
                type="button"
                onClick={logout}
                disabled={loggingOut || running}
                title={running ? "Dừng phiên tải trước khi đăng xuất" : undefined}
                className="mt-3 inline-flex h-8 items-center gap-2 rounded-lg border border-rose-200 bg-white px-4 text-xs font-semibold text-rose-600 shadow-sm transition hover:bg-rose-50 disabled:opacity-60"
              >
                {loggingOut ? <Loader2 className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />}
                Đăng xuất TikTok
              </button>
            ) : (
              <button
                type="button"
                onClick={openLogin}
                disabled={opening || running || auth.loading}
                className="mt-3 inline-flex h-8 items-center gap-2 rounded-lg bg-[#0B4FC4] px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-[#0A45AB] disabled:opacity-60"
              >
                {opening ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
                Mở trình duyệt đăng nhập TikTok
              </button>
            )}
            {auth.connected && (
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#DBEAFE] pt-2.5">
                <span className="text-xs text-[#64748B]">Tài khoản TikTok:</span>
                <span className="truncate text-xs font-semibold text-[#0F172A]" title={auth.username || undefined}>
                  {auth.username ? `@${auth.username}` : "Không lấy được tên tài khoản"}
                </span>
              </div>
            )}
            <div className={cn("flex items-center justify-between gap-3 pt-2.5", auth.connected ? "mt-2" : "mt-3 border-t border-[#DBEAFE]")}>
              <span className="text-xs text-[#64748B]">Trạng thái đăng nhập:</span>
              <StatusPill on={auth.connected}>
                {auth.loading ? "Đang kiểm tra…" : auth.connected ? "Đã đăng nhập" : "Chưa đăng nhập"}
              </StatusPill>
            </div>
            {auth.error && (
              <p className="mt-2 text-xs text-rose-600">
                {auth.error}{" "}
                <button type="button" onClick={refreshAuth} className="font-semibold underline">Kiểm tra lại</button>
              </p>
            )}
          </div>
        </section>

        <section className={cn(CARD, "p-6")}>
          <div className="mb-4 border-b border-[#F1F5F9] pb-3">
            <StepHeading step={2} title="Cấu hình quét và thư mục lưu" />
          </div>
          <div className="space-y-4">
            <div>
              <label htmlFor="tiktok-keywords" className={LABEL}>
                Nhập từ khóa tìm kiếm TikTok <span className="font-normal text-[#94A3B8]">(Phân cách bằng dấu phẩy)</span>
              </label>
              <input
                id="tiktok-keywords"
                value={keywordText}
                disabled={running}
                onChange={(e) => setKeywordText(e.target.value)}
                placeholder="thời trang mùa hè, review đồ gia dụng, mẹo vặt cuộc sống"
                className={INPUT}
              />
            </div>
            <div>
              <label htmlFor="tiktok-folder" className={LABEL}>Thư mục lưu trữ video</label>
              <div className="flex gap-2">
                <input id="tiktok-folder" readOnly value={folder} title={folder} placeholder="Chưa chọn thư mục" className={cn(INPUT, "min-w-0 truncate bg-[#F8FAFC] font-mono")} />
                <button
                  type="button"
                  onClick={chooseFolder}
                  disabled={picking || running}
                  className="h-[34px] shrink-0 rounded-lg border border-[#CBD5E1] bg-white px-3.5 text-xs font-semibold text-[#334155] hover:bg-[#F8FAFC] disabled:opacity-60"
                >
                  {folder ? "Đổi thư mục" : "Chọn thư mục"}
                </button>
              </div>
            </div>
            <div>
              <span className={LABEL}>Số lượng video / từ khóa</span>
              <div className="flex items-center gap-2 text-xs text-[#64748B]">
                <NumberInput value={perKeyword} onChange={setPerKeyword} min={1} max={500} disabled={running} className="w-20" /> video
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className={cn(CARD, "overflow-hidden")}>
        <div className="p-5">
          <StepHeading step={3} title="Chọn tài khoản Facebook">
            <CountBadge>Đã chọn {selected.size} / {total} tài khoản</CountBadge>
          </StepHeading>
          <p className="mt-0.5 pl-[34px] text-xs text-[#64748B]">Lựa chọn tài khoản Facebook mà bạn muốn tải video</p>
        </div>
        <div className="max-h-[360px] overflow-auto">
          <table className="w-full min-w-[720px]">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={cn(TH, "w-12")}>
                  <Checkbox checked={allSelected} disabled={!usable.length || running} onCheckedChange={toggleAll} aria-label="Chọn tất cả tài khoản đang hiện" />
                </th>
                <th className={cn(TH, "w-16")}>STT</th>
                <th className={TH}>UID Facebook</th>
                <th className={TH}>Họ & tên tài khoản</th>
                <th className={cn(TH, "text-center")}>Trạng thái ĐN</th>
                <th className={cn(TH, "text-center")}>Trạng thái TK</th>
              </tr>
            </thead>
            <tbody>
              {usable.map((account, index) => (
                <tr key={account.uid} className="text-xs hover:bg-[#F8FAFC]">
                  <td className="px-4 py-2.5">
                    <Checkbox checked={selected.has(account.uid)} disabled={running} onCheckedChange={() => toggle(account.uid)} aria-label={`Chọn ${account.profile_name || account.uid}`} />
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[#64748B]">{String(index + 1).padStart(2, "0")}</td>
                  <td className="px-4 py-2.5"><UidCopy uid={account.uid} /></td>
                  <td className="px-4 py-2.5 font-semibold text-[#0F172A]">{account.profile_name || "—"}</td>
                  <td className="px-4 py-2.5 text-center"><StatusPill on>Đã đăng nhập</StatusPill></td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="rounded-full bg-[#D1FAE5] px-2.5 py-0.5 text-xs font-semibold text-[#047857]">Live</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <p className="py-8 text-center text-xs text-[#94A3B8]">Đang tải tài khoản…</p>}
          {!loading && !loadError && !usable.length && (
            <p className="py-8 text-center text-xs text-[#94A3B8]">Chưa có tài khoản Live đã đăng nhập.</p>
          )}
          {loadError && (
            <p className="py-8 text-center text-xs text-rose-600">
              {loadError} <button type="button" onClick={reload} className="font-semibold underline">Thử lại</button>
            </p>
          )}
          {!loading && hasMore && (
            <div className="border-t border-[#F1F5F9] py-2.5 text-center text-xs">
              {moreError && <p className="mb-1 text-rose-600">{moreError}</p>}
              <button type="button" onClick={loadMore} disabled={loadingMore} className="font-semibold text-[#2563EB] hover:underline disabled:opacity-60">
                {loadingMore ? "Đang tải…" : "Xem thêm tài khoản"}
              </button>
            </div>
          )}
        </div>
      </section>

      <button
        type="button"
        onClick={running ? stop : start}
        disabled={busy || job.phase === "stopping"}
        className={cn(
          "flex h-11 w-full items-center justify-center gap-2.5 rounded-xl text-sm font-bold uppercase tracking-wide text-white shadow-md transition disabled:opacity-60",
          running ? "bg-[#DC2626] hover:bg-[#B91C1C]" : "bg-[#0B4FC4] hover:bg-[#0A45AB]"
        )}
      >
        {running ? <Square className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
        {job.phase === "stopping" ? "Đang dừng…" : running ? "Dừng quét và tải video" : "Bắt đầu quét và tải video TikTok"}
      </button>

      <section className={cn(CARD, "overflow-hidden")}>
        <div className="flex items-center gap-2.5 p-5">
          <h2 className="font-heading text-base font-semibold text-[#0F172A]">Danh sách kết quả quét</h2>
          <CountBadge>Đã tải: {job.done} / {job.total} video</CountBadge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px]">
            <thead>
              <tr>
                {["STT", "Tài khoản Facebook", "Thư mục lưu", "Link video", "Nội dung caption & file TXT", "Trạng thái"].map((title) => (
                  <th key={title} className={TH}>{title}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((video, index) => <VideoRow key={video.id} video={video} index={first + index} />)}
              {!rows.length && (
                <tr><td colSpan={6} className="py-10 text-center text-xs text-[#94A3B8]">{running ? "Đang tìm video…" : "Chưa có video nào được quét."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-[#E2E8F0] px-5 py-3 text-xs text-[#64748B]">
          <span>
            Hiển thị <strong className="text-[#0F172A]">{rows.length ? first + 1 : 0} - {first + rows.length}</strong> của{" "}
            <strong className="text-[#0F172A]">{job.total}</strong> video quét được
          </span>
          {totalPages > 1 && <Pager page={page} totalPages={totalPages} onChange={setPage} />}
        </div>
      </section>

      <LiveLogConsole
        title="Live Automation Log Console"
        logs={job.logs}
        phase={running ? "running" : job.phase}
      />
    </div>
  );
}
