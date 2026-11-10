"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Play,
  Square,
} from "lucide-react";
import { toast } from "@/lib/toast";
import AccountSelectModal, { isScanReady } from "../components/AccountSelectModal";
import GroupPickerModal from "../components/GroupPickerModal";
import {
  controlMemberScan,
  getMemberScanStatus,
  getScanAccounts,
  getScanCategories,
  getScannedGroups,
  getScannedMembers,
  startMemberScan,
} from "../service";
import AccountGroupPickerCard from "./_components/AccountGroupPickerCard";
import AdvancedScanFilterCard from "./_components/AdvancedScanFilterCard";
import GroupPreviewSection from "./_components/GroupPreviewSection";
import LiveMemberResultSection from "./_components/LiveMemberResultSection";
import LiveLogConsole from "./_components/LiveLogConsole";

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
  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const res = await getScanAccounts();
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
        if (readyUids.length > 0) return readyUids.slice(0, 5);
        return list.slice(0, 5).map((a) => a.uid);
      });
    } catch {
      setModuleAccounts([]);
      setSelectedUids([]);
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
  const [, setAvailableGroups] = useState([]);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);

  // Load available groups & categories from Database
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [members, setMembers] = useState([]);

  const loadCategoriesAndGroups = useCallback(async () => {
    try {
      const res = await getScannedGroups();
      const list = res?.groups || [];
      setAvailableGroups(
        list.map((g, idx) => {
          const rawGid = String(g.group_id || g.uid || "");
          const dbId = g.id;
          let realGid = "";
          let rawUrl = String(g.url || g.href || "");
          if (rawUrl.includes("/groups/")) {
            const parts = rawUrl.split("/groups/")[1].split("/")[0].split("?")[0].trim();
            if (parts && !/^\d{1,7}$/.test(parts)) {
              realGid = parts;
            }
          }
          if (!realGid) {
            if (rawGid && !/^\d{1,7}$/.test(rawGid)) {
              realGid = rawGid;
            }
          }
          let realUrl = "";
          if (rawUrl && !/\/groups\/\d{1,7}(?:[/?#]|$)/.test(rawUrl)) {
            realUrl = rawUrl;
          } else if (realGid && !/^\d{1,7}$/.test(realGid)) {
            realUrl = `https://www.facebook.com/groups/${realGid}`;
          }

          return {
            id: realGid || String(dbId || idx),
            groupId: realGid,
            group_id: realGid,
            dbId: dbId,
            stt: String(idx + 1).padStart(2, "0"),
            name: g.name || g.group_name || realGid || `Nhóm #${dbId}`,
            uid: realGid,
            tag: (g.name || "FB").slice(0, 2).toUpperCase(),
            tagBg: "bg-[#DBEAFE]",
            tagText: "text-[#2563EB]",
            type: g.type === "private" ? "private" : "public",
            typeLabel: g.type === "private" ? "Riêng tư" : "Công khai",
            members: g.members || "—",
            memberCount: g.membersCount || 0,
            url: realUrl,
          };
        })
      );
    } catch {
      setAvailableGroups([]);
    }

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
  const [switchAccThreshold, setSwitchAccThreshold] = useState(50);
  const [membersLimit, setMembersLimit] = useState(50);

  const [skipAdmin, setSkipAdmin] = useState(true);
  const [autoDedupe, setAutoDedupe] = useState(true);
  const [newMembersOnly, setNewMembersOnly] = useState(true);

  // --- Section 4: Master-Detail Category & Members ---
  const [categorySearch, setCategorySearch] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [friendFilter, setFriendFilter] = useState("all");
  const [selectedMembers, setSelectedMembers] = useState(new Set());
  const [currentPage, setCurrentPage] = useState(1);

  // --- Section 5: Logs & Execution ---
  const [logs, setLogs] = useState([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [activeJobId, setActiveJobId] = useState(null);
  const [copiedLog, setCopiedLog] = useState(false);

  // Polling Live Status
  useEffect(() => {
    if (!isExecuting || !activeJobId) return;

    const interval = setInterval(async () => {
      try {
        const res = await getMemberScanStatus({ jobId: activeJobId });
        const job = res?.job;
        if (!job) return;

        if (Array.isArray(job.logs) && job.logs.length > 0) {
          setLogs(job.logs);
        }

        if (Array.isArray(job.members) && job.members.length > 0) {
          setMembers(job.members);
        }

        if (job.status === "done" || job.status === "aborted" || job.status === "error") {
          setIsExecuting(false);
          setActiveJobId(null);
          if (job.status === "done") {
            toast.success(`Đã hoàn thành phiên quét! Thu thập được ${job.total_members_scanned || 0} thành viên.`);
            if (selectedCategory) loadDatabaseMembers(selectedCategory);
          } else if (job.status === "aborted") {
            toast.info("Phiên quét đã dừng lại.");
          } else if (job.status === "error") {
            toast.error(job.error || "Phiên quét gặp sự cố!");
          }
        }
      } catch {
        // Polling error ignored
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
  const handleToggleExecution = async () => {
    if (isExecuting) {
      if (activeJobId) {
        try {
          await controlMemberScan({ jobId: activeJobId, action: "abort" });
        } catch {
          // ignore
        }
      }
      setIsExecuting(false);
      toast.info("Đã dừng tiến trình quét thành viên nhóm.");
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
      const fCount = Number(m.friendCount || m.friend_count || 0);
      const matchFriend =
        friendFilter === "all" ||
        (friendFilter === "under500" && fCount <= 500) ||
        (friendFilter === "over500" && fCount > 500);
      return matchQuery && matchFriend;
    });
  }, [members, memberSearch, friendFilter]);

  const pageSize = 15;
  const totalPages = Math.max(1, Math.ceil(filteredMembers.length / pageSize));
  const paginatedMembers = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredMembers.slice(start, start + pageSize).map((m, idx) => ({
      ...m,
      id: m.id || m.uid || `mem-${idx}`,
      stt: String(start + idx + 1).padStart(2, "0"),
      shortUid: m.uid ? (m.uid.length > 15 ? `${m.uid.slice(0, 6)}...${m.uid.slice(-4)}` : m.uid) : "—",
      friends: (m.friendCount || m.friend_count) ? `${(m.friendCount || m.friend_count).toLocaleString("vi-VN")} bạn` : "—",
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

  // Export CSV Helper (UC-GMS-06)
  const exportMembersCsv = (memberList, title = "MemberScraping") => {
    if (!memberList || memberList.length === 0) {
      toast.warning("Chưa có thành viên nào để xuất!");
      return;
    }
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const filename = `${title}_${ts}.csv`;

    const headers = ["STT", "Họ tên", "UID Facebook", "Nhóm", "Link cá nhân", "Số bạn bè", "Vai trò", "Thời gian quét"];
    const rows = memberList.map((m, idx) => [
      idx + 1,
      `"${(m.name || "").replace(/"/g, '""')}"`,
      `\t${m.uid}`, // Prefix tab to guarantee text interpretation in Excel
      `"${(m.group_name || m.group_id || "").replace(/"/g, '""')}"`,
      `"${(m.profile_url || `https://www.facebook.com/${m.uid}`).replace(/"/g, '""')}"`,
      m.friendCount ?? m.friend_count ?? 0,
      m.role === "admin" ? "Quản trị viên" : m.role === "moderator" ? "Kiểm duyệt viên" : "Thành viên",
      `"${m.scanned_at || ""}"`,
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Đã xuất ${memberList.length} thành viên ra tệp: ${filename}`);
  };

  const handleExportAll = () => {
    if (isExecuting) {
      toast.warning("Đang quét thành viên, vui lòng đợi hoàn tất hoặc dừng tiến trình trước khi xuất file!");
      return;
    }
    exportMembersCsv(members, "MemberScraping_All");
  };

  const handleExportGroup = () => {
    if (isExecuting) {
      toast.warning("Đang quét thành viên, vui lòng đợi hoàn tất hoặc dừng tiến trình trước khi xuất file!");
      return;
    }
    const catName = currentCategoryData?.name || "Group";
    exportMembersCsv(filteredMembers, `MemberScraping_${catName.replace(/[^a-zA-Z0-9]/g, "_")}`);
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

        {/* BIG PRIMARY ACTION BUTTON: BẮT ĐẦU THỰC THI */}
        <button
          type="button"
          onClick={handleToggleExecution}
          className={`inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-xl text-sm font-bold tracking-wide text-white transition-colors shadow-sm ${
            isExecuting ? "bg-[#DC2626] hover:bg-rose-700" : "bg-[#2563EB] hover:bg-blue-600"
          }`}
        >
          {isExecuting ? (
            <>
              <Square className="size-4 fill-white" />
              <span>DỪNG THỰC THI QUÉT</span>
            </>
          ) : (
            <>
              <Play className="size-4 fill-white" />
              <span>BẮT ĐẦU THỰC THI</span>
            </>
          )}
        </button>

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
          friendFilter={friendFilter}
          onFriendFilterChange={(val) => {
            setFriendFilter(val);
            setCurrentPage(1);
          }}
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
          targetType="members"
        />
      </div>
    </>
  );
}
