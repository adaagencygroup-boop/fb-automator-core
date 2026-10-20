"use client";
import { useState, useEffect } from "react";
import { getPages } from "./service";
import FanpageList from "./FanpageList";
import AiPost from "./AiPost";
import ReelsPoster from "./ReelsPoster";
import TikTokDownloadTab from "./components/TikTokDownloadTab";
import YouTubeDownloadTab from "./components/YouTubeDownloadTab";
import HistoryTab from "./components/HistoryTab";
import PostDetailModal from "./components/PostDetailModal";
let globalPagesCache = null;
export default function PageManagerModule({ subPage } = {}) {
  const [currentTab, setCurrentTab] = useState(subPage || "pages.list");
  const [pages, setPages] = useState(() => {
    if (globalPagesCache && globalPagesCache.length > 0) return globalPagesCache;
    if (typeof window !== "undefined") {
      try {
        const local = localStorage.getItem("fb_pages_cache");
        if (local) {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed) && parsed.length > 0) {
            globalPagesCache = parsed;
            return parsed;
          }
        }
      } catch {}
    }
    return [];
  });
  const [loading, setLoading] = useState(() => (!globalPagesCache || globalPagesCache.length === 0));
  const [selectedPost, setSelectedPost] = useState(null);
  const [postModalOpen, setPostModalOpen] = useState(false);
  const loadData = async (forceLoading = false) => {
    if (forceLoading || (!globalPagesCache || globalPagesCache.length === 0)) {
      setLoading(true);
    }
    try {
      const pRes = await getPages();
      const list = Array.isArray(pRes?.pages) ? pRes.pages : (Array.isArray(pRes) ? pRes : []);
      if (list.length > 0) {
        globalPagesCache = list;
        try {
          localStorage.setItem("fb_pages_cache", JSON.stringify(list));
        } catch {}
        setPages(list);
      }
    } catch {}
    setLoading(false);
  };
  useEffect(() => {
    if (subPage) setCurrentTab(subPage);
  }, [subPage]);
  useEffect(() => {
    loadData();
  }, []);
  const handlePageFieldUpdate = (pageId, fields) => {
    setPages((prev) => {
      const updated = prev.map((p) => (String(p.page_id || p.id) === String(pageId) ? { ...p, ...fields } : p));
      globalPagesCache = updated;
      try {
        localStorage.setItem("fb_pages_cache", JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };
  const handleOpenPostDetail = (post) => {
    setSelectedPost(post);
    setPostModalOpen(true);
  };
  if (subPage === "pages.list") {
    return <FanpageList />;
  }
  if (subPage === "pages.ai_post") {
    return <AiPost />;
  }
  if (subPage === "pages.reels") {
    return <ReelsPoster />;
  }
  if (subPage === "pages.tiktok") {
    return <TikTokDownloadTab pages={pages} loading={loading} onPageUpdate={handlePageFieldUpdate} />;
  }
  if (subPage === "pages.youtube") {
    return <YouTubeDownloadTab pages={pages} loading={loading} onPageUpdate={handlePageFieldUpdate} />;
  }
  if (subPage === "pages.history") {
    return (
      <div className="space-y-4">
        <HistoryTab onSelectPost={handleOpenPostDetail} />
        <PostDetailModal open={postModalOpen} onOpenChange={setPostModalOpen} post={selectedPost} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-lg bg-card border border-border shadow-subtle">
        {[
          { id: "pages.list", label: "Danh Sách Fanpage" },
          { id: "pages.ai_post", label: "Đăng Bài AI" },
          { id: "pages.reels", label: "Đăng Video Reels" },
          { id: "pages.tiktok", label: "Tải Video TikTok" },
          { id: "pages.youtube", label: "Tải YouTube Shorts" },
          { id: "pages.history", label: "Lịch Sử / Nhật Ký" },
        ].map((tab) => (
          <button key={tab.id} type="button" onClick={() => setCurrentTab(tab.id)} className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${currentTab === tab.id ? "bg-primary text-white shadow-subtle" : "text-muted-foreground hover:text-foreground"}`}>
            {tab.label}
          </button>
        ))}
      </div>
      <div className={currentTab === "pages.list" ? "block" : "hidden"}>
        <FanpageList />
      </div>
      <div className={currentTab === "pages.ai_post" ? "block" : "hidden"}>
        <AiPost />
      </div>
      <div className={currentTab === "pages.reels" ? "block" : "hidden"}>
        <ReelsPoster />
      </div>
      <div className={currentTab === "pages.tiktok" ? "block" : "hidden"}>
        <TikTokDownloadTab pages={pages} loading={loading} onPageUpdate={handlePageFieldUpdate} />
      </div>
      <div className={currentTab === "pages.youtube" ? "block" : "hidden"}>
        <YouTubeDownloadTab pages={pages} loading={loading} onPageUpdate={handlePageFieldUpdate} />
      </div>
      <div className={currentTab === "pages.history" ? "block" : "hidden"}>
        <HistoryTab onSelectPost={handleOpenPostDetail} />
      </div>
      <PostDetailModal open={postModalOpen} onOpenChange={setPostModalOpen} post={selectedPost} />
    </div>
  );
}
