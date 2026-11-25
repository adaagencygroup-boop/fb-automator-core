"use client";

import { useEffect, useState } from "react";
import { Download, FileSpreadsheet, FileText, Hash, Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import { exportEngagements } from "../service";
import { downloadTable, downloadUidText, engagementExportTable } from "../utils/exportTable";

const FORMATS = [
  { id: "xlsx", label: "Excel (.xlsx)", desc: "Đầy đủ các cột, UID dạng chữ", Icon: FileSpreadsheet, color: "text-emerald-600" },
  { id: "csv", label: "CSV (.csv)", desc: "Phân cách dấu phẩy, nạp vào CRM", Icon: FileText, color: "text-blue-600" },
  { id: "txt", label: "Danh sách UID (.txt)", desc: "Mỗi dòng 1 UID — chạy seeding / quảng cáo", Icon: Hash, color: "text-violet-600" },
];

const TAB_TEXT = { like: "Đã Like", comment: "Bình luận" };

/**
 * Hộp thoại "Xuất toàn bộ file": định dạng + phạm vi (dòng đã chọn / tab đang xem / Like + Bình luận của bài /
 * mọi bài trong danh mục) + lọc mức quan tâm.
 */
export default function ExportModal({ open, onOpenChange, post, postKeys = [], tab = "like", search = "", tier = null,
  selectedRows = [], baseName = "Tuong_tac_bai_viet" }) {
  const [format, setFormat] = useState("xlsx");
  const [scope, setScope] = useState("tab");
  const [tierFilter, setTierFilter] = useState(tier ? String(tier) : "all");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setScope(selectedRows.length ? "selected" : "tab");
    setTierFilter(tier ? String(tier) : "all");
  }, [open, selectedRows.length, tier]);

  const scopes = [
    selectedRows.length ? { id: "selected", label: `Các dòng đã chọn (${selectedRows.length})` } : null,
    post ? { id: "tab", label: `Tab đang xem của bài này (${TAB_TEXT[tab]})` } : null,
    post ? { id: "post", label: "Toàn bộ Like + Bình luận của bài này" } : null,
    postKeys.length > 1 ? { id: "all", label: `Toàn bộ tương tác của ${postKeys.length} bài trong danh mục` } : null,
  ].filter(Boolean);

  const run = async () => {
    setBusy(true);
    try {
      const t = tierFilter === "all" ? null : Number(tierFilter);
      let rows;
      if (scope === "selected") {
        rows = selectedRows.filter((r) => !t || r.tier === t).map((r) => ({ ...r, action: r.action || tab, post_url: post?.post_url }));
      } else {
        const keys = scope === "all" ? postKeys : [post.post_key];
        const res = await exportEngagements({
          postKeys: keys,
          scope: scope === "tab" ? "tab" : "all",
          tab,
          search: scope === "tab" ? search : "",
          tier: t,
        });
        rows = res?.rows || [];
      }
      if (!rows.length) {
        toast.warning("Không có dữ liệu tương tác nào để xuất với lựa chọn này.");
        return;
      }
      const name = scope === "all" ? `${baseName}_${postKeys.length}_bai` : `${baseName}_${post?.post_key || ""}`;
      if (format === "txt") {
        downloadUidText(name, rows.map((r) => r.uid));
      } else {
        const table = engagementExportTable(rows);
        await downloadTable({ format, baseName: name, sheetName: "Tuong tac", ...table });
      }
      toast.success(`Xuất dữ liệu thành công! ${rows.length.toLocaleString("vi-VN")} dòng — tệp đã được lưu về máy.`);
      onOpenChange(false);
    } catch (err) {
      const msg = String(err?.message || "");
      toast.error(/EBUSY|EPERM|permission|locked/i.test(msg)
        ? "Không thể ghi đè file: tệp đang được mở trong Excel. Vui lòng đóng tệp hoặc đổi tên tệp khác."
        : msg || "Xuất file thất bại.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 rounded-2xl p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <DialogTitle className="text-base font-bold text-slate-900">Xuất dữ liệu tương tác</DialogTitle>
          <button type="button" onClick={() => onOpenChange(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-5 px-6 py-5">
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Định dạng</p>
            <div className="grid gap-2">
              {FORMATS.map(({ id, label, desc, Icon, color }) => (
                <label key={id} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                  format === id ? "border-[#2563EB] bg-[#EFF6FF]" : "border-slate-200 hover:bg-slate-50"}`}>
                  <input type="radio" className="accent-[#2563EB]" checked={format === id} onChange={() => setFormat(id)} />
                  <Icon className={`size-4 ${color}`} />
                  <span className="text-sm font-semibold text-slate-800">{label}</span>
                  <span className="ml-auto text-[11px] text-slate-400">{desc}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Phạm vi</p>
            <div className="grid gap-1.5">
              {scopes.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
                  <input type="radio" className="accent-[#2563EB]" checked={scope === s.id} onChange={() => setScope(s.id)} />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Mức quan tâm</p>
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none focus:border-[#2563EB]"
            >
              <option value="all">Tất cả mức</option>
              <option value="1">Chỉ Mức 1 (Cao)</option>
              <option value="2">Chỉ Mức 2 (Cơ bản)</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={() => onOpenChange(false)}
            className="h-9 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            Hủy
          </button>
          <button type="button" onClick={run} disabled={busy || !scopes.length}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#2563EB] px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Tải xuống
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
