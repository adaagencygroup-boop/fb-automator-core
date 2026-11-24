"use client";

// Huy hiệu "Mức tiềm năng" (cột QUAN TÂM) + 3 hộp chú giải ở chân bảng — theo Figma Module 12.
// Mức 1: xanh lá #10B981 · Mức 2: vàng cam #F59E0B · Mức 3: xanh dương #3B82F6.

export const TIERS = {
  1: { label: "Mức 1 (Cao)", cls: "bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]" },
  2: { label: "Mức 2 (Vừa)", cls: "bg-[#FFFBEB] border-[#FDE68A] text-[#B45309]" },
  3: { label: "Mức 3 (Cơ bản)", cls: "bg-[#EFF6FF] border-[#BFDBFE] text-[#1D4ED8]" },
};

export function TierBadge({ tier, title }) {
  const t = TIERS[tier] || TIERS[3];
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${t.cls}`}
    >
      {t.label}
    </span>
  );
}

/** Giải thích vì sao người này ở mức đó: đã Like / Share / Bình luận trên bài. */
export function tierReason(row) {
  const acts = [row.has_like && "bày tỏ cảm xúc", row.has_share && "chia sẻ", row.has_comment && "bình luận"].filter(Boolean);
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
    <div className="grid gap-3 md:grid-cols-3">
      <div className="rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] px-4 py-3">
        <p className="text-[13px] font-bold text-[#047857]">Mức 1: Tiềm năng tối đa</p>
        <p className="mt-1 text-xs leading-5 text-[#059669]">
          Tài khoản tương tác tối đa (vừa <b>Like</b>, <b>Share</b> và <b>Comment</b> tại bài viết).
        </p>
      </div>
      <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3">
        <p className="text-[13px] font-bold text-[#B45309]">Mức 2: Tương tác tích cực</p>
        <p className="mt-1 text-xs leading-5 text-[#D97706]">
          Tài khoản có tương tác tích cực (thực hiện <b>2 trong 3</b> hành động Like / Share / Comment).
        </p>
      </div>
      <div className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3">
        <p className="text-[13px] font-bold text-[#1D4ED8]">Mức 3: Tương tác cơ bản</p>
        <p className="mt-1 text-xs leading-5 text-[#2563EB]">
          Tài khoản tương tác cơ bản (chỉ thực hiện <b>1 hành động</b> Like, hoặc Share, hoặc để lại Comment).
        </p>
      </div>
    </div>
  );
}
