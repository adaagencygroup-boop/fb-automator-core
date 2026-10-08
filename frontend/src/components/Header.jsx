"use client";

import { MODULE_REGISTRY } from "@/modules";

export default function Header({ activeTab, engineOnline }) {
  const currentModule = MODULE_REGISTRY.find((m) => m.id === activeTab);

  return (
    <header className="h-14 bg-white border-b border-border px-6 flex items-center justify-between shrink-0 shadow-subtle">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-heading font-bold text-foreground flex items-center gap-2">
          <span className="text-base">{currentModule?.icon}</span>
          <span>{currentModule?.label}</span>
        </h2>
        <span className="text-[11px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded border border-slate-200 font-medium">
          Phụ trách: {currentModule?.author}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div
          className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border ${
            engineOnline
              ? "bg-emerald-50 border-emerald-200 text-emerald-700"
              : "bg-red-50 border-red-200 text-red-600"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              engineOnline ? "bg-emerald-500 animate-pulse" : "bg-red-500"
            }`}
          />
          <span>{engineOnline ? "Engine: Port 28129 Online" : "Engine: Offline"}</span>
        </div>
      </div>
    </header>
  );
}
