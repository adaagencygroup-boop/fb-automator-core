"use client";

/** Khung chung các bước của Seeding Bài viết (theo Figma): thẻ trắng bo góc + badge số đỏ + tiêu đề, phần phải tuỳ chọn. */
export const CARD = "rounded-2xl border border-gray-200/90 bg-white shadow-sm";

export function StepHeader({ step, title, children }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-500 text-xs font-bold text-white">
          {step}
        </span>
        <h2 className="text-base font-bold text-gray-900">{title}</h2>
      </div>
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </div>
  );
}

export default function StepCard({ step, title, actions, className = "", children }) {
  return (
    <section className={`${CARD} space-y-5 p-6 ${className}`}>
      <StepHeader step={step} title={title}>
        {actions}
      </StepHeader>
      {children}
    </section>
  );
}
