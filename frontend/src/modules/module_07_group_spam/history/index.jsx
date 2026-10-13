"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  List,
  RotateCcw,
  Search,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const MOCK_HISTORY_DATA = [
  {
    id: 1,
    date: "02/10/2026",
    time: "10:45",
    type: "POST", // Đăng bài
    groupName: "Chợ Sinh Viên Hà Nội",
    groupUrl: "facebook.com/groups/chosinhvienhanoi",
    content: "Tuyển CTV làm online tại nhà, thời gian linh hoạt, không yêu cầu kinh nghiệm. Inbox mình tư vấn chi tiết nhé! 💙",
    account: "Nguyễn Văn Thuận (100024928174522)",
    status: "SUCCESS",
    result: "Đã đăng",
    mediaCount: 2,
  },
  {
    id: 2,
    date: "02/10/2026",
    time: "10:42",
    type: "COMMENT", // Bình luận
    groupName: "Việc Làm Online 2026",
    groupUrl: "facebook.com/groups/vieclamonline2026",
    content: "Bạn ơi ib mình nhé!",
    account: "Trần Cường (100067319293847)",
    status: "SUCCESS",
    result: "Đã bình luận",
    mediaCount: 0,
  },
  {
    id: 3,
    date: "02/10/2026",
    time: "10:38",
    type: "POST",
    groupName: "Hội Mua Bán Đồ Cũ",
    groupUrl: "facebook.com/groups/muabandocu2026",
    content: "Thanh lý laptop giá tốt cấu hình cao học tập văn phòng mượt mà, ai cần ib xem máy trực tiếp...",
    account: "Lê Hoàng Long (100055391934729)",
    status: "SUCCESS",
    result: "Đã đăng",
    mediaCount: 3,
  },
  {
    id: 4,
    date: "02/10/2026",
    time: "10:35",
    type: "COMMENT",
    groupName: "Tuyển Dụng Hà Nội",
    groupUrl: "facebook.com/groups/tuyendunghanoi",
    content: "Công việc phù hợp nè",
    account: "Đỗ Minh Quân (100092839203814)",
    status: "FAILED",
    result: "Lỗi",
    errorDetail: "Bị nhóm giới hạn tần suất bình luận (Spam rate limit)",
    mediaCount: 0,
  },
  {
    id: 5,
    date: "02/10/2026",
    time: "10:30",
    type: "POST",
    groupName: "Việc Làm Thêm Sinh Viên",
    groupUrl: "facebook.com/groups/vieclamthemsinhvien",
    content: "Tuyển nhân viên part-time làm theo ca, thu nhập ổn định 30-45k/h, hỗ trợ xoay ca linh hoạt.",
    account: "Trương Thuỳ Linh (100049282718292)",
    status: "SUCCESS",
    result: "Đã đăng",
    mediaCount: 1,
  },
  {
    id: 6,
    date: "02/10/2026",
    time: "10:25",
    type: "COMMENT",
    groupName: "Hội Yêu Thích Du Lịch",
    groupUrl: "facebook.com/groups/yeuthichdulich",
    content: "Chỗ này đẹp quá!",
    account: "Nguyễn Văn Thuận (100024928174522)",
    status: "SUCCESS",
    result: "Đã bình luận",
    mediaCount: 0,
  },
  {
    id: 7,
    date: "02/10/2026",
    time: "10:20",
    type: "POST",
    groupName: "Pass Đồ Sinh Viên",
    groupUrl: "facebook.com/groups/passdosinhvien",
    content: "Pass sách giá rẻ, ai cần ib mình chụp ảnh chi tiết từng cuốn nha, có ship cod toàn quốc.",
    account: "Trần Cường (100067319293847)",
    status: "SUCCESS",
    result: "Đã đăng",
    mediaCount: 4,
  },
  {
    id: 8,
    date: "02/10/2026",
    time: "10:15",
    type: "COMMENT",
    groupName: "Cộng Đồng Freelancer",
    groupUrl: "facebook.com/groups/congdongfreelancer",
    content: "Bạn có thể ib chi tiết không?",
    account: "Lê Hoàng Long (100055391934729)",
    status: "SUCCESS",
    result: "Đã bình luận",
    mediaCount: 0,
  },
  {
    id: 9,
    date: "02/10/2026",
    time: "10:10",
    type: "POST",
    groupName: "Hội Công Nghệ Thông Tin",
    groupUrl: "facebook.com/groups/congnghethongtin",
    content: "Chia sẻ tài liệu lập trình Fullstack React + Node.js trọn bộ từ cơ bản đến nâng cao hoàn toàn miễn phí...",
    account: "Đỗ Minh Quân (100092839203814)",
    status: "FAILED",
    result: "Lỗi",
    errorDetail: "Nhóm yêu cầu admin phê duyệt trước khi đăng bài (Pending Approval)",
    mediaCount: 1,
  },
  {
    id: 10,
    date: "02/10/2026",
    time: "10:05",
    type: "COMMENT",
    groupName: "Hội Làm Đẹp",
    groupUrl: "facebook.com/groups/hollamdep",
    content: "Sản phẩm này tốt không ạ?",
    account: "Trương Thuỳ Linh (100049282718292)",
    status: "SUCCESS",
    result: "Đã bình luận",
    mediaCount: 0,
  },
];

export default function GroupHistoryModule() {
  const [searchTerm, setSearchTerm] = useState("");
  const [seedingType, setSeedingType] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [timeRange, setTimeRange] = useState("custom");
  const [startDate, setStartDate] = useState("2026-10-01");
  const [endDate, setEndDate] = useState("2026-10-07");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [detailItem, setDetailItem] = useState(null);

  const filteredData = useMemo(() => {
    return MOCK_HISTORY_DATA.filter((item) => {
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const match =
          item.groupName.toLowerCase().includes(query) ||
          item.content.toLowerCase().includes(query) ||
          item.account.toLowerCase().includes(query);
        if (!match) return false;
      }
      if (seedingType !== "ALL" && item.type !== seedingType) {
        return false;
      }
      if (statusFilter !== "ALL" && item.status !== statusFilter) {
        return false;
      }
      return true;
    });
  }, [searchTerm, seedingType, statusFilter]);

  const totalTasks = 125;
  const totalSuccess = 110;
  const totalFailed = 12;
  const postCount = 60;
  const commentCount = 65;

  const handleResetFilter = () => {
    setSearchTerm("");
    setSeedingType("ALL");
    setStatusFilter("ALL");
    setTimeRange("custom");
    setStartDate("2026-10-01");
    setEndDate("2026-10-07");
    setCurrentPage(1);
  };

  const handleExportCSV = () => {
    const headers = ["STT,Thời gian,Loại,Nhóm,Nội dung,Trạng thái,Kết quả,Tài khoản"];
    const rows = filteredData.map(
      (item) =>
        `"${item.id}","${item.date} ${item.time}","${item.type === "POST" ? "Đăng bài" : "Bình luận"}","${item.groupName}","${item.content.replace(/"/g, '""')}","${item.status === "SUCCESS" ? "Thành công" : "Thất bại"}","${item.result}","${item.account}"`
    );
    const csvContent = "\uFEFF" + [headers, ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lich_su_spam_group_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const filterSummary = useMemo(() => {
    const parts = [];
    if (seedingType !== "ALL") parts.push(seedingType === "POST" ? "Đăng bài" : "Bình luận");
    if (statusFilter !== "ALL") parts.push(statusFilter === "SUCCESS" ? "Thành công" : "Thất bại");
    if (searchTerm.trim()) parts.push(`"${searchTerm.trim()}"`);
    return parts.length ? parts.join(", ") : "Tất cả";
  }, [seedingType, statusFilter, searchTerm]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3.5">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-full border border-blue-100 bg-blue-50 text-primary">
          <Clock className="size-6 text-primary" />
        </div>
        <div>
          <h1 className="font-heading text-xl font-bold tracking-tight text-slate-800">
            Lịch sử hoạt động
          </h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Xem lại các lần đăng bài và bình luận vào nhóm Facebook.
          </p>
        </div>
      </div>

      {/* Card 1: Bộ lọc tìm kiếm */}
      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <Search className="size-4 text-primary" />
            <h3 className="font-heading text-sm font-bold text-slate-800">Bộ lọc tìm kiếm</h3>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
            <span className="size-2 rounded-full bg-primary" />
            <span>Đang lọc theo: {filterSummary}</span>
          </div>
        </div>

        <div className="space-y-4 px-6 py-5">
          {/* Row 1 */}
          <div className="grid gap-4 md:grid-cols-12">
            <div className="md:col-span-6">
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-600">
                TÌM KIẾM
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Tìm kiếm tên chiến dịch, link, tên page/bài viết..."
                  className="h-9 pl-9 text-xs"
                />
              </div>
            </div>

            <div className="md:col-span-3">
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-600">
                LOẠI SEEDING
              </label>
              <select
                value={seedingType}
                onChange={(e) => setSeedingType(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-white px-3 text-xs text-slate-700 shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="ALL">Tất cả</option>
                <option value="POST">Đăng bài</option>
                <option value="COMMENT">Bình luận</option>
              </select>
            </div>

            <div className="md:col-span-3">
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-600">
                TRẠNG THÁI
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-white px-3 text-xs text-slate-700 shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="ALL">Tất cả</option>
                <option value="SUCCESS">Thành công</option>
                <option value="FAILED">Thất bại</option>
              </select>
            </div>
          </div>

          {/* Row 2 */}
          <div className="flex flex-wrap items-end gap-3 pt-1">
            <div className="w-full sm:w-44">
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-600">
                THỜI GIAN
              </label>
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-white px-3 text-xs text-slate-700 shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="custom">Tùy chọn</option>
                <option value="today">Hôm nay</option>
                <option value="yesterday">Hôm qua</option>
                <option value="last7">7 ngày qua</option>
                <option value="last30">30 ngày qua</option>
              </select>
            </div>

            <div className="w-full sm:w-44">
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-600">
                TỪ NGÀY
              </label>
              <div className="relative">
                <CalendarDays className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-9 pl-9 text-xs"
                />
              </div>
            </div>

            <div className="w-full sm:w-44">
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-600">
                ĐẾN NGÀY
              </label>
              <div className="relative">
                <CalendarDays className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-9 pl-9 text-xs"
                />
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleResetFilter}
                className="h-9 gap-1.5 border-slate-200 text-xs text-slate-600 hover:bg-slate-50"
              >
                <RotateCcw className="size-3.5 text-slate-500" /> Đặt lại
              </Button>
              <Button
                type="button"
                className="h-9 gap-1.5 bg-primary px-5 text-xs text-white hover:bg-primary/90"
              >
                <Filter className="size-3.5" /> Lọc
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Card 2: 3 Thống kê Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {/* Card Tổng tác vụ */}
        <Card className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white shadow-sm">
            <FileText className="size-6 stroke-[2.2]" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Tổng tác vụ</p>
            <p className="text-2xl font-bold tracking-tight text-blue-600">{totalTasks}</p>
            <p className="text-[11px] font-medium text-slate-400">
              Đăng bài: <span className="font-semibold text-slate-600">{postCount}</span> | Bình luận:{" "}
              <span className="font-semibold text-slate-600">{commentCount}</span>
            </p>
          </div>
        </Card>

        {/* Card Thành công */}
        <Card className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm">
            <Check className="size-6 stroke-[3]" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Thành công</p>
            <p className="text-2xl font-bold tracking-tight text-emerald-600">{totalSuccess}</p>
            <p className="text-[11px] font-semibold text-emerald-600">87.5%</p>
          </div>
        </Card>

        {/* Card Thất bại */}
        <Card className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-rose-600 text-white shadow-sm">
            <X className="size-6 stroke-[3]" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Thất bại</p>
            <p className="text-2xl font-bold tracking-tight text-rose-600">{totalFailed}</p>
            <p className="text-[11px] font-semibold text-rose-600">9.6%</p>
          </div>
        </Card>
      </div>

      {/* Card 3: Danh sách lịch sử */}
      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <List className="size-4 text-primary" />
            <h3 className="font-heading text-sm font-bold text-slate-800">Danh sách lịch sử</h3>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            className="h-8 gap-1.5 border-primary/30 text-xs text-primary hover:bg-blue-50"
          >
            <Download className="size-3.5" /> Xuất file
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-xs">
            <thead className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
              <tr>
                <th className="w-12 px-4 py-3 text-center">STT</th>
                <th className="w-28 px-3 py-3">Thời gian</th>
                <th className="w-28 px-3 py-3">Loại</th>
                <th className="min-w-[180px] px-3 py-3">Nhóm</th>
                <th className="min-w-[280px] px-3 py-3">Nội dung</th>
                <th className="w-28 px-3 py-3">Trạng thái</th>
                <th className="w-24 px-3 py-3">Kết quả</th>
                <th className="w-20 px-4 py-3 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredData.map((item) => (
                <tr key={item.id} className="transition-colors hover:bg-slate-50/50">
                  <td className="px-4 py-3 text-center text-slate-400 font-mono text-[11px]">
                    {item.id}
                  </td>
                  <td className="px-3 py-3">
                    <div className="text-[11px] font-medium text-slate-700">{item.date}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{item.time}</div>
                  </td>
                  <td className="px-3 py-3">
                    {item.type === "POST" ? (
                      <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-600">
                        Đăng bài
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[11px] font-semibold text-violet-600">
                        Bình luận
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className="font-semibold text-slate-800">{item.groupName}</span>
                  </td>
                  <td className="px-3 py-3">
                    <p className="line-clamp-1 max-w-[320px] text-slate-600 text-[11px]" title={item.content}>
                      {item.content}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    {item.status === "SUCCESS" ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-600">
                        <span className="size-1.5 rounded-full bg-emerald-500" /> Thành công
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[10px] font-semibold text-rose-600">
                        <X className="size-2.5 stroke-[3]" /> Thất bại
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {item.status === "SUCCESS" ? (
                      <span className="text-[11px] font-medium text-slate-600">{item.result}</span>
                    ) : (
                      <span className="text-[11px] font-bold text-rose-600">Lỗi</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => setDetailItem(item)}
                      className="inline-flex size-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                      title="Xem chi tiết"
                    >
                      <Eye className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}

              {!filteredData.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-400 text-xs">
                    Không tìm thấy bản ghi lịch sử nào phù hợp với bộ lọc.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Phân trang */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4 text-xs text-slate-500">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span>Hiển thị</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
              <span>mục/trang</span>
            </div>
            <span className="text-slate-400">|</span>
            <span>
              Hiển thị <strong className="text-slate-700">1 - {Math.min(filteredData.length, pageSize)}</strong> của{" "}
              <strong className="text-slate-700">{totalTasks}</strong> mục
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="flex size-7 items-center justify-center rounded border border-slate-200 text-slate-400 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage(1)}
              className={`size-7 rounded font-semibold text-xs transition-colors ${
                currentPage === 1 ? "bg-primary text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              1
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage(2)}
              className="size-7 rounded border border-slate-200 bg-white text-xs text-slate-600 hover:bg-slate-50"
            >
              2
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage(3)}
              className="size-7 rounded border border-slate-200 bg-white text-xs text-slate-600 hover:bg-slate-50"
            >
              3
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage(4)}
              className="size-7 rounded border border-slate-200 bg-white text-xs text-slate-600 hover:bg-slate-50"
            >
              4
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage(5)}
              className="size-7 rounded border border-slate-200 bg-white text-xs text-slate-600 hover:bg-slate-50"
            >
              5
            </button>
            <span className="px-1 text-slate-400">...</span>
            <button
              type="button"
              onClick={() => setCurrentPage(13)}
              className="size-7 rounded border border-slate-200 bg-white text-xs text-slate-600 hover:bg-slate-50"
            >
              13
            </button>
            <button
              type="button"
              disabled={currentPage >= 13}
              onClick={() => setCurrentPage((p) => p + 1)}
              className="flex size-7 items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      </Card>

      {/* Modal Xem chi tiết nhật ký */}
      {detailItem && (
        <Dialog open={Boolean(detailItem)} onOpenChange={(open) => !open && setDetailItem(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-800">
                <Clock className="size-4 text-primary" /> Chi tiết hoạt động #{detailItem.id}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">Loại tác vụ</span>
                  <p className="mt-0.5 font-bold text-slate-700">
                    {detailItem.type === "POST" ? "Đăng bài vào Group" : "Bình luận bài viết Group"}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">Thời gian thực thi</span>
                  <p className="mt-0.5 font-mono text-slate-700">
                    {detailItem.date} {detailItem.time}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">Trạng thái</span>
                  <div className="mt-0.5">
                    {detailItem.status === "SUCCESS" ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                        ● Thành công
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600">
                        ✕ Thất bại
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">Kết quả</span>
                  <p className="mt-0.5 font-bold text-slate-700">{detailItem.result}</p>
                </div>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Tài khoản thực hiện</span>
                <p className="mt-0.5 font-semibold text-slate-800">{detailItem.account}</p>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Nhóm mục tiêu</span>
                <div className="mt-0.5 flex items-center justify-between">
                  <span className="font-semibold text-slate-800">{detailItem.groupName}</span>
                  <a
                    href={`https://${detailItem.groupUrl}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    Xem nhóm <ExternalLink className="size-3" />
                  </a>
                </div>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Nội dung chi tiết</span>
                <div className="mt-1 max-h-36 overflow-auto rounded-lg border border-slate-200 bg-white p-3 text-[11px] text-slate-700 whitespace-pre-wrap leading-relaxed">
                  {detailItem.content}
                </div>
              </div>

              {detailItem.errorDetail && (
                <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3 text-rose-700">
                  <div className="flex items-center gap-1.5 font-bold text-[11px]">
                    <AlertCircle className="size-3.5 text-rose-500" /> Chi tiết lỗi:
                  </div>
                  <p className="mt-1 text-[11px] text-rose-600">{detailItem.errorDetail}</p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setDetailItem(null)}>
                Đóng
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
