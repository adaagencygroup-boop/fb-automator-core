import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

export function SectionCard({ number, title, description, aside, children, className = "" }) {
  return (
    <Card className={`overflow-hidden border-slate-200 shadow-sm ${className}`}>
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
        <div className="flex min-w-0 items-start gap-3">
          {number && (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
              {number}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="font-heading text-sm font-bold leading-5 text-slate-800">{title}</h3>
            {description && <p className="mt-0.5 text-[11px] leading-4 text-slate-400">{description}</p>}
          </div>
        </div>
        {aside}
      </div>
      <div className="px-6 py-5">{children}</div>
    </Card>
  );
}

export function Field({ label, required = false, children, className = "" }) {
  return (
    <div className={`block space-y-1.5 ${className}`}>
      <span className="block text-[11px] font-semibold text-slate-600">
        {label} {required && <span className="text-slate-400">(bắt buộc)</span>}
      </span>
      {children}
    </div>
  );
}

export function SelectField({ value, onChange, children, className = "", disabled = false, ...props }) {
  return (
    <select
      value={value}
      onChange={onChange}
      disabled={disabled}
      className={`h-9 w-full rounded-md border border-input bg-white px-3 text-xs text-slate-700 shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 disabled:opacity-75 ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

export function CheckLabel({ checked, onCheckedChange, children }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[11px] font-medium text-slate-700">
      <Checkbox checked={checked} onCheckedChange={onCheckedChange} />
      {children}
    </label>
  );
}

export function initialsOf(name = "") {
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

export function normalizeAccount(account, index) {
  const name =
    account.profile_name ||
    account.name ||
    (account.uid ? `Nick FB (${account.uid})` : `Tài khoản ${index + 1}`);

  const rawStatus = account.status ? String(account.status).toUpperCase() : null;
  const status = rawStatus === "LIVE" ? "LIVE" : rawStatus === "DIE" ? "DIE" : rawStatus || "UNKNOWN";

  const subtitle = account.email || account.mail || "Chưa có email";

  return {
    ...account,
    id: account.id ?? index + 1,
    key: String(account.id ?? account.uid ?? index),
    name,
    uid: String(account.uid || "—"),
    status,
    email: subtitle,
  };
}
