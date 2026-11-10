"use client";

import { ArrowRight, ShieldCheck, Zap } from "lucide-react";
import { LoginHeader } from "./LoginHeader";

export function LoginHeroBanner() {
  return (
    <section className="auth-entry-hero">
      <div>
        <LoginHeader />
        <div className="mt-6 mb-3 inline-flex items-center gap-1.5 rounded-full bg-blue-100/70 px-2 py-1 text-[10px] font-semibold tracking-wide text-blue-700">
          <span className="size-1 rounded-full bg-blue-600" />TỰ ĐỘNG HÓA CHUYÊN NGHIỆP
        </div>
        <h1 className="font-heading font-bold text-2xl xl:text-[30px] leading-snug text-slate-900">
          Tự động hóa tạo<br /><span className="text-[#245ff4]">Fanpage Facebook</span>
        </h1>
        <p className="mt-4 text-xs leading-6 text-slate-500">
          Nhanh chóng – An toàn – Hiệu quả. Tối ưu hóa quy trình quản trị, tiết kiệm hàng giờ vận hành thủ công mỗi ngày.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" className="flex h-9 items-center gap-1 rounded-lg bg-[#245ff4] px-3 text-xs font-medium text-white hover:bg-blue-700">
            Khám phá ngay <ArrowRight className="size-3.5" />
          </button>
          <button type="button" className="h-9 rounded-lg bg-white px-3 text-xs font-medium text-slate-800 hover:bg-blue-50">Tài liệu hướng dẫn</button>
        </div>
        <div className="mt-7 flex flex-col gap-2">
          {[
            { Icon: Zap, title: "Tiết kiệm thời gian", body: "Tối ưu hiệu suất làm việc" },
            { Icon: ShieldCheck, title: "Bảo mật & Riêng tư", body: "Mã hóa dữ liệu cấp phần cứng" },
          ].map(({ Icon, title, body }) => (
            <div key={title} className="flex items-center gap-2.5 rounded-lg bg-white px-2.5 py-2">
              <div className="grid size-8 shrink-0 place-items-center rounded-md bg-blue-50 text-[#245ff4]"><Icon className="size-4" /></div>
              <div><p className="text-xs font-semibold text-slate-800">{title}</p><p className="text-[11px] text-slate-500">{body}</p></div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-10 flex items-center justify-between gap-2 text-[10px]">
        <div className="flex items-center gap-1.5 font-medium text-sky-700"><span className="h-2 w-1 rounded-full bg-sky-600" />Hệ thống trực tuyến</div>
        <span className="text-slate-500">Phiên bản 2.0.2</span>
      </div>
    </section>
  );
}
