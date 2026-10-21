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

  // Lắng nghe sự kiện Deep Link trong môi trường Desktop Tauri
  useEffect(() => {
    let unlisten;
    let active = true;

    async function initDeepLink() {
      if (typeof window === "undefined") return;
      if (!window.__TAURI__ && !window.__TAURI_INTERNALS__) return;

      try {
        const { listen } = await import("@tauri-apps/api/event");
        if (!active) return;
        unlisten = await listen("deep-link://new-url", (event) => {
          const urls = event.payload;
          if (Array.isArray(urls) && urls.length > 0) {
            const rawUrl = urls[0];
            console.log("[Tauri DeepLink] Incoming URL:", rawUrl);
            if (rawUrl.includes("oauth")) {
              const urlParts = rawUrl.split("://")[1] || "";
              const hashIdx = urlParts.indexOf("#");
              const qIdx = urlParts.indexOf("?");
              const splitIdx = hashIdx !== -1 ? hashIdx : qIdx;
              const routePath = splitIdx !== -1 ? urlParts.substring(0, splitIdx) : urlParts;
              const params = splitIdx !== -1 ? urlParts.substring(splitIdx) : "";
              const finalPath = "/" + (routePath.startsWith("/") ? routePath.slice(1) : routePath) + params;
              router.push(finalPath);
            }
          }
        });
      } catch (err) {
        console.warn("[Tauri DeepLink] Could not attach listener:", err);
      }
    }

    initDeepLink();
    return () => {
      active = false;
      if (typeof unlisten === "function") unlisten();
    };
  }, [router]);

  useEffect(() => {
    let active = true;
    let timer = null;

    // Kiểm tra Engine định kỳ và tự động reconnect
    const checkHealth = async () => {
      try {
        await api.get("/api/health");
        if (active) {
          setEngineOnline(true);
          timer = setTimeout(checkHealth, 20000);
        }
      } catch {
        if (active) {
          setEngineOnline(false);
          timer = setTimeout(checkHealth, 2000);
        }
      }
    };

    checkHealth();

    // Nhận log realtime qua WebSocket
    let ws;
    const connectWs = () => {
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
    };
    connectWs();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, []);

  const goTo = (navId) => router.push(pathOf(findNavItem(navId).item));
  const { user } = session;

  return (
    <div className="flex h-screen w-screen bg-background text-foreground antialiased overflow-hidden">
      <IntroMusic />
      <Sidebar activeTab={activeTab} open={sidebarOpen} />
      <div className="flex-1 flex flex-col min-w-0 bg-background overflow-hidden">
        <SessionContext.Provider value={session}>
          <Header
            activeTab={activeTab}
            engineOnline={engineOnline}
            user={user}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
          />
        </SessionContext.Provider>
        <main className="flex-1 overflow-y-auto p-6 bg-muted/20">{children}</main>
        {SHOW_SYSTEM_LOG && <ConsoleTerminal logs={logs} />}
      </div>
    </div>
  );
}
