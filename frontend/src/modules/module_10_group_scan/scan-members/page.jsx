"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Users,
  Globe,
  Trash2,
  Play,
  Download,
  Search,
  ExternalLink,
  ChevronDown,
  Copy,
  Check,
  Square,
  Eye,
  X,
} from "lucide-react";
import { toast } from "@/lib/toast";
import AccountSelectModal, { isScanReady } from "../components/AccountSelectModal";
import { getScanAccounts } from "../service";

const DEFAULT_SCAN_ACCOUNTS = [
  {
    id: "acc-1",
    uid: "81594788917102",
    profile_name: "Riska Nasution (Nick Trâu)",
    email: "riska.nasution@gmail.com",
    status: "live",
    login_status: "logged_in",
  },
  {
    id: "acc-2",
    uid: "100084729182312",
    profile_name: "Hoàng Minh Thuận (Scan Post 01)",
    email: "thuandz99@gmail.com",
    status: "live",
    login_status: "logged_in",
  },
  {
    id: "acc-3",
    uid: "100091823761294",
    profile_name: "Trần Mai Anh (Seeding 02)",
    email: "maianh.tran@gmail.com",
    status: "live",
    login_status: "logged_in",
  },
  {
    id: "acc-4",
    uid: "100062819451290",
    profile_name: "Nguyễn Hải Đăng (Acc Backup 03)",
    email: "haidang.dev@gmail.com",
    status: "live",
    login_status: "logged_in",
  },
  {
    id: "acc-5",
    uid: "100037194012893",
    profile_name: "Lê Ngọc Bích (Farm 04)",
    email: "ngocbich.le@gmail.com",
    status: "live",
    login_status: "logged_in",
  },
];

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

// ==========================================
// DỮ LIỆU MẪU BAN ĐẦU CHUẨN FIGMA IMAGE 1
// ==========================================

const INITIAL_SELECTED_GROUPS = [
  {
    id: "g-1",
    stt: "01",
    name: "Hội Buôn Bán Online Toàn Quốc",
    uid: "81594788917102",
    tag: "HB",
    tagBg: "bg-[#DBEAFE]",
    tagText: "text-[#2563EB]",
    type: "public",
    typeLabel: "Công khai",
    members: "258.724 TV",
    memberCount: 258724,
  },
  {
    id: "g-2",
    stt: "02",
    name: "Marketing Sài Gòn Hub - Tuyển dụng & Thảo luận",
    uid: "49204918231032",
    tag: "MK",
    tagBg: "bg-[#F3E8FF]",
    tagText: "text-[#9333EA]",
    type: "private",
    typeLabel: "Riêng tư",
    members: "186.392 TV",
    memberCount: 186392,
  },
  {
    id: "g-3",
    stt: "03",
    name: "Bất Động Sản & Đầu Tư Hà Nội 2024",
    uid: "92837192837123",
    tag: "BĐ",
    tagBg: "bg-[#FFEDD5]",
    tagText: "text-[#EA580C]",
    type: "public",
    typeLabel: "Công khai",
    members: "142.050 TV",
    memberCount: 142050,
  },
  {
    id: "g-4",
    stt: "04",
    name: "Cộng Đồng Thương Mại Điện Tử & Dropship VN",
    uid: "37492817293847",
    tag: "TM",
    tagBg: "bg-[#D1FAE5]",
    tagText: "text-[#059669]",
    type: "public",
    typeLabel: "Công khai",
    members: "95.400 TV",
    memberCount: 95400,
  },
  {
    id: "g-5",
    stt: "05",
    name: "Khởi Nghiệp & Kinh Doanh Thực Chiến",
    uid: "61928371928312",
    tag: "KV",
    tagBg: "bg-[#FCE7F3]",
    tagText: "text-[#DB2777]",
    type: "private",
    typeLabel: "Riêng tư",
    members: "312.800 TV",
    memberCount: 312800,
  },
];

const CATEGORIES_DATA = [
  {
    id: "cat-1",
    name: "Hội Buôn Bán Online Toàn Quốc",
    stats: "15 nhóm FB • 1.8M TV",
    membersTotal: 1820,
    memberSizeStr: "258.724",
  },
  {
    id: "cat-2",
    name: "Marketing Sài Gòn Hub",
    stats: "15 nhóm FB • 1.8M TV",
    membersTotal: 960,
    memberSizeStr: "186.392",
  },
  {
    id: "cat-3",
    name: "Bất Động Sản & Đầu Tư",
    stats: "15 nhóm FB • 1.8M TV",
    membersTotal: 740,
    memberSizeStr: "142.050",
  },
  {
    id: "cat-4",
    name: "Cộng Đồng E-commerce VN",
    stats: "15 nhóm FB • 1.8M TV",
    membersTotal: 520,
    memberSizeStr: "95.400",
  },
];

const INITIAL_MEMBERS = [
  {
    id: "m-1",
    stt: "01",
    name: "Nguyễn Văn An",
    uid: "100084729182312",
    shortUid: "fb.com/1000847291...",
    friends: "50 bạn bè",
    friendCount: 50,
    time: "10:35:48",
  },
  {
    id: "m-2",
    stt: "02",
    name: "Trần Thị Mai",
    uid: "100091823761294",
    shortUid: "fb.com/1000918237...",
    friends: "50 bạn bè",
    friendCount: 50,
    time: "10:35:46",
  },
  {
    id: "m-3",
    stt: "03",
    name: "Lê Hoàng Quân",
    uid: "100062819451290",
    shortUid: "fb.com/1000628194...",
    friends: "50 bạn bè",
    friendCount: 50,
    time: "10:35:44",
  },
  {
    id: "m-4",
    stt: "04",
    name: "Phạm Thu Trang",
    uid: "100037194012893",
    shortUid: "fb.com/1000371940...",
    friends: "50 bạn bè",
    friendCount: 50,
    time: "10:35:40",
  },
  {
    id: "m-5",
    stt: "05",
    name: "Vũ Đức Duy",
    uid: "100010948219482",
    shortUid: "fb.com/1000109482...",
    friends: "50 bạn bè",
    friendCount: 50,
    time: "10:35:36",
  },
  {
    id: "m-6",
    stt: "06",
    name: "Bùi Yến Nhi",
    uid: "100058291048192",
    shortUid: "fb.com/1000582910...",
    friends: "50 bạn bè",
    friendCount: 50,
    time: "10:35:32",
  },
];

const INITIAL_LOGS = [
  {
    time: "14:26:41",
    thread: "Thread-01",
    color: "text-slate-200",
    message: "Khởi chạy Chrome Profile cho UID 81594788917102 (Riska Nasution)...",
  },
  {
    time: "14:26:44",
    thread: "Thread-01",
    color: "text-amber-400",
    message: "Proxy: nick không có proxy, đang chạy bằng IP của máy",
  },
  {
    time: "14:26:51",
    thread: "Thread-01",
    color: "text-slate-300",
    message: "Kế hoạch: Check thông báo → Tham gia nhóm → Lướt Newsfeed → Kết bạn theo gợi ý → Xem Video Watch",
  },
  {
    time: "14:26:51",
    thread: "Thread-01",
    color: "text-emerald-400",
    message: "Bắt đầu: Check thông báo",
  },
  {
    time: "14:26:59",
    thread: "Thread-01",
    color: "text-slate-300",
    message: "Check thông báo: Đã xem danh sách thông báo",
  },
  {
    time: "14:26:59",
    thread: "Thread-01",
    color: "text-emerald-400",
    message: "Bắt đầu: Tham gia nhóm",
  },
  {
    time: "14:27:14",
    thread: "Thread-01",
    color: "text-teal-300",
    message: "Tham gia nhóm: Đã tham gia 1/1 nhóm (nhóm đề xuất)",
  },
  {
    time: "14:27:14",
    thread: "Thread-01",
    color: "text-emerald-400",
    message: "Bắt đầu: Lướt Newsfeed",
  },
];

export default function GroupScanMembersPage() {
  // --- Account Selection State ---
  const [accountsModalOpen, setAccountsModalOpen] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [moduleAccounts, setModuleAccounts] = useState(DEFAULT_SCAN_ACCOUNTS);
  const [selectedUids, setSelectedUids] = useState(
    DEFAULT_SCAN_ACCOUNTS.map((a) => a.uid)
  );

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
      const list = rawList.length > 0 ? rawList.map(normalizeAccount) : DEFAULT_SCAN_ACCOUNTS;
      setModuleAccounts(list);
      setSelectedUids((current) => {
        const readyUids = list.filter(isScanReady).map((acc) => acc.uid);
        const kept = current.filter((uid) => readyUids.includes(uid));
        if (kept.length > 0) return kept;
        if (readyUids.length > 0) return readyUids.slice(0, 5);
        return list.slice(0, 5).map((a) => a.uid);
      });
    } catch {
      setModuleAccounts(DEFAULT_SCAN_ACCOUNTS);
      setSelectedUids(DEFAULT_SCAN_ACCOUNTS.map((a) => a.uid));
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    getScanAccounts()
      .then((res) => {
        if (ignore) return;
        const rawList = Array.isArray(res)
          ? res
          : Array.isArray(res?.accounts)
          ? res.accounts
          : Array.isArray(res?.data)
          ? res.data
          : [];
        const list = rawList.length > 0 ? rawList.map(normalizeAccount) : DEFAULT_SCAN_ACCOUNTS;
        setModuleAccounts(list);
        setSelectedUids((current) => {
          const readyUids = list.filter(isScanReady).map((acc) => acc.uid);
          const kept = current.filter((uid) => readyUids.includes(uid));
          if (kept.length > 0) return kept;
          if (readyUids.length > 0) return readyUids.slice(0, 5);
          return list.slice(0, 5).map((a) => a.uid);
        });
      })
      .catch(() => {
        if (ignore) return;
        setModuleAccounts(DEFAULT_SCAN_ACCOUNTS);
        setSelectedUids(DEFAULT_SCAN_ACCOUNTS.map((a) => a.uid));
      });
    return () => {
      ignore = true;
    };
  }, []);

  const selectedAccountNames = useMemo(() => {
    return moduleAccounts
      .filter((a) => selectedUids.includes(a.uid))
      .map((a) => a.profile_name || a.uid)
      .join(", ");
  }, [moduleAccounts, selectedUids]);

  // --- Group Selection State ---
  const [selectedGroups, setSelectedGroups] = useState(INITIAL_SELECTED_GROUPS);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);

  // --- Section 2: Config Steppers & Checkboxes ---
  const [minDelay, setMinDelay] = useState(5);
  const [maxDelay, setMaxDelay] = useState(5);
  const [switchAccThreshold, setSwitchAccThreshold] = useState(50);
  const [membersLimit, setMembersLimit] = useState(50);

  const [skipAdmin, setSkipAdmin] = useState(true);
  const [autoDedupe, setAutoDedupe] = useState(true);
  const [newMembersOnly, setNewMembersOnly] = useState(true);

  // --- Section 4: Master-Detail Category & Members ---
  const [selectedCategory, setSelectedCategory] = useState("cat-1");
  const [categorySearch, setCategorySearch] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [friendFilter, setFriendFilter] = useState("all");
  const [friendDropdownOpen, setFriendDropdownOpen] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState(new Set());
  const [currentPage, setCurrentPage] = useState(1);

  // --- Section 5: Logs & Execution ---
  const [logs, setLogs] = useState(INITIAL_LOGS);
  const [isExecuting, setIsExecuting] = useState(false);
  const [copiedLog, setCopiedLog] = useState(false);

  // Handle Remove Group from Preview Table
  const handleRemoveGroup = (groupId) => {
    setSelectedGroups((prev) => prev.filter((g) => g.id !== groupId));
    toast.success("Đã xóa nhóm khỏi danh sách quét!");
  };

  // Handle Execute Toggle
  const handleToggleExecution = () => {
    if (isExecuting) {
      setIsExecuting(false);
      toast.info("Đã dừng tiến trình quét thành viên nhóm.");
      setLogs((prev) => [
        ...prev,
        {
          time: new Date().toLocaleTimeString("vi-VN", { hour12: false }),
          thread: "Thread-01",
          color: "text-rose-400",
          message: "Người dùng đã tạm dừng tiến trình quét.",
        },
      ]);
    } else {
      if (selectedUids.length === 0) {
        toast.error("Vui lòng chọn ít nhất một tài khoản thực thi!");
        return;
      }
      if (selectedGroups.length === 0) {
        toast.error("Vui lòng chọn ít nhất một nhóm để quét!");
        return;
      }
      setIsExecuting(true);
      toast.success("Bắt đầu tiến trình quét thành viên nhóm...");
      setLogs((prev) => [
        ...prev,
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
    if (!categorySearch.trim()) return CATEGORIES_DATA;
    return CATEGORIES_DATA.filter((c) =>
      c.name.toLowerCase().includes(categorySearch.toLowerCase())
    );
  }, [categorySearch]);

  // Filter Members
  const filteredMembers = useMemo(() => {
    return INITIAL_MEMBERS.filter((m) => {
      const matchQuery =
        !memberSearch.trim() ||
        m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
        m.uid.includes(memberSearch.trim());
      const matchFriend =
        friendFilter === "all" ||
        (friendFilter === "under500" && m.friendCount <= 500) ||
        (friendFilter === "over500" && m.friendCount > 500);
      return matchQuery && matchFriend;
    });
  }, [memberSearch, friendFilter]);

  // Select all members toggle
  const allFilteredSelected =
    filteredMembers.length > 0 &&
    filteredMembers.every((m) => selectedMembers.has(m.id));

  const handleToggleSelectAllMembers = () => {
    if (allFilteredSelected) {
      setSelectedMembers(new Set());
    } else {
      setSelectedMembers(new Set(filteredMembers.map((m) => m.id)));
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

  // Export handlers
  const handleExportAll = () => {
    toast.success("Đang trích xuất toàn bộ danh sách thành viên ra file Excel / CSV...");
  };

  const handleExportGroup = () => {
    const curCat = CATEGORIES_DATA.find((c) => c.id === selectedCategory);
    toast.success(`Đang xuất file thành viên của nhóm: ${curCat?.name || "nhóm đang chọn"}...`);
  };

  const currentCategoryData = CATEGORIES_DATA.find((c) => c.id === selectedCategory) || CATEGORIES_DATA[0];

  return (
    <div className="-m-6 min-h-full space-y-5 bg-[#F4F7FC] p-6">
      <div className="space-y-5">
        {/* =======================================================
            SECTION 1 & SECTION 2: 2 Column Configuration Grids
        ======================================================= */}
        <div className="grid items-start gap-5 xl:grid-cols-2">
          {/* Card 1: Chọn tài khoản & Nhóm quét */}
          <section className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-4">
            {/* Header */}
            <div className="flex items-center gap-2.5 pb-3 border-b border-[#F1F5F9]">
              <span className="flex size-6 items-center justify-center rounded-full bg-[#2563EB] text-[11px] font-bold text-white shrink-0">
                1
              </span>
              <h2 className="text-sm font-bold text-[#0B1C30]">
                Chọn tài khoản & Nhóm quét
              </h2>
            </div>

            {/* Account & Group Selection Rows */}
            <div className="space-y-4">
              {/* Row 1: Tài khoản Facebook thực thi */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#475569]">
                  Tài khoản Facebook thực thi:
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setAccountsModalOpen(true)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#1877F2] px-3.5 text-xs font-semibold text-white hover:bg-blue-600 transition-colors shadow-sm"
                  >
                    <Users className="size-3.5 shrink-0" />
                    <span>Chọn tài khoản</span>
                  </button>

                  <div
                    title={selectedAccountNames}
                    className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-3 text-xs font-medium text-[#059669] cursor-help"
                  >
                    <span className="size-1.5 rounded-full bg-[#10B981] shrink-0" />
                    <span>
                      Đã chọn:{" "}
                      <strong className="text-emerald-950 font-bold">
                        {selectedUids.length} / {moduleAccounts.length}
                      </strong>{" "}
                      tài khoản
                    </span>
                  </div>
                </div>
              </div>

              {/* Row 2: Chỉ định nhóm cần quét */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">
                  CHỈ ĐỊNH NHÓM CẦN QUÉT
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setGroupPickerOpen(true)}
                    className="inline-flex h-8 items-center gap-2 rounded-lg bg-[#1877F2] px-3.5 text-xs font-semibold text-white hover:bg-blue-600 transition-colors shadow-sm"
                  >
                    <Globe className="w-3.5 h-3.5 shrink-0" />
                    <span>Chọn nhóm muốn quét</span>
                  </button>

                  <div className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] px-3 text-xs font-medium text-[#065F46]">
                    <span className="w-2 h-2 rounded-full bg-[#10B981] shrink-0" />
                    <span>
                      Đã chọn: <strong className="text-emerald-950">{selectedGroups.length} nhóm</strong>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Card 2: Cấu hình quét nâng cao & Bộ lọc */}
          <section className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-4">
            {/* Header */}
            <div className="flex items-center gap-2.5 pb-3 border-b border-[#F1F5F9]">
              <span className="flex size-6 items-center justify-center rounded-full bg-[#2563EB] text-[11px] font-bold text-white shrink-0">
                2
              </span>
              <h2 className="text-sm font-bold text-[#0B1C30]">
                Cấu hình quét nâng cao & Bộ lọc
              </h2>
            </div>

            {/* Stepper Delay */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#334155]">
                Khoảng cách giữa các lần quét:
              </span>
              <div className="flex items-center gap-2">
                {/* Min delay stepper */}
                <div className="flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7">
                  <button
                    type="button"
                    onClick={() => setMinDelay((v) => Math.max(1, v - 1))}
                    className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-l-lg font-medium"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    value={minDelay}
                    onChange={(e) => setMinDelay(Number(e.target.value) || 1)}
                    className="w-8 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setMinDelay((v) => v + 1)}
                    className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-r-lg font-medium"
                  >
                    +
                  </button>
                </div>

                <span className="text-xs text-[#94A3B8]">-</span>

                {/* Max delay stepper */}
                <div className="flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7">
                  <button
                    type="button"
                    onClick={() => setMaxDelay((v) => Math.max(minDelay, v - 1))}
                    className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-l-lg font-medium"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    value={maxDelay}
                    onChange={(e) => setMaxDelay(Number(e.target.value) || minDelay)}
                    className="w-8 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setMaxDelay((v) => v + 1)}
                    className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-r-lg font-medium"
                  >
                    +
                  </button>
                </div>

                <span className="text-xs text-[#64748B]">giây</span>
              </div>
            </div>

            {/* Stepper 1: Switch Account Threshold */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#334155]">
                Đổi tài khoản mới khi quét được:
              </span>
              <div className="flex items-center gap-2">
                <div className="flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7">
                  <button
                    type="button"
                    onClick={() => setSwitchAccThreshold((v) => Math.max(5, v - 5))}
                    className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-l-lg font-medium"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    value={switchAccThreshold}
                    onChange={(e) => setSwitchAccThreshold(Number(e.target.value) || 10)}
                    className="w-10 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setSwitchAccThreshold((v) => v + 5)}
                    className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-r-lg font-medium"
                  >
                    +
                  </button>
                </div>
                <span className="text-xs text-[#64748B]">nhóm / tài khoản</span>
              </div>
            </div>

            {/* Stepper 2: Members Limit per Group */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#334155]">
                Mỗi nhóm quét tối đa:
              </span>
              <div className="flex items-center gap-2">
                <div className="flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7">
                  <button
                    type="button"
                    onClick={() => setMembersLimit((v) => Math.max(10, v - 10))}
                    className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-l-lg font-medium"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    value={membersLimit}
                    onChange={(e) => setMembersLimit(Number(e.target.value) || 10)}
                    className="w-10 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setMembersLimit((v) => v + 10)}
                    className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-r-lg font-medium"
                  >
                    +
                  </button>
                </div>
                <span className="text-xs text-[#64748B]">thành viên / nhóm</span>
              </div>
            </div>

            {/* Checkbox Filters */}
            <div className="space-y-2 rounded-lg border border-[#F1F5F9] bg-[#F8FAFC]/80 p-3">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={skipAdmin}
                  onChange={(e) => setSkipAdmin(e.target.checked)}
                  className="size-4 text-[#2563EB] rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                />
                <span className="text-xs font-medium text-[#334155]">
                  Không quét ban quản trị (Admin / Kiểm duyệt viên)
                </span>
              </label>

              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoDedupe}
                  onChange={(e) => setAutoDedupe(e.target.checked)}
                  className="size-4 text-[#2563EB] rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                />
                <span className="text-xs font-medium text-[#334155]">
                  Tự động lọc trùng link giữa các nhóm đang quét
                </span>
              </label>

              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={newMembersOnly}
                  onChange={(e) => setNewMembersOnly(e.target.checked)}
                  className="size-4 text-[#2563EB] rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                />
                <span className="text-xs font-medium text-[#334155]">
                  Chỉ quét thành viên mới tham gia gần đây
                </span>
              </label>
            </div>
          </section>
        </div>

        {/* =======================================================
            SECTION 3: Xem trước danh sách nhóm muốn quét
        ======================================================= */}
        <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          {/* Table Header Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F1F5F9] px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex size-8 items-center justify-center rounded-lg bg-[#EFF6FF] text-[#2563EB] shrink-0">
                <Eye className="size-4" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-[#0B1C30]">
                    Xem trước danh sách nhóm muốn quét
                  </h3>
                  <span className="rounded-full bg-[#DBEAFE] px-2.5 py-0.5 text-[11px] font-semibold text-[#1D4ED8]">
                    {selectedGroups.length} nhóm đã chọn
                  </span>
                </div>
                <p className="text-xs text-[#94A3B8]">
                  Kiểm tra thông tin quyền riêng tư và quy mô thành viên trước khi tiến hành quét
                </p>
              </div>
            </div>
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-xs">
              <thead className="bg-[#F8FAFC] text-[10px] font-bold uppercase tracking-wide text-[#64748B] border-b border-[#E2E8F0]">
                <tr>
                  <th className="w-14 px-4 py-3 text-center">STT</th>
                  <th className="px-4 py-3">TÊN NHÓM FACEBOOK</th>
                  <th className="w-36 px-4 py-3">LOẠI NHÓM</th>
                  <th className="w-48 px-4 py-3">QUY MÔ / THÀNH VIÊN</th>
                  <th className="w-20 px-4 py-3 text-center">THAO TÁC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {selectedGroups.map((group, idx) => (
                  <tr key={group.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-center font-bold text-[#94A3B8]">
                      {group.stt || (idx < 9 ? `0${idx + 1}` : `${idx + 1}`)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${group.tagBg} ${group.tagText}`}
                        >
                          {group.tag}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-semibold text-xs text-[#0F172A] line-clamp-1">
                            {group.name}
                          </span>
                          <span className="font-mono text-[11px] text-[#94A3B8]">
                            ID: {group.uid}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {group.type === "public" ? (
                        <span className="inline-flex rounded border border-[#D1FAE5] bg-[#ECFDF5] px-2 py-0.5 text-[10px] font-semibold text-[#047857]">
                          Công khai
                        </span>
                      ) : (
                        <span className="inline-flex rounded bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-semibold text-[#475569]">
                          Riêng tư
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold text-[#0F172A]">
                      {group.members}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveGroup(group.id)}
                        className="rounded p-1 text-[#94A3B8] hover:bg-rose-50 hover:text-rose-600 transition-colors"
                        title="Xóa nhóm"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {selectedGroups.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-xs text-[#94A3B8]">
                      Chưa có nhóm nào được chọn. Vui lòng bấm &quot;Chọn nhóm muốn quét&quot;.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* =======================================================
            BIG PRIMARY ACTION BUTTON: BẮT ĐẦU THỰC THI
        ======================================================= */}
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

        {/* =======================================================
            SECTION 4: Kết quả quét thành viên (Master-Detail 2 cột)
        ======================================================= */}
        <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-4">
          {/* Section Header with Export */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F1F5F9] pb-3">
            <h3 className="text-sm font-bold text-[#0B1C30]">
              Kết quả quét thành viên
            </h3>
            <button
              type="button"
              onClick={handleExportAll}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E2E8F0] px-3 text-xs font-semibold text-[#64748B] hover:bg-slate-50 transition-colors"
            >
              <Download className="size-3.5 text-[#64748B]" />
              <span>Xuất toàn bộ file</span>
            </button>
          </div>

          {/* 2 Column Master-Detail Split */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 w-full">
            {/* Left: Danh mục nhóm (4) */}
            <div className="lg:col-span-4 flex flex-col gap-3 w-full">
              <span className="text-xs font-bold text-[#334155]">
                Danh mục nhóm ({CATEGORIES_DATA.length})
              </span>

              {/* Quick Search inside list */}
              <div className="relative w-full">
                <Search className="size-3.5 absolute left-3 top-2.5 text-[#94A3B8]" />
                <input
                  type="text"
                  placeholder="Tìm nhóm..."
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                  className="w-full h-8 pl-8 pr-3 text-xs text-slate-800 border border-[#E2E8F0] rounded-lg outline-none focus:border-[#2563EB]"
                />
              </div>

              {/* Group Cards List */}
              <div className="flex flex-col gap-2 w-full">
                {filteredCategories.map((cat) => {
                  const isSelected = cat.id === selectedCategory;
                  return (
                    <button
                      type="button"
                      key={cat.id}
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`flex flex-col items-start p-2.5 gap-0.5 w-full rounded-lg text-left transition-all ${
                        isSelected
                          ? "bg-[#EFF6FF]/60 border border-[#3B82F6] shadow-xs"
                          : "bg-white border border-[#E2E8F0] hover:border-slate-300"
                      }`}
                    >
                      <span className="font-semibold text-xs leading-4 text-[#0F172A] line-clamp-1">
                        {cat.name}
                      </span>
                      <span className="text-[11px] leading-4 text-[#64748B]">
                        {cat.stats}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right: Chi tiết thành viên đã quét */}
            <div className="lg:col-span-8 flex flex-col gap-3 w-full">
              {/* Header Toolbar */}
              <div className="flex flex-wrap justify-between items-center w-full gap-2 pb-1">
                <div className="flex flex-col">
                  <h4 className="font-bold text-xs text-[#0F172A]">
                    {currentCategoryData.name}
                  </h4>
                  <span className="text-[11px] text-[#64748B]">
                    Quy mô: <strong className="text-slate-800">{currentCategoryData.memberSizeStr}</strong> Thành viên
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Search UID, Name */}
                  <div className="relative">
                    <Search className="size-3.5 absolute left-2.5 top-2 text-[#94A3B8]" />
                    <input
                      type="text"
                      placeholder="Tìm UID, Tên..."
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      className="w-44 h-7 pl-8 pr-2 text-xs text-slate-800 border border-[#E2E8F0] rounded-lg outline-none focus:border-[#2563EB]"
                    />
                  </div>

                  {/* Filter Friends */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setFriendDropdownOpen(!friendDropdownOpen)}
                      className="inline-flex items-center justify-between px-2.5 h-7 border border-[#E2E8F0] rounded-lg text-xs font-medium text-[#475569] bg-white hover:bg-slate-50 gap-1.5"
                    >
                      <span>
                        {friendFilter === "all"
                          ? "Tất cả số bạn bè"
                          : friendFilter === "under500"
                          ? "Dưới 500 bạn bè"
                          : "Trên 500 bạn bè"}
                      </span>
                      <ChevronDown className="size-3 text-[#64748B]" />
                    </button>

                    {friendDropdownOpen && (
                      <div className="absolute right-0 mt-1 w-36 bg-white border border-[#E2E8F0] rounded-lg shadow-lg z-20 py-1 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            setFriendFilter("all");
                            setFriendDropdownOpen(false);
                          }}
                          className={`w-full text-left px-3 py-1.5 hover:bg-slate-100 ${
                            friendFilter === "all" ? "text-blue-600 font-bold" : "text-slate-700"
                          }`}
                        >
                          Tất cả số bạn bè
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFriendFilter("under500");
                            setFriendDropdownOpen(false);
                          }}
                          className={`w-full text-left px-3 py-1.5 hover:bg-slate-100 ${
                            friendFilter === "under500" ? "text-blue-600 font-bold" : "text-slate-700"
                          }`}
                        >
                          Dưới 500 bạn bè
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFriendFilter("over500");
                            setFriendDropdownOpen(false);
                          }}
                          className={`w-full text-left px-3 py-1.5 hover:bg-slate-100 ${
                            friendFilter === "over500" ? "text-blue-600 font-bold" : "text-slate-700"
                          }`}
                        >
                          Trên 500 bạn bè
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Button Xuất nhóm */}
                  <button
                    type="button"
                    onClick={handleExportGroup}
                    className="inline-flex items-center gap-1 px-2.5 h-7 border border-[#E2E8F0] rounded-lg text-xs font-semibold text-[#475569] hover:bg-slate-50 transition-colors"
                  >
                    <Download className="size-3 text-[#475569]" />
                    <span>Xuất nhóm</span>
                  </button>
                </div>
              </div>

              {/* Scraped Member Result Table */}
              <div className="w-full border border-[#E2E8F0] rounded-lg overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-xs">
                  <thead className="bg-[#F8FAFC] text-[10px] font-bold uppercase tracking-wide text-[#64748B] border-b border-[#E2E8F0]">
                    <tr>
                      <th className="py-2.5 px-3 text-center w-10">
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={handleToggleSelectAllMembers}
                          className="size-3.5 rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </th>
                      <th className="py-2.5 px-3 text-center w-12">STT</th>
                      <th className="py-2.5 px-3">Họ và tên</th>
                      <th className="py-2.5 px-3">Profile Link / UID</th>
                      <th className="py-2.5 px-3 w-28">Số bạn bè</th>
                      <th className="py-2.5 px-3 text-right w-24">Thời gian</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9]">
                    {filteredMembers.map((member) => {
                      const isChecked = selectedMembers.has(member.id);
                      return (
                        <tr
                          key={member.id}
                          className={`hover:bg-slate-50 transition-colors ${
                            isChecked ? "bg-[#EFF6FF]/30" : ""
                          }`}
                        >
                          <td className="py-2 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggleSelectMember(member.id)}
                              className="size-3.5 rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                            />
                          </td>
                          <td className="py-2 px-3 text-center font-medium text-xs text-[#94A3B8]">
                            {member.stt}
                          </td>
                          <td className="py-2 px-3 font-semibold text-xs text-[#0F172A]">
                            {member.name}
                          </td>
                          <td className="py-2 px-3">
                            <a
                              href={`https://facebook.com/${member.uid}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 font-mono text-[11px] text-[#2563EB] hover:underline"
                            >
                              <span>{member.shortUid}</span>
                              <ExternalLink className="size-3 text-[#2563EB]" />
                            </a>
                          </td>
                          <td className="py-2 px-3 font-medium text-xs text-[#334155]">
                            {member.friends}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-[11px] text-[#94A3B8]">
                            {member.time}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Table Pagination */}
              <div className="flex flex-row justify-between items-center w-full pt-1">
                <span className="text-xs text-[#64748B]">
                  Hiển thị 1 - {filteredMembers.length} của {currentCategoryData.membersTotal.toLocaleString("vi-VN")} UID
                </span>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="size-7 flex items-center justify-center border border-[#E2E8F0] rounded text-xs font-semibold text-[#64748B] hover:bg-slate-100"
                  >
                    &lt;
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentPage(1)}
                    className={`size-7 flex items-center justify-center rounded text-xs font-semibold ${
                      currentPage === 1 ? "bg-[#2563EB] text-white" : "border border-[#E2E8F0] text-[#64748B] hover:bg-slate-100"
                    }`}
                  >
                    1
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentPage(2)}
                    className={`size-7 flex items-center justify-center rounded text-xs font-semibold ${
                      currentPage === 2 ? "bg-[#2563EB] text-white" : "border border-[#E2E8F0] text-[#64748B] hover:bg-slate-100"
                    }`}
                  >
                    2
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentPage(3)}
                    className={`size-7 flex items-center justify-center rounded text-xs font-semibold ${
                      currentPage === 3 ? "bg-[#2563EB] text-white" : "border border-[#E2E8F0] text-[#64748B] hover:bg-slate-100"
                    }`}
                  >
                    3
                  </button>
                  <span className="px-1 text-xs font-semibold text-[#94A3B8]">...</span>
                  <button
                    type="button"
                    onClick={() => setCurrentPage(182)}
                    className={`size-7 flex items-center justify-center rounded text-xs font-semibold ${
                      currentPage === 182 ? "bg-[#2563EB] text-white" : "border border-[#E2E8F0] text-[#64748B] hover:bg-slate-100"
                    }`}
                  >
                    182
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => p + 1)}
                    className="size-7 flex items-center justify-center border border-[#E2E8F0] rounded text-xs font-semibold text-[#64748B] hover:bg-slate-100"
                  >
                    &gt;
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* =======================================================
            SECTION 5: Live Automation Log Console [Thread-01]
        ======================================================= */}
        <section className="overflow-hidden rounded-xl border border-slate-800 bg-[#1e293b] shadow-inner">
          {/* Terminal Header */}
          <div className="flex items-center justify-between border-b border-slate-800 bg-[#0f172a] px-4 py-2.5">
            {/* Left: Window 3 dots & Title */}
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-rose-500" />
                <span className="size-2.5 rounded-full bg-amber-500" />
                <span className="size-2.5 rounded-full bg-emerald-500" />
              </div>
              <span className="font-mono text-xs font-semibold text-slate-300">
                Live Automation Log Console [Thread-01]
              </span>
            </div>

            {/* Right: Badge Status & Copy Button */}
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-400">
                <span className={`size-1.5 rounded-full ${isExecuting ? "bg-emerald-400 animate-ping" : "bg-emerald-400"}`} />
                {isExecuting ? "RUNNING" : "IDLE"}
              </span>

              <button
                type="button"
                onClick={handleCopyLogs}
                className="text-slate-400 hover:text-white transition-colors"
                title="Sao chép toàn bộ logs"
              >
                {copiedLog ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
              </button>
            </div>
          </div>

          {/* Terminal Logs Window */}
          <div className="max-h-52 space-y-1.5 overflow-y-auto px-4 py-3 font-mono text-[11px] leading-relaxed">
            {logs.map((log, index) => (
              <p key={index} className="flex flex-wrap items-start gap-2 text-slate-300">
                <span className="shrink-0 text-slate-500">[{log.time}]</span>
                <span className="shrink-0 text-sky-400">[{log.thread}]</span>
                <span className={`break-all ${log.color}`}>{log.message}</span>
              </p>
            ))}
          </div>
        </section>
      </div>

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
      {groupPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b pb-3 border-slate-100">
              <h3 className="font-bold text-base text-slate-800 flex items-center gap-2">
                <Globe className="size-5 text-blue-600" />
                Chọn nhóm muốn quét
              </h3>
              <button
                type="button"
                onClick={() => setGroupPickerOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="size-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Đang có {selectedGroups.length} nhóm được chọn để thực thi quét thành viên.
            </p>

            <div className="max-h-60 overflow-y-auto space-y-2">
              {selectedGroups.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center justify-between p-2.5 border rounded-lg bg-slate-50"
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`size-7 rounded ${g.tagBg} ${g.tagText} flex items-center justify-center text-xs font-bold`}>
                      {g.tag}
                    </span>
                    <div>
                      <p className="text-xs font-bold text-slate-800">{g.name}</p>
                      <p className="text-[11px] text-slate-400">ID: {g.uid} • {g.members}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveGroup(g.id)}
                    className="text-slate-400 hover:text-rose-600 p-1"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setGroupPickerOpen(false)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold"
              >
                Hoàn tất
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
