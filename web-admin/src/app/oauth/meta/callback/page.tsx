"use client";

import { useEffect, useState } from "react";
import { getCallbackAction, makeLocalCallbackUrl } from "./callback-routing.mjs";

type ViewState = "checking" | "profile" | "redirecting" | "invalid";

export default function MetaOAuthCallbackPage() {
  const [view, setView] = useState<ViewState>("checking");

  useEffect(() => {
    const action = getCallbackAction(window.location.hash);
    if (action.type === "profile") {
      setView("profile");
      return;
    }
    if (action.type === "popup") {
      setView("redirecting");
      window.location.replace(makeLocalCallbackUrl(action.result));
      return;
    }
    setView("invalid");
  }, []);

  const message = {
    checking: "Đang kiểm tra kết quả OAuth…",
    profile: "Đã nhận kết quả. Giữ nguyên trang này trong khi ứng dụng hoàn tất xác thực Facebook.",
    redirecting: "Đang chuyển kết quả về ứng dụng trên máy này…",
    invalid: "Không tìm thấy phiên kết nối hợp lệ. Hãy quay lại Module 5 và bắt đầu kết nối Facebook lại.",
  }[view];

  return (
    <main className="oauth-callback-page">
      <section className="oauth-callback-card" aria-live="polite">
        <div className={`oauth-callback-mark ${view === "invalid" ? "is-error" : ""}`}>
          {view === "invalid" ? "!" : "f"}
        </div>
        <p className="oauth-callback-eyebrow">Facebook Automator</p>
        <h1>{view === "invalid" ? "Không thể hoàn tất kết nối" : "Đang trả kết quả Facebook"}</h1>
        <p className="oauth-callback-message">{message}</p>
        {view === "redirecting" && <p className="oauth-callback-note">Nếu ứng dụng chưa mở, hãy mở app rồi tải lại trang callback trước khi phiên xác thực hết hạn.</p>}
      </section>
      <style jsx>{`
        .oauth-callback-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at top, #eff6ff, #f8fafc 55%); color: #0f172a; font-family: var(--font-admin-sans), sans-serif; }
        .oauth-callback-card { width: min(100%, 480px); padding: 40px 34px; border: 1px solid #e2e8f0; border-radius: 24px; background: #fff; text-align: center; box-shadow: 0 24px 70px #0f172a14; }
        .oauth-callback-mark { width: 58px; height: 58px; display: grid; place-items: center; margin: 0 auto 22px; border-radius: 18px; background: #1877f2; color: #fff; font-size: 34px; font-weight: 800; }
        .oauth-callback-mark.is-error { background: #fee2e2; color: #b91c1c; }
        .oauth-callback-eyebrow { margin: 0 0 8px; color: #64748b; font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
        h1 { margin: 0; font-size: 23px; line-height: 1.3; font-weight: 750; }
        .oauth-callback-message { margin: 14px 0 0; color: #475569; font-size: 15px; line-height: 1.65; }
        .oauth-callback-note { margin: 18px 0 0; color: #64748b; font-size: 13px; line-height: 1.6; }
      `}</style>
    </main>
  );
}
