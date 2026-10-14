"use client";

import { useState, useEffect } from "react";
import FanpageList from "./FanpageList";
import { getPages, fetchPageTokens } from "./service";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";

export default function PageManagerModule({ subPage } = {}) {
  if (subPage === "pages.list") {
    return <FanpageList />;
  }
  return <TokenManager />;
}

function TokenManager() {
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
          <CardTitle className="text-primary flex items-center gap-2">
            <span>🔑</span> Nạp Page Từ User Access Token
          </CardTitle>
          <Button onClick={handleFetchTokens} size="sm">
            Lấy Token Vĩnh Viễn
          </Button>
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <Input
            type="text"
            value={userToken}
            onChange={(e) => setUserToken(e.target.value)}
            placeholder="Dán User Access Token (me/accounts) vào đây..."
            className="font-mono text-xs"
          />
        </CardContent>
      </Card>

      {/* Pages Table Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between p-5 pb-3">
          <CardTitle className="flex items-center gap-2">
            <span>📢</span> Danh Sách Fanpage Đang Quản Lý ({pages.length})
          </CardTitle>
          <Button onClick={loadData} disabled={loading} size="sm" variant="outline">
            {loading ? "Đang tải..." : "🔄 Cập nhật"}
          </Button>
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Page ID</TableHead>
                  <TableHead>Tên Fanpage</TableHead>
                  <TableHead>AI Auto Post</TableHead>
                  <TableHead>Reels Folder</TableHead>
                  <TableHead className="text-right">Trạng Thái</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pages.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      Chưa có Fanpage nào được nạp. Hãy dán User Token ở trên để đồng bộ.
                    </TableCell>
                  </TableRow>
                ) : (
                  pages.map((p, i) => (
                    <TableRow key={p.id || i}>
                      <TableCell className="font-mono text-muted-foreground">{p.page_id}</TableCell>
                      <TableCell className="font-bold text-foreground">{p.page_name}</TableCell>
                      <TableCell>
                        <span className={p.auto_ai_enabled ? "text-primary font-semibold" : "text-muted-foreground"}>
                          {p.auto_ai_enabled ? "● Đang bật" : "○ Tắt"}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {p.reels_folder || "Chưa gán"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={p.status === "ACTIVE" ? "success" : "destructive"}>
                          {p.status || "ACTIVE"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
