import { AlertTriangle, CalendarX, CheckCircle2, Info, X } from "lucide-react";

export function AuthFeedback({ feedback, onClose }) {
  if (!feedback) return null;
  const tone = feedback.tone || (feedback.success ? "success" : "error");
  const Icon = feedback.kind === "license" ? CalendarX : tone === "success" ? CheckCircle2 : tone === "info" ? Info : AlertTriangle;
  const loginDesign = ["credentials", "license", "hwid"].includes(feedback.kind);
  return (
    <div role={tone === "success" || tone === "info" ? "status" : "alert"} data-tone={tone} data-kind={feedback.kind} data-login-design={loginDesign || undefined} className="auth-feedback">
      <div className="auth-feedback-icon"><Icon className="size-5" /></div>
      <div className="min-w-0 flex-1"><p className="auth-feedback-title">{feedback.title}</p><p className="auth-feedback-message">{feedback.message}</p></div>
      {!loginDesign && <button type="button" aria-label="Đóng thông báo" onClick={onClose} className="self-start rounded-md p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-4" /></button>}
    </div>
  );
}
