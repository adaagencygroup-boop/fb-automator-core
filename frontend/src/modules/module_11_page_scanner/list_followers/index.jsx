"use client";

import React, { useState, useMemo } from "react";
import {
  Search,
  Plus,
  RefreshCw,
  FileSpreadsheet,
  Trash2,
  Copy,
  Check,
  ExternalLink,
  Users,
  MapPin,
  FolderInput,
  Download,
  X,
} from "lucide-react";

const INITIAL_FOLLOWER_PAGES = [
  {
    id: "page_skincare_kr",
    name: "Mỹ Phẩm & Skincare Hàn Quốc",
    page_uid: "100064829101",
    uid_count: 4820,
    updated_at: "10:45 AM hôm nay",
  },
  {
    id: "page_tech_world",
    name: "Thế Giới Công Nghệ",
    page_uid: "100083920192",
    uid_count: 245,
    updated_at: "09:15 AM hôm nay",
  },
  {
    id: "page_hot_fashion",
    name: "Thời Trang Nữ Hot",
    page_uid: "100051829304",
    uid_count: 180,
    updated_at: "Hôm qua",
  },
  {
    id: "page_coastal_bds",
    name: "Bất Động Sản Ven Biển",
    page_uid: "100092837465",
    uid_count: 95,
    updated_at: "Hôm qua",
  },
  {
    id: "page_modern_interior",
    name: "Nội Thất Hiện Đại",
    page_uid: "100073829104",
    uid_count: 310,
    updated_at: "2 ngày trước",
  },
  {
    id: "page_smart_home",
    name: "Gia Dụng Tiện Ích",
    page_uid: "100049283716",
    uid_count: 140,
    updated_at: "3 ngày trước",
  },
];

const INITIAL_FOLLOWERS_LIST = [
  {
    id: "uid_100089412388",
    uid: "100089412388",
    name: "Nguyễn Ngọc Bảo Trâm",
    initials: "BT",
    avatar_bg: "bg-pink-100 text-pink-700",
    subtitle: "Nữ • Tương tác thường xuyên",
    profile_link: "fb.com/100089412388",
    friends_count: 4850,
    location: "TP. Hồ Chí Minh",
    region_code: "HCM",
  },
  {
    id: "uid_100045198273",
    uid: "100045198273",
    name: "Trần Minh Hoàng",
    initials: "MH",
    avatar_bg: "bg-blue-100 text-blue-700",
    subtitle: "Nam • Đã theo dõi 2 năm",
    profile_link: "fb.com/100045198273",
    friends_count: 3420,
    location: "Hà Nội",
    region_code: "HN",
  },
  {
    id: "uid_100078291034",
    uid: "100078291034",
    name: "Lê Thị Khánh Linh",
    initials: "KL",
    avatar_bg: "bg-purple-100 text-purple-700",
    subtitle: "Nữ • Top Fan cứng",
    profile_link: "fb.com/100078291034",
    friends_count: 4990,
    location: "Đà Nẵng",
    region_code: "DN",
  },
  {
    id: "uid_100061928374",
    uid: "100061928374",
    name: "Phạm Quốc Khánh",
    initials: "QK",
    avatar_bg: "bg-emerald-100 text-emerald-700",
    subtitle: "Nam • Đã theo dõi 8 tháng",
    profile_link: "fb.com/100061928374",
    friends_count: 2150,
    location: "TP. Hồ Chí Minh",
    region_code: "HCM",
  },
  {
    id: "uid_100093847561",
    uid: "100093847561",
    name: "Đỗ Thùy Dương",
    initials: "TD",
    avatar_bg: "bg-amber-100 text-amber-700",
    subtitle: "Nữ • Tương tác gần đây",
    profile_link: "fb.com/100093847561",
    friends_count: 1890,
    location: "Hà Nội",
    region_code: "HN",
  },
  {
    id: "uid_100038475692",
    uid: "100038475692",
    name: "Vũ Hoàng Nam",
    initials: "HN",
    avatar_bg: "bg-indigo-100 text-indigo-700",
    subtitle: "Nam • Đã theo dõi 1 năm",
    profile_link: "fb.com/100038475692",
    friends_count: 4120,
    location: "Hải Phòng",
    region_code: "HP",
  },
];

function exportFollowersCsv(followers, filename = "danh_sach_followers_quet.csv") {
  const headers = [
    "STT",
    "Họ và Tên",
    "UID Facebook",
    "Profile Link",
    "Số bạn bè",
    "Vị trí",
  ];
  const rows = followers.map((f, idx) => [
    idx + 1,
    `"${(f.name || "").replace(/"/g, '""')}"`,
    f.uid,
    `https://${f.profile_link}`,
    f.friends_count,
    `"${f.location}"`,
  ]);
  const csv = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.setAttribute("download", filename);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export default function PageScannerListFollowers() {
  const [pages, setPages] = useState(INITIAL_FOLLOWER_PAGES);
  const [activePageId, setActivePageId] = useState("page_skincare_kr");
  const [sidebarSearch, setSidebarSearch] = useState("");

  const [followers, setFollowers] = useState(INITIAL_FOLLOWERS_LIST);
  const [searchQuery, setSearchQuery] = useState("");
  const [provinceFilter, setProvinceFilter] = useState("ALL");
  const [friendsFilter, setFriendsFilter] = useState("ALL");

  const [selectedIds, setSelectedIds] = useState([
    "uid_100089412388",
    "uid_100045198273",
    "uid_100078291034",
  ]);
  const [copiedUid, setCopiedUid] = useState(null);

  const [showAddCatModal, setShowAddCatModal] = useState(false);
  const [newCatName, setNewCatName] = useState("");

  const filteredSidebarPages = useMemo(() => {
    const q = sidebarSearch.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.page_uid.toLowerCase().includes(q)
    );
  }, [pages, sidebarSearch]);

  const activePage = useMemo(() => {
    return pages.find((p) => p.id === activePageId) || pages[0];
  }, [pages, activePageId]);

  const filteredFollowers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return followers.filter((f) => {
      if (
        q &&
        !f.name.toLowerCase().includes(q) &&
        !f.uid.toLowerCase().includes(q) &&
        !f.location.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (provinceFilter !== "ALL" && f.region_code !== provinceFilter) {
        return false;
      }
      if (friendsFilter === "GT_2000" && f.friends_count < 2000) {
        return false;
      }
      if (friendsFilter === "GT_4000" && f.friends_count < 4000) {
        return false;
      }
      return true;
    });
  }, [followers, searchQuery, provinceFilter, friendsFilter]);

  const handleCopyUid = (uid) => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(uid).catch(() => {});
    }
    setCopiedUid(uid);
    setTimeout(() => setCopiedUid(null), 1600);
  };

  const toggleSelectFollower = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (
      filteredFollowers.length > 0 &&
      filteredFollowers.every((f) => selectedIds.includes(f.id))
    ) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredFollowers.map((f) => f.id));
    }
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    setFollowers((prev) => prev.filter((f) => !selectedIds.includes(f.id)));
    setSelectedIds([]);
  };

  const handleRefresh = () => {
    const randomUid = String(Math.floor(100010000000 + Math.random() * 89999999999));
    const newItem = {
      id: `uid_${randomUid}`,
      uid: randomUid,
      name: "Hoàng Ngọc Thảo Vy",
      initials: "TV",
      avatar_bg: "bg-rose-100 text-rose-700",
      subtitle: "Nữ • Vừa đồng bộ mới",
      profile_link: `fb.com/${randomUid}`,
      friends_count: Math.floor(1200 + Math.random() * 3600),
      location: "TP. Hồ Chí Minh",
      region_code: "HCM",
    };
    setFollowers((prev) => [newItem, ...prev]);
    setPages((prev) =>
      prev.map((p) =>
        p.id === activePage.id
          ? { ...p, uid_count: p.uid_count + 1, updated_at: "Vừa xong" }
          : p
      )
    );
  };

  const handleAddCategory = () => {
    const trimmed = newCatName.trim();
    if (!trimmed) return;
    const created = {
      id: `page_${Date.now()}`,
      name: trimmed,
      page_uid: String(Math.floor(10001000000 + Math.random() * 89999999999)),
      uid_count: 0,
      updated_at: "Vừa tạo",
    };
    setPages((prev) => [...prev, created]);
    setActivePageId(created.id);
    setNewCatName("");
    setShowAddCatModal(false);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start pb-10">
      {/* Left Sidebar: Danh mục Page */}
      <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <span className="text-sm font-bold text-slate-800">Danh mục Page</span>
          <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[11px] font-bold">
            Tổng: {pages.length} page
          </span>
        </div>

        <div className="p-3 border-b border-slate-100">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
              placeholder="Tìm tên hoặc ID page..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="p-2.5 space-y-1.5 max-h-[480px] overflow-y-auto">
          {filteredSidebarPages.map((p) => {
            const isSelected = p.id === activePage?.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setActivePageId(p.id)}
                className={`w-full text-left p-3 rounded-xl transition-all flex items-center justify-between gap-2 cursor-pointer ${
                  isSelected
                    ? "bg-blue-600 text-white shadow-sm"
                    : "hover:bg-slate-50 text-slate-700 border border-transparent"
                }`}
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold truncate">{p.name}</div>
                  <div
                    className={`text-[10px] mt-0.5 ${
                      isSelected ? "text-blue-100" : "text-slate-400"
                    }`}
                  >
                    ID: {p.page_uid}
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0 ${
                    isSelected
                      ? "bg-white/20 text-white"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {p.uid_count.toLocaleString("vi-VN")} UID
                </span>
              </button>
            );
          })}
        </div>

        <div className="p-3 border-t border-slate-100">
          <button
            type="button"
            onClick={() => setShowAddCatModal(true)}
            className="w-full py-2.5 rounded-xl border border-dashed border-blue-300 bg-blue-50/40 hover:bg-blue-50 text-blue-600 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Thêm danh mục mới
          </button>
        </div>
      </div>

      {/* Right Main Card */}
      <div className="lg:col-span-9 bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <h2 className="text-base font-bold text-slate-900">
                {activePage?.name}
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Tổng tệp quét:{" "}
              <strong className="text-blue-600">
                {(activePage?.uid_count || filteredFollowers.length).toLocaleString(
                  "vi-VN"
                )}{" "}
                UID
              </strong>{" "}
              • Cập nhật lần cuối: {activePage?.updated_at}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 text-blue-600" />
              Làm mới
            </button>
            <button
              type="button"
              onClick={() => exportFollowersCsv(filteredFollowers)}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Xuất Excel
            </button>
            <button
              type="button"
              onClick={() => {
                if (pages.length <= 1) return;
                const next = pages.filter((p) => p.id !== activePage.id);
                setPages(next);
                setActivePageId(next[0].id);
              }}
              className="p-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-600 cursor-pointer"
              title="Xóa danh mục này"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter Row */}
        <div className="p-4 bg-slate-50/60 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm theo UID, Tên người dùng, SĐT..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-xs focus:outline-none focus:border-blue-500"
            />
          </div>

          <select
            value={provinceFilter}
            onChange={(e) => setProvinceFilter(e.target.value)}
            className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700"
          >
            <option value="ALL">Tỉnh thành: Toàn quốc</option>
            <option value="HCM">TP. Hồ Chí Minh</option>
            <option value="HN">Hà Nội</option>
            <option value="DN">Đà Nẵng</option>
            <option value="HP">Hải Phòng</option>
          </select>

          <select
            value={friendsFilter}
            onChange={(e) => setFriendsFilter(e.target.value)}
            className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700"
          >
            <option value="ALL">Lọc theo số bạn bè: Tất cả</option>
            <option value="GT_2000">Từ 2.000 bạn bè trở lên</option>
            <option value="GT_4000">Trên 4.000 bạn bè</option>
          </select>
        </div>

        {/* Blue Selection Bar */}
        {selectedIds.length > 0 && (
          <div className="px-4 py-2.5 bg-blue-50/80 border-b border-blue-100 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-blue-800">
              {selectedIds.length} Followers đang được tick chọn
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="px-3 py-1 rounded-lg bg-white border border-blue-200 text-blue-700 text-xs font-semibold flex items-center gap-1 cursor-pointer"
              >
                <FolderInput className="w-3.5 h-3.5" />
                Chuyển danh mục
              </button>
              <button
                type="button"
                onClick={() =>
                  exportFollowersCsv(
                    filteredFollowers.filter((f) => selectedIds.includes(f.id)),
                    "followers_da_chon.csv"
                  )
                }
                className="px-3 py-1 rounded-lg bg-white border border-blue-200 text-blue-700 text-xs font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Xuất file chọn
              </button>
              <button
                type="button"
                onClick={handleDeleteSelected}
                className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Xóa ({selectedIds.length})
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-[11px] font-bold text-slate-500 uppercase">
                <th className="py-3 px-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={
                      filteredFollowers.length > 0 &&
                      filteredFollowers.every((f) => selectedIds.includes(f.id))
                    }
                    onChange={toggleSelectAll}
                    className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600"
                  />
                </th>
                <th className="py-3 px-3 w-12">STT</th>
                <th className="py-3 px-3 min-w-[220px]">HỌ VÀ TÊN</th>
                <th className="py-3 px-3">UID FACEBOOK</th>
                <th className="py-3 px-3">PROFILE LINK</th>
                <th className="py-3 px-3">SỐ BẠN BÈ</th>
                <th className="py-3 px-3">VỊ TRÍ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredFollowers.map((item, idx) => (
                <tr key={item.id} className="hover:bg-slate-50/70">
                  <td className="py-3.5 px-3 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => toggleSelectFollower(item.id)}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600"
                    />
                  </td>
                  <td className="py-3.5 px-3 font-semibold text-slate-500">
                    {idx + 1}
                  </td>
                  <td className="py-3.5 px-3">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${item.avatar_bg}`}
                      >
                        {item.initials}
                      </div>
                      <div>
                        <div className="font-bold text-slate-800">{item.name}</div>
                        <div className="text-[11px] text-slate-400">
                          {item.subtitle}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-3">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 font-mono text-[11px] font-bold">
                      <span>{item.uid}</span>
                      <button
                        type="button"
                        onClick={() => handleCopyUid(item.uid)}
                        className="text-slate-400 hover:text-blue-600 cursor-pointer"
                        title="Copy UID"
                      >
                        {copiedUid === item.uid ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </td>
                  <td className="py-3.5 px-3">
                    <a
                      href={`https://${item.profile_link}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 hover:underline font-medium"
                    >
                      {item.profile_link}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </td>
                  <td className="py-3.5 px-3">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 font-bold text-[11px]">
                      <Users className="w-3 h-3" />
                      {item.friends_count.toLocaleString("vi-VN")} bạn bè
                    </span>
                  </td>
                  <td className="py-3.5 px-3">
                    <span className="inline-flex items-center gap-1 text-slate-700 font-medium">
                      <MapPin className="w-3.5 h-3.5 text-rose-500" />
                      {item.location}
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
            Hiển thị <strong>1 - {filteredFollowers.length}</strong> trên tổng{" "}
            <strong>
              {(activePage?.uid_count || filteredFollowers.length).toLocaleString(
                "vi-VN"
              )}
            </strong>{" "}
            Followers
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
      {showAddCatModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-800">
                Thêm danh mục Followers mới
              </h3>
              <button
                type="button"
                onClick={() => setShowAddCatModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                Tên Fanpage / Danh mục
              </label>
              <input
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="VD: Cộng Đồng Yêu Bếp..."
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddCatModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleAddCategory}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold"
              >
                Thêm mới
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
