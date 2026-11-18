"use client";
import { useState, useMemo, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import CustomSelect from "@/components/ui/custom-select";
import { Search, Flag, Copy, Check, RefreshCw, Video, Bot, Film } from "lucide-react";
import { getHistory, getHistoryStats } from "../service";
import Pagination from "@/components/ui/pagination";
function PageLogo({ avatar, name }) {
  const [hasError, setHasError] = useState(false);
  if (!avatar || hasError) {
    return (
      <div className="w-6 h-6 rounded bg-muted text-muted-foreground border border-border flex items-center justify-center shrink-0">
        <Flag className="w-3 h-3 fill-current" />
      </div>
    );
  }
  return (
    <img src={avatar} alt={name || "Fanpage"} onError={() => setHasError(true)} className="w-6 h-6 rounded object-cover shrink-0 border border-border" />
  );
}
function formatDateTimeUtc7(val) {
  if (!val) return "Vừa Xong";
  try {
    let s = String(val).trim();
    if (!s.endsWith("Z") && !s.includes("+") && !s.includes("GMT")) {
      s = s.replace(" ", "T") + "Z";
    }
    const d = new Date(s);
    if (isNaN(d.getTime())) return String(val);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).formatToParts(d).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
    return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
  } catch {
    return String(val);
  }
}
function formatLogMessage(item) {
  const pName = item.page_name || "Fanpage";
  const type = (item.post_type || "").toUpperCase();
  if (type === "TIKTOK") {
    if (item.status === "FAILED") {
      return `Thất Bại Khi Tải Video TikTok Cho Fanpage: ${pName}`;
    }
    return `Đã Tải Video TikTok Cho Fanpage: ${pName}`;
  }
  if (type === "YOUTUBE") {
    if (item.status === "FAILED") {
      return `Thất Bại Khi Tải Video YouTube Cho Fanpage: ${pName}`;
    }
    return `Đã Tải Video YouTube Cho Fanpage: ${pName}`;
  }
  if (type === "AI") {
    if (item.status === "FAILED") {
      return `Thất Bại Khi Đăng Bài AI Cho Fanpage: ${pName}`;
    }
    return `Đã Đăng Bài AI Cho Fanpage: ${pName}`;
  }
  if (type === "REEL" || type === "REELS") {
    if (item.status === "FAILED") {
      return `Thất Bại Khi Đăng Reels Cho Fanpage: ${pName}`;
    }
    return `Đã Đăng Reels Cho Fanpage: ${pName}`;
  }
  return item.title || item.caption || `Hoạt Động Fanpage: ${pName}`;
}
function getActivityBadge(type) {
  const t = (type || "").toUpperCase();
  if (t === "TIKTOK") {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-0.5 rounded text-[11px] font-normal max-w-full border border-pink-200 bg-pink-50/70 text-pink-700 dark:border-pink-900/60 dark:bg-pink-950/30 dark:text-pink-400">
        <Video className="w-3 h-3 shrink-0 text-pink-600 dark:text-pink-400" />
        <span className="truncate">Tải Video TikTok</span>
      </span>
    );
  }
  if (t === "YOUTUBE") {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-0.5 rounded text-[11px] font-normal max-w-full border border-red-200 bg-red-50/70 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-400">
        <Film className="w-3 h-3 shrink-0 text-red-600 dark:text-red-400" />
        <span className="truncate">Tải Video YouTube</span>
      </span>
    );
  }
  if (t === "AI") {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-0.5 rounded text-[11px] font-normal max-w-full border border-blue-200 bg-blue-50/70 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-400">
        <Bot className="w-3 h-3 shrink-0 text-blue-600 dark:text-blue-400" />
        <span className="truncate">Đăng Bài AI</span>
      </span>
    );
  }
  if (t === "REEL" || t === "REELS") {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-0.5 rounded text-[11px] font-normal max-w-full border border-purple-200 bg-purple-50/70 text-purple-700 dark:border-purple-900/60 dark:bg-purple-950/30 dark:text-purple-400">
        <Film className="w-3 h-3 shrink-0 text-purple-600 dark:text-purple-400" />
        <span className="truncate">Đăng Video Reels</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-0.5 rounded text-[11px] font-normal max-w-full border border-border bg-muted/50 text-foreground">
      <span className="truncate">{type || "Hoạt Động"}</span>
    </span>
  );
}
function getStatusBadge(status) {
  const isSuccess = status === "SUCCESS";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-normal whitespace-nowrap shrink-0 ${isSuccess ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800" : "bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isSuccess ? "bg-emerald-500" : "bg-rose-500"}`}></span>
      {isSuccess ? "Thành Công" : "Thất Bại"}
    </span>
  );
}
export default function HistoryTab({ onSelectPost, isActive = true }) {
  const [activeTab, setActiveTab] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [historyItems, setHistoryItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [stats, setStats] = useState({
    total: 0,
    ai: { total: 0, success: 0, failed: 0 },
    reels: { total: 0, success: 0, failed: 0 },
    tiktok: { total: 0, success: 0, failed: 0 },
    youtube: { total: 0, success: 0, failed: 0 }
  });
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [detailCopied, setDetailCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const loadStats = async (fresh = true) => {
    const data = await getHistoryStats(fresh);
    if (data) setStats(data);
  };
  const loadHistory = async (fresh = true) => {
    setLoading(true);
    try {
      const data = await getHistory(activeTab === "ALL" ? "" : activeTab, searchTerm, statusFilter, 200, 0, fresh);
      setHistoryItems(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  };
  const handleRefresh = async () => {
    if (loading || refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([
        loadStats(true),
        loadHistory(true),
        new Promise((resolve) => setTimeout(resolve, 500))
      ]);
    } finally {
      setRefreshing(false);
    }
  };
  const prevActiveRef = useRef(isActive);
  useEffect(() => {
    loadStats(true);
  }, []);
  useEffect(() => {
    if (isActive && !prevActiveRef.current) {
      loadStats(true);
      loadHistory(true);
    }
    prevActiveRef.current = isActive;
  }, [isActive]);
  useEffect(() => {
    setCurrentPage(1);
    loadHistory(true);
  }, [activeTab, statusFilter, searchTerm]);
  const totalPages = Math.max(1, Math.ceil(historyItems.length / pageSize));
  const paginatedItems = useMemo(() => {
    return historyItems.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  }, [historyItems, currentPage, pageSize]);
  const handleCopyText = (text, setCopied = setDetailCopied) => {
    if (!text) return;
    try {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  const statList = [
    { id: "ALL", label: "Tất Cả Hoạt Động", total: (stats.ai?.total || 0) + (stats.reels?.total || 0) + (stats.tiktok?.total || 0) + (stats.youtube?.total || 0), success: (stats.ai?.success || 0) + (stats.reels?.success || 0) + (stats.tiktok?.success || 0) + (stats.youtube?.success || 0), failed: (stats.ai?.failed || 0) + (stats.reels?.failed || 0) + (stats.tiktok?.failed || 0) + (stats.youtube?.failed || 0), color: "text-foreground", bg: "bg-muted border-border" },
    { id: "AI", label: "Đăng Bài AI", total: stats.ai?.total || 0, success: stats.ai?.success || 0, failed: stats.ai?.failed || 0, color: "text-blue-700 dark:text-blue-400", bg: "bg-blue-50/70 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900/50" },
    { id: "REELS", label: "Đăng Video Reels", total: stats.reels?.total || 0, success: stats.reels?.success || 0, failed: stats.reels?.failed || 0, color: "text-purple-700 dark:text-purple-400", bg: "bg-purple-50/70 border-purple-200 dark:bg-purple-950/30 dark:border-purple-900/50" },
    { id: "TIKTOK", label: "Tải Video TikTok", total: stats.tiktok?.total || 0, success: stats.tiktok?.success || 0, failed: stats.tiktok?.failed || 0, color: "text-pink-700 dark:text-pink-400", bg: "bg-pink-50/70 border-pink-200 dark:bg-pink-950/30 dark:border-pink-900/50" },
    { id: "YOUTUBE", label: "Tải Video YouTube", total: stats.youtube?.total || 0, success: stats.youtube?.success || 0, failed: stats.youtube?.failed || 0, color: "text-red-700 dark:text-red-400", bg: "bg-red-50/70 border-red-200 dark:bg-red-950/30 dark:border-red-900/50" },
  ];
  return (
    <div className="space-y-4 font-normal">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Lịch Sử & Nhật Ký Hoạt Động Hệ Thống</h2>
          <p className="text-xs text-muted-foreground">Theo Dõi Chi Tiết Toàn Bộ Lịch Sử Đăng Bài AI, Reels Và Tải Video TikTok, YouTube.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleRefresh} disabled={loading || refreshing} className="gap-1.5 h-8 text-xs font-normal border border-border hover:bg-muted text-foreground rounded shadow-none">
            <RefreshCw className={`w-3.5 h-3.5 transition-transform ${(loading || refreshing) ? "animate-spin" : ""}`} />
            <span>{refreshing ? "Đang Làm Mới..." : "Làm Mới"}</span>
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {statList.map((st) => (
          <Card key={st.id} onClick={() => setActiveTab(st.id)} className={`cursor-pointer transition-all border ${activeTab === st.id ? "border-primary ring-1 ring-primary bg-card shadow-xs" : "border-border hover:border-border/80 bg-card"} rounded-lg shadow-none`}>
            <CardContent className="p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-medium text-muted-foreground truncate">{st.label}</span>
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${st.bg} ${st.color}`}>Tổng: {st.total}</span>
              </div>
              <div className="flex items-center justify-between text-xs font-mono pt-0.5">
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">✓ {st.success}</span>
                <span className="text-rose-600 dark:text-rose-400 font-medium">✗ {st.failed}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="border border-border bg-card shadow-none rounded-lg">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
            <div className="flex flex-wrap items-center gap-1 p-1 rounded bg-muted/40 border border-border/50">
              {[
                { id: "ALL", label: "Tất Cả" },
                { id: "AI", label: "Đăng Bài AI" },
                { id: "REELS", label: "Đăng Video Reels" },
                { id: "TIKTOK", label: "Tải Video TikTok" },
                { id: "YOUTUBE", label: "Tải Video YouTube" },
              ].map((tab) => (
                <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`px-2.5 py-1 rounded text-xs font-normal transition-all ${activeTab === tab.id ? "bg-background text-foreground shadow-xs border border-border" : "text-muted-foreground hover:text-foreground"}`}>
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <CustomSelect
                value={statusFilter}
                onChange={setStatusFilter}
                size="sm"
                className="w-40"
                options={[
                  { value: "ALL", label: "Tất Cả Trạng Thái" },
                  { value: "SUCCESS", label: "Thành Công ✓" },
                  { value: "FAILED", label: "Thất Bại ✗" },
                ]}
              />
              <div className="relative w-64">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input placeholder="Tìm Theo Tên Page, Nội Dung, ID..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="h-8 text-xs font-normal pl-8 rounded" />
              </div>
            </div>
          </div>
          <Table className="table-fixed w-full">
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-[5%] text-center text-xs font-medium px-2">STT</TableHead>
                  <TableHead className="w-[15%] text-xs font-medium px-2">Thời Gian</TableHead>
                  <TableHead className="w-[15%] text-xs font-medium text-center px-2">Hoạt Động</TableHead>
                  <TableHead className="w-[18%] text-xs font-medium px-2">Fanpage</TableHead>
                  <TableHead className="w-[23%] text-xs font-medium px-2">Nội Dung Nhật Ký</TableHead>
                  <TableHead className="w-[12%] text-center text-xs font-medium px-2">Trạng Thái</TableHead>
                  <TableHead className="w-[12%] text-right text-xs font-medium pr-3 pl-2">Thao Tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground text-xs">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                        <span>Đang Tải Danh Sách Lịch Sử...</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : historyItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground text-xs">Chưa Có Bản Ghi Lịch Sử Nào Phù Hợp Bộ Lọc.</TableCell>
                  </TableRow>
                ) : (
                  paginatedItems.map((it, idx) => {
                    const rowNum = (currentPage - 1) * pageSize + idx + 1;
                    const msgTitle = formatLogMessage(it);
                    const accInfo = it.account_name || (it.account_uid ? `UID: ${it.account_uid}` : "");
                    return (
                      <TableRow key={`hist_${it.post_type || 'act'}_${it.id || rowNum}_${idx}`} className="hover:bg-muted/30">
                        <TableCell className="text-center text-xs font-mono text-muted-foreground px-2 truncate">{rowNum}</TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground px-2 truncate" title={formatDateTimeUtc7(it.posted_at)}>
                          {formatDateTimeUtc7(it.posted_at)}
                        </TableCell>
                        <TableCell className="text-center px-2 overflow-hidden">
                          {getActivityBadge(it.post_type)}
                        </TableCell>
                        <TableCell className="px-2 overflow-hidden">
                          <div className="flex items-center gap-2 min-w-0">
                            <PageLogo avatar={it.avatar} name={it.page_name} />
                            <div className="min-w-0 flex-1">
                              <span className="text-xs font-medium text-foreground block truncate" title={it.page_name || "Fanpage"}>{it.page_name || "Fanpage"}</span>
                              {accInfo && (
                                <span className="text-[10px] text-muted-foreground font-mono block truncate" title={accInfo}>{accInfo}</span>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="px-2 overflow-hidden">
                          <div className="w-full min-w-0 space-y-0.5">
                            <p className="text-xs font-medium text-foreground truncate" title={msgTitle}>{msgTitle}</p>
                            {it.title && it.title !== msgTitle && (
                              <p className="text-[11px] text-muted-foreground truncate" title={it.title}>{it.title}</p>
                            )}
                            {it.caption && it.caption !== it.title && (
                              <span className="text-[10px] text-muted-foreground font-mono block truncate" title={`ID / Chi Tiết: ${it.caption}`}>ID / Chi Tiết: {it.caption}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center px-2 overflow-hidden">
                          {getStatusBadge(it.status)}
                        </TableCell>
                        <TableCell className="text-right pr-3 pl-2 overflow-hidden">
                          <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs font-normal border border-border hover:bg-muted text-foreground rounded shadow-none max-w-full truncate" onClick={() => setSelectedDetail(it)}>Xem Chi Tiết</Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          {historyItems.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 px-1">
              <div className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                <span>Hiển Thị</span>
                <CustomSelect
                  value={pageSize}
                  onChange={(val) => {
                    setPageSize(Number(val));
                    setCurrentPage(1);
                  }}
                  size="sm"
                  direction="up"
                  className="w-[72px]"
                  buttonClassName="h-7 px-2"
                  options={[
                    { value: 10, label: "10" },
                    { value: 20, label: "20" },
                    { value: 50, label: "50" },
                    { value: 100, label: "100" },
                  ]}
                />
                <span>/ Trang (Tổng {historyItems.length} Bản Ghi)</span>
              </div>
              <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
            </div>
          )}
        </CardContent>
      </Card>
      <Dialog open={!!selectedDetail} onOpenChange={(open) => !open && setSelectedDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-5 bg-card rounded-lg">
          <DialogHeader className="p-0 border-b border-border pb-3">
            <div className="flex items-center justify-between gap-3 pr-7">
              <DialogTitle className="text-sm font-semibold text-foreground">
                Chi Tiết Nhật Ký: {selectedDetail?.page_name || "Fanpage"}
              </DialogTitle>
              {getActivityBadge(selectedDetail?.post_type)}
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              Thời Gian: {formatDateTimeUtc7(selectedDetail?.posted_at)} | ID: {selectedDetail?.id || "N/A"}
            </p>
          </DialogHeader>
          <div className="space-y-3 py-3 overflow-y-auto flex-1 font-normal">
            <div className="p-3 rounded border border-border bg-muted/20 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-medium text-foreground">{formatLogMessage(selectedDetail || {})}</span>
                {getStatusBadge(selectedDetail?.status)}
              </div>
              {selectedDetail?.title && (
                <div>
                  <span className="text-[11px] text-muted-foreground block">Tiêu Đề / Tên Video:</span>
                  <p className="text-xs text-foreground leading-relaxed">{selectedDetail.title}</p>
                </div>
              )}
              {selectedDetail?.caption && selectedDetail.caption !== selectedDetail.title && (
                <div>
                  <span className="text-[11px] text-muted-foreground block">Chi Tiết / Nội Dung / ID:</span>
                  <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">{selectedDetail.caption}</p>
                </div>
              )}
              {selectedDetail?.post_url && (
                <div className="pt-2 border-t border-border flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1 flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground">
                    <span className="shrink-0">Link bài viết:</span>
                    <a
                      href={selectedDetail.post_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline truncate"
                      title={selectedDetail.post_url}
                    >
                      {selectedDetail.post_url}
                    </a>
                  </div>
                  <button type="button" onClick={() => handleCopyText(selectedDetail.post_url, setLinkCopied)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 shrink-0 font-normal">
                    {linkCopied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                    <span>{linkCopied ? "Đã Sao Chép" : "Sao Chép Đường Link"}</span>
                  </button>
                </div>
              )}
              {selectedDetail?.object_path && selectedDetail.object_path !== selectedDetail?.post_url && (
                <div className="pt-2 border-t border-border flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono text-muted-foreground truncate" title={selectedDetail.object_path}>
                    Tệp: {selectedDetail.object_path}
                  </span>
                  <button type="button" onClick={() => handleCopyText(selectedDetail.object_path, setDetailCopied)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 shrink-0 font-normal">
                    {detailCopied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                    <span>{detailCopied ? "Đã Sao Chép" : "Sao Chép Đường Dẫn"}</span>
                  </button>
                </div>
              )}
              {selectedDetail?.error_message && (
                <div className="p-2.5 rounded bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-400 text-xs font-mono space-y-1">
                  <span className="font-semibold block">Thông Báo Lỗi:</span>
                  <p className="whitespace-pre-wrap">{selectedDetail.error_message}</p>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
