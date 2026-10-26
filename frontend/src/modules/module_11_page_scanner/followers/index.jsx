"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Users,
  Layers,
  Plus,
  Trash2,
  Play,
  Pause,
  Square,
  Download,
  Search,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  ListChecks,
  Loader2,
  FolderInput,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "@/lib/toast";
import { getAccounts } from "@/modules/module_02_account_manager/service";
import { normalizeAccount, initialsOf } from "@/modules/module_07_group_spam/shared/components";
import { AVATAR_COLORS } from "@/modules/module_07_group_spam/shared/constants";
import { getScannedPages } from "../service";
import {
  DEFAULT_SCANNED_PAGES,
  SelectAccountsModal,
  SelectPagesModal,
} from "../shared/SelectPagesModal";

const INITIAL_FOLLOWERS_BY_PAGE = {
  "user:hoimuasamthoitrangonline": [
    {
      id: "fl_1",
      name: "Nguyễn Thu Thảo",
      uid: "1800847291048",
      location: "Hà Nội",
      friends: "1.420 bạn bè",
      time: "10:42:15",
    },
    {
      id: "fl_2",
      name: "Lê Hoàng Quân",
      uid: "1800918237194",
      location: "TP. Hồ Chí Minh",
      friends: "530 bạn bè",
      time: "10:42:11",
    },
    {
      id: "fl_3",
      name: "Trần Minh Hằng",
      uid: "1800628194025",
      location: "Đà Nẵng",
      friends: "2.850 bạn bè",
      time: "10:42:08",
    },
    {
      id: "fl_4",
      name: "Vũ Đức Duy",
      uid: "1800371940128",
      location: "Hà Nội",
      friends: "920 bạn bè",
      time: "10:41:59",
    },
    {
      id: "fl_5",
      name: "Bùi Yến Nhi",
      uid: "1800109482937",
      location: "Hải Phòng",
      friends: "3.100 bạn bè",
      time: "10:41:55",
    },
    {
      id: "fl_6",
      name: "Đỗ Tuấn Kiệt",
      uid: "1800582919385",
      location: "Cần Thơ",
      friends: "180 bạn bè",
      time: "10:41:50",
    },
  ],
  "user:genzcosmeticshub": [
    {
      id: "fl_7",
      name: "Phạm Ngọc Ánh",
      uid: "1000847291821",
      location: "TP. Hồ Chí Minh",
      friends: "2.150 bạn bè",
      time: "10:39:12",
    },
    {
      id: "fl_8",
      name: "Hoàng Minh Trang",
      uid: "1000918237412",
      location: "Hà Nội",
      friends: "890 bạn bè",
      time: "10:38:45",
    },
  ],
};

function StepperBox({ value, onChange, min = 1, max = 500, step = 1, disabled }) {
  return (
    <div className="inline-flex h-8 items-center overflow-hidden rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]">
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, Number(value || min) - step))}
        className="flex h-full w-7 items-center justify-center text-xs font-bold text-[#64748B] hover:bg-[#E2E8F0]/60 disabled:opacity-40"
      >
        −
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
        className="h-full w-12 border-x border-[#E2E8F0] bg-white text-center text-xs font-bold text-[#0F172A] outline-none"
      />
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, Number(value || min) + step))}
        className="flex h-full w-7 items-center justify-center text-xs font-bold text-[#64748B] hover:bg-[#E2E8F0]/60 disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

export default function PageScannerFollowers() {
  /* Accounts */
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [selectedUids, setSelectedUids] = useState([]);
  const [showAccountModal, setShowAccountModal] = useState(false);

  /* Target Pages */
  const [availablePages, setAvailablePages] = useState(DEFAULT_SCANNED_PAGES);
  const [targetPages, setTargetPages] = useState(DEFAULT_SCANNED_PAGES);
  const [showPageModal, setShowPageModal] = useState(false);

  /* Config */
  const [delayMin, setDelayMin] = useState(5);
  const [delayMax, setDelayMax] = useState(5);
  const [rotateEvery, setRotateEvery] = useState(50);
  const [maxMembersPerPage, setMaxMembersPerPage] = useState(50);
  const [prioritizeRecent, setPrioritizeRecent] = useState(true);
  const [dedupAcrossPages, setDedupAcrossPages] = useState(true);

  /* Run state */
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  /* Results state */
  const [activeTargetKey, setActiveTargetKey] = useState(DEFAULT_SCANNED_PAGES[0].page_key);
  const [leftSearch, setLeftSearch] = useState("");
  const [rightSearch, setRightSearch] = useState("");
  const [followersMap, setFollowersMap] = useState(INITIAL_FOLLOWERS_BY_PAGE);
  const [selectedRowIds, setSelectedRowIds] = useState(["fl_1", "fl_2"]);
  const [currentPage, setCurrentPage] = useState(1);

  /* Logs */
  const [logs, setLogs] = useState([
    {
      id: "l1",
      ts: "10:41:48",
      thread: "Thread-01",
      text: "Khởi chạy session Chrome Profile UID: 61594788917102 (Page Target: 1827491029)...",
      type: "info",
    },
    {
      id: "l2",
      ts: "10:41:50",
      thread: "Thread-01",
      text: "Proxy: Kết nối IPv4 SOCKS5 103.149.28.11:8080 - Trạng thái: Sạch (Ping 42ms)",
      type: "success",
    },
    {
      id: "l3",
      ts: "10:41:52",
      thread: "Thread-02",
      text: "Mở GraphQL Followers Endpoint: https://mbasic.facebook.com/page/1827491029/followers",
      type: "link",
    },
    {
      id: "l4",
      ts: "10:41:55",
      thread: "Thread-03",
      text: "[Thành công] Đã trích xuất UID 1000582919385 (Đỗ Tuấn Kiệt - Cần Thơ). Lọc trùng: HỢP LỆ",
      type: "success",
    },
    {
      id: "l5",
      ts: "10:41:59",
      thread: "Thread-02",
      text: "[Thành công] Đã trích xuất UID 1000371940128 (Vũ Đức Duy - Hà Nội). Bạn bè: 3.120",
      type: "success",
    },
    {
      id: "l6",
      ts: "10:42:05",
      thread: "Thread-01",
      text: "Đang phân trang con trỏ 'after:cursor=QVFIUkJ6b05z...' - Nghỉ 5 giây chống checkpoint...",
      type: "info",
    },
  ]);

  useEffect(() => {
    let ignore = false;
    getAccounts()
      .then((data) => {
        if (ignore) return;
        const list = (Array.isArray(data) ? data : data?.accounts || []).map((a, i) =>
          normalizeAccount(a, i),
        );
        setAccounts(list);
        setSelectedUids(list.map((a) => a.uid));
      })
      .catch(() => {})
      .finally(() => {
        if (!ignore) setAccountsLoading(false);
      });

    getScannedPages({ page: 1, page_size: 50 })
      .then((res) => {
        if (ignore || !res?.items?.length) return;
        const mapped = res.items.map((p, idx) => ({
          id: p.id || `db_${idx}`,
          page_key: p.page_key,
          page_name: p.page_name || p.page_key,
          uid: p.page_key?.replace(/^id:|^user:/, "") || `180084729${idx}`,
          page_url: p.page_url,
          category: p.category || "Thương mại & Dịch vụ",
          follower_count: p.follower_count || 125000,
          scanned_uid_count: 1200 + idx * 350,
        }));
        const combined = [...DEFAULT_SCANNED_PAGES];
        for (const m of mapped) {
          if (!combined.some((c) => c.page_key === m.page_key)) combined.push(m);
        }
        setAvailablePages(combined);
      })
      .catch(() => {});

    return () => {
      ignore = true;
    };
  }, []);

  const activePage = useMemo(
    () =>
      targetPages.find((p) => p.page_key === activeTargetKey) ||
      targetPages[0] ||
      DEFAULT_SCANNED_PAGES[0],
    [targetPages, activeTargetKey],
  );

  const filteredLeftPages = useMemo(() => {
    if (!leftSearch.trim()) return targetPages;
    const q = leftSearch.trim().toLowerCase();
    return targetPages.filter((p) =>
      `${p.page_name || ""} ${p.uid || ""}`.toLowerCase().includes(q),
    );
  }, [targetPages, leftSearch]);

  const currentFollowers = useMemo(() => {
    const list =
      followersMap[activePage?.page_key] ||
      INITIAL_FOLLOWERS_BY_PAGE["user:hoimuasamthoitrangonline"] ||
      [];
    if (!rightSearch.trim()) return list;
    const q = rightSearch.trim().toLowerCase();
    return list.filter((u) =>
      `${u.name} ${u.uid} ${u.location}`.toLowerCase().includes(q),
    );
  }, [followersMap, activePage, rightSearch]);

  const handleStartScan = () => {
    if (!targetPages.length) {
      toast.warning("Vui lòng chọn ít nhất 1 Fanpage cần quét followers.");
      return;
    }
    setIsRunning(true);
    setIsPaused(false);
    const now = new Date().toLocaleTimeString("vi-VN", { hour12: false });
    setLogs((prev) => [
      ...prev,
      {
        id: `l_${Date.now()}`,
        ts: now,
        thread: "Thread-01",
        text: `Bắt đầu thực thi quét followers cho ${targetPages.length} Fanpage (Tối đa ${maxMembersPerPage} UID/page)...`,
        type: "success",
      },
    ]);
    toast.success(`Đã khởi chạy quét followers cho ${targetPages.length} Fanpage!`);
    setTimeout(() => {
      setIsRunning(false);
      toast.success("Hoàn thành phiên quét danh sách người theo dõi Page!");
    }, 2500);
  };

  const handleExportCSV = (onlyCurrentPage = false) => {
    const rowsToExport = onlyCurrentPage
      ? currentFollowers
      : Object.values(followersMap).flat();
    const headers = ["STT", "Họ và tên", "UID Facebook", "Địa chỉ", "Số bạn bè", "Thời gian"];
    const csvRows = rowsToExport.map((u, idx) => [
      idx + 1,
      u.name,
      u.uid,
      u.location,
      u.friends,
      u.time,
    ]);
    const csv = [headers, ...csvRows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `followers_page_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Đã xuất tệp danh sách Followers (CSV) thành công.");
  };

  const handleDeleteSelectedUids = () => {
    if (!selectedRowIds.length || !activePage) return;
    const key = activePage.page_key;
    const curr = followersMap[key] || INITIAL_FOLLOWERS_BY_PAGE["user:hoimuasamthoitrangonline"];
    setFollowersMap((prev) => ({
      ...prev,
      [key]: curr.filter((u) => !selectedRowIds.includes(u.id)),
    }));
    setSelectedRowIds([]);
    toast.success(`Đã xóa ${selectedRowIds.length} UID khỏi danh sách.`);
  };

  return (
    <div className="space-y-5 pb-10">
      {/* ═══ TOP 2-COLUMN CARDS (Chuẩn Figma quét fl page.png) ═══ */}
      <div className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-2">
        {/* Card 1: Cấu hình chung, Chọn tài khoản & Nhóm quét */}
        <div className="flex flex-col rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#1877F2] text-xs font-bold text-white">
              1
            </span>
            <h3 className="text-[15px] font-bold text-[#0F172A]">
              Cấu hình chung, Chọn tài khoản & Nhóm quét
            </h3>
          </div>

          <div className="space-y-4">
            {/* TÀI KHOẢN THỰC THI QUÉT */}
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                TÀI KHOẢN THỰC THI QUÉT
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowAccountModal(true)}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#1877F2] px-4 text-xs font-bold text-white shadow-sm transition hover:bg-[#166FE5]"
                >
                  <Users className="size-4" />
                  Chọn tài khoản
                </button>
                <span className="inline-flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3.5 py-2 text-xs font-medium text-[#334155]">
                  <span className="size-2 rounded-full bg-[#10B981]" />
                  Đã chọn:{" "}
                  <strong className="font-bold text-[#0F172A]">
                    {selectedUids.length || 5} / {accounts.length || 5}
                  </strong>{" "}
                  tài khoản
                </span>
              </div>
            </div>

            {/* CHỈ ĐỊNH NHÓM CẦN QUÉT */}
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                CHỈ ĐỊNH NHÓM CẦN QUÉT
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowPageModal(true)}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#1877F2] px-4 text-xs font-bold text-white shadow-sm transition hover:bg-[#166FE5]"
                >
                  <Layers className="size-4" />
                  Chọn page muốn quét
                </button>
                <span className="inline-flex items-center gap-2 rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] px-3.5 py-2 text-xs font-semibold text-[#059669]">
                  <span className="size-2 rounded-full bg-[#10B981]" />
                  Đã chọn: <strong>{targetPages.length} nhóm</strong>
                </span>
              </div>
            </div>

            {/* Khoảng cách giữa các lần quét */}
            <div className="pt-1">
              <p className="mb-2 text-xs font-semibold text-[#1E293B]">
                Khoảng cách giữa các lần quét:
              </p>
              <div className="flex items-center gap-2">
                <StepperBox value={delayMin} onChange={setDelayMin} min={1} max={120} />
                <span className="text-xs text-[#64748B]">-</span>
                <StepperBox
                  value={delayMax}
                  onChange={(v) => setDelayMax(Math.max(delayMin, v))}
                  min={1}
                  max={180}
                />
                <span className="text-xs text-[#64748B]">giây</span>
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: Cấu hình quét nâng cao & Bộ lọc */}
        <div className="flex flex-col rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#1877F2] text-xs font-bold text-white">
              2
            </span>
            <h3 className="text-[15px] font-bold text-[#0F172A]">
              Cấu hình quét nâng cao & Bộ lọc
            </h3>
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-semibold text-[#1E293B]">
                Đổi tài khoản mới khi quét được:
              </span>
              <div className="flex items-center gap-2">
                <StepperBox
                  value={rotateEvery}
                  onChange={setRotateEvery}
                  min={1}
                  max={500}
                  step={10}
                />
                <span className="w-32 text-xs text-[#64748B]">nhóm / tài khoản</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-semibold text-[#1E293B]">
                Mỗi nhóm quét tối đa:
              </span>
              <div className="flex items-center gap-2">
                <StepperBox
                  value={maxMembersPerPage}
                  onChange={setMaxMembersPerPage}
                  min={10}
                  max={5000}
                  step={10}
                />
                <span className="w-32 text-xs text-[#64748B]">thành viên / nhóm</span>
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
              <label className="flex cursor-pointer items-center gap-2.5">
                <Checkbox
                  checked={prioritizeRecent}
                  onCheckedChange={(c) => setPrioritizeRecent(!!c)}
                />
                <span className="text-xs font-medium text-[#1E293B]">
                  Ưu tiên quét người mới theo dõi gần đây
                </span>
              </label>

              <label className="flex cursor-pointer items-center gap-2.5">
                <Checkbox
                  checked={dedupAcrossPages}
                  onCheckedChange={(c) => setDedupAcrossPages(!!c)}
                />
                <span className="text-xs font-medium text-[#1E293B]">
                  Tự động kiểm tra trùng UID giữa các page
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ PREVIEW CARD: Xem trước danh sách page muốn quét ═══ */}
      <div className="overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F1F5F9] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-[#EFF6FF] text-[#1877F2]">
              <ListChecks className="size-4" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="text-sm font-bold text-[#0F172A]">
                  Xem trước danh sách page muốn quét
                </h3>
                <span className="rounded-full bg-[#EFF6FF] px-2.5 py-0.5 text-[11px] font-bold text-[#1877F2]">
                  {targetPages.length} page đã chọn
                </span>
              </div>
              <p className="text-[11px] text-[#64748B]">
                Danh sách các trang đã được lập trình sẵn sàng cào danh sách followers
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowPageModal(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#BFDBFE] bg-white px-3.5 text-xs font-bold text-[#1877F2] hover:bg-[#EFF6FF]"
          >
            <Plus className="size-3.5" />
            Quản lý / Thay đổi page
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-[#F8FAFC] text-[11px] font-bold uppercase text-[#64748B]">
              <tr className="border-b border-[#E2E8F0]">
                <th className="w-16 px-6 py-3">STT</th>
                <th className="px-4 py-3">TÊN FANPAGE & ID</th>
                <th className="px-4 py-3">NGÀNH NGHỀ / LOẠI PAGE</th>
                <th className="px-4 py-3">QUY MÔ / FOLLOWERS</th>
                <th className="w-24 px-6 py-3 text-center">THAO TÁC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {targetPages.map((pg, idx) => (
                <tr key={pg.page_key} className="hover:bg-[#F8FAFC]">
                  <td className="px-6 py-3.5 font-mono text-[#64748B]">
                    {String(idx + 1).padStart(2, "0")}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-9 rounded-lg border border-[#E2E8F0]">
                        <AvatarFallback className={AVATAR_COLORS[idx % AVATAR_COLORS.length]}>
                          {initialsOf(pg.page_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-bold text-[#0F172A]">{pg.page_name}</p>
                        <p className="font-mono text-[11px] text-[#94A3B8]">UID: {pg.uid}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-[#475569]">{pg.category}</td>
                  <td className="px-4 py-3.5 font-bold text-[#0F172A]">
                    {(pg.follower_count || 120000).toLocaleString("vi-VN")} Followers
                  </td>
                  <td className="px-6 py-3.5 text-center">
                    <button
                      type="button"
                      onClick={() =>
                        setTargetPages((prev) => prev.filter((p) => p.page_key !== pg.page_key))
                      }
                      className="rounded-lg p-1.5 text-[#94A3B8] hover:bg-[#FEE2E2] hover:text-[#EF4444]"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ═══ BẮT ĐẦU THỰC THI BUTTON ═══ */}
      <div className="space-y-2.5">
        <button
          type="button"
          disabled={isRunning}
          onClick={handleStartScan}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1877F2] text-sm font-bold tracking-wide text-white shadow-sm transition hover:bg-[#166FE5] disabled:opacity-60"
        >
          {isRunning ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              ĐANG THỰC THI QUÉT FOLLOWERS...
            </>
          ) : (
            <>
              <Play className="size-4 fill-current" />
              BẮT ĐẦU THỰC THI
            </>
          )}
        </button>

        {isRunning && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsPaused((p) => !p)}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-[#FCA5A5] bg-white text-xs font-bold text-[#DC2626] hover:bg-[#FEF2F2]"
            >
              <Pause className="size-3.5" />
              {isPaused ? "TIẾP TỤC" : "TẠM DỪNG"}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsRunning(false);
                toast.warning("Đã dừng khẩn cấp phiên quét followers.");
              }}
              className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-[#FECACA] bg-[#FEE2E2] px-5 text-xs font-bold text-[#DC2626] hover:bg-[#FECACA]"
            >
              <Square className="size-3.5 fill-current" />
              DỪNG KHẨN CẤP
            </button>
          </div>
        )}
      </div>

      {/* ═══ MASTER-DETAIL RESULTS: Kết quả quét người theo dõi ═══ */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h3 className="text-base font-bold text-[#0F172A]">Kết quả quét người theo dõi</h3>
            <span className="rounded-full bg-[#EFF6FF] px-3 py-0.5 text-xs font-bold text-[#1877F2]">
              3.450 UID thu thập
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleExportCSV(false)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white px-3.5 text-xs font-bold text-[#1E293B] shadow-sm hover:bg-[#F8FAFC]"
          >
            <Download className="size-3.5 text-[#1877F2]" />
            Xuất toàn bộ file (Excel/CSV)
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Left Master Card (4 cols) */}
          <div className="flex flex-col rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-sm lg:col-span-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-bold text-[#0F172A]">
                Danh mục Page mục tiêu ({filteredLeftPages.length})
              </span>
              <SlidersHorizontal className="size-3.5 text-[#64748B]" />
            </div>

            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#94A3B8]" />
              <input
                value={leftSearch}
                onChange={(e) => setLeftSearch(e.target.value)}
                placeholder="Tìm tên Page, UID..."
                className="h-9 w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] pl-9 pr-3 text-xs text-[#0F172A] outline-none focus:border-[#1877F2] focus:bg-white"
              />
            </div>

            <div className="flex-1 space-y-2.5 overflow-y-auto pr-1">
              {filteredLeftPages.slice(0, 4).map((pg, idx) => {
                const active = activePage?.page_key === pg.page_key;
                return (
                  <div
                    key={pg.page_key}
                    onClick={() => setActiveTargetKey(pg.page_key)}
                    className={`cursor-pointer rounded-xl border p-3.5 transition ${
                      active
                        ? "border-2 border-[#1877F2] bg-[#EFF6FF]/30 shadow-sm"
                        : "border-[#E2E8F0] bg-white hover:bg-[#F8FAFC]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-bold text-[#0F172A]">
                        {pg.page_name}
                      </span>
                      <span
                        className={`size-2 shrink-0 rounded-full ${
                          idx === 0 ? "bg-[#10B981]" : "bg-[#CBD5E1]"
                        }`}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-[#64748B]">
                      <span>
                        Quy mô:{" "}
                        <strong className="text-[#0F172A]">
                          {(pg.follower_count || 120000).toLocaleString("vi-VN")}
                        </strong>{" "}
                        followers
                      </span>
                      <span className={active ? "font-bold text-[#1877F2]" : "font-semibold text-[#334155]"}>
                        Đã quét: {(pg.scanned_uid_count || 480).toLocaleString("vi-VN")} UID
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-[#F1F5F9] pt-3 text-xs">
              <span className="text-[#64748B]">Tổng UID đã xử lý:</span>
              <strong className="font-mono font-bold text-[#1877F2]">5.050 UID</strong>
            </div>
          </div>

          {/* Right Detail Card (8 cols) */}
          <div className="flex flex-col rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm lg:col-span-8">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F1F5F9] pb-3.5">
              <div>
                <h4 className="text-sm font-bold text-[#0F172A]">{activePage?.page_name}</h4>
                <p className="mt-0.5 text-xs text-[#64748B]">
                  Quy mô:{" "}
                  <strong className="text-[#0F172A]">
                    {(activePage?.follower_count || 520000).toLocaleString("vi-VN")}
                  </strong>{" "}
                  Thành viên • Đã thu thập:{" "}
                  <strong className="font-mono text-[#1877F2]">
                    {(activePage?.scanned_uid_count || 3450).toLocaleString("vi-VN")}
                  </strong>{" "}
                  UID
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleExportCSV(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#1877F2] px-4 text-xs font-bold text-white shadow-sm hover:bg-[#166FE5]"
              >
                <Download className="size-3.5" />
                Xuất UID Page này
              </button>
            </div>

            <div className="relative my-3.5">
              <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#94A3B8]" />
              <input
                value={rightSearch}
                onChange={(e) => setRightSearch(e.target.value)}
                placeholder="Tìm UID, Tên, Vị trí..."
                className="h-9 w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] pl-10 pr-4 text-xs text-[#0F172A] outline-none focus:border-[#1877F2] focus:bg-white"
              />
            </div>

            {/* Action bar */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#F8FAFC] px-3.5 py-2">
              <div className="flex items-center gap-2 text-xs font-bold text-[#1877F2]">
                <span className="flex size-5 items-center justify-center rounded-full bg-[#1877F2] text-[10px] text-white">
                  {selectedRowIds.length}
                </span>
                Đã chọn: {selectedRowIds.length} UID
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toast.info("Đã mở hộp thoại chuyển danh mục")}
                  className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#334155] hover:bg-slate-50"
                >
                  <FolderInput className="size-3.5" />
                  Chuyển danh mục
                </button>
                <button
                  type="button"
                  onClick={() => handleExportCSV(true)}
                  className="inline-flex items-center gap-1 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-1.5 text-xs font-bold text-[#1877F2] hover:bg-[#DBEAFE]"
                >
                  <Download className="size-3.5" />
                  Xuất file chọn
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSelectedUids}
                  className="inline-flex items-center gap-1 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-1.5 text-xs font-bold text-[#DC2626] hover:bg-[#FEE2E2]"
                >
                  <Trash2 className="size-3.5" />
                  Xóa
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F8FAFC] text-[11px] font-bold uppercase text-[#64748B]">
                  <tr className="border-b border-[#E2E8F0]">
                    <th className="w-8 px-3 py-2.5">
                      <Checkbox
                        checked={
                          currentFollowers.length > 0 &&
                          selectedRowIds.length === currentFollowers.length
                        }
                        onCheckedChange={(c) =>
                          setSelectedRowIds(c ? currentFollowers.map((u) => u.id) : [])
                        }
                      />
                    </th>
                    <th className="w-12 px-2 py-2.5">STT</th>
                    <th className="px-3 py-2.5">HỌ VÀ TÊN</th>
                    <th className="px-3 py-2.5">UID / PROFILE LINK</th>
                    <th className="px-3 py-2.5">ĐỊA CHỈ</th>
                    <th className="px-3 py-2.5">SỐ BẠN BÈ</th>
                    <th className="px-3 py-2.5 text-right">THỜI GIAN</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {currentFollowers.map((u, idx) => {
                    const checked = selectedRowIds.includes(u.id);
                    return (
                      <tr key={u.id} className="hover:bg-[#F8FAFC]">
                        <td className="px-3 py-3">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(c) =>
                              setSelectedRowIds((prev) =>
                                c ? [...prev, u.id] : prev.filter((id) => id !== u.id),
                              )
                            }
                          />
                        </td>
                        <td className="px-2 py-3 font-mono text-[#64748B]">
                          {String(idx + 1).padStart(2, "0")}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar className="size-7">
                              <AvatarFallback className={AVATAR_COLORS[idx % AVATAR_COLORS.length]}>
                                {initialsOf(u.name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-bold text-[#0F172A]">{u.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <a
                            href={`https://www.facebook.com/${u.uid}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-mono font-medium text-[#1877F2] hover:underline"
                          >
                            {u.uid}
                            <ExternalLink className="size-3" />
                          </a>
                        </td>
                        <td className="px-3 py-3 text-[#475569]">{u.location}</td>
                        <td className="px-3 py-3 font-semibold text-[#1E293B]">{u.friends}</td>
                        <td className="px-3 py-3 text-right font-mono text-[#64748B]">
                          {u.time}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="mt-4 flex items-center justify-between border-t border-[#F1F5F9] pt-3 text-xs">
              <span className="text-[#64748B]">
                Hiển thị <strong className="text-[#0F172A]">1 - {currentFollowers.length}</strong>{" "}
                của <strong className="text-[#0F172A]">3.450</strong> UID
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="flex size-7 items-center justify-center rounded-lg border border-[#E2E8F0] text-[#64748B] hover:bg-[#F8FAFC]"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                {[1, 2, 3].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setCurrentPage(p)}
                    className={`flex size-7 items-center justify-center rounded-lg text-xs font-bold ${
                      currentPage === p
                        ? "bg-[#1877F2] text-white"
                        : "border border-[#E2E8F0] text-[#475569] hover:bg-[#F8FAFC]"
                    }`}
                  >
                    {p}
                  </button>
                ))}
                <span className="px-1 text-[#94A3B8]">...</span>
                <button
                  type="button"
                  className="flex h-7 items-center justify-center rounded-lg border border-[#E2E8F0] px-2 text-xs font-semibold text-[#475569]"
                >
                  575
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => p + 1)}
                  className="flex size-7 items-center justify-center rounded-lg border border-[#E2E8F0] text-[#64748B] hover:bg-[#F8FAFC]"
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ LIVE AUTOMATION LOG CONSOLE ═══ */}
      <div className="overflow-hidden rounded-2xl border border-[#1E293B] bg-[#0B1120] shadow-md">
        <div className="flex items-center justify-between border-b border-[#1E293B] bg-[#0F172A] px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <span className="size-2.5 rounded-full bg-[#EF4444]" />
              <span className="size-2.5 rounded-full bg-[#F59E0B]" />
              <span className="size-2.5 rounded-full bg-[#10B981]" />
            </div>
            <span className="font-mono text-xs font-semibold text-[#94A3B8]">
              Live Automation Log Console [Thread-03 - Quét Followers]
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-[#10B981]/30 bg-[#10B981]/10 px-2.5 py-0.5 font-mono text-[10px] font-bold text-[#10B981]">
            <span className="size-1.5 animate-pulse rounded-full bg-[#10B981]" />
            RUNNING (3 THREADS)
          </span>
        </div>

        <div className="max-h-56 space-y-1.5 overflow-y-auto p-5 font-mono text-xs leading-relaxed">
          {logs.map((l) => (
            <div key={l.id} className="flex items-start gap-2 text-[#CBD5E1]">
              <span className="shrink-0 text-[#64748B]">[{l.ts}]</span>
              <span className="shrink-0 text-[#94A3B8]">[{l.thread}]</span>
              <span
                className={
                  l.type === "success"
                    ? "text-[#10B981]"
                    : l.type === "link"
                      ? "text-[#38BDF8] underline"
                      : "text-[#E2E8F0]"
                }
              >
                {l.text}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Modals */}
      <SelectAccountsModal
        open={showAccountModal}
        onClose={() => setShowAccountModal(false)}
        accounts={accounts}
        loading={accountsLoading}
        selectedUids={selectedUids}
        onConfirm={setSelectedUids}
      />
      <SelectPagesModal
        open={showPageModal}
        onClose={() => setShowPageModal(false)}
        availablePages={availablePages}
        selectedPages={targetPages}
        onConfirm={setTargetPages}
      />
    </div>
  );
}
