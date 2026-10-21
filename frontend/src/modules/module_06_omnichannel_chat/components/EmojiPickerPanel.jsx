"use client";

import dynamic from "next/dynamic";

/**
 * Bảng chọn biểu tượng cảm xúc đầy đủ (emoji-picker-react): có ô tìm kiếm,
 * chia nhóm, nhớ emoji hay dùng và chọn được tông màu da.
 *
 * Thư viện đụng tới `window` ngay khi dựng nên chỉ nạp phía trình duyệt.
 * Dùng chuỗi "native"/"light" thay vì import enum EmojiStyle/Theme, để gói này
 * không bị kéo vào bundle của server.
 */
const EmojiPicker = dynamic(() => import("emoji-picker-react"), {
  ssr: false,
  loading: () => (
    <p className="flex h-[380px] w-80 items-center justify-center text-xs text-slate-400">
      Đang tải biểu tượng...
    </p>
  ),
});

export default function EmojiPickerPanel({ onPick }) {
  return (
    <EmojiPicker
      onEmojiClick={(data) => onPick(data.emoji)}
      emojiStyle="native" /* dùng font hệ thống, không tải ảnh từ CDN -> chạy được offline */
      theme="light"
      lazyLoadEmojis
      width={320}
      height={380}
      searchPlaceholder="Tìm biểu tượng..."
      previewConfig={{ showPreview: false }}
      style={{ border: "none", fontFamily: "inherit" }}
    />
  );
}
