"use client";
import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export default function PostDetailModal({ open, onOpenChange, post }) {
  const [commentText, setCommentText] = useState("");
  const [comments, setComments] = useState([
    { id: "c1", name: "Thuận Nguyễn", avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop", time: "1 phút", content: "hihihihi", likes: 2 },
    { id: "c2", name: "Thuận Nguyễn", avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop", time: "1 phút", content: "Bài viết rất hay và bổ ích, cảm ơn page đã chia sẻ!", likes: 5 },
  ]);
  const handleAddComment = () => {
    if (!commentText.trim()) return;
    setComments([...comments, { id: "c_" + Date.now(), name: "Bạn (Fanpage)", avatar: "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=100&h=100&fit=crop", time: "Vừa xong", content: commentText.trim(), likes: 0 }]);
    setCommentText("");
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-5 bg-card max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-sm">B</div>
            <div>
              <h2 className="text-sm font-heading font-bold text-foreground">Chi tiết bài viết</h2>
              <p className="text-xs text-muted-foreground">{post?.page_name || "Bí Quyết Sức Khỏe"} • 10/10/2026, 2:48:20 AM</p>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto space-y-3 py-3 pr-1">
          <p className="text-xs text-foreground leading-relaxed">{post?.title || "Ăn uống đúng là cách giữ sức khỏe tốt nhất #suckhoe #kienthuc #dinhduong #BíQuyếtSứcKhỏe"}</p>
          <div className="w-full h-56 rounded-lg bg-zinc-950 flex flex-col items-center justify-center relative overflow-hidden text-white shadow-card">
            <div className="text-center p-4">
              <span className="text-red-500 text-xs font-semibold uppercase tracking-wider block mb-1">Sau 50 tuổi</span>
              <h3 className="text-xl font-bold font-heading">4 món ăn Cần tránh buổi tối</h3>
            </div>
            <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between text-[11px] text-zinc-400 bg-black/60 px-2.5 py-1 rounded">
              <span>▶ 0:08 / 13:14</span>
              <span>HD 1080p</span>
            </div>
          </div>
          <div className="flex items-center justify-between py-2 border-y border-border text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5 text-primary font-semibold">
              <span className="w-4 h-4 rounded-full bg-primary text-white flex items-center justify-center text-[10px]">👍</span>
              <span>{post?.likes || "1,801"}</span>
            </div>
            <div className="flex items-center gap-3">
              <span>{comments.length} bình luận</span>
              <span>12 lượt chia sẻ</span>
            </div>
          </div>
          <div className="space-y-3 pt-1">
            <h4 className="text-xs font-bold text-foreground">Bình luận mới nhất</h4>
            {comments.map((c) => (
              <div key={c.id} className="flex items-start gap-2.5 text-xs">
                <img src={c.avatar} alt={c.name} className="w-7 h-7 rounded-full object-cover shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="bg-muted p-2 rounded-xl inline-block max-w-[85%]">
                    <span className="font-bold text-foreground block">{c.name}</span>
                    <span className="text-muted-foreground leading-snug">{c.content}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1 ml-2">
                    <span>{c.time}</span>
                    <button type="button" className="font-semibold text-primary hover:underline">Thích</button>
                    <button type="button" className="font-semibold text-primary hover:underline">Trả lời</button>
                    <button type="button" className="font-semibold text-muted-foreground hover:underline">Gửi tin nhắn</button>
                    <button type="button" className="font-semibold text-muted-foreground hover:underline">Ẩn</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="pt-2 border-t border-border flex items-center gap-2">
          <Input placeholder="Viết bình luận dưới tên Fanpage..." value={commentText} onChange={(e) => setCommentText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAddComment()} className="text-xs h-9" />
          <Button size="sm" onClick={handleAddComment}>Gửi</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
