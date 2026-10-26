"use client";

import React, { useState, useMemo } from "react";
import {
  Search,
  X,
  Check,
  CheckCircle2,
  Users,
  Copy,
  Loader2,
  ExternalLink,
  Download,
  Trash2,
  FolderKanban,
  SlidersHorizontal,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "@/lib/toast";
import { initialsOf } from "@/modules/module_07_group_spam/shared/components";
import { AVATAR_COLORS } from "@/modules/module_07_group_spam/shared/constants";

const LIVE_STATUSES = new Set(["LIVE", "live", "Live"]);

export const DEFAULT_SCANNED_PAGES = [
  {
    id: "pg_1",
    page_key: "user:hoimuasamthoitrangonline",
    page_name: "Hội Mua Sắm & Thời Trang Online",
    uid: "1800847291048",
    page_url: "https://www.facebook.com/hoimuasamthoitrangonline",
    category: "Thời trang & Phụ kiện",
    follower_count: 520000,
    scanned_uid_count: 3450,
    scanned_post_count: 184,
    phone: "0988 123 456",
    email: "contact@lelegance.vn",
    website: "lelegance.vn",
    address: "Quận 1, TP. HCM",
    is_verified: true,
  },
  {
    id: "pg_2",
    page_key: "user:genzcosmeticshub",
    page_name: "GenZ Cosmetics Hub",
    uid: "1800918237194",
    page_url: "https://www.facebook.com/genzcosmeticshub",
    category: "Mỹ phẩm & Làm đẹp",
    follower_count: 184200,
    scanned_uid_count: 1120,
    scanned_post_count: 112,
    phone: "0932 778 999",
    email: "hello@genzcosmetics.vn",
    website: "genzcosmetics.vn",
    address: "Quận 3, TP. HCM",
    is_verified: true,
  },
  {
    id: "pg_3",
    page_key: "user:dogiadungthongminhlockn",
    page_name: "Đồ Gia Dụng Thông Minh Lockn",
    uid: "1800628194451",
    page_url: "https://www.facebook.com/dogiadungthongminhlockn",
    category: "Gia dụng & Đời sống",
    follower_count: 95400,
    scanned_uid_count: 480,
    scanned_post_count: 78,
    phone: "028 3822 554",
    email: "support@locknvn.com",
    website: "locknvn.com",
    address: "Đống Đa, Hà Nội",
    is_verified: false,
  },
  {
    id: "pg_4",
    page_key: "user:beautygardenofficialstore",
    page_name: "Beauty Garden Official Store",
    uid: "1800371940128",
    page_url: "https://www.facebook.com/beautygarden.vn",
    category: "Mỹ phẩm chính hãng",
    follower_count: 312000,
    scanned_uid_count: 1890,
    scanned_post_count: 145,
    phone: "1900 8899",
    email: "cskh@beautygarden.vn",
    website: "beautygarden.vn",
    address: "Đống Đa, Hà Nội",
    is_verified: true,
  },
  {
    id: "pg_5",
    page_key: "user:apexfitnessyogacenter",
    page_name: "Apex Fitness & Yoga Center",
    uid: "1800109482719",
    page_url: "https://www.facebook.com/apexfitness",
    category: "Gym & Sức khỏe",
    follower_count: 78500,
    scanned_uid_count: 640,
    scanned_post_count: 62,
    phone: "0888 456 789",
    email: "info@apexfit.vn",
    website: "apexfit.vn",
    address: "Hải Châu, Đà Nẵng",
    is_verified: false,
  },
];

const SAMPLE_PAGE_UIDS = [
  {
    id: "u1",
    name: "Nguyễn Thu Thảo",
    uid: "1800847291048",
    location: "Hà Nội",
    friends: "1.420 bạn bè",
    time: "10:42:15",
  },
  {
    id: "u2",
    name: "Lê Hoàng Quân",
    uid: "1800918237194",
    location: "TP. Hồ Chí Minh",
    friends: "530 bạn bè",
    time: "10:42:11",
  },
  {
    id: "u3",
    name: "Trần Minh Hằng",
    uid: "1800628194025",
    location: "Đà Nẵng",
    friends: "2.850 bạn bè",
    time: "10:42:08",
  },
  {
    id: "u4",
    name: "Vũ Đức Duy",
    uid: "1800371940128",
    location: "Hà Nội",
    friends: "920 bạn bè",
    time: "10:41:59",
  },
  {
    id: "u5",
    name: "Bùi Yến Nhi",
    uid: "1800109482937",
    location: "Hải Phòng",
    friends: "3.100 bạn bè",
    time: "10:41:55",
  },
  {
    id: "u6",
    name: "Đỗ Tuấn Kiệt",
    uid: "1800582919385",
    location: "Cần Thơ",
    friends: "180 bạn bè",
    time: "10:41:50",
  },
];

/* ─── Modal 1: Chọn tài khoản Facebook thực thi quét (Chọn tài khoản.png) ─── */
export function SelectAccountsModal({
  open,
  onClose,
  accounts = [],
  loading = false,
  selectedUids = [],
  onConfirm,
}) {
  const [draftUids, setDraftUids] = useState(selectedUids);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("ALL");
  const [farmTime, setFarmTime] = useState("ALL");

  const categories = useMemo(() => {
    const s = new Set();
    accounts.forEach((a) => {
      if (a.category || a.folder) s.add(a.category || a.folder);
    });
    return [...s];
  }, [accounts]);

  const filtered = useMemo(() => {
    return accounts.filter((acc) => {
      if (category !== "ALL" && (acc.category || acc.folder || "Tài khoản Clone") !== category) {
        return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = `${acc.name || ""} ${acc.uid || ""} ${acc.proxy || ""} ${acc.category || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [accounts, category, search]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1px]">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#F1F5F9] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[#EFF6FF] text-[#1877F2]">
              <Users className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0F172A]">
                Chọn tài khoản Facebook thực thi quét
              </h2>
              <p className="text-xs text-[#64748B]">
                Lựa chọn các tài khoản đang hoạt động (Live) để phân bổ luồng quét tự động
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#64748B] hover:bg-[#F1F5F9]"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-[#F1F5F9] bg-[#F8FAFC] px-6 py-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#94A3B8]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm theo Tên tài khoản, UID, Proxy, Thư mục..."
              className="h-9 w-full rounded-xl border border-[#E2E8F0] bg-white pl-10 pr-4 text-xs text-[#0F172A] outline-none focus:border-[#1877F2]"
            />
          </div>

          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs font-semibold text-[#334155] outline-none"
          >
            <option value="ALL">Tất cả danh mục</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            value={farmTime}
            onChange={(e) => setFarmTime(e.target.value)}
            className="h-9 rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs font-semibold text-[#334155] outline-none"
          >
            <option value="ALL">Tất cả thời gian nuôi</option>
            <option value="6M">Trên 6 tháng</option>
            <option value="1Y">Trên 1 năm</option>
          </select>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto px-6 py-3">
          {loading ? (
            <div className="py-12 text-center text-xs text-[#64748B]">
              <Loader2 className="mx-auto mb-2 size-6 animate-spin text-[#1877F2]" />
              Đang tải danh sách tài khoản...
            </div>
          ) : (
            <table className="w-full min-w-[860px] text-left text-xs">
              <thead className="sticky top-0 bg-[#F8FAFC] text-[11px] font-bold uppercase text-[#64748B]">
                <tr className="border-b border-[#E2E8F0]">
                  <th className="w-10 px-3 py-3">
                    <Checkbox
                      checked={filtered.length > 0 && draftUids.length >= filtered.length}
                      onCheckedChange={(c) => {
                        if (c) setDraftUids(filtered.map((a) => a.uid));
                        else setDraftUids([]);
                      }}
                    />
                  </th>
                  <th className="w-12 px-2 py-3">STT</th>
                  <th className="px-3 py-3">TÀI KHOẢN & HỌ TÊN</th>
                  <th className="px-3 py-3">UID FACEBOOK</th>
                  <th className="px-3 py-3">DANH MỤC</th>
                  <th className="px-3 py-3">TRẠNG THÁI TK</th>
                  <th className="px-3 py-3">ĐĂNG NHẬP</th>
                  <th className="px-3 py-3">PROXY GÁN KÈM</th>
                  <th className="px-3 py-3 text-right">THỜI GIAN NUÔI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {filtered.map((acc, idx) => {
                  const checked = draftUids.includes(acc.uid);
                  const isLive = LIVE_STATUSES.has(String(acc.status));
                  return (
                    <tr
                      key={acc.uid}
                      onClick={() =>
                        setDraftUids((prev) =>
                          checked ? prev.filter((u) => u !== acc.uid) : [...prev, acc.uid],
                        )
                      }
                      className={`cursor-pointer transition ${
                        checked ? "bg-[#EFF6FF]/70" : "hover:bg-[#F8FAFC]"
                      }`}
                    >
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(c) =>
                            setDraftUids((prev) =>
                              c ? [...prev, acc.uid] : prev.filter((u) => u !== acc.uid),
                            )
                          }
                        />
                      </td>
                      <td className="px-2 py-3 font-mono text-[#64748B]">
                        {String(idx + 1).padStart(2, "0")}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar className="size-8">
                            <AvatarFallback className={AVATAR_COLORS[idx % AVATAR_COLORS.length]}>
                              {initialsOf(acc.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-bold text-[#0F172A]">{acc.name}</p>
                            <p className="text-[11px] text-[#64748B]">
                              {acc.email || `${acc.uid}@fb.com`}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 font-mono text-[#334155]">
                        <div className="inline-flex items-center gap-1.5">
                          <span>{acc.uid}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard?.writeText(acc.uid);
                              toast.success(`Đã sao chép UID ${acc.uid}`);
                            }}
                            className="text-[#94A3B8] hover:text-[#1877F2]"
                          >
                            <Copy className="size-3" />
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="rounded-md bg-[#EFF6FF] px-2.5 py-1 text-[11px] font-semibold text-[#1D4ED8]">
                          {acc.category || acc.folder || "Tài khoản Clone"}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                            isLive
                              ? "bg-[#ECFDF5] text-[#059669]"
                              : "bg-[#FEF2F2] text-[#DC2626]"
                          }`}
                        >
                          <span
                            className={`size-1.5 rounded-full ${
                              isLive ? "bg-[#10B981]" : "bg-[#EF4444]"
                            }`}
                          />
                          {acc.status || "Live"}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#ECFDF5] px-2.5 py-0.5 text-[11px] font-bold text-[#059669]">
                          <CheckCircle2 className="size-3" />
                          Đã đăng nhập
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono text-[11px] text-[#475569]">
                        {acc.proxy || "Không dùng Proxy"}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-[#334155]">
                        {acc.farm_time || "8 tháng 12 ngày"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#F1F5F9] bg-[#F8FAFC] px-6 py-4">
          <div className="flex items-center gap-2 text-xs text-[#475569]">
            <CheckCircle2 className="size-4 text-[#10B981]" />
            <span>
              Đã chọn: <strong className="text-[#1877F2]">{draftUids.length} tài khoản</strong> (Sẵn
              sàng thực thi)
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-xl border border-[#CBD5E1] bg-white px-4 text-xs font-bold text-[#475569] hover:bg-[#F1F5F9]"
            >
              Hủy bỏ
            </button>
            <button
              type="button"
              onClick={() => {
                onConfirm(draftUids);
                onClose();
                toast.success(`Đã chọn ${draftUids.length} tài khoản thực thi.`);
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#1877F2] px-5 text-xs font-bold text-white shadow-sm hover:bg-[#166FE5]"
            >
              <Check className="size-4" />
              Xác nhận chọn ({draftUids.length})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Modal 2: Chọn page từ danh mục đã quét (Chọn page.png) ─── */
export function SelectPagesModal({
  open,
  onClose,
  availablePages = DEFAULT_SCANNED_PAGES,
  selectedPages = [],
  onConfirm,
}) {
  const [draftKeys, setDraftKeys] = useState(() => selectedPages.map((p) => p.page_key));
  const [activePageKey, setActivePageKey] = useState(
    selectedPages[0]?.page_key || availablePages[0]?.page_key || "",
  );
  const [leftSearch, setLeftSearch] = useState("");
  const [rightSearch, setRightSearch] = useState("");
  const [selectedUidIds, setSelectedUidIds] = useState(["u1", "u2"]);

  const filteredPages = useMemo(() => {
    if (!leftSearch.trim()) return availablePages;
    const q = leftSearch.trim().toLowerCase();
    return availablePages.filter((p) =>
      `${p.page_name || ""} ${p.uid || ""} ${p.page_key || ""}`.toLowerCase().includes(q),
    );
  }, [availablePages, leftSearch]);

  const activePage = useMemo(
    () =>
      availablePages.find((p) => p.page_key === activePageKey) ||
      availablePages[0] ||
      DEFAULT_SCANNED_PAGES[0],
    [availablePages, activePageKey],
  );

  const filteredUids = useMemo(() => {
    if (!rightSearch.trim()) return SAMPLE_PAGE_UIDS;
    const q = rightSearch.trim().toLowerCase();
    return SAMPLE_PAGE_UIDS.filter((u) =>
      `${u.name} ${u.uid} ${u.location}`.toLowerCase().includes(q),
    );
  }, [rightSearch]);

  if (!open) return null;

  const toggleDraftPage = (pageKey) => {
    setDraftKeys((prev) =>
      prev.includes(pageKey) ? prev.filter((k) => k !== pageKey) : [...prev, pageKey],
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1px]">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-[#F8FAFC] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E2E8F0] bg-[#E2E8F0]/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-white text-[#0F172A] shadow-sm">
              <FolderKanban className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0F172A]">
                Chọn page từ danh mục đã quét
              </h2>
              <p className="text-xs text-[#475569]">
                Lựa chọn các page từ danh sách đã thu thập trước đó để tiến hành quét mục tiêu
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#475569] hover:bg-black/5"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Body: 2 Columns (Left: Danh mục Page mục tiêu, Right: Chi tiết Page) */}
        <div className="grid flex-1 grid-cols-1 gap-4 overflow-auto p-5 lg:grid-cols-12">
          {/* Left Column (4 cols) */}
          <div className="flex flex-col rounded-2xl border border-[#E2E8F0] bg-white p-4 lg:col-span-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-bold text-[#0F172A]">
                Danh mục Page mục tiêu ({filteredPages.length})
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
              {filteredPages.map((pg) => {
                const isSelected = draftKeys.includes(pg.page_key);
                const isCurrent = activePage?.page_key === pg.page_key;
                return (
                  <div
                    key={pg.page_key}
                    onClick={() => {
                      setActivePageKey(pg.page_key);
                      if (!isSelected) toggleDraftPage(pg.page_key);
                    }}
                    className={`cursor-pointer rounded-xl border p-3 transition ${
                      isCurrent
                        ? "border-[#1877F2] bg-[#EFF6FF]/40 shadow-sm"
                        : "border-[#E2E8F0] bg-white hover:bg-[#F8FAFC]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleDraftPage(pg.page_key)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="text-xs font-bold text-[#0F172A] line-clamp-1">
                          {pg.page_name}
                        </span>
                      </div>
                      <span
                        className={`mt-1 size-2 shrink-0 rounded-full ${
                          isSelected ? "bg-[#10B981]" : "bg-[#CBD5E1]"
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
                      <span className="font-bold text-[#1877F2]">
                        Đã quét: {(pg.scanned_uid_count || 1250).toLocaleString("vi-VN")} UID
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-[#F1F5F9] pt-3 text-xs">
              <span className="text-[#64748B]">Tổng UID đã xử lý:</span>
              <strong className="font-mono font-bold text-[#1877F2]">5.050 UID</strong>
            </div>
          </div>

          {/* Right Column (8 cols) */}
          <div className="flex flex-col rounded-2xl border border-[#E2E8F0] bg-white p-4 lg:col-span-8">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F1F5F9] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#0F172A]">{activePage?.page_name}</h3>
                <p className="text-[11px] text-[#64748B]">
                  Quy mô:{" "}
                  <strong className="text-[#0F172A]">
                    {(activePage?.follower_count || 520000).toLocaleString("vi-VN")}
                  </strong>{" "}
                  Thành viên • Đã thu thập:{" "}
                  <strong className="text-[#1877F2]">
                    {(activePage?.scanned_uid_count || 3450).toLocaleString("vi-VN")}
                  </strong>{" "}
                  UID
                </p>
              </div>
              <button
                type="button"
                onClick={() => toast.success(`Đã xuất danh sách UID của ${activePage?.page_name}`)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#1877F2] px-3 text-xs font-bold text-white hover:bg-[#166FE5]"
              >
                <Download className="size-3.5" />
                Xuất UID Page này
              </button>
            </div>

            <div className="relative my-3">
              <Search className="absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-[#94A3B8]" />
              <input
                value={rightSearch}
                onChange={(e) => setRightSearch(e.target.value)}
                placeholder="Tìm UID, Tên, Vị trí..."
                className="h-9 w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] pl-9 pr-3 text-xs text-[#0F172A] outline-none focus:border-[#1877F2] focus:bg-white"
              />
            </div>

            {/* Sub-toolbar */}
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#F8FAFC] px-3 py-2">
              <div className="flex items-center gap-2 text-xs font-bold text-[#1877F2]">
                <span className="flex size-5 items-center justify-center rounded-full bg-[#1877F2] text-[10px] text-white">
                  {selectedUidIds.length}
                </span>
                Đã chọn: {selectedUidIds.length} UID
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => toast.info("Đã chuyển danh mục cho các UID đã chọn")}
                  className="rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#334155] hover:bg-slate-50"
                >
                  Chuyển danh mục
                </button>
                <button
                  type="button"
                  onClick={() => toast.success("Đã xuất file UID đã chọn")}
                  className="rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-2.5 py-1 text-[11px] font-bold text-[#1877F2] hover:bg-[#DBEAFE]"
                >
                  Xuất file chọn
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedUidIds([])}
                  className="inline-flex items-center gap-1 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-2.5 py-1 text-[11px] font-bold text-[#DC2626] hover:bg-[#FEE2E2]"
                >
                  <Trash2 className="size-3" />
                  Xóa
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F8FAFC] text-[10px] font-bold uppercase text-[#64748B]">
                  <tr className="border-b border-[#E2E8F0]">
                    <th className="w-8 px-2 py-2.5">
                      <Checkbox
                        checked={
                          filteredUids.length > 0 && selectedUidIds.length === filteredUids.length
                        }
                        onCheckedChange={(c) =>
                          setSelectedUidIds(c ? filteredUids.map((u) => u.id) : [])
                        }
                      />
                    </th>
                    <th className="w-10 px-2 py-2.5">STT</th>
                    <th className="px-2 py-2.5">HỌ VÀ TÊN</th>
                    <th className="px-2 py-2.5">UID / PROFILE LINK</th>
                    <th className="px-2 py-2.5">ĐỊA CHỈ</th>
                    <th className="px-2 py-2.5">SỐ BẠN BÈ</th>
                    <th className="px-2 py-2.5 text-right">THỜI GIAN</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {filteredUids.map((u, idx) => {
                    const checked = selectedUidIds.includes(u.id);
                    return (
                      <tr key={u.id} className="hover:bg-[#F8FAFC]">
                        <td className="px-2 py-2.5">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(c) =>
                              setSelectedUidIds((prev) =>
                                c ? [...prev, u.id] : prev.filter((id) => id !== u.id),
                              )
                            }
                          />
                        </td>
                        <td className="px-2 py-2.5 font-mono text-[#64748B]">
                          {String(idx + 1).padStart(2, "0")}
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center gap-2">
                            <Avatar className="size-7">
                              <AvatarFallback className={AVATAR_COLORS[idx % AVATAR_COLORS.length]}>
                                {initialsOf(u.name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-bold text-[#0F172A]">{u.name}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          <a
                            href={`https://www.facebook.com/${u.uid}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-[#1877F2] hover:underline"
                          >
                            {u.uid}
                            <ExternalLink className="size-3" />
                          </a>
                        </td>
                        <td className="px-2 py-2.5 text-[#475569]">{u.location}</td>
                        <td className="px-2 py-2.5 font-semibold text-[#1E293B]">{u.friends}</td>
                        <td className="px-2 py-2.5 text-right font-mono text-[#64748B]">
                          {u.time}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-[#E2E8F0] bg-white px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border border-[#CBD5E1] bg-white px-5 text-xs font-bold text-[#475569] hover:bg-[#F8FAFC]"
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            onClick={() => {
              const chosen = availablePages.filter((p) => draftKeys.includes(p.page_key));
              onConfirm(chosen);
              onClose();
              toast.success(`Đã chọn ${chosen.length} Fanpage mục tiêu.`);
            }}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#1877F2] px-6 text-xs font-bold text-white shadow-sm hover:bg-[#166FE5]"
          >
            <Check className="size-4" />
            Xác nhận chọn ({draftKeys.length} page)
          </button>
        </div>
      </div>
    </div>
  );
}
