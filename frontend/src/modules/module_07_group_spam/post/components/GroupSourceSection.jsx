import React, { useRef, useState, useMemo } from "react";
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
  Plus,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { SectionCard, SelectField } from "../../shared/components";
import { GROUPS as DEFAULT_GROUPS } from "../../shared/constants";
import { parseGroupFileSource, searchGroupSource } from "../../service";

/**
 * ============================================================================
 * MODULE 07 - BƯỚC 3: NGUỒN NHÓM FACEBOOK (GroupSourceSection)
 * Kế thừa nghiệp vụ từ FaceBook_Post_Group.py:
 * 1. Đọc danh sách nhóm từ File link nhóm (.txt, .csv) - tương ứng self.btn_group_file
 *    - Lọc link hợp lệ (facebook.com/groups/...), tách query param '?'.
 *    - Tự động khử trùng lặp (dedup) và loại bỏ dòng rác/lỗi.
 * 2. Tìm kiếm nhóm theo Từ khóa - tương ứng self.txt_keyword
 *    - Tìm kiếm nhóm tự động theo từ khóa chủ đề (search_term).
 *    - Bộ lọc số lượng thành viên (> 10K, > 50K, > 100K TV), loại nhóm công khai.
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
  customGroups,
  setCustomGroups,
}) {
  const groupFileInputRef = useRef(null);
  const [memberFilter, setMemberFilter] = useState("all");
  const [groupTypeFilter, setGroupTypeFilter] = useState("all");
  const [isManualDialogOpen, setIsManualDialogOpen] = useState(false);
  const [manualGroupInput, setManualGroupInput] = useState("");

  // Danh sách nhóm đang hiển thị: nếu có nhóm custom/file thì ưu tiên, không thì lấy DEFAULT_GROUPS
  const baseGroups = useMemo(() => {
    if (groupSource === "file" && groupFile?.groups?.length) {
      return groupFile.groups;
    }
    return customGroups || DEFAULT_GROUPS;
  }, [groupSource, groupFile, customGroups]);

  // Bộ lọc tìm kiếm và số lượng thành viên
  const filteredGroups = useMemo(() => {
    return baseGroups.filter((group) => {
      // Lọc theo từ khóa tìm kiếm nhanh trong bảng
      const query = groupFilter.trim().toLowerCase();
      const matchQuery = !query || `${group.name} ${group.url}`.toLowerCase().includes(query);

      // Lọc theo số lượng thành viên (nếu có dữ liệu)
      let matchMember = true;
      const memNum = parseInt(String(group.members || "0").replace(/[^\d]/g, ""), 10);
      if (memberFilter === "10k") matchMember = memNum >= 10;
      else if (memberFilter === "50k") matchMember = memNum >= 50;
      else if (memberFilter === "100k") matchMember = memNum >= 100;

      return matchQuery && matchMember;
    });
  }, [baseGroups, groupFilter, memberFilter]);

  // Toggle chọn 1 nhóm
  const toggleGroup = (key, checked) => {
    setSelectedGroupKeys((current) =>
      checked ? [...new Set([...current, key])] : current.filter((item) => item !== key)
    );
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
      setCustomGroups((current) => (current || DEFAULT_GROUPS).filter((g) => g.key !== key));
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

  // Thêm nhóm thủ công bằng Link hoặc UID
  const handleAddManualGroup = () => {
    const input = manualGroupInput.trim();
    if (!input) return;

    // Chuẩn hóa link (loại bỏ query ? giống FaceBook_Post_Group.py)
    const cleanUrl = input.split("?")[0].replace(/^https?:\/\//, "").trim();
    const newGroupKey = `manual_${Date.now()}`;
    const newGroupItem = {
      id: String(baseGroups.length + 1).padStart(2, "0"),
      key: newGroupKey,
      name: `Nhóm thủ công (${cleanUrl.replace("facebook.com/groups/", "")})`,
      url: cleanUrl.startsWith("facebook.com") ? cleanUrl : `facebook.com/groups/${cleanUrl}`,
      frequency: "15 bài",
      members: "Tự do",
    };

    const nextList = [newGroupItem, ...baseGroups];
    if (setCustomGroups) setCustomGroups(nextList);
    if (groupSource === "file" && groupFile) {
      setGroupFile({
        ...groupFile,
        groups: nextList,
        validGroupsCount: nextList.length,
      });
    }
    setSelectedGroupKeys((cur) => [newGroupKey, ...cur]);
    setManualGroupInput("");
    setIsManualDialogOpen(false);
  };

  /**
   * Xử lý file link nhóm (Tương tự logic trong FaceBook_Post_Group.py)
   * 1. Đọc text từng dòng
   * 2. Bỏ qua ghi chú '#' hoặc dòng trống
   * 3. Lọc lấy các link chứa facebook.com/groups hoặc fb.com hoặc dãy số UID
   * 4. Bỏ các param URL rác đằng sau dấu '?' (line.split('?')[0])
   * 5. Khử trùng lặp (dedup) và thống kê link hỏng
   */
  const [isSearching, setIsSearching] = useState(false);

  const handleSearchGroups = async () => {
    if (!groupSearch?.trim()) return;
    setIsSearching(true);
    try {
      const res = await searchGroupSource({ keyword: groupSearch.trim(), max_results: 50 });
      if (res?.groups?.length) {
        if (setCustomGroups) setCustomGroups(res.groups);
        setSelectedGroupKeys(res.groups.map((g) => g.key));
      }
    } catch (err) {
      console.warn("Backend search group error:", err);
    } finally {
      setIsSearching(false);
    }
  };

  /**
   * Xử lý file link nhóm: Gọi Backend Module 7 (/api/groups/source/parse)
   * Kế thừa nghiệp vụ FaceBook_Post_Group.py (tách '?', dedup, lọc lỗi, check history)
   */
  const processGroupFile = (file) => {
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = String(event.target?.result || "");
      try {
        const res = await parseGroupFileSource({ content: text, filter_posted: false });
        if (res && Array.isArray(res.groups)) {
          setGroupFile({
            name: file.name,
            size: file.size,
            status: "valid",
            dedupCount: res.dedup_count,
            invalidCount: res.invalid_count,
            validGroupsCount: res.valid_count,
            alreadyPostedCount: res.already_posted_count,
            groups: res.groups,
          });
          setSelectedGroupKeys(res.groups.map((g) => g.key));
          return;
        }
      } catch (err) {
        console.warn("Backend parse fallback to local parser:", err);
      }

      // Fallback local parser nếu backend không khả dụng
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));

      const cleanedLines = lines.map((line) => line.split("?")[0].trim());
      const unique = Array.from(new Set(cleanedLines));

      const validLinks = unique.filter(
        (line) =>
          line.includes("facebook.com/groups") ||
          line.includes("fb.com/groups") ||
          line.includes("facebook.com") ||
          /^\d{6,}$/.test(line)
      );

      const invalidCount = unique.length - validLinks.length;
      const dedupCount = lines.length - unique.length;

      const fileGroups = validLinks.map((url, idx) => {
        const rawUrl = url.replace(/^https?:\/\//, "");
        const cleanUrl = rawUrl.startsWith("facebook.com") ? rawUrl : `facebook.com/groups/${rawUrl}`;
        const groupUid = cleanUrl.split("/groups/")[1]?.replace(/\/$/, "") || `group_${idx + 1}`;
        return {
          id: String(idx + 1).padStart(2, "0"),
          key: `file_group_${idx}_${groupUid}`,
          name: `Nhóm file #${idx + 1} (${groupUid})`,
          url: cleanUrl,
          frequency: "15 bài",
          members: "—",
        };
      });

      setGroupFile({
        name: file.name,
        size: file.size,
        status: "valid",
        dedupCount,
        invalidCount,
        validGroupsCount: fileGroups.length,
        groups: fileGroups,
      });

      setSelectedGroupKeys(fileGroups.map((g) => g.key));
    };
    reader.readAsText(file);
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

  const handleDownloadTemplate = () => {
    const templateContent = [
      "# ==========================================================================",
      "# DANH SÁCH LINK NHÓM FACEBOOK ĐĂNG BÀI (Mỗi dòng 1 link hoặc UID nhóm)",
      "# Hỗ trợ: https://www.facebook.com/groups/<tên_hoặc_uid_nhóm>",
      "# ==========================================================================",
      "https://www.facebook.com/groups/vieclamonline2024",
      "https://www.facebook.com/groups/muabanonline2024",
      "https://www.facebook.com/groups/tuyendungctvhn",
      "https://www.facebook.com/groups/congdongmarketingvn",
      "https://www.facebook.com/groups/khoinghiepkinhdoanh2024",
      "https://www.facebook.com/groups/sinhvientimvieclam",
    ].join("\n");
    const blob = new Blob([templateContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mau_danh_sach_nhom_fb.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleRemoveGroupFile = () => {
    setGroupFile(null);
    setSelectedGroupKeys(DEFAULT_GROUPS.map((g) => g.key));
    if (groupFileInputRef.current) {
      groupFileInputRef.current.value = "";
    }
  };

  return (
    <SectionCard
      number="3"
      title="Nguồn nhóm"
      description="Chọn hình thức cấp nguồn nhóm: đăng theo danh sách file link nhóm (.txt) hoặc quét tìm theo từ khóa"
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
          onClick={() => setGroupSource("file")}
          className={`rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
            groupSource === "file"
              ? "border-2 border-primary bg-white shadow-xs"
              : "border-slate-200 bg-white hover:border-slate-300"
          }`}
        >
          <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
            <span
              className={`flex size-3.5 items-center justify-center rounded-full border ${
                groupSource === "file" ? "border-2 border-primary bg-white" : "border-slate-300 bg-white"
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
            Kế thừa từ FaceBook_Post_Group.py: Đăng chính xác vào các nhóm trong file link. Tự động khử trùng lặp và loại bỏ link lỗi.
          </p>
        </button>

        <button
          type="button"
          onClick={() => setGroupSource("search")}
          className={`rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
            groupSource === "search"
              ? "border-2 border-primary bg-white shadow-xs"
              : "border-slate-200 bg-white hover:border-slate-300"
          }`}
        >
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
            <span
              className={`flex size-3.5 items-center justify-center rounded-full border ${
                groupSource === "search" ? "border-2 border-primary bg-white" : "border-slate-300 bg-white"
              }`}
            >
              {groupSource === "search" && <span className="size-1.5 rounded-full bg-primary" />}
            </span>
            <Search className="size-4 text-slate-500" />
            <span>Tìm kiếm nhóm theo từ khóa</span>
          </div>
          <p className="mt-1 pl-5.5 text-[10px] text-slate-400">
            Tự động tìm kiếm trên Facebook theo từ khóa (search_term) và đăng bài vào các nhóm phù hợp.
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
            className="flex flex-col items-center justify-center rounded-xl border border-dashed border-blue-200 bg-blue-50/20 px-4 py-7 text-center transition-colors hover:bg-blue-50/30"
          >
            <div className="mb-2.5 flex size-9 items-center justify-center rounded-full bg-blue-100 text-primary">
              <FileUp className="size-4.5" />
            </div>
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
        <div className="mt-4 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={groupSearch}
                onChange={(event) => setGroupSearch(event.target.value)}
                placeholder="Nhập từ khóa tìm nhóm (VD: việc làm online, tuyển dụng ctv, mẹ bỉm sữa...)"
                className="pl-9"
              />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={isSearching || !groupSearch.trim()}
              onClick={handleSearchGroups}
              className="cursor-pointer"
            >
              <Search className="mr-1.5 size-3.5" />
              {isSearching ? "Đang quét nhóm..." : "Quét nhóm theo từ khóa"}
            </Button>
          </div>

          {/* Bộ lọc số lượng thành viên và loại nhóm */}
          <div className="flex flex-wrap items-center gap-2 text-[10px]">
            <span className="flex items-center gap-1 font-semibold text-slate-600">
              <ListFilter className="size-3.5 text-primary" /> Bộ lọc nhóm:
            </span>
            <button
              type="button"
              onClick={() => setMemberFilter("all")}
              className={`rounded border px-2.5 py-1.5 font-semibold cursor-pointer ${
                memberFilter === "all" ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              Tất cả TV
            </button>
            <button
              type="button"
              onClick={() => setMemberFilter("10k")}
              className={`rounded border px-2.5 py-1.5 font-semibold cursor-pointer ${
                memberFilter === "10k" ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              &gt; 10K TV
            </button>
            <button
              type="button"
              onClick={() => setMemberFilter("50k")}
              className={`rounded border px-2.5 py-1.5 font-semibold cursor-pointer ${
                memberFilter === "50k" ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              &gt; 50K TV
            </button>
            <button
              type="button"
              onClick={() => setMemberFilter("100k")}
              className={`rounded border px-2.5 py-1.5 font-semibold cursor-pointer ${
                memberFilter === "100k" ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              &gt; 100K TV
            </button>

            <SelectField
              value={groupTypeFilter}
              onChange={(e) => setGroupTypeFilter(e.target.value)}
              className="h-7 w-auto py-0 text-[10px]"
            >
              <option value="all">Tất cả loại nhóm</option>
              <option value="public">Nhóm công khai (Public)</option>
              <option value="private">Nhóm kiểm duyệt (Private)</option>
            </SelectField>

            {memberFilter !== "all" && (
              <button
                type="button"
                onClick={() => setMemberFilter("all")}
                className="text-[10px] text-slate-400 hover:text-slate-600 underline cursor-pointer ml-1"
              >
                Đặt lại lọc
              </button>
            )}
          </div>
        </div>
      )}

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
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs text-primary cursor-pointer"
            onClick={() => setIsManualDialogOpen((prev) => !prev)}
          >
            <Plus className="mr-1 size-3.5" /> Thêm link thủ công
          </Button>
        </div>
      </div>

      {/* Hộp thoại thêm link nhóm thủ công */}
      {isManualDialogOpen && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-primary/20 bg-blue-50/30 p-2.5">
          <Input
            value={manualGroupInput}
            onChange={(e) => setManualGroupInput(e.target.value)}
            placeholder="Dán link nhóm (https://www.facebook.com/groups/...) hoặc UID..."
            className="h-8 text-xs bg-white"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddManualGroup();
            }}
          />
          <Button type="button" size="sm" onClick={handleAddManualGroup} className="h-8 text-xs cursor-pointer">
            Thêm
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setIsManualDialogOpen(false)}
            className="h-8 text-xs cursor-pointer"
          >
            Hủy
          </Button>
        </div>
      )}

      {/* THÔNG KÊ SỐ LƯỢNG */}
      <div className="my-3 flex items-center justify-between text-[11px]">
        <span className="font-semibold text-emerald-600">
          ● Đang sẵn sàng: {filteredGroups.length} nhóm
          {selectedGroupKeys.length > 0 && ` (Đã chọn: ${selectedGroupKeys.length})`}
        </span>
        <span className="text-slate-400">
          {groupSource === "file" ? "Nguồn: File link ngoài" : `Từ khóa: "${groupSearch || "Mặc định"}"`}
        </span>
      </div>

      {/* BẢNG DANH SÁCH NHÓM */}
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <div className="max-h-[360px] overflow-auto">
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
              {filteredGroups.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-8 text-center text-slate-400">
                    <AlertCircle className="mx-auto mb-1.5 size-5 text-slate-300" />
                    Không tìm thấy nhóm nào phù hợp bộ lọc hoặc file trống.
                  </td>
                </tr>
              ) : (
                filteredGroups.map((group, idx) => {
                  const isSelected = selectedGroupKeys.includes(group.key);
                  return (
                    <tr
                      key={group.key}
                      className={`transition-colors ${isSelected ? "bg-blue-50/25" : "bg-white hover:bg-slate-50/50"}`}
                    >
                      <td className="px-3 py-2">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => toggleGroup(group.key, checked)}
                        />
                      </td>
                      <td className="px-2 py-2 text-slate-400 font-mono text-[10px]">{group.id || idx + 1}</td>
                      <td className="px-3 py-2">
                        <p className="font-semibold text-slate-800 line-clamp-1">{group.name}</p>
                        <a
                          href={group.url.startsWith("http") ? group.url : `https://${group.url}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                        >
                          {group.url}
                          <ExternalLink className="size-2.5" />
                        </a>
                      </td>
                      <td className="px-3 py-2 text-slate-500">{group.frequency || "15 bài"}</td>
                      <td className="px-3 py-2 font-semibold text-slate-600">{group.members || "—"}</td>
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
    </SectionCard>
  );
}
