"use client";

import { MODULE_REGISTRY } from "@/modules";

export default function Sidebar({ activeTab, onSelectTab }) {
  return (
    <aside className="w-64 bg-white border-r border-border flex flex-col justify-between shrink-0 select-none shadow-subtle">
      <div>
        <div className="p-4 border-b border-border text-center">
          <h1 className="text-base font-black tracking-wider text-primary font-heading flex items-center justify-center gap-2">
            <img
              src="/icons/app_brand_logo.svg"
              alt="Logo"
              className="w-6 h-6 rounded-md shadow-sm"
            />
            <span>FB AUTOMATOR</span>
          </h1>
          <p className="text-[10px] text-muted-foreground font-medium tracking-wide mt-0.5">
            ENTERPRISE PLATFORM v2.0
          </p>
        </div>

        <nav className="p-2 space-y-1">
          {MODULE_REGISTRY.map((m) => {
            const active = activeTab === m.id;
            return (
              <button
                key={m.id}
                onClick={() => onSelectTab(m.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-xs font-semibold transition ${
                  active
                    ? "bg-primary-subtle text-primary border-l-4 border-primary shadow-subtle font-bold"
                    : "text-slate-600 hover:text-foreground hover:bg-slate-100"
                }`}
              >
                <span className="text-sm">{m.icon}</span>
                <span>{m.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="p-3 text-center border-t border-border text-[10px] text-muted-foreground">
        9 Modules &bull; Supabase PostgreSQL
      </div>
    </aside>
  );
}
