"use client";

import PostEngagementScanPage from "./scan/page";
import PostEngagementListPage from "./list/page";

// Module 12 — Quét tài khoản đã tương tác bài viết.
const PAGES = {
  "engage.scan": PostEngagementScanPage,
  "engage.list": PostEngagementListPage,
};

export default function PostEngagementModule({ subPage = "engage.scan" }) {
  const Page = PAGES[subPage];
  if (Page) return <Page />;
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
      <p className="text-sm font-semibold text-slate-700">Chức năng đang được phát triển</p>
    </div>
  );
}
