"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import ConsoleTerminal from "@/components/ConsoleTerminal";
import { MODULE_REGISTRY } from "@/modules";
import api from "@/services/api";
import { WS_BASE } from "@/config/constants";
import { findNavItem } from "@/config/navigation";

export default function Home() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [engineOnline, setEngineOnline] = useState(false);
  const [logs, setLogs] = useState([]);

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
      <Sidebar activeTab={activeTab} onSelectTab={setActiveTab} />

      {/* WORKSPACE CHÍNH */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* HEADER TỔNG */}
        <Header activeTab={activeTab} onProfileClick={() => setActiveTab("profile")} />

        {/* CONTAINER HIỂN THỊ MODULE HIỆN TẠI */}
        <main className="flex-1 overflow-y-auto p-6 bg-background">
          {ModuleComponent ? (
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
