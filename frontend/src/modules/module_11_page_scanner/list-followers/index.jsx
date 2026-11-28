"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  Upload,
  RefreshCw,
  Copy,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "@/lib/toast";
import { useActionLock } from "../shared/useActionLock";
import { saveCsvContent } from "../shared/saveFile.mjs";
import { runDelete, notifyExportResult } from "../_shared";
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
  // Khoá nút xuất file / sao chép trong lúc xử lý (bấm liên tục chỉ chạy / báo 1 lần)
  const [isExporting, guardExport] = useActionLock();
  const [isCopyingUid, guardCopyUid] = useActionLock();
  const [pages, setPages] = useState([]);
  const [sideSearch, setSideSearch] = useState("");
  const [activePageKey, setActivePageKey] = useState(ALL_ID);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState("");
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
          setItems(data.items || []);
          setTotal(data.total || 0);
          setPage(p);
          setSelectedIds([]);
        })
        .catch((err) => {
          toast.error(`Lỗi tải DS followers: ${err.message}`);
        })
        .finally(() => setLoading(false));
    },
    [pageSize, keyword, activePageKey],
  );

  useEffect(() => {
    load(1);
  }, [activePageKey, pageSize]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = (p = 1) => {
    setLoading(true);
    return load(p);
  };

  /* Chiều cao phần đầu dính (đổi khi hiện thanh "đang tick chọn") → vị trí dính của tiêu đề cột */
  const stickyHeadRef = useRef(null);
  const [stickyHeadHeight, setStickyHeadHeight] = useState(0);
  useLayoutEffect(() => {
    const el = stickyHeadRef.current;
    if (!el) return undefined;
    const measure = () => setStickyHeadHeight(el.offsetHeight);
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  /* Chỉ phủ khe 24px phía trên khi phần đầu đang dính — lúc chưa cuộn, dải phủ sẽ che dòng mô tả trang */
  const [headStuck, setHeadStuck] = useState(false);
  useEffect(() => {
    const el = stickyHeadRef.current;
    const scroller = el?.closest("main");
    if (!el || !scroller) return undefined;
    const check = () => {
      const padTop = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
      const offset = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      setHeadStuck(scroller.scrollTop > 0 && offset <= padTop + 1);
    };
    check();
    scroller.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      scroller.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);

  const selectPage = (key) => {
    if (key === activePageKey) return;
    setLoading(true);
    setActivePageKey(key);
  };

  const rowId = (r) => r.id || `${r.page_key}-${r.follower_key}`;

  const handleExport = async () => {
    const rowsSrc = selectedIds.length
      ? items.filter((r) => selectedIds.includes(rowId(r)))
      : items;
    if (!rowsSrc.length) {
      toast.warning("Không có dữ liệu để xuất.", { key: "m11-list-followers-export" });
      return;
    }
    const headers = [
      "STT",
      "Họ và Tên",
      "UID Facebook",
      "Profile Link",
      "Avatar",
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
        r.avatar_url || "",
        r.page_name || r.page_key || "",
      ];
    });
    const csv = [headers, ...rows]
      .map((row) =>
        row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");
    try {
      const res = await saveCsvContent(csv, `followers_${new Date().toISOString().slice(0, 10)}.csv`);
      notifyExportResult(res, {
        successMessage: `Đã xuất ${rowsSrc.length.toLocaleString("vi-VN")} followers ra file "${res.fileName}".`,
        key: "m11-list-followers-export",
      });
    } catch (err) {
      toast.error(`Lỗi xuất file: ${err?.message || "Không lưu được file."}`, {
        key: "m11-list-followers-export",
      });
    }
  };

  const handleDeleteSelected = async () => {
    const numericIds = items
      .filter((r) => selectedIds.includes(rowId(r)) && r.id != null)
      .map((r) => r.id);
    const n = await runDelete({
      count: numericIds.length,
      noun: "followers",
      request: () => deletePageFollowers({ follower_ids: numericIds }),
    });
    if (n == null) return;
    setSelectedIds([]);
    reload(page);
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
            // Cuộn trang vẫn giữ danh mục Page trong tầm nhìn (main của AppShell là vùng cuộn, p-6)
            className="lg:sticky lg:top-0"
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
          </ListSidePanel>
        }
      >
        {/* Không overflow-hidden: sẽ chặn sticky của phần đầu bảng */}
        <Card className="border-slate-200 shadow-sm">
          {/* Phần đầu (tiêu đề, nút, tìm kiếm, thanh chọn) dính trên cùng khi cuộn trang */}
          {/* top-0: thẳng hàng với cột Danh mục Page. main (vùng cuộn) có p-6 nên phía trên còn khe 24px —
              dải ::before màu nền phủ khe đó để dòng bảng cuộn qua không lộ ra */}
          <div
            ref={stickyHeadRef}
            className={`sticky top-0 z-30 rounded-t-xl bg-white ${
              headStuck
                ? "before:pointer-events-none before:absolute before:-inset-x-px before:-top-6 before:h-6 before:bg-background before:content-['']"
                : ""
            }`}
          >
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
                onClick={() => guardExport(handleExport)}
                disabled={isExporting}
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
                placeholder="Tìm kiếm theo UID, Tên người dùng…"
                className="h-9 text-[11px]"
              />
            </div>
          </div>

          <div className="px-5">
            <SelectionBar
              count={selectedIds.length}
              onExport={() => guardExport(handleExport)}
              exportDisabled={isExporting}
              onDelete={handleDeleteSelected}
            />
          </div>
          </div>

          {/* Màn rộng: bỏ overflow để tiêu đề cột dính theo trang, ngay dưới phần đầu; màn hẹp: cuộn ngang */}
          <div className="overflow-x-auto lg:overflow-visible">
            <table className="w-full min-w-[720px] text-left text-[11px]">
              <thead
                className="z-20 bg-slate-50 text-slate-500 lg:sticky lg:top-[var(--m11-head-h)]"
                style={{ "--m11-head-h": `${stickyHeadHeight}px` }}
              >
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
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <TableLoading colSpan={5} />
                ) : items.length === 0 ? (
                  <TableEmpty
                    colSpan={5}
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
                            <Avatar className="relative size-7">
                              <AvatarImage
                                src={r.avatar_url}
                                className="absolute inset-0 z-10"
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                }}
                              />
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
                                onClick={() =>
                                  guardCopyUid(async () => {
                                    try {
                                      await navigator.clipboard?.writeText(rawUid);
                                      toast.success(`Đã sao chép UID ${rawUid}`, { key: "m11-list-followers-copy" });
                                    } catch {
                                      toast.error("Không sao chép được UID", { key: "m11-list-followers-copy" });
                                    }
                                  })
                                }
                                disabled={isCopyingUid}
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
