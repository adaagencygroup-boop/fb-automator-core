"use client";

import { useMemo, useState, useEffect } from "react";
import {
  Folder,
  Plus,
  Search,
  Pencil,
  Trash2,
  FolderInput,
  ExternalLink,
  MoreVertical,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  ArrowUpDown,
} from "lucide-react";
import { toast } from "@/lib/toast";

// ==========================================
// DỮ LIỆU MẪU BAN ĐẦU CHUẨN FIGMA / SCREENSHOT
// ==========================================
const INITIAL_CATEGORIES = [
  {
    id: "cat-1",
    name: "Hội Buôn",
    description: "Các nhóm buôn bán kinh doanh sỉ & lẻ",
    sub: "15 nhóm FB • 1.8M TV",
  },
  {
    id: "cat-2",
    name: "Marketing Sài Gòn Hub",
    description: "Nhóm chuyên môn marketing & truyền thông tại HCM",
    sub: "15 nhóm FB • 1.8M TV",
  },
  {
    id: "cat-3",
    name: "Marketing Sài Gòn Hub",
    description: "Cộng đồng agency & freelancer",
    sub: "15 nhóm FB • 1.8M TV",
  },
  {
    id: "cat-4",
    name: "Marketing Sài Gòn Hub",
    description: "Cộng đồng kinh doanh online",
    sub: "15 nhóm FB • 1.8M TV",
  },
  {
    id: "cat-5",
    name: "Marketing Sài Gòn Hub",
    description: "Nhóm mua bán trao đổi phụ kiện",
    sub: "15 nhóm FB • 1.8M TV",
  },
  {
    id: "cat-6",
    name: "Marketing Sài Gòn Hub",
    description: "Nhóm quảng cáo đa nền tảng",
    sub: "15 nhóm FB • 1.8M TV",
  },
];

const INITIAL_GROUPS = [
  {
    id: "g-1",
    categoryId: "cat-1",
    stt: 1,
    keyword: "bán hàng online",
    name: "Hội Buôn Bán Online Toàn Quốc",
    type: "public",
    membersCount: 258724,
    members: "258.724",
    url: "https://www.facebook.com/groups/hoibuonbanonlinetoanquoc",
    note: "—",
    initialChecked: true,
  },
  {
    id: "g-2",
    categoryId: "cat-1",
    stt: 2,
    keyword: "marketing",
    name: "Marketing Online - Chia Sẻ Kinh Nghiệm",
    type: "public",
    membersCount: 186392,
    members: "186.392",
    url: "https://www.facebook.com/groups/marketingonlinechiasekinhnghiem",
    note: "—",
    initialChecked: true,
  },
  {
    id: "g-3",
    categoryId: "cat-1",
    stt: 3,
    keyword: "kinh doanh",
    name: "Cộng Đồng Kinh Doanh & Khởi Nghiệp",
    type: "private",
    membersCount: 412567,
    members: "412.567",
    url: "https://www.facebook.com/groups/congdongkinhdoanhvakhoinghiep",
    note: "Đã tham gia",
    initialChecked: true,
  },
  {
    id: "g-4",
    categoryId: "cat-1",
    stt: 4,
    keyword: "bán hàng online",
    name: "Hội Sỉ Lẻ Toàn Quốc (VIP)",
    type: "private",
    membersCount: null,
    members: "—",
    url: "https://www.facebook.com/groups/hoisiletoanquocvip",
    note: "Đang chờ QTV duyệt",
    initialChecked: false,
  },
  {
    id: "g-5",
    categoryId: "cat-1",
    stt: 5,
    keyword: "bán hàng online",
    name: "Shop Online Việt Nam",
    type: "public",
    membersCount: 98243,
    members: "98.243",
    url: "https://www.facebook.com/groups/shoponlinevietnam",
    note: "—",
    initialChecked: false,
  },
  {
    id: "g-6",
    categoryId: "cat-1",
    stt: 6,
    keyword: "affiliate",
    name: "Chiến Binh Kiếm Tiền MMO Kín",
    type: "private",
    membersCount: null,
    members: "—",
    url: "https://www.facebook.com/groups/chienbinhkiemtienmmokin",
    note: "Đang chờ QTV duyệt",
    initialChecked: false,
  },
  {
    id: "g-7",
    categoryId: "cat-1",
    stt: 7,
    keyword: "dropship",
    name: "Cộng Đồng Fulfillment Toàn Quốc",
    type: "private",
    membersCount: 145200,
    members: "145.200",
    url: "https://www.facebook.com/groups/congdongfulfillmenttoanquoc",
    note: "Đã tham gia",
    initialChecked: false,
  },
  {
    id: "g-8",
    categoryId: "cat-1",
    stt: 8,
    keyword: "mẹ và bé",
    name: "Hội Các Mẹ Bỉm Sữa Chia Sẻ Kinh Nghiệm",
    type: "public",
    membersCount: 520190,
    members: "520.190",
    url: "https://www.facebook.com/groups/hoicacmebimsuachiasekinhnghiem",
    note: "—",
    initialChecked: false,
  },
  // Các nhóm bổ sung để đủ tổng số 28 nhóm như trên ảnh thiết kế
  {
    id: "g-9",
    categoryId: "cat-1",
    stt: 9,
    keyword: "thời trang",
    name: "Chợ Sỉ Quần Áo Miền Nam",
    type: "public",
    membersCount: 165300,
    members: "165.300",
    url: "https://www.facebook.com/groups/chosiquanaomiennam",
    note: "—",
    initialChecked: false,
  },
  {
    id: "g-10",
    categoryId: "cat-1",
    stt: 10,
    keyword: "kinh doanh",
    name: "Gia Đình Khởi Nghiệp Trẻ",
    type: "public",
    membersCount: 88400,
    members: "88.400",
    url: "https://www.facebook.com/groups/giadinhkhoinghieptre",
    note: "—",
    initialChecked: false,
  },
  {
    id: "g-11",
    categoryId: "cat-1",
    stt: 11,
    keyword: "bất động sản",
    name: "Cộng Đồng Nhà Đất Đầu Tư",
    type: "private",
    membersCount: 220000,
    members: "220.000",
    url: "https://www.facebook.com/groups/congdongnhadatdautu",
    note: "Đã tham gia",
    initialChecked: false,
  },
  {
    id: "g-12",
    categoryId: "cat-1",
    stt: 12,
    keyword: "phụ kiện",
    name: "Hội Buôn Nguồn Hàng Quảng Châu",
    type: "public",
    membersCount: 310500,
    members: "310.500",
    url: "https://www.facebook.com/groups/hoibuonnguonhangquangchau",
    note: "—",
    initialChecked: false,
  },
  {
    id: "g-13",
    categoryId: "cat-1",
    stt: 13,
    keyword: "quảng cáo",
    name: "Thủ Thuật Chạy Ads Chuyên Nghiệp",
    type: "private",
    membersCount: null,
    members: "—",
    url: "https://www.facebook.com/groups/thuthuatchayads",
    note: "Đang chờ QTV duyệt",
    initialChecked: false,
  },
  {
    id: "g-14",
    categoryId: "cat-1",
    stt: 14,
    keyword: "đồ gia dụng",
    name: "Kho Sỉ Tổng Hợp Toàn Quốc",
    type: "public",
    membersCount: 142000,
    members: "142.000",
    url: "https://www.facebook.com/groups/khositonghop",
    note: "—",
    initialChecked: false,
  },
  {
    id: "g-15",
    categoryId: "cat-1",
    stt: 15,
    keyword: "mỹ phẩm",
    name: "Hội Phân Phối Mỹ Phẩm Chính Hãng",
    type: "public",
    membersCount: 95400,
    members: "95.400",
    url: "https://www.facebook.com/groups/phanphoimypham",
    note: "—",
    initialChecked: false,
  },
  {
    id: "g-16",
    categoryId: "cat-1",
    stt: 16,
    keyword: "kinh doanh",
    name: "Cộng Đồng F&B Việt Nam",
    type: "private",
    membersCount: 195000,
    members: "195.000",
    url: "https://www.facebook.com/groups/congdongfbvn",
    note: "Đã tham gia",
    initialChecked: false,
  },
  {
    id: "g-17",
    categoryId: "cat-1",
    stt: 17,
    keyword: "bán hàng online",
    name: "Hội Chủ Shop Livestream",
    type: "public",
    membersCount: 112000,
    members: "112.000",
    url: "https://www.facebook.com/groups/chushoplivestream",
    note: "—",
    initialChecked: false,
  },
  {
    id: "g-18",
    categoryId: "cat-1",
    stt: 18,
    keyword: "marketing",
    name: "Content Marketing Master",
    type: "public",
    membersCount: 84300,
    members: "84.300",
    url: "https://www.facebook.com/groups/contentmaster",
    note: "—",
    initialChecked: false,
  },
  {
    id: "g-19",
    categoryId: "cat-1",
    stt: 19,
    keyword: "affiliate",
    name: "TikTok Shop & KOC Vietnam",
    type: "public",
    membersCount: 230000,
    members: "230.000",
    url: "https://www.facebook.com/groups/tiktokshopkoc",
    note: "—",
    initialChecked: false,
  },
  {
    id: "g-20",
    categoryId: "cat-1",
    stt: 20,
    keyword: "dropship",
    name: "Shopee & Lazada Seller Club",
    type: "public",
    membersCount: 175000,
    members: "175.000",
    url: "https://www.facebook.com/groups/sellerclub",
    note: "—",
    initialChecked: false,
  },
  {
    id: "g-21",
    categoryId: "cat-1",
    stt: 21,
    keyword: "mẹ và bé",
    name: "Review Đồ Dùng Trẻ Em",
    type: "public",
    membersCount: 68000,
    members: "68.000",
    url: "https://www.facebook.com/groups/reviewdodungtreem",
    note: "—",
    initialChecked: false,
  },
  {
    id: "g-22",
    categoryId: "cat-1",
    stt: 22,
    keyword: "bán hàng online",
    name: "Nhóm Hàng Tiêu Dùng Giá Rẻ",
    type: "public",
    membersCount: 92100,
    members: "92.100",
    url: "https://www.facebook.com/groups/hangtieudunggiare",
    note: "—",
    initialChecked: false,
  },
  {
    id: "g-23",
    categoryId: "cat-1",
    stt: 23,
    keyword: "kinh doanh",
    name: "Cộng Đồng Nhượng Quyền Việt",
    type: "private",
    membersCount: 54000,
    members: "54.000",
    url: "https://www.facebook.com/groups/nhuongquyen",
    note: "Đã tham gia",
    initialChecked: false,
  },
  {
    id: "g-24",
    categoryId: "cat-1",
    stt: 24,
    keyword: "marketing",
    name: "SEO & Growth Hacking Group",
    type: "public",
    membersCount: 76000,
    members: "76.000",
    url: "https://www.facebook.com/groups/seogrowth",
    note: "—",
    initialChecked: false,
  },
  {
    id: "g-25",
    categoryId: "cat-1",
    stt: 25,
    keyword: "bán hàng online",
    name: "Nguồn Hàng Độc Lạ Hot Trend",
    type: "public",
    membersCount: 135000,
    members: "135.000",
    url: "https://www.facebook.com/groups/nguonhangdocla",
    note: "—",
    initialChecked: false,
  },
  {
    id: "g-26",
    categoryId: "cat-1",
    stt: 26,
    keyword: "affiliate",
    name: "Cộng Đồng Kiếm Tiền Online Dễ Dàng",
    type: "private",
    membersCount: null,
    members: "—",
    url: "https://www.facebook.com/groups/kiemtienonlinededang",
    note: "Đang chờ QTV duyệt",
    initialChecked: false,
  },
  {
    id: "g-27",
    categoryId: "cat-1",
    stt: 27,
    keyword: "thời trang",
    name: "Xưởng May Gia Công Xuất Khẩu",
    type: "public",
    membersCount: 48900,
    members: "48.900",
    url: "https://www.facebook.com/groups/xuongmaygiacong",
    note: "—",
    initialChecked: false,
  },
  {
    id: "g-28",
    categoryId: "cat-1",
    stt: 28,
    keyword: "kinh doanh",
    name: "Cộng Đồng Doanh Nhân Tương Lai",
    type: "public",
    membersCount: 162000,
    members: "162.000",
    url: "https://www.facebook.com/groups/doanhnhantuonglai",
    note: "—",
    initialChecked: false,
  },
];

export default function GroupScanListPage() {
  // State quản lý danh mục và nhóm
  const [categories, setCategories] = useState(INITIAL_CATEGORIES);
  const [activeCategoryId, setActiveCategoryId] = useState("cat-1");
  const [categorySearch, setCategorySearch] = useState("");
  const [groups, setGroups] = useState(INITIAL_GROUPS);

  // Bộ lọc bên phải
  const [tableSearch, setTableSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [membersFilter, setMembersFilter] = useState("all");
  const [noteFilter, setNoteFilter] = useState("all");

  // Selection
  const [selectedIds, setSelectedIds] = useState(
    () => new Set(INITIAL_GROUPS.filter((g) => g.initialChecked).map((g) => g.id))
  );

  // Phân trang
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);

  // Modals state
  const [showAddCatModal, setShowAddCatModal] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [showEditCatModal, setShowEditCatModal] = useState(false);
  const [editCatName, setEditCatName] = useState("");
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [targetCatId, setTargetCatId] = useState("");
  const [activeMenuCatId, setActiveMenuCatId] = useState(null);

  // Active Category Object
  const activeCategory = useMemo(() => {
    return categories.find((c) => c.id === activeCategoryId) || categories[0];
  }, [categories, activeCategoryId]);

  // Lọc danh mục bên trái theo từ khóa
  const filteredCategories = useMemo(() => {
    if (!categorySearch.trim()) return categories;
    const term = categorySearch.toLowerCase().trim();
    return categories.filter((c) => c.name.toLowerCase().includes(term));
  }, [categories, categorySearch]);

  // Các nhóm thuộc danh mục đang chọn
  const categoryGroups = useMemo(() => {
    return groups.filter((g) => g.categoryId === activeCategoryId);
  }, [groups, activeCategoryId]);

  // Thống kê 4 thẻ Summary Cards
  const stats = useMemo(() => {
    const totalGroups = categoryGroups.length;
    let totalMembersCount = 0;
    let nonModerated = 0; // Không kiểm duyệt (Công khai)
    let moderated = 0; // Có kiểm duyệt (Riêng tư)

    categoryGroups.forEach((g) => {
      if (g.membersCount) {
        totalMembersCount += g.membersCount;
      }
      if (g.type === "public") {
        nonModerated += 1;
      } else {
        moderated += 1;
      }
    });

    // Định dạng số thành viên có dấu chấm phân cách hàng nghìn
    const formatNumber = (num) => {
      return num.toLocaleString("vi-VN");
    };

    return {
      totalGroups,
      totalMembersFormatted: totalMembersCount ? formatNumber(totalMembersCount) : "3.245.000",
      nonModerated,
      moderated,
    };
  }, [categoryGroups]);

  // Lọc nhóm trong bảng theo Toolbar tìm kiếm & dropdowns
  const filteredGroups = useMemo(() => {
    return categoryGroups.filter((g) => {
      // 1. Text search (tên nhóm hoặc UID / keyword / URL)
      if (tableSearch.trim()) {
        const term = tableSearch.toLowerCase().trim();
        const matchName = g.name.toLowerCase().includes(term);
        const matchKey = g.keyword.toLowerCase().includes(term);
        const matchUrl = g.url.toLowerCase().includes(term);
        if (!matchName && !matchKey && !matchUrl) return false;
      }

      // 2. Filter Loại nhóm
      if (typeFilter !== "all") {
        if (typeFilter === "public" && g.type !== "public") return false;
        if (typeFilter === "private" && g.type !== "private") return false;
      }

      // 3. Filter Thành viên
      if (membersFilter !== "all") {
        const count = g.membersCount || 0;
        if (membersFilter === "under50k" && count >= 50000) return false;
        if (membersFilter === "50k_200k" && (count < 50000 || count > 200000)) return false;
        if (membersFilter === "over200k" && count <= 200000) return false;
      }

      // 4. Filter Ghi chú
      if (noteFilter !== "all") {
        if (noteFilter === "joined" && !g.note.includes("Đã tham gia")) return false;
        if (noteFilter === "pending" && !g.note.includes("Đang chờ")) return false;
        if (noteFilter === "none" && g.note !== "—") return false;
      }

      return true;
    });
  }, [categoryGroups, tableSearch, typeFilter, membersFilter, noteFilter]);

  // Pagination calculation
  const totalItems = filteredGroups.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedGroups = useMemo(() => {
    return filteredGroups.slice(startIndex, startIndex + pageSize);
  }, [filteredGroups, startIndex, pageSize]);

  // Select all checkbox handler
  const allCurrentPageSelected = useMemo(() => {
    if (paginatedGroups.length === 0) return false;
    return paginatedGroups.every((g) => selectedIds.has(g.id));
  }, [paginatedGroups, selectedIds]);

  const toggleSelectAll = () => {
    const next = new Set(selectedIds);
    if (allCurrentPageSelected) {
      paginatedGroups.forEach((g) => next.delete(g.id));
    } else {
      paginatedGroups.forEach((g) => next.add(g.id));
    }
    setSelectedIds(next);
  };

  const toggleSelectRow = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  // Thêm danh mục
  const handleAddCategory = () => {
    if (!newCatName.trim()) {
      toast.warn("Vui lòng nhập tên danh mục!");
      return;
    }
    const newId = `cat-${Date.now()}`;
    const newCat = {
      id: newId,
      name: newCatName.trim(),
      description: "Danh mục nhóm tự tạo",
      sub: "0 nhóm FB • 0 TV",
    };
    setCategories([...categories, newCat]);
    setActiveCategoryId(newId);
    setNewCatName("");
    setShowAddCatModal(false);
    toast.success(`Đã tạo danh mục "${newCat.name}" thành công!`);
  };

  // Sửa danh mục
  const handleEditCategory = () => {
    if (!editCatName.trim()) {
      toast.warn("Tên danh mục không được để trống!");
      return;
    }
    setCategories(
      categories.map((c) =>
        c.id === activeCategoryId ? { ...c, name: editCatName.trim() } : c
      )
    );
    setShowEditCatModal(false);
    toast.success("Đã cập nhật danh mục thành công!");
  };

  // Xóa danh mục
  const handleDeleteCategory = (catId) => {
    if (categories.length <= 1) {
      toast.error("Không thể xóa danh mục cuối cùng!");
      return;
    }
    const catToDelete = categories.find((c) => c.id === catId);
    const remaining = categories.filter((c) => c.id !== catId);
    setCategories(remaining);
    if (activeCategoryId === catId) {
      setActiveCategoryId(remaining[0].id);
    }
    // Xóa nhóm thuộc danh mục đó hoặc chuyển sang danh mục đầu
    setGroups(groups.filter((g) => g.categoryId !== catId));
    setShowEditCatModal(false);
    setActiveMenuCatId(null);
    toast.success(`Đã xóa danh mục "${catToDelete?.name || ""}"!`);
  };

  // Chuyển nhóm sang danh mục khác
  const handleMoveGroups = () => {
    if (!targetCatId) {
      toast.warn("Vui lòng chọn danh mục đích!");
      return;
    }
    const count = selectedIds.size;
    setGroups(
      groups.map((g) =>
        selectedIds.has(g.id) ? { ...g, categoryId: targetCatId } : g
      )
    );
    const targetCat = categories.find((c) => c.id === targetCatId);
    setSelectedIds(new Set());
    setShowMoveModal(false);
    toast.success(`Đã chuyển ${count} nhóm sang "${targetCat?.name || "danh mục mới"}"!`);
  };

  // Xóa các nhóm đã chọn
  const handleDeleteSelectedGroups = () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    setGroups(groups.filter((g) => !selectedIds.has(g.id)));
    setSelectedIds(new Set());
    toast.success(`Đã xóa ${count} nhóm thành công!`);
  };

  return (
    <div className="-m-6 min-h-full space-y-5 bg-[#F4F7FC] p-6">
      {/* ======================================================== */}
      {/* MAIN LAYOUT: LEFT FOLDER PANEL & RIGHT DETAIL SECTION */}
      {/* ======================================================== */}
      <div className="flex flex-col lg:flex-row gap-5 items-start w-full">
        {/* ──────────────────────────────────────────────────────── */}
        {/* LEFT COLUMN: DANH SÁCH DANH MỤC (Width 320px) */}
        {/* ──────────────────────────────────────────────────────── */}
        <div className="w-full lg:w-[320px] shrink-0 bg-white border border-[#E2E8F0] shadow-sm rounded-xl p-4 flex flex-col justify-between min-h-[640px]">
          <div className="flex flex-col">
            {/* Header of Category Box */}
            <div className="flex items-center justify-between pb-3 border-b border-[#F1F5F9]">
              <div className="flex items-center gap-2">
                <Folder className="w-4 h-4 text-[#2563EB] fill-[#2563EB]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#334155]">
                  DANH SÁCH DANH MỤC
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowAddCatModal(true)}
                title="Tạo danh mục mới"
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 font-bold text-sm transition-colors"
              >
                +
              </button>
            </div>

            {/* Stats summary */}
            <div className="py-2.5">
              <span className="text-xs font-semibold text-[#1E293B]">
                {categories.length} Thư mục ({groups.length} nhóm FB)
              </span>
            </div>

            {/* Filter input */}
            <div className="relative w-full mb-3">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-[#94A3B8]" />
              <input
                type="text"
                value={categorySearch}
                onChange={(e) => setCategorySearch(e.target.value)}
                placeholder="Lọc danh mục thư mục..."
                className="w-full h-[30px] rounded-lg border border-[#E2E8F0] bg-white pl-8 pr-3 text-xs text-[#1E293B] placeholder:text-[#6B7280] focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            {/* Folder Item List */}
            <div className="flex flex-col gap-2 max-h-[460px] overflow-y-auto pr-0.5">
              {filteredCategories.map((cat, idx) => {
                const isActive = cat.id === activeCategoryId;
                const catGroupCount = groups.filter((g) => g.categoryId === cat.id).length;
                return (
                  <div
                    key={cat.id}
                    onClick={() => {
                      setActiveCategoryId(cat.id);
                      setPage(1);
                    }}
                    className={`h-16 p-3 rounded-lg flex items-center justify-between cursor-pointer transition-all relative ${
                      isActive
                        ? "bg-[#EFF6FF]/60 border border-[#3B82F6]"
                        : "bg-white border border-[#F1F5F9] hover:border-slate-300"
                    }`}
                  >
                    <div className="flex flex-col gap-0.5 min-w-0 pr-2">
                      <span
                        className={`text-sm font-semibold truncate ${
                          isActive ? "text-[#0F172A]" : "text-[#1E293B]"
                        }`}
                      >
                        {cat.name}
                      </span>
                      <span
                        className={`text-xs truncate ${
                          isActive ? "text-[#64748B]" : "text-[#94A3B8]"
                        }`}
                      >
                        {catGroupCount} nhóm FB • 1.8M TV
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isActive && (
                        <span className="w-2 h-2 rounded-full bg-[#2563EB]" />
                      )}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuCatId(activeMenuCatId === cat.id ? null : cat.id);
                          }}
                          className="p-1 rounded hover:bg-slate-100 text-[#94A3B8] hover:text-slate-600 transition-colors"
                        >
                          <MoreVertical className="w-3.5 h-3.5" />
                        </button>
                        {activeMenuCatId === cat.id && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute right-0 top-full mt-1 w-32 bg-white rounded-lg border border-slate-200 shadow-lg py-1 z-50 text-xs"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setEditCatName(cat.name);
                                setShowEditCatModal(true);
                                setActiveMenuCatId(null);
                              }}
                              className="w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 flex items-center gap-1.5"
                            >
                              <Pencil className="w-3 h-3" /> Đổi tên
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCategory(cat.id)}
                              className="w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50 flex items-center gap-1.5"
                            >
                              <Trash2 className="w-3 h-3" /> Xóa
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer Button: + Thêm danh mục */}
          <button
            type="button"
            onClick={() => setShowAddCatModal(true)}
            className="pt-3 border-t border-[#F1F5F9] flex items-center gap-2 text-xs font-semibold text-[#475569] hover:text-[#2563EB] transition-colors w-full text-left"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Thêm danh mục</span>
          </button>
        </div>

        {/* ──────────────────────────────────────────────────────── */}
        {/* RIGHT COLUMN: DETAIL SECTION (4 CARDS + TABLE + TOOLBAR) */}
        {/* ──────────────────────────────────────────────────────── */}
        <div className="flex-1 w-full bg-white border border-[#E2E8F0] shadow-sm rounded-xl p-6 flex flex-col gap-4 min-w-0">
          {/* Detail Title & Action */}
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight text-[#0F172A]">
              {activeCategory.name}
            </h2>
            <button
              type="button"
              onClick={() => {
                setEditCatName(activeCategory.name);
                setShowEditCatModal(true);
              }}
              className="h-[30px] px-3.5 py-1.5 bg-white border border-[#CBD5E1] shadow-sm rounded-lg text-xs font-medium text-[#334155] flex items-center gap-1.5 hover:bg-slate-50 transition-colors"
            >
              <Pencil className="w-3 h-3 text-[#64748B]" />
              <span>Sửa danh mục</span>
            </button>
          </div>

          {/* 4 Summary Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Card 1: Tổng số nhóm */}
            <div className="bg-[#F8FAFC]/70 border border-[#E2E8F0]/80 rounded-xl p-3.5 text-center flex flex-col items-center justify-center gap-1.5 h-[90px]">
              <span className="text-xs font-medium text-[#64748B]">
                Tổng số nhóm
              </span>
              <span className="text-2xl font-bold text-[#0F172A] leading-8">
                {stats.totalGroups}
              </span>
            </div>

            {/* Card 2: Tổng thành viên (Highlighted Blue) */}
            <div className="bg-[#EFF6FF]/60 border border-[#DBEAFE] rounded-xl p-3.5 text-center flex flex-col items-center justify-center gap-1.5 h-[90px]">
              <span className="text-xs font-medium text-[#64748B]">
                Tổng thành viên
              </span>
              <span className="text-2xl font-bold text-[#2563EB] leading-8">
                {stats.totalMembersFormatted}
              </span>
            </div>

            {/* Card 3: Không kiểm duyệt */}
            <div className="bg-[#F8FAFC]/70 border border-[#E2E8F0]/80 rounded-xl p-3.5 text-center flex flex-col items-center justify-center gap-1.5 h-[90px]">
              <span className="text-xs font-medium text-[#64748B]">
                Không kiểm duyệt
              </span>
              <span className="text-2xl font-bold text-[#0F172A] leading-8">
                {stats.nonModerated}
              </span>
            </div>

            {/* Card 4: Có kiểm duyệt */}
            <div className="bg-[#F8FAFC]/70 border border-[#E2E8F0]/80 rounded-xl p-3.5 text-center flex flex-col items-center justify-center gap-1.5 h-[90px]">
              <span className="text-xs font-medium text-[#64748B]">
                Có kiểm duyệt
              </span>
              <span className="text-2xl font-bold text-[#0F172A] leading-8">
                {stats.moderated}
              </span>
            </div>
          </div>

          {/* Search & Filters Toolbar */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            {/* Search Input */}
            <div className="relative flex-1 w-full">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#94A3B8]" />
              <input
                type="text"
                value={tableSearch}
                onChange={(e) => {
                  setTableSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Tìm theo tên nhóm hoặc UID..."
                className="w-full h-[34px] rounded-lg border border-[#E2E8F0] bg-white pl-8 pr-3 text-xs text-[#1E293B] placeholder:text-[#6B7280] focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            {/* Filter: Loại nhóm */}
            <div className="w-full sm:w-auto shrink-0">
              <select
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full sm:w-auto h-[34px] px-3 rounded-lg border border-[#E2E8F0] bg-white text-xs text-[#334155] focus:outline-none focus:border-blue-500 cursor-pointer"
              >
                <option value="all">Loại nhóm</option>
                <option value="public">Công khai</option>
                <option value="private">Riêng tư</option>
              </select>
            </div>

            {/* Filter: Thành viên */}
            <div className="w-full sm:w-auto shrink-0">
              <select
                value={membersFilter}
                onChange={(e) => {
                  setMembersFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full sm:w-auto h-[34px] px-3 rounded-lg border border-[#E2E8F0] bg-white text-xs text-[#334155] focus:outline-none focus:border-blue-500 cursor-pointer"
              >
                <option value="all">Thành viên</option>
                <option value="under50k">Dưới 50.000</option>
                <option value="50k_200k">50.000 - 200.000</option>
                <option value="over200k">Trên 200.000</option>
              </select>
            </div>

            {/* Filter: Ghi chú */}
            <div className="w-full sm:w-auto shrink-0">
              <select
                value={noteFilter}
                onChange={(e) => {
                  setNoteFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full sm:w-auto h-[34px] px-3 rounded-lg border border-[#E2E8F0] bg-white text-xs text-[#334155] focus:outline-none focus:border-blue-500 cursor-pointer"
              >
                <option value="all">Ghi chú: Tất cả</option>
                <option value="joined">Đã tham gia</option>
                <option value="pending">Đang chờ QTV duyệt</option>
                <option value="none">Chưa có ghi chú</option>
              </select>
            </div>
          </div>

          {/* Batch Action Bar */}
          <div className="h-11 px-4 rounded-lg bg-[#EFF6FF]/60 border border-[#DBEAFE] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selectedIds.size > 0}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded border-blue-500 text-blue-600 focus:ring-blue-500 cursor-pointer accent-[#2563EB]"
              />
              <span className="text-xs font-semibold text-[#1E3A8A]">
                Đã chọn {selectedIds.size} / {filteredGroups.length} nhóm
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={selectedIds.size === 0}
                onClick={() => {
                  if (categories.length <= 1) {
                    toast.warn("Chưa có danh mục khác để chuyển!");
                    return;
                  }
                  const otherCat = categories.find((c) => c.id !== activeCategoryId);
                  setTargetCatId(otherCat ? otherCat.id : "");
                  setShowMoveModal(true);
                }}
                className="h-[26px] px-3 rounded border border-[#E2E8F0] bg-white text-xs font-medium text-[#334155] flex items-center gap-1.5 hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FolderInput className="w-3.5 h-3.5 text-[#64748B]" />
                <span>Chuyển mục</span>
              </button>

              <button
                type="button"
                disabled={selectedIds.size === 0}
                onClick={handleDeleteSelectedGroups}
                className="h-6 px-2.5 rounded border border-[#FECACA] bg-[#FEF2F2] text-xs font-medium text-[#93000A] flex items-center gap-1 hover:bg-red-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-3 h-3 text-[#93000A]" />
                <span>Xóa</span>
              </button>
            </div>
          </div>

          {/* Data Table */}
          <div className="border border-[#E2E8F0] rounded-lg overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[700px]">
              <thead>
                <tr className="bg-[#F8FAFC]/80 border-b border-[#E2E8F0] h-[48px]">
                  <th className="w-10 px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={allCurrentPageSelected}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer accent-[#2563EB]"
                    />
                  </th>
                  <th className="w-12 px-2 py-2 text-center text-[11px] font-bold uppercase text-[#475569]">
                    STT
                  </th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase text-[#475569]">
                    TỪ KHÓA
                  </th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase text-[#475569]">
                    TÊN NHÓM
                  </th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase text-[#475569]">
                    LOẠI NHÓM
                  </th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase text-[#475569] text-right">
                    THÀNH VIÊN
                  </th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase text-[#475569]">
                    LIÊN KẾT / URL NHÓM
                  </th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase text-[#475569]">
                    GHI CHÚ
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {paginatedGroups.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-xs text-slate-400">
                      Không tìm thấy nhóm nào phù hợp trong danh mục này.
                    </td>
                  </tr>
                ) : (
                  paginatedGroups.map((g, index) => {
                    const isChecked = selectedIds.has(g.id);
                    return (
                      <tr
                        key={g.id}
                        className={`hover:bg-slate-50/60 transition-colors ${
                          isChecked ? "bg-blue-50/20" : ""
                        }`}
                      >
                        {/* Checkbox */}
                        <td className="w-10 px-3 py-4 text-center">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelectRow(g.id)}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer accent-[#2563EB]"
                          />
                        </td>

                        {/* STT */}
                        <td className="w-12 px-2 py-4 text-center text-xs font-medium text-[#94A3B8]">
                          {startIndex + index + 1}
                        </td>

                        {/* TỪ KHÓA */}
                        <td className="px-3 py-4 text-xs font-medium text-[#1E293B]">
                          {g.keyword}
                        </td>

                        {/* TÊN NHÓM */}
                        <td className="px-3 py-4 text-xs font-medium text-[#0F172A] max-w-[200px] leading-5">
                          {g.name}
                        </td>

                        {/* LOẠI NHÓM */}
                        <td className="px-3 py-4">
                          {g.type === "public" ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#ECFDF5] border border-[#A7F3D0] text-[#047857]">
                              Công khai
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#EEF2FF] border border-[#C7D2FE] text-[#4338CA]">
                              Riêng tư
                            </span>
                          )}
                        </td>

                        {/* THÀNH VIÊN */}
                        <td className="px-3 py-4 text-xs font-medium text-[#0F172A] text-right">
                          {g.members}
                        </td>

                        {/* LIÊN KẾT / URL NHÓM */}
                        <td className="px-3 py-4">
                          <a
                            href={g.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-[#2563EB] hover:underline max-w-[190px] truncate"
                          >
                            <span className="truncate">{g.url}</span>
                            <ExternalLink className="w-3 h-3 shrink-0 text-[#94A3B8]" />
                          </a>
                        </td>

                        {/* GHI CHÚ */}
                        <td className="px-3 py-4 text-xs">
                          {g.note === "Đã tham gia" ? (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-[10px] text-[11px] font-medium bg-[#EFF6FF] border border-[#BFDBFE] text-[#1D4ED8]">
                              Đã tham gia
                            </span>
                          ) : g.note === "Đang chờ QTV duyệt" ? (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-[10px] text-[11px] font-medium bg-[#FFFBEB] border border-[#FDE68A] text-[#B45309]">
                              Đang chờ QTV duyệt
                            </span>
                          ) : (
                            <span className="text-[#94A3B8]">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Table Pagination */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
            {/* Left stats info */}
            <div className="flex items-center gap-2 text-xs text-[#64748B]">
              <span>
                Hiển thị {filteredGroups.length === 0 ? 0 : startIndex + 1} -{" "}
                {Math.min(startIndex + pageSize, filteredGroups.length)} trong tổng số{" "}
                {filteredGroups.length} nhóm
              </span>
              <span>•</span>
              <div className="flex items-center gap-1.5">
                <span>Hàng mỗi trang:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="h-[26px] px-2 rounded border border-[#E2E8F0] bg-white text-xs text-[#334155] focus:outline-none focus:border-blue-500 cursor-pointer"
                >
                  <option value={8}>8</option>
                  <option value={15}>15</option>
                  <option value={30}>30</option>
                </select>
              </div>
            </div>

            {/* Right pagination buttons */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="w-7 h-7 rounded border border-[#E2E8F0] flex items-center justify-center text-slate-400 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
                const isCurrent = p === currentPage;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    className={`w-7 h-7 rounded text-xs font-semibold flex items-center justify-center transition-colors ${
                      isCurrent
                        ? "bg-[#0F172A] text-white"
                        : "border border-[#E2E8F0] text-[#475569] hover:bg-slate-50"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}

              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="w-7 h-7 rounded border border-[#E2E8F0] flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 3. MODALS (THÊM DANH MỤC, SỬA DANH MỤC, CHUYỂN MỤC) */}
      {/* ======================================================== */}

      {/* Modal Thêm danh mục */}
      {showAddCatModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 p-6 flex flex-col gap-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-blue-600" />
                <span>Thêm danh mục mới</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowAddCatModal(false)}
                className="p-1 rounded hover:bg-slate-100 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Tên danh mục thư mục <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                autoFocus
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Ví dụ: Hội Săn Hàng Sale, Bất Động Sản..."
                className="h-9 px-3 rounded-lg border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
                onKeyDown={(e) => e.key === "Enter" && handleAddCategory()}
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddCatModal(false)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleAddCategory}
                className="px-4 py-1.5 rounded-lg bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700 shadow-sm"
              >
                Tạo danh mục
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Sửa danh mục */}
      {showEditCatModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 p-6 flex flex-col gap-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Pencil className="w-4 h-4 text-blue-600" />
                <span>Chỉnh sửa danh mục</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowEditCatModal(false)}
                className="p-1 rounded hover:bg-slate-100 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Tên danh mục thư mục <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                autoFocus
                value={editCatName}
                onChange={(e) => setEditCatName(e.target.value)}
                className="h-9 px-3 rounded-lg border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                onKeyDown={(e) => e.key === "Enter" && handleEditCategory()}
              />
            </div>
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => handleDeleteCategory(activeCategoryId)}
                className="px-3 py-1.5 rounded-lg border border-red-200 text-xs font-medium text-red-600 hover:bg-red-50 flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Xóa danh mục</span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowEditCatModal(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={handleEditCategory}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700 shadow-sm"
                >
                  Lưu thay đổi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Chuyển mục */}
      {showMoveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 p-6 flex flex-col gap-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <FolderInput className="w-4 h-4 text-blue-600" />
                <span>Chuyển {selectedIds.size} nhóm sang danh mục khác</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowMoveModal(false)}
                className="p-1 rounded hover:bg-slate-100 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Chọn danh mục đích:
              </label>
              <select
                value={targetCatId}
                onChange={(e) => setTargetCatId(e.target.value)}
                className="h-9 px-3 rounded-lg border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
              >
                {categories
                  .filter((c) => c.id !== activeCategoryId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowMoveModal(false)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleMoveGroups}
                className="px-4 py-1.5 rounded-lg bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700 shadow-sm"
              >
                Xác nhận chuyển
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
