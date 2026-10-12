"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import ConsoleTerminal from "@/components/ConsoleTerminal";
import { MODULE_REGISTRY } from "@/modules";
import api from "@/services/api";
import { WS_BASE } from "@/config/constants";
import { findNavItem } from "@/config/navigation";
import { usePersistentBoolean } from "@/lib/usePersistentBoolean";
import AuthGate from "@/components/AuthGate";

export default function Home() {
  return (
    <AuthGate>
      {(session) => <Workspace session={session} />}
    </AuthGate>
  );
}

function Workspace({ session }) {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [engineOnline, setEngineOnline] = useState(false);
  const [logs, setLogs] = useState([]);
  const [sidebarOpen, setSidebarOpen] = usePersistentBoolean("fb-automator.sidebar-open", true);
  const toggleSidebar = () => setSidebarOpen((v) => !v);

  useEffect(() => {
    // Check Engine Health via Axios
    api.get("/api/health")
      .then(() => setEngineOnline(true))
      .catch(() => setEngineOnline(false));

    // Connect WebSocket Logs
    let ws;
    try {
      ws = new WebSocket(WS_BASE);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const time = new Date().toLocaleTimeString();
          setLogs((prev) => [...prev.slice(-300), { time, ...data }]);
        } catch (e) {}
      };
    } catch (e) {}

    return () => {
      if (ws) ws.close();
    };
  }, []);

  // activeTab = id mục menu (src/config/navigation.js) -> module tương ứng
  const { item: activeNavItem } = findNavItem(activeTab);
  const activeModule = MODULE_REGISTRY.find((m) => m.id === activeNavItem.moduleId);
  const ModuleComponent = activeModule?.component;

  return (
    <div className="flex h-screen w-screen bg-background text-foreground antialiased overflow-hidden">
      {/* SIDEBAR TỔNG */}
      <Sidebar activeTab={activeTab} onSelectTab={setActiveTab} open={sidebarOpen} />

      {/* WORKSPACE CHÍNH */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* HEADER TỔNG */}
        <Header
          activeTab={activeTab}
          user={{
            name: session.user.username,
            initials: String(session.user.username || "?").slice(0, 2).toUpperCase(),
          }}
          onProfileClick={() => setActiveTab("profile")}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={toggleSidebar}
          isAdmin={session.isAdmin}
          adminUrl={session.adminUrl}
          onLogout={session.logout}
        />

        {/* CONTAINER HIỂN THỊ MODULE HIỆN TẠI */}
        <main className="flex-1 overflow-y-auto p-6 bg-background">
          {!session.user.modules_unlocked ? (
            <div className="mx-auto max-w-lg rounded-xl border border-border bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold tracking-tight text-sky-600">Chưa mở được các module</h2>
              <p className="mt-2 text-sm leading-5 text-slate-500">
                Tài khoản {session.user.username} đang ở trạng thái {session.user.status}. Cần admin duyệt hoặc gia hạn thì mới vào được 9 module.
              </p>
            </div>
          ) : ModuleComponent ? (
            <ModuleComponent />
          ) : (
            <div className="text-muted-foreground text-xs p-4">Chức năng đang được phát triển.</div>
          )}
        </main>

        {/* CONSOLE TERMINAL TỔNG */}
        <ConsoleTerminal logs={logs} engineOnline={engineOnline} />
      </div>
    </div>
  );
}
