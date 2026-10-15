"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import { FitMaskIcon, MaskIcon } from "@/components/icons";
import { findNavItem } from "@/config/navigation";
import { CURRENT_USER } from "@/config/constants";

// Figma: Header - TopBar (1016:109)
export default function Header({
  activeTab,
  user = CURRENT_USER,
  onNotificationsClick,
  onProfileClick,
  sidebarOpen = true,
  onToggleSidebar,
  isAdmin = false,
  adminUrl = "",
  onLogout,
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);
  const triggerRef = useRef(null);
  useEffect(() => {
    if (!profileOpen) return;
    const closeOutside = (event) => {
      if (!profileRef.current?.contains(event.target)) setProfileOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setProfileOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileOpen]);
  const { item, parent } = findNavItem(activeTab);
  const title = item.title || item.label;
  const headerIcon = item.headerIcon || parent?.headerIcon;
  const initials = user?.initials || getInitial(user?.name);

  return (
    <header className={`${activeTab === "dashboard" ? "h-[60px]" : "h-[74px]"} bg-white border-b border-border pl-8 pr-8 pt-3.5 pb-[15px] flex items-center justify-between gap-6 shrink-0 font-sans`}>
      {/* Nút ẩn/hiện sidebar + Title & Subtitle */}
      <div className="flex items-center min-w-0">
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-controls="app-sidebar"
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? "Ẩn sidebar" : "Hiện sidebar"}
            title={sidebarOpen ? "Ẩn sidebar" : "Hiện sidebar"}
            className="-ml-2 mr-3 size-9 shrink-0 rounded-lg flex items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            <MaskIcon src="/icons/icon_sidebar_toggle.svg" width={16} height={16} />
          </button>
        )}
        <div className={activeTab === "dashboard" ? "hidden" : "w-[21px] h-6 shrink-0 flex items-center justify-start"}>
          {headerIcon ? (
            <img src={headerIcon.src} alt="" width={headerIcon.width} height={headerIcon.height} className="block" />
          ) : (
            // Mục chưa có icon Header riêng trong Figma: dùng icon menu, tô màu xanh như cờ Header
            (item.icon || parent?.icon) && (
              <FitMaskIcon {...(item.icon || parent.icon)} size={20} className="text-success" />
            )
          )}
        </div>
        <div className={activeTab === "dashboard" ? "hidden" : "pl-3 min-w-0 flex flex-col"}>
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
        {isAdmin && adminUrl && (
          <a
            href={adminUrl}
            target="_blank"
            rel="noreferrer"
            className="mr-3 h-8 px-3 rounded-md border border-border bg-white text-xs font-semibold text-sky-600 inline-flex items-center hover:bg-slate-50"
          >
            Trang Admin
          </a>
        )}
        <button
          type="button"
          onClick={onNotificationsClick}
          aria-label="Thông báo"
          className="size-9 rounded-full border border-border flex items-center justify-center transition-colors hover:bg-slate-50 outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
        >
          <img src="/icons/icon_bell.svg" alt="" width={12.2588} height={14} className="block" />
        </button>

        <div ref={profileRef} className="relative" onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setProfileOpen(false);
        }}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setProfileOpen((open) => !open)}
          aria-expanded={profileOpen}
          aria-controls="header-profile-options"
          aria-label={`Tùy chọn tài khoản ${user?.name || ""}`}
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
        {profileOpen && <div id="header-profile-options" className="absolute right-0 top-full z-50 mt-3 w-48 rounded-xl border border-border bg-white p-1.5 shadow-lg">
          <button type="button" onClick={() => { setProfileOpen(false); onProfileClick?.(); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-700 hover:bg-blue-50 focus-visible:bg-blue-50">
            <UserRound size={17} /> Profile
          </button>
          {onLogout && <button type="button" onClick={() => { setProfileOpen(false); onLogout(); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 focus-visible:bg-red-50">
            <LogOut size={17} /> Đăng xuất
          </button>}
        </div>}
        </div>
      </div>
    </header>
  );
}

function getInitial(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[parts.length - 1]?.[0] || "?").toUpperCase();
}
