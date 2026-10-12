"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import ConsoleTerminal from "@/components/ConsoleTerminal";
import api from "@/services/api";
import { WS_BASE } from "@/config/constants";
import { findNavItem, findNavItemByPath, pathOf } from "@/config/navigation";
import { usePersistentBoolean } from "@/lib/usePersistentBoolean";

// Khung "Nhật ký hệ thống realtime" ở cuối màn hình — đang ẩn. Đổi thành true để hiện lại.
const SHOW_SYSTEM_LOG = false;

/**
 * Khung chung của mọi trang: Sidebar + Header + vùng nội dung.
 * Trang đang mở được xác định từ URL (src/config/navigation.js -> pathOf).
 */
export default function AppShell({ children }) {
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

  return (
    <div className="flex h-screen w-screen bg-background text-foreground antialiased overflow-hidden">
      <Sidebar activeTab={activeTab} open={sidebarOpen} />

      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <Header
          activeTab={activeTab}
          onProfileClick={() => goTo("profile")}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />

        <main className="flex-1 overflow-y-auto p-6 bg-background">{children}</main>

        {SHOW_SYSTEM_LOG && <ConsoleTerminal logs={logs} engineOnline={engineOnline} />}
      </div>
    </div>
  );
}
