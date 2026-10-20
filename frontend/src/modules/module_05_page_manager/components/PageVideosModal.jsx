"use client";
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Trash2, Copy, Check, Video, Play } from "lucide-react";
import { getPageVideos, clearPageVideos, deletePageVideo, getVideoStreamUrl } from "../service";
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
export default function PageVideosModal({ open, onOpenChange, page, defaultSource = null, onCleared }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState(defaultSource || "ALL");
  const [copiedId, setCopiedId] = useState(null);
  const [playingVideo, setPlayingVideo] = useState(null);
  const loadVideos = async () => {
    if (!page) return;
    setLoading(true);
    try {
      const targetSource = sourceFilter === "ALL" ? null : sourceFilter;
      const res = await getPageVideos(page.page_id || page.id, targetSource);
      setVideos(res && Array.isArray(res.videos) ? res.videos : []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (open && page) {
      if (defaultSource) setSourceFilter(defaultSource);
      loadVideos();
    }
  }, [open, page, sourceFilter]);
  const handleCopy = (path, id) => {
    if (!path) return;
    try {
      navigator.clipboard.writeText(path);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  };
  const handleDeleteOne = async (videoDbId) => {
    if (!page || !videoDbId) return;
    if (!confirm("Bạn Có Chắc Muốn Xóa Video Này Khỏi Danh Sách & Ổ Đĩa Không?")) return;
    try {
      await deletePageVideo(page.page_id || page.id, videoDbId);
      setVideos((prev) => prev.filter((v) => v.id !== videoDbId));
      if (onCleared) onCleared(page.page_id || page.id);
    } catch {}
  };
  const handleClearAll = async () => {
    if (!page) return;
    const targetSource = sourceFilter === "ALL" ? null : sourceFilter;
    const confirmMsg = targetSource
      ? `Bạn Có Chắc Muốn Xóa Tất Cả Video ${targetSource} Đã Tải Của Fanpage "${page.page_name}"?`
      : `Bạn Có Chắc Muốn Xóa Tất Cả Video Đã Tải Của Fanpage "${page.page_name}"?`;
    if (!confirm(confirmMsg)) return;
    setLoading(true);
    try {
      await clearPageVideos(page.page_id || page.id, targetSource);
      setVideos([]);
      if (onCleared) onCleared(page.page_id || page.id);
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl w-[95vw] p-5 bg-card max-h-[85vh] flex flex-col font-normal [&_*]:!font-normal [&_*]:normal-case">
          <DialogHeader className="p-0 border-b border-border pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {page?.avatar ? (
                  <img src={page.avatar} alt={page.page_name} className="w-10 h-10 rounded-full object-cover border border-border shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-normal text-sm shrink-0">
                    <Video className="w-5 h-5" />
                  </div>
                )}
                <div>
                  <DialogTitle className="text-sm font-normal font-heading text-foreground flex items-center gap-2">
                    <span>{page?.page_name || "Fanpage"}</span>
                    <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal">
                      {videos.length} Video {defaultSource === "TIKTOK" ? "TikTok " : ""}Đã Tải
                    </Badge>
                  </DialogTitle>
                  <p className="text-[11px] text-muted-foreground font-mono mt-0.5">UID: {page?.page_id || page?.id}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!defaultSource && (
                  <div className="flex items-center p-0.5 bg-muted rounded-md border border-border text-xs">
                    {["ALL", "TIKTOK", "YOUTUBE"].map((src) => (
                      <button key={src} type="button" onClick={() => setSourceFilter(src)} className={`px-2.5 py-1 rounded text-[11px] font-normal transition-all ${sourceFilter === src ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                        {src === "ALL" ? "Tất Cả" : src === "TIKTOK" ? "TikTok" : "YouTube"}
                      </button>
                    ))}
                  </div>
                )}
                {videos.length > 0 && (
                  <Button size="sm" variant="outline" onClick={handleClearAll} disabled={loading} className="h-7 text-[11px] gap-1 font-normal text-rose-600 border-rose-200 hover:bg-rose-50 dark:border-rose-900/60 dark:hover:bg-rose-950/40 shadow-none">
                    <Trash2 className="w-3 h-3" /> Xóa Tất Cả Video
                  </Button>
                )}
              </div>
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto py-2">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 space-y-3">
                <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                <span className="text-xs text-muted-foreground font-normal animate-pulse">Đang Nạp Danh Sách Video...</span>
              </div>
            ) : videos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
                <Video className="w-8 h-8 text-muted-foreground stroke-1" />
                <span className="font-normal text-foreground text-sm">Chưa Có Video {defaultSource === "TIKTOK" ? "TikTok " : ""}Nào Được Tải Về</span>
                <span className="text-xs font-normal text-muted-foreground max-w-sm">
                  {defaultSource === "TIKTOK" ? "Các Video Được Tải Từ TikTok Của Fanpage Này Sẽ Được Lưu Trữ & Hiển Thị Tại Đây." : "Các Video Được Tải Từ TikTok Hoặc YouTube Shorts Của Fanpage Này Sẽ Được Lưu Trữ & Hiển Thị Tại Đây."}
                </span>
              </div>
            ) : (
              <div className="border border-border rounded-lg overflow-x-auto w-full">
                <Table className="w-full">
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="w-12 text-center text-[11px] font-normal normal-case tracking-normal shrink-0">STT</TableHead>
                      <TableHead className="text-[11px] font-normal normal-case tracking-normal min-w-[200px]">Tiêu Đề Video</TableHead>
                      {!defaultSource && <TableHead className="w-20 text-center text-[11px] font-normal normal-case tracking-normal shrink-0">Nguồn</TableHead>}
                      <TableHead className="text-[11px] font-normal normal-case tracking-normal min-w-[220px]">Đường Dẫn Tập Tin</TableHead>
                      <TableHead className="w-36 text-center text-[11px] font-normal normal-case tracking-normal shrink-0">Thời Gian</TableHead>
                      <TableHead className="w-28 text-center text-[11px] font-normal normal-case tracking-normal pr-2 shrink-0">Thao Tác</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {videos.map((v, idx) => (
                      <TableRow key={v.id || idx} className="hover:bg-muted/20 text-xs">
                        <TableCell className="text-center font-mono text-muted-foreground shrink-0">{idx + 1}</TableCell>
                        <TableCell>
                          <div className="space-y-0.5 max-w-sm cursor-pointer group" onClick={() => setPlayingVideo(v)} title="Bấm Để Xem Video Này Trực Tiếp">
                            <p className="font-normal text-foreground line-clamp-2 leading-snug group-hover:text-primary group-hover:underline">{v.title || "Video Không Có Tiêu Đề"}</p>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground font-mono">ID: {v.video_id || "N/A"}</span>
                              <span className="text-[10px] text-blue-600 font-normal inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"><Play className="w-2.5 h-2.5 fill-current" /> Xem Video</span>
                            </div>
                          </div>
                        </TableCell>
                        {!defaultSource && (
                          <TableCell className="text-center shrink-0">
                            <Badge variant="subtle" className={`text-[10px] font-normal px-2 py-0.5 ${String(v.source).toUpperCase() === "TIKTOK" ? "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/20" : "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20"}`}>
                              {String(v.source).toUpperCase() === "TIKTOK" ? "TikTok" : "YouTube"}
                            </Badge>
                          </TableCell>
                        )}
                        <TableCell>
                          <div className="flex items-center gap-1.5 max-w-sm">
                            <span className="text-[11px] font-mono text-muted-foreground truncate" title={v.object_path || ""}>
                              {v.object_path || "N/A"}
                            </span>
                            {v.object_path && (
                              <button type="button" onClick={() => handleCopy(v.object_path, v.id || idx)} title="Sao Chép Đường Dẫn" className="text-muted-foreground hover:text-foreground transition-colors p-1 shrink-0">
                                {copiedId === (v.id || idx) ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                              </button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center text-[11px] text-muted-foreground font-mono whitespace-nowrap shrink-0">
                          {formatDateTimeUtc7(v.downloaded_at)}
                        </TableCell>
                        <TableCell className="text-center pr-2 shrink-0">
                          <div className="flex items-center justify-center gap-1.5">
                            <Button size="sm" variant="outline" onClick={() => setPlayingVideo(v)} className="h-7 px-2 text-[11px] font-normal text-blue-600 border-blue-200 hover:bg-blue-50 dark:border-blue-900/60 dark:text-blue-400 dark:hover:bg-blue-950/40 gap-1 shadow-none" title="Xem Video Trực Tiếp">
                              <Play className="w-3 h-3 fill-current" /> Xem
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => handleDeleteOne(v.id)} title="Xóa Video Này" className="h-7 w-7 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40">
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
          <div className="border-t border-border pt-3 flex justify-end">
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)} className="text-xs font-normal">
              Đóng
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(playingVideo)} onOpenChange={(openVal) => { if (!openVal) setPlayingVideo(null); }}>
        <DialogContent className="max-w-4xl w-[94vw] p-4 pt-3 bg-card max-h-[92vh] flex flex-col font-normal [&_*]:!font-normal [&_*]:normal-case">
          <DialogHeader className="p-0 border-b border-border pb-2 mb-2 pr-8">
            <DialogTitle className="text-sm font-normal text-foreground truncate">
              {playingVideo?.title || "Xem Video Đã Tải"}
            </DialogTitle>
            {playingVideo?.video_id && (
              <p className="text-[11px] font-mono text-muted-foreground">ID: {playingVideo.video_id}</p>
            )}
          </DialogHeader>
          <div className="w-full flex-1 flex flex-col items-center min-h-0">
            <div className="w-full bg-black rounded-xl overflow-hidden border border-border shadow-inner max-h-[66vh] flex items-center justify-center">
              <video
                controls
                autoPlay
                playsInline
                className="w-full max-h-[66vh] object-contain block"
                src={getVideoStreamUrl(playingVideo?.object_path, playingVideo?.id)}
              >
                Trình Duyệt Không Hỗ Trợ Định Dạng Video Này.
              </video>
            </div>
            <div className="w-full mt-2.5 p-2 rounded-lg border border-border bg-muted/30 text-xs font-mono space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground truncate" title={playingVideo?.object_path || ""}>{playingVideo?.object_path || "N/A"}</span>
                <Button size="sm" variant="ghost" onClick={() => handleCopy(playingVideo?.object_path, "player")} className="h-6 text-[10px] gap-1 px-2 shrink-0">
                  {copiedId === "player" ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />} Sao Chép
                </Button>
              </div>
            </div>
          </div>
          <div className="border-t border-border pt-2.5 mt-2 flex justify-end">
            <Button size="sm" variant="outline" onClick={() => setPlayingVideo(null)} className="text-xs font-normal">
              Đóng
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
