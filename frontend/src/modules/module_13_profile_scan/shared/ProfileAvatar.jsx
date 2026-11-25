"use client";

import React, { useState } from "react";
import { initialsOf } from "@/modules/module_07_group_spam/shared/components";

/** Ảnh đại diện; không có ảnh hoặc link ảnh hết hạn → chữ cái đầu của tên (hoặc children) */
export default function ProfileAvatar({ src, name, className = "size-8 rounded-full", tint = "bg-[#2563EB] text-white", children }) {
  const [broken, setBroken] = useState(null);
  if (src && broken !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" draggable={false} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(src)} className={`shrink-0 bg-[#F1F5F9] object-cover ${className}`} />
    );
  }
  return <span className={`flex shrink-0 items-center justify-center text-xs font-bold ${className} ${tint}`}>{children || initialsOf(name)}</span>;
}
