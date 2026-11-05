"use client";

import { Download, Search, Filter, ExternalLink, Eye } from "lucide-react";
import Pagination from "@/components/ui/pagination";
import CustomSelect from "@/components/ui/custom-select";
import { toast } from "@/lib/toast";

const MIN_LIKE_OPTIONS = [
  { value: "0", label: "Tất cả like" },
  { value: "50", label: "> 50 like" },
  { value: "100", label: "> 100 like" },
  { value: "500", label: "> 500 like" },
];

const MIN_CMT_OPTIONS = [
  { value: "0", label: "Tất cả cmt" },
  { value: "10", label: "> 10 cmt" },
  { value: "20", label: "> 20 cmt" },
  { value: "50", label: "> 50 cmt" },
];

const MIN_SHARE_OPTIONS = [
  { value: "0", label: "Tất cả share" },
  { value: "5", label: "> 5 share" },
  { value: "10", label: "> 10 share" },
  { value: "50", label: "> 50 share" },
];

const SORT_OPTIONS = [
  { value: "highest_interaction", label: "Tương tác cao nhất" },
  { value: "latest", label: "Mới nhất" },
  { value: "most_likes", label: "Nhiều like nhất" },
  { value: "most_comments", label: "Nhiều bình luận nhất" },
];

export default function LivePostResultSection({
  categories,
  selectedCategory,
  onSelectCategory,
  categorySearch,
  onCategorySearchChange,
  currentCategoryData,
  onExportAll,
  onExportGroup,
  postSearch,
  onPostSearchChange,
  minLikeFilter,
  onMinLikeFilterChange,
  minCmtFilter,
  onMinCmtFilterChange,
  minShareFilter,
  onMinShareFilterChange,
  sortOption,
  onSortOptionChange,
  onResetFilters,
  posts,
  allFilteredSelected,
  onToggleSelectAllPosts,
  selectedPostIds,
  onToggleSelectPost,
  currentPage,
  pageSize,
  totalFilteredCount,
  totalPages,
  onPageChange,
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F1F5F9] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <h3 className="text-sm font-bold text-[#0F172A]">
            Kết quả quét bài viết
          </h3>
          <span className="rounded-full bg-[#DBEAFE] px-2.5 py-0.5 text-[11px] font-semibold text-[#1D4ED8]">
            {totalFilteredCount} Bài viết
          </span>
        </div>

        <button
          type="button"
          onClick={onExportAll}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-[#F8FAFC] px-3 text-xs font-semibold text-[#334155] hover:bg-slate-100 transition-colors"
        >
          <Download className="size-3.5 text-[#64748B]" />
          <span>Xuất toàn bộ Excel / CSV</span>
        </button>
      </div>

      {/* 2 Column Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[580px]">
        {/* Cột trái: Danh mục nhóm */}
        <div className="lg:col-span-4 p-4 bg-[#F8FAFC]/50 border-r border-[#E2E8F0] flex flex-col gap-3">
          <span className="text-[11px] font-bold uppercase tracking-wide text-[#334155]">
            DANH MỤC NHÓM ({categories.length})
          </span>

          <div className="relative w-full">
            <Search className="size-3.5 absolute left-3 top-2 text-[#94A3B8]" />
            <input
              type="text"
              placeholder="Tìm nhóm..."
              value={categorySearch}
              onChange={(e) => onCategorySearchChange(e.target.value)}
              className="w-full h-7 pl-8 pr-3 text-xs text-slate-800 border border-[#E2E8F0] bg-white rounded-lg outline-none focus:border-[#1877F2]"
            />
          </div>

          <div className="flex flex-col gap-2 max-h-[480px] overflow-y-auto pr-0.5">
            {categories.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                Chưa có danh mục nào từ cơ sở dữ liệu.
              </div>
            ) : (
              categories.map((cat) => {
                const isSelected = cat.id === selectedCategory;
                return (
                  <button
                    type="button"
                    key={cat.id}
                    onClick={() => onSelectCategory(cat.id)}
                    className={`flex flex-col items-start p-3 gap-1 w-full rounded-xl text-left transition-all ${
                      isSelected
                        ? "bg-white border-2 border-[#1877F2] shadow-xs"
                        : "bg-white border border-[#E2E8F0] hover:border-slate-300"
                    }`}
                  >
                    <span className="font-bold text-xs text-[#0F172A] line-clamp-1">
                      {cat.name}
                    </span>
                    <div className="flex items-center justify-between w-full">
                      <span className="text-[11px] text-[#64748B]">
                        {cat.memberSummary}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                          isSelected
                            ? "bg-[#EFF6FF] text-[#1877F2]"
                            : "bg-[#F1F5F9] text-[#475569]"
                        }`}
                      >
                        {cat.postCount} bài
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Cột phải: Bảng bài viết & Bộ lọc Like, Comment, Share */}
        <div className="lg:col-span-8 p-4 flex flex-col gap-3.5 min-w-0">
          {/* Group Header Info */}
          <div className="flex flex-wrap justify-between items-center pb-3 border-b border-[#F1F5F9] gap-2">
            <div className="flex flex-col gap-0.5">
              <h4 className="font-bold text-sm text-[#0F172A]">
                {currentCategoryData?.fullName || currentCategoryData?.name || "Chưa chọn danh mục"}
              </h4>
              <div className="flex items-center gap-2 text-xs text-[#64748B]">
                <span>Quy mô: {currentCategoryData?.memberSummary || "0 Nhóm"}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={onExportGroup}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-3 text-xs font-semibold text-[#1877F2] hover:bg-blue-100 transition-colors"
            >
              <Download className="size-3 text-[#1877F2]" />
              <span>Xuất bài viết nhóm</span>
            </button>
          </div>

          {/* Bộ lọc tương tác nâng cao */}
          <div className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl flex flex-col gap-2.5">
            {/* Search & Quick Filters */}
            <div className="flex flex-wrap items-center gap-2 w-full">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="size-3.5 absolute left-2.5 top-2 text-[#94A3B8]" />
                <input
                  type="text"
                  placeholder="Tìm nội dung bài viết, ID bài, tác giả..."
                  value={postSearch}
                  onChange={(e) => onPostSearchChange(e.target.value)}
                  className="w-full h-7 pl-8 pr-2.5 text-xs text-slate-800 border border-[#E2E8F0] bg-white rounded-lg outline-none focus:border-[#1877F2]"
                />
              </div>

              <div className="w-28 shrink-0">
                <CustomSelect
                  value={minLikeFilter}
                  onChange={onMinLikeFilterChange}
                  options={MIN_LIKE_OPTIONS}
                  size="sm"
                  buttonClassName="h-7 text-xs"
                />
              </div>

              <div className="w-28 shrink-0">
                <CustomSelect
                  value={minCmtFilter}
                  onChange={onMinCmtFilterChange}
                  options={MIN_CMT_OPTIONS}
                  size="sm"
                  buttonClassName="h-7 text-xs"
                />
              </div>

              <div className="w-28 shrink-0">
                <CustomSelect
                  value={minShareFilter}
                  onChange={onMinShareFilterChange}
                  options={MIN_SHARE_OPTIONS}
                  size="sm"
                  buttonClassName="h-7 text-xs"
                />
              </div>
            </div>

            {/* Sorting and Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/60">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[#64748B] flex items-center gap-1">
                  <Filter className="size-3 text-[#94A3B8]" />
                  Sắp xếp:
                </span>
                <div className="w-44 shrink-0">
                  <CustomSelect
                    value={sortOption}
                    onChange={onSortOptionChange}
                    options={SORT_OPTIONS}
                    size="sm"
                    buttonClassName="h-7 text-xs font-semibold"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toast.success("Đã áp dụng bộ lọc bài viết!")}
                  className="inline-flex h-7 items-center gap-1 px-3 bg-[#1877F2] text-white rounded-lg text-xs font-semibold hover:bg-blue-600 transition-colors shadow-xs"
                >
                  <Search className="size-3" />
                  <span>Lọc dữ liệu</span>
                </button>
                <button
                  type="button"
                  onClick={onResetFilters}
                  className="inline-flex h-7 items-center px-2.5 bg-white border border-[#E2E8F0] text-[#64748B] rounded-lg text-xs font-medium hover:bg-slate-50 transition-colors"
                >
                  Đặt lại bộ lọc
                </button>
              </div>
            </div>
          </div>

          {/* Bảng bài viết quét được */}
          <div className="w-full border border-[#E2E8F0] rounded-xl overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-[#F8FAFC] text-[10px] font-bold uppercase tracking-wide text-[#64748B] border-b border-[#E2E8F0]">
                <tr>
                  <th className="py-2.5 px-3 text-center w-10">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={onToggleSelectAllPosts}
                      className="size-3.5 rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                    />
                  </th>
                  <th className="py-2.5 px-2 text-center w-10">STT</th>
                  <th className="py-2.5 px-3 min-w-[220px]">NỘI DUNG BÀI VIẾT</th>
                  <th className="py-2.5 px-3 w-36">TÁC GIẢ</th>
                  <th className="py-2.5 px-2 text-center w-20">LƯỢT LIKE</th>
                  <th className="py-2.5 px-2 text-center w-20">LƯỢT CMT</th>
                  <th className="py-2.5 px-2 text-center w-20">LƯỢT SHARE</th>
                  <th className="py-2.5 px-3 w-28">THỜI GIAN ĐĂNG</th>
                  <th className="py-2.5 px-3 text-center w-20">THAO TÁC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {posts.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-400">
                      Chưa có bài viết nào được quét. Nhấn &apos;BẮT ĐẦU THỰC THI&apos; để quét bài viết.
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
                              {post.content}
                            </p>
                            <a
                              href={`https://${post.linkText}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 font-mono text-[11px] text-[#1877F2] hover:underline"
                            >
                              <span className="truncate max-w-[220px]">{post.linkText}</span>
                              <ExternalLink className="size-3 text-[#1877F2] shrink-0" />
                            </a>
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <span
                              className={`size-7 rounded-full ${post.authorTagBg} ${post.authorTagText} font-bold text-xs flex items-center justify-center shrink-0 uppercase`}
                            >
                              {post.authorTag}
                            </span>
                            <div className="flex flex-col min-w-0">
                              <span className="font-semibold text-xs text-[#0F172A] truncate">
                                {post.authorName}
                              </span>
                              <span className="font-mono text-[10px] text-[#94A3B8] truncate">
                                {post.authorUid}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-[#EFF6FF] border border-[#DBEAFE] font-bold text-xs text-[#1D4ED8]">
                            {post.likesStr || post.likes || 0}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-[#ECFDF5] border border-[#D1FAE5] font-bold text-xs text-[#047857]">
                            {post.comments || 0}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-[#FFFBEB] border border-[#FEF3C7] font-bold text-xs text-[#B45309]">
                            {post.shares || 0}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[11px] text-[#64748B]">
                          {post.postedTime || "—"}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              title="Xem chi tiết"
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
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Phân trang */}
          <div className="flex flex-row justify-between items-center w-full pt-1">
            <span className="text-xs text-[#64748B]">
              Hiển thị {totalFilteredCount > 0 ? `${(currentPage - 1) * pageSize + 1} - ${Math.min(currentPage * pageSize, totalFilteredCount)}` : "0"} của {totalFilteredCount} bài viết
            </span>

            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={onPageChange}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

