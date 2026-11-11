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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SectionCard, initialsOf } from "../../shared/components";
import { AVATAR_COLORS } from "../../shared/constants";
import { attachDragSelection } from "../../shared/drag-selection";

/**
 * ============================================================================
 * MODULE 07 - BƯỚC 2: CHỌN TÀI KHOẢN / NGƯỜI DÙNG ĐI SEEDING (GroupAccountSection)
 * Kế thừa nghiệp vụ từ FaceBook_Post_Group.py:
 * 1. Quản lý & nạp danh sách tài khoản Facebook thực tế từ Module 2 (Quản lý tài khoản)
 * 2. Tìm kiếm nhanh tài khoản theo UID, Tên người dùng, Email
 * 3. Chọn tất cả / Bỏ chọn từng tài khoản
 * 4. Cuộn trực tiếp không phân trang, hiển thị đầy đủ tài khoản
 * 5. Hiển thị thông tin Live/Die, Avatar, UID
 * ============================================================================
 */
export default function GroupAccountSection({
  accounts = [],
  accountsLoading = false,
  selectedAccountKeys = [],
  setSelectedAccountKeys,
  onRefreshAccounts,
  stepNumber = "2",
}) {
  const effectiveAccounts = useMemo(() => accounts || [], [accounts]);
  const isEligible = (account) =>
    String(account?.status || "").toLowerCase() === "live" &&
    String(account?.login_status || "").toLowerCase() === "logged_in";

  const [accountSearch, setAccountSearch] = useState("");

  // Lọc tài khoản theo từ khóa tìm kiếm
  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();
    if (!query) return effectiveAccounts;
    return effectiveAccounts.filter((account) =>
      `${account.name || ""} ${account.uid || ""} ${account.email || ""}`.toLowerCase().includes(query)
    );
  }, [accountSearch, effectiveAccounts]);

  const displayedAccounts = useMemo(
    () => filteredAccounts.filter((account) => String(account.login_status || "").toLowerCase() === "logged_in"),
    [filteredAccounts]
  );

  const tableContainerRef = useRef(null);
  const rowsRef = useRef(filteredAccounts);
  const selectedKeysRef = useRef(selectedAccountKeys);

  useEffect(() => {
    rowsRef.current = filteredAccounts;
    selectedKeysRef.current = selectedAccountKeys;
  }, [filteredAccounts, selectedAccountKeys]);

  useEffect(() => {
    if (!effectiveAccounts.length) return;
    const eligibleKeys = new Set(effectiveAccounts.filter(isEligible).map((account) => account.key));
    setSelectedAccountKeys((current) => current.filter((key) => eligibleKeys.has(key)));
  }, [effectiveAccounts, setSelectedAccountKeys]);

  // Gắn cơ chế drag-to-select (giữ chuột kéo để chọn nhiều dòng liên tục)
  useEffect(() => {
    if (!tableContainerRef.current) return;
    return attachDragSelection(tableContainerRef.current, {
      getVisibleKeys: () => rowsRef.current.filter(isEligible).map((row) => row.key),
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
    const account = effectiveAccounts.find((item) => item.key === key);
    if (!account || !isEligible(account)) return;
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
    setSelectedAccountKeys(filteredAccounts.filter(isEligible).map((account) => account.key));
  };

  // Làm mới và đồng bộ lại danh sách tài khoản
  const handleRefresh = () => {
    setAccountSearch("");
    if (onRefreshAccounts) onRefreshAccounts();
  };

  return (
    <SectionCard
      number={stepNumber}
      title="Chọn tài khoản"
      description="Chọn danh sách tài khoản Facebook sẽ thực hiện đăng bài và tương tác"
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={accountSearch}
            onChange={(event) => setAccountSearch(event.target.value)}
            placeholder="Tìm kiếm UID, tên tài khoản Facebook..."
            className="pl-9 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={handleSelectAll}
          className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check className="mr-1.5 size-3.5" /> Chọn tất cả
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <div ref={tableContainerRef} className="max-h-[360px] overflow-auto select-none">
          <table className="w-full min-w-[650px] text-left text-xs select-none">
            <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500 shadow-xs">
              <tr className="border-b border-slate-200">
                <th className="w-12 px-4 py-3">
                  <Checkbox
                    checked={
                      displayedAccounts.some(isEligible) &&
                      displayedAccounts.filter(isEligible).every((account) => selectedAccountKeys.includes(account.key))
                    }
                    onCheckedChange={(checked) =>
                      setSelectedAccountKeys(checked ? displayedAccounts.filter(isEligible).map((account) => account.key) : [])
                    }
                  />
                </th>
                <th className="px-3 py-3 font-semibold">Tài khoản Facebook</th>
                <th className="px-3 py-3 font-semibold">UID Facebook</th>
                <th className="px-3 py-3 font-semibold">Trạng thái tài khoản</th>
                <th className="px-3 py-3 font-semibold">Trạng thái đăng nhập</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayedAccounts.map((account, index) => {
                const selected = selectedAccountKeys.includes(account.key);
                const eligible = isEligible(account);
                const loggedIn = String(account.login_status || "").toLowerCase() === "logged_in";
                return (
                  <tr
                    key={account.key}
                    data-account-key={account.key}
                    onClick={(e) => eligible && handleRowClick(account.key, e)}
                    className={`${eligible ? "cursor-pointer" : "cursor-not-allowed opacity-50"} transition-colors select-none ${selected ? "bg-blue-50/70 hover:bg-blue-100/60" : "bg-white hover:bg-slate-50"
                      }`}
                  >
                    <td className="px-4 py-2.5">
                      <Checkbox
                        checked={selected}
                        disabled={!eligible}
                        onCheckedChange={(checked) => toggleAccount(account.key, checked)}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar className="size-8 border-0">
                          {(account.avatar_url || account.avatar) && (
                            <AvatarImage src={account.avatar_url || account.avatar} alt={account.name || "FB"} />
                          )}
                          <AvatarFallback className={AVATAR_COLORS[index % AVATAR_COLORS.length]}>
                            {initialsOf(account.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-semibold text-slate-700 text-sm">{account.name}</p>
                          <p className="text-xs text-slate-400">
                            {account.email || "Chưa có email"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-500">{account.uid}</td>
                    <td className="px-3 py-2.5">
                      {String(account.status || "").toUpperCase() === "LIVE" ? (
                        <span className="font-semibold text-emerald-600">● Live</span>
                      ) : String(account.status || "").toUpperCase() === "DIE" ? (
                        <span className="font-semibold text-red-500">● Die</span>
                      ) : (
                        <span className="font-semibold text-slate-400">
                          ● {account.status || "Chưa check"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {loggedIn && <span className="font-semibold text-emerald-600">● Đã đăng nhập</span>}
                    </td>
                  </tr>
                );
              })}

              {!accountsLoading && !displayedAccounts.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <Users className="size-8 text-slate-300" />
                      <p className="text-xs font-semibold text-slate-600">
                        {effectiveAccounts.length === 0
                          ? "Chưa có tài khoản Facebook nào trong Module 2 (Quản lý tài khoản)"
                          : "Không tìm thấy tài khoản Facebook phù hợp"}
                      </p>
                      <p className="max-w-md text-[11px] text-slate-400">
                        {effectiveAccounts.length === 0
                          ? "Vui lòng vào Module 2 để thêm hoặc import tài khoản Facebook, sau đó quay lại để chọn tài khoản đi seeding."
                          : "Thử tìm kiếm với từ khóa khác hoặc bấm nút làm mới."}
                      </p>
                      {effectiveAccounts.length === 0 ? (
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
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                    <RefreshCw className="inline mr-2 size-4 animate-spin text-primary" />
                    Đang tải tài khoản từ Module 2...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* THÔNG TIN HỖ TRỢ & HƯỚNG DẪN CHỌN */}
      <div className="mt-2.5 flex items-center justify-between text-sm text-slate-400">
        <span className="flex items-center gap-1 text-slate-400">
          {effectiveAccounts.length > 0 && (
            <span>Tổng cộng: <strong className="text-slate-600">{effectiveAccounts.length}</strong> tài khoản</span>
          )}
        </span>
        <span className="flex items-center gap-1.5 text-slate-400">
          <MousePointerClick className=" text-primary/70" size={16} />
          <span>Giữ & kéo chuột để chọn dải tài khoản</span>
        </span>
      </div>

      <div className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-500">
        {selectedAccountKeys.length > 0
          ? `Đã chọn ${selectedAccountKeys.length}/${effectiveAccounts.length} Tài khoản`
          : "Chưa chọn tài khoản nào"}
      </div>
    </SectionCard>
  );
}
