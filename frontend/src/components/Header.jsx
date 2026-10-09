"use client";

import { FitMaskIcon } from "@/components/icons";
import { findNavItem } from "@/config/navigation";
import { CURRENT_USER } from "@/config/constants";

// Figma: Header - TopBar (1016:109)
export default function Header({ activeTab, user = CURRENT_USER, onNotificationsClick, onProfileClick }) {
  const { item, parent } = findNavItem(activeTab);
  const title = item.title || item.label;
  const headerIcon = item.headerIcon || parent?.headerIcon;
  const initials = user?.initials || getInitial(user?.name);

  return (
    <header className="h-[74px] bg-white border-b border-border pl-8 pr-8 pt-3.5 pb-[15px] flex items-center justify-between gap-6 shrink-0 font-sans">
      {/* Title & Subtitle */}
      <div className="flex items-center min-w-0">
        <div className="w-[21px] h-6 shrink-0 flex items-center justify-start">
          {headerIcon ? (
            <img src={headerIcon.src} alt="" width={headerIcon.width} height={headerIcon.height} className="block" />
          ) : (
            // Mục chưa có icon Header riêng trong Figma: dùng icon menu, tô màu xanh như cờ Header
            (item.icon || parent?.icon) && (
              <FitMaskIcon {...(item.icon || parent.icon)} size={20} className="text-success" />
            )
          )}
        </div>
        <div className="pl-3 min-w-0 flex flex-col">
          <h2 className="font-sans text-lg leading-7 font-bold tracking-[-0.45px] text-sky-600 truncate">
            {title}
          </h2>
          {item.description && (
            <p className="text-xs leading-4 text-slate-500 truncate">{item.description}</p>
          )}
        </div>
      </div>

      {/* Right Header: Notifications & User Profile */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onNotificationsClick}
          aria-label="Thông báo"
          className="size-9 rounded-full border border-border flex items-center justify-center transition-colors hover:bg-slate-50 outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
        >
          <img src="/icons/icon_bell.svg" alt="" width={12.2588} height={14} className="block" />
        </button>

        <button
          type="button"
          onClick={onProfileClick}
          className="ml-4 pl-1 flex items-center rounded-full transition-opacity hover:opacity-80 outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
        >
          <span className="size-8 rounded-full bg-primary text-white text-xs leading-4 font-bold flex items-center justify-center drop-shadow-[0px_1px_1px_rgba(0,0,0,0.05)]">
            {initials}
          </span>
          <span className="pl-2 text-xs leading-4 font-semibold text-slate-700 whitespace-nowrap">
            {user?.name}
          </span>
          <img
            src="/icons/icon_header_chevron_down.svg"
            alt=""
            width={16.75}
            height={5}
            className="block"
          />
        </button>
      </div>
    </header>
  );
}

function getInitial(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[parts.length - 1]?.[0] || "?").toUpperCase();
}
