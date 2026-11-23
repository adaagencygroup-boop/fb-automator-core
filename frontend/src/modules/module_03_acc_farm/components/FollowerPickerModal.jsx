"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, RefreshCw, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/modules/module_07_group_spam/shared/components";
import { AVATAR_COLORS } from "@/modules/module_07_group_spam/shared/constants";
import {
  Checkbox,
  ListPagination,
  ListSidePanel,
  MasterDetail,
  SideListItem,
  TableEmpty,
  TableLoading,
} from "@/modules/module_11_page_scanner/_listLayout";
import { getPageFollowers, getPagesWithFollowers } from "@/modules/module_11_page_scanner/service";
import { getPickerGroupCategories, getPickerGroupMembers, pickerErrorMessage } from "../service";
import { parseFbLink } from "./ScenarioConfig";

const ALL_ID = "__all__";
const PAGE_SIZE = 10;
const NUMERIC_UID = /^\d{5,20}$/;

const TABS = [
  { id: "followers", label: "Người theo dõi Page", source: "Quét page → Danh sách followers" },
  { id: "members", label: "Thành viên nhóm", source: "Quét nhóm → Danh sách thành viên" },
];

/**
 * Link trang cá nhân dùng được cho Kết bạn theo link; null với dòng Module 11 lấy nhầm (ảnh bìa, link ra ngoài, link
 * của chính fanpage đang quét — thấy khi quét thật 2026-11-09).
 */
function followerLink(row) {
  const url = String(row?.profile_url || "").trim();
  const link = parseFbLink(url);
  if (link?.kind !== "friend") return null;
  const pageKey = String(row?.page_key || "").trim().toLowerCase();
  if (pageKey && (link.key === `user:${pageKey}` || link.key === `id:${pageKey.replace(/^id:/, "")}`)) return null;
  return { key: link.key, url };
}

/** Thành viên nhóm Module 10: có UID số thì dùng facebook.com/<uid> (chuẩn hơn link username), không thì profile_url */
function memberLink(row) {
  const uid = String(row?.uid || "").trim();
  const url = NUMERIC_UID.test(uid) ? `https://www.facebook.com/${uid}` : String(row?.profile_url || "").trim();
  const link = parseFbLink(url);
  return link?.kind === "friend" ? { key: link.key, url } : null;
}

const shortLink = (url) => url.replace(/^https?:\/\/(m\.|www\.|web\.|mbasic\.)?facebook\.com\//, "fb.com/").slice(0, 32);
const fmt = (n) => Number(n || 0).toLocaleString("vi-VN");

/** Dữ liệu 1 trang của bảng bên phải: giữ dòng cũ khi đang tải trang khác để bảng không co lại */
function usePagedList(fetchPage, errorModule) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    (p, filters) => {
      setLoading(true);
      fetchPage(p, filters)
        .then(({ items: list, total: count }) => {
          setItems(list);
          setTotal(count);
          setPage(p);
          setError("");
        })
        .catch((err) => setError(pickerErrorMessage(err, errorModule)))
        .finally(() => setLoading(false));
    },
    [fetchPage, errorModule],
  );
  return { items, total, page, loading, error, load };
}

/** Bảng chọn người dùng chung cho 2 tab: cột tick + STT + tên, các cột còn lại do tab truyền vào */
function PeopleTable({ rows, list, selected, onToggle, onToggleAll, columns, emptyText }) {
  const { loading, error, page, items } = list;
  const selectable = rows.filter((r) => r.link);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.link.key));
  const colSpan = columns.length + 3;
  return (
    // Giữ chỗ đủ 1 trang (10 dòng): ít người thì thanh phân trang không bị kéo lên
    <div className="min-h-[585px] overflow-auto">
      <table className="w-full min-w-[760px] text-left text-[11px]">
        <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500">
          <tr className="border-b border-slate-200">
            <th className="w-10 px-4 py-3">
              <Checkbox checked={allSelected} disabled={!selectable.length} onCheckedChange={(c) => onToggleAll(selectable, Boolean(c))} />
            </th>
            <th className="w-12 px-3 py-3 font-semibold">STT</th>
            <th className="px-3 py-3 font-semibold">HỌ VÀ TÊN</th>
            {columns.map((c) => (
              <th key={c.title} className="px-3 py-3 font-semibold">{c.title}</th>
            ))}
          </tr>
        </thead>
        <tbody className={`divide-y divide-slate-100 transition-opacity ${loading && items.length ? "pointer-events-none opacity-50" : ""}`}>
          {loading && !items.length ? (
            <TableLoading colSpan={colSpan} />
          ) : error ? (
            <TableEmpty colSpan={colSpan} message={error} />
          ) : rows.length === 0 ? (
            <TableEmpty colSpan={colSpan} message={emptyText} />
          ) : (
            rows.map(({ row, link, name, rowKey }, idx) => {
              const on = Boolean(link && selected.has(link.key));
              return (
                <tr
                  key={rowKey}
                  onClick={(e) => link && !e.target.closest("a") && onToggle(link, !on)}
                  className={on ? "cursor-pointer bg-blue-50/50" : link ? "cursor-pointer hover:bg-slate-50" : "opacity-50"}
                >
                  {/* Bấm cả dòng là chọn; ô tick tự xử lý, không để dòng chọn lần nữa */}
                  <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={on} disabled={!link} onCheckedChange={(c) => link && onToggle(link, Boolean(c))} />
                  </td>
                  <td className="px-3 py-2.5 font-mono text-slate-400">{String((page - 1) * PAGE_SIZE + idx + 1).padStart(2, "0")}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar className="size-7">
                        <AvatarFallback className={AVATAR_COLORS[idx % AVATAR_COLORS.length]}>{initialsOf(name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-800">{name}</div>
                        {!link && <div className="text-[10px] text-rose-500">Không phải link trang cá nhân, không chọn được</div>}
                      </div>
                    </div>
                  </td>
                  {columns.map((c) => (
                    <td key={c.title} className="px-3 py-2.5 text-slate-600">{c.render(row)}</td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

const profileCell = (row) =>
  row.profile_url ? (
    <a href={row.profile_url} target="_blank" rel="noreferrer" className="inline-flex max-w-[220px] truncate font-medium text-primary hover:underline">
      {shortLink(row.profile_url)}
    </a>
  ) : (
    "—"
  );

/** Khung bảng bên phải: tiêu đề + tổng + Làm mới + ô tìm + bảng + phân trang */
function TableCard({ title, list, keyword, setKeyword, onSearch, onRefresh, children, onPageChange }) {
  return (
    <Card className="overflow-hidden border-slate-200 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="font-heading text-sm font-bold text-slate-800">{title}</h3>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Tổng: <strong className="text-slate-700">{fmt(list.total)} người</strong>
            {list.loading && list.items.length > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-primary">
                <Loader2 className="size-3 animate-spin" /> Đang tải…
              </span>
            )}
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-[11px]" onClick={onRefresh}>
          <RefreshCw className="size-3.5" /> Làm mới
        </Button>
      </div>
      <div className="px-5 py-3">
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSearch()}
          placeholder="Tìm theo UID, tên người dùng… (Enter để tìm)"
          className="h-9 text-[11px]"
        />
      </div>
      {children}
      <ListPagination page={list.page} pageSize={PAGE_SIZE} total={list.total} onPageChange={onPageChange} />
    </Card>
  );
}

// ── Tab 1: người theo dõi Fanpage (Module 11) ──

const fetchFollowers = (p, { side, word }) =>
  getPageFollowers({ page: p, page_size: PAGE_SIZE, keyword: word.trim() || undefined, page_key: side !== ALL_ID ? side : undefined }).then(
    (res) => ({ items: res?.items || [], total: res?.total || 0 }),
  );

const FOLLOWER_COLS = [
  { title: "UID FACEBOOK", render: (r) => <span className="font-mono">{String(r.follower_key || "").replace(/^id:|^user:/, "") || "—"}</span> },
  { title: "PROFILE LINK", render: profileCell },
  { title: "SỐ BẠN BÈ", render: (r) => (r.friend_count != null ? fmt(r.friend_count) : "—") },
  { title: "VỊ TRÍ", render: (r) => r.location || "—" },
];

function FollowersTab({ selected, onToggle, onToggleAll }) {
  const [pages, setPages] = useState([]);
  const [sideSearch, setSideSearch] = useState("");
  const [side, setSide] = useState(ALL_ID);
  const [keyword, setKeyword] = useState("");
  const list = usePagedList(fetchFollowers, "Quét page");
  const { load } = list;

  useEffect(() => {
    getPagesWithFollowers()
      .then((res) => setPages(res?.items || []))
      .catch(() => setPages([]));
    load(1, { side: ALL_ID, word: "" });
  }, [load]);

  const reload = (p, s = side) => load(p, { side: s, word: keyword });
  const selectSide = (key) => {
    if (key === side) return;
    setSide(key);
    reload(1, key);
  };
  const shownPages = useMemo(() => {
    const q = sideSearch.trim().toLowerCase();
    return q ? pages.filter((p) => `${p.page_name || ""} ${p.page_key || ""}`.toLowerCase().includes(q)) : pages;
  }, [pages, sideSearch]);
  const rows = useMemo(
    () =>
      list.items.map((r) => ({
        row: r,
        link: followerLink(r),
        name: r.follower_name || "Người dùng Facebook",
        rowKey: r.id || `${r.page_key}-${r.follower_key}`,
      })),
    [list.items],
  );
  const activePage = side === ALL_ID ? null : pages.find((p) => p.page_key === side);

  return (
    <MasterDetail
      side={
        <ListSidePanel title="Danh mục Page" totalLabel={`Tổng: ${pages.length} page`} search={sideSearch} onSearchChange={setSideSearch} searchPlaceholder="Tìm tên hoặc ID page…">
          <SideListItem active={side === ALL_ID} onClick={() => selectSide(ALL_ID)} title="Tất cả page" subtitle="Toàn bộ followers đã quét" />
          {shownPages.map((p, i) => (
            <SideListItem
              key={p.page_key}
              active={side === p.page_key}
              onClick={() => selectSide(p.page_key)}
              title={p.page_name || p.page_key}
              subtitle={`ID: ${String(p.page_key || "").replace(/^id:|^user:/, "")}`}
              badge={p.scanned_uid_count != null ? `${fmt(p.scanned_uid_count)} UID` : undefined}
              avatar={
                <Avatar className="size-8 border border-slate-200">
                  <AvatarFallback className={AVATAR_COLORS[i % AVATAR_COLORS.length]}>{initialsOf(p.page_name || "FB")}</AvatarFallback>
                </Avatar>
              }
            />
          ))}
          {!shownPages.length && sideSearch ? <p className="px-2 py-6 text-center text-[11px] text-slate-400">Không khớp page.</p> : null}
        </ListSidePanel>
      }
    >
      <TableCard
        title={activePage?.page_name || "Tất cả followers"}
        list={list}
        keyword={keyword}
        setKeyword={setKeyword}
        onSearch={() => reload(1)}
        onRefresh={() => reload(list.page)}
        onPageChange={(p) => reload(p)}
      >
        <PeopleTable
          rows={rows}
          list={list}
          selected={selected}
          onToggle={onToggle}
          onToggleAll={onToggleAll}
          columns={FOLLOWER_COLS}
          emptyText="Chưa có followers — chạy Quét followers ở mục Quét page."
        />
      </TableCard>
    </MasterDetail>
  );
}

// ── Tab 2: thành viên nhóm (Module 10) ──

const fetchMembers = (p, { side, word }) =>
  getPickerGroupMembers({ page: p, page_size: PAGE_SIZE, search: word.trim() || undefined, category_id: side !== ALL_ID ? side : undefined }).then(
    (res) => ({ items: res?.members || [], total: res?.total || 0 }),
  );

const ROLE_LABELS = { admin: "Quản trị viên", moderator: "Người kiểm duyệt", member: "Thành viên" };

const MEMBER_COLS = [
  { title: "UID FACEBOOK", render: (r) => <span className="font-mono">{r.uid || "—"}</span> },
  { title: "NHÓM", render: (r) => <span className="inline-block max-w-[200px] truncate align-bottom" title={r.group_name}>{r.group_name || "—"}</span> },
  { title: "PROFILE LINK", render: profileCell },
  { title: "VAI TRÒ", render: (r) => ROLE_LABELS[r.role] || r.role || "—" },
];

function MembersTab({ selected, onToggle, onToggleAll }) {
  const [categories, setCategories] = useState([]);
  const [sideSearch, setSideSearch] = useState("");
  const [side, setSide] = useState(ALL_ID);
  const [keyword, setKeyword] = useState("");
  const list = usePagedList(fetchMembers, "Quét nhóm");
  const { load } = list;

  useEffect(() => {
    getPickerGroupCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
    load(1, { side: ALL_ID, word: "" });
  }, [load]);

  const reload = (p, s = side) => load(p, { side: s, word: keyword });
  const selectSide = (id) => {
    if (id === side) return;
    setSide(id);
    reload(1, id);
  };
  const shownCats = useMemo(() => {
    const q = sideSearch.trim().toLowerCase();
    return q ? categories.filter((c) => String(c.name || "").toLowerCase().includes(q)) : categories;
  }, [categories, sideSearch]);
  // Cùng 1 người ở nhiều nhóm = nhiều dòng; lựa chọn theo người nên tick 1 dòng là các dòng kia cũng tick
  const rows = useMemo(
    () => list.items.map((r) => ({ row: r, link: memberLink(r), name: r.name || "Người dùng Facebook", rowKey: r.id || `${r.group_id}-${r.uid}` })),
    [list.items],
  );
  const activeCat = side === ALL_ID ? null : categories.find((c) => String(c.id) === String(side));

  return (
    <MasterDetail
      side={
        <ListSidePanel title="Danh mục nhóm" totalLabel={`Tổng: ${categories.length} danh mục`} search={sideSearch} onSearchChange={setSideSearch} searchPlaceholder="Tìm danh mục…">
          <SideListItem active={side === ALL_ID} onClick={() => selectSide(ALL_ID)} title="Tất cả nhóm" subtitle="Toàn bộ thành viên đã quét" />
          {shownCats.map((c, i) => (
            <SideListItem
              key={c.id}
              active={String(side) === String(c.id)}
              onClick={() => selectSide(c.id)}
              title={c.name}
              subtitle={`${fmt(c.count)} nhóm`}
              avatar={
                <Avatar className="size-8 border border-slate-200">
                  <AvatarFallback className={AVATAR_COLORS[i % AVATAR_COLORS.length]}>{initialsOf(c.name || "N")}</AvatarFallback>
                </Avatar>
              }
            />
          ))}
          {!shownCats.length && sideSearch ? <p className="px-2 py-6 text-center text-[11px] text-slate-400">Không khớp danh mục.</p> : null}
        </ListSidePanel>
      }
    >
      <TableCard
        title={activeCat?.name || "Tất cả thành viên"}
        list={list}
        keyword={keyword}
        setKeyword={setKeyword}
        onSearch={() => reload(1)}
        onRefresh={() => reload(list.page)}
        onPageChange={(p) => reload(p)}
      >
        <PeopleTable
          rows={rows}
          list={list}
          selected={selected}
          onToggle={onToggle}
          onToggleAll={onToggleAll}
          columns={MEMBER_COLS}
          emptyText="Chưa có thành viên — chạy Quét thành viên ở mục Quét nhóm."
        />
      </TableCard>
    </MasterDetail>
  );
}

/**
 * Chọn người cho ô Kết bạn theo link từ 2 nguồn đã quét: người theo dõi Fanpage (Module 11) và thành viên nhóm (Module 10).
 * Chỉ để chọn, không xóa / nhập file. Lựa chọn dùng chung cho 2 tab, giữ khi đổi tab / trang / danh mục.
 * initial: Map key người -> link đang có trong ô danh sách (tick sẵn); onConfirm(Map): toàn bộ lựa chọn sau khi xác nhận.
 * Hạn chế: cùng 1 người mà Module 11 lưu link username còn Module 10 lưu UID thì coi là 2 người.
 */
export default function FollowerPickerModal({ initial, onClose, onConfirm }) {
  const [tab, setTab] = useState(TABS[0].id);
  const [selected, setSelected] = useState(() => new Map(initial)); // key -> url

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const changed = selected.size !== initial.size || [...selected.keys()].some((key) => !initial.has(key));
  const onToggle = useCallback(
    (link, on) =>
      setSelected((prev) => {
        const next = new Map(prev);
        if (on) next.set(link.key, link.url);
        else next.delete(link.key);
        return next;
      }),
    [],
  );
  const onToggleAll = useCallback(
    (rows, on) =>
      setSelected((prev) => {
        const next = new Map(prev);
        rows.forEach(({ link }) => (on ? next.set(link.key, link.url) : next.delete(link.key)));
        return next;
      }),
    [],
  );
  const tabProps = { selected, onToggle, onToggleAll };
  const activeTab = TABS.find((t) => t.id === tab);

  return createPortal(
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Chiều cao cố định: đổi tab / trang có số dòng khác nhau thì hộp không co giãn, không nhảy */}
      <div role="dialog" aria-modal="true" aria-label="Chọn người từ danh sách quét" className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-6 pt-4">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900">Lấy từ danh sách quét</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Chọn người đã quét ({activeTab.source}) để thêm vào danh sách kết bạn theo link.
            </p>
            <div role="tablist" className="mt-3 flex gap-1">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "-mb-px border-b-2 px-3 py-2 text-xs font-semibold transition-colors",
                    tab === t.id ? "border-primary text-primary" : "border-transparent text-slate-500 hover:text-slate-800",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Giữ cả 2 tab trong cây (ẩn tab không xem): đổi tab không tải lại, không mất trang / bộ lọc đang xem */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div hidden={tab !== "followers"}>
            <FollowersTab {...tabProps} />
          </div>
          <div hidden={tab !== "members"}>
            <MembersTab {...tabProps} />
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 px-6 py-3">
          <span className="text-xs text-slate-500">
            Đã chọn <strong className="text-slate-800">{selected.size}</strong> người
            {selected.size > 0 && (
              <button type="button" onClick={() => setSelected(new Map())} className="ml-2 font-semibold text-primary hover:underline">
                Bỏ chọn
              </button>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Hủy
            </Button>
            <Button type="button" size="sm" disabled={!changed} onClick={() => onConfirm(selected)}>
              Xác nhận chọn {selected.size} người
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
