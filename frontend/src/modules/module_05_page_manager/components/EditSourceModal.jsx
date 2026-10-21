"use client";
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Link2, Search, Trash2, Check, Flag } from "lucide-react";
function PageLogo({ avatar, name }) {
  const [hasError, setHasError] = useState(false);
  if (!avatar || hasError) {
    return (
      <div className="w-5 h-5 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 flex items-center justify-center shrink-0">
        <Flag className="w-2.5 h-2.5 fill-current" />
      </div>
    );
  }
  return (
    <img src={avatar} alt={name || "Fanpage"} onError={() => setHasError(true)} className="w-5 h-5 rounded-full object-cover shrink-0 border border-border" />
  );
}
export default function EditSourceModal({ open, onOpenChange, item, sourceType = "TIKTOK", onSave }) {
  const [tempLink, setTempLink] = useState("");
  const [tempKeyword, setTempKeyword] = useState("");
  useEffect(() => {
    if (open && item) {
      setTempLink(item.link || "");
      setTempKeyword(item.keyword || "");
    }
  }, [open, item]);
  if (!item) return null;
  const linkList = tempLink.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  const keywordList = tempKeyword.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  const handleSave = () => {
    onSave?.({
      id: item.id,
      page_id: item.page_id,
      link: tempLink.trim(),
      keyword: tempKeyword.trim()
    });
    onOpenChange(false);
  };
  const platformLabel = sourceType === "TIKTOK" ? "TikTok" : "YouTube Shorts";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-5 space-y-4 font-normal [&_*]:!font-normal [&_*]:normal-case">
        <DialogHeader className="p-0 pb-3 border-b border-border pr-8">
          <DialogTitle className="text-xs font-normal text-foreground flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <PageLogo avatar={item.avatar} name={item.page_name} />
              <span className="font-normal truncate">Cấu Hình Nguồn Tải: {item.page_name}</span>
            </div>
            <Badge variant="outline" className="text-[10px] font-normal border-blue-200 text-blue-600 bg-blue-50/50 shrink-0 mr-1">
              {platformLabel}
            </Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 font-normal text-foreground">
                <Link2 className="w-3.5 h-3.5 text-blue-600" />
                <span>Link Video Hoặc Kênh {platformLabel}</span>
              </div>
              <div className="flex items-center gap-2">
                {linkList.length > 0 && (
                  <Badge variant="outline" className="text-[10px] font-normal font-mono border-blue-200 text-blue-600 bg-blue-50/50 px-1.5 py-0">
                    {linkList.length} Link
                  </Badge>
                )}
                {tempLink.trim() && (
                  <Button variant="ghost" size="sm" type="button" onClick={() => setTempLink("")} className="h-5 px-1.5 text-[10px] font-normal text-muted-foreground hover:text-rose-600 gap-1 shadow-none">
                    <Trash2 className="w-2.5 h-2.5" /> Xóa Trắng Link
                  </Button>
                )}
              </div>
            </div>
            <p className="text-[11px] font-normal text-muted-foreground">
              Dán Một Hoặc Nhiều Link Video Hoặc Link Kênh / Profile. Mỗi Dòng Một Link.
            </p>
            <Textarea
              value={tempLink}
              onChange={(e) => setTempLink(e.target.value)}
              placeholder={sourceType === "TIKTOK" ? "https://www.tiktok.com/@user/video/7234567890...\nhttps://www.tiktok.com/@user/video/7234567891...\nHoặc Link Kênh: https://www.tiktok.com/@username" : "https://www.youtube.com/shorts/...\nhttps://www.youtube.com/watch?v=...\nHoặc Link Kênh: https://www.youtube.com/@username"}
              className="min-h-[140px] text-xs font-normal font-mono leading-relaxed resize-y"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 font-normal text-foreground">
                <Search className="w-3.5 h-3.5 text-blue-600" />
                <span>Từ Khóa Tìm Kiếm & Lọc Video</span>
              </div>
              <div className="flex items-center gap-2">
                {keywordList.length > 0 && (
                  <Badge variant="outline" className="text-[10px] font-normal font-mono border-slate-200 text-slate-600 px-1.5 py-0">
                    {keywordList.length} Từ Khóa
                  </Badge>
                )}
                {tempKeyword.trim() && (
                  <Button variant="ghost" size="sm" type="button" onClick={() => setTempKeyword("")} className="h-5 px-1.5 text-[10px] font-normal text-muted-foreground hover:text-rose-600 gap-1 shadow-none">
                    <Trash2 className="w-2.5 h-2.5" /> Xóa Trắng Từ Khóa
                  </Button>
                )}
              </div>
            </div>
            <p className="text-[11px] font-normal text-muted-foreground">
              Dùng Để Lọc Video Kênh Hoặc Tìm Kiếm Video Mới Toàn Sàn. Phân Tách Bằng Dấu Phẩy Hoặc Xuống Dòng.
            </p>
            <Textarea
              value={tempKeyword}
              onChange={(e) => setTempKeyword(e.target.value)}
              placeholder="Xe Độ, Review Xe, Hài Hước..."
              className="min-h-[90px] text-xs font-normal leading-relaxed resize-y"
            />
          </div>
        </div>
        <DialogFooter className="p-0 pt-3 border-t border-border flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" type="button" onClick={() => onOpenChange(false)} className="h-8 text-xs font-normal shadow-none">
            Hủy Bỏ
          </Button>
          <Button variant="outline" size="sm" type="button" onClick={handleSave} className="h-8 text-xs font-normal text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700 dark:border-blue-900/60 dark:text-blue-400 dark:hover:bg-blue-950/40 gap-1.5 shadow-none">
            <Check className="w-3.5 h-3.5" /> Lưu Cấu Hình
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
