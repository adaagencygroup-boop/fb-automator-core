"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  BadgeCheck,
  Phone,
  Plus,
  RefreshCw,
  Hash,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "@/lib/toast";
import { initialsOf } from "@/modules/module_07_group_spam/shared/components";
import { AVATAR_COLORS } from "@/modules/module_07_group_spam/shared/constants";
import {
  getScannedPages,
  getSearchKeywords,
  savePageList,
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
import { useSavedPageLists } from "../shared/useSavedPageLists";

const ALL_ID = "__all__";
const KW_PREFIX = "kw:";
const LIST_PREFIX = "list:";

/** Làm sạch category FB (bỏ đoạn " · N followers"). */
function cleanCategory(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s
    .replace(/\s*[·•]\s*\d[\d.,]*\s*followers?\b/gi, "")
    .replace(/\s*[·•]\s*\d[\d.,]*\s*người theo dõi\b/gi, "")
    .replace(/^(Facebook\s*[·•]\s*)+/i, "")
    .trim();
}

/** Tag hiển thị: matched_hashtags + source_keywords (unique). */
function pageTags(row) {
  const out = [];
  const seen = new Set();
  const push = (v) => {
    const t = String(v || "").trim().replace(/^#/, "");
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t.startsWith("#") ? t : t);
  };
  const mh = row?.matched_hashtags;
  if (Array.isArray(mh)) mh.forEach(push);
  else if (typeof mh === "string" && mh.trim()) {
    try {
      const parsed = JSON.parse(mh);
      if (Array.isArray(parsed)) parsed.forEach(push);
      else
        mh.split(/[,;|]/).forEach(push);
    } catch {
      mh.split(/[,;|]/).forEach(push);
    }
  }
  (row?.source_keywords || []).forEach(push);
  return out;
}

export default function PageScannerListPages() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState([]);

  const [keywords, setKeywords] = useState([]);
  const lists = useSavedPageLists();
  const [sideSearch, setSideSearch] = useState("");
  const [activeId, setActiveId] = useState(ALL_ID);

  const loadKeywords = useCallback(() => {
    return getSearchKeywords()
      .then((data) => setKeywords(data.items || []))
      .catch(() => setKeywords([]));
  }, []);

  useEffect(() => {
    loadKeywords();
  }, [loadKeywords]);

  const activeKeyword = useMemo(() => {
    if (!activeId.startsWith(KW_PREFIX)) return null;
    const kw = activeId.slice(KW_PREFIX.length);
    return keywords.find((k) => k.keyword === kw) || { keyword: kw };
  }, [activeId, keywords]);

  const activeList = useMemo(() => {
    if (!activeId.startsWith(LIST_PREFIX)) return null;
    const id = activeId.slice(LIST_PREFIX.length);
    return lists.find((l) => l.id === id) || null;
  }, [activeId, lists]);

  const filteredKeywords = useMemo(() => {
    const q = sideSearch.trim().toLowerCase();
    if (!q) return keywords;
    return keywords.filter((k) => `${k.keyword || ""}`.toLowerCase().includes(q));
  }, [keywords, sideSearch]);

  const filteredLists = useMemo(() => {
    const q = sideSearch.trim().toLowerCase();
    if (!q) return lists;
    return lists.filter((l) => `${l.name || ""}`.toLowerCase().includes(q));
  }, [lists, sideSearch]);

  const resolveSourceKeyword = useCallback(
    (id = activeId) => {
      if (!id?.startsWith(KW_PREFIX)) return undefined;
      return id.slice(KW_PREFIX.length) || undefined;
    },
    [activeId],
  );

  const load = useCallback(
    (p = 1, overrideId) => {
      const id = overrideId ?? activeId;
      const sourceKw = resolveSourceKeyword(id);
      const listId = id?.startsWith(LIST_PREFIX) ? id.slice(LIST_PREFIX.length) : null;
      const list = listId ? lists.find((l) => l.id === listId) : null;

      const request = list?.pages
        ? Promise.resolve({ items: list.pages })
        : getScannedPages({
            page: p,
            page_size: pageSize,
            keyword: keyword.trim() || undefined,
            source_keyword: sourceKw,
            sort_by: "followers",
            sort_dir: "desc",
          });

      return request.then((data) => {
        let rows = data.items || [];
        let tot = data.total || 0;
        if (list?.pages) {
          const q = keyword.trim().toLowerCase();
          if (q) {
            rows = rows.filter((r) =>
              `${r.page_name || ""} ${r.page_key || ""} ${r.phone || ""} ${r.email || ""}`
                .toLowerCase()
                .includes(q),
            );
          }
          tot = rows.length;
          const start = (p - 1) * pageSize;
          rows = rows.slice(start, start + pageSize);
        }

        // Guard: backend cũ bỏ qua source_keyword → lọc client theo tag/từ khóa
        if (sourceKw && rows.length) {
          const norm = sourceKw.replace(/^#+/, "").toLowerCase();
          const matchRow = (r) => {
            const tags = pageTags(r).map((t) => t.replace(/^#+/, "").toLowerCase());
            const sks = (r.source_keywords || []).map((t) =>
              String(t).replace(/^#+/, "").toLowerCase(),
            );
            return (
              tags.includes(norm) ||
              sks.includes(norm) ||
              (r.source_keywords || []).includes(sourceKw)
            );
          };
          const hit = rows.filter(matchRow);
          // Chỉ coi là "chưa lọc" khi hầu hết dòng không khớp từ khóa đang chọn
          if (hit.length < rows.length && hit.length / rows.length < 0.9) {
            rows = hit;
            tot = hit.length;
          }
        }

        setItems(rows);
        setTotal(tot);
        setPage(p);
        setSelectedKeys([]);
      }).catch((err) => {
        toast.error(`Lỗi tải DS page: ${err.message}`);
      }).finally(() => {
        setLoading(false);
      });
    },
    [pageSize, keyword, activeId, lists, resolveSourceKeyword],
  );

  useEffect(() => {
    load(1, activeId);
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = (p = 1) => {
    setLoading(true);
    return load(p);
  };

  const selectSource = (id) => {
    if (id === activeId) return;
    setLoading(true);
    setActiveId(id);
  };

  const handleExport = () => {
    const rowsSrc = selectedKeys.length
      ? items.filter((r) => selectedKeys.includes(r.page_key))
      : items;
    if (!rowsSrc.length) {
      toast.warning("Không có dữ liệu để xuất.");
      return;
    }
    const headers = [
      "STT",
      "Tên Page",
      "Link",
      "Danh mục FB",
      "Tag / Từ khóa",
      "SĐT",
      "Email",
      "Website",
      "Địa chỉ",
      "Followers",
    ];
    const rows = rowsSrc.map((r, i) => [
      i + 1,
      r.page_name || "",
      r.page_url || "",
      cleanCategory(r.category),
      pageTags(r).join(", "),
      r.phone || "",
      r.email || "",
      r.website || "",
      r.address || "",
      r.follower_count ?? "",
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `danh_sach_page_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Đã xuất CSV.");
  };

  const handleCreateList = () => {
    const name = window.prompt("Tên danh mục mới?");
    if (!name?.trim()) return;
    const pages = selectedKeys.length
      ? items.filter((r) => selectedKeys.includes(r.page_key))
      : [];
    const entry = savePageList({ name: name.trim(), pages });
    selectSource(`${LIST_PREFIX}${entry.id}`);
    toast.success(`Đã tạo danh mục “${entry.name}”`);
  };

  const handleMoveToList = () => {
    if (!selectedKeys.length) return;
    const name = window.prompt("Chuyển vào danh mục (tên mới hoặc để trống = danh mục đang chọn)?");
    if (name === null) return;
    const pages = items.filter((r) => selectedKeys.includes(r.page_key));
    if (name.trim()) {
      savePageList({ name: name.trim(), pages });
    } else if (activeList) {
      const merged = [...(activeList.pages || [])];
      const seen = new Set(merged.map((p) => p.page_key));
      pages.forEach((p) => {
        if (!seen.has(p.page_key)) merged.push(p);
      });
      savePageList({ name: activeList.name, pages: merged });
    } else {
      toast.warning("Chọn danh mục đích hoặc nhập tên mới.");
      return;
    }
    toast.success("Đã cập nhật danh mục.");
  };

  const handleRefresh = async () => {
    await loadKeywords();
    reload(1);
  };

  const allSelected = items.length > 0 && selectedKeys.length === items.length;
  const detailTitle = activeKeyword?.keyword || activeList?.name || "Tất cả page";

  return (
    <div className="pb-8">
      <ListPageHeader
        title="Danh sách page quét"
        subtitle="Kho Fanpage đã quét — SĐT, email, website, địa chỉ."
        actionHref="/scanner/search"
        actionLabel="Quét thêm"
      />

      <MasterDetail
        side={
          <ListSidePanel
            title="Danh sách danh mục"
            totalLabel={`Đã tìm: ${keywords.length} từ khóa · ${lists.length} danh mục lưu`}
            search={sideSearch}
            onSearchChange={setSideSearch}
            searchPlaceholder="Tìm từ khóa / danh mục…"
            headerRight={
              <Button type="button" size="sm" className="h-7 gap-1 text-[10px]" onClick={handleCreateList}>
                <Plus className="size-3" /> Thêm
              </Button>
            }
          >
            <SideListItem
              active={activeId === ALL_ID}
              onClick={() => selectSource(ALL_ID)}
              title="Tất cả page"
              subtitle="Kho quét toàn bộ"
              badge={activeId === ALL_ID && total > 0 ? total.toLocaleString("vi-VN") : undefined}
            />

            {filteredKeywords.length > 0 ? (
              <p className="px-2.5 pb-1 pt-2 text-[9px] font-bold uppercase tracking-wide text-slate-400">
                Từ khóa đã tìm
              </p>
            ) : null}
            {filteredKeywords.map((k) => (
              <SideListItem
                key={`kw-${k.keyword}`}
                active={activeId === `${KW_PREFIX}${k.keyword}`}
                onClick={() => selectSource(`${KW_PREFIX}${k.keyword}`)}
                title={k.keyword}
                subtitle={
                  k.source_type === "HASHTAG"
                    ? `${k.session_count || 1} phiên hashtag`
                    : `${k.session_count || 1} phiên tìm kiếm`
                }
                badge={(k.page_count || 0).toLocaleString("vi-VN")}
                avatar={
                  <div
                    className={`flex size-8 items-center justify-center rounded-md ${
                      k.source_type === "HASHTAG" ? "bg-violet-50 text-violet-600" : "bg-sky-50 text-sky-600"
                    }`}
                  >
                    {k.source_type === "HASHTAG" ? <Hash className="size-3.5" /> : <Search className="size-3.5" />}
                  </div>
                }
              />
            ))}

            {filteredLists.length > 0 ? (
              <p className="px-2.5 pb-1 pt-2 text-[9px] font-bold uppercase tracking-wide text-slate-400">
                Danh mục đã lưu
              </p>
            ) : null}
            {filteredLists.map((l) => (
              <SideListItem
                key={l.id}
                active={activeId === `${LIST_PREFIX}${l.id}`}
                onClick={() => selectSource(`${LIST_PREFIX}${l.id}`)}
                title={l.name}
                subtitle={`${l.count || l.pages?.length || 0} page`}
                badge={(l.count || l.pages?.length || 0).toLocaleString("vi-VN")}
              />
            ))}

            {!filteredKeywords.length && !filteredLists.length && sideSearch ? (
              <p className="px-2 py-6 text-center text-[11px] text-slate-400">Không khớp từ khóa / danh mục.</p>
            ) : null}
            {!keywords.length && !lists.length && !sideSearch ? (
              <p className="px-2 py-4 text-center text-[11px] text-slate-400">
                Chưa có từ khóa — chạy Quét thông tin page trước.
              </p>
            ) : null}
          </ListSidePanel>
        }
      >
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="font-heading text-sm font-bold text-slate-800">{detailTitle}</h2>
              <p className="mt-0.5 text-[11px] text-slate-400">
                {Number(total).toLocaleString("vi-VN")} Page
                {activeKeyword ? " theo từ khóa" : activeList ? " trong danh mục" : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-[11px]" onClick={handleRefresh}>
                <RefreshCw className="size-3.5" /> Làm mới
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 border-emerald-200 bg-emerald-50 text-[11px] text-emerald-700"
                onClick={handleExport}
              >
                <Download className="size-3.5" /> Xuất file
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 px-5 py-3">
            <div className="relative min-w-[220px] flex-1">
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && reload(1)}
                placeholder="Tìm theo Tên Page, ID Page, Số điện thoại hoặc Email…"
                className="h-9 text-[11px]"
              />
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => reload(1)}>
              Lọc
            </Button>
          </div>

          <div className="flex items-center gap-3 px-5 pb-2">
            <label className="inline-flex items-center gap-2 text-[11px] text-slate-600">
              <Checkbox checked={allSelected} onCheckedChange={(c) => setSelectedKeys(c ? items.map((r) => r.page_key) : [])} />
              Chọn tất cả
            </label>
            {selectedKeys.length > 0 ? (
              <span className="text-[11px] text-slate-400">
                Đã chọn {selectedKeys.length} / {items.length} page
              </span>
            ) : null}
          </div>

          <div className="px-5">
            <SelectionBar count={selectedKeys.length} onExport={handleExport} onMoveCategory={handleMoveToList} />
          </div>

          <div className="overflow-auto">
            <table className="w-full min-w-[1280px] text-left text-[11px]">
              <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="w-10 px-4 py-3" />
                  <th className="w-12 px-3 py-3 font-semibold">STT</th>
                  <th className="px-3 py-3 font-semibold">TÊN PAGE</th>
                  <th className="px-3 py-3 font-semibold">LINK PAGE</th>
                  <th className="px-3 py-3 font-semibold">DANH MỤC FB</th>
                  <th className="px-3 py-3 font-semibold">TAG / TỪ KHÓA</th>
                  <th className="px-3 py-3 font-semibold">SỐ ĐIỆN THOẠI</th>
                  <th className="px-3 py-3 font-semibold">EMAIL</th>
                  <th className="px-3 py-3 font-semibold">WEBSITE</th>
                  <th className="px-3 py-3 font-semibold">VỊ TRÍ / ĐỊA CHỈ</th>
                  <th className="px-3 py-3 font-semibold">FOLLOWERS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <TableLoading colSpan={11} />
                ) : items.length === 0 ? (
                  <TableEmpty colSpan={11} message="Chưa có page — chạy Quét thông tin page trước." />
                ) : (
                  items.map((r, idx) => {
                    const selected = selectedKeys.includes(r.page_key);
                    const cat = cleanCategory(r.category);
                    const tags = pageTags(r);
                    return (
                      <tr key={r.page_key || r.id} className={selected ? "bg-blue-50/50" : "hover:bg-slate-50"}>
                        <td className="px-4 py-2.5">
                          <Checkbox
                            checked={selected}
                            onCheckedChange={(c) =>
                              setSelectedKeys((prev) =>
                                c ? [...prev, r.page_key] : prev.filter((k) => k !== r.page_key),
                              )
                            }
                          />
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-400">
                          {String((page - 1) * pageSize + idx + 1).padStart(2, "0")}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <Avatar className="size-8 border border-slate-200">
                              {r.avatar_url && <AvatarImage src={r.avatar_url} />}
                              <AvatarFallback className={AVATAR_COLORS[idx % AVATAR_COLORS.length]}>
                                {initialsOf(r.page_name || "FB")}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex min-w-0 items-center gap-1">
                              <span className="max-w-[160px] truncate font-semibold text-slate-800">
                                {r.page_name || "—"}
                              </span>
                              {r.is_verified === true && <BadgeCheck className="size-3.5 shrink-0 text-blue-500" />}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          {r.page_url ? (
                            <a
                              href={r.page_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex max-w-[180px] items-center gap-1 truncate text-primary hover:underline"
                            >
                              {String(r.page_url).replace(/^https?:\/\/(m\.|www\.)?facebook\.com\//, "fb.com/")}
                              <ExternalLink className="size-3 shrink-0" />
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">
                          {cat ? (
                            <span className="line-clamp-2 max-w-[140px]" title={cat}>
                              {cat}
                            </span>
                          ) : (
                            <span className="italic text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {tags.length ? (
                            <div className="flex max-w-[200px] flex-wrap gap-1">
                              {tags.slice(0, 4).map((t) => (
                                <span
                                  key={t}
                                  className="inline-flex rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700"
                                  title={t}
                                >
                                  {t.startsWith("#") ? t : t}
                                </span>
                              ))}
                              {tags.length > 4 ? (
                                <span className="text-[10px] text-slate-400">+{tags.length - 4}</span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="italic text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {r.phone ? (
                            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                              <Phone className="size-3" />
                              {r.phone}
                            </span>
                          ) : (
                            <span className="italic text-slate-300">Chưa cập nhật</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">
                          {r.email || <span className="italic text-slate-300">Chưa cập nhật</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          {r.website ? (
                            <a
                              href={r.website.startsWith("http") ? r.website : `https://${r.website}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-block max-w-[120px] truncate text-primary hover:underline"
                            >
                              {String(r.website).replace(/^https?:\/\//, "")}
                            </a>
                          ) : (
                            <span className="italic text-slate-300">Chưa cập nhật</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">
                          {r.address || <span className="italic text-slate-300">Chưa cập nhật</span>}
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-emerald-700">
                          {r.follower_count != null ? Number(r.follower_count).toLocaleString("vi-VN") : "—"}
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
