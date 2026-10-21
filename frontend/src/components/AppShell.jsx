"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import ConsoleTerminal from "@/components/ConsoleTerminal";
import AuthGate from "@/components/AuthGate";
import IntroMusic from "@/components/IntroMusic";
import { SessionContext } from "@/components/SessionContext";
import api from "@/services/api";
import { WS_BASE } from "@/config/constants";
import { findNavItem, findNavItemByPath, pathOf } from "@/config/navigation";
import { usePersistentBoolean } from "@/lib/usePersistentBoolean";
import { useMediaQuery } from "@/lib/use-media-query";

// Khung "Nhật ký hệ thống realtime" ở cuối màn hình — đang ẩn. Đổi thành true để hiện lại.
const SHOW_SYSTEM_LOG = false;

// Dưới bề rộng này, sidebar không chiếm chỗ nữa mà mở dạng drawer đè lên nội dung + lớp phủ.
const SIDEBAR_OVERLAY_QUERY = "(max-width: 1279px)";

/**
 * Khung chung của mọi trang: đăng nhập (AuthGate) -> Sidebar + Header + vùng nội dung.
 * Trang đang mở được xác định từ URL (src/config/navigation.js -> pathOf).
 */
export default function AppShell({ children }) {
  const pathname = usePathname();
  if (pathname.replace(/\/$/, "") === "/oauth/meta/callback") return children;
  return <AuthGate>{(session) => <Workspace session={session}>{children}</Workspace>}</AuthGate>;
}

function Workspace({ session, children }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeTab = findNavItemByPath(pathname)?.id ?? null;

  const [engineOnline, setEngineOnline] = useState(false);
  const [logs, setLogs] = useState([]);
  // Màn rộng: sidebar chiếm chỗ (đẩy nội dung), nhớ trạng thái.
  // Màn hẹp: sidebar là drawer đè lên nội dung, luôn bắt đầu ở trạng thái đóng.
  const [sidebarOpen, setSidebarOpen] = usePersistentBoolean("fb-automator.sidebar-open", true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isOverlay = useMediaQuery(SIDEBAR_OVERLAY_QUERY);
  const navOpen = isOverlay ? drawerOpen : sidebarOpen;
  const toggleNav = () => (isOverlay ? setDrawerOpen((v) => !v) : setSidebarOpen((v) => !v));

  // Đang mở drawer thì bấm Esc để đóng
  useEffect(() => {
    if (!isOverlay || !drawerOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOverlay, drawerOpen]);

  useEffect(() => {
    // Kiểm tra Engine
    api
      .get("/api/health")
      .then(() => setEngineOnline(true))
      .catch(() => setEngineOnline(false));

    // Nhận log realtime qua WebSocket
    let ws;
    try {
      ws = new WebSocket(WS_BASE);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const time = new Date().toLocaleTimeString();
          setLogs((prev) => [...prev.slice(-300), { time, ...data }]);
        } catch {
          /* bỏ qua gói tin không phải JSON */
        }
      };
    } catch {
      /* Engine chưa chạy */
    }
    return () => ws?.close();
  }, []);

  const goTo = (navId) => router.push(pathOf(findNavItem(navId).item));
  const { user } = session;

  return (
    <div className="flex h-screen w-screen bg-background text-foreground antialiased overflow-hidden">
      <IntroMusic />

      {isOverlay ? (
        // Màn hẹp: drawer đè lên nội dung + lớp phủ, không chiếm chỗ của vùng nội dung
        navOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-slate-900/40"
              aria-hidden="true"
              onClick={() => setDrawerOpen(false)}
            />
            <div
              className="fixed inset-y-0 left-0 z-50 shadow-2xl"
              // Bấm vào một mục menu thì đóng drawer luôn
              onClick={(e) => {
                if (e.target instanceof Element && e.target.closest("a")) setDrawerOpen(false);
              }}
            >
              <Sidebar activeTab={activeTab} open />
            </div>
          </>
        )
      ) : (
        <Sidebar activeTab={activeTab} open={sidebarOpen} />
      )}

      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <Header
          activeTab={activeTab}
          user={{
            name: user.username,
            initials: String(user.username || "?").slice(0, 2).toUpperCase(),
          }}
          onProfileClick={() => goTo("profile")}
          sidebarOpen={navOpen}
          onToggleSidebar={toggleNav}
          isAdmin={session.isAdmin}
          adminUrl={session.adminUrl}
          onLogout={session.logout}
        />

        <main className={`flex-1 overflow-y-auto p-6 ${["dashboard", "profile"].includes(activeTab) ? "bg-[#f7f8ff]" : "bg-background"}`}>
          {user.modules_unlocked || ["dashboard", "profile"].includes(activeTab) ? (
            <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
          ) : (
            <div className="mx-auto max-w-lg rounded-xl border border-border bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold tracking-tight text-sky-600">Chưa mở được các module</h2>
              <p className="mt-2 text-sm leading-5 text-slate-500">
                Tài khoản {user.username} đang ở trạng thái {user.status}. Cần admin duyệt hoặc gia hạn thì mới vào được 9
                module.
              </p>
            </div>
          )}
        </main>

        {SHOW_SYSTEM_LOG && <ConsoleTerminal logs={logs} engineOnline={engineOnline} />}
      </div>
    </div>
  );
}
