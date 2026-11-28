"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  BadgeCheck,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  Hash,
  Search,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "@/lib/toast";
import { useActionLock } from "../shared/useActionLock";
import { saveCsvContent } from "../shared/saveFile.mjs";
import { askConfirm } from "../shared/askConfirm";
import { initialsOf } from "@/modules/module_07_group_spam/shared/components";
import { AVATAR_COLORS } from "@/modules/module_07_group_spam/shared/constants";
import {
  getScannedPages,
  getSearchKeywords,
  createPageList,
  deletePageList,
  savePagesToList,
  deleteScannedPages,
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
import { usePageLists } from "../shared/usePageLists";
import SavePageListModal from "../shared/SavePageListModal";
import { runDelete, notifyExportResult } from "../_shared";
import { matchesInfoFilter, matchesRegion, VN_PROVINCES_34 } from "../utils.mjs";
import CreateCategoryModal from "@/modules/module_10_group_scan/member-list/_components/CreateCategoryModal";

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
  // Khoá nút xuất file trong lúc xử lý (bấm liên tục chỉ xuất / báo 1 lần)
  const [isExporting, guardExport] = useActionLock();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState([]);

  const [keywords, setKeywords] = useState([]);
  const { lists } = usePageLists();
  const [moveKeys, setMoveKeys] = useState(null); // != null → mở modal "Chuyển vào danh mục"
  const [createOpen, setCreateOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [creating, setCreating] = useState(false);
  const [sideSearch, setSideSearch] = useState("");
  const [activeId, setActiveId] = useState(ALL_ID);
  const [infoFilter, setInfoFilter] = useState("ALL");
  const [regionFilter, setRegionFilter] = useState("ALL");
  const [allPagesTotal, setAllPagesTotal] = useState(null);
  const reqSeqRef = useRef(0);
  const searchTimerRef = useRef(null);
  const mountedRef = useRef(false);
  const skipNextKeywordEffectRef = useRef(false);

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
    return lists.find((l) => String(l.id) === id) || { id: Number(id), name: "Danh mục" };
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

  const buildQueryParams = useCallback(
    (p = 1, overrides = {}) => {
      const id = overrides.id ?? activeId;
      const kw = (overrides.keyword ?? keyword).trim();
      const info = overrides.infoFilter ?? infoFilter;
      const reg = overrides.regionFilter ?? regionFilter;
      const sourceKw = resolveSourceKeyword(id);
      const listId = id?.startsWith(LIST_PREFIX) ? Number(id.slice(LIST_PREFIX.length)) : null;

      return {
        id,
        sourceKw,
        kw,
        info,
        reg,
        params: {
          page: p,
          page_size: overrides.pageSize ?? pageSize,
          keyword: kw || undefined,
          source_keyword: sourceKw,
          list_id: Number.isFinite(listId) ? listId : undefined,
          info_filter: info !== "ALL" ? info : undefined,
          region: reg !== "ALL" ? reg : undefined,
          sort_by: "followers",
          sort_dir: "desc",
        },
      };
    },
    [pageSize, keyword, activeId, infoFilter, regionFilter, resolveSourceKeyword],
  );

  const load = useCallback(
    (p = 1, overrides = {}) => {
      const { id, sourceKw, kw, info, reg, params } = buildQueryParams(p, overrides);
      const seq = ++reqSeqRef.current;

      return getScannedPages(params).then((data) => {
        if (seq !== reqSeqRef.current) return;
        let rows = data.items || [];
        let tot = Number(data.total) || 0;

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

        // Guard: nếu backend chưa restart để nhận info_filter / region → vẫn lọc đúng chuẩn trên client
        if (info !== "ALL" || reg !== "ALL") {
          const filtered = rows.filter((r) => matchesInfoFilter(r, info) && matchesRegion(r.address, reg));
          if (filtered.length < rows.length) {
            rows = filtered;
            if (tot === (data.items || []).length || tot <= pageSize) {
              tot = filtered.length;
            }
          }
        }

        setItems(rows);
        setTotal(tot);
        if (id === ALL_ID && !kw && info === "ALL" && reg === "ALL") {
          setAllPagesTotal(tot);
        }
        setPage(p);
        setSelectedKeys([]);
      }).catch((err) => {
        if (seq !== reqSeqRef.current) return;
        toast.error(`Lỗi tải DS page: ${err.message}`);
      }).finally(() => {
        if (seq === reqSeqRef.current) setLoading(false);
      });
    },
    [buildQueryParams, pageSize],
  );

  // Tự tải lại ngay khi đổi nguồn sidebar hoặc đổi dropdown Tình trạng / Khu vực
  useEffect(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    setLoading(true);
    load(1);
    mountedRef.current = true;
  }, [activeId, infoFilter, regionFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tự tìm kiếm tức thì khi gõ vào ô tìm kiếm (debounce 250ms, không cần nhấn Enter)
  useEffect(() => {
    if (!mountedRef.current) return undefined;
    if (skipNextKeywordEffectRef.current) {
      skipNextKeywordEffectRef.current = false;
      return undefined;
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      searchTimerRef.current = null;
      setLoading(true);
      load(1);
    }, 250);
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
        searchTimerRef.current = null;
      }
    };
  }, [keyword]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleResetFilters = () => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    const hadKeyword = Boolean(keyword);
    const hadDropdown = infoFilter !== "ALL" || regionFilter !== "ALL";
    if (!hadKeyword && !hadDropdown) return;
    if (hadKeyword) {
      skipNextKeywordEffectRef.current = true;
      setKeyword("");
    }
    if (hadDropdown) {
      setInfoFilter("ALL");
      setRegionFilter("ALL");
    } else {
      setLoading(true);
      load(1, { keyword: "", infoFilter: "ALL", regionFilter: "ALL" });
    }
  };

  const reload = (p = 1) => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    setLoading(true);
    return load(p);
  };

  const selectSource = (id) => {
    if (id === activeId) return;
    setLoading(true);
    setActiveId(id);
  };

  const handleExport = async () => {
    let rowsSrc = [];
    if (selectedKeys.length) {
      rowsSrc = filteredItems.filter((r) => selectedKeys.includes(r.page_key));
    } else if (total > filteredItems.length) {
      try {
        const batchSize = 1000;
        const collected = [];
        let p = 1;
        let expected = total;
        while (collected.length < expected && p <= 20) {
          const { params, info, reg } = buildQueryParams(p, { pageSize: batchSize });
          const data = await getScannedPages(params);
          const chunk = (data.items || []).filter(
            (r) => matchesInfoFilter(r, info) && matchesRegion(r.address, reg),
          );
          collected.push(...chunk);
          expected = Number(data.total) || collected.length;
          if ((data.items || []).length < batchSize) break;
          p += 1;
        }
        rowsSrc = collected;
      } catch (err) {
        toast.error(`Lỗi tải dữ liệu xuất Excel: ${err?.message || "Không tải được danh sách."}`, {
          key: "m11-list-pages-export",
        });
        return;
      }
    } else {
      rowsSrc = filteredItems;
    }
    if (!rowsSrc.length) {
      toast.warning("Không có dữ liệu để xuất.", { key: "m11-list-pages-export" });
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
    try {
      const res = await saveCsvContent(csv, `danh_sach_page_${new Date().toISOString().slice(0, 10)}.csv`);
      notifyExportResult(res, {
        successMessage: `Đã xuất ${rowsSrc.length.toLocaleString("vi-VN")} page ra file "${res.fileName}".`,
        key: "m11-list-pages-export",
      });
    } catch (err) {
      toast.error(`Lỗi xuất CSV: ${err?.message || "Không lưu được file."}`, { key: "m11-list-pages-export" });
    }
  };

  const openCreateList = () => {
    setNewListName("");
    setCreateOpen(true);
  };

  const handleCreateList = async (e) => {
    e.preventDefault();
    const name = newListName.trim();
    if (creating) return;
    if (!name) {
      toast.error("Vui lòng nhập tên danh mục.");
      return;
    }
    setCreating(true);
    try {
      const cat = await createPageList(name);
      if (selectedKeys.length) {
        await savePagesToList({ categoryId: cat.id, pageKeys: selectedKeys });
      }
      selectSource(`${LIST_PREFIX}${cat.id}`);
      toast.success(cat.created ? `Đã tạo danh mục “${cat.name}”` : `Danh mục “${cat.name}” đã có — đã mở danh mục này.`);
      setCreateOpen(false);
    } catch (err) {
      toast.error(`Lỗi tạo danh mục: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  /* "Chuyển vào danh mục": mở modal chọn / tạo danh mục cho các page đang tick */
  const handleMoveToList = () => {
    if (!selectedKeys.length) return;
    setMoveKeys([...selectedKeys]);
  };

  const handleMoved = (res) => {
    setSelectedKeys([]);
    if (activeList && res?.category?.id === activeList.id) reload(page);
  };

  const handleRefresh = async () => {
    await loadKeywords();
    reload(1);
  };

  const handleDeleteSelected = async () => {
    const n = await runDelete({
      count: selectedKeys.length,
      noun: "page",
      request: () => deleteScannedPages({ page_keys: selectedKeys }),
    });
    if (n == null) return;
    setSelectedKeys([]);
    await loadKeywords();
    reload(page);
  };

  const handleDeleteCategory = async () => {
    if (!activeList) {
      toast.info("Chọn một danh mục đã lưu ở cột trái để xóa.");
      return;
    }
    const ok = await askConfirm({
      title: "Xóa danh mục",
      description: `Xóa danh mục "${activeList.name}"? Các page trong kho vẫn giữ nguyên.`,
      confirmText: "Xóa danh mục",
    });
    if (!ok) return;
    try {
      await deletePageList(activeList.id);
      selectSource(ALL_ID);
      toast.success(`Đã xóa danh mục "${activeList.name}".`);
    } catch (err) {
      toast.error(`Lỗi xóa danh mục: ${err.message}`);
    }
  };

  const filteredItems = useMemo(() => {
    return items.filter(
      (r) => matchesInfoFilter(r, infoFilter) && matchesRegion(r.address, regionFilter),
    );
  }, [items, infoFilter, regionFilter]);

  const hasActiveFilter = Boolean(
    keyword.trim() || infoFilter !== "ALL" || regionFilter !== "ALL",
  );
  const allSelected = filteredItems.length > 0 && selectedKeys.length === filteredItems.length;
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
              <Button type="button" size="sm" className="h-7 gap-1 text-[10px]" onClick={openCreateList}>
                <Plus className="size-3" /> Thêm
              </Button>
            }
          >
            <SideListItem
              active={activeId === ALL_ID}
              onClick={() => selectSource(ALL_ID)}
              title="Tất cả page"
              subtitle="Kho quét toàn bộ"
              badge={
                allPagesTotal != null && allPagesTotal > 0
                  ? allPagesTotal.toLocaleString("vi-VN")
                  : activeId === ALL_ID && !hasActiveFilter && total > 0
                    ? total.toLocaleString("vi-VN")
                    : undefined
              }
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
                subtitle={`${(l.page_count || 0).toLocaleString("vi-VN")} page`}
                badge={(l.page_count || 0).toLocaleString("vi-VN")}
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

            <div className="pt-2">
              <button
                type="button"
                onClick={openCreateList}
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
              <h2 className="font-heading text-sm font-bold text-slate-800">{detailTitle}</h2>
              <p className="mt-0.5 text-[11px] text-slate-400">
                {hasActiveFilter ? "Khớp bộ lọc: " : "Tổng số Page đã lưu: "}
                <strong className="text-slate-700">{Number(total).toLocaleString("vi-VN")} Page</strong>
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
                className="h-8 gap-1.5 border-red-200 bg-red-50 text-[11px] text-red-600 hover:bg-red-100"
                onClick={handleDeleteCategory}
              >
                <Trash2 className="size-3.5" /> Xóa danh mục
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
            <select
              value={infoFilter}
              onChange={(e) => setInfoFilter(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-medium text-slate-700 outline-none"
            >
              <option value="ALL">Tình trạng: Tất cả thông tin</option>
              <option value="HAS_PHONE">Có Số điện thoại</option>
              <option value="HAS_EMAIL">Có Email</option>
              <option value="HAS_BOTH">Đầy đủ SĐT &amp; Email</option>
              <option value="HAS_WEBSITE">Có Website</option>
              <option value="NO_CONTACT">Chưa có SĐT &amp; Email</option>
            </select>
            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-medium text-slate-700 outline-none"
            >
              <option value="ALL">Khu vực: Toàn quốc</option>
              <optgroup label="Thành phố trực thuộc TW (6)">
                {VN_PROVINCES_34.cities.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Các tỉnh (28)">
                {VN_PROVINCES_34.provinces.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
              <option value="NO_ADDRESS">Chưa có địa chỉ</option>
            </select>
            {hasActiveFilter ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9 gap-1.5 text-[11px] text-slate-600 hover:text-slate-900"
                onClick={handleResetFilters}
              >
                <RotateCcw className="size-3.5" /> Xóa bộ lọc
              </Button>
            ) : null}
          </div>

          <div className="flex items-center gap-3 px-5 pb-2">
            <label className="inline-flex items-center gap-2 text-[11px] text-slate-600">
              <Checkbox checked={allSelected} onCheckedChange={(c) => setSelectedKeys(c ? filteredItems.map((r) => r.page_key) : [])} />
              Chọn tất cả
            </label>
            {selectedKeys.length > 0 ? (
              <span className="text-[11px] text-slate-400">
                Đã chọn {selectedKeys.length} / {filteredItems.length} page
              </span>
            ) : null}
          </div>

          <div className="px-5">
            <SelectionBar
              count={selectedKeys.length}
              onExport={() => guardExport(handleExport)}
              exportDisabled={isExporting}
              onMoveCategory={handleMoveToList}
              onDelete={handleDeleteSelected}
            />
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
                ) : filteredItems.length === 0 ? (
                  <TableEmpty
                    colSpan={11}
                    message={
                      hasActiveFilter
                        ? "Không tìm thấy page phù hợp với bộ lọc."
                        : "Chưa có page — chạy Quét thông tin page trước."
                    }
                  />
                ) : (
                  filteredItems.map((r, idx) => {
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
                            <div className="min-w-0">
                              <div className="flex items-center gap-1">
                                <span className="max-w-[160px] truncate font-semibold text-slate-800">
                                  {r.page_name || "—"}
                                </span>
                                {r.is_verified === true && <BadgeCheck className="size-3.5 shrink-0 text-blue-500" />}
                              </div>
                              <div className="font-mono text-[10px] text-slate-400">
                                UID: {String(r.page_key || r.id || "").replace(/^id:|^user:/, "")}
                              </div>
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

      <CreateCategoryModal
        open={createOpen}
        onClose={() => {
          if (!creating) setCreateOpen(false);
        }}
        categoryName={newListName}
        onCategoryNameChange={setNewListName}
        onSubmit={handleCreateList}
        title="Thêm mới danh mục Page"
        label="Tên danh mục Page"
        placeholder="Ví dụ: Mỹ phẩm Hà Nội..."
        maxLength={255}
        busy={creating}
      />

      <SavePageListModal
        isOpen={moveKeys !== null}
        onClose={() => setMoveKeys(null)}
        pageKeys={moveKeys || []}
        onSaved={handleMoved}
      />
    </div>
  );
}
