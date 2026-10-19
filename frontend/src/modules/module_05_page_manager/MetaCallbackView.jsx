"use client";

import { ArrowLeft, ArrowRight, ArrowUpRight, Check, CheckCircle2, CircleAlert, Globe, Layers, Loader2, LockKeyhole, RefreshCw, ShieldCheck, UserRound, X } from "lucide-react";

const primary = "flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1877F2] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-wait disabled:opacity-60";
const secondary = "flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50";

export default function MetaCallbackView({ phase, message, identity, previousIdentity, errorCode, actionBusy, actionError, canClose, count, onAccept, onDecline, onContinue, onRetry, onClose }) {
  const failed = phase === "error";
  const cancelled = phase === "cancelled";
  const success = phase === "success";
  const switching = phase === "switch";
  const confirming = phase === "confirmation";
  const profile = phase === "profile";
  const sameIdentity = failed && errorCode === "SAME_FACEBOOK_IDENTITY";
  const loading = ["processing", "syncing", "profile"].includes(phase);
  const title = sameIdentity ? "Facebook vẫn là tài khoản cũ" : failed ? "Chưa thể hoàn tất kết nối" : cancelled ? "Đã hủy kết nối" : success ? "Kết nối thành công" : switching ? "Kết nối một Facebook khác" : confirming ? "Xác nhận tài khoản của bạn" : profile ? "Đang kết nối qua Chrome Profile" : phase === "syncing" ? "Đang đồng bộ Page" : "Đang xác thực Facebook";
  const step = success ? 3 : phase === "syncing" || profile ? 2 : confirming ? 1 : 0;
  const StatusIcon = success ? CheckCircle2 : failed || cancelled ? CircleAlert : switching ? RefreshCw : confirming ? UserRound : Loader2;
  const tone = success ? "bg-emerald-50 text-emerald-600 ring-emerald-100" : failed || cancelled ? "bg-amber-50 text-amber-600 ring-amber-100" : "bg-blue-50 text-blue-600 ring-blue-100";
  const person = identity || (switching || sameIdentity ? previousIdentity : null);

  return <main className="relative flex min-h-dvh flex-col items-center overflow-x-hidden bg-[#f6f8fc] px-4 py-6 text-slate-900 sm:px-6 sm:py-9">
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-blue-100/60 to-transparent" />
    <div className="relative w-full max-w-[520px]">
      <header className="mb-7 flex items-center justify-between gap-3">
        <a href="/pages/list" className="flex items-center gap-2.5 text-sm font-bold tracking-tight"><span className="flex size-9 items-center justify-center rounded-xl bg-[#1877F2] text-white shadow-sm"><Layers className="size-5" /></span>Facebook Automator</a>
        <span className="flex items-center gap-1.5 rounded-full border border-white bg-white/80 px-2.5 py-1.5 text-[11px] font-medium text-slate-500"><LockKeyhole className="size-3" />Kết nối Meta</span>
      </header>

      <article className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_16px_60px_-24px_rgba(15,23,42,0.22)]">
        <div className="px-6 pb-6 pt-8 sm:px-8">
          <div className={`mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl ring-4 ${tone}`}><StatusIcon aria-hidden="true" className={`size-8 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} /></div>
          <p className="text-center text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Quản lý kết nối Facebook</p>
          <h1 className="mt-2 text-center text-[23px] font-bold leading-tight tracking-tight sm:text-2xl">{title}</h1>
          <p role="status" aria-live="polite" className="mt-3 text-center text-sm leading-6 text-slate-500">{message}</p>

          {!failed && !cancelled && !switching && <ol aria-label="Tiến trình kết nối" className="mt-7 flex items-start">
            {["Cấp quyền", "Xác nhận", "Đồng bộ Page"].map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} className="relative flex flex-1 flex-col items-center gap-2">
              {index < 2 && <span aria-hidden="true" className={`absolute left-1/2 top-3 h-px w-full ${step > index ? "bg-blue-400" : "bg-slate-200"}`} />}
              <span className={`relative z-10 flex size-6 items-center justify-center rounded-full text-[10px] font-semibold ${step > index ? "bg-blue-600 text-white" : step === index ? "bg-blue-50 text-blue-600 ring-2 ring-blue-100" : "bg-slate-100 text-slate-400"}`}>{step > index ? <Check className="size-3.5" /> : index + 1}</span>
              <span className={`text-[10px] font-medium sm:text-xs ${step >= index ? "text-slate-700" : "text-slate-400"}`}>{label}</span>
            </li>)}
          </ol>}

          {person && <section aria-label="Xác nhận tài khoản Facebook" className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{switching || sameIdentity ? "Kết nối đang được giữ lại" : "Tài khoản Facebook"}</p>
            <div className="flex items-center gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-lg font-bold text-blue-600">{person.name?.trim().slice(0, 1).toUpperCase() || <UserRound className="size-5" />}</span><div className="min-w-0"><p className="break-words text-sm font-semibold">{person.name}</p><p className="mt-1 break-all text-[11px] text-slate-400">App-scoped ID: {person.id}</p></div><ShieldCheck aria-hidden="true" className="ml-auto size-5 shrink-0 text-blue-500" /></div>
          </section>}

          {(switching || sameIdentity) && <div className="mt-5 space-y-3 rounded-2xl border border-amber-100 bg-amber-50/60 p-4 text-xs leading-5 text-slate-600">
            <p className="font-semibold text-slate-800">Đổi Facebook trước, sau đó tiếp tục</p>
            <p>Mở Facebook ở tab bên cạnh và chuyển sang tài khoản bạn muốn dùng. Nếu không có lựa chọn đổi tài khoản, hãy đăng xuất rồi đăng nhập Facebook khác tại tab đó.</p>
            <p>Quay lại cửa sổ này để cấp quyền. Kết nối và Page cũ chỉ thay đổi khi tài khoản mới được xác nhận và đồng bộ thành công.</p>
            <a href="https://www.facebook.com/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-blue-600 hover:underline">Mở Facebook để đổi tài khoản<ArrowUpRight className="size-3.5" /></a>
          </div>}

          {success && Number.isInteger(count) && <div className="mt-6 flex items-center justify-between rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3"><span className="flex items-center gap-2 text-sm font-medium text-emerald-800"><Layers className="size-4" />Page đã đồng bộ</span><span className="text-xl font-bold text-emerald-700">{count}</span></div>}
          {confirming && <p className="mt-4 text-xs leading-5 text-slate-500">Đúng tài khoản của bạn? Chấp nhận để lưu kết nối và tự động đồng bộ Page. Bạn không cần thao tác thêm trên màn Page.</p>}
          {actionError && <p role="alert" className="mt-4 rounded-xl border border-red-100 bg-red-50 p-3 text-xs leading-5 text-red-700">{actionError}</p>}

          <div className="mt-6 space-y-2.5">
            {switching && <><button type="button" disabled={actionBusy} onClick={onContinue} className={primary}>Tôi đã đổi Facebook — tiếp tục<ArrowRight className="size-4" /></button><button type="button" disabled={actionBusy} onClick={onDecline} className={secondary}>Hủy đổi tài khoản</button></>}
            {confirming && <><button type="button" disabled={actionBusy} onClick={onAccept} className={primary}>{actionBusy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}{actionBusy ? "Đang xử lý…" : "Chấp nhận đăng nhập"}</button><button type="button" disabled={actionBusy} onClick={onDecline} className={secondary}>Hủy</button></>}
            {failed && onRetry && <button type="button" disabled={actionBusy} onClick={onRetry} className={primary}>{actionBusy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{sameIdentity ? "Tôi đã đổi Facebook — thử lại" : "Thử kết nối lại"}</button>}
            {loading && <div className="flex items-center justify-center gap-2 rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500"><Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />{profile ? "Worker đang xử lý kết nối" : "Bạn có thể giữ cửa sổ này mở trong lúc xử lý"}</div>}
            {canClose && <button type="button" onClick={onClose} className={success ? primary : secondary}><X className="size-4" />Đóng cửa sổ</button>}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-6 py-4 sm:px-8"><a href="/pages/list" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-blue-600"><ArrowLeft className="size-3.5" />Về danh sách Page</a><span className="inline-flex items-center gap-1.5 text-[10px] text-slate-400"><Globe className="size-3" />Facebook Login</span></footer>
      </article>
      <p className="mt-5 text-center text-[11px] leading-5 text-slate-400">{success ? "Danh sách Page đã được cập nhật. Cửa sổ sẽ tự đóng nếu trình duyệt cho phép." : "Quyền truy cập được cấp trực tiếp qua Facebook."}</p>
    </div>
  </main>;
}
