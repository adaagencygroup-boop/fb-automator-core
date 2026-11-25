"use client";

// Huy hiệu "Mức tiềm năng" (cột QUAN TÂM) + hộp chú giải ở chân bảng.
// Figma có 3 mức tính cả Share, nhưng Facebook chỉ cho xem tổng số lượt chia sẻ (không biết ai chia sẻ) → còn 2 mức
// theo Like + Bình luận. Mức 1: xanh lá · Mức 2: vàng cam.

export const TIERS = {
  1: { label: "Mức 1 (Cao)", cls: "bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]" },
  2: { label: "Mức 2 (Cơ bản)", cls: "bg-[#FFFBEB] border-[#FDE68A] text-[#B45309]" },
};

export function TierBadge({ tier, title }) {
  const t = TIERS[tier] || TIERS[2];
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${t.cls}`}
    >
      {t.label}
    </span>
  );
}

/** Giải thích vì sao người này ở mức đó: đã Like / Bình luận trên bài. */
export function tierReason(row) {
  const acts = [row.has_like && "bày tỏ cảm xúc", row.has_comment && "bình luận"].filter(Boolean);
  return acts.length ? `Đã ${acts.join(", ")} trên bài viết này` : "";
}

const REACTIONS = {
  LIKE: { icon: "👍", label: "Thích" },
  LOVE: { icon: "❤️", label: "Yêu thích" },
  CARE: { icon: "🥰", label: "Thương thương" },
  HAHA: { icon: "😆", label: "Haha" },
  WOW: { icon: "😮", label: "Wow" },
  SAD: { icon: "😢", label: "Buồn" },
  ANGRY: { icon: "😡", label: "Phẫn nộ" },
};

export function ReactionIcon({ type }) {
  const r = REACTIONS[type];
  if (!r) return null;
  return (
    <span title={r.label} className="text-[13px] leading-none">
      {r.icon}
    </span>
  );
}

export function TierLegend() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] px-4 py-3">
        <p className="text-[13px] font-bold text-[#047857]">Mức 1: Tiềm năng cao</p>
        <p className="mt-1 text-xs leading-5 text-[#059669]">
          Tài khoản vừa <b>Like</b> vừa <b>Comment</b> tại bài viết.
        </p>
      </div>
      <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3">
        <p className="text-[13px] font-bold text-[#B45309]">Mức 2: Tương tác cơ bản</p>
        <p className="mt-1 text-xs leading-5 text-[#D97706]">
          Tài khoản chỉ thực hiện <b>1 hành động</b>: Like, hoặc để lại Comment.
        </p>
      </div>
    </div>
  );
}
