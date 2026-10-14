import React, { useState, useMemo } from "react";
import Link from "next/link";
import {
  Search,
  Check,
  RefreshCw,
  Users,
  Plus,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SectionCard, initialsOf } from "../../shared/components";
import { AVATAR_COLORS } from "../../shared/constants";

/**
 * ============================================================================
 * MODULE 07 - BƯỚC 1: CHỌN TÀI KHOẢN / NGƯỜI DÙNG ĐI SEEDING (GroupAccountSection)
 * Kế thừa nghiệp vụ từ FaceBook_Post_Group.py:
 * 1. Quản lý & nạp danh sách tài khoản Facebook (từ Module 2)
 * 2. Tìm kiếm nhanh tài khoản theo UID, Tên người dùng
 * 3. Chọn tất cả / Bỏ chọn từng tài khoản
 * 4. Phân trang linh hoạt (10, 20, 50 hoặc Xem tất cả)
 * 5. Hiển thị thông tin Live/Die, Proxy, Bạn bè
 * ============================================================================
 */
export default function GroupAccountSection({
  accounts = [],
  accountsLoading = false,
  selectedAccountKeys = [],
  setSelectedAccountKeys,
  onRefreshAccounts,
}) {
  const [accountSearch, setAccountSearch] = useState("");
  const [accountPage, setAccountPage] = useState(1);
  const [accountPageSize, setAccountPageSize] = useState(10);

  // Lọc tài khoản theo từ khóa tìm kiếm
  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();
    if (!query) return accounts;
    return accounts.filter((account) =>
      `${account.name} ${account.uid}`.toLowerCase().includes(query)
    );
  }, [accountSearch, accounts]);

  // Phân trang danh sách tài khoản
  const paginatedAccounts = useMemo(() => {
    const start = (accountPage - 1) * accountPageSize;
    return filteredAccounts.slice(start, start + accountPageSize);
  }, [filteredAccounts, accountPage, accountPageSize]);

  // Tổng số trang
  const totalPages = Math.ceil(filteredAccounts.length / accountPageSize) || 1;

  // Toggle chọn 1 tài khoản
  const toggleAccount = (key, checked) => {
    setSelectedAccountKeys((current) =>
      checked ? [...new Set([...current, key])] : current.filter((item) => item !== key)
    );
  };

  // Chọn tất cả tài khoản trong kết quả lọc
  const handleSelectAll = () => {
    setSelectedAccountKeys(filteredAccounts.map((account) => account.key));
  };

  // Làm mới và đồng bộ lại danh sách tài khoản
  const handleRefresh = () => {
    setAccountSearch("");
    setAccountPage(1);
    if (onRefreshAccounts) onRefreshAccounts();
  };

  return (
    <SectionCard
      number="1"
      title="Chọn tài khoản / người dùng đi seeding"
      description="Chọn danh sách tài khoản Facebook sẽ thực hiện đăng bài và tương tác"
      aside={
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-600">
          + Đã chọn {selectedAccountKeys.length}/{accounts.length} tài khoản
        </span>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={accountSearch}
            onChange={(event) => {
              setAccountSearch(event.target.value);
              setAccountPage(1);
            }}
            placeholder="Tìm kiếm UID, tên tài khoản Facebook..."
            className="pl-9"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleSelectAll}
          className="cursor-pointer"
        >
          <Check className="mr-1.5 size-3.5" /> Chọn tất cả ({filteredAccounts.length})
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 cursor-pointer"
          title="Đồng bộ danh sách từ Module 2"
          onClick={handleRefresh}
        >
          <RefreshCw className={`size-3.5 ${accountsLoading ? "animate-spin text-primary" : ""}`} />
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <div className="max-h-[330px] overflow-auto">
          <table className="w-full min-w-[650px] text-left text-[11px]">
            <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500 shadow-xs">
              <tr className="border-b border-slate-200">
                <th className="w-12 px-4 py-3">
                  <Checkbox
                    checked={
                      filteredAccounts.length > 0 &&
                      filteredAccounts.every((account) => selectedAccountKeys.includes(account.key))
                    }
                    onCheckedChange={(checked) =>
                      setSelectedAccountKeys(checked ? filteredAccounts.map((account) => account.key) : [])
                    }
                  />
                </th>
                <th className="px-3 py-3 font-semibold">Tài khoản Facebook</th>
                <th className="px-3 py-3 font-semibold">UID Facebook</th>
                <th className="px-3 py-3 font-semibold">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedAccounts.map((account, index) => {
                const selected = selectedAccountKeys.includes(account.key);
                return (
                  <tr
                    key={account.key}
                    className={`transition-colors ${selected ? "bg-blue-50/30" : "bg-white hover:bg-slate-50/50"}`}
                  >
                    <td className="px-4 py-2.5">
                      <Checkbox
                        checked={selected}
                        onCheckedChange={(checked) => toggleAccount(account.key, checked)}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar className="size-8 border-0">
                          <AvatarFallback className={AVATAR_COLORS[index % AVATAR_COLORS.length]}>
                            {initialsOf(account.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-semibold text-slate-700">{account.name}</p>
                          <p className="text-[10px] text-slate-400">
                            {account.friends || "Tài khoản Module 2"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-500">{account.uid}</td>
                    <td className="px-3 py-2.5">
                      <span
                        className={
                          account.status === "LIVE"
                            ? "font-semibold text-emerald-600"
                            : "font-semibold text-red-500"
                        }
                      >
                        ● {account.status === "LIVE" ? "Live" : account.status}
                      </span>
                    </td>
                  </tr>
                );
              })}

              {!accountsLoading && !filteredAccounts.length && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <Users className="size-8 text-slate-300" />
                      <p className="text-xs font-semibold text-slate-600">
                        {accounts.length === 0
                          ? "Chưa có tài khoản Facebook nào trong Module 2 (Quản lý tài khoản)"
                          : "Không tìm thấy tài khoản Facebook phù hợp"}
                      </p>
                      <p className="max-w-md text-[11px] text-slate-400">
                        {accounts.length === 0
                          ? "Vui lòng vào Module 2 để thêm hoặc import tài khoản Facebook, sau đó quay lại để chọn tài khoản đi seeding."
                          : "Thử tìm kiếm với từ khóa khác hoặc bấm nút làm mới."}
                      </p>
                      {accounts.length === 0 ? (
                        <div className="pt-2">
                          <Link
                            href="/accounts"
                            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-primary/90"
                          >
                            <Plus className="size-3.5" /> Thêm tài khoản tại Module 2
                          </Link>
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )}

              {accountsLoading && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                    <RefreshCw className="inline mr-2 size-4 animate-spin text-primary" />
                    Đang tải tài khoản từ Module 2...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* THANH PHÂN TRANG */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[10px] text-slate-400">
        <div className="flex items-center gap-4">
          <span>
            Hiển thị{" "}
            <strong className="text-slate-600">
              {Math.min(filteredAccounts.length, accountPageSize)}/{accounts.length}
            </strong>{" "}
            tài khoản
          </span>
          <span>
            Dòng / trang:{" "}
            <select
              value={accountPageSize}
              onChange={(e) => {
                setAccountPageSize(Number(e.target.value));
                setAccountPage(1);
              }}
              className="ml-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 outline-none"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </span>
          <button
            type="button"
            onClick={() => {
              setAccountPageSize(accounts.length || 10);
              setAccountPage(1);
            }}
            className="font-semibold text-primary hover:underline cursor-pointer"
          >
            Xem tất cả →
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={accountPage <= 1}
            onClick={() => setAccountPage((p) => Math.max(1, p - 1))}
            className="rounded border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
          >
            <ChevronLeft className="size-3" />
          </button>

          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map((page) => (
            <button
              key={page}
              type="button"
              onClick={() => setAccountPage(page)}
              className={`size-7 rounded font-semibold transition-colors cursor-pointer ${accountPage === page
                  ? "bg-primary text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
            >
              {page}
            </button>
          ))}

          <button
            type="button"
            disabled={accountPage >= totalPages}
            onClick={() => setAccountPage((p) => Math.min(totalPages, p + 1))}
            className="rounded border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
          >
            <ChevronRight className="size-3" />
          </button>
        </div>
      </div>
    </SectionCard>
  );
}
