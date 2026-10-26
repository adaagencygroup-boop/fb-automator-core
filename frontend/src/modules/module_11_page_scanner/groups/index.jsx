"use client";

import React, { useState, useMemo, useEffect } from "react";
import {
  Folder,
  Plus,
  Search,
  FileSpreadsheet,
  Trash2,
  ExternalLink,
  Phone,
  Mail,
  Globe,
  MapPin,
  CheckCircle2,
  FolderInput,
  X,
} from "lucide-react";
import { getScannedPages, loadSavedPageLists } from "../service";

const INITIAL_CATEGORIES = [
  {
    id: "cat_fashion",
    name: "Thời trang cao cấp",
    count: 3420,
    updated_at: "15 phút trước",
  },
  {
    id: "cat_realestate",
    name: "Bất động sản & Resort",
    count: 2150,
    updated_at: "40 phút trước",
  },
  {
    id: "cat_fnb",
    name: "F&B - Quán Cafe & Bánh",
    count: 1840,
    updated_at: "1 giờ trước",
  },
  {
    id: "cat_cosmetics",
    name: "Mỹ phẩm & Chăm sóc da",
    count: 2680,
    updated_at: "2 giờ trước",
  },
  {
    id: "cat_gym",
    name: "Gym & Fitness Yoga",
    count: 1250,
    updated_at: "Hôm qua",
  },
  {
    id: "cat_interior",
    name: "Nội thất & Kiến trúc",
    count: 1110,
    updated_at: "2 ngày trước",
  },
];

const INITIAL_PAGES_DATA = [
  {
    id: "1000648291101",
    category_id: "cat_fashion",
    initials: "LE",
    avatar_bg: "bg-indigo-100 text-indigo-700",
    name: "LEP' - Thời Trang Thiết Kế Hà Nội",
    verified: true,
    uid: "1000648291101",
    link: "fb.com/lep.design.vn",
    phone: "0988.456.789",
    email: "cskh@lep.vn",
    website: "lep.vn",
    address: "102 Bà Triệu, Hoàn Kiếm, Hà Nội",
    region: "HN",
  },
  {
    id: "1000837461920",
    category_id: "cat_fashion",
    initials: "TH",
    avatar_bg: "bg-pink-100 text-pink-700",
    name: "Thời Trang Nữ SIXDO By Đỗ Mạnh Cường",
    verified: true,
    uid: "1000837461920",
    link: "fb.com/sixdo.vn",
    phone: "1800.6650",
    email: "info@sixdo.vn",
    website: "sixdo.vn",
    address: "Quận 1, TP. Hồ Chí Minh",
    region: "HCM",
  },
  {
    id: "1000519283741",
    category_id: "cat_fashion",
    initials: "BG",
    avatar_bg: "bg-amber-100 text-amber-700",
    name: "Biluxury - Thời Trang Nam Thiết Kế",
    verified: true,
    uid: "1000519283741",
    link: "fb.com/biluxury.vn",
    phone: "0944.328.989",
    email: "support@biluxury.vn",
    website: "biluxury.vn",
    address: "Cầu Giấy, Hà Nội",
    region: "HN",
  },
  {
    id: "1000729182304",
    category_id: "cat_fashion",
    initials: "AF",
    avatar_bg: "bg-emerald-100 text-emerald-700",
    name: "Aristino - Be The Man",
    verified: true,
    uid: "1000729182304",
    link: "fb.com/ilovearistino",
    phone: "1800.6226",
    email: "cskh@aristino.com",
    website: "aristino.com",
    address: "Thanh Xuân, Hà Nội",
    region: "HN",
  },
  {
    id: "1000918273645",
    category_id: "cat_fashion",
    initials: "EL",
    avatar_bg: "bg-purple-100 text-purple-700",
    name: "ELISE Fashion Vietnam",
    verified: true,
    uid: "1000918273645",
    link: "fb.com/elisevietnam",
    phone: "1900.3060",
    email: "pr@elise.vn",
    website: "elise.vn",
    address: "Quận 3, TP. Hồ Chí Minh",
    region: "HCM",
  },
  {
    id: "1000394857123",
    category_id: "cat_fashion",
    initials: "JM",
    avatar_bg: "bg-blue-100 text-blue-700",
    name: "JM Dress Design - Đầm Thiết Kế Cao Cấp",
    verified: false,
    uid: "1000394857123",
    link: "fb.com/jmdressdesign",
    phone: "0962.960.766",
    email: "marketing@jm.com.vn",
    website: "jm.com.vn",
    address: "Đống Đa, Hà Nội",
    region: "HN",
  },
  {
    id: "1000661728394",
    category_id: "cat_realestate",
    initials: "BĐ",
    avatar_bg: "bg-cyan-100 text-cyan-700",
    name: "Biệt Thự Nghỉ Dưỡng Vinhomes & SunGroup",
    verified: true,
    uid: "1000661728394",
    link: "fb.com/bietthunghiduong.vip",
    phone: "0909.888.999",
    email: "sales@luxuryresort.vn",
    website: "luxuryresort.vn",
    address: "Ngũ Hành Sơn, Đà Nẵng",
    region: "DN",
  },
];

function exportPagesToCsv(pages, categoryName) {
  const headers = [
    "STT",
    "Tên Fanpage",
    "UID Page",
    "Link Page",
    "Số điện thoại",
    "Email",
    "Website",
    "Địa chỉ / Khu vực",
  ];
  const rows = pages.map((p, idx) => [
    idx + 1,
    `"${(p.name || "").replace(/"/g, '""')}"`,
    p.uid,
    `https://${p.link}`,
    p.phone || "Chưa cập nhật",
    p.email || "---",
    p.website || "---",
    `"${(p.address || "").replace(/"/g, '""')}"`,
  ]);
  const csv = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute(
    "download",
    `danh_sach_page_${(categoryName || "quet").toLowerCase().replace(/\s+/g, "_")}.csv`
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export default function PageScannerGroupsList() {
  const [categories, setCategories] = useState(() => {
    const savedLists = loadSavedPageLists();
    if (!Array.isArray(savedLists) || savedLists.length === 0) {
      return INITIAL_CATEGORIES;
    }
    const extraCats = savedLists.map((list) => ({
      id: `saved_${list.id}`,
      name: list.name,
      count: Array.isArray(list.pages) ? list.pages.length : 0,
      updated_at: "Vừa lưu",
    }));
    const existingIds = new Set(INITIAL_CATEGORIES.map((c) => c.id));
    return [...INITIAL_CATEGORIES, ...extraCats.filter((c) => !existingIds.has(c.id))];
  });
  const [activeCategoryId, setActiveCategoryId] = useState("cat_fashion");
  const [categorySearch, setCategorySearch] = useState("");

  const [pages, setPages] = useState(INITIAL_PAGES_DATA);
  const [pageSearch, setPageSearch] = useState("");
  const [infoStatusFilter, setInfoStatusFilter] = useState("ALL");
  const [regionFilter, setRegionFilter] = useState("ALL");
  const [selectedPageIds, setSelectedPageIds] = useState(["1000648291101", "1000837461920"]);

  // Add Category Modal
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  // Move Category Modal
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [targetCategoryId, setTargetCategoryId] = useState("cat_realestate");

  useEffect(() => {
    let mounted = true;

    getScannedPages({ page: 1, limit: 50 })
      .then((res) => {
        if (!mounted) return;
        const dbPages = Array.isArray(res?.items)
          ? res.items
          : Array.isArray(res?.data)
            ? res.data
            : [];
        if (dbPages.length > 0) {
          const mapped = dbPages.map((item, i) => ({
            id: String(item.page_id || item.id || `db_${i}`),
            category_id: "cat_fashion",
            initials: (item.name || "PG").slice(0, 2).toUpperCase(),
            avatar_bg: "bg-blue-100 text-blue-700",
            name: item.name || `Fanpage #${i + 1}`,
            verified: Boolean(item.is_verified),
            uid: String(item.page_id || item.id || ""),
            link: (item.url || `fb.com/${item.page_id || ""}`).replace(
              /^https?:\/\/(www\.)?/,
              ""
            ),
            phone: item.phone || "Chưa cập nhật",
            email: item.email || "---",
            website: item.website || "---",
            address: item.address || item.location || "Việt Nam",
            region: "HCM",
          }));
          setPages((prev) => {
            const existingIds = new Set(prev.map((p) => p.id));
            const uniqueNew = mapped.filter((m) => !existingIds.has(m.id));
            return [...prev, ...uniqueNew];
          });
        }
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  const filteredCategories = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, categorySearch]);

  const activeCategory = useMemo(() => {
    return (
      categories.find((c) => c.id === activeCategoryId) ||
      categories[0] || {
        id: "cat_fashion",
        name: "Thời trang cao cấp",
        count: 3420,
        updated_at: "15 phút trước",
      }
    );
  }, [categories, activeCategoryId]);

  const filteredPages = useMemo(() => {
    const q = pageSearch.trim().toLowerCase();
    return pages.filter((p) => {
      const belongsToCategory =
        p.category_id === activeCategory?.id || activeCategory?.id === "cat_fashion";
      if (!belongsToCategory) return false;

      if (
        q &&
        !p.name.toLowerCase().includes(q) &&
        !p.uid.toLowerCase().includes(q) &&
        !(p.phone || "").toLowerCase().includes(q) &&
        !(p.email || "").toLowerCase().includes(q)
      ) {
        return false;
      }

      if (infoStatusFilter === "HAS_PHONE" && (!p.phone || p.phone === "Chưa cập nhật")) {
        return false;
      }
      if (infoStatusFilter === "HAS_EMAIL" && (!p.email || p.email === "---")) {
        return false;
      }
      if (regionFilter !== "ALL" && p.region !== regionFilter) {
        return false;
      }

      return true;
    });
  }, [pages, activeCategory, pageSearch, infoStatusFilter, regionFilter]);

  const totalPagesAcrossCategories = useMemo(() => {
    return categories.reduce((acc, c) => acc + (Number(c.count) || 0), 0);
  }, [categories]);

  const handleToggleSelectPage = (id) => {
    setSelectedPageIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleToggleSelectAll = () => {
    if (
      filteredPages.length > 0 &&
      filteredPages.every((p) => selectedPageIds.includes(p.id))
    ) {
      setSelectedPageIds([]);
    } else {
      setSelectedPageIds(filteredPages.map((p) => p.id));
    }
  };

  const handleDeleteSelectedPages = () => {
    if (selectedPageIds.length === 0) return;
    setPages((prev) => prev.filter((p) => !selectedPageIds.includes(p.id)));
    setSelectedPageIds([]);
  };

  const handleCreateCategory = () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    const newCat = {
      id: `cat_${Date.now()}`,
      name: trimmed,
      count: 0,
      updated_at: "Vừa tạo",
    };
    setCategories((prev) => [...prev, newCat]);
    setActiveCategoryId(newCat.id);
    setNewCategoryName("");
    setShowAddCategoryModal(false);
  };

  const handleDeleteActiveCategory = () => {
    if (categories.length <= 1) return;
    const nextCats = categories.filter((c) => c.id !== activeCategory.id);
    setCategories(nextCats);
    setActiveCategoryId(nextCats[0].id);
  };

  const handleMoveSelectedToCategory = () => {
    if (!targetCategoryId || selectedPageIds.length === 0) return;
    setPages((prev) =>
      prev.map((p) =>
        selectedPageIds.includes(p.id) ? { ...p, category_id: targetCategoryId } : p
      )
    );
    setShowMoveModal(false);
    setSelectedPageIds([]);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start pb-10">
      {/* Left Sidebar: DANH SÁCH DANH MỤC */}
      <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <span className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">
            DANH SÁCH DANH MỤC
          </span>
          <button
            type="button"
            onClick={() => setShowAddCategoryModal(true)}
            className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Thêm
          </button>
        </div>

        {/* Summary bar */}
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-[11px] font-semibold text-slate-600">
          <span>
            Đã quét: <strong className="text-slate-900">{categories.length} danh mục</strong>
          </span>
          <span className="text-blue-600 font-bold">
            {totalPagesAcrossCategories.toLocaleString("vi-VN")} Page
          </span>
        </div>

        {/* Filter input */}
        <div className="p-3 border-b border-slate-100">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={categorySearch}
              onChange={(e) => setCategorySearch(e.target.value)}
              placeholder="Lọc danh mục thư mục..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Category cards */}
        <div className="p-2.5 space-y-1.5 max-h-[480px] overflow-y-auto">
          {filteredCategories.map((cat) => {
            const isSelected = cat.id === activeCategory?.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategoryId(cat.id)}
                className={`w-full text-left p-3 rounded-xl transition-all flex items-center justify-between gap-2 cursor-pointer ${
                  isSelected
                    ? "bg-blue-600 text-white shadow-sm"
                    : "hover:bg-slate-50 text-slate-700 border border-transparent hover:border-slate-200/80"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Folder
                    className={`w-4 h-4 shrink-0 ${
                      isSelected ? "text-white" : "text-blue-500"
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate">{cat.name}</div>
                    <div
                      className={`text-[10px] mt-0.5 ${
                        isSelected ? "text-blue-100" : "text-slate-400"
                      }`}
                    >
                      Cập nhật {cat.updated_at}
                    </div>
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0 ${
                    isSelected
                      ? "bg-white/20 text-white"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {Number(cat.count).toLocaleString("vi-VN")} page
                </span>
              </button>
            );
          })}
        </div>

        {/* Bottom dashed button */}
        <div className="p-3 border-t border-slate-100">
          <button
            type="button"
            onClick={() => setShowAddCategoryModal(true)}
            className="w-full py-2.5 rounded-xl border border-dashed border-blue-300 bg-blue-50/40 hover:bg-blue-50 text-blue-600 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Thêm danh mục mới
          </button>
        </div>
      </div>

      {/* Right Detail Card */}
      <div className="lg:col-span-9 bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        {/* Category Header */}
        <div className="p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-bold text-slate-900">
                {activeCategory?.name}
              </h2>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold">
                Đã đồng bộ
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              <strong className="text-slate-800">
                {Number(activeCategory?.count || filteredPages.length).toLocaleString(
                  "vi-VN"
                )}{" "}
                Page
              </strong>{" "}
              • Cập nhật {activeCategory?.updated_at}
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => exportPagesToCsv(filteredPages, activeCategory?.name)}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Xuất Excel
            </button>
            <button
              type="button"
              onClick={handleDeleteActiveCategory}
              className="px-3.5 py-2 rounded-xl border border-rose-200 bg-rose-50/60 hover:bg-rose-100 text-rose-600 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              Xóa danh mục
            </button>
          </div>
        </div>

        {/* Filter Row */}
        <div className="p-4 bg-slate-50/60 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={pageSearch}
              onChange={(e) => setPageSearch(e.target.value)}
              placeholder="Tìm theo Tên Page, ID Page, Số điện thoại hoặc Email..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-xs focus:outline-none focus:border-blue-500"
            />
          </div>

          <select
            value={infoStatusFilter}
            onChange={(e) => setInfoStatusFilter(e.target.value)}
            className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700"
          >
            <option value="ALL">Tình trạng: Tất cả thông tin</option>
            <option value="HAS_PHONE">Có Số điện thoại</option>
            <option value="HAS_EMAIL">Có địa chỉ Email</option>
          </select>

          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700"
          >
            <option value="ALL">Khu vực: Toàn quốc</option>
            <option value="HN">Hà Nội</option>
            <option value="HCM">TP. Hồ Chí Minh</option>
            <option value="DN">Đà Nẵng</option>
          </select>
        </div>

        {/* Selection Bar */}
        <div className="px-4 py-2.5 bg-blue-50/50 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={
                  filteredPages.length > 0 &&
                  filteredPages.every((p) => selectedPageIds.includes(p.id))
                }
                onChange={handleToggleSelectAll}
                className="w-4 h-4 rounded border-slate-300 text-blue-600"
              />
              Chọn tất cả
            </label>
            <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[11px] font-bold">
              Đã chọn {selectedPageIds.length} / {filteredPages.length} page
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowMoveModal(true)}
              disabled={selectedPageIds.length === 0}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <FolderInput className="w-3.5 h-3.5 text-blue-600" />
              Chuyển danh mục
            </button>
            <button
              type="button"
              onClick={handleDeleteSelectedPages}
              disabled={selectedPageIds.length === 0}
              className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Xóa ({selectedPageIds.length})
            </button>
          </div>
        </div>

        {/* Pages Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-[11px] font-bold text-slate-500 uppercase">
                <th className="py-3 px-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={
                      filteredPages.length > 0 &&
                      filteredPages.every((p) => selectedPageIds.includes(p.id))
                    }
                    onChange={handleToggleSelectAll}
                    className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600"
                  />
                </th>
                <th className="py-3 px-3 w-12">STT</th>
                <th className="py-3 px-3 min-w-[230px]">THÔNG TIN PAGE</th>
                <th className="py-3 px-3">LINK PAGE</th>
                <th className="py-3 px-3">SỐ ĐIỆN THOẠI</th>
                <th className="py-3 px-3">EMAIL</th>
                <th className="py-3 px-3">WEBSITE</th>
                <th className="py-3 px-3">ĐỊA CHỈ / VÙNG</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredPages.map((p, idx) => (
                <tr key={p.id} className="hover:bg-slate-50/80">
                  <td className="py-3 px-3 text-center">
                    <input
                      type="checkbox"
                      checked={selectedPageIds.includes(p.id)}
                      onChange={() => handleToggleSelectPage(p.id)}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600"
                    />
                  </td>
                  <td className="py-3 px-3 font-semibold text-slate-500">
                    {idx + 1}
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${p.avatar_bg}`}
                      >
                        {p.initials}
                      </div>
                      <div>
                        <div className="font-bold text-slate-800 flex items-center gap-1">
                          {p.name}
                          {p.verified && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 fill-blue-50" />
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          UID: {p.uid}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <a
                      href={`https://${p.link}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 hover:underline font-medium"
                    >
                      {p.link}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </td>
                  <td className="py-3 px-3">
                    {p.phone && p.phone !== "Chưa cập nhật" ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 font-bold text-[11px]">
                        <Phone className="w-3 h-3" />
                        {p.phone}
                      </span>
                    ) : (
                      <span className="text-slate-400 italic">Chưa cập nhật</span>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    {p.email && p.email !== "---" ? (
                      <span className="inline-flex items-center gap-1 text-slate-700">
                        <Mail className="w-3.5 h-3.5 text-slate-400" />
                        {p.email}
                      </span>
                    ) : (
                      <span className="text-slate-400">---</span>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    {p.website && p.website !== "---" ? (
                      <span className="inline-flex items-center gap-1 text-blue-600 font-medium">
                        <Globe className="w-3.5 h-3.5" />
                        {p.website}
                      </span>
                    ) : (
                      <span className="text-slate-400">---</span>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    <span className="inline-flex items-center gap-1 text-slate-600">
                      <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                      {p.address}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-4 py-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            Hiển thị <strong>1 - {filteredPages.length}</strong> trên tổng{" "}
            <strong>
              {Number(activeCategory?.count || filteredPages.length).toLocaleString(
                "vi-VN"
              )}
            </strong>{" "}
            page
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-600"
            >
              Trước
            </button>
            <button
              type="button"
              className="px-2.5 py-1 rounded bg-blue-600 text-white font-bold"
            >
              1
            </button>
            <button
              type="button"
              className="px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-600"
            >
              2
            </button>
            <button
              type="button"
              className="px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-600"
            >
              3
            </button>
            <button
              type="button"
              className="px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-600"
            >
              Sau
            </button>
          </div>
        </div>
      </div>

      {/* Modal: Thêm danh mục mới */}
      {showAddCategoryModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-800">
                Thêm danh mục Page mới
              </h3>
              <button
                type="button"
                onClick={() => setShowAddCategoryModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                Tên danh mục thư mục
              </label>
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="VD: Nha khoa & Thẩm mỹ viện..."
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddCategoryModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleCreateCategory}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold"
              >
                Tạo danh mục
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Chuyển danh mục */}
      {showMoveModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-800">
                Chuyển {selectedPageIds.length} Page sang danh mục khác
              </h3>
              <button
                type="button"
                onClick={() => setShowMoveModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                Chọn danh mục đích
              </label>
              <select
                value={targetCategoryId}
                onChange={(e) => setTargetCategoryId(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.count} page)
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowMoveModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleMoveSelectedToCategory}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold"
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
