"use client";

import React, { useState, useEffect, Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Activity, Play, Pause, ChevronRight, Sparkles } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { api } from "@/services/api";

function MiniProgressContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [activeSession, setActiveSession] = useState(null);

  useEffect(() => {
    let ignore = false;

    const checkStatus = async () => {
      try {
        const res = await api.get("/api/post/status");
        const d = res?.data ?? res;
        if (ignore) return;

        if (d && d.session_id && (d.is_running || d.is_paused) && !d.session_finished && !d.is_stopped) {
          const m = d.metrics || {};
          const total = (d.session_accounts && d.session_accounts.length) ||
            (m.running + m.waiting + m.completed + m.systemError + m.deadAccount) || 1;
          const done = (m.completed || 0) + (m.systemError || 0) + (m.deadAccount || 0);
          const percent = Math.min(100, Math.round((done / Math.max(1, total)) * 100));

          const currentActivity = d.threads?.[0]?.currentActivity || "Đang xử lý đăng bài...";

          setActiveSession({
            id: d.session_id,
            isRunning: d.is_running,
            isPaused: d.is_paused,
            postType: d.post_type || "status",
            total,
            done,
            percent,
            currentActivity,
          });
        } else {
          setActiveSession(null);
        }
      } catch (err) {
        // quiet error
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 2000);
    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, []);

  // Nếu không có phiên đang chạy -> Ẩn widget
  if (!activeSession) return null;

  // Ẩn widget nếu người dùng đang đứng ở chính màn hình giám sát của phiên này:
  // 1. Đang xem chi tiết qua ID: /interact/post?id=...
  const currentId = searchParams?.get("id") || searchParams?.get("session_id");
  const isAtIdDetail = (pathname === "/interact/post" || pathname === "/interact/post/") && currentId === activeSession.id;

  // 2. Đang ở trang /interact/post và đang mở đúng tab của phiên đang thực thi (Status / Reels / Story)
  const currentTab = searchParams?.get("tab");
  const savedTab = typeof window !== "undefined" ? localStorage.getItem("module_03_post_mode") : null;
  const activeTabOnPage = currentTab || savedTab || "status";
  const isAtRunningTab = (pathname === "/interact/post" || pathname === "/interact/post/") && !currentId && activeTabOnPage === activeSession.postType;

  if (isAtIdDetail || isAtRunningTab) return null;

  const handleClick = () => {
    const postType = activeSession.postType || "status";
    if (typeof window !== "undefined") {
      localStorage.setItem("module_03_post_mode", postType);
    }
    router.push(`/interact/post?tab=${postType}`);
  };

  const typeLabels = {
    status: "Status",
    reels: "Reels",
    story: "Story",
  };

  return (
    <div
      onClick={handleClick}
      className="fixed bottom-5 right-5 z-50 w-72 rounded-2xl border border-slate-200/90 bg-white/95 backdrop-blur-md p-3.5 shadow-xl transition-all duration-300 hover:shadow-2xl hover:scale-[1.02] active:scale-[0.99] cursor-pointer group animate-in fade-in slide-in-from-bottom-4"
    >
      {/* Header dòng 1: Icon + Tên + % */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                activeSession.isPaused ? "bg-amber-400" : "bg-blue-500"
              }`}
            />
            <span
              className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                activeSession.isPaused ? "bg-amber-500" : "bg-blue-600"
              }`}
            />
          </span>
          <span className="text-xs font-bold text-slate-800 truncate">
            {activeSession.isPaused ? "Tạm dừng" : "Đang đăng"}{" "}
            {typeLabels[activeSession.postType] || activeSession.postType}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs font-mono font-bold text-blue-600">
            {activeSession.done}/{activeSession.total}
          </span>
          <span className="text-[11px] font-semibold text-slate-400">
            ({activeSession.percent}%)
          </span>
        </div>
      </div>

      {/* Progress Bar shadcn */}
      <div className="mb-2">
        <Progress value={activeSession.percent} className="h-1.5" />
      </div>

      {/* Footer dòng 3: Tóm tắt hoạt động & nút xem chi tiết */}
      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
        <span className="truncate pr-2 font-medium group-hover:text-slate-700 transition-colors">
          {activeSession.currentActivity}
        </span>
        <span className="flex items-center font-bold text-blue-600 group-hover:underline shrink-0">
          Xem chi tiết
          <ChevronRight size={13} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </div>
  );
}

export function MiniProgress() {
  return (
    <Suspense fallback={null}>
      <MiniProgressContent />
    </Suspense>
  );
}

