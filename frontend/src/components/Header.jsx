"use client";

import { MODULE_REGISTRY } from "@/modules";

export default function Header({ activeTab, engineOnline }) {
  const currentModule = MODULE_REGISTRY.find((m) => m.id === activeTab);

  return (
    <header className="h-14 bg-slate-900 border-b border-slate-800 px-6 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <span>{currentModule?.icon}</span>
          <span>{currentModule?.label}</span>
        </h2>
        <span className="text-[11px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700">
          Phụ trách: {currentModule?.author}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div
          className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium border ${
            engineOnline
              ? "bg-emerald-950/40 border-emerald-500/50 text-emerald-400"
              : "bg-red-950/40 border-red-500/50 text-red-400"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              engineOnline ? "bg-emerald-400" : "bg-red-500"
            }`}
          />
          <span>{engineOnline ? "Engine: Port 28129 Online" : "Engine: Offline"}</span>
        </div>
      </div>
    </header>
  );
}
