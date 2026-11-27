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
import PostCampaignsView from "./components/campaigns/PostCampaignsView";
import { api } from "@/services/api";
import { useUnsavedChanges } from "@/components/UnsavedChangesContext";
import { shouldRestoreProgressView } from "@/modules/module_03_acc_farm/postSessionUi";

/**
 * Module 03: Đăng bài và tương tác tài khoản.
 *   interact.engage  -> Tab 1: Tương tác tài khoản (nuôi nick tự động từ main)
 *   interact.tiktok  -> Tải video từ TikTok theo từ khóa cho từng tài khoản
 *   interact.history -> Lịch sử (chuẩn từ nhánh main: FarmHistory)
 *   interact.post    -> Tab 2: Đăng bài viết Facebook (Status, Reels, Story)
 *   interact.campaigns -> Quản lý chiến dịch đăng Status nhiều khung giờ
 */
export default function AccFarmModule({ subPage = "interact.post" }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { requestNavigation, setUnsavedChanges } = useUnsavedChanges();

  const [postMode, setPostMode] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("module_03_post_mode");
      if (saved && ["status", "reels", "story"].includes(saved)) {
        return saved;
      }
    }
    return "status";
  });
  /** Status có Prompt AI hoặc bài viết → cần confirm trước khi đổi tab */
  const [statusNeedsLeaveConfirm, setStatusNeedsLeaveConfirm] = useState(false);

  // Ticket #56: Reels / Story — tắt guard "Ở lại / Rời đi" (chuyển màn không hỏi)
  useEffect(() => {
    if (postMode !== "reels" && postMode !== "story") return;
    setUnsavedChanges(false);
    setStatusNeedsLeaveConfirm(false);
  }, [postMode, setUnsavedChanges]);

  // Đồng bộ tab từ URL ?tab=status|reels|story
  useEffect(() => {
    const urlTab = searchParams?.get("tab");
    if (urlTab && ["status", "reels", "story"].includes(urlTab) && urlTab !== postMode) {
      // Chỉ chặn khi vẫn ở Status dirty và URL đòi về status; Reels/Story luôn cho qua
      if (statusNeedsLeaveConfirm && urlTab === "status") return;
      if (urlTab === "reels" || urlTab === "story") {
        setUnsavedChanges(false);
        setStatusNeedsLeaveConfirm(false);
      }
      setPostMode(urlTab);
      if (typeof window !== "undefined") {
        localStorage.setItem("module_03_post_mode", urlTab);
      }
    }
  }, [searchParams, postMode, statusNeedsLeaveConfirm, setUnsavedChanges]);

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

  const handleModeChange = (mode) => {
    if (mode === postMode) return;
    // Reels/Story: không hiện popup (kể cả đang chuyển sang tab này từ Status)
    if (
      postMode === "reels" ||
      postMode === "story" ||
      mode === "reels" ||
      mode === "story"
    ) {
      setUnsavedChanges(false);
      applyModeChange(mode);
      return;
    }
    // Status ↔ Status only path: dirty Prompt/bài → popup Context
    requestNavigation(() => applyModeChange(mode));
  };

  // 1. Phân hệ Tương tác tài khoản / Nuôi nick (/interact/engage) - Chuẩn từ main
  if (subPage === "interact.engage") {
    return <FarmEngage />;
  }

  // 2. Phân hệ Lịch sử (/interact/history) - Chuẩn từ main
  if (subPage === "interact.history") {
    return <FarmHistory />;
  }

  // Quản lý chiến dịch đăng bài (/interact/campaigns)
  if (subPage === "interact.campaigns") {
    return <PostCampaignsView />;
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

        {/* Dynamic Post Mode View — giữ Status mounted (ẩn) để không mất bài; chỉ chặn rời trang khi tab Status đang mở */}
        <div>
          <div className={postMode === "status" ? "block" : "hidden"}>
            <StatusPostView
              isActive={postMode === "status"}
              onHasPostsChange={setStatusNeedsLeaveConfirm}
            />
          </div>
          {postMode !== "status" && <ReelsPostView mode={postMode} />}
        </div>
      </div>
    );
  }

  return <ComingSoon />;
}
