"use client";

import { useState } from "react";
import { createBulkPages } from "./service";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function PageCreatorModule() {
  const [namesText, setNamesText] = useState("");
  const [category, setCategory] = useState("COMMUNITY");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!namesText.trim()) return alert("Vui lòng nhập tên Page!");
    setIsCreating(true);
    try {
      const names = namesText.split("\n").filter((n) => n.trim());
      await createBulkPages({ page_names: names, category });
      alert(`Đã gửi yêu cầu tạo ${names.length} Fanpage!`);
      setNamesText("");
    } catch (e) {
      alert("Lỗi: " + e.message);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between p-5 pb-3">
          <CardTitle className="text-amber-400">⚡ Tạo Fanpage Hàng Loạt</CardTitle>
          <Button onClick={handleCreate} disabled={isCreating} size="sm" variant="default">
            {isCreating ? "Đang tạo..." : "🚀 Bắt Đầu Tạo Page"}
          </Button>
        </CardHeader>
        <CardContent className="p-5 pt-0 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400">Danh mục (Category):</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full md:w-64 bg-slate-950 border border-slate-800 rounded p-2 text-xs text-slate-200"
            >
              <option value="COMMUNITY">Cộng Đồng (Community)</option>
              <option value="BLOGGER">Blogger Cá Nhân</option>
              <option value="MEDIA_NEWS">Tin Tức / Truyền Thông</option>
              <option value="ENTERTAINMENT">Giải Trí</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-slate-400">
              Danh sách tên Fanpage (Mỗi dòng 1 tên):
            </label>
            <textarea
              rows={4}
              value={namesText}
              onChange={(e) => setNamesText(e.target.value)}
              placeholder="Góc Thư Giãn Mỗi Ngày&#10;Bóng Đá 24h Pro&#10;Tin Nóng Showbiz Hôm Nay"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-200 focus:outline-none focus:border-amber-400 font-mono"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
