"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import { Search, X, Clock, Smile, Cat, Utensils, Trophy, Plane, Lightbulb, Heart, Check } from "lucide-react";

const EMOJI_CATEGORIES = [
  {
    id: "smileys",
    name: "Mặt cười & Cảm xúc",
    icon: Smile,
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "🥲", "🥹",
      "☺️", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘",
      "😗", "😙", "😚", "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐",
      "🤓", "😎", "🥸", "🤩", "🥳", "😏", "😒", "😞", "😔", "😟",
      "😕", "🙁", "☹️", "😣", "😖", "😫", "😩", "🥺", "😢", "😭",
      "😮‍💨", "😤", "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱",
      "😨", "😰", "😥", "😓", "🫣", "🤗", "🫡", "🤫", "🫠", "🤥",
      "😶", "😶‍🌫️", "😐", "😑", "😬", "🫨", "🙄", "😯", "😦", "😧",
      "😮", "😲", "🥱", "😴", "🤤", "😪", "😵", "😵‍💫", "🤐", "🥴",
      "🤢", "🤮", "🤧", "😷", "🤒", "🤕", "🤑", "🤠", "😈", "👿"
    ],
  },
  {
    id: "people",
    name: "Cử chỉ & Con người",
    icon: Smile,
    emojis: [
      "👋", "🤚", "🖐️", "✋", "🖖", "🫱", "🫲", "🫳", "🫴", "👌",
      "🤌", "🤏", "✌️", "🤞", "🫰", "🤟", "🤘", "🤙", "👈", "👉",
      "👆", "🖕", "👇", "☝️", "🫵", "👍", "👎", "✊", "👊", "🤛",
      "🤜", "👏", "🙌", "🫶", "👐", "🤲", "🤝", "🙏", "✍️", "💅",
      "🤳", "💪", "🦾", "🦿", "🦵", "🦶", "👂", "🦻", "👃", "🫀",
      "🫁", "🧠", "🦷", "🦴", "👀", "👁️", "👅", "👄", "🫦", "👶",
      "🧒", "👦", "👧", "🧑", "👱", "👨", "🧔", "👩", "🧓", "👴"
    ],
  },
  {
    id: "animals",
    name: "Động vật & Thiên nhiên",
    icon: Cat,
    emojis: [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐻‍❄️", "🐨",
      "🐯", "🦁", "🐮", "🐷", "🐽", "🐸", "🐵", "🙈", "🙉", "🙊",
      "🐒", "🐔", "🐧", "🐦", "🐤", "🐣", "🐥", "🦆", "🦅", "🦉",
      "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🪱", "🐛", "🦋", "🐌",
      "🐞", "🐜", "🪰", "🪲", "🪳", "🦟", "🦗", "🕷️", "🦂", "🐢",
      "🐍", "🦎", "🦖", "🦕", "🐙", "🦑", "🦐", "🦞", "🦀", "🐡",
      "🐠", "🐟", "🐬", "🐳", "🐋", "鲨", "🦭", "🐊", "🐅", "🐆",
      "🦓", "🦍", "🦧", "🦣", "🐘", "🦛", "🦏", "🐪", "🐫", "🦒",
      "🦘", "🦬", "🐃", "🐂", "🐄", "🐎", "🐖", "🐏", "🐑", "🦙",
      "🐐", "🦌", "🐕", "🐩", "🦮", "🐈", "🐓", "🦃", "🦚", "🦜",
      "🌸", "💮", "🏵️", "🌹", "🥀", "🌺", "🌻", "🌼", "🌷", "🌱",
      "🪴", "🌲", "🌳", "🌴", "🌵", "🌾", "🌿", "☘️", "🍀", "🍁"
    ],
  },
  {
    id: "food",
    name: "Đồ ăn & Thức uống",
    icon: Utensils,
    emojis: [
      "🍇", "🍈", "🍉", "🍊", "🍋", "🍌", "🍍", "🥭", "🍎", "🍏",
      "🍐", "🍑", "🍒", "🍓", "🫐", "🥝", "🍅", "🫒", "🥥", "🥑",
      "🍆", "🥔", "🥕", "🌽", "🌶️", "🫑", "🥒", "🥬", "🥦", "🧄",
      "🧅", "🥜", "🫘", "🌰", "🍞", "🥐", "🥖", "🫓", "🥨", "🥯",
      "🥞", "🧇", "🧀", "🍖", "🍗", "🥩", "🥓", "🍔", "🍟", "🍕",
      "🌭", "🥪", "🌮", "🌯", "🫔", "🥙", "🧆", "🥚", "🍳", "🥘",
      "🍲", "🫕", "🥣", "🥗", "🍿", "🧈", "🧂", "🥫", "🍱", "🍘",
      "🍙", "🍚", "🍛", "🍜", "🍝", "🍠", "🍢", "🍣", "🍤", "🍥",
      "🥮", "🍡", "🥟", "🥠", "🥡", "🍦", "🍧", "🍨", "🍩", "🍪",
      "🎂", "🍰", "🧁", "🥧", "🍫", "🍬", "🍭", "🍮", "🍯", "🍼",
      "🥛", "☕", "🫖", "🍵", "🍶", "🍾", "🍷", "🍸", "🍹", "🍺",
      "🍻", "🥂", "🥃", "🥤", "🧋", "🧃", "🧉", "🧊"
    ],
  },
  {
    id: "activities",
    name: "Hoạt động & Thể thao",
    icon: Trophy,
    emojis: [
      "⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🏉", "🥏", "🎱",
      "🪀", "🏓", "🏸", "🏒", "🏑", "🥍", "🏏", "🪃", "🥅", "⛳",
      "🪁", "🏹", "🎣", "🤿", "🥊", "🥋", "🎽", "🛹", "🛼", "🛷",
      "⛸️", "🥌", "🎿", "⛷️", "🏂", "🪂", "🏋️", "🤼", "🤸", "🤺",
      "⛹️", "🤾", "🧗", "🧘", "🏇", "🚴", "🚵", "🎯", "🎮", "🕹️",
      "🎲", "♠️", "♥️", "♦️", "♣️", "♟️", "🎰", "🧩", "🏆", "🥇",
      "🥈", "🥉", "🏅", "🎖️", "🎫", "🎟️", "🎪", "🎭", "🎨", "🎬"
    ],
  },
  {
    id: "travel",
    name: "Du lịch & Địa điểm",
    icon: Plane,
    emojis: [
      "🚗", "🚕", "🚙", "🚌", "🚎", "🏎️", "🚓", "🚑", "🚒", "🚐",
      "🛻", "🚚", "🚛", "🚜", "🦯", "🦽", "🦼", "🛴", "🚲", "🛵",
      "🏍️", "🛺", "🚨", "🚔", "🚍", "🚘", "🚖", "🚡", "🚠", "🚟",
      "🚃", "🚋", "🚞", "🚝", "🚄", "🚅", "🚈", "🚂", "🚆", "🚇",
      "🚊", "🚉", "✈️", "🛫", "🛬", "🛩️", "💺", "🛰️", "🚀", "🛸",
      "🚁", "🛶", "⛵", "🚤", "🛥️", "🛳️", "⛴️", "🚢", "⚓", "🛟",
      "⛽", "🚧", "🚦", "🚥", "🗺️", "🗿", "🗽", "🗼", "🏰", "🏯",
      "🏟️", "🎡", "🎢", "🏖️", "🏝️", "🏜️", "🌋", "⛰️", "🏔️", "🏕️"
    ],
  },
  {
    id: "objects",
    name: "Đồ vật & Biểu tượng",
    icon: Lightbulb,
    emojis: [
      "💡", "🔦", "🏮", "🪔", "📱", "📲", "💻", "⌨️", "🖥️", "🖨️",
      "🖱️", "🪙", "💵", "💴", "💶", "💷", "💸", "💳", "🧾", "💎",
      "⚖️", "🪜", "🧰", "🔧", "🔨", "⚒️", "🛠️", "⛏️", "🪓", "🔩",
      "⚙️", "🪤", "🧱", "⛓️", "🧲", "🔫", "💣", "🧨", "🪓", "🔪",
      "🗡️", "⚔️", "🛡️", "🚬", "⚰️", "🪦", "⚱️", "🏺", "🔮", "📿",
      "🧿", "🪬", "💈", "⚗️", "🧪", "🧫", "🧬", "🔬", "🔭", "📡",
      "💉", "🩸", "💊", "🩹", "🩺", "🚪", "🪞", "🪟", "🛏️", "🛋️",
      "🪑", "🚽", "🪠", "🚿", "🛁", "🪤", "🧴", "🧷", "🧹", "📦",
      "📫", "📪", "📬", "📭", "📮", "📯", "📜", "📃", "📄", "📑"
    ],
  },
  {
    id: "symbols",
    name: "Trái tim & Ký hiệu",
    icon: Heart,
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
      "❤️‍🔥", "❤️‍🩹", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝",
      "💟", "☮️", "✝️", "☪️", "🕉️", "☸️", "✡️", "🔯", "🕎", "☯️",
      "☦️", "🛐", "⛎", "♈", "♉", "♊", "♋", "♌", "♍", "♎",
      "♏", "♐", "♑", "♒", "♓", "🆔", "⚛️", "📴", "📳", "🈶",
      "🈚", "🈸", "🈺", "🈯", "✴️", "❇️", "✳️", "❎", "✅", "✔️",
      "☑️", "🟢", "🔴", "🔵", "🟡", "🟠", "🟣", "⚫", "⚪", "🟩",
      "🟥", "🟦", "🟨", "🟧", "🟪", "⬛", "⬜", "⭐", "🌟", "✨",
      "⚡", "☄️", "💥", "🔥", "🌈", "☀️", "🌤️", "⛅", "🌥️", "☁️"
    ],
  },
];

const LOCAL_STORAGE_RECENT_KEY = "fb_automator_recent_emojis";

export function FacebookEmojiMenu({ isOpen, onClose, onSelectEmoji, targetTitle = "", align = "right" }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState("smileys");
  const [recentEmojis, setRecentEmojis] = useState([]);
  const [justInserted, setJustInserted] = useState(null);
  const menuRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const categoryRefs = useRef({});

  // Tải danh sách emoji gần đây từ LocalStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_RECENT_KEY);
      if (stored) {
        setRecentEmojis(JSON.parse(stored));
      }
    } catch (e) {
      // ignore
    }
  }, [isOpen]);

  // Click ra ngoài Menu hoặc ấn phím ESC để đóng
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Xử lý chọn emoji
  const handleEmojiClick = (emoji) => {
    onSelectEmoji(emoji);
    setJustInserted(emoji);
    setTimeout(() => setJustInserted(null), 1200);

    // Cập nhật recent emojis
    setRecentEmojis((prev) => {
      const updated = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, 16);
      try {
        localStorage.setItem(LOCAL_STORAGE_RECENT_KEY, JSON.stringify(updated));
      } catch (e) {
        // ignore
      }
      return updated;
    });
  };

  // Lọc emoji theo tìm kiếm
  const filteredCategories = useMemo(() => {
    if (!searchTerm.trim()) return EMOJI_CATEGORIES;
    const q = searchTerm.trim().toLowerCase();
    return EMOJI_CATEGORIES.map((cat) => ({
      ...cat,
      emojis: cat.emojis.filter((emoji) => emoji.includes(q) || cat.name.toLowerCase().includes(q)),
    })).filter((cat) => cat.emojis.length > 0);
  }, [searchTerm]);

  const scrollToCategory = (catId) => {
    setActiveCategory(catId);
    if (categoryRefs.current[catId]) {
      categoryRefs.current[catId].scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className={`absolute top-full mt-1.5 z-50 w-[300px] sm:w-[320px] bg-white rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150 ${
        align === "left" ? "left-0" : "right-0"
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header Menu */}
      <div className="px-3.5 py-2.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-base">😃</span>
          <span className="text-xs font-bold text-slate-800 truncate">Biểu tượng cảm xúc</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors cursor-pointer text-xs"
          title="Đóng menu"
        >
          <X size={14} />
        </button>
      </div>

      {/* Search Input */}
      <div className="px-3 pt-2 pb-1.5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm kiếm emoji..."
            autoFocus
            className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-100 hover:bg-slate-100/90 focus:bg-white rounded-xl border border-transparent focus:border-blue-500 focus:outline-none transition-all placeholder:text-slate-400"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-slate-300 hover:bg-slate-400 text-white flex items-center justify-center text-[9px]"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Category Tabs */}
      {!searchTerm && (
        <div className="px-2 py-1 border-b border-slate-100 flex items-center justify-between gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden bg-white">
          {recentEmojis.length > 0 && (
            <button
              type="button"
              onClick={() => scrollToCategory("recent")}
              className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                activeCategory === "recent"
                  ? "bg-blue-50 text-blue-600 font-bold scale-105"
                  : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              }`}
              title="Gần đây"
            >
              <Clock size={15} />
            </button>
          )}
          {EMOJI_CATEGORIES.map((cat) => {
            const IconComp = cat.icon;
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => scrollToCategory(cat.id)}
                className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                  isActive
                    ? "bg-blue-50 text-blue-600 font-bold scale-105"
                    : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                }`}
                title={cat.name}
              >
                <IconComp size={15} />
              </button>
            );
          })}
        </div>
      )}

      {/* Emoji Scroll Area */}
      <div
        ref={scrollContainerRef}
        className="p-2.5 overflow-y-auto flex-1 space-y-3 max-h-[220px] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full"
      >
        {/* Nhóm Gần đây */}
        {!searchTerm && recentEmojis.length > 0 && (
          <div
            ref={(el) => {
              categoryRefs.current["recent"] = el;
            }}
          >
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 px-1">
              Gần đây
            </h4>
            <div className="grid grid-cols-8 gap-0.5">
              {recentEmojis.map((emoji, idx) => (
                <button
                  key={`recent-${idx}`}
                  type="button"
                  onClick={() => handleEmojiClick(emoji)}
                  className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-slate-100 text-xl transition-all hover:scale-125 active:scale-95 cursor-pointer select-none"
                  title={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Các nhóm Emoji chính */}
        {filteredCategories.map((cat) => (
          <div
            key={cat.id}
            ref={(el) => {
              categoryRefs.current[cat.id] = el;
            }}
          >
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 px-1">
              {cat.name}
            </h4>
            <div className="grid grid-cols-8 gap-0.5">
              {cat.emojis.map((emoji, idx) => (
                <button
                  key={`${cat.id}-${idx}`}
                  type="button"
                  onClick={() => handleEmojiClick(emoji)}
                  className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-slate-100 text-xl transition-all hover:scale-125 active:scale-95 cursor-pointer select-none"
                  title={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ))}

        {filteredCategories.length === 0 && (
          <div className="py-8 text-center text-slate-400 text-xs">
            Không tìm thấy emoji nào.
          </div>
        )}
      </div>

      {/* Footer nhỏ gọn */}
      <div className="px-3 py-1.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
        <div className="flex items-center gap-1 min-w-0">
          {justInserted ? (
            <span className="text-emerald-600 font-semibold flex items-center gap-1 animate-in fade-in truncate">
              <Check size={12} className="stroke-[3]" /> Đã chèn {justInserted}
            </span>
          ) : (
            <span className="text-slate-400 truncate">Nhấn để chèn vào bài viết</span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="px-2.5 py-0.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium text-[11px] transition-colors cursor-pointer shrink-0"
        >
          Xong
        </button>
      </div>
    </div>
  );
}

// Backward compatibility export
export const FacebookEmojiModal = FacebookEmojiMenu;
