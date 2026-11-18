export type ToastState = { msg: string; type: "success" | "error" } | null;

interface ToastProps {
  toast: ToastState;
}

export function Toast({ toast }: ToastProps) {
  if (!toast) return null;
  return (
    <div className={`adm-toast adm-toast--${toast.type}`}>
      {toast.type === "success" ? "✓" : "✕"} {toast.msg}
    </div>
  );
}
