"use client";

import GroupScanInfoPage from "./scan-info/page";
import GroupScanListPage from "./group-list/page";
import GroupScanMembersPage from "./scan-members/page";
import GroupScanMemberListPage from "./member-list/page";
import GroupScanPostsPage from "./scan-posts/page";
import GroupScanPostListPage from "./post-list/page";
import GroupScanHistoryPage from "./history/page";

export default function GroupScanModule({ subPage = "scan.info" }) {
  if (subPage === "scan.info") {
    return <GroupScanInfoPage />;
  }
  if (subPage === "scan.list") {
    return <GroupScanListPage />;
  }
  if (subPage === "scan.members") {
    return <GroupScanMembersPage />;
  }
  if (subPage === "scan.member_list") {
    return <GroupScanMemberListPage />;
  }
  if (subPage === "scan.posts") {
    return <GroupScanPostsPage />;
  }
  if (subPage === "scan.post_list") {
    return <GroupScanPostListPage />;
  }
  if (subPage === "scan.history") {
    return <GroupScanHistoryPage />;
  }
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
      <p className="text-sm font-semibold text-slate-700">Chức năng đang được phát triển</p>
      <p className="mt-1 text-xs text-slate-400">Màn này thuộc Module 10 — sẽ nối sau bước quét thông tin nhóm.</p>
    </div>
  );
}
