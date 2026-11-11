"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GiphyFetch } from "@giphy/js-fetch-api";
import { cn } from "@/lib/utils";

/**
 * Bảng chọn Sticker / GIF lấy từ Giphy.
 *
 * Vì sao dùng Giphy: Graph API không cho Page gửi sticker của Facebook theo id,
 * nhưng cho gửi ảnh qua URL công khai. URL của Giphy nằm sẵn trên Internet nên
 * Facebook tải được ngay — không cần tunnel/ngrok như file mình tự upload.
 *
 *  - kind: "stickers" (nền trong suốt) hoặc "gifs"
 *  - onPick(url): trả về URL ảnh đã chọn để gửi đi
 */

const DEFAULT_GIPHY_KEY = "Buzga2KS4vdI4PyaGh2NWs4PxwZZyyYc";
const GIPHY_KEY = process.env.NEXT_PUBLIC_GIPHY_KEY || DEFAULT_GIPHY_KEY;
const PAGE_SIZE = 24;
const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-sky-500";

// Chỉ khởi tạo khi có key, tránh thư viện ném lỗi lúc dựng component
const gf = GIPHY_KEY ? new GiphyFetch(GIPHY_KEY) : null;

export default function GiphyPicker({ kind = "stickers", onPick }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const reqRef = useRef(0);

  const load = useCallback(
    async (q) => {
      if (!gf) return;
      const id = ++reqRef.current;
      setLoading(true);
      setError("");
      try {
        const res = q.trim()
          ? await gf.search(q.trim(), { type: kind, limit: PAGE_SIZE, rating: "pg" })
          : await gf.trending({ type: kind, limit: PAGE_SIZE, rating: "pg" });
        if (id !== reqRef.current) return; // đã có yêu cầu mới hơn
        setItems(res?.data || []);
      } catch {
        if (id === reqRef.current) setError("Không tải được dữ liệu từ Giphy. Kiểm tra kết nối rồi thử lại.");
      } finally {
        if (id === reqRef.current) setLoading(false);
      }
    },
    [kind],
  );

  // Mở bảng -> tải mục thịnh hành; gõ tìm kiếm thì chờ 350ms mới gọi
  useEffect(() => {
    const timer = setTimeout(() => load(query), query ? 350 : 0);
    return () => clearTimeout(timer);
  }, [query, load]);

  if (!GIPHY_KEY) {
    return (
      <p className="px-3 py-6 text-center text-xs leading-5 text-slate-500">
        Chưa cấu hình <span className="font-semibold">NEXT_PUBLIC_GIPHY_KEY</span>.
        <br />
        Thêm khoá Giphy vào <code>frontend/.env.local</code> rồi khởi động lại trang.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={kind === "stickers" ? "Tìm sticker..." : "Tìm GIF..."}
        aria-label={kind === "stickers" ? "Tìm sticker" : "Tìm GIF"}
        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 outline-none focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-100"
      />

      {error && <p className="px-1 text-[11px] leading-4 text-red-600">{error}</p>}

      <div className="h-56 overflow-y-auto">
        {loading && items.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-400">Đang tải...</p>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-400">Không tìm thấy kết quả.</p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {items.map((item) => {
              // fixed_width: bản nhẹ để xem trước; original: bản gửi đi cho nét
              const preview = item.images?.fixed_width_small?.url || item.images?.fixed_width?.url;
              const full = item.images?.original?.url || preview;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onPick(full)}
                  title={item.title || ""}
                  className={cn(
                    "aspect-square overflow-hidden rounded-lg bg-slate-100 transition-transform hover:scale-105",
                    FOCUS,
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- ảnh từ CDN Giphy, không qua loader của Next */}
                  <img src={preview} alt={item.title || "Sticker"} loading="lazy" className="size-full object-contain" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      <p className="px-1 text-[10px] leading-4 text-slate-400">Nội dung từ Giphy</p>
    </div>
  );
}
