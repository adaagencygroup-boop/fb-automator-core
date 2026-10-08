"use client";

import { useState, useEffect } from "react";
import { getDashboardStats } from "./service";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function DashboardModule() {
  const [stats, setStats] = useState({
    accounts: { total: 0, live: 0, die: 0 },
    pages_total: 0,
    posts_today: 0,
    proxies_active: 0,
    recent_activity: [],
  });
  const [loading, setLoading] = useState(false);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const data = await getDashboardStats();
      setStats(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  return (
    <div className="space-y-6">
      {/* 4 Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-sky-500">
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-xs font-bold uppercase text-slate-400">
              Tổng Tài Khoản
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-3xl font-black text-sky-400">{stats.accounts?.total || 0}</div>
            <p className="text-[11px] text-slate-500 mt-1">
              Live: {stats.accounts?.live || 0} | Die: {stats.accounts?.die || 0}
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-cyan-500">
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-xs font-bold uppercase text-slate-400">
              Fanpage Hoạt Động
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-3xl font-black text-cyan-400">{stats.pages_total || 0}</div>
            <p className="text-[11px] text-slate-500 mt-1">Sẵn sàng tự động đăng</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-500">
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-xs font-bold uppercase text-slate-400">
              Bài Đăng Hôm Nay
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-3xl font-black text-emerald-400">{stats.posts_today || 0}</div>
            <p className="text-[11px] text-slate-500 mt-1">Reels &amp; Video &amp; AI</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-amber-500">
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-xs font-bold uppercase text-slate-400">
              Proxy Hoạt Động
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-3xl font-black text-amber-400">{stats.proxies_active || 0}</div>
            <p className="text-[11px] text-slate-500 mt-1">Đã kiểm tra sức khỏe</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between p-5">
          <CardTitle>📊 Lịch Sử Đăng Bài Gần Nhất</CardTitle>
          <Button onClick={fetchStats} disabled={loading} size="sm" variant="outline">
            {loading ? "Đang tải..." : "🔄 Làm mới"}
          </Button>
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3">Thời Gian</th>
                  <th className="py-2.5 px-3">Mục Tiêu</th>
                  <th className="py-2.5 px-3">Hình Thức</th>
                  <th className="py-2.5 px-3">Trạng Thái</th>
                  <th className="py-2.5 px-3">Post ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {stats.recent_activity?.length > 0 ? (
                  stats.recent_activity.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-3 text-slate-400">{r.posted_at}</td>
                      <td className="py-2.5 px-3 font-semibold text-slate-200">
                        {r.target_name || r.target_id}
                      </td>
                      <td className="py-2.5 px-3 text-sky-400">{r.post_type}</td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                          {r.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-400 font-mono">{r.fb_post_id || "-"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-500">
                      Chưa có bài đăng nào hôm nay.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
