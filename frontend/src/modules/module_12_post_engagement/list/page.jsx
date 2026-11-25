"use client";

import ModulePageHeader from "../components/ModulePageHeader";
import ResultsExplorer from "../components/ResultsExplorer";

/** Màn "Danh sách tài khoản": kho toàn bộ bài viết đã quét và tài khoản đã tương tác (lưu lâu dài trong CSDL). */
export default function PostEngagementListPage() {
  return (
    <div className="-m-6 min-h-full space-y-5 bg-[#F4F7FC] p-6">
      <ModulePageHeader navId="engage.list" />
      <ResultsExplorer title="Danh sách quét tương tác bài viết" headerSize="lg" allowDelete />
    </div>
  );
}
