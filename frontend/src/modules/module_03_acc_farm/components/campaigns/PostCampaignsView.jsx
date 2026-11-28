"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarClock,
  CheckCircle2,
  Eye,
  FileText,
  Megaphone,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { toast } from "@/lib/toast";
import {
  deletePostCampaign,
  listPostCampaigns,
  resumePostCampaign,
  stopPostCampaign,
} from "../../service";
import { PostCampaignDetailDialog } from "./PostCampaignDetailDialog";
import {
  PostsBar,
  SlotChips,
  StatusPill,
  campaignStatusShort,
  formatDateTime,
} from "./campaignUi";

const ITEMS_PER_PAGE = 10;
const REFRESH_MS = 15000;

const STATUS_FILTERS = [
  { value: "ALL", label: "Tất cả trạng thái" },
  { value: "ACTIVE", label: "Đang hoạt động" },
  { value: "STOPPED", label: "Tạm dừng" },
  { value: "COMPLETED", label: "Hoàn thành" },
];

function StatCard({ title, value, desc, icon, tone = "blue" }) {
  const toneBox =
    tone === "emerald"
      ? "bg-emerald-50 text-emerald-600"
      : tone === "amber"
        ? "bg-amber-50 text-amber-600"
        : "bg-blue-50 text-blue-600";
  return (
    <Card className="h-full border-slate-200 bg-white p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          {title}
        </p>
        <span
          className={`flex size-9 items-center justify-center rounded-lg ${toneBox}`}
        >
          {icon}
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-800">{value}</p>
      {desc && <p className="mt-1 text-xs text-slate-400">{desc}</p>}
    </Card>
  );
}

/**
 * Quản lý chiến dịch đăng bài Status nhiều khung giờ (/interact/campaigns).
 * Bố cục giống Quản lý chiến dịch Spam Group, thêm Dừng / Chạy tiếp / Sửa / Chạy lại khung giờ.
 */
export default function PostCampaignsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState(
    () => searchParams?.get("id") || null,
  );
  const [confirm, setConfirm] = useState(null); // { kind: "delete" | "stop", campaign }
  const [acting, setActing] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setCampaigns(await listPostCampaigns());
    } catch (err) {
      if (!quiet)
        toast.error(
          err?.message || "Không tải được danh sách chiến dịch.",
          "CHIẾN DỊCH",
        );
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // ?id=<chiến dịch> (từ trang Đăng bài) → mở chi tiết
  useEffect(() => {
    const id = searchParams?.get("id");
    if (id) setDetailId(id);
  }, [searchParams]);

  const openDetail = (id) => {
    setDetailId(id);
    router.replace(id ? `/interact/campaigns?id=${id}` : "/interact/campaigns");
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return campaigns.filter(
      (c) =>
        (statusFilter === "ALL" || c.status === statusFilter) &&
        (!q ||
          String(c.name || "")
            .toLowerCase()
            .includes(q)),
    );
  }, [campaigns, search, statusFilter]);

  useEffect(() => setPage(1), [search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paged = filtered.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE,
  );

  const stats = useMemo(
    () => ({
      total: campaigns.length,
      active: campaigns.filter((c) => c.status === "ACTIVE").length,
      completed: campaigns.filter((c) => c.status === "COMPLETED").length,
      posts: campaigns.reduce((n, c) => n + (Number(c.posts_success) || 0), 0),
    }),
    [campaigns],
  );

  const runAction = async (fn, success) => {
    setActing(true);
    try {
      await fn();
      toast.success(success, "CHIẾN DỊCH");
      setConfirm(null);
      await load(true);
      return true;
    } catch (err) {
      toast.error(err?.message || "Thao tác không thành công.", "CHIẾN DỊCH");
      return false;
    } finally {
      setActing(false);
    }
  };

  const handleResume = (c) =>
    runAction(
      () => resumePostCampaign(c.id),
      `Chiến dịch "${c.name}" chạy tiếp (khung đang dở chạy tiếp từ chỗ dừng).`,
    );

  const handleConfirm = async () => {
    if (!confirm) return;
    const { kind, campaign: c } = confirm;
    if (kind === "stop") {
      await runAction(
        () => stopPostCampaign(c.id),
        `Đã tạm dừng chiến dịch "${c.name}".`,
      );
    } else {
      const ok = await runAction(
        () => deletePostCampaign(c.id),
        `Đã xoá chiến dịch "${c.name}". Bài đã đăng vẫn còn trong Lịch sử.`,
      );
      if (ok && detailId === c.id) openDetail(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">
            Quản lý chiến dịch đăng bài
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Theo dõi các chiến dịch đăng Status nhiều khung giờ: dừng, chạy
            tiếp, sửa, chạy lại khung bị lỡ.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => load()}
            className="h-9 gap-2"
          >
            <RefreshCw
              className={`size-3.5 ${loading ? "animate-spin" : ""}`}
            />
            Làm mới
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => router.push("/interact/post?tab=status")}
            className="h-9 gap-2 bg-blue-600 hover:bg-blue-700"
          >
            <Plus className="size-3.5" />
            Tạo chiến dịch
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Tổng chiến dịch"
          value={stats.total}
          desc="Của tài khoản đang đăng nhập"
          icon={<Megaphone className="size-4" />}
        />
        <StatCard
          title="Đang hoạt động"
          value={stats.active}
          desc="Còn khung giờ chờ hoặc đang chạy"
          icon={<CalendarClock className="size-4" />}
          tone="amber"
        />
        <StatCard
          title="Hoàn thành"
          value={stats.completed}
          desc="Đã chạy hết các khung giờ"
          icon={<CheckCircle2 className="size-4" />}
          tone="emerald"
        />
        <StatCard
          title="Bài đã đăng"
          value={stats.posts}
          desc="Tổng bài đăng thành công"
          icon={<TrendingUp className="size-4" />}
        />
      </div>

      <Card className="flex flex-col gap-3 border-slate-200 p-4 shadow-xs sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên chiến dịch..."
            className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs focus:border-blue-500 focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 focus:border-blue-500 focus:outline-none"
          aria-label="Lọc trạng thái"
        >
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </Card>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-9 text-[11px] w-[70px]">Mã</TableHead>
            <TableHead className="h-9 text-[11px]">
              Chiến dịch
            </TableHead>
            <TableHead className="h-9 text-[11px]">Khung giờ</TableHead>
            <TableHead className="h-9 text-[11px]">Bài đăng</TableHead>
            <TableHead className="h-9 text-[11px]">Trạng thái</TableHead>
            {/* Cột Thao tác ghim mép phải: luôn nhìn thấy kể cả khi bảng phải cuộn ngang */}
            <TableHead className="sticky right-0 z-10 h-9 bg-white text-right text-[11px] shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.12)]">
              Thao tác
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && campaigns.length === 0 ? (
            Array.from({ length: 4 }, (_, i) => (
              <TableRow key={`sk-${i}`} className="text-xs">
                {Array.from({ length: 6 }, (__, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-full max-w-[120px]" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-12 text-center">
                <div className="flex flex-col items-center">
                  <FileText className="size-10 text-slate-300" />
                  <p className="mt-3 text-sm font-semibold text-slate-700">
                    Chưa có chiến dịch nào
                  </p>
                  <p className="mt-1 max-w-sm text-xs text-slate-400">
                    Vào Đăng bài viết Facebook → Status, bật &quot;Hẹn giờ (tạo
                    chiến dịch)&quot; và thêm khung giờ để tạo chiến dịch.
                  </p>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            paged.map((c, idx) => {
              const st = campaignStatusShort(c);
              const canEdit = Number(c.slot_running) === 0;
              return (
                <TableRow
                  key={c.id}
                  className="cursor-pointer text-xs"
                  onClick={() => openDetail(c.id)}
                >
                  <TableCell className="font-mono font-bold text-blue-600">
                    CD
                    {String((page - 1) * ITEMS_PER_PAGE + idx + 1).padStart(
                      3,
                      "0",
                    )}
                  </TableCell>
                  <TableCell>
                    <p className="text-xs font-bold text-slate-900">{c.name}</p>
                    <p className="text-[11px] text-slate-400">
                      {c.account_count} nick · tạo{" "}
                      {formatDateTime(c.created_at)}
                      {!c.on_this_machine && " · chạy trên máy khác"}
                    </p>
                  </TableCell>
                  <TableCell>
                    <SlotChips slots={c.slot_timeline} />
                  </TableCell>
                  <TableCell>
                    <PostsBar
                      success={Number(c.posts_success) || 0}
                      failed={Number(c.posts_failed) || 0}
                      expected={
                        (Number(c.account_count) || 0) *
                        (Number(c.slot_total) || 0)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <StatusPill {...st} />
                    {st.detail && (
                      <p className="mt-1 whitespace-nowrap pl-1 text-[11px] text-amber-700">
                        {st.detail}
                      </p>
                    )}
                  </TableCell>
                  <TableCell
                    className="sticky right-0 z-10 bg-white text-right shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.12)]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="inline-flex items-center justify-end gap-3">
                      <button
                        type="button"
                        title="Xem chi tiết"
                        aria-label="Xem chi tiết"
                        onClick={() => openDetail(c.id)}
                      >
                        <Eye className="size-4 text-slate-500 hover:text-slate-900" />
                      </button>
                      <button
                        type="button"
                        title={
                          canEdit
                            ? "Sửa chiến dịch"
                            : "Đang chạy 1 khung giờ, đợi xong rồi sửa"
                        }
                        aria-label="Sửa chiến dịch"
                        disabled={!canEdit}
                        onClick={() =>
                          router.push(
                            `/interact/post?tab=status&campaign=${c.id}`,
                          )
                        }
                        className="disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Pencil className="size-4 text-slate-500 hover:text-slate-900" />
                      </button>
                      {c.status === "STOPPED" ? (
                        <button
                          type="button"
                          title="Chạy tiếp"
                          aria-label="Chạy tiếp"
                          disabled={acting}
                          onClick={() => handleResume(c)}
                        >
                          <Play className="size-4 text-blue-600 hover:text-blue-700" />
                        </button>
                      ) : c.status === "ACTIVE" ? (
                        <button
                          type="button"
                          title="Tạm dừng chiến dịch"
                          aria-label="Tạm dừng chiến dịch"
                          onClick={() =>
                            setConfirm({ kind: "stop", campaign: c })
                          }
                        >
                          <Pause className="size-4 text-amber-600 hover:text-amber-700" />
                        </button>
                      ) : (
                        <span className="inline-block size-4" />
                      )}
                      <button
                        type="button"
                        title="Xoá chiến dịch"
                        aria-label="Xoá chiến dịch"
                        onClick={() =>
                          setConfirm({ kind: "delete", campaign: c })
                        }
                      >
                        <Trash2 className="size-4 text-rose-500 hover:text-rose-700" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      {filtered.length > ITEMS_PER_PAGE && (
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-slate-500">
            Hiển thị {(page - 1) * ITEMS_PER_PAGE + 1}–
            {Math.min(page * ITEMS_PER_PAGE, filtered.length)} của{" "}
            {filtered.length} chiến dịch
          </p>
          <div className="flex gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Trước
            </Button>
            <span className="px-2 py-1 text-xs font-semibold text-slate-600">
              {page}/{totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page === totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Sau
            </Button>
          </div>
        </div>
      )}

      <PostCampaignDetailDialog
        campaignId={detailId}
        open={Boolean(detailId)}
        onOpenChange={(open) => {
          if (!open) openDetail(null);
        }}
        onStop={(c) => setConfirm({ kind: "stop", campaign: c })}
        onResume={handleResume}
        onDelete={(c) => setConfirm({ kind: "delete", campaign: c })}
        onChanged={() => load(true)}
      />

      <ConfirmDialog
        isOpen={Boolean(confirm)}
        onClose={() => !acting && setConfirm(null)}
        onConfirm={handleConfirm}
        loading={acting}
        variant={confirm?.kind === "delete" ? "danger" : "warning"}
        title={
          confirm?.kind === "delete" ? "Xoá chiến dịch" : "Tạm dừng chiến dịch"
        }
        confirmText={confirm?.kind === "delete" ? "Xoá chiến dịch" : "Tạm dừng"}
        description={
          confirm?.kind === "delete"
            ? `Xoá vĩnh viễn chiến dịch "${confirm?.campaign?.name}" cùng các khung giờ. Khung đang chạy trên máy này sẽ dừng ngay. Bài đã đăng vẫn còn trong Lịch sử.`
            : `Tạm dừng chiến dịch "${confirm?.campaign?.name}": khung đang chạy dở được giữ nguyên chỗ đang làm, các khung chưa chạy tạm dừng theo. Bấm Chạy tiếp để chạy tiếp từ chỗ dừng (khung nào qua giờ hẹn trong lúc tạm dừng sẽ thành Bị lỡ).`
        }
      />
    </div>
  );
}
