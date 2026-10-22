"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Hash,
  Link2,
  FileUp,
  Download,
  Play,
  Square,
  RefreshCw,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  AlertCircle,
  Loader2,
  Users,
  Phone,
  Mail,
  Globe,
  Filter,
  X,
  CheckCircle2,
  Clock,
  BarChart2,
  Trash2,
  Copy,
  BadgeCheck,
  Sparkles,
  AlertTriangle,
  FileText,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "@/lib/toast";
import { getAccounts } from "@/modules/module_02_account_manager/service";
import { normalizeAccount, initialsOf } from "@/modules/module_07_group_spam/shared/components";
import { AVATAR_COLORS } from "@/modules/module_07_group_spam/shared/constants";
import {
  searchPagesByHashtag,
  searchPages,
  parsePageLinks,
  uploadPageFile,
  downloadPageTemplate,
  stopScanSession,
  getScanSessionDetail,
  getScannedPages,
} from "../service";

/* ─── Shared UI atoms ─── */
function SectionCard({ number, title, description, aside, children, className = "" }) {
  return (
    <Card className={`overflow-hidden border-slate-200 shadow-sm ${className}`}>
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
        <div className="flex min-w-0 items-start gap-3">
          {number && (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
              {number}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="font-heading text-sm font-bold leading-5 text-slate-800">{title}</h3>
            {description && <p className="mt-0.5 text-[11px] leading-4 text-slate-400">{description}</p>}
          </div>
        </div>
        {aside}
      </div>
      <div className="px-6 py-5">{children}</div>
    </Card>
  );
}

function StepBadge({ label, active, done }) {
  if (done) return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 border border-emerald-200/60">
      <Check className="size-3" /> {label}
    </span>
  );
  if (active) return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 border border-amber-200/60">
      <Clock className="size-3" /> {label}
    </span>
  );
  return null;
}

function NumCtrl({ value, onChange, min = 1, max = 500, disabled }) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - 10))}
        className="flex size-7 items-center justify-center rounded border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
      >−</button>
      <input
        type="number"
        min={min} max={max}
        value={value}
        disabled={disabled}
        onChange={e => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))}
        className="h-7 w-16 rounded border border-slate-200 bg-white text-center text-xs font-semibold text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50"
      />
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + 10))}
        className="flex size-7 items-center justify-center rounded border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
      >+</button>
    </div>
  );
}

function StopReasonBadge({ reason }) {
  const map = {
    TARGET_REACHED:  { label: "Đạt mục tiêu",        cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    NO_NEW_RESULTS:  { label: "Hết kết quả",           cls: "bg-blue-50 text-blue-700 border-blue-200" },
    CYCLE_DETECTED:  { label: "Phát hiện lặp vòng",   cls: "bg-violet-50 text-violet-700 border-violet-200" },
    END_MARKER:      { label: "Facebook hết bài viết", cls: "bg-slate-50 text-slate-600 border-slate-200" },
    TIMEOUT:         { label: "Hết thời gian",         cls: "bg-amber-50 text-amber-700 border-amber-200" },
    MAX_SCROLLS:     { label: "Đạt giới hạn cuộn",    cls: "bg-amber-50 text-amber-700 border-amber-200" },
    CHECKPOINT:      { label: "Bị checkpoint",         cls: "bg-red-50 text-red-700 border-red-200" },
    USER_STOPPED:    { label: "Người dùng dừng",       cls: "bg-slate-50 text-slate-600 border-slate-200" },
    ERROR:           { label: "Lỗi",                   cls: "bg-red-50 text-red-700 border-red-200" },
  };
  const info = map[reason] || { label: reason || "—", cls: "bg-slate-50 text-slate-500 border-slate-200" };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${info.cls}`}>
      {info.label}
    </span>
  );
}

function RelevanceBadge({ score = 0, status = "RELEVANT" }) {
  if (status === "RELEVANT") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
        <Sparkles className="size-2.5 text-emerald-500" />
        {score}đ • Liên quan
      </span>
    );
  }
  if (status === "REVIEW") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-700">
        <AlertTriangle className="size-2.5 text-amber-500" />
        {score}đ • Cần xem lại
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-500">
      {score}đ • Loại
    </span>
  );
}

/* ─── Source mode tabs (Section 10) ─── */
const SOURCE_MODES = [
  { id: "hashtag",  label: "Theo Hashtag (Mục 10)",  Icon: Hash },
  { id: "paste",    label: "Nhập Link",             Icon: Link2 },
  { id: "upload",   label: "Tải tệp (.txt / .csv)", Icon: FileUp },
];

/* ════════════════════════════════════════════════════════════
   MAIN PAGE SCANNER COMPONENT
   ════════════════════════════════════════════════════════════ */
export default function PageScannerModule() {
  /* ── Accounts ── */
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [selectedAccountUid, setSelectedAccountUid] = useState(null);
  const [showAccountModal, setShowAccountModal] = useState(false);

  /* ── Config Step 1: source mode ── */
  const [sourceMode, setSourceMode] = useState("hashtag");
  const [hashtags, setHashtags] = useState("#thoitrang, #mypham");
  const [contextKeywords, setContextKeywords] = useState("bán sỉ, thời trang, shop, auth");
  const [pasteContent, setPasteContent] = useState("");
  const [uploadResult, setUploadResult] = useState(null);
  const fileInputRef = useRef(null);

  /* ── Config Step 2: settings ── */
  const [maxPostsPerHashtag, setMaxPostsPerHashtag] = useState(100);
  const [minPosts, setMinPosts] = useState(2);
  const [headless, setHeadless] = useState(false);
  const [allowDirectFallback, setAllowDirectFallback] = useState(true);

  /* ── Session state ── */
  const [running, setRunning] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [stopReason, setStopReason] = useState(null);

  /* ── Results & Filter ── */
  const [pages, setPages] = useState([]);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(50);
  const [resultSearch, setResultSearch] = useState("");
  const [relevanceFilter, setRelevanceFilter] = useState("ALL"); // ALL | RELEVANT | REVIEW | EXCLUDED
  const [selectedPageKeys, setSelectedPageKeys] = useState([]);
  const [loadingResults, setLoadingResults] = useState(false);

  /* ── Stats ── */
  const [stats, setStats] = useState(null);

  /* ── Polling & Lifecycle refs ── */
  const pollRef = useRef(null);
  const lastLoadedCountRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  useEffect(() => {
    let ignore = false;
    getAccounts()
      .then((data) => {
        if (!ignore) {
          const normalized = (Array.isArray(data) ? data : data?.accounts || []).map((a, i) =>
            normalizeAccount(a, i),
          );
          setAccounts(normalized);
        }
      })
      .catch((err) => {
        if (!ignore) toast.error(`Lỗi tải tài khoản: ${err.message}`);
      })
      .finally(() => {
        if (!ignore) setAccountsLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  // Load results from a session
  const loadResults = useCallback(async (sid, page = 1, relStatus = relevanceFilter) => {
    if (!sid) return;
    setLoadingResults(true);
    try {
      const data = await getScannedPages({
        session_id: sid,
        page,
        page_size: pageSize,
        keyword: resultSearch || undefined,
        relevance_status: relStatus !== "ALL" ? relStatus : undefined,
      });
      setPages(data.items || []);
      setTotalPages(Math.ceil((data.total || 0) / pageSize));
    } catch (err) {
      toast.error(`Lỗi tải kết quả: ${err.message}`);
    } finally {
      setLoadingResults(false);
    }
  }, [pageSize, resultSearch, relevanceFilter]);

  // When filter changes, reload
  const handleFilterChange = (filterVal) => {
    setRelevanceFilter(filterVal);
    setCurrentPage(1);
    if (sessionId) {
      loadResults(sessionId, 1, filterVal);
    }
  };

  // File upload handler
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await uploadPageFile(formData);
      setUploadResult(res);
      toast.success(`Đã nhập ${res.valid_count} Page hợp lệ từ "${file.name}"`);
    } catch (err) {
      toast.error(`Lỗi đọc file: ${err.message}`);
    }
    e.target.value = "";
  };

  // START execution
  const handleStart = async () => {
    stopPolling();
    lastLoadedCountRef.current = 0;

    setRunning(true);
    setStopReason(null);
    setStats(null);
    setPages([]);
    setSelectedPageKeys([]);
    setCurrentPage(1);

    try {
      if (sourceMode === "hashtag") {
        if (!hashtags.trim()) {
          toast.warning("Vui lòng nhập ít nhất một hashtag!");
          setRunning(false);
          return;
        }

        const res = await searchPagesByHashtag({
          hashtags: hashtags.trim(),
          context_keywords: contextKeywords
            .split(/[,;\n]/)
            .map(k => k.trim())
            .filter(Boolean),
          min_posts: minPosts,
          max_posts_per_hashtag: maxPostsPerHashtag,
          account_uid: selectedAccountUid || null,
          headless,
          allow_direct_fallback: allowDirectFallback,
        });

        const activeSid = res.session_id;
        setSessionId(activeSid);
        toast.info(`Đã khởi động phiên quét Hashtag #${activeSid}. Đang mở Chrome...`);

        // Chu kỳ polling cập nhật realtime kết quả & chỉ số
        pollRef.current = setInterval(async () => {
          try {
            const session = await getScanSessionDetail(activeSid);
            const currentCount = session.pages_count || session.total_unique || 0;

            setStopReason(session.stop_reason);
            setStats({
              count: currentCount,
              total_seen: session.total_seen || 0,
              total_unique: session.total_unique || 0,
              total_posts_scanned: session.total_posts_scanned || session.total_seen || 0,
              total_posts_matched: session.total_posts_matched || 0,
              total_authors_seen: session.total_authors_seen || 0,
              total_pages_relevant: session.total_pages_relevant || 0,
              total_pages_review: session.total_pages_review || 0,
              total_pages_excluded: session.total_pages_excluded || 0,
              batches_count: session.batches_count || 0,
              duration_seconds: session.duration_seconds || 0,
              stop_reason: session.stop_reason,
              session_id: activeSid,
              status: session.status,
              error_message: session.error_message,
            });

            // Tải lũy kế các Page mới quét được vào bảng
            if (currentCount > lastLoadedCountRef.current) {
              lastLoadedCountRef.current = currentCount;
              loadResults(activeSid, 1);
            }

            // Kết thúc phiên khi backend chuyển trạng thái
            if (["COMPLETED", "PARTIAL", "STOPPED", "FAILED"].includes(session.status)) {
              stopPolling();
              setRunning(false);
              loadResults(activeSid, 1);

              if (session.status === "FAILED" || session.stop_reason === "ERROR") {
                toast.error(
                  `Phiên quét bị dừng: ${session.error_message || session.stop_reason || "Lỗi không xác định"}`
                );
              } else if (session.status === "STOPPED" || session.stop_reason === "USER_STOPPED") {
                toast.info(`Đã dừng phiên quét. Thu được ${currentCount} Fanpage.`);
              } else {
                toast.success(
                  `Hoàn thành! Thu hoạch ${session.total_pages_relevant || currentCount} Page liên quan (${session.total_pages_review || 0} cần duyệt).`
                );
              }
            }
          } catch (pollErr) {
            console.error("Lỗi cập nhật tiến độ phiên:", pollErr);
          }
        }, 1500);

        return;
      } else if (sourceMode === "paste") {
        if (!pasteContent.trim()) {
          toast.warning("Vui lòng dán danh sách link vào ô trên!");
          setRunning(false);
          return;
        }
        const res = await parsePageLinks({
          content: pasteContent.trim(),
          filter_existing: true,
          save_to_db: true,
        });
        setSessionId(res.session_id);
        setStats({ count: res.valid_count, stop_reason: "TARGET_REACHED", session_id: res.session_id });
        setStopReason("TARGET_REACHED");
        if (res.session_id) await loadResults(res.session_id, 1);
        toast.success(`Đã nhập ${res.valid_count} Page hợp lệ (trùng loại: ${res.dedup_count}, lỗi: ${res.invalid_count})`);
        setRunning(false);
      } else if (sourceMode === "upload") {
        if (!uploadResult) {
          toast.warning("Vui lòng tải file lên trước!");
          setRunning(false);
          return;
        }
        setSessionId(uploadResult.session_id);
        setStats({ count: uploadResult.valid_count, stop_reason: "TARGET_REACHED", session_id: uploadResult.session_id });
        setStopReason("TARGET_REACHED");
        if (uploadResult.session_id) await loadResults(uploadResult.session_id, 1);
        toast.success(`Đã lưu ${uploadResult.valid_count} Page từ file tải lên.`);
        setRunning(false);
      }
    } catch (err) {
      stopPolling();
      toast.error(`Lỗi thực thi: ${err.message}`);
      setStopReason("ERROR");
      setRunning(false);
    }
  };

  // STOP session
  const handleStop = async () => {
    if (!sessionId) {
      stopPolling();
      setRunning(false);
      return;
    }
    try {
      await stopScanSession(sessionId);
      toast.info("Đã gửi tín hiệu dừng. Trình duyệt đang đóng an toàn...");
    } catch (err) {
      toast.error(`Không thể gửi lệnh dừng: ${err.message}`);
      stopPolling();
      setRunning(false);
    }
  };

  // Pagination
  const handlePageChange = (p) => {
    setCurrentPage(p);
    loadResults(sessionId, p);
  };

  // Export CSV
  const handleExportCSV = () => {
    if (!pages.length) return;
    const headers = [
      "STT",
      "Tên Page",
      "Link Page",
      "Điểm liên quan",
      "Xếp loại",
      "Số bài gắn hashtag",
      "Hashtag khớp",
      "Bằng chứng bài viết",
      "Followers",
      "Tích xanh",
      "Danh mục"
    ];
    const rows = pages.map((p, i) => [
      i + 1,
      p.page_name || "",
      p.page_url || "",
      p.relevance_score || 0,
      p.relevance_status || "RELEVANT",
      p.hashtag_post_count || 0,
      p.matched_hashtags || "",
      Array.isArray(p.evidence_posts) ? p.evidence_posts.join(" | ") : (p.evidence_posts || ""),
      p.follower_count || "",
      p.is_verified === true ? "Có" : p.is_verified === false ? "Không" : "",
      p.category || "",
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `danh_sach_fanpage_hashtag_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Đã xuất file CSV!");
  };

  // Selected account display
  const selAcc = accounts.find(a => a.uid === selectedAccountUid);

  return (
    <div className="space-y-5 pb-8">

      {/* ══════ STEP 1: Account + Source ══════ */}
      <div className="grid gap-5 lg:grid-cols-2">

        {/* Step 1A: Account picker */}
        <SectionCard
          number="1"
          title="Chọn tài khoản & Thiết lập nguồn Hashtag"
          description="Quét bài viết theo hashtag, phân loại tác giả là Fanpage và chấm điểm liên quan"
          aside={
            selectedAccountUid
              ? <StepBadge done label={`Đã chọn: ${selAcc?.name || selectedAccountUid}`} />
              : <StepBadge active label="Chưa chọn (hệ thống tự chọn)" />
          }
        >
          {/* Account select button */}
          <div className="mb-4 flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowAccountModal(true)}
              disabled={running}
              className="gap-1.5"
            >
              <Users className="size-3.5" />
              Chọn tài khoản
            </Button>
            {selectedAccountUid && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700 border border-emerald-200">
                <CheckCircle2 className="size-3" />
                {selAcc?.name || selectedAccountUid}
              </span>
            )}
            {!selectedAccountUid && (
              <span className="text-[11px] text-slate-400">Không chọn → hệ thống tự chọn nick tốt nhất</span>
            )}
          </div>

          {/* Source mode tabs */}
          <p className="mb-2 text-[11px] font-semibold text-slate-600">PHƯƠNG THỨC QUÉT</p>
          <div className="mb-4 flex gap-1.5">
            {SOURCE_MODES.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                disabled={running}
                onClick={() => setSourceMode(id)}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[11px] font-semibold transition-all ${
                  sourceMode === id
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* Source: Hashtag (Mục 10) */}
          {sourceMode === "hashtag" && (
            <div className="space-y-3.5">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                  Danh sách Hashtag mục tiêu (phân cách bằng dấu phẩy hoặc khoảng trắng)
                </label>
                <div className="relative">
                  <Hash className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-primary" />
                  <Input
                    value={hashtags}
                    onChange={e => setHashtags(e.target.value)}
                    disabled={running}
                    placeholder="#thoitrang, #mypham, #phukien..."
                    className="pl-9 font-medium"
                    onKeyDown={e => e.key === "Enter" && !running && handleStart()}
                  />
                </div>
                <p className="mt-1 text-[10px] text-slate-400">
                  Mẹo: Nhập nhiều hashtag liên quan (VD: <code className="text-primary">#thoitrang, #outfit</code>) để Page xuất hiện ở cả 2 tag được cộng điểm tối đa (+15đ).
                </p>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                  Từ khóa ngữ cảnh bổ trợ (Context keywords — tùy chọn)
                </label>
                <Input
                  value={contextKeywords}
                  onChange={e => setContextKeywords(e.target.value)}
                  disabled={running}
                  placeholder="bán sỉ, thời trang nữ, shop, authentic, giá tốt..."
                  className="text-xs"
                />
                <p className="mt-1 text-[10px] text-slate-400">
                  Khi hashtag quá rộng (như #sale, #review), từ khóa ngữ cảnh giúp lọc các Page đăng spam và ưu tiên Page đúng ngành.
                </p>
              </div>
            </div>
          )}

          {/* Source: Paste */}
          {sourceMode === "paste" && (
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">
                Dán danh sách link Fanpage Facebook
              </label>
              <Textarea
                value={pasteContent}
                onChange={e => setPasteContent(e.target.value)}
                disabled={running}
                rows={6}
                placeholder={"https://www.facebook.com/biluxuryvn\nhttps://www.facebook.com/innisfreevietnam\n100084729103941\n..."}
                className="font-mono text-[11px]"
              />
              {pasteContent.trim() && (
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Khoảng {pasteContent.trim().split("\n").filter(Boolean).length} dòng nhập vào
                </p>
              )}
            </div>
          )}

          {/* Source: Upload */}
          {sourceMode === "upload" && (
            <div>
              <div
                className="relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 p-8 text-center transition-all hover:border-primary/40 hover:bg-primary/5 cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUp className="size-8 text-slate-400" />
                <div>
                  <p className="text-sm font-semibold text-slate-700">Kéo thả file .txt hoặc .csv vào đây</p>
                  <p className="text-[11px] text-slate-400">hoặc <span className="font-semibold text-primary underline">Bấm để tải lên</span></p>
                </div>
                <input ref={fileInputRef} type="file" accept=".txt,.csv" hidden onChange={handleFileUpload} />
              </div>

              {uploadResult && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                  <p className="mb-2 text-[11px] font-semibold text-slate-600">XEM TRƯỚC DANH SÁCH TẢI LÊN</p>
                  <div className="flex gap-4 text-[11px]">
                    <span className="text-emerald-700 font-semibold">✓ Hợp lệ: {uploadResult.valid_count}</span>
                    <span className="text-amber-700 font-semibold">⚡ Trùng: {uploadResult.dedup_count}</span>
                    <span className="text-red-600 font-semibold">✗ Lỗi: {uploadResult.invalid_count}</span>
                    <span className="text-slate-500">Tổng: {uploadResult.total_lines}</span>
                  </div>
                  <div className="mt-2 max-h-32 overflow-auto rounded border border-slate-100 bg-slate-50">
                    <table className="w-full text-[10px]">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-100">
                          <th className="px-3 py-1.5 text-left text-slate-500 font-semibold">STT</th>
                          <th className="px-3 py-1.5 text-left text-slate-500 font-semibold">Link Page</th>
                          <th className="px-3 py-1.5 text-left text-slate-500 font-semibold">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(uploadResult.pages || []).slice(0, 5).map((p, i) => (
                          <tr key={i} className="border-b border-slate-100">
                            <td className="px-3 py-1.5 text-slate-400">{i + 1}</td>
                            <td className="px-3 py-1.5 text-slate-600 truncate max-w-[200px]">{p.page_url}</td>
                            <td className="px-3 py-1.5">
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 font-semibold">Hợp lệ</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={downloadPageTemplate}
                className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline"
              >
                <Download className="size-3" /> Tải file mẫu (.txt)
              </button>
            </div>
          )}
        </SectionCard>

        {/* Step 1B: Settings */}
        <SectionCard
          number="2"
          title="Thiết lập cấu hình quét & chấm điểm"
          description="Giới hạn bài viết, điều kiện cứng chống spam và trình duyệt"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-semibold text-slate-700">Số bài viết quét tối đa / hashtag</span>
                <p className="text-[10px] text-slate-400">Khuyến nghị 50–100 bài để đảm bảo tốc độ và độ an toàn</p>
              </div>
              <NumCtrl value={maxPostsPerHashtag} onChange={setMaxPostsPerHashtag} min={10} max={300} disabled={running} />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-semibold text-slate-700">Điều kiện cứng: Tối thiểu số bài / Page</span>
                <p className="text-[10px] text-slate-400">Loại các Page đăng 1 bài vu vơ câu view (mặc định 2 bài)</p>
              </div>
              <NumCtrl value={minPosts} onChange={setMinPosts} min={1} max={10} disabled={running} />
            </div>

            <hr className="border-slate-100" />

            <label className="flex cursor-pointer items-center justify-between text-[11px] font-semibold text-slate-600">
              <div>
                <span>Tự động dùng IP trực tiếp nếu Proxy lỗi (Fallback)</span>
                <p className="text-[10px] font-normal text-slate-400">Tự động chuyển IP để phiên quét không bị dừng giữa chừng</p>
              </div>
              <div
                onClick={() => !running && setAllowDirectFallback(v => !v)}
                className={`relative h-5 w-9 rounded-full transition-colors cursor-pointer ${allowDirectFallback ? "bg-primary" : "bg-slate-200"} ${running ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${allowDirectFallback ? "translate-x-4" : "translate-x-0.5"}`} />
              </div>
            </label>

            <label className="flex cursor-pointer items-center justify-between text-[11px] font-semibold text-slate-600">
              <div>
                <span>Chạy Chrome ẩn (Headless)</span>
                <p className="text-[10px] font-normal text-slate-400">Tắt giao diện Chrome để tiết kiệm RAM & CPU</p>
              </div>
              <div
                onClick={() => !running && setHeadless(v => !v)}
                className={`relative h-5 w-9 rounded-full transition-colors cursor-pointer ${headless ? "bg-primary" : "bg-slate-200"} ${running ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${headless ? "translate-x-4" : "translate-x-0.5"}`} />
              </div>
            </label>
          </div>
        </SectionCard>
      </div>

      {/* ══════ ACTION & LIVE STREAMING STATUS ══════ */}
      <div className="flex flex-col gap-3">
        {running && stats && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50/90 to-indigo-50/90 p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-blue-600" />
              </span>
              <div>
                <p className="text-xs font-bold text-slate-800">
                  Phiên hashtag #{stats.session_id || sessionId} đang quét trực tiếp
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                  <span>Bài quét: <strong className="text-slate-900">{stats.total_posts_scanned || stats.total_seen || 0}</strong></span>
                  <span>•</span>
                  <span>Khớp hashtag: <strong className="text-blue-700">{stats.total_posts_matched || 0}</strong></span>
                  <span>•</span>
                  <span>Fanpage: <strong className="text-slate-900">{stats.count || 0}</strong></span>
                  <span>•</span>
                  <span>Đạt chuẩn: <strong className="text-emerald-700">{stats.total_pages_relevant || 0}</strong></span>
                  <span>•</span>
                  <span>Cần xem lại: <strong className="text-amber-700">{stats.total_pages_review || 0}</strong></span>
                  <span>•</span>
                  <span>Đợt cuộn: <strong className="text-slate-700">{stats.batches_count || 0}</strong></span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-white/80 px-3 py-1.5 border border-blue-100 text-xs font-medium text-slate-700">
              <Clock className="size-3.5 text-blue-600" />
              <span>Thời gian: <strong>{stats.duration_seconds || 0}s</strong></span>
            </div>
          </div>
        )}

        <Button
          type="button"
          size="lg"
          className="w-full gap-2 text-sm font-bold shadow-md shadow-primary/20"
          disabled={running}
          onClick={handleStart}
        >
          {running
            ? <><Loader2 className="size-4 animate-spin" /> ĐANG QUÉT BÀI VIẾT & PHÂN LOẠI PAGE THEO HASHTAG...</>
            : <><Play className="size-4" /> BẮT ĐẦU THỰC THI QUÉT HASHTAG</>
          }
        </Button>

        {running && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full gap-2 border-red-300 bg-red-50/40 text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={handleStop}
          >
            <Square className="size-4" /> DỪNG KHẨN CẤP
          </Button>
        )}
      </div>

      {/* ══════ RESULTS TABLE ══════ */}
      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <h3 className="font-heading text-sm font-bold text-slate-800">Kết quả lọc Fanpage theo Hashtag</h3>
            {stats && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400">Thu hoạch:</span>
                <span className="text-[11px] font-bold text-primary">{stats.count} Page</span>
                {stats.stop_reason && <StopReasonBadge reason={stats.stop_reason} />}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 text-[11px]"
              disabled={!pages.length}
              onClick={handleExportCSV}
            >
              <Download className="size-3.5" /> Xuất file CSV (kèm Bằng chứng)
            </Button>
          </div>
        </div>

        {/* Results filter & Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-3 bg-slate-50/40">
          {/* Status Tabs */}
          <div className="flex items-center gap-1.5">
            {[
              { id: "ALL", label: "Tất cả" },
              { id: "RELEVANT", label: "✨ Liên quan (Đạt chuẩn)" },
              { id: "REVIEW", label: "⚠️ Cần xem lại" },
              { id: "EXCLUDED", label: "🚫 Bị loại" },
            ].map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => handleFilterChange(id)}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-all ${
                  relevanceFilter === id
                    ? "bg-white text-primary shadow-sm border border-slate-200"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Search in results */}
          <div className="relative min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3 text-slate-400" />
            <Input
              value={resultSearch}
              onChange={e => setResultSearch(e.target.value)}
              placeholder="Tìm theo tên hoặc link Page..."
              className="pl-8 h-7 text-[11px] bg-white"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-auto">
          <table className="w-full min-w-[960px] text-left text-[11px]">
            <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500 shadow-sm">
              <tr className="border-b border-slate-200">
                <th className="w-10 px-4 py-3">
                  <Checkbox
                    checked={pages.length > 0 && selectedPageKeys.length === pages.length}
                    onCheckedChange={c => setSelectedPageKeys(c ? pages.map(p => p.page_key) : [])}
                  />
                </th>
                <th className="w-12 px-3 py-3 font-semibold">STT</th>
                <th className="px-3 py-3 font-semibold">FANPAGE</th>
                <th className="px-3 py-3 font-semibold">ĐỘ LIÊN QUAN</th>
                <th className="px-3 py-3 font-semibold">SỐ BÀI KHỚP HASHTAG</th>
                <th className="px-3 py-3 font-semibold">BẰNG CHỨNG (EVIDENCE)</th>
                <th className="px-3 py-3 font-semibold">LINK TRANG</th>
                <th className="px-3 py-3 font-semibold">FOLLOWERS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingResults ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-slate-400">
                    <Loader2 className="mx-auto mb-2 size-6 animate-spin text-primary" />
                    <p>Đang tải danh sách Fanpage...</p>
                  </td>
                </tr>
              ) : pages.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-slate-400">
                    <Hash className="mx-auto mb-2 size-8 opacity-30 text-primary" />
                    <p className="text-sm font-medium text-slate-600">Chưa có Fanpage nào</p>
                    <p className="text-[11px]">Nhập hashtag mục tiêu và bấm &quot;Bắt đầu thực thi quét hashtag&quot; để tìm Page</p>
                  </td>
                </tr>
              ) : (
                pages.map((page, idx) => {
                  const globalIdx = (currentPage - 1) * pageSize + idx + 1;
                  const isSelected = selectedPageKeys.includes(page.page_key);

                  // Parse evidence posts
                  let evidenceList = [];
                  if (Array.isArray(page.evidence_posts)) {
                    evidenceList = page.evidence_posts;
                  } else if (typeof page.evidence_posts === "string" && page.evidence_posts.trim()) {
                    try {
                      evidenceList = JSON.parse(page.evidence_posts);
                    } catch {
                      evidenceList = page.evidence_posts.split("|").map(s => s.trim()).filter(Boolean);
                    }
                  }

                  return (
                    <tr
                      key={page.page_key}
                      onClick={e => {
                        if (e.target.closest("a,button,input")) return;
                        setSelectedPageKeys(prev =>
                          isSelected ? prev.filter(k => k !== page.page_key) : [...prev, page.page_key]
                        );
                      }}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? "bg-blue-50/60 hover:bg-blue-100/60" : "bg-white hover:bg-slate-50"
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={c =>
                            setSelectedPageKeys(prev =>
                              c ? [...prev, page.page_key] : prev.filter(k => k !== page.page_key)
                            )
                          }
                        />
                      </td>
                      <td className="px-3 py-2.5 text-slate-400 font-mono">{String(globalIdx).padStart(2, "0")}</td>

                      {/* Fanpage Avatar & Name */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar className="size-8 shrink-0 border border-slate-200">
                            {page.avatar_url && <AvatarImage src={page.avatar_url} />}
                            <AvatarFallback className={AVATAR_COLORS[idx % AVATAR_COLORS.length]}>
                              {initialsOf(page.page_name || "FB")}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1">
                              <span className="truncate max-w-[180px] font-semibold text-slate-800">
                                {page.page_name || "—"}
                              </span>
                              {page.is_verified === true && (
                                <BadgeCheck className="size-3.5 shrink-0 text-blue-500" />
                              )}
                            </div>
                            {page.category && (
                              <span className="text-[10px] text-slate-400 truncate block max-w-[180px]">{page.category}</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Relevance Score Badge */}
                      <td className="px-3 py-2.5">
                        <RelevanceBadge
                          score={page.relevance_score || 0}
                          status={page.relevance_status || "RELEVANT"}
                        />
                      </td>

                      {/* Matched Count & Tags */}
                      <td className="px-3 py-2.5">
                        <div className="space-y-0.5">
                          <span className="font-bold text-slate-700">
                            {page.hashtag_post_count || 1} bài viết
                          </span>
                          {page.matched_hashtags && (
                            <div className="flex flex-wrap gap-1">
                              {String(page.matched_hashtags).split(",").map((t, ti) => (
                                <span key={ti} className="rounded bg-blue-50 px-1.5 py-0.2 text-[9px] font-medium text-blue-600">
                                  #{t.trim().replace(/^#/, "")}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Evidence Posts (Audit trail) */}
                      <td className="px-3 py-2.5">
                        {evidenceList && evidenceList.length > 0 ? (
                          <div className="flex items-center gap-1.5">
                            {evidenceList.slice(0, 3).map((link, li) => (
                              <a
                                key={li}
                                href={link}
                                target="_blank"
                                rel="noreferrer"
                                title={`Bài viết kiểm chứng #${li + 1}`}
                                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:border-primary hover:text-primary transition-colors"
                              >
                                <FileText className="size-2.5" />
                                Bài #{li + 1}
                                <ExternalLink className="size-2.5" />
                              </a>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-300 text-[10px]">Đang ghi nhận</span>
                        )}
                      </td>

                      {/* Page Link */}
                      <td className="px-3 py-2.5">
                        {page.page_url ? (
                          <a
                            href={page.page_url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-primary hover:underline truncate max-w-[150px]"
                          >
                            <span className="truncate">
                              {page.page_url.replace("https://www.facebook.com/", "fb.com/")}
                            </span>
                            <ExternalLink className="size-3 shrink-0" />
                          </a>
                        ) : "—"}
                      </td>

                      {/* Followers */}
                      <td className="px-3 py-2.5">
                        {page.follower_count ? (
                          <span className="font-semibold text-emerald-700">
                            {page.follower_count.toLocaleString("vi-VN")}
                          </span>
                        ) : (
                          <span className="text-slate-400">{page.follower_text || "—"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3">
            <span className="text-[11px] text-slate-400">
              Hiển thị {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, pages.length)} trong {totalPages * pageSize} Page
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button" variant="outline" size="icon"
                className="size-7" disabled={currentPage <= 1}
                onClick={() => handlePageChange(currentPage - 1)}
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = i + 1;
                return (
                  <button
                    key={p}
                    onClick={() => handlePageChange(p)}
                    className={`flex size-7 items-center justify-center rounded-md text-[11px] font-semibold transition-colors ${
                      p === currentPage
                        ? "bg-primary text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
              {totalPages > 5 && <span className="text-slate-400 text-[11px]">...</span>}
              <Button
                type="button" variant="outline" size="icon"
                className="size-7" disabled={currentPage >= totalPages}
                onClick={() => handlePageChange(currentPage + 1)}
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* ══════ ACCOUNT SELECT MODAL ══════ */}
      {showAccountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h2 className="font-bold text-slate-800">Chọn tài khoản Facebook thực thi quét</h2>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Chọn tài khoản có trạng thái Live để cào dữ liệu bài viết theo hashtag
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAccountModal(false)}
                className="rounded-lg p-1.5 hover:bg-slate-100"
              >
                <X className="size-4 text-slate-500" />
              </button>
            </div>

            <div className="max-h-[400px] overflow-auto px-6 py-4">
              {accountsLoading ? (
                <div className="py-10 text-center text-slate-400">
                  <Loader2 className="mx-auto mb-2 size-6 animate-spin" />
                  <p className="text-sm">Đang tải danh sách tài khoản...</p>
                </div>
              ) : (
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="border-b border-slate-200">
                      <th className="w-10 px-3 py-2.5"></th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-500">TÀI KHOẢN & HỌ TÊN</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-500">UID FACEBOOK</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-500">TRẠNG THÁI TK</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-500">PROXY GÁN KÈM</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {accounts.map((acc, idx) => {
                      const selected = selectedAccountUid === acc.uid;
                      return (
                        <tr
                          key={acc.uid}
                          onClick={() => setSelectedAccountUid(acc.uid)}
                          className={`cursor-pointer transition-colors ${
                            selected ? "bg-blue-50" : "hover:bg-slate-50"
                          }`}
                        >
                          <td className="px-3 py-2.5">
                            <Checkbox
                              checked={selected}
                              onCheckedChange={() => setSelectedAccountUid(acc.uid)}
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <Avatar className="size-8">
                                <AvatarFallback className={AVATAR_COLORS[idx % AVATAR_COLORS.length]}>
                                  {initialsOf(acc.name)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="font-semibold text-slate-700">{acc.name}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-slate-500">{acc.uid}</td>
                          <td className="px-3 py-2.5">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              acc.status === "LIVE"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-red-50 text-red-600"
                            }`}>
                              • {acc.status}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-slate-400 text-[10px]">
                            {acc.proxy || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
              <Button variant="outline" onClick={() => { setSelectedAccountUid(null); setShowAccountModal(false); }}>
                Hủy bỏ
              </Button>
              <Button onClick={() => setShowAccountModal(false)} disabled={!selectedAccountUid}>
                <Check className="mr-1.5 size-3.5" />
                Xác nhận chọn
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
