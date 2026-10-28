"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  Upload,
  RefreshCw,
  FolderInput,
  MapPin,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "@/lib/toast";
import { initialsOf } from "@/modules/module_07_group_spam/shared/components";
import { AVATAR_COLORS } from "@/modules/module_07_group_spam/shared/constants";
import { getPageFollowers, getScannedPages, importFollowers } from "../service";
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
  const [pageSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const data = await getScannedPages({ page: 1, page_size: 200, sort_by: "followers", sort_dir: "desc" });
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
    () => (activePageKey === ALL_ID ? null : pages.find((p) => p.page_key === activePageKey)),
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
            rows = rows.filter((r) => `${r.location || ""}`.toLowerCase().includes(loc));
          }
          setItems(rows);
          setTotal(locationFilter.trim() ? rows.length : data.total || 0);
          setPage(p);
          setSelectedIds([]);
        })
        .catch((err) => {
          toast.error(`Lỗi tải DS followers: ${err.message}`);
        })
        .finally(() => setLoading(false));
    },
    [pageSize, keyword, activePageKey, locationFilter],
  );

  useEffect(() => {
    load(1);
  }, [activePageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = (p = 1) => {
    setLoading(true);
    return load(p);
  };

  const selectPage = (key) => {
    if (key === activePageKey) return;
    setLoading(true);
    setActivePageKey(key);
  };

  const handleExport = () => {
    const rowsSrc = selectedIds.length
      ? items.filter((r) => selectedIds.includes(r.id || `${r.page_key}-${r.follower_key}`))
      : items;
    if (!rowsSrc.length) {
      toast.warning("Không có dữ liệu để xuất.");
      return;
    }
    const headers = ["STT", "Page nguồn", "page_key", "Tên", "follower_key", "Link", "Giới tính", "Vị trí"];
    const rows = rowsSrc.map((r, i) => [
      i + 1,
      r.page_name || "",
      r.page_key || "",
      r.follower_name || "",
      r.follower_key || "",
      r.profile_url || "",
      r.gender || "",
      r.location || "",
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `followers_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Đã xuất CSV.");
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (!lines.length) {
        toast.warning("File trống.");
        return;
      }
      const start = /page_key|follower/i.test(lines[0]) ? 1 : 0;
      const itemsIn = [];
      for (let i = start; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c) => c.replace(/^"|"$/g, "").trim());
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
        toast.warning("Không parse được dòng hợp lệ (cần page_key, follower_key).");
        return;
      }
      const res = await importFollowers({ items: itemsIn });
      toast.success(`Import: +${res.inserted} mới · ${res.updated} cập nhật`);
      reload(1);
    } catch (err) {
      toast.error(err.message || "Lỗi import");
    }
  };

  const rowId = (r) => r.id || `${r.page_key}-${r.follower_key}`;
  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const detailTitle = activePage?.page_name || "Tất cả followers";

  return (
    <div className="pb-8">
      <ListPageHeader
        title="Danh sách follower"
        subtitle="Cơ sở dữ liệu người theo dõi theo từng Fanpage."
        actionHref="/scanner/followers"
        actionLabel="Quét followers"
      />

      <MasterDetail
        side={
          <ListSidePanel
            title="Danh mục Page"
            totalLabel={`${pages.length} page trong kho`}
            search={sideSearch}
            onSearchChange={setSideSearch}
            searchPlaceholder="Tìm tên hoặc ID page…"
          >
            <SideListItem
              active={activePageKey === ALL_ID}
              onClick={() => selectPage(ALL_ID)}
              title="Tất cả page"
              subtitle="Toàn bộ followers đã quét"
              badge={total > 0 && activePageKey === ALL_ID ? total.toLocaleString("vi-VN") : undefined}
            />
            {filteredPages.map((p, i) => (
              <SideListItem
                key={p.page_key}
                active={activePageKey === p.page_key}
                onClick={() => selectPage(p.page_key)}
                title={p.page_name || p.page_key}
                subtitle={p.page_key}
                badge={
                  p.follower_count != null
                    ? Number(p.follower_count).toLocaleString("vi-VN")
                    : undefined
                }
                avatar={
                  <Avatar className="size-8 border border-slate-200">
                    {p.avatar_url && <AvatarImage src={p.avatar_url} />}
                    <AvatarFallback className={AVATAR_COLORS[i % AVATAR_COLORS.length]}>
                      {initialsOf(p.page_name || "FB")}
                    </AvatarFallback>
                  </Avatar>
                }
              />
            ))}
            {!filteredPages.length && sideSearch ? (
              <p className="px-2 py-6 text-center text-[11px] text-slate-400">Không khớp page.</p>
            ) : null}
          </ListSidePanel>
        }
      >
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="font-heading text-sm font-bold text-slate-800">{detailTitle}</h2>
              <p className="mt-0.5 text-[11px] text-slate-400">
                {total.toLocaleString("vi-VN")} follower
                {activePage?.page_url ? (
                  <>
                    {" · "}
                    <a
                      href={activePage.page_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 text-primary hover:underline"
                    >
                      {String(activePage.page_url).replace(/^https?:\/\/(m\.|www\.)?facebook\.com\//, "fb.com/")}
                      <ExternalLink className="size-3" />
                    </a>
                  </>
                ) : null}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-[11px]" onClick={() => reload(1)}>
                <RefreshCw className="size-3.5" /> Làm mới
              </Button>
              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[11px] font-medium hover:bg-slate-50">
                <Upload className="size-3.5" /> Nhập file
                <input type="file" accept=".csv,.txt" className="hidden" onChange={handleImportFile} />
              </label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 border-emerald-200 bg-emerald-50 text-[11px] text-emerald-700"
                onClick={handleExport}
              >
                <Download className="size-3.5" /> Xuất
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 px-5 py-3">
            <div className="relative min-w-[200px] flex-1">
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && reload(1)}
                placeholder="Tìm tên, link, UID, vị trí…"
                className="h-9 text-[11px]"
              />
            </div>
            <div className="relative w-44">
              <MapPin className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && reload(1)}
                placeholder="Tỉnh thành…"
                className="h-9 pl-8 text-[11px]"
              />
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => reload(1)}>
              Lọc
            </Button>
            {selectedIds.length > 0 ? (
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-[11px]" disabled title="Sắp có">
                <FolderInput className="size-3.5" /> Chuyển danh mục
              </Button>
            ) : null}
          </div>

          <div className="flex items-center gap-3 px-5 pb-2">
            <label className="inline-flex items-center gap-2 text-[11px] text-slate-600">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(c) => setSelectedIds(c ? items.map(rowId) : [])}
              />
              Chọn tất cả
            </label>
            {selectedIds.length > 0 ? (
              <span className="text-[11px] text-slate-400">
                Đã chọn {selectedIds.length} / {items.length}
              </span>
            ) : null}
          </div>

          <div className="px-5">
            <SelectionBar count={selectedIds.length} onExport={handleExport} />
          </div>

          <div className="overflow-auto">
            <table className="w-full min-w-[960px] text-left text-[11px]">
              <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="w-10 px-4 py-3" />
                  <th className="w-12 px-3 py-3 font-semibold">STT</th>
                  <th className="px-3 py-3 font-semibold">PAGE NGUỒN</th>
                  <th className="px-3 py-3 font-semibold">TÊN</th>
                  <th className="px-3 py-3 font-semibold">LINK / UID</th>
                  <th className="px-3 py-3 font-semibold">GIỚI TÍNH</th>
                  <th className="px-3 py-3 font-semibold">VỊ TRÍ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <TableLoading colSpan={7} />
                ) : items.length === 0 ? (
                  <TableEmpty colSpan={7} message="Chưa có followers — import CSV hoặc chạy Quét followers." />
                ) : (
                  items.map((r, idx) => {
                    const id = rowId(r);
                    const selected = selectedIds.includes(id);
                    return (
                      <tr key={id} className={selected ? "bg-blue-50/50" : "hover:bg-slate-50"}>
                        <td className="px-4 py-2.5">
                          <Checkbox
                            checked={selected}
                            onCheckedChange={(c) =>
                              setSelectedIds((prev) => (c ? [...prev, id] : prev.filter((x) => x !== id)))
                            }
                          />
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-400">
                          {String((page - 1) * pageSize + idx + 1).padStart(2, "0")}
                        </td>
                        <td className="px-3 py-2.5 font-medium text-slate-700">
                          {r.page_name || r.page_key || "—"}
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-slate-800">
                          {r.follower_name || "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          {r.profile_url ? (
                            <a
                              href={r.profile_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex max-w-[220px] items-center gap-1 truncate text-primary hover:underline"
                            >
                              {r.follower_key || r.profile_url}
                              <ExternalLink className="size-3 shrink-0" />
                            </a>
                          ) : (
                            r.follower_key || "—"
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">
                          {r.gender || <span className="italic text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">
                          {r.location || <span className="italic text-slate-300">—</span>}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <ListPagination page={page} pageSize={pageSize} total={total} onPageChange={(p) => reload(p)} />
        </Card>
      </MasterDetail>
    </div>
  );
}
