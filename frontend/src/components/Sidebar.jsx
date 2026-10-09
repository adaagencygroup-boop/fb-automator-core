"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { MaskIcon, FitMaskIcon } from "@/components/icons";
import { NAV_ITEMS, NAV_CHEVRON } from "@/config/navigation";

// Figma: Aside - LeftSidebar (1016:5); kiểu mục cấp 1 theo 1020:13823 / 1020:13770
export default function Sidebar({ activeTab, onSelectTab }) {
  // Accordion: mỗi lúc chỉ mở 1 nhóm submenu.
  // openGroupId = undefined -> tự mở nhóm chứa mục đang active; null -> đóng hết.
  const [openGroupId, setOpenGroupId] = useState(undefined);
  const activeGroupId = NAV_ITEMS.find((item) =>
    item.children?.some((c) => c.id === activeTab),
  )?.id;
  const currentOpenId = openGroupId === undefined ? activeGroupId : openGroupId;
  const isGroupOpen = (item) => currentOpenId === item.id;
  const toggleGroup = (item) =>
    setOpenGroupId(isGroupOpen(item) ? null : item.id);

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
          ),
        )}
      </nav>
    </aside>
  );
}

/** Kích thước hiển thị chung của icon menu (px) — mọi icon được đưa về cùng cỡ */
const TOP_ICON_SIZE = 16;
const SUB_ICON_SIZE = 15;

/** Icon menu: đặt trong khung vuông cố định + cách chữ 12px (gap của Figma 1020:13823) */
function NavIcon({ icon, className, size = TOP_ICON_SIZE }) {
  if (!icon) return null;
  return (
    <FitMaskIcon {...icon} size={size} className={cn("mr-3", className)} />
  );
}

// Kiểu mục cấp 1 — Figma "Tổng quan" (1020:13823): px 14, py 10, bo góc 12, chữ 14px Medium #434655
const TOP_ITEM =
  "w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl text-left text-sm leading-5 transition-colors";
const TOP_IDLE =
  "text-[#434655] font-medium hover:bg-slate-50 hover:text-slate-900";

// Viền focus khi điều hướng bằng bàn phím (Tab) — chỉ hiện với bàn phím, không hiện khi bấm chuột.
// Dùng ring-inset để không bị cắt bởi vùng cuộn / vùng ẩn của submenu.
const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500";

/** Mục cấp 1 không có submenu (Tổng quan, Quản lý tài khoản Facebook, ...) */
function NavLink({ item, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        TOP_ITEM,
        FOCUS_RING,
        active ? "bg-sky-100 text-sky-700 font-semibold" : TOP_IDLE,
      )}
    >
      <span className="flex items-center min-w-0">
        <NavIcon
          icon={item.icon}
          className={active ? "text-sky-700" : "text-[#434655]"}
        />
        <span>{item.label}</span>
      </span>
    </button>
  );
}

/** Nhóm có submenu (Đăng bài & tương tác, Tạo fanpage, Quản lý Fanpage, Spam Group, Seeding) */
function NavGroup({ item, activeTab, open, onToggle, onSelectTab }) {
  const sectionActive = item.children.some((c) => c.id === activeTab);
  const submenuId = `submenu-${item.id}`;

  return (
    <div className="w-full flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={submenuId}
        className={cn(
          TOP_ITEM,
          FOCUS_RING,
          sectionActive ? "text-sky-600 font-semibold" : TOP_IDLE,
        )}
      >
        <span className="flex items-center min-w-0">
          <NavIcon
            icon={item.icon}
            className={sectionActive ? "text-sky-600" : "text-[#434655]"}
          />
          <span>{item.label}</span>
        </span>
        <MaskIcon
          {...NAV_CHEVRON}
          className={cn(
            "transition-transform duration-200 motion-reduce:transition-none",
            open && "rotate-180",
            "shrink-0",
            sectionActive ? "text-sky-600" : "text-slate-400",
          )}
        />
      </button>

      {/* Mở/đóng có hiệu ứng trượt: grid-template-rows 0fr <-> 1fr. Khi đóng, `inert` loại các nút khỏi thứ tự Tab. */}
      <div
        id={submenuId}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden flex justify-end">
          <div className="w-[215px] mt-1 mb-1 flex flex-col gap-1 pl-3.5 border-l-2 border-sky-100">
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
                    FOCUS_RING,
                    active
                      ? "py-2 bg-sky-100 text-sky-700 text-[13px] leading-[19.5px] font-semibold"
                      : "py-1.5 text-slate-600 text-[12.5px] leading-[18.75px] font-medium hover:bg-slate-50 hover:text-slate-800",
                  )}
                >
                  <NavIcon
                    icon={child.icon}
                    size={SUB_ICON_SIZE}
                    className={active ? "text-sky-700" : "text-slate-600"}
                  />
                  <span className="truncate">{child.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
