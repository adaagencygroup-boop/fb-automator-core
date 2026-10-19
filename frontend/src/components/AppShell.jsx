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

// Khung "Nhật ký hệ thống realtime" ở cuối màn hình — đang ẩn. Đổi thành true để hiện lại.
const SHOW_SYSTEM_LOG = false;

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
  const [sidebarOpen, setSidebarOpen] = usePersistentBoolean("fb-automator.sidebar-open", true);

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
      <Sidebar activeTab={activeTab} open={sidebarOpen} />

      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <Header
          activeTab={activeTab}
          user={{
            name: user.username,
            initials: String(user.username || "?").slice(0, 2).toUpperCase(),
          }}
          onProfileClick={() => goTo("profile")}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
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
