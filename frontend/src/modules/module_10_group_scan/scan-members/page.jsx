"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Pause,
  Play,
  Square,
} from "lucide-react";
import { toast } from "@/lib/toast";
import AccountSelectModal, { isScanReady } from "../components/AccountSelectModal";
import GroupPickerModal from "../components/GroupPickerModal";
import {
  controlMemberScan,
  getMemberScanStatus,
  getActiveMemberScan,
  getScanAccounts,
  getScanCategories,
  getScannedMembers,
  startMemberScan,
} from "../service";
import AccountGroupPickerCard from "./_components/AccountGroupPickerCard";
import AdvancedScanFilterCard from "./_components/AdvancedScanFilterCard";
import GroupPreviewSection from "./_components/GroupPreviewSection";
import LiveMemberResultSection from "./_components/LiveMemberResultSection";
import LiveLogConsole from "./_components/LiveLogConsole";
import { downloadTable, memberExportTable, safeFileName } from "../utils/exportTable";
import ModulePageHeader from "../components/ModulePageHeader";

function normalizeAccount(raw) {
  const status = String(raw.status || "").toLowerCase();
  let login = String(raw.login_status || "").toLowerCase();
  if (login === "success") login = "logged_in";
  if (!login && String(raw.login_status || "").toUpperCase() === "LOGGED_IN") login = "logged_in";
  return {
    ...raw,
    uid: String(raw.uid || ""),
    profile_name: raw.profile_name || raw.name || "",
    email: raw.email || raw.mail || "",
    status: status === "live" || status === "die" ? status : status || "unknown",
    login_status: login || "not_logged_in",
  };
}

export default function GroupScanMembersPage() {
  // --- Account Selection State ---
  const [accountsModalOpen, setAccountsModalOpen] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [moduleAccounts, setModuleAccounts] = useState([]);
  const [selectedUids, setSelectedUids] = useState([]);

  // Load accounts from Module 2 API
  // fresh=true (nút Làm mới): bỏ cache để thấy ngay trạng thái Live / đăng nhập mới nhất.
  const loadAccounts = useCallback(async ({ fresh = false } = {}) => {
    setAccountsLoading(true);
    try {
      const res = await getScanAccounts({ fresh });
      const rawList = Array.isArray(res)
        ? res
        : Array.isArray(res?.accounts)
        ? res.accounts
        : Array.isArray(res?.data)
        ? res.data
        : [];
      const list = rawList.map(normalizeAccount);
      setModuleAccounts(list);
      setSelectedUids((current) => {
        const readyUids = list.filter(isScanReady).map((acc) => acc.uid);
        const kept = current.filter((uid) => readyUids.includes(uid));
        if (kept.length > 0) return kept;
        // Chỉ tự chọn nick Live + đã đăng nhập; không có nick nào sẵn sàng thì để trống.
        return readyUids.slice(0, 5);
      });
      return true;
    } catch {
      setModuleAccounts([]);
      setSelectedUids([]);
      return false;
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const selectedAccountNames = useMemo(() => {
    return moduleAccounts
      .filter((a) => selectedUids.includes(a.uid))
      .map((a) => a.profile_name || a.uid)
      .join(", ");
  }, [moduleAccounts, selectedUids]);

  // --- Group Selection State ---
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);

  // Load available groups & categories from Database
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [members, setMembers] = useState([]);

  const loadCategoriesAndGroups = useCallback(async () => {
    try {
      const data = await getScanCategories();
      const cats = Array.isArray(data) ? data : [];
      setCategories(
        cats.map((c) => ({
          id: c.id,
          name: c.name,
          stats: `${c.count || 0} nhóm FB`,
          membersTotal: 0,
          memberSizeStr: "0",
        }))
      );
      if (cats.length > 0) {
        setSelectedCategory((prev) => (prev && cats.some((c) => c.id === prev) ? prev : cats[0].id));
      } else {
        setSelectedCategory("");
      }
    } catch {
      setCategories([]);
    }
  }, []);

  useEffect(() => {
    loadCategoriesAndGroups();
  }, [loadCategoriesAndGroups]);

  // Nạp thành viên đã quét từ CSDL
  const loadDatabaseMembers = useCallback(async (catId) => {
    try {
      const res = await getScannedMembers({ category_id: catId, page_size: 100 });
      if (res?.members && Array.isArray(res.members)) {
        setMembers(res.members);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (selectedCategory) {
      loadDatabaseMembers(selectedCategory);
    }
  }, [selectedCategory, loadDatabaseMembers]);

  // --- Section 2: Config Steppers & Checkboxes ---
  const [minDelay, setMinDelay] = useState(5);
  const [maxDelay, setMaxDelay] = useState(10);
  const [switchAccThreshold, setSwitchAccThreshold] = useState(5);
  const [membersLimit, setMembersLimit] = useState(50);

  const [skipAdmin, setSkipAdmin] = useState(true);
  const [autoDedupe, setAutoDedupe] = useState(true);
  const [newMembersOnly, setNewMembersOnly] = useState(false);

  // --- Section 4: Master-Detail Category & Members ---
  const [categorySearch, setCategorySearch] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedMembers, setSelectedMembers] = useState(new Set());
  const [currentPage, setCurrentPage] = useState(1);

  // --- Section 5: Logs & Execution ---
  const [logs, setLogs] = useState([
    {
      time: "—",
      thread: "System",
      message: "Module 10.2 sẵn sàng. Chọn tài khoản & nhóm cần quét thành viên, sau đó bấm Bắt đầu thực thi.",
      color: "text-slate-300",
    },
  ]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [activeJobId, setActiveJobId] = useState(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [copiedLog, setCopiedLog] = useState(false);

  // Mở lại trang / F5 trong lúc Engine đang quét → gắn lại vào phiên đó thay vì báo IDLE.
  useEffect(() => {
    let cancelled = false;
    getActiveMemberScan()
      .then((res) => {
        if (cancelled || !res?.job_id) return;
        setActiveJobId(res.job_id);
        setIsExecuting(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Polling Live Status
  useEffect(() => {
    if (!isExecuting || !activeJobId) return;
    let notFound = 0;

    const interval = setInterval(async () => {
      try {
        const res = await getMemberScanStatus({ jobId: activeJobId });
        const job = res?.job;
        if (!job) return;
        notFound = 0;

        if (Array.isArray(job.logs) && job.logs.length > 0) {
          setLogs(job.logs);
        }

        if (Array.isArray(job.members) && job.members.length > 0) {
          setMembers(job.members);
        }

        setIsPaused(job.status === "paused");
        setIsStopping(job.status === "stopping");

        if (job.status === "done" || job.status === "aborted" || job.status === "error") {
          setIsExecuting(false);
          setActiveJobId(null);
          setIsPaused(false);
          setIsStopping(false);
          if (job.status === "done") {
            toast.success(`Đã hoàn thành phiên quét! Thu thập được ${job.total_members_scanned || 0} thành viên.`);
            if (selectedCategory) loadDatabaseMembers(selectedCategory);
          } else if (job.status === "aborted") {
            toast.info("Phiên quét đã dừng lại.");
          } else if (job.status === "error") {
            toast.error(job.error || "Phiên quét gặp sự cố!");
          }
        }
      } catch (err) {
        // Chỉ thôi theo dõi khi Engine xác nhận không còn phiên (404 liên tiếp); lỗi mạng thì poll tiếp.
        if (err?.status === 404) {
          notFound += 1;
          if (notFound === 5) {
            setIsExecuting(false);
            setActiveJobId(null);
            setIsPaused(false);
            setIsStopping(false);
            toast.info("Phiên quét không còn trên máy chủ (có thể Engine vừa restart).");
          }
        }
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [isExecuting, activeJobId, selectedCategory, loadDatabaseMembers]);

  // Handle Remove Group from Preview Table
  const handleRemoveGroup = (groupId) => {
    setSelectedGroups((prev) => prev.filter((g) => g.id !== groupId));
    toast.success("Đã xóa nhóm khỏi danh sách quét!");
  };

  // Handle Execute Toggle
  // Dừng: gửi lệnh rồi tiếp tục poll tới khi worker báo kết thúc (để thấy log cuối).
  const handleStop = async () => {
    if (!activeJobId || isStopping || controlBusy) return;
    setControlBusy(true);
    try {
      await controlMemberScan({ jobId: activeJobId, action: "abort" });
      setIsStopping(true);
      toast.info("Đang dừng — chờ lưu dữ liệu và đóng trình duyệt...");
    } catch (err) {
      // Lệnh dừng không tới được phiên: KHÔNG tự coi là đã dừng (Engine có thể vẫn đang quét).
      toast.error(err?.message || "Không gửi được lệnh dừng — bấm Dừng lại lần nữa.");
    } finally {
      setControlBusy(false);
    }
  };

  const handlePauseResume = async () => {
    if (!activeJobId || isStopping || controlBusy) return;
    const action = isPaused ? "resume" : "pause";
    setControlBusy(true);
    try {
      await controlMemberScan({ jobId: activeJobId, action });
      setIsPaused(action === "pause");
      toast.info(action === "pause" ? "Đã tạm dừng phiên quét." : "Đang tiếp tục quét...");
    } catch (err) {
      toast.error(err?.message || "Không gửi được lệnh điều khiển.");
    } finally {
      setControlBusy(false);
    }
  };

  const handleToggleExecution = async () => {
    if (isExecuting) {
      await handleStop();
    } else {
      if (selectedUids.length === 0) {
        toast.error("Vui lòng chọn ít nhất một tài khoản thực thi!");
        return;
      }
      if (selectedGroups.length === 0) {
        toast.error("Vui lòng chọn ít nhất một nhóm để quét!");
        return;
      }
      if (selectedGroups.length > 20) {
        toast.warning("Số lượng nhóm mục tiêu trong một phiên quét không được vượt quá 20 nhóm để bảo đảm an toàn tài khoản!");
        return;
      }
      if (minDelay > maxDelay) {
        toast.error("Thời gian trễ tối đa phải lớn hơn hoặc bằng thời gian tối thiểu!");
        return;
      }
      if (maxDelay > 3600) {
        toast.error("Thời gian trễ tối đa không được vượt quá 3600 giây!");
        return;
      }

      try {
        setIsExecuting(true);
        setLogs([
          {
            time: new Date().toLocaleTimeString("vi-VN", { hour12: false }),
            thread: "Thread-01",
            color: "text-emerald-400",
            message: `[Bắt đầu quét] Kích hoạt ${selectedUids.length} tài khoản thực thi cho ${selectedGroups.length} nhóm...`,
          },
          {
            time: new Date().toLocaleTimeString("vi-VN", { hour12: false }),
            thread: "Thread-01",
            color: "text-slate-300",
            message: `Cấu hình: Delay ${minDelay}-${maxDelay}s, Đổi nick sau ${switchAccThreshold} nhóm, Giới hạn ${membersLimit} TV/nhóm.`,
          },
        ]);

        const res = await startMemberScan({
          uids: selectedUids,
          groups: selectedGroups,
          delay_min: minDelay,
          delay_max: maxDelay,
          switch_acc_threshold: switchAccThreshold,
          members_limit: membersLimit,
          skip_admin: skipAdmin,
          auto_dedupe: autoDedupe,
          new_members_only: newMembersOnly,
        });

        if (res?.job_id) {
          setActiveJobId(res.job_id);
          toast.success("Bắt đầu tiến trình quét thành viên nhóm...");
        } else {
          setIsExecuting(false);
          toast.error("Không thể khởi động phiên quét!");
        }
      } catch (err) {
        setIsExecuting(false);
        const errMsg = err?.response?.data?.detail || err?.message || "Đã xảy ra lỗi";
        toast.error(`Khởi chạy thất bại: ${errMsg}`);
      }
    }
  };

  // Copy Logs
  const handleCopyLogs = () => {
    const text = logs.map((l) => `[${l.time}] [${l.thread}] ${l.message}`).join("\n");
    navigator.clipboard.writeText(text);
    setCopiedLog(true);
    toast.success("Đã sao chép toàn bộ logs vào clipboard!");
    setTimeout(() => setCopiedLog(false), 2000);
  };

  // Filter Categories
  const filteredCategories = useMemo(() => {
    if (!categorySearch.trim()) return categories;
    return categories.filter((c) =>
      c.name.toLowerCase().includes(categorySearch.toLowerCase())
    );
  }, [categories, categorySearch]);

  // Filter Members
  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      const matchQuery =
        !memberSearch.trim() ||
        (m.name || "").toLowerCase().includes(memberSearch.toLowerCase()) ||
        String(m.uid || "").includes(memberSearch.trim());
      return matchQuery;
    });
  }, [members, memberSearch]);

  const pageSize = 15;
  const totalPages = Math.max(1, Math.ceil(filteredMembers.length / pageSize));
  const paginatedMembers = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredMembers.slice(start, start + pageSize).map((m, idx) => ({
      ...m,
      id: m.id || m.uid || `mem-${idx}`,
      stt: String(start + idx + 1).padStart(2, "0"),
      shortUid: m.uid ? (m.uid.length > 15 ? `${m.uid.slice(0, 6)}...${m.uid.slice(-4)}` : m.uid) : "—",
      time: m.scanned_at || m.time || "Vừa xong",
    }));
  }, [filteredMembers, currentPage, pageSize]);

  // Select all members toggle
  const allFilteredSelected =
    paginatedMembers.length > 0 &&
    paginatedMembers.every((m) => selectedMembers.has(m.id));

  const handleToggleSelectAllMembers = () => {
    if (allFilteredSelected) {
      setSelectedMembers(new Set());
    } else {
      setSelectedMembers(new Set(paginatedMembers.map((m) => m.id)));
    }
  };

  const handleToggleSelectMember = (id) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const currentCategoryData =
    categories.find((c) => c.id === selectedCategory) || categories[0] || null;

  // Xuất Excel thành viên — lấy ĐỦ từ máy chủ (bảng kết quả chỉ tải 100 người đầu của danh mục).
  const exportMembers = async (params, baseName) => {
    try {
      const res = await getScannedMembers({ ...params, page: 1, page_size: 100000 }, { fresh: true });
      const list = res?.members || [];
      if (!list.length) {
        toast.warning("Chưa có thành viên nào để xuất!");
        return;
      }
      const fileName = await downloadTable({ format: "xlsx", baseName, sheetName: "Thanh vien", ...memberExportTable(list) });
      toast.success(`Đã xuất ${list.length} thành viên ra file: ${fileName}`);
    } catch (err) {
      toast.error("Xuất file thất bại: " + (err?.message || "Lỗi"));
    }
  };

  const handleExportAll = () => {
    if (isExecuting) {
      toast.warning("Đang quét thành viên, vui lòng đợi hoàn tất hoặc dừng tiến trình trước khi xuất file!");
      return;
    }
    exportMembers({}, "Thanh_vien_tat_ca");
  };

  const handleExportGroup = () => {
    if (isExecuting) {
      toast.warning("Đang quét thành viên, vui lòng đợi hoàn tất hoặc dừng tiến trình trước khi xuất file!");
      return;
    }
    const catName = currentCategoryData?.name || "Danh_muc";
    exportMembers({ category_id: selectedCategory, search: memberSearch }, `Thanh_vien_${safeFileName(catName)}`);
  };

  return (
    <>
      <style>{`
        input[type="number"]::-webkit-inner-spin-button,
        input[type="number"]::-webkit-outer-spin-button {
          -webkit-appearance: none !important;
          margin: 0 !important;
        }
        input[type="number"] {
          -moz-appearance: textfield !important;
          appearance: textfield !important;
        }
      `}</style>
      <div className="-m-6 min-h-full space-y-5 bg-[#F4F7FC] p-6">
        <ModulePageHeader navId="scan.members" />
        {/* SECTION 1 & SECTION 2: 2 Column Configuration Grids */}
        <div className="grid items-stretch gap-5 xl:grid-cols-2">
          {/* Card 1: Chọn tài khoản & Nhóm quét */}
          <AccountGroupPickerCard
            onOpenAccountsModal={() => setAccountsModalOpen(true)}
            selectedUidsCount={selectedUids.length}
            totalAccountsCount={moduleAccounts.length}
            selectedAccountNames={selectedAccountNames}
            onOpenGroupPicker={() => setGroupPickerOpen(true)}
            selectedGroupsCount={selectedGroups.length}
          />

          {/* Card 2: Cấu hình quét nâng cao & Bộ lọc */}
          <AdvancedScanFilterCard
            minDelay={minDelay}
            setMinDelay={setMinDelay}
            maxDelay={maxDelay}
            setMaxDelay={setMaxDelay}
            switchAccThreshold={switchAccThreshold}
            setSwitchAccThreshold={setSwitchAccThreshold}
            membersLimit={membersLimit}
            setMembersLimit={setMembersLimit}
            skipAdmin={skipAdmin}
            setSkipAdmin={setSkipAdmin}
            autoDedupe={autoDedupe}
            setAutoDedupe={setAutoDedupe}
            newMembersOnly={newMembersOnly}
            setNewMembersOnly={setNewMembersOnly}
          />
        </div>

        {/* SECTION 3: Xem trước danh sách nhóm muốn quét */}
        <GroupPreviewSection
          selectedGroups={selectedGroups}
          onRemoveGroup={handleRemoveGroup}
        />

        {/* BIG PRIMARY ACTION BUTTON: BẮT ĐẦU / TẠM DỪNG / DỪNG */}
        {isExecuting ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={handlePauseResume}
              disabled={isStopping || controlBusy || !activeJobId}
              className="inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-xl bg-[#F59E0B] text-sm font-bold tracking-wide text-white shadow-sm transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPaused ? <Play className="size-4 fill-white" /> : <Pause className="size-4 fill-white" />}
              <span>{isPaused ? "TIẾP TỤC QUÉT" : "TẠM DỪNG"}</span>
            </button>
            <button
              type="button"
              onClick={handleStop}
              disabled={isStopping || controlBusy}
              className="inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-xl bg-[#DC2626] text-sm font-bold tracking-wide text-white shadow-sm transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Square className="size-4 fill-white" />
              <span>{isStopping ? "ĐANG DỪNG..." : "DỪNG THỰC THI QUÉT"}</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleToggleExecution}
            className="inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-xl bg-[#2563EB] text-sm font-bold tracking-wide text-white shadow-sm transition-colors hover:bg-blue-600"
          >
            <Play className="size-4 fill-white" />
            <span>BẮT ĐẦU THỰC THI</span>
          </button>
        )}

        {/* SECTION 4: Kết quả quét thành viên (Master-Detail 2 cột) */}
        <LiveMemberResultSection
          categories={filteredCategories}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          categorySearch={categorySearch}
          onCategorySearchChange={setCategorySearch}
          currentCategoryData={currentCategoryData}
          memberSearch={memberSearch}
          onMemberSearchChange={setMemberSearch}
          onExportAll={handleExportAll}
          onExportGroup={handleExportGroup}
          members={paginatedMembers}
          allFilteredSelected={allFilteredSelected}
          onToggleSelectAllMembers={handleToggleSelectAllMembers}
          selectedMembers={selectedMembers}
          onToggleSelectMember={handleToggleSelectMember}
          currentPage={currentPage}
          pageSize={pageSize}
          totalFilteredCount={filteredMembers.length}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />

        {/* SECTION 5: Live Automation Log Console [Thread-01] */}
        <LiveLogConsole
          logs={logs}
          isExecuting={isExecuting}
          onCopyLogs={handleCopyLogs}
          copiedLog={copiedLog}
          title="Live Automation Log Console [Thread-01]"
        />

        {/* Account Selection Modal */}
        <AccountSelectModal
          open={accountsModalOpen}
          onOpenChange={setAccountsModalOpen}
          accounts={moduleAccounts}
          loading={accountsLoading}
          selectedUids={selectedUids}
          onRefresh={loadAccounts}
          onConfirm={(uids) => {
            setSelectedUids(uids);
            toast.success(`Đã chọn ${uids.length} tài khoản thực thi!`);
          }}
        />

        {/* Group Picker Modal */}
        <GroupPickerModal
          open={groupPickerOpen}
          onClose={() => setGroupPickerOpen(false)}
          selectedGroups={selectedGroups}
          onConfirm={(newGroups) => {
            setSelectedGroups(newGroups);
            setGroupPickerOpen(false);
            toast.success(`Đã chọn ${newGroups.length} nhóm!`);
          }}
        />
      </div>
    </>
  );
}
