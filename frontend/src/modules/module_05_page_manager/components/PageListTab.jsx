"use client";
import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Search, RefreshCw, Plus, Video, Trash2, Eye, Flag } from "lucide-react";
import Pagination from "@/components/ui/pagination";
import AddPageModal from "./AddPageModal";
import PageVideosModal from "./PageVideosModal";
function PageLogo({ avatar, name }) {
  const [hasError, setHasError] = useState(false);
  if (!avatar || hasError) {
    return (
      <div className="w-9 h-9 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 flex items-center justify-center shrink-0">
        <Flag className="w-4 h-4 fill-current" />
      </div>
    );
  }
  return (
    <img src={avatar} alt={name || "Fanpage"} onError={() => setHasError(true)} className="w-9 h-9 rounded-full object-cover shrink-0 border border-border group-hover:ring-1 group-hover:ring-primary" />
  );
}
export default function PageListTab({ pages, loading, onRefresh, onDeletePage, onSelectPost }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [selectedVideosPage, setSelectedVideosPage] = useState(null);
  const [videosModalOpen, setVideosModalOpen] = useState(false);
  const filteredPages = useMemo(() => {
    return pages.filter((p) => {
      const matchName = (p.page_name || "").toLowerCase().includes(searchTerm.toLowerCase());
      const matchStatus = statusFilter === "ALL" ? true : p.status === statusFilter;
      return matchName && matchStatus;
    });
  }, [pages, searchTerm, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filteredPages.length / pageSize));
  const paginatedPages = useMemo(() => {
    return filteredPages.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  }, [filteredPages, currentPage, pageSize]);
  const activeCount = useMemo(() => pages.filter((p) => p.status === "ACTIVE").length, [pages]);
  const errorCount = useMemo(() => pages.filter((p) => p.status === "ERROR").length, [pages]);
  const handleOpenVideos = (p) => {
    setSelectedVideosPage(p);
    setVideosModalOpen(true);
  };
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border border-border bg-card shadow-subtle">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Tổng số Page</p>
              <h3 className="text-2xl font-heading font-bold text-foreground mt-0.5">{loading && pages.length === 0 ? "..." : pages.length}</h3>
            </div>
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">🚩</div>
          </CardContent>
        </Card>
        <Card className="border border-border bg-card shadow-subtle">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-emerald-600 font-medium">Đang hoạt động</p>
              <h3 className="text-2xl font-heading font-bold text-foreground mt-0.5">{loading && pages.length === 0 ? "..." : activeCount}</h3>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-lg">✓</div>
          </CardContent>
        </Card>
        <Card className="border border-border bg-card shadow-subtle">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-red-600 font-medium">Lỗi / Mất kết nối</p>
              <h3 className="text-2xl font-heading font-bold text-foreground mt-0.5">{loading && pages.length === 0 ? "..." : errorCount}</h3>
            </div>
            <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center font-bold text-lg">!</div>
          </CardContent>
        </Card>
      </div>
      <Card className="border border-border bg-card shadow-card">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 flex-1 max-w-lg">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input placeholder="Tìm kiếm Page theo tên..." value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }} className="text-xs h-9 pl-8" />
              </div>
              <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }} className="h-9 px-3 rounded-md border border-input bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="ALL">Tất cả trạng thái</option>
                <option value="ACTIVE">Đang hoạt động</option>
                <option value="ERROR">Lỗi / Mất kết nối</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="default" onClick={() => setAddModalOpen(true)} className="gap-1 font-semibold">
                <Plus className="w-3.5 h-3.5" /> THÊM PAGE
              </Button>
              <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading} className="gap-1">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-14 text-center text-xs font-semibold">STT</TableHead>
                  <TableHead className="text-xs font-semibold">Tên Page</TableHead>
                  <TableHead className="text-xs font-semibold">Acc quản lý</TableHead>
                  <TableHead className="text-right text-xs font-semibold pr-4">Hành động</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && pages.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-12 text-muted-foreground text-xs">
                      <div className="flex flex-col items-center justify-center space-y-3">
                        <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                        <span className="font-semibold text-foreground">Đang tải danh sách Fanpage...</span>
                        <span className="text-[11px] text-muted-foreground">Đang nạp dữ liệu từ hệ thống, vui lòng chờ trong giây lát.</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filteredPages.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-10 text-muted-foreground text-xs">Không tìm thấy Fanpage nào phù hợp.</TableCell>
                  </TableRow>
                ) : (
                  paginatedPages.map((p, idx) => (
                    <TableRow key={p.id || idx} className="hover:bg-muted/30">
                      <TableCell className="text-center text-xs text-muted-foreground font-mono">{(currentPage - 1) * pageSize + idx + 1}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2.5 cursor-pointer group" onClick={() => handleOpenVideos(p)} title="Nhấp để xem video đã tải của Fanpage này">
                          <PageLogo avatar={p.avatar} name={p.page_name} />
                          <div>
                            <span className="text-xs font-heading font-bold text-foreground block leading-snug group-hover:text-primary group-hover:underline">{p.page_name}</span>
                            <span className="text-[11px] text-muted-foreground">{p.followers || "50k"} người theo dõi</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <img src={p.account_avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop"} alt={p.account_name} className="w-7 h-7 rounded-full object-cover shrink-0" />
                          <div>
                            <span className="text-xs font-medium text-foreground block leading-tight">{p.account_name}</span>
                            <span className="text-[11px] font-mono text-muted-foreground">UID: {p.account_uid}</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right pr-4">
                        <div className="inline-flex items-center gap-1.5">
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary" title="Xem video đã tải" onClick={() => handleOpenVideos(p)}>
                            <Video className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary" title="Chọn bài viết" onClick={() => onSelectPost?.({ page_name: p.page_name, title: p.ai_keyword })}>
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="Xóa Fanpage" onClick={() => onDeletePage?.(p.id || p.page_id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {filteredPages.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 px-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Hiển thị</span>
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }} className="h-7 text-xs border border-input rounded px-2 bg-background text-foreground focus:outline-none">
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
                <span>/ trang (Tổng {filteredPages.length} Fanpage)</span>
              </div>
              <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
            </div>
          )}
        </CardContent>
      </Card>
      <AddPageModal open={addModalOpen} onOpenChange={setAddModalOpen} onSuccess={onRefresh} />
      <PageVideosModal open={videosModalOpen} onOpenChange={setVideosModalOpen} page={selectedVideosPage} defaultSource="ALL" />
    </div>
  );
}
