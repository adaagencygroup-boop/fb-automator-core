"use client";

import GroupScanInfoPage from "./scan-info/page";
import GroupScanListPage from "./group-list/page";
import GroupScanMembersPage from "./scan-members/page";
import GroupScanMemberListPage from "./member-list/page";
import GroupScanHistoryPage from "./history/page";
import OverflowTooltip from "./components/OverflowTooltip";

const PAGES = {
  "scan.info": GroupScanInfoPage,
  "scan.list": GroupScanListPage,
  "scan.members": GroupScanMembersPage,
  "scan.member_list": GroupScanMemberListPage,
  "scan.history": GroupScanHistoryPage,
};

export default function GroupScanModule({ subPage = "scan.info" }) {
  const Page = PAGES[subPage];
  if (Page) {
    // Chữ bị cắt "…" ở bất kỳ trang / modal nào của Module 10 → rê chuột hiện đầy đủ.
    return (
      <OverflowTooltip className="contents">
        <Page />
      </OverflowTooltip>
    );
  }
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
      <p className="text-sm font-semibold text-slate-700">Chức năng đang được phát triển</p>
      <p className="mt-1 text-xs text-slate-400">Màn này thuộc Module 10 — sẽ nối sau bước quét thông tin nhóm.</p>
    </div>
  );
}
