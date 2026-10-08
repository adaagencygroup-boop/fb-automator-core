"use client";

import { useState, useEffect } from "react";
import { getPages, fetchPageTokens } from "./service";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function PageManagerModule() {
  const [pages, setPages] = useState([]);
  const [userToken, setUserToken] = useState("");
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await getPages();
      setPages(data.pages || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleFetchTokens = async () => {
    if (!userToken.trim()) return alert("Vui lòng nhập User Token!");
    try {
      const res = await fetchPageTokens(userToken);
      if (res.success) {
        alert(`Đã nạp thành công ${res.count} Fanpage vào hệ thống!`);
        setUserToken("");
        loadData();
      }
    } catch (e) {
      alert("Lỗi: " + e.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Fetch Token Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between p-5 pb-3">
          <CardTitle className="text-cyan-400">🔑 Nạp Page Từ User Access Token</CardTitle>
          <Button onClick={handleFetchTokens} size="sm" variant="default">
            Lấy Token Vĩnh Viễn
          </Button>
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <input
            type="text"
            value={userToken}
            onChange={(e) => setUserToken(e.target.value)}
            placeholder="Dán User Access Token (me/accounts) vào đây..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-400 font-mono"
          />
        </CardContent>
      </Card>

      {/* Pages Table Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between p-5 pb-3">
          <CardTitle>📢 Danh Sách Fanpage Đang Quản Lý ({pages.length})</CardTitle>
          <Button onClick={loadData} disabled={loading} size="sm" variant="outline">
            {loading ? "Đang tải..." : "🔄 Cập nhật"}
          </Button>
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-950 text-slate-400">
                <tr className="border-b border-slate-800">
                  <th className="py-2.5 px-3">Page ID</th>
                  <th className="py-2.5 px-3">Tên Fanpage</th>
                  <th className="py-2.5 px-3">AI Post</th>
                  <th className="py-2.5 px-3">Reels Folder</th>
                  <th className="py-2.5 px-3">Trạng Thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {pages.map((p, i) => (
                  <tr key={i} className="hover:bg-slate-800/30">
                    <td className="py-2 px-3 font-mono text-slate-400">{p.page_id}</td>
                    <td className="py-2 px-3 font-bold text-slate-200">{p.page_name}</td>
                    <td className="py-2 px-3 text-sky-400 font-semibold">
                      {p.auto_ai_enabled ? "Bật" : "Tắt"}
                    </td>
                    <td className="py-2 px-3 text-slate-400">
                      {p.reels_folder || "Chưa gán"}
                    </td>
                    <td className="py-2 px-3">
                      <Badge variant="success">{p.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
