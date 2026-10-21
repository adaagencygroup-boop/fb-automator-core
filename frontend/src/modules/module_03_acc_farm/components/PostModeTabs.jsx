"use client";

import React from "react";
import { PenSquare, Film, Clock3 } from "lucide-react";

export function PostModeTabs({ currentMode, onChangeMode }) {
  const tabs = [
    {
      id: "status",
      label: "Đăng Status (Bài viết)",
      icon: PenSquare,
    },
    {
      id: "reels",
      label: "Đăng Reels (Video ngắn)",
      icon: Film,
    },
    {
      id: "story",
      label: "Đăng Story (Tin 24h)",
      icon: Clock3,
    },
  ];

  return (
    <div className="inline-flex items-center gap-2 select-none bg-[#E5EEFF] p-1 rounded-xl border border-[#B4C9F0]">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = currentMode === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChangeMode(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${isActive
                ? "bg-blue-600 text-white shadow-xs scale-[1.01]"
                : "text-[#434655] border-slate-200 hover:bg-blue-500 hover:text-white"
              }`}
          >
            <Icon size={16} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
