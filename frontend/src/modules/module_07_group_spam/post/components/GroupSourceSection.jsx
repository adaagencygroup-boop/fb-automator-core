import React, { useRef, useState, useMemo, useEffect } from "react";
import {
  Search,
  Link2,
  FileUp,
  Download,
  FileText,
  Check,
  RotateCw,
  Trash2,
  ListFilter,
  ExternalLink,
  AlertCircle,
  Loader2,
  Globe,
  Lock,
  MousePointerClick,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { attachDragSelection } from "../../shared/drag-selection";
// import { SectionCard, SelectField } from "../../shared/components";
import { GROUPS as DEFAULT_GROUPS } from "../../shared/constants";
// import { parseGroupFileSource, searchGroupSource } from "../../service";
import { toast } from "@/lib/toast";
import { SectionCard, SelectField } from "../../shared/components";
import {
  parseGroupFileSource,
  uploadGroupSourceFile,
  searchGroupSource,
  downloadGroupTemplate,
} from "../../service";

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
  accounts = [],
}) {
  const groupFileInputRef = useRef(null);
  const [maxResults, setMaxResults] = useState("50");
  const [memberFilter, setMemberFilter] = useState("all");
  const [groupTypeFilter, setGroupTypeFilter] = useState("all");
  const [frequencyFilter, setFrequencyFilter] = useState("all");
  const [isFileProcessing, setIsFileProcessing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Tài khoản đầu tiên được chọn ở Bước 1 để thực hiện cào dữ liệu nhóm thật từ Facebook
  const activeScrapingAccount = useMemo(() => {
    if (!selectedAccountKeys || selectedAccountKeys.length === 0) return null;
    const firstKey = selectedAccountKeys[0];
    return (
      (accounts || []).find((a) => a.key === firstKey || a.uid === firstKey) || {
        uid: firstKey,
        name: `Tài khoản (${firstKey})`,
      }
    );
  }, [selectedAccountKeys, accounts]);

  // Danh sách nhóm đang hiển thị: dữ liệu thật từ Backend (file hoặc search/thủ công)
  const baseGroups = useMemo(() => {
    if (groupSource === "file") {
      return groupFile?.groups || [];
    }
    return customGroups || [];
  }, [groupSource, groupFile, customGroups]);

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
      const memNum = parseInt(String(group.members || "0").replace(/[^\d]/g, ""), 10);
      if (memberFilter === "10k") matchMember = memNum >= 10;
      else if (memberFilter === "50k") matchMember = memNum >= 50;
      else if (memberFilter === "100k") matchMember = memNum >= 100;

      // Lọc theo loại nhóm (công khai / riêng tư)
      let matchType = true;
      if (groupTypeFilter === "public") matchType = group.privacy === "public";
      else if (groupTypeFilter === "private") matchType = group.privacy === "private";

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

      return matchQuery && matchMember && matchType && matchFrequency;
    });
  }, [baseGroups, groupFilter, memberFilter, groupTypeFilter, frequencyFilter]);

  // Ẩn bảng danh sách nhóm và các thanh thao tác khi ở chế độ tìm kiếm nhưng chưa thực hiện tìm kiếm từ khóa nào
  const isSearchIdle =
    groupSource === "search" &&
    !hasSearched &&
    !isSearching &&
    (!customGroups || customGroups.length === 0);

  // Toggle chọn 1 nhóm
  const toggleGroup = (key, checked) => {
    setSelectedGroupKeys((current) =>
      checked ? [...new Set([...current, key])] : current.filter((item) => item !== key)
    );
  };

  const tableContainerRef = useRef(null);
  const rowsRef = useRef(filteredGroups);
  rowsRef.current = filteredGroups;
  const selectedKeysRef = useRef(selectedGroupKeys);
  selectedKeysRef.current = selectedGroupKeys;

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

  // Bỏ chọn tất cả nhóm
  const handleClearAll = () => {
    setSelectedGroupKeys([]);
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

  // Thêm nhóm thủ công bằng Link hoặc UID (qua Backend parse để đồng nhất)
  const handleAddManualGroup = async () => {
    const input = manualGroupInput.trim();
    if (!input) return;

    try {
      const res = await parseGroupFileSource({ content: input, filter_posted: false });
      if (res && Array.isArray(res.groups) && res.groups.length > 0) {
        const newGroups = res.groups;
        const existingKeys = new Set(baseGroups.map((g) => g.key.toLowerCase()));
        const uniqueNew = newGroups.filter((g) => !existingKeys.has(g.key.toLowerCase()));

        if (uniqueNew.length === 0) {
          toast.info("Nhóm này đã có sẵn trong danh sách!", "TRÙNG LẶP");
          return;
        }

        const nextList = [...uniqueNew, ...baseGroups];
        if (groupSource === "file") {
          setGroupFile((prev) => ({
            name: prev?.name || "Danh sách nhập tay",
            size: prev?.size || 0,
            status: "valid",
            dedupCount: prev?.dedupCount || 0,
            invalidCount: prev?.invalidCount || 0,
            validGroupsCount: nextList.length,
            alreadyPostedCount: prev?.alreadyPostedCount || 0,
            groups: nextList,
          }));
        } else if (setCustomGroups) {
          setCustomGroups(nextList);
        }
        setSelectedGroupKeys((cur) => [...new Set([...uniqueNew.map((g) => g.key), ...cur])]);
        setManualGroupInput("");
        setIsManualDialogOpen(false);
        toast.success(`Đã thêm ${uniqueNew.length} nhóm vào danh sách`, "THÊM THỦ CÔNG");
        return;
      }
    } catch (err) {
      console.warn("Backend parse manual group fallback:", err);
    }

    // Fallback thủ công nếu backend bận
    const cleanUrl = input.split("?")[0].replace(/^https?:\/\//, "").trim();
    const groupUid = cleanUrl.split("/groups/")[1]?.replace(/\/$/, "") || cleanUrl;
    const newGroupKey = `group_${groupUid}`;
    const newGroupItem = {
      id: String(baseGroups.length + 1).padStart(2, "0"),
      key: newGroupKey,
      name: `Nhóm thủ công [ID: ${groupUid}]`,
      url: cleanUrl.startsWith("facebook.com") ? cleanUrl : `facebook.com/groups/${cleanUrl}`,
      uid: groupUid,
      frequency: "10+ bài viết/ngày",
      members: "Công khai",
      privacy: "public",
      already_posted: false,
    };

    const nextList = [newGroupItem, ...baseGroups.filter((g) => g.key !== newGroupKey)];
    if (groupSource === "file") {
      setGroupFile((prev) => ({
        name: prev?.name || "Danh sách nhập tay",
        size: prev?.size || 0,
        status: "valid",
        dedupCount: prev?.dedupCount || 0,
        invalidCount: prev?.invalidCount || 0,
        validGroupsCount: nextList.length,
        alreadyPostedCount: prev?.alreadyPostedCount || 0,
        groups: nextList,
      }));
    } else if (setCustomGroups) {
      setCustomGroups(nextList);
    }
    setSelectedGroupKeys((cur) => [...new Set([newGroupKey, ...cur])]);
    setManualGroupInput("");
    setIsManualDialogOpen(false);
    toast.success("Đã thêm nhóm thành công", "THÊM THỦ CÔNG");
  };

  // Quét tìm nhóm theo từ khóa qua Backend (dữ liệu nhóm Facebook thật)
  const handleSearchGroups = async () => {
    // RÀNG BUỘC: Bắt buộc phải chọn ít nhất 1 tài khoản ở Bước 1
    if (!selectedAccountKeys || selectedAccountKeys.length === 0) {
      toast.warning(
        "Vui lòng chọn ít nhất 1 tài khoản Facebook ở Bước 1 để thực hiện quét nhóm thật!",
        "YÊU CẦU CHỌN TÀI KHOẢN"
      );
      const step1El = document.getElementById("step-1-accounts");
      if (step1El) {
        step1El.scrollIntoView({ behavior: "smooth", block: "start" });
      }
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
      const activeAccountUid = selectedAccountKeys?.[0] || null;
      const res = await searchGroupSource({
        keyword,
        max_results: Number(maxResults) || 50,
        member_filter: memberFilter,
        group_type: groupTypeFilter,
        frequency_filter: frequencyFilter,
        account_uid: activeAccountUid,
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
    try {
      // 1. Thử upload trực tiếp file lên /api/groups/source/upload
      const formData = new FormData();
      formData.append("file", file);
      formData.append("filter_posted", "false");

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
          `Đã nạp ${validGroups.length} nhóm hợp lệ từ file "${file.name}" (Lọc bỏ ${res.dedup_count ?? 0} trùng lặp, ${res.invalid_count ?? 0} link hỏng)`,
          "NẠP FILE THÀNH CÔNG"
        );
        return;
      }
    } catch (uploadErr) {
      console.warn("Backend upload error, trying parse text content:", uploadErr);
      try {
        const text = await file.text();
        const res = await parseGroupFileSource({ content: text, filter_posted: false });
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
            `Đã nạp ${validGroups.length} nhóm hợp lệ từ file "${file.name}"`,
            "NẠP FILE THÀNH CÔNG"
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

  return (
    <SectionCard
      number="3"
      title="Nguồn nhóm"
      description="Chọn hình thức cấp nguồn nhóm: quét tìm theo từ khóa Facebook hoặc nạp từ file danh sách link nhóm (.txt, .csv)"
      aside={
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-primary">
            Đã chọn {selectedGroupKeys.length}/{baseGroups.length} nhóm
          </span>
        </div>
      }
    >
      {/* 2 Chế độ nguồn nhóm: Tìm kiếm theo từ khóa VS Từ file link */}
      <div className="grid gap-3 md:grid-cols-2">
        <button
          type="button"
          onClick={() => setGroupSource("search")}
          className={`rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${groupSource === "search"
            ? "border-2 border-primary bg-white shadow-xs"
            : "border-slate-200 bg-white hover:border-slate-300"
            }`}
        >
          <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
            <span
              className={`flex size-3.5 items-center justify-center rounded-full border ${groupSource === "search" ? "border-2 border-primary bg-white" : "border-slate-300 bg-white"
                }`}
            >
              {groupSource === "search" && <span className="size-1.5 rounded-full bg-primary" />}
            </span>
            <span className="flex size-5 items-center justify-center rounded bg-primary text-white">
              <Search className="size-3" />
            </span>
            <span>Tìm kiếm nhóm theo từ khóa</span>
          </div>
          <p className="mt-1 pl-5.5 text-[10px] text-slate-400">
            Quét tìm kiếm các nhóm Facebook theo từ khóa chủ đề, tự động lọc theo số lượng thành viên và loại nhóm phù hợp để đăng bài.
          </p>
        </button>

        <button
          type="button"
          onClick={() => setGroupSource("file")}
          className={`rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${groupSource === "file"
            ? "border-2 border-primary bg-white shadow-xs"
            : "border-slate-200 bg-white hover:border-slate-300"
            }`}
        >
          <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
            <span
              className={`flex size-3.5 items-center justify-center rounded-full border ${groupSource === "file" ? "border-2 border-primary bg-white" : "border-slate-300 bg-white"
                }`}
            >
              {groupSource === "file" && <span className="size-1.5 rounded-full bg-primary" />}
            </span>
            <span className="flex size-5 items-center justify-center rounded bg-primary text-white">
              <Link2 className="size-3" />
            </span>
            <span>Từ file link nhóm (.txt, .csv)</span>
          </div>
          <p className="mt-1 pl-5.5 text-[10px] text-slate-400">
            Nạp danh sách nhóm từ file link có sẵn, hệ thống tự động khử trùng lặp và loại bỏ các link nhóm bị lỗi.
          </p>
        </button>
      </div>

      {/* NỘI DUNG CHẾ ĐỘ 1: TỪ FILE LINK NHÓM */}
      {groupSource === "file" && (
        <div className="mt-4 space-y-3">
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
            className={`flex flex-col items-center justify-center rounded-xl border border-dashed px-4 py-7 text-center transition-colors ${isFileProcessing
              ? "border-primary/40 bg-blue-50/50"
              : "border-blue-200 bg-blue-50/20 hover:bg-blue-50/30"
              }`}
          >
            <div className="mb-2.5 flex size-9 items-center justify-center rounded-full bg-blue-100 text-primary">
              {isFileProcessing ? (
                <Loader2 className="size-4.5 animate-spin" />
              ) : (
                <FileUp className="size-4.5" />
              )}
            </div>
            {isFileProcessing ? (
              <p className="text-xs font-semibold text-primary">
                Đang nạp và kiểm tra dữ liệu nhóm qua Backend...
              </p>
            ) : (
              <>
                <p className="text-xs font-medium text-slate-600">
                  Kéo thả file vào đây hoặc{" "}
                  <button
                    type="button"
                    onClick={() => groupFileInputRef.current?.click()}
                    className="font-semibold text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary cursor-pointer"
                  >
                    📂 chọn file .txt từ máy tính
                  </button>
                </p>
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs text-primary hover:underline cursor-pointer"
                >
                  <Download className="size-3.5" /> Tải file mẫu danh sách link (.txt)
                </button>
              </>
            )}
          </div>

          {groupFile && (
            <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-emerald-50 text-emerald-600">
                  <FileText className="size-5" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-slate-800">{groupFile.name}</span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                      <Check className="size-3 stroke-[2.5]" /> Hợp lệ ({groupFile.validGroupsCount ?? 0} nhóm)
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {groupFile.size ? `${(groupFile.size / 1024).toFixed(1)} KB` : "—"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Đã tự động lọc bỏ {groupFile.dedupCount ?? 0} nhóm trùng lặp & {groupFile.invalidCount ?? 0} link hỏng/lỗi
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-auto">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => groupFileInputRef.current?.click()}
                  className="h-8 gap-1.5 border-slate-200 text-xs text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  <RotateCw className="size-3.5 text-slate-500" /> Chọn file khác
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRemoveGroupFile}
                  className="h-8 gap-1.5 border-slate-200 text-xs text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                >
                  <Trash2 className="size-3.5 text-slate-400" /> Xóa file
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* NỘI DUNG CHẾ ĐỘ 2: TÌM KIẾM THEO TỪ KHÓA */}
      {groupSource === "search" && (
        <div className="mt-4 space-y-2.5">
          {/* Thông tin tài khoản cào dữ liệu hoặc cảnh báo cần chọn tài khoản */}
          {activeScrapingAccount ? (
            <div className="flex flex-wrap items-center justify-between gap-2 px-0.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/80 px-2.5 py-0.5 text-[11px] text-emerald-800">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Tài khoản quét: <strong className="font-semibold text-emerald-950">{activeScrapingAccount.name}</strong>
                  <span className="font-mono text-[10px] text-emerald-700/80">({activeScrapingAccount.uid})</span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  document.getElementById("step-1-accounts")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="text-[11px] text-slate-500 hover:text-primary transition-colors cursor-pointer"
              >
                Đổi tài khoản ở Bước 1 →
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <div className="flex items-center gap-2">
                <AlertCircle className="size-4 text-amber-600 shrink-0" />
                <span className="text-[11px]">
                  <strong>Chưa chọn tài khoản ở Bước 1.</strong> Hệ thống cần 1 tài khoản Facebook để đăng nhập và cào dữ liệu nhóm thật.
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  document.getElementById("step-1-accounts")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-2xs hover:bg-amber-700 cursor-pointer"
              >
                Lên Bước 1 chọn tài khoản
              </button>
            </div>
          )}

          {/* Thanh tìm kiếm chính tích hợp chọn số lượng nhóm quét */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={groupSearch}
                onChange={(event) => setGroupSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (!isSearching) {
                      handleSearchGroups();
                    }
                  }
                }}
                placeholder="Nhập từ khóa tìm nhóm (VD: việc làm online, tuyển dụng ctv, mẹ bỉm sữa...)"
                className="h-9 pl-9 pr-3 text-xs"
              />
            </div>

            {/* Chọn số lượng nhóm tối đa cần quét */}
            <div className="w-full sm:w-44 shrink-0">
              <SelectField
                value={maxResults}
                onChange={(e) => setMaxResults(e.target.value)}
                className="h-9 text-xs border-slate-200 bg-white"
                title="Chọn số lượng nhóm Facebook tối đa cần quét"
              >
                <option value="10">Quét 10 nhóm</option>
                <option value="20">Quét 20 nhóm (Nhanh)</option>
                <option value="30">Quét 30 nhóm</option>
                <option value="50">Quét 50 nhóm (Mặc định)</option>
                <option value="100">Quét 100 nhóm (Nhiều)</option>
                <option value="150">Quét 150 nhóm</option>
                <option value="200">Quét 200 nhóm (Tối đa)</option>
              </SelectField>
            </div>

            <Button
              type="button"
              size="sm"
              disabled={isSearching}
              onClick={handleSearchGroups}
              className="h-9 px-4 shrink-0 text-xs font-medium cursor-pointer shadow-xs"
            >
              {isSearching ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Search className="mr-1.5 size-3.5" />
              )}
              {isSearching ? "Đang quét nhóm..." : "Quét nhóm"}
            </Button>
          </div>

          {/* Thanh tiêu chí lọc phụ: Gọn gàng trên 1 hàng, tối ưu diện tích thị giác */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200/80 bg-slate-50/70 px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 mr-1">
                <ListFilter className="size-3.5 text-primary" /> Tiêu chí lọc:
              </span>

              {/* Lọc thành viên */}
              <div className="w-36">
                <SelectField
                  value={memberFilter}
                  onChange={(e) => setMemberFilter(e.target.value)}
                  className="h-7 border-slate-200 bg-white text-[11px] py-0 px-2"
                  title="Lọc theo số lượng thành viên"
                >
                  <option value="all">TV: Tất cả</option>
                  <option value="10k">&gt; 10K thành viên</option>
                  <option value="50k">&gt; 50K thành viên</option>
                  <option value="100k">&gt; 100K thành viên</option>
                </SelectField>
              </div>

              {/* Lọc tần suất bài viết */}
              <div className="w-36">
                <SelectField
                  value={frequencyFilter}
                  onChange={(e) => setFrequencyFilter(e.target.value)}
                  className="h-7 border-slate-200 bg-white text-[11px] py-0 px-2"
                  title="Lọc theo tần suất bài viết/ngày"
                >
                  <option value="all">Tần suất: Tất cả</option>
                  <option value="5">5+ bài viết/ngày</option>
                  <option value="10">10+ bài viết/ngày</option>
                  <option value="20">20+ bài viết/ngày</option>
                </SelectField>
              </div>

              {/* Lọc quyền riêng tư */}
              <div className="w-36">
                <SelectField
                  value={groupTypeFilter}
                  onChange={(e) => setGroupTypeFilter(e.target.value)}
                  className="h-7 border-slate-200 bg-white text-[11px] py-0 px-2"
                  title="Lọc theo quyền riêng tư nhóm"
                >
                  <option value="all">Quyền: Tất cả</option>
                  <option value="public">Nhóm Công khai</option>
                  <option value="private">Nhóm Kiểm duyệt</option>
                </SelectField>
              </div>
            </div>

            {/* Đặt lại bộ lọc */}
            {(memberFilter !== "all" || groupTypeFilter !== "all" || frequencyFilter !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setMemberFilter("all");
                  setGroupTypeFilter("all");
                  setFrequencyFilter("all");
                }}
                className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 hover:text-rose-600 transition-colors cursor-pointer"
                title="Đặt lại các tiêu chí lọc phụ"
              >
                <RotateCw className="size-2.5" /> Đặt lại lọc
              </button>
            )}
          </div>
        </div>
      )}

      {/* THANH THAO TÁC, THỐNG KÊ VÀ BẢNG DANH SÁCH NHÓM (ẨN KHI CHƯA TÌM KIẾM TỪ KHÓA) */}
      {!isSearchIdle && (
        <>
          {/* THANH THAO TÁC BẢNG NHÓM */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={groupFilter}
                onChange={(event) => setGroupFilter(event.target.value)}
                placeholder="Lọc nhanh nhóm trong danh sách..."
                className="h-8 pl-9 text-xs"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleSelectAll}
                className="h-8 text-xs cursor-pointer"
              >
                <Check className="mr-1 size-3.5" /> Chọn tất cả ({filteredGroups.length})
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 border-red-200 text-xs text-red-500 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                onClick={handleClearAll}
              >
                <Trash2 className="mr-1 size-3.5" /> Bỏ chọn hết
              </Button>
            </div>
          </div>

          {/* THÔNG KÊ SỐ LƯỢNG */}
          <div className="my-3 flex items-center justify-between text-[11px]">
            <span className="font-semibold text-emerald-600">
              ● Đang sẵn sàng: {filteredGroups.length} nhóm
              {selectedGroupKeys.length > 0 && ` (Đã chọn: ${selectedGroupKeys.length})`}
            </span>
            <span className="text-slate-400">
              {groupSource === "file"
                ? "Nguồn: File link ngoài"
                : `Từ khóa: "${groupSearch || "Mặc định"}" (Lọc tối đa ${maxResults} nhóm)`}
            </span>
          </div>

          {/* BẢNG DANH SÁCH NHÓM */}
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <div ref={tableContainerRef} className="max-h-[360px] overflow-auto">
              <table className="w-full min-w-[700px] text-left text-[11px]">
                <thead className="sticky top-0 bg-slate-50 text-slate-500 shadow-xs z-10">
                  <tr className="border-b border-slate-200">
                    <th className="w-10 px-3 py-2.5">
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
                    <th className="w-12 px-2 py-2.5 font-semibold">STT</th>
                    <th className="px-3 py-2.5 font-semibold">Tên nhóm & Link URL</th>
                    <th className="px-3 py-2.5 font-semibold">Tần suất</th>
                    <th className="px-3 py-2.5 font-semibold">Thành viên</th>
                    <th className="w-16 px-3 py-2.5 text-center font-semibold">Xóa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {isFileProcessing || isSearching ? (
                    <tr>
                      <td colSpan="6" className="py-12 text-center text-slate-500">
                        <Loader2 className="mx-auto mb-2 size-6 animate-spin text-primary" />
                        <p className="text-xs font-medium text-slate-700">
                          {isFileProcessing
                            ? "Đang nạp và chuẩn hóa danh sách link nhóm qua Backend..."
                            : "Đang quét danh sách nhóm Facebook qua Backend..."}
                        </p>
                      </td>
                    </tr>
                  ) : filteredGroups.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="py-10 text-center text-slate-400">
                        <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                          <AlertCircle className="size-5" />
                        </div>
                        <p className="text-xs font-medium text-slate-600">
                          {groupSource === "file"
                            ? "Chưa có nhóm nào từ file"
                            : "Chưa có kết quả tìm kiếm nhóm"}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400 max-w-md mx-auto">
                          {groupSource === "file"
                            ? "Vui lòng kéo thả file .txt/.csv hoặc bấm 'Tải file mẫu' phía trên để nạp danh sách link nhóm thật."
                            : "Nhập từ khóa chủ đề (VD: việc làm online, tuyển dụng ctv...) và bấm 'Quét nhóm theo từ khóa'."}
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredGroups.map((group, idx) => {
                      const isSelected = selectedGroupKeys.includes(group.key);
                      const isPublic = group.privacy === "public";
                      return (
                        <tr
                          key={group.key}
                          data-group-key={group.key}
                          onClick={(e) => handleRowClick(group.key, e)}
                          className={`transition-colors select-none cursor-pointer ${
                            isSelected ? "bg-blue-50/70 hover:bg-blue-100/60" : "bg-white hover:bg-slate-50"
                          }`}
                        >
                          <td className="px-3 py-2">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) => toggleGroup(group.key, checked)}
                            />
                          </td>
                          <td className="px-2 py-2 text-slate-400 font-mono text-[10px]">{group.id || idx + 1}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="font-semibold text-slate-800 line-clamp-1">{group.name}</p>
                              {isPublic ? (
                                <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 border border-emerald-200">
                                  <Globe className="size-2.5" /> Công khai
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 border border-amber-200">
                                  <Lock className="size-2.5" /> Kiểm duyệt
                                </span>
                              )}
                              {group.already_posted && (
                                <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[9px] font-medium text-rose-600 border border-rose-200">
                                  Đã đăng gần đây
                                </span>
                              )}
                            </div>
                            <a
                              href={group.url.startsWith("http") ? group.url : `https://${group.url}`}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-primary hover:underline font-mono"
                            >
                              {group.url}
                              <ExternalLink className="size-2.5" />
                            </a>
                          </td>
                          <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{group.frequency || "15 bài/ngày"}</td>
                          <td className="px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">{group.members || "—"}</td>
                          <td className="px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveSingleGroup(group.key)}
                              className="p-1 text-slate-400 hover:text-red-500 rounded hover:bg-red-50 transition-colors cursor-pointer"
                              title="Xóa nhóm này"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* THÔNG TIN HỖ TRỢ & HƯỚNG DẪN CHỌN */}
          <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1 text-slate-400">
              {filteredGroups.length > 0 && (
                <span>
                  Tổng cộng: <strong className="text-slate-600">{filteredGroups.length}</strong> nhóm
                  {selectedGroupKeys.length > 0 && (
                    <> (Đã chọn: <strong className="text-primary">{selectedGroupKeys.length}</strong>)</>
                  )}
                </span>
              )}
            </span>
            <span className="flex items-center gap-1.5 text-slate-400">
              <MousePointerClick className="size-3 text-primary/70" />
              <span>Giữ & kéo chuột để lướt chọn dải nhóm</span>
            </span>
          </div>
        </>
      )}
    </SectionCard>
  );
}
