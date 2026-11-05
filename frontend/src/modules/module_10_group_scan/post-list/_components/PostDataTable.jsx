"use client";

import { ExternalLink, Trash2, Eye } from "lucide-react";
import Pagination from "@/components/ui/pagination";
import CustomSelect from "@/components/ui/custom-select";

function IconLike() {
  return (
    <svg width="10" height="9" viewBox="0 0 10 9" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
      <path d="M6.11328 0.0208333C6.3737 0.0729167 6.57552 0.203125 6.71875 0.411458V0.411458C6.86198 0.619792 6.90755 0.854167 6.85547 1.11458L6.81641 1.34896C6.71224 1.86979 6.52344 2.35807 6.25 2.8138H9.0625C9.32292 2.82682 9.54427 2.91797 9.72656 3.08724C9.89583 3.26953 9.98698 3.49089 10 3.7513C9.98698 4.12891 9.81771 4.40885 9.49219 4.59115C9.71354 4.77344 9.83073 5.01432 9.84375 5.3138C9.84375 5.54818 9.77214 5.75 9.62891 5.91927C9.48568 6.08854 9.30339 6.19271 9.08203 6.23177C9.17318 6.375 9.21875 6.53776 9.21875 6.72005C9.19271 7.16276 8.97786 7.46224 8.57422 7.61849C8.58724 7.68359 8.59375 7.7487 8.59375 7.8138C8.58073 8.07422 8.48958 8.29557 8.32031 8.47786C8.13802 8.64713 7.91667 8.73828 7.65625 8.7513H5.76172C5.37109 8.7513 5.01953 8.64713 4.70703 8.4388L3.96484 7.93099C3.41797 7.55339 3.13802 7.03255 3.125 6.36849V5.6263V4.6888V4.20052C3.13802 3.60156 3.3724 3.11328 3.82812 2.73568L3.96484 2.61849C4.4987 2.1888 4.83724 1.64193 4.98047 0.977865L5.01953 0.763021C5.07161 0.502604 5.20182 0.300781 5.41016 0.157552C5.61849 0.0143229 5.85286 -0.03125 6.11328 0.0208333V0.0208333V0.0208333M0.625 3.1263H1.875C2.05729 3.1263 2.20703 3.1849 2.32422 3.30208C2.44141 3.41927 2.5 3.56901 2.5 3.7513V8.1263C2.5 8.30859 2.44141 8.45833 2.32422 8.57552C2.20703 8.69271 2.05729 8.7513 1.875 8.7513H0.625C0.442708 8.7513 0.292969 8.69271 0.175781 8.57552C0.0585938 8.45833 0 8.30859 0 8.1263V3.7513C0 3.56901 0.0585938 3.41927 0.175781 3.30208C0.292969 3.1849 0.442708 3.1263 0.625 3.1263V3.1263V3.1263" fill="#1D4ED8"/>
    </svg>
  );
}

function IconComment() {
  return (
    <svg width="10" height="9" viewBox="0 0 10 9" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
      <path d="M5 8.125C5.9375 8.11198 6.77734 7.92969 7.51953 7.57812V7.57812C8.27474 7.21354 8.8737 6.72526 9.31641 6.11328V6.11328C9.75911 5.5013 9.98698 4.81771 10 4.0625C9.98698 3.30729 9.75911 2.6237 9.31641 2.01172C8.8737 1.39974 8.27474 0.911458 7.51953 0.546875C6.77734 0.195312 5.9375 0.0130208 5 0C4.0625 0.0130208 3.22266 0.195312 2.48047 0.546875C1.72526 0.911458 1.1263 1.39974 0.683594 2.01172C0.240885 2.6237 0.0130208 3.30729 0 4.0625C0.0130208 4.96094 0.325521 5.7487 0.9375 6.42578C0.872396 6.90755 0.729167 7.31771 0.507812 7.65625C0.403646 7.83854 0.30599 7.97526 0.214844 8.06641C0.175781 8.11849 0.143229 8.15755 0.117188 8.18359C0.117188 8.19661 0.110677 8.20312 0.0976562 8.20312C0.0976562 8.20312 0.0976562 8.20964 0.0976562 8.22266V8.22266V8.22266V8.22266V8.22266V8.22266C0.00651041 8.3138 -0.0195312 8.42448 0.0195312 8.55469C0.0846354 8.6849 0.182292 8.75 0.3125 8.75C0.885417 8.72396 1.41927 8.60026 1.91406 8.37891C2.36979 8.17057 2.72135 7.96875 2.96875 7.77344C3.59375 8.00781 4.27083 8.125 5 8.125V8.125V8.125M2.5 3.4375C2.68229 3.4375 2.83203 3.49609 2.94922 3.61328V3.61328C3.06641 3.73047 3.125 3.88021 3.125 4.0625C3.125 4.24479 3.06641 4.39453 2.94922 4.51172C2.83203 4.62891 2.68229 4.6875 2.5 4.6875C2.31771 4.6875 2.16797 4.62891 4.55078 4.51172C4.43359 4.39453 4.375 4.24479 4.375 4.0625C4.375 3.88021 4.43359 3.73047 4.55078 3.61328C4.66797 3.49609 4.81771 3.4375 5 3.4375V3.4375V3.4375M6.875 4.0625C6.875 3.88021 6.93359 3.73047 7.05078 3.61328V3.61328C7.16797 3.49609 7.31771 3.4375 7.5 3.4375C7.68229 3.4375 7.83203 3.49609 7.94922 3.61328C8.06641 3.73047 8.125 3.88021 8.125 4.0625C8.125 4.24479 8.06641 4.39453 7.94922 4.51172C7.83203 4.62891 7.68229 4.6875 7.5 4.6875C7.31771 4.6875 7.16797 4.62891 7.05078 4.51172C6.93359 4.39453 6.875 4.24479 6.875 4.0625V4.0625V4.0625" fill="#047857"/>
    </svg>
  );
}

function IconShare() {
  return (
    <svg width="10" height="9" viewBox="0 0 10 9" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
      <path d="M5.99609 0.0595238C5.76172 0.176711 5.63802 0.365513 5.625 0.62593V1.87593H3.4375C2.46094 1.90197 1.65365 2.24051 1.01562 2.89156C0.364583 3.52958 0.0260417 4.33687 0 5.31343C0.0130208 6.0426 0.15625 6.64807 0.429688 7.12984C0.690104 7.61161 0.976562 7.9827 1.28906 8.24312C1.60156 8.49051 1.82292 8.64676 1.95312 8.71187C2.00521 8.73791 2.05729 8.75093 2.10938 8.75093C2.34375 8.72489 2.47396 8.59468 2.5 8.3603C2.48698 8.21708 2.42188 8.09338 2.30469 7.98921C2.21354 7.89807 2.1224 7.76135 2.03125 7.57905C1.9401 7.40978 1.88802 7.17541 1.875 6.87593C1.88802 6.34208 2.07031 5.89937 2.42188 5.5478C2.77344 5.19624 3.21615 5.01395 3.75 5.00093H5.625V6.25093C5.63802 6.51135 5.76172 6.70015 5.99609 6.81734C6.24349 6.9215 6.46484 6.88895 6.66016 6.71968L9.78516 3.90718C9.92839 3.77697 10 3.62072 10 3.43843C10 3.25614 9.92839 3.09989 9.78516 2.96968L6.66016 0.15718C6.46484 -0.0120908 6.24349 -0.0446429 5.99609 0.0595238V0.0595238V0.0595238" fill="#7E22CE"/>
    </svg>
  );
}

const PAGE_SIZE_OPTIONS = [
  { value: 5, label: "5" },
  { value: 10, label: "10" },
  { value: 20, label: "20" },
];

export default function PostDataTable({
  posts,
  allFilteredSelected,
  onToggleSelectAll,
  selectedPostIds,
  onToggleSelectPost,
  onRemovePost,
  currentPage,
  pageSize,
  totalFilteredCount,
  totalPages,
  onPageChange,
  onPageSizeChange,
}) {
  return (
    <>
      {/* Posts Data Table */}
      <div className="w-full border border-[#E2E8F0] rounded-xl overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="bg-[#F8FAFC] text-[10px] font-bold uppercase tracking-wide text-[#64748B] border-b border-[#E2E8F0]">
            <tr>
              <th className="py-2.5 px-3 text-center w-10">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={onToggleSelectAll}
                  className="size-3.5 rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                />
              </th>
              <th className="py-2.5 px-2 text-center w-10">STT</th>
              <th className="py-2.5 px-3 min-w-[220px]">LINK & NỘI DUNG BÀI VIẾT</th>
              <th className="py-2.5 px-3 w-36">TÁC GIẢ</th>
              <th className="py-2.5 px-3 text-center min-w-[190px]">
                CHỈ SỐ TƯƠNG TÁC (L / C / S)
              </th>
              <th className="py-2.5 px-3 w-28">NGÀY ĐĂNG</th>
              <th className="py-2.5 px-3 text-center w-24">THAO TÁC</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9]">
            {posts.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-10 text-xs text-slate-400">
                  Chưa có bài viết nào được quét trong nhóm này.
                </td>
              </tr>
            ) : (
              posts.map((post) => {
                const isChecked = selectedPostIds.has(post.id);
                return (
                  <tr
                    key={post.id}
                    className={`hover:bg-slate-50 transition-colors ${
                      isChecked ? "bg-[#EFF6FF]/25" : ""
                    }`}
                  >
                    <td className="py-2.5 px-3 text-center">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => onToggleSelectPost(post.id)}
                        className="size-3.5 rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                      />
                    </td>
                    <td className="py-2.5 px-2 text-center font-mono text-xs text-[#94A3B8]">
                      {post.stt}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex flex-col gap-1">
                        <p className="text-xs font-medium text-[#1E293B] line-clamp-2">
                          {post.title}
                        </p>
                        <a
                          href={`https://${post.linkText}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-[11px] text-[#2563EB] hover:underline"
                        >
                          <span className="truncate max-w-[200px]">{post.linkText}</span>
                          <ExternalLink className="size-3 text-[#2563EB] shrink-0" />
                        </a>
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`size-6 rounded-full ${post.authorTagBg} ${post.authorTagText} font-bold text-[11px] flex items-center justify-center shrink-0 uppercase`}
                        >
                          {post.authorTag}
                        </span>
                        <span className="font-semibold text-xs text-[#0F172A] truncate">
                          {post.authorName}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center justify-center gap-1.5 flex-wrap">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#EFF6FF] text-[#1D4ED8] text-xs font-semibold">
                          <IconLike />
                          <span>{post.likes}</span>
                        </span>
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#ECFDF5] text-[#047857] text-xs font-semibold">
                          <IconComment />
                          <span>{post.comments}</span>
                        </span>
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#F3E8FF] text-[#7E22CE] text-xs font-semibold">
                          <IconShare />
                          <span>{post.shares}</span>
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-[#64748B]">
                      {post.postedDate}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          title="Xem trước"
                          className="p-1 text-slate-400 hover:text-blue-600 rounded"
                        >
                          <Eye className="size-3.5" />
                        </button>
                        <a
                          href={`https://${post.linkText}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Mở bài viết"
                          className="p-1 text-slate-400 hover:text-blue-600 rounded"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={() => onRemovePost(post.id)}
                          title="Xóa bài viết"
                          className="p-1 text-slate-400 hover:text-rose-600 rounded"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Phân trang Footer */}
      <div className="flex flex-wrap justify-between items-center w-full pt-1 gap-2">
        <div className="flex items-center gap-2 text-xs text-[#64748B]">
          <span>
            Hiển thị {totalFilteredCount > 0 ? `${(currentPage - 1) * pageSize + 1} - ${Math.min(currentPage * pageSize, totalFilteredCount)}` : "0"} trong tổng số {totalFilteredCount} bài viết
          </span>
          <span>•</span>
          <div className="flex items-center gap-1">
            <span>Hàng mỗi trang:</span>
            <CustomSelect
              value={pageSize}
              onChange={onPageSizeChange}
              options={PAGE_SIZE_OPTIONS}
              size="sm"
              direction="up"
              className="w-16"
              buttonClassName="h-6 px-1.5 text-xs"
            />
          </div>
        </div>

        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />
      </div>
    </>
  );
}

