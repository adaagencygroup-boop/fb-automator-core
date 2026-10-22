"use client";

import AiCredentialsSection from "./AiCredentialsSection";
import { useState } from "react";
import { Check, Copy, Eye, EyeOff, ExternalLink, Headset, Monitor, Phone, RefreshCw, Save, Send, UserRound } from "lucide-react";
import { useSession } from "@/components/SessionContext";
import api from "@/services/api";
import { SUPPORT } from "@/config/support";
import { getLicenseState } from "@/modules/module_01_dashboard/licenseState.mjs";
import RenewalContactDialog from "@/modules/module_01_dashboard/RenewalContactDialog";

export default function UserProfileModule() {
  const session = useSession();
  const [freshUser, setFreshUser] = useState(null);
  const user = freshUser?.id === session?.user.id ? freshUser : session?.user;
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [visible, setVisible] = useState({});
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState(null);
  const [copied, setCopied] = useState("");
  const [renewalOpen, setRenewalOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  if (!user) return null;
  const license = getLicenseState(user, now);
  const active = ["active", "warning"].includes(license.tone);
  const status = active ? "Đang hoạt động" : license.tone === "expired" ? "Đã hết hạn" : "Chưa kích hoạt";
  const expiry = user.expired_at ? new Date(user.expired_at) : null;
  const created = user.created_at ? new Date(user.created_at) : null;
  const usedDays = created && Number.isFinite(created.getTime()) ? Math.max(0, Math.floor((now - created.getTime()) / 86400000)) : null;
  const totalDays = expiry && created ? Math.ceil((expiry.getTime() - created.getTime()) / 86400000) : 0;
  const usedPercent = totalDays > 0 && usedDays !== null ? Math.min(100, Math.max(0, usedDays / totalDays * 100)) : 0;

  async function copy(value, field) {
    try { await navigator.clipboard.writeText(value); setCopied(field); }
    catch { setNotice({ error: true, text: "Không thể sao chép. Vui lòng sao chép thủ công." }); }
  }
  async function syncProfile() {
    setSyncing(true);
    try { setFreshUser(await api.get("/api/v1/auth/me")); setNow(Date.now()); setNotice({ text: "Đã đồng bộ thông tin tài khoản." }); }
    catch (error) { setNotice({ error: true, text: error.message }); }
    finally { setSyncing(false); }
  }
  async function savePassword(event) {
    event.preventDefault();
    if (passwords.next !== passwords.confirm) { setNotice({ error: true, text: "Mật khẩu xác nhận không khớp." }); return; }
    setBusy(true); setNotice(null);
    try {
      await api.post("/api/v1/auth/change-password", { old_password: passwords.current, new_password: passwords.next });
      setPasswords({ current: "", next: "", confirm: "" });
      window.alert("Đã đổi mật khẩu thành công. Vui lòng đăng nhập lại.");
      await session.logout();
    } catch (error) { setNotice({ error: true, text: error.message }); }
    finally { setBusy(false); }
  }
  return <div className="mx-auto max-w-6xl space-y-5 text-slate-900">
    <div className="flex justify-end"><button type="button" onClick={syncProfile} disabled={syncing || busy} className="inline-flex items-center gap-2 rounded-lg border border-[#dce4f3] bg-white px-3 py-2 text-xs font-medium disabled:opacity-50"><RefreshCw size={14} className={syncing ? "animate-spin" : ""} />{syncing ? "Đang đồng bộ..." : "Đồng bộ"}</button></div>
    {notice && <p role={notice.error ? "alert" : "status"} className={`rounded-lg p-3 text-sm ${notice.error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{notice.text}</p>}
    <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
      <Section title="1. Thông tin tài khoản">
        <div className="grid gap-4 sm:grid-cols-2">
          {[{ label: "Tên đăng nhập", value: user.username, icon: UserRound, field: "username" }, { label: "Thông tin liên hệ chính", value: user.contact_info, icon: Phone, field: "contact" }].map(({ label, value, icon: Icon, field }) => <div key={field} className="rounded-xl border border-[#e6ecf7] bg-slate-50 p-4"><p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p><div className="flex items-center gap-2 text-sm"><Icon size={14} className="shrink-0 text-slate-400" /><span className="min-w-0 break-all">{value || "Chưa cập nhật"}</span>{value && <button type="button" aria-label={`Sao chép ${label.toLowerCase()}`} onClick={() => copy(value, field)} className="ml-auto shrink-0 text-slate-400 hover:text-blue-600">{copied === field ? <Check size={14} /> : <Copy size={14} />}</button>}</div></div>)}
          <div className="flex items-center justify-between gap-2 rounded-xl border border-[#e6ecf7] bg-slate-50 p-4"><span className="text-[10px] uppercase tracking-wide text-slate-400">Vai trò hệ thống</span><span className="rounded bg-slate-200 px-2 py-1 text-[10px] font-semibold">{String(user.role || "user").toUpperCase()}</span></div>
          <div className="flex items-center justify-between gap-2 rounded-xl border border-[#e6ecf7] bg-slate-50 p-4"><span className="text-[10px] uppercase tracking-wide text-slate-400">Trạng thái</span><span className={`rounded px-2 py-1 text-[10px] font-semibold ${active ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-700"}`}>● {status}</span></div>
        </div>
        <p className="mt-5 flex items-center gap-2 border-t border-slate-100 pt-4 text-xs text-slate-400"><Monitor size={14} className="shrink-0" /><span className="break-all">Mã máy trạm: {user.hwid || "Chưa liên kết"}</span></p>
      </Section>
      <Section title="2. Bảo mật">
        <form onSubmit={savePassword} className="space-y-3">
          {[{ field: "current", label: "Mật khẩu hiện tại", auto: "current-password" }, { field: "next", label: "Mật khẩu mới", auto: "new-password" }, { field: "confirm", label: "Xác nhận mật khẩu mới", auto: "new-password" }].map(({ field, label, auto }) => <div key={field}><label htmlFor={`password-${field}`} className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide">{label}</label><div className="relative"><input id={`password-${field}`} type={visible[field] ? "text" : "password"} autoComplete={auto} value={passwords[field]} onChange={(event) => setPasswords({ ...passwords, [field]: event.target.value })} placeholder={`Nhập ${label.toLowerCase()}`} required disabled={busy} className="w-full rounded-lg border border-[#dce4f3] bg-[#f8faff] px-3 py-2.5 pr-10 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 placeholder:text-slate-400" /><button type="button" aria-label={`${visible[field] ? "Ẩn" : "Hiện"} ${label.toLowerCase()}`} aria-pressed={Boolean(visible[field])} onClick={() => setVisible({ ...visible, [field]: !visible[field] })} className="absolute inset-y-0 right-3 text-slate-400">{visible[field] ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></div>)}
          <div className="flex justify-end gap-3 pt-2"><button type="button" disabled={busy} onClick={() => { setPasswords({ current: "", next: "", confirm: "" }); setVisible({}); setNotice(null); }} className="px-3 py-2 text-xs text-slate-500">Hủy</button><button disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"><Save size={14} />{busy ? "Đang lưu..." : "Lưu mật khẩu mới"}</button></div>
        </form>
      </Section>
    </div>
    <Section title="3. Bản quyền & Gói cước">
      <div className="rounded-xl border border-blue-100 bg-[#f7f9ff] p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-wide text-blue-600">Ngày hết hạn bản quyền</p><p className="mt-1 text-3xl font-bold tracking-tight">{expiry && Number.isFinite(expiry.getTime()) ? expiry.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "Chưa thiết lập"}</p><p className={`mt-1 text-xs ${active ? "text-emerald-600" : "text-amber-700"}`}>● {license.tone === "expired" ? "Bản quyền đã hết hạn" : license.days !== null ? `Thời hạn còn lại: ${license.days} ngày` : "Chưa có thời hạn bản quyền"}</p></div><button type="button" onClick={() => setRenewalOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-blue-500 bg-white px-3 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-50"><RefreshCw size={14} />Gia hạn gói</button></div><div className="mt-4 border-t border-slate-100 pt-3"><p className="mb-2 text-xs text-slate-400">{usedDays !== null ? `Đã sử dụng: ${usedDays} ngày` : "Chưa có dữ liệu thời gian sử dụng"}</p><div role="progressbar" aria-label="Thời gian bản quyền đã sử dụng" aria-valuenow={Math.round(usedPercent)} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-600" style={{ width: `${usedPercent}%` }} /></div></div></div>
    </Section>
    <AiCredentialsSection />
    <Section title="5. Hỗ trợ kỹ thuật"><div className="grid gap-4 sm:grid-cols-2"><SupportCard href={SUPPORT.telegram.url} icon={Send} label="Kênh hỗ trợ nhanh" title="Telegram CSKH" detail={SUPPORT.telegram.display} /><SupportCard href={SUPPORT.zalo.url} icon={Headset} label="Đường dây nóng kỹ thuật" title="Hỗ trợ kỹ thuật / Zalo" detail={SUPPORT.zalo.display} green /></div></Section>
    {renewalOpen && <RenewalContactDialog onClose={() => setRenewalOpen(false)} />}
  </div>;
}
function Section({ title, children }) {
  return <section className="rounded-xl border border-[#e2e8f5] bg-white p-5 shadow-sm"><h3 className="mb-4 border-b border-slate-100 pb-3 text-sm font-semibold">{title}</h3>{children}</section>;
}
function SupportCard({ href, icon: Icon, label, title, detail, green }) {
  return <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-[#e6ecf7] bg-[#fafbff] p-4 hover:border-blue-300"><span className={`rounded-xl p-3 ${green ? "bg-emerald-100 text-emerald-600" : "bg-blue-100 text-blue-600"}`}><Icon size={20} /></span><span className="min-w-0"><span className="block text-[10px] uppercase tracking-wide text-slate-400">{label}</span><strong className="mt-1 block text-sm font-semibold">{title}</strong><span className={`block break-all text-xs ${green ? "text-emerald-600" : "text-blue-600"}`}>{detail}</span></span><ExternalLink size={15} className="ml-auto shrink-0 text-slate-400" /></a>;
}
