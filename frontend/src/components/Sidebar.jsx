"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { MaskIcon } from "@/components/icons";
import { NAV_ITEMS, NAV_CHEVRON } from "@/config/navigation";

// Figma: Aside - LeftSidebar (1016:5)
export default function Sidebar({ activeTab, onSelectTab }) {
  // Nhóm submenu: mặc định mở khi chứa mục đang active, người dùng có thể đóng/mở tay
  const [groupOverrides, setGroupOverrides] = useState({});
  const isGroupOpen = (item) =>
    groupOverrides[item.id] ?? item.children.some((c) => c.id === activeTab);
  const toggleGroup = (item) =>
    setGroupOverrides((prev) => ({ ...prev, [item.id]: !isGroupOpen(item) }));

  return (
    <aside className="w-64 h-full bg-white border-r border-border flex flex-col shrink-0 select-none font-sans">
      {/* Brand / Logo Area */}
      <div className="flex items-center px-5 pt-4 pb-[17px] border-b border-slate-100 shrink-0">
        <div className="size-9 rounded-lg bg-primary flex items-center justify-center shrink-0 drop-shadow-[0px_1px_1px_rgba(0,0,0,0.05)]">
          <img
            src="/icons/icon_brand_facebook_f.svg"
            alt="Facebook Auto Poster AI Pro"
            width={10.7031}
            height={20}
            className="block"
          />
        </div>
        <div className="pl-3 min-w-0 flex flex-col">
          <h1 className="font-sans text-[13.5px] leading-[16.88px] font-bold text-slate-800 truncate">
            Facebook Auto Poster AI Pro
          </h1>
          <p className="text-[10px] leading-[15px] font-medium tracking-[-0.25px] text-slate-500 truncate">
            Batching &amp; Key Rotation System
          </p>
        </div>
      </div>

      {/* Navigation Menu Items */}
      <nav className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) =>
          item.children?.length ? (
            <NavGroup
              key={item.id}
              item={item}
              activeTab={activeTab}
              open={isGroupOpen(item)}
              onToggle={() => toggleGroup(item)}
              onSelectTab={onSelectTab}
            />
          ) : (
            <NavLink
              key={item.id}
              item={item}
              active={activeTab === item.id}
              onClick={() => onSelectTab(item.id)}
            />
          )
        )}
      </nav>
    </aside>
  );
}

/** Mục cấp 1 không có submenu (Dashboard, Nuôi Acc, ...) */
function NavLink({ item, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-[13px] leading-[19.5px] transition-colors",
        active
          ? "bg-sky-100 text-sky-700 font-semibold"
          : "text-slate-600 font-medium hover:bg-slate-50 hover:text-slate-800"
      )}
    >
      <span className="flex items-center min-w-0">
        <MaskIcon {...item.icon} className={active ? "text-sky-700" : "text-slate-500"} />
        <span className="truncate">{item.label}</span>
      </span>
    </button>
  );
}

/** Nhóm có submenu (Quản lý Fanpage) */
function NavGroup({ item, activeTab, open, onToggle, onSelectTab }) {
  const sectionActive = item.children.some((c) => c.id === activeTab);

  return (
    <div className={cn("w-full flex flex-col items-end", open && "gap-1 py-1")}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-[13px] leading-[19.5px] transition-colors",
          sectionActive
            ? "text-sky-600 font-semibold"
            : "text-slate-600 font-medium hover:bg-slate-50 hover:text-slate-800"
        )}
      >
        <span className="flex items-center min-w-0">
          <MaskIcon {...item.icon} className={sectionActive ? "text-sky-600" : "text-slate-500"} />
          <span className="truncate">{item.label}</span>
        </span>
        <MaskIcon
          {...NAV_CHEVRON}
          className={cn(
            "transition-transform duration-200",
            open && "rotate-180",
            sectionActive ? "text-sky-600" : "text-slate-400"
          )}
        />
      </button>

      {open && (
        <div className="w-[215px] flex flex-col gap-1 pl-3.5 border-l-2 border-sky-100">
          {item.children.map((child) => {
            const active = activeTab === child.id;
            return (
              <button
                key={child.id}
                type="button"
                onClick={() => onSelectTab(child.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "w-full flex items-center px-3 rounded-md text-left transition-colors",
                  active
                    ? "py-2 bg-sky-100 text-sky-700 text-[13px] leading-[19.5px] font-semibold"
                    : "py-1.5 text-slate-600 text-[12.5px] leading-[18.75px] font-medium hover:bg-slate-50 hover:text-slate-800"
                )}
              >
                <MaskIcon {...child.icon} className={active ? "text-sky-700" : "text-slate-400"} />
                <span className="truncate">{child.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
