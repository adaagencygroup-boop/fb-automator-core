"use client";

import { cn } from "@/lib/utils";

/**
 * Biểu tượng cảm xúc kiểu Facebook, dùng chung cho dòng tóm tắt dưới bài viết
 * và hộp thoại "ai đã thả cảm xúc gì".
 *
 * Thích và Yêu thích vẽ hình trắng đặc trên nền màu — emoji ❤️ vốn đỏ nên đặt
 * lên nền đỏ là mất hút. Các cảm xúc còn lại vốn đã là mặt vàng tròn, dùng
 * thẳng emoji trên nền cùng tông là ra đúng hình của Facebook.
 */

const ThumbGlyph = ({ size }) => (
  <svg viewBox="0 0 24 24" fill="#fff" width={size} height={size} aria-hidden="true">
    <path d="M6.5 10.1v10H4a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2h2.5Z" />
    <path d="M14.2 2c1.5 0 2.7 1.4 2.4 2.9l-.6 3.3h3.1c1.9 0 3.3 1.7 2.9 3.5l-1.1 5.9a3 3 0 0 1-2.9 2.4H9.4A1.4 1.4 0 0 1 8 18.7v-8.5c0-.3.1-.6.2-.8l4-6.4c.4-.6 1.1-1 1.9-1Z" />
  </svg>
);

const HeartGlyph = ({ size }) => (
  <svg viewBox="0 0 24 24" fill="#fff" width={size} height={size} aria-hidden="true">
    <path d="M12 20.8 4.2 13c-2-2-2-5.2 0-7.2s5.2-2 7.2 0l.6.6.6-.6c2-2 5.2-2 7.2 0s2 5.2 0 7.2z" />
  </svg>
);

/* Khoá khớp enum thật của cạnh /reactions: LIKE, LOVE, CARE, HAHA, WOW, SAD, ANGRY.
   Lưu ý là SAD chứ không phải SORRY, và CARE có thật — tài liệu của Meta ghi
   ngược cả hai điểm này. Xem ghi chú ở facebook_posts.py. */
export const REACTION_META = {
  like: { label: "Thích", bg: "#0866FF", Glyph: ThumbGlyph },
  love: { label: "Yêu thích", bg: "#F33E58", Glyph: HeartGlyph },
  care: { label: "Thương thương", bg: "#F7B125", emoji: "🥰" },
  haha: { label: "Haha", bg: "#F7B125", emoji: "😆" },
  wow: { label: "Wow", bg: "#F7B125", emoji: "😮" },
  sad: { label: "Buồn", bg: "#F7B125", emoji: "😢" },
  angry: { label: "Phẫn nộ", bg: "#E9710F", emoji: "😡" },
};

/** Một biểu tượng tròn; `ring` dùng khi xếp chồng để tách khỏi cái phía sau */
export function ReactionIcon({ type, size = 18, ring = false, className, style }) {
  const meta = REACTION_META[type];
  if (!meta) return null;
  return (
    <span
      aria-hidden="true"
      style={{ background: meta.bg, width: size, height: size, ...style }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full leading-none",
        ring && "ring-[1.5px] ring-white",
        className,
      )}
    >
      {meta.Glyph ? (
        <meta.Glyph size={Math.round(size * 0.58)} />
      ) : (
        <span style={{ fontSize: Math.round(size * 0.72) }}>{meta.emoji}</span>
      )}
    </span>
  );
}
