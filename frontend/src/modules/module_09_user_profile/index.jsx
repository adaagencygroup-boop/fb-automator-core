"use client";

import { useState, useEffect } from "react";
import { getProxies, getKeys } from "./service";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export default function UserProfileModule() {
  const [proxies, setProxies] = useState([]);
  const [keys, setKeys] = useState([]);

  useEffect(() => {
    getProxies().then((d) => setProxies(d.proxies || [])).catch(() => {});
    getKeys().then((d) => setKeys(d.keys || [])).catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="p-5 pb-3">
          <CardTitle>⚙️ Cài Đặt Hệ Thống &amp; Quản Lý Tài Nguyên</CardTitle>
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-950 border border-slate-800 p-4 rounded-lg space-y-1">
              <div className="text-xs font-bold text-sky-400">🌐 Proxy Pool ({proxies.length})</div>
              <p className="text-[11px] text-slate-500">Quản lý proxy dùng chung toàn hệ thống.</p>
            </div>

            <div className="bg-slate-950 border border-slate-800 p-4 rounded-lg space-y-1">
              <div className="text-xs font-bold text-purple-400">🔑 Gemini API Keys ({keys.length})</div>
              <p className="text-[11px] text-slate-500">Xoay tua tự động khi dính 429 quota limit.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
