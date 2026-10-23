"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { REACTION_META, ReactionIcon } from "./ReactionIcons";
import { Avatar } from "./atoms";
import { getPostReactions, friendlyFbError } from "../service";

/**
 * Hộp thoại chi tiết cảm xúc, dựng theo hộp thoại của Facebook: hàng tab
 * "Tất cả / 👍 N / ❤️ N", bấm tab nào lọc loại đó.
 *
 * Danh sách người lấy từ cạnh /{post_id}/reactions. Facebook CHỈ trả về những
 * người mà app được phép nhìn thấy — đo trên dữ liệu thật: bài 2 lượt trả đủ
 * 2 người, nhưng bài 502 lượt trả mảng rỗng mà không báo lỗi gì.
 *
 * Nên khi không có ai, hộp thoại lùi về bảng đếm theo từng loại — vẫn đủ dùng,
 * đúng bằng giao diện trước đây.
 */

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-sky-500";

const formatCount = (n) => Number(n || 0).toLocaleString("vi-VN");

/**
 * Tỉ lệ dạng "94,2%" — luôn 1 chữ số thập phân cho đều mắt, bỏ phần thập phân
 * khi số vốn đã tròn (100%).
 *
 * Dưới 0,1% thì ghi "<0,1%" chứ không làm tròn thành "0,0%": 1 lượt trên 2.215
 * là 0,045%, hiện "0,0%" khiến người đọc tưởng bằng không.
 */
const formatPercent = (part, whole) => {
  if (!whole || !part) return "0%";
  const pct = (part / whole) * 100;
  if (pct < 0.1) return "<0,1%";
  if (Number.isInteger(pct)) return `${pct}%`;
  return `${pct.toFixed(1).replace(".", ",")}%`;
};

/** Một người trong danh sách, huy hiệu loại cảm xúc đeo ở góc avatar */
function PersonRow({ person }) {
  const isSelf = Boolean(person?.__self);
  const name = person?.name || "Người dùng";
  const kind = String(person?.type || "").toLowerCase();
  // Dùng luôn ảnh Graph trả về, kể cả khi đó là hình bóng xám mặc định
  // (`is_silhouette`) — giống Facebook, và đồng bộ với danh sách bình luận.
  const src = person?.picture?.data?.url;

  return (
    <li className="flex items-center gap-2.5 py-1.5">
      <span className="relative shrink-0">
        <Avatar src={src} name={name} size={36} className="text-sm" />
        {REACTION_META[kind] && (
          <ReactionIcon
            type={kind}
            size={17}
            ring
            className="absolute -bottom-0.5 -right-0.5"
          />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">
        {name}
      </span>
    </li>
  );
}

/** Bảng đếm theo từng loại — dùng khi Facebook không trả về ai */
function CountBars({ ranked, base }) {
  return (
    <ul className="flex flex-col gap-3.5">
      {ranked.map(([key, n]) => (
        <li key={key}>
          <div className="flex items-center gap-2.5">
            <ReactionIcon type={key} size={22} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">
              {REACTION_META[key].label}
            </span>
            <span className="shrink-0 text-sm font-bold text-slate-900">{formatCount(n)}</span>
            <span className="w-12 shrink-0 text-right text-xs text-slate-400">
              {formatPercent(n, base)}
            </span>
          </div>
          {/* Thanh đo trên tổng số, khớp đúng con số phần trăm bên cạnh.
              minWidth giữ cho loại chỉ vài lượt vẫn nhìn thấy, mà không
              phóng đại tỉ lệ như cách lấy mốc là loại nhiều nhất. */}
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full"
              style={{ width: `${(n / base) * 100}%`, minWidth: 3, background: REACTION_META[key].bg }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function ReactionDialog({ postId, pageId, breakdown, total, viewer, onClose }) {
  const [tab, setTab] = useState("all");
  // Trạng thái tải suy ra từ việc dữ liệu đã khớp tab hiện tại chưa, thay vì
  // set cờ loading trong thân effect (react-compiler cấm).
  // `hasMore` lấy từ `paging.next` chứ KHÔNG từ `paging.cursors.after`:
  // Facebook vẫn trả `after` ở trang cuối, nên dựa vào nó thì nút "Xem thêm"
  // không bao giờ tắt. `next` chỉ có khi thật sự còn trang sau.
  const [fetched, setFetched] = useState({
    forTab: null, people: [], after: null, hasMore: false, error: "",
  });
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!postId || !pageId) return undefined;
    let alive = true;
    getPostReactions(postId, pageId, { type: tab })
      .then((res) => {
        if (!alive) return;
        setFetched({
          forTab: tab,
          people: Array.isArray(res?.data) ? res.data : [],
          after: res?.paging?.cursors?.after || null,
          hasMore: Boolean(res?.paging?.next),
          error: "",
        });
      })
      .catch((err) => {
        if (alive) {
          setFetched({
            forTab: tab, people: [], after: null, hasMore: false,
            error: friendlyFbError(err?.message),
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [postId, pageId, tab]);

  const ranked = Object.entries(breakdown || {})
    .filter(([key, n]) => REACTION_META[key] && n > 0)
    .sort((a, b) => b[1] - a[1]);

  // `total` có thể lớn hơn tổng các loại: ngoài 7 loại quen thuộc, enum còn
  // THANKFUL, PRIDE, FIRE, HUNDRED — mấy loại dịp lễ mình không hỏi tới.
  const sum = ranked.reduce((acc, [, n]) => acc + n, 0);
  const base = Math.max(total || 0, sum) || 1;

  const loading = Boolean(postId && pageId) && fetched.forTab !== tab;

  /**
   * Facebook ĐẾM lượt của chính Page nhưng KHÔNG liệt kê nó trong /reactions
   * — đo thực tế: summary=5 mà data chỉ có 4 người. Mình biết chắc Page đã
   * thả gì qua `viewer_reaction`, nên tự chèn vào để danh sách khớp với con số.
   */
  const people = useMemo(() => {
    const list = fetched.forTab === tab ? fetched.people : [];
    if (!viewer) return list;
    if (tab !== "all" && tab !== viewer.type) return list;
    if (list.some((x) => String(x.id) === String(viewer.id))) return list;
    return [
      {
        __self: true,
        id: viewer.id,
        name: viewer.name,
        type: viewer.type,
        picture: { data: { url: viewer.avatar } },
      },
      ...list,
    ];
  }, [fetched, tab, viewer]);

  const loadMore = () => {
    if (loadingMore || !fetched.hasMore || !fetched.after) return;
    setLoadingMore(true);
    getPostReactions(postId, pageId, { type: tab, after: fetched.after })
      .then((res) => {
        const fresh = Array.isArray(res?.data) ? res.data : [];
        setFetched((prev) => {
          const seen = new Set(prev.people.map((x) => x.id));
          return {
            ...prev,
            people: [...prev.people, ...fresh.filter((x) => !seen.has(x.id))],
            after: res?.paging?.cursors?.after || null,
            hasMore: Boolean(res?.paging?.next),
          };
        });
      })
      .finally(() => setLoadingMore(false));
  };

  const tabs = [["all", null], ...ranked];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" aria-hidden="true" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Chi tiết cảm xúc"
        className="relative flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-200 pl-4 pr-3 pt-3">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {tabs.map(([key, n]) => {
              const active = tab === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  aria-pressed={active}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 pb-2.5 pt-1 text-sm transition-colors",
                    active
                      ? "border-blue-600 font-bold text-blue-600"
                      : "border-transparent text-slate-500 hover:text-slate-800",
                    FOCUS,
                  )}
                >
                  {key === "all" ? (
                    <>Tất cả<span className="font-normal">{formatCount(total)}</span></>
                  ) : (
                    <>
                      <ReactionIcon type={key} size={18} />
                      {formatCount(n)}
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className={cn("mt-0.5 shrink-0 rounded-full p-1.5 text-slate-500 hover:bg-slate-100", FOCUS)}
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
              <Loader2 className="size-4 animate-spin" />
              Đang tải…
            </p>
          ) : people.length > 0 ? (
            <>
              <ul className="flex flex-col">
                {people.map((x) => (
                  <PersonRow key={x.id} person={x} />
                ))}
              </ul>
              {fetched.hasMore && (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className={cn(
                    "mt-2 w-full rounded-lg py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60",
                    FOCUS,
                  )}
                >
                  {loadingMore ? "Đang tải…" : "Xem thêm"}
                </button>
              )}
            </>
          ) : ranked.length > 0 ? (
            <>
              <CountBars ranked={tab === "all" ? ranked : ranked.filter(([k]) => k === tab)} base={base} />
              <p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-4 text-slate-400">
                Facebook không cho biết những ai đã thả cảm xúc ở bài này.
              </p>
            </>
          ) : (
            <p className="py-8 text-center text-sm text-slate-400">
              {fetched.error || (total > 0 ? "Không lấy được chi tiết cảm xúc." : "Chưa có ai bày tỏ cảm xúc.")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
