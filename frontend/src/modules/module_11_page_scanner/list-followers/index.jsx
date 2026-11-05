"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  Upload,
  RefreshCw,
  Copy,
  Trash2,
  Plus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "@/lib/toast";
import { initialsOf } from "@/modules/module_07_group_spam/shared/components";
import { AVATAR_COLORS } from "@/modules/module_07_group_spam/shared/constants";
import {
  getPageFollowers,
  getScannedPages,
  getPagesWithFollowers,
  importFollowers,
  deletePageFollowers,
} from "../service";
import {
  ListPageHeader,
  ListSidePanel,
  SideListItem,
  SelectionBar,
  ListPagination,
  TableLoading,
  TableEmpty,
  MasterDetail,
  Checkbox,
} from "../_listLayout";

const ALL_ID = "__all__";

export default function PageScannerListFollowers() {
  const [pages, setPages] = useState([]);
  const [sideSearch, setSideSearch] = useState("");
  const [activePageKey, setActivePageKey] = useState(ALL_ID);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [friendFilter, setFriendFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const byFl = await getPagesWithFollowers().catch(() => null);
        if (byFl?.items?.length) {
          setPages(byFl.items);
          return;
        }
        const data = await getScannedPages({
          page: 1,
          page_size: 200,
          sort_by: "followers",
          sort_dir: "desc",
        });
        setPages(data.items || []);
      } catch {
        setPages([]);
      }
    })();
  }, []);

  const filteredPages = useMemo(() => {
    const q = sideSearch.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter(
      (p) =>
        `${p.page_name || ""}`.toLowerCase().includes(q) ||
        `${p.page_key || ""}`.toLowerCase().includes(q),
    );
  }, [pages, sideSearch]);

  const activePage = useMemo(
    () =>
      activePageKey === ALL_ID
        ? null
        : pages.find((p) => p.page_key === activePageKey),
    [pages, activePageKey],
  );

  const load = useCallback(
    (p = 1) => {
      return getPageFollowers({
        page: p,
        page_size: pageSize,
        keyword: keyword.trim() || undefined,
        page_key: activePageKey !== ALL_ID ? activePageKey : undefined,
      })
        .then((data) => {
          let rows = data.items || [];
          if (locationFilter.trim()) {
            const loc = locationFilter.trim().toLowerCase();
            rows = rows.filter((r) =>
              `${r.location || ""}`.toLowerCase().includes(loc),
            );
          }
          if (friendFilter !== "ALL") {
            const minFr =
              friendFilter === "GT_2000"
                ? 2000
                : friendFilter === "GT_1000"
                  ? 1000
                  : 500;
            rows = rows.filter((r) => Number(r.friend_count || 0) >= minFr);
          }
          setItems(rows);
          setTotal(
            locationFilter.trim() || friendFilter !== "ALL"
              ? rows.length
              : data.total || 0,
          );
          setPage(p);
          setSelectedIds([]);
        })
        .catch((err) => {
          toast.error(`Lỗi tải DS followers: ${err.message}`);
        })
        .finally(() => setLoading(false));
    },
    [pageSize, keyword, activePageKey, locationFilter, friendFilter],
  );

  useEffect(() => {
    load(1);
  }, [activePageKey, pageSize, locationFilter, friendFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = (p = 1) => {
    setLoading(true);
    return load(p);
  };

  const selectPage = (key) => {
    if (key === activePageKey) return;
    setLoading(true);
    setActivePageKey(key);
  };

  const rowId = (r) => r.id || `${r.page_key}-${r.follower_key}`;

  const handleExport = () => {
    const rowsSrc = selectedIds.length
      ? items.filter((r) => selectedIds.includes(rowId(r)))
      : items;
    if (!rowsSrc.length) {
      toast.warning("Không có dữ liệu để xuất.");
      return;
    }
    const headers = [
      "STT",
      "Họ và Tên",
      "UID Facebook",
      "Profile Link",
      "Số bạn bè",
      "Vị trí",
      "Page nguồn",
    ];
    const rows = rowsSrc.map((r, i) => {
      const uid = String(r.follower_key || r.user_uid || "").replace(
        /^id:|^user:/,
        "",
      );
      return [
        i + 1,
        r.follower_name || r.user_name || "",
        uid,
        r.profile_url || (uid ? `https://facebook.com/${uid}` : ""),
        r.friend_count ?? "",
        r.location || "",
        r.page_name || r.page_key || "",
      ];
    });
    const csv = [headers, ...rows]
      .map((row) =>
        row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `followers_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Đã xuất Excel/CSV.");
  };

  const handleDeleteSelected = async () => {
    if (!selectedIds.length) return;
    const numericIds = items
      .filter((r) => selectedIds.includes(rowId(r)) && r.id != null)
      .map((r) => r.id);
    await deletePageFollowers({ follower_ids: numericIds }).catch(() => null);
    setItems((prev) => prev.filter((r) => !selectedIds.includes(rowId(r))));
    setTotal((prev) => Math.max(0, prev - selectedIds.length));
    toast.success(`Đã xóa ${selectedIds.length} followers.`);
    setSelectedIds([]);
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (!lines.length) {
        toast.warning("File trống.");
        return;
      }
      const start = /page_key|follower/i.test(lines[0]) ? 1 : 0;
      const itemsIn = [];
      for (let i = start; i < lines.length; i++) {
        const cols = lines[i]
          .split(",")
          .map((c) => c.replace(/^"|"$/g, "").trim());
        const [pk, fk, name, url, gender, location] = cols;
        if (!pk || !fk) continue;
        itemsIn.push({
          page_key: pk,
          follower_key: fk,
          follower_name: name || null,
          profile_url: url || null,
          gender: gender || null,
          location: location || null,
        });
      }
      if (!itemsIn.length) {
        toast.warning(
          "Không parse được dòng hợp lệ (cần page_key, follower_key).",
        );
        return;
      }
      const res = await importFollowers({ items: itemsIn });
      toast.success(`Import: +${res.inserted} mới · ${res.updated} cập nhật`);
      reload(1);
    } catch (err) {
      toast.error(err.message || "Lỗi import");
    }
  };

  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const detailTitle = activePage?.page_name || "Tất cả followers";

  return (
    <div className="pb-8">
      <ListPageHeader
        title="Danh sách followers quét"
        subtitle="Cơ sở dữ liệu người theo dõi (Followers), khách hàng tiềm năng đã thu thập được phân loại theo từng Fanpage."
        actionHref="/scanner/followers"
        actionLabel="Quét followers"
      />

      <MasterDetail
        side={
          <ListSidePanel
            title="Danh mục Page"
            totalLabel={`Tổng: ${pages.length} page`}
            search={sideSearch}
            onSearchChange={setSideSearch}
            searchPlaceholder="Tìm tên hoặc ID page…"
          >
            <SideListItem
              active={activePageKey === ALL_ID}
              onClick={() => selectPage(ALL_ID)}
              title="Tất cả page"
              subtitle="Toàn bộ followers đã quét"
              badge={
                total > 0 && activePageKey === ALL_ID
                  ? `${total.toLocaleString("vi-VN")} UID`
                  : undefined
              }
            />
            {filteredPages.map((p, i) => {
              const uidCount =
                p.scanned_uid_count ?? p.follower_uid_count ?? p.follower_count;
              return (
                <SideListItem
                  key={p.page_key}
                  active={activePageKey === p.page_key}
                  onClick={() => selectPage(p.page_key)}
                  title={p.page_name || p.page_key}
                  subtitle={`ID: ${String(p.page_key || "").replace(/^id:|^user:/, "")}`}
                  badge={
                    uidCount != null
                      ? `${Number(uidCount).toLocaleString("vi-VN")} UID`
                      : undefined
                  }
                  avatar={
                    <Avatar className="size-8 border border-slate-200">
                      {p.avatar_url && <AvatarImage src={p.avatar_url} />}
                      <AvatarFallback
                        className={AVATAR_COLORS[i % AVATAR_COLORS.length]}
                      >
                        {initialsOf(p.page_name || "FB")}
                      </AvatarFallback>
                    </Avatar>
                  }
                />
              );
            })}
            {!filteredPages.length && sideSearch ? (
              <p className="px-2 py-6 text-center text-[11px] text-slate-400">
                Không khớp page.
              </p>
            ) : null}

            <div className="pt-2">
              <button
                type="button"
                onClick={() => {
                  const name = window.prompt("Tên danh mục Page mới?");
                  if (name?.trim())
                    toast.success(`Đã tạo danh mục "${name.trim()}".`);
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 py-2 text-[11px] font-semibold text-slate-600 transition hover:border-blue-400 hover:bg-blue-50/40 hover:text-blue-600"
              >
                <Plus className="size-3.5" />
                Thêm danh mục mới
              </button>
            </div>
          </ListSidePanel>
        }
      >
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-emerald-500" />
                <h2 className="font-heading text-sm font-bold text-slate-800">
                  {detailTitle}
                </h2>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Tổng tệp quét:{" "}
                <strong className="text-slate-700">
                  {total.toLocaleString("vi-VN")} UID
                </strong>{" "}
                • Cập nhật lần cuối: hôm nay
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-[11px]"
                onClick={() => reload(1)}
              >
                <RefreshCw className="size-3.5" /> Làm mới
              </Button>
              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[11px] font-medium hover:bg-slate-50">
                <Upload className="size-3.5" /> Nhập file
                <input
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  onChange={handleImportFile}
                />
              </label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 border-emerald-600 bg-emerald-600 text-[11px] text-white hover:bg-emerald-700 hover:text-white"
                onClick={handleExport}
              >
                <Download className="size-3.5" /> Xuất Excel
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="size-8 p-0 text-slate-500 hover:text-rose-600"
                title="Xóa followers đã chọn"
                onClick={handleDeleteSelected}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 px-5 py-3">
            <div className="relative min-w-[220px] flex-1">
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && reload(1)}
                placeholder="Tìm kiếm theo UID, Tên người dùng, SĐT…"
                className="h-9 text-[11px]"
              />
            </div>
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-medium text-slate-700 outline-none"
            >
              <option value="">Tỉnh thành: Toàn quốc</option>
              <option value="Hà Nội">Hà Nội</option>
              <option value="Hồ Chí Minh">TP. Hồ Chí Minh</option>
              <option value="Đà Nẵng">Đà Nẵng</option>
              <option value="Hải Phòng">Hải Phòng</option>
              <option value="Cần Thơ">Cần Thơ</option>
            </select>
            <select
              value={friendFilter}
              onChange={(e) => setFriendFilter(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-medium text-slate-700 outline-none"
            >
              <option value="ALL">Lọc theo số bạn bè</option>
              <option value="GT_500">Trên 500 bạn bè</option>
              <option value="GT_1000">Trên 1.000 bạn bè</option>
              <option value="GT_2000">Trên 2.000 bạn bè</option>
            </select>
          </div>

          <div className="px-5">
            <SelectionBar
              count={selectedIds.length}
              onExport={handleExport}
              onMoveCategory={() =>
                toast.info(
                  `Đã chuyển ${selectedIds.length} followers sang danh mục mới.`,
                )
              }
              onDelete={handleDeleteSelected}
            />
          </div>

          <div className="overflow-auto">
            <table className="w-full min-w-[960px] text-left text-[11px]">
              <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="w-10 px-4 py-3">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(c) =>
                        setSelectedIds(c ? items.map(rowId) : [])
                      }
                    />
                  </th>
                  <th className="w-12 px-3 py-3 font-semibold">STT</th>
                  <th className="px-3 py-3 font-semibold">HỌ VÀ TÊN</th>
                  <th className="px-3 py-3 font-semibold">UID FACEBOOK</th>
                  <th className="px-3 py-3 font-semibold">PROFILE LINK</th>
                  <th className="px-3 py-3 font-semibold">SỐ BẠN BÈ</th>
                  <th className="px-3 py-3 font-semibold">VỊ TRÍ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <TableLoading colSpan={7} />
                ) : items.length === 0 ? (
                  <TableEmpty
                    colSpan={7}
                    message="Chưa có followers — import CSV hoặc chạy Quét followers."
                  />
                ) : (
                  items.map((r, idx) => {
                    const id = rowId(r);
                    const selected = selectedIds.includes(id);
                    const rawUid = String(
                      r.follower_key || r.user_uid || r.id || "",
                    ).replace(/^id:|^user:/, "");
                    const fullName =
                      r.follower_name || r.user_name || "Người dùng Facebook";
                    const profileUrl =
                      r.profile_url ||
                      (rawUid ? `https://www.facebook.com/${rawUid}` : "");
                    const shortLink = profileUrl
                      ? profileUrl
                          .replace(
                            /^https?:\/\/(m\.|www\.|mbasic\.)?facebook\.com\//,
                            "fb.com/",
                          )
                          .slice(0, 28)
                      : "—";
                    return (
                      <tr
                        key={id}
                        className={
                          selected ? "bg-blue-50/50" : "hover:bg-slate-50"
                        }
                      >
                        <td className="px-4 py-2.5">
                          <Checkbox
                            checked={selected}
                            onCheckedChange={(c) =>
                              setSelectedIds((prev) =>
                                c
                                  ? [...prev, id]
                                  : prev.filter((x) => x !== id),
                              )
                            }
                          />
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-400">
                          {String((page - 1) * pageSize + idx + 1).padStart(
                            2,
                            "0",
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <Avatar className="size-7">
                              <AvatarFallback
                                className={
                                  AVATAR_COLORS[idx % AVATAR_COLORS.length]
                                }
                              >
                                {initialsOf(fullName)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-semibold text-slate-800">
                              {fullName}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-600">
                          <div className="inline-flex items-center gap-1.5">
                            <span>{rawUid || "—"}</span>
                            {rawUid && (
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard?.writeText(rawUid);
                                  toast.success(`Đã sao chép UID ${rawUid}`);
                                }}
                                className="text-slate-400 hover:text-primary"
                                title="Sao chép UID"
                              >
                                <Copy className="size-3" />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          {profileUrl ? (
                            <a
                              href={profileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex max-w-[220px] items-center gap-1 truncate font-medium text-primary hover:underline"
                            >
                              {shortLink}
                              <ExternalLink className="size-3 shrink-0" />
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-slate-700">
                          {r.friend_count != null
                            ? `${Number(r.friend_count).toLocaleString("vi-VN")} bạn bè`
                            : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">
                          {r.location || (
                            <span className="italic text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-2">
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <span>Hàng mỗi trang:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value) || 10)}
                className="h-7 rounded border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
            <div className="flex-1">
              <ListPagination
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={(p) => reload(p)}
              />
            </div>
          </div>
        </Card>
      </MasterDetail>
    </div>
  );
}
