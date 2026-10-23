"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { facebook_picture_url } from "./picture";

const LOGIN = {
  logged_in: { label: "Đã đăng nhập", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  not_logged_in: { label: "Chưa đăng nhập", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  failed: { label: "Đăng nhập lỗi", cls: "bg-rose-50 text-rose-700 border-rose-200" },
};

function initials(name = "") {
  return (
    String(name)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(-2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "FB"
  );
}

/** Nick đã đăng nhập Module 2. Die thì không cho chọn. */
export function isScanReady(account) {
  const status = String(account.status || "").toLowerCase();
  const login = String(account.login_status || "").toLowerCase();
  if (status === "die") return false;
  return login === "logged_in" || login === "success";
}

export default function AccountSelectModal({
  open,
  onOpenChange,
  accounts = [],
  loading = false,
  selectedUids = [],
  onConfirm,
  onRefresh,
}) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState(() => new Set(selectedUids));

  useEffect(() => {
    if (open) setDraft(new Set(selectedUids));
  }, [open, selectedUids]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((acc) =>
      `${acc.profile_name || ""} ${acc.uid || ""} ${acc.email || ""}`.toLowerCase().includes(q),
    );
  }, [accounts, query]);

  const readyRows = filtered.filter(isScanReady);
  const allReadyChecked = readyRows.length > 0 && readyRows.every((acc) => draft.has(acc.uid));

  const toggle = (uid, checked, ready) => {
    if (!ready) return;
    setDraft((current) => {
      const next = new Set(current);
      if (checked) next.add(uid);
      else next.delete(uid);
      return next;
    });
  };

  const toggleAllReady = (checked) => {
    setDraft((current) => {
      const next = new Set(current);
      readyRows.forEach((acc) => {
        if (checked) next.add(acc.uid);
        else next.delete(acc.uid);
      });
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-slate-100 px-5 py-4">
          <DialogTitle className="text-base font-bold text-slate-900">
            Chọn tài khoản quét nhóm
          </DialogTitle>
          <p className="text-xs text-slate-500">
            Lấy từ Module 2. Chỉ nick đã đăng nhập (không Die) mới dùng để quét.
          </p>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm UID, tên, email..."
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none focus:border-blue-500"
            />
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            Đồng bộ
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {loading && accounts.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
              <Loader2 className="size-4 animate-spin" /> Đang tải tài khoản Module 2...
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-16 text-center text-sm text-slate-400">
              Không có tài khoản khớp. Vào Quản lý tài khoản Facebook để thêm hoặc đăng nhập nick.
            </p>
          ) : (
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="sticky top-0 bg-white text-[11px] font-bold uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="w-10 py-2">
                    <Checkbox
                      checked={allReadyChecked}
                      onCheckedChange={(value) => toggleAllReady(Boolean(value))}
                      disabled={!readyRows.length}
                    />
                  </th>
                  <th className="py-2">Tài khoản</th>
                  <th className="w-28 py-2">Trạng thái</th>
                  <th className="w-36 py-2">Phiên đăng nhập</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((acc) => {
                  const ready = isScanReady(acc);
                  const login = LOGIN[acc.login_status] || LOGIN.not_logged_in;
                  const checked = draft.has(acc.uid);
                  return (
                    <tr
                      key={acc.uid}
                      className={`border-b border-slate-50 ${ready ? "hover:bg-slate-50" : "opacity-55"}`}
                    >
                      <td className="py-2.5">
                        <Checkbox
                          checked={checked}
                          disabled={!ready}
                          onCheckedChange={(value) => toggle(acc.uid, Boolean(value), ready)}
                        />
                      </td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar className="size-8">
                            <AvatarImage src={facebook_picture_url(acc.uid)} alt="" />
                            <AvatarFallback className="bg-blue-50 text-[10px] font-bold text-blue-700">
                              {initials(acc.profile_name || acc.uid)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-800">
                              {acc.profile_name || "Chưa có tên"}
                            </p>
                            <p className="truncate text-[11px] text-slate-400">UID: {acc.uid}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            String(acc.status).toLowerCase() === "live"
                              ? "bg-emerald-50 text-emerald-700"
                              : String(acc.status).toLowerCase() === "die"
                                ? "bg-rose-50 text-rose-700"
                                : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {String(acc.status || "unknown").toUpperCase()}
                        </span>
                      </td>
                      <td className="py-2.5">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${login.cls}`}>
                          {login.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <DialogFooter className="gap-2 border-t border-slate-100 px-5 py-3 sm:justify-between">
          <p className="text-xs text-slate-500">
            Đã chọn <strong className="text-slate-800">{draft.size}</strong> tài khoản sẵn sàng
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-9 rounded-lg border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={() => {
                onConfirm([...draft]);
                onOpenChange(false);
              }}
              className="h-9 rounded-lg bg-[#2563EB] px-4 text-xs font-bold text-white hover:bg-blue-600"
            >
              Xác nhận
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
