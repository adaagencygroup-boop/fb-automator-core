import React, { useRef, useState, useMemo, useEffect } from "react";
import {
  Search,
  FileUp,
  Download,
  FileText,
  Check,
  Edit3,
  RotateCw,
  Trash2,
  ListFilter,
  ExternalLink,
  AlertCircle,
  Loader2,
  Globe,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { attachDragSelection } from "../../shared/drag-selection";
import { toast } from "@/lib/toast";
import { SectionCard, SelectField } from "../../shared/components";
import {
  parseGroupFileSource,
  uploadGroupSourceFile,
  searchGroupSource,
  downloadGroupTemplate,
} from "../../service";

function parseMemberCount(value) {
  const text = String(value || "").trim().toUpperCase();
  const abbreviated = text.match(/([\d.,]+)\s*([KMB])/);
  if (abbreviated) {
    const amount = Number.parseFloat(abbreviated[1].replace(",", ".")) || 0;
    const multiplier = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[abbreviated[2]];
    return amount * multiplier;
  }
  return Number.parseInt(text.replace(/\D/g, ""), 10) || 0;
}

/**
 * ============================================================================
 * MODULE 07 - BƯỚC 3: NGUỒN NHÓM FACEBOOK (GroupSourceSection)
 * Kế thừa nghiệp vụ từ FaceBook_Post_Group.py:
 * 1. Đọc danh sách nhóm từ File link nhóm (.txt, .csv) - tương ứng self.btn_group_file
 *    - Gọi Backend (/api/groups/source/upload và /api/groups/source/parse)
 *    - Tách query param '?', loại bỏ ký tự rác, khử trùng lặp và loại link hỏng
 *    - Kiểm tra lịch sử đã đăng nhóm (group_session_logs)
 * 2. Tìm kiếm nhóm theo Từ khóa - tương ứng self.txt_keyword
 *    - Tìm kiếm qua Backend /api/groups/source/search theo từ khóa chủ đề
 *    - Bộ lọc số lượng thành viên (> 10K, > 50K, > 100K TV) và loại nhóm (công khai / riêng tư)
 * ============================================================================
 */
export default function GroupSourceSection({
  groupSource = "file",
  setGroupSource,
  groupFile,
  setGroupFile,
  groupSearch = "",
  setGroupSearch,
  groupFilter = "",
  setGroupFilter,
  selectedGroupKeys = [],
  setSelectedGroupKeys,
  customGroups = [],
  setCustomGroups,
  selectedAccountKeys = [],
  setSelectedAccountKeys,
  accounts = [],
  isLocked = false,
  setIsLocked,
  onContinue,
  stepNumber = "4",
}) {
  const groupFileInputRef = useRef(null);
  const [maxResults, setMaxResults] = useState("50");
  const [memberFilter, setMemberFilter] = useState("all");
  const [groupTypeFilter, setGroupTypeFilter] = useState("all");
  const [frequencyFilter, setFrequencyFilter] = useState("all");
  const [membershipFilter, setMembershipFilter] = useState("all");
  const [isFileProcessing, setIsFileProcessing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [isQuantityDialogOpen, setIsQuantityDialogOpen] = useState(false);
  const [showSearchFilters, setShowSearchFilters] = useState(false);
  const [showResultFilters, setShowResultFilters] = useState(false);

  // Mặc định dùng tài khoản đầu tiên đã chọn ở Bước 2 để quét nhóm.
  const activeScrapingAccount = useMemo(() => {
    const firstSelectedKey = selectedAccountKeys[0];
    if (!firstSelectedKey) return null;
    return (accounts || []).find(
      (account) => account.key === firstSelectedKey || account.uid === firstSelectedKey
    ) || null;
  }, [selectedAccountKeys, accounts]);

  // Danh sách nhóm đang hiển thị: dữ liệu thật từ Backend (file hoặc search/thủ công)
  const baseGroups = useMemo(() => {
    if (groupSource === "file") {
      return groupFile?.groups || [];
    }
    return customGroups || [];
  }, [groupSource, groupFile, customGroups]);

  const selectedSourceGroupsCount = useMemo(() => {
    const sourceKeys = new Set(baseGroups.map((group) => group.key));
    return selectedGroupKeys.filter((key) => sourceKeys.has(key)).length;
  }, [baseGroups, selectedGroupKeys]);

  // Bộ lọc tìm kiếm, số lượng thành viên, loại nhóm và tần suất bài viết
  const filteredGroups = useMemo(() => {
    return baseGroups.filter((group) => {
      // Lọc theo từ khóa tìm kiếm nhanh trong bảng
      const query = groupFilter.trim().toLowerCase();
      const matchQuery =
        !query ||
        `${group.name || ""} ${group.url || ""} ${group.uid || ""}`.toLowerCase().includes(query);

      // Lọc theo số lượng thành viên
      let matchMember = true;
      const memberCount = parseMemberCount(group.members);
      if (memberFilter === "10k") matchMember = memberCount >= 10_000;
      else if (memberFilter === "50k") matchMember = memberCount >= 50_000;
      else if (memberFilter === "100k") matchMember = memberCount >= 100_000;

      // Lọc theo loại nhóm (công khai / riêng tư)
      let matchType = true;
      if (groupTypeFilter === "public") matchType = group.privacy === "public";
      else if (groupTypeFilter === "private") matchType = group.privacy === "private";

      let matchMembership = true;
      if (membershipFilter === "joined") {
        matchMembership = group.membership_status === "joined";
      } else if (membershipFilter === "not_joined") {
        matchMembership = group.membership_status === "not_joined";
      }

      // Lọc theo tần suất bài viết / ngày (ví dụ: "10+ bài viết/ngày", "25 bài/ngày")
      let matchFrequency = true;
      if (frequencyFilter !== "all") {
        const freqMatch = String(group.frequency || "").match(/(\d+)/);
        const freqNum = freqMatch ? parseInt(freqMatch[1], 10) : 0;
        const targetFreq = parseInt(frequencyFilter, 10);
        if (!isNaN(targetFreq)) {
          matchFrequency = freqNum >= targetFreq;
        }
      }

      return matchQuery && matchMember && matchType && matchMembership && matchFrequency;
    });
  }, [baseGroups, groupFilter, memberFilter, groupTypeFilter, membershipFilter, frequencyFilter]);

  // Ẩn bảng danh sách nhóm và các thanh thao tác khi ở chế độ tìm kiếm nhưng chưa thực hiện tìm kiếm từ khóa nào
  const isSearchIdle =
    groupSource === "search" &&
    !hasSearched &&
    !isSearching &&
    (!customGroups || customGroups.length === 0);

  const activeResultFilterCount = [
    memberFilter,
    groupTypeFilter,
    frequencyFilter,
    membershipFilter,
  ].filter((value) => value !== "all").length;
  const activeSearchFilterCount = activeResultFilterCount + (maxResults !== "50" ? 1 : 0);

  // Toggle chọn 1 nhóm
  const toggleGroup = (key, checked) => {
    setSelectedGroupKeys((current) =>
      checked ? [...new Set([...current, key])] : current.filter((item) => item !== key)
    );
  };

  const tableContainerRef = useRef(null);
  const rowsRef = useRef(filteredGroups);
  const selectedKeysRef = useRef(selectedGroupKeys);

  useEffect(() => {
    rowsRef.current = filteredGroups;
    selectedKeysRef.current = selectedGroupKeys;
  }, [filteredGroups, selectedGroupKeys]);

  // Gắn cơ chế drag-to-select (giữ chuột kéo để lướt chọn nhiều nhóm liên tục)
  useEffect(() => {
    if (!tableContainerRef.current) return;
    return attachDragSelection(tableContainerRef.current, {
      getVisibleKeys: () => rowsRef.current.map((row) => row.key),
      getSelectedKeys: () => selectedKeysRef.current,
      onSelectionChange: (keys) => {
        selectedKeysRef.current = keys;
        setSelectedGroupKeys(keys);
      },
      disabled: isFileProcessing || isSearching,
    });
  }, [isFileProcessing, isSearching, setSelectedGroupKeys]);

  // Click vào dòng nhóm để toggle chọn nhanh
  const handleRowClick = (groupKey, event) => {
    if (event.target.closest("button, input, select, textarea, a, [role='button']")) return;
    const isCurrentlySelected = selectedGroupKeys.includes(groupKey);
    toggleGroup(groupKey, !isCurrentlySelected);
  };

  // Chọn tất cả nhóm trong kết quả lọc
  const handleSelectAll = () => {
    setSelectedGroupKeys(filteredGroups.map((g) => g.key));
  };

  // Xóa 1 nhóm khỏi danh sách
  const handleRemoveSingleGroup = (key) => {
    toggleGroup(key, false);
    if (setCustomGroups) {
      setCustomGroups((current) => (current || []).filter((g) => g.key !== key));
    }
    if (groupFile?.groups) {
      const remaining = groupFile.groups.filter((g) => g.key !== key);
      setGroupFile({
        ...groupFile,
        groups: remaining,
        validGroupsCount: remaining.length,
      });
    }
  };

  const handleSaveSource = () => {
    if (
      selectedSourceGroupsCount === 0 ||
      selectedAccountKeys.length > selectedSourceGroupsCount
    ) {
      setIsQuantityDialogOpen(true);
      return;
    }
    toast.success("Đã lưu cấu hình nguồn nhóm.", "LƯU THÀNH CÔNG");
    setIsLocked?.(true);
    onContinue?.();
  };

  const handleReduceAccounts = () => {
    if (selectedSourceGroupsCount === 0 || !setSelectedAccountKeys) return;
    const trimmed = selectedAccountKeys.slice(0, selectedSourceGroupsCount);
    setSelectedAccountKeys(trimmed);
    setIsQuantityDialogOpen(false);
    setIsLocked?.(true);
    toast.info(
      `Đã giảm số tài khoản xuống ${trimmed.length} để phù hợp với số nhóm.`,
      "ĐIỀU CHỈNH SỐ LƯỢNG"
    );
    onContinue?.();
  };

  // Quét tìm nhóm theo từ khóa qua Backend (dữ liệu nhóm Facebook thật)
  const handleSearchGroups = async () => {
    if (!activeScrapingAccount) {
      toast.warning("Hãy chọn ít nhất một tài khoản ở Bước 2 trước khi quét nhóm.", "CHƯA CHỌN TÀI KHOẢN");
      return;
    }

    const keyword = groupSearch?.trim();
    if (!keyword) {
      toast.info("Vui lòng nhập từ khóa tìm nhóm Facebook", "TÌM NHÓM");
      return;
    }
    setHasSearched(true);
    setIsSearching(true);
    try {
      const res = await searchGroupSource({
        keyword,
        max_results: Number(maxResults) || 50,
        member_filter: memberFilter,
        group_type: groupTypeFilter,
        frequency_filter: frequencyFilter,
        membership_filter: membershipFilter,
        account_uid: activeScrapingAccount.uid,
      });
      const foundGroups = res?.groups || [];
      if (foundGroups.length > 0) {
        if (setCustomGroups) setCustomGroups(foundGroups);
        setSelectedGroupKeys(foundGroups.map((g) => g.key));
        toast.success(
          `Đã tìm thấy ${foundGroups.length} nhóm Facebook thật phù hợp cho "${keyword}" (tối đa ${maxResults} nhóm)`,
          "TÌM NHÓM THÀNH CÔNG"
        );
      } else {
        if (setCustomGroups) setCustomGroups([]);
        setSelectedGroupKeys([]);
        toast.info(
          `Không tìm thấy nhóm phù hợp cho từ khóa "${keyword}". Hãy thử từ khóa khác hoặc điều chỉnh bộ lọc.`,
          "KẾT QUẢ TÌM KIẾM"
        );
      }
    } catch (err) {
      console.error("Backend search group error:", err);
      toast.error(
        `Lỗi tìm kiếm nhóm: ${err.message || "Không kết nối được Backend"}`,
        "LỖI TÌM NHÓM"
      );
    } finally {
      setIsSearching(false);
    }
  };


  /**
   * Xử lý file link nhóm: Gọi Backend Module 7 (/api/groups/source/upload & /api/groups/source/parse)
   * Kế thừa nghiệp vụ FaceBook_Post_Group.py:
   * 1. Upload file lên Backend hoặc parse text
   * 2. Lọc link facebook.com/groups/..., tách '?', khử trùng lặp
   * 3. Kiểm tra lịch sử đã đăng nhóm (group_session_logs)
   */
  const processGroupFile = async (file) => {
    if (!file) return;
    setIsFileProcessing(true);
    const scrapeUid = activeScrapingAccount?.uid || accounts[0]?.uid;
    try {
      // 1. Thử upload trực tiếp file lên /api/groups/source/upload và quét thông tin thật
      const formData = new FormData();
      formData.append("file", file);
      formData.append("filter_posted", "false");
      if (scrapeUid) {
        formData.append("account_uid", scrapeUid);
      }

      const res = await uploadGroupSourceFile(formData);
      if (res && Array.isArray(res.groups)) {
        const validGroups = res.groups;
        setGroupFile({
          name: file.name,
          size: file.size,
          status: "valid",
          dedupCount: res.dedup_count ?? 0,
          invalidCount: res.invalid_count ?? 0,
          validGroupsCount: res.valid_count ?? validGroups.length,
          alreadyPostedCount: res.already_posted_count ?? 0,
          groups: validGroups,
        });
        setSelectedGroupKeys(validGroups.map((g) => g.key));
        toast.success(
          `Đã quét được ${validGroups.length} nhóm thật từ file "${file.name}" (Lọc bỏ ${res.dedup_count ?? 0} trùng lặp, ${res.invalid_count ?? 0} link hỏng)`,
          "QUÉT NHÓM THÀNH CÔNG"
        );
        return;
      }
    } catch (uploadErr) {
      console.warn("Backend upload error, trying parse text content:", uploadErr);
      try {
        const text = await file.text();
        const res = await parseGroupFileSource({
          content: text,
          filter_posted: false,
          account_uid: scrapeUid,
        });
        if (res && Array.isArray(res.groups)) {
          const validGroups = res.groups;
          setGroupFile({
            name: file.name,
            size: file.size,
            status: "valid",
            dedupCount: res.dedup_count ?? 0,
            invalidCount: res.invalid_count ?? 0,
            validGroupsCount: res.valid_count ?? validGroups.length,
            alreadyPostedCount: res.already_posted_count ?? 0,
            groups: validGroups,
          });
          setSelectedGroupKeys(validGroups.map((g) => g.key));
          toast.success(
            `Đã quét được ${validGroups.length} nhóm thật từ file "${file.name}"`,
            "QUÉT NHÓM THÀNH CÔNG"
          );
          return;
        }
      } catch (parseErr) {
        console.error("Backend parse text failed:", parseErr);
        toast.error(
          `Không thể đọc dữ liệu file nhóm: ${parseErr.message || "Định dạng file không hỗ trợ"}`,
          "LỖI ĐỌC FILE"
        );
      }
    } finally {
      setIsFileProcessing(false);
    }
  };

  const handleGroupFileChange = (event) => {
    const file = event.target.files?.[0];
    if (file) processGroupFile(file);
  };

  const handleGroupFileDrop = (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) processGroupFile(file);
  };

  // Tải file mẫu trực tiếp từ Backend endpoint /api/groups/source/template
  const handleDownloadTemplate = async () => {
    try {
      await downloadGroupTemplate();
      toast.success("Đang tải file mẫu link nhóm (.txt) từ hệ thống...", "TẢI FILE MẪU");
    } catch (err) {
      toast.error(`Không thể tải file mẫu: ${err.message}`, "LỖI TẢI FILE");
    }
  };

  // Xóa file nhóm hiện tại
  const handleRemoveGroupFile = () => {
    setGroupFile(null);
    setSelectedGroupKeys([]);
    if (groupFileInputRef.current) {
      groupFileInputRef.current.value = "";
    }
    toast.info("Đã xóa file danh sách nhóm", "THÔNG BÁO");
  };

  const renderGroupFilters = (className, includeMaxResults = false) => (
    <div className={className}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        Lọc kết quả
      </span>
      {includeMaxResults && (
        <div className="min-w-[135px] flex-1 sm:flex-none">
          <SelectField
            value={maxResults}
            onChange={(event) => setMaxResults(event.target.value)}
            className="h-7 border-slate-200 bg-white px-2 py-0 text-[11px]"
          >
            {[10, 20, 30, 50, 100, 150, 200].map((value) => (
              <option key={value} value={value}>Tối đa {value} nhóm</option>
            ))}
          </SelectField>
        </div>
      )}
      <div className="min-w-[145px] flex-1 sm:flex-none">
        <SelectField
          value={memberFilter}
          onChange={(event) => setMemberFilter(event.target.value)}
          className="h-7 border-slate-200 bg-white px-2 py-0 text-[11px]"
        >
          <option value="all">Mọi quy mô</option>
          <option value="10k">Trên 10K thành viên</option>
          <option value="50k">Trên 50K thành viên</option>
          <option value="100k">Trên 100K thành viên</option>
        </SelectField>
      </div>
      <div className="min-w-[135px] flex-1 sm:flex-none">
        <SelectField
          value={frequencyFilter}
          onChange={(event) => setFrequencyFilter(event.target.value)}
          className="h-7 border-slate-200 bg-white px-2 py-0 text-[11px]"
        >
          <option value="all">Mọi tần suất</option>
          <option value="5">5+ bài/ngày</option>
          <option value="10">10+ bài/ngày</option>
          <option value="20">20+ bài/ngày</option>
        </SelectField>
      </div>
      <div className="min-w-[125px] flex-1 sm:flex-none">
        <SelectField
          value={groupTypeFilter}
          onChange={(event) => setGroupTypeFilter(event.target.value)}
          className="h-7 border-slate-200 bg-white px-2 py-0 text-[11px]"
        >
          <option value="all">Mọi loại nhóm</option>
          <option value="public">Công khai</option>
          <option value="private">Kiểm duyệt</option>
        </SelectField>
      </div>
      <div className="min-w-[135px] flex-1 sm:flex-none">
        <SelectField
          value={membershipFilter}
          onChange={(event) => setMembershipFilter(event.target.value)}
          className="h-7 border-slate-200 bg-white px-2 py-0 text-[11px]"
        >
          <option value="all">Mọi trạng thái tham gia</option>
          <option value="joined">Đã tham gia</option>
          <option value="not_joined">Chưa tham gia</option>
        </SelectField>
      </div>
      {(activeResultFilterCount > 0 || (includeMaxResults && maxResults !== "50")) && (
        <button
          type="button"
          onClick={() => {
            if (includeMaxResults) setMaxResults("50");
            setMemberFilter("all");
            setGroupTypeFilter("all");
            setFrequencyFilter("all");
            setMembershipFilter("all");
          }}
          className="inline-flex h-7 items-center gap-1 px-1 text-[10px] font-medium text-slate-500 hover:text-red-600"
        >
          <RotateCw className="size-3" /> Đặt lại
        </button>
      )}
    </div>
  );

  return (
    <SectionCard
      number={stepNumber}
      title="Nguồn nhóm"
      description="Tìm nhóm trên Facebook hoặc nhập danh sách có sẵn."
      aside={
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-primary">
          {selectedGroupKeys.length}/{baseGroups.length} đã chọn
        </span>
      }
    >
      <fieldset
        disabled={isLocked}
        className={`min-w-0 ${isLocked ? "pointer-events-none opacity-70" : ""}`}
      >
      <div className="inline-flex w-full rounded-lg bg-slate-100 p-1 sm:w-auto">
        <button
          type="button"
          onClick={() => setGroupSource("search")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-semibold transition-colors sm:flex-none ${
            groupSource === "search"
              ? "bg-white text-primary shadow-xs"
              : "text-slate-500 hover:text-slate-800"
          }`}
        >
          <Search className="size-3.5" /> Tìm theo từ khóa
        </button>
        <button
          type="button"
          onClick={() => setGroupSource("file")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-semibold transition-colors sm:flex-none ${
            groupSource === "file"
              ? "bg-white text-primary shadow-xs"
              : "text-slate-500 hover:text-slate-800"
          }`}
        >
          <FileUp className="size-3.5" /> Nhập từ file
        </button>
      </div>

      {groupSource === "file" && (
        <div className="mt-3">
          <input
            ref={groupFileInputRef}
            type="file"
            accept=".txt,.csv,.xlsx"
            className="hidden"
            onChange={handleGroupFileChange}
          />
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleGroupFileDrop}
            className={`rounded-lg border border-dashed p-3 transition-colors ${
              isFileProcessing
                ? "border-primary/40 bg-blue-50/50"
                : "border-slate-300 bg-slate-50/50 hover:border-primary/40"
            }`}
          >
            {isFileProcessing ? (
              <div className="flex items-center justify-center gap-2 py-3 text-xs font-medium text-primary">
                <Loader2 className="size-4 animate-spin" /> Đang đọc file và quét thông tin nhóm thật từ Facebook...
              </div>
            ) : groupFile ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-600">
                    <FileText className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-xs font-semibold text-slate-800">{groupFile.name}</p>
                      <span className="text-[10px] font-semibold text-emerald-600">
                        {groupFile.validGroupsCount ?? 0} nhóm hợp lệ
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      Đã bỏ {groupFile.dedupCount ?? 0} trùng lặp và {groupFile.invalidCount ?? 0} link lỗi
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => groupFileInputRef.current?.click()}
                    className="h-7 px-2.5 text-[11px]"
                  >
                    <RotateCw className="mr-1 size-3" /> Đổi file
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleRemoveGroupFile}
                    className="h-7 px-2 text-[11px] text-slate-500 hover:text-red-600"
                  >
                    <Trash2 className="mr-1 size-3" /> Xóa
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-blue-50 text-primary">
                    <FileUp className="size-4" />
                  </span>
                  <div>
                    <p className="text-xs font-medium text-slate-700">Kéo thả file danh sách nhóm vào đây</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">Hỗ trợ .txt, .csv và .xlsx</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadTemplate}
                    className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-primary"
                  >
                    <Download className="size-3" /> File mẫu
                  </button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => groupFileInputRef.current?.click()}
                    className="h-8 px-3 text-xs"
                  >
                    Chọn file
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {groupSource === "search" && (
        <div className="mt-3 rounded-lg border border-slate-200 p-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={groupSearch}
                onChange={(event) => setGroupSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (!isSearching) handleSearchGroups();
                  }
                }}
                placeholder="Nhập từ khóa, ví dụ: việc làm online"
                className="h-9 pl-9 text-xs"
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowSearchFilters((current) => !current)}
              className={`h-9 shrink-0 px-3 text-xs ${
                showSearchFilters || activeSearchFilterCount > 0
                  ? "border-primary/40 bg-blue-50 text-primary"
                  : ""
              }`}
            >
              <ListFilter className="mr-1.5 size-3.5" /> Bộ lọc
              {activeSearchFilterCount > 0 && (
                <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[9px] leading-none text-white">
                  {activeSearchFilterCount}
                </span>
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isSearching}
              onClick={handleSearchGroups}
              className="h-9 shrink-0 px-4 text-xs"
            >
              {isSearching ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Search className="mr-1.5 size-3.5" />
              )}
              {isSearching ? "Đang quét..." : "Quét nhóm"}
            </Button>
          </div>

          {(showSearchFilters || activeSearchFilterCount > 0) &&
            renderGroupFilters(
              "mt-2 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50/60 px-2.5 py-2",
              true
            )}

        </div>
      )}

      {!isSearchIdle && (
        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
          <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50/60 p-2.5 sm:flex-row sm:items-center">
            <div className="relative min-w-[180px] flex-1">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={groupFilter}
                onChange={(event) => setGroupFilter(event.target.value)}
                placeholder="Lọc danh sách nhóm..."
                className="h-8 bg-white pl-9 text-xs"
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowResultFilters((current) => !current)}
              className={`h-8 shrink-0 px-2.5 text-[11px] ${
                showResultFilters || activeResultFilterCount > 0
                  ? "border-primary/40 bg-blue-50 text-primary"
                  : ""
              }`}
            >
              <ListFilter className="mr-1 size-3" /> Bộ lọc
              {activeResultFilterCount > 0 && (
                <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[9px] leading-none text-white">
                  {activeResultFilterCount}
                </span>
              )}
            </Button>
            <div className="flex items-center justify-between gap-2 sm:justify-end">
              <span className="whitespace-nowrap text-[11px] text-slate-500">
                <strong className="text-slate-700">{filteredGroups.length}</strong> nhóm ·{" "}
                <strong className="text-primary">{selectedGroupKeys.length}</strong> đã chọn
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleSelectAll}
                className="h-8 px-2.5 text-[11px]"
              >
                <Check className="mr-1 size-3" /> Chọn tất cả
              </Button>
            </div>
          </div>

          {(showResultFilters || activeResultFilterCount > 0) &&
            renderGroupFilters(
              "flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-2.5 py-2"
            )}

          <div ref={tableContainerRef} className="max-h-[320px] overflow-auto">
              <table className="w-full min-w-[620px] text-left text-[11px]">
                <thead className="sticky top-0 z-10 bg-white text-slate-500 shadow-xs">
                  <tr className="border-b border-slate-200">
                    <th className="w-10 px-3 py-2">
                      <Checkbox
                        checked={
                          filteredGroups.length > 0 &&
                          filteredGroups.every((group) => selectedGroupKeys.includes(group.key))
                        }
                        onCheckedChange={(checked) =>
                          setSelectedGroupKeys(checked ? filteredGroups.map((group) => group.key) : [])
                        }
                      />
                    </th>
                    <th className="px-2 py-2 font-semibold">Nhóm Facebook</th>
                    <th className="w-28 px-3 py-2 font-semibold">Loại</th>
                    <th className="w-32 px-3 py-2 font-semibold">Hoạt động</th>
                    <th className="w-28 px-3 py-2 font-semibold">Thành viên</th>
                    <th className="w-12 px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {isFileProcessing || isSearching ? (
                    <tr>
                      <td colSpan="6" className="py-10 text-center text-slate-500">
                        <Loader2 className="mx-auto mb-2 size-5 animate-spin text-primary" />
                        <p className="text-xs">
                          {isFileProcessing
                            ? "Đang đọc file và quét dữ liệu nhóm thật từ Facebook..."
                            : "Đang quét nhóm Facebook..."}
                        </p>
                      </td>
                    </tr>
                  ) : filteredGroups.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="py-10 text-center">
                        <div className="mx-auto mb-2 flex size-8 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                          <AlertCircle className="size-4" />
                        </div>
                        <p className="text-xs font-medium text-slate-500">
                          {groupSource === "file"
                            ? "File chưa có nhóm hợp lệ"
                            : "Không có nhóm phù hợp"}
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredGroups.map((group, idx) => {
                      const isSelected = selectedGroupKeys.includes(group.key);
                      const isPublic = group.privacy === "public";
                      const groupUrl = group.url || "";
                      return (
                        <tr
                          key={group.key}
                          data-group-key={group.key}
                          onClick={(e) => handleRowClick(group.key, e)}
                          className={`transition-colors select-none cursor-pointer ${
                            isSelected ? "bg-blue-50/60 hover:bg-blue-50" : "bg-white hover:bg-slate-50"
                          }`}
                        >
                          <td className="px-3 py-2">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) => toggleGroup(group.key, checked)}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-2">
                              <span className="w-5 shrink-0 text-right font-mono text-[9px] text-slate-300">
                                {idx + 1}
                              </span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className="truncate font-semibold text-slate-800">{group.name || "Nhóm chưa có tên"}</p>
                              {group.already_posted && (
                                    <span className="shrink-0 rounded bg-rose-50 px-1.5 py-0.5 text-[9px] text-rose-600">Đã đăng</span>
                              )}
                                </div>
                                {groupUrl && (
                                  <a
                                    href={groupUrl.startsWith("http") ? groupUrl : `https://${groupUrl}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-0.5 flex max-w-md items-center gap-1 truncate font-mono text-[9px] text-slate-400 hover:text-primary"
                                  >
                                    <span className="truncate">{groupUrl}</span>
                                    <ExternalLink className="size-2.5 shrink-0" />
                                  </a>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center gap-1 text-[10px] ${isPublic ? "text-emerald-600" : "text-amber-600"}`}>
                              {isPublic ? <Globe className="size-3" /> : <Lock className="size-3" />}
                              {isPublic ? "Công khai" : "Kiểm duyệt"}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-500">{group.frequency || "—"}</td>
                          <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-600">{group.members || "—"}</td>
                          <td className="px-2 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveSingleGroup(group.key)}
                              className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500"
                              title="Xóa nhóm này"
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
          </div>
          {filteredGroups.length > 0 && (
            <div className="border-t border-slate-100 px-3 py-1.5 text-right text-[10px] text-slate-400">
              Có thể giữ và kéo chuột để chọn nhiều nhóm.
            </div>
          )}
        </div>
      )}

      </fieldset>

      <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
        {isLocked ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setIsLocked?.(false)} className="h-9 px-4 text-xs">
            <Edit3 className="mr-1.5 size-3.5" />
            Chỉnh sửa
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={handleSaveSource} className="h-9 px-4 text-xs">
            <Check className="mr-1.5 size-3.5" />
            Lưu cấu hình
          </Button>
        )}
      </div>

      <ConfirmDialog
        isOpen={isQuantityDialogOpen}
        onClose={() => setIsQuantityDialogOpen(false)}
        onConfirm={() => setIsQuantityDialogOpen(false)}
        onSecondaryConfirm={handleReduceAccounts}
        title={selectedSourceGroupsCount === 0 ? "Chưa chọn nhóm" : "Chưa đủ số lượng nhóm"}
        description={
          selectedSourceGroupsCount === 0
            ? `Bạn đã chọn ${selectedAccountKeys.length} tài khoản nhưng chưa chọn nhóm nào. Hãy chọn ít nhất một nhóm trước khi lưu cấu hình.`
            : `Bạn đã chọn ${selectedAccountKeys.length} tài khoản nhưng chỉ có ${selectedSourceGroupsCount} nhóm. Số tài khoản không được lớn hơn số nhóm (A ≤ G).`
        }
        confirmText="Chọn thêm nhóm"
        cancelText="Đóng"
        secondaryText={selectedSourceGroupsCount > 0 ? "Giảm số tài khoản" : undefined}
        variant="warning"
      />
    </SectionCard>
  );
}
