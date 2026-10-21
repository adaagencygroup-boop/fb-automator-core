import React, { useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import {
  Search,
  Check,
  RefreshCw,
  Users,
  Plus,
  MousePointerClick,
  CheckCircle2,
  AlertCircle,
  Edit3,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";
import { SectionCard, initialsOf } from "../../shared/components";
import { AVATAR_COLORS } from "../../shared/constants";
import { attachDragSelection } from "../../shared/drag-selection";

/**
 * ============================================================================
 * MODULE 07 - BƯỚC 1: CHỌN TÀI KHOẢN / NGƯỜI DÙNG ĐI SEEDING (GroupAccountSection)
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
  onConfirm,
  isLocked,
  setIsLocked,
}) {
  const effectiveAccounts = accounts || [];

  const [internalLocked, setInternalLocked] = useState(false);
  const locked = isLocked !== undefined ? isLocked : internalLocked;
  const setLocked = (val) => {
    if (setIsLocked) setIsLocked(val);
    setInternalLocked(val);
  };

  const [accountSearch, setAccountSearch] = useState("");

  // Lọc tài khoản theo từ khóa tìm kiếm
  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();
    if (!query) return effectiveAccounts;
    return effectiveAccounts.filter((account) =>
      `${account.name || ""} ${account.uid || ""} ${account.email || ""}`.toLowerCase().includes(query)
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
      disabled: accountsLoading || locked,
    });
  }, [accountsLoading, locked, setSelectedAccountKeys]);

  // Toggle chọn 1 tài khoản
  const toggleAccount = (key, checked) => {
    if (locked) return;
    setSelectedAccountKeys((current) =>
      checked ? [...new Set([...current, key])] : current.filter((item) => item !== key)
    );
  };

  // Click vào dòng tài khoản để toggle nhanh
  const handleRowClick = (accountKey, event) => {
    if (locked) return;
    if (event.target.closest("button, input, select, textarea, a, [role='button']")) return;
    const isCurrentlySelected = selectedAccountKeys.includes(accountKey);
    toggleAccount(accountKey, !isCurrentlySelected);
  };

  // Chọn tất cả tài khoản trong kết quả lọc
  const handleSelectAll = () => {
    if (locked) return;
    setSelectedAccountKeys(filteredAccounts.map((account) => account.key));
  };

  // Làm mới và đồng bộ lại danh sách tài khoản
  const handleRefresh = () => {
    setAccountSearch("");
    if (onRefreshAccounts) onRefreshAccounts();
  };

  // Xác nhận tài khoản và cuộn xuống Bước 2 (ràng buộc: phải chọn ít nhất 1 tài khoản)
  const handleConfirmAccounts = () => {
    if (!selectedAccountKeys || selectedAccountKeys.length === 0) {
      toast.warning(
        "Vui lòng chọn ít nhất 1 tài khoản Facebook ở bảng trên trước khi tiếp tục!",
        "CHƯA CHỌN TÀI KHOẢN"
      );
      return;
    }

    toast.success(
      `Đã xác nhận ${selectedAccountKeys.length} tài khoản Facebook. Đang chuyển sang Bước 2...`,
      "XÁC NHẬN THÀNH CÔNG"
    );

    setLocked(true);

    if (onConfirm) {
      onConfirm(selectedAccountKeys);
    }

    setTimeout(() => {
      const step2El = document.getElementById("step-2-settings");
      if (step2El) {
        step2El.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 120);
  };

  return (
    <SectionCard
      number="1"
      title="Chọn tài khoản"
      description="Chọn danh sách tài khoản Facebook sẽ thực hiện đăng bài và tương tác"
      aside={
        locked ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 border border-emerald-200/60">
            <Check className="size-3 text-emerald-600" />
            Đã chọn {selectedAccountKeys.length}/{effectiveAccounts.length} tài khoản
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 border border-amber-200/60">
            <Edit3 className="size-3 text-amber-600" />
            Đang chọn ({selectedAccountKeys.length}/{effectiveAccounts.length})
          </span>
        )
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={accountSearch}
            onChange={(event) => setAccountSearch(event.target.value)}
            disabled={locked}
            placeholder="Tìm kiếm UID, tên tài khoản Facebook..."
            className="pl-9 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={locked}
          onClick={handleSelectAll}
          className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check className="mr-1.5 size-3.5" /> Chọn tất cả
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={locked || accountsLoading}
          className="size-8 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
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
                    disabled={locked}
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
                    className={`transition-colors select-none ${
                      locked ? "cursor-default" : "cursor-pointer"
                    } ${
                      selected ? "bg-blue-50/70 hover:bg-blue-100/60" : "bg-white hover:bg-slate-50"
                    }`}
                  >
                    <td className="px-4 py-2.5">
                      <Checkbox
                        checked={selected}
                        disabled={locked}
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
                          <p className="font-semibold text-slate-700">{account.name}</p>
                          <p className="text-[10px] text-slate-400">
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
                  </tr>
                );
              })}

              {!accountsLoading && !filteredAccounts.length && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center">
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

      {/* THÔNG TIN HỖ TRỢ & HƯỚNG DẪN CHỌN */}
      <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-400">
        <span className="flex items-center gap-1 text-slate-400">
          {effectiveAccounts.length > 0 && (
            <span>Tổng cộng: <strong className="text-slate-600">{effectiveAccounts.length}</strong> tài khoản</span>
          )}
        </span>
        <span className="flex items-center gap-1.5 text-slate-400">
          <MousePointerClick className="size-3 text-primary/70" />
          <span>Giữ & kéo chuột để chọn dải tài khoản</span>
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <div
          className={`text-[11px] ${
            locked
              ? "text-emerald-600 font-medium"
              : selectedAccountKeys.length > 0
                ? "text-slate-500"
                : "text-amber-600 font-medium"
          }`}
        >
          {locked
            ? `Đã xác nhận ${selectedAccountKeys.length} tài khoản Facebook. Bấm Chỉnh sửa nếu muốn thay đổi.`
            : selectedAccountKeys.length > 0
              ? `Đã chọn ${selectedAccountKeys.length}/${effectiveAccounts.length} tài khoản. Bấm Xác nhận tài khoản để tiếp tục.`
              : "Chưa chọn tài khoản nào (Bắt buộc chọn ít nhất 1 tài khoản để tiếp tục sang Bước 2 và phục vụ Bước 3)"}
        </div>
        <div className="flex gap-2">
          {locked ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setLocked(false)}
              className="cursor-pointer text-xs flex items-center gap-1.5 border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium shadow-2xs"
            >
              <Edit3 className="size-3.5 text-slate-600" />
              Chỉnh sửa
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={accountsLoading}
              onClick={handleConfirmAccounts}
              className="cursor-pointer text-xs bg-slate-900 text-white hover:bg-slate-800"
            >
              Xác nhận tài khoản
            </Button>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
