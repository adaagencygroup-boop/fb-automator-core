"use client";

/**
 * "Lưu làm mẫu" / "Mở mẫu đã lưu" — lưu cấu hình seeding (loại tương tác, số lượt, tỉ lệ cảm xúc, nghỉ, luồng…)
 * vào DB theo tài khoản đăng nhập để dùng lại.
 */
import React, { useState } from "react";
import { Bookmark, FolderOpen, Loader2, Trash2 } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { seedingApi } from "../../service";

export default function PostTemplateControls({ getConfig, onApply, disabled = false }) {
  const [mode, setMode] = useState(null); // null | "save" | "open"
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);

  const openList = async () => {
    if (mode === "open") return setMode(null);
    setMode("open");
    setLoading(true);
    try {
      setItems(await seedingApi.listTemplates("POST"));
    } catch (err) {
      toast.error(err?.message || "Không tải được danh sách mẫu.", "LỖI");
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await seedingApi.saveTemplate(name.trim(), getConfig(), "POST");
      toast.success(res?.created ? `Đã lưu mẫu "${res.item.name}".` : `Đã cập nhật mẫu "${res.item.name}".`, "ĐÃ LƯU MẪU");
      setName("");
      setMode(null);
    } catch (err) {
      toast.error(err?.message || "Không lưu được mẫu.", "LỖI");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (tpl) => {
    if (!window.confirm(`Xoá mẫu "${tpl.name}"?`)) return;
    try {
      await seedingApi.deleteTemplate(tpl.id);
      setItems((list) => list.filter((x) => x.id !== tpl.id));
    } catch (err) {
      toast.error(err?.message || "Không xoá được mẫu.", "LỖI");
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode(mode === "save" ? null : "save")}
          disabled={disabled}
          className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
        >
          <Bookmark className="h-3.5 w-3.5" /> Lưu làm mẫu
        </button>
        <button
          type="button"
          onClick={openList}
          disabled={disabled}
          aria-expanded={mode === "open"}
          className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
        >
          <FolderOpen className="h-3.5 w-3.5" /> Mở mẫu đã lưu
        </button>
      </div>

      {mode === "save" && (
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            maxLength={120}
            autoFocus
            aria-label="Tên mẫu"
            placeholder="Tên mẫu, vd: Seeding nông sản"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            className="h-9 min-w-0 flex-1 rounded-lg border border-gray-200 px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
          <button
            type="button"
            onClick={save}
            disabled={saving || !name.trim()}
            className="h-9 rounded-lg bg-[#2563EB] px-3 text-xs font-bold text-white disabled:bg-gray-200 disabled:text-gray-400"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Lưu"}
          </button>
        </div>
      )}

      {mode === "open" && (
        <div className="max-h-56 overflow-y-auto rounded-xl border border-gray-200 bg-white">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-4 text-xs text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang tải...
            </div>
          ) : !items.length ? (
            <div className="py-4 text-center text-xs text-gray-500">Chưa có mẫu nào.</div>
          ) : (
            items.map((tpl) => (
              <div key={tpl.id} className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 last:border-0">
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-900">{tpl.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    onApply(tpl.config || {});
                    setMode(null);
                    toast.success(`Đã áp dụng mẫu "${tpl.name}".`, "ĐÃ DÙNG MẪU");
                  }}
                  className="h-8 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100"
                >
                  Dùng
                </button>
                <button
                  type="button"
                  onClick={() => remove(tpl)}
                  aria-label={`Xoá mẫu ${tpl.name}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
