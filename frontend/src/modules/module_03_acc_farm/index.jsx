"use client";

import React, { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import ComingSoon from "@/components/ComingSoon";
import FarmEngage from "./components/FarmEngage";
import FarmHistory from "./components/FarmHistory";
import { PostModeTabs } from "./components/PostModeTabs";
import { StatusPostView } from "./components/StatusPostView";
import { ReelsPostView } from "./components/ReelsPostView";
import { api } from "@/services/api";

/**
 * Module 03: Đăng bài và tương tác tài khoản.
 *   interact.engage  -> Tab 1: Tương tác tài khoản (nuôi nick tự động từ main)
 *   interact.history -> Lịch sử (chuẩn từ nhánh main: FarmHistory)
 *   interact.post    -> Tab 2: Đăng bài viết Facebook (Status, Reels, Story)
 */
export default function AccFarmModule({ subPage = "interact.post" }) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [postMode, setPostMode] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("module_03_post_mode");
      if (saved && ["status", "reels", "story"].includes(saved)) {
        return saved;
      }
    }
    return "status";
  });

  // Đồng bộ tab từ URL ?tab=status|reels|story
  useEffect(() => {
    const urlTab = searchParams?.get("tab");
    if (urlTab && ["status", "reels", "story"].includes(urlTab)) {
      setPostMode(urlTab);
      if (typeof window !== "undefined") {
        localStorage.setItem("module_03_post_mode", urlTab);
      }
    }
  }, [searchParams]);

  useEffect(() => {
    // Kiểm tra server xem có phiên đăng bài đang chạy không để tự chuyển đúng tab (nếu URL chưa chỉ định tab)
    const checkActiveSession = async () => {
      try {
        const urlTab = searchParams?.get("tab");
        if (urlTab) return; // Nếu URL đã chỉ định rõ tab thì ưu tiên URL

        const res = await api.get("/api/post/status");
        const d = res?.data ?? res;
        if (d && (d.is_running || d.is_paused || (d.session_id && !d.session_finished))) {
          if (d.post_type && ["status", "reels", "story"].includes(d.post_type)) {
            setPostMode(d.post_type);
            if (typeof window !== "undefined") {
              localStorage.setItem("module_03_post_mode", d.post_type);
            }
          }
        }
      } catch {
        // quiet error
      }
    };
    checkActiveSession();
  }, [searchParams]);

  const handleModeChange = (mode) => {
    setPostMode(mode);
    if (typeof window !== "undefined") {
      localStorage.setItem("module_03_post_mode", mode);
    }
    router.replace(`/interact/post?tab=${mode}`);
  };

  // 1. Phân hệ Tương tác tài khoản / Nuôi nick (/interact/engage) - Chuẩn từ main
  if (subPage === "interact.engage") {
    return <FarmEngage />;
  }

  // 2. Phân hệ Lịch sử (/interact/history) - Chuẩn từ main
  if (subPage === "interact.history") {
    return <FarmHistory />;
  }

  // 3. Phân hệ Đăng bài Facebook (/interact/post)
  if (subPage === "interact.post") {
    return (
      <div className="space-y-6 container mx-auto">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">Đăng bài Facebook</h1>
          <p className="mt-1 text-sm text-slate-500">Tự động đăng bài, đăng reels, đăng story lên Facebook.</p>
        </div>
        {/* Mode Switcher Tabs (Status, Reels, Story) */}
        <div className="flex items-center justify-between flex-wrap gap-3 pb-1 border-b border-slate-200/60">
          <PostModeTabs
            currentMode={postMode}
            onChangeMode={handleModeChange}
          />
        </div>

        {/* Dynamic Post Mode View */}
        <div>
          {postMode === "status" ? (
            <StatusPostView />
          ) : (
            <ReelsPostView mode={postMode} />
          )}
        </div>
      </div>
    );
  }

  return <ComingSoon />;
}
