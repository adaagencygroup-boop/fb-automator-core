"use client";

import { MODULE_REGISTRY } from "@/modules";

export default function Sidebar({ activeTab, onSelectTab }) {
  return (
    <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col justify-between shrink-0 select-none">
      <div>
        <div className="p-4 border-b border-slate-800 text-center">
          <h1 className="text-base font-black tracking-wider text-cyan-400">
            ⚡ FB AUTOMATOR
          </h1>
          <p className="text-[10px] text-slate-500 font-medium tracking-wide mt-0.5">
            TAURI + SUPABASE v2.0
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
                    ? "bg-slate-900 text-cyan-400 border-l-4 border-cyan-400 shadow"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/50"
                }`}
              >
                <span className="text-sm">{m.icon}</span>
                <span>{m.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="p-3 text-center border-t border-slate-900 text-[10px] text-slate-600">
        9 Modules &bull; Supabase Cloud
      </div>
    </aside>
  );
}
