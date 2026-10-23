"use client";

import GroupScanInfoPage from "./scan-info/page";

export default function GroupScanModule({ subPage = "scan.info" }) {
  if (subPage === "scan.info") {
    return <GroupScanInfoPage />;
  }
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
      <p className="text-sm font-semibold text-slate-700">Chức năng đang được phát triển</p>
      <p className="mt-1 text-xs text-slate-400">Màn này thuộc Module 10 — sẽ nối sau bước quét thông tin nhóm.</p>
    </div>
  );
}
