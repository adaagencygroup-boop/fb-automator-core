import React, { useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import {
  Search,
  Check,
  RefreshCw,
  Users,
  Plus,
  MousePointerClick,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SectionCard, initialsOf } from "../../shared/components";
import { AVATAR_COLORS, MOCK_ACCOUNTS } from "../../shared/constants";
import { attachDragSelection } from "../../shared/drag-selection";

/**
 * ============================================================================
 * MODULE 07 - BƯỚC 1: CHỌN TÀI KHOẢN / NGƯỜI DÙNG ĐI SEEDING (GroupAccountSection)
 * Kế thừa nghiệp vụ từ FaceBook_Post_Group.py:
 * 1. Quản lý & nạp danh sách tài khoản Facebook (từ Module 2 hoặc 20 tài khoản clone tĩnh để test)
 * 2. Tìm kiếm nhanh tài khoản theo UID, Tên người dùng
 * 3. Chọn tất cả / Bỏ chọn từng tài khoản
 * 4. Cuộn trực tiếp không phân trang, hiển thị đầy đủ tài khoản
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
  // Gán trực tiếp danh sách tĩnh MOCK_ACCOUNTS (20 tài khoản) từ constants.js để test nhiều tài khoản
  const effectiveAccounts = MOCK_ACCOUNTS;

  const [accountSearch, setAccountSearch] = useState("");

  // Lọc tài khoản theo từ khóa tìm kiếm
  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();
    if (!query) return effectiveAccounts;
    return effectiveAccounts.filter((account) =>
      `${account.name} ${account.uid} ${account.email || ""}`.toLowerCase().includes(query)
    );
  }, [accountSearch, effectiveAccounts]);

  const tableContainerRef = useRef(null);
  const rowsRef = useRef(filteredAccounts);
  rowsRef.current = filteredAccounts;
  const selectedKeysRef = useRef(selectedAccountKeys);
  selectedKeysRef.current = selectedAccountKeys;

  // Gắn cơ chế drag-to-select (giữ chuột kéo để chọn nhiều dòng liên tục)
  useEffect(() => {
    if (!tableContainerRef.current) return;
    return attachDragSelection(tableContainerRef.current, {
      getVisibleKeys: () => rowsRef.current.map((row) => row.key),
      getSelectedKeys: () => selectedKeysRef.current,
      onSelectionChange: (keys) => {
        selectedKeysRef.current = keys;
        setSelectedAccountKeys(keys);
      },
      disabled: accountsLoading,
    });
  }, [accountsLoading, setSelectedAccountKeys]);

  // Toggle chọn 1 tài khoản
  const toggleAccount = (key, checked) => {
    setSelectedAccountKeys((current) =>
      checked ? [...new Set([...current, key])] : current.filter((item) => item !== key)
    );
  };

  // Click vào dòng tài khoản để toggle nhanh
  const handleRowClick = (accountKey, event) => {
    if (event.target.closest("button, input, select, textarea, a, [role='button']")) return;
    const isCurrentlySelected = selectedAccountKeys.includes(accountKey);
    toggleAccount(accountKey, !isCurrentlySelected);
  };

  // Chọn tất cả tài khoản trong kết quả lọc
  const handleSelectAll = () => {
    setSelectedAccountKeys(filteredAccounts.map((account) => account.key));
  };

  // Làm mới và đồng bộ lại danh sách tài khoản
  const handleRefresh = () => {
    setAccountSearch("");
    if (onRefreshAccounts) onRefreshAccounts();
  };

  return (
    <SectionCard
      number="1"
      title="Chọn tài khoản"
      description="Chọn danh sách tài khoản Facebook sẽ thực hiện đăng bài và tương tác"
      aside={
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-600">
          + Đã chọn {selectedAccountKeys.length}/{effectiveAccounts.length} tài khoản
        </span>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={accountSearch}
            onChange={(event) => setAccountSearch(event.target.value)}
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
          <Check className="mr-1.5 size-3.5" /> Chọn tất cả
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
        <div ref={tableContainerRef} className="max-h-[360px] overflow-auto select-none">
          <table className="w-full min-w-[650px] text-left text-[11px] select-none">
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
              {filteredAccounts.map((account, index) => {
                const selected = selectedAccountKeys.includes(account.key);
                return (
                  <tr
                    key={account.key}
                    data-account-key={account.key}
                    onClick={(e) => handleRowClick(account.key, e)}
                    className={`cursor-pointer transition-colors select-none ${selected ? "bg-blue-50/70 hover:bg-blue-100/60" : "bg-white hover:bg-slate-50"
                      }`}
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
                            {account.email || "Chưa có email"}
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

      {/* THÔNG TIN HIỂN THỊ */}
      <div className="mt-3 flex items-center justify-end text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5 text-slate-400">
          <MousePointerClick className="size-3 text-primary/70" />
          <span>Giữ & kéo chuột để chọn dải tài khoản</span>
        </span>
      </div>
    </SectionCard>
  );
}
