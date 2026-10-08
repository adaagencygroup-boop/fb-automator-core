"use client";

import { useState, useEffect } from "react";
import { getAccounts, importAccounts } from "./service";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function AccountManagerModule() {
  const [accounts, setAccounts] = useState([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchAccounts = async () => {
    setLoading(true);
    try {
      const data = await getAccounts();
      setAccounts(data.accounts || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const handleImport = async () => {
    if (!inputText.trim()) return alert("Vui lòng nhập tài khoản!");
    try {
      const res = await importAccounts(inputText);
      if (res.success) {
        alert(`Đã nhập thành công ${res.imported_count} tài khoản!`);
        setInputText("");
        fetchAccounts();
      }
    } catch (e) {
      alert("Lỗi nhập: " + e.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Import Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between p-5 pb-3">
          <CardTitle className="text-sky-400">➕ Nhập Tài Khoản Facebook</CardTitle>
          <Button onClick={handleImport} size="sm" variant="primary">
            Xác Nhận Nhập
          </Button>
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <textarea
            rows={3}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="UID|Pass|2FA|Cookie|Token|Mail|MailPass|Proxy (Mỗi tài khoản 1 dòng)"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-200 focus:outline-none focus:border-sky-400 font-mono"
          />
        </CardContent>
      </Card>

      {/* Account Table Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between p-5 pb-3">
          <CardTitle>📋 Danh Sách Tài Khoản ({accounts.length})</CardTitle>
          <Button onClick={fetchAccounts} disabled={loading} size="sm" variant="outline">
            {loading ? "Đang tải..." : "🔄 Cập nhật"}
          </Button>
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-950 text-slate-400">
                <tr className="border-b border-slate-800">
                  <th className="py-2.5 px-3">UID</th>
                  <th className="py-2.5 px-3">Trạng Thái</th>
                  <th className="py-2.5 px-3">Proxy</th>
                  <th className="py-2.5 px-3">2FA</th>
                  <th className="py-2.5 px-3">Ghi Chú</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {accounts.map((acc, i) => (
                  <tr key={i} className="hover:bg-slate-800/30">
                    <td className="py-2 px-3 font-mono font-bold text-slate-200">{acc.uid}</td>
                    <td className="py-2 px-3">
                      <Badge
                        variant={
                          acc.status === "LIVE"
                            ? "success"
                            : acc.status === "DIE"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {acc.status}
                      </Badge>
                    </td>
                    <td className="py-2 px-3 text-slate-400">{acc.proxy || "Mặc định"}</td>
                    <td className="py-2 px-3">{acc.fa2 ? "✅" : "❌"}</td>
                    <td className="py-2 px-3 text-slate-400">{acc.notes || acc.tags || "-"}</td>
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
