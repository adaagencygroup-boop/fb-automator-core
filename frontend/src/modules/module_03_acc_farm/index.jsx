"use client";

import React, { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import ComingSoon from "@/components/ComingSoon";
import FarmEngage from "./components/FarmEngage";
import FarmHistory from "./components/FarmHistory";
import TikTokDownloadView from "./components/TikTokDownloadView";
import { PostModeTabs } from "./components/PostModeTabs";
import { StatusPostView } from "./components/StatusPostView";
import { ReelsPostView } from "./components/ReelsPostView";
import { api } from "@/services/api";
import { shouldRestoreProgressView } from "@/modules/module_03_acc_farm/postSessionUi";

/**
 * Module 03: Đăng bài và tương tác tài khoản.
 *   interact.engage  -> Tab 1: Tương tác tài khoản (nuôi nick tự động từ main)
 *   interact.tiktok  -> Tải video từ TikTok theo từ khóa cho từng tài khoản
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
    if (urlTab && ["status", "reels", "story"].includes(urlTab) && urlTab !== postMode) {
      setPostMode(urlTab);
      if (typeof window !== "undefined") {
        localStorage.setItem("module_03_post_mode", urlTab);
      }
    }
  }, [searchParams, postMode]);

  // Khi vào lại trang Đăng bài: ưu tiên tab của phiên progress còn trên BE (kể cả vừa xong chưa reset)
  useEffect(() => {
    if (subPage !== "interact.post") return undefined;
    let cancelled = false;
    const checkActiveSession = async () => {
      try {
        const res = await api.get("/api/post/status");
        const d = res?.data ?? res;
        if (cancelled || !shouldRestoreProgressView(d)) return;
        if (!d.post_type || !["status", "reels", "story"].includes(d.post_type)) return;

        setPostMode(d.post_type);
        if (typeof window !== "undefined") {
          localStorage.setItem("module_03_post_mode", d.post_type);
        }
        const urlTab = searchParams?.get("tab");
        if (urlTab !== d.post_type) {
          router.replace(`/interact/post?tab=${d.post_type}`);
        }
      } catch {
        // quiet error
      }
    };
    checkActiveSession();
    return () => {
      cancelled = true;
    };
    // Chỉ chạy khi mount trang post (rời module rồi quay lại sẽ remount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subPage]);

  const applyModeChange = (mode) => {
    setPostMode(mode);
    if (typeof window !== "undefined") {
      localStorage.setItem("module_03_post_mode", mode);
    }
    router.replace(`/interact/post?tab=${mode}`);
  };

  // Không còn hỏi "Ở lại / Rời đi": bài Status tự lưu nháp ngầm
  const handleModeChange = (mode) => {
    if (mode === postMode) return;
    applyModeChange(mode);
  };

  // 1. Phân hệ Tương tác tài khoản / Nuôi nick (/interact/engage) - Chuẩn từ main
  if (subPage === "interact.engage") {
    return <FarmEngage />;
  }

  // 2. Phân hệ Lịch sử (/interact/history) - Chuẩn từ main
  if (subPage === "interact.history") {
    return <FarmHistory />;
  }

  // Tải video từ TikTok (/interact/tiktok)
  if (subPage === "interact.tiktok") {
    return <TikTokDownloadView />;
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

        {/* Dynamic Post Mode View — giữ Status mounted (ẩn) để không mất bài */}
        <div>
          <div className={postMode === "status" ? "block" : "hidden"}>
            <StatusPostView isActive={postMode === "status"} />
          </div>
          {/* key: Reels và Story là 2 màn riêng — không dùng chung state tiến trình */}
          {postMode !== "status" && <ReelsPostView key={postMode} mode={postMode} />}
        </div>
      </div>
    );
  }

  return <ComingSoon />;
}
