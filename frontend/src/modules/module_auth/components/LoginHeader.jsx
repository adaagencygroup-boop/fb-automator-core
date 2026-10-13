"use client";

import React from "react";

export function LoginHeader() {
  return (
    <header className="flex items-center gap-3 shrink-0">
      {/* App Brand Logo */}
      <div className="flex items-center gap-3">
        <div className="w-7 h-8 rounded-lg bg-[#245ff4] flex items-center justify-center text-white font-bold text-sm">
          f
        </div>
        <div className="flex items-center gap-1.5 font-heading font-bold text-sm text-slate-900 tracking-tight">
          <span>Facebook Automator</span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#245ff4]"></span>
        </div>
      </div>
    </header>
  );
}
