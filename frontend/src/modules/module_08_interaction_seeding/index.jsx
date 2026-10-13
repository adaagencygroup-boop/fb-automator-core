"use client";

import { useState } from "react";
import SeedingPageMain from "./seeding-page/page";
import SeedingProfileMain from "./seeding-profile/page";
import SeedingPostPage from "./seeding-post/page";
import SeedingHistoryPage from "./seeding-history/page";

const TABS = [
  { id: "seeding.page", label: "Seeding Page", icon: "📢" },
  { id: "seeding.profile", label: "Seeding Trang cá nhân", icon: "👤" },
  { id: "seeding.post", label: "Seeding Bài viết", icon: "📝" },
  { id: "seeding.history", label: "Lịch sử Seeding", icon: "📜" },
];

export default function InteractionSeedingModule({ subPage }) {
  const [activeTab, setActiveTab] = useState(subPage || "seeding.page");
  const currentTab = subPage || activeTab;

  return (
    <div className="space-y-4">
      {!subPage && (
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
          {TABS.map((tab) => {
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all flex items-center gap-2 ${
                  isActive
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300"
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {currentTab === "seeding.page" && <SeedingPageMain />}
      {currentTab === "seeding.profile" && <SeedingProfileMain />}
      {currentTab === "seeding.post" && <SeedingPostPage />}
      {currentTab === "seeding.history" && <SeedingHistoryPage />}
    </div>
  );
}
