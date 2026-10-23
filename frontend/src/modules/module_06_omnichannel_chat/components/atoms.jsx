"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** Mấy mảnh nhỏ dùng chung giữa NotificationDetail và CommentThread */

// Màu avatar chữ cái (nền / chữ) — đồng bộ với NotificationList
const AVATAR_COLORS = [
  ["#E1EFFF", "#1877F2"],
  ["#E5EDF9", "#295BAC"],
  ["#E1F7EB", "#00875A"],
  ["#FCE6E8", "#D83A52"],
  ["#FAECE0", "#B85718"],
];

function avatarColor(name = "") {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

const initialOf = (name = "") => (name.trim()[0] || "?").toUpperCase();

export function Initial({ name, size = 32, className }) {
  const [bg, fg] = avatarColor(name);
  return (
    <span
      style={{ width: size, height: size, background: bg, color: fg }}
      className={cn("shrink-0 rounded-full flex items-center justify-center font-bold", className)}
      aria-hidden="true"
    >
      {initialOf(name)}
    </span>
  );
}

/**
 * Ảnh đại diện, lùi về chữ cái khi không có ảnh hoặc ảnh hỏng.
 *
 * Link ảnh của Facebook (platform-lookaside.fbsbx.com) có hạn dùng và hết thì
 * trả 403, nên bắt `onError` để không để lại ô vuông vỡ.
 */
export function Avatar({ src, name, size = 32, className }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) return <Initial name={name} size={size} className={className} />;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      style={{ width: size, height: size }}
      className={cn("shrink-0 rounded-full bg-slate-100 object-cover", className)}
    />
  );
}

/** Thời gian tương đối tiếng Việt (vd. "1 phút", "3 giờ", "2 ngày") */
export function relativeTime(iso) {
  if (!iso) return "";
  let s = String(iso).trim();
  if (!s.endsWith("Z") && !s.includes("+") && !s.includes("-", 11)) s += "Z";
  const then = new Date(s).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Vừa xong";
  if (mins < 60) return `${mins} phút`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày`;
  return new Date(then).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}
