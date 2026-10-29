"use client";

import { useEffect, useState } from "react";
import { getCallbackAction, makeLocalCallbackUrl } from "./callback-routing.mjs";

type ViewState = "checking" | "profile" | "profileError" | "redirecting" | "invalid";

export default function MetaOAuthCallbackPage() {
  const [view, setView] = useState<ViewState>("checking");

  useEffect(() => {
    const action = getCallbackAction(window.location.hash);
    if (action.type === "profile") {
      setView(action.result.error || !action.result.accessToken ? "profileError" : "profile");
      return;
    }
    if (action.type === "popup") {
      setView("redirecting");
      window.location.replace(makeLocalCallbackUrl(action.result));
      return;
    }
    setView("invalid");
  }, []);

  const content = {
    checking: {
      eyebrow: "Facebook OAuth",
      title: "Đang kiểm tra kết quả",
      message: "Vui lòng chờ trong giây lát.",
      icon: "loading",
    },
    profile: {
      eyebrow: "Đã nhận kết quả",
      title: "Đang xác thực Facebook",
      message: "Giữ trang này mở để ứng dụng nhận kết quả và tiếp tục đồng bộ Page.",
      icon: "success",
    },
    profileError: {
      eyebrow: "Facebook chưa cấp quyền",
      title: "Kết nối chưa hoàn tất",
      message: "Bạn đã hủy hoặc từ chối cấp quyền Facebook. Hãy quay lại ứng dụng, mở mục Quản lý Page và bấm Kết nối Facebook để thử lại.",
      icon: "error",
    },
    redirecting: {
      eyebrow: "Đang kết nối với ứng dụng",
      title: "Đang chuyển kết quả",
      message: "Kết quả xác thực đang được gửi về ứng dụng trên máy này.",
      icon: "loading",
    },
    invalid: {
      eyebrow: "Không thể hoàn tất",
      title: "Phiên kết nối không hợp lệ",
      message: "Phiên kết nối đã hết hoặc không còn hợp lệ. Hãy đóng trang này, quay lại ứng dụng, mở mục Quản lý Page và bấm Kết nối Facebook để bắt đầu lại.",
      icon: "error",
    },
  }[view];

  return (
    <main className="oauth-callback-page">
      <section className="oauth-callback-card" aria-live="polite" aria-busy={view === "checking" || view === "redirecting"}>
        <div className="oauth-callback-brand">
          <span className="oauth-callback-brand-mark" aria-hidden="true">f</span>
          <span>Facebook Automator</span>
        </div>
        <div className={`oauth-callback-status-icon is-${content.icon}`} aria-hidden="true">
          {content.icon === "loading" ? <span className="oauth-callback-spinner" /> : content.icon === "success" ? "✓" : "!"}
        </div>
        <p className={`oauth-callback-eyebrow is-${content.icon}`}>{content.eyebrow}</p>
        <h1>{content.title}</h1>
        <p className="oauth-callback-message">{content.message}</p>
        {(view === "profile" || view === "profileError") && <p className="oauth-callback-note">Trang được giữ nguyên để ứng dụng đọc kết quả từ Chrome profile. Hãy quay lại ứng dụng sau khi xử lý xong.</p>}
        {view === "redirecting" && <p className="oauth-callback-note">Nếu engine chưa chạy, hãy mở ứng dụng rồi tải lại callback trước khi phiên xác thực hết hạn.</p>}
        {view === "invalid" && (
          <button className="oauth-callback-button" type="button" onClick={() => window.close()}>
            Đóng trang
          </button>
        )}
        <div className="oauth-callback-security"><span aria-hidden="true">●</span> Kết quả xác thực được chuyển an toàn về ứng dụng</div>
      </section>
      <style jsx>{`
        .oauth-callback-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: radial-gradient(ellipse at 50% 0%, #e8f2ff 0%, #f6f9ff 42%, #f8fafc 100%); color: #0f172a; font-family: var(--font-admin-sans), Inter, sans-serif; }
        .oauth-callback-card { position: relative; overflow: hidden; width: min(100%, 500px); padding: 42px 40px 30px; border: 1px solid #e3eaf4; border-radius: 24px; background: rgba(255,255,255,.96); text-align: center; box-shadow: 0 28px 80px rgba(30,64,112,.12), 0 3px 12px rgba(15,23,42,.04); }
        .oauth-callback-card::before { content: ""; position: absolute; inset: 0 0 auto; height: 4px; background: linear-gradient(90deg,#0866ff,#59a7ff); }
        .oauth-callback-brand { display: inline-flex; align-items: center; gap: 9px; margin-bottom: 30px; color: #475569; font-size: 13px; font-weight: 650; }
        .oauth-callback-brand-mark { display: grid; place-items: end center; width: 26px; height: 26px; overflow: hidden; border-radius: 50%; background: linear-gradient(145deg,#2894ff,#0866ff); color: white; font-family: Arial,sans-serif; font-size: 24px; font-weight: 800; line-height: 24px; }
        .oauth-callback-status-icon { width: 66px; height: 66px; display: grid; place-items: center; margin: 0 auto 18px; border-radius: 20px; font-size: 29px; font-weight: 700; }
        .oauth-callback-status-icon.is-loading { background: #eff6ff; }
        .oauth-callback-status-icon.is-success { background: #ecfdf5; color: #059669; }
        .oauth-callback-status-icon.is-error { background: #fef2f2; color: #dc2626; }
        .oauth-callback-spinner { width: 30px; height: 30px; border: 3px solid #bfdbfe; border-top-color: #1877f2; border-radius: 50%; animation: oauth-spin .8s linear infinite; }
        .oauth-callback-eyebrow { margin: 0 0 8px; color: #64748b; font-size: 11px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
        .oauth-callback-eyebrow.is-success { color: #047857; }
        .oauth-callback-eyebrow.is-error { color: #b91c1c; }
        h1 { margin: 0; color: #172033; font-size: clamp(21px,4vw,25px); line-height: 1.3; font-weight: 750; letter-spacing: -.025em; }
        .oauth-callback-message { max-width: 390px; margin: 12px auto 0; color: #526176; font-size: 15px; line-height: 1.7; }
        .oauth-callback-note { margin: 17px 0 0; padding: 12px 14px; border: 1px solid #e7edf5; border-radius: 12px; background: #f8fafc; color: #64748b; font-size: 12px; line-height: 1.6; text-align: left; }
        .oauth-callback-button { min-height: 44px; margin-top: 22px; padding: 0 22px; border: 0; border-radius: 11px; background: #1877f2; color: #fff; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 5px 12px rgba(24,119,242,.2); transition: background .15s,transform .15s; }
        .oauth-callback-button:hover { background: #0866d8; transform: translateY(-1px); }
        .oauth-callback-button:focus-visible { outline: 3px solid #93c5fd; outline-offset: 3px; }
        .oauth-callback-security { display: flex; align-items: center; justify-content: center; gap: 7px; margin-top: 27px; color: #94a3b8; font-size: 11px; }
        .oauth-callback-security span { color: #22c55e; font-size: 8px; }
        @keyframes oauth-spin { to { transform: rotate(360deg); } }
        @media (max-width: 520px) { .oauth-callback-card { padding: 34px 22px 24px; border-radius: 20px; } .oauth-callback-brand { margin-bottom: 25px; } }
        @media (prefers-reduced-motion: reduce) { .oauth-callback-spinner { animation-duration: 2s; } .oauth-callback-button { transition: none; } }
      `}</style>
    </main>
  );
}
